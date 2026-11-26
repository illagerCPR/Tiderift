// industry-unit.mjs -- Build 51 R3 潮工（工业）最小闭环回归（纯 node，不依赖服务器）
// 断言：
//   ① 内容归属：三个方块 ID 钉值（224/225/226）、名字表 11 语、创造分类、配方仅在启用工业的世界可见
//   ② 拓扑：六邻接连通分量、拆轴分网、超预算网络停摆
//   ③ 锅炉：燃料 + 桶装水 → 潮压（空桶回收）；断料/停机；燃烧结束自动续点
//   ④ 碎石机：满效率产出、供给不足全网降速、无供给停转、产物满阻塞、无料进度回退
//   ⑤ 槽位：投料（水桶/燃料/可加工料）、拒收、满了、取出
//   ⑥ 时间纪律：dt 钳到 ≤1s（不追赶离线生产）+ 同输入同输出（确定性）
//   ⑦ 状态清洗：坏档/脏包不崩、类型与范围钳制
//   ⑧ 存档 / 导入净化 / 摘要计数
//   ⑨ 源码绊线：联机不本地推进、服务器 sweep 与动作路由接上、关闭工业不 tick
import { readFileSync } from 'fs';
import {
  buildNetworks, tickIndustry, applyIndustryAction, spillStacks,
  emptyBoilerState, emptyCrusherState, sanitizeMachineState, machineSig,
} from '../src/core/Industry.js';
import {
  INDUSTRY_BLOCK_KIND, CRUSH_RECIPES, CRUSHER_BLOCK, BOILER_BLOCK, SHAFT_BLOCK,
  BOILER_SUPPLY, CRUSHER_DEMAND, CRUSH_TIME, INDUSTRY_TICK_MS,
} from '../src/content/industry/defs.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { getAllRecipes, matchRecipe, recipeEnabled } from '../src/core/Crafting.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { normalizeExtraContent } from '../src/content/ExtraContent.js';
import { normalizeSaveData } from '../src/core/SaveSystem.js';
import { sanitizeSaveData, summarize } from '../src/core/SaveTransfer.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const INDUSTRY = normalizeExtraContent({ schema: 1, industry: true });
const NONE = normalizeExtraContent(null);

// 便捷：造一个方块索引（key -> kind）
function idx(entries) {
  const m = new Map();
  for (const [key, kind] of entries) m.set(key, kind);
  return m;
}

// ── ① 内容归属 ──────────────────────────────────────────────────────────
{
  const boiler = BlockRegistry.getByName(BOILER_BLOCK);
  const shaft = BlockRegistry.getByName(SHAFT_BLOCK);
  const crusher = BlockRegistry.getByName(CRUSHER_BLOCK);
  ok(boiler && boiler.id === 224, `潮压锅炉 id 钉值 224（${boiler && boiler.id}）`);
  ok(shaft && shaft.id === 225, `传动轴 id 钉值 225（${shaft && shaft.id}）`);
  ok(crusher && crusher.id === 226, `碎石机 id 钉值 226（${crusher && crusher.id}）`);
  ok(boiler.industryKind === 'boiler' && shaft.industryKind === 'shaft' && crusher.industryKind === 'crusher',
    'industryKind 映射正确');
  ok(boiler.requiresExtras && boiler.requiresExtras.join() === 'industry', '三个方块都归属工业内容');
  ok(INDUSTRY_BLOCK_KIND[BOILER_BLOCK] === 'boiler' && INDUSTRY_BLOCK_KIND[CRUSHER_BLOCK] === 'crusher',
    'defs 的方块名→种类表与注册表一致');
  for (const name of [BOILER_BLOCK, SHAFT_BLOCK, CRUSHER_BLOCK]) {
    const row = NAME_I18N[name];
    ok(Array.isArray(row) && row.length === 11, `${name} 名字表 11 语`);
    ok(getItemCategory(name) === 'functional', `${name} 创造分类 = 功能方块`);
  }
  // 配方归属：关闭工业的世界既看不到也合不出
  const shaftRecipe = getAllRecipes().find((r) => r.output === SHAFT_BLOCK);
  ok(!!shaftRecipe && recipeEnabled(shaftRecipe, INDUSTRY) && !recipeEnabled(shaftRecipe, NONE),
    '传动轴配方只在启用工业的世界可用');
  ok(matchRecipe([['iron_ingot'], ['stone'], ['iron_ingot']], NONE) === null, '关闭工业：合不出传动轴');
  ok(matchRecipe([['iron_ingot'], ['stone'], ['iron_ingot']], INDUSTRY)?.name === SHAFT_BLOCK,
    '启用工业：可合出传动轴');
  ok(Object.keys(CRUSH_RECIPES).length >= 2, '碎石配方表非空（圆石/砾石）');
}

