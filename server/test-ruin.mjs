// test-ruin.mjs -- B35 D 可动手解开的遗迹：房间权威账本回归（纯 node：Room 直接实例化，不依赖服务器进程）
// 覆盖：消息常量 wire contract / 键与维度校验 / 上报入账与幂等 / 限速桶 / 领取去重与越权拒绝 /
//       账本上限 / op 重置（单处与全房）/ 快照往返 / 旧快照缺字段回落 / 坏项跳过 / 限速档接入
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Room, sanitizeRuinKey } from './room.js';
import { roomSnapshot, saveRoom, loadRooms, isRoomSnapshot } from './store.js';
import { MSG } from './protocol.js';
import { tierOf, createConnectionLimiters } from './ratelimit.js';
import { sanitizeRateLimits } from './config.js';
import { assert, finish } from './test-lib.mjs';

function fakeWs() {
  return { readyState: 1, bufferedAmount: 0, sent: [], send(buf) { this.sent.push(JSON.parse(buf)); } };
}
function fakePlayer(id, name, dim = 'overworld') {
  return { id, name, dim, ws: fakeWs(), pos: { x: 0, y: 64, z: 0 } };
}
function join(room, id, name, dim = 'overworld') {
  const p = fakePlayer(id, name, dim);
  room.players.set(p.id, p);
  return p;
}
const sentOfType = (p, type) => p.ws.sent.filter((m) => m.t === type);
const KEY = 'overworld|tide_sluice|1008|-2032';
const EMBER_KEY = 'nether|ember_circuit|-16|32';

// ── 一、消息常量保持客户端 wire contract ─────────────────────────────────
assert('遗迹消息常量与客户端一致',
  MSG.RUIN_STATE === 'ruin_state' && MSG.RUIN_UPDATE === 'ruin_update' &&
  MSG.RUIN_CLAIM === 'ruin_claim' && MSG.RUIN_CLAIMED === 'ruin_claimed' && MSG.RUIN_DENY === 'ruin_deny');

// ── 二、键校验：客户端字段一律不可信 ────────────────────────────────────
assert('合法键原样通过', sanitizeRuinKey(KEY) === KEY);
assert('未知维度拒绝', sanitizeRuinKey('void|tide_sluice|0|0') === '');
assert('未知机关类型拒绝', sanitizeRuinKey('overworld|village|0|0') === '');
assert('类型与维度不匹配拒绝（烬火回路不在主世界）', sanitizeRuinKey('overworld|ember_circuit|0|0') === '');
assert('坐标越界拒绝', sanitizeRuinKey('overworld|tide_sluice|30000001|0') === '');
assert('非字符串/空/缺段拒绝',
  sanitizeRuinKey(null) === '' && sanitizeRuinKey(12) === '' && sanitizeRuinKey('overworld|tide_sluice|1') === '');

// ── 三、上报入账与幂等 ──────────────────────────────────────────────────
const room = new Room('t-ruin-state');
const alice = join(room, 1, 'Alice');
const bob = join(room, 2, 'Bob');

room.onRuinState(alice, { key: KEY });
assert('上报后入账', room.ruins.get(KEY)?.state === 'solved');
assert('入账广播发全房（含提交者本人）',
  sentOfType(alice, MSG.RUIN_UPDATE).length === 1 && sentOfType(bob, MSG.RUIN_UPDATE).length === 1);
assert('广播带归属昵称与 id',
  sentOfType(bob, MSG.RUIN_UPDATE)[0].byId === 1 && sentOfType(bob, MSG.RUIN_UPDATE)[0].byName === 'Alice');
const atBefore = room.ruins.get(KEY).at;
room.onRuinState(alice, { key: KEY });
room.onRuinState(bob, { key: KEY });
assert('重复/他人重复上报幂等：不重复广播、不改写',
  room.ruins.size === 1 && sentOfType(alice, MSG.RUIN_UPDATE).length === 1 && room.ruins.get(KEY).at === atBefore);

// ── 四、维度与键门控 ────────────────────────────────────────────────────
room.onRuinState(bob, { key: EMBER_KEY });
assert('维度不符拒绝（主世界玩家上报下界机关）',
  !room.ruins.has(EMBER_KEY) && sentOfType(bob, MSG.RUIN_DENY).at(-1).reason === 'dim');
const netherPlayer = join(room, 3, 'Nether', 'nether');
room.onRuinState(netherPlayer, { key: EMBER_KEY });
assert('同维度上报通过', room.ruins.get(EMBER_KEY)?.byName === 'Nether');
room.onRuinState(netherPlayer, { key: 'oops' });
assert('非法键被拒且原因明确', sentOfType(netherPlayer, MSG.RUIN_DENY).at(-1).reason === 'key');
room.onRuinState(netherPlayer, null);
assert('空消息不崩服（按非法键拒绝）',
  sentOfType(netherPlayer, MSG.RUIN_DENY).length === 2 && sentOfType(netherPlayer, MSG.RUIN_DENY).at(-1).reason === 'key');

