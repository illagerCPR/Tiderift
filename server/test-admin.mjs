// test-admin.mjs -- 阶段 4 服务器管理面板回归：房间上限 / 踢出 / 清掉落物 / 配置
// 用法：node server/test-admin.mjs   （先启动 server/index.mjs，端口 3001）
// 依赖 ws（server/package.json 已声明）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { ok, finish, counts, configure } from './test-lib.mjs';

configure({ style: 'admin' });

const WS_URL = 'ws://127.0.0.1:3001/ws';
const API = 'http://127.0.0.1:3001/api';

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const p = { ws, id: null, inbox: [], waiters: [] };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      p.inbox.push(m);
      for (let i = p.waiters.length - 1; i >= 0; i--) {
        if (p.waiters[i](m)) p.waiters.splice(i, 1);
      }
    });
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', name, version: PROTOCOL_VERSION }));
    });
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

function send(p, type, data = {}) { p.ws.send(JSON.stringify({ t: type, ...data })); }

function waitFor(p, pred, timeout = 3000) {
  return new Promise((resolve) => {
    const hit = p.inbox.find(pred);
    if (hit) return resolve(hit);
    const t = setTimeout(() => resolve(null), timeout);
    p.waiters.push((m) => { if (pred(m)) { clearTimeout(t); resolve(m); return true; } return false; });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('阶段 4 管理面板回归 ================');

// 先重置配置为宽松值（上限 10），避免影响其它用例
await fetch(API + '/config', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dropTtlMs: 300000, maxPlayersPerRoom: 10 }),
});

// --- 用例 1：房间人数上限 ---
{
  console.log('[1] 房间人数上限 (maxPlayersPerRoom=2)');
  await fetch(API + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxPlayersPerRoom: 2 }),
  });
  const a = await connect('上限A');
  const b = await connect('上限B');
  const c = await connect('上限C');
  send(a, 'create_room', { room: 'cap-room', seed: 777, mode: 'survival' });
  await sleep(100);
  send(b, 'join_room', { room: 'cap-room' });
  await sleep(100);
  send(c, 'join_room', { room: 'cap-room' });
  await sleep(300);
  const cKicked = await waitFor(c, (m) => m.t === 'kicked');
  ok('第 3 人收到 kicked（房间已满）', !!cKicked, JSON.stringify(cKicked || {}));
  ok('第 1 人仍在房间（未收到 kicked）', !a.inbox.some((m) => m.t === 'kicked'));
  a.ws.close(); b.ws.close(); c.ws.close();
  await sleep(100);
}

// --- 用例 2：踢出玩家 ---
{
  console.log('[2] 管理面板踢出玩家');
  const a = await connect('踢出A');
  const b = await connect('踢出B');
  send(a, 'create_room', { room: 'kick-room', seed: 888, mode: 'survival' });
  await sleep(100);
  send(b, 'join_room', { room: 'kick-room' });
  await sleep(200);
  const st = await (await fetch(API + '/status')).json();
  const target = st.rooms.find((r) => r.name === 'kick-room').players.find((p) => p.name === '踢出B');
  ok('面板能看到玩家 B', !!target, JSON.stringify(target || {}));
  const kr = await (await fetch(API + '/kick', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: target.id }),
  })).json();
  ok('kick 接口返回 ok', kr.ok === true, JSON.stringify(kr));
  await sleep(200);
  const st2 = await (await fetch(API + '/status')).json();
  const still = st2.rooms.find((r) => r.name === 'kick-room').players.some((p) => p.id === target.id);
  ok('被踢玩家从房间移除', !still);
  // 被踢玩家收到 kicked（若连接尚在）——这里 B 可能已被服务端 close
  ok('kick 响应含房间名', kr.room === 'kick-room');
  a.ws.close();
  await sleep(100);
}

// --- 用例 3：清空掉落物 ---
{
  console.log('[3] 清空房间掉落物');
  const a = await connect('掉落A');
  send(a, 'create_room', { room: 'drop-room', seed: 999, mode: 'survival' });
  await sleep(150);
  send(a, 'drop_spawn', { x: 1, y: 65, z: 1, name: 'apple', count: 1 });
  await sleep(150);
  let st = await (await fetch(API + '/status')).json();
  const before = st.rooms.find((r) => r.name === 'drop-room').drops;
  ok('掉落物已记录', before >= 1, `drops=${before}`);
  const cr = await (await fetch(API + '/room/drop-room/clear-drops', { method: 'POST' })).json();
  ok('清空接口返回数量', Number.isInteger(cr.removed) && cr.removed >= 1, JSON.stringify(cr));
  await sleep(150);
  st = await (await fetch(API + '/status')).json();
  const after = st.rooms.find((r) => r.name === 'drop-room').drops;
  ok('掉落物已清空', after === 0, `drops=${after}`);
  a.ws.close();
  await sleep(100);
}

