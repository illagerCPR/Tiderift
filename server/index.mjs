// index.mjs -- Project-MC 局域网联机服务器入口
// 用法：node server/index.mjs  （端口可用环境变量 PORT 覆盖，默认 3001）
// WebSocket 路径固定为 /ws
// 阶段 3：多房间（房间名隔离世界）+ 世界落盘（server/world/<房间名>.json，重启恢复）
// 阶段 4：服务器配置面板（http://<host>:<port>/ 管理页 + /api/* JSON 接口 + server/config.json 持久化配置）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { MSG, PROTOCOL_VERSION } from './protocol.js';
import * as store from './store.js';
import * as config from './config.js';
import { roomStats } from './stats.js';
import { tierOf, createConnectionLimiters, RateLimiter } from './ratelimit.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// 服务器配置（管理面板可改，落盘 config.json，重启保留）
const serverConfig = config.loadConfig();
const BOOT_TIME = Math.floor(Date.now() / 1000);

// 房间管理器：房间名 -> Room（同名房间共享同一世界，世界按名隔离并落盘）
const rooms = new Map();
let nextPlayerId = 1;

// S4：房间名统一口径——trim 后截断 40 字符（对齐 store.roomFileName 落盘口径，内存 key 与磁盘文件名一致）
const ROOM_NAME_MAX = 40;
function normalizeRoomName(name) {
  return String(name || '').trim().slice(0, ROOM_NAME_MAX) || 'default';
}

// 取（或创建）指定房间；创建时若磁盘有该房间存档则恢复其世界
function getRoom(name) {
  const key = normalizeRoomName(name);
  let room = rooms.get(key);
  if (!room) {
    room = new Room(key, (r) => store.saveRoom(r), serverConfig);
    room.playerProfiles = store.loadPlayerProfiles(key); // Idea-3C：档案随房间装入内存
    room.onSaveProfiles = (r) => store.savePlayerProfiles(r.name, r.playerProfiles);
    const snap = store.loadRooms().find((s) => s.name === key);
    if (snap) {
      room.restore(snap);
      console.log(`[世界] 恢复房间「${key}」seed=${room.seed} 方块${room.blocksTotal()} 掉落${room.drops.size}`);
    }
    rooms.set(key, room);
  }
  return room;
}

// B38 L2：房间是否「活着」（有人在线）——统计空房回收与 /api/stats 过滤共用这一条判据
function roomIsActive(name) {
  const r = rooms.get(name);
  return !!r && r.players.size > 0;
}

// 阶段11：房间白名单（config.roomWhitelist，名单为空/不存在 = 不启用，所有人可进）
function whitelistAllows(roomName, playerName) {
  const list = serverConfig.roomWhitelist && serverConfig.roomWhitelist[roomName];
  if (!list || !list.length) return true;
  return list.includes(playerName);
}

// 初次进房（create_room/join_room）白名单拒绝：发 kicked（客户端停止自动重连）后断开底层连接
function rejectByWhitelist(player, roomName) {
  send(player.ws, { t: MSG.KICKED, reason: `房间「${roomName}」已启用白名单，你的昵称不在名单内` });
  setTimeout(() => { try { player.ws.close(); } catch {} }, 50);
  console.log(`[拒绝] ${player.name} 试图进入白名单房间「${roomName}」`);
}

// 服务器聊天命令（/rooms /seed /room /rebuild /help），结果只回给发起者
function handleCommand(player, text) {
  const args = text.slice(1).trim().split(/\s+/);
  const cmd = args[0] || '';
  const room = player.room;
  if (!room) return;
  let reply = '';
  if (cmd === 'rooms') {
    const list = [...rooms.values()].map((r) => `「${r.name}」${r.players.size}人 seed=${r.seed}`).join('  ');
    reply = `现有房间: ${list || '无'}`;
  } else if (cmd === 'seed') {
    reply = `当前房间「${room.name}」seed=${room.seed} 方块改动${room.blocksTotal()} 掉落${room.drops.size}`;
  } else if (cmd === 'dim') {
    // M4：聊天命令换维（联机无作弊面板时的统一入口）
    const target = args.slice(1).join(' ').trim();
    if (!target) reply = '用法: /dim <overworld|nether|end|aether> 切换维度';
    else { room.onSwitchDimension(player, { dim: target }); return; }
  } else if (cmd === 'room') {
    const target = args.slice(1).join(' ').trim();
    if (!target) reply = '用法: /room <房间名> 切换到其它房间（无需回主菜单）';
    else {
      switchRoom(player, target);
      return; // 切换结果经 WORLD_INFO/聊天消息告知
    }
  } else if (cmd === 'rebuild' || cmd === 'reset' || cmd === 'regen') {
    if (!room.isOperator(player)) reply = '只有房主(HOST)/op 可以重建世界'; // 阶段11：op 名单放行
    else {
      room.resetWorld();
      return; // 重建结果经 WORLD_INFO(restart) 广播告知
    }
  } else if (cmd === 'help') {
    reply = '命令: /rooms 列出房间  /seed 当前世界  /room <名> 切换房间  /rebuild 重建世界(host/op)  /dim <名> 切换维度  /help 帮助';
  } else {
    reply = `未知命令 /${cmd}（/help 查看）`;
  }
  room.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: reply });
}

// 世界内换房（阶段5）：保持 WebSocket 连接，离开当前房间并加入目标房间，客户端重启本地世界
function switchRoom(player, roomName) {
  const key = normalizeRoomName(roomName);
  if (!player.room) return;
  if (key === player.room.name) {
    player.room.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: `你已在房间「${key}」` });
    return;
  }
  // 阶段11：换房同样受目标房间白名单约束（游戏内用聊天提示而非踢下线）
  if (!whitelistAllows(key, player.name)) {
    player.room.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: `房间「${key}」已启用白名单，无法切换（继续留在当前房间）` });
    return;
  }
  const target = getRoom(key);
  if (target.isFull()) {
    player.room.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: `房间「${key}」已满，无法切换（继续留在当前房间）` });
    return;
  }
  const oldRoom = player.room;
  oldRoom.removePlayer(player.id);
  player.room = null;
  if (!target.addPlayer(player)) return; // 理论不会触发（已先检查满）
  player.room = target;
  target.joinRoom(player, {}, { restart: true });
  target.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: `已切换到房间「${target.name}」seed=${target.seed}` });
  console.log(`[换房] ${player.name}: ${oldRoom.name} -> ${target.name}`);
}

// S5：首次开房/加入前先退旧房（与 switchRoom 同语义），防同一玩家在两个房间同时登记成幽灵成员。
// 目标与当前同名时不退——原地重开/重进保持原行为，避免自己退自己触发 host 交接抖动。
function leaveCurrentRoom(player, targetKey) {
  if (!player.room || player.room.name === targetKey) return;
  player.room.removePlayer(player.id);
  player.room = null;
}