// ── 五、领取：单向去重 + 未解开拒绝 ─────────────────────────────────────
const claimKey = 'overworld|tide_sluice|2000|2000';
room.onRuinClaim(alice, { key: claimKey });
assert('未解开的机关不能领取', sentOfType(alice, MSG.RUIN_DENY).at(-1).reason === 'locked' && !room.ruinClaims.has(claimKey));
room.onRuinState(alice, { key: claimKey });
room.onRuinClaim(alice, { key: claimKey });
const claimed = sentOfType(alice, MSG.RUIN_CLAIMED);
assert('领取成功只回执领取者本人', claimed.length === 1 && sentOfType(bob, MSG.RUIN_CLAIMED).length === 0);
assert('回执带 key/领取者与时间', claimed[0].key === claimKey && claimed[0].byId === 1 && claimed[0].byName === 'Alice' && claimed[0].at > 0);
room.onRuinClaim(alice, { key: claimKey });
assert('同一人重复领取被拒（claimed）', sentOfType(alice, MSG.RUIN_DENY).at(-1).reason === 'claimed');
room.onRuinClaim(bob, { key: claimKey });
assert('两人同时解开只有一人拿到奖励（第二人 claimed）',
  sentOfType(bob, MSG.RUIN_CLAIMED).length === 0 && sentOfType(bob, MSG.RUIN_DENY).at(-1).reason === 'claimed');
room.onRuinClaim(bob, { key: EMBER_KEY });
assert('跨维领取被拒', sentOfType(bob, MSG.RUIN_DENY).at(-1).reason === 'dim');

// ── 六、账本上限与写入限速 ──────────────────────────────────────────────
const capped = new Room('t-ruin-cap');
const caper = join(capped, 9, 'Caper');
for (let i = 0; i < 96; i++) {
  if (i % 20 === 0) caper._ruinBucket = null; // 令牌桶突发 20：分段重置，专测账本上限
  capped.onRuinState(caper, { key: `overworld|tide_sluice|${i * 16}|0` });
}
assert('账本上限 96 处机关', capped.ruins.size === 96, String(capped.ruins.size));
caper._ruinBucket = null;
capped.onRuinState(caper, { key: 'overworld|tide_sluice|9999|9999' });
assert('超出上限拒绝新条目', capped.ruins.size === 96 && sentOfType(caper, MSG.RUIN_DENY).at(-1).reason === 'limit');

const slow = new Room('t-ruin-rate');
const slower = join(slow, 10, 'Slow');
for (let i = 0; i < 20; i++) slow.onRuinState(slower, { key: `overworld|tide_sluice|${i}|0` });
assert('令牌桶突发 20 次放行', slow.ruins.size === 20);
slow.onRuinState(slower, { key: 'overworld|tide_sluice|777|0' });
assert('第 21 次写入触发限速', sentOfType(slower, MSG.RUIN_DENY).at(-1).reason === 'rate' && !slow.ruins.has('overworld|tide_sluice|777|0'));

// ── 七、op 重置：单处与全房 ────────────────────────────────────────────
const opRoom = new Room('t-ruin-reset');
opRoom.config = { roomOps: { 't-ruin-reset': ['Op'] } };
const normal = join(opRoom, 11, 'Normal');
const op = join(opRoom, 12, 'Op');
opRoom.onRuinState(normal, { key: 'overworld|tide_sluice|64|0' });
opRoom.onRuinState(normal, { key: 'overworld|tide_sluice|128|0' });
opRoom.onRuinClaim(normal, { key: 'overworld|tide_sluice|64|0' });
assert('非 op 重置被拒', opRoom.resetRuins(normal).ok === false && opRoom.ruins.size === 2);
const one = opRoom.resetRuins(op, 'overworld|tide_sluice|64|0');
assert('op 可重置单处（连带清领取记录）',
  one.ok === true && one.removed === 1 && !opRoom.ruins.has('overworld|tide_sluice|64|0') && !opRoom.ruinClaims.has('overworld|tide_sluice|64|0'));
assert('重置广播全量账本', sentOfType(normal, MSG.RUIN_STATE).at(-1).ruins && Object.keys(sentOfType(normal, MSG.RUIN_STATE).at(-1).ruins).length === 1);
const all = opRoom.resetRuins(op);
assert('op 可重置全房', all.ok === true && all.removed === 1 && opRoom.ruins.size === 0 && opRoom.ruinClaims.size === 0);
opRoom.onRuinState(normal, { key: 'overworld|tide_sluice|64|0' });
opRoom.resetRuins(op, 'garbage');
assert('非法键重置被拒且不动账本', opRoom.ruins.size === 1);

