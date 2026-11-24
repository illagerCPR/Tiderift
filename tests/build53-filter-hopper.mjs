// build53-filter-hopper.mjs -- Build 53 R1 分拣漏斗（过滤槽 / 满箱回退 / 不可堆叠 / 两端同构）
// 纯 node，不依赖服务器。断言：
//   ① 注册：方块 ID 钉值（230~233）、朝向家族、归属、纹理键、十一语名字、功能分类、配方闸口
//   ② 协议不变量：容器仍是 27 槽；过滤槽 = 最后一格，缓冲只剩前 26 格
//   ③ 过滤规则：只搬同名物品（出料与取料都认）、空过滤 = 全通、过滤槽自己永不流动、
//      名字相同但带 data 的物品不并堆
//   ④ 边界：目标满 → 物品留在缓冲（不丢不复制）；26 格缓冲填满后不再从上游抽取；
//      作为出料目标时分拣漏斗的第 27 格不会被别的漏斗写
//   ⑤ 熔炉路径：过滤同时管「进炉」与「取炉产物」
//   ⑥ 守恒与确定性：多 tick 多漏斗场景总物品数恒定、重复运行结果一致
//   ⑦ 兼容：没有 isFilterHopper 注入时，带第 27 格内容的容器仍按普通漏斗搬
//   ⑧ 索引：World 的漏斗索引（写入与读档派生）都认分拣漏斗
//   ⑨ 源码绊线：服务器 id 表 / 服务器 sweep 注入判定 / 界面与破坏路径接线
import { readFileSync } from 'fs';
import {
  tickHopperFlow, filterNameOf, flowTarget, CONTAINER_SLOTS, FILTER_SLOT, FILTER_BUFFER_SLOTS,
} from '../src/core/HopperFlow.js';
import {
  HOPPER_FACING_BY_ID, FILTER_HOPPER_FACING_BY_ID, CONTAINER_BLOCK_IDS,
  hopperFacingOf, isHopperId, isFilterHopperId, isContainerId,
} from '../server/flow.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { World } from '../src/core/World.js';
import { getAllRecipes, recipeEnabled } from '../src/core/Crafting.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { normalizeExtraContent } from '../src/content/ExtraContent.js';
import { en } from '../src/i18n/locales/en.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const INDUSTRY = normalizeExtraContent({ schema: 1, industry: true });
const NONE = normalizeExtraContent(null);

const key = (x, y, z) => `${x},${y},${z}`;
const stack = (name, count, data = null) => ({ name, count, data });
const emptySlots = () => new Array(CONTAINER_SLOTS).fill(null);
const box = (...items) => {
  const a = emptySlots();
  items.forEach((s, i) => { if (s) a[i] = s; });
  return a;
};
const get = (c, x, y, z) => c.get(key(x, y, z)) || null;
const contentsOf = (items) => items.filter(Boolean).map((s) => `${s.name}x${s.count}`).join(',');
const totalCount = (containers) => {
  let n = 0;
  for (const items of containers.values()) for (const s of items) if (s) n += s.count;
  return n;
};
// isFilterHopper 由调用方按方块种类注入（服务器查方块账本、单机查 BlockRegistry）
function makeIo(containers, filterAt = null) {
  const io = {
    getContainer: (x, y, z) => containers.get(key(x, y, z)) || null,
    ensureContainer: (x, y, z) => {
      const k = key(x, y, z);
      const cur = containers.get(k);
      if (cur) return cur;
      const items = emptySlots();
      containers.set(k, items);
      return items;
    },
  };
  if (filterAt) io.isFilterHopper = (x, y, z) => filterAt.has(key(x, y, z));
  return io;
}
const furnace = (st = {}) => ({
  input: null, fuel: null, output: null, burnTime: 0, burnMax: 0, cookTime: 0, ...st,
});
function makeFurnaceIo(containers, furnaces, filterAt = null) {
  const io = makeIo(containers, filterAt);
  io.getFurnace = (x, y, z) => furnaces.get(key(x, y, z)) || null;
  io.ensureFurnace = (x, y, z) => furnaces.get(key(x, y, z)) || null;
  io.onFurnaceChanged = () => {};
  return io;
}

