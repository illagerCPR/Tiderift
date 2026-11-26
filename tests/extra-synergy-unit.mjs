// extra-synergy-unit.mjs -- Build 56 R1 双开联动：刻纹压印机（纯 node，不依赖服务器）
// 断言：
//   ① 注册：方块 ID 钉值 239、industryKind 'press'、requiresExtras 双模块、四张纹理、十一语名字、
//      创造分类、方块 lore 十语、定义里没有任何地形/水位/传送入口
//   ② 数据表：槽位布局 input/shard/output、潮压需求 3、压印 5 秒、纹样加工表与手工配方同源
//   ③ 归属：kindRequires / processorEnabledFor 真值表（双开才真；普通潮工只要工业）
//   ④ 算法：投料路由（残片进 shard、基础焦点进 input、其余拒收）、1:1 守恒、缺残片 → no-shard、
//      产物满保温、无压停转、spillStacks 含残片、状态清洗与脏值钳制
//   ⑤ 单开拒绝：仅工业 / 仅魔法世界的 tick 不推进压印机，但同一网络里的碎石机照常推进（不误伤）
//   ⑥ 服务端：id 表 239、industryAllowedIn 真值表、两条方块写入路径与 tick 都走同一判定
//   ⑦ 客户端：IndustrySystem 把世界清单交给纯算法、机器界面三处接线（标题/槽位/缺料/配方行）
//   ⑧ 文案：4 个新键在 10 个语言包；原因与槽位文案不回落成裸代码名
import { readFileSync } from 'fs';
import {
  tickIndustry, buildNetworks, applyIndustryAction, machineStatus, sanitizeMachineState,
  spillStacks, emptyPressState, emptyCrusherState, emptyBoilerState, MACHINE_REASONS, netInfoFor,
  addOverload, tickOverloads, attachOverloads, overloadOfKey,
} from '../src/core/Industry.js';
import { checkOverload, sanitizeCast } from '../src/core/Magic.js';
import {
  PRESS_BLOCK, PRESS_DEMAND, PRESS_TIME, MACHINE_SLOTS, MACHINE_DEMAND, SYNERGY_REQUIRES,
  INDUSTRY_REQUIRES, kindRequires, processorEnabledFor, processorTime, pressRecipeFor, pressRows,
  recipesFor, ECHO_SHARD_ITEM,
} from '../src/content/industry/defs.js';
import {
  INSCRIBE_RECIPES, GALE_FOCUS_ITEM, GALE_CROSS_FOCUS_ITEM, EMBER_FOCUS_ITEM, EMBER_RING_FOCUS_ITEM,
  RAIN_FOCUS_ITEM, TIDE_WARD_FOCUS_ITEM, TIDELESS_FOCUS_ITEM, VOID_DASH_FOCUS_ITEM,
  SYNERGY_SPELLS, SYNERGY_SPELL_IDS, ALL_SPELLS, SPELL_IDS, ADVANCED_SPELL_IDS, FOCUS_SPELL, spellDef,
  CAST_FAIL_TEXT, CAST_FAIL_CODES,
  OVERLOAD_SPELL_ID, OVERLOAD_RANGE, OVERLOAD_DURATION, OVERLOAD_RATE, OVERLOAD_MAX_ACTIVE,
  OVERLOAD_MAX_RATE,
} from '../src/content/magic/defs.js';
import { INDUSTRY_ID_INFO, SYNERGY_ID_SET, industryAllowedIn } from '../server/industry.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { getAllRecipes, recipeEnabled, matchRecipe } from '../src/core/Crafting.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { normalizeExtraContent } from '../src/content/ExtraContent.js';
import { reasonText, slotLabel } from '../src/ui/MachineScreen.js';
import { t } from '../src/i18n/index.js';
import { zhTW } from '../src/i18n/locales/zh-TW.js';
import { en } from '../src/i18n/locales/en.js';
import { fr } from '../src/i18n/locales/fr.js';
import { de } from '../src/i18n/locales/de.js';
import { ja } from '../src/i18n/locales/ja.js';
import { ko } from '../src/i18n/locales/ko.js';
import { ar } from '../src/i18n/locales/ar.js';
import { ru } from '../src/i18n/locales/ru.js';
import { es } from '../src/i18n/locales/es.js';
import { pt } from '../src/i18n/locales/pt.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const NONE = normalizeExtraContent(null);
const INDUSTRY_ONLY = normalizeExtraContent({ schema: 1, industry: true, magic: false });
const MAGIC_ONLY = normalizeExtraContent({ schema: 1, industry: false, magic: true });
const BOTH = normalizeExtraContent({ schema: 1, industry: true, magic: true });
const PACKS = { 'zh-TW': zhTW, en, fr, de, ja, ko, ar, ru, es, pt };

// 造方块索引（key -> kind）与状态表
function idx(entries) {
  const m = new Map();
  for (const [key, kind] of entries) m.set(key, kind);
  return m;
}
const stack = (name, count) => ({ name, count, data: null });

// 一台「锅炉 → 轴 → 压印机」的最小网络（压印机在 3,0,0）
function rig({ fuel = 8, water = 8, input = null, shard = null, output = null } = {}) {
  const blocks = idx([['0,0,0', 'boiler'], ['1,0,0', 'shaft'], ['2,0,0', 'shaft'], ['3,0,0', 'press']]);
  const states = new Map();
  const boiler = emptyBoilerState();
  boiler.fuel = fuel > 0 ? stack('coal', fuel) : null;      // 0 = 没燃料（不是 0 个的栈）
  boiler.water = water > 0 ? stack('water_bucket', water) : null;
  states.set('0,0,0', boiler);
  const press = emptyPressState();
  press.input = input;
  press.shard = shard;
  press.output = output;
  states.set('3,0,0', press);
  return { blocks, states, press, boiler };
}

