// village.js -- 村庄结构：中央水井 + 四向道路 + 环路建筑套件（平原/沙漠变体）
// 布局纯函数：只依赖 (rng, 锚点, 地表高度, generator 纯查询)，追加顺序=绘制优先级。
// meta 携带 villagerSpawns（门前景位/井边）与 houses，供村民生成（T2）读取。
import { Biomes } from '../biomes.js';
import { blockId } from './StructureManager.js';
import { fillBox, wallsBox, clearBox, floorBox, foundation } from './StructureKit.js';
import { steleStack } from '../steles.js';
import { doorId } from '../../core/blockShape.js';

const CLEAR_TOP = 7;   // 建筑足迹上方清空高度（容纳树冠）
const ROAD_LEN = 28;   // 道路臂长（自井心）
const ROAD_HALF = 1;   // 道路半宽（3 格宽）

export const VILLAGE_DEF = {
  cell: 20,            // 网格边长（区块）→ 有效间距数百格
  attempts: 6,         // 每 cell 6 次锚点尝试（水系/坡地拒绝率高，靠多次尝试提升可放置率）
  radius: 48,          // 最大水平半径（扫描范围与 bbox 兜底）
  chance: 0.5,         // 单次尝试通过概率
  salt: 101,
  biomes: [Biomes.PLAINS, Biomes.DESERT],
  probeR: [10, 18],    // 小探针环：本作沙漠斑块小，大环会系统性排除沙漠村庄
  minTop: 65,          // 海平面+1（低于此为水体）；坡地由地基/铺路原语贴合，门控不求天然平坦
  maxTop: 92,
  maxSlope: 8,
  solve: solveVillage,
};