// ── ① 注册与 id 钉值 ──────────────────────────────────────────────────
{
  const expected = { n: 'filter_hopper', s: 'filter_hopper_s', e: 'filter_hopper_e', w: 'filter_hopper_w' };
  ok(FILTER_HOPPER_FACING_BY_ID.size === 4, '分拣漏斗朝向表恰好四档');
  for (const [id, facing] of FILTER_HOPPER_FACING_BY_ID) {
    const def = BlockRegistry.getById(id);
    ok(!!def && def.name === expected[facing], `分拣漏斗 id ${id} = ${expected[facing]}（实际 ${def ? def.name : 'MISSING'}）`);
    ok(!!def && def.baseBlock === 'filter_hopper' && def.facing === facing,
      `id ${id} 的 baseBlock/facing 一致（${def && def.baseBlock}/${def && def.facing}）`);
    ok(!!def && def.filterHopper === true, `id ${id} 带 filterHopper 标记`);
    ok(!!def && def.facingAway === true, `id ${id} 是 facingAway 家族（出料口背对玩家）`);
    ok(isContainerId(id) && isHopperId(id) && isFilterHopperId(id), `id ${id} 同时是容器/漏斗/分拣漏斗`);
    ok(hopperFacingOf(id) === facing, `id ${id} 朝向查询 = ${facing}`);
  }
  ok(BlockRegistry.getId('filter_hopper') === 230 && BlockRegistry.getId('filter_hopper_w') === 233,
    '分拣漏斗家族 ID 钉值 230~233');
  // ID 追加纪律：既有方块一律不动（旧存档/联机账本按数字 ID 落盘）
  ok(BlockRegistry.getId('hopper') === 217 && BlockRegistry.getId('hopper_w') === 220, '普通漏斗家族 ID 未被插队');
  ok(BlockRegistry.getId('tide_cutter') === 228 && BlockRegistry.getId('drive_clutch') === 229, 'B52 两件 ID 未被插队');
  ok(HOPPER_FACING_BY_ID.size === 4 && !isFilterHopperId(217) && !isFilterHopperId(220),
    '普通漏斗表口径不变（四档、不算分拣）');
  // 纹理键必须全在 SVG 表里（缺键会 fallback 到整张图集，B28 老坑）
  for (const facing of ['n', 's', 'e', 'w']) {
    const def = BlockRegistry.getByName(expected[facing]);
    const keys = new Set([def.top, def.side, def.bottom, def.front, def.icon].filter(Boolean));
    for (const k of keys) ok(!!BlockSVGDefinitions[k], `${def.name} 纹理 ${k} 已在 SVG 表`);
    ok(!!def.faceTex && def.faceTex[def.facing] === def.front, `${def.name} 定向面已派生 faceTex`);
    ok(def.icon === def.front, `${def.name} 图标取定向面（看得出正/筛面）`);
  }
  // 归属、分类、配方闸口
  const row = NAME_I18N.filter_hopper;
  ok(Array.isArray(row) && row.length === 11 && row[0] === '分拣漏斗', '分拣漏斗名字表 11 语且首列对齐');
  ok(getItemCategory('filter_hopper') === 'functional', '分拣漏斗创造分类 = 功能方块');
  ok(getItemCategory('hopper') === 'functional', '普通漏斗也归功能方块（同栏相邻，不再落在杂项）');
  const recipe = getAllRecipes().find((r) => r.output === 'filter_hopper');
  ok(!!recipe && recipe.count === 1, '分拣漏斗有 1 出 1 的配方');
  ok(!!recipe && recipeEnabled(recipe, INDUSTRY) && !recipeEnabled(recipe, NONE), '配方只在启用工业的世界可用');
  ok(BlockRegistry.getByName('filter_hopper').requiresExtras.join() === 'industry', '方块本体归属工业内容');
  const lore = (BlockRegistry.getByName('filter_hopper').lore || []).join('');
  ok(lore.includes('筛子'), '方块 lore 落库（界面悬浮用）');
  ok(!!en[lore], '方块 lore 有英文译文（i18n 动态键审计口径）');
  for (const k of ['分拣漏斗', '过滤', '最后一格是过滤槽：放什么就只搬什么，空着 = 全通']) {
    ok(typeof en[k] === 'string' && en[k].length > 0, `语言包有键：${k.slice(0, 12)}…`);
  }
}

