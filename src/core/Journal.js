// Journal.js -- 四界游记数据与探索记录
import { DIMENSIONS } from './dimensions.js';
import { PHENOMENON_ORDER, phenomenonFor } from './Phenomena.js';

const CELL_LIMIT = 12000;
const DISCOVERY_LIMIT = 512;
const MARKER_LIMIT = 64;
const SHARED_MARKER_LIMIT = 256;
const BIOME_CODE = /^[a-z0-9_-]{1,32}$/;
const ANCHOR_CODE = /^-?[0-9]{1,9},-?[0-9]{1,9}$/;

function validCoord(v) {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 30000000;
}

function cleanText(value, max = 48) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function validDim(dim) {
  return !!(DIMENSIONS[dim] && DIMENSIONS[dim].implemented);
}

function emptyBuckets() {
  return Object.fromEntries(Object.keys(DIMENSIONS).filter((id) => DIMENSIONS[id].implemented).map((id) => [id, new Map()]));
}

function sanitizeMarker(raw, shared = false) {
  if (!raw || typeof raw !== 'object' || !validDim(raw.dim) ||
      !validCoord(raw.x) || !validCoord(raw.y) || !validCoord(raw.z)) return null;
  const label = cleanText(raw.label);
  if (!label) return null;
  const marker = {
    id: cleanText(raw.id, 48), dim: raw.dim,
    x: raw.x, y: raw.y, z: raw.z, label,
    color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#f4ca64',
  };
  if (shared) {
    marker.ownerId = Number.isInteger(raw.ownerId) ? raw.ownerId : 0;
    marker.owner = cleanText(raw.owner, 24);
  }
  return marker;
}

export class Journal {
  constructor(game) {
    this.game = game;
    this.reset(null);
  }

  reset(raw) {
    this.explored = emptyBuckets();
    this.discoveries = [];
    this.readSteles = new Set();
    this.markers = [];
    this.sharedMarkers = [];
    this.phenomena = [];        // 潮候观测记录（Build 37 G）：[{ dim, kind, anchor, at }]
    this.phenomenaSouvenir = false; // 四象集齐纪念是否已发放（一次性，随存档保留）
    this.lastPosition = {};
    this._lastCell = null;
    this.deserialize(raw);
  }

