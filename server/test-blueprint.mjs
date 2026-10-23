// test-blueprint.mjs -- Build 35 E 共享蓝图服务端账本回归
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Room } from './room.js';
import { roomSnapshot, saveRoom, loadRooms } from './store.js';
import { MSG } from './protocol.js';
import { assert, finish } from './test-lib.mjs';

function fakeWs() {
  return { readyState: 1, bufferedAmount: 0, sent: [], send(buf) { this.sent.push(JSON.parse(buf)); } };
}

function fakePlayer(id, name, dim = 'overworld') {
  return { id, name, dim, ws: fakeWs(), pos: { x: 0, y: 64, z: 0 } };
}

function join(room, id, name, dim = 'overworld') {
  const player = fakePlayer(id, name, dim);
  room.players.set(player.id, player);
  return player;
}

const sentOfType = (player, type) => player.ws.sent.filter((message) => message.t === type);
const blueprint = (overrides = {}) => ({
  id: 'blue01', name: '蓝图', dim: 'forged-dim', rev: 99999, byId: 'forged-owner',
  size: { x: 1, y: 1, z: 1 }, palette: [0], data: '0.1', ...overrides,
});
const save = (room, player, value) => room.onBlueprintSave(player, { blueprint: value });
const lastDeny = (player) => sentOfType(player, MSG.BLUEPRINT_DENY).at(-1);

assert('消息常量保持客户端 wire contract',
  MSG.BLUEPRINT_SAVE === 'blueprint_save' && MSG.BLUEPRINT_DELETE === 'blueprint_delete' &&
  MSG.BLUEPRINTS === 'blueprints' && MSG.BLUEPRINT_UPDATE === 'blueprint_update' &&
  MSG.BLUEPRINT_REMOVED === 'blueprint_removed' && MSG.BLUEPRINT_DENY === 'blueprint_deny');

const room = new Room('t-blueprint-ledger');
const alice = join(room, 1, 'Alice');
const bob = join(room, 2, 'Bob');
save(room, alice, blueprint());
const created = room.blueprints.get('blue01');
assert('合法蓝图创建入账且服务端生成权威字段',
  created?.rev === 1 && created.byId === '1' && created.dim === 'overworld' &&
  created.name === '蓝图' && !('byName' in created));
assert('创建忽略客户端 dim/byId/rev', created?.dim === alice.dim && created?.byId === String(alice.id) && created?.rev === 1);
assert('创建广播含提交者且 payload 精确为 blueprint',
  sentOfType(alice, MSG.BLUEPRINT_UPDATE).length === 1 &&
  sentOfType(bob, MSG.BLUEPRINT_UPDATE).length === 1 &&
  sentOfType(bob, MSG.BLUEPRINT_UPDATE)[0].blueprint.id === 'blue01' &&
  Object.keys(sentOfType(bob, MSG.BLUEPRINT_UPDATE)[0]).sort().join(',') === 'blueprint,t');

save(room, alice, blueprint({ name: '蓝图改版', rev: 1, byId: 'other' }));
assert('owner 编辑更新字段并将修订递增', room.blueprints.get('blue01')?.name === '蓝图改版' && room.blueprints.get('blue01')?.rev === 2);
assert('owner 编辑保留原 byId', room.blueprints.get('blue01')?.byId === '1');
save(room, bob, blueprint({ name: '越权改写' }));
assert('非 owner 编辑被拒且不改账本', lastDeny(bob)?.reason === 'owner' && room.blueprints.get('blue01')?.name === '蓝图改版');
room.onBlueprintDelete(bob, { id: 'blue01' });
assert('非 owner 删除被拒且不广播移除', lastDeny(bob)?.reason === 'owner' && sentOfType(bob, MSG.BLUEPRINT_REMOVED).length === 0);

room.config = { roomOps: { 't-blueprint-ledger': ['Op'] } };
const op = join(room, 3, 'Op');
save(room, op, blueprint({ name: '管理员编辑', byId: 'forged', rev: 800 }));
assert('operator 可编辑且保留 owner 与服务器修订',
  room.blueprints.get('blue01')?.name === '管理员编辑' && room.blueprints.get('blue01')?.byId === '1' && room.blueprints.get('blue01')?.rev === 3);
