// hopper-unit.mjs -- Build 36 F-1 漏斗搬运纯算法回归（纯 node，不依赖服务器/浏览器）
// 覆盖：方块 id 钉值（服务器 id 表 vs BlockRegistry）、配置白名单、朝向出料、先出后进、
//       一堆/tick、满/空/不可堆叠/上限边界、touched 每容器一条、确定性。
import { ok, finish } from './harness.mjs';
import '../src/blocks/BlockDefs.js'; // 副作用注册（必须先于读 BlockRegistry）
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { tickHopperFlow, flowTarget, HOPPER_MAX_STACK } from '../src/core/HopperFlow.js';
import { HOPPER_FACING_BY_ID, CONTAINER_BLOCK_IDS, FLOW_HOPPER_LIMIT } from '../server/flow.js';
import { loadConfig, applyConfig } from '../server/config.js';

// ── 1. 方块 id 钉值：服务器 id 表必须与 BlockDefs 注册顺序一致 ──────────────────
const expectedNames = { n: 'hopper', s: 'hopper_s', e: 'hopper_e', w: 'hopper_w' };
for (const [id, facing] of HOPPER_FACING_BY_ID) {
  const def = BlockRegistry.getById(id);
  ok(!!def && def.name === expectedNames[facing],
    `漏斗 id ${id} 仍是 ${expectedNames[facing]}（实际 ${def ? def.name : 'MISSING'}）`);
  ok(!!def && def.baseBlock === 'hopper' && def.facing === facing,
    `漏斗 id ${id} 的 baseBlock/facing 一致（${def && def.baseBlock}/${def && def.facing}）`);
}
ok(HOPPER_FACING_BY_ID.size === 4, '漏斗朝向表恰好四档');
for (const id of CONTAINER_BLOCK_IDS) {
  const def = BlockRegistry.getById(id);
  const isContainer = !!def && (def.baseBlock === 'chest' || def.baseBlock === 'hopper' || def.name === 'shulker_box');
  ok(isContainer, `容器 id ${id} 仍是容器方块（${def ? def.name : 'MISSING'}）`);
}
ok(FLOW_HOPPER_LIMIT === 64, '每房间漏斗上限 64');
// ID 追加纪律：漏斗家族必须是当前末尾（B36 之后的新方块只能排在 hopper_w 之后）
{
  const all = BlockRegistry.all();
  ok(all[all.length - 1].name === 'hopper_w', '漏斗家族是当前最后注册的方块', all[all.length - 1].name);
  ok(BlockRegistry.getId('ruin_plaque') === 216, '前序末尾（遗迹铭牌）ID 未被插队改变', String(BlockRegistry.getId('ruin_plaque')));
}
const hopperDef = BlockRegistry.getByName('hopper');
ok(!!hopperDef && hopperDef.facingAway === true, '漏斗是 facingAway 家族（出料口背对玩家）');
ok(!!hopperDef && hopperDef.front === 'hopper_front', '漏斗定向面纹理已注册');

// ── 2. 配置白名单：flowEnabled / flowIntervalMs 必须真正落到配置里 ─────────────
const cfg0 = loadConfig();
ok(cfg0.flowEnabled === true, '默认 flowEnabled=true');
ok(cfg0.flowIntervalMs === 200, '默认 flowIntervalMs=200');
ok(applyConfig(cfg0, { flowEnabled: false }).flowEnabled === false, 'applyConfig 接受 flowEnabled=false');
ok(applyConfig(cfg0, { flowEnabled: 'false' }).flowEnabled === true, 'flowEnabled 只认 boolean（字符串被忽略）');
ok(applyConfig(cfg0, { flowIntervalMs: 1000 }).flowIntervalMs === 1000, 'applyConfig 接受 flowIntervalMs');
ok(applyConfig(cfg0, { flowIntervalMs: 50 }).flowIntervalMs === 200, 'flowIntervalMs 低于 200 被拒（保持原值）');
ok(applyConfig(cfg0, { flowIntervalMs: 999999 }).flowIntervalMs === 200, 'flowIntervalMs 超上限被拒（保持原值）');

