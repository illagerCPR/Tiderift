// test-race.mjs -- B34-C 御风赛道与成绩的服务端回归（纯 node：Room 直接实例化，不依赖服务器进程）
// 覆盖：id 清洗 / 保存与修订 / 归属与 operator 权限 / 定义校验 / 数量与限速 / 成绩只留更快 /
//       删除连带清成绩 / 落盘往返 / 旧档与坏档兼容
// 用法：node server/test-race.mjs（跑批时由 run-all-tests.sh 在起服阶段调用）
import { Room, cleanRaceId } from './room.js';
import { roomSnapshot } from './store.js';
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
const POINTS = [{ x: 0, y: 64, z: 0 }, { x: 100, y: 64, z: 0 }, { x: 100, y: 64, z: 100 }];
const msg = (over = {}) => ({ id: 'race01', name: '测试赛道', dim: 'aether', mode: 'glide', points: POINTS, ...over });
function freshBucket(...players) { for (const p of players) p._raceBucket = { tokens: 20, last: Date.now() }; }

// ── 一、id 清洗 ──────────────────────────────────────────────────────
assert('合法赛道 id 通过', cleanRaceId('race01') === 'race01');
assert('非字符串 / 大写 / 过短 / 过长一律拒绝',
  cleanRaceId(123) === '' && cleanRaceId('RACE01') === '' && cleanRaceId('ab') === '' && cleanRaceId('a'.repeat(21)) === '');
assert('带特殊字符的 id 拒绝', cleanRaceId('race-01') === '' && cleanRaceId('race 01') === '');

// ── 二、保存：服务端决定维度/归属/修订号 ──────────────────────────────
const room = new Room('t-race-save');
const alice = join(room, 1, 'Alice');
const bob = join(room, 2, 'Bob');

room.onRaceSave(alice, msg({ dim: 'overworld' }));
assert('维度与服务器记录不符直接拒绝', sentOfType(alice, MSG.RACE_DENY)[0]?.reason === 'dim');

room.onRaceSave(alice, msg());
const saved = room.races.get('race01');
assert('保存后入账', !!saved);
assert('首版修订号为 1', saved.revision === 1, String(saved.revision));
assert('归属为提交者', saved.byId === 1, String(saved.byId));
assert('维度取服务器记录', saved.dim === 'aether');
assert('点位原样保留', JSON.stringify(saved.points) === JSON.stringify(POINTS));
assert('保存广播到全房间（含本人）',
  sentOfType(alice, MSG.RACE_UPDATE).length === 1 && sentOfType(bob, MSG.RACE_UPDATE).length === 1);

// 编辑：修订号递增，旧修订成绩作废
room.raceRecords.set('race01#1#1', { ms: 30000, byName: 'Alice' });
freshBucket(alice);
room.onRaceSave(alice, msg({ name: '改名赛道' }));
assert('再次保存递增修订号', room.races.get('race01').revision === 2, String(room.races.get('race01').revision));
assert('编辑后旧修订成绩被清除', room.raceRecords.size === 0);
assert('编辑后名称更新', room.races.get('race01').name === '改名赛道');

// 他人不可改；房间 operator 可以
freshBucket(bob);
room.onRaceSave(bob, msg());
assert('非创建者保存被拒（owner）', sentOfType(bob, MSG.RACE_DENY).some((m) => m.reason === 'owner'));
room.config = { roomOps: { 't-race-save': ['Bob'] } };
freshBucket(bob);
room.onRaceSave(bob, msg({ name: '管理员改' }));
assert('房间 operator 可编辑他人赛道', room.races.get('race01').name === '管理员改');
assert('operator 编辑不改归属', room.races.get('race01').byId === 1);

// ── 三、定义校验：任一不合规整条拒绝 ──────────────────────────────────
const bad = new Room('t-race-bad');
const carol = join(bad, 3, 'Carol');
const expectDeny = (label, over, reason = 'track') => {
  freshBucket(carol);
  bad.races.clear();
  bad.onRaceSave(carol, msg(over));
  const denies = sentOfType(carol, MSG.RACE_DENY);
  assert(label, bad.races.size === 0 && denies.length > 0 && denies[denies.length - 1].reason === reason);
};
expectDeny('少于 3 个点位拒绝', { points: POINTS.slice(0, 2) });
expectDeny('相邻重复点拒绝', { points: [POINTS[0], POINTS[0], POINTS[2]] });
expectDeny('单段超长拒绝', { points: [{ x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: 513 }, { x: 0, y: 64, z: 600 }] });
expectDeny('空名拒绝', { name: '   ' });
expectDeny('坐标越界拒绝', { points: [{ x: 40000000, y: 64, z: 0 }, POINTS[1], POINTS[2]] });
expectDeny('高度越界拒绝', { points: [{ x: 0, y: 300, z: 0 }, POINTS[1], POINTS[2]] });
expectDeny('非整数坐标拒绝', { points: [{ x: 0.5, y: 64, z: 0 }, POINTS[1], POINTS[2]] });
expectDeny('非法 id 拒绝', { id: 'BAD' }, 'id');
expectDeny('超过 12 个点位拒绝', { points: Array.from({ length: 13 }, (_, i) => ({ x: i * 10, y: 64, z: 0 })) });
assert('非法模式回落为御风', (() => {
  freshBucket(carol);
  bad.races.clear();
  bad.onRaceSave(carol, msg({ id: 'race02', mode: 'jetpack' }));
  return bad.races.get('race02')?.mode === 'glide';
})());

