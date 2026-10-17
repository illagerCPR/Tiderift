// test-hardening-edge.mjs -- 批次一服务器加固边界回归（S1 畸形 Host 不崩 / S4 房间名 40 字符口径 / S5 入口无幽灵成员 / 面板 XSS 静态断言）
// 用法：node server/test-hardening-edge.mjs   （先启动 server/index.mjs，端口 3001）
import { WebSocket } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'ws://127.0.0.1:3001/ws';
const BASE = 'http://127.0.0.1:3001';
const results = [];

function assert(name, cond, extra = '') {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const p = { ws, id: null, inbox: [], waiters: [], closed: false };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      p.inbox.push(m);
      for (let i = p.waiters.length - 1; i >= 0; i--) {
        if (p.waiters[i](m)) p.waiters.splice(i, 1);
      }
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, version: '0.1' })));
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

// 原始 Host 头请求：node 客户端允许头值含空格，服务器侧 new URL 会抛 Invalid URL
function hostRequest(host) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: 3001, path: '/api/status', method: 'GET', headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.end();
  });
}

const tag = Date.now().toString(36);
console.log('服务器加固边界回归 ================');

// --- 用例 1（S1）：畸形 Host 头返回 4xx，且进程不死 ---
{
  console.log('[1] S1：畸形 Host 头');
  const bad = await hostRequest('a b');
  assert('畸形 Host 返回 4xx（解析失败不抛出）', bad.status >= 400 && bad.status < 500, `status=${bad.status} body=${String(bad.body).slice(0, 80)}`);
  const root = await fetch(BASE + '/');
  assert('随后 HTTP 请求仍成功（进程存活）', root.status === 200, `status=${root.status}`);
  const alive = await connect('alive' + tag);
  assert('随后 WebSocket 握手仍成功（连接层存活）', !!alive.id, `id=${alive.id}`);
  alive.ws.close();
}

// --- 用例 2（S4）：房间名口径 trim + 40 字符截断 ---
{
  console.log('[2] S4：房间名口径');
  const long = 'H'.repeat(60);
  const p1 = await connect('longname' + tag);
  send(p1, 'create_room', { room: long, seed: 11, mode: 'survival' });
  const w1 = await waitFor(p1, (m) => m.t === 'world_info');
  assert('超长房间名按 40 字符口径截断', !!w1 && w1.room === 'H'.repeat(40), `room=${w1 && w1.room}`);

  // 同前缀的超长名（41+ 字符）必须归并到同一房间（内存 key 与磁盘文件名口径一致）
  const p2 = await connect('longjoin' + tag);
  send(p2, 'join_room', { room: 'H'.repeat(41) + 'tail' });
  const w2 = await waitFor(p2, (m) => m.t === 'world_info');
  assert('同前缀超长名归并到同一房间', !!w2 && w2.room === w1.room, `room=${w2 && w2.room}`);

  // 服务端房间注册表（/rooms 命令）里不出现超长 key
  send(p1, 'chat', { text: '/rooms' });
  const rooms = await waitFor(p1, (m) => m.t === 'chat' && /现有房间/.test(m.text || ''));
  assert('房间列表含截断后的名字', !!rooms && rooms.text.includes('「' + 'H'.repeat(40) + '」'), `text=${(rooms && rooms.text || '').slice(0, 60)}…`);
  assert('房间列表不含超长名字', !!rooms && !rooms.text.includes('H'.repeat(41)));

  const okName = 'edge-ok-' + tag;
  const p3 = await connect('okname' + tag);
  send(p3, 'create_room', { room: okName, seed: 12, mode: 'survival' });
  const w3 = await waitFor(p3, (m) => m.t === 'world_info');
  assert('合法房间名不被改写', !!w3 && w3.room === okName, `room=${w3 && w3.room}`);

  const p4 = await connect('trimname' + tag);
  send(p4, 'join_room', { room: '  edge-trim-' + tag + '  ' });
  const w4 = await waitFor(p4, (m) => m.t === 'world_info');
  assert('首尾空白仍被 trim（合法名行为不变）', !!w4 && w4.room === 'edge-trim-' + tag, `room=${w4 && w4.room}`);

  p1.ws.close(); p2.ws.close(); p3.ws.close(); p4.ws.close();
}

