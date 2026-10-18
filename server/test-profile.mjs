// test-profile.mjs -- Idea-3C 服务器回归：玩家档案（上报收录 / 进房下发 / 脏包拒绝 / 管理清理 / 落盘往返）
// 用法：node server/test-profile.mjs   （先启动 server/index.mjs，端口 3001；跑批前清空 server/world/ 与 server/config.json）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import * as store from './store.js';
import { sanitizePlayerProfile } from './room.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    const p = { ws, id: null, inbox: [], waiters: [], closed: false };
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

// 管理接口可能已开鉴权（跑批中前序 test-admin 会建号并持久化 config）：
// 从 config.json 取一个未过期账号口令带 Bearer 头；无账号则裸调
let adminToken = null;
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json'), 'utf8'));
  const accs = Array.isArray(cfg.adminAccounts) ? cfg.adminAccounts : [];
  const acc = accs.find((a) => !a.expires || Date.now() / 1000 < a.expires);
  if (acc) adminToken = acc.token;
} catch { /* 无 config = 未开鉴权 */ }

const api = async (method, path, body = null) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

// 合法档案样例（客户端 SaveSystem serialize() 的 V2 紧凑格式）
const goodProfile = () => ({
  inventory: {
    slots: [
      { n: 'dirt', c: 12 }, { n: 'shulker_box', c: 1, d: [{ name: 'diamond', count: 3 }, null, null] },
      null, null, null, null, null, null, null,
    ],
    armor: [null, null, null, null],
  },
  position: { x: 12.5, y: 64, z: -3.25 },
  dim: 'overworld',
  health: 17.5,
  food: 18,
  saturation: 4,
  xp: 33,
  xpLevel: 2,
});

// --- 用例 1：sanitizePlayerProfile 单元校验 ---
{
  const ok = sanitizePlayerProfile(goodProfile());
  assert('sanitize 合法档案通过', !!ok && ok.position.x === 12.5 && ok.health === 17.5);
  assert('sanitize 槽位补齐 36', ok && Array.isArray(ok.inventory.slots) && ok.inventory.slots.length === 36);
  assert('sanitize 盒内容保留', ok && ok.inventory.slots[1] && Array.isArray(ok.inventory.slots[1].d) && ok.inventory.slots[1].d[0].name === 'diamond');
  assert('sanitize 拒绝缺位置', !sanitizePlayerProfile({ ...goodProfile(), position: null }));
  assert('sanitize 拒绝非有限坐标', !sanitizePlayerProfile({ ...goodProfile(), position: { x: 'NaN串', y: 0, z: 0 } }));
  assert('sanitize 拒绝过深坐标', !sanitizePlayerProfile({ ...goodProfile(), position: { x: 0, y: 5000, z: 0 } }));
  assert('sanitize 拒绝盒中盒', !sanitizePlayerProfile({
    ...goodProfile(),
    inventory: { slots: [{ n: 'shulker_box', c: 1, d: [{ n: 'shulker_box', c: 1, d: [] }] }], armor: [] },
  }));
  assert('sanitize 拒绝 armor 超长', !sanitizePlayerProfile({
    ...goodProfile(),
    inventory: { slots: [], armor: [null, null, null, null, null, null] },
  }));
  assert('sanitize 拒绝非对象', !sanitizePlayerProfile('垃圾') && !sanitizePlayerProfile(null));
}

// --- 用例 2：上报收录 → 断线 → 重进下发（核心闭环） ---
const room = `profile-test-${Date.now()}`;
{
  const a = await connect('档案甲');
  send(a, 'create_room', { room, seed: 20260912, mode: 'survival' });
  assert('甲建房', !!(await waitFor(a, (m) => m.t === 'room_created')));

  send(a, 'profile_save', { profile: goodProfile() });
  await sleep(300); // 等服务器收录

  // 未退房强制看内存（走管理 API）：档案已收录
  const list1 = await api('GET', `/room/${encodeURIComponent(room)}/players`);
  assert('上报后档案可查', list1.status === 200 && list1.data.players.length === 1 && list1.data.players[0].nick === '档案甲',
    `status=${list1.status} data=${JSON.stringify(list1.data).slice(0, 120)} token=${adminToken ? '有' : '无'}`);

  a.ws.close(); // 退房 → removePlayer 立即刷盘
  await sleep(300);

  const a2 = await connect('档案甲');
  send(a2, 'join_room', { room });
  assert('重进房间', !!(await waitFor(a2, (m) => m.t === 'room_created' || m.t === 'world_info')));
  const profMsg = await waitFor(a2, (m) => m.t === 'player_profile');
  assert('重进收到 player_profile', !!profMsg && !!profMsg.profile);
  assert('下发档案含背包', !!profMsg && profMsg.profile.inventory.slots[0] && profMsg.profile.inventory.slots[0].n === 'dirt');
  assert('下发档案含盒内容', !!profMsg && profMsg.profile.inventory.slots[1] && Array.isArray(profMsg.profile.inventory.slots[1].d) && profMsg.profile.inventory.slots[1].d[0].name === 'diamond');
  a2.ws.close();
  await sleep(200);
}

