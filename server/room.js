// room.js -- 房间管理：玩家集合 + 维度化方块账本 + 消息路由（多房间，世界按房间名隔离）
// 职责：方块仲裁(last-write-wins)、玩家状态中继、host 权限（改模式/设时间）、世界落盘回调
// 阶段 3：每个房间独立持有世界（seed/blocks/drops/时间），变更即落盘，服务器重启后可恢复
// M4：方块/容器账本按维度分桶（同坐标跨维互不干扰）；掉落物/怪物/状态广播按维度过滤
import { MSG } from './protocol.js';
import { DIMENSIONS, DEFAULT_DIMENSION } from '../src/core/dimensions.js';
import { safeBiomeScale } from '../src/world/biomes.js';

// S9：账本回放打包粒度（每块最多 512 格，形状与客户端 BLOCK_CHANGE_BATCH 消费一致）
const REPLAY_CHUNK = 512;
// S9：单连接发送缓冲背压阈值（超过则让出事件循环等排空，不丢账本项）
const REPLAY_BACKPRESSURE_BYTES = 1024 * 1024;

// 安全整数/浮点转换，防脏包
function safeInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isInteger(n) && Math.abs(n) <= 30000000 ? n : fallback;
}
function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
// S2：快照内层账本条目必须是 [键, 值] 数组（畸形档里的 null/数字条目会让解构抛 TypeError）
function safeEntries(v) {
  return Array.isArray(v) ? v.filter((e) => Array.isArray(e) && typeof e[0] === 'string') : [];
}
// S2：坏档告警（畸形快照跳过坏项，不再抛异常崩服）
function warnBadSnapshot(roomName, what) {
  console.warn(`[世界] 房间「${roomName}」快照 ${what}，已跳过`);
}

// Idea-2C：内容跟随物品（潜影盒）——27 槽数组，槽 = null 或 {name,count}；
// 嵌套 data（盒中盒，原版同样禁止）或任一槽非法 → 整体拒绝（视为普通物品）
function sanitizeItemData(v) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > 27) return null;
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const s = v[i];
    if (!s) { out.push(null); continue; }
    if (typeof s !== 'object' || !s.name || s.data != null) return null;
    const name = String(s.name).slice(0, 32);
    const count = safeInt(s.count, 1);
    if (count < 1) return null;
    out.push({ name, count: Math.min(64, count) });
  }
  return out;
}

// Idea-3C：玩家档案校验——整体通过才收录（任一字段非法 → 整体拒绝，防半套档案污染）。
// 数值一律 typeof number 强校验：JSON 的 NaN/Infinity 序列化为 null，若走 Number(null)=0
// 强转会被洗成合法值（Idea-2B 同款陷阱），这里直接拒绝。
function sanitizeSlotArray(v, maxSlots) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length > maxSlots) return null;
  const out = [];
  for (let i = 0; i < maxSlots; i++) {
    const s = v[i];
    if (!s) { out.push(null); continue; }
    if (typeof s !== 'object' || typeof s.n !== 'string') return null;
    if (typeof s.c !== 'number' || !Number.isInteger(s.c) || s.c < 1 || s.c > 64) return null;
    const slot = { n: s.n.slice(0, 64), c: s.c };
    if (s.d != null) {
      const d = sanitizeItemData(s.d);
      if (d === null) return null; // 嵌套 data 等非法 → 整档拒绝
      slot.d = d;
    }
    out.push(slot);
  }
  return out;
}

function profileNum(v, lo, hi) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return null;
  return v;
}

export function sanitizePlayerProfile(v) {
  if (!v || typeof v !== 'object') return null;
  const inv = v.inventory && typeof v.inventory === 'object' ? v.inventory : {};
  const slots = sanitizeSlotArray(inv.slots, 36);
  const armor = sanitizeSlotArray(inv.armor, 4);
  if (slots === null || armor === null) return null;
  const pos = v.position && typeof v.position === 'object' ? v.position : {};
  const px = profileNum(pos.x, -30000000, 30000000);
  const py = profileNum(pos.y, -300, 1000);
  const pz = profileNum(pos.z, -30000000, 30000000);
  if (px === null || py === null || pz === null) return null;
  const health = profileNum(v.health, 0, 20);
  const food = profileNum(v.food, 0, 20);
  const saturation = profileNum(v.saturation, 0, 20);
  const xp = profileNum(v.xp, 0, 30000000);
  const xpLevel = profileNum(v.xpLevel, 0, 1000);
  if (health === null || food === null || saturation === null || xp === null || xpLevel === null) return null;
  return {
    inventory: { slots, armor },
    position: { x: px, y: py, z: pz },
    dim: typeof v.dim === 'string' && v.dim ? v.dim.slice(0, 16) : 'overworld',
    health, food, saturation, xp, xpLevel,
    savedAt: Date.now(),
  };
}

// ---- B34-A：四界游记共享标记（房间权威账本）----
// 上限与客户端 src/core/Journal.js 对齐：全局 256 条、label 48 字符、owner 24 字符、颜色 #rrggbb
const JOURNAL_MARKER_LIMIT = 256;
const JOURNAL_MARKER_LABEL_MAX = 48;
const JOURNAL_MARKER_OWNER_MAX = 24;
const JOURNAL_MARKER_COORD_MAX = 30000000;
const JOURNAL_MARKER_ID_RE = /^[a-z0-9-]{1,48}$/i;
const JOURNAL_MARKER_COLOR_RE = /^#[0-9a-f]{6}$/i;
const JOURNAL_MARKER_DEFAULT_COLOR = '#f4ca64'; // 与客户端 Journal.sanitizeMarker 的回落色一致
// 分享/删除写入节流：令牌桶突发 90 条 + 每分钟补 30 条（与 chat 档同量级）。
// 未登记进 server/ratelimit.js 的 tierOf（该文件与 config.js 不在 B34-A 可改范围），
// 服务端硬上限（坐标/文本/数量）仍由本文件独立执行，不依赖限速档。
const JOURNAL_BUCKET_CAP = 90;
const JOURNAL_BUCKET_PER_MIN = 30;

// 去控制字符 + trim + 截断（与 src/core/Journal.js 的 cleanText 同口径）
function cleanJournalText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

// 坐标：严格 typeof number + 有限 + |v| <= 30000000（不接受字符串强转）
function journalCoord(v) {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= JOURNAL_MARKER_COORD_MAX ? v : null;
}

// 维度：只认注册表中 implemented 的维度（未实现/未知维度直接拒绝，不回退主世界）
function journalDim(dim) {
  const d = DIMENSIONS[dim];
  return d && d.implemented ? dim : null;
}

// 客户端字段一律不信任：维度白名单 / 有限坐标 / 文本清洗 / 颜色格式；label 清洗后为空视为非法
export function sanitizeJournalMarker(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const dim = journalDim(raw.dim);
  if (!dim) return null;
  const x = journalCoord(raw.x), y = journalCoord(raw.y), z = journalCoord(raw.z);
  if (x === null || y === null || z === null) return null;
  const label = cleanJournalText(raw.label, JOURNAL_MARKER_LABEL_MAX);
  if (!label) return null;
  const color = typeof raw.color === 'string' && JOURNAL_MARKER_COLOR_RE.test(raw.color)
    ? raw.color : JOURNAL_MARKER_DEFAULT_COLOR;
  return { dim, x, y, z, label, color };
}

// 快照恢复用：客户端字段同样清洗，另要求服务端 id / ownerId / owner 形状合法（坏项跳过，不崩服）
function sanitizeStoredJournalMarker(raw) {
  const marker = sanitizeJournalMarker(raw);
  if (!marker || typeof raw.id !== 'string' || !JOURNAL_MARKER_ID_RE.test(raw.id)) return null;
  const ownerId = Number.isInteger(raw.ownerId) && raw.ownerId > 0 ? raw.ownerId : 0;
  return { id: raw.id, ...marker, ownerId, owner: cleanJournalText(raw.owner, JOURNAL_MARKER_OWNER_MAX) };
}

// 幂等去重键：同一 owner 的同维度同坐标同文本 = 同一条标记（重复分享不再入账）
function journalContentKey(ownerId, marker) {
  return `${ownerId}|${marker.dim}|${marker.x}|${marker.y}|${marker.z}|${marker.label}`;
}

