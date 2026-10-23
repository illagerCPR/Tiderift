// RaceTracks.js -- 御风赛道数据模型（纯模块：只管校验/清洗/存取，不依赖 GUI 与 Three.js，可 node 直测）

// 上限与服务器 server/room.js 对齐：24 条赛道 / 12 个点位 / 24 字名称 / 相邻点 512 格。
export const RACE_NAME_MAX = 24;
export const RACE_BY_MAX = 24;
export const RACE_TRACK_LIMIT = 24;
export const RACE_POINT_MIN = 3;   // 起点 + 至少一个检查点 + 终点
export const RACE_POINT_MAX = 12;
export const RACE_COORD_MAX = 30000000;
export const RACE_SEGMENT_MAX = 512;
export const RACE_RECORD_LIMIT = 240;
export const RACE_MIN_MS = 1000;
export const RACE_MAX_MS = 3600000; // 1 小时：超过视为无效成绩
export const RACE_MODES = ['glide', 'free']; // 御风（鞘翅/气流）/ 自由（创造飞行等，单独标识不混榜）
export const RACE_ID_RE = /^[a-z0-9]{6,20}$/;
export const RACE_POST_BLOCK = 'race_post';
export const RACE_HOTKEY_HINT = 'G';

const DIMS = ['overworld', 'nether', 'end', 'aether'];

function validDim(dim) { return DIMS.includes(dim); }

function intInRange(value, max) {
  const n = Number(value);
  return Number.isInteger(n) && Math.abs(n) <= max;
}

// 名称清洗：剥控制字符、压空白、按字符（非 UTF-16 单元）截断，空名一律回落 ''
export function cleanRaceName(raw) {
  if (typeof raw !== 'string') return '';
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return Array.from(text).slice(0, RACE_NAME_MAX).join('');
}

export function cleanRaceMode(raw) {
  return RACE_MODES.includes(raw) ? raw : RACE_MODES[0];
}

// 点位清洗：整数化 + 世界坐标上限 + 0..255 高度；非整数输入不静默取整成别的点
export function cleanRacePoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const z = Number(raw.z);
  if (!intInRange(x, RACE_COORD_MAX) || !intInRange(z, RACE_COORD_MAX)) return null;
  if (!Number.isInteger(y) || y < 0 || y > 255) return null;
  return { x, y, z };
}

export function racePointKey(point) {
  return `${point.x},${point.y},${point.z}`;
}

