// echoRuins.js -- 四维回响遗迹（Build 55 R1）：四潮各留一处「还在重演」的旧址
// 内容：雨痕水龛（主世界）/ 烬痕炉龛（下界）/ 风纹哨台（天域）/ 无潮静台（末地）。
// 每处的材质与环境各说各话：水与黏土（雨土纪）/ 岩浆与灵魂沙（烬火纪）/
// 白石与云絮（天海纪元）/ 末地砖与黑曜石（无潮彼岸）——玩家不看文字也能分出四系。
// 纪律：
//   ① requiresExtras = ['magic']——关闭魔法的世界一类都不激活，旧结构随机流逐字节不变。
//   ② 四类各自独立 salt 与独立锚点网格，互不共流，也不与任何既有类型共流。
//   ③ 布局只由 (seed, 锚点 cell) 决定：rng 抽取顺序固定，任意端/任意顺序逐字节一致。
//   ④ 遗迹只承载叙述与材料：不放可运行机器、不放会流动的流体、不改既有结构；
//      碑位（meta.plinth）在 R1 留空，R3 由叙事批次落碑。
import { blockId } from './StructureManager.js';
import { clearBox } from './StructureKit.js';
import { Chunk, CHUNK_SIZE } from '../../core/Chunk.js';
import { probeIsland } from './aetherStructures.js';

const LAVA_SEA_TOP = 33;

// ── 选址：下界腔体（与潮火之炉同款，探针环按 9×9 收窄）──────────────────
function placeEmber(gen, ax, az) {
  const cx = Math.floor(ax / CHUNK_SIZE), cz = Math.floor(az / CHUNK_SIZE);
  const c = new Chunk(cx, cz);
  gen.generateChunk(c, false);
  const lx0 = ax - cx * CHUNK_SIZE, lz0 = az - cz * CHUNK_SIZE;
  const floors = [];
  for (const [dx, dz] of [[0, 0], [-5, 0], [5, 0], [0, -5], [0, 5]]) {
    const lx = lx0 + dx, lz = lz0 + dz;
    let y = 150;
    while (y >= LAVA_SEA_TOP + 2) {
      if (c.get(lx, y, lz) !== 0) { y--; continue; }
      while (y >= LAVA_SEA_TOP && c.get(lx, y, lz) === 0) y--;
      if (y < LAVA_SEA_TOP) break;
      floors.push(y);
      break;
    }
  }
  if (floors.length < 3) return -1;
  floors.sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i < floors.length; i++) {
    const members = floors.filter(f => f >= floors[i] && f <= floors[i] + 6);
    if (!best || members.length > best.length) best = members;
  }
  if (!best || best.length < 3) return -1;
  best.sort((a, b) => a - b);
  return best[best.length >> 1] + 1;
}

// ── 选址：末地高原（与拾遗者石环同款外岛透镜门；静台 9×9 需要真平地）────────
function placeStill(gen, ax, az) {
  if (typeof gen.getBiome !== 'function' || gen.getBiome(ax, az) !== 'end_highlands') return -1;
  const cx = Math.floor(ax / CHUNK_SIZE), cz = Math.floor(az / CHUNK_SIZE);
  const c = new Chunk(cx, cz);
  gen.generateChunk(c, false);
  const lx0 = ax - cx * CHUNK_SIZE, lz0 = az - cz * CHUNK_SIZE;
  const floors = [];
  for (const [dx, dz] of [[0, 0], [-4, 0], [4, 0], [0, -4], [0, 4], [-4, -4], [4, 4], [-4, 4], [4, -4]]) {
    const lx = lx0 + dx, lz = lz0 + dz;
    let y = 90;
    let found = -1;
    while (y >= 30) {
      if (c.get(lx, y, lz) !== 0) { y--; continue; }
      while (y >= 30 && c.get(lx, y, lz) === 0) y--;
      if (y >= 30) found = y;
      break;
    }
    if (found < 0) return -1;
    floors.push(found);
  }
  if (floors.length < 9) return -1;
  floors.sort((a, b) => a - b);
  if (floors[8] - floors[0] > 6) return -1;
  return floors[4] + 1;
}

