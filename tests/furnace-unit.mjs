// furnace-unit.mjs -- Build 36 F-2 熔炉进出料纯算法回归（纯 node，不依赖服务器/浏览器）
// 覆盖：熔炉方块 id 钉值（服务器 id 表 vs BlockRegistry/furnaceLitId）、烧炼推进语义
//       （点火扣燃料/满 10s 产出/输出满停烧/断料清进度/大步长追赶有界/进度回退）、
//       漏斗进出料路由（燃料槽优先/只取产物/一堆 tick/槽满不动）、服务器账本快照与恢复、
//       房间权威 tick 的产出与点燃态方块切换。
import { ok, finish } from './harness.mjs';
import '../src/blocks/BlockDefs.js'; // 副作用注册（必须先于读 BlockRegistry）
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { furnaceLitId } from '../src/core/blockShape.js';
import { SMELT_TIME } from '../src/core/Smelting.js';
import { tickFurnaceState, emptyFurnaceState } from '../src/core/FurnaceTick.js';
import { tickHopperFlow, HOPPER_MAX_STACK } from '../src/core/HopperFlow.js';
import { FURNACE_ID_INFO, FURNACE_LIMIT, FURNACE_SYNC_MS, isFurnaceId, furnaceInfoOf, furnaceBlockId } from '../server/furnace.js';
import { CONTAINER_BLOCK_IDS } from '../server/flow.js';
import { roomSnapshot, isRoomSnapshot } from '../server/store.js';
import { Room } from '../server/room.js';

const key = (x, y, z) => `${x},${y},${z}`;
const box = (...slots) => {
  const a = new Array(27).fill(null);
  slots.forEach((s, i) => { a[i] = s; });
  return a;
};
const stack = (name, count = 1) => ({ name, count, data: null });
const totalOf = (arr) => (Array.isArray(arr) ? arr.filter(Boolean).reduce((n, s) => n + s.count, 0) : -1);

// ── 1. 方块 id 钉值：服务器 id 表必须与 BlockDefs 注册顺序一致 ──────────────────
for (const [id, info] of FURNACE_ID_INFO) {
  const def = BlockRegistry.getById(id);
  ok(!!def && def.baseBlock === 'furnace', `熔炉 id ${id} 仍是熔炉家族（${def ? def.name : 'MISSING'}）`);
  ok(def.facing === info.facing && !!def.lit === info.lit,
    `熔炉 id ${id} 的 facing/lit 一致（${def.facing}/${def.lit} vs ${info.facing}/${info.lit}）`);
  // 服务器 id 表必须与客户端同一套派生函数同源，防止两处各自维护后漂移
  ok(furnaceLitId(info.facing, info.lit) === id, `熔炉 id ${id} 与 furnaceLitId(${info.facing},${info.lit}) 同源`);
  ok(isFurnaceId(id) && !!furnaceInfoOf(id), `furnaceInfoOf(${id}) 可查`);
  ok(furnaceBlockId(info.facing, info.lit) === id, `furnaceBlockId 反查回 ${id}`);
}
ok(FURNACE_ID_INFO.size === 8, '熔炉家族恰好 8 个 id（4 朝向 × 点燃/熄灭）');
ok(furnaceBlockId('n', false) !== furnaceBlockId('n', true), '点燃态与熄灭态是两个不同方块 id');
ok(furnaceBlockId('x', false) === 0 && furnaceInfoOf(0) === null, '非法朝向/未知 id 一律回落 0/null');
ok(FURNACE_LIMIT === 256, '每房间熔炉账本上限 256');
ok(FURNACE_SYNC_MS === 500, '烧炼进度同步节拍 500ms');
// F-1 的 27 槽容器表不能混进熔炉：两条路径（container_set 与 furnace_set）必须各管各的
for (const [id, info] of FURNACE_ID_INFO) {
  ok(!CONTAINER_BLOCK_IDS.has(id), `熔炉 id ${id}（${info.facing}/${info.lit}）不在 27 槽容器表里`);
}

// ── 2. 烧炼推进语义 ────────────────────────────────────────────────────────
const mkSt = (patch = {}) => Object.assign(emptyFurnaceState(), patch);

