// SaveTransfer.js -- 单人存档导出/导入：gzip 单文件信封、校验与净化（Build 43）
// 纯逻辑模块（除 gzip 流 API 外无浏览器依赖），node 可测。
// 文件格式：gzip( UTF-8 JSON )，解压后为信封
//   { format:'tiderift-save', fileVersion:1, app, build, exportedAt, slot, save }
// save 即 localStorage 内同一形状的存档对象；未知字段原样保留。
// 导入端兼容「裸存档 JSON」（无信封）：顶层有 version + seed/gamemode 即认。
import { BUILD } from '../version.js';
import { SAVE_VERSION, normalizeSaveData } from './SaveSystem.js';
import { DIMENSIONS } from './dimensions.js';
import { safeBiomeScale } from '../world/biomes.js';
import { BlockRegistry } from './BlockRegistry.js';
import { ItemRegistry } from './ItemRegistry.js';

export const SAVE_FILE_FORMAT = 'tiderift-save';
export const SAVE_FILE_VERSION = 1;
export const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024; // 解压上限（防压缩炸弹）

const DIM_KEYS = new Set(Object.keys(DIMENSIONS));
const GAMEMODES = new Set(['creative', 'survival', 'spectator']);
const COORD_KEY = /^-?\d+,-?\d+,-?\d+$/;
const MAX_COORD_KEY_LEN = 40;
const MAX_NAME_LEN = 64;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const HAS_COMPRESSION = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

// 带错误码的异常：UI 按 code 映射本地化文案（键表见 MenuScreen.SAVE_IMPORT_ERROR_KEYS）
export class SaveTransferError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SaveTransferError';
    this.code = code;
  }
}