// 服务器管理面板（阶段 4）：HTTP 路由 + JSON API
// 管理页 /   -> server/admin.html
// /api/status  -> 服务器/房间/玩家/配置状态
// /api/stats   -> 各房间消息速率（1 秒一点、60 点环形；会话级内存，不落盘）
// /api/broadcast {text} -> 向所有房间广播系统消息
// /api/kick {playerId} -> 踢出玩家（发 kicked，客户端停止自动重连）
// /api/config (GET/POST) -> 读取/更新服务器配置（落盘）
// /api/room/<name>/clear-drops -> 清空该房间掉落物
// /api/room/<name>/delete -> 删除房间（踢出所有玩家 + 删磁盘存档 + 从内存移除）
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 64 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const adminHtml = (() => {
  try {
    return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin.html'), 'utf8');
  } catch { return '<h1>管理面板文件缺失</h1>'; }
})();

// Build 21 M3：皮肤代理缓存（用户名小写 → {ts, payload}；5 分钟 TTL，规避 Mojang 限速）
const skinCache = new Map();
const SKIN_CACHE_TTL = 5 * 60 * 1000;

// S7：缓存条数上限（超出先惰性清扫过期项，仍超限则淘汰最旧条目——Map 插入序即写入序）
const SKIN_CACHE_MAX = 200;
const SKIN_FETCH_TIMEOUT_MS = 5000;                 // 三跳 fetch 单次超时（超时 → 502）
const SKIN_URL_HOST = 'textures.minecraft.net';     // 皮肤 PNG 只允许该域（SSRF 纵深）

// S7：写入缓存并维持上限（重复写入重插到队尾，淘汰时从队首取）
function skinCacheSet(key, payload) {
  const now = Date.now();
  skinCache.delete(key);
  skinCache.set(key, { ts: now, payload });
  if (skinCache.size <= SKIN_CACHE_MAX) return;
  for (const [k, v] of skinCache) if (now - v.ts >= SKIN_CACHE_TTL) skinCache.delete(k);
  while (skinCache.size > SKIN_CACHE_MAX) skinCache.delete(skinCache.keys().next().value);
}

// S7：/api/skin/ 按来源 IP 限频（复用 RateLimiter；档位 skinFetch，默认 30/分钟，0=不限，热读配置）
const skinLimiters = new Map(); // ip -> {limiter, ts}；惰性淘汰 10 分钟未活跃的条目
function skinLimiterFor(ip) {
  const now = Date.now();
  if (skinLimiters.size > 256) {
    for (const [k, v] of skinLimiters) if (now - v.ts >= 600000) skinLimiters.delete(k);
  }
  let entry = skinLimiters.get(ip);
  if (!entry) {
    entry = { limiter: new RateLimiter(() => (serverConfig.rateLimits || {}).skinFetch), ts: now };
    skinLimiters.set(ip, entry);
  }
  entry.ts = now;
  return entry.limiter;
}

// S7：皮肤拉取日志节流——按 IP 聚合 10s 窗口（同窗口只更新同一条目，不再逐次新增行），
// 汇总含「请求数 / 缓存命中数 / 失败数 / 最近一次用户名与原因」，保住「谁在拉皮肤」的审计能力。
const SKIN_FETCH_LOG_WINDOW_MS = 10000;
const skinFetchStats = new Map(); // ip -> {from, req, hit, fail, last}
function skinFetchNote(ip, username, result) {
  const now = Date.now();
  if (skinFetchStats.size > 256) {
    for (const [k, v] of skinFetchStats) if (now - v.from >= SKIN_FETCH_LOG_WINDOW_MS) skinFetchStats.delete(k);
  }
  let st = skinFetchStats.get(ip);
  if (!st || now - st.from >= SKIN_FETCH_LOG_WINDOW_MS) {
    st = { from: now, req: 0, hit: 0, fail: 0, last: '' };
    skinFetchStats.set(ip, st);
  }
  st.req++;
  if (result.code === 200 && result.note === '缓存') st.hit++;
  else if (result.code !== 200) st.fail++;
  st.last = `"${username}" → ${result.code}${result.note ? `（${result.note}）` : ''}`;
  return `${ip} 拉取皮肤 ${st.req} 次（缓存命中 ${st.hit}，失败 ${st.fail}）最近：${st.last}`;
}

// 皮肤代理专用 JSON 响应：带 CORS 头（前端 5173 与服务器 3001 跨端口，公开只读数据放行）
function sendSkinJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

// 三跳代理：用户名 → uuid（api.mojang.com）→ textures（sessionserver）→ PNG（textures.minecraft.net）。
// 返回 { data: dataURL, model: 'classic'|'slim', source: 'mojang', username }；失败给明确错误码。
// Build 22：返回值附 {code, note} 供路由写管理日志（面板可审计"谁在拉谁的皮肤"）。
async function handleSkinLookup(res, username) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    sendSkinJson(res, 400, { error: '用户名格式无效（3-16 位字母/数字/下划线）' });
    return { code: 400, note: '格式无效' };
  }
  const cacheKey = username.toLowerCase();
  const cached = skinCache.get(cacheKey);
  if (cached) {
    if (Date.now() - cached.ts < SKIN_CACHE_TTL) {
      sendSkinJson(res, 200, cached.payload);
      return { code: 200, note: '缓存' };
    }
    skinCache.delete(cacheKey); // S7：过期项顺手清理（此前只判 TTL、永不清理，Map 只增不减）
  }
  try {
    const profRes = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(SKIN_FETCH_TIMEOUT_MS) });
    if (profRes.status === 204 || profRes.status === 404) {
      sendSkinJson(res, 404, { error: '未找到该正版用户名' });
      return { code: 404, note: '用户名不存在' };
    }
    if (!profRes.ok) throw new Error(`mojang profile HTTP ${profRes.status}`);
    const prof = await profRes.json();
    if (!prof || !prof.id) { sendSkinJson(res, 404, { error: '未找到该正版用户名' }); return { code: 404, note: '用户名不存在' }; }
    const sessRes = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${prof.id}`,
      { signal: AbortSignal.timeout(SKIN_FETCH_TIMEOUT_MS) });
    if (!sessRes.ok) throw new Error(`sessionserver HTTP ${sessRes.status}`);
    const sess = await sessRes.json();
    const prop = (sess.properties || []).find((x) => x.name === 'textures');
    if (!prop) { sendSkinJson(res, 404, { error: '该账号没有皮肤数据' }); return { code: 404, note: '无皮肤数据' }; }
    const tex = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'));
    const skinUrl = tex.textures && tex.textures.SKIN && tex.textures.SKIN.url;
    if (!skinUrl) { sendSkinJson(res, 404, { error: '该账号没有皮肤 URL' }); return { code: 404, note: '无皮肤 URL' }; }
    const model = (tex.textures.SKIN.metadata && tex.textures.SKIN.metadata.model === 'slim') ? 'slim' : 'classic';
    // S7：皮肤 PNG 只认 textures.minecraft.net（Mojang 资料可被伪造，白名单是 SSRF 纵深）。
    // Mojang 该字段至今给的是 http://textures.minecraft.net/...（同域同时支持 https），故 http 输入
    // 自动升级为 https 再拉取——出站请求恒为 https，既不开天窗，也不让真实皮肤全部 502。
    let skinFetchUrl = '';
    try {
      const u = new URL(skinUrl);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname === SKIN_URL_HOST) skinFetchUrl = u.href.replace(/^http:/, 'https:');
    } catch { skinFetchUrl = ''; }
    if (!skinFetchUrl) {
      sendSkinJson(res, 502, { error: '皮肤地址域名非法（仅允许 https://' + SKIN_URL_HOST + '）' });
      return { code: 502, note: '皮肤地址域名非法' };
    }
    const imgRes = await fetch(skinFetchUrl, { signal: AbortSignal.timeout(SKIN_FETCH_TIMEOUT_MS) });
    if (!imgRes.ok) throw new Error(`皮肤文件 HTTP ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const payload = { data: `data:image/png;base64,${buf.toString('base64')}`, model, source: 'mojang', username };
    skinCacheSet(cacheKey, payload);
    sendSkinJson(res, 200, payload);
    return { code: 200, note: `mojang/${model}` };
  } catch (e) {
    const reason = (e && e.name === 'TimeoutError') ? `上游超时（${SKIN_FETCH_TIMEOUT_MS}ms）` : ((e && e.message) || String(e));
    sendSkinJson(res, 502, { error: `皮肤代理失败：${reason}` });
    return { code: 502, note: reason };
  }
}

