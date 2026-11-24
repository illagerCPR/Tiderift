// build52-industry-unit.mjs -- Build 52 R1 潮工生产网络（切割机 / 离合闸 / 副产物 / 机器状态）
// 纯 node，不依赖服务器。断言：
//   ① 内容注册：两件新方块 ID 钉值（228/229）、十一语名字、功能分类、归属与配方闸口
//   ② 配方类型：切割表与碎石表互不回退；原木出板率高于手工；配方表对 UI 同源
//   ③ 网络闸门：离合闸接通导流、断开锯断子网、缺状态不静默断网、环路只计一次、跨维互不串
//   ④ 切割机：供需效率按种类表（cutter 需求 3）、切割时间、断料/满槽/无压语义
//   ⑤ 有限副产物：确定性计数、副产槽独立、满槽丢这一次（不欠账、不吞主产物）
//   ⑥ 槽位：指定槽位投/取、输出与副产槽只出不进、非法槽拒绝、破坏散落含副产
//   ⑦ 离合闸动作：手动拨杆、红石信号优先、导流状态变化的返回值
//   ⑧ 机器状态派生：running/ready/no-input/no-recipe/output-full/no-fuel/no-water/no-power/over-limit
//   ⑨ 清洗与存档：clutch/cutter 状态净化、存档迁移与摘要计数
//   ⑩ 源码绊线：服务器 id 表、单机/服务器共用同一张数值表
import { readFileSync } from 'fs';
import {
  buildNetworks, tickIndustry, applyIndustryAction, spillStacks,
  emptyBoilerState, emptyCrusherState, emptyCutterState, emptyClutchState,
  sanitizeMachineState, machineSig, machineStatus, netInfoFor,
  clutchEngaged, toggleClutch, setClutchPowered, isMachineSlot, slotInsertable,
} from '../src/core/Industry.js';
import {
  INDUSTRY_BLOCK_KIND, CUT_RECIPES, CRUSH_RECIPES, CRUSH_BYPRODUCTS,
  CUTTER_BLOCK, CLUTCH_BLOCK, CRUSHER_BLOCK, BOILER_BLOCK, SHAFT_BLOCK,
  BOILER_SUPPLY, CRUSHER_DEMAND, CUTTER_DEMAND, CRUSH_TIME, CUT_TIME,
  MACHINE_DEMAND, MACHINE_SLOTS, CUT_RECIPES as CUT_TABLE,
  recipesFor, processorRecipeFor, processorTime,
} from '../src/content/industry/defs.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { getAllRecipes, matchRecipe, recipeEnabled } from '../src/core/Crafting.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { normalizeExtraContent } from '../src/content/ExtraContent.js';
import { normalizeSaveData } from '../src/core/SaveSystem.js';
import { sanitizeSaveData, summarize } from '../src/core/SaveTransfer.js';
import { INDUSTRY_ID_INFO } from '../server/industry.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const INDUSTRY = normalizeExtraContent({ schema: 1, industry: true });
const NONE = normalizeExtraContent(null);

function idx(entries) {
  const m = new Map();
  for (const [key, kind] of entries) m.set(key, kind);
  return m;
}

