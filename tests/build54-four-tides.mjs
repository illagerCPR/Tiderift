// build54-four-tides.mjs -- Build 54 R1 四潮齐备（雨潮回潮 / 无潮折步）纯 node 回归
// 断言：
//   ① 内容：两个新焦点 id 钉值 144/145、11 语名字、创造分类、归属 magic、配方只认魔法开关
//   ② 四系独立：魔法配方不含任何工业方块/物品，仅工业世界合不出焦点
//   ③ 法术表：四支基础方向、每支焦点唯一、费用与冷却为正、回潮与折步的边界字段
//   ④ 施法校验：四个法术的真值表（手持正确焦点 ok、拿错 wrong-focus）
//   ⑤ 回潮治疗：按缺失量裁剪、满血拒绝、脏值兜底（永不超上限）
//   ⑥ 折步落点：最远可站立点、遇挡即停（不越墙）、无立足点 → 0、未加载格视为被挡
//   ⑦ 形状校验：落点可选透传、越远落点丢弃、部分字段丢弃
//   ⑧ 源码绊线：失败不扣回响且不进冷却、折步查已加载区块、回潮走 planMend + 既有状态效果、
//      魔法域不写方块（不改地形）、服务器透传落点表现
import { readFileSync } from 'fs';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { matchRecipe, recipeEnabled, getAllRecipes } from '../src/core/Crafting.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { normalizeExtraContent } from '../src/content/ExtraContent.js';
import {
  SPELLS, SPELL_IDS, FOCUS_SPELL,
  RAIN_FOCUS_ITEM, TIDELESS_FOCUS_ITEM, ECHO_DUST_ITEM,
} from '../src/content/magic/defs.js';
import {
  checkCast, planMend, resolveBlinkTarget, sanitizeCast,
} from '../src/core/Magic.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const MAGIC = normalizeExtraContent({ schema: 1, magic: true });
const INDUSTRY = normalizeExtraContent({ schema: 1, industry: true });
const NONE = normalizeExtraContent(null);

// 工业专属方块/物品：魔法配方出现它们就等于「魔法必须靠工业才能起步」
const INDUSTRY_NAMES = [
  'tide_boiler', 'drive_shaft', 'crusher', 'tide_cutter', 'drive_clutch',
  'filter_hopper', 'harvester', 'pressure_gauge',
];

// ── ① 内容 ──────────────────────────────────────────────────────────────
{
  const rain = ItemRegistry.getByName(RAIN_FOCUS_ITEM);
  const tideless = ItemRegistry.getByName(TIDELESS_FOCUS_ITEM);
  ok(rain && rain.id === 144, `雨潮焦点 id 钉值 144（${rain && rain.id}）`);
  ok(tideless && tideless.id === 145, `无潮焦点 id 钉值 145（${tideless && tideless.id}）`);
  for (const it of [rain, tideless]) {
    ok(it && it.requiresExtras && it.requiresExtras.join() === 'magic', `${it && it.name} 归属魔法内容`);
    ok(it && it.stack === 1, `${it && it.name} 不可堆叠（焦点是唯一法器）`);
    ok(it && Array.isArray(it.lore) && it.lore.length === 1, `${it && it.name} 带一句 lore`);
  }
  for (const name of [RAIN_FOCUS_ITEM, TIDELESS_FOCUS_ITEM]) {
    const row = NAME_I18N[name];
    ok(Array.isArray(row) && row.length === 11, `${name} 名字表 11 语`);
  }
  ok(getItemCategory(RAIN_FOCUS_ITEM) === 'tools' && getItemCategory(TIDELESS_FOCUS_ITEM) === 'tools',
    '两个新焦点创造分类 = 工具');
  // 注册表不含仅工业世界的名字（关闭工业时仍然注册，只是配方/界面看不到）
  ok(!!BlockRegistry.getByName('resonance_table'), '仪台仍只注册一次（核心开关门控在配方层）');
}