// ── 定义表 ─────────────────────────────────────────────────────────────
export const ECHO_RAIN_DEF = {
  cell: 16, attempts: 2, chance: 0.45,
  radius: 10, probeR: [7, 11], maxSlope: 4, minTop: 64,
  salt: 8501, dims: ['overworld'], requiresExtras: ['magic'],
  solve: solveRain,
};

export const ECHO_EMBER_DEF = {
  cell: 18, attempts: 2, chance: 0.5,
  radius: 10,
  salt: 8502, dims: ['nether'], requiresExtras: ['magic'],
  place: placeEmber,
  solve: solveEmber,
};

export const ECHO_GALE_DEF = {
  cell: 14, attempts: 2, chance: 0.5,
  radius: 9,
  salt: 8503, dims: ['aether'], requiresExtras: ['magic'],
  place: (gen, ax, az) => probeIsland(gen, ax, az, ['verdant', 'autumn', 'frost', 'crystal'], 6, 4),
  solve: solveGale,
};

export const ECHO_TIDELESS_DEF = {
  cell: 16, attempts: 2, chance: 0.5,
  radius: 10,
  salt: 8504, dims: ['end'], requiresExtras: ['magic'],
  place: placeStill,
  solve: solveTideless,
};

// ── 雨痕水龛（主世界）：半沉的砖龛 + 一盆不再落下的雨 ─────────────────────
export function solveRain(rng, ax, groundY, az) {
  const BRICK = blockId('stone_bricks');
  const MOSSY = blockId('mossy_stone_bricks');
  const CRACK = blockId('cracked_stone_bricks');
  const CLAY = blockId('clay');
  const WATER = blockId('water');
  const LAMP = blockId('sea_lantern');
  const CHEST = blockId('chest');
  const y0 = groundY;
  const blocks = [];
  const meta = { kind: 'echo_rain', center: [ax, y0, az], chests: [], plinth: null };

  const brick = () => {
    const r = rng();
    if (r < 0.45) return BRICK;
    if (r < 0.8) return MOSSY;
    return CRACK;
  };

  clearBox(blocks, ax - 4, y0 + 1, az - 4, ax + 4, y0 + 4, az + 4);

  // 地基 9×9（12% 塌洞）；水盆 3×3 嵌在地基里，黏土镶边一圈（看得出的"水口"）
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      if (rng() < 0.12) { blocks.push([ax + dx, y0, az + dz, 0]); continue; }
      blocks.push([ax + dx, y0, az + dz, brick()]);
    }
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) blocks.push([ax + dx, y0, az + dz, WATER]);
  }
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
      if (rng() < 0.18) continue; // 镶边也有缺
      blocks.push([ax + dx, y0, az + dz, CLAY]);
    }
  }

  // 残墙两高，南面开口 3 格；四处缺口固定点位（不耗 rng）
  for (let dx = -4; dx <= 4; dx++) {
    for (const dz of [-4, 4]) {
      if (dz === 4 && dx >= -1 && dx <= 1) continue;
      if ((dx === -4 || dx === 4) && dz === -4) continue;
      blocks.push([ax + dx, y0 + 1, az + dz, brick()]);
      blocks.push([ax + dx, y0 + 2, az + dz, brick()]);
    }
  }
  for (let dz = -3; dz <= 3; dz++) {
    for (const dx of [-4, 4]) {
      if (dz === 3) continue;
      blocks.push([ax + dx, y0 + 1, az + dz, brick()]);
      if (dz !== 2) blocks.push([ax + dx, y0 + 2, az + dz, brick()]);
    }
  }

  // 四角柱两高 + 悬在海晶灯下的"未落之雨"：灯挂在柱顶，盆里永远差那一滴
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    blocks.push([ax + dx, y0 + 1, az + dz, BRICK]);
    blocks.push([ax + dx, y0 + 2, az + dz, BRICK]);
  }
  blocks.push([ax, y0 + 3, az, LAMP]);
  blocks.push([ax, y0 + 2, az, 0]); // 灯下留空——雨停在半空，不落地

  // 龛位：北墙内角（R3 落碑；R1 只清空）
  meta.plinth = [ax - 2, y0 + 1, az - 3];
  clearBox(blocks, ax - 2, y0 + 1, az - 3, ax - 2, y0 + 2, az - 3);

  meta.chests.push([ax + 2, y0 + 1, az + 2, 'echo_rain']);
  blocks.push([ax + 2, y0 + 1, az + 2, CHEST]);

  return { blocks, meta };
}

