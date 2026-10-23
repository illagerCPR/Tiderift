// tide_sluice.js -- 潮闸房（D 可动手解开的遗迹·主世界）：石砌水闸遗迹，把水引到标线格
// 结构：9×13 石砖厅 + 中轴暗渠（槽底石砖、两侧挡水墙）+ 两处泥塞 + 沉沙池（池底荧石标线列）
//      + 池东墙上的水位白线（同时是内室门体）+ 内室纪念台。
// 解法：挖开两处泥塞，水从水口沿暗渠流进沉沙池，水面漫过标线列即判定解开。
// 不变量：布局只由 (seed, cell 锚点) 决定（solve 纯函数，几何与机关定义共用 core/Ruins.js 的
//      SLUICE_LAYOUT 与 ruinPuzzle）；水口在内，无需天然水源；未加载区块不参与判定。
// 密度预案：cell 24 / attempts 2 / chance 0.4 / salt 7301（近水门控已在 place 内，实际更稀）。
import { blockId } from './StructureManager.js';
import { clearBox, floorBox, wallsBox } from './StructureKit.js';
import { Biomes } from '../biomes.js';
import { SEA_LEVEL } from '../../core/Chunk.js';
import { SLUICE_LAYOUT, ruinPuzzle } from '../../core/Ruins.js';

const SLUICE_BIOMES = [Biomes.PLAINS, Biomes.BIRCH_FOREST, Biomes.TAIGA];
// 平坦度/同群系探针（±4、±7 各四正与对角）
const RING_PROBES = [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4], [4, -4], [-4, 4], [7, 0], [-7, 0], [0, 7], [0, -7]];
// 近水门控探针：9/14/20 三环各八向（河湖海任一"潮边"才立闸）
const WATER_PROBES = (() => {
  const out = [];
  for (const r of [9, 14, 20]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      out.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]);
    }
  }
  return out;
})();

