// test-idea4.mjs -- Idea-4 服务器回归：A 房间配置开关（PvP/怪物）+ B 世界备份 + C 消息速率限制
// 覆盖：API 校验/落盘、world_info.settings 下发、服务器权威过滤（攻击/怪物）、
//       room_settings 热广播（异房间不串扰）、重开生效、默认全开、
//       备份导出（内存/磁盘/404/权限）、store 备份修剪、限速丢包/热恢复/心跳豁免/日志聚合
// 用法：node server/test-idea4.mjs   （先启动 server/index.mjs，端口 3001）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';

// 命名避开全局类（const URL 会遮蔽全局 URL 构造器，new URL 在 try 内静默炸掉的教训）
const WS_URL = 'ws://127.0.0.1:3001/ws';
const API = 'http://127.0.0.1:3001/api';
const results = [];

function assert(name, cond, extra = '') {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const p = { ws, id: null, name, inbox: [], waiters: [], closed: false };
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

// 管理接口可能已开鉴权（跑批中前序套件建号并持久化 config）：
// op 测试用未过期 op 账号；viewer 403 用 role='viewer' 账号（无账号则该条走"未开启鉴权放行"分支）
const cfgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');
let opToken = null, viewerToken = null, authOn = false;
try {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const accs = Array.isArray(cfg.adminAccounts) ? cfg.adminAccounts : [];
  const live = accs.filter((a) => !a.expires || Date.now() / 1000 < a.expires);
  opToken = (live.find((a) => a.role !== 'viewer') || live[0] || {}).token || null;
  viewerToken = (live.find((a) => a.role === 'viewer') || {}).token || null;
  authOn = live.length > 0;
} catch { /* 无 config = 未开鉴权 */ }

const api = async (method, p, body = null, token = opToken) => {
  const res = await fetch(API + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

// Idea-4B：备份接口返回附件，需要原始 headers/text
const rawApi = async (method, p, token = opToken) => {
  const res = await fetch(API + p, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, headers: res.headers, text: await res.text() };
};

const ROOM = `i4a-${Date.now()}`;
const ROOM_DEF = `i4a-def-${Date.now()}`;
const ROOM_OTHER = `i4a-other-${Date.now()}`;

// ---- 1. API 基础：GET 全表 + 非法 body 拒绝 ----
{
  const r0 = await api('GET', '/settings');
  assert('GET /api/settings 200 且 roomSettings 为对象', r0.status === 200 && r0.data.roomSettings && typeof r0.data.roomSettings === 'object');

  const bad1 = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, { pvp: 1 });
  assert('pvp 非 boolean → 400', bad1.status === 400, `got ${bad1.status}`);
  const bad2 = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, {});
  assert('空 patch → 400', bad2.status === 400, `got ${bad2.status}`);
}

// ---- 2. 关闭 PvP + 怪物 → 落盘 + 回显 ----
{
  const r = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, { pvp: false, mobs: false });
  assert('POST 关闭 pvp+mobs → 200 回显', r.status === 200 && r.data.ok && r.data.settings.pvp === false && r.data.settings.mobs === false);
  let persisted = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    persisted = cfg.roomSettings && cfg.roomSettings[ROOM] && cfg.roomSettings[ROOM].pvp === false && cfg.roomSettings[ROOM].mobs === false;
  } catch { /* config 不存在 */ }
  assert('配置已落盘 config.json', persisted);
}

// ---- 3. world_info.settings 下发（创建/加入两条路径）----
const A = await connect('i4a-甲');
send(A, 'create_room', { room: ROOM, seed: 4451, mode: 'survival' });
const wiA = await waitFor(A, (m) => m.t === 'world_info');
assert('创建者 world_info 带 settings pvp=false', !!wiA && wiA.settings && wiA.settings.pvp === false && wiA.settings.mobs === false);

const B = await connect('i4a-乙');
send(B, 'join_room', { room: ROOM });
const wiB = await waitFor(B, (m) => m.t === 'world_info');
assert('加入者 world_info 带 settings pvp=false', !!wiB && wiB.settings && wiB.settings.pvp === false && wiB.settings.mobs === false);

