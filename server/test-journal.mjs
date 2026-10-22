// test-journal.mjs -- B34-A 四界游记共享标记服务端回归（纯 node：Room 直接实例化，不依赖服务器进程）
// 覆盖：字段清洗 / 分享广播与幂等 / 删除权限（owner ⇄ operator）/ 账本上限 / 写入限速 / 落盘往返 / 旧档兼容
// 用法：node server/test-journal.mjs（跑批时由 run-all-tests.sh 在起服阶段调用）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Room, sanitizeJournalMarker } from './room.js';
import { roomSnapshot, saveRoom, loadRooms } from './store.js';
import { MSG } from './protocol.js';
import { assert, finish } from './test-lib.mjs';

function fakeWs() {
  return { readyState: 1, bufferedAmount: 0, sent: [], send(buf) { this.sent.push(JSON.parse(buf)); } };
}
function fakePlayer(id, name) {
  return { id, name, dim: 'overworld', ws: fakeWs(), pos: { x: 0, y: 64, z: 0 } };
}
function join(room, id, name) {
  const p = fakePlayer(id, name);
  room.players.set(p.id, p);
  return p;
}
const sentOfType = (p, type) => p.ws.sent.filter((m) => m.t === type);
const BASE = { dim: 'overworld', x: 10, y: 64, z: 20, label: '家', color: '#ff0000' };

// ── 一、服务端清洗：客户端字段一律不可信 ────────────────────────────────
const clean = sanitizeJournalMarker({ ...BASE });
assert('合法标记通过清洗并保留字段', clean && clean.dim === 'overworld' && clean.x === 10 && clean.y === 64 && clean.z === 20);
assert('清洗结果不含 id/ownerId/owner（入账时才注入）', clean && !('id' in clean) && !('ownerId' in clean) && !('owner' in clean));
assert('非对象 / 数组 / 字符串一律拒绝',
  sanitizeJournalMarker(null) === null && sanitizeJournalMarker([]) === null && sanitizeJournalMarker('x') === null);
assert('未知维度拒绝', sanitizeJournalMarker({ ...BASE, dim: 'nowhere' }) === null);
assert('坐标不接受字符串强转', sanitizeJournalMarker({ ...BASE, x: '10' }) === null);
assert('坐标 NaN / Infinity 拒绝', sanitizeJournalMarker({ ...BASE, y: NaN }) === null && sanitizeJournalMarker({ ...BASE, z: Infinity }) === null);
assert('坐标越界拒绝（|v| > 30000000）', sanitizeJournalMarker({ ...BASE, x: 30000001 }) === null);
assert('label 超长截断到 48 字符', sanitizeJournalMarker({ ...BASE, label: 'a'.repeat(100) }).label.length === 48);
assert('label 去控制字符后为空则拒绝', sanitizeJournalMarker({ ...BASE, label: '\u0000\u0001' }) === null);
assert('非法颜色回落默认色 #f4ca64', sanitizeJournalMarker({ ...BASE, color: 'red' }).color === '#f4ca64');
assert('缺省颜色回落默认色', sanitizeJournalMarker({ ...BASE, color: undefined }).color === '#f4ca64');
assert('合法颜色保留', sanitizeJournalMarker({ ...BASE, color: '#0a1B2c' }).color === '#0a1B2c');

// ── 二、分享、广播与注入 ────────────────────────────────────────────────
const room = new Room('t-journal-share');
const alice = join(room, 1, 'Alice');
const bob = join(room, 2, 'Bob');
room.onJournalMarker(alice, { ...BASE });
assert('分享后账本新增一条', room.journalMarkers.size === 1);
assert('分享者本人收到广播（多端顺序一致）', sentOfType(alice, MSG.JOURNAL_MARKER_ADD).length === 1);
assert('同房间其他人收到广播且内容一致',
  sentOfType(bob, MSG.JOURNAL_MARKER_ADD).length === 1 && sentOfType(bob, MSG.JOURNAL_MARKER_ADD)[0].marker.label === '家');
const firstMarker = [...room.journalMarkers.values()][0];
assert('服务端分配权威 id（j-<n>）', /^j-\d+$/.test(firstMarker.id), firstMarker.id);
assert('服务端注入归属 ownerId/owner', firstMarker.ownerId === 1 && firstMarker.owner === 'Alice');

// ── 三、幂等与多 owner 隔离 ─────────────────────────────────────────────
room.onJournalMarker(alice, { ...BASE });
assert('同 owner 重复分享幂等（账本仍 1 条）', room.journalMarkers.size === 1);
assert('重复分享回发已有标记（不新增 id）', sentOfType(alice, MSG.JOURNAL_MARKER_ADD).length === 2);
room.onJournalMarker(bob, { ...BASE });
assert('不同 owner 同内容各自入账（不互相覆盖）', room.journalMarkers.size === 2);

// ── 四、删除权限：owner 或 operator ─────────────────────────────────────
room.onJournalMarkerDelete(bob, { id: firstMarker.id });
assert('非 owner 删除被拒（账本保留）', room.journalMarkers.has(firstMarker.id));
assert('非 owner 删除不广播', sentOfType(bob, MSG.JOURNAL_MARKER_REMOVED).length === 0);
room.onJournalMarkerDelete(alice, { id: firstMarker.id });
assert('owner 删除成功', !room.journalMarkers.has(firstMarker.id));
assert('删除向全房间广播', sentOfType(bob, MSG.JOURNAL_MARKER_REMOVED).length === 1);
assert('删除不存在的 id 不抛异常', (() => { try { room.onJournalMarkerDelete(alice, { id: 'j-999' }); return true; } catch { return false; } })());

