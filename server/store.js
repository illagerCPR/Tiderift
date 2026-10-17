// store.js -- 房间世界落盘：server/world/<房间名>.json 读写
// 服务器重启后从磁盘恢复各房间（方块账本/掉落物/种子/时间/计数器），实现"重启不丢世界"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'world');

// 房间名 -> 安全文件名（中文/字母/数字/连字符保留，其余替换为 _，空名回退 default）
export function roomFileName(name) {
  const s = String(name || '').trim() || 'default';
  return s.replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 40);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// S3：原子落盘——先写同目录临时文件再 rename 替换，避免写入中途崩溃/掉电留下截断档（截断档=静默丢档）
export function writeFileAtomic(file, text) {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

// 房间世界快照（纯数据，saveRoom 与 Idea-4B 备份导出共用）
// 快照 V2（M4）：blocks/containers 按维度分桶 {dim: [entries]}；旧格式由 Room.restore 迁移
export function roomSnapshot(room) {
  const dimensionBlocks = {};
  for (const [dim, m] of room.dimensionBlocks) dimensionBlocks[dim] = [...m.entries()];
  const dimensionContainers = {};
  for (const [dim, m] of room.dimensionContainers) dimensionContainers[dim] = [...m.entries()];
  return {
    name: room.name,
    seed: room.seed,
    biomeScale: room.biomeScale || null, // 群系规模档位（旧快照无字段 → restore 回落 null→small）
    time: room.time,
    aetherDusk: !!room.aetherDusk, // 天域复潮状态（批次 D，旧快照无字段 → restore 回落 false）
    finaleOffered: !!room.finaleOffered, // 终局篇 F3：候潮/听潮状态（单向开关落盘）
    finalePos: room.finalePos || null,
    finaleDone: !!room.finaleDone,
    nextDropId: room.nextDropId,
    nextMobId: room.nextMobId,
    dimensionBlocks,
    dimensionContainers,
    drops: [...room.drops.entries()].map(([id, d]) => ({ id, ...d })),
    savedAt: Date.now(),
  };
}

// 将房间世界写入磁盘 <dir>/<房间名>.json
export function saveRoom(room, dir = DEFAULT_DIR) {
  ensureDir(dir);
  const data = roomSnapshot(room);
  writeFileAtomic(path.join(dir, roomFileName(room.name) + '.json'), JSON.stringify(data, null, 2));
}

// 坏档归档：移入 <dir>/corrupt/（默认即 server/world/corrupt/，跑批 rm -rf server/world 一并清理）
function archiveCorrupt(dir, file, reason) {
  const target = path.join(dir, 'corrupt', `${file.replace(/\.json$/, '')}-${Date.now()}.json`);
  try {
    ensureDir(path.dirname(target));
    fs.renameSync(path.join(dir, file), target);
    console.error(`[世界] 坏档 ${file}（${reason}）已归档到 ${target}`);
  } catch (e) {
    console.error(`[世界] 坏档 ${file}（${reason}）归档失败: ${e.message}`);
  }
}

// S2：快照形状校验——内层 entries/containers/drops 必须为数组，否则 Room.restore 迭代时抛 TypeError 崩服
function isRoomSnapshot(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (typeof data.name !== 'string' || !Number.isInteger(data.seed)) return false;
  for (const key of ['dimensionBlocks', 'dimensionContainers']) {
    const bucket = data[key];
    if (bucket === undefined) continue;
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return false;
    for (const entries of Object.values(bucket)) if (!Array.isArray(entries)) return false;
  }
  for (const key of ['blocks', 'containers', 'drops']) { // 含 V1 平铺旧格式（restore 回退分支同样要迭代）
    if (data[key] !== undefined && !Array.isArray(data[key])) return false;
  }
  return true;
}

// 读取磁盘上全部房间快照（原始对象数组，恢复逻辑在 Room.restore）
// 坏档（解析失败/形状非法）移入 corrupt/ 保留现场并报警，既不让畸形档流进 restore，也不静默丢档
export function loadRooms(dir = DEFAULT_DIR) {
  const rooms = [];
  if (!fs.existsSync(dir)) return rooms;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      archiveCorrupt(dir, f, `JSON 解析失败: ${e.message}`);
      continue;
    }
    if (!isRoomSnapshot(data)) {
      archiveCorrupt(dir, f, '快照结构非法');
      continue;
    }
    rooms.push(data);
  }
  return rooms;
}

// 删除某房间的世界存档（供测试/管理使用）
export function deleteRoomFile(name, dir = DEFAULT_DIR) {
  try { fs.unlinkSync(path.join(dir, roomFileName(name) + '.json')); } catch {}
}

// ---- Idea-3C：玩家档案（server/world/players/<房间名>.players.json）----
// 独立目录存储：档案高频写（每 10s 脏刷新 + 退房即写），与房间世界快照分离避免写放大。
// 结构：{ 昵称: { inventory, position, dim, health, food, saturation, xp, xpLevel, savedAt } }

export function loadPlayerProfiles(roomName, dir = DEFAULT_DIR) {
  const file = path.join(dir, 'players', roomFileName(roomName) + '.players.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {}; // 不存在/损坏 → 空档案（首次进房即建档）
  }
}

export function savePlayerProfiles(roomName, profiles, dir = DEFAULT_DIR) {
  const playersDir = path.join(dir, 'players');
  if (!fs.existsSync(playersDir)) fs.mkdirSync(playersDir, { recursive: true });
  const file = path.join(playersDir, roomFileName(roomName) + '.players.json');
  writeFileAtomic(file, JSON.stringify(profiles, null, 2));
}

export function deletePlayerProfiles(roomName, dir = DEFAULT_DIR) {
  try { fs.unlinkSync(path.join(dir, 'players', roomFileName(roomName) + '.players.json')); } catch {}
}

// ---- Idea-4B：世界备份（<dir>/backups/<房间名>-<毫秒时间戳>.json）----

const BACKUP_TS_RE = /-(\d+)\.json$/;

// 备份目录路径（懒建）
function backupsDir(dir) {
  const d = path.join(dir, 'backups');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

// 将房间当前世界快照写入备份目录，返回备份文件名（<safe>-<ts>.json）
export function backupRoom(room, dir = DEFAULT_DIR) {
  const ts = Date.now();
  const file = `${roomFileName(room.name)}-${ts}.json`;
  writeFileAtomic(path.join(backupsDir(dir), file), JSON.stringify(roomSnapshot(room), null, 2));
  return file;
}

// 列出某房间的备份（按时间戳降序，最新在前），项 {file, ts}
export function listBackups(roomName, dir = DEFAULT_DIR) {
  const prefix = roomFileName(roomName) + '-';
  const d = path.join(dir, 'backups');
  if (!fs.existsSync(d)) return [];
  const out = [];
  for (const f of fs.readdirSync(d)) {
    if (!f.startsWith(prefix) || !f.endsWith('.json')) continue;
    const m = f.match(BACKUP_TS_RE);
    if (m) out.push({ file: f, ts: Number(m[1]) });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

// 修剪备份：只保留最新 keep 份，返回删除的文件名数组
export function pruneBackups(roomName, keep, dir = DEFAULT_DIR) {
  const list = listBackups(roomName, dir);
  const removed = [];
  for (let i = keep; i < list.length; i++) {
    try { fs.unlinkSync(path.join(dir, 'backups', list[i].file)); removed.push(list[i].file); } catch {}
  }
  return removed;
}