// ── ① 内容注册与归属 ────────────────────────────────────────────────────
{
  const cutter = BlockRegistry.getByName(CUTTER_BLOCK);
  const clutch = BlockRegistry.getByName(CLUTCH_BLOCK);
  ok(cutter && cutter.id === 228, `切割机 id 钉值 228（${cutter && cutter.id}）`);
  ok(clutch && clutch.id === 229, `离合闸 id 钉值 229（${clutch && clutch.id}）`);
  ok(cutter.industryKind === 'cutter' && clutch.industryKind === 'clutch', 'industryKind 映射正确');
  ok(cutter.requiresExtras.join() === 'industry' && clutch.requiresExtras.join() === 'industry',
    '两件新方块都归属工业内容');
  ok(INDUSTRY_BLOCK_KIND[CUTTER_BLOCK] === 'cutter' && INDUSTRY_BLOCK_KIND[CLUTCH_BLOCK] === 'clutch',
    'defs 的方块名→种类表与注册表一致');
  ok(INDUSTRY_ID_INFO.get(228) === 'cutter' && INDUSTRY_ID_INFO.get(229) === 'clutch',
    '服务器 id 表覆盖两件新方块');
  ok(!INDUSTRY_ID_INFO.has(227), '回响仪台（227）不属工业家族');
  for (const name of [CUTTER_BLOCK, CLUTCH_BLOCK]) {
    const row = NAME_I18N[name];
    ok(Array.isArray(row) && row.length === 11, `${name} 名字表 11 语`);
    ok(getItemCategory(name) === 'functional', `${name} 创造分类 = 功能方块`);
  }
  // 纹理键必须全部落在 SVG 表里（缺键会 fallback 到整张图集，B28 老坑）
  for (const def of [cutter, clutch]) {
    const keys = new Set([def.top, def.side, def.bottom, def.front, def.icon].filter(Boolean));
    for (const key of keys) ok(!!BlockSVGDefinitions[key], `${def.name} 纹理 ${key} 已在 SVG 表`);
    ok(!def.front || !!def.faceTex, `${def.name} 定向面已派生 faceTex`);
    if (def.front) ok(def.icon === def.front, `${def.name} 图标取定向面（看得出正面）`);
  }
  // 配方归属：关闭工业的世界既看不到也合不出
  for (const out of [CUTTER_BLOCK, CLUTCH_BLOCK]) {
    const r = getAllRecipes().find((x) => x.output === out);
    ok(!!r && recipeEnabled(r, INDUSTRY) && !recipeEnabled(r, NONE), `${out} 配方只在启用工业的世界可用`);
  }
  const cutterGrid = [
    ['iron_ingot', 'iron_ingot', 'iron_ingot'],
    ['stone', 'drive_shaft', 'stone'],
    ['iron_ingot', 'iron_ingot', 'iron_ingot'],
  ];
  ok(matchRecipe(cutterGrid, INDUSTRY)?.name === CUTTER_BLOCK, '启用工业：可合出切割机');
  ok(matchRecipe(cutterGrid, NONE) === null, '关闭工业：合不出切割机');
}

// ── ② 配方类型与数值表 ──────────────────────────────────────────────────
{
  ok(Object.keys(CUT_RECIPES).length >= 7, `切割配方表覆盖原木/石料/骨材（${Object.keys(CUT_RECIPES).length}）`);
  ok(CUT_RECIPES.oak_log.output === 'oak_planks' && CUT_RECIPES.oak_log.count === 6,
    '原木 → 6 木板（手工只有 4，切割机值得建）');
  ok(CUT_RECIPES.bone.output === 'bone_meal' && CUT_RECIPES.bone.count === 3, '骨 → 3 骨粉');
  ok(CUT_RECIPES.stone.output === 'stone_bricks', '石头 → 石砖（整形）');
  ok(processorRecipeFor('cutter', 'oak_log') && !processorRecipeFor('crusher', 'oak_log'),
    '切割表与碎石表互不回退（碎石机不认原木）');
  ok(processorRecipeFor('crusher', 'cobblestone') && !processorRecipeFor('cutter', 'cobblestone'),
    '碎石表与切割表互不回退（切割机不认圆石）');
  ok(processorTime('cutter') === CUT_TIME && processorTime('crusher') === CRUSH_TIME, '加工时间按种类取表');
  ok(MACHINE_DEMAND.cutter === CUTTER_DEMAND && MACHINE_DEMAND.crusher === CRUSHER_DEMAND,
    '需求表是单一来源（cutter 3 / crusher 2）');
  ok(MACHINE_DEMAND.boiler === 0 && MACHINE_DEMAND.clutch === 0 && MACHINE_DEMAND.shaft === 0,
    '发电机/闸门/轴不消耗潮压');
  ok(CUT_TABLE === CUT_RECIPES, '配方表导出稳定（UI 与算法读同一份）');
  const rows = recipesFor('cutter');
  ok(rows.length === Object.keys(CUT_RECIPES).length, 'recipesFor 覆盖整张切割表');
  ok(rows.every((r) => r.time === CUT_TIME && r.input && r.output), '配方行带输入/输出/时间');
  const crushRows = recipesFor('crusher');
  ok(crushRows.some((r) => r.byproduct && r.byproduct.name === 'flint'), '碎石配方行带副产物说明');
  ok(CRUSH_BYPRODUCTS.cobblestone.name === 'flint' && CRUSH_BYPRODUCTS.cobblestone.every === 8,
    '圆石副产：每 8 个一块燧石');
  ok(MACHINE_SLOTS.boiler.join() === 'fuel,water,output' && MACHINE_SLOTS.cutter.join() === 'input,output,bonus',
    '槽位布局表（UI/服务器校验同源）');
  ok(recipesFor('boiler').length === 0, '锅炉没有配方表（燃料另有语义）');
}