// 2.1 没有燃料不推进
{
  const st = mkSt({ input: stack('iron_ore', 1) });
  const r = tickFurnaceState(st, 5);
  ok(st.cookTime === 0 && st.burnTime === 0, '无燃料：不点火也不推进进度');
  ok(r.slotsChanged === false && r.litChanged === false, '无燃料：两项变化标志都为 false');
}

// 2.2 点火即扣 1 个燃料，点燃态翻转
{
  const st = mkSt({ input: stack('iron_ore', 1), fuel: stack('coal', 2) });
  const r = tickFurnaceState(st, 0.1);
  ok(st.burnTime > 0 && st.burnMax === 80, '点火：coal 燃烧 80 秒，burnTime/burnMax 就位');
  ok(st.fuel.count === 1, '点火：燃料立刻扣 1 个（2 → 1）');
  ok(r.litChanged === true && r.slotsChanged === true, '点火：litChanged 与 slotsChanged 都置位');
}

// 2.3 满 SMELT_TIME 产出 1 个，输入耗尽清进度
{
  const st = mkSt({ input: stack('iron_ore', 1), fuel: stack('coal', 1) });
  tickFurnaceState(st, 0.05);              // 点火
  tickFurnaceState(st, SMELT_TIME - 0.05); // 补满一个烧炼周期
  ok(!!st.output && st.output.name === 'iron_ingot' && st.output.count === 1, '满 10s 产出 1 个铁锭');
  ok(st.input === null, '输入耗尽后槽位清空');
  ok(st.cookTime === 0, '断料清进度（不残留 cookTime）');
}

// 2.4 输出槽同类满 64 → 停止烧炼，进度回退
{
  const st = mkSt({ input: stack('iron_ore', 64), fuel: stack('coal', 1), output: stack('iron_ingot', 64), cookTime: 4 });
  tickFurnaceState(st, 1);
  ok(st.output.count === 64 && st.cookTime < 4, '输出槽满：不再产出且进度回退');
  ok(st.input.count === 64, '输出槽满：输入一个也不消耗');
}

// 2.5 不可烧物品：有火也不推进
{
  const st = mkSt({ input: stack('bread', 3), fuel: stack('coal', 1) });
  tickFurnaceState(st, 8);
  ok(st.cookTime === 0 && st.output === null, '非可烧物品不产生任何产物');
}

// 2.6 大步长追赶有界：一次 tick 最多产出一堆（guard 64），原料按量精确消耗
{
  const st = mkSt({ input: stack('iron_ore', 64), fuel: stack('coal_block', 1) });
  tickFurnaceState(st, 0.05);   // 点火（coal_block 800s）
  tickFurnaceState(st, 700);    // 单帧 700 秒：仍在燃烧窗口内，理论可烧 70 个
  ok(st.output && st.output.count === 64, '单帧最多产出 64 个（一堆 = 追赶上限）');
  ok(st.input === null, '原料按产出量精确消耗干净（不留残料）');
  ok(st.burnTime > 0, '大步长追赶后燃烧计时仍单调（不因追赶反复重置）');
  ok(st.cookTime === 0, '断料后进度归零');
}

// 2.7 半程分两次推进与一次推进等价（帧率无关）
{
  const a = mkSt({ input: stack('iron_ore', 1), fuel: stack('coal', 1) });
  const b = mkSt({ input: stack('iron_ore', 1), fuel: stack('coal', 1) });
  tickFurnaceState(a, 0.05); tickFurnaceState(a, SMELT_TIME);
  tickFurnaceState(b, 0.05); tickFurnaceState(b, SMELT_TIME / 2); tickFurnaceState(b, SMELT_TIME / 2);
  ok(a.output.count === b.output.count && a.cookTime === b.cookTime, '分两次推进与一次推进产出等价（帧率无关）');
}

// 2.8 dt<=0 与脏状态不抛
{
  const st = mkSt();
  const r0 = tickFurnaceState(st, 0);
  ok(r0.slotsChanged === false && r0.litChanged === false, 'dt=0 不产生任何变化');
  ok(tickFurnaceState(null, 1).slotsChanged === false, '空状态不抛且返回空变化');
}

