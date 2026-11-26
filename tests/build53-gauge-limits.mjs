// build53-gauge-limits.mjs -- Build 53 R3 潮压表 / 联合故障提示 / 两道上限
// 纯 node，不依赖服务器。断言：
//   ① 注册：方块 ID 钉值 238、industryKind 'gauge'、纹理、十一语名字、分类、配方闸口、lore
//   ② 读数：netInfoFor 提供 在烧锅炉数 / 在跑机器数 / 断路位置；断开闸进 cuts 且不导流
//   ③ 表状态：gauge 的五种停转原因（over-limit / cut / no-power / stalled / running）与只读语义
//   ④ 并网规模：projectedNetworkSize 单块=1、接一节=+1、并两网=和+1、断闸不并、满 128 恰好允许
//   ⑤ 上限常量：512 方块 / 128 节点，且 gauge 不占潮压需求
//   ⑥ 文案：gaugeText 覆盖 gauge 可能产生的全部 reason；MACHINE_REASONS 含 cut
//   ⑦ 源码绊线：客户端预检 + 服务器权威回滚（两处）+ 界面只读布局 + id 表
import { readFileSync } from 'fs';
import {
  buildNetworks, machineStatus, netInfoFor, projectedNetworkSize, emptyStateFor,
  MACHINE_REASONS,
} from '../src/core/Industry.js';
import {
  GAUGE_BLOCK, INDUSTRY_BLOCK_KIND, MACHINE_DEMAND, MACHINE_SLOTS,
  INDUSTRY_BLOCK_LIMIT, NETWORK_MAX_NODES, BOILER_SUPPLY,
} from '../src/content/industry/defs.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { getAllRecipes, recipeEnabled } from '../src/core/Crafting.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { normalizeExtraContent } from '../src/content/ExtraContent.js';
import { INDUSTRY_ID_INFO } from '../server/industry.js';
import { en } from '../src/i18n/locales/en.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const INDUSTRY = normalizeExtraContent({ schema: 1, industry: true });
const NONE = normalizeExtraContent(null);
const key = (x, y, z) => `${x},${y},${z}`;
const mapOf = (entries) => new Map(entries);

// ── ① 注册 ────────────────────────────────────────────────────────────
{
  const def = BlockRegistry.getByName(GAUGE_BLOCK);
  ok(GAUGE_BLOCK === 'pressure_gauge', '方块名 pressure_gauge');
  ok(!!def && def.id === 238, `潮压表 id 钉值 238（${def && def.id}）`);
  ok(!!def && def.industryKind === 'gauge', 'industryKind = gauge');
  ok(!!def && def.requiresExtras.join() === 'industry', '归属工业内容');
  ok(INDUSTRY_BLOCK_KIND[GAUGE_BLOCK] === 'gauge' && INDUSTRY_ID_INFO.get(238) === 'gauge', '两端 id 表一致');
  ok(BlockRegistry.getId('harvester_w') === 237, 'B53 R2 家族 ID 未被插队');
  const keys = new Set([def.top, def.side, def.bottom, def.front, def.icon].filter(Boolean));
  for (const k of keys) ok(!!BlockSVGDefinitions[k], `纹理 ${k} 已在 SVG 表`);
  ok(!!def.faceTex && def.faceTex[def.facing] === def.front, '定向面已派生 faceTex（表盘朝北）');
  ok(def.icon === def.front, '图标取表盘面');
  const row = NAME_I18N[GAUGE_BLOCK];
  ok(Array.isArray(row) && row.length === 11 && row[0] === '潮压表', '名字表 11 语且首列对齐');
  ok(getItemCategory(GAUGE_BLOCK) === 'functional', '创造分类 = 功能方块');
  const recipe = getAllRecipes().find((r) => r.output === GAUGE_BLOCK);
  ok(!!recipe && recipeEnabled(recipe, INDUSTRY) && !recipeEnabled(recipe, NONE), '配方只在启用工业的世界可用');
  const lore = (def.lore || []).join('');
  ok(!!lore && !!en[lore], 'lore 有英文译文（i18n 动态键审计口径）');
  ok(MACHINE_DEMAND.gauge === 0, '潮压表不消耗潮压');
  ok(Array.isArray(MACHINE_SLOTS.gauge) && MACHINE_SLOTS.gauge.length === 0, '潮压表没有槽位');
  const st = emptyStateFor('gauge');
  ok(!!st && st.kind === 'gauge' && Object.keys(st).length === 1, '空状态只有 kind（纯只读、不落盘内容）');
}