// ── ② 拓扑 ──────────────────────────────────────────────────────────────
{
  const blocks = idx([
    ['0,0,0', 'boiler'], ['1,0,0', 'shaft'], ['2,0,0', 'shaft'], ['3,0,0', 'crusher'],
    ['0,10,0', 'shaft'], // 孤立轴：独立分量、无供给
  ]);
  const nets = buildNetworks(blocks);
  ok(nets.comps.length === 2, `六邻接连通分量 = 2（${nets.comps.length}）`);
  const main = nets.comps.find((c) => c.boilers.length);
  ok(main && main.boilers.length === 1 && main.crushers.length === 1 && main.nodes.length === 4,
    '主网络包含 1 锅炉 1 碎石机 2 轴');
  ok(nets.compOf.get('0,10,0') !== nets.compOf.get('0,0,0'), '不邻接的轴自成网络');
  // 超预算：129 个节点
  const big = new Map();
  big.set('0,0,0', 'boiler');
  for (let i = 1; i <= 128; i++) big.set(`${i},0,0`, i === 128 ? 'crusher' : 'shaft');
  const bigNets = buildNetworks(big);
  ok(bigNets.comps.length === 1 && bigNets.comps[0].overLimit === true, '129 节点网络标记 overLimit');
  const smallNets = buildNetworks(idx([['0,0,0', 'boiler'], ['1,0,0', 'crusher']]));
  ok(smallNets.comps[0].overLimit === false, '小网络不触发超限');
}

// ── ③ 锅炉 ──────────────────────────────────────────────────────────────
{
  const blocks = idx([['0,0,0', 'boiler'], ['1,0,0', 'crusher']]);
  const states = new Map();
  const st = emptyBoilerState();
  st.fuel = { name: 'coal', count: 2, data: null };
  st.water = { name: 'water_bucket', count: 2, data: null };
  states.set('0,0,0', st);
  states.set('1,0,0', emptyCrusherState());
  states.get('1,0,0').input = { name: 'cobblestone', count: 8, data: null };

  // 一个 tick：点火 + 燃烧 + 产压
  tickIndustry(blocks, states, 0.2);
  ok(st.burnTime > 0 && st.burnMax === 80, `点火成功，燃烧计时 = 燃料秒数（${st.burnMax}）`);
  ok(st.fuel.count === 1, '点火消耗 1 个燃料');
  ok(st.water.count === 1, '点火消耗 1 桶水');
  ok(st.output && st.output.name === 'bucket' && st.output.count === 1, '空桶回收到 output 槽');
  ok(states.get('1,0,0').progress > 0, '同一 tick 碎石机开始推进（供给 4 ≥ 需求 2 → 满效率）');

  // 空桶满 → 不能点火（防丢桶）
  const st2 = emptyBoilerState();
  st2.fuel = { name: 'coal', count: 1, data: null };
  st2.water = { name: 'water_bucket', count: 1, data: null };
  st2.output = { name: 'bucket', count: 64, data: null };
  const states2 = new Map([['0,0,0', st2]]);
  tickIndustry(idx([['0,0,0', 'boiler']]), states2, 0.2);
  ok(st2.burnTime === 0 && st2.fuel.count === 1 && st2.water.count === 1, '空桶已满时不点火（不吞材料）');

  // 燃料耗尽 + 水耗尽 → 不再点火，供给为 0
  const st3 = emptyBoilerState();
  st3.fuel = { name: 'coal', count: 1, data: null };
  st3.water = { name: 'water_bucket', count: 1, data: null };
  const states3 = new Map([['0,0,0', st3], ['1,0,0', { kind: 'crusher', input: { name: 'cobblestone', count: 8, data: null }, output: null, progress: 1 }]]);
  const b3 = idx([['0,0,0', 'boiler'], ['1,0,0', 'crusher']]);
  const netz = tickIndustry(b3, states3, 0.2);
  ok(netz.networks.comps[0].supply === BOILER_SUPPLY, '在烧锅炉计入供给');
  // 继续烧到燃料 80 秒用尽（每步 1 秒，钳制上限）：只验证材料确实被消耗
  for (let i = 0; i < 3; i++) tickIndustry(b3, states3, 1);
  ok(st3.water === null && st3.fuel === null, '燃料与桶装水都被消耗（各扣 1 个）');
}