// --- 用例 3（S5）：同一连接 CREATE_ROOM 后 JOIN_ROOM 另一房间，旧房间不留幽灵成员 ---
{
  console.log('[3] S5：入口换房无幽灵成员');
  const r1 = 'ghost-r1-' + tag;
  const r2 = 'ghost-r2-' + tag;

  const pA = await connect('ghA' + tag);
  send(pA, 'create_room', { room: r1, seed: 21, mode: 'survival' });
  const wa = await waitFor(pA, (m) => m.t === 'world_info');
  assert('玩家 A 创建 R1', !!wa && wa.room === r1, `room=${wa && wa.room}`);

  const pB = await connect('ghB' + tag);
  send(pB, 'join_room', { room: r1 });
  const wb = await waitFor(pB, (m) => m.t === 'world_info');
  const seenA = await waitFor(pB, (m) => m.t === 'player_join' && m.id === pA.id);
  assert('B 加入 R1 后可见 A（房间内确有 A 的登记）', !!wb && wb.room === r1 && !!seenA, `room=${wb && wb.room} seenA=${!!seenA}`);

  // A 同连接改投 R2：旧房必须先移除 A
  send(pA, 'join_room', { room: r2 });
  const wa2 = await waitFor(pA, (m) => m.t === 'world_info' && m.room === r2);
  assert('A 改投 R2 成功', !!wa2, `room=${wa2 && wa2.room}`);
  const left = await waitFor(pB, (m) => m.t === 'player_leave' && m.id === pA.id, 2000);
  assert('R1 内 B 收到 A 的 player_leave', !!left);

  // 第三人加入 R1：回放列表必须含 B、不含 A（幽灵成员直查）
  const pC = await connect('ghC' + tag);
  send(pC, 'join_room', { room: r1 });
  const replayB = await waitFor(pC, (m) => m.t === 'player_join' && m.id === pB.id);
  const replayA = await waitFor(pC, (m) => m.t === 'player_join' && m.id === pA.id, 600);
  assert('R1 回放仍含 B（回放机制正常）', !!replayB);
  assert('R1 回放不再含 A（旧房无幽灵成员）', !replayA, replayA ? '仍回放了 A' : '');

  // 第四人加入 R2：A 确实登记在 R2（正向对照）
  const pD = await connect('ghD' + tag);
  send(pD, 'join_room', { room: r2 });
  const replayA2 = await waitFor(pD, (m) => m.t === 'player_join' && m.id === pA.id, 2000);
  assert('R2 回放含 A（换房后登记在新房）', !!replayA2);

  pA.ws.close(); pB.ws.close(); pC.ws.close(); pD.ws.close();
}

// --- 用例 4：静态断言（面板 XSS + 进程级兜底入口存在） ---
{
  console.log('[4] 静态断言：面板转义 / 进程兜底');
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const adminSrc = fs.readFileSync(path.join(dir, 'admin.html'), 'utf8');
  assert('admin.html 无裸拼 ${room.name}', !adminSrc.includes('${room.name}'));
  assert('admin.html 无裸拼 ${p.name}', !adminSrc.includes('${p.name}'));
  assert('admin.html 房间名/玩家名已过 esc()', adminSrc.includes('${esc(room.name)}') && adminSrc.includes('${esc(p.name)}'));

  const idxSrc = fs.readFileSync(path.join(dir, 'index.mjs'), 'utf8');
  assert('index.mjs 注册 uncaughtException 兜底', idxSrc.includes("process.on('uncaughtException'"));
  assert('index.mjs 注册 unhandledRejection 兜底', idxSrc.includes("process.on('unhandledRejection'"));
  assert('SIGINT/SIGTERM 优雅退出保留', idxSrc.includes("process.on('SIGINT', shutdown)") && idxSrc.includes("process.on('SIGTERM', shutdown)"));
}

await sleep(100);
const failed = results.filter(([, ok]) => !ok);
console.log(`\n服务器加固边界回归：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) { console.log('失败项：'); for (const [name] of failed) console.log('  - ' + name); process.exit(1); }
