// ember_circuit.js -- 烬火回路房（D 可动手解开的遗迹·下界）：四向红石回路遗迹，接好断线让四盏灯全亮
// 结构：9×9 下界砖厅 + 中央回路石墩（红石火把）+ 四条地面导线支路（每条第 2 格出厂断线）
//      + 支路末端的灯座（红石灯，未点亮）+ 北侧内室（门体 = 解封格）+ 内室纪念台。
// 解法：把断线补上（厅内料架上备有红石粉），火把沿四条支路点亮四盏灯即判定解开。
// 不变量：布局只由 (seed, cell 锚点) 决定（几何与机关定义共用 core/Ruins.js 的 EMBER_LAYOUT
//      与 ruinPuzzle）；灯是否点亮由 RedstoneSystem 真实结算，本结构只放电源/导线/灯本身。
// 密度（B35 D 调参）：cell 32 / attempts 2 / chance 0.05 / salt 7302。
// 下界腔体门控（place 内 5 列下探）通过率远高于另外两维的群系/平坦度门控，同样的 cell 24 + chance 0.5
// 会让它比另两维密一个数量级（实测同面积 298 vs 11/28），因此本类型单独调稀：只动 ember 自己的常量。
import { blockId } from './StructureManager.js';
import { clearBox, floorBox, wallsBox } from './StructureKit.js';
import { Chunk, CHUNK_SIZE } from '../../core/Chunk.js';
import { EMBER_LAYOUT, ruinPuzzle } from '../../core/Ruins.js';

const LAVA_SEA_TOP = 33; // 与 fortress/tidefire_hearth 同款支撑下限（熔岩海面之上）

// 选址：锚点区块临时生成（关闭装饰防递归），5 列下探找开阔腔地面，取 6 格内聚簇的中位层
function placeCircuit(gen, ax, az) {
  if (!gen || typeof gen.generateChunk !== 'function') return -1;
  const cx = Math.floor(ax / CHUNK_SIZE), cz = Math.floor(az / CHUNK_SIZE);
  const c = new Chunk(cx, cz);
  gen.generateChunk(c, false);
  const lx0 = ax - cx * CHUNK_SIZE, lz0 = az - cz * CHUNK_SIZE;
  const floors = [];
  for (const [dx, dz] of [[0, 0], [-6, 0], [6, 0], [0, -6], [0, 6]]) {
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
    const members = floors.filter((f) => f >= floors[i] && f <= floors[i] + 6);
    if (!best || members.length > best.length) best = members;
  }
  if (!best || best.length < 3) return -1;
  best.sort((a, b) => a - b);
  return best[best.length >> 1] + 1;
}

export function solveCircuit(rng, ax, y0, az, gen) {
  const seed = gen && typeof gen.seed !== 'undefined' ? gen.seed : 0;
  const P = ruinPuzzle(seed, 'nether', 'ember_circuit', ax, y0, az);
  const L = EMBER_LAYOUT;
  const NB = blockId('nether_bricks');
  const CR = blockId('cracked_stone_bricks');
  const SB = blockId('stone_bricks');
  const MG = blockId('magma_block');
  const GS = blockId('glowstone');
  const SS = blockId('soul_sand');
  const QB = blockId('quartz_block');
  const SM = blockId('star_marrow_block');
  const LAMP = blockId('redstone_lamp');
  const TORCH = blockId('redstone_torch');
  const WIRE = blockId('redstone_wire');
  const blocks = [];
  const meta = { kind: 'ember_circuit', ruin: { kind: P.kind, key: P.key, ax: P.ax, ay: P.ay, az: P.az } };
  const wy = y0 + L.wireY;

  // ① 清腔 + 地板 + 主室外墙 + 内室外墙 + 屋顶
  clearBox(blocks, ax - 6, wy, az - 10, ax + 6, wy + 4, az + 6);
  floorBox(blocks, ax - 6, az - 10, ax + 6, az + 6, y0, NB);
  floorBox(blocks, ax - 6, az - 10, ax + 6, az + 6, y0 - 1, NB);
  wallsBox(blocks, ax - 5, wy, az - 5, ax + 5, wy + 3, az + 5, NB);
  wallsBox(blocks, ax - 3, wy, az - 9, ax + 3, wy + 3, az - 5, NB);
  floorBox(blocks, ax - 5, az - 5, ax + 5, az + 5, wy + 4, NB);
  floorBox(blocks, ax - 3, az - 9, ax + 3, az - 5, wy + 4, NB);

  // ② 风化：墙面按 rng 掺裂石（纯装饰）；南门 2 宽 2 高；东西墙内嵌荧石照明
  for (let x = ax - 5; x <= ax + 5; x++) {
    for (let y = wy; y <= wy + 3; y++) {
      const r = rng();
      if (r < 0.10) blocks.push([x, y, az - 5, CR]);
      else if (r < 0.16) blocks.push([x, y, az + 5, CR]);
    }
  }
  for (let y = wy; y <= wy + 1; y++) {
    blocks.push([ax - 1, y, az + 5, 0]);
    blocks.push([ax, y, az + 5, 0]);
  }
  blocks.push([ax - 5, wy + 2, az + 3, GS]);
  blocks.push([ax + 5, wy + 2, az + 3, GS]);

  // ③ 门体（北墙 z = doorZ 的 3 宽 3 高，普通下界砖；阶段 2 解封写入空气）
  for (let x = L.doorX0; x <= L.doorX1; x++) {
    for (let y = L.doorY0; y <= L.doorY1; y++) blocks.push([ax + x, y0 + y, az + L.doorZ, NB]);
  }

  // ④ 中央回路石墩 + 红石火把（关键件：被挖走则四灯必灭）
  blocks.push([ax, y0, az, SB]);
  blocks.push([ax, wy, az, TORCH]);

  // ⑤ 四条支路：step1 导线出厂在位，step2 导线出厂缺失（断线 = 玩家要补的位置）
  for (const w of P.wires) blocks.push([w.x, w.y, w.z, WIRE]);

  // ⑥ 四个灯座：红石灯 + 上方灯罩拱 + 末端护座（避免灯与墙混在一起看不清）
  L.dirs.forEach(([dx, dz]) => {
    const lx = ax + dx * L.lampStep, lz = az + dz * L.lampStep;
    blocks.push([lx, wy, lz, LAMP]);
    blocks.push([lx, wy + 1, lz, CR]);
    blocks.push([lx + dx, wy, lz + dz, SS]);
  });

  // ⑦ 备料架：西墙内侧两块岩浆块上各嵌一枚红石粉（可挖下来补线，材料就在厅内）
  blocks.push([ax - 4, wy, az + 3, MG]);
  blocks.push([ax - 4, wy + 1, az + 3, WIRE]);
  blocks.push([ax + 4, wy, az + 3, MG]);
  blocks.push([ax + 4, wy + 1, az + 3, WIRE]);

  // ⑧ 内室纪念台（阶段 2 在此发放纪念物与蓝图）
  blocks.push([P.inner.x, y0, P.inner.z, QB]);
  blocks.push([P.inner.x, wy, P.inner.z, SM]);

  return { blocks, meta };
}

export const EMBER_CIRCUIT_DEF = {
  cell: 32,          // 32 区块网格（512 格）——稀有档（同面积约 10~25 处）
  attempts: 2,
  chance: 0.05,
  radius: 18,        // 覆盖主室 ±5 与北侧内室（z 到 az-9）
  salt: 7302,        // 与既有全部 salt 错开
  dims: ['nether'],
  place: placeCircuit,
  solve: solveCircuit,
};