// ── ④ 碎石机与供需 ─────────────────────────────────────────────────────
{
  // 满效率：4 供给 / 2 需求 = 1 → 4 秒产出一个
  {
    const blocks = idx([['0,0,0', 'boiler'], ['1,0,0', 'shaft'], ['2,0,0', 'crusher']]);
    const states = new Map();
    const b = emptyBoilerState();
    b.fuel = { name: 'coal', count: 1, data: null };
    b.water = { name: 'water_bucket', count: 1, data: null };
    states.set('0,0,0', b);
    const c = emptyCrusherState();
    c.input = { name: 'cobblestone', count: 10, data: null };
    states.set('2,0,0', c);
    for (let i = 0; i < Math.ceil(CRUSH_TIME / 0.2) + 2; i++) tickIndustry(blocks, states, 0.2);
    ok(c.output && c.output.name === 'gravel' && c.output.count >= 1, '满效率下 4 秒内产出砾石');
    ok(c.input.count < 10, '原料被消耗');
  }
  // 供给不足：1 锅炉（4）供 3 台碎石机（6）→ 效率 2/3
  {
    const blocks = idx([
      ['0,0,0', 'boiler'], ['1,0,0', 'shaft'],
      ['2,0,0', 'crusher'], ['1,1,0', 'crusher'], ['1,-1,0', 'crusher'],
    ]);
    const states = new Map();
    const b = emptyBoilerState();
    b.fuel = { name: 'coal', count: 1, data: null };
    b.water = { name: 'water_bucket', count: 1, data: null };
    states.set('0,0,0', b);
    for (const k of ['2,0,0', '1,1,0', '1,-1,0']) {
      const c = emptyCrusherState();
      c.input = { name: 'cobblestone', count: 4, data: null };
      states.set(k, c);
    }
    const r = tickIndustry(blocks, states, 0.2);
    const comp = r.networks.comps[0];
    ok(comp.supply === 4 && comp.demand === 6, `供给 4 / 需求 6（${comp.supply}/${comp.demand}）`);
    ok(Math.abs(comp.efficiency - 4 / 6) < 1e-9, `效率 = 供给/需求 = 2/3（${comp.efficiency.toFixed(3)}）`);
    // 同一网络里三台机器效率一致（降速是全网口径）
    const p = [...states.values()].filter((s) => s.kind === 'crusher').map((s) => s.progress);
    ok(Math.abs(p[0] - p[1]) < 1e-9 && Math.abs(p[1] - p[2]) < 1e-9, '同一网络内各机器推进速度一致');
    ok(Math.abs(p[0] - 0.2 * (4 / 6)) < 1e-9, '推进量 = dt × 效率');
  }
  // 无供给：进度保温不推进
  {
    const blocks = idx([['0,0,0', 'shaft'], ['1,0,0', 'crusher']]);
    const states = new Map([['1,0,0', { kind: 'crusher', input: { name: 'cobblestone', count: 4, data: null }, output: null, progress: 1 }]]);
    tickIndustry(blocks, states, 0.5);
    ok(states.get('1,0,0').progress === 1, '无供给：进度保持不动（不推进也不回退）');
  }
  // 无料：进度缓慢回退
  {
    const blocks = idx([['0,0,0', 'boiler'], ['1,0,0', 'crusher']]);
    const states = new Map([
      ['0,0,0', { ...emptyBoilerState(), fuel: { name: 'coal', count: 1, data: null }, water: { name: 'water_bucket', count: 1, data: null } }],
      ['1,0,0', { kind: 'crusher', input: null, output: null, progress: 2 }],
    ]);
    tickIndustry(blocks, states, 0.5);
    ok(states.get('1,0,0').progress < 2, '无料时进度缓慢回退（不清零）');
  }
  // 产物满：阻塞保温
  {
    const blocks = idx([['0,0,0', 'boiler'], ['1,0,0', 'crusher']]);
    const states = new Map([
      ['0,0,0', { ...emptyBoilerState(), fuel: { name: 'coal', count: 1, data: null }, water: { name: 'water_bucket', count: 1, data: null } }],
      ['1,0,0', {
        kind: 'crusher', input: { name: 'cobblestone', count: 4, data: null },
        output: { name: 'gravel', count: 64, data: null }, progress: 1,
      }],
    ]);
    tickIndustry(blocks, states, 0.5);
    ok(states.get('1,0,0').progress === 1, '产物满：进度保温（不推进）');
    ok(states.get('1,0,0').input.count === 4, '产物满：不消耗原料');
  }
  // 超限网络整体停摆
  {
    const big = new Map([['0,0,0', 'boiler']]);
    for (let i = 1; i <= 127; i++) big.set(`${i},0,0`, 'shaft');
    big.set('128,0,0', 'crusher');
    const states = new Map([
      ['0,0,0', { ...emptyBoilerState(), fuel: { name: 'coal', count: 1, data: null }, water: { name: 'water_bucket', count: 1, data: null } }],
      ['128,0,0', { kind: 'crusher', input: { name: 'cobblestone', count: 4, data: null }, output: null, progress: 0 }],
    ]);
    tickIndustry(big, states, 0.5);
    ok(states.get('128,0,0').progress === 0, '超限网络不推进（整网停转）');
  }
}