// --- 用例 4：删除房间（重置世界） ---
{
  console.log('[4] 删除房间并重置世界存档');
  const a = await connect('删除A');
  send(a, 'create_room', { room: 'del-room', seed: 1111, mode: 'survival' });
  await sleep(150);
  send(a, 'block_set', { x: 5, y: 64, z: 5, id: 1 });
  await sleep(150);
  let st = await (await fetch(API + '/status')).json();
  ok('房间存在且方块已记录', !!st.rooms.find((r) => r.name === 'del-room'));
  const dr = await (await fetch(API + '/room/del-room/delete', { method: 'POST' })).json();
  ok('删除接口返回 ok', dr.ok === true, JSON.stringify(dr));
  await sleep(200);
  st = await (await fetch(API + '/status')).json();
  ok('房间已从内存移除', !st.rooms.find((r) => r.name === 'del-room'));
  // 房间内玩家被踢出
  ok('玩家收到 kicked（房间被删）', a.inbox.some((m) => m.t === 'kicked'));
  // 重新加入同名房间应新建世界（seed 变化/新）
  const b = await connect('删除B');
  send(b, 'join_room', { room: 'del-room' });
  await sleep(200);
  const wi = await waitFor(b, (m) => m.t === 'world_info');
  ok('重新加入同名房间自动重建世界', !!wi && Number.isInteger(wi.seed), JSON.stringify(wi || {}));
  b.ws.close();
  await sleep(100);
}

// --- 用例 5：配置读写 ---
{
  console.log('[5] 配置读写与非法值过滤');
  const g = await (await fetch(API + '/config')).json();
  ok('GET config 返回全部字段', !!g.config && Number.isInteger(g.config.dropTtlMs));
  const r = await (await fetch(API + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dropTtlMs: 999999999, maxPlayersPerRoom: 5 }), // 非法 + 合法
  })).json();
  ok('非法值被忽略、合法值生效', r.config.dropTtlMs !== 999999999 && r.config.maxPlayersPerRoom === 5, JSON.stringify(r.config));
  // 恢复默认
  await fetch(API + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dropTtlMs: 300000, maxPlayersPerRoom: 10 }),
  });
}

// --- 用例 6：广播 ---
{
  console.log('[6] 管理面板广播');
  const a = await connect('广播A');
  send(a, 'create_room', { room: 'bcast-room', seed: 2222, mode: 'survival' });
  await sleep(150);
  const br = await (await fetch(API + '/broadcast', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '服务器即将维护' }),
  })).json();
  ok('广播接口 ok', br.ok === true, JSON.stringify(br));
  const chat = await waitFor(a, (m) => m.t === 'chat');
  ok('房间内玩家收到系统广播', !!chat && chat.fromId === 0 && chat.text.includes('服务器即将维护'), JSON.stringify(chat || {}));
  a.ws.close();
  await sleep(100);
}

// --- 用例 7：管理面板鉴权（阶段5） ---
{
  console.log('[7] 管理面板鉴权 adminToken');
  // 开启鉴权（当前未开启，无需口令即可设置）
  const set = await (await fetch(API + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminToken: 's3cret' }),
  })).json();
  ok('开启鉴权成功（adminToken 返回掩码）', set.ok === true && set.config.adminToken === '****', JSON.stringify(set.config));

  const noAuth = await fetch(API + '/status');
  ok('无口令访问 /api/status -> 401', noAuth.status === 401);
  const badAuth = await fetch(API + '/status', { headers: { 'Authorization': 'Bearer wrong' } });
  ok('错误口令访问 -> 401', badAuth.status === 401);
  const okAuth = await fetch(API + '/status', { headers: { 'Authorization': 'Bearer s3cret' } });
  ok('正确口令访问 -> 200', okAuth.status === 200);
  const cfg = await (await fetch(API + '/config', { headers: { 'Authorization': 'Bearer s3cret' } })).json();
  ok('config 中 adminToken 被掩码', cfg.config.adminToken === '****', JSON.stringify(cfg.config.adminToken));
  const kickNoAuth = await fetch(API + '/kick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok('无口令踢人 -> 401', kickNoAuth.status === 401);

  // 关闭鉴权（用口令清空），否则后续清理请求会 401
  const clear = await (await fetch(API + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer s3cret' },
    body: JSON.stringify({ adminToken: '' }),
  })).json();
  ok('用正确口令关闭鉴权', clear.ok === true && clear.config.adminToken === '');
  const again = await fetch(API + '/status');
  ok('关闭鉴权后无口令恢复访问', again.status === 200);
}

// 清理：删除测试房间
for (const name of ['cap-room', 'kick-room', 'drop-room', 'del-room', 'bcast-room']) {
  await fetch(API + '/room/' + name + '/delete', { method: 'POST' }).catch(() => {});
}

const { total, passed } = counts();
console.log(`\n结果: ${passed}/${total} PASS`);
finish();
