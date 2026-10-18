// test-stage6.mjs -- 阶段 6 服务器回归：手持物品同步 / 玩家死亡掉落物 / 鉴权过期与操作日志
// 用法：node server/test-stage6.mjs   （先启动 server/index.mjs，端口 3001）
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

console.log('阶段 6 服务器回归 ================');

// --- 用例 1：PLAYER_STATE 携带手持物品（selected + held + ts） ---
{
  console.log('[1] PLAYER_STATE 手持物品同步');
  const A = await connect('手持A');
  send(A, 'create_room', { room: 's6-held', seed: 1111, mode: 'survival' });
  await sleep(150);
  const B = await connect('手持B');
  send(B, 'join_room', { room: 's6-held' });
  await sleep(150);
  send(A, 'player_state', { x: 1.5, y: 70, z: 2.5, yaw: 0.5, pitch: 0.1, onGround: true, flying: false, inWater: false, selected: 3, held: 'wood_sword' });
  const bState = await waitFor(B, (m) => m.t === 'player_state' && m.id === A.id);
  assert('B 收到 player_state 且带 ts', !!bState && typeof bState.ts === 'number' && bState.ts > 0, JSON.stringify(bState || {}));
  assert('player_state 携带 selected=3', !!bState && bState.selected === 3, JSON.stringify(bState && bState.selected));
  assert('player_state 携带 held=wood_sword', !!bState && bState.held === 'wood_sword', JSON.stringify(bState && bState.held));
  // player_full 也带 held（进房初始同步）
  send(A, 'player_full', { health: 20, food: 20, saturation: 5, mode: 'survival', selected: 1, held: 'torch' });
  const bFull = await waitFor(B, (m) => m.t === 'player_full' && m.id === A.id);
  assert('player_full 携带 held=torch', !!bFull && bFull.held === 'torch', JSON.stringify(bFull || {}));
  A.ws.close(); B.ws.close();
  await sleep(150);
}

// --- 用例 2：玩家死亡掉落物同步 ---
{
  console.log('[2] PLAYER_DIED 死亡掉落物');
  const A = await connect('死亡A');
  send(A, 'create_room', { room: 's6-death', seed: 2222, mode: 'survival' });
  await sleep(150);
  const B = await connect('死亡B');
  send(B, 'join_room', { room: 's6-death' });
  await sleep(150);

  send(A, 'player_died', { x: 10, y: 65, z: 20, drops: [{ name: 'apple', count: 3 }, { name: 'iron_ingot', count: 2 }] });
  const bDied = await waitFor(B, (m) => m.t === 'player_died' && m.id === A.id);
  assert('B 收到 player_died(死亡广播)', !!bDied, JSON.stringify(bDied || {}));
  const apple = await waitFor(B, (m) => m.t === 'drop_spawn' && m.name === 'apple');
  const iron = await waitFor(B, (m) => m.t === 'drop_spawn' && m.name === 'iron_ingot');
  assert('死亡掉落 apple x3 广播', !!apple && apple.count === 3, JSON.stringify(apple || {}));
  assert('死亡掉落 iron_ingot x2 广播', !!iron && iron.count === 2, JSON.stringify(iron || {}));
  assert('掉落位置靠近死亡点', !!apple && Math.abs(apple.x - 10) <= 1 && Math.abs(apple.z - 20) <= 1, `(${apple && apple.x},${apple && apple.z})`);

  // 重复上报同一次死亡：不应再产出掉落（_diedDrops 去重）
  const dropCountBefore = B.inbox.filter((m) => m.t === 'drop_spawn').length;
  send(A, 'player_died', { x: 10, y: 65, z: 20, drops: [{ name: 'diamond', count: 1 }] });
  await sleep(250);
  const dropCountAfter = B.inbox.filter((m) => m.t === 'drop_spawn').length;
  assert('重复 player_died 不再刷掉落', dropCountAfter === dropCountBefore, `${dropCountBefore}->${dropCountAfter}`);

  // 服务器账本已记录（管理面板可见）
  const st = await (await fetch(API + '/status')).json();
  const roomInfo = st.rooms.find((r) => r.name === 's6-death');
  assert('死亡掉落进入服务器账本', !!roomInfo && roomInfo.drops >= 2, `drops=${roomInfo && roomInfo.drops}`);

  // 复活后可再次掉落
  send(A, 'respawn', { x: 0.5, y: 66, z: 0.5 });
  await sleep(150);
  send(A, 'player_died', { x: 11, y: 65, z: 21, drops: [{ name: 'bone', count: 1 }] });
  const bone = await waitFor(B, (m) => m.t === 'drop_spawn' && m.name === 'bone');
  assert('复活后再次死亡可再掉落 bone', !!bone, JSON.stringify(bone || {}));
  A.ws.close(); B.ws.close();
  await sleep(150);
}