// ── ② 配方：四系只认魔法，不依赖工业 ────────────────────────────────────
{
  const magicRecipes = getAllRecipes().filter((r) => (r.requiresExtras || []).includes('magic'));
  ok(magicRecipes.length >= 6, `魔法配方至少六条（实际 ${magicRecipes.length}）`);
  for (const r of magicRecipes) {
    ok(r.requiresExtras.length === 1 && r.requiresExtras[0] === 'magic',
      `${r.output} 只要求魔法（不捆工业）`);
    const flat = r.type === 'shaped'
      ? r.pattern.flat().filter(Boolean)
      : r.ingredients.filter(Boolean).map((i) => (typeof i === 'string' ? i : i.name));
    for (const name of INDUSTRY_NAMES) {
      ok(!flat.includes(name), `${r.output} 不用工业件 ${name}`);
    }
  }
  const rainRecipe = magicRecipes.find((r) => r.output === RAIN_FOCUS_ITEM);
  const tidelessRecipe = magicRecipes.find((r) => r.output === TIDELESS_FOCUS_ITEM);
  ok(!!rainRecipe && recipeEnabled(rainRecipe, MAGIC), '雨潮焦点配方在启用魔法时可用');
  ok(!!tidelessRecipe && recipeEnabled(tidelessRecipe, MAGIC), '无潮焦点配方在启用魔法时可用');
  ok(!recipeEnabled(rainRecipe, NONE) && !recipeEnabled(tidelessRecipe, NONE),
    '关闭魔法：两个新焦点都合不出');
  ok(!recipeEnabled(rainRecipe, INDUSTRY) && !recipeEnabled(tidelessRecipe, INDUSTRY),
    '只开工业：新焦点依然合不出（只有魔法主线能起步）');
  // 两个焦点的材料都是基础资源（不靠遗迹/稀有保底）
  ok(matchRecipe([
    [null, 'clay_ball', null],
    ['clay_ball', 'echo_dust', 'clay_ball'],
    [null, 'clay_ball', null],
  ], MAGIC)?.name === RAIN_FOCUS_ITEM, '雨潮焦点 = 四岸泥 + 回响尘');
  ok(matchRecipe([
    [null, 'ender_pearl', null],
    ['ender_pearl', 'echo_dust', 'ender_pearl'],
    [null, 'ender_pearl', null],
  ], MAGIC)?.name === TIDELESS_FOCUS_ITEM, '无潮焦点 = 四末影珍珠 + 回响尘');
  ok(ECHO_DUST_ITEM === 'echo_dust', '焦点共用的仍是同一份回响尘');
}

// ── ③ 法术表 ────────────────────────────────────────────────────────────
{
  ok(SPELL_IDS.length === 4, `四支基础方向（${SPELL_IDS.join(', ')}）`);
  const focuses = SPELL_IDS.map((id) => SPELLS[id].focus);
  ok(new Set(focuses).size === 4, '四支法术各有专属焦点');
  for (const id of SPELL_IDS) {
    const def = SPELLS[id];
    ok(def.cost > 0 && def.cooldown > 0, `${id} 有费用与冷却`);
    ok(def.cost <= 30, `${id} 单次费用不超过 30（不被一次掏空）`);
  }
  ok(SPELLS.tide_mend.focus === RAIN_FOCUS_ITEM && SPELLS.void_step.focus === TIDELESS_FOCUS_ITEM,
    '回潮 / 折步绑定各自的焦点');
  ok(SPELLS.tide_mend.heal > 0 && SPELLS.tide_mend.heal < 20, '回潮一次补不满满血（不能当免费回血池）');
  ok(SPELLS.tide_mend.guardEffect === 'resistance' && SPELLS.tide_mend.guardSeconds > 0,
    '回潮的防护复用既有状态效果，不新造 buff 系统');
  ok(SPELLS.void_step.distance >= 4 && SPELLS.void_step.distance <= 10, '折步是短距（4~10 格）');
  ok(SPELLS.void_step.standDepth >= 1, '折步要求脚下有立足面');
  ok(FOCUS_SPELL[RAIN_FOCUS_ITEM] === 'tide_mend' && FOCUS_SPELL[TIDELESS_FOCUS_ITEM] === 'void_step',
    '焦点 → 法术映射覆盖四系');
}

// ── ④ 施法校验 ──────────────────────────────────────────────────────────
{
  const base = {
    echo: 60, cooldownLeft: 0, magicEnabled: true, spectator: false, creative: false,
  };
  for (const id of SPELL_IDS) {
    const focus = SPELLS[id].focus;
    ok(checkCast({ ...base, spellId: id, held: focus }).ok, `${id}：五关齐备可施放`);
    ok(checkCast({ ...base, spellId: id, held: null }).code === 'no-focus', `${id}：空手 → no-focus`);
    const other = SPELL_IDS.find((x) => x !== id);
    ok(checkCast({ ...base, spellId: id, held: SPELLS[other].focus }).code === 'wrong-focus',
      `${id}：拿错焦点 → wrong-focus`);
    ok(checkCast({ ...base, spellId: id, held: focus, echo: 1 }).code === 'echo', `${id}：回响不足 → echo`);
    ok(checkCast({ ...base, spellId: id, held: focus, cooldownLeft: 0.3 }).code === 'cooldown',
      `${id}：冷却中 → cooldown`);
    ok(checkCast({ ...base, spellId: id, held: focus, creative: true }).code === 'mode',
      `${id}：创造模式拒绝`);
    ok(checkCast({ ...base, spellId: id, held: focus, magicEnabled: false }).code === 'disabled',
      `${id}：关闭魔法的世界拒绝`);
  }
}

