// test-stage12.mjs -- B38 L2 服务器回归：房间消息速率统计（定长环形 / 双漏斗计数 / /api/stats / viewer 可读）
// 用法：node server/test-stage12.mjs （先启动 server/index.mjs，端口 3001；跑批前清空 server/world/ 与 server/config.json）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { createStatsStore, STATS_POINTS } from './stats.js';
import { assert, finish, counts, configure } from './test-lib.mjs';

configure({ style: 'spaced' });

const URL = 'ws://127.0.0.1:3001/ws';
const API = 'http://127.0.0.1:3001/api';
const ROOM = `stage12-${Date.now() % 1000000}`;

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const p = { ws, id: null, inbox: [] };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      p.inbox.push(m);
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
  });
}

const send = (p, t, d = {}) => p.ws.send(JSON.stringify({ t, ...d }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (path, method = 'GET', body, token) => {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
};

const statsRoom = (json, name) => (json && Array.isArray(json.rooms) ? json.rooms.find((r) => r.name === name) : null);

console.log('B38 L2 服务器统计回归 ================');

// --- [1] 纯模块：定长环形 / 总量累加 / 空房回收 / 脏值丢弃 ---
console.log('[1] 统计存储（纯模块）');
{
  const store = createStatsStore();
  for (let i = 0; i < 200; i++) {
    store.add('r1', { inMsgs: 1, outMsgs: 2, inBytes: 10, outBytes: 20 });
    store.tick(i * 1000);
  }
  const r1 = store.snapshot().rooms[0];
  assert('环形缓冲定长（1 秒一点，最多 60 点）', r1.points.length === STATS_POINTS, String(r1.points.length));
  assert('总量不受环形裁剪影响', r1.totals.inMsgs === 200 && r1.totals.outMsgs === 400 && r1.totals.inBytes === 2000,
    JSON.stringify(r1.totals));
  assert('每个点只装自己那一秒的量', r1.points[r1.points.length - 1].inMsgs === 1,
    JSON.stringify(r1.points[r1.points.length - 1]));
  store.add('r1', { inMsgs: -3, inBytes: 'x', outMsgs: null });
  const after = store.snapshot().rooms[0];
  assert('脏值（负数/非数字/null）不污染统计', after.totals.inMsgs === 200 && after.totals.inBytes === 2000,
    JSON.stringify(after.totals));
  store.add('r2', { inMsgs: 5 });
  store.tick(999000, (name) => name === 'r1');
  const pruned = store.snapshot();
  assert('active 判据为假的房间整条回收', pruned.rooms.length === 1 && pruned.rooms[0].name === 'r1',
    JSON.stringify(pruned.rooms.map((r) => r.name)));
}

// --- [2] 端到端：两客户端同房间收发 → /api/stats 计数与采样 ---
console.log('[2] /api/stats 端到端');
const A = await connect('StatA');
send(A, 'create_room', { room: ROOM, seed: 4242, mode: 'survival', biomeScale: 'medium' });
await sleep(350);
assert('建房成功', !!A.inbox.find((m) => m.t === 'world_info' && m.room === ROOM));
const B = await connect('StatB');
send(B, 'join_room', { room: ROOM });
await sleep(350);
assert('B 加入同一房间', !!B.inbox.find((m) => m.t === 'world_info' && m.room === ROOM));

const s0 = await api('/stats');
const r0 = statsRoom(s0.json, ROOM);
assert('GET /api/stats 200 且列出在线房间', s0.status === 200 && !!r0,
  JSON.stringify((s0.json && s0.json.rooms || []).map((r) => r.name)));
assert('房间在线人数正确', !!r0 && r0.players === 2, String(r0 && r0.players));

for (let i = 0; i < 40; i++) send(A, 'player_state', { x: i, y: 64, z: 0, yaw: 0, pitch: 0 });
await sleep(250);
const r1 = statsRoom((await api('/stats')).json, ROOM);
assert('入向条数随上报增长', !!r1 && r1.totals.inMsgs >= 40, String(r1 && r1.totals.inMsgs));
assert('出向条数（同维度广播）同步增长', !!r1 && r1.totals.outMsgs >= 40, String(r1 && r1.totals.outMsgs));
assert('字节量入/出都累计到非零', !!r1 && r1.totals.inBytes > 0 && r1.totals.outBytes > 0,
  JSON.stringify(r1 && r1.totals));

await sleep(1300);
const r2 = statsRoom((await api('/stats')).json, ROOM);
assert('每秒采样落点', !!r2 && r2.points.length >= 1, String(r2 && r2.points.length));
assert('采样长度不超过定长上限', !!r2 && r2.points.length <= STATS_POINTS, String(r2 && r2.points.length));
assert('采样点内含这一秒的收发量', !!r2 && r2.points.some((p) => p.inMsgs > 0 && p.outBytes > 0),
  JSON.stringify(r2 && r2.points.slice(-2)));

const before = r2.totals.inMsgs;
for (let i = 0; i < 20; i++) send(A, 'player_state', { x: i, y: 64, z: 0 });
await sleep(250);
const r3 = statsRoom((await api('/stats')).json, ROOM);
assert('再发 20 条后累计继续增长', !!r3 && r3.totals.inMsgs >= before + 20, `${before} → ${r3 && r3.totals.inMsgs}`);

// --- [3] viewer 可读（非 GET 仍 403）---
console.log('[3] viewer 角色可读');
const tOp = await api('/tokens', 'POST', { label: 'stage12-op', expiresMinutes: 0, role: 'op' });
assert('生成 op 账号', tOp.status === 200 && !!tOp.json.token, JSON.stringify(tOp.json));
const tV = await api('/tokens', 'POST', { label: 'stage12-viewer', expiresMinutes: 0, role: 'viewer' }, tOp.json.token);
assert('op 可生成 viewer 账号', tV.status === 200 && !!tV.json.token);
const vGet = await api('/stats', 'GET', undefined, tV.json.token);
assert('viewer GET /api/stats 放行', vGet.status === 200 && !!statsRoom(vGet.json, ROOM), String(vGet.status));
const vPost = await api('/config', 'POST', {}, tV.json.token);
assert('viewer POST /api/config 仍 403', vPost.status === 403, String(vPost.status));
// 清理：撤销两个账号（保持跑批幂等）
await api('/tokens/revoke', 'POST', { token: tV.json.token }, tOp.json.token);
const rv = await api('/tokens/revoke', 'POST', { token: tOp.json.token }, tOp.json.token);
assert('测试账号撤销后鉴权自动关闭', rv.status === 200 && rv.json.remaining === 0, JSON.stringify(rv.json));

// --- [5] B38 L3：私聊 / 队伍分流 ---
console.log('[5] 私聊与队伍分流');
const C = await connect('StatC');
send(C, 'join_room', { room: ROOM });
await sleep(350);
A.inbox.length = 0; B.inbox.length = 0; C.inbox.length = 0;

send(A, 'chat', { text: '有人吗', ch: 'team' });
await sleep(250);
assert('未组队发队伍消息得到系统提示', A.inbox.some((m) => m.t === 'chat' && m.fromId === 0 && /不在任何队伍/.test(m.text || '')),
  JSON.stringify(A.inbox.filter((m) => m.t === 'chat')));
assert('未组队的队伍消息不外泄', !B.inbox.some((m) => m.t === 'chat' && m.text === '有人吗'));

A.inbox.length = 0; B.inbox.length = 0; C.inbox.length = 0;
send(A, 'team_join', { team: 'T1' });
await sleep(250);
const aTeams = A.inbox.filter((m) => m.t === 'teams').pop();
assert('组队后收到 TEAMS 全量结构', !!aTeams && aTeams.teams.some((t) => t.name === 'T1' && t.members.length === 1),
  JSON.stringify(aTeams));
assert('TEAMS 广播给房间其他玩家', B.inbox.some((m) => m.t === 'teams'));

B.inbox.length = 0;
send(B, 'team_join', { team: 'T1' });
await sleep(250);
const teams2 = B.inbox.filter((m) => m.t === 'teams').pop();
assert('第二人加入后队伍有 2 名成员', !!teams2 && teams2.teams.find((t) => t.name === 'T1').members.length === 2,
  JSON.stringify(teams2));

A.inbox.length = 0; B.inbox.length = 0; C.inbox.length = 0;
send(A, 'chat', { text: '队伍频道', ch: 'team' });
await sleep(250);
assert('队友收到队伍消息（含发送者回显）',
  A.inbox.some((m) => m.t === 'chat' && m.text === '队伍频道' && m.ch === 'team') &&
  B.inbox.some((m) => m.t === 'chat' && m.text === '队伍频道' && m.ch === 'team'));
assert('非队友收不到队伍消息', !C.inbox.some((m) => m.t === 'chat' && m.text === '队伍频道'));

B.inbox.length = 0; C.inbox.length = 0;
send(A, 'chat', { text: '悄悄话', ch: 'dm', to: 'StatC' });
await sleep(250);
assert('私聊目标收到', C.inbox.some((m) => m.t === 'chat' && m.text === '悄悄话' && m.ch === 'dm'));
assert('同房非目标收不到私聊', !B.inbox.some((m) => m.t === 'chat' && m.text === '悄悄话'));
assert('私聊发送者收到回显', A.inbox.some((m) => m.t === 'chat' && m.text === '悄悄话'));

A.inbox.length = 0;
send(A, 'chat', { text: 'q', ch: 'dm', to: 'Nobody' });
await sleep(250);
assert('私聊离线玩家得到系统提示（不静默失败）',
  A.inbox.some((m) => m.t === 'chat' && m.fromId === 0 && /不在线/.test(m.text || '')));

B.inbox.length = 0; A.inbox.length = 0;
send(B, 'team_leave', {});
await sleep(250);
const teams3 = B.inbox.filter((m) => m.t === 'teams').pop();
assert('退队后 TEAMS 只剩队长', !!teams3 && teams3.teams.find((t) => t.name === 'T1').members.length === 1,
  JSON.stringify(teams3));
A.inbox.length = 0; B.inbox.length = 0;
send(A, 'chat', { text: '还在吗', ch: 'team' });
await sleep(250);
assert('退队的人不再收到队伍消息', !B.inbox.some((m) => m.t === 'chat' && m.text === '还在吗'));

A.inbox.length = 0;
send(A, 'team_leave', {});
await sleep(250);
const teams4 = A.inbox.filter((m) => m.t === 'teams').pop();
assert('队长退队 = 队伍解散', !!teams4 && !teams4.teams.some((t) => t.name === 'T1'), JSON.stringify(teams4));

// 队伍人数上限 8：塞满后第 9 人被拒（不静默）
const teamers = [];
for (let i = 0; i < 5; i++) {
  const cl = await connect('Team' + i);
  send(cl, 'join_room', { room: ROOM });
  teamers.push(cl);
}
await sleep(450);
send(A, 'team_join', { team: 'T8' });
await sleep(200);
for (const cl of [B, C, ...teamers]) {
  send(cl, 'team_join', { team: 'T8' });
  await sleep(120);
}
const extra = await connect('Team9');
send(extra, 'join_room', { room: ROOM });
await sleep(400);
extra.inbox.length = 0;
send(extra, 'team_join', { team: 'T8' });
await sleep(300);
assert('队伍满 8 人后第 9 人被拒并收到提示',
  extra.inbox.some((m) => m.t === 'chat' && m.fromId === 0 && /已满/.test(m.text || '')),
  JSON.stringify(extra.inbox.filter((m) => m.t === 'chat')));

// --- [4] 房空即回收 ---
console.log('[4] 空房回收');
A.ws.close();
B.ws.close();
C.ws.close();
for (const cl of teamers) cl.ws.close();
extra.ws.close();
await sleep(2600);
const s4 = await api('/stats');
assert('房空后该房间从 /api/stats 消失', !statsRoom(s4.json, ROOM),
  JSON.stringify((s4.json && s4.json.rooms || []).map((r) => r.name)));

const { total, passed } = counts();
console.log(`---\n${passed}/${total} PASS`);
finish();