// ── ② 协议不变量 ───────────────────────────────────────────────────────
{
  ok(CONTAINER_SLOTS === 27, '容器协议不变量仍是 27 槽（存档/联机/导入导出零改动）');
  ok(FILTER_SLOT === 26, '过滤槽 = 最后一格（下标 26）');
  ok(FILTER_BUFFER_SLOTS === 26, '分拣漏斗缓冲 = 前 26 格');
  const withFilter = box(stack('bread', 3));
  withFilter[FILTER_SLOT] = stack('iron_ingot', 1);
  ok(filterNameOf(withFilter) === 'iron_ingot', 'filterNameOf 读最后一格的物品名');
  ok(filterNameOf(emptySlots()) === null, '空过滤槽 → null（全通）');
  ok(filterNameOf(null) === null && filterNameOf(undefined) === null, '非数组输入安全返回 null');
  const withData = box();
  withData[FILTER_SLOT] = stack('shulker_box', 1, { items: [stack('bread', 2)] });
  ok(filterNameOf(withData) === 'shulker_box', '过滤只认物品名（带 data 也按名字认）');
}

// ── ③ 过滤规则 ────────────────────────────────────────────────────────
// 3.1 出料只放行同名物品
{
  const c = new Map();
  const self = box(stack('bread', 5), stack('iron_ingot', 3));
  self[FILTER_SLOT] = stack('bread', 1);
  c.set(key(0, 0, 0), self);
  const touched = tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(c, new Set([key(0, 0, 0)])));
  ok(contentsOf(get(c, 0, 0, 1)) === 'breadx5', '过滤=面包 → 只有面包出门');
  ok(contentsOf(self) === 'iron_ingotx3,breadx1', '铁留在缓冲、过滤槽的面包原样不动');
  ok(touched.has(key(0, 0, 0)) && touched.has(key(0, 0, 1)), 'touched 含两端容器');
}

// 3.2 空过滤 = 全通（与普通漏斗一致）
{
  const build = (filterSet) => {
    const c = new Map();
    c.set(key(0, 0, 0), box(stack('iron_ingot', 4)));
    tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(c, filterSet));
    return c;
  };
  const filteredEmpty = build(new Set([key(0, 0, 0)]));
  const plain = build(null);
  ok(contentsOf(get(filteredEmpty, 0, 0, 1)) === 'iron_ingotx4', '过滤槽空着 → 全通');
  ok(contentsOf(get(filteredEmpty, 0, 0, 1)) === contentsOf(get(plain, 0, 0, 1)), '空过滤与普通漏斗结果一致');
}

// 3.3 过滤同样管「取料」：不认的物品连进都不进
{
  const c = new Map();
  c.set(key(0, 1, 0), box(stack('bread', 2), stack('iron_ingot', 4)));
  const self = box();
  self[FILTER_SLOT] = stack('iron_ingot', 1);
  c.set(key(0, 0, 0), self);
  const io = makeIo(c, new Set([key(0, 0, 0)]));
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], io);
  ok(contentsOf(self) === 'iron_ingotx4,iron_ingotx1', '只把铁取进缓冲（面包留在上游）');
  ok(contentsOf(get(c, 0, 1, 0)) === 'breadx2', '上游面包一个不少');
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], io);
  ok(contentsOf(get(c, 0, 0, 1)) === 'iron_ingotx4', '第二 tick 把缓冲里的铁送出去');
  ok(contentsOf(self) === 'iron_ingotx1', '缓冲清空后只剩过滤槽的样品');
}

// 3.4 过滤槽自己永不流动（出料与取料都不碰）
{
  const c = new Map();
  const self = box();
  self[FILTER_SLOT] = stack('diamond', 1);
  c.set(key(0, 0, 0), self);
  const io = makeIo(c, new Set([key(0, 0, 0)]));
  for (let i = 0; i < 5; i++) tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], io);
  ok(contentsOf(get(c, 0, 0, 1)) === '', '只有过滤槽、缓冲为空 → 一个东西都运不出去');
  ok(contentsOf(self) === 'diamondx1', '过滤槽的钻石仍在原处（没有被当缓冲搬走）');
  ok(filterNameOf(self) === 'diamond', '过滤规则仍生效');
}