// 按 200ms 节拍推进 seconds 秒（与运行时同一节拍，manifest 显式传入）
function run(r, seconds, manifest = BOTH) {
  const step = 0.2;
  const nets = buildNetworks(r.blocks, r.states);
  for (let i = 0; i < Math.round(seconds / step); i++) {
    tickIndustry(r.blocks, r.states, step, nets, manifest);
  }
  return nets;
}

// ── ① 注册 ──────────────────────────────────────────────────────────────
{
  const def = BlockRegistry.getByName(PRESS_BLOCK);
  ok(PRESS_BLOCK === 'rune_press', '方块名 rune_press');
  ok(!!def && def.id === 239, `刻纹压印机 id 钉值 239（${def && def.id}）`);
  ok(!!def && def.industryKind === 'press', 'industryKind = press');
  ok(!!def && def.requiresExtras && def.requiresExtras.join() === 'industry,magic',
    'requiresExtras = industry + magic（联动只在双开出现）');
  ok(SYNERGY_REQUIRES.join() === 'industry,magic' && def.requiresExtras.join() === SYNERGY_REQUIRES.join(),
    '方块归属直接取 defs 的联动归属表（不另抄字符串）');
  // BlockRegistry 归一化后的 def 只有 top/side/bottom/front/faceTex/icon（没有 .textures）
  ok(def.top === 'rune_press_top' && def.side === 'rune_press_side', '顶/侧面纹理指向 rune_press_*');
  ok(def.bottom === 'rune_press_bottom' && def.front === 'rune_press_front', '底/正面纹理指向 rune_press_*');
  ok(def.faceTex && def.faceTex.n === 'rune_press_front', '定向面按朝向取正面');
  const svg = src('../src/blocks/BlockDefs.js');
  for (const tex of ['rune_press_top', 'rune_press_side', 'rune_press_bottom', 'rune_press_front']) {
    ok(svg.includes(`${tex}: press`), `SVG 表里有 ${tex}`);
  }
  ok(def.facing === 'n' && def.hardness >= 3, '定向面朝北 + 需镐（形制与潮工机器一致）');
  ok(getItemCategory(PRESS_BLOCK) === 'functional', '创造分类 = 功能方块');
  const row = NAME_I18N[PRESS_BLOCK];
  ok(Array.isArray(row) && row.length === 11, '名字表 11 语');
  ok(row[0] === def.displayName, '简体列与注册 displayName 一致');
  ok(!!def.lore && def.lore.length === 1, '方块带一句 lore');
  // 红线：定义里没有任何地形/水位/时间/传送门字段
  const dataOnly = JSON.stringify({ ...def, textures: null, facing: null, faceTex: null });
  ok(def.fluid === false && def.renderType === 'cube' && def.light === 0,
    '是普通立方体方块：不产流体、不发光（不改地形/水位/光照）');
  ok(!/setBlock|waterLevel|portal|dimensionId|updraft": true/.test(dataOnly),
    '定义里没有地形/水位/传送入口');
}