// ── 3. 漏斗 ↔ 熔炉进出料路由 ────────────────────────────────────────────────
function makeIo(containers, furnaces) {
  const changed = [];
  return {
    changed,
    io: {
      getContainer: (x, y, z) => containers.get(key(x, y, z)) || null,
      ensureContainer: (x, y, z) => {
        const k = key(x, y, z);
        let c = containers.get(k);
        if (!c) { c = new Array(27).fill(null); containers.set(k, c); }
        return c;
      },
      getFurnace: (x, y, z) => furnaces.get(key(x, y, z)) || null,
      ensureFurnace: (x, y, z) => {
        const k = key(x, y, z);
        let f = furnaces.get(k);
        if (!f) { f = emptyFurnaceState(); furnaces.set(k, f); }
        return f;
      },
      onFurnaceChanged: (x, y, z) => changed.push(key(x, y, z)),
    },
  };
}

// 3.1 出料口正对熔炉：燃料先进燃料槽
{
  const containers = new Map([[key(0, 0, 0), box(stack('coal', 5))]]);
  const furnaces = new Map([[key(1, 0, 0), emptyFurnaceState()]]);
  const { io, changed } = makeIo(containers, furnaces);
  const touched = tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 'e' }], io);
  const f = furnaces.get(key(1, 0, 0));
  ok(!!f.fuel && f.fuel.name === 'coal' && f.fuel.count === 5, '燃料物品进燃料槽');
  ok(f.input === null, '燃料物品不进输入槽');
  ok(changed.join('|') === key(1, 0, 0), '熔炉变更回调带出被改写的熔炉坐标');
  ok(touched.has(key(0, 0, 0)) && !touched.has(key(1, 0, 0)), '漏斗自身进 touched，熔炉不进容器 touched');
}

// 3.2 可烧物品进输入槽
{
  const containers = new Map([[key(0, 0, 0), box(stack('iron_ore', 3))]]);
  const furnaces = new Map([[key(0, 0, 1), emptyFurnaceState()]]);
  const { io } = makeIo(containers, furnaces);
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 's' }], io);
  const f = furnaces.get(key(0, 0, 1));
  ok(!!f.input && f.input.name === 'iron_ore' && f.input.count === 3, '可烧物品进输入槽');
  ok(f.fuel === null, '可烧物品不进燃料槽');
}

// 3.3 既是燃料又可烧（原木）：燃料槽优先；燃料槽满了才退到输入槽
{
  const c1 = new Map([[key(0, 0, 0), box(stack('oak_log', 2))]]);
  const f1 = new Map([[key(1, 0, 0), emptyFurnaceState()]]);
  const io1 = makeIo(c1, f1).io;
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 'e' }], io1);
  ok(f1.get(key(1, 0, 0)).fuel && f1.get(key(1, 0, 0)).fuel.name === 'oak_log', '双料物品优先进燃料槽');

  const c2 = new Map([[key(0, 0, 0), box(stack('oak_log', 2))]]);
  const f2 = new Map([[key(1, 0, 0), Object.assign(emptyFurnaceState(), { fuel: stack('coal', 64) })]]);
  const io2 = makeIo(c2, f2).io;
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 'e' }], io2);
  ok(!!f2.get(key(1, 0, 0)).input && f2.get(key(1, 0, 0)).input.name === 'oak_log', '燃料槽满时双料物品退到输入槽');
}

// 3.4 熔炉在漏斗正上方：只取输出槽
{
  const containers = new Map([[key(0, 1, 0), new Array(27).fill(null)]]);
  const furnaces = new Map([[key(0, 2, 0), Object.assign(emptyFurnaceState(), {
    input: stack('iron_ore', 9), fuel: stack('coal', 9), output: stack('iron_ingot', 4),
  })]]);
  const { io, changed } = makeIo(containers, furnaces);
  tickHopperFlow([{ x: 0, y: 1, z: 0, facing: 's' }], io);
  const self = containers.get(key(0, 1, 0));
  const f = furnaces.get(key(0, 2, 0));
  ok(totalOf(self) === 4, '漏斗从熔炉只取到产物 4 个');
  ok(self.some((s) => s && s.name === 'iron_ingot'), '取到的确实是产物');
  ok(f.output === null, '产物槽被取空');
  ok(f.input.count === 9 && f.fuel.count === 9, '输入/燃料槽一个也不外流');
  ok(changed.join('|') === key(0, 2, 0), '取产物同样触发熔炉变更回调');
}