// ── 四、数量上限与写入限速 ───────────────────────────────────────────
const limitRoom = new Room('t-race-limit');
const dave = join(limitRoom, 4, 'Dave');
for (let i = 0; i < 24; i++) {
  dave._raceBucket = { tokens: 20, last: Date.now() };
  limitRoom.onRaceSave(dave, msg({ id: 'r' + String(i).padStart(6, '0'), name: '赛道' + i }));
}
assert('24 条赛道全部入账', limitRoom.races.size === 24, String(limitRoom.races.size));
dave._raceBucket = { tokens: 20, last: Date.now() };
limitRoom.onRaceSave(dave, msg({ id: 'rover01' }));
assert('超出数量上限拒绝', limitRoom.races.size === 24
  && sentOfType(dave, MSG.RACE_DENY).some((m) => m.reason === 'limit'));

const rateRoom = new Room('t-race-rate');
const erin = join(rateRoom, 5, 'Erin');
erin._raceBucket = { tokens: 2, last: Date.now() };
rateRoom.onRaceSave(erin, msg({ id: 'race10' }));
rateRoom.onRaceSave(erin, msg({ id: 'race11' }));
rateRoom.onRaceSave(erin, msg({ id: 'race12' }));
assert('令牌用尽后拒绝（rate）', rateRoom.races.size === 2
  && sentOfType(erin, MSG.RACE_DENY).some((m) => m.reason === 'rate'));

// ── 五、成绩：每人每条赛道每个修订只留更快 ────────────────────────────
const scoreRoom = new Room('t-race-score');
const frank = join(scoreRoom, 6, 'Frank');
const grace = join(scoreRoom, 7, 'Grace');
freshBucket(frank, grace);
scoreRoom.onRaceSave(frank, msg({ id: 'race20' }));
freshBucket(frank, grace);

scoreRoom.onRaceRecord(frank, { id: 'race20', revision: 1, ms: 42000 });
assert('首次成绩入账', scoreRoom.raceRecords.get('race20#1#6')?.ms === 42000);
assert('成绩广播到全房间', sentOfType(grace, MSG.RACE_RECORD_UPDATE).length === 1);
const beforeBroadcasts = sentOfType(grace, MSG.RACE_RECORD_UPDATE).length;
freshBucket(frank);
scoreRoom.onRaceRecord(frank, { id: 'race20', revision: 1, ms: 50000 });
assert('更慢的成绩不覆盖也不广播',
  scoreRoom.raceRecords.get('race20#1#6').ms === 42000 && sentOfType(grace, MSG.RACE_RECORD_UPDATE).length === beforeBroadcasts);
freshBucket(frank);
scoreRoom.onRaceRecord(frank, { id: 'race20', revision: 1, ms: 39000 });
assert('更快的成绩覆盖', scoreRoom.raceRecords.get('race20#1#6').ms === 39000);
freshBucket(grace);
scoreRoom.onRaceRecord(grace, { id: 'race20', revision: 1, ms: 35000 });
assert('两名玩家各自留各自的最佳', scoreRoom.raceRecords.get('race20#1#7')?.ms === 35000
  && scoreRoom.raceRecords.get('race20#1#6')?.ms === 39000);

freshBucket(frank);
scoreRoom.onRaceRecord(frank, { id: 'race20', revision: 9, ms: 10000 });
assert('旧/错修订号的成绩拒绝', scoreRoom.raceRecords.get('race20#1#6').ms === 39000
  && sentOfType(frank, MSG.RACE_DENY).some((m) => m.reason === 'revision'));