// ── 3. 搬运算法 ────────────────────────────────────────────────────────────
const stack = (name, count, data = null) => ({ name, count, data });
const emptySlots = () => new Array(27).fill(null);
// 容器恒为 27 槽（协议不变量）：短数组会让「空槽判定」失效，测试统一用 box() 造
const box = (...items) => {
  const a = emptySlots();
  items.forEach((s, i) => { if (s) a[i] = s; });
  return a;
};
const key = (x, y, z) => `${x},${y},${z}`;

// 造一个账本：containers = Map("x,y,z" -> 27 槽)；createAllowed 决定哪些位置允许凭空建容器
function makeIo(containers, createAllowed = null) {
  return {
    getContainer: (x, y, z) => containers.get(key(x, y, z)) || null,
    ensureContainer: (x, y, z) => {
      const k = key(x, y, z);
      const cur = containers.get(k);
      if (cur) return cur;
      if (createAllowed && !createAllowed.has(k)) return null;
      const items = emptySlots();
      containers.set(k, items);
      return items;
    },
  };
}
const get = (containers, x, y, z) => containers.get(key(x, y, z)) || null;
const contentsOf = (items) => items.filter(Boolean).map((s) => `${s.name}x${s.count}`).join(',');

// 3.1 朝向映射
ok(JSON.stringify(flowTarget(5, 70, 5, 'n')) === JSON.stringify({ x: 5, y: 70, z: 4 }), '朝向 n → z-1');
ok(JSON.stringify(flowTarget(5, 70, 5, 's')) === JSON.stringify({ x: 5, y: 70, z: 6 }), '朝向 s → z+1');
ok(JSON.stringify(flowTarget(5, 70, 5, 'e')) === JSON.stringify({ x: 6, y: 70, z: 5 }), '朝向 e → x+1');
ok(JSON.stringify(flowTarget(5, 70, 5, 'w')) === JSON.stringify({ x: 4, y: 70, z: 5 }), '朝向 w → x-1');
ok(JSON.stringify(flowTarget(5, 70, 5, 'bogus')) === JSON.stringify({ x: 5, y: 69, z: 5 }), '非法朝向退化为向下');

// 3.2 空源：不动任何东西
{
  const c = new Map();
  c.set(key(0, 0, 0), emptySlots());
  c.set(key(0, 1, 0), emptySlots());
  c.set(key(0, 0, 1), emptySlots());
  const touched = tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(c));
  ok(touched.size === 0, '空源不产生任何搬运与广播');
}

// 3.3 先出后进：第一 tick 进货，第二 tick 出货
{
  const c = new Map();
  c.set(key(0, 1, 0), box(stack('bread', 8)));
  const io = makeIo(c);
  const hoppers = [{ x: 0, y: 0, z: 0, facing: 's' }];
  let touched = tickHopperFlow(hoppers, io);
  ok(contentsOf(get(c, 0, 0, 0)) === 'breadx8', 'tick1 上方箱子 → 漏斗缓冲');
  ok(contentsOf(get(c, 0, 1, 0)) === '', 'tick1 上方箱子被搬空');
  ok(touched.has(key(0, 0, 0)) && touched.has(key(0, 1, 0)), 'tick1 touched 含漏斗与来源');
  touched = tickHopperFlow(hoppers, io);
  ok(contentsOf(get(c, 0, 0, 1)) === 'breadx8', 'tick2 漏斗缓冲 → 出料口目标箱');
  ok(contentsOf(get(c, 0, 0, 0)) === '', 'tick2 漏斗缓冲清空');
  ok(touched.has(key(0, 0, 0)) && touched.has(key(0, 0, 1)), 'tick2 touched 含漏斗与目标');
}

// 3.4 目标满：只囤不吐（不丢物品）
{
  const full = emptySlots().map(() => stack('stone', HOPPER_MAX_STACK));
  const c = new Map();
  c.set(key(0, 1, 0), box(stack('bread', 3)));
  c.set(key(0, 0, 1), full);
  const io = makeIo(c);
  const hoppers = [{ x: 0, y: 0, z: 0, facing: 's' }];
  for (let i = 0; i < 3; i++) tickHopperFlow(hoppers, io);
  ok(contentsOf(get(c, 0, 0, 0)) === 'breadx3', '目标满时物品停在漏斗缓冲（不丢）');
  ok(get(c, 0, 0, 1).filter(Boolean).length === 27, '目标箱 27 槽仍是石头未破坏');
  ok(get(c, 0, 1, 0).filter(Boolean).length === 0, '上方箱子已搬空');
}