// ── ③ 网络闸门 ──────────────────────────────────────────────────────────
{
  // 缺状态：按接通（不静默断网）
  const chain = idx([['0,0,0', 'boiler'], ['1,0,0', 'shaft'], ['2,0,0', 'clutch'], ['3,0,0', 'crusher']]);
  ok(buildNetworks(chain).comps.length === 1, '离合闸缺状态时按接通处理（整条网络仍连通）');

  const engaged = new Map([['2,0,0', { kind: 'clutch', manual: true, powered: false }]]);
  ok(buildNetworks(chain, engaged).comps.length === 1, '手动接通：网络连通');

  const manualOff = new Map([['2,0,0', { kind: 'clutch', manual: false, powered: false }]]);
  const split = buildNetworks(chain, manualOff);
  ok(split.comps.length === 2, `手动断开：网络被锯成两段（${split.comps.length}）`);
  ok(netInfoFor(split, '3,0,0').supply === 0, '断开后下游侧没有供给');
  ok(netInfoFor(split, '0,0,0').nodes >= 2, '断开后上游侧仍含锅炉与轴');

  const powered = new Map([['2,0,0', { kind: 'clutch', manual: true, powered: true }]]);
  ok(buildNetworks(chain, powered).comps.length === 2, '红石信号优先：手动接通也会被切断');
  const poweredManualOff = new Map([['2,0,0', { kind: 'clutch', manual: false, powered: true }]]);
  ok(buildNetworks(chain, poweredManualOff).comps.length === 2, '红石 + 手动双断仍为两段');

  // 环路：2×2 轴环 + 外部机器，节点只计一次
  const loop = idx([
    ['0,0,0', 'boiler'], ['1,0,0', 'shaft'],
    ['1,0,1', 'shaft'], ['0,0,1', 'shaft'], ['0,0,0', 'boiler'],
    ['2,0,0', 'crusher'],
  ]);
  const loopNets = buildNetworks(loop);
  ok(loopNets.comps.length === 1, '环路仍是一个连通分量');
  ok(loopNets.comps[0].nodes.length === loop.size, `环路节点去重（${loopNets.comps[0].nodes.length}/${loop.size}）`);

  // 跨维隔离：两维各自建网，互不串
  const overworld = idx([['0,0,0', 'boiler'], ['1,0,0', 'shaft'], ['2,0,0', 'crusher']]);
  const nether = idx([['0,0,0', 'boiler'], ['1,0,0', 'clutch']]);
  const a = buildNetworks(overworld);
  const b = buildNetworks(nether);
  ok(a.comps.length === 1 && b.comps.length === 1, '两维各自一张图');
  ok(a.comps[0].nodes.length === 3 && b.comps[0].nodes.length === 2, '跨维节点不会并进同一张图');

  // 断开的离合闸自身仍算网内节点（不凭空消失），但不导流
  const onlyClutch = buildNetworks(idx([['0,0,0', 'clutch'], ['1,0,0', 'boiler']]),
    new Map([['0,0,0', { kind: 'clutch', manual: false, powered: false }]]));
  ok(onlyClutch.comps.length === 2, '断开的闸与其邻居分属两段');
}

