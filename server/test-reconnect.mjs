// test-reconnect.mjs -- B32-3/4 服务端黑盒：重连维度恢复握手与恢复前消息门控
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { assert, finish } from './test-lib.mjs';

const URL = 'ws://127.0.0.1:3001/ws';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ROOM = 'resume-' + Date.now();

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const queue = [];
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, version: PROTOCOL_VERSION })));
    ws.on('message', (raw) => queue.push(JSON.parse(raw.toString())));
    ws.on('error', reject);
    const timer = setInterval(() => {
      const welcome = queue.find((msg) => msg.t === 'welcome');
      if (welcome) { clearInterval(timer); resolve({ ws, queue, selfId: welcome.selfId }); }
    }, 10);
    setTimeout(() => { clearInterval(timer); reject(new Error('等待 welcome 超时')); }, 3000);
  });
}

async function waitFor(client, predicate, timeout = 2500) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const hit = client.queue.find(predicate);
    if (hit) return hit;
    await sleep(10);
  }
  return null;
}

async function waitClosed(client, timeout = 1000) {
  if (client.ws.readyState >= 2) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    client.ws.once('close', () => { clearTimeout(timer); resolve(true); });
  });
}

const send = (client, t, fields = {}) => client.ws.send(JSON.stringify({ t, ...fields }));
const sockets = [];
const A = await connect('ResumeA');
sockets.push(A);
send(A, 'create_room', { room: ROOM, seed: 7331, mode: 'survival' });
await waitFor(A, (msg) => msg.t === 'world_info');
send(A, 'switch_dimension', { dim: 'nether' });
await waitFor(A, (msg) => msg.t === 'dimension_world' && msg.dim === 'nether');
send(A, 'block_set', { x: 31, y: 68, z: -7, id: 4 });
send(A, 'container_set', { x: 32, y: 68, z: -7, items: new Array(27).fill(null) });
send(A, 'drop_spawn', { x: 33, y: 68, z: -7, name: 'stone', count: 2 });
send(A, 'profile_save', { profile: {
  inventory: { slots: [], armor: [] }, position: { x: 40, y: 71, z: -9 }, dim: 'nether',
  health: 18, food: 17, saturation: 4, xp: 3, xpLevel: 2,
} });
await waitFor(A, (msg) => msg.t === 'drop_spawn' && msg.name === 'stone');

const observer = await connect('ResumeObserver');
sockets.push(observer);
send(observer, 'join_room', { room: ROOM });
await waitFor(observer, (msg) => msg.t === 'world_info');
send(observer, 'switch_dimension', { dim: 'nether' });
await waitFor(observer, (msg) => msg.t === 'dimension_world' && msg.dim === 'nether');

A.ws.close();
await waitFor(observer, (msg) => msg.t === 'player_leave' && msg.id === A.selfId);
const A2 = await connect('ResumeA');
sockets.push(A2);
const recoveryId = 'resume-test-' + Date.now().toString(36);
send(A2, 'join_room', { room: ROOM, recoveryId, resumeDim: 'nether',
  resumePos: { x: 41, y: 72, z: -10, yaw: 1.25, pitch: -0.2 } });
const worldInfo = await waitFor(A2, (msg) => msg.t === 'world_info' && msg.recoveryId === recoveryId);
const snapshot = await waitFor(A2, (msg) => msg.t === 'dimension_world' && msg.recoveryId === recoveryId);
assert('重连 WORLD_INFO 确认恢复目标维度与会话代次',
  !!worldInfo && worldInfo.dim === 'nether' && worldInfo.recoveryId === recoveryId);
assert('下界恢复快照包含下界账本且同维早退不吞回执',
  !!snapshot && snapshot.dim === 'nether' && snapshot.blocks.some((b) => b.x === 31 && b.y === 68 && b.z === -7 && b.id === 4));
assert('恢复快照同时包含该维度容器账本',
  !!snapshot && snapshot.containers.some((c) => c.x === 32 && c.y === 68 && c.z === -7));
assert('重连回放下界掉落物与玩家档案',
  !!await waitFor(A2, (msg) => msg.t === 'drop_spawn' && msg.d === 'nether' && msg.name === 'stone') &&
  !!await waitFor(A2, (msg) => msg.t === 'player_profile' && msg.profile.dim === 'nether'));
