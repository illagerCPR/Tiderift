// Blueprints.js -- 建筑蓝图校验、编码、捕获与材料需求模型
import { BlockRegistry } from './BlockRegistry.js';
import { ItemRegistry } from './ItemRegistry.js';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './Chunk.js';

export const BLUEPRINT_LIMITS = Object.freeze({ axis: 32, volume: 32768, palette: 256, dataBytes: 16384, instances: 4096, roomCount: 24, reach: 32 });
export const BLUEPRINT_DIMS = Object.freeze(['overworld', 'nether', 'end', 'aether']);
const ID_PATTERN = /^[a-z0-9]{6,20}$/;

export function validateBlueprintName(name) {
  return typeof name === 'string' && [...name].length > 0 && [...name].length <= 24 && name.trim().length > 0;
}

function validateSize(size) {
  if (!size || typeof size !== 'object') return null;
  const { x, y, z } = size;
  if (![x, y, z].every((value) => Number.isInteger(value) && value >= 1 && value <= BLUEPRINT_LIMITS.axis)) return null;
  const volume = x * y * z;
  return volume <= BLUEPRINT_LIMITS.volume ? volume : null;
}

// 框选规则：两次点选各自距玩家不超过 32 格（逐次点选当场判定，不按包围盒对角判）
export function isWithinCaptureReach(point, origin, max = BLUEPRINT_LIMITS.reach) {
  if (!point || !origin) return false;
  const dx = point.x - origin.x, dy = point.y - origin.y, dz = point.z - origin.z;
  if (![dx, dy, dz].every(Number.isFinite)) return false;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= max;
}

export function encodeBlueprintRLE(voxels, palette) {
  if (!Array.isArray(voxels) && !(voxels instanceof Uint8Array)) throw new TypeError('voxels must be an array');
  if (!Array.isArray(palette) || palette.length < 1) throw new TypeError('palette must be nonempty');
  if (!isValidPalette(palette)) throw new TypeError('invalid palette');
  const indexById = new Map(palette.map((id, index) => [id, index]));
  const runs = [];
  let previous = -1, length = 0;
  for (const blockId of voxels) {
    const index = indexById.get(blockId);
    if (index === undefined) throw new TypeError('voxel id missing from palette');
    if (index === previous) length++;
    else {
      if (length) runs.push(previous.toString(36) + '.' + length.toString(36));
      previous = index; length = 1;
    }
  }
  if (length) runs.push(previous.toString(36) + '.' + length.toString(36));
  const encoded = runs.join(',');
  if (encoded.length > BLUEPRINT_LIMITS.dataBytes) throw new RangeError('blueprint data exceeds 16 KB');
  return encoded;
}

export function decodeBlueprintRLE(data, palette, expectedLength) {
  if (typeof data !== 'string' || data.length === 0 || data.length > BLUEPRINT_LIMITS.dataBytes || !/^[\x00-\x7f]*$/.test(data)) return null;
  if (!isValidPalette(palette) || !Number.isInteger(expectedLength) || expectedLength < 1) return null;
  const tokens = data.split(',');
  const result = new Uint8Array(expectedLength);
  let offset = 0, previous = -1;
  for (const token of tokens) {
    const match = /^(0|[1-9a-z][0-9a-z]*)\.([1-9a-z][0-9a-z]*)$/.exec(token);
    if (!match) return null;
    const index = Number.parseInt(match[1], 36);
    const count = Number.parseInt(match[2], 36);
    if (match[1] !== index.toString(36) || match[2] !== count.toString(36) || !Number.isSafeInteger(index) || index >= palette.length || !Number.isSafeInteger(count) || count <= 0 || index === previous || offset + count > expectedLength) return null;
    result.fill(palette[index], offset, offset + count);
    offset += count;
    previous = index;
  }
  return offset === expectedLength ? result : null;
}

function isValidPalette(palette) {
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > BLUEPRINT_LIMITS.palette || palette[0] !== 0) return false;
  const seen = new Set();
  for (const blockId of palette) {
    if (!Number.isInteger(blockId) || blockId < 0 || blockId > 255 || seen.has(blockId)) return false;
    seen.add(blockId);
  }
  return true;
}