// ── ⑤ 槽位动作 ──────────────────────────────────────────────────────────
{
  const boiler = emptyBoilerState();
  ok(applyIndustryAction('boiler', boiler, 'insert', 'water_bucket', 3).applied === 3, '投水桶 → 水槽');
  ok(applyIndustryAction('boiler', boiler, 'insert', 'coal', 5).applied === 5, '投燃料 → 燃料槽');
  ok(applyIndustryAction('boiler', boiler, 'insert', 'diamond', 1).code === 'invalid', '锅炉拒收非燃料');
  const crusher = emptyCrusherState();
  ok(applyIndustryAction('crusher', crusher, 'insert', 'cobblestone', 10).applied === 10, '碎石机投圆石');
  ok(applyIndustryAction('crusher', crusher, 'insert', 'gravel', 1).code === 'full', '异类进料视为满');
  ok(applyIndustryAction('crusher', crusher, 'insert', 'diamond', 1).code === 'invalid', '碎不了的东西拒收');
  // 取出
  boiler.output = { name: 'bucket', count: 3, data: null };
  const take = applyIndustryAction('boiler', boiler, 'extract', null, 2);
  ok(take.ok && take.applied === 2 && take.items[0].name === 'bucket', '取出空桶 ×2');
  ok(boiler.output.count === 1, '取出后槽位剩余 1');
  ok(applyIndustryAction('crusher', emptyCrusherState(), 'extract', null, 1).code === 'empty', '空产物槽取出返回 empty');
  // 破坏散落
  const spill = spillStacks(boiler);
  ok(spill.some((s) => s.name === 'water_bucket') && spill.some((s) => s.name === 'coal'), '破坏机器散落槽位内容');
  ok(spillStacks(null).length === 0, '空状态散落安全');
}

// ── ⑥ 时间纪律与确定性 ──────────────────────────────────────────────────
{
  const run = (dt) => {
    const blocks = idx([['0,0,0', 'boiler'], ['1,0,0', 'crusher']]);
    const states = new Map([
      ['0,0,0', { ...emptyBoilerState(), fuel: { name: 'coal', count: 1, data: null }, water: { name: 'water_bucket', count: 1, data: null } }],
      ['1,0,0', { kind: 'crusher', input: { name: 'cobblestone', count: 8, data: null }, output: null, progress: 0 }],
    ]);
    tickIndustry(blocks, states, dt);
    return { burn: states.get('0,0,0').burnTime, progress: states.get('1,0,0').progress };
  };
  const big = run(10);
  ok(Math.abs(big.progress - 1) < 1e-9, 'dt 钳到 1 秒（切后台/卡顿不追赶离线生产）');
  const a = run(0.2);
  const b = run(0.2);
  ok(a.progress === b.progress && a.burn === b.burn, '同输入同输出（确定性）');
  ok(INDUSTRY_TICK_MS === 200, '推进节拍 200ms');
}

