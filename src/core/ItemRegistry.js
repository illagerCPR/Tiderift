// ItemRegistry.js -- 物品注册表（非方块物品）
// B51：额外内容归属白名单 requiresExtras（同 BlockRegistry 口径，注册永远全量）
import { normalizeRequires } from '../content/ExtraContent.js';

const items = new Map();
const nameToId = new Map();
let nextId = 1;

function register(def) {
  const id = def.id ?? nextId++;
  const name = def.name;
  const item = {
    id,
    name,
    displayName: def.displayName || name,
    stack: def.stack ?? 64,
    food: def.food ?? 0,
    tool: def.tool || null,
    tier: def.tier ?? 0,
    durability: def.durability ?? 0,
    damage: def.damage ?? 0,
    armorSlot: def.armorSlot || null,
    armorPoints: def.armorPoints ?? 0,
    lore: def.lore || null, // 天域批次 A：物品残文行（语言包键，InventoryScreen tooltip t() 渲染）
    blockName: def.blockName || null,
    // B51：额外内容归属（null = 基础内容；数组 = 需要全部启用，未知 ID 永不满足）
    requiresExtras: normalizeRequires(def.requiresExtras)
  };
  items.set(id, item);
  nameToId.set(name, id);
  return id;
}

function getById(id) { return items.get(id); }
function getByName(name) { const id = nameToId.get(name); return id ? items.get(id) : undefined; }
function getId(name) { return nameToId.get(name) || 0; }
function all() { return [...items.values()]; }

export const ItemRegistry = { register, getById, getByName, getId, all };