// 选址：同群系 + 地表高于海平面 + 12 探针起伏 ≤5 + 半径 20 内至少 4 列低于海平面（近水）
function placeSluice(gen, ax, az) {
  if (typeof gen.getBiome !== 'function' || typeof gen.getBaseHeight !== 'function') return -1;
  const biome = gen.getBiome(ax, az);
  if (SLUICE_BIOMES.indexOf(biome) < 0) return -1;
  const y = gen.getBaseHeight(ax, az);
  if (y < SEA_LEVEL + 2 || y > 96) return -1;
  let min = y, max = y;
  for (const [dx, dz] of RING_PROBES) {
    if (gen.getBiome(ax + dx, az + dz) !== biome) return -1;
    const h = gen.getBaseHeight(ax + dx, az + dz);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  if (max - min > 5) return -1;
  let wet = 0;
  for (const [dx, dz] of WATER_PROBES) {
    if (gen.getBaseHeight(ax + dx, az + dz) < SEA_LEVEL) wet++;
  }
  return wet >= 4 ? y : -1;
}

export function solveSluice(rng, ax, y0, az, gen) {
  const seed = gen && typeof gen.seed !== 'undefined' ? gen.seed : 0;
  const P = ruinPuzzle(seed, 'overworld', 'tide_sluice', ax, y0, az);
  const L = SLUICE_LAYOUT;
  const SB = blockId('stone_bricks');
  const MS = blockId('mossy_stone_bricks');
  const CR = blockId('cracked_stone_bricks');
  const MC = blockId('mossy_cobblestone');
  const GR = blockId('gravel');
  const WC = blockId('white_concrete');
  const SL = blockId('sea_lantern');
  const GL = blockId('glowstone');
  const QB = blockId('quartz_block');
  const SM = blockId('star_marrow_block');
  const WA = blockId('water');
  const blocks = [];
  const meta = { kind: 'tide_sluice', ruin: { kind: P.kind, key: P.key, ax: P.ax, ay: P.ay, az: P.az } };
  const wy = y0 + L.waterY;

  // ① 清腔（外沿余量）+ 双层地板 + 外墙（高 3）+ 屋顶
  clearBox(blocks, ax - 8, wy, az - 6, ax + 8, wy + 4, az + 6);
  floorBox(blocks, ax - 7, az - 5, ax + 7, az + 5, y0, SB);
  floorBox(blocks, ax - 7, az - 5, ax + 7, az + 5, y0 - 1, SB);
  wallsBox(blocks, ax - 7, wy, az - 5, ax + 7, wy + 3, az + 5, SB);
  floorBox(blocks, ax - 7, az - 5, ax + 7, az + 5, wy + 4, SB);

  // ② 风化：屋顶按 rng 掺裂石/苔石（纯装饰，不参与判定）
  for (let x = ax - 7; x <= ax + 7; x++) {
    for (let z = az - 5; z <= az + 5; z++) {
      const r = rng();
      if (r < 0.10) blocks.push([x, wy + 4, z, CR]);
      else if (r < 0.18) blocks.push([x, wy + 4, z, MS]);
    }
  }

  // ③ 主厅南门（2 宽 2 高）与墙上灯石（照明，便于读图）
  for (let y = wy; y <= wy + 1; y++) {
    blocks.push([ax - 5, y, az + 5, 0]);
    blocks.push([ax - 4, y, az + 5, 0]);
  }
  blocks.push([ax - 7, wy + 2, az, GL]);
  blocks.push([ax + 7, wy + 2, az + 3, GL]);

  // ④ 隔墙（x = doorX）：把东侧内室封死，门体即解封格（普通石砖，阶段 2 挖开）
  for (let z = az - 4; z <= az + 4; z++) {
    for (let y = wy; y <= wy + 3; y++) blocks.push([ax + L.doorX, y, z, SB]);
  }
  // 池东墙上的水位白线（与标线格同高，肉眼可读的"要到这里"）
  for (let z = az + L.doorZ0; z <= az + L.doorZ1; z++) blocks.push([ax + L.doorX, wy, z, WC]);

  // ⑤ 水口与水源（水源格 = 关键件；四向挡水，只留东向出水）
  blocks.push([ax + L.srcX, wy, az + L.srcZ, WA]);
  blocks.push([ax + L.srcX - 1, wy, az, MS]);
  blocks.push([ax + L.srcX, wy, az - 1, MS]);
  blocks.push([ax + L.srcX, wy, az + 1, MS]);

  // ⑥ 暗渠：两侧挡水墙 + 两处泥塞（挖开即通水；中段留空让水看得见地"走"）
  for (let x = ax + L.chanX0; x <= ax + L.chanX1; x++) {
    blocks.push([x, wy, az - 1, SB]);
    blocks.push([x, wy, az + 1, SB]);
  }
  for (const dx of L.plugXs) blocks.push([ax + dx, wy, az + L.srcZ, GR]);

  // ⑦ 沉沙池：南北挡水 + 池底荧石标线列（标线格正下方，夜里发光）
  for (let x = ax + L.basinX0; x <= ax + L.basinX1; x++) {
    blocks.push([x, wy, az + L.basinZ0 - 1, SB]);
    blocks.push([x, wy, az + L.basinZ1 + 1, SB]);
  }
  for (let z = az + L.basinZ0; z <= az + L.basinZ1; z++) {
    blocks.push([ax + L.markX, y0, z, SL]);
  }
  // 旧水位线（北墙内面的苔痕，提示"水位曾经到过这里"）
  for (let x = ax - 6; x <= ax + 2; x++) {
    if (((x - ax) & 1) === 0) blocks.push([x, wy + 1, az - 5, MC]);
  }

  // ⑧ 内室纪念台（阶段 2 在此发放纪念物与蓝图）
  blocks.push([P.inner.x, wy, P.inner.z, QB]);
  blocks.push([P.inner.x, wy + 1, P.inner.z, SM]);

  return { blocks, meta };
}

export const TIDE_SLUICE_DEF = {
  cell: 24,          // 24 区块网格（384 格）——机关房稀有档
  attempts: 2,
  chance: 0.4,
  radius: 14,        // 覆盖 x ±7 / z ±5（对角 ~8.6）与清腔外沿
  salt: 7301,        // 与既有全部 salt 错开
  dims: ['overworld'],
  place: placeSluice,
  solve: solveSluice,
};