// ── ④ 切割机推进与供需 ──────────────────────────────────────────────────
{
  // 满效率：1 锅炉（4）供 1 切割机（3）→ 效率 1；3 秒一个
  const blocks = idx([['0,0,0', 'boiler'], ['1,0,0', 'shaft'], ['2,0,0', 'cutter']]);
  const states = new Map();
  const boiler = emptyBoilerState();
  boiler.fuel = { name: 'coal', count: 1, data: null };
  boiler.water = { name: 'water_bucket', count: 1, data: null };
  states.set('0,0,0', boiler);
  const cutter = emptyCutterState();
  cutter.input = { name: 'oak_log', count: 4, data: null };
  states.set('2,0,0', cutter);
  const r = tickIndustry(blocks, states, 0.2);
  ok(r.networks.comps[0].demand === CUTTER_DEMAND, `切割机计需求 ${CUTTER_DEMAND}`);
  ok(r.networks.comps[0].efficiency === 1, '供给 4 ≥ 需求 3 → 满效率');
  ok(Math.abs(cutter.progress - 0.2) < 1e-9, '推进量 = dt × 效率');
  for (let i = 0; i < Math.ceil(CUT_TIME / 0.2) + 3; i++) tickIndustry(blocks, states, 0.2);
  ok(cutter.output && cutter.output.name === 'oak_planks' && cutter.output.count >= 1,
    '切割机产出木板');
  ok(cutter.output.count <= 6 * 2, '原木 → 6 板/个（产量高于手工）');

  // 切割机与碎石机并行：1 锅炉 4 压供 1 切割 3 + 1 碎石 2 → 需求 5，效率 4/5
  {
    const b2 = idx([
      ['0,0,0', 'boiler'], ['1,0,0', 'shaft'],
      ['2,0,0', 'cutter'], ['1,1,0', 'crusher'],
    ]);
    const st2 = new Map();
    const bo = emptyBoilerState();
    bo.fuel = { name: 'coal', count: 1, data: null };
    bo.water = { name: 'water_bucket', count: 1, data: null };
    st2.set('0,0,0', bo);
    const cu = emptyCutterState();
    cu.input = { name: 'oak_log', count: 4, data: null };
    st2.set('2,0,0', cu);
    const cr = emptyCrusherState();
    cr.input = { name: 'cobblestone', count: 4, data: null };
    st2.set('1,1,0', cr);
    const rr = tickIndustry(b2, st2, 0.2);
    const comp = rr.networks.comps[0];
    ok(comp.demand === CUTTER_DEMAND + CRUSHER_DEMAND, `两条生产线并行需求 ${comp.demand}`);
    ok(Math.abs(comp.efficiency - BOILER_SUPPLY / comp.demand) < 1e-9, '供给不足按比例降速（全网口径）');
    ok(Math.abs(cu.progress - 0.2 * comp.efficiency) < 1e-9 && Math.abs(cr.progress - 0.2 * comp.efficiency) < 1e-9,
      '两台机器共享同一效率：每秒推进的秒数相同');
    ok(Math.abs(cu.progress / CUT_TIME - cr.progress / CRUSH_TIME) > 1e-6,
      '加工时长不同 → 进度条占比不同（UI 按各自 time 归一）');
  }

  // 切割机拿到碎石料：不认（进度回退，不产出）
  {
    const b3 = idx([['0,0,0', 'boiler'], ['1,0,0', 'cutter']]);
    const st3 = new Map([
      ['0,0,0', { ...emptyBoilerState(), fuel: { name: 'coal', count: 1, data: null }, water: { name: 'water_bucket', count: 1, data: null } }],
      ['1,0,0', { ...emptyCutterState(), input: { name: 'cobblestone', count: 4, data: null }, progress: 2 }],
    ]);
    tickIndustry(b3, st3, 0.5);
    const c = st3.get('1,0,0');
    ok(c.progress < 2 && c.output === null, '切割机不认圆石：进度回退、不产出');
  }
}

// ── ⑤ 有限副产物 ────────────────────────────────────────────────────────
{
  const blocks = idx([['0,0,0', 'boiler'], ['1,0,0', 'crusher']]);
  const states = new Map([
    ['0,0,0', { ...emptyBoilerState(), fuel: { name: 'coal', count: 1, data: null }, water: { name: 'water_bucket', count: 1, data: null } }],
    ['1,0,0', { ...emptyCrusherState(), input: { name: 'cobblestone', count: 40, data: null } }],
  ]);
  const st = states.get('1,0,0');
  // 跑够 8 个周期（8 × 4 秒）；每步 1 秒
  for (let i = 0; i < CRUSH_TIME * 8 + 2; i++) tickIndustry(blocks, states, 1);
  ok(st.cycles === 8, `完成 8 个周期（cycles=${st.cycles}）`);
  ok(st.output && st.output.name === 'gravel' && st.output.count === 8, '主产物 8 个沙砾');
  ok(st.bonus && st.bonus.name === 'flint' && st.bonus.count === 1, '第 8 个副产 1 块燧石');
  ok(st.input.count === 40 - 8, '原料按成品数消耗');

  // 副产槽满：丢掉这一次，不吞主产物、不欠账
  const full = { ...emptyCrusherState(), input: { name: 'cobblestone', count: 8, data: null }, cycles: 7, bonus: { name: 'flint', count: 64, data: null } };
  const st2 = new Map([
    ['0,0,0', { ...emptyBoilerState(), fuel: { name: 'coal', count: 1, data: null }, water: { name: 'water_bucket', count: 1, data: null } }],
    ['1,0,0', full],
  ]);
  for (let i = 0; i < CRUSH_TIME + 2; i++) tickIndustry(blocks, st2, 1);
  ok(full.output && full.output.name === 'gravel', '副产槽满：主产物照常产出');
  ok(full.bonus.count === 64, '副产槽满：不溢出（丢掉这一次）');
  ok(full.cycles === 8, '副产计数照常推进（确定性、无随机）');

  // 切割机没有副产（副产表只挂在碎石料上）
  const cut = { ...emptyCutterState(), input: { name: 'oak_log', count: 3, data: null }, cycles: 7 };
  const st3 = new Map([
    ['0,0,0', { ...emptyBoilerState(), fuel: { name: 'coal', count: 1, data: null }, water: { name: 'water_bucket', count: 1, data: null } }],
    ['1,0,0', cut],
  ]);
  const b3 = idx([['0,0,0', 'boiler'], ['1,0,0', 'cutter']]);
  for (let i = 0; i < CUT_TIME + 2; i++) tickIndustry(b3, st3, 1);
  ok(cut.output && cut.output.name === 'oak_planks' && cut.bonus === null, '切割机不产副产物');
}

