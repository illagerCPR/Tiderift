// test-hardening-net.mjs -- 轮 5 服务器加固网络层回归（S6 限速扩档 / S7 皮肤端点加固 / S10 删房清理 /
// S11 协议版本校验 / S12 心跳热生效）。用法：node server/test-hardening-net.mjs（先启动 server/index.mjs，端口 3001）
import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION } from './protocol.js';
import * as store from './store.js';

const URL_WS = 'ws://127.0.0.1:3001/ws';
const BASE = 'http://127.0.0.1:3001';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const tag = Date.now().toString(36);
const suiteStart = Date.now();
const results = [];

function assert(name, cond, extra = '') {
  results.push([name, !!cond]);
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + ' ' + extra);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 管理 API：跑批中前序套件可能开启鉴权（config.json 持久化）——带未过期 op 账号
let opToken = null;
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
  const accs = Array.isArray(cfg.adminAccounts) ? cfg.adminAccounts : [];
  const live = accs.filter((a) => !a.expires || Date.now() / 1000 < a.expires);
  opToken = (live.find((a) => a.role !== 'viewer') || live[0] || {}).token || null;
} catch { /* 无 config = 未开鉴权 */ }

const api = async (method, p, body) => {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      ...(opToken ? { Authorization: 'Bearer ' + opToken } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

// 建连接（自动回 pong），不自动握手——版本用例需要观察 kicked
function open() {
  const ws = new WebSocket(URL_WS);
  const p = { ws, id: null, protocol: undefined, legacy: undefined, inbox: [], waiters: [], closed: false, pings: [] };
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'ping') { p.pings.push(Date.now()); ws.send(JSON.stringify({ t: 'pong' })); }
    p.inbox.push(m);
    for (let i = p.waiters.length - 1; i >= 0; i--) if (p.waiters[i](m)) p.waiters.splice(i, 1);
  });
  ws.on('close', () => { p.closed = true; });
  ws.on('error', () => {});
  return p;
}

const opened = (p) => new Promise((res, rej) => {
  if (p.ws.readyState === 1) return res();
  p.ws.on('open', res);
  p.ws.on('error', rej);
});

function waitFor(p, pred, timeout = 3000) {
  return new Promise((resolve) => {
    const hit = p.inbox.find(pred);
    if (hit) return resolve(hit);
    const t = setTimeout(() => resolve(null), timeout);
    p.waiters.push((m) => { if (pred(m)) { clearTimeout(t); resolve(m); return true; } return false; });
  });
}

function waitClosed(p, timeout = 2000) {
  if (p.closed) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeout);
    p.ws.once('close', () => { clearTimeout(t); resolve(true); });
  });
}

const OMIT = Symbol('omit-version'); // 显式表示「HELLO 不带 version 字段」（旧客户端）

// 握手：version=OMIT 表示省略该字段；null 表示字段值为 null
async function handshake(name, version = PROTOCOL_VERSION) {
  const p = open();
  await opened(p);
  const hello = { t: 'hello', name };
  if (version !== OMIT) hello.version = version;
  p.ws.send(JSON.stringify(hello));
  const w = await waitFor(p, (m) => m.t === 'welcome', 2000);
  if (w) { p.id = w.selfId; p.protocol = w.protocol; p.legacy = w.legacy; }
  return p;
}

const send = (p, t, d = {}) => p.ws.send(JSON.stringify({ t, ...d }));

// 合法档案样例（与 test-profile 同口径的 V2 紧凑格式）
const goodProfile = () => ({
  inventory: { slots: [{ n: 'dirt', c: 12 }, null, null], armor: [null, null, null, null] },
  position: { x: 12.5, y: 64, z: -3.25 },
  dim: 'overworld',
  health: 17.5, food: 18, saturation: 4, xp: 33, xpLevel: 2,
});

const rmRoom = (room) => api('POST', '/api/room/' + encodeURIComponent(room) + '/delete');

console.log('服务器加固（网络层）回归 ================');