// ── 八、快照往返与旧档回落 ─────────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiderift-ruin-'));
try {
  const saved = new Room('t-ruin-store');
  saved.seed = 424242; // 快照校验要求 seed 为整数
  const saver = join(saved, 7, 'Saver');
  saved.onRuinState(saver, { key: KEY });
  saved.onRuinClaim(saver, { key: KEY });
  saveRoom(saved, dir);

  const file = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
  const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  assert('快照含 ruins 对象', raw.ruins && typeof raw.ruins === 'object' && raw.ruins[KEY]?.state === 'solved');
  assert('快照含 ruinClaims 数组 [key, byId, byName, at]',
    Array.isArray(raw.ruinClaims) && raw.ruinClaims[0][0] === KEY && raw.ruinClaims[0][1] === 7 && raw.ruinClaims[0][2] === 'Saver');
  assert('快照形状校验通过（isRoomSnapshot 语义）', isRoomSnapshot(raw) === true);

  const loaded = loadRooms(dir);
  assert('loadRooms 读回快照', loaded.length === 1);
  const restored = new Room('t-ruin-store');
  restored.restore(loaded[0]);
  assert('restore 后账本与领取记录一致',
    restored.ruins.get(KEY)?.byName === 'Saver' && restored.ruinClaims.get(KEY)?.byId === 7);
  restored.onRuinState(join(restored, 8, 'Next'), { key: KEY });
  assert('服务端重启后重复上报仍幂等', restored.ruins.size === 1);

  const legacy = new Room('t-ruin-legacy');
  legacy.restore({ seed: 1, dimensionBlocks: {} });
  assert('旧快照缺 ruins 字段回落空表不崩', legacy.ruins.size === 0 && legacy.ruinClaims.size === 0);
  const badShape = new Room('t-ruin-badshape');
  badShape.restore({ seed: 1, dimensionBlocks: {}, ruins: 'oops', ruinClaims: 'oops' });
  assert('ruins/ruinClaims 形状非法时跳过不崩', badShape.ruins.size === 0 && badShape.ruinClaims.size === 0);
  const dirty = new Room('t-ruin-dirty');
  dirty.restore({
    seed: 1, dimensionBlocks: {},
    ruins: {
      'bad-key': { state: 'solved' },
      'overworld|ember_circuit|0|0': { state: 'solved' }, // 类型与维度不匹配
      [KEY]: { state: 'solved', byName: 'Old', at: 11 },
    },
    ruinClaims: [
      ['bad-key', 5, 'X', 1],
      ['overworld|tide_sluice|99999|0', 5, 'X', 1], // 无主机关：领取记录不恢复
      [KEY, 'not-an-id', 'X', 1],
      [KEY, 5, 'Old', 11],
    ],
  });
  assert('坏项跳过、合法项保留', dirty.ruins.size === 1 && dirty.ruins.get(KEY).byName === 'Old');
  assert('无主/非法领取记录不恢复', dirty.ruinClaims.size === 1 && dirty.ruinClaims.get(KEY).byId === 5);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 九、全量 payload 与不完整房间对象鲁棒 ──────────────────────────────
{
  const payload = room.ruinsPayload();
  assert('ruinsPayload 形如 { ruins: { key: {state, byName, at} } }',
    payload.ruins[KEY]?.state === 'solved' && payload.ruins[KEY]?.byName === 'Alice' && typeof payload.ruins[KEY]?.at === 'number');
  const partial = roomSnapshot({
    name: 't-ruin-partial', seed: 1,
    dimensionBlocks: new Map(), dimensionContainers: new Map(), drops: new Map(), // 只给账本字段子集
  });
  assert('roomSnapshot 对缺账本字段的对象不抛错', partial.ruins !== undefined && Array.isArray(partial.ruinClaims));
  assert('roomSnapshot 恒输出缺省空值', Object.keys(partial.ruins).length === 0 && partial.ruinClaims.length === 0);
}

// ── 十、限速档接入（tierOf + 连接限速器组）──────────────────────────────
assert('RUIN_STATE/RUIN_CLAIM 归入 ruin 档',
  tierOf(MSG.RUIN_STATE, MSG) === 'ruin' && tierOf(MSG.RUIN_CLAIM, MSG) === 'ruin');
{
  const limiters = createConnectionLimiters({ rateLimits: {} });
  assert('连接限速器组含 ruin 档（config 未收录时走代码兜底）', !!limiters.ruin && typeof limiters.ruin.allow === 'function');
  // 兜底 120/min：前 120 次放行，第 121 次拒绝（同一时刻结算，不补令牌）
  let allowed = 0;
  const now = Date.now();
  for (let i = 0; i < 130; i++) if (limiters.ruin.allow(now)) allowed++;
  assert('ruin 兜底额度为 120 次/分钟', allowed === 120, String(allowed));
  const hot = createConnectionLimiters({ rateLimits: { ruin: 5 } });
  let hotAllowed = 0;
  for (let i = 0; i < 10; i++) if (hot.ruin.allow(now)) hotAllowed++;
  assert('config 收紧后活读新额度', hotAllowed === 5, String(hotAllowed));
  // server/config.js 必须收录该档，否则管理面板改不动（只能吃 ratelimit.js 的兜底值）
  const defaults = sanitizeRateLimits(null);
  assert('限速默认值收录 ruin 档', defaults.ruin === 120, String(defaults.ruin));
  assert('sanitizeRateLimits 保留 ruin（管理面板可改）',
    sanitizeRateLimits({ ruin: 15 }).ruin === 15 && sanitizeRateLimits({ ruin: -1 }, { ruin: 120 }).ruin === 120);
}

finish();
