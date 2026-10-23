// config.js -- 服务器配置：默认参数 + 磁盘持久化（server/config.json，管理面板可改，重启保留）
// 阶段10：管理鉴权升级为多账号 adminAccounts [{token,label,expires}]；
//         旧字段 adminToken/adminTokenExpires 保留为兼容接口（等价于 label='default' 的账号）
// 阶段11：adminAccounts 增 role（'op'|'viewer'，缺省 op）；新增房间白名单 roomWhitelist 与
//         房间 op 名单 roomOps（{<房间名>: [昵称...]}，名单为空/不存在 = 不启用）
// Idea-4A：房间配置开关 roomSettings（{<房间名>: {pvp,mobs}}，缺省/缺字段 = 开）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from './store.js';

const CONFIG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');

// 默认配置（字段说明见 README / 管理面板）
const DEFAULTS = {
  dropTtlMs: 300000,     // 掉落物过期毫秒（默认 5 分钟）
  heartbeatMs: 15000,    // 心跳间隔毫秒（超过该时间未收到 pong 视为掉线）
  maxPlayersPerRoom: 10, // 单个房间最大玩家数（超出拒绝加入）
  adminToken: '',        // 兼容接口：等价于 default 账号（空=无 default 账号；全部账号为空时=不鉴权）
  adminTokenExpires: 0,  // 兼容接口：default 账号过期时间（Unix 秒，0=永不过期）
  adminAccounts: [],     // 阶段10：管理账号列表 [{token,label,expires,role}]；空数组=不鉴权（局域网信任）
  roomWhitelist: {},     // 阶段11：房间白名单 {<房间名>: [昵称...]}；名单非空时仅名单内昵称可进
  roomOps: {},           // 阶段11：房间 op 名单 {<房间名>: [昵称...]}；名单内玩家享 host 级游戏权限（改模式/设时间/重建世界）
  roomSettings: {},      // Idea-4A：房间开关 {<房间名>: {pvp,mobs}}；缺省/缺字段 = 开（true）
  backupIntervalMinutes: 0, // Idea-4B：自动备份间隔分钟（0=关闭）
  backupKeep: 10,        // Idea-4B：每房间保留备份份数
  rateLimits: {          // Idea-4C：消息速率限制（每分钟次数，0=不限制）
    chat: 30,            //   聊天/命令（人工节奏）
    block: 900,          //   block_set（挖放峰值 ~15/s）
    state: 1800,         //   player_state（客户端 20Hz=1200/min，留余量）
    join: 30,            // S6：create/join/switch_room（每条约一次整账本回放）
    skin: 30,            // S6：skin_set（16KB 数据向全房广播）
    profile: 60,         // S6：profile_save（整档校验）
    skinFetch: 30,       // S7：/api/skin/ 按来源 IP 限频（每分钟次数）
    ruin: 120,           // B35 D：ruin_state/ruin_claim（每次解开或领取才发一条，低频）
  },
};

// 数字配置的合法范围（防止管理面板提交脏值）
const RANGES = {
  dropTtlMs: [1000, 3600000],       // 1s ~ 1h
  heartbeatMs: [2000, 60000],       // 2s ~ 60s
  maxPlayersPerRoom: [1, 64],       // 1 ~ 64
  adminTokenExpires: [0, 4102444800], // Unix 秒，0=永不过期 ~ 2100 年
  backupIntervalMinutes: [0, 14400],  // Idea-4B：0=关闭 ~ 10 天
  backupKeep: [1, 50],              // Idea-4B：1 ~ 50 份
};

// Idea-4C：速率限制每分钟次数的合法范围（0=不限制）
const RATE_LIMITS_MAX = 100000;

// 字符串配置的最大长度（如管理口令）
const STRING_MAX = { adminToken: 64 };

// 房间名/玩家昵称映射表的清洗上限
const ROOM_MAP_LIMITS = { maxRooms: 32, maxNames: 16, roomNameMax: 32, playerNameMax: 16 };

