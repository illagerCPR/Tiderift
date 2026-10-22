// test-waymark.mjs -- B34-B 天域旧航路航标服务端回归（纯 node：Room 直接实例化，不依赖服务器进程）
// 覆盖：键/阶段清洗 / 严格顺序与一次性语义 / 身份与维度门控 / 账本上限 / 提交限速 / 落盘往返 / 旧档兼容
// 用法：node server/test-waymark.mjs（跑批时由 run-all-tests.sh 在起服阶段调用）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Room, sanitizeWaymarkKey, cleanWaymarkStage } from './room.js';
import { roomSnapshot, saveRoom, loadRooms } from './store.js';
import { MSG } from './protocol.js';
import { assert, finish } from './test-lib.mjs';

function fakeWs() {
  return { readyState: 1, bufferedAmount: 0, sent: [], send(buf) { this.sent.push(JSON.parse(buf)); } };
}
function fakePlayer(id, name, dim = 'aether') {
  return { id, name, dim, ws: fakeWs(), pos: { x: 0, y: 64, z: 0 } };
}
function join(room, id, name, dim = 'aether') {
  const p = fakePlayer(id, name, dim);
  room.players.set(p.id, p);
  return p;
}
const sentOfType = (p, type) => p.ws.sent.filter((m) => m.t === type);
const KEY = '224,-448';

// ── 一、键与阶段清洗：客户端字段一律不可信 ──────────────────────────────
assert('合法锚点键通过', sanitizeWaymarkKey(KEY) === KEY);
assert('负号与前导零规范化', sanitizeWaymarkKey('-007,16') === '-7,16', sanitizeWaymarkKey('-007,16'));
assert('缺逗号 / 非整数 / 科学计数法一律拒绝',
  sanitizeWaymarkKey('12') === null && sanitizeWaymarkKey('1.5,2') === null && sanitizeWaymarkKey('1e3,2') === null);
assert('非字符串键拒绝', sanitizeWaymarkKey(12) === null && sanitizeWaymarkKey(null) === null && sanitizeWaymarkKey(['1,2']) === null);
assert('坐标越界拒绝（|v| > 30000000）', sanitizeWaymarkKey('30000001,0') === null);
assert('阶段只认 1..3', cleanWaymarkStage(1) === 1 && cleanWaymarkStage(3) === 3);
assert('阶段 0 / 4 / -1 / 非数拒绝',
  cleanWaymarkStage(0) === 0 && cleanWaymarkStage(4) === 0 && cleanWaymarkStage(-1) === 0 && cleanWaymarkStage('x') === 0);

// ── 二、严格顺序 + 一次性语义 ──────────────────────────────────────────
const room = new Room('t-waymark-order');
const alice = join(room, 1, 'Alice');
const bob = join(room, 2, 'Bob');

room.onWaymarkSubmit(alice, { key: KEY, stage: 2 });
assert('越级提交（先 2 后 1）被拒', room.waymarks.size === 0);
assert('拒绝回包带权威当前阶段', sentOfType(alice, MSG.WAYMARK_DENY).length === 1 && sentOfType(alice, MSG.WAYMARK_DENY)[0].current === 0);

room.onWaymarkSubmit(alice, { key: KEY, stage: 1 });
assert('第一阶段入账', room.waymarks.get(KEY)?.stage === 1);
assert('提交者本人收到广播（多端顺序一致）', sentOfType(alice, MSG.WAYMARK_UPDATE).length === 1);
assert('广播带归属与提交者 id',
  sentOfType(bob, MSG.WAYMARK_UPDATE).length === 1 &&
  sentOfType(bob, MSG.WAYMARK_UPDATE)[0].byId === 1 && sentOfType(bob, MSG.WAYMARK_UPDATE)[0].byName === 'Alice');

room.onWaymarkSubmit(alice, { key: KEY, stage: 1 });
assert('重复提交同一阶段被拒（幂等，不重复奖励）', room.waymarks.get(KEY).stage === 1 && sentOfType(alice, MSG.WAYMARK_DENY).length === 2);

room.onWaymarkSubmit(bob, { key: KEY, stage: 2 });
assert('他人可接续下一阶段（多人分头修复）', room.waymarks.get(KEY).stage === 2);
room.onWaymarkSubmit(alice, { key: KEY, stage: 2 });
assert('并发提交同阶段：先到者胜出，后到者被拒', room.waymarks.get(KEY).stage === 2 && sentOfType(alice, MSG.WAYMARK_DENY).length === 3);

room.onWaymarkSubmit(bob, { key: KEY, stage: 3 });
room.onWaymarkSubmit(bob, { key: KEY, stage: 3 });
assert('第三阶段完成后不再接受重复提交', room.waymarks.get(KEY).stage === 3 && sentOfType(bob, MSG.WAYMARK_DENY).length === 1);

// ── 三、维度与参数门控 ────────────────────────────────────────────────
const outsider = join(room, 3, 'Eve', 'overworld');
outsider._waymarkBucket = null;
room.onWaymarkSubmit(outsider, { key: '1,1', stage: 1 });
assert('非天域玩家提交被拒', room.waymarks.has('1,1') === false && sentOfType(outsider, MSG.WAYMARK_DENY)[0].reason === 'dim');