// --- 用例 3：脏档案整体拒绝（不下发、不落库） ---
{
  const b = await connect('档案乙');
  send(b, 'join_room', { room });
  await waitFor(b, (m) => m.t === 'room_created' || m.t === 'world_info');

  const bad1 = goodProfile();
  bad1.inventory.slots = '不是数组';
  send(b, 'profile_save', { profile: bad1 });
  const bad2 = goodProfile();
  bad2.position = { x: Infinity, y: 0, z: 0 }; // JSON.stringify(Infinity) → null → safeNum(null)=null? 注意：null → fallback(null) → null → 拒绝
  send(b, 'profile_save', { profile: bad2 });
  await sleep(300);

  const list2 = await api('GET', `/room/${encodeURIComponent(room)}/players`);
  const nicks = list2.data.players.map((p) => p.nick);
  assert('脏档案不入库', list2.status === 200 && !nicks.includes('档案乙'), `当前档案: ${nicks.join(',') || '无'}`);
  b.ws.close();
  await sleep(200);
}

// --- 用例 4：管理 API 清除档案（伪造昵称覆盖的清理入口） ---
{
  const c = await connect('档案丙');
  send(c, 'join_room', { room });
  await waitFor(c, (m) => m.t === 'room_created' || m.t === 'world_info');
  send(c, 'profile_save', { profile: goodProfile() });
  await sleep(300);

  const del = await api('DELETE', `/room/${encodeURIComponent(room)}/players/${encodeURIComponent('档案丙')}`);
  assert('DELETE 清除档案', del.status === 200 && del.data.ok);
  const del2 = await api('DELETE', `/room/${encodeURIComponent(room)}/players/${encodeURIComponent('档案丙')}`);
  assert('重复 DELETE 返回 404', del2.status === 404);

  const d = await connect('档案丁');
  send(d, 'join_room', { room });
  await waitFor(d, (m) => m.t === 'room_created' || m.t === 'world_info');
  const profMsg = await waitFor(d, (m) => m.t === 'player_profile' && m.profile && m.profile.savedAt);
  // 丁没有上报过档案 → 不应收到丙的（已删）也不应收到自己的（从未有）
  assert('已删档案不再下发', !profMsg);
  d.ws.close();
  await sleep(200);
}

// --- 用例 5：store 文件往返（独立 players 目录） ---
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-'));
  store.savePlayerProfiles('往返房间', { 甲: goodProfile() }, tmp);
  const back = store.loadPlayerProfiles('往返房间', tmp);
  assert('档案文件往返一致', back && back['甲'] && back['甲'].position.x === 12.5);
  store.deletePlayerProfiles('往返房间', tmp);
  assert('删除后读回为空', Object.keys(store.loadPlayerProfiles('往返房间', tmp)).length === 0);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- 用例 6：换维档案不串位置（dim 不同 → 客户端逻辑职责，服务器只存 dim 字段） ---
{
  const e = await connect('档案戊');
  send(e, 'join_room', { room });
  await waitFor(e, (m) => m.t === 'room_created' || m.t === 'world_info');
  const nether = goodProfile();
  nether.dim = 'nether';
  nether.position = { x: 100, y: 40, z: 100 };
  send(e, 'profile_save', { profile: nether });
  await sleep(300);
  const list = await api('GET', `/room/${encodeURIComponent(room)}/players`);
  const row = list.data.players.find((p) => p.nick === '档案戊');
  assert('异维档案 dim 落库', !!row && row.dim === 'nether');
  e.ws.close();
  await sleep(200);
}

// 清理：房间文件 + 档案文件
store.deleteRoomFile(room);
store.deletePlayerProfiles(room);
store.deleteRoomFile(room.replace('profile-test-', 'profile-test-')); // 幂等兜底

const failed = results.filter(([, ok]) => !ok);
console.log(`\n=== test-profile: ${results.length - failed.length}/${results.length} 通过 ===`);
process.exit(failed.length ? 1 : 0);
