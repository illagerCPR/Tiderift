// BlockRegistry.js -- 方块注册表
// 每个方块定义: { id, name, textures:{top,side,bottom,front} 或 all, transparent, solid, hardness, light }

const blocks = new Map();
const nameToId = new Map();
const idToName = new Map();
let nextId = 1; // 0 保留给空气

function register(def) {
  const id = def.id ?? nextId++;
  const name = def.name;
  const tex = def.textures;
  // 统一为 {top, side, bottom}；未指定时用方块名作为贴图名
  // B28：front = 定向面（正对 facing 的那一面）纹理名，其余四面用 side
  let top, side, bottom, front = null;
  if (typeof tex === 'string') { top = side = bottom = tex; }
  else if (tex && typeof tex === 'object') {
    top = tex.top || tex.side || name;
    side = tex.side || tex.top || name;
    bottom = tex.bottom || tex.side || name;
    front = tex.front || null;
  } else {
    top = side = bottom = name;
  }
  // B28 朝向（'n'|'s'|'e'|'w'）：定向面方块 facing 边用 front 纹理，其余三面 side。
  // 显式给 front 而未给 facing 时按朝北（本名态）处理。
  const facing = def.facing || (front ? 'n' : null);
  const faceTex = front ? { n: side, s: side, e: side, w: side, [facing]: front } : null;
  const block = {
    id,
    name,
    displayName: def.displayName || name,
    top, side, bottom,
    // B28：front = 定向面纹理键（无则 null）；faceTex = 四水平面 → 纹理键表（ChunkMesh 逐面取用）
    front, faceTex,
    // B28：UI 图标纹理键（有定向面时用定向面——箱子/熔炉图标要看得出正面）
    icon: def.icon || front || side,
    transparent: def.transparent ?? false,
    solid: def.solid ?? true,
    hardness: def.hardness ?? 1,
    tool: def.tool || null,
    minTier: def.minTier ?? 0,
    light: def.light ?? 0,
    fluid: def.fluid ?? false,
    fluidType: def.fluidType || null, // B26 流体模拟：'water'/'lava'（流动等级方块与源同值，判定按此不按 name）
    renderType: def.renderType || 'cube',
    // B27 床/门形制：格内 AABB（单位坐标）——渲染 addBox 与碰撞 cellBox 共用
    shape: def.shape || null,
    // B27 门/床/活板门状态家族：'door_lower'|'door_upper'|'bed_foot'|'bed_head'|null
    part: def.part || null,
    // B27 朝向（'n'|'s'|'e'|'w'）：门=关态面板贴的边；床=foot→head 方向；活板门=开态贴边
    // B28：定向面方块（箱子/熔炉/头颅）= 正面（front 纹理面）所在边
    facing,
    open: def.open ?? false,
    baseBlock: def.baseBlock || null, // 家族基名（'oak_door' 等）——掉落/物品映射用
    // B28：可放置朝向家族基础名（'chest'）——放置时按玩家方位替换为对应朝向态
    facingBase: def.facingBase || null,
    lit: def.lit ?? false, // B28 功能方块二次状态（熔炉点燃/红石灯充能）
    updraft: def.updraft ?? false, // 天域批次 B：上升气流柱（Game._updateUpdraftState 消费）
    lore: def.lore || null, // 世界观批次 N1：方块悬浮 lore（InventoryScreen._bindHover 消费）
    stele: def.stele ?? false, // 世界观批次 W3：石碑家族标记（Game 右键读碑按此判定，修 wind_stele 硬编码遗漏 ember/moss）
    ambientParticles: def.ambientParticles ?? false,
    color: def.color || null
  };
  blocks.set(id, block);
  nameToId.set(name, id);
  idToName.set(id, name);
  return id;
}

function getById(id) { return blocks.get(id); }
function getByName(name) { const id = nameToId.get(name); return id ? blocks.get(id) : undefined; }
function getId(name) { return nameToId.get(name) || 0; }
function getNameById(id) { return idToName.get(id) || null; }
function all() { return [...blocks.values()]; }

export const BlockRegistry = { register, getById, getByName, getId, getNameById, all };