room.onBlueprintDelete(op, { id: 'blue01' });
assert('operator 可删除并向全房间广播 blueprint_removed',
  !room.blueprints.has('blue01') && [alice, bob, op].every((player) => sentOfType(player, MSG.BLUEPRINT_REMOVED).some((message) => message.id === 'blue01')));

const dimRoom = new Room('t-blueprint-dim');
const netherPlayer = join(dimRoom, 4, 'Nether', 'nether');
save(dimRoom, netherPlayer, blueprint({ id: 'blue02', dim: 'end' }));
assert('维度取 player.dim 而忽略客户端维度', dimRoom.blueprints.get('blue02')?.dim === 'nether');
netherPlayer.dim = 'void';
save(dimRoom, netherPlayer, blueprint({ id: 'blue03' }));
assert('不支持的服务端维度拒绝', lastDeny(netherPlayer)?.reason === 'dim' && !dimRoom.blueprints.has('blue03'));

const invalidRoom = new Room('t-blueprint-invalid');
const invalidPlayer = join(invalidRoom, 5, 'Validator');
const expectInvalid = (name, value, reason) => {
  invalidPlayer._blueprintBucket = { tokens: 20, last: Date.now() };
  const before = sentOfType(invalidPlayer, MSG.BLUEPRINT_DENY).length;
  save(invalidRoom, invalidPlayer, value);
  assert(name, !invalidRoom.blueprints.has(value?.id) && sentOfType(invalidPlayer, MSG.BLUEPRINT_DENY).length === before + 1 && lastDeny(invalidPlayer)?.reason === reason);
};
expectInvalid('非法 ID（大小写/字符）拒绝', blueprint({ id: 'Bad!' }), 'id');
expectInvalid('短于 6 位的 ID 拒绝', blueprint({ id: 'abcde' }), 'id');
expectInvalid('长于 20 位的 ID 拒绝', blueprint({ id: 'a'.repeat(21) }), 'id');
expectInvalid('空名称拒绝', blueprint({ id: 'blue02', name: '  ' }), 'name');
expectInvalid('名称超过 24 Unicode 码点拒绝', blueprint({ id: 'blue03', name: '界'.repeat(25) }), 'name');
expectInvalid('名称仅控制字符拒绝', blueprint({ id: 'blue04', name: '\u0000\u0001' }), 'name');
expectInvalid('每轴尺寸超过 32 拒绝', blueprint({ id: 'blue05', size: { x: 33, y: 1, z: 1 } }), 'size');
expectInvalid('尺寸轴小于 1 拒绝', blueprint({ id: 'blue23', size: { x: 0, y: 1, z: 1 } }), 'size');
expectInvalid('尺寸不接受数字字符串', blueprint({ id: 'blue06', size: { x: '1', y: 1, z: 1 } }), 'size');
expectInvalid('palette 不可为空', blueprint({ id: 'blue24', palette: [] }), 'palette');
expectInvalid('palette 必须以 air 0 开始', blueprint({ id: 'blue07', palette: [1] }), 'palette');
expectInvalid('palette 拒绝重复 block ID', blueprint({ id: 'blue08', palette: [0, 1, 1] }), 'palette');
expectInvalid('palette 拒绝非整数或越界 block ID', blueprint({ id: 'blue09', palette: [0, 256] }), 'palette');
expectInvalid('palette 超过 256 项拒绝', blueprint({ id: 'blue10', palette: [0, ...Array.from({ length: 256 }, (_, i) => i + 1)] }), 'palette');
expectInvalid('RLE 格式错误拒绝', blueprint({ id: 'blue11', data: 'oops' }), 'data');
expectInvalid('RLE 尾逗号拒绝', blueprint({ id: 'blue12', data: '0.1,' }), 'data');
expectInvalid('RLE 前导零拒绝', blueprint({ id: 'blue13', data: '00.1' }), 'data');
expectInvalid('RLE 大写 base36 非规范形式拒绝', blueprint({ id: 'blue25', data: '0.A' }), 'data');
expectInvalid('RLE 非规范 run 拒绝', blueprint({ id: 'blue14', size: { x: 2, y: 1, z: 1 }, data: '0.01' }), 'data');
expectInvalid('RLE 索引超出 palette 拒绝', blueprint({ id: 'blue15', data: '1.1' }), 'data');
expectInvalid('RLE run 必须为正数', blueprint({ id: 'blue16', data: '0.0' }), 'data');
expectInvalid('RLE 相邻相同索引必须合并', blueprint({ id: 'blue17', size: { x: 2, y: 1, z: 1 }, data: '0.1,0.1' }), 'data');
expectInvalid('RLE 总 run 小于体积拒绝', blueprint({ id: 'blue18', size: { x: 2, y: 1, z: 1 }, data: '0.1' }), 'data');
expectInvalid('RLE 总 run 大于体积拒绝', blueprint({ id: 'blue19', data: '0.2' }), 'data');
expectInvalid('RLE 非 ASCII 字符拒绝', blueprint({ id: 'blue20', data: '0.一' }), 'data');
const oversizedRle = Array.from({ length: 8192 }, (_, index) => (index % 2) + '.4').join(',');
expectInvalid('规范 run 总量正确但 data 超过 16384 字符拒绝',
  blueprint({ id: 'blue21', size: { x: 32, y: 32, z: 32 }, palette: [0, 1], data: oversizedRle }), 'data');