freshBucket(frank);
scoreRoom.onRaceRecord(frank, { id: 'race20', revision: 1, ms: 10 });
assert('越界成绩拒绝（<1s）', sentOfType(frank, MSG.RACE_DENY).some((m) => m.reason === 'time'));
freshBucket(frank);
scoreRoom.onRaceRecord(frank, { id: 'nosuch', revision: 1, ms: 30000 });
assert('无主赛道成绩拒绝（track）', sentOfType(frank, MSG.RACE_DENY).some((m) => m.reason === 'track'));
const otherDim = join(scoreRoom, 8, 'Heidi', 'overworld');
freshBucket(otherDim);
scoreRoom.onRaceRecord(otherDim, { id: 'race20', revision: 1, ms: 30000 });
assert('异维度上报拒绝（dim）', sentOfType(otherDim, MSG.RACE_DENY).some((m) => m.reason === 'dim'));

// ── 六、删除：权限 + 连带清成绩 ──────────────────────────────────────
const delRoom = new Room('t-race-del');
const ivan = join(delRoom, 9, 'Ivan');
const judy = join(delRoom, 10, 'Judy');
freshBucket(ivan, judy);
delRoom.onRaceSave(ivan, msg({ id: 'race30' }));
freshBucket(ivan);
delRoom.onRaceRecord(ivan, { id: 'race30', revision: 1, ms: 25000 });
delRoom.onRaceDelete(judy, { id: 'race30' });
assert('非创建者不能删除', delRoom.races.has('race30'));
assert('越权删除回 owner 拒绝', sentOfType(judy, MSG.RACE_DENY).some((m) => m.reason === 'owner'));
delRoom.onRaceDelete(ivan, { id: 'race30' });
assert('创建者删除成功', !delRoom.races.has('race30'));
assert('删除广播到全房间', sentOfType(judy, MSG.RACE_REMOVED).some((m) => m.id === 'race30'));
assert('删除连带清掉成绩', delRoom.raceRecords.size === 0);

// ── 七、落盘往返与旧档兼容 ───────────────────────────────────────────
const snapRoom = new Room('t-race-store');
const kim = join(snapRoom, 11, 'Kim');
freshBucket(kim);
snapRoom.onRaceSave(kim, msg({ id: 'race40', points: POINTS }));
freshBucket(kim);
snapRoom.onRaceRecord(kim, { id: 'race40', revision: 1, ms: 21000 });
const snap = roomSnapshot(snapRoom);
assert('快照含赛道数组', Array.isArray(snap.races) && snap.races.length === 1);
assert('快照含成绩数组', Array.isArray(snap.raceRecords) && snap.raceRecords.length === 1);
const restored = new Room('t-race-store');
restored.restore(JSON.parse(JSON.stringify(snap)));
assert('restore 后赛道一致', restored.races.get('race40')?.points.length === 3);
assert('restore 后成绩一致', restored.raceRecords.get('race40#1#11')?.ms === 21000);
const nextPlayer = join(restored, 12, 'Next');
freshBucket(nextPlayer);
restored.onRaceRecord(nextPlayer, { id: 'race40', revision: 1, ms: 19000 });
assert('服务端重启后仍可上报成绩', restored.raceRecords.get('race40#1#12')?.ms === 19000);

const legacy = new Room('t-race-legacy');
legacy.restore({ seed: 1, dimensionBlocks: {} });
assert('旧快照无 races 字段回落空表', legacy.races.size === 0 && legacy.raceRecords.size === 0);
const badShape = new Room('t-race-bad-shape');
badShape.restore({ seed: 1, dimensionBlocks: {}, races: 'oops', raceRecords: { a: 1 } });
assert('坏形状不崩服且回落空表', badShape.races.size === 0 && badShape.raceRecords.size === 0);
const dirty = new Room('t-race-dirty');
dirty.restore({
  seed: 1, dimensionBlocks: {},
  races: [null, { id: 'nope' }, { id: 'race50', name: '好赛道', dim: 'aether', points: POINTS, revision: 1, byId: 'x' }],
  raceRecords: [['race50#1#x', 20000, 'X'], ['race50#9#y', 20000, 'Y'], ['bad-key', 20000, 'Z'], ['race50#1#z', 10, 'Z']],
});
assert('坏赛道项跳过、好项保留', dirty.races.size === 1 && dirty.races.get('race50')?.name === '好赛道');
assert('坏成绩项与无主赛道的成绩跳过', dirty.raceRecords.size === 1 && dirty.raceRecords.has('race50#1#x'));

const partial = roomSnapshot({
  name: 't-race-partial', seed: 1,
  dimensionBlocks: new Map(), dimensionContainers: new Map(), drops: new Map(),
});
assert('roomSnapshot 对缺账本字段的对象不抛错', partial.races !== undefined && Array.isArray(partial.races));
assert('roomSnapshot 恒输出空数组', partial.races.length === 0 && partial.raceRecords.length === 0);

finish();