// ── 烬痕炉龛（下界）：一圈下界砖围着还没熄的炉心 ─────────────────────────
export function solveEmber(rng, ax, groundY, az) {
  const NB = blockId('nether_bricks');
  const MG = blockId('magma_block');
  const SS = blockId('soul_sand');
  const NR = blockId('netherrack');
  const GS = blockId('glowstone');
  const OB = blockId('obsidian');
  const CHEST = blockId('chest');
  const y0 = groundY;
  const blocks = [];
  const meta = { kind: 'echo_ember', center: [ax, y0, az], chests: [], plinth: null };

  clearBox(blocks, ax - 4, y0 + 1, az - 4, ax + 4, y0 + 4, az + 4);

  // 平台 9×9：下界砖为主，岩屑按 rng 混入
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const r = rng();
      blocks.push([ax + dx, y0, az + dz, r < 0.16 ? NR : NB]);
    }
  }
  // 炉心：3×3 岩浆块 + 四角黑曜石楔
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) blocks.push([ax + dx, y0, az + dz, MG]);
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    blocks.push([ax + dx, y0 + 1, az + dz, OB]);
  }
  // 灵魂沙四处（余温的灰烬坑），固定点位
  for (const [dx, dz] of [[-3, 0], [3, 0], [2, 3], [-2, -3]]) {
    blocks.push([ax + dx, y0, az + dz, SS]);
  }

  // 残墙两高，南北各开一口；缺口点位固定
  for (let dx = -4; dx <= 4; dx++) {
    for (const dz of [-4, 4]) {
      if (dz === 4 && dx >= -1 && dx <= 1) continue;
      if (dz === -4 && dx >= 2 && dx <= 3) continue;
      blocks.push([ax + dx, y0 + 1, az + dz, NB]);
      if (dx !== 0) blocks.push([ax + dx, y0 + 2, az + dz, NB]);
    }
  }
  for (let dz = -3; dz <= 3; dz++) {
    for (const dx of [-4, 4]) {
      if (dz === 0) continue;
      blocks.push([ax + dx, y0 + 1, az + dz, NB]);
      if (Math.abs(dz) !== 3) blocks.push([ax + dx, y0 + 2, az + dz, NB]);
    }
  }
  // 四根黑曜石柱撑住"炉罩"，柱顶荧石——炉龛自己还留着光
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    blocks.push([ax + dx, y0 + 2, az + dz, OB]);
    blocks.push([ax + dx, y0 + 3, az + dz, GS]);
  }

  // 龛位：北墙内侧（R3 落碑）
  meta.plinth = [ax, y0 + 1, az - 3];
  clearBox(blocks, ax, y0 + 1, az - 3, ax, y0 + 2, az - 3);

  meta.chests.push([ax - 2, y0 + 1, az + 2, 'echo_ember']);
  blocks.push([ax - 2, y0 + 1, az + 2, CHEST]);

  return { blocks, meta };
}