const maxRun = (32 * 32 * 32).toString(36);
const maxIdAndPalette = blueprint({
  id: 'a'.repeat(20), name: '界'.repeat(24), palette: Array.from({ length: 256 }, (_, index) => index),
});
invalidPlayer._blueprintBucket = { tokens: 20, last: Date.now() };
save(invalidRoom, invalidPlayer, maxIdAndPalette);
assert('ID/Unicode 名称/palette 的 20/24/256 项上限值可接受',
  invalidRoom.blueprints.get('a'.repeat(20))?.name === '界'.repeat(24) && invalidRoom.blueprints.get('a'.repeat(20))?.palette.length === 256);
invalidPlayer._blueprintBucket = { tokens: 20, last: Date.now() };
save(invalidRoom, invalidPlayer, blueprint({ id: 'blue22', size: { x: 32, y: 32, z: 32 }, data: '0.' + maxRun }));
assert('32³ 最大体积及 base36 run 上界可接受', invalidRoom.blueprints.get('blue22')?.size.x === 32 && invalidRoom.blueprints.get('blue22')?.size.y === 32 && invalidRoom.blueprints.get('blue22')?.size.z === 32 && invalidRoom.blueprints.get('blue22')?.data === '0.' + maxRun);

const rateRoom = new Room('t-blueprint-rate');
const ratePlayer = join(rateRoom, 6, 'Rate');
for (let i = 0; i < 21; i++) save(rateRoom, ratePlayer, blueprint({ id: 'rate' + String(i).padStart(2, '0') }));
assert('写入桶允许 20 次突发并拒绝第 21 次', rateRoom.blueprints.size === 20 && lastDeny(ratePlayer)?.reason === 'rate');
ratePlayer._blueprintBucket.last -= 6000;
save(rateRoom, ratePlayer, blueprint({ id: 'rate21' }));
assert('每分钟 10 次令牌补充按 elapsed 生效', rateRoom.blueprints.size === 21);

const capRoom = new Room('t-blueprint-cap');
const capPlayer = join(capRoom, 7, 'Cap');
for (let i = 0; i < 24; i++) {
  capPlayer._blueprintBucket = { tokens: 20, last: Date.now() };
  save(capRoom, capPlayer, blueprint({ id: 'cap' + String(i).padStart(3, '0') }));
}
capPlayer._blueprintBucket = { tokens: 20, last: Date.now() };
save(capRoom, capPlayer, blueprint({ id: 'cap999' }));
assert('房间蓝图上限为 24', capRoom.blueprints.size === 24 && lastDeny(capPlayer)?.reason === 'limit');
capRoom.blueprints.get('cap000').rev = 99999;
save(capRoom, capPlayer, blueprint({ id: 'cap000' }));
assert('修订号 99999 不溢出', capRoom.blueprints.get('cap000').rev === 99999 && lastDeny(capPlayer)?.reason === 'revision');