// ── ⑤ 回潮治疗 ──────────────────────────────────────────────────────────
{
  ok(planMend(10, 20, 6).heal === 6, '回潮：缺口够大 → 按配置补满 6');
  const near = planMend(17, 20, 6);
  ok(near.ok && near.heal === 3 && near.health === 20, '回潮：只补到生命上限（不溢出）');
  ok(planMend(20, 20, 6).ok === false && planMend(20, 20, 6).code === 'full', '满血 → 拒绝且不治疗');
  ok(planMend(25, 20, 6).code === 'full', '血量脏值超上限 → 视为满血拒绝');
  ok(planMend(5, 20, 0).code === 'full', '治疗量为 0 → 拒绝（不白扣回响）');
  ok(planMend('x', 20, 6).code === 'unknown', '脏血量 → unknown');
  ok(planMend(1, 20, 999).health === 20, '治疗量再大也不越过生命上限');
  // 反复施放不会越过上限
  let hp = 4;
  for (let i = 0; i < 10; i++) { const r = planMend(hp, 20, 6); if (r.ok) hp = r.health; }
  ok(hp === 20, `连续十次回潮后血量恰好封顶（${hp}）`);
}

// ── ⑥ 折步落点 ──────────────────────────────────────────────────────────
{
  const free = () => ({ blocked: false, free: true, standable: true });
  ok(resolveBlinkTarget(8, free) === 8, '折步：一路有立足 → 走满 8 格');
  // 3 格处有墙 → 停在墙前（< 3）
  {
    const d = resolveBlinkTarget(8, (t) => ({ blocked: t >= 3, free: true, standable: true }));
    ok(d > 2.5 && d < 3, `折步：遇墙即停不穿墙（${d.toFixed(2)}）`);
  }
  // 障碍之后即使有可站立点也不能越过（与风步的差别）
  {
    const d = resolveBlinkTarget(8, (t) => (
      t >= 2 && t < 4 ? { blocked: true } : { blocked: false, free: true, standable: true }
    ));
    ok(d > 1.5 && d < 2, `折步：不越过障碍取后面的点（${d.toFixed(2)}）`);
  }
  // 只有悬空点 → 0（不折进半空）
  ok(resolveBlinkTarget(8, () => ({ blocked: false, free: true, standable: false })) === 0,
    '折步：没有立足点 → 不去（0）');
  // 最远可站立点：前段可站、后段悬空 → 取前段最远
  {
    const d = resolveBlinkTarget(8, (t) => ({ blocked: false, free: true, standable: t <= 4.5 }));
    ok(Math.abs(d - 4.5) < 1e-9, `折步：取最远可站立点（${d.toFixed(2)}）`);
  }
  // 未加载区块：调用方把它当 blocked 传进来 → 停在之前
  {
    const d = resolveBlinkTarget(8, (t) => (t >= 5 ? { blocked: true } : { blocked: false, free: true, standable: true }));
    ok(d > 4.5 && d < 5, `折步：不落未加载区块（${d.toFixed(2)}）`);
  }
  // free=false（实心格）同样立即停
  ok(resolveBlinkTarget(8, () => ({ blocked: false, free: false, standable: true })) === 0,
    '折步：实心格挡住整段');
  // 自定义步长
  ok(resolveBlinkTarget(2, () => ({ blocked: false, free: true, standable: true }), 0.5) === 2,
    '折步：步长可配（0.5）');
}