const badKeyPlayer = join(room, 4, 'Mal');
room.onWaymarkSubmit(badKeyPlayer, { key: 'oops', stage: 1 });
assert('非法键被拒且原因明确', sentOfType(badKeyPlayer, MSG.WAYMARK_DENY)[0].reason === 'key');
room.onWaymarkSubmit(badKeyPlayer, { key: '1,1', stage: 9 });
assert('非法阶段被拒', sentOfType(badKeyPlayer, MSG.WAYMARK_DENY)[1].reason === 'stage');
room.onWaymarkSubmit(badKeyPlayer, null);
assert('空消息不崩服', sentOfType(badKeyPlayer, MSG.WAYMARK_DENY).length === 3);

// ── 四、账本上限与提交限速 ────────────────────────────────────────────
const capped = new Room('t-waymark-cap');
const caper = join(capped, 9, 'Caper');
for (let i = 0; i < 96; i++) {
  if (i % 20 === 0) caper._waymarkBucket = null; // 令牌桶突发 30：分段重置，专测账本上限
  capped.onWaymarkSubmit(caper, { key: `${i * 16},0`, stage: 1 });
}
assert('账本上限 96 座塔', capped.waymarks.size === 96, String(capped.waymarks.size));
caper._waymarkBucket = null; // 前面 96 次已耗尽令牌，重置后再测上限
capped.onWaymarkSubmit(caper, { key: '9999,9999', stage: 1 });
assert('超出上限拒绝新塔', capped.waymarks.size === 96 && sentOfType(caper, MSG.WAYMARK_DENY).pop().reason === 'limit');

const slow = new Room('t-waymark-rate');
const slower = join(slow, 10, 'Slow');
for (let i = 0; i < 30; i++) slow.onWaymarkSubmit(slower, { key: '16,16', stage: 3 }); // 阶段错 → 走令牌桶并被拒
const denies = sentOfType(slower, MSG.WAYMARK_DENY);
assert('令牌桶前 30 次按顺序拒绝', denies.length === 30 && denies.every((m) => m.reason === 'order'));
slow.onWaymarkSubmit(slower, { key: '16,16', stage: 3 });
assert('第 31 次触发限速', sentOfType(slower, MSG.WAYMARK_DENY).pop().reason === 'rate');

// ── 五、落盘往返 ──────────────────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiderift-waymark-'));
try {
  const saved = new Room('t-waymark-store');
  saved.seed = 424242; // 快照校验要求 seed 为整数（真实房间建房时即固定）
  const saver = join(saved, 7, 'Saver');
  saved.onWaymarkSubmit(saver, { key: KEY, stage: 1 });
  saved.onWaymarkSubmit(saver, { key: KEY, stage: 2 });
  saveRoom(saved, dir);

  const file = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
  const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  assert('快照含 waymarks 数组', Array.isArray(raw.waymarks) && raw.waymarks.length === 1);
  assert('快照条目为 [键, {stage, byName}]',
    raw.waymarks[0][0] === KEY && raw.waymarks[0][1].stage === 2 && raw.waymarks[0][1].byName === 'Saver');

  const loaded = loadRooms(dir);
  assert('loadRooms 读回快照', loaded.length === 1);
  const restored = new Room('t-waymark-store');
  restored.restore(loaded[0]);
  assert('restore 后进度一致', restored.waymarks.get(KEY)?.stage === 2);
  const nextPlayer = join(restored, 8, 'Next');
  restored.onWaymarkSubmit(nextPlayer, { key: KEY, stage: 3 });
  assert('服务端重启后可继续下一阶段', restored.waymarks.get(KEY).stage === 3);

  const legacy = new Room('t-waymark-legacy');
  legacy.restore({ seed: 1, dimensionBlocks: {} });
  assert('旧快照缺 waymarks 回落空表不崩', legacy.waymarks.size === 0);
  const badShape = new Room('t-waymark-badshape');
  badShape.restore({ seed: 1, dimensionBlocks: {}, waymarks: 'oops' });
  assert('waymarks 非数组时跳过不崩', badShape.waymarks.size === 0);
  const dirty = new Room('t-waymark-dirty');
  dirty.restore({
    seed: 1, dimensionBlocks: {},
    waymarks: [
      ['bad-key', { stage: 1 }],
      ['1,2', { stage: 9 }],
      ['3,4', { stage: 2, byName: 'Old' }],
    ],
  });
  assert('坏项跳过、合法项保留', dirty.waymarks.size === 1 && dirty.waymarks.get('3,4').stage === 2);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 六、不完整房间对象鲁棒（单测/备份导出路径只给账本字段子集）──────────
const partial = roomSnapshot({
  name: 't-waymark-partial', seed: 1,
  dimensionBlocks: new Map(), dimensionContainers: new Map(), drops: new Map(), // 只给账本字段子集，不提供 waymarks
});
assert('roomSnapshot 对缺账本字段的对象不抛错', partial.waymarks !== undefined);
assert('roomSnapshot 恒输出数组（空账本也不缺字段）', Array.isArray(partial.waymarks) && partial.waymarks.length === 0);

finish();