// ── gzip 编解码（浏览器 / node ≥18 原生流） ──
export function isGzipBytes(bytes) {
  return !!bytes && bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function toUint8(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return null;
}

export async function gzipBytes(text) {
  if (!HAS_COMPRESSION) throw new SaveTransferError('no-compression');
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function gunzipBytes(bytes, limit = MAX_UNCOMPRESSED_BYTES) {
  if (!HAS_COMPRESSION) throw new SaveTransferError('no-compression');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch { /* 取消失败不影响判定 */ }
      throw new SaveTransferError('too-large');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(merged);
}

// ── 文件名 ──
function pad2(n) { return String(n).padStart(2, '0'); }

export function makeFileName(slot, now = Date.now(), compressed = true) {
  const d = new Date(now);
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  return `Tiderift-save-${slot}-${stamp}.${compressed ? 'tidersave' : 'json'}`;
}

// ── 导出 ──
export async function buildSaveFile(saveData, { slot = 1, build = BUILD, now = Date.now(), compress = HAS_COMPRESSION } = {}) {
  const envelope = {
    format: SAVE_FILE_FORMAT,
    fileVersion: SAVE_FILE_VERSION,
    app: 'Tiderift',
    build,
    exportedAt: now,
    slot,
    save: saveData
  };
  const json = JSON.stringify(envelope);
  const bytes = compress ? await gzipBytes(json) : new TextEncoder().encode(json);
  return {
    envelope,
    bytes,
    compressed: !!compress,
    fileName: makeFileName(slot, now, compress),
    mime: compress ? 'application/gzip' : 'application/json'
  };
}

// ── 导入：解析 ──
function isBareSave(obj) {
  return typeof obj.version === 'number' &&
    (typeof obj.seed === 'number' || typeof obj.gamemode === 'string');
}

export function parseSaveText(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new SaveTransferError('bad-json'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new SaveTransferError('not-a-save');

  let envelope;
  if (obj.format === SAVE_FILE_FORMAT) {
    if (obj.fileVersion !== SAVE_FILE_VERSION) throw new SaveTransferError('bad-file-version');
    if (!obj.save || typeof obj.save !== 'object' || Array.isArray(obj.save)) throw new SaveTransferError('not-a-save');
    envelope = obj;
  } else if (isBareSave(obj)) {
    envelope = {
      format: SAVE_FILE_FORMAT,
      fileVersion: SAVE_FILE_VERSION,
      app: 'Tiderift',
      build: 0,
      exportedAt: Number(obj.timestamp) || 0,
      slot: obj.slot,
      save: obj
    };
  } else {
    throw new SaveTransferError('not-a-save');
  }

  // 跨版本：来自更新版本的文件一律拒绝（旧客户端没有该版本的新方块 ID，会崩区块网格）
  const build = Number(envelope.build);
  if (Number.isFinite(build) && build > BUILD) throw new SaveTransferError('newer-build');

  const version = envelope.save.version;
  if (version !== 1 && version !== 2) throw new SaveTransferError('bad-save-version');
  const normalized = normalizeSaveData(envelope.save);
  if (!normalized) throw new SaveTransferError('bad-save-version');

  return { envelope, save: normalized };
}

export async function decodeSaveFile(input) {
  const bytes = toUint8(input);
  if (!bytes || bytes.length === 0) throw new SaveTransferError('unreadable');
  let text;
  if (isGzipBytes(bytes)) {
    try { text = await gunzipBytes(bytes); } catch (e) {
      if (e instanceof SaveTransferError) throw e;
      throw new SaveTransferError('unreadable');
    }
  } else {
    text = new TextDecoder().decode(bytes);
  }
  return parseSaveText(text);
}

// ── 导入：净化 ──
function finite(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// 物品/方块的堆叠上限（物品 def.stack，方块恒 64）
function stackLimitOf(name) {
  const item = ItemRegistry.getByName(name);
  if (item) return Math.max(1, Math.min(999, item.stack || 64));
  return 64;
}

function sanitizeStack(raw, dropped) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) { dropped.items++; return null; }
  const name = typeof raw.n === 'string' ? raw.n : (typeof raw.name === 'string' ? raw.name : '');
  if (!name || name.length > MAX_NAME_LEN) { dropped.items++; return null; }
  if (!ItemRegistry.getByName(name) && !BlockRegistry.getByName(name)) { dropped.items++; return null; }
  const count = Math.floor(finite(raw.c !== undefined ? raw.c : raw.count, 1));
  if (count <= 0) { dropped.items++; return null; } // 0 数量无意义，丢弃
  const data = raw.d !== undefined ? raw.d : (raw.data !== undefined ? raw.data : null);
  return { n: name, c: clamp(count, 1, stackLimitOf(name)), d: data ?? null };
}

// 容器/熔炉槽位形状是 {name,count,data}（与 Inventory 的存档形状 {n,c,d} 不同）
function sanitizeSlotStack(raw, dropped) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) { dropped.containers++; return null; }
  const name = typeof raw.name === 'string' ? raw.name : (typeof raw.n === 'string' ? raw.n : '');
  if (!name || name.length > MAX_NAME_LEN) { dropped.containers++; return null; }
  if (!ItemRegistry.getByName(name) && !BlockRegistry.getByName(name)) { dropped.containers++; return null; }
  const count = Math.floor(finite(raw.count !== undefined ? raw.count : raw.c, 1));
  if (count <= 0) { dropped.containers++; return null; }
  const data = raw.data !== undefined ? raw.data : (raw.d !== undefined ? raw.d : null);
  return { name, count: clamp(count, 1, stackLimitOf(name)), data: data ?? null };
}

function sanitizeInventory(raw, dropped) {
  const legacy = Array.isArray(raw);
  const slotsRaw = legacy ? raw : (raw && Array.isArray(raw.slots) ? raw.slots : []);
  const armorRaw = legacy ? [] : (raw && Array.isArray(raw.armor) ? raw.armor : []);
  return {
    slots: Array.from({ length: 36 }, (_, i) => sanitizeStack(slotsRaw[i], dropped)),
    armor: Array.from({ length: 4 }, (_, i) => sanitizeStack(armorRaw[i], dropped))
  };
}