export function segmentLength(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// 赛道总长（相邻点距离之和，取整米）
export function trackLength(track) {
  if (!track || !Array.isArray(track.points) || track.points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < track.points.length; i++) total += segmentLength(track.points[i - 1], track.points[i]);
  return Math.round(total);
}

export function raceRecordKey(id, revision, who = '') {
  return `${id}#${revision | 0}#${who}`;
}

export function newRaceId() {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function cleanRaceId(raw) {
  return (typeof raw === 'string' && RACE_ID_RE.test(raw)) ? raw : '';
}

// 赛道清洗：id/dim/名称/模式/点位全部校验，任一项不合规即整条拒绝（不做部分接受）
export function sanitizeTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanRaceId(raw.id);
  if (!id) return null;
  const name = cleanRaceName(raw.name);
  if (!name) return null;
  if (!validDim(raw.dim)) return null;
  if (!Array.isArray(raw.points)) return null;
  if (raw.points.length < RACE_POINT_MIN || raw.points.length > RACE_POINT_MAX) return null;
  const points = [];
  for (const item of raw.points) {
    const point = cleanRacePoint(item);
    if (!point) return null;
    if (points.length) {
      const prev = points[points.length - 1];
      if (prev.x === point.x && prev.y === point.y && prev.z === point.z) return null; // 相邻重复点 = 无效定义
      if (segmentLength(prev, point) > RACE_SEGMENT_MAX) return null;                   // 单段超长 = 无效定义
    }
    points.push(point);
  }
  const byId = (raw.byId === null || raw.byId === undefined) ? '' : String(raw.byId).slice(0, 40);
  const byName = typeof raw.byName === 'string'
    ? Array.from(raw.byName.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, RACE_BY_MAX).join('')
    : '';
  return {
    id,
    name,
    dim: raw.dim,
    mode: cleanRaceMode(raw.mode),
    revision: Math.max(1, Math.min(99999, Number(raw.revision) | 0)),
    byId,
    byName,
    points,
  };
}

function cloneTrack(track) {
  return {
    id: track.id,
    name: track.name,
    dim: track.dim,
    mode: track.mode,
    revision: track.revision,
    byId: track.byId,
    byName: track.byName,
    points: track.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
  };
}

// 成绩清洗：只有落在 [RACE_MIN_MS, RACE_MAX_MS] 的整数毫秒才算有效成绩
export function cleanRaceMillis(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const ms = Math.round(n);
  if (ms < RACE_MIN_MS || ms > RACE_MAX_MS) return 0;
  return ms;
}

export class RaceTracks {
  constructor(game) {
    this.game = game; // 只用于界面取 player/net 等运行时信息；数据本身自足
    this.tracks = [];         // 有序数组（后建的在后面，列表展示按创建序）
    this.records = new Map(); // 'id#rev#who' -> { ms, name }；SP 的 who 为 ''
  }

  reset(raw) {
    this.tracks = [];
    this.records = new Map();
    if (!raw || typeof raw !== 'object') return;
    const list = Array.isArray(raw.tracks) ? raw.tracks : [];
    for (const item of list) {
      const track = sanitizeTrack(item);
      if (!track) continue;
      if (this.tracks.some((t) => t.id === track.id)) continue;
      this.tracks.push(track);
      if (this.tracks.length >= RACE_TRACK_LIMIT) break;
    }
    const records = raw.records;
    const entries = Array.isArray(records) ? records
      : (records && typeof records === 'object' ? Object.entries(records).map(([key, value]) => (
        value && typeof value === 'object' ? [key, value.ms, value.name] : [key, value, ''])) : []);
    for (const entry of entries) {
      if (!Array.isArray(entry)) continue;
      const key = typeof entry[0] === 'string' ? entry[0] : '';
      if (!/^[a-z0-9]{6,20}#\d{1,5}#[A-Za-z0-9_-]{0,40}$/.test(key)) continue;
      const ms = cleanRaceMillis(entry[1]);
      if (!ms) continue;
      const name = typeof entry[2] === 'string' ? Array.from(entry[2]).slice(0, RACE_BY_MAX).join('') : '';
      this.records.set(key, { ms, name });
      if (this.records.size >= RACE_RECORD_LIMIT) break;
    }
  }

  serialize() {
    return {
      tracks: this.tracks.map(cloneTrack),
      records: [...this.records.entries()].map(([key, value]) => [key, value.ms, value.name || '']),
    };
  }

  list(dim) {
    return dim ? this.tracks.filter((t) => t.dim === dim) : this.tracks.slice();
  }

  get(id) {
    return this.tracks.find((t) => t.id === id) || null;
  }

  // 服务器广播/单机新建共用的落盘入口：同 id 覆盖（就地替换，保持创建序），新 id 追加
  applyTrack(raw) {
    const track = sanitizeTrack(raw);
    if (!track) return null;
    const index = this.tracks.findIndex((t) => t.id === track.id);
    if (index >= 0) this.tracks[index] = track;
    else {
      if (this.tracks.length >= RACE_TRACK_LIMIT) return null;
      this.tracks.push(track);
    }
    return track;
  }

  remove(id) {
    const before = this.tracks.length;
    this.tracks = this.tracks.filter((t) => t.id !== id);
    if (this.tracks.length === before) return false;
    for (const key of [...this.records.keys()]) {
      if (key.startsWith(`${id}#`)) this.records.delete(key);
    }
    return true;
  }

  best(id, revision, who = '') {
    const rec = this.records.get(raceRecordKey(id, revision, who));
    return rec ? rec.ms : null;
  }

  // 房间最佳（任意玩家）：只有联机时才有其他玩家的记录
  roomBest(id, revision, selfId = '') {
    const prefix = `${id}#${revision | 0}#`;
    let best = null;
    for (const [key, value] of this.records) {
      if (!key.startsWith(prefix)) continue;
      if (key.slice(prefix.length) === selfId) continue;
      if (!best || value.ms < best.ms) best = { ms: value.ms, name: value.name || '' };
    }
    return best;
  }

  setRecord(id, revision, who, ms, name = '') {
    const value = cleanRaceMillis(ms);
    if (!value) return null;
    const key = raceRecordKey(id, revision, who || '');
    const prev = this.records.get(key);
    const next = { ms: prev ? Math.min(prev.ms, value) : value, name: name || (prev ? prev.name : '') };
    if (this.records.size >= RACE_RECORD_LIMIT && !prev) return null;
    this.records.set(key, next);
    return next;
  }

  submitBest(id, revision, ms, who = '', name = '') {
    const value = cleanRaceMillis(ms);
    if (!value) return { accepted: false, isBest: false, previous: null };
    const prev = this.records.get(raceRecordKey(id, revision, who));
    const isBest = !prev || value < prev.ms;
    if (isBest) this.setRecord(id, revision, who, value, name);
    return { accepted: true, isBest, previous: prev ? prev.ms : null };
  }

  get size() { return this.tracks.length; }
}