// ── ② 读数：锅炉/机器台数与断路位置 ────────────────────────────────────
{
  // 锅炉(0,0,0) — 轴(1,0,0) — 离合闸(2,0,0) — 轴(3,0,0) — 碎石机(4,0,0)
  const blocks = mapOf([
    [key(0, 0, 0), 'boiler'], [key(1, 0, 0), 'shaft'], [key(2, 0, 0), 'clutch'],
    [key(3, 0, 0), 'shaft'], [key(4, 0, 0), 'crusher'],
  ]);
  const engaged = mapOf([[key(2, 0, 0), { kind: 'clutch', manual: true, powered: false }]]);
  const nets = buildNetworks(blocks, engaged);
  const info = netInfoFor(nets, key(0, 0, 0));
  ok(!!info && info.boilers === 1, '读数带上在烧锅炉台数（1 台）');
  ok(!!info && info.machines === 1, '读数带上机器台数（1 台碎石机）');
  ok(!!info && info.cutsTotal === 0 && Array.isArray(info.cuts), '接通时没有断路');
  ok(!!info && info.nodes === 5, '接通时全网 5 节点');
  // 断开离合闸：下游自成子网，闸记在"看得见它的那一侧"的 cuts 里
  const cut = mapOf([[key(2, 0, 0), { kind: 'clutch', manual: false, powered: false }]]);
  const nets2 = buildNetworks(blocks, cut);
  const up = netInfoFor(nets2, key(0, 0, 0));
  const down = netInfoFor(nets2, key(4, 0, 0));
  ok(!!up && up.cutsTotal === 1 && up.cuts[0] === key(2, 0, 0), '上游读得到断路位置（闸的坐标）');
  ok(!!up && up.nodes === 3, '上游只剩锅炉+轴+闸（3 节点）');
  ok(!!down && down.nodes === 2, '下游只剩轴+碎石机（2 节点）');
  ok(!!down && down.cutsTotal === 0, '下游看不到那处断路（它在上游那侧）');
  ok(!!up && up.cuts.length <= 6, '断路位置最多带 6 处（payload 有界）');
  // 多闸断路也封顶
  const many = new Map();
  for (let i = 0; i < 10; i++) {
    many.set(key(i * 2, 0, 0), 'clutch');
    many.set(key(i * 2 + 1, 0, 0), 'shaft');
  }
  const states = new Map();
  for (let i = 0; i < 10; i++) states.set(key(i * 2, 0, 0), { kind: 'clutch', manual: false, powered: false });
  const nets3 = buildNetworks(many, states);
  const first = netInfoFor(nets3, key(0, 0, 0));
  ok(!!first && first.cuts.length <= 6, '多处断路时坐标列表封顶 6 条');
}

// ── ③ 表状态：五种读数口径 ────────────────────────────────────────────
{
  const gst = { kind: 'gauge' };
  const net = (o = {}) => ({
    supply: 0, demand: 0, efficiency: 0, nodes: 1, overLimit: false,
    boilers: 0, machines: 0, cuts: [], cutsTotal: 0, ...o,
  });
  ok(machineStatus('gauge', gst, net({ overLimit: true })).reason === 'over-limit', '超限 → over-limit');
  ok(machineStatus('gauge', gst, net({ cutsTotal: 1, cuts: [key(2, 0, 0)] })).reason === 'cut', '有断路 → cut');
  ok(machineStatus('gauge', gst, net()).reason === 'no-power', '没有在烧的锅炉 → no-power');
  ok(machineStatus('gauge', gst, net({ supply: BOILER_SUPPLY })).reason === 'stalled', '有压但没机器 → stalled');
  ok(machineStatus('gauge', gst, net({ supply: BOILER_SUPPLY, demand: 2, efficiency: 1 })).reason === 'running', '有压有机器 → running');
  const s = machineStatus('gauge', gst, net({ boilers: 2, machines: 3, supply: 8, demand: 5, efficiency: 1, cutsTotal: 2 }));
  ok(s.boilers === 2 && s.machines === 3, '状态里带上锅炉/机器台数');
  ok(s.cutsTotal === 2 && Array.isArray(s.cuts), '状态里带上断路处数');
  ok(s.progressFrac === 0 && s.recipe === null, '仪表没有进度与配方（只读）');
  ok(machineStatus('gauge', null, net()).reason === 'idle', '没有状态条目时回落 idle（不崩）');
}