function sanitizeBlockBuckets(raw, dropped) {
  const out = Object.create(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const dim of Object.keys(raw)) {
    if (DANGEROUS_KEYS.has(dim) || !DIM_KEYS.has(dim)) continue;
    const bucket = raw[dim];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    const o = Object.create(null);
    for (const key of Object.keys(bucket)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (!COORD_KEY.test(key) || key.length > MAX_COORD_KEY_LEN) { dropped.blocks++; continue; }
      const id = Number(bucket[key]);
      if (!Number.isInteger(id) || id < 0 || id > 255) { dropped.blocks++; continue; }
      if (id !== 0 && !BlockRegistry.getById(id)) { dropped.blocks++; continue; }
      o[key] = id;
    }
    out[dim] = o;
  }
  return out;
}

function sanitizeContainerBuckets(raw, dropped) {
  const out = Object.create(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const dim of Object.keys(raw)) {
    if (DANGEROUS_KEYS.has(dim) || !DIM_KEYS.has(dim)) continue;
    const bucket = raw[dim];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    const o = Object.create(null);
    for (const key of Object.keys(bucket)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (!COORD_KEY.test(key) || key.length > MAX_COORD_KEY_LEN) { dropped.containers++; continue; }
      const slots = bucket[key];
      if (!Array.isArray(slots) || slots.length !== 27) { dropped.containers++; continue; }
      o[key] = slots.map((s) => sanitizeSlotStack(s, dropped));
    }
    out[dim] = o;
  }
  return out;
}

function sanitizeFurnaceState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const dummy = { containers: 0 };
  return {
    input: sanitizeSlotStack(raw.input, dummy),
    fuel: sanitizeSlotStack(raw.fuel, dummy),
    output: sanitizeSlotStack(raw.output, dummy),
    burnTime: clamp(finite(raw.burnTime, 0), 0, 1e9),
    burnMax: clamp(finite(raw.burnMax, 0), 0, 1e9),
    cookTime: clamp(finite(raw.cookTime, 0), 0, 1e9)
  };
}

function sanitizeFurnaceBuckets(raw, dropped) {
  const out = Object.create(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const dim of Object.keys(raw)) {
    if (DANGEROUS_KEYS.has(dim) || !DIM_KEYS.has(dim)) continue;
    const bucket = raw[dim];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    const o = Object.create(null);
    for (const key of Object.keys(bucket)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (!COORD_KEY.test(key) || key.length > MAX_COORD_KEY_LEN) { dropped.furnaces++; continue; }
      const st = sanitizeFurnaceState(bucket[key]);
      if (!st) { dropped.furnaces++; continue; }
      o[key] = st;
    }
    out[dim] = o;
  }
  return out;
}

function sanitizePoint(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return { x: finite(raw.x, 0), y: finite(raw.y, 0), z: finite(raw.z, 0) };
}

function sanitizeBedSpawn(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    x: finite(raw.x, 0),
    y: finite(raw.y, 0),
    z: finite(raw.z, 0),
    dimension: DIM_KEYS.has(raw.dimension) ? raw.dimension : 'overworld'
  };
}