// 阶段5 管理面板鉴权：管理账号列表非空时开启，API 请求须带 Authorization: Bearer <token>
// 阶段10：升级为多账号（serverConfig.adminAccounts），任一未过期账号均可通过；旧 adminToken 等价于 default 账号
// 账号过期 → 'expired'（仅放行 POST /api/config 续期/关闭，其余 401）
// 阶段11：返回 {state, role}，role = 'op'|'viewer'（viewer 对写操作 403）；未开启鉴权 = 全权 op
function authState(req) {
  const accounts = Array.isArray(serverConfig.adminAccounts) ? serverConfig.adminAccounts : [];
  if (!accounts.length) return { state: 'ok', role: 'op' }; // 未开启鉴权（局域网信任环境默认关闭）
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return { state: 'no', role: null };
  const token = auth.slice(7);
  const acc = accounts.find((a) => a.token === token);
  if (!acc) return { state: 'no', role: null };
  if (acc.expires > 0 && Date.now() / 1000 >= acc.expires) return { state: 'expired', role: acc.role || 'op' };
  return { state: 'ok', role: acc.role === 'viewer' ? 'viewer' : 'op' };
}

// 阶段6 管理操作日志（内存环形缓冲，最近 200 条，/api/logs 查询）
// S7：第三参数 throttleKey 非空时按 <op>|<key> 聚合——同一 10s 窗口内的重复调用就地更新同一条汇总
// （不新增行），避免 /api/skin/ 这类高频入口刷爆环形缓冲；detail 由调用方累加计数后渲染。
const ADMIN_LOG_MAX = 200;
const ADMIN_LOG_THROTTLE_MS = 10000;
const adminLogs = [];
const _adminLogThrottled = new Map(); // <op>|<key> -> { entry, from }
function logAdmin(op, detail, throttleKey = null) {
  const now = Date.now();
  if (throttleKey) {
    const k = op + '|' + throttleKey;
    if (_adminLogThrottled.size > 256) {
      for (const [kk, v] of _adminLogThrottled) if (now - v.from >= ADMIN_LOG_THROTTLE_MS) _adminLogThrottled.delete(kk);
    }
    const prev = _adminLogThrottled.get(k);
    if (prev && now - prev.from < ADMIN_LOG_THROTTLE_MS) {
      prev.entry.time = now;
      prev.entry.detail = detail;
      return;
    }
    const entry = { time: now, op, detail };
    adminLogs.push(entry);
    if (adminLogs.length > ADMIN_LOG_MAX) adminLogs.shift();
    _adminLogThrottled.set(k, { entry, from: now });
    return;
  }
  adminLogs.push({ time: now, op, detail });
  if (adminLogs.length > ADMIN_LOG_MAX) adminLogs.shift();
}

// 管理账号对外稳定标识：token 的 SHA-256 前 8 位（明文口令不出现在列表/日志，rotate/revoke 按 id 定位）
function accountId(a) {
  return crypto.createHash('sha256').update(String(a.token)).digest('hex').slice(0, 8);
}

// 对外返回配置时掩码口令，避免泄露明文；adminToken 兼容字段由 default 账号派生显示
function maskedConfig() {
  const c = { ...serverConfig };
  const accounts = (c.adminAccounts || []).map((a) => ({ id: accountId(a), label: a.label, expires: a.expires, role: a.role === 'viewer' ? 'viewer' : 'op', token: a.token ? '****' : '' }));
  const def = accounts.find((a) => a.label === 'default') || null;
  c.adminAccounts = accounts;
  c.adminToken = def && def.token ? '****' : '';
  return c;
}