const opRoom = new Room('t-journal-op', null, { roomOps: { 't-journal-op': ['Op'] } });
opRoom.hostId = 99; // Op 不是 host，仅凭 roomOps 授权
const op = join(opRoom, 1, 'Op');
const ownerP = join(opRoom, 2, 'Owner');
opRoom.onJournalMarker(ownerP, { ...BASE });
const opMarker = [...opRoom.journalMarkers.values()][0];
opRoom.onJournalMarkerDelete(op, { id: opMarker.id });
assert('operator 可删除他人标记', !opRoom.journalMarkers.has(opMarker.id));

// ── 五、账本上限 256（绕开写入限速，只测上限语义）──────────────────────
const capRoom = new Room('t-journal-cap');
const capPlayer = join(capRoom, 1, 'Cap');
for (let i = 0; i < 300; i++) {
  capPlayer._journalBucket = null; // 每轮重置令牌桶，隔离限速与本用例
  capRoom.onJournalMarker(capPlayer, { ...BASE, x: i * 10, label: 'm' + i });
}
assert('账本上限 256 条', capRoom.journalMarkers.size === 256, String(capRoom.journalMarkers.size));
assert('超额丢弃最旧（m0 已被挤出）', ![...capRoom.journalMarkers.values()].some((m) => m.label === 'm0'));
assert('最新条目仍保留（m299）', [...capRoom.journalMarkers.values()].some((m) => m.label === 'm299'));

// ── 六、写入限速：突发 90 后丢弃 ────────────────────────────────────────
const rateRoom = new Room('t-journal-rate');
const ratePlayer = join(rateRoom, 1, 'Rate');
for (let i = 0; i < 120; i++) rateRoom.onJournalMarker(ratePlayer, { ...BASE, x: i });
assert('连续超量分享被限速丢弃（账本 = 90 突发额度）', rateRoom.journalMarkers.size === 90, String(rateRoom.journalMarkers.size));

// ── 七、落盘往返与旧档兼容 ──────────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b34-journal-'));
try {
  const saved = new Room('t-journal-store');
  saved.seed = 424242; // 快照校验要求 seed 为整数（真实房间建房时即固定）
  const saver = join(saved, 7, 'Saver');
  saved.onJournalMarker(saver, { ...BASE });
  saved.onJournalMarker(saver, { ...BASE, x: 30, label: '矿洞', color: '#00ff00' });
  saveRoom(saved, dir);

  const file = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
  const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  assert('快照含 journalMarkers 数组', Array.isArray(raw.journalMarkers) && raw.journalMarkers.length === 2);
  assert('快照记录 nextJournalMarkerId', raw.nextJournalMarkerId === 3, String(raw.nextJournalMarkerId));
  assert('落盘条目带权威归属（不含客户端伪造字段）',
    raw.journalMarkers.every((m) => /^j-\d+$/.test(m.id) && m.ownerId === 7 && m.owner === 'Saver'));

  const loaded = loadRooms(dir);
  assert('loadRooms 读回快照', loaded.length === 1);
  const restored = new Room('t-journal-store');
  restored.restore(loaded[0]);
  assert('restore 后账本条数一致', restored.journalMarkers.size === 2);
  assert('restore 保留 id 与归属',
    [...restored.journalMarkers.values()].every((m) => /^j-\d+$/.test(m.id) && m.ownerId === 7 && m.owner === 'Saver'));
  const nextPlayer = join(restored, 8, 'Next');
  restored.onJournalMarker(nextPlayer, { ...BASE, x: 90, label: '新点' });
  const ids = [...restored.journalMarkers.values()].map((m) => m.id);
  assert('服务端重启后继续分享不撞 id', restored.journalMarkers.size === 3 && new Set(ids).size === 3, ids.join(','));

  const legacy = new Room('t-journal-legacy');
  legacy.restore({ seed: 1, dimensionBlocks: {} });
  assert('旧快照缺 journalMarkers 回落空表不崩', legacy.journalMarkers.size === 0);
  const badShape = new Room('t-journal-badshape');
  badShape.restore({ seed: 1, dimensionBlocks: {}, journalMarkers: 'oops' });
  assert('journalMarkers 非数组时跳过不崩', badShape.journalMarkers.size === 0);

  const dense = new Room('t-journal-dirty');
  dense.restore({
    seed: 1, dimensionBlocks: {}, nextJournalMarkerId: 11,
    journalMarkers: [
      { id: 'bad!', dim: 'overworld', x: 1, y: 2, z: 3, label: '非法 id' },
      { id: 'j-9', dim: 'nowhere', x: 1, y: 2, z: 3, label: '非法维度' },
      { id: 'j-10', dim: 'overworld', x: 1, y: 2, z: 3, label: '合法项', ownerId: 5, owner: 'Old' },
    ],
  });
  assert('坏项跳过、合法项保留', dense.journalMarkers.size === 1 && dense.journalMarkers.has('j-10'));
  assert('恢复后 nextJournalMarkerId 不回退', dense.nextJournalMarkerId >= 11);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 八、快照校验拦截非数组 journalMarkers（loadRooms 走 corrupt 流程的依据）──
const badSnapshot = roomSnapshot(new Room('t-journal-shape'));
assert('roomSnapshot 恒输出数组（空账本也不缺字段）',
  Array.isArray(badSnapshot.journalMarkers) && badSnapshot.journalMarkers.length === 0);

finish();