function sanitizePlainObject(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

// 净化存档：只修已知字段、保留未知字段（跳过原型污染键）；返回 { data, dropped }
export function sanitizeSaveData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SaveTransferError('not-a-save');
  const dropped = { items: 0, blocks: 0, containers: 0, furnaces: 0, keys: 0 };
  const out = Object.create(null);
  for (const key of Object.keys(raw)) {
    if (DANGEROUS_KEYS.has(key)) { dropped.keys++; continue; }
    out[key] = raw[key];
  }
  // V1 遗留平铺字段已迁移进维度桶，删掉避免重复存储
  delete out.modifiedBlocks;
  delete out.containers;

  out.version = SAVE_VERSION;
  out.seed = typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? raw.seed >>> 0 : 0;
  out.dimension = DIM_KEYS.has(raw.dimension) ? raw.dimension : 'overworld';
  out.gamemode = GAMEMODES.has(raw.gamemode) ? raw.gamemode : 'creative';
  out.cheatsEnabled = !!raw.cheatsEnabled;
  out.biomeScale = safeBiomeScale(raw.biomeScale);
  out.aetherDusk = !!raw.aetherDusk;
  out.dragonDefeated = !!raw.dragonDefeated;
  out.finaleDone = !!raw.finaleDone;
  out.emblemWorn = !!raw.emblemWorn;
  out.timestamp = clamp(finite(raw.timestamp, Date.now()), 0, Number.MAX_SAFE_INTEGER);

  const p = raw.player && typeof raw.player === 'object' && !Array.isArray(raw.player) ? raw.player : {};
  out.player = {
    x: finite(p.x, 0),
    y: finite(p.y, 80),
    z: finite(p.z, 0),
    yaw: finite(p.yaw, 0),
    pitch: finite(p.pitch, 0),
    health: clamp(finite(p.health, 20), 0, 20),
    food: clamp(finite(p.food, 20), 0, 20),
    saturation: clamp(finite(p.saturation, 0), 0, 20),
    exhaustion: clamp(finite(p.exhaustion, 0), 0, 1e6),
    xp: clamp(finite(p.xp, 0), 0, 1e9),
    xpLevel: clamp(finite(p.xpLevel, 0), 0, 1e6),
    onFire: clamp(finite(p.onFire, 0), 0, 1e6),
    airTicks: clamp(finite(p.airTicks, 300), 0, 300)
  };

  out.inventory = sanitizeInventory(raw.inventory, dropped);
  out.dimensionBlocks = sanitizeBlockBuckets(raw.dimensionBlocks, dropped);
  out.dimensionContainers = sanitizeContainerBuckets(raw.dimensionContainers, dropped);
  out.dimensionFurnaces = sanitizeFurnaceBuckets(raw.dimensionFurnaces, dropped);
  out.finalePrimordial = sanitizePoint(raw.finalePrimordial);
  out.bedSpawn = sanitizeBedSpawn(raw.bedSpawn);
  out.sky = { time: clamp(finite(raw.sky && raw.sky.time, 0.35), 0, 1) };
  out.redstone = sanitizePlainObject(raw.redstone);
  out.journal = sanitizePlainObject(raw.journal);
  out.waymarks = sanitizePlainObject(raw.waymarks);
  out.ruins = sanitizePlainObject(raw.ruins);
  out.races = sanitizePlainObject(raw.races);
  out.blueprints = Array.isArray(raw.blueprints) ? raw.blueprints : [];

  return { data: out, dropped };
}

export function droppedCount(dropped) {
  if (!dropped) return 0;
  let n = 0;
  for (const k of Object.keys(dropped)) n += dropped[k] || 0;
  return n;
}

// ── 摘要（导入确认弹窗用） ──
function countDimEntries(buckets) {
  if (!buckets || typeof buckets !== 'object') return 0;
  let n = 0;
  for (const dim of Object.keys(buckets)) {
    const b = buckets[dim];
    if (b && typeof b === 'object') n += Object.keys(b).length;
  }
  return n;
}

export function summarize(data) {
  return {
    slot: data.slot,
    gamemode: data.gamemode || 'creative',
    dimension: data.dimension || 'overworld',
    timestamp: Number(data.timestamp) || 0,
    seed: (Number(data.seed) || 0) >>> 0,
    cheatsEnabled: !!data.cheatsEnabled,
    blocks: countDimEntries(data.dimensionBlocks),
    containers: countDimEntries(data.dimensionContainers),
    furnaces: countDimEntries(data.dimensionFurnaces),
    finaleDone: !!data.finaleDone
  };
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export const SAVE_TRANSFER_HAS_COMPRESSION = HAS_COMPRESSION;

// 导入失败码 → 本地化文案键（UI 侧 t(SAVE_IMPORT_ERROR_KEYS[code]) 动态取值；
// 动态键在 tests/i18n-parity.mjs 登记）
export const SAVE_IMPORT_ERROR_KEYS = {
  'not-a-save': '不是有效的存档文件',
  'bad-json': '存档文件已损坏，无法读取',
  'bad-file-version': '存档文件版本不受支持',
  'bad-save-version': '存档数据版本不受支持',
  'newer-build': '该存档来自更新的游戏版本，请先升级游戏',
  'too-large': '存档文件过大，无法导入',
  'unreadable': '存档文件损坏或无法解压',
  'no-compression': '当前浏览器不支持压缩存档',
  'quota': '本地存储空间不足，无法写入存档',
  'write-failed': '写入存档失败'
};