// 对照组：另一房间在线玩家（热广播不得串扰）
const C = await connect('i4a-丙');
send(C, 'create_room', { room: ROOM_OTHER, seed: 4452, mode: 'survival' });
await waitFor(C, (m) => m.t === 'world_info');

// ---- 4. PvP 关闭：服务器权威短路 ----
{
  await sleep(150);
  send(A, 'attack_player', { targetId: B.id, damage: 5 });
  const hitB = await waitFor(B, (m) => m.t === 'attack_player', 1200);
  assert('PvP 关：受害者收不到 attack_player', hitB === null);
  const hint = await waitFor(A, (m) => m.t === 'chat' && m.from === '系统' && /PvP/.test(m.text || ''), 1500);
  assert('PvP 关：攻击者收到系统提示', !!hint);
}

// ---- 5. 怪物生成关闭：不分配 id 不转发 ----
{
  await sleep(150);
  send(A, 'mob_spawn', { type: 'zombie', x: 1, y: 66, z: 1 });
  const mA = await waitFor(A, (m) => m.t === 'mob_spawn', 1200);
  const mB = await waitFor(B, (m) => m.t === 'mob_spawn', 300);
  assert('mobs 关：发起者收不到 mob_spawn 回执', mA === null);
  assert('mobs 关：他人收不到 mob_spawn', mB === null);
  const hint = await waitFor(A, (m) => m.t === 'chat' && m.from === '系统' && /怪物/.test(m.text || ''), 1500);
  assert('mobs 关：发起者收到系统提示', !!hint);
}

// ---- 6. 热广播：同房间收到、异房间不串扰；随后恢复生效 ----
{
  const r = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, { pvp: true });
  const rsA = await waitFor(A, (m) => m.t === 'room_settings', 1500);
  const rsB = await waitFor(B, (m) => m.t === 'room_settings', 300);
  const rsC = C.inbox.find((m) => m.t === 'room_settings');
  assert('热广播：同房间玩家收到 room_settings', !!rsA && rsA.pvp === true && rsA.mobs === false && rsA.room === ROOM);
  assert('热广播：同房间第二人收到', !!rsB);
  assert('热广播：异房间玩家不串扰', !rsC);

  // 恢复后 PvP 攻击照常中继
  await sleep(150);
  send(A, 'attack_player', { targetId: B.id, damage: 5 });
  const hitB = await waitFor(B, (m) => m.t === 'attack_player' && m.fromId === A.id, 1500);
  assert('PvP 开：attack_player 正常中继', !!hitB);
}

// ---- 7. mobs 单独恢复 → 怪物转发恢复（含发起者回执）----
{
  const r = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, { mobs: true });
  assert('POST 单独开 mobs → 200（pvp 保持开）', r.status === 200 && r.data.settings.pvp === true && r.data.settings.mobs === true);
  const rsB = await waitFor(B, (m) => m.t === 'room_settings' && m.mobs === true, 1500);
  assert('热广播：mobs 恢复送达', !!rsB);
  await sleep(150);
  send(A, 'mob_spawn', { type: 'zombie', x: 2, y: 66, z: 2 });
  const mA = await waitFor(A, (m) => m.t === 'mob_spawn' && m.type === 'zombie', 1500);
  const mB = await waitFor(B, (m) => m.t === 'mob_spawn' && m.type === 'zombie', 300);
  assert('mobs 开：发起者收到回执', !!mA);
  assert('mobs 开：他人收到广播', !!mB);
}

// ---- 8. 未配置房间 = 默认全开 ----
{
  const D = await connect('i4a-丁');
  send(D, 'create_room', { room: ROOM_DEF, seed: 4453, mode: 'survival' });
  const wi = await waitFor(D, (m) => m.t === 'world_info');
  assert('未配置房间 world_info.settings 默认全开', !!wi && wi.settings && wi.settings.pvp === true && wi.settings.mobs === true);
  D.ws.close();
}

// ---- 9. viewer 角色 POST → 403（鉴权开启时）----
{
  if (authOn && viewerToken) {
    const r = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, { pvp: false }, viewerToken);
    assert('viewer POST settings → 403', r.status === 403, `got ${r.status}`);
    const g = await api('GET', '/settings', null, viewerToken);
    assert('viewer GET settings → 200', g.status === 200, `got ${g.status}`);
  } else {
    assert('viewer 403（跳过：鉴权未开启）', true);
  }
}