const routeRoom = new Room('t-blueprint-route');
const routePlayer = join(routeRoom, 8, 'Router');
routeRoom.handle(routePlayer, { t: MSG.BLUEPRINT_SAVE, blueprint: blueprint({ id: 'route1' }) });
assert('Room.handle 路由 blueprint_save', routeRoom.blueprints.has('route1'));
routeRoom.handle(routePlayer, { t: MSG.BLUEPRINT_DELETE, id: 'route1' });
assert('owner 删除成功并只发 id removed payload',
  !routeRoom.blueprints.has('route1') && sentOfType(routePlayer, MSG.BLUEPRINT_REMOVED).at(-1)?.id === 'route1');
routeRoom.handle(routePlayer, { t: MSG.BLUEPRINT_DELETE, id: 'missing1' });
assert('删除缺失蓝图返回 deny id/reason', lastDeny(routePlayer)?.id === 'missing1' && lastDeny(routePlayer)?.reason === 'missing');

const flushedSnapshots = [];
const storeRoom = new Room('t-blueprint-store', (savedRoom) => flushedSnapshots.push(roomSnapshot(savedRoom)));
storeRoom.seed = 123;
const storePlayer = join(storeRoom, 9, 'Store');
save(storeRoom, storePlayer, blueprint({ id: 'store01' }));
assert('保存修改走既有 saveSoon 脏标记路径', storeRoom.isWorldDirty());
storeRoom.flushWorld();
assert('flushWorld 回调快照包含蓝图', !storeRoom.isWorldDirty() && flushedSnapshots[0]?.blueprints[0]?.id === 'store01');
const snapshot = roomSnapshot(storeRoom);
assert('roomSnapshot 写出蓝图数组', Array.isArray(snapshot.blueprints) && snapshot.blueprints.length === 1);
const directRestore = new Room('t-blueprint-store');
directRestore.restore(JSON.parse(JSON.stringify(snapshot)));
assert('快照 restore 保留权威字段', directRestore.blueprints.get('store01')?.byId === '9' && directRestore.blueprints.get('store01')?.rev === 1);

directRestore.seed = 1;
const replayPlayer = join(directRestore, 10, 'Replay');
directRestore.joinRoom(replayPlayer, {});
assert('join/rejoin 下发 BLUEPRINTS 完整列表',
  sentOfType(replayPlayer, MSG.BLUEPRINTS).at(-1)?.blueprints[0]?.id === 'store01');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b35-blueprint-'));
try {
  saveRoom(storeRoom, tempDir);
  const loaded = loadRooms(tempDir);
  assert('saveRoom/loadRooms 磁盘往返蓝图', loaded.length === 1 && loaded[0].blueprints[0].id === 'store01');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const dirty = new Room('t-blueprint-dirty');
dirty.restore({ seed: 1, dimensionBlocks: {}, blueprints: [null, { id: 'Bad!' }, blueprint({ id: 'valid01', dim: 'end', rev: 5, byId: 'owner-5' })] });
assert('restore 跳过畸形项并保留合法蓝图', dirty.blueprints.size === 1 && dirty.blueprints.get('valid01')?.rev === 5);
const tooMany = Array.from({ length: 26 }, (_, i) => ({ ...blueprint({ id: 'rest' + String(i).padStart(3, '0') }), dim: 'end', rev: 1, byId: 'owner' }));
dirty.restore({ seed: 1, dimensionBlocks: {}, blueprints: tooMany });
assert('restore 列表截断到 24 条', dirty.blueprints.size === 24);
const legacy = new Room('t-blueprint-legacy');
legacy.restore({ seed: 1, dimensionBlocks: {} });
assert('旧快照缺 blueprints 时回落空 Map', legacy.blueprints.size === 0);
const badShape = new Room('t-blueprint-bad-shape');
badShape.restore({ seed: 1, dimensionBlocks: {}, blueprints: 'not-array' });
assert('蓝图快照字段形状异常不崩服', badShape.blueprints.size === 0);
const partialSnapshot = roomSnapshot({
  name: 'partial', seed: 1, dimensionBlocks: new Map(), dimensionContainers: new Map(), drops: new Map(),
});
assert('roomSnapshot 对缺省蓝图 Map 返回空数组', Array.isArray(partialSnapshot.blueprints) && partialSnapshot.blueprints.length === 0);

finish();