// 校验管理账号数组（阶段10/11）：≤10 项，每项 {token 1..64, label ≤24, expires 0..2100年, role}；
// role 仅认 'viewer'（只读），其余一律归一为 'op'（含缺省/旧配置，向后兼容）；非法整体丢弃
export function sanitizeAccounts(raw) {
  if (!Array.isArray(raw) || raw.length > 10) return null;
  const out = [];
  for (const a of raw) {
    if (!a || typeof a.token !== 'string' || a.token.length === 0 || a.token.length > 64) return null;
    const label = typeof a.label === 'string' ? a.label.slice(0, 24) : '';
    const n = Number(a.expires);
    const expires = Number.isFinite(n) && n >= 0 && n <= 4102444800 ? Math.round(n) : 0;
    const role = a.role === 'viewer' ? 'viewer' : 'op';
    out.push({ token: a.token, label, expires, role });
  }
  return out;
}

// 校验 {<房间名>: [昵称...]} 形态的映射（阶段11：roomWhitelist / roomOps 共用）：
// ≤32 个房间 × 每房 ≤16 个昵称（去重），房间名/昵称裁剪去空白；非法整体返回 null
export function sanitizeRoomNameMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  let rooms = 0;
  for (const [rawRoom, rawNames] of Object.entries(raw)) {
    if (rooms >= ROOM_MAP_LIMITS.maxRooms) break;
    const room = String(rawRoom || '').trim().slice(0, ROOM_MAP_LIMITS.roomNameMax);
    if (!room || !Array.isArray(rawNames)) continue;
    const names = [];
    for (const v of rawNames) {
      const s = String(v || '').trim().slice(0, ROOM_MAP_LIMITS.playerNameMax);
      if (s && !names.includes(s)) names.push(s);
      if (names.length >= ROOM_MAP_LIMITS.maxNames) break;
    }
    out[room] = names;
    rooms++;
  }
  return out;
}

// Idea-4A：校验房间开关表（{<房间名>: {pvp,mobs}}）：≤32 房间，pvp/mobs 仅认 boolean
// （缺省/非布尔 = 开 true——与"未配置即全开"语义一致）；非法条目跳过，非对象整体返回 null
export function sanitizeRoomSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  let rooms = 0;
  for (const [rawRoom, rawVal] of Object.entries(raw)) {
    if (rooms >= ROOM_MAP_LIMITS.maxRooms) break;
    const room = String(rawRoom || '').trim().slice(0, ROOM_MAP_LIMITS.roomNameMax);
    if (!room || !rawVal || typeof rawVal !== 'object' || Array.isArray(rawVal)) continue;
    out[room] = {
      pvp: typeof rawVal.pvp === 'boolean' ? rawVal.pvp : true,
      mobs: typeof rawVal.mobs === 'boolean' ? rawVal.mobs : true,
    };
    rooms++;
  }
  return out;
}

// Idea-4C：校验速率限制表（每分钟次数，0=不限制）；S6/S7 扩档为七项：
// 连接级 chat/block/state/join/skin/profile + 皮肤代理 IP 级 skinFetch；B35 D 增 ruin（遗迹上报/领取）。
// 缺省项回落当前值（applyConfig 传入 current）或默认值；非法数字忽略该项
export function sanitizeRateLimits(raw, current = null) {
  const base = current || DEFAULTS.rateLimits;
  if (raw === undefined || raw === null) return { ...base };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of ['chat', 'block', 'state', 'join', 'skin', 'profile', 'skinFetch', 'ruin']) {
    const src = raw[key] !== undefined ? raw[key] : base[key];
    const n = Number(src);
    out[key] = Number.isFinite(n) && n >= 0 && n <= RATE_LIMITS_MAX ? Math.round(n) : base[key];
  }
  return out;
}

// 找 default 兼容账号（旧 adminToken 等价物）
function findDefaultAccount(accounts) {
  return accounts.find((a) => a.label === 'default') || null;
}