// ---- 10. Idea-4B：世界备份导出 ----
{
  // 房间在内存（A 在线）→ 内存快照
  const r = await rawApi('GET', `/room/${encodeURIComponent(ROOM)}/backup`);
  const disp = r.headers.get('content-disposition') || '';
  let snap = null;
  try { snap = JSON.parse(r.text); } catch { /* 非法 JSON */ }
  assert('备份导出 200 + attachment 头', r.status === 200 && /attachment/.test(disp), `got ${r.status}`);
  assert('备份内容为完整快照（name/seed/dimensionBlocks）', !!snap && snap.name === ROOM && Number.isInteger(snap.seed) && typeof snap.dimensionBlocks === 'object');

  // 房间不在内存、无磁盘存档 → 404
  const r404 = await rawApi('GET', `/room/${encodeURIComponent('i4a-nope-' + Date.now())}/backup`);
  assert('未知房间备份 → 404', r404.status === 404, `got ${r404.status}`);

  // 磁盘存档回读（房间未被本次启动触碰）
  const diskName = 'i4b-diskroom';
  fs.writeFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'world', store.roomFileName(diskName) + '.json'),
    JSON.stringify({ name: diskName, seed: 777, time: 0.5, nextDropId: 1, nextMobId: 1, dimensionBlocks: {}, dimensionContainers: {}, drops: [] }),
  );
  const rDisk = await rawApi('GET', `/room/${encodeURIComponent(diskName)}/backup`);
  let diskSnap = null;
  try { diskSnap = JSON.parse(rDisk.text); } catch { /* 非法 JSON */ }
  assert('磁盘存档回读导出（无内存房间）', rDisk.status === 200 && !!diskSnap && diskSnap.seed === 777);
  fs.unlinkSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'world', store.roomFileName(diskName) + '.json'));

  // viewer 权限（鉴权开启时）
  if (authOn && viewerToken) {
    const rv = await rawApi('GET', `/room/${encodeURIComponent(ROOM)}/backup`, viewerToken);
    assert('viewer 备份导出 → 403（op 专属）', rv.status === 403, `got ${rv.status}`);
  } else {
    assert('viewer 备份 403（跳过：鉴权未开启）', true);
  }

  // store 层：备份写入 / 列表排序 / 修剪保留份数
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i4b-backup-'));
  const fakeRoom = { name: 'i4b-单测', seed: 1, biomeScale: null, time: 0.5, nextDropId: 1, nextMobId: 1, dimensionBlocks: new Map(), dimensionContainers: new Map(), drops: new Map() };
  const f1 = store.backupRoom(fakeRoom, tmp);
  await sleep(5);
  const f2 = store.backupRoom(fakeRoom, tmp);
  await sleep(5);
  const f3 = store.backupRoom(fakeRoom, tmp);
  const list = store.listBackups('i4b-单测', tmp);
  assert('backupRoom 写入 + listBackups 排序（最新在前）', list.length === 3 && list[0].file === f3 && list[1].file === f2 && list[2].file === f1);
  const removed = store.pruneBackups('i4b-单测', 1, tmp);
  assert('pruneBackups 只保留最新 1 份', removed.length === 2 && store.listBackups('i4b-单测', tmp).length === 1);
  fs.rmSync(tmp, { recursive: true, force: true });

  // 自动备份配置读写与范围校验（非法值忽略）
  const cfgSet = await api('POST', '/config', { backupIntervalMinutes: 30, backupKeep: 5 });
  assert('自动备份配置保存 → 200', cfgSet.status === 200 && cfgSet.data.config.backupIntervalMinutes === 30 && cfgSet.data.config.backupKeep === 5);
  const cfgBad = await api('POST', '/config', { backupIntervalMinutes: 99999, backupKeep: 0 });
  assert('自动备份非法值忽略（保持原值）', cfgBad.status === 200 && cfgBad.data.config.backupIntervalMinutes === 30 && cfgBad.data.config.backupKeep === 5);
}