// 3.5 堆叠上限：并入同类未满堆只补到 64
{
  const c = new Map();
  c.set(key(0, 0, 0), box(stack('bread', HOPPER_MAX_STACK)));
  c.set(key(0, 0, 1), box(stack('bread', HOPPER_MAX_STACK - 4)));
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(c));
  ok(contentsOf(get(c, 0, 0, 1)) === 'breadx64', '同类未满堆补满到 64');
  ok(contentsOf(get(c, 0, 0, 0)) === 'breadx60', '补满后剩余留在源容器');
}

// 3.6 带 data（潜影盒）不堆叠：进空槽而非并入同名堆
{
  const c = new Map();
  c.set(key(0, 0, 0), box(stack('shulker_box', 1, { items: [] })));
  c.set(key(0, 0, 1), box(stack('shulker_box', 5)));
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(c));
  const dst = get(c, 0, 0, 1);
  ok(dst[0].count === 5, '带 data 的物品不并入同名堆');
  ok(!!dst[1] && dst[1].name === 'shulker_box' && dst[1].count === 1 && !!dst[1].data, '带 data 的物品独占空槽且 data 保留');
}

// 3.7 每 tick 每漏斗只搬一堆
{
  const c = new Map();
  c.set(key(0, 1, 0), box(stack('bread', 5), null, stack('iron_ingot', 3)));
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(c));
  ok(contentsOf(get(c, 0, 0, 0)) === 'breadx5', '一 tick 只搬第一堆（iron 未动）');
  ok(get(c, 0, 1, 0)[2].count === 3, '第二堆原样留在上方容器');
}

// 3.8 朝向错误不搬运（出料方向没有容器 → 只囤不吐，且不凭空造容器）
{
  const c = new Map();
  c.set(key(0, 1, 0), box(stack('bread', 2)));
  const io = makeIo(c, new Set([key(0, 0, 0), key(0, 0, 1)])); // 只允许漏斗自身与 s 方向
  const hoppers = [{ x: 0, y: 0, z: 0, facing: 'e' }];
  for (let i = 0; i < 3; i++) tickHopperFlow(hoppers, io);
  ok(contentsOf(get(c, 0, 0, 0)) === 'breadx2', '朝向 e 无处可出 → 物品囤在漏斗里');
  ok(!c.has(key(1, 0, 0)), '不会凭空给不存在的目标建容器');
  ok(!c.has(key(0, 0, 1)), '错误方向的容器未被创建');
}

// 3.9 touched 每容器一条（同 tick 两条漏斗共用一个目标）
{
  const c = new Map();
  c.set(key(0, 1, 0), box(stack('bread', 1)));
  c.set(key(1, 1, 0), box(stack('iron_ingot', 1)));
  c.set(key(1, 0, 1), emptySlots()); // 两条漏斗的共用目标
  const touched = tickHopperFlow([
    { x: 0, y: 0, z: 0, facing: 's' },  // 目标 (0,0,1) → 需自建
    { x: 1, y: 0, z: 1, facing: 's' },  // 自身缓冲有货则先出
  ], makeIo(c));
  ok(touched instanceof Set, 'tickHopperFlow 返回 Set（天然按容器去重）');
  ok([...touched].length === touched.size, '同 tick 每容器最多一条键');
  ok([...touched].every((k) => c.has(k)), 'touched 里的键都是真实存在于账本的容器');
}

// 3.10 确定性：同一初始状态下重复跑得到同样结果
{
  const build = () => {
    const c = new Map();
    c.set(key(0, 1, 0), box(stack('bread', 7)));
    c.set(key(0, 0, 1), box(stack('bread', 60)));
    return c;
  };
  const a = build(), b = build();
  const t1 = tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(a));
  const t2 = tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(b));
  ok(contentsOf(get(a, 0, 0, 1)) === contentsOf(get(b, 0, 0, 1)), '两次运行目标箱内容一致');
  ok([...t1].sort().join('|') === [...t2].sort().join('|'), '两次运行 touched 一致');
}

finish('hopper-unit');