// ── ⑦ 形状校验（含落点透传）──────────────────────────────────────────────
{
  const base = { spell: 'void_step', x: 0, y: 70, z: 0, dx: 0, dy: 0, dz: 1, echo: 40 };
  const plain = sanitizeCast(base);
  ok(plain && plain.x2 === undefined, '折步：无落点时不带 x2（向后兼容）');
  const withTo = sanitizeCast({ ...base, x2: 0, y2: 70, z2: 7 });
  ok(withTo && withTo.x2 === 0 && withTo.z2 === 7, '折步：落点在范围内 → 透传');
  const farTo = sanitizeCast({ ...base, x2: 0, y2: 70, z2: 900 });
  ok(farTo && farTo.x2 === undefined, '折步：落点太远 → 丢弃该字段');
  const half = sanitizeCast({ ...base, x2: 1 });
  ok(half && half.x2 === undefined, '折步：落点字段不全 → 丢弃');
  const badY = sanitizeCast({ ...base, x2: 0, y2: -9999, z2: 3 });
  ok(badY && badY.x2 === undefined, '折步：落点高度越界 → 丢弃');
  // 四个法术都能过形状校验（服务器表是通用的）
  for (const id of SPELL_IDS) {
    ok(!!sanitizeCast({ ...base, spell: id }), `${id} 通过服务器形状校验`);
  }
  ok(sanitizeCast({ ...base, spell: 'tide_mend', echo: 101 }) === null, '回响越界仍被拒绝');
}

// ── ⑧ 源码绊线 ─────────────────────────────────────────────────────────
{
  const magic = src('../src/player/MagicSystem.js');
  const room = src('../server/room.js');
  const defs = src('../src/content/magic/defs.js');
  const magicCore = src('../src/core/Magic.js');

  // 失败路径：提示在前、扣回响在后（目标无效/满血不扣费用、不进冷却）
  const feedbackAt = magic.indexOf('this._feedback(res.code)');
  const spendAt = magic.indexOf('p.echo = clampEcho(p.echo - base.cost, p.echoMax)');
  ok(feedbackAt > 0 && spendAt > feedbackAt, '本体施法失败在扣回响之前就返回（失败不扣费用）');
  ok(/_castTideMend\(def\)/.test(magic) && /_castVoidStep\(def\)/.test(magic), '两个新法术各有施法入口');
  ok(/this\._lastCast\.set\(spellId, Date\.now\(\)\)/.test(magic) && spendAt < magic.indexOf('this._lastCast.set(spellId'),
    '只有成功施法才进冷却');
  // 折步安全：已加载区块 + AABB + 立足面
  ok(/getChunk\(Math\.floor\(x\) >> 4, Math\.floor\(z\) >> 4\)/.test(magic), '折步检查目标区块已加载');
  ok(/_hasFloor\(x, y, z, def\.standDepth\)/.test(magic), '折步要求落点有立足面');
  ok(/_aabbFree\(x, y, z, half, height\)/.test(magic), '折步要求落点 AABB 无碰撞');
  ok(/resolveBlinkTarget\(def\.distance, probe, def\.step\)/.test(magic), '折步走纯函数落点求解');
  // 回潮：治疗裁剪 + 既有状态效果；不生成水、不动方块
  ok(/planMend\(p\.health, p\.maxHealth, def\.heal\)/.test(magic), '回潮治疗量走 planMend 裁剪');
  ok(/p\.applyEffect\(def\.guardEffect, def\.guardLevel, def\.guardSeconds\)/.test(magic),
    '回潮防护复用 Player.effects');
  ok(!/setBlock\(/.test(magic) && !/world\.setBlock/.test(magic), '魔法域不写方块（不改地形）');
  ok(!/water/.test(magic), '魔法域不生成水');
  // 远端表现分流
  ok(/msg\.spell === 'tide_mend'/.test(magic) && /_mendFxAt\(msg\.x/.test(magic),
    '远端回潮只播水汽（不替他回血）');
  ok(/msg\.spell === 'void_step'/.test(magic) && /msg\.x2/.test(magic), '远端折步画起止两点');
  // B55 R2：广播改用 def.id（进阶长折复用同一施法函数，不能写死基础 ID）
  ok(/sendMagicCast\(def\.id, p\.echo, from, dir, to\)/.test(magic), '折步广播带落点（法术 ID 由数据表给）');
  // 服务器：落点只作表现
  ok(/fx\.x2 = cast\.x2/.test(room), '服务器透传落点表现');
  // 数据表：四系常量齐备（测试不依赖注释文案）
  ok(/RAIN_FOCUS_ITEM = 'rain_focus'/.test(defs) && /TIDELESS_FOCUS_ITEM = 'tideless_focus'/.test(defs),
    '焦点常量落地');
  ok(/export function resolveBlinkTarget/.test(magicCore) && /export function planMend/.test(magicCore),
    '纯函数导出（node 可测）');
}

finish('build54-four-tides');