// ---- 11. Idea-4C：消息速率限制（chat/block/state 分级令牌桶）----
{
  // 收紧三档到 3 次/分钟
  const tighten = await api('POST', '/config', { rateLimits: { chat: 3, block: 3, state: 3 } });
  assert('限速配置收紧 → 200 回显', tighten.status === 200 && tighten.data.config.rateLimits.chat === 3 && tighten.data.config.rateLimits.block === 3 && tighten.data.config.rateLimits.state === 3);
  const badRl = await api('POST', '/config', { rateLimits: '垃圾' });
  assert('rateLimits 非对象 → 保持原值', badRl.status === 200 && badRl.data.config.rateLimits.chat === 3);

  await sleep(150);
  // chat：5 发 3 中
  for (let i = 0; i < 5; i++) send(A, 'chat', { text: `限速${i}` });
  await sleep(500);
  const gotB = B.inbox.filter((m) => m.t === 'chat' && m.fromId === A.id && (m.text || '').startsWith('限速')).length;
  assert('chat 桶：5 条只广播 3 条', gotB === 3, `got ${gotB}`);

  // block：5 发 3 中
  for (let i = 0; i < 5; i++) send(A, 'block_set', { x: 10 + i, y: 70, z: 10, id: 3 });
  await sleep(500);
  const gotBlocks = B.inbox.filter((m) => m.t === 'block_change' && m.by === A.id).length;
  assert('block 桶：5 条只广播 3 条', gotBlocks === 3, `got ${gotBlocks}`);

  // state：5 发 3 中
  for (let i = 0; i < 5; i++) send(A, 'player_state', { x: 1, y: 66, z: 1, yaw: 0, pitch: 0 });
  await sleep(500);
  const gotStates = B.inbox.filter((m) => m.t === 'player_state' && m.id === A.id).length;
  assert('state 桶：5 条只广播 3 条', gotStates === 3, `got ${gotStates}`);

  // PING 豁免：桶耗尽后心跳仍通
  send(A, 'ping', { seq: 4321, ts: 1 });
  const pong = await waitFor(A, (m) => m.t === 'pong' && m.seq === 4321, 1500);
  assert('PING 不受限速（心跳豁免）', !!pong);

  // 丢包计数进 /api/status
  const st = await api('GET', '/status');
  const players = (st.data.rooms || []).find((x) => x.name === ROOM)?.players || [];
  const pa = players.find((x) => x.name === A.name) || {};
  assert('status 携带 dropped 计数（chat/block/state 各≥2）', (pa.dropped?.chat || 0) >= 2 && (pa.dropped?.block || 0) >= 2 && (pa.dropped?.state || 0) >= 2, JSON.stringify(pa.dropped || {}));

  // 聚合日志（10s sweep，轮询最多 13s）
  let logged = false;
  for (let i = 0; i < 13 && !logged; i++) {
    await sleep(1000);
    const lg = await api('GET', '/logs');
    logged = (lg.data.logs || []).some((l) => l.op === 'rate-limit');
  }
  assert('rate-limit 聚合日志落 adminLog', logged);

  // 热恢复：限额回升后立即放行
  const restore = await api('POST', '/config', { rateLimits: { chat: 30, block: 900, state: 1800 } });
  assert('限速恢复默认 → 200', restore.status === 200 && restore.data.config.rateLimits.chat === 30);
  await sleep(150);
  send(A, 'chat', { text: '恢复后通了' });
  const okMsg = await waitFor(B, (m) => m.t === 'chat' && (m.text || '') === '恢复后通了', 1500);
  assert('热生效：恢复后消息不再被丢', !!okMsg);
}

// ---- 清理：删除测试房间 + 还原配置（防污染后续套件/重复跑批）----
for (const rn of [ROOM, ROOM_DEF, ROOM_OTHER]) {
  await api('POST', `/room/${encodeURIComponent(rn)}/delete`, {});
}
await api('POST', '/config', { backupIntervalMinutes: 0, backupKeep: 10, rateLimits: { chat: 30, block: 900, state: 1800 }, roomSettings: {} });
A.ws.close(); B.ws.close(); C.ws.close();

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n结果: ${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