// --- 用例 3：管理面板鉴权过期 + 操作日志 ---
{
  console.log('[3] 鉴权过期与操作日志（阶段6）');
  // 先确保未鉴权，方便设置
  await fetch(API + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminToken: '', adminTokenExpires: 0 }) });
  const now = Math.floor(Date.now() / 1000);

  // 开启带过期时间的口令
  const set = await (await fetch(API + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminToken: 'expTkn', adminTokenExpires: now + 120 }),
  })).json();
  assert('设置带过期时间的口令成功', set.ok === true && set.config.adminToken === '****' && set.config.adminTokenExpires === now + 120, JSON.stringify(set.config));

  // 操作日志：config 操作已记录；无口令访问 401 并记录 auth-fail
  const log1 = await (await fetch(API + '/logs', { headers: { 'Authorization': 'Bearer expTkn' } })).json();
  assert('/api/logs 返回操作日志', Array.isArray(log1.logs) && log1.logs.some((l) => l.op === 'config'), JSON.stringify(log1.logs && log1.logs.slice(0, 2)));
  const noAuth = await fetch(API + '/status');
  assert('无口令访问 -> 401', noAuth.status === 401);
  const log2 = await (await fetch(API + '/logs', { headers: { 'Authorization': 'Bearer expTkn' } })).json();
  assert('401 被记录为 auth-fail 日志', log2.logs.some((l) => l.op === 'auth-fail'), JSON.stringify(log2.logs && log2.logs.slice(0, 2)));

  // 口令过期：设为过去时间后正确口令也 401（仅 /api/config POST 可续期）
  await fetch(API + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer expTkn' },
    body: JSON.stringify({ adminTokenExpires: now - 10 }),
  });
  const expiredStatus = await fetch(API + '/status', { headers: { 'Authorization': 'Bearer expTkn' } });
  const expiredBody = await expiredStatus.json();
  assert('口令过期后 /api/status -> 401', expiredStatus.status === 401, JSON.stringify(expiredBody));
  assert('过期错误提示明确', /过期/.test(expiredBody.error || ''), JSON.stringify(expiredBody));
  const expiredLogs = await fetch(API + '/logs', { headers: { 'Authorization': 'Bearer expTkn' } });
  assert('口令过期后 /api/logs -> 401（仅 config 可续期）', expiredLogs.status === 401);

  // 恢复：过期口令仍可 POST /api/config 清空（避免锁死）
  const clear = await (await fetch(API + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer expTkn' },
    body: JSON.stringify({ adminToken: '', adminTokenExpires: 0 }),
  })).json();
  assert('过期口令可续期/关闭鉴权（config POST 放行）', clear.ok === true && clear.config.adminToken === '', JSON.stringify(clear.config));
  const restored = await fetch(API + '/status');
  assert('关闭鉴权后无口令恢复访问', restored.status === 200);
}

// 清理测试房间
for (const name of ['s6-held', 's6-death']) {
  await fetch(API + '/room/' + name + '/delete', { method: 'POST' }).catch(() => {});
}

const failCount = results.filter((r) => !r[1]).length;
console.log(`---\n${results.length - failCount}/${results.length} PASS`);
process.exitCode = failCount ? 1 : 0;