// ── ④ 并网规模 ────────────────────────────────────────────────────────
{
  // 单块孤立：1
  const empty = new Map();
  ok(projectedNetworkSize(buildNetworks(empty, null), empty, 5, 0, 0, null) === 1, '空网络里放一块 → 1 节点');
  // 接在一节轴后面：2
  const one = mapOf([[key(0, 0, 0), 'shaft']]);
  ok(projectedNetworkSize(buildNetworks(one, null), one, 1, 0, 0, null) === 2, '接一节轴 → 2 节点');
  // 夹在两个网络中间：1 + 1 + 1 = 3
  const two = mapOf([[key(0, 0, 0), 'shaft'], [key(2, 0, 0), 'shaft']]);
  ok(projectedNetworkSize(buildNetworks(two, null), two, 1, 0, 0, null) === 3, '并起两个网络 → 3 节点');
  // 断开的闸不并网（放一块在闸的下游另一侧，只算下游自己）
  const cutBlocks = mapOf([[key(0, 0, 0), 'shaft'], [key(1, 0, 0), 'clutch']]);
  const cutStates = mapOf([[key(1, 0, 0), { kind: 'clutch', manual: false, powered: false }]]);
  const cutNets = buildNetworks(cutBlocks, cutStates);
  // 断开的闸像锯断的轴：贴上去的新块自成 1 节点子网（与 buildNetworks 的 BFS 口径一致）
  ok(projectedNetworkSize(cutNets, cutBlocks, 2, 0, 0, cutStates) === 1,
    '断闸不导流：贴闸放一块不会并到上游（自成 1 节点）');
  {
    const after = new Map(cutBlocks);
    after.set(key(2, 0, 0), 'shaft');
    const netsAfter = buildNetworks(after, cutStates);
    const at = netInfoFor(netsAfter, key(2, 0, 0));
    ok(!!at && at.nodes === 1, '放下后真实网络也是 1 节点（预检与建图同口径）');
    const upAfter = netInfoFor(netsAfter, key(0, 0, 0));
    ok(!!upAfter && upAfter.nodes === 2, '上游仍是 2 节点（轴 + 闸），没被并进来');
  }
  // 满 128 恰好允许，129 拒绝
  const line = new Map();
  for (let i = 0; i < 127; i++) line.set(key(i, 0, 0), 'shaft');
  const lineNets = buildNetworks(line, null);
  ok(projectedNetworkSize(lineNets, line, 127, 0, 0, null) === 128, '127 节 + 1 = 128（刚好允许）');
  line.set(key(127, 0, 0), 'shaft');
  const full = buildNetworks(line, null);
  ok(projectedNetworkSize(full, line, 128, 0, 0, null) === 129, '128 节 + 1 = 129（该拒绝）');
}

// ── ⑤ 上限常量与文案 ──────────────────────────────────────────────────
{
  ok(INDUSTRY_BLOCK_LIMIT === 512, '每房间/维度方块上限 512');
  ok(NETWORK_MAX_NODES === 128, '单网络节点上限 128');
  ok(MACHINE_REASONS.includes('cut'), '停转原因表含 cut（压力表与机器共用一套码）');
  const ms = src('../src/ui/MachineScreen.js');
  for (const code of ['over-limit', 'cut', 'no-power', 'stalled', 'running']) {
    ok(ms.includes(`case '${code}':`), `gaugeText/reasonText 覆盖 ${code}`);
  }
  ok(ms.includes('export function gaugeText'), '压力表有独立读数文案函数');
  ok(ms.includes("boiler: 'tide_boiler'") && ms.includes("gauge: 'pressure_gauge'")
    && ms.includes("press: 'rune_press'"), '标题按 kind 取注册名（含 gauge / press）');
  for (const k of ['在烧锅炉 {n} 台 · 在跑机器 {m} 台', '断路 {n} 处：{list}', '上游闸断开，下游拿不到潮压',
    '表针到底：上游没有在烧的锅炉', '压力空转：有压但没有机器在干活',
    '只读仪表：不耗压、不产压，读数跟着网络实时变']) {
    ok(typeof en[k] === 'string' && en[k].length > 0, `语言包有键：${k.slice(0, 10)}…`);
  }
}

// ── ⑥ 源码绊线：预检与权威回滚 ────────────────────────────────────────
{
  const ic = src('../src/player/InteractionController.js');
  ok(ic.includes('g.industry.canPlaceAt('), '放置前走客户端预检');
  ok(ic.includes("t('潮工方块已达上限（512 个）')") && ic.includes("t('再连一节就超过 128 节点：这条轴太长了')"),
    '超限提示用静态 t() 字面量');
  const sys = src('../src/player/IndustrySystem.js');
  ok(sys.includes('canPlaceAt(x, y, z)'), 'IndustrySystem 暴露 canPlaceAt');
  ok(sys.includes('projectedNetworkSize('), '预检与服务器共用并网规模纯函数');
  const room = src('../server/room.js');
  ok(room.includes('projectedNetworkSize('), '服务器权威校验并网规模');
  ok(room.includes('_industryBlockTotal()'), '服务器按工业方块总数判 512 上限');
  ok(room.includes('本房间潮工方块已达上限'), '服务器拒绝时给系统提示');
  ok(room.includes('isIndustryId(id) && !industryKindOf('), '只对"新增"工业方块做限额（同格替换不算）');
  const ind = src('../server/industry.js');
  ok(ind.includes('[238, \'gauge\']'), '服务器 id 表登记潮压表');
  const ms = src('../src/ui/MachineScreen.js');
  ok(ms.includes('isGauge'), '界面区分只读仪表布局');
  ok(ms.includes("t('只读仪表：不耗压、不产压，读数跟着网络实时变')"), '仪表提示为静态字面量');
  ok(ms.includes('if (!isGauge) {'), '仪表走"不渲染槽位/背包"的分支守卫');
}

finish('build53-gauge-limits');