// --- 用例 1（S11）：协议版本校验 ---
{
  console.log('[1] S11：协议版本校验');
  for (const bad of ['0.1', 2]) {
    const p = open();
    await opened(p);
    p.ws.send(JSON.stringify({ t: 'hello', name: 'ver-bad' + tag, version: bad }));
    const kick = await waitFor(p, (m) => m.t === 'kicked', 2000);
    assert('version=' + JSON.stringify(bad) + ' → 收 kicked', !!kick, kick ? 'reason=' + kick.reason : '无 kicked');
    assert('version=' + JSON.stringify(bad) + ' → 连接被关闭', await waitClosed(p));
    assert('version=' + JSON.stringify(bad) + ' → kicked 提示协议版本不一致', !!kick && /协议版本不一致/.test(kick.reason || ''), (kick && kick.reason) || '');
  }

  const ok = await handshake('ver-ok' + tag, PROTOCOL_VERSION);
  assert('version=PROTOCOL_VERSION → 正常收到 welcome', !!ok.id, 'id=' + ok.id);
  assert('welcome.protocol === PROTOCOL_VERSION', ok.protocol === PROTOCOL_VERSION, 'protocol=' + ok.protocol);
  assert('新客户端 welcome.legacy 非 true', ok.legacy !== true, 'legacy=' + ok.legacy);

  const legacy = await handshake('ver-legacy' + tag, OMIT);
  assert('无 version 字段 → welcome.legacy === true（按旧客户端放行）', legacy.legacy === true && !!legacy.id, 'legacy=' + legacy.legacy);
  assert('旧客户端 welcome 仍带 protocol', legacy.protocol === PROTOCOL_VERSION, 'protocol=' + legacy.protocol);
  const nullVer = await handshake('ver-null' + tag, null);
  assert('version: null → 同样按旧客户端放行（welcome.legacy === true）', nullVer.legacy === true && !!nullVer.id, 'legacy=' + nullVer.legacy);
  nullVer.ws.close();
  const lroom = 'hard-net-legacy-' + tag;
  send(legacy, 'join_room', { room: lroom });
  const lwi = await waitFor(legacy, (m) => m.t === 'world_info' && m.room === lroom, 3000);
  assert('旧客户端仍能 join_room（world_info 送达）', !!lwi, 'room=' + (lwi && lwi.room));
  legacy.ws.close(); ok.ws.close();
  await sleep(200);
  assert('清理一次性房间', (await rmRoom(lroom)).status === 200);
}

// --- 用例 2（S6）：join 档限速 ---
{
  console.log('[2] S6：join 档限速（create/join/switch 每条约一次整账本回放）');
  const room = 'hard-net-join-' + tag;
  const nick = 'jl' + tag; // 服务器昵称上限 16 字符：面板检索必须用同一短名
  const p = await handshake(nick, PROTOCOL_VERSION);
  send(p, 'create_room', { room, seed: 4242, mode: 'survival' });
  const w0 = await waitFor(p, (m) => m.t === 'world_info' && m.room === room, 3000);
  assert('建房成功（基线）', !!w0, 'room=' + (w0 && w0.room));
  await sleep(200);
  const before = p.inbox.filter((m) => m.t === 'world_info').length;
  for (let i = 0; i < 40; i++) send(p, 'join_room', { room });
  await sleep(1500);
  const got = p.inbox.filter((m) => m.t === 'world_info').length - before;
  assert('超出 join 档的请求不再产生 world_info', got < 40, 'world_info +' + got);
  assert('放行量与 join 档容量相符（默认 30/分钟）', got >= 15 && got <= 30, '+' + got);

  const st = await api('GET', '/api/status');
  const ri = (st.data.rooms || []).find((r) => r.name === room);
  const me = ri && (ri.players || []).find((pl) => pl.name === nick);
  assert('面板可见 dropped.join > 0（丢包上报口径已扩档）', !!(me && me.dropped && me.dropped.join > 0), JSON.stringify((me && me.dropped) || {}));
  p.ws.close();
  await sleep(200);
  assert('清理一次性房间', (await rmRoom(room)).status === 200);
}