// ── ⑥ 槽位动作（指定槽位）───────────────────────────────────────────────
{
  const boiler = emptyBoilerState();
  ok(applyIndustryAction('boiler', boiler, 'insert', 'coal', 3, 'fuel').ok, '指定燃料槽投料');
  ok(boiler.fuel.count === 3 && boiler.water === null, '只进指定槽');
  ok(applyIndustryAction('boiler', boiler, 'insert', 'coal', 1, 'water').code === 'invalid', '燃料不能投进水槽');
  ok(applyIndustryAction('boiler', boiler, 'insert', 'bucket', 1, 'output').code === 'invalid', '产物槽只出不进');

  const cutter = emptyCutterState();
  ok(applyIndustryAction('cutter', cutter, 'insert', 'oak_log', 5, 'input').applied === 5, '指定输入槽投原木');
  ok(applyIndustryAction('cutter', cutter, 'insert', 'oak_log', 1, 'bonus').code === 'invalid', '副产槽只出不进');
  cutter.output = { name: 'oak_planks', count: 6, data: null };
  cutter.bonus = { name: 'flint', count: 2, data: null };
  const takeBonus = applyIndustryAction('cutter', cutter, 'extract', null, 64, 'bonus');
  ok(takeBonus.ok && takeBonus.applied === 2 && takeBonus.items[0].name === 'flint', '按槽位取出副产物');
  ok(cutter.bonus === null && cutter.output.count === 6, '取副产不动主产物');
  const takeOut = applyIndustryAction('cutter', cutter, 'extract', null, 6, 'output');
  ok(takeOut.ok && takeOut.items[0].name === 'oak_planks', '按槽位取出主产物');
  ok(applyIndustryAction('cutter', cutter, 'extract', null, 1, 'water').code === 'invalid', '非法槽位拒绝');
  ok(isMachineSlot('cutter', 'bonus') && !isMachineSlot('boiler', 'bonus'), '槽位归属按机器种类判定');
  ok(slotInsertable('crusher', 'input', 'cobblestone') && !slotInsertable('crusher', 'input', 'oak_log'),
    '槽位收料判定走配方表');

  // 破坏散落包含副产物
  const spill = spillStacks({ ...emptyCrusherState(), input: { name: 'cobblestone', count: 2, data: null }, output: { name: 'gravel', count: 3, data: null }, bonus: { name: 'flint', count: 1, data: null } });
  ok(spill.some((s) => s.name === 'cobblestone') && spill.some((s) => s.name === 'flint'),
    '拆机器散落原料与副产物');
}