// 读取磁盘配置，缺失/非法字段回退默认值；旧配置（仅 adminToken）自动迁移为 default 账号
export function loadConfig() {
  const cfg = { ...DEFAULTS, adminAccounts: [] };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      for (const key of ['dropTtlMs', 'heartbeatMs', 'maxPlayersPerRoom', 'adminTokenExpires', 'backupIntervalMinutes', 'backupKeep']) {
        const range = RANGES[key];
        const n = Number(data[key]);
        if (Number.isFinite(n) && n >= range[0] && n <= range[1]) cfg[key] = Math.round(n);
      }
      if (typeof data.adminToken === 'string' && data.adminToken.length <= STRING_MAX.adminToken) cfg.adminToken = data.adminToken;
      const accounts = sanitizeAccounts(data.adminAccounts);
      if (accounts) {
        cfg.adminAccounts = accounts;
      } else if (cfg.adminToken) {
        // 旧版配置迁移：adminToken 非空 → default 账号（沿用 adminTokenExpires）
        cfg.adminAccounts = [{ token: cfg.adminToken, label: 'default', expires: cfg.adminTokenExpires, role: 'op' }];
      }
      const whitelist = sanitizeRoomNameMap(data.roomWhitelist);
      if (whitelist) cfg.roomWhitelist = whitelist;
      const ops = sanitizeRoomNameMap(data.roomOps);
      if (ops) cfg.roomOps = ops;
      const settings = sanitizeRoomSettings(data.roomSettings);
      if (settings) cfg.roomSettings = settings;
      const rl = sanitizeRateLimits(data.rateLimits);
      if (rl) cfg.rateLimits = rl;
    }
  } catch (e) {
    console.error(`[配置] 读取 ${CONFIG_PATH} 失败: ${e.message}`);
  }
  return cfg;
}

// 校验并合并一份新配置（非法字段忽略），返回更新后的配置
// adminAccounts 为主接口；旧字段 adminToken/adminTokenExpires 作为 default 账号的兼容读写
export function applyConfig(current, patch) {
  const next = { ...current, adminAccounts: [...(current.adminAccounts || [])] };
  for (const key of ['dropTtlMs', 'heartbeatMs', 'maxPlayersPerRoom', 'adminTokenExpires', 'backupIntervalMinutes', 'backupKeep']) {
    if (!(key in patch)) continue;
    const range = RANGES[key];
    const n = Number(patch[key]);
    if (Number.isFinite(n) && n >= range[0] && n <= range[1]) next[key] = Math.round(n);
  }
  if ('adminToken' in patch) {
    if (typeof patch.adminToken === 'string' && patch.adminToken.length <= STRING_MAX.adminToken) next.adminToken = patch.adminToken;
  }
  // 主接口：整体替换账号列表（非法丢弃）
  if ('adminAccounts' in patch) {
    const accounts = sanitizeAccounts(patch.adminAccounts);
    if (accounts) next.adminAccounts = accounts;
  }
  // 阶段11：房间白名单 / op 名单（整体替换，非法丢弃）
  if ('roomWhitelist' in patch) {
    const wl = sanitizeRoomNameMap(patch.roomWhitelist);
    if (wl) next.roomWhitelist = wl;
  }
  if ('roomOps' in patch) {
    const ops = sanitizeRoomNameMap(patch.roomOps);
    if (ops) next.roomOps = ops;
  }
  // Idea-4A：房间开关（整体替换，非法丢弃）
  if ('roomSettings' in patch) {
    const settings = sanitizeRoomSettings(patch.roomSettings);
    if (settings) next.roomSettings = settings;
  }
  // Idea-4C：速率限制（逐项合并进当前值，整体为垃圾时保持不变）
  if ('rateLimits' in patch) {
    const rl = sanitizeRateLimits(patch.rateLimits, next.rateLimits);
    if (rl) next.rateLimits = rl;
  }
  // 兼容语义：adminToken 变更同步到 default 账号（空=移除 default 账号；其余账号不受影响）
  if ('adminToken' in patch) {
    const def = findDefaultAccount(next.adminAccounts);
    if (next.adminToken) {
      if (def) def.token = next.adminToken;
      else next.adminAccounts.push({ token: next.adminToken, label: 'default', expires: next.adminTokenExpires });
    } else if (def) {
      next.adminAccounts = next.adminAccounts.filter((a) => a !== def);
    }
  }
  // 兼容语义：adminTokenExpires 变更只作用于 default 账号
  if ('adminTokenExpires' in patch) {
    const def = findDefaultAccount(next.adminAccounts);
    if (def) def.expires = next.adminTokenExpires;
  }
  // 回写兼容字段（default 账号优先）
  const def = findDefaultAccount(next.adminAccounts);
  next.adminToken = def ? def.token : '';
  next.adminTokenExpires = def ? def.expires : 0;
  return next;
}

export function saveConfig(cfg) {
  try { writeFileAtomic(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch (e) {
    console.error(`[配置] 写入 ${CONFIG_PATH} 失败: ${e.message}`);
  }
}