const joined = await waitFor(observer, (msg) => msg.t === 'player_join' && msg.id === A2.selfId);
assert('其他玩家看到重连者位于正确维度和断线位置',
  !!joined && joined.dim === 'nether' && joined.pos.x === 41 && joined.pos.y === 72 && joined.pos.z === -10);

const observerChanges = () => observer.queue.filter((msg) => msg.t === 'block_change' && msg.by === A2.selfId);
send(A2, 'block_set', { x: 34, y: 68, z: -7, id: 5 });
send(A2, 'world_ready', { recoveryId: 'stale-recovery', dim: 'nether' });
await sleep(100);
assert('确认前方块写入与过期令牌均被拒绝', observerChanges().length === 0 &&
  !A2.queue.some((msg) => msg.t === 'world_resumed'));
send(A2, 'world_ready', { recoveryId, dim: 'nether' });
const resumed = await waitFor(A2, (msg) => msg.t === 'world_resumed' && msg.recoveryId === recoveryId);
assert('服务端只对匹配的维度/代次确认恢复', !!resumed && resumed.dim === 'nether');
send(A2, 'block_set', { x: 35, y: 68, z: -7, id: 6 });
await waitFor(observer, (msg) => msg.t === 'block_change' && msg.by === A2.selfId && msg.x === 35);
assert('恢复确认后方块修改重新进入正确维度广播', observerChanges().some((msg) => msg.x === 35 && msg.d === 'nether'));

send(A2, 'switch_dimension', { dim: 'overworld' });
await waitFor(A2, (msg) => msg.t === 'dimension_world' && msg.dim === 'overworld');
A2.ws.close();
await waitFor(observer, (msg) => msg.t === 'player_leave' && msg.id === A2.selfId);
const A3 = await connect('ResumeA');
sockets.push(A3);
const mainRecoveryId = 'resume-main-' + Date.now().toString(36);
send(A3, 'join_room', { room: ROOM, recoveryId: mainRecoveryId, resumeDim: 'overworld',
  resumePos: { x: 7, y: 70, z: 8, yaw: 0, pitch: 0 } });
const mainSnapshot = await waitFor(A3, (msg) => msg.t === 'dimension_world' && msg.recoveryId === mainRecoveryId);
assert('主世界同维恢复也收到明确账本确认，不被同维早退截断',
  !!mainSnapshot && mainSnapshot.dim === 'overworld' && Array.isArray(mainSnapshot.blocks));
send(A3, 'world_ready', { recoveryId: mainRecoveryId, dim: 'overworld' });
assert('主世界恢复也能完成服务端确认',
  !!await waitFor(A3, (msg) => msg.t === 'world_resumed' && msg.recoveryId === mainRecoveryId));
A3._testDim = 'overworld';

let observerDim = 'nether';
async function switchObserverDimension(dim) {
  if (observerDim === dim) return;
  send(observer, 'switch_dimension', { dim });
  const snapshot = await waitFor(observer, (msg) => msg.t === 'dimension_world' && msg.dim === dim);
  assert(`${dim} 同维观察端收到维度快照`, !!snapshot);
  observerDim = dim;
}

async function disconnectAndRecover(current, dim, label, pos) {
  if (current._testDim !== dim) {
    send(current, 'switch_dimension', { dim });
    assert(`${label} 断线前完成正常换维`,
      !!await waitFor(current, (msg) => msg.t === 'dimension_world' && msg.dim === dim));
    current._testDim = dim;
  }
  current.ws.close();
  await waitFor(observer, (msg) => msg.t === 'player_leave' && msg.id === current.selfId);
  await switchObserverDimension(dim);
  const next = await connect('ResumeA');
  sockets.push(next);
  const id = `resume-${dim}-${Date.now().toString(36)}`;
  send(next, 'join_room', { room: ROOM, recoveryId: id, resumeDim: dim, resumePos: pos });
  const info = await waitFor(next, (msg) => msg.t === 'world_info' && msg.recoveryId === id);
  const world = await waitFor(next, (msg) => msg.t === 'dimension_world' && msg.recoveryId === id);
  assert(`${label} WORLD_INFO 固定恢复维度`, !!info && info.dim === dim);
  assert(`${label} 恢复快照包含目标维度`, !!world && world.dim === dim && Array.isArray(world.blocks));
  const joinedPlayer = await waitFor(observer, (msg) => msg.t === 'player_join' && msg.id === next.selfId);
  assert(`${label} 同维观察端收到恢复玩家与位置`, !!joinedPlayer && joinedPlayer.dim === dim &&
    joinedPlayer.pos.x === pos.x && joinedPlayer.pos.y === pos.y && joinedPlayer.pos.z === pos.z);
  send(next, 'world_ready', { recoveryId: id, dim });
  assert(`${label} 恢复完成握手`, !!await waitFor(next, (msg) => msg.t === 'world_resumed' && msg.recoveryId === id));
  next._testDim = dim;
  return next;
}