export function validateBlueprint(blueprint) {
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) return { ok: false, reason: 'object' };
  if (typeof blueprint.id !== 'string' || !ID_PATTERN.test(blueprint.id)) return { ok: false, reason: 'id' };
  if (!validateBlueprintName(blueprint.name)) return { ok: false, reason: 'name' };
  if (!BLUEPRINT_DIMS.includes(blueprint.dim)) return { ok: false, reason: 'dim' };
  if (!Number.isInteger(blueprint.rev) || blueprint.rev < 1 || blueprint.rev > 99999) return { ok: false, reason: 'rev' };
  if (typeof blueprint.byId !== 'string') return { ok: false, reason: 'byId' };
  const volume = validateSize(blueprint.size);
  if (volume === null) return { ok: false, reason: 'size' };
  if (!isValidPalette(blueprint.palette)) return { ok: false, reason: 'palette' };
  const voxels = decodeBlueprintRLE(blueprint.data, blueprint.palette, volume);
  if (!voxels) return { ok: false, reason: 'data' };
  return { ok: true, voxels, volume };
}

export function captureBlueprint(world, first, second, { id, name, byId = '' } = {}) {
  if (!world || !first || !second || ![first.x, first.y, first.z, second.x, second.y, second.z].every(Number.isInteger)) return { ok: false, reason: 'coordinates' };
  const min = { x: Math.min(first.x, second.x), y: Math.min(first.y, second.y), z: Math.min(first.z, second.z) };
  const max = { x: Math.max(first.x, second.x), y: Math.max(first.y, second.y), z: Math.max(first.z, second.z) };
  const size = { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 };
  const volume = validateSize(size);
  if (volume === null || min.y < 0 || max.y >= CHUNK_HEIGHT) return { ok: false, reason: 'size' };
  const chunks = new Map();
  for (let cz = Math.floor(min.z / CHUNK_SIZE); cz <= Math.floor(max.z / CHUNK_SIZE); cz++) {
    for (let cx = Math.floor(min.x / CHUNK_SIZE); cx <= Math.floor(max.x / CHUNK_SIZE); cx++) {
      const chunk = world.getChunk(cx, cz);
      if (!chunk || !chunk.blocks || chunk.blocks.length < CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT) return { ok: false, reason: 'unloaded' };
      chunks.set(cx + ',' + cz, chunk);
    }
  }
  const voxels = new Uint8Array(volume);
  const palette = [0];
  const paletteIndex = new Map([[0, 0]]);
  let offset = 0;
  for (let y = min.y; y <= max.y; y++) {
    for (let z = min.z; z <= max.z; z++) {
      for (let x = min.x; x <= max.x; x++) {
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
        const chunk = chunks.get(cx + ',' + cz);
        const id = chunk.blocks[Chunk.index(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)];
        if (!paletteIndex.has(id)) {
          if (palette.length >= BLUEPRINT_LIMITS.palette) return { ok: false, reason: 'palette' };
          paletteIndex.set(id, palette.length);
          palette.push(id);
        }
        voxels[offset++] = id;
      }
    }
  }
  let data;
  try { data = encodeBlueprintRLE(voxels, palette); }
  catch (error) { return { ok: false, reason: error.message.includes('16 KB') ? 'data' : 'palette' }; }
  const blueprint = { id, name, dim: world.dimension, rev: 1, byId: String(byId), size, palette, data };
  const checked = validateBlueprint(blueprint);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  return { ok: true, blueprint, voxels, origin: min };
}