// 3.5 输出槽为空：什么也不发生
{
  const containers = new Map([[key(0, 1, 0), new Array(27).fill(null)]]);
  const furnaces = new Map([[key(0, 2, 0), emptyFurnaceState()]]);
  const { io, changed } = makeIo(containers, furnaces);
  const touched = tickHopperFlow([{ x: 0, y: 1, z: 0, facing: 's' }], io);
  ok(totalOf(containers.get(key(0, 1, 0))) === 0, '产物槽空：漏斗保持空');
  ok(changed.length === 0 && touched.size === 0, '产物槽空：无变更回调、无 touched');
}

// 3.6 每 tick 只搬一堆（受目标槽剩余空间限制）
{
  const containers = new Map([[key(0, 0, 0), box(stack('coal', 64))]]);
  const furnaces = new Map([[key(1, 0, 0), Object.assign(emptyFurnaceState(), { fuel: stack('coal', 60) })]]);
  const { io } = makeIo(containers, furnaces);
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 'e' }], io);
  ok(furnaces.get(key(1, 0, 0)).fuel.count === HOPPER_MAX_STACK, '目标槽补满 64');
  ok(containers.get(key(0, 0, 0))[0].count === 60, '只搬 4 个（一堆 = 目标剩余空间）');
}

// 3.7 燃料槽满且物品不可烧：一动不动
{
  const containers = new Map([[key(0, 0, 0), box(stack('coal', 5))]]);
  const furnaces = new Map([[key(1, 0, 0), Object.assign(emptyFurnaceState(), { fuel: stack('coal', 64) })]]);
  const { io, changed } = makeIo(containers, furnaces);
  tickHopperFlow([{ x: 0, y: 0, z: 0, facing: 'e' }], io);
  ok(containers.get(key(0, 0, 0))[0].count === 5, '燃料槽满：燃料原封不动');
  ok(changed.length === 0, '没搬动就不发熔炉变更回调');
}

// ── 4. 服务器账本：快照 / 恢复 / 权威 tick ──────────────────────────────────
const FURNACE_N = furnaceBlockId('n', false);
const FURNACE_N_LIT = furnaceBlockId('n', true);

// 4.1 roomSnapshot 带上熔炉账本
{
  const room = new Room('t-snap', null, {});
  room.seed = 4321; // isRoomSnapshot 要求 seed 是整数（未开房的房间 seed=null）
  room.dimensionBlocks.set('overworld', new Map([['0,0,0', FURNACE_N]]));
  room.dimensionFurnaces.set('overworld', new Map([['0,0,0', Object.assign(emptyFurnaceState(), { input: stack('iron_ore', 2) })]]));
  const snap = roomSnapshot(room);
  ok(Array.isArray(snap.dimensionFurnaces.overworld) && snap.dimensionFurnaces.overworld.length === 1, '快照含 dimensionFurnaces');
  ok(snap.dimensionFurnaces.overworld[0][1].input.name === 'iron_ore', '快照保留了熔炉内容物');
  ok(isRoomSnapshot(snap), 'isRoomSnapshot 接受带熔炉账本的快照');
  ok(!isRoomSnapshot({ ...snap, dimensionFurnaces: [] }), 'isRoomSnapshot 拒绝数组形式的熔炉账本');
  ok(!isRoomSnapshot({ ...snap, dimensionFurnaces: { overworld: 'x' } }), 'isRoomSnapshot 拒绝非数组的维度条目');
}

// 4.2 旧快照（无 dimensionFurnaces）恢复为空表，不抛
{
  const room = new Room('t-old', null, {});
  room.restore({ name: 't-old', seed: 1, dimensionBlocks: { overworld: [] } });
  ok(room.dimensionFurnaces.size === 0, '旧快照无熔炉字段 → 空表');
}