// 连续断线，并覆盖全部已实现维度的服务端恢复握手。
const A4 = await disconnectAndRecover(A3, 'overworld', '连续主世界重连',
  { x: 8, y: 70, z: 9, yaw: 0, pitch: 0 });
const A5 = await disconnectAndRecover(A4, 'end', '末地断线重连',
  { x: 12, y: 65, z: -4, yaw: 0.4, pitch: -0.1 });
const A6 = await disconnectAndRecover(A5, 'aether', '天域断线重连',
  { x: -6, y: 140, z: 3, yaw: -0.4, pitch: 0.1 });

// 恢复期间换房必须退出旧恢复代次，并在新房正常解锁；退出则应干净离房。
const targetRoom = `${ROOM}-switch`;
const targetOwner = await connect('ResumeTarget');
sockets.push(targetOwner);
send(targetOwner, 'create_room', { room: targetRoom, seed: 7442, mode: 'survival' });
await waitFor(targetOwner, (msg) => msg.t === 'world_info' && msg.room === targetRoom);
targetOwner.ws.close();
await sleep(80);

const switcher = await connect('ResumeSwitch');
sockets.push(switcher);
const switchRecovery = `resume-switch-${Date.now().toString(36)}`;
send(switcher, 'join_room', { room: ROOM, recoveryId: switchRecovery, resumeDim: 'aether',
  resumePos: { x: 1, y: 140, z: 1, yaw: 0, pitch: 0 } });
await waitFor(switcher, (msg) => msg.t === 'dimension_world' && msg.recoveryId === switchRecovery);
send(switcher, 'chat', { text: `/room ${targetRoom}` });
assert('恢复期间主动换房收到新房间重启消息',
  !!await waitFor(switcher, (msg) => msg.t === 'world_info' && msg.room === targetRoom && msg.restart === true));
send(switcher, 'block_set', { x: 2, y: 70, z: 2, id: 1 });
send(switcher, 'chat', { text: '/seed' });
assert('换房后旧恢复门控已解除',
  !!await waitFor(switcher, (msg) => msg.t === 'chat' && msg.fromId === 0 && msg.text.includes('方块改动1')));

const leaver = await connect('ResumeLeave');
sockets.push(leaver);
const leaveRecovery = `resume-leave-${Date.now().toString(36)}`;
send(leaver, 'join_room', { room: ROOM, recoveryId: leaveRecovery, resumeDim: 'end',
  resumePos: { x: 0, y: 65, z: 0, yaw: 0, pitch: 0 } });
await waitFor(leaver, (msg) => msg.t === 'dimension_world' && msg.recoveryId === leaveRecovery);
send(leaver, 'leave_room');
assert('恢复期间主动退出关闭连接', await waitClosed(leaver));

const invalidRecovery = await connect('ResumeInvalid');
sockets.push(invalidRecovery);
send(invalidRecovery, 'join_room', { room: ROOM, recoveryId: 'resume-invalid', resumeDim: 'moon' });
assert('服务端拒绝无效恢复维度并关闭连接',
  !!await waitFor(invalidRecovery, (msg) => msg.t === 'kicked') &&
  await waitClosed(invalidRecovery));

for (const client of sockets) {
  try { client.ws.close(); } catch {}
}
await sleep(80);
finish('test-reconnect');