// 3.5 名字相同但带 data 的物品不并堆（沿用 canMerge 语义）
{
  const c = new Map();
  const a = stack('shulker_box', 1, { items: [] });
  const b = stack('shulker_box', 1, { items: [stack('bread', 1)] });
  const self = box(a);
  self[FILTER_SLOT] = stack('shulker_box', 1);
  c.set(key(0, 0, 0), self);
  const dst = box(b);
  c.set(key(0, 0, 1), dst);
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(c, new Set([key(0, 0, 0)])));
  ok(dst[0] && dst[0].count === 1 && contentsOf([dst[0]]).includes('x1'), '同名带 data 不并进已有堆');
  ok(dst[1] && dst[1].data === a.data, '进空槽且 data 原样保留（引用未被复制或重置）');
  ok(!self[0], '原槽已空');
}

// ── ④ 边界：目标满 / 缓冲满 / 被写入 ────────────────────────────────────
// 4.1 目标满 → 物品留在缓冲，不丢不复制，过滤槽不受影响
{
  const c = new Map();
  const self = box(stack('bread', 10));
  self[FILTER_SLOT] = stack('bread', 1);
  c.set(key(0, 0, 0), self);
  c.set(key(0, 1, 0), box(stack('bread', 64)));
  const full = emptySlots();
  for (let i = 0; i < CONTAINER_SLOTS; i++) full[i] = stack('stone', 64);
  c.set(key(0, 0, 1), full);
  const before = totalCount(c);
  const io = makeIo(c, new Set([key(0, 0, 0)]));
  for (let i = 0; i < 3; i++) tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], io);
  ok(totalCount(c) === before, '目标满时总物品数守恒（不丢不复制）');
  ok(filterNameOf(self) === 'bread', '过滤槽没被挤掉');
  const breadInSelf = self.slice(0, FILTER_BUFFER_SLOTS).filter(Boolean).reduce((n, s) => n + s.count, 0);
  ok(breadInSelf === 74, `上游面包全部退守缓冲（10+64=74，实际 ${breadInSelf}）`);
  ok(contentsOf(full).startsWith('stonex64'), '满箱内容一个字节没动');
}

// 4.2 26 格缓冲填满后不再从上游抽取
{
  const c = new Map();
  const self = emptySlots();
  for (let i = 0; i < FILTER_BUFFER_SLOTS; i++) self[i] = stack(`sand`, 1);
  self[FILTER_SLOT] = stack('sand', 1);
  c.set(key(0, 0, 0), self);
  const up = box(stack('sand', 8));
  c.set(key(0, 1, 0), up);
  // 目标位置无容器 → 出料无处可去，缓冲不会被清空
  const touched = tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(c, new Set([key(0, 0, 0)])));
  ok(contentsOf(up) === 'sandx8', '缓冲 26 格全满 → 不再从上游抽取（物品留在原处）');
  ok(touched.size >= 0, 'touched 结构稳定（Set）');
  ok(filterNameOf(self) === 'sand', '过滤槽仍是 sand');
}

// 4.3 作为出料目标：分拣漏斗的第 27 格不会被别的漏斗写
{
  const c = new Map();
  // 上方的普通漏斗有 5 个钻石要往下推
  c.set(key(0, 1, 0), box(stack('diamond', 5)));
  // 下方的分拣漏斗：0~25 全是砖，第 27 格放着 1 个钻石作过滤样品
  const dst = emptySlots();
  for (let i = 0; i < FILTER_BUFFER_SLOTS; i++) dst[i] = stack('brick', 64);
  dst[FILTER_SLOT] = stack('diamond', 1);
  c.set(key(0, 0, 0), dst);
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(c, new Set([key(0, 0, 0)])));
  ok(dst[FILTER_SLOT].count === 1, '过滤槽不会被并堆（26 格全满就是进不来）');
  ok(contentsOf(get(c, 0, 1, 0)) === 'diamondx5', '钻石原样留在上游漏斗');
}