// --- 用例 3（S7）：/api/skin/ 限频 + 日志节流 ---
{
  console.log('[3] S7：皮肤端点 IP 限频 + 日志聚合节流');
  // 可选外网探针：验证「缓存命中」口径（无外网/上游不可用时跳过，不阻塞 CI）
  let liveCache = false;
  try {
    const r1 = await fetch(BASE + '/api/skin/jeb_', { signal: AbortSignal.timeout(9000) });
    if (r1.status === 200) { await fetch(BASE + '/api/skin/jeb_'); liveCache = true; }
  } catch { liveCache = false; }
  if (!liveCache) console.log('SKIP  外网不可达，跳过「缓存命中」口径断言（其余断言不受影响）');

  const codes = [];
  for (let i = 0; i < 40; i++) codes.push((await fetch(BASE + '/api/skin/zz')).status);
  const n400 = codes.filter((c) => c === 400).length;
  const n429 = codes.filter((c) => c === 429).length;
  assert('非法用户名 → 400（校验出口不变）', n400 > 0, '400×' + n400);
  assert('超限 → 429（IP 限频生效）', n429 > 0, '429×' + n429);
  assert('40 连发未全部放行', n400 + n429 === 40 && n429 >= 5, '400×' + n400 + ' 429×' + n429);

  const logs = await api('GET', '/api/logs');
  const skinLogs = (logs.data.logs || []).filter((l) => l.op === 'skin-fetch' && l.time >= suiteStart);
  assert('skin-fetch 日志条目数远小于请求数（10s 窗口聚合）', skinLogs.length > 0 && skinLogs.length <= 3, 'entries=' + skinLogs.length);
  const agg = skinLogs.find((l) => /拉取皮肤 \d+ 次/.test(l.detail));
  assert('聚合日志含请求数/失败数/最近原因', !!agg && /失败 \d+/.test(agg.detail) && /最近：/.test(agg.detail), agg ? agg.detail : '');
  assert('聚合日志保留来源 IP（审计能力未丢）', !!agg && /127\.0\.0\.1/.test(agg.detail), agg ? agg.detail : '');
  if (liveCache) {
    assert('缓存命中计入聚合（第二次拉取走缓存）', skinLogs.some((l) => /缓存命中 [1-9]/.test(l.detail)), (skinLogs.find((l) => /缓存命中 [1-9]/.test(l.detail)) || {}).detail || '无');
  }
}

// --- 用例 4（S10）：删房清理世界/档案/备份 ---
{
  console.log('[4] S10：删房清理残留');
  const room = 'hard-net-del-' + tag;
  const p = await handshake('delroom' + tag, PROTOCOL_VERSION);
  send(p, 'create_room', { room, seed: 777, mode: 'survival' });
  const wi = await waitFor(p, (m) => m.t === 'world_info' && m.room === room, 3000);
  assert('建房成功', !!wi, 'room=' + (wi && wi.room));
  send(p, 'profile_save', { profile: goodProfile() });
  await sleep(300);
  p.ws.close();
  await sleep(400); // 退房即刷档案落盘
  const worldFile = path.join(DIR, 'world', room + '.json');
  const profFile = path.join(DIR, 'world', 'players', room + '.players.json');
  assert('前置：世界存档已落盘', fs.existsSync(worldFile), worldFile);
  assert('前置：玩家档案已落盘', fs.existsSync(profFile), profFile);

  // 备份：runAutoBackupOnce 每 60s 才跑一轮，这里直接调同一生产函数落一份，断言删房会清干净
  const backupFile = store.backupRoom({
    name: room, seed: 777, time: 0, nextDropId: 1, nextMobId: 1,
    dimensionBlocks: new Map(), dimensionContainers: new Map(), drops: new Map(),
  });
  const backupPath = path.join(DIR, 'world', 'backups', backupFile);
  assert('前置：备份文件已生成', fs.existsSync(backupPath), backupFile);

  const del = await rmRoom(room);
  assert('删房 API 返回 200', del.status === 200, JSON.stringify(del.data));
  assert('世界存档已删除', !fs.existsSync(worldFile));
  assert('玩家档案已删除（同名重建不再复活旧档）', !fs.existsSync(profFile));
  assert('该房间全部备份已删除', !fs.existsSync(backupPath));
  const st2 = await api('GET', '/api/status');
  assert('房间已从内存注册表移除', !(st2.data.rooms || []).some((r) => r.name === room));
}