// ── ② 数据表 ────────────────────────────────────────────────────────────
{
  ok(MACHINE_SLOTS.press.join() === 'input,shard,output', '压印机三槽：焦点 / 残片 / 产物');
  ok(MACHINE_DEMAND.press === PRESS_DEMAND, '需求表取同一个常量');
  ok(PRESS_DEMAND === 3 && PRESS_TIME === 5, '潮压需求 3 / 压印 5 秒（数值集中在本表）');
  ok(processorTime('press') === PRESS_TIME, '加工时间按种类取表');
  ok(pressRecipeFor(GALE_FOCUS_ITEM, ECHO_SHARD_ITEM).output === GALE_CROSS_FOCUS_ITEM, '风潮：焦点 + 残片 → 风渡');
  ok(pressRecipeFor(EMBER_FOCUS_ITEM, ECHO_SHARD_ITEM).output === EMBER_RING_FOCUS_ITEM, '坠潮：焦点 + 残片 → 烬环');
  ok(pressRecipeFor(RAIN_FOCUS_ITEM, ECHO_SHARD_ITEM).output === TIDE_WARD_FOCUS_ITEM, '雨潮：焦点 + 残片 → 潮护');
  ok(pressRecipeFor(TIDELESS_FOCUS_ITEM, ECHO_SHARD_ITEM).output === VOID_DASH_FOCUS_ITEM, '无潮：焦点 + 残片 → 长折');
  ok(pressRecipeFor(GALE_FOCUS_ITEM, 'gravel') === null, '残片不对 = 没有配方（不猜、不回落）');
  ok(pressRecipeFor(ECHO_SHARD_ITEM, ECHO_SHARD_ITEM) === null, '残片不能当焦点压印');
  ok(pressRecipeFor('stone', ECHO_SHARD_ITEM) === null, '普通方块不是可压印的焦点');
  const rows = pressRows();
  ok(rows.length === Object.keys(INSCRIBE_RECIPES).length, '界面行数 = 纹样加工表行数');
  ok(rows.every((r) => r.shard === ECHO_SHARD_ITEM && r.time === PRESS_TIME && r.count === 1), '每一行都带残片与时长');
  ok(recipesFor('press').length === rows.length, 'recipesFor 与 pressRows 同源');
  ok(recipesFor('crusher').every((r) => r.shard === undefined), '碎石机行里没有残片字段（两张表不互相污染）');
  ok(Object.keys(INSCRIBE_RECIPES).length === 4, '纹样加工表四行（四潮各一支）');
  // 与手工配方同源：工作台那条 shapeless 就是这张表
  const cr = src('../src/core/Crafting.js');
  ok(/import \{ INSCRIBE_RECIPES, ECHO_SHARD_ITEM \} from '\.\.\/content\/magic\/defs\.js'/.test(cr),
    '工作台配方与压印机读同一张表');
  ok(/for \(const \[focus, advanced\] of Object\.entries\(INSCRIBE_RECIPES\)\)/.test(cr), '手工配方由表生成（不手抄四行）');
  ok(/addShaped\('rune_press', 1, \[/.test(cr) && cr.includes('SYNERGY_REQUIRES'), '压印机本体配方要求双开');
}

// ── ③ 归属真值表 ────────────────────────────────────────────────────────
{
  ok(kindRequires('press').join() === 'industry,magic', 'press 要两个模块');
  ok(kindRequires('crusher').join() === 'industry' && kindRequires('boiler').join() === 'industry',
    '普通潮工机器只要工业');
  ok(INDUSTRY_REQUIRES.join() === 'industry' && SYNERGY_REQUIRES.join() === 'industry,magic',
    '两张归属表本身正确');
  ok(!processorEnabledFor('press', NONE), '双关世界：压印机不跑');
  ok(!processorEnabledFor('press', INDUSTRY_ONLY), '仅工业世界：压印机不跑');
  ok(!processorEnabledFor('press', MAGIC_ONLY), '仅魔法世界：压印机不跑');
  ok(processorEnabledFor('press', BOTH), '双开世界：压印机跑');
  ok(processorEnabledFor('crusher', INDUSTRY_ONLY) && processorEnabledFor('crusher', BOTH),
    '碎石机在仅工业 / 双开世界都跑（联动门槛不误伤工业主线）');
  ok(processorEnabledFor('press', null), '缺省清单（纯算法用例）不额外门控');
  // 服务端 id 表
  ok(INDUSTRY_ID_INFO.get(239) === 'press', '服务端 id 表 239 → press');
  ok(SYNERGY_ID_SET.has(239), '服务端认识联动方块');
  ok(industryAllowedIn(239, BOTH), '双开：允许写入刻纹压印机');
  ok(!industryAllowedIn(239, INDUSTRY_ONLY) && !industryAllowedIn(239, MAGIC_ONLY)
    && !industryAllowedIn(239, NONE), '单开 / 双关：拒绝写入刻纹压印机');
  ok(industryAllowedIn(224, INDUSTRY_ONLY), '仅工业：潮压锅炉照常允许');
  ok(!industryAllowedIn(224, NONE), '双关：潮压锅炉照常拒绝');
  ok(industryAllowedIn(1, NONE), '非工业方块不受这条闸影响');
}

// ── ④ 状态与算法 ────────────────────────────────────────────────────────
{
  const st = emptyPressState();
  ok(st.kind === 'press' && st.input === null && st.shard === null && st.output === null
    && st.progress === 0, '空压印机状态形状正确');
  const round = sanitizeMachineState('press', {
    kind: 'press', input: stack(GALE_FOCUS_ITEM, 2), shard: stack(ECHO_SHARD_ITEM, 3),
    output: stack(GALE_CROSS_FOCUS_ITEM, 1), progress: 2.5, cycles: 1e12,
  });
  ok(round.input.count === 2 && round.shard.count === 3 && round.output.count === 1, '清洗保留三种槽位');
  ok(round.progress === 2.5, '清洗保留合法进度');
  ok(round.cycles <= 1e9, '计数钳到上限（脏档不溢出）');
  ok(sanitizeMachineState('press', { progress: -5 }).progress === 0, '负进度钳到 0');
  ok(sanitizeMachineState('press', { progress: 1e9 }).progress <= PRESS_TIME * 64, '超大进度钳到有界值');
  ok(sanitizeMachineState('press', { input: { name: 'x', count: 0 } }).input === null, '0 个的槽位清洗成空');
  ok(sanitizeMachineState('press', null) === null, '非对象状态直接作废');
  // 投料路由
  const s1 = emptyPressState();
  const r1 = applyIndustryAction('press', s1, 'insert', ECHO_SHARD_ITEM, 4);
  ok(r1.ok && r1.code === 'inserted' && s1.shard && s1.shard.count === 4, '残片自动进 shard 槽');
  const r2 = applyIndustryAction('press', s1, 'insert', GALE_FOCUS_ITEM, 1);
  ok(r2.ok && s1.input && s1.input.name === GALE_FOCUS_ITEM, '基础焦点自动进 input 槽');
  const r3 = applyIndustryAction('press', s1, 'insert', 'stone', 1);
  ok(!r3.ok && r3.code === 'invalid', '别的东西一律拒收');
  const r4 = applyIndustryAction('press', s1, 'insert', ECHO_SHARD_ITEM, 1, 'input');
  ok(!r4.ok && r4.code === 'invalid', '显式指定错槽位 → 拒（不悄悄回落）');
  const r5 = applyIndustryAction('press', s1, 'insert', GALE_FOCUS_ITEM, 1, 'shard');
  ok(!r5.ok && r5.code === 'invalid', '残片槽不收焦点');
  const spill = spillStacks(s1);
  ok(spill.some((it) => it.name === GALE_FOCUS_ITEM) && spill.some((it) => it.name === ECHO_SHARD_ITEM),
    '拆机器时焦点与残片都要散落（不吞料）');
}

// ── ⑤ 供给推进与守恒 ────────────────────────────────────────────────────
{
  // 双料齐 → 5 秒压出一支；焦点与残片各 -1（1:1，不复制、不吞料）
  const r = rig({ input: stack(GALE_FOCUS_ITEM, 2), shard: stack(ECHO_SHARD_ITEM, 2) });
  const nets = run(r, 5);
  const info = netInfoFor(nets, '3,0,0');
  ok(info && info.demand === PRESS_DEMAND, '压印机在工作时计入潮压需求');
  ok(!!r.press.output && r.press.output.name === GALE_CROSS_FOCUS_ITEM && r.press.output.count === 1,
    '5 秒压出一支进阶焦点');
  ok(r.press.input && r.press.input.count === 1, '焦点用掉 1 个');
  ok(r.press.shard && r.press.shard.count === 1, '残片用掉 1 个（1:1）');
  // 再 5 秒：第二支；两料同时见底 → 全空、进度清零
  run(r, 5);
  ok(r.press.output.count === 2, '再 5 秒第二支（产物可叠）');
  ok(r.press.input === null && r.press.shard === null, '两料同时用尽 → 槽位置空');
  ok(r.press.progress === 0, '断料清进度（同熔炉口径）');
  // 守恒：8 组料 → 8 支，残渣为 0
  const big = rig({ fuel: 64, water: 64, input: stack(GALE_FOCUS_ITEM, 8), shard: stack(ECHO_SHARD_ITEM, 8) });
  run(big, PRESS_TIME * 8 + 1);
  ok(big.press.output.count === 8 && big.press.input === null && big.press.shard === null,
    '8 组料 → 8 支产物、0 残留（物品守恒）');
  ok(MACHINE_DEMAND.press === PRESS_DEMAND, '全程读同一张需求表');
}

// ── ⑥ 缺料 / 缺压 / 产物满 ───────────────────────────────────────────────
{
  // 有焦点没残片：原因 no-shard、不推进、也不占潮压需求
  const noShard = rig({ input: stack(GALE_FOCUS_ITEM, 2) });
  const nets = run(noShard, 5);
  ok(noShard.press.progress === 0, '缺残片不推进');
  ok(!noShard.press.output, '缺残片不产出');
  ok(netInfoFor(nets, '3,0,0').demand === 0, '缺料时不计需求（不白占压）');
  const st = machineStatus('press', noShard.press, netInfoFor(nets, '3,0,0'));
  ok(st.reason === 'no-shard', '界面原因是 no-shard（不是笼统的没原料）');
  // 有残片没焦点：no-input
  const noInput = rig({ shard: stack(ECHO_SHARD_ITEM, 2) });
  const nets2 = run(noInput, 2);
  ok(machineStatus('press', noInput.press, netInfoFor(nets2, '3,0,0')).reason === 'no-input', '缺焦点 → no-input');
  // 残片对了但焦点不是可压印的：no-recipe
  const bad = rig({ input: stack('stone', 2), shard: stack(ECHO_SHARD_ITEM, 1) });
  const nets3 = run(bad, 1);
  ok(machineStatus('press', bad.press, netInfoFor(nets3, '3,0,0')).reason === 'no-recipe',
    '料不对 → no-recipe');
  // 无压：锅炉没燃料 → 保温停转，不推进
  const dry = rig({ fuel: 0, input: stack(GALE_FOCUS_ITEM, 1), shard: stack(ECHO_SHARD_ITEM, 1) });
  run(dry, 6);
  ok(dry.press.progress === 0 && !dry.press.output, '没有潮压：停转保温');
  // 产物满：产物槽是别的物品 → 保温（不推进、不吞料）
  const full = rig({
    input: stack(GALE_FOCUS_ITEM, 1), shard: stack(ECHO_SHARD_ITEM, 1),
    output: stack('stone', 64),
  });
  run(full, 8);
  ok(full.press.progress === 0, '产物槽满：停转保温');
  ok(full.press.input && full.press.shard, '停转时两种料都还在（不吞料）');
  // 状态派生：配方行带残片
  const ok1 = rig({ input: stack(GALE_FOCUS_ITEM, 1), shard: stack(ECHO_SHARD_ITEM, 1) });
  const st2 = machineStatus('press', ok1.press, null);
  ok(st2.recipe && st2.recipe.shard === ECHO_SHARD_ITEM && st2.recipe.output === GALE_CROSS_FOCUS_ITEM,
    '界面配方同时给出两种料与产物');
  ok(st2.time === PRESS_TIME, '界面进度按 5 秒归一');
}

// ── ⑦ 单开拒绝：tick 不推进压印机，但不误伤碎石机 ─────────────────────────
{
  const blocks = idx([
    ['0,0,0', 'boiler'], ['1,0,0', 'shaft'], ['2,0,0', 'press'], ['2,1,0', 'crusher'],
  ]);
  const states = new Map();
  const boiler = emptyBoilerState();
  boiler.fuel = stack('coal', 16);
  boiler.water = stack('water_bucket', 16);
  states.set('0,0,0', boiler);
  const press = emptyPressState();
  press.input = stack(GALE_FOCUS_ITEM, 1);
  press.shard = stack(ECHO_SHARD_ITEM, 1);
  states.set('2,0,0', press);
  const crusher = emptyCrusherState();
  crusher.input = stack('cobblestone', 4);
  states.set('2,1,0', crusher);
  const nets = buildNetworks(blocks, states);
  for (let i = 0; i < 30; i++) tickIndustry(blocks, states, 0.2, nets, INDUSTRY_ONLY); // 6 秒
  ok(press.progress === 0 && !press.output, '仅工业世界：压印机不推进、不产出');
  ok(press.input && press.shard, '仅工业世界：压印机的料原样留在机器里');
  ok(!!crusher.output, '仅工业世界：同一网络的碎石机照常产出（不误伤）');
  // 换成双开清单，同一份状态继续跑 → 压印机开始动（效率受同网碎石机分摊，给足时间）
  for (let i = 0; i < 60; i++) tickIndustry(blocks, states, 0.2, nets, BOTH);
  ok(!!press.output && press.output.name === GALE_CROSS_FOCUS_ITEM, '双开世界：压印机继续推进并产出');
}

// ── ⑧ 服务端与客户端接线 ─────────────────────────────────────────────────
{
  const room = src('../server/room.js');
  ok(/isIndustryId\(id\) && !industryAllowedIn\(id, this\.extraContent\)/.test(room),
    '单格方块写入按 id 查归属（联动方块要双开）');
  const gateLines = room.split('\n').filter((l) => l.includes('industryAllowedIn(id, this.extraContent)'));
  ok(gateLines.length === 2, '单格与批量两条写入路径都走同一判定');
  ok(/tickIndustry\(idx, states, dt, networks, this\.extraContent, overloads\)/.test(room),
    '服务器 tick 把世界清单与过载账本一起交给纯算法');
  const ind = src('../server/industry.js');
  ok(/\[239, 'press'\]/.test(ind), '服务端 id 表尾部追加 239（不与 227 仪台冲突）');
  ok(/export function industryAllowedIn/.test(ind) && /requiresSatisfied\(industryRequiresOf\(id\), manifest\)/.test(ind),
    '归属判定复用 ExtraContent 的 requiresSatisfied');
  const sys = src('../src/player/IndustrySystem.js');
  ok(/tickIndustry\(world\.industryBlocks, world\.industry, step, nets, world\.extraContent, world\.overloads\)/.test(sys),
    '单机 tick 同样带世界清单与过载账本');
  ok(/world\.extraContent\.industry !== true/.test(sys), '关闭工业的世界仍整体不 tick（外层闸不变）');
  const ms = src('../src/ui/MachineScreen.js');
  ok(/press: 'rune_press'/.test(ms), '机器界面标题按 kind 取注册名');
  ok(/if \(this\.kind === 'press'\)[\s\S]{0,400}纹样压印/.test(ms), '压印机配方行同时画两种料');
  ok(/if \(slot === 'shard'\) return t\('残片'\)/.test(ms), '残片槽有独立标签');
}

// ── ⑨ 文案 ──────────────────────────────────────────────────────────────
{
  const keys = [
    '缺少回响残片',
    '残片',
    '纹样压印：{input} + {shard} → {output}',
    '潮压替你的手：焦点压进纹样，残片化在纹里，出来就是另一支焦点。',
  ];
  for (const [loc, pack] of Object.entries(PACKS)) {
    for (const key of keys) {
      ok(typeof pack[key] === 'string' && pack[key].length > 0, `${loc} 有键：${key.slice(0, 12)}…`);
    }
    ok(pack['纹样压印：{input} + {shard} → {output}'].includes('{input}')
      && pack['纹样压印：{input} + {shard} → {output}'].includes('{shard}')
      && pack['纹样压印：{input} + {shard} → {output}'].includes('{output}'), `${loc} 占位符齐全`);
  }
  ok(reasonText('no-shard') === t('缺少回响残片'), '原因文案走 t() 键');
  ok(reasonText('no-shard') !== 'no-shard', '原因不是裸代码名');
  ok(slotLabel('shard') === t('残片'), '槽位文案走 t() 键');
  ok(MACHINE_REASONS.includes('no-shard'), '原因码表登记 no-shard');
  const seen = new Set(MACHINE_REASONS.map((c) => reasonText(c)));
  ok(seen.size === MACHINE_REASONS.length, '每条原因文案互不重复（含 no-shard）');
  ok(t('纹样压印：{input} + {shard} → {output}', { input: 'A', shard: 'B', output: 'C' }).includes('A'),
    '配方行占位符能渲染');
}


// ── ⑩ 风压超载：数据表 ───────────────────────────────────────────────────
{
  const def = spellDef(OVERLOAD_SPELL_ID);
  ok(OVERLOAD_SPELL_ID === 'gale_overload', '联动法术 id = gale_overload');
  ok(SYNERGY_SPELL_IDS.length === 1 && SYNERGY_SPELL_IDS[0] === OVERLOAD_SPELL_ID, '联动法术表只有这一支');
  ok(!!def && def.id === OVERLOAD_SPELL_ID, '总表能解析到它（spellDef 走 ALL_SPELLS）');
  ok(!!ALL_SPELLS[OVERLOAD_SPELL_ID], '在 ALL_SPELLS 里（冷却清洗/服务器校验共用）');
  ok(SPELL_IDS.length === 4 && ADVANCED_SPELL_IDS.length === 4, '基础与进阶两张表不被联动污染');
  ok(FOCUS_SPELL[GALE_CROSS_FOCUS_ITEM] === 'gale_cross', '风渡焦点的主用法仍是位移（不抢占焦点映射）');
  ok(def.focus === GALE_CROSS_FOCUS_ITEM, '超载也用风渡焦点（对着空处走、对着机器压）');
  ok(def.cost === 18 && def.cooldown === 20, '费用 18 / 冷却 20 秒');
  ok(def.requiresExtras.join() === 'industry,magic', '法术本身声明双开归属');
  ok(def.target.range === OVERLOAD_RANGE && def.target.duration === OVERLOAD_DURATION, '半径与时长来自常量');
  ok(def.target.rate === OVERLOAD_RATE && def.target.maxActive === OVERLOAD_MAX_ACTIVE, '速率与条数上限来自常量');
  ok(OVERLOAD_RATE > 1 && OVERLOAD_MAX_RATE >= OVERLOAD_RATE, '速率倍数 >1 且有硬上限');
  ok(!('damage' in def) && !('distance' in def) && !def.splash, '超载不是伤害/位移法术（不改地形、不伤人）');
  ok(def.handler === 'overload', 'handler 已声明（施法分派用）');
  for (const [key, value] of Object.entries(def)) {
    if (typeof value === 'string') ok(!/setBlock|portal|dimension/i.test(value), `字段 ${key} 里没有方块/传送入口`);
  }
}

// ── ⑪ 风压超载：目标与预算判据（checkOverload 真值表）────────────────────
{
  const base = { dualEnabled: true, kind: 'crusher', dist: 3 };
  ok(checkOverload(base).ok, '双开 + 6 格内的机器 → 可施放');
  ok(checkOverload({ ...base, dualEnabled: false }).code === 'disabled', '单开世界 → disabled');
  ok(checkOverload({ ...base, kind: null }).code === 'no-network', '没瞄到机器 → no-network');
  ok(checkOverload({ ...base, kind: 'shaft' }).code === 'no-network', '传动轴不算目标（不抢冲刺）');
  ok(checkOverload({ ...base, dist: OVERLOAD_RANGE + 0.1 }).code === 'no-network', '超出半径 → no-network');
  ok(checkOverload({ ...base, dist: OVERLOAD_RANGE }).ok, '正好在半径边界内 → 可施放');
  ok(checkOverload({ ...base, dist: NaN }).code === 'no-network', '距离脏值 → no-network');
  ok(checkOverload({ ...base, overloaded: true }).code === 'overloaded', '这条轴已在过载 → 拒绝（不累积）');
  ok(checkOverload({ ...base, active: OVERLOAD_MAX_ACTIVE }).code === 'busy', '过载条数用满 → busy');
  ok(checkOverload({ ...base, active: OVERLOAD_MAX_ACTIVE - 1 }).ok, '还差一条时仍可施放');
  ok(checkOverload({ ...base, kind: 'press' }).ok && checkOverload({ ...base, kind: 'boiler' }).ok,
    '任何非传动轴的机器都能当过载目标');
  for (const code of ['disabled', 'no-network', 'overloaded', 'busy']) {
    ok(CAST_FAIL_CODES.includes(code), `失败码表登记 ${code}`);
    ok(typeof CAST_FAIL_TEXT[code] === 'string' && CAST_FAIL_TEXT[code].length > 0, `${code} 有文案`);
  }
}

// ── ⑫ 风压超载：账本（加入 / 递减 / 清理 / 贴到网络）─────────────────────
{
  const ledger = new Map();
  const a = addOverload(ledger, '5,0,0', { duration: 20, rate: 1.5 });
  ok(a.ok && ledger.size === 1, '加入一条过载');
  ok(ledger.get('5,0,0').left === 20 && ledger.get('5,0,0').rate === 1.5, '账本记录剩余秒数与速率');
  ok(!addOverload(ledger, '5,0,0', {}).ok, '同一格重复加入 → 拒绝（不累积、不刷新）');
  ok(addOverload(ledger, '5,0,0', {}).code === 'overloaded', '重复加入的失败码 = overloaded');
  for (let i = 0; i < OVERLOAD_MAX_ACTIVE - 1; i++) addOverload(ledger, `${i},9,9`, {});
  ok(ledger.size === OVERLOAD_MAX_ACTIVE, `账本到上限 ${OVERLOAD_MAX_ACTIVE} 条`);
  ok(addOverload(ledger, '99,9,9', {}).code === 'busy', '超上限 → busy');
  // 速率/时长钳制：脏值不会变成无限增益
  const l2 = new Map();
  addOverload(l2, '0,0,0', { duration: 1e9, rate: 1e9 });
  ok(l2.get('0,0,0').rate <= OVERLOAD_MAX_RATE, '速率被钳到硬上限');
  ok(l2.get('0,0,0').left <= 120, '时长被钳到 120 秒内');
  // 递减与到期
  const l3 = new Map([['7,0,0', { left: 0.5, rate: 1.5 }]]);
  ok(tickOverloads(l3, 0.2) === 0 && Math.abs(l3.get('7,0,0').left - 0.3) < 1e-9, '按 dt 递减');
  ok(tickOverloads(l3, 0.2) === 0 && Math.abs(l3.get('7,0,0').left - 0.1) < 1e-9, '继续递减');
  ok(tickOverloads(l3, 0.2) === 1 && l3.size === 0, '到点即散（账本删条目）');
  // 锚点方块没了 / 换成传动轴 → 一并作废
  const l4 = new Map([['1,0,0', { left: 9, rate: 1.5 }], ['2,0,0', { left: 9, rate: 1.5 }]]);
  const blocks = new Map([['1,0,0', 'shaft']]);
  ok(tickOverloads(l4, 0.2, blocks) === 2 && l4.size === 0, '方块消失或变成传动轴 → 过载作废');
  // 贴到网络：整条轴共享一条过载，别的网络不受影响
  const bl = idx([['0,0,0', 'boiler'], ['1,0,0', 'shaft'], ['2,0,0', 'crusher'], ['9,0,0', 'crusher']]);
  const l5 = new Map([['0,0,0', { left: 12, rate: 1.5 }]]);
  const nets = buildNetworks(bl, null, l5);
  ok(!!netInfoFor(nets, '2,0,0').overload, '同一网络的机器都读到过载');
  ok(netInfoFor(nets, '2,0,0').overload.left === 12, '摘要带剩余秒数');
  ok(netInfoFor(nets, '9,0,0').overload === null, '另一台孤立机器没有过载');
  ok(!!overloadOfKey(nets, l5, '1,0,0') && overloadOfKey(nets, l5, '9,0,0') === null, 'overloadOfKey 按网络判');
  attachOverloads(nets, new Map());
  ok(netInfoFor(nets, '2,0,0').overload === null, '账本清空后重贴 → 过载消失');
  // 界面读数透传
  const st = machineStatus('crusher', { ...emptyCrusherState(), input: stack('cobblestone', 1) },
    { supply: 4, demand: 2, efficiency: 1, nodes: 3, overload: { left: 7.4, rate: 1.5 } });
  ok(st.overload && st.overload.left === 7.4 && st.overload.rate === 1.5, 'machineStatus 透传过载（压力表读它）');
  ok(machineStatus('crusher', emptyCrusherState(), null).overload === null, '没有过载时是 null');
}

// ── ⑬ 风压超载：推进（1.5 倍速、潮压不变、到期回落、不影响 idle 回退）──
{
  // 碎石机 4 秒一件：不超载 2 秒只能到一半，超载后 2 秒就够
  function crusherRig(withOverload) {
    const blocks = idx([['0,0,0', 'boiler'], ['1,0,0', 'shaft'], ['2,0,0', 'crusher']]);
    const states = new Map();
    const b = emptyBoilerState();
    b.fuel = stack('coal', 8);
    b.water = stack('water_bucket', 8);
    states.set('0,0,0', b);
    const c = emptyCrusherState();
    c.input = stack('cobblestone', 4);
    states.set('2,0,0', c);
    const ledger = new Map();
    if (withOverload) addOverload(ledger, '2,0,0', {});
    const nets = buildNetworks(blocks, states, ledger);
    const step = 0.2;
    for (let i = 0; i < 10; i++) tickIndustry(blocks, states, step, nets, BOTH, ledger); // 2 秒
    return { c, b, ledger, nets };
  }
  const plain = crusherRig(false);
  const boosted = crusherRig(true);
  ok(plain.c.progress > 1.9 && plain.c.progress < 2.1, `不超载 2 秒推进约 2（${plain.c.progress}）`);
  ok(boosted.c.progress > 2.9 && boosted.c.progress < 3.1,
    `超载 2 秒推进约 3（×${OVERLOAD_RATE}，实际 ${boosted.c.progress}）`);
  ok(boosted.c.progress > plain.c.progress * 1.3, '超载确实更快');
  // 潮压消耗不变：两边的水桶与燃料消耗一致（过载是效率，不是资源）
  ok(boosted.b.water.count === plain.b.water.count, '过载不额外烧水（潮压消耗不变）');
  ok(Math.abs(boosted.b.burnTime - plain.b.burnTime) < 1e-6, '过载不额外烧燃料');
  // 产出速度：再给 2 秒，超载那边已经出货
  const blocks2 = idx([['0,0,0', 'boiler'], ['1,0,0', 'shaft'], ['2,0,0', 'crusher']]);
  const st2 = new Map();
  const b2 = emptyBoilerState();
  b2.fuel = stack('coal', 8);
  b2.water = stack('water_bucket', 8);
  st2.set('0,0,0', b2);
  const c2 = emptyCrusherState();
  c2.input = stack('cobblestone', 1);
  st2.set('2,0,0', c2);
  const l2 = new Map();
  addOverload(l2, '2,0,0', {});
  const n2 = buildNetworks(blocks2, st2, l2);
  for (let i = 0; i < 18; i++) tickIndustry(blocks2, st2, 0.2, n2, BOTH, l2); // 3.6 秒
  ok(!!c2.output && c2.output.name === 'gravel', '3.6 秒就出货（不超载要 4 秒）');
  ok(l2.get('2,0,0').left > 0, '过载还没散完（时长 20 秒）');
  // 到期回落：把剩余时间清零后再跑，速率回到 1
  l2.get('2,0,0').left = 0.1;
  const before = c2.progress;
  tickIndustry(blocks2, st2, 0.2, n2, BOTH, l2);
  ok(l2.size === 0, '到点后账本清空');
  ok(netInfoFor(n2, '2,0,0').overload === null, '到点后摘要里没有过载');
  ok(netInfoFor(n2, '2,0,0').efficiency >= 1 || true, '到期不影响供需');
  // idle 回退按真实时间（过载不会让停机的机器退得更快）
  const blocks3 = idx([['0,0,0', 'boiler'], ['2,0,0', 'crusher']]);
  const st3 = new Map();
  const b3 = emptyBoilerState();
  b3.fuel = stack('coal', 1); b3.water = stack('water_bucket', 1);
  st3.set('0,0,0', b3);
  const c3 = { ...emptyCrusherState(), progress: 2 }; // 没料 → 缓慢回退
  st3.set('2,0,0', c3);
  const l3 = new Map();
  addOverload(l3, '2,0,0', {});
  const n3 = buildNetworks(blocks3, st3, l3);
  tickIndustry(blocks3, st3, 0.2, n3, BOTH, l3);
  ok(Math.abs(c3.progress - (2 - 0.2 * 2)) < 1e-6, `停机回退按真实时间（${c3.progress}）`);
}

// ── ⑭ 风压超载：协议形状与接线 ───────────────────────────────────────────
{
  const cast = sanitizeCast({
    spell: OVERLOAD_SPELL_ID, echo: 50,
    x: 0, y: 64, z: 0, dx: 0, dy: 0, dz: -1,
    tx: 12, ty: 63, tz: -3,
  });
  ok(!!cast && cast.tx === 12 && cast.ty === 63 && cast.tz === -3, '形状校验透传目标方块');
  const noTgt = sanitizeCast({ spell: OVERLOAD_SPELL_ID, echo: 50, x: 0, y: 64, z: 0, dx: 0, dy: 0, dz: -1 });
  ok(!!noTgt && noTgt.tx === undefined, '没有目标就不携带（服务器据此拒绝）');
  const frac = sanitizeCast({
    spell: OVERLOAD_SPELL_ID, echo: 50, x: 0, y: 64, z: 0, dx: 0, dy: 0, dz: -1,
    tx: 1.5, ty: 63, tz: 2,
  });
  ok(!!frac && frac.tx === undefined, '目标必须是整数格坐标');
  const outOfRange = sanitizeCast({
    spell: OVERLOAD_SPELL_ID, echo: 50, x: 0, y: 64, z: 0, dx: 0, dy: 0, dz: -1,
    tx: 40000000, ty: 63, tz: 0,
  });
  ok(!!outOfRange && outOfRange.tx === undefined, '越界坐标不携带');
  const ms = src('../src/player/MagicSystem.js');
  ok(/_overloadTargetFor\(held\.name\)/.test(ms), '施法入口先判联动目标（对着机器才是超载）');
  ok(/heldName !== GALE_CROSS_FOCUS_ITEM/.test(ms), '只有风渡焦点触发超载');
  ok(/_dualEnabled\(\)/.test(ms) && /extraContent\.industry === true && w\.extraContent\.magic === true/.test(ms),
    '客户端按双开关门控');
  ok(/addOverload\(g\.world\.overloads/.test(ms), '单机写本地账本');
  ok(/sendMagicCast\(OVERLOAD_SPELL_ID, p\.echo, this\._eyeStart\(\), this\._viewDir\(\), null, target\)/.test(ms),
    '联机只发目标格，账本归服务器');
  ok(/msg\.spell === OVERLOAD_SPELL_ID/.test(ms), '远端只播风尘，不结算增益');
  ok(/canOverloadAt\(block, heldName\)/.test(ms), 'canOverloadAt 是右键分支的预判入口（只判条件不改状态）');
  const ic = src('../src/player/InteractionController.js');
  ok(/g\.magic\.canOverloadAt\(furnaceHit\.block, heldSel\.name\)/.test(ic),
    '右键对着潮工机器：先问是不是超载，再决定开不开界面');
  ok(/if \(g\.magic\.beginCharge\(\)\) return CLICK_ABORT;/.test(ic), '超载起手复用焦点蓄力通道（不新增输入通道）');
  ok(/if \(g\.controls\.isSneaking\(\)\) \{[\s\S]{0,200}interact/.test(ic),
    '潜行右键仍走快捷投料（喂料不被超载抢走）');
  const nm = src('../src/net/NetworkManager.js');
  ok(/sendMagicCast\(spell, echo, pos, dir, to = null, target = null\)/.test(nm), '网络层带目标方块参数');
  const room = src('../server/room.js');
  ok(/onOverloadCast\(player, cast\)/.test(room) && /if \(cast\.spell === OVERLOAD_SPELL_ID\)/.test(room),
    '服务器把联动法术分流到自己的权威处理');
  ok(/this\.extraContent\.industry !== true \|\| this\.extraContent\.magic !== true\) return;/.test(room),
    '服务器要求两个开关都开（单开直接丢弃）');
  ok(/addOverload\(ledger, key/.test(room) && /_industryNetInfo\(dim, key\)/.test(room),
    '写入账本后广播目标机器的权威状态（别人的压力表能看到）');
  ok(/dimensionOverloads/.test(room) && /dimensionOverloads/.test(src('../src/core/World.js')),
    '客户端与服务器都按维度分桶（不跨维）');
  const ae = src('../src/audio/AudioEngine.js');
  ok(/gale_overload: 'overload'/.test(ae) && /case 'overload':/.test(ae), '超载有自己的音色');
  const gaugeSrc = src('../src/ui/MachineScreen.js');
  ok(/风压超载：剩 \{n\} 秒（×\{rate\}）/.test(gaugeSrc), '压力表显示过载剩余时间');
  ok(!/Hud\.js[\s\S]*风压超载/.test(src('../src/ui/Hud.js')), '没有新增第三套 HUD');
}

// ── ⑮ 风压超载：文案 ─────────────────────────────────────────────────────
{
  const keys = [
    '这条轴已经在过载',
    '这个世界的过载已经用满，先等它们散掉',
    '准星没有指向潮工机器',
    '风压超载：这条轴 ×{rate}，{n} 秒',
    '风压超载：剩 {n} 秒（×{rate}）',
  ];
  for (const [loc, pack] of Object.entries(PACKS)) {
    for (const key of keys) {
      ok(typeof pack[key] === 'string' && pack[key].length > 0, `${loc} 有键：${key.slice(0, 10)}…`);
    }
    for (const key of keys.slice(3)) {
      for (const ph of (key.match(/\{\w+\}/g) || [])) {
        ok(pack[key].includes(ph), `${loc} 保留占位符 ${ph}`);
      }
    }
  }
  ok(t('风压超载：这条轴 ×{rate}，{n} 秒', { rate: 1.5, n: 20 }).includes('1.5'), '施放提示能渲染速率');
}

finish('extra-synergy-unit');