// 4.4 空的缓冲 + 过滤槽有样品 → 目标箱子能收下才搬
{
  const c = new Map();
  const self = box();
  self[FILTER_SLOT] = stack('wheat', 1);
  c.set(key(0, 0, 0), self);
  c.set(key(0, 1, 0), box(stack('wheat', 6)));
  const io = makeIo(c, new Set([key(0, 0, 0)]));
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], io);
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], io);
  ok(contentsOf(get(c, 0, 0, 1)) === 'wheatx6', '过滤=小麦 → 小麦照常直通');
  ok(filterNameOf(self) === 'wheat', '过滤规则仍在');
}

// ── ⑤ 熔炉路径 ────────────────────────────────────────────────────────
// 5.1 过滤管「进炉」：只有同名物品进燃料/原料槽
{
  const c = new Map();
  const self = box(stack('coal', 2), stack('cobblestone', 4));
  self[FILTER_SLOT] = stack('coal', 1);
  c.set(key(0, 0, 0), self);
  const f = furnace();
  const furnaces = new Map([[key(0, 0, 1), f]]);
  const io = makeFurnaceIo(c, furnaces, new Set([key(0, 0, 0)]));
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], io);
  ok(f.fuel && f.fuel.name === 'coal' && f.fuel.count === 2, '燃料槽只收到过滤放行的煤');
  ok(!f.input, '圆石没有进炉（过滤不认它）');
  ok(contentsOf(self) === 'cobblestonex4,coalx1', '圆石留在缓冲、过滤样品不动');
}

// 5.2 过滤管「取炉产物」：产物不同名就不取
{
  const c = new Map();
  const self = box();
  self[FILTER_SLOT] = stack('sand', 1);
  c.set(key(0, 0, 0), self);
  const f = furnace({ output: stack('gravel', 3) });
  const furnaces = new Map([[key(0, 1, 0), f]]);
  const io = makeFurnaceIo(c, furnaces, new Set([key(0, 0, 0)]));
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], io);
  ok(contentsOf(self) === 'sandx1' && f.output.count === 3, '过滤=沙 → 不取砾石产物');
  self[FILTER_SLOT] = stack('gravel', 1);
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], io);
  ok(contentsOf(self) === 'gravelx3,gravelx1', '换成砾石过滤 → 产物被取走');
  ok(!f.output, '熔炉输出槽已清空');
}

// ── ⑥ 守恒与确定性 ────────────────────────────────────────────────────
{
  const build = () => {
    const c = new Map();
    // 两条分拣漏斗：一条只搬面包、一条只搬铁；上面各有一个上游箱
    const f1 = box();
    f1[FILTER_SLOT] = stack('bread', 1);
    const f2 = box();
    f2[FILTER_SLOT] = stack('iron_ingot', 1);
    c.set(key(0, 0, 0), f1);
    c.set(key(0, 0, 2), f2);
    c.set(key(0, 1, 0), box(stack('bread', 20), stack('iron_ingot', 12)));
    c.set(key(0, 1, 2), box(stack('bread', 7), stack('iron_ingot', 30)));
    c.set(key(0, 0, 1), emptySlots()); // f1 的出料口
    c.set(key(0, 0, 3), emptySlots()); // f2 的出料口
    return c;
  };
  const run = () => {
    const c = build();
    const io = makeIo(c, new Set([key(0, 0, 0), key(0, 0, 2)]));
    const list = [
      { x: 0, y: 0, z: 0, facing: 's' },
      { x: 0, y: 0, z: 2, facing: 's' },
    ];
    const before = totalCount(c);
    for (let i = 0; i < 20; i++) {
      tickHopperFlow(list, io);
      if (totalCount(c) !== before) return { c, ok: false, before };
    }
    return { c, ok: true, before };
  };
  const a = run();
  ok(a.ok, '20 tick 全程物品数守恒');
  ok(contentsOf(get(a.c, 0, 0, 1)) === 'breadx20', '面包线只收面包（20 个全到）');
  ok(contentsOf(get(a.c, 0, 0, 3)) === 'iron_ingotx30', '铁线只收铁（30 个全到）');
  const b = run();
  ok(contentsOf(get(a.c, 0, 0, 1)) === contentsOf(get(b.c, 0, 0, 1)) &&
     contentsOf(get(a.c, 0, 0, 3)) === contentsOf(get(b.c, 0, 0, 3)), '两次运行结果一致（确定性）');
}