export function inventoryBlockCount(inventory, blockName) {
  if (!inventory || !Array.isArray(inventory.slots) || typeof blockName !== 'string') return 0;
  const block = BlockRegistry.getByName(blockName);
  const baseName = block && block.baseBlock ? block.baseBlock : blockName;
  let total = 0;
  for (const stack of inventory.slots) {
    if (!stack || !Number.isFinite(stack.count) || stack.count <= 0) continue;
    const item = ItemRegistry.getByName(stack.name);
    const alias = stack.name === 'redstone_torch_item' ? 'redstone_torch' : (stack.name === 'bone_meal_item' ? 'bone_meal' : null);
    const itemBlock = item && (item.blockName || item.name);
    const candidates = [stack.name, alias, itemBlock].filter(Boolean);
    const matches = candidates.some((candidate) => {
      const itemDef = BlockRegistry.getByName(candidate);
      const itemBase = itemDef && itemDef.baseBlock ? itemDef.baseBlock : candidate;
      return candidate === blockName || candidate === baseName || itemBase === baseName;
    });
    if (matches) total += Math.floor(stack.count);
  }
  return total;
}

export function calculateBlueprintMaterials(blueprint, inventory) {
  const checked = validateBlueprint(blueprint);
  if (!checked.ok) return { ok: false, reason: checked.reason, materials: [] };
  const counts = new Map();
  for (const id of checked.voxels) {
    if (id === 0) continue;
    const def = BlockRegistry.getById(id);
    const name = def ? (def.baseBlock || def.name) : String(id);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const materials = [...counts].map(([name, needed]) => {
    const owned = inventoryBlockCount(inventory, name);
    return { name, needed, owned, missing: Math.max(0, needed - owned) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, materials };
}

export class Blueprints {
  constructor() { this.personal = []; this.shared = []; }

  resetPersonal(value) {
    this.personal = Array.isArray(value) ? value.filter((blueprint) => blueprint && validateBlueprint(blueprint).ok && blueprint.byId === '').slice(0, BLUEPRINT_LIMITS.roomCount).map((blueprint) => structuredClone(blueprint)) : [];
  }

  resetShared(value) {
    this.shared = Array.isArray(value) ? value.filter((blueprint) => blueprint && validateBlueprint(blueprint).ok && blueprint.byId !== '').map((blueprint) => structuredClone(blueprint)) : [];
  }

  serializePersonal() { return this.personal.map((blueprint) => structuredClone(blueprint)); }

  createPersonal(blueprint) {
    if (!blueprint || !validateBlueprint(blueprint).ok || blueprint.byId !== '') return false;
    if (this.personal.some((entry) => entry.id === blueprint.id)) return this.editPersonal(blueprint.id, blueprint);
    if (this.personal.length >= BLUEPRINT_LIMITS.roomCount) return false;
    this.personal.push(structuredClone(blueprint));
    return true;
  }

  // B35 D：按 id 或名字去重后再塞进个人集合（遗迹奖励重复领取/换语言后同名不同串都不重复塞）
  addPersonalUnique(blueprint) {
    if (!blueprint || typeof blueprint !== 'object') return false;
    if (this.personal.some((entry) => entry.id === blueprint.id || entry.name === blueprint.name)) return false;
    return this.createPersonal(blueprint);
  }

  editPersonal(id, changes) {
    const index = this.personal.findIndex((entry) => entry.id === id);
    if (index < 0 || !changes || typeof changes !== 'object' || this.personal[index].rev >= 99999) return false;
    const current = this.personal[index];
    const updated = { ...current, ...changes, id: current.id, byId: '', rev: Math.min(99999, current.rev + 1) };
    if (!validateBlueprint(updated).ok) return false;
    this.personal[index] = updated;
    return true;
  }

  removePersonal(id) {
    const previous = this.personal.length;
    this.personal = this.personal.filter((entry) => entry.id !== id);
    return this.personal.length !== previous;
  }

  applyShared(blueprint) {
    if (!blueprint || blueprint.byId === '' || !validateBlueprint(blueprint).ok) return false;
    const index = this.shared.findIndex((entry) => entry.id === blueprint.id);
    if (index >= 0 && blueprint.rev < this.shared[index].rev) return false;
    if (index >= 0) this.shared[index] = structuredClone(blueprint);
    else {
      if (this.shared.length >= BLUEPRINT_LIMITS.roomCount) return false;
      this.shared.push(structuredClone(blueprint));
    }
    return true;
  }

  removeShared(id) {
    const previous = this.shared.length;
    this.shared = this.shared.filter((entry) => entry.id !== id);
    return this.shared.length !== previous;
  }
}