// ── 风纹哨台（天域）：白石台 + 云絮 + 星髓芯，四面漏风 ────────────────────
export function solveGale(rng, ax, groundY, az) {
  const QZ = blockId('quartz_block');
  const CW = blockId('cloud_wool');
  const SM = blockId('star_marrow_block');
  const GS = blockId('glowstone');
  const CHEST = blockId('chest');
  const y0 = groundY;
  const blocks = [];
  const meta = { kind: 'echo_gale', center: [ax, y0, az], chests: [], plinth: null };

  clearBox(blocks, ax - 3, y0 + 1, az - 3, ax + 3, y0 + 6, az + 3);

  // 7×7 白石台，四边各缺一格（风穿过去）
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const edge = Math.max(Math.abs(dx), Math.abs(dz)) === 3;
      if (edge) {
        if ((dx === 0 && dz === 3) || (dx === 0 && dz === -3) || (dx === 3 && dz === 0) || (dx === -3 && dz === 0)) {
          blocks.push([ax + dx, y0, az + dz, 0]);
          continue;
        }
        if (rng() < 0.14) { blocks.push([ax + dx, y0, az + dz, 0]); continue; }
      }
      blocks.push([ax + dx, y0, az + dz, QZ]);
    }
  }
  // 星髓芯：台心一格凹下去的白石环里
  blocks.push([ax, y0, az, SM]);
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    blocks.push([ax + dx, y0, az + dz, CW]);
  }
  // 四角白石柱三高，柱顶荧石；柱间悬两块云絮（被风托着）
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    blocks.push([ax + dx, y0 + 1, az + dz, QZ]);
    blocks.push([ax + dx, y0 + 2, az + dz, QZ]);
    blocks.push([ax + dx, y0 + 3, az + dz, GS]);
  }
  blocks.push([ax - 3, y0 + 4, az, CW]);
  blocks.push([ax + 3, y0 + 4, az, CW]);
  // 一圈低矮云絮护栏（北/东各一段）
  for (let dx = -1; dx <= 1; dx++) blocks.push([ax + dx, y0 + 1, az - 3, CW]);
  for (let dz = -1; dz <= 1; dz++) blocks.push([ax + 3, y0 + 1, az + dz, CW]);

  // 龛位：台心北侧（R3 落碑）
  meta.plinth = [ax - 1, y0 + 1, az - 2];
  clearBox(blocks, ax - 1, y0 + 1, az - 2, ax - 1, y0 + 2, az - 2);

  meta.chests.push([ax + 2, y0 + 1, az + 2, 'echo_gale']);
  blocks.push([ax + 2, y0 + 1, az + 2, CHEST]);

  return { blocks, meta };
}

// ── 无潮静台（末地）：一环之隔的内台，四面无水无门 ───────────────────────
export function solveTideless(rng, ax, groundY, az) {
  const EB = blockId('end_stone_bricks');
  const PP = blockId('purpur_block');
  const OB = blockId('obsidian');
  const ES = blockId('end_stone');
  const CHEST = blockId('chest');
  const y0 = groundY;
  const blocks = [];
  const meta = { kind: 'echo_tideless', center: [ax, y0, az], chests: [], plinth: null };

  clearBox(blocks, ax - 4, y0 + 1, az - 4, ax + 4, y0 + 4, az + 4);

  // 外环末地砖 / 中间一道 1 格宽的空槽（沟底仍是末地石，不悬空也不通虚空）/ 内台紫珀
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d === 3) {
        blocks.push([ax + dx, y0 - 1, az + dz, ES]);  // 沟底
        blocks.push([ax + dx, y0, az + dz, 0]);       // 沟体（无水、无桥）
        continue;
      }
      if (d === 4 && rng() < 0.15) { blocks.push([ax + dx, y0, az + dz, 0]); continue; }
      blocks.push([ax + dx, y0, az + dz, d === 4 ? EB : PP]);
    }
  }
  // 内台四角黑曜石矮柱（两高）+ 台心"无"位
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    blocks.push([ax + dx, y0 + 1, az + dz, OB]);
    blocks.push([ax + dx, y0 + 2, az + dz, OB]);
  }

  // 龛位：台心北侧（R3 落碑）
  meta.plinth = [ax, y0 + 1, az - 2];
  clearBox(blocks, ax, y0 + 1, az - 2, ax, y0 + 2, az - 2);

  meta.chests.push([ax + 2, y0 + 1, az - 1, 'echo_tideless']);
  blocks.push([ax + 2, y0 + 1, az - 1, CHEST]);

  return { blocks, meta };
}