// 4.3 恢复：方块账本里仍是熔炉 → 状态与进度都回来；方块已不是熔炉 → 条目被剪掉
{
  const room = new Room('t-restore', null, {});
  room.restore({
    name: 't-restore',
    seed: 7,
    dimensionBlocks: { overworld: [['0,0,0', FURNACE_N], ['5,0,0', 1]] },
    dimensionFurnaces: {
      overworld: [
        ['0,0,0', { input: { name: 'iron_ore', count: 3 }, fuel: null, output: null, burnTime: 12.5, burnMax: 80, cookTime: 3.5 }],
        ['5,0,0', { input: { name: 'iron_ore', count: 9 }, fuel: null, output: null, burnTime: 0, burnMax: 0, cookTime: 0 }],
        ['9,9,9', { input: null, fuel: null, output: null, burnTime: 0, burnMax: 0, cookTime: 0 }],
      ],
    },
  });
  const m = room.dimensionFurnaces.get('overworld');
  ok(m.size === 1, `只保留方块账本里仍是熔炉的条目（实际 ${m.size}）`);
  const st = m.get('0,0,0');
  ok(!!st && st.input.name === 'iron_ore' && st.input.count === 3, '恢复内容物');
  ok(st.burnTime === 12.5 && st.burnMax === 80 && st.cookTime === 3.5, '恢复燃烧/烧炼进度');
  ok(!m.has('5,0,0') && !m.has('9,9,9'), '方块不是熔炉的条目被剪掉（防幽灵槽位）');
}

// 4.4 sanitizeFurnaceState：脏状态一律清洗，不崩
{
  const room = new Room('t-san', null, {});
  ok(room.sanitizeFurnaceState(null) === null, 'null 状态 → null');
  ok(room.sanitizeFurnaceState([]) === null, '数组状态 → null');
  const st = room.sanitizeFurnaceState({
    input: { name: 'iron_ore', count: 999 }, fuel: { name: '', count: 3 },
    output: null, burnTime: -5, burnMax: 'x', cookTime: NaN,
  });
  ok(st.input.count === 64, '超限数量钳到 64');
  ok(st.fuel === null, '无名物品栈清洗成空槽');
  ok(st.burnTime === 0 && st.burnMax === 0 && st.cookTime === 0, '非法进度字段归 0');
}

// 4.5 房间权威 tick：进度推进 + 产出 + 点燃态方块切换
{
  const room = new Room('t-tick', null, {});
  room.restore({
    name: 't-tick',
    seed: 9,
    dimensionBlocks: { overworld: [['0,0,0', FURNACE_N]] },
    dimensionFurnaces: {
      overworld: [['0,0,0', { input: { name: 'iron_ore', count: 2 }, fuel: { name: 'coal', count: 1 }, output: null, burnTime: 0, burnMax: 0, cookTime: 0 }]],
    },
  });
  const st = room.dimensionFurnaces.get('overworld').get('0,0,0');
  let t = 1_000_000;
  room.tickFurnaces(t); // 第一帧只对齐 dt
  ok(st.burnTime === 0, '首帧只对齐时间基准，不推进');
  room.tickFurnaces(t + 200);
  ok(st.burnTime > 0 && st.fuel === null, '第二个 tick 点火并扣掉最后一个燃料');
  const litId = room.dimensionBlocks.get('overworld').get('0,0,0');
  ok(litId === FURNACE_N_LIT, `点燃态方块已切到 furnace_lit（实际 ${litId}）`);
  for (let i = 1; i <= 11; i++) room.tickFurnaces(t + 200 + i * 1000);
  ok(!!st.output && st.output.name === 'iron_ingot' && st.output.count === 1, '11 秒后产出恰好 1 个铁锭（不多不少）');
  ok(st.input.count === 1, '原料按产出量恰好消耗 1 个');
  // 挖掉熔炉：方块变成空气 → 账本条目在下一次 tick 自动作废
  room.onBlockSet({ id: 1, dim: 'overworld', name: 'x' }, { x: 0, y: 0, z: 0, id: 0 });
  ok(room.dimensionFurnaces.get('overworld').size === 0, '方块被挖 → 熔炉账本条目立刻清掉');
  // 此时燃料已被消耗，剩下「1 个铁矿石 + 1 个铁锭」两组内容物
  const dropNames = [...room.drops.values()].map((d) => d.name).sort().join(',');
  ok(room.drops.size === 2 && dropNames === 'iron_ingot,iron_ore', `内容物按服务器权威散落成掉落（${dropNames}）`);
}

finish('furnace-unit');
