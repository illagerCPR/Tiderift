// room-persist-replay.mjs -- S8 世界落盘节流 + S9 回放批量打包/背压（纯 node，不依赖服务器进程）
import { Room } from '../server/room.js';
import { roomSnapshot } from '../server/store.js';
import { assert, finish } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 假连接：记录 send 载荷（readyState=1 供 sendTo 放行）；bufferedAmount 可调以驱动背压分支
function fakeWs() {
  return {
    readyState: 1, bufferedAmount: 0, sent: [],
    send(buf) { this.sent.push(JSON.parse(buf)); },
  };
}
function fakePlayer(id, name, dim = 'overworld') {
  return { id, name, dim, ws: fakeWs(), pos: { x: 0, y: 64, z: 0 }, alive: true };
}

// ── 节流原语：saveSoon 只标脏 / flushWorld 幂等 / save 即时 ──────────────
const saved = [];
const room = new Room('t-persist', (r) => saved.push(r));
for (let i = 0; i < 200; i++) room.saveSoon();
assert('saveSoon × 200 不落盘（onSave 计数 0）', saved.length === 0, `saved=${saved.length}`);
assert('saveSoon 后 isWorldDirty() 为真', room.isWorldDirty() === true);
room.flushWorld();
assert('flushWorld 立即落盘一次', saved.length === 1, `saved=${saved.length}`);
assert('flushWorld 后脏标记复位', room.isWorldDirty() === false);
room.flushWorld();
assert('重复 flushWorld 幂等（不脏时不落盘）', saved.length === 1, `saved=${saved.length}`);
room.save();
assert('save() 立即落盘（计数 +1）', saved.length === 2, `saved=${saved.length}`);

// 每个操作前先 flushWorld 清脏，确保脏标记确实由本次操作置位
function checkThrottled(name, fn) {
  room.flushWorld();
  const before = saved.length;
  fn();
  assert(name, saved.length === before && room.isWorldDirty() === true,
    `saved+${saved.length - before} dirty=${room.isWorldDirty()}`);
}
function checkImmediate(name, fn) {
  room.flushWorld();
  const before = saved.length;
  fn();
  assert(name, saved.length === before + 1 && room.isWorldDirty() === false,
    `saved+${saved.length - before} dirty=${room.isWorldDirty()}`);
}

// ── 行为级接线：高频路径（方块/容器/掉落）走 saveSoon ────────────────────
const A = fakePlayer(1, 'Alice');
room.addPlayer(A);
checkThrottled('方块单条落账本走 saveSoon', () => room.onBlockSet(A, { x: 1, y: 64, z: 1, id: 1 }));
checkThrottled('方块批量落账本走 saveSoon', () => room.onBlockSetBatch(A, { list: [[2, 64, 2, 1], [3, 64, 3, 2]] }));
checkThrottled('容器落账本走 saveSoon', () => room.onContainerSet(A, { x: 4, y: 64, z: 4, items: new Array(27).fill(null) }));
checkThrottled('掉落物生成走 saveSoon', () => room.onDropSpawn(A, { x: 5, y: 64, z: 5, name: 'dirt', count: 1 }));
const dropId = [...room.drops.keys()].pop();
checkThrottled('掉落物拾取走 saveSoon', () => room.onDropTaken(A, { id: dropId }));
room.drops.set(999999, { x: 0, y: 0, z: 0, name: 'dirt', count: 1, dim: 'overworld', spawnedAt: Date.now() - 10 * 60 * 1000 });
checkThrottled('掉落物过期清理走 saveSoon', () => room.expireDrops());
checkThrottled('玩家死亡掉落走 saveSoon',
  () => room.onPlayerDied(A, { x: 6, y: 64, z: 6, drops: [{ name: 'dirt', count: 1 }] }));

// ── 结构性变更仍即时 save（等价语义不变）────────────────────────────────
checkImmediate('建房走即时 save', () => room.createRoom(A, { seed: 12345, mode: 'survival' }));
checkImmediate('世界重建走即时 save', () => room.resetWorld());
checkImmediate('换维走即时 save', () => room.onSwitchDimension(A, { dim: 'nether' }));
checkImmediate('设时间走即时 save', () => room.onSetTime(A, { time: 0.5 }));

// ── 退房强刷：房间清空时 flushWorld ────────────────────────────────────
const B = fakePlayer(2, 'Bob');
room.addPlayer(B);
room.saveSoon();
const beforeLeave = saved.length;
room.removePlayer(B.id);
assert('非最后一名玩家退房不触发世界强刷', saved.length === beforeLeave && room.isWorldDirty() === true,
  `saved+${saved.length - beforeLeave}`);
room.onBlockSet(A, { x: 7, y: 64, z: 7, id: 1 });
const beforeEmpty = saved.length;
room.removePlayer(A.id);
assert('最后一名玩家退房触发世界强刷（onSave +1 且脏标记复位）',
  saved.length === beforeEmpty + 1 && room.isWorldDirty() === false, `saved+${saved.length - beforeEmpty}`);

// ── B32-1：空气修改必须作为账本值跨快照与加入回放保留 ───────────────────
const airLedger = new Room('t-air-ledger');
const miner = fakePlayer(1, 'Miner');
airLedger.addPlayer(miner);
airLedger.onBlockSet(miner, { x: 11, y: 64, z: -2, id: 0 });
assert('单条挖掘以显式 0 保留天然方块坐标',
  airLedger.dimensionBlocks.get('overworld')?.has('11,64,-2') &&
  airLedger.dimensionBlocks.get('overworld')?.get('11,64,-2') === 0);