// --- 用例 5（S12）：心跳热生效 ---
{
  console.log('[5] S12：心跳周期活读');
  const cfg0 = await api('GET', '/api/config');
  const prevHb = cfg0.data.config && cfg0.data.config.heartbeatMs;
  const p = await handshake('hb' + tag, PROTOCOL_VERSION);

  await api('POST', '/api/config', { heartbeatMs: 2000 });
  const t0 = Date.now();
  while (p.pings.filter((t) => t >= t0).length < 2 && Date.now() - t0 < 8000) await sleep(100);
  const fast = p.pings.filter((t) => t >= t0);
  assert('改小后首个 ping ≤3s 到达（新周期立即生效）', fast.length >= 1 && fast[0] - t0 <= 3000, 'first=+' + (fast[0] - t0) + 'ms');
  assert('相邻 ping 间隔≈新周期 2s（pong 往返计时为证）', fast.length >= 2 && (fast[1] - fast[0]) <= 3000, 'gap=' + (fast.length >= 2 ? (fast[1] - fast[0]) : 'n/a') + 'ms');

  await api('POST', '/api/config', { heartbeatMs: 60000 });
  await sleep(1200); // 让「改大前已到期」的 ping 先落地
  const quietFrom = Date.now();
  await sleep(2500);
  const slow = p.pings.filter((t) => t >= quietFrom).length;
  assert('改大后 2.5s 内无 ping（周期确实每轮现读，不是连接建立时固化）', slow === 0, 'pings=' + slow);

  const restore = await api('POST', '/api/config', { heartbeatMs: prevHb || 15000 });
  assert('心跳配置已恢复原值（不污染后续套件）', restore.status === 200 && restore.data.config.heartbeatMs === (prevHb || 15000), 'heartbeatMs=' + (restore.data.config && restore.data.config.heartbeatMs));
  p.ws.close();
}

// --- 用例 6：静态盘点（源码级防回退绊线） ---
{
  console.log('[6] 静态断言：加固点未回退');
  const srv = fs.readFileSync(path.join(DIR, 'index.mjs'), 'utf8');
  assert('三跳 fetch 均带 5s 超时', (srv.match(/AbortSignal\.timeout\(SKIN_FETCH_TIMEOUT_MS\)/g) || []).length === 3);
  assert('皮肤缓存有上限并惰性清扫', srv.includes('const SKIN_CACHE_MAX = 200;') && srv.includes('skinCacheSet(cacheKey, payload)'));
  assert('皮肤 PNG 域名白名单在位（且 http 自动升级 https）', srv.includes("const SKIN_URL_HOST = 'textures.minecraft.net';") && srv.includes('u.hostname === SKIN_URL_HOST') && srv.includes("u.href.replace(/^http:/, 'https:')"));
  assert('skin-fetch 日志走 10s 聚合节流', srv.includes("logAdmin('skin-fetch', skinFetchNote(ip, username, r), ip)"));
  assert('删房清理档案/备份/时间戳齐全', srv.includes('store.deletePlayerProfiles(roomName)') && srv.includes('store.pruneBackups(roomName, 0)') && srv.includes('lastBackupAt.delete(roomName)'));
  assert('丢包上报遍历 dropped 全部键', srv.includes('for (const k of Object.keys(d))'));
  assert('世界账本 1s 强刷扫描已接线', srv.includes('const worldFlushSweep = setInterval(') && srv.includes('clearInterval(worldFlushSweep)'));
  assert('心跳定时器随连接关闭清理', srv.includes('clearTimeout(hbTimer)'));

  const rl = fs.readFileSync(path.join(DIR, 'ratelimit.js'), 'utf8');
  assert('join 档覆盖 CREATE/JOIN/SWITCH_ROOM', /MSG\.CREATE_ROOM \|\| msgType === MSG\.JOIN_ROOM \|\| msgType === MSG\.SWITCH_ROOM/.test(rl));
  assert('skin/profile 档已接入 tierOf 与连接限速器组', rl.includes("return 'skin'") && rl.includes("return 'profile'") && rl.includes('join: new RateLimiter') && rl.includes('skin: new RateLimiter') && rl.includes('profile: new RateLimiter'));
  const cfgSrc = fs.readFileSync(path.join(DIR, 'config.js'), 'utf8');
  assert('默认限速四档齐备（join30/skin30/profile60/skinFetch30）', /join: 30,/.test(cfgSrc) && /skin: 30,/.test(cfgSrc) && /profile: 60,/.test(cfgSrc) && /skinFetch: 30,/.test(cfgSrc));
  assert('sanitizeRateLimits 键集含新档', cfgSrc.includes("['chat', 'block', 'state', 'join', 'skin', 'profile', 'skinFetch']"));
}

// 皮肤 IP 令牌桶是跨套件共享的进程内状态：留足补充时间，避免后续套件（test-skinlog）连吃 429
await sleep(5000);

const failed = results.filter(([, ok]) => !ok);
console.log('\n服务器加固（网络层）回归：' + (results.length - failed.length) + '/' + results.length + ' 通过');
if (failed.length) { console.log('失败项：'); for (const [name] of failed) console.log('  - ' + name); process.exit(1); }