// ── ⑦ 离合闸动作 ────────────────────────────────────────────────────────
{
  const st = emptyClutchState();
  ok(clutchEngaged(st) === true, '默认接通');
  const t1 = toggleClutch(st);
  ok(t1.ok && st.manual === false && t1.engaged === false, '手动拨到断开');
  const t2 = toggleClutch(st);
  ok(st.manual === true && t2.engaged === true, '再拨回接通');
  ok(setClutchPowered(st, true) === true && clutchEngaged(st) === false, '红石通电 → 导流状态改变（断开）');
  ok(setClutchPowered(st, true) === false, '重复写同一信号不重复触发重建');
  ok(setClutchPowered(st, false) === true && clutchEngaged(st) === true, '红石断电 → 恢复手动状态');
  st.manual = false;
  setClutchPowered(st, true);
  ok(clutchEngaged(st) === false, '手动断开 + 通电仍为断开');
  st.manual = true;
  setClutchPowered(st, true);
  ok(clutchEngaged(st) === false, '信号优先：手动接通拗不过通电');
  ok(toggleClutch({ kind: 'shaft' }).ok === false, '非离合闸状态拒绝切换');
  ok(setClutchPowered(null, true) === false, '空状态安全');
  ok(clutchEngaged(null) === true, '缺状态按接通（不静默断网）');
}

// ── ⑧ 机器状态派生（界面文案的数据源）──────────────────────────────────
{
  const netOk = { supply: 4, demand: 2, efficiency: 1, nodes: 3, overLimit: false };
  const netNone = { supply: 0, demand: 2, efficiency: 0, nodes: 3, overLimit: false };
  const netOver = { supply: 4, demand: 2, efficiency: 0, nodes: 200, overLimit: true };

  const boiler = emptyBoilerState();
  ok(machineStatus('boiler', boiler, netOk).reason === 'no-fuel', '锅炉无燃料 → no-fuel');
  boiler.fuel = { name: 'coal', count: 1, data: null };
  ok(machineStatus('boiler', boiler, netOk).reason === 'no-water', '有燃料无桶装水 → no-water');
  boiler.water = { name: 'water_bucket', count: 1, data: null };
  ok(machineStatus('boiler', boiler, netOk).reason === 'ready', '料齐未点火 → ready');
  boiler.burnTime = 40; boiler.burnMax = 80;
  const burning = machineStatus('boiler', boiler, netOk);
  ok(burning.reason === 'running' && Math.abs(burning.progressFrac - 0.5) < 1e-9, '在烧 → running + 进度 50%');
  boiler.burnTime = 0;
  boiler.output = { name: 'bucket', count: 64, data: null };
  ok(machineStatus('boiler', boiler, netOk).reason === 'output-full', '空桶满 → output-full');

  const crusher = emptyCrusherState();
  ok(machineStatus('crusher', crusher, netOk).reason === 'no-input', '空机器 → no-input');
  crusher.input = { name: 'diamond', count: 1, data: null };
  ok(machineStatus('crusher', crusher, netOk).reason === 'no-recipe', '不认的料 → no-recipe');
  crusher.input = { name: 'cobblestone', count: 4, data: null };
  ok(machineStatus('crusher', crusher, netNone).reason === 'no-power', '无潮压 → no-power');
  ok(machineStatus('crusher', crusher, netOver).reason === 'over-limit', '超预算网络 → over-limit');
  const ready = machineStatus('crusher', crusher, netOk);
  ok(ready.reason === 'ready' && ready.recipe && ready.recipe.output === 'gravel', '有料待转 → ready + 配方');
  crusher.progress = 2;
  const running = machineStatus('crusher', crusher, netOk);
  ok(running.reason === 'running' && Math.abs(running.progressFrac - 0.5) < 1e-9, '推进中 → running + 50%');
  crusher.output = { name: 'gravel', count: 64, data: null };
  ok(machineStatus('crusher', crusher, netOk).reason === 'output-full', '产物满 → output-full');

  const cutter = { ...emptyCutterState(), input: { name: 'oak_log', count: 1, data: null } };
  const cs = machineStatus('cutter', cutter, { supply: 4, demand: 3, efficiency: 1 });
  ok(cs.recipe.output === 'oak_planks' && cs.time === CUT_TIME, '切割机状态带正确配方与时长');
  ok(machineStatus('clutch', { kind: 'clutch', manual: false, powered: false }, null).reason === 'disengaged',
    '断开的离合闸 → disengaged');
  ok(machineStatus('boiler', null, null).reason === 'idle', '缺状态安全（idle）');
}