// 写入节流（桶挂在连接对象 player 上，与服务端其余限速同思路；超限静默丢包）
function allowJournalWrite(player, now = Date.now()) {
  let b = player._journalBucket;
  if (!b) b = player._journalBucket = { tokens: JOURNAL_BUCKET_CAP, last: now };
  const elapsed = Math.max(0, now - b.last);
  if (elapsed > 0) {
    b.tokens = Math.min(JOURNAL_BUCKET_CAP, b.tokens + (elapsed / 60000) * JOURNAL_BUCKET_PER_MIN);
    b.last = now;
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// ---- B34-B：天域旧航路航标进度（房间权威账本）----
// 上限与客户端 src/core/Waymarks.js 对齐：96 座塔、阶段 1..3、归属名 24 字符。
// 键 = "锚点x,锚点z"：维度固定天域、结构类型固定 aether_tower，由客户端结构记录保证。
const WAYMARK_LIMIT = 96;
const WAYMARK_STAGE_LIMIT = 3;
const WAYMARK_OWNER_MAX = 24;
const WAYMARK_COORD_MAX = 30000000;
const WAYMARK_KEY_RE = /^-?\d{1,9},-?\d{1,9}$/;
// 提交节流：令牌桶突发 30 次 + 每分钟补 15 次（三阶段提交是低频操作，超限静默丢弃）
const WAYMARK_BUCKET_CAP = 30;
const WAYMARK_BUCKET_PER_MIN = 15;

// 锚点键：严格 "整数,整数" 字符串，不接受浮点/科学计数法/其它形态
export function sanitizeWaymarkKey(key) {
  if (typeof key !== 'string' || !WAYMARK_KEY_RE.test(key)) return null;
  const [rawX, rawZ] = key.split(',');
  const ax = Number(rawX), az = Number(rawZ);
  if (!Number.isInteger(ax) || !Number.isInteger(az)) return null;
  if (Math.abs(ax) > WAYMARK_COORD_MAX || Math.abs(az) > WAYMARK_COORD_MAX) return null;
  return `${ax},${az}`;
}

// 阶段：只认 1..3 的整数（0/越界/字符串强转一律非法）
export function cleanWaymarkStage(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= WAYMARK_STAGE_LIMIT ? n : 0;
}

// 快照恢复：[key, {stage, byName}] —— 键与阶段都合法才收，坏项跳过不崩服
function sanitizeStoredWaymark(entry) {
  if (!Array.isArray(entry) || entry.length < 2) return null;
  const key = sanitizeWaymarkKey(entry[0]);
  const value = entry[1] && typeof entry[1] === 'object' ? entry[1] : {};
  const stage = cleanWaymarkStage(value.stage);
  if (!key || !stage) return null;
  return [key, { stage, byName: cleanJournalText(value.byName, WAYMARK_OWNER_MAX) }];
}

function allowWaymarkWrite(player, now = Date.now()) {
  let b = player._waymarkBucket;
  if (!b) b = player._waymarkBucket = { tokens: WAYMARK_BUCKET_CAP, last: now };
  const elapsed = Math.max(0, now - b.last);
  if (elapsed > 0) {
    b.tokens = Math.min(WAYMARK_BUCKET_CAP, b.tokens + (elapsed / 60000) * WAYMARK_BUCKET_PER_MIN);
    b.last = now;
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export class Room {
  // name: 房间名（同名房间共享同一世界）；onSave: (room) => void 世界变更落盘回调（index.mjs 注入）
  // config: 服务器配置引用（读取 dropTtlMs 等），管理面板可实时改
  constructor(name = 'default', onSave = null, config = null) {
    this.name = String(name).trim() || 'default';
    this.onSave = onSave;
    this.config = config;
    this._worldDirty = false; // S8：世界账本脏标记（高频路径只标脏，由 flushWorld / 后台扫描落盘）
    this.players = new Map();   // id -> player
    this._blockReplayTasks = new Map(); // playerId -> 当前方块回放任务
    // M4 维度分桶账本：dim -> Map("x,y,z" -> id)；同坐标跨维度互不干扰
    this.dimensionBlocks = new Map();
    this.dimensionContainers = new Map(); // dim -> Map("x,y,z" -> 27 槽数组)
    this.drops = new Map();     // dropId -> {x,y,z,name,count,dim,spawnedAt,owner?,ownerUntil?}
    this.nextDropId = 1;
    this.nextMobId = 1;         // 怪物 id 分配（事件同步，服务器仅分配/中继不跑 AI）
    this.seed = null;
    this.biomeScale = null; // 群系规模档位：首次开房固定（与 seed 同语义），null=未定（回提 small）
    this.time = 0.35;
    this.aetherDusk = false; // 天域复潮状态（批次 D：单向开关，快照落盘 + welcome 下发）
    this.finaleOffered = false; // 终局篇 F3：候潮（献证，单向开关）
    this.finalePos = null; // 候潮祭坛坐标 {x,y,z}
    this.finaleDone = false; // 终局篇 F3：听潮完成（单向开关）
    this.hostId = null;
    this.nextId = 1;
    // Idea-3C：玩家档案（房间→昵称 键；index.mjs 从磁盘装入 + 注入 onSaveProfiles 落盘回调）
    this.playerProfiles = {};
    this._profilesDirty = false;
    this.playerSkins = new Map(); // Build 21 M2：玩家皮肤（id → {data, model}；内存态，重连后客户端重发）
    // B34-A：四界游记共享标记账本（id → marker，服务端权威；落盘随房间快照）
    this.journalMarkers = new Map();
    this.nextJournalMarkerId = 1;
    // B34-B：天域旧航路航标进度（"ax,az" → {stage, byName}；服务器权威，落盘随房间快照）
    this.waymarks = new Map();
  }

  // 取（或建）指定维度的账本桶
  dimBucket(store, dim) {
    let m = store.get(dim);
    if (!m) { m = new Map(); store.set(dim, m); }
    return m;
  }

  // 维度名合法性（只认注册表中 implemented 的维度；非法回退主世界）
  static safeDim(dim) {
    const d = DIMENSIONS[dim];
    return d && d.implemented ? dim : DEFAULT_DIMENSION;
  }

  // 全维度方块总数（info//seed 展示用）
  blocksTotal() {
    let n = 0;
    for (const m of this.dimensionBlocks.values()) n += m.size;
    return n;
  }

  // 掉落物过期毫秒（默认 5 分钟；管理面板配置 dropTtlMs 实时生效）
  dropTtlMs() { return (this.config && this.config.dropTtlMs) || 300000; }

  // 从磁盘快照恢复房间世界状态（服务器重启后复活），过期掉落物丢弃；旧 host 已不在线，由新进玩家接管
  // 快照 V2：dimensionBlocks/dimensionContainers {dim: [entries]}；旧格式（平铺 blocks/containers 数组）迁移进主世界桶
  // S2：内层账本逐项校验（entries/containers/drops 非数组或条目畸形 → 告警跳过坏项，不得崩服）
  restore(snap) {
    if (!snap || typeof snap !== 'object') { warnBadSnapshot(this.name, '外层非对象'); return; }
    this.seed = safeInt(snap.seed, this.seed);
    this.biomeScale = snap.biomeScale != null ? safeBiomeScale(snap.biomeScale) : this.biomeScale;
    this.time = safeNum(snap.time, this.time);
    this.aetherDusk = !!snap.aetherDusk; // 天域复潮状态（批次 D，旧快照无字段回落 false）
    this.finaleOffered = !!snap.finaleOffered; // 终局篇 F3（旧快照无字段回落 false）
    this.finalePos = snap.finalePos || null;
    this.finaleDone = !!snap.finaleDone;
    this.nextDropId = Math.max(1, safeInt(snap.nextDropId, 1));
    this.nextMobId = Math.max(1, safeInt(snap.nextMobId, 1));
    this.dimensionBlocks = new Map();
    if (snap.dimensionBlocks && typeof snap.dimensionBlocks === 'object' && !Array.isArray(snap.dimensionBlocks)) {
      for (const [dim, entries] of Object.entries(snap.dimensionBlocks)) {
        if (!Array.isArray(entries)) { warnBadSnapshot(this.name, `维度 ${dim} 的方块账本非数组`); continue; }
        const m = this.dimBucket(this.dimensionBlocks, Room.safeDim(dim));
        for (const [k, id] of safeEntries(entries)) m.set(k, safeInt(id, 0));
      }
    } else {
      const m = this.dimBucket(this.dimensionBlocks, DEFAULT_DIMENSION);
      for (const [k, id] of safeEntries(snap.blocks)) m.set(k, safeInt(id, 0));
    }
    this.dimensionContainers = new Map();
    if (snap.dimensionContainers && typeof snap.dimensionContainers === 'object' && !Array.isArray(snap.dimensionContainers)) {
      for (const [dim, entries] of Object.entries(snap.dimensionContainers)) {
        if (!Array.isArray(entries)) { warnBadSnapshot(this.name, `维度 ${dim} 的容器账本非数组`); continue; }
        const m = this.dimBucket(this.dimensionContainers, Room.safeDim(dim));
        for (const [k, items] of safeEntries(entries)) {
          if (Array.isArray(items) && items.length === 27) m.set(k, items.map((s) => this.sanitizeStack(s)));
        }
      }
    } else {
      const m = this.dimBucket(this.dimensionContainers, DEFAULT_DIMENSION);
      for (const [k, items] of safeEntries(snap.containers)) {
        if (Array.isArray(items) && items.length === 27) m.set(k, items.map((s) => this.sanitizeStack(s)));
      }
    }
    this.drops = new Map();
    const now = Date.now();
    const ttl = this.dropTtlMs();
    if (snap.drops !== undefined && !Array.isArray(snap.drops)) warnBadSnapshot(this.name, '掉落物列表非数组');
    for (const d of (Array.isArray(snap.drops) ? snap.drops : [])) {
      if (!d || typeof d.id !== 'number' || !d.name) continue;
      if (now - safeNum(d.spawnedAt, now) > ttl) continue; // 过期掉落物不恢复
      const data = sanitizeItemData(d.data);
      this.drops.set(d.id, {
        x: safeNum(d.x), y: safeNum(d.y), z: safeNum(d.z),
        name: String(d.name).slice(0, 32),
        count: Math.min(64, Math.max(1, safeInt(d.count, 1))),
        dim: Room.safeDim(d.dim),
        spawnedAt: safeNum(d.spawnedAt, now),
        ...(data ? { data } : {}),
        // 阶段10：归属锁恢复（ownerId 需为正整数；过期锁自动失效）
        owner: Number.isInteger(d.owner) && d.owner > 0 ? d.owner : null,
        ownerUntil: safeNum(d.ownerUntil, 0),
        // Build 10：Q 丢弃抛掷初速恢复（非法值不带 → 客户端按 id 哈希派生）
        ...(typeof d.vx === 'number' && Number.isFinite(d.vx) &&
            typeof d.vy === 'number' && Number.isFinite(d.vy) &&
            typeof d.vz === 'number' && Number.isFinite(d.vz)
          ? { vx: d.vx, vy: d.vy, vz: d.vz } : {}),
      });
    }
    // B34-A：共享标记恢复（旧快照无该字段 → 空表，不崩服；坏项跳过）
    this.journalMarkers = new Map();
    this.nextJournalMarkerId = Math.max(1, safeInt(snap.nextJournalMarkerId, 1));
    if (snap.journalMarkers !== undefined && !Array.isArray(snap.journalMarkers)) {
      warnBadSnapshot(this.name, '共享标记列表非数组');
    }
    for (const raw of (Array.isArray(snap.journalMarkers) ? snap.journalMarkers : [])) {
      const marker = sanitizeStoredJournalMarker(raw);
      if (marker) this.journalMarkers.set(marker.id, marker);
    }
    while (this.journalMarkers.size > JOURNAL_MARKER_LIMIT) this.journalMarkers.delete(this.journalMarkers.keys().next().value);
    // B34-B：航标进度恢复（旧快照无该字段 → 空表，不崩服；坏项跳过）
    this.waymarks = new Map();
    if (snap.waymarks !== undefined && !Array.isArray(snap.waymarks)) {
      warnBadSnapshot(this.name, '航标进度表非数组');
    }
    for (const entry of (Array.isArray(snap.waymarks) ? snap.waymarks : [])) {
      const rec = sanitizeStoredWaymark(entry);
      if (rec) this.waymarks.set(rec[0], rec[1]);
    }
    while (this.waymarks.size > WAYMARK_LIMIT) this.waymarks.delete(this.waymarks.keys().next().value);
    this.hostId = null;
  }

  // 世界状态变更后落盘（回调由 index.mjs 注入为 store.saveRoom）
  // S8：立即全量落盘（结构性变更用）；全量快照已覆盖待落盘内容，故一并清脏标记
  save() { this._worldDirty = false; if (this.onSave) this.onSave(this); }

  // S8：高频路径（方块/容器/掉落）只标脏，由 1s 后台扫描或 flushWorld 落盘
  saveSoon() { this._worldDirty = true; }

  // S8：脏则立即落盘并清标记；不脏时空操作（幂等，供关服强刷/退房强刷复用）
  flushWorld() {
    if (!this._worldDirty) return;
    this._worldDirty = false; // 先清后写：落盘过程中的新写入会重新标脏，不被吞掉
    if (this.onSave) this.onSave(this);
  }

  isWorldDirty() { return this._worldDirty; }

  // T5：容器物品栈校验（name 限长、count 1-64；非法/数量<1 → null 空槽）
  sanitizeStack(s) {
    if (!s || typeof s !== 'object' || !s.name) return null;
    const count = safeInt(s.count, 1);
    if (count < 1) return null;
    const out = { name: String(s.name).slice(0, 32), count: Math.min(64, count) };
    const data = sanitizeItemData(s.data); // Idea-2C：内容跟随物品（容器内潜影盒）
    if (data) out.data = data;
    return out;
  }

  // 房间是否已满（管理面板配置 maxPlayersPerRoom）
  isFull() {
    const cap = (this.config && this.config.maxPlayersPerRoom) || 10;
    return this.players.size >= cap;
  }

  // Idea-4A：房间开关（config.roomSettings[房间名]，未配置/缺字段 = 全开）
  settings() {
    const s = this.config && this.config.roomSettings && this.config.roomSettings[this.name];
    return { pvp: !s || s.pvp !== false, mobs: !s || s.mobs !== false };
  }

  addPlayer(p) {
    // 管理面板配置的房间人数上限（超出拒绝入房）
    const cap = (this.config && this.config.maxPlayersPerRoom) || 10;
    if (this.players.size >= cap) {
      this.sendTo(p, MSG.KICKED, { reason: `房间「${this.name}」已满（上限 ${cap} 人）` });
      setTimeout(() => { try { p.ws.close(); } catch {} }, 50);
      return false;
    }
    p.mode = 'survival';
    p.health = 20; p.food = 20; p.saturation = 5;
    p.pos = { x: 0.5, y: 66, z: 0.5, yaw: 0, pitch: 0 };
    p.onGround = false; p.flying = false; p.inWater = false;
    p.dim = DEFAULT_DIMENSION; // M4：加入恒在主世界（此后经 switch_dimension 切换）
    p.selected = 0; p.heldItem = null; p.alive = true;
    p.hotbar = null; // 阶段10：完整快捷栏快照（player_full 上报；joinRoom 回放给新加入者）
    p._diedDrops = false; // 阶段6：本次死亡周期的掉落是否已产出（防重复上报刷掉落）
    p._recovery = null; // B32：重连恢复期间只接受匹配的 world_ready
    this.players.set(p.id, p);
    return true;
  }

  playerList() {
    return [...this.players.values()].map(p => ({
      id: p.id, name: p.name, mode: p.mode, pos: p.pos,
      health: p.health, food: p.food, selected: p.selected,
    }));
  }

  // 阶段10：玩家加入回放信息（含选中槽位/手持物/完整快捷栏 + M4 维度，让新加入者立即看到在线玩家）
  joinInfo(p) {
    const info = { id: p.id, name: p.name, mode: p.mode, pos: p.pos, selected: p.selected, held: p.heldItem, dim: p.dim };
    if (Array.isArray(p.hotbar)) info.hotbar = p.hotbar;
    return info;
  }

  sendTo(p, type, data) {
    if (p && p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: type, ...data }));
  }

  _cancelBlockReplay(player) {
    if (!player) return;
    const task = this._blockReplayTasks.get(player.id);
    if (!task || task.player !== player) return;
    task.cancelled = true;
    if (task.timer) clearTimeout(task.timer);
    this._blockReplayTasks.delete(player.id);
  }

  _cancelAllBlockReplays() {
    for (const task of this._blockReplayTasks.values()) {
      task.cancelled = true;
      if (task.timer) clearTimeout(task.timer);
    }
    this._blockReplayTasks.clear();
  }

  broadcast(type, data, exceptId = null) {
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      this.sendTo(p, type, data);
    }
  }

  // M4：按维度广播（只发给与 dim 相同的在线玩家——异维端不应用别维度的方块/掉落/怪）
  broadcastDim(type, data, dim, exceptId = null) {
    for (const p of this.players.values()) {
      if (p.id === exceptId || p.dim !== dim) continue;
      this.sendTo(p, type, data);
    }
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this._cancelBlockReplay(p);
    p._recovery = null;
    this.players.delete(id);
    this.playerSkins.delete(id); // Build 21 M2：皮肤为内存态（重连后客户端重发）
    this.broadcast(MSG.PLAYER_LEAVE, { id, name: p.name });
    // Idea-3C：退房立即刷档案（丢包窗口最小化；断线重连同昵称直接恢复）
    this.saveProfiles();
    // S8：最后一人退房 = 房间清空，脏世界账本立即落盘（不让脏标记随空房悬置）
    if (this.players.size === 0) this.flushWorld();
    if (this.hostId === id) {
      this.hostId = this.players.size ? this.players.keys().next().value : null;
    }
    console.log(`[!] ${p.name} 离开房间「${this.name}」，剩余 ${this.players.size} 人`);
  }

  // 管理面板操作（阶段 4）--------

  // 踢出玩家：发送 kicked 消息（客户端停止自动重连），再从房间移除
  kickPlayer(id, reason = '被服务器管理员移出') {
    const p = this.players.get(id);
    if (!p) return false;
    this.sendTo(p, MSG.KICKED, { reason });
    this.removePlayer(id);
    // 让 kicked 消息有时间送达再断开底层连接
    setTimeout(() => { try { p.ws.close(); } catch {} }, 50);
    return true;
  }

  // 清空该房间全部掉落物（广播 drop_taken by=0 让各端移除），返回移除数量
  clearDrops() {
    const n = this.drops.size;
    for (const [id, d] of this.drops) {
      this.broadcastDim(MSG.DROP_TAKEN, { id, by: 0 }, d.dim || DEFAULT_DIMENSION);
    }
    this.drops.clear();
    if (n) this.save();
    return n;
  }

  // 房间状态快照（管理面板展示）
  info() {
    return {
      name: this.name,
      seed: this.seed,
      time: this.time,
      hostId: this.hostId,
      blocks: this.blocksTotal(),
      drops: this.drops.size,
      settings: this.settings(), // Idea-4A：面板房间卡 checkbox 数据源
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, mode: p.mode, dim: p.dim,
        health: p.health, food: p.food, pos: p.pos, host: p.id === this.hostId,
        dropped: p.dropped || {}, // Idea-4C：限速丢包计数（管理面板展示）
      })),
    };
  }

  createRoom(player, msg) {
    // 已有世界的房间（重复开房/从磁盘恢复）沿用原 seed，仅首次开房时由 host 决定种子
    if (this.seed === null) this.seed = safeInt(msg.seed, Math.floor(Math.random() * 2147483647));
    // 群系规模与 seed 同语义：仅首次开房固定，重复开房/加入沿用房间记录（两端群系布局一致）
    if (this.biomeScale === null) this.biomeScale = safeBiomeScale(msg.biomeScale);
    player.mode = msg.mode === 'creative' ? 'creative' : (msg.mode === 'spectator' ? 'spectator' : 'survival');
    // S5：hostId 仅在空位或原 host 已离线时接管（与 joinRoom 同口径），防同房二次「创建房间」夺权
    if (this.hostId === null || !this.players.has(this.hostId)) this.hostId = player.id;
    this.sendTo(player, MSG.ROOM_CREATED, { roomId: this.name });
    // restart=true 表示世界内换房到新房间：客户端需重启本地世界（新 seed）
    this.sendTo(player, MSG.WORLD_INFO, { seed: this.seed, mode: player.mode, time: this.time, hostId: this.hostId, room: this.name, restart: !!msg.restart, biomeScale: this.biomeScale, aetherDusk: !!this.aetherDusk, finale: this.finaleInfo(), settings: this.settings() });
    this.broadcast(MSG.PLAYER_JOIN, this.joinInfo(player), player.id);
    this.save();
    console.log(`[+] ${player.name} 创建房间「${this.name}」seed=${this.seed} (host)`);
  }

  // opts.restart=true 表示世界内换房/重建：客户端收到 WORLD_INFO 后重启本地世界（保持连接）
  joinRoom(player, msg, opts = {}) {
    let recovery = null;
    if (msg && msg.recoveryId !== undefined) {
      const recoveryId = typeof msg.recoveryId === 'string' ? msg.recoveryId : '';
      const dim = typeof msg.resumeDim === 'string' ? msg.resumeDim : '';
      if (!/^[a-z0-9-]{1,64}$/i.test(recoveryId) || !DIMENSIONS[dim] || !DIMENSIONS[dim].implemented) {
        this.sendTo(player, MSG.KICKED, { reason: '重连恢复信息无效，请重新连接' });
        setTimeout(() => { try { player.ws.close(); } catch {} }, 50);
        return false;
      }
      recovery = { recoveryId, dim };
      player.dim = dim;
      player._recovery = { ...recovery, ready: false };
      const pos = msg.resumePos;
      if (pos && typeof pos === 'object' &&
          ['x', 'y', 'z', 'yaw', 'pitch'].every((key) => typeof pos[key] === 'number' && Number.isFinite(pos[key])) &&
          Math.abs(pos.x) <= 30000000 && Math.abs(pos.z) <= 30000000 && pos.y >= -300 && pos.y <= 1000) {
        player.pos = { x: pos.x, y: pos.y, z: pos.z, yaw: pos.yaw, pitch: pos.pitch };
      }
    }
    // 房间世界不存在（尚未创建/无存档）时，首个加入者自动成为 host 并随机生成世界
    if (this.seed === null) {
      if (recovery) {
        this.seed = Math.floor(Math.random() * 2147483647);
        if (this.biomeScale === null) this.biomeScale = safeBiomeScale(msg.biomeScale);
      } else {
        this.createRoom(player, { seed: Math.floor(Math.random() * 2147483647), mode: 'survival', restart: !!opts.restart });
        return true;
      }
    }
    // 无 host 时（如房间从磁盘恢复且暂无玩家在线）首个加入者接管 host
    if (this.hostId === null || !this.players.has(this.hostId)) this.hostId = player.id;
    const info = { seed: this.seed, mode: this.modeOfHost(), time: this.time, hostId: this.hostId, room: this.name, restart: !!opts.restart, biomeScale: this.biomeScale, aetherDusk: !!this.aetherDusk, finale: this.finaleInfo(), settings: this.settings() };
    if (recovery) { info.recoveryId = recovery.recoveryId; info.dim = recovery.dim; }
    this.sendTo(player, MSG.WORLD_INFO, info);
    // B34-A：进房/重连下发房间共享标记全量（客户端在世界就绪前会缓存，onWorldStarted 统一应用）
    this.sendTo(player, MSG.JOURNAL_MARKERS, this.journalMarkersPayload());
    // B34-B：进房/重连下发航标进度全量（客户端在世界就绪前缓存，onWorldStarted 统一应用）
    this.sendTo(player, MSG.WAYMARKS, this.waymarksPayload());
    if (recovery) {
      this.sendDimensionSnapshot(player, recovery.dim, null, recovery.recoveryId);
    } else {
      // 回放现存玩家：加入者立即可见房间内已有玩家（阶段10：附带手持物/快捷栏）
      for (const p of this.players.values()) {
        if (p.id === player.id) continue;
        this.sendTo(player, MSG.PLAYER_JOIN, this.joinInfo(p));
      }
      // 回放方块账本：按玩家当前维度读取，背压时不丢项。
      this.replayBlocks(player);
      // 回放容器账本（T5）：未动过的箱子由确定性生成对齐。
      for (const [key, items] of this.dimBucket(this.dimensionContainers, player.dim)) {
        const [x, y, z] = key.split(',').map(Number);
        this.sendTo(player, MSG.CONTAINER_SET, { x, y, z, items, by: 0 });
      }
      this.replayDrops(player, player.dim);
    }
    this.broadcast(MSG.PLAYER_JOIN, this.joinInfo(player), player.id);
    // Idea-3C：进房下发该昵称已有档案（仅发本人；客户端在世界就绪后应用）
    const prof = this.playerProfiles[player.name];
    if (prof) this.sendTo(player, MSG.PLAYER_PROFILE, { profile: prof });
    // Build 21 M2：回放房内其他玩家的皮肤（内存账本；新玩家随后 sendSkin 上报自己的）
    for (const [id, sk] of this.playerSkins) {
      if (id === player.id || !this.players.has(id)) continue;
      this.sendTo(player, MSG.SKIN_SET, { id, data: sk.data, model: sk.model });
    }
    console.log(`[+] ${player.name} 加入房间「${this.name}」seed=${this.seed} (${this.players.size}人)`);
    return true;
  }

  // S9：方块账本回放——先快照格位列表，再按 512 格分块发 BLOCK_CHANGE_BATCH（{list:[[x,y,z,id]], by:0, d}）
  // 未超背压阈值时逐块同步推进（首块与既有「加入即见世界」同 tick）；超阈值则 setTimeout 让出事件循环等排空，不丢项
  replayBlocks(player) {
    this._cancelBlockReplay(player);
    const ws = player.ws;
    const dim = player.dim;
    const bucket = this.dimBucket(this.dimensionBlocks, dim);
    const pending = [];
    for (const key of bucket.keys()) {
      const [x, y, z] = key.split(',').map(Number);
      pending.push([key, x, y, z]);
    }
    if (!pending.length) return; // 账本为空不发任何消息（保持既有语义）
    let i = 0;
    const task = { player, ws, dim, timer: null, cancelled: false };
    this._blockReplayTasks.set(player.id, task);
    const finish = () => {
      if (this._blockReplayTasks.get(player.id) === task) this._blockReplayTasks.delete(player.id);
    };
    const active = () => !task.cancelled && this._blockReplayTasks.get(player.id) === task &&
      this.players.get(player.id) === player && player.ws === ws && player.dim === dim && ws?.readyState === 1;
    const step = () => {
      task.timer = null;
      if (!active()) { task.cancelled = true; finish(); return; }
      while (i < pending.length) {
        // 背压：发送缓冲积压超阈值先让出 50ms，再从当前块继续
        if (ws.bufferedAmount > REPLAY_BACKPRESSURE_BYTES) { task.timer = setTimeout(step, 50); return; }
        const list = [];
        while (i < pending.length && list.length < REPLAY_CHUNK) {
          const [key, x, y, z] = pending[i++];
          // 让出期间该格可能已被实时广播改写（那条广播排在本块之前到达），取账本现值避免旧值覆盖新值
          const live = bucket.get(key);
          list.push([x, y, z, live === undefined ? 0 : live]);
        }
        this.sendTo(player, MSG.BLOCK_CHANGE_BATCH, { list, by: 0, d: dim });
      }
      finish();
    };
    step();
  }

  dropMessage(id, drop) {
    const back = { id, x: drop.x, y: drop.y, z: drop.z, name: drop.name,
      count: drop.count, d: drop.dim || DEFAULT_DIMENSION };
    if (drop.data) back.data = drop.data;
    if (drop.vx != null && drop.vy != null && drop.vz != null) {
      back.vx = drop.vx; back.vy = drop.vy; back.vz = drop.vz;
    }
    const remaining = drop.owner && drop.ownerUntil ? Math.ceil(drop.ownerUntil - Date.now()) : 0;
    if (remaining > 0) { back.owner = drop.owner; back.ownerLock = remaining; }
    return back;
  }

  replayDrops(player, dim) {
    for (const [id, d] of this.drops) {
      if ((d.dim || DEFAULT_DIMENSION) !== dim) continue;
      this.sendTo(player, MSG.DROP_SPAWN, this.dropMessage(id, d));
    }
  }

  sendDimensionSnapshot(player, dim, pos = null, recoveryId = null) {
    const blocks = [];
    for (const [key, id] of this.dimBucket(this.dimensionBlocks, dim)) {
      const [x, y, z] = key.split(',').map(Number);
      blocks.push({ x, y, z, id });
    }
    const containers = [];
    for (const [key, items] of this.dimBucket(this.dimensionContainers, dim)) {
      const [x, y, z] = key.split(',').map(Number);
      containers.push({ x, y, z, items });
    }
    const snapshot = { dim, blocks, containers, pos };
    if (recoveryId) snapshot.recoveryId = recoveryId;
    this.sendTo(player, MSG.DIMENSION_WORLD, snapshot);
    this.replayDrops(player, dim);
    for (const p of this.players.values()) {
      if (p.id === player.id || p.dim !== dim) continue;
      this.sendTo(player, MSG.PLAYER_JOIN, this.joinInfo(p));
    }
  }

  onWorldReady(player, msg) {
    const recovery = player && player._recovery;
    if (!recovery || recovery.ready || this.players.get(player.id) !== player ||
        player.ws?.readyState !== 1 || msg.recoveryId !== recovery.recoveryId || msg.dim !== recovery.dim || player.dim !== recovery.dim) return;
    player._recovery = null;
    this.sendTo(player, MSG.WORLD_RESUMED, { recoveryId: recovery.recoveryId, dim: recovery.dim });
  }

  // Idea-3C：档案上报（last-write-wins；只存内存+标脏，10s 扫描节流落盘）
  onProfileSave(player, msg) {
    const prof = sanitizePlayerProfile(msg.profile);
    if (!prof) return; // 非法档案静默丢弃（信任场景下的最低防线）
    this.playerProfiles[player.name] = prof;
    this._profilesDirty = true;
  }

  // Build 21 M2：玩家皮肤上报——校验后入账本并广播给其他玩家（S2C 带 id；本人已有，免发）。
  // 皮肤为内存态：退房即删（重连后客户端重发），不进快照/存档。
  onSkinSet(player, msg) {
    const data = typeof msg.data === 'string' ? msg.data : '';
    const model = msg.model === 'slim' ? 'slim' : 'classic';
    if (!data.startsWith('data:image/png;base64,') || data.length > 16384) {
      console.log(`[skin] ${player.name}#${player.id} 上报被拒（格式/体积）`);
      return;
    }
    this.playerSkins.set(player.id, { data, model });
    let sent = 0;
    for (const p of this.players.values()) {
      if (p.id === player.id) continue;
      this.sendTo(p, MSG.SKIN_SET, { id: player.id, data, model });
      sent++;
    }
    console.log(`[skin] ${player.name}#${player.id} 上报 ${model} ${data.length}B → 广播 ${sent} 人（账本 ${this.playerSkins.size}）`);
  }

  // Idea-3C：档案落盘（退房即刷 + 10s 脏扫描共用）；无回调时只清脏标记
  saveProfiles() {
    this._profilesDirty = false;
    if (this.onSaveProfiles) this.onSaveProfiles(this);
  }

  modeOfHost() {
    const h = this.players.get(this.hostId);
    return h ? h.mode : 'survival';
  }

  // 阶段11：游戏内权限——host，或昵称在 config.roomOps[房间名] 名单内的玩家（改模式/设时间/重建世界）
  isOperator(player) {
    if (!player) return false;
    if (player.id === this.hostId) return true;
    const ops = this.config && this.config.roomOps && this.config.roomOps[this.name];
    return !!(ops && ops.length && ops.includes(player.name));
  }

  // 重建当前房间世界（阶段5，仅 host 可触发）：新种子 + 清空方块/掉落/时间，
  // 广播 WORLD_INFO(restart) 让所有端重启本地世界，并重放 PLAYER_JOIN 让各端重建远端玩家
  resetWorld() {
    this._cancelAllBlockReplays();
    for (const p of this.players.values()) {
      p._recovery = null;
      p.dim = DEFAULT_DIMENSION;
    }
    this.seed = Math.floor(Math.random() * 2147483647);
    this.dimensionBlocks.clear();
    this.dimensionContainers.clear();
    this.drops.clear();
    this.time = 0.35;
    this.nextMobId = 1;
    this.nextDropId = 1;
    this.broadcast(MSG.WORLD_INFO, { seed: this.seed, mode: this.modeOfHost(), time: this.time, hostId: this.hostId, room: this.name, restart: true, biomeScale: this.biomeScale, aetherDusk: !!this.aetherDusk, finale: this.finaleInfo(), settings: this.settings() });
    for (const p of this.players.values()) {
      this.broadcast(MSG.PLAYER_JOIN, this.joinInfo(p), p.id);
    }
    this.save();
    console.log(`[世界] 房间「${this.name}」已重建 seed=${this.seed} (${this.players.size}人)`);
  }

  // 玩家消息路由
  handle(player, msg) {
    if (player._recovery && msg.t !== MSG.WORLD_READY && msg.t !== MSG.PING) return;
    switch (msg.t) {
      case MSG.BLOCK_SET: this.onBlockSet(player, msg); break;
      case MSG.BLOCK_SET_BATCH: this.onBlockSetBatch(player, msg); break;
      case MSG.CONTAINER_SET: this.onContainerSet(player, msg); break;
      case MSG.DROP_SPAWN: this.onDropSpawn(player, msg); break;
      case MSG.DROP_TAKEN: this.onDropTaken(player, msg); break;
      case MSG.MOB_SPAWN: this.onMobSpawn(player, msg); break;
      case MSG.MOB_ATTACK: this.onMobAttack(player, msg); break;
      case MSG.MOB_DIED: this.onMobDied(player, msg); break;
      case MSG.REDSTONE_STATE: this.onRedstoneState(player, msg); break;
      case MSG.ARROW_SHOT: this.onArrowShot(player, msg); break;
      case MSG.WITHER_SKULL: this.onWitherSkull(player, msg); break;
      case MSG.COLOSSUS_SLAM: this.onColossusSlam(player, msg); break;
      case MSG.AETHER_STATE: this.onAetherState(player, msg); break;
      case MSG.FINALE_STATE: this.onFinaleState(player, msg); break;
      case MSG.SKIN_SET: this.onSkinSet(player, msg); break;
      case MSG.PLAYER_STATE: this.onPlayerState(player, msg); break;
      case MSG.PLAYER_FULL: this.onPlayerFull(player, msg); break;
      case MSG.ATTACK_PLAYER: this.onAttack(player, msg); break;
      case MSG.PLAYER_DIED: this.onPlayerDied(player, msg); break;
      case MSG.RESPAWN: this.onRespawn(player, msg); break;
      case MSG.GAMEMODE: this.onGamemode(player, msg); break;
      case MSG.SWITCH_DIMENSION: this.onSwitchDimension(player, msg); break;
      case MSG.WORLD_READY: this.onWorldReady(player, msg); break;
      case MSG.SET_TIME: this.onSetTime(player, msg); break;
      case MSG.CHAT: this.onChat(player, msg); break;
      case MSG.JOURNAL_MARKER: this.onJournalMarker(player, msg); break;
      case MSG.JOURNAL_MARKER_DELETE: this.onJournalMarkerDelete(player, msg); break;
      case MSG.WAYMARK_SUBMIT: this.onWaymarkSubmit(player, msg); break;
      case MSG.PING:
        // 阶段10：回显 seq + 客户端时间戳 ts，供客户端直测网络 RTT
        this.sendTo(player, MSG.PONG, { seq: safeInt(msg.seq), ts: safeNum(msg.ts, 0) });
        break;
      default: break;
    }
  }

  onBlockSet(player, msg) {
    const x = safeInt(msg.x), y = safeInt(msg.y), z = safeInt(msg.z), id = safeInt(msg.id);
    if (id < 0 || id > 65535) return;
    const dim = player.dim; // M4：归入发起者当前维度的账本，广播只发同维度玩家
    const blocks = this.dimBucket(this.dimensionBlocks, dim);
    const containers = this.dimBucket(this.dimensionContainers, dim);
    // 0 是确定性地形上的显式空气修改，不能与“该坐标没有账本项”混为一谈。
    blocks.set(`${x},${y},${z}`, id);
    if (id === 0) {
      containers.delete(`${x},${y},${z}`); // T5：箱子被挖 → 容器账本一并清除（内容散落由挖掘方 drop_spawn 上报）
    }
    this.broadcastDim(MSG.BLOCK_CHANGE, { x, y, z, id, by: player.id, d: dim }, dim, player.id);
    this.saveSoon();
  }

  // B26 流体批量：逐格落账本（与单格同规则）后一条批量广播；限速按消息计（1 条）不按格数
  onBlockSetBatch(player, msg) {
    if (!Array.isArray(msg.list) || msg.list.length === 0 || msg.list.length > 512) return;
    const dim = player.dim;
    const blocks = this.dimBucket(this.dimensionBlocks, dim);
    const containers = this.dimBucket(this.dimensionContainers, dim);
    const changes = [];
    for (const it of msg.list) {
      if (!Array.isArray(it) || it.length !== 4) continue;
      const x = safeInt(it[0]), y = safeInt(it[1]), z = safeInt(it[2]), id = safeInt(it[3]);
      if (id < 0 || id > 65535) continue;
      // 与单条路径同义：显式保留空气值，容器内容另行清理。
      blocks.set(`${x},${y},${z}`, id);
      if (id === 0) {
        containers.delete(`${x},${y},${z}`);
      }
      changes.push([x, y, z, id]);
    }
    if (!changes.length) return;
    this.broadcastDim(MSG.BLOCK_CHANGE_BATCH, { list: changes, by: player.id, d: dim }, dim, player.id);
    this.saveSoon();
  }

  // T5：容器整箱同步（last-write-wins，与方块账本同仲裁策略；M4：按维度分桶 + 同维广播）
  // B34-A：四界游记共享标记（房间权威账本）----
  // 个人标记只在本端可见；玩家明确点「分享」后才上报，这里统一清洗、分配服务端 id 并注入归属。
  // 上限与客户端 src/core/Journal.js 同口径（256 条 / label 48 / owner 24）。
  journalMarkersPayload() {
    return { markers: [...this.journalMarkers.values()] };
  }

  onJournalMarker(player, msg) {
    if (!allowJournalWrite(player)) return; // 超量分享静默丢弃，不断开连接
    const clean = sanitizeJournalMarker(msg);
    if (!clean) return; // 非法维度/坐标/文本直接忽略（客户端字段一律不可信）
    // 同 owner 的同维度同坐标同文本 = 同一条标记：重复分享幂等，原样回报已有条目
    const contentKey = journalContentKey(player.id, clean);
    for (const marker of this.journalMarkers.values()) {
      if (journalContentKey(marker.ownerId, marker) === contentKey) {
        this.sendTo(player, MSG.JOURNAL_MARKER_ADD, { marker });
        return;
      }
    }
    let id = `j-${this.nextJournalMarkerId}`;
    while (this.journalMarkers.has(id)) id = `j-${++this.nextJournalMarkerId}`;
    this.nextJournalMarkerId++;
    const marker = { id, ...clean, ownerId: player.id, owner: cleanJournalText(player.name, JOURNAL_MARKER_OWNER_MAX) };
    this.journalMarkers.set(id, marker);
    while (this.journalMarkers.size > JOURNAL_MARKER_LIMIT) this.journalMarkers.delete(this.journalMarkers.keys().next().value);
    this.broadcast(MSG.JOURNAL_MARKER_ADD, { marker }); // 含分享者本人：各端顺序一致
    this.saveSoon();
  }

  // 删除共享标记：仅 owner 或房间 operator；越权静默拒绝（不回错误码，避免探测他人标记）
  onJournalMarkerDelete(player, msg) {
    const id = typeof msg.id === 'string' ? msg.id : '';
    const marker = this.journalMarkers.get(id);
    if (!marker) return;
    if (marker.ownerId !== player.id && !this.isOperator(player)) return;
    this.journalMarkers.delete(id);
    this.broadcast(MSG.JOURNAL_MARKER_REMOVED, { id, by: player.id });
    this.saveSoon();
  }

  // B34-B：航标进度全量（进房/重连下发）
  waymarksPayload() {
    return { list: [...this.waymarks.entries()].map(([key, value]) => [key, value.stage, value.byName]) };
  }

  // B34-B：三阶段修复提交。服务器只负责「严格顺序 + 一次性」：
  // 阶段必须恰好等于当前阶段 +1，重复 / 越级 / 两人并发提交一律拒绝，并把权威当前值回给提交者
  // （客户端只在收到自己触发的更新回执后才扣材料，因此不会双重扣料）。
  // 边界：材料由客户端本地扣除——服务器不持有背包，无法校验实物；协议文档注明该限制。
  onWaymarkSubmit(player, msg) {
    const key = sanitizeWaymarkKey(msg && msg.key);
    const stage = cleanWaymarkStage(msg && msg.stage);
    const current = (key && this.waymarks.get(key) ? this.waymarks.get(key).stage : 0);
    const deny = (reason) => this.sendTo(player, MSG.WAYMARK_DENY, { key: key || '', stage, current, reason });
    if (!key) return deny('key');
    if (!stage) return deny('stage');
    if (player.dim !== 'aether') return deny('dim'); // 只能在天域塔顶提交
    if (!allowWaymarkWrite(player)) return deny('rate');
    if (stage !== current + 1) return deny('order');
    if (!this.waymarks.has(key) && this.waymarks.size >= WAYMARK_LIMIT) return deny('limit');
    const byName = cleanJournalText(player.name, WAYMARK_OWNER_MAX);
    this.waymarks.set(key, { stage, byName });
    this.broadcast(MSG.WAYMARK_UPDATE, { key, stage, byId: player.id, byName }); // 含提交者本人：各端顺序一致
    this.saveSoon();
  }

  onContainerSet(player, msg) {
    const x = safeInt(msg.x), y = safeInt(msg.y), z = safeInt(msg.z);
    if (!Array.isArray(msg.items) || msg.items.length !== 27) return;
    const items = msg.items.map((s) => this.sanitizeStack(s));
    const dim = player.dim;
    this.dimBucket(this.dimensionContainers, dim).set(`${x},${y},${z}`, items);
    this.broadcastDim(MSG.CONTAINER_SET, { x, y, z, items, by: player.id, d: dim }, dim, player.id);
    this.saveSoon();
  }

  // 掉落物：客户端请求生成 -> 服务器分配唯一 id 并广播（含发起者，各端据此创建同一实体；M4：同维度广播）
  onDropSpawn(player, msg) {
    const x = safeNum(msg.x), y = safeNum(msg.y), z = safeNum(msg.z);
    const count = Math.min(64, Math.max(1, safeInt(msg.count, 1)));
    const name = String(msg.name || '').slice(0, 32);
    if (!name) return;
    // Idea-2C：内容跟随物品（潜影盒），校验失败整体丢弃（视为普通掉落）
    const data = sanitizeItemData(msg.data);
    const id = this.nextDropId++;
    const dim = player.dim;
    const entry = { x, y, z, name, count, dim, spawnedAt: Date.now() };
    if (data) entry.data = data;
    // Build 10：可选真实初速（Q 丢弃抛掷透传）；非法/缺省不带 → 各端按 id 哈希派生，向后兼容旧客户端
    if ([msg.vx, msg.vy, msg.vz].every(v => typeof v === 'number' && Number.isFinite(v))) {
      const clamp = (v) => Math.max(-16, Math.min(16, v));
      entry.vx = clamp(msg.vx); entry.vy = clamp(msg.vy); entry.vz = clamp(msg.vz);
    }
    this.drops.set(id, entry);
    this.broadcastDim(MSG.DROP_SPAWN, this.dropMessage(id, entry), dim);
    this.saveSoon();
    console.log(`[掉落] ${player.name} 生成 ${name}x${count} @(${x},${y},${z}) id=${id} [${dim}]`);
  }

  // 掉落物拾取：从账本删除并广播
  // 阶段10：死亡掉落物有归属锁——锁定期内只有 owner 本人可拾取，他人拾取被拒（回 drop_deny，账本保留）
  // M4：跨维度拾取一律拒绝（掉落物只存在于其生成维度）
  onDropTaken(player, msg) {
    const id = safeInt(msg.id);
    const d = this.drops.get(id);
    if (!d) {
      // 账本中已不存在（他人抢先拾取/过期移除/管理清空）→ 通知请求者回滚本地拾取，防物品复制
      this.sendTo(player, MSG.DROP_DENY, { id, owner: 0 });
      return;
    }
    if ((d.dim || DEFAULT_DIMENSION) !== player.dim) {
      this.sendTo(player, MSG.DROP_DENY, { id, owner: 0 });
      return;
    }
    if (d.owner && d.ownerUntil > Date.now() && player.id !== d.owner) {
      this.sendTo(player, MSG.DROP_DENY, { id, owner: d.owner });
      // 补发实体数据（客户端若已抢先本地拾取移除，凭此重建；数据以服务器账本为准）
      this.sendTo(player, MSG.DROP_SPAWN, this.dropMessage(id, d));
      return;
    }
    this.drops.delete(id);
    this.broadcastDim(MSG.DROP_TAKEN, { id, by: player.id, d: player.dim }, player.dim);
    this.saveSoon();
  }

  // 清理过期掉落物（默认 5 分钟，取配置值），广播移除（by=0 表示过期自然消失；M4：按掉落物维度广播）
  expireDrops() {
    const now = Date.now();
    const ttl = this.dropTtlMs();
    let changed = false;
    for (const [id, d] of this.drops) {
      if (now - d.spawnedAt > ttl) {
        this.drops.delete(id);
        this.broadcastDim(MSG.DROP_TAKEN, { id, by: 0 }, d.dim || DEFAULT_DIMENSION);
        changed = true;
      }
    }
    if (changed) this.saveSoon();
  }

  // 怪物事件（阶段 2 方案①：服务器只分配 id + 中继，不跑 AI）
  // host 端请求生成 -> 分配唯一 id 广播（含发起者，各端据此创建同一怪物实体；M4：同维度广播）
  onMobSpawn(player, msg) {
    // Idea-4A：怪物生成关闭时拒绝分配 id 不转发（发起者端实体由回执创建，故各端一致不出现）
    if (!this.settings().mobs) {
      this.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: '本房间已关闭怪物生成' });
      return;
    }
    const type = String(msg.type || '').slice(0, 24);
    const x = safeNum(msg.x), y = safeNum(msg.y), z = safeNum(msg.z);
    if (!type) return;
    const id = this.nextMobId++;
    const dim = player.dim;
    // T5：tradeSeed 透传（村民交易表派生种子，服务器不解释；缺省 = 旧客户端不带）
    const back = { id, type, x, y, z, d: dim };
    if (msg.tradeSeed !== undefined) back.tradeSeed = safeInt(msg.tradeSeed, 0);
    this.broadcastDim(MSG.MOB_SPAWN, back, dim);
    console.log(`[怪] ${player.name} 生成 ${type} @(${x},${y},${z}) id=${id} [${dim}]`);
  }

  // 玩家攻击怪物：转发（except 发起者，发起者端已本地处理；M4：同维度）
  onMobAttack(player, msg) {
    const id = safeInt(msg.id);
    const damage = Math.max(0, safeNum(msg.damage, 1));
    const x = safeNum(msg.x), y = safeNum(msg.y), z = safeNum(msg.z);
    this.broadcastDim(MSG.MOB_ATTACK, { id, fromId: player.id, damage, x, y, z }, player.dim, player.id);
  }

  // 怪物死亡：转发（except 发起者，掉落物由击杀端产出；M4：同维度）
  onMobDied(player, msg) {
    const id = safeInt(msg.id);
    this.broadcastDim(MSG.MOB_DIED, { id }, player.dim, player.id);
  }

  // 红石源状态（lever/button）：转发 except 发起者，各端对齐 poweredBlocks（M4：同维度）
  onRedstoneState(player, msg) {
    const x = safeInt(msg.x), y = safeInt(msg.y), z = safeInt(msg.z);
    this.broadcastDim(MSG.REDSTONE_STATE, { x, y, z, on: !!msg.on, by: player.id }, player.dim, player.id);
  }

  // 箭矢射击（Idea-2B）：事件转发 except 发起者（射端已本地生成）——只传初速，
  // 各端本地积分；不进方块/掉落账本（钉墙/寿命消失各端本地处理）；M4：同维度
  onArrowShot(player, msg) {
    // 先类型检查再放行：JSON 无 NaN（stringify 成 null，Number(null)=0 会混过 isFinite 转换）
    const raw = [msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz];
    if (!raw.every((v) => typeof v === 'number' && Number.isFinite(v))) return; // 脏包丢弃
    const [x, y, z, dx, dy, dz] = raw;
    this.broadcastDim(MSG.ARROW_SHOT, { id: player.id, x, y, z, dx, dy, dz }, player.dim, player.id);
  }

  // 凋灵之首/天域风弹（Idea-2D-② + 批次 C）：同箭矢事件转发 except 发起者（发射端已本地生成）；不进账本
  onWitherSkull(player, msg) {
    const raw = [msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz];
    if (!raw.every((v) => typeof v === 'number' && Number.isFinite(v))) return; // 脏包丢弃
    const [x, y, z, dx, dy, dz] = raw;
    const payload = { id: player.id, x, y, z, dx, dy, dz };
    if (msg.k === 'gale') payload.k = 'gale'; // 天域风弹标记透传（缺省 = 凋灵之首）
    this.broadcastDim(MSG.WITHER_SKULL, payload, player.dim, player.id);
  }

  // 守誓巨像震地（批次 C）：同款事件转发 except 发起者；不进账本
  onColossusSlam(player, msg) {
    const raw = [msg.x, msg.y, msg.z];
    if (!raw.every((v) => typeof v === 'number' && Number.isFinite(v))) return;
    const [x, y, z] = raw;
    this.broadcastDim(MSG.COLOSSUS_SLAM, { id: player.id, x, y, z }, player.dim, player.id);
  }

  // 天域复潮状态（批次 D）：服务器权威单向开关（只进不退）；广播全房间 + 落盘
  onAetherState(player, msg) {
    if (msg.dusk !== true || this.aetherDusk) return;
    this.aetherDusk = true;
    this.broadcast(MSG.AETHER_STATE, { dusk: true });
    this.save(); // 状态进快照（onSave → store.saveRoom），重启恢复
  }

  // 终局篇 F3 候潮/听潮状态：服务器权威只进不退（aetherState 同款三件套）
  // WORLD_INFO 下发的 finale 快照对象（新加入/重连/重建统一恢复）
  finaleInfo() {
    return {
      offered: !!this.finaleOffered,
      x: this.finalePos ? this.finalePos.x : 0,
      y: this.finalePos ? this.finalePos.y : 0,
      z: this.finalePos ? this.finalePos.z : 0,
      done: !!this.finaleDone,
    };
  }

  onFinaleState(player, msg) {
    if (msg.offered === true && !this.finaleOffered) {
      // 献证候潮：坐标取首个献证者（方块置换本身走账本同步）
      const raw = [msg.x, msg.y, msg.z];
      const ok = raw.every((v) => typeof v === 'number' && Number.isFinite(v));
      this.finaleOffered = true;
      this.finalePos = ok ? { x: raw[0], y: raw[1], z: raw[2] } : null;
      this.broadcast(MSG.FINALE_STATE, { offered: true, x: this.finalePos ? this.finalePos.x : 0, y: this.finalePos ? this.finalePos.y : 0, z: this.finalePos ? this.finalePos.z : 0 });
      this.save();
      return;
    }
    if (msg.done === true && this.finaleOffered && !this.finaleDone) {
      // 听潮完成：startTs 以服务器时钟重排（房间权威时钟，各端窗口相位同源对齐）
      this.finaleDone = true;
      this.broadcast(MSG.FINALE_STATE, { done: true, startTs: Date.now() });
      this.save();
    }
  }

  onPlayerState(player, msg) {
    const p = player.pos;
    p.x = safeNum(msg.x, p.x); p.y = safeNum(msg.y, p.y); p.z = safeNum(msg.z, p.z);
    p.yaw = safeNum(msg.yaw, p.yaw); p.pitch = safeNum(msg.pitch, p.pitch);
    player.onGround = !!msg.onGround; player.flying = !!msg.flying; player.inWater = !!msg.inWater;
    player.mining = !!msg.mine; // 阶段11：挖掘中标志（瞬时状态，不进 joinInfo）
    // 阶段6：手持物品同步——广播当前快捷栏槽位与物品名（远端模型据此渲染手持物）
    if (msg.selected !== undefined) player.selected = safeInt(msg.selected, player.selected);
    if (typeof msg.held === 'string') player.heldItem = msg.held.slice(0, 32);
    this.broadcastDim(MSG.PLAYER_STATE, {
      id: player.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      onGround: player.onGround, flying: player.flying, inWater: player.inWater,
      selected: player.selected, held: player.heldItem, mine: player.mining ? 1 : 0,
      ts: Date.now(), // 阶段5：服务器时间戳，客户端做时间对齐的缓冲插值
    }, player.dim, player.id);
  }

  // 阶段10：校验客户端上报的完整快捷栏（≤9 槽，每项 null 或 {name,count}），非法整体丢弃
  sanitizeHotbar(raw) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 9) return null;
    const out = [];
    for (const s of raw) {
      if (!s) { out.push(null); continue; }
      const name = typeof s.name === 'string' ? s.name.slice(0, 32) : '';
      if (!name) return null; // 脏包：一项非法则整条丢弃
      out.push({ name, count: Math.min(64, Math.max(1, safeInt(s.count, 1))) });
    }
    return out;
  }

  onPlayerFull(player, msg) {
    player.health = safeNum(msg.health, player.health);
    player.food = safeNum(msg.food, player.food);
    player.saturation = safeNum(msg.saturation, player.saturation);
    if (msg.mode) player.mode = msg.mode === 'creative' ? 'creative' : (msg.mode === 'spectator' ? 'spectator' : 'survival');
    if (msg.selected !== undefined) player.selected = safeInt(msg.selected, player.selected);
    if (typeof msg.held === 'string') player.heldItem = msg.held.slice(0, 32);
    const hotbar = this.sanitizeHotbar(msg.hotbar);
    if (hotbar) player.hotbar = hotbar; // 阶段10：记录完整快捷栏（joinRoom 回放给新加入者）
    const back = {
      id: player.id, health: player.health, food: player.food,
      saturation: player.saturation, mode: player.mode, selected: player.selected, held: player.heldItem,
    };
    if (player.hotbar) back.hotbar = player.hotbar;
    this.broadcastDim(MSG.PLAYER_FULL, back, player.dim, player.id);
  }

  onAttack(player, msg) {
    // Idea-4A：PvP 关闭时服务器权威短路——不结算不广播，给攻击者系统提示
    if (!this.settings().pvp) {
      this.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: '本房间已关闭 PvP（玩家间伤害无效）' });
      return;
    }
    const target = this.players.get(safeInt(msg.targetId));
    if (!target || target.id === player.id || !target.alive) return;
    const damage = Math.max(0, safeNum(msg.damage, 1));
    target.health = Math.max(0, target.health - damage);
    this.broadcast(MSG.ATTACK_PLAYER, { fromId: player.id, targetId: target.id, damage });
    if (target.health <= 0) {
      target.health = 0;
      target.alive = false;
      this.broadcast(MSG.PLAYER_DIED, { id: target.id });
    }
  }

  // 玩家死亡（阶段6）：广播死亡 + 把客户端上报的背包物品生成世界掉落物（drop_spawn 广播，各端一致可拾取）
  // 由客户端在本地检测到死亡时上报（携带死亡位置 + 背包掉落列表）；PvP 致死时 alive 已 false，此处只产出掉落
  onPlayerDied(player, msg) {
    if (player.alive) {
      player.alive = false;
      this.broadcast(MSG.PLAYER_DIED, { id: player.id });
    }
    // 同一死亡周期只产出一次掉落（防重复上报刷掉落）
    if (player._diedDrops) return;
    player._diedDrops = true;
    const x = safeNum(msg.x, player.pos.x);
    const y = safeNum(msg.y, player.pos.y);
    const z = safeNum(msg.z, player.pos.z);
    const drops = Array.isArray(msg.drops) ? msg.drops : [];
    let n = 0;
    for (let i = 0; i < drops.length && n < 64; i++) {
      const d = drops[i] || {};
      const name = String(d.name || '').slice(0, 32);
      const count = Math.min(64, Math.max(1, safeInt(d.count, 1)));
      if (!name) continue;
      // Idea-2C：死亡掉落透传内容跟随物品（潜影盒），校验失败视为普通掉落
      const data = sanitizeItemData(d.data);
      // 掉落位置做微小确定性偏移，避免整叠重叠成一点
      const ox = ((i % 5) - 2) * 0.3;
      const oz = ((Math.floor(i / 5) % 5) - 2) * 0.3;
      const id = this.nextDropId++;
      // 阶段10：死亡掉落归属锁——3 秒内只有死者本人可拾取（防止别人的死亡掉落被路过玩家瞬间抢走）
      const ownerLockMs = 3000;
      const ownerUntil = Date.now() + ownerLockMs;
      const dim = player.dim; // M4：死亡掉落落在死者当前维度
      const entry = { x: x + ox, y, z: z + oz, name, count, dim, spawnedAt: Date.now(), owner: player.id, ownerUntil };
      if (data) entry.data = data;
      this.drops.set(id, entry);
      this.broadcastDim(MSG.DROP_SPAWN, this.dropMessage(id, entry), dim);
      n++;
    }
    if (n) this.saveSoon();
    console.log(`[死亡] ${player.name} 死亡 @(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}) 掉落 ${n} 组`);
  }

  onRespawn(player, msg) {
    player.health = 20; player.food = 20; player.saturation = 5; player.alive = true;
    player._diedDrops = false; // 阶段6：新死亡周期允许再次产出掉落
    player.pos.x = safeNum(msg.x, 0.5); player.pos.y = safeNum(msg.y, 66); player.pos.z = safeNum(msg.z, 0.5);
    this.broadcast(MSG.RESPAWN, {
      id: player.id, x: player.pos.x, y: player.pos.y, z: player.pos.z,
      health: player.health, food: player.food,
    });
  }

  onGamemode(player, msg) {
    if (!this.isOperator(player)) { // 阶段11：host/op 可改自己的模式；拒绝给系统提示（原为静默忽略）
      this.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: '只有房主(HOST)/op 可以切换游戏模式' });
      return;
    }
    player.mode = msg.mode === 'creative' ? 'creative' : (msg.mode === 'spectator' ? 'spectator' : 'survival');
    this.broadcast(MSG.GAMEMODE, { id: player.id, mode: player.mode });
  }

  // M4：维度切换（联机）。流程：核对维度合法 → 记账 player.dim → 全体广播 player_dimension
  // → 向切换者下发目标维度账本（dimension_world）→ 回放同维度玩家列表（切换者本地世界重建远端玩家）
  onSwitchDimension(player, msg) {
    const raw = String(msg.dim || '');
    const def = DIMENSIONS[raw];
    if (!def || !def.implemented) {
      this.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: `未知维度「${raw}」` });
      return;
    }
    const dim = raw;
    if (player.dim === dim) return;
    this._cancelBlockReplay(player);
    player.dim = dim;
    // 广播给所有人（含切换者）：异维端移除其实体、同维端重建
    this.broadcast(MSG.PLAYER_DIMENSION, { id: player.id, dim, name: player.name, pos: player.pos, selected: player.selected, held: player.heldItem });
    // 传送门落点（迭代 M2/M3）：原样回传给换维者本人。带 x/z（下界/天域换算落点）或仅 portal
    // 标记（末地出生点链）均可；服务器不校验语义，非法类型清洗
    let pos = null;
    if (msg.pos && (typeof msg.pos.portal === 'string' || (Number.isFinite(msg.pos.x) && Number.isFinite(msg.pos.z)))) {
      pos = {
        x: Number.isFinite(msg.pos.x) ? (msg.pos.x | 0) : null,
        z: Number.isFinite(msg.pos.z) ? (msg.pos.z | 0) : null,
        portal: typeof msg.pos.portal === 'string' ? msg.pos.portal.slice(0, 16) : null,
      };
    }
    this.sendDimensionSnapshot(player, dim, pos);
    this.save();
    console.log(`[维度] ${player.name} → ${dim}（房间「${this.name}」）`);
  }

  onSetTime(player, msg) {
    if (!this.isOperator(player)) { // 阶段11：host/op 可设时间；拒绝给系统提示（原为静默忽略）
      this.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: '只有房主(HOST)/op 可以设定时间' });
      return;
    }
    this.time = Math.min(1, Math.max(0, safeNum(msg.time, this.time)));
    this.broadcast(MSG.TIME, { time: this.time });
    this.save();
    console.log(`[时间] host=${this.hostId} 设定 time=${this.time}`);
  }

  onChat(player, msg) {
    const text = String(msg.text || '').slice(0, 120);
    if (!text) return;
    console.log(`[聊天] ${player.name}: ${text}`);
    this.broadcast(MSG.CHAT, { from: player.name, fromId: player.id, text });
  }
}