// S1：handler 具名化，URL 解析移入 try（畸形 Host 此前在 try 外抛出 → unhandledRejection → 进程终止）
async function handleHttpRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://' + req.headers.host);
  } catch {
    sendJson(res, 400, { error: '请求格式非法' });
    return;
  }
  const p = url.pathname;

  // Build 21 M3：玩家皮肤代理（公开 GET——玩家无管理口令也能用；Mojang API 无 CORS
  // 头且面向服务端设计，浏览器直连会被拦，经服务器中转三跳：用户名→uuid→textures→PNG）。
  // Build 22：每次拉取写管理日志（IP + 用户名 + 结果），面板"操作日志"区可见。
  if (req.method === 'GET' && p.startsWith('/api/skin/')) {
    const username = decodeURIComponent(p.slice('/api/skin/'.length)).trim();
    const ip = (req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
    // S7：按来源 IP 限频（skinFetch 档，默认 30/分钟，0=不限）；超限 429 + Retry-After
    if (!skinLimiterFor(ip).allow()) {
      const limit = Number((serverConfig.rateLimits || {}).skinFetch) || 0;
      const retryAfter = String(Math.max(1, Math.ceil(limit > 0 ? 60000 / limit : 60)));
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': retryAfter });
      res.end(JSON.stringify({ error: '皮肤代理请求过于频繁，请稍后重试' }));
      logAdmin('skin-fetch', skinFetchNote(ip, username, { code: 429, note: 'IP 限频' }), ip);
      return;
    }
    const r = await handleSkinLookup(res, username);
    logAdmin('skin-fetch', skinFetchNote(ip, username, r), ip); // S7：按 IP 10s 聚合节流
    return;
  }

  // 管理面板页面
  if (req.method === 'GET' && p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(adminHtml);
    return;
  }

  // JSON API
  if (p.startsWith('/api/')) {
    try {
      // 阶段5 鉴权：开启 adminToken 后所有 API 都要求 Bearer 口令（未开则放行）
      // 阶段6：口令已过期 → 仅允许 POST /api/config 续期/关闭，其余 401；并记录失败尝试
      // 阶段11：viewer 角色只读——所有非 GET 请求 403（含 config/tokens/broadcast/kick/whitelist）
      const auth = authState(req);
      if (auth.state === 'no') {
        logAdmin('auth-fail', `访问 ${req.method} ${p} 未授权（口令缺失/错误）`);
        sendJson(res, 401, { error: '未授权：请先登录管理面板' });
        return;
      }
      if (auth.state === 'expired' && !(p === '/api/config' && req.method === 'POST')) {
        logAdmin('auth-fail', `口令已过期访问 ${req.method} ${p}（仅允许 /api/config 续期）`);
        sendJson(res, 401, { error: '口令已过期：请在配置卡中续期（或清空口令关闭鉴权）后保存' });
        return;
      }
      if (auth.state === 'ok' && auth.role === 'viewer' && req.method !== 'GET') {
        logAdmin('auth-fail', `viewer 账号尝试写操作 ${req.method} ${p}（已拒绝）`);
        sendJson(res, 403, { error: 'viewer 账号为只读权限，无权执行写操作' });
        return;
      }
      if (p === '/api/status' && req.method === 'GET') {
        const onlinePlayers = [...rooms.values()].reduce((n, r) => n + r.players.size, 0);
        sendJson(res, 200, {
          bootTime: BOOT_TIME,
          onlinePlayers,
          rooms: [...rooms.values()].map((r) => r.info()),
          config: maskedConfig(),
        });
        return;
      }
      // B38 L2：房间消息速率（viewer 可读；非 GET 已被上方 viewer 分支 403）
      if (p === '/api/stats' && req.method === 'GET') {
        const snap = roomStats.snapshot(roomIsActive);
        // 在线人数是即时量：直接读房间，不跟着 1 秒采样节拍走（否则刚进房会显示 0）
        for (const entry of snap.rooms) {
          const r = rooms.get(entry.name);
          entry.players = r ? r.players.size : 0;
        }
        sendJson(res, 200, snap);
        return;
      }
      if (p === '/api/config' && req.method === 'GET') {
        sendJson(res, 200, { config: maskedConfig() });
        return;
      }
      if (p === '/api/config' && req.method === 'POST') {
        const body = await readBody(req);
        Object.assign(serverConfig, config.applyConfig(serverConfig, body));
        config.saveConfig(serverConfig);
        logAdmin('config', `更新配置 dropTtlMs=${serverConfig.dropTtlMs} heartbeatMs=${serverConfig.heartbeatMs} maxPlayersPerRoom=${serverConfig.maxPlayersPerRoom} adminToken=${serverConfig.adminToken ? '****' : '(未开启)'} adminTokenExpires=${serverConfig.adminTokenExpires}`);
        console.log(`[配置] 已更新: dropTtlMs=${serverConfig.dropTtlMs} heartbeatMs=${serverConfig.heartbeatMs} maxPlayersPerRoom=${serverConfig.maxPlayersPerRoom} adminToken=${serverConfig.adminToken ? '****' : '(未开启)'} adminTokenExpires=${serverConfig.adminTokenExpires}`);
        sendJson(res, 200, { ok: true, config: maskedConfig() });
        return;
      }
      // 阶段11：当前登录账号角色（面板据此适配 UI；未开启鉴权 = op）
      if (p === '/api/whoami' && req.method === 'GET') {
        sendJson(res, 200, { role: auth.role, authEnabled: (serverConfig.adminAccounts || []).length > 0 });
        return;
      }
      // 阶段11：房间白名单 / op 名单（GET 两角色均可读；POST 已被上方 viewer 403 拦截，仅 op）
      if (p === '/api/whitelist' && req.method === 'GET') {
        sendJson(res, 200, { roomWhitelist: serverConfig.roomWhitelist || {}, roomOps: serverConfig.roomOps || {} });
        return;
      }
      if (p === '/api/whitelist' && req.method === 'POST') {
        const body = await readBody(req);
        if ('roomWhitelist' in body) {
          const wl = config.sanitizeRoomNameMap(body.roomWhitelist);
          if (!wl) { sendJson(res, 400, { error: 'roomWhitelist 格式非法（应为 {房间名: [昵称...]}）' }); return; }
          serverConfig.roomWhitelist = wl;
        }
        if ('roomOps' in body) {
          const ops = config.sanitizeRoomNameMap(body.roomOps);
          if (!ops) { sendJson(res, 400, { error: 'roomOps 格式非法（应为 {房间名: [昵称...]}）' }); return; }
          serverConfig.roomOps = ops;
        }
        config.saveConfig(serverConfig);
        const wlRooms = Object.entries(serverConfig.roomWhitelist).filter(([, l]) => l.length).length;
        const opRooms = Object.entries(serverConfig.roomOps).filter(([, l]) => l.length).length;
        logAdmin('whitelist', `更新白名单/Op 名单（启用白名单房间 ${wlRooms} 个，op 名单房间 ${opRooms} 个）`);
        console.log(`[管理] 更新白名单/Op 名单（启用白名单房间 ${wlRooms} 个，op 名单房间 ${opRooms} 个）`);
        sendJson(res, 200, { ok: true, roomWhitelist: serverConfig.roomWhitelist, roomOps: serverConfig.roomOps });
        return;
      }
      // Idea-4A：房间开关（GET 两角色均可读；POST 走下方单房间端点，已被 viewer 拦截）
      if (p === '/api/settings' && req.method === 'GET') {
        sendJson(res, 200, { roomSettings: serverConfig.roomSettings || {} });
        return;
      }
      // 阶段6 操作日志（仅管理面板 / 管理员查看）
      if (p === '/api/logs' && req.method === 'GET') {
        sendJson(res, 200, { logs: [...adminLogs].reverse() }); // 最新在前
        return;
      }
      // 阶段10 管理账号 API：生成 / 轮换 / 撤销（多账号 + token 轮换策略）
      // 生成：POST /api/tokens {label?, expiresMinutes?} -> 新口令明文仅此一次返回
      if (p === '/api/tokens' && req.method === 'POST') {
        if (!Array.isArray(serverConfig.adminAccounts)) serverConfig.adminAccounts = [];
        if (serverConfig.adminAccounts.length >= 10) { sendJson(res, 400, { error: '管理账号已达上限（10 个）' }); return; }
        const body = await readBody(req);
        const token = crypto.randomBytes(24).toString('base64url'); // 32 字符强随机
        const label = String(body.label || '').trim().slice(0, 24) || `token-${Date.now() % 10000}`;
        const minutes = Number(body.expiresMinutes) || 0;
        const expires = minutes > 0 ? Math.floor(Date.now() / 1000) + minutes * 60 : 0;
        const role = body.role === 'viewer' ? 'viewer' : 'op'; // 阶段11：角色（缺省 op）
        serverConfig.adminAccounts.push({ token, label, expires, role });
        config.saveConfig(serverConfig);
        logAdmin('token-create', `新增管理账号「${label}」（${role === 'viewer' ? 'viewer 只读' : 'op 全权'}）${expires > 0 ? `（${new Date(expires * 1000).toLocaleString()} 过期）` : '（永不过期）'}`);
        console.log(`[管理] 新增管理账号「${label}」（共 ${serverConfig.adminAccounts.length} 个）`);
        sendJson(res, 200, { ok: true, token, label, expires });
        return;
      }
      // 轮换：POST /api/tokens/rotate {id|token, expiresMinutes?} -> 该账号换发新口令（旧口令立即失效）
      if (p === '/api/tokens/rotate' && req.method === 'POST') {
        const body = await readBody(req);
        const accounts = Array.isArray(serverConfig.adminAccounts) ? serverConfig.adminAccounts : [];
        const idOrToken = String(body.id || body.token || '');
        const acc = accounts.find((a) => accountId(a) === idOrToken || a.token === idOrToken);
        if (!acc) { sendJson(res, 404, { error: '管理账号不存在（口令不匹配）' }); return; }
        const newToken = crypto.randomBytes(24).toString('base64url');
        acc.token = newToken;
        if (body.expiresMinutes !== undefined) {
          const minutes = Number(body.expiresMinutes) || 0;
          acc.expires = minutes > 0 ? Math.floor(Date.now() / 1000) + minutes * 60 : 0;
        }
        config.saveConfig(serverConfig);
        logAdmin('token-rotate', `轮换管理账号「${acc.label}」口令（旧口令已失效）`);
        console.log(`[管理] 轮换管理账号「${acc.label}」口令`);
        sendJson(res, 200, { ok: true, token: newToken, label: acc.label, expires: acc.expires });
        return;
      }
      // 撤销：POST /api/tokens/revoke {id|token} -> 删除该账号（全部撤销后鉴权自动关闭）
      if (p === '/api/tokens/revoke' && req.method === 'POST') {
        const body = await readBody(req);
        const accounts = Array.isArray(serverConfig.adminAccounts) ? serverConfig.adminAccounts : [];
        const idOrToken = String(body.id || body.token || '');
        const idx = accounts.findIndex((a) => accountId(a) === idOrToken || a.token === idOrToken);
        if (idx < 0) { sendJson(res, 404, { error: '管理账号不存在（口令不匹配）' }); return; }
        const [rm] = accounts.splice(idx, 1);
        config.saveConfig(serverConfig);
        logAdmin('token-revoke', `撤销管理账号「${rm.label}」${accounts.length ? '' : '（鉴权已关闭）'}`);
        console.log(`[管理] 撤销管理账号「${rm.label}」（剩余 ${accounts.length} 个）`);
        sendJson(res, 200, { ok: true, remaining: accounts.length });
        return;
      }
      if (p === '/api/broadcast' && req.method === 'POST') {
        const body = await readBody(req);
        const text = String(body.text || '').slice(0, 200);
        if (!text) { sendJson(res, 400, { error: '消息为空' }); return; }
        for (const r of rooms.values()) {
          r.broadcast(MSG.CHAT, { from: '系统', fromId: 0, text: `【管理】${text}` });
        }
        logAdmin('broadcast', text);
        console.log(`[管理] 广播: ${text}`);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (p === '/api/kick' && req.method === 'POST') {
        const body = await readBody(req);
        const id = Number(body.playerId);
        const reason = String(body.reason || '').trim().slice(0, 80) || '被服务器管理员移出'; // 阶段10：原因可填写
        for (const r of rooms.values()) {
          if (r.players.has(id)) {
            const name = r.players.get(id).name;
            r.kickPlayer(id, reason);
            logAdmin('kick', `踢出玩家 id=${id} (${name})，房间「${r.name}」，原因：${reason}`);
            sendJson(res, 200, { ok: true, room: r.name });
            return;
          }
        }
        sendJson(res, 404, { error: '玩家不在任何房间' });
        return;
      }
      // Idea-4A：单房间开关（pvp/mobs 只认 boolean，缺省字段保持不变）；
      // 落盘 config + 房间在内存时向在线玩家广播 room_settings 热生效
      const sm = p.match(/^\/api\/room\/([^/]+)\/settings$/);
      if (sm && req.method === 'POST') {
        const roomName = decodeURIComponent(sm[1]);
        const body = await readBody(req);
        const patch = {};
        if ('pvp' in body) {
          if (typeof body.pvp !== 'boolean') { sendJson(res, 400, { error: 'pvp 须为 boolean' }); return; }
          patch.pvp = body.pvp;
        }
        if ('mobs' in body) {
          if (typeof body.mobs !== 'boolean') { sendJson(res, 400, { error: 'mobs 须为 boolean' }); return; }
          patch.mobs = body.mobs;
        }
        if (!('pvp' in patch) && !('mobs' in patch)) { sendJson(res, 400, { error: '至少提供 pvp 或 mobs 之一' }); return; }
        if (roomName.length > 32) { sendJson(res, 400, { error: '房间名过长' }); return; }
        const cur = (serverConfig.roomSettings && serverConfig.roomSettings[roomName]) || {};
        const entry = { pvp: 'pvp' in patch ? patch.pvp : cur.pvp !== false, mobs: 'mobs' in patch ? patch.mobs : cur.mobs !== false };
        serverConfig.roomSettings = { ...(serverConfig.roomSettings || {}), [roomName]: entry };
        config.saveConfig(serverConfig);
        const room = rooms.get(roomName);
        if (room) {
          room.broadcast(MSG.ROOM_SETTINGS, { room: roomName, pvp: entry.pvp, mobs: entry.mobs });
        }
        logAdmin('room-settings', `房间「${roomName}」开关更新：PvP ${entry.pvp ? '开' : '关'}，怪物 ${entry.mobs ? '开' : '关'}${room ? `（已广播 ${room.players.size} 名在线玩家）` : '（房间当前离线）'}`);
        console.log(`[管理] 房间「${roomName}」开关：PvP ${entry.pvp ? '开' : '关'} 怪物 ${entry.mobs ? '开' : '关'}`);
        sendJson(res, 200, { ok: true, room: roomName, settings: entry });
        return;
      }
      // Idea-4B：世界备份导出（op 权限——viewer 对 GET 也 403，导出属敏感读）
      const bm = p.match(/^\/api\/room\/([^/]+)\/backup$/);
      if (bm && req.method === 'GET') {
        if (auth.role !== 'op') {
          logAdmin('auth-fail', `viewer 账号尝试下载世界备份（已拒绝）`);
          sendJson(res, 403, { error: 'viewer 账号为只读权限，无权导出世界备份' });
          return;
        }
        const roomName = decodeURIComponent(bm[1]);
        let body = null;
        const room = rooms.get(roomName);
        if (room && room.seed !== null) {
          body = JSON.stringify(store.roomSnapshot(room), null, 2);
        } else {
          // 房间不在内存：回读磁盘存档（服务器重启后未触碰的房间）
          try {
            const f = path.join(path.dirname(fileURLToPath(import.meta.url)), 'world', store.roomFileName(roomName) + '.json');
            if (fs.existsSync(f)) body = fs.readFileSync(f, 'utf8');
          } catch { /* 读盘失败按 404 处理 */ }
        }
        if (body === null) { sendJson(res, 404, { error: '房间不存在（无内存世界也无磁盘存档）' }); return; }
        const ts = Date.now();
        // Content-Disposition 头只放 ASCII：房间名再过滤一遍非 \w- 字符
        const asciiName = store.roomFileName(roomName).replace(/[^\w-]/g, '_') || 'room';
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="backup-${asciiName}-${ts}.json"`,
        });
        res.end(body);
        logAdmin('backup', `导出房间「${roomName}」世界备份（${body.length} 字节）`);
        return;
      }
      // B35 D：遗迹账本——GET 列表（只读）/ POST 重置（body.key 缺省 = 整个房间）
      const rm = p.match(/^\/api\/room\/([^/]+)\/ruins$/);
      if (rm && (req.method === 'GET' || req.method === 'POST')) {
        const roomName = decodeURIComponent(rm[1]);
        const room = rooms.get(roomName);
        if (!room) { sendJson(res, 404, { error: '房间不存在' }); return; }
        if (req.method === 'GET') {
          const ruins = [...room.ruins.entries()].map(([key, value]) => ({
            key, byName: value.byName, at: value.at, claimedBy: (room.ruinClaims.get(key) || {}).byName || '',
          }));
          sendJson(res, 200, { ok: true, room: roomName, ruins });
          return;
        }
        const body = await readBody(req);
        const result = room.resetRuins(null, typeof body.key === 'string' ? body.key : null);
        if (!result.ok) { sendJson(res, 400, { error: result.reason === 'key' ? '遗迹键非法' : '重置失败' }); return; }
        logAdmin('ruin-reset', `房间「${roomName}」重置遗迹 ${result.removed} 处${body.key ? '（单处 ' + body.key + '）' : '（全房）'}`);
        sendJson(res, 200, { ok: true, removed: result.removed });
        return;
      }
      // /api/room/<name>/<action>
      const m = p.match(/^\/api\/room\/([^/]+)\/(clear-drops|delete)$/);
      if (m && req.method === 'POST') {
        const roomName = decodeURIComponent(m[1]);
        const action = m[2];
        const room = rooms.get(roomName);
        if (!room) { sendJson(res, 404, { error: '房间不存在' }); return; }
        if (action === 'clear-drops') {
          const removed = room.clearDrops();
          logAdmin('clear-drops', `房间「${roomName}」清空 ${removed} 个掉落物`);
          sendJson(res, 200, { ok: true, removed });
          return;
        }
        if (action === 'delete') {
          for (const id of [...room.players.keys()]) room.kickPlayer(id, '房间已被服务器管理员删除');
          store.deleteRoomFile(roomName);
          store.deletePlayerProfiles(roomName); // S10：玩家档案文件（否则同名重建会「复活」旧档案）
          store.pruneBackups(roomName, 0);      // S10：该房间全部备份
          lastBackupAt.delete(roomName);        // S10：自动备份节流时间戳（内存残留）
          rooms.delete(roomName);
          logAdmin('delete-room', `删除房间「${roomName}」（世界存档/玩家档案/备份已移除）`);
          console.log(`[管理] 删除房间「${roomName}」（世界存档/玩家档案/备份已移除）`);
          sendJson(res, 200, { ok: true });
          return;
        }
      }
      // Idea-3C：玩家档案管理——GET 列表 / DELETE 清除（伪造昵称覆盖他人档案的清理入口）
      const pm = p.match(/^\/api\/room\/([^/]+)\/players(\/([^/]+))?$/);
      if (pm && (req.method === 'GET' || (req.method === 'DELETE' && pm[3]))) {
        const roomName = decodeURIComponent(pm[1]);
        const room = rooms.get(roomName);
        const profiles = room ? room.playerProfiles : store.loadPlayerProfiles(roomName);
        if (req.method === 'GET') {
          const list = Object.entries(profiles).map(([nick, pr]) => ({
            nick, dim: pr.dim, savedAt: pr.savedAt,
            health: pr.health, xpLevel: pr.xpLevel,
          }));
          sendJson(res, 200, { ok: true, room: roomName, players: list });
          return;
        }
        const nick = decodeURIComponent(pm[3]);
        if (!(nick in profiles)) { sendJson(res, 404, { error: '该房间无此玩家档案' }); return; }
        delete profiles[nick];
        if (room) room._profilesDirty = false; // 内存已改，直接落盘
        store.savePlayerProfiles(roomName, profiles);
        logAdmin('profile-delete', `删除房间「${roomName}」玩家「${nick}」档案`);
        sendJson(res, 200, { ok: true, room: roomName, nick });
        return;
      }
      sendJson(res, 404, { error: '未知接口' });
    } catch (e) {
      sendJson(res, 500, { error: String(e && e.message || e) });
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

// S1：handler 顶层兜底——任何未捕获异常/拒绝都在此收敛并回 500，不再逃逸为 unhandledRejection
const server = http.createServer(async (req, res) => {
  try {
    await handleHttpRequest(req, res);
  } catch (err) {
    console.error(`[HTTP] 请求处理异常: ${(err && err.message) || err}`);
    try {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '服务器内部错误' }));
      } else res.end();
    } catch { /* 响应已不可写 */ }
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

// 掉落物过期清理：所有房间每 10s 扫一次，过期的广播 drop_taken
const dropSweep = setInterval(() => { for (const r of rooms.values()) r.expireDrops(); }, 10000);

// Idea-3C：玩家档案脏刷新（10s 节流落盘；退房时另有立即刷）
const profileSweep = setInterval(() => {
  for (const r of rooms.values()) {
    if (r._profilesDirty) r.saveProfiles();
  }
}, 10000);

// Idea-4B：自动备份 sweep（每分钟检查；backupIntervalMinutes=0 关闭；只备份内存中已建世界的房间）
// 每房间保留 backupKeep 份（超出删最旧）；备份动作写 adminLog（间隔分钟级不会刷屏）
const lastBackupAt = new Map(); // 房间名 -> 上次备份 ms
function runAutoBackupOnce() {
  const intervalMs = (serverConfig.backupIntervalMinutes || 0) * 60000;
  if (!(intervalMs > 0)) return;
  const keep = serverConfig.backupKeep || 10;
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.seed === null) continue;
    const last = lastBackupAt.get(r.name) || 0;
    if (now - last < intervalMs) continue;
    try {
      const file = store.backupRoom(r);
      const removed = store.pruneBackups(r.name, keep);
      lastBackupAt.set(r.name, now);
      logAdmin('auto-backup', `房间「${r.name}」自动备份 ${file}${removed.length ? `（清理旧备份 ${removed.length} 份）` : ''}`);
      console.log(`[备份] 房间「${r.name}」自动备份 ${file}`);
    } catch (e) {
      console.error(`[备份] 房间「${r.name}」自动备份失败: ${e.message}`);
    }
  }
}
const backupSweep = setInterval(runAutoBackupOnce, 60000);

// S8 接线（N2 在 room.js 落地脏标记）：世界账本 1s 强刷——高频方块/容器/掉落改动只标脏，
// 由本扫描统一落盘；退房清空与关服另有立即刷路径（flushWorld 幂等，不脏时无操作）。
const worldFlushSweep = setInterval(() => { for (const r of rooms.values()) r.flushWorld(); }, 1000);

// B38 L2：消息速率采样——每秒把各房间这一秒的收发条数/字节量压成一个点，房间保留最近 STATS_POINTS 个；
// 空房整条回收（对应房间从 /api/stats 与面板里消失）。存量只在内存，不进 roomSnapshot、不落盘。
const statsSweep = setInterval(() => { roomStats.tick(Date.now(), roomIsActive); }, 1000);

// B36 F-1：漏斗搬运 sweep——每 200ms 让各房间推进一次；实际节拍由 config.flowIntervalMs 门控
// （flowEnabled=false 时 tickFlow 直接短路）。搬运结果以 by:0 的 CONTAINER_SET 按容器合并广播。
// B36 F-2：熔炉烧炼推进共用同一 sweep（进度与产出服务器权威；客户端只显示）。
const flowSweep = setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    try {
      r.tickFlow(now);
    } catch (e) {
      console.error(`[漏斗] 房间「${r.name}」tick 异常: ${(e && e.message) || e}`);
    }
    try {
      r.tickFurnaces(now);
    } catch (e) {
      console.error(`[熔炉] 房间「${r.name}」tick 异常: ${(e && e.message) || e}`);
    }
  }
}, 200);

// Idea-4C：限速丢包聚合日志（10s 一批增量，防刷爆 200 条环形缓冲）
const _rateReported = new WeakMap(); // player -> 已上报的 dropped 全档快照
const rateReportSweep = setInterval(() => {
  for (const r of rooms.values()) {
    for (const p of r.players.values()) {
      const d = p.dropped;
      if (!d || !Object.keys(d).length) continue;
      const seen = _rateReported.get(p) || {};
      const parts = [];
      for (const k of Object.keys(d)) { // S6：遍历全部档位（chat/block/state/join/skin/profile），新增档位无需再改此处
        const delta = (d[k] || 0) - (seen[k] || 0);
        if (delta > 0) parts.push(`${k}+${delta}`);
      }
      if (!parts.length) continue;
      _rateReported.set(p, { ...d });
      logAdmin('rate-limit', `房间「${r.name}」玩家 ${p.name} 限速丢包 ${parts.join(' ')}`);
    }
  }
}, 10000);

// 优雅退出：全部房间世界落盘（重启不丢）
function shutdown() {
  console.log('正在保存所有房间世界...');
  for (const r of rooms.values()) {
    r.flushWorld();    // S8：先把脏账本落盘（幂等；不脏时无操作）
    store.saveRoom(r); // 兜底：未走脏标记的存量快照仍完整落盘
    r.saveProfiles();  // Idea-3C：退出前刷全部脏档案
  }
  clearInterval(dropSweep);
  clearInterval(profileSweep);
  clearInterval(backupSweep);
  clearInterval(rateReportSweep);
  clearInterval(worldFlushSweep);
  clearInterval(statsSweep);
  clearInterval(flowSweep);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// S1：进程级兜底——未捕获异常/未处理拒绝只记日志、不再走 Node 默认终止（否则单个畸形请求带走全部房间与连接）
process.on('uncaughtException', (err) => {
  console.error(`[异常] uncaughtException: ${(err && err.stack) || err}`);
  logAdmin('crash-guard', `uncaughtException: ${(err && err.message) || err}`);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[异常] unhandledRejection: ${(reason && reason.stack) || reason}`);
  logAdmin('crash-guard', `unhandledRejection: ${(reason && reason.message) || reason}`);
});

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

// S12：心跳周期活读——自管理 setTimeout 链 + 200ms 轮询步长，每轮现读 serverConfig.heartbeatMs
// （管理面板改配置对在线连接最迟一个步长后生效）；到点才发 ping，未回 pong 则下一轮到点 terminate。
const HEARTBEAT_POLL_MS = 200;
function heartbeatDelay() {
  const ms = Number(serverConfig.heartbeatMs);
  return Number.isFinite(ms) && ms > 0 ? ms : 15000;
}

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress;
  console.log(`[+] 连接: ${addr}`);
  let player = null; // { id, ws, name, room? }；创建/加入房间后才进入某房间

  let alive = true;
  let lastPingAt = Date.now();
  let hbTimer = setTimeout(function heartbeatStep() {
    if (Date.now() - lastPingAt < heartbeatDelay()) { hbTimer = setTimeout(heartbeatStep, HEARTBEAT_POLL_MS); return; }
    if (!alive) { ws.terminate(); return; }
    alive = false;
    lastPingAt = Date.now();
    send(ws, { t: MSG.PING, seq: lastPingAt });
    hbTimer = setTimeout(heartbeatStep, HEARTBEAT_POLL_MS);
  }, HEARTBEAT_POLL_MS);

  ws.on('message', (raw) => {
    // B38 L2：入向流量先记再解析——畸形包同样占用带宽，不该从统计里漏掉
    if (player && player.room) roomStats.add(player.room.name, { inMsgs: 1, inBytes: (raw && raw.length) || 0 });
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    // 心跳 pong：任何连接的 pong 都刷新存活（浏览器端 NetworkManager 自动回复）
    if (msg.t === MSG.PONG) { alive = true; return; }

    if (!player) {
      // 首条必须是 hello；此时尚未分配房间（welcome 不带玩家列表，进房后由 joinRoom 回放）
      if (msg.t === MSG.HELLO) {
        // S11：协议版本校验——version 缺省（undefined/null）按旧客户端放行并回 legacy 标记；
        // 其余必须等于 PROTOCOL_VERSION，否则 KICKED + 断开（客户端据此提示刷新页面、停止重连）。
        const rawVersion = msg.version;
        const legacy = rawVersion === undefined || rawVersion === null;
        if (!legacy && Number(rawVersion) !== PROTOCOL_VERSION) {
          send(ws, { t: MSG.KICKED, reason: `协议版本不一致（服务器 v${PROTOCOL_VERSION}，客户端 v${String(rawVersion)}），请刷新页面后重试` });
          console.log(`[拒绝] 协议版本不一致: ${String(msg.name || '玩家').slice(0, 16)} v=${String(rawVersion)}`);
          setTimeout(() => { try { ws.close(); } catch {} }, 50);
          return;
        }
        player = { id: nextPlayerId++, ws, name: String(msg.name || '玩家').slice(0, 16) };
        player.rate = createConnectionLimiters(serverConfig); // Idea-4C：连接级限速器（阈值活读 config）
        send(ws, { t: MSG.WELCOME, selfId: player.id, players: [], protocol: PROTOCOL_VERSION, legacy });
        console.log(`[*] ${player.name} 已连接 (id=${player.id})${legacy ? '（旧客户端：未上报协议版本）' : ''}`);
      }
      return;
    }

    // Idea-4C：分级限速（chat/block/state 令牌桶，超限丢包+计数；其余消息与心跳豁免）
    const tier = tierOf(msg.t, MSG);
    if (tier && !player.rate[tier].allow()) {
      player.dropped = player.dropped || {};
      player.dropped[tier] = (player.dropped[tier] || 0) + 1;
      return;
    }

    // B32：恢复握手完成前，拒绝旧世界写入/位置/档案消息；允许确认、心跳与主动离房/换房。
    const recoveryExitChat = msg.t === MSG.CHAT && /^\/room(?:\s|$)/i.test(String(msg.text || '').trim());
    if (player._recovery && ![MSG.WORLD_READY, MSG.PING, MSG.SWITCH_ROOM, MSG.LEAVE_ROOM].includes(msg.t) && !recoveryExitChat) return;

    if (msg.t === MSG.CREATE_ROOM) {
      const roomKey = normalizeRoomName(msg.room);
      if (!whitelistAllows(roomKey, player.name)) { rejectByWhitelist(player, roomKey); return; } // 阶段11：白名单
      leaveCurrentRoom(player, roomKey); // S5：登记前先退旧房（与换房路径同语义）
      const room = getRoom(roomKey);
      if (!room.addPlayer(player)) return; // 房间已满：addPlayer 已发 kicked
      player.room = room;
      room.createRoom(player, msg);
    } else if (msg.t === MSG.JOIN_ROOM) {
      const roomKey = normalizeRoomName(msg.room);
      if (!whitelistAllows(roomKey, player.name)) { rejectByWhitelist(player, roomKey); return; } // 阶段11：白名单
      leaveCurrentRoom(player, roomKey); // S5：登记前先退旧房（与换房路径同语义）
      const room = getRoom(roomKey);
      if (!room.addPlayer(player)) return; // 房间已满：addPlayer 已发 kicked
      player.room = room;
      room.joinRoom(player, msg);
    } else if (msg.t === MSG.LEAVE_ROOM) {
      if (player.room) player.room.removePlayer(player.id);
      player.room = null;
      player = null;
      ws.close();
    } else if (msg.t === MSG.SWITCH_ROOM) {
      // 阶段5：世界内换房（保持连接，客户端重启本地世界）；阶段11：目标房间白名单约束
      switchRoom(player, String(msg.room || ''));
    } else if (msg.t === MSG.WORLD_RESET) {
      // 阶段5：重建当前房间世界（仅 host；阶段11：房间 op 名单放行；无权限回系统聊天提示）
      if (player.room) {
        if (player.room.isOperator(player)) player.room.resetWorld();
        else player.room.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: '只有房主(HOST)/op 可以重建世界' });
      }
    } else if (msg.t === MSG.PROFILE_SAVE) {
      // Idea-3C：玩家档案上报（校验通过才收录，10s 节流落盘）
      if (player.room) player.room.onProfileSave(player, msg);
    } else if (msg.t === MSG.CHAT && String(msg.text || '').startsWith('/')) {
      // 服务器聊天命令：/rooms /seed /room /rebuild /help
      handleCommand(player, String(msg.text || '').slice(0, 120));
    } else {
      if (process.env.DEBUG) console.log(`[msg] ${msg.t} from id=${player.id}`);
      if (player.room) player.room.handle(player, msg);
    }
  });

  ws.on('close', () => {
    clearTimeout(hbTimer); // S12：连接关闭清理心跳定时器（不泄漏）
    if (player && player.room) player.room.removePlayer(player.id);
    console.log(`[-] 断开: ${addr}`);
  });
  ws.on('error', () => {});
});

server.listen(PORT, HOST, () => {
  console.log(`Project-MC LAN server 监听 http://${HOST}:${PORT} (WebSocket: /ws)`);
  console.log('局域网内其它电脑用 ws://<本机IP>:' + PORT + '/ws 加入');
  console.log(`管理面板: http://127.0.0.1:${PORT}/ （房间/玩家/配置/世界管理）`);
  console.log(`已加载磁盘房间存档: ${store.loadRooms().length} 个`);
  console.log(`配置: 掉落物过期 ${serverConfig.dropTtlMs}ms 心跳 ${serverConfig.heartbeatMs}ms 每房上限 ${serverConfig.maxPlayersPerRoom}人 管理口令 ${serverConfig.adminToken ? '已开启' : '未开启(局域网信任)'}${serverConfig.adminTokenExpires > 0 ? ` (${new Date(serverConfig.adminTokenExpires * 1000).toLocaleString()} 过期)` : ''}`);
});