airLedger.onBlockSetBatch(miner, { list: [[12, 64, -2, 0], [13, 64, -2, 4]] });
assert('批量挖掘保留 0 且同批放置值仍在账本',
  airLedger.dimensionBlocks.get('overworld')?.get('12,64,-2') === 0 &&
  airLedger.dimensionBlocks.get('overworld')?.get('13,64,-2') === 4);
airLedger.dimensionContainers.set('overworld', new Map([['11,64,-2', new Array(27).fill(null)]]));
airLedger.onBlockSet(miner, { x: 11, y: 64, z: -2, id: 0 });
assert('挖掉容器时清除容器内容但保留空气账本项',
  airLedger.dimensionBlocks.get('overworld')?.get('11,64,-2') === 0 &&
  !airLedger.dimensionContainers.get('overworld')?.has('11,64,-2'));
const savedAir = JSON.parse(JSON.stringify(roomSnapshot(airLedger)));
const restoredAir = new Room('t-air-ledger');
restoredAir.restore(savedAir);
assert('JSON 快照恢复保留空气值 0',
  restoredAir.dimensionBlocks.get('overworld')?.has('11,64,-2') &&
  restoredAir.dimensionBlocks.get('overworld')?.get('11,64,-2') === 0);
const lateJoiner = fakePlayer(2, 'LateJoiner');
restoredAir.addPlayer(lateJoiner);
restoredAir.joinRoom(lateJoiner, {}, {});
const airReplay = lateJoiner.ws.sent.filter((m) => m.t === 'block_change_batch').flatMap((m) => m.list);
assert('新玩家回放包含显式空气修改',
  airReplay.some(([x, y, z, id]) => x === 11 && y === 64 && z === -2 && id === 0));

// ── S9 回放打包：1200 格账本 → 512/512/176 三条 block_change_batch ──────
const LEDGER = [];
for (let i = 0; i < 1200; i++) LEDGER.push([`${i},64,0`, 1 + (i % 7)]);
const replay = new Room('t-replay');
replay.addPlayer(fakePlayer(1, 'Host'));
replay.restore({ seed: 4242, dimensionBlocks: { overworld: LEDGER } });
const joiner = fakePlayer(2, 'Joiner');
replay.addPlayer(joiner);
replay.joinRoom(joiner, {}, {});

const batches = joiner.ws.sent.filter((m) => m.t === 'block_change_batch');
assert('回放同步发出 3 条 block_change_batch（512/512/176）',
  batches.map((b) => b.list.length).join(',') === '512,512,176', batches.map((b) => b.list.length).join(','));
assert('回放无逐格 block_change', !joiner.ws.sent.some((m) => m.t === 'block_change'));
assert('每条 list.length ≤ 512', batches.every((b) => (b.list || []).length <= 512));
assert('载荷形状 {list:[[x,y,z,id]], by:0, d:维度}',
  batches.every((b) => b.by === 0 && b.d === 'overworld' &&
    (b.list || []).every((it) => Array.isArray(it) && it.length === 4 && it.every((v) => typeof v === 'number'))));
const expectFlat = LEDGER.map(([k, id]) => { const [x, y, z] = k.split(',').map(Number); return [x, y, z, id]; });
const gotFlat = batches.flatMap((b) => b.list);
assert('回放总格数 = 账本格数且取值一致', JSON.stringify(gotFlat) === JSON.stringify(expectFlat),
  `total=${gotFlat.length}`);

// 账本为空时不发任何回放消息（保持既有语义）
const empty = new Room('t-empty');
empty.addPlayer(fakePlayer(1, 'Host'));
empty.restore({ seed: 1, dimensionBlocks: {} });
const emptyJoiner = fakePlayer(2, 'J');
empty.addPlayer(emptyJoiner);
empty.joinRoom(emptyJoiner, {}, {});
assert('账本为空不发方块回放消息',
  !emptyJoiner.ws.sent.some((m) => m.t === 'block_change_batch' || m.t === 'block_change'));

// ── S9 背压：超阈值异步等待，不丢项 ────────────────────────────────────
const bp = new Room('t-backpressure');
bp.addPlayer(fakePlayer(1, 'Host'));
bp.restore({ seed: 7, dimensionBlocks: { overworld: LEDGER } });
const slow = fakePlayer(2, 'Slow');
bp.addPlayer(slow);
slow.ws.bufferedAmount = 2 * 1024 * 1024; // 超 1MB 阈值
bp.joinRoom(slow, {}, {});
assert('背压超阈值：本 tick 不发任何块（异步推进）',
  slow.ws.sent.filter((m) => m.t === 'block_change_batch').length === 0);
await sleep(150);
assert('缓冲未排空：继续等待且不丢块（仍 0 条）',
  slow.ws.sent.filter((m) => m.t === 'block_change_batch').length === 0);
slow.ws.bufferedAmount = 0; // 模拟排空
await sleep(150);
const bpBatches = slow.ws.sent.filter((m) => m.t === 'block_change_batch');
assert('缓冲排空后全部块送达（3 条 / 1200 格）',
  bpBatches.length === 3 && bpBatches.reduce((n, b) => n + b.list.length, 0) === 1200,
  `${bpBatches.length}条/${bpBatches.reduce((n, b) => n + b.list.length, 0)}格`);
finish('room-persist-replay');