export function solveVillage(rng, ax, groundY, az, gen) {
  const baseAt = (x, z) => gen.getBaseHeight(x, z);
  const plains = gen.getBiome(ax, az) === Biomes.PLAINS;

  // 材料表：平原=橡木木板/圆石/云杉屋顶；沙漠=砂岩/白陶瓦
  // B46：路面两种变体统一换成草径（草径顶面低 1 像素，村庄道路有"踩实的小径"观感）
  const M = plains ? {
    wall: blockId('oak_planks'), corner: blockId('oak_log'), base: blockId('cobblestone'),
    roof: blockId('spruce_planks'), floor: blockId('oak_planks'), path: blockId('grass_path'),
    post: blockId('oak_log'),
  } : {
    wall: blockId('sandstone'), corner: blockId('sandstone'), base: blockId('sandstone'),
    roof: blockId('white_terracotta'), floor: blockId('sandstone'), path: blockId('grass_path'),
    post: blockId('sandstone'),
  };
  const ID = {
    glass: blockId('glass'), door: blockId('oak_door'), torch: blockId('torch'),
    hay: blockId('hay_block'), water: blockId('water'), cobble: blockId('cobblestone'),
    log: blockId('oak_log'), pumpkin: blockId('pumpkin'),
    bed: blockId('white_bed'), craft: blockId('crafting_table'),
    furnace: blockId('furnace'), wool: blockId('white_wool'), chest: blockId('chest'),
    farmland: blockId('farmland'),
  };
  // B27 双格门：face（门朝向，指向道路）→ 门面板贴的边（关态朝向键）
  const FACE_TO_FACING = { 'z-': 'n', 'z+': 's', 'x-': 'w', 'x+': 'e' };

  const blocks = [];
  const meta = {
    variant: plains ? 'plains' : 'desert',
    center: [ax, groundY, az],
    houses: [],
    villagerSpawns: [],
    chests: [], // T5：[[x,y,z,loot表名],...]，StructureManager 注册后由打开时惰性生成内容
    steles: [], // W3：[[x,y,z,章节id],...]，井旁苔纹石碑（雨土纪·纹样）
  };

  // 单列处理：清空上方 → 地基回填 → 铺路
  const pathAt = (x, z) => {
    clearBox(blocks, x, groundY + 1, z, x, groundY + CLEAR_TOP, z);
    const t = baseAt(x, z);
    for (let y = t; y < groundY; y++) blocks.push([x, y, z, M.base]);
    blocks.push([x, groundY, z, M.path]);
  };

  // 村民出生点：清柱（顺带清树）+ 按实际地形垫站台。实际地表 = getBaseHeight，
  // 坡地若用 groundY+1 会卡进实心方块导致卡死/掉虚空；记录柱心坐标供直接放置。
  const spawnAt = (x, z) => {
    clearBox(blocks, x, groundY + 1, z, x, groundY + CLEAR_TOP, z);
    const t = Math.max(groundY, baseAt(x, z));
    for (let y = baseAt(x, z); y < t; y++) blocks.push([x, y, z, M.base]);
    blocks.push([x, t, z, M.path]);
    meta.villagerSpawns.push([x + 0.5, t + 1.05, z + 0.5]);
  };

  // ── 中央水井：3×3 水坑 + 圆石沿口 + 四柱小顶 ──────────────────────────
  fillBox(blocks, ax - 1, groundY - 3, az - 1, ax + 1, groundY - 3, az + 1, ID.cobble);
  fillBox(blocks, ax - 1, groundY - 2, az - 1, ax + 1, groundY - 1, az + 1, ID.water);
  floorBox(blocks, ax - 2, az - 2, ax + 2, az + 2, groundY, ID.cobble);
  wallsBox(blocks, ax - 1, groundY + 1, az - 1, ax + 1, groundY + 1, az + 1, ID.cobble);
  for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    for (let y = 1; y <= 3; y++) blocks.push([ax + px, groundY + y, az + pz, M.post]);
  }
  fillBox(blocks, ax - 1, groundY + 4, az - 1, ax + 1, groundY + 4, az + 1, M.roof);
  spawnAt(ax + 3, az + 3);
  spawnAt(ax - 3, az - 3);

  // ── 四向道路（3 宽）+ 灯柱 ────────────────────────────────────────────
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let t = 3; t <= ROAD_LEN; t++) {
      for (let w = -ROAD_HALF; w <= ROAD_HALF; w++) {
        const px = dx ? ax + dx * t : ax + w;
        const pz = dz ? az + dz * t : az + w;
        pathAt(px, pz);
      }
    }
    for (const t of [10, 20]) {
      const lx = dx ? ax + dx * t : ax + 2;
      const lz = dz ? az + dz * t : az + 2;
      if (baseAt(lx, lz) > groundY) continue; // 地势高于路面则不放灯柱
      blocks.push([lx, groundY + 1, lz, M.post]);
      blocks.push([lx, groundY + 2, lz, M.post]);
      blocks.push([lx, groundY + 3, lz, ID.torch]);
    }
  }

  // ── 通用小屋：地基+清场+地板+墙+角柱+门窗+双坡顶+屋内陈设 ────────────
  // face: 门朝向（'z-'/'z+'/'x-'/'x+'，指向最近道路）
  function buildHouse(cx, cz, w, d, face, kind) {
    const x0 = cx - (w >> 1), x1 = x0 + w - 1;
    const z0 = cz - (d >> 1), z1 = z0 + d - 1;
    foundation(blocks, x0 - 1, z0 - 1, x1 + 1, z1 + 1, groundY, M.base, baseAt);
    clearBox(blocks, x0, groundY + 1, z0, x1, groundY + CLEAR_TOP, z1);
    floorBox(blocks, x0, z0, x1, z1, groundY, M.floor);
    wallsBox(blocks, x0, groundY + 1, z0, x1, groundY + 3, z1, M.wall);
    for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      for (let y = 1; y <= 3; y++) blocks.push([px, groundY + y, pz, M.corner]);
    }

    // 门与窗（+2 高一排玻璃；角柱不动）
    const midX = (x0 + x1) >> 1, midZ = (z0 + z1) >> 1;
    let doorPos, spawn;
    const setAt = (x, y, z, id) => blocks.push([x, y, z, id]);
    if (face === 'z-' || face === 'z+') {
      const fz = face === 'z-' ? z0 : z1;
      const facing = FACE_TO_FACING[face];
      setAt(midX, groundY + 1, fz, doorId('oak_door', 'lower', facing, false)); // B27 双格门
      setAt(midX, groundY + 2, fz, doorId('oak_door', 'upper', facing, false));
      spawn = [midX, fz + (face === 'z-' ? -1 : 1)];   // 门外一格（spawnAt 记录）
      setAt(x0 + 1, groundY + 2, fz, ID.glass);
      setAt(x1 - 1, groundY + 2, fz, ID.glass);
      const bz = face === 'z-' ? z1 : z0;
      setAt(midX, groundY + 2, bz, ID.glass);
      setAt(x0, groundY + 2, midZ, ID.glass);
      setAt(x1, groundY + 2, midZ, ID.glass);
      doorPos = [midX, fz];
    } else {
      const fx = face === 'x-' ? x0 : x1;
      const facing = FACE_TO_FACING[face];
      setAt(fx, groundY + 1, midZ, doorId('oak_door', 'lower', facing, false)); // B27 双格门
      setAt(fx, groundY + 2, midZ, doorId('oak_door', 'upper', facing, false));
      spawn = [fx + (face === 'x-' ? -1 : 1), midZ];   // 门外一格（spawnAt 记录）
      setAt(fx, groundY + 2, z0 + 1, ID.glass);
      setAt(fx, groundY + 2, z1 - 1, ID.glass);
      const bx = face === 'x-' ? x1 : x0;
      setAt(bx, groundY + 2, midZ, ID.glass);
      setAt(midX, groundY + 2, z0, ID.glass);
      setAt(midX, groundY + 2, z1, ID.glass);
      doorPos = [fx, midZ];
    }

    // 双坡屋顶（沿 z 向收分）
    const top = groundY + 3;
    floorBox(blocks, x0, z0, x1, z1, top + 1, M.roof);
    floorBox(blocks, x0, z0 + 1, x1, z1 - 1, top + 2, M.roof);
    if (d >= 6) floorBox(blocks, x0, z0 + 2, x1, z1 - 2, top + 3, M.roof);

    // 屋内陈设（贴后墙，按 kind 变化）
    const bz = z1 - 1;
    setAt(x0 + 1, groundY + 1, bz, ID.torch);
    if (kind === 'bed' || kind === 'big') setAt(x1 - 1, groundY + 1, bz, ID.bed);
    if (kind === 'craft' || kind === 'big') {
      setAt(x0 + 1, groundY + 1, z0 + 1, ID.craft);
      setAt(x0 + 2, groundY + 1, z0 + 1, ID.furnace);
    }
    if (kind === 'big') setAt(x1 - 2, groundY + 1, z0 + 1, ID.wool);

    // T5：箱子（大厅必放，民居 40%；右前角空位，与门窗/陈设不冲突）
    if (kind === 'big' || rng() < 0.4) {
      setAt(x1 - 1, groundY + 1, z0 + 1, ID.chest);
      meta.chests.push([x1 - 1, groundY + 1, z0 + 1, kind === 'big' ? 'village_big' : 'village_house']);
    }

    meta.houses.push({ door: doorPos, groundY });
    spawnAt(spawn[0], spawn[1]);
  }

  // ── 农田：原木边框 + 中央水渠 + 耕地垄 + 小麦（原版式，阶段由确定性 rng 抛签）──
  function buildFarm(cx, cz, w, d) {
    const x0 = cx - (w >> 1), x1 = x0 + w - 1;
    const z0 = cz - (d >> 1), z1 = z0 + d - 1;
    foundation(blocks, x0, z0, x1, z1, groundY, M.base, baseAt);
    clearBox(blocks, x0, groundY + 1, z0, x1, groundY + CLEAR_TOP, z1);
    const midX = (x0 + x1) >> 1;
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const border = x === x0 || x === x1 || z === z0 || z === z1;
        if (border) {
          blocks.push([x, groundY + 1, z, ID.log]);
        } else if (x === midX) {
          blocks.push([x, groundY, z, ID.water]);
        } else {
          blocks.push([x, groundY, z, ID.farmland]);
          const stage = Math.floor(rng() * 8); // wheat_crop_0..7，消耗次数由布局唯一确定
          blocks.push([x, groundY + 1, z, blockId('wheat_crop_' + stage)]);
        }
      }
    }
    spawnAt(x0 - 1, cz);
  }

  // ── 干草料堆：干草垛 + 南瓜点 + 火把柱 ────────────────────────────────
  function buildHayCamp(cx, cz) {
    const x0 = cx - 2, z0 = cz - 2;
    foundation(blocks, x0, z0, x0 + 4, z0 + 4, groundY, M.base, baseAt);
    clearBox(blocks, x0, groundY + 1, z0, x0 + 4, groundY + CLEAR_TOP, z0 + 4);
    for (const [hx, hz] of [[x0, z0], [x0 + 3, z0], [x0, z0 + 3], [x0 + 3, z0 + 3]]) {
      fillBox(blocks, hx, groundY + 1, hz, hx, groundY + 2, hz, ID.hay);
    }
    blocks.push([x0 + 2, groundY + 1, z0 + 2, ID.pumpkin]);
    blocks.push([x0 + 1, groundY + 1, z0 + 2, ID.torch]);
  }

  // ── 布点：x 臂两侧 8 宅 + z 臂农田/大厅/料堆 ──────────────────────────
  const kinds = ['bed', 'plain', 'craft'];
  const variant = () => kinds[Math.floor(rng() * kinds.length)];
  buildHouse(ax + 12, az + 6, 6, 5, 'z-', variant());
  buildHouse(ax + 12, az - 6, 6, 5, 'z+', variant());
  buildHouse(ax - 12, az + 6, 6, 5, 'z-', variant());
  buildHouse(ax - 12, az - 6, 6, 5, 'z+', variant());
  buildHouse(ax + 24, az + 6, 7, 6, 'z-', variant());
  buildHouse(ax + 24, az - 6, 7, 6, 'z+', variant());
  buildHouse(ax - 24, az + 6, 7, 6, 'z-', 'big');
  buildHouse(ax - 24, az - 6, 6, 5, 'z+', variant());
  buildFarm(ax + 7, az + 20, 7, 9);
  buildHouse(ax - 7, az + 20, 7, 6, 'x+', 'big');
  buildHayCamp(ax + 7, az - 20);

  // ── 井旁碑位（世界观批次 W3）：苔纹石碑（雨土纪·纹样）──────────────────
  // 硬编码坐标零 rng 消耗，blocks 只追加不改写（旧 seed 村庄布局逐字节稳定）；
  // 井区外缘 (ax+3, az-2)——不触碰道路/房屋/农田/出生景位，bbox 判定不受影响。
  // Build 20 ① 四格形制：clearBox 已清 groundY+1..+4 四格，底座苔石压地表层。
  clearBox(blocks, ax + 3, groundY + 1, az - 2, ax + 3, groundY + 4, az - 2);
  for (let y = baseAt(ax + 3, az - 2); y < groundY; y++) blocks.push([ax + 3, y, az - 2, M.base]);
  for (const [bx, by, bz, bid] of steleStack(ax + 3, groundY + 1, az - 2, 'overworld')) blocks.push([bx, by, bz, bid]);
  meta.steles.push([ax + 3, groundY + 1, az - 2, 'rain_pattern']);

  return { blocks, meta };
}
