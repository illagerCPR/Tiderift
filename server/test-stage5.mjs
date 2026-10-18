// test-stage5.mjs -- 阶段 5 服务器回归：世界内换房 / 重建世界 / PLAYER_STATE 时间戳
// 用法：node server/test-stage5.mjs   （先启动 server/index.mjs，端口 3001）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';

const URL = 'ws://127.0.0.1:3001/ws';
const API = 'http://127.0.0.1:3001/api';
const results = [];

function assert(name, cond, extra = '') {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const p = { ws, id: null, inbox: [], waiters: [] };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      p.inbox.push(m);
      for (let i = p.waiters.length - 1; i >= 0; i--) {
        if (p.waiters[i](m)) p.waiters.splice(i, 1);
      }
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, version: PROTOCOL_VERSION })));
    ws.on('message', function h(raw) {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome') {
        ws.off('message', h);
        p.id = m.selfId;
        resolve(p);
      }
    });
    ws.on('error', reject);
    ws.on('close', () => { p.closed = true; });
  });
}

const send = (p, t, d = {}) => p.ws.send(JSON.stringify({ t, ...d }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(p, pred, timeout = 3000) {
  return new Promise((resolve) => {
    const hit = p.inbox.find(pred);
    if (hit) return resolve(hit);
    const t = setTimeout(() => resolve(null), timeout);
    p.waiters.push((m) => { if (pred(m)) { clearTimeout(t); resolve(m); return true; } return false; });
  });
}

console.log('阶段 5 服务器回归 ================');

// --- 用例 1：世界内换房 ---
{
  console.log('[1] 世界内换房 switch_room');
  const A = await connect('换房A');
  send(A, 'create_room', { room: 's5-room1', seed: 1111, mode: 'survival' });
  await sleep(150);
  const aWorld1 = await waitFor(A, (m) => m.t === 'world_info');
  assert('A 创建 s5-room1 seed=1111', !!aWorld1 && aWorld1.seed === 1111 && aWorld1.room === 's5-room1');

  const B = await connect('换房B');
  send(B, 'join_room', { room: 's5-room1' });
  await sleep(150);
  const bWorld1 = await waitFor(B, (m) => m.t === 'world_info');
  assert('B 加入 s5-room1 seed=1111', !!bWorld1 && bWorld1.seed === 1111 && bWorld1.room === 's5-room1');

  // B 世界内换房到不存在的 s5-room2：应自动创建，B 成为 host，且 WORLD_INFO 带 restart 标记
  send(B, 'switch_room', { room: 's5-room2' });
  const bWorld2 = await waitFor(B, (m) => m.t === 'world_info' && m.room === 's5-room2');
  assert('B 换房收到 world_info(restart) room=s5-room2', !!bWorld2 && bWorld2.restart === true, JSON.stringify(bWorld2 || {}));
  assert('B 换房后成为新房间 host', !!bWorld2 && bWorld2.hostId === B.id);
  assert('B 换房后 seed 为新随机整数', !!bWorld2 && Number.isInteger(bWorld2.seed));

  // 旧房间 A 应收到 B 离开；A 的世界未被重启
  const aLeave = await waitFor(A, (m) => m.t === 'player_leave' && m.id === B.id);
  assert('A 收到 B 的 player_leave', !!aLeave);
  const aRestartCount = A.inbox.filter((m) => m.t === 'world_info' && m.restart === true).length;
  assert('A 未因 B 换房而重启世界', aRestartCount === 0, `restart=${aRestartCount}`);

  // B 切回 s5-room1（此时应带 restart 且 seed 仍 1111）
  send(B, 'switch_room', { room: 's5-room1' });
  const bBack = await waitFor(B, (m) => m.t === 'world_info' && m.room === 's5-room1' && m.restart === true);
  assert('B 切回 s5-room1 收到 restart world_info seed=1111', !!bBack && bBack.seed === 1111, JSON.stringify(bBack || {}));
  A.ws.close(); B.ws.close();
  await sleep(150);
}

// --- 用例 2：重建世界（host 权限） ---
{
  console.log('[2] 重建世界 world_reset（仅 host）');
  const A = await connect('重置A');
  send(A, 'create_room', { room: 's5-reset', seed: 2222, mode: 'survival' });
  await sleep(150);
  const B = await connect('重置B');
  send(B, 'join_room', { room: 's5-reset' });
  await sleep(150);

  // 放一个方块让账本非空
  send(A, 'block_set', { x: 7, y: 64, z: 7, id: 1 });
  await sleep(150);
  assert('B 收到重置前 block_change', !!B.inbox.find((m) => m.t === 'block_change' && m.x === 7 && m.y === 64 && m.z === 7));

  // host A 重建世界
  send(A, 'world_reset', {});
  const aReset = await waitFor(A, (m) => m.t === 'world_info' && m.restart === true);
  const bReset = await waitFor(B, (m) => m.t === 'world_info' && m.restart === true);
  assert('A 收到重建 world_info(restart)', !!aReset);
  assert('B 收到重建 world_info(restart)', !!bReset);
  assert('重建后 seed 为新的随机整数', !!aReset && Number.isInteger(aReset.seed) && aReset.seed !== 2222, `seed=${aReset && aReset.seed}`);
  assert('重建后 B 收到 A 的 player_join 重放（远端重建）', !!B.inbox.find((m) => m.t === 'player_join' && m.id === A.id));

  // 重建后账本已清空：再放一个方块，B 应收到（新的账本）
  send(A, 'block_set', { x: 8, y: 64, z: 8, id: 2 });
  await sleep(150);
  assert('重建后新方块 block_change 仍广播', !!B.inbox.find((m) => m.t === 'block_change' && m.x === 8 && m.y === 64 && m.z === 8 && m.id === 2));

  // 非 host B 发起重建应被忽略
  const beforeCount = A.inbox.filter((m) => m.t === 'world_info' && m.restart === true).length;
  send(B, 'world_reset', {});
  await sleep(300);
  const afterCount = A.inbox.filter((m) => m.t === 'world_info' && m.restart === true).length;
  assert('非 host 的 world_reset 被忽略', beforeCount === afterCount, `${beforeCount}->${afterCount}`);
  A.ws.close(); B.ws.close();
  await sleep(150);
}

// --- 用例 3：PLAYER_STATE 携带时间戳 ---
{
  console.log('[3] PLAYER_STATE 带 ts（供客户端时间戳对齐插值）');
  const A = await connect('状态A');
  send(A, 'create_room', { room: 's5-state', seed: 3333, mode: 'survival' });
  await sleep(150);
  const B = await connect('状态B');
  send(B, 'join_room', { room: 's5-state' });
  await sleep(150);
  send(A, 'player_state', { x: 1.5, y: 70, z: 2.5, yaw: 0.5, pitch: 0.1, onGround: true, flying: false, inWater: false });
  const bState = await waitFor(B, (m) => m.t === 'player_state' && m.id === A.id);
  assert('B 收到 player_state 且带 ts', !!bState && typeof bState.ts === 'number' && bState.ts > 0, JSON.stringify(bState || {}));
  A.ws.close(); B.ws.close();
  await sleep(150);
}

// 清理测试房间
for (const name of ['s5-room1', 's5-room2', 's5-reset', 's5-state']) {
  await fetch(API + '/room/' + name + '/delete', { method: 'POST' }).catch(() => {});
}

const failCount = results.filter((r) => !r[1]).length;
console.log(`---\n${results.length - failCount}/${results.length} PASS`);
// 不用 process.exit()：Windows libuv 在 socket 关闭态直接 exit 会触发断言，改用 exitCode 自然退出
process.exitCode = failCount ? 1 : 0;