  deserialize(raw) {
    if (!raw || typeof raw !== 'object') return;
    for (const dim of Object.keys(this.explored)) {
      const source = raw.explored && raw.explored[dim];
      if (typeof source === 'string') {
        for (const row of source.split(';').slice(-CELL_LIMIT)) {
          const parts = row.split(',');
          if (parts.length !== 3 || !BIOME_CODE.test(parts[2])) continue;
          const cx = parseInt(parts[0], 36), cz = parseInt(parts[1], 36);
          if (Number.isSafeInteger(cx) && Number.isSafeInteger(cz) && Math.abs(cx) <= 1875000 && Math.abs(cz) <= 1875000) {
            this.explored[dim].set(`${cx},${cz}`, parts[2]);
          }
        }
      } else if (Array.isArray(source)) {
        for (const row of source.slice(-CELL_LIMIT)) {
          if (!Array.isArray(row) || row.length !== 3) continue;
          const [cx, cz, biome] = row;
          if (Number.isInteger(cx) && Number.isInteger(cz) && BIOME_CODE.test(String(biome))) {
            this.explored[dim].set(`${cx},${cz}`, String(biome));
          }
        }
      }
    }
    if (Array.isArray(raw.discoveries)) {
      const seen = new Set();
      for (const item of raw.discoveries.slice(-DISCOVERY_LIMIT)) {
        if (!item || !validDim(item.dim) || typeof item.type !== 'string' ||
            !validCoord(item.x) || !validCoord(item.z)) continue;
        const key = `${item.dim}|${item.type}|${Math.floor(item.x)},${Math.floor(item.z)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.discoveries.push({ key, dim: item.dim, type: cleanText(item.type, 32),
          x: item.x, z: item.z, label: cleanText(item.label, 48) || cleanText(item.type, 32) });
      }
    }
    if (Array.isArray(raw.readSteles)) {
      for (const id of raw.readSteles.slice(-DISCOVERY_LIMIT)) {
        if (typeof id === 'string' && /^[a-z0-9_-]{1,40}$/.test(id)) this.readSteles.add(id);
      }
    }
    if (Array.isArray(raw.markers)) {
      for (const item of raw.markers.slice(-MARKER_LIMIT)) {
        const marker = sanitizeMarker(item);
        if (marker) this.markers.push(marker);
      }
    }
    // 潮候记录（Build 37 G）：旧档无此字段 → 空表回落，不迁移不报错。
    // 合法条目必须「维度 + 现象种类」与定义表相符，重复项直接丢弃（同维度同现象只记一次）。
    if (Array.isArray(raw.phenomena)) {
      const seen = new Set();
      for (const item of raw.phenomena.slice(-PHENOMENON_ORDER.length * 2)) {
        if (!item || typeof item !== 'object' || !validDim(item.dim)) continue;
        const def = phenomenonFor(item.dim);
        if (!def || def.kind !== item.kind || seen.has(item.dim)) continue;
        seen.add(item.dim);
        this.phenomena.push({
          dim: item.dim, kind: def.kind,
          anchor: ANCHOR_CODE.test(String(item.anchor)) ? String(item.anchor) : '0,0',
          at: Number.isFinite(item.at) ? item.at : 0,
        });
      }
    }
    this.phenomenaSouvenir = raw.phenomenaSouvenir === true;
    if (raw.lastPosition && typeof raw.lastPosition === 'object') {
      for (const dim of Object.keys(this.explored)) {
        const p = raw.lastPosition[dim];
        if (p && validCoord(p.x) && validCoord(p.z)) this.lastPosition[dim] = { x: p.x, z: p.z };
      }
    }
  }

  serialize() {
    const explored = {};
    for (const [dim, cells] of Object.entries(this.explored)) {
      const rows = [...cells.entries()].slice(-CELL_LIMIT).map(([key, biome]) => {
        const [cx, cz] = key.split(',').map(Number);
        return `${cx.toString(36)},${cz.toString(36)},${biome}`;
      });
      explored[dim] = rows.join(';');
    }
    return {
      version: 1,
      explored,
      discoveries: this.discoveries.slice(-DISCOVERY_LIMIT).map(({ dim, type, x, z, label }) => ({ dim, type, x, z, label })),
      readSteles: [...this.readSteles].slice(-DISCOVERY_LIMIT),
      markers: this.markers.slice(-MARKER_LIMIT).map((m) => ({ ...m })),
      phenomena: this.phenomena.map((p) => ({ ...p })),
      phenomenaSouvenir: this.phenomenaSouvenir,
      lastPosition: { ...this.lastPosition },
    };
  }

  observe(dim, x, z) {
    if (!validDim(dim) || !validCoord(x) || !validCoord(z)) return false;
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const cellKey = `${dim}|${cx},${cz}`;
    this.lastPosition[dim] = { x, z };
    if (this._lastCell === cellKey) return false;
    this._lastCell = cellKey;
    const cells = this.explored[dim];
    let changed = false;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const tx = cx + dx, tz = cz + dz, key = `${tx},${tz}`;
        if (cells.has(key)) continue;
        const biome = this.game.world?.generator?.getBiome((tx + 0.5) * 16, (tz + 0.5) * 16);
        const code = String(biome ?? 'unknown').toLowerCase();
        cells.set(key, BIOME_CODE.test(code) ? code : 'unknown');
        changed = true;
      }
    }
    while (cells.size > CELL_LIMIT) cells.delete(cells.keys().next().value);
    return changed;
  }

  isExplored(dim, cx, cz) {
    return !!(this.explored[dim] && this.explored[dim].has(`${cx},${cz}`));
  }

  recordDiscovery(dim, type, x, z, label) {
    if (!validDim(dim) || !validCoord(x) || !validCoord(z)) return false;
    const key = `${dim}|${type}|${Math.floor(x)},${Math.floor(z)}`;
    if (this.discoveries.some((item) => item.key === key)) return false;
    this.discoveries.push({ key, dim, type: cleanText(type, 32), x, z, label: cleanText(label, 48) || cleanText(type, 32) });
    if (this.discoveries.length > DISCOVERY_LIMIT) this.discoveries.shift();
    return true;
  }

  recordStele(id) {
    if (typeof id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(id) || this.readSteles.has(id)) return false;
    this.readSteles.add(id);
    while (this.readSteles.size > DISCOVERY_LIMIT) this.readSteles.delete(this.readSteles.values().next().value);
    return true;
  }

  addMarker(dim, x, y, z, label) {
    const marker = sanitizeMarker({ id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, dim, x, y, z, label });
    if (!marker) return null;
    this.markers.push(marker);
    if (this.markers.length > MARKER_LIMIT) this.markers.shift();
    return marker;
  }

  removeMarker(id) {
    const before = this.markers.length;
    this.markers = this.markers.filter((m) => m.id !== id);
    return this.markers.length !== before;
  }

  setSharedMarkers(markers) {
    this.sharedMarkers = [];
    for (const item of (Array.isArray(markers) ? markers.slice(-SHARED_MARKER_LIMIT) : [])) this.upsertSharedMarker(item);
  }

  upsertSharedMarker(raw) {
    const marker = sanitizeMarker(raw, true);
    if (!marker || !marker.id) return false;
    const index = this.sharedMarkers.findIndex((m) => m.id === marker.id);
    if (index >= 0) this.sharedMarkers[index] = marker;
    else {
      this.sharedMarkers.push(marker);
      if (this.sharedMarkers.length > SHARED_MARKER_LIMIT) this.sharedMarkers.shift();
    }
    return true;
  }

  removeSharedMarker(id) {
    this.sharedMarkers = this.sharedMarkers.filter((m) => m.id !== id);
  }

  // ── 局部潮候（Build 37 G）──────────────────────────────────────────────
  // 只认定义表里的「维度 + 现象种类」，同维度同现象只记一次（重复观测返回 false，不刷新记录）。
  recordPhenomenon(dim, kind, anchorKey) {
    const def = phenomenonFor(dim);
    if (!def || def.kind !== kind) return false;
    if (this.phenomena.some((p) => p.dim === dim)) return false;
    this.phenomena.push({
      dim, kind: def.kind,
      anchor: ANCHOR_CODE.test(String(anchorKey)) ? String(anchorKey) : '0,0',
      at: Date.now(),
    });
    return true;
  }

  hasPhenomenon(dim) {
    return this.phenomena.some((p) => p.dim === dim);
  }

  phenomenaCount() {
    return this.phenomena.length;
  }

  // 四种集齐（按定义表判定，维度没实现时不参与要求）
  phenomenaComplete() {
    return PHENOMENON_ORDER.every((dim) => !DIMENSIONS[dim] || !DIMENSIONS[dim].implemented || this.hasPhenomenon(dim));
  }

  // 一次性纪念：只有集齐且未发放过才返回 true（调用方据此发物品）。
  claimPhenomenaSouvenir() {
    if (this.phenomenaSouvenir || !this.phenomenaComplete()) return false;
    this.phenomenaSouvenir = true;
    return true;
  }
}

export { cleanText as cleanJournalText };