// ── ⑦ 状态清洗 ──────────────────────────────────────────────────────────
{
  ok(sanitizeMachineState('boiler', null) === null, '空状态清洗为 null');
  ok(sanitizeMachineState('shaft', {}) === null, '轴没有状态');
  const dirty = sanitizeMachineState('boiler', {
    fuel: { name: 'coal', count: 999 }, water: 'bad', output: { name: '', count: 1 },
    burnTime: -5, burnMax: 'x',
  });
  ok(dirty.fuel.count === 64 && dirty.water === null && dirty.output === null, '槽位数量钳制、坏槽丢弃');
  ok(dirty.burnTime === 0 && dirty.burnMax === 0, '计时负数/脏值归零');
  const c = sanitizeMachineState('crusher', { input: { name: 'cobblestone', count: 3 }, progress: 1e9 });
  ok(c.progress <= CRUSH_TIME * 64, '进度有上限（不吃超大值）');
  const b = emptyBoilerState();
  b.fuel = { name: 'coal', count: 2, data: null };
  ok(typeof machineSig(b) === 'string' && machineSig(b).includes('coal'), '槽位签名可判定内容变化');
}

// ── ⑧ 存档 / 导入净化 / 摘要 ────────────────────────────────────────────
{
  const save = {
    version: 2, seed: 7, gamemode: 'creative', dimension: 'overworld',
    dimensionIndustry: { overworld: { '1,64,2': { kind: 'boiler', fuel: { name: 'coal', count: 3 }, water: null, output: null, burnTime: 0, burnMax: 0 } } },
  };
  const norm = normalizeSaveData(save);
  ok(norm && norm.dimensionIndustry.overworld['1,64,2'].kind === 'boiler', '存档保留工业状态');
  const { data } = sanitizeSaveData(save);
  ok(data.dimensionIndustry.overworld['1,64,2'].fuel.count === 3, '导入净化保留工业槽位');
  ok(summarize(data).industry === 1, '摘要统计工业机器台数');
  const { data: bad, dropped: droppedBad } = sanitizeSaveData({ version: 2, seed: 1, dimensionIndustry: { overworld: { 'x,y,z': { kind: 'boiler' }, '1,2,3': { kind: 'nope' } } } });
  ok(Object.keys(bad.dimensionIndustry.overworld).length === 0 && droppedBad.industry > 0, '非法坐标/未知种类被丢弃并计数');
}

// ── ⑨ 源码绊线 ─────────────────────────────────────────────────────────
{
  const sys = src('../src/player/IndustrySystem.js');
  const game = src('../src/player/Game.js');
  const room = src('../server/room.js');
  const indexSrc = src('../server/index.mjs');
  const ic = src('../src/player/InteractionController.js');
  ok(/if \(g\.networkMode\) return; \/\/ 联机：服务器权威推进/.test(sys), '联机客户端不本地推进');
  ok(/world\.extraContent\.industry !== true/.test(sys), '关闭工业的世界不 tick（模块机制不运行）');
  ok(/this\.industry\.update\(dt\)/.test(game), 'Game.update 接上工业域');
  ok(/updateFurnaces\(dt\);[\s\S]{0,400}this\.industry\.update\(dt\)/.test(game), '工业推进在既有机器节拍附近');
  ok(/r\.tickIndustrySweep\(now\)/.test(indexSrc), '服务器 sweep 每秒推进工业');
  ok(/case MSG\.INDUSTRY_ACTION: this\.onIndustryAction/.test(room), '服务器路由工业动作');
  // B56 R1：归属需求改由 industryAllowedIn 按 id 查表（普通潮工 = industry，联动 = industry+magic）
  ok(/isIndustryId\(id\) && !industryAllowedIn\(id, this\.extraContent\)/.test(room),
    '未启用工业的世界拒绝工业方块写入');
  ok(/industryAllowedIn,[\s\S]{0,80}\} from '\.\/industry\.js'/.test(room),
    '归属判定从 server/industry.js 取（服务器不另抄一份字符串）');
  ok(/g\.industry\?\.onBreak\(hit\.block\)/.test(ic), '拆机器 → 清账本 + 内容散落');
  ok(/g\.industry\.interact\(furnaceHit\.block\)/.test(ic), '右键机器 → 投料/取产物');
}

finish('industry-unit');