// ── ⑨ 清洗与存档 ────────────────────────────────────────────────────────
{
  ok(sanitizeMachineState('cutter', null) === null, '空切割机状态清洗为 null');
  const dirty = sanitizeMachineState('cutter', {
    input: { name: 'oak_log', count: 999 }, output: 'bad', bonus: { name: 'flint', count: 2 },
    progress: -1, cycles: 1e12,
  });
  ok(dirty.input.count === 64 && dirty.output === null && dirty.bonus.count === 2, '切割机槽位清洗');
  ok(dirty.progress === 0 && dirty.cycles <= 1e9, '进度/副产计数钳制');
  const clutch = sanitizeMachineState('clutch', { manual: 0, powered: 1 });
  ok(clutch.manual === false && clutch.powered === true, '离合闸状态清洗（0/1 归一为布尔）');
  ok(sanitizeMachineState('clutch', { manual: false, powered: 'x' }).powered === false, '红石字段只认 true/1');
  ok(sanitizeMachineState('clutch', {}).manual === true, '缺字段时手动默认接通');
  ok(machineSig({ kind: 'clutch', manual: true, powered: true }).includes('p1'), '离合闸签名带信号位');
  ok(machineSig({ kind: 'cutter', input: null, output: null, bonus: { name: 'flint', count: 1 } }).includes('flint'),
    '加工机签名带副产槽');

  const save = {
    version: 2, seed: 11, gamemode: 'survival', dimension: 'overworld',
    dimensionIndustry: {
      overworld: {
        '1,64,2': { kind: 'cutter', input: { name: 'oak_log', count: 3 }, output: null, bonus: { name: 'flint', count: 1 }, progress: 1, cycles: 5 },
        '2,64,2': { kind: 'clutch', manual: false, powered: true },
      },
    },
  };
  const norm = normalizeSaveData(save);
  ok(norm && norm.dimensionIndustry.overworld['1,64,2'].kind === 'cutter', '存档保留切割机状态');
  ok(norm.dimensionIndustry.overworld['2,64,2'].kind === 'clutch', '存档保留离合闸状态');
  const { data } = sanitizeSaveData(save);
  ok(data.dimensionIndustry.overworld['1,64,2'].bonus.name === 'flint', '导入净化保留副产槽');
  ok(data.dimensionIndustry.overworld['2,64,2'].manual === false, '导入净化保留手动状态');
  ok(summarize(data).industry === 2, '摘要按状态条数统计（含离合闸）');
  const { data: bad } = sanitizeSaveData({ version: 2, seed: 1, dimensionIndustry: { overworld: { '1,2,3': { kind: 'cutter' } } } });
  ok(bad.dimensionIndustry.overworld['1,2,3'].kind === 'cutter', '缺槽位的切割机条目补空槽（不丢弃）');
}

// ── ⑩ 源码绊线 ─────────────────────────────────────────────────────────
{
  const ind = src('../src/core/Industry.js');
  const defs = src('../src/content/industry/defs.js');
  const serverInd = src('../server/industry.js');
  const craft = src('../src/core/Crafting.js');
  const blocks = src('../src/blocks/BlockDefs.js');
  ok(/MACHINE_DEMAND/.test(ind) && /MACHINE_DEMAND/.test(defs), '单机/服务器共用同一张需求表');
  ok(!/CRUSHER_DEMAND\s*=\s*2/.test(ind), '算法里不再出现第二份硬编码需求');
  ok(/export function recipesFor/.test(defs), '配方表对 UI 同源导出');
  ok(/228, 'cutter'/.test(serverInd) && /229, 'clutch'/.test(serverInd), '服务器 id 表登记两件新方块');
  ok(/addShaped\('tide_cutter'[\s\S]{0,300}\['industry'\]/.test(craft), '切割机配方带内容归属');
  ok(/addShaped\('drive_clutch'[\s\S]{0,300}\['industry'\]/.test(craft), '离合闸配方带内容归属');
  ok(/reg\('tide_cutter'[\s\S]{0,200}requiresExtras: \['industry'\], industryKind: 'cutter'/.test(blocks),
    '切割机注册带归属与种类');
  ok(/reg\('drive_clutch'[\s\S]{0,200}requiresExtras: \['industry'\], industryKind: 'clutch'/.test(blocks),
    '离合闸注册带归属与种类');
  // 追加纪律：新方块注册必须在回响仪台之后（ID 只增不改）
  ok(blocks.indexOf("reg('tide_cutter'") > blocks.indexOf("reg('resonance_table'"),
    '新方块追加在文件末尾（不插队、ID 零漂移）');
}

finish('build52-industry-unit');