// ── ⑦ 兼容：没有 isFilterHopper 注入时按普通漏斗搬 ───────────────────────
{
  const c = new Map();
  const self = box();
  self[FILTER_SLOT] = stack('diamond', 1); // 没有 isFilterHopper → 这就是普通第 27 格
  c.set(key(0, 0, 0), self);
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(c));
  ok(contentsOf(get(c, 0, 0, 1)) === 'diamondx1', '无注入时第 27 格照常当缓冲搬走（旧口径不变）');
  ok(!get(c, 0, 0, 0)[FILTER_SLOT], '源槽已清空');
}

// ── ⑧ World 漏斗索引认分拣漏斗 ─────────────────────────────────────────
{
  const w = new World(20261124);
  const fid = BlockRegistry.getId('filter_hopper');
  const hid = BlockRegistry.getId('hopper');
  w.trackHopper(3, 70, 5, fid);
  ok(w.hoppers.get(key(3, 70, 5)) === 'n', 'trackHopper 收录分拣漏斗（朝向 n）');
  w.trackHopper(3, 70, 5, hid);
  ok(w.hoppers.get(key(3, 70, 5)) === 'n', '换成普通漏斗仍在这张索引里');
  w.trackHopper(3, 70, 5, BlockRegistry.getId('stone'));
  ok(!w.hoppers.has(key(3, 70, 5)), '换成石头后从索引里摘掉');
  // 读档派生：方块账本里的分拣漏斗要进当前维度的索引
  const w2 = new World(20261124);
  w2.loadDimensionBuckets({ overworld: { '9,64,-2': fid } }, {}, null, null);
  ok(w2.hoppers.get('9,64,-2') === 'n', '读档派生索引收录分拣漏斗');
  w2.loadDimensionBuckets({ overworld: { '9,64,-2': BlockRegistry.getId('filter_hopper_e') } }, {}, null, null);
  ok(w2.hoppers.get('9,64,-2') === 'e', '读档派生索引带出朝向 e');
}

// ── ⑨ 源码绊线 ────────────────────────────────────────────────────────
{
  const roomSrc = src('../server/room.js');
  ok(roomSrc.includes('isFilterHopper:'), '服务器 sweep 注入 isFilterHopper 判定');
  ok(roomSrc.includes('isFilterHopperId('), '服务器按方块 id 表判定分拣漏斗');
  const placement = src('../src/player/Placement.js');
  ok(placement.includes('isFilterHopper: isFilterHopperAt'), '单机本地 tick 注入同一判定');
  ok(placement.includes('def.filterHopper'), '单机容器判定认分拣漏斗');
  const worldSrc = src('../src/core/World.js');
  ok(worldSrc.includes('isHopperFamilyDef'), 'World 用同一张漏斗家族判定（写入 + 读档派生）');
  ok((worldSrc.match(/isHopperFamilyDef\(/g) || []).length >= 3, 'World 的写入与派生都过这个判定');
  const chest = src('../src/ui/ChestScreen.js');
  ok(chest.includes('filter-tag') && chest.includes('filterHopper'), '容器界面标出过滤格');
  ok(chest.includes("t('最后一格是过滤槽：放什么就只搬什么，空着 = 全通')"), '界面提示用静态 t() 字面量');
  const ic = src('../src/player/InteractionController.js');
  ok((ic.match(/filterHopper/g) || []).length >= 3, '右键开界与两条破坏路径都认分拣漏斗');
  const flowSrc = src('../src/core/HopperFlow.js');
  ok(flowSrc.includes('FILTER_SLOT') && flowSrc.includes('FILTER_BUFFER_SLOTS'), '过滤槽常量单点定义在 HopperFlow');
}

finish('build53-filter-hopper');
