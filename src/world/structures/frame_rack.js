// frame_rack.js -- 构件架房（D 可动手解开的遗迹·天域）：三槽构件架，按镶边提示把材料补进凹槽
// 结构：9×9 石英地石砖厅 + 北墙三处凹槽（槽心为空气，四周镶边 = 所需材料，肉眼即提示）
//      + 东墙三列料架（每列备 2 块同材料，可挖下来补槽）+ 西墙内室（门体 = 解封格）+ 纪念台。
// 解法：把三个凹槽各填上一块与镶边同料的方块，三槽齐备即判定解开。
// 不变量：布局只由 (seed, cell 锚点) 决定——材料由 ruinPuzzle(seed, ...) 确定性挑选，
//      几何直接读同一份定义（core/Ruins.js 的 RACK_LAYOUT / ruinPuzzle），不会与判定漂移。
// 密度预案：cell 24 / attempts 3 / chance 0.45 / salt 7303（浮岛选址复用 probeIsland 单一实现）。
import { blockId } from './StructureManager.js';
import { clearBox, floorBox, wallsBox } from './StructureKit.js';
import { probeIsland } from './aetherStructures.js';
import { RACK_LAYOUT, ruinPuzzle } from '../../core/Ruins.js';

// 选址：四群系大岛皆可，中心 ±5 平坦（maxSlope 6）——机关房占地 ±5
function placeRack(gen, ax, az) {
  return probeIsland(gen, ax, az, ['verdant', 'autumn', 'frost', 'crystal'], 6, 5);
}

export function solveRack(rng, ax, y0, az, gen) {
  const seed = gen && typeof gen.seed !== 'undefined' ? gen.seed : 0;
  const P = ruinPuzzle(seed, 'aether', 'frame_rack', ax, y0, az);
  const L = RACK_LAYOUT;
  const QB = blockId('quartz_block');
  const SB = blockId('stone_bricks');
  const CR = blockId('cracked_stone_bricks');
  const CW = blockId('cloud_wool');
  const SL = blockId('sea_lantern');
  const SM = blockId('star_marrow_block');
  const blocks = [];
  const meta = { kind: 'frame_rack', ruin: { kind: P.kind, key: P.key, ax: P.ax, ay: P.ay, az: P.az } };
  const wy = y0 + 1;
  const sy = y0 + L.slotY;

  // ① 清腔 + 双层地板 + 主室外墙 + 屋顶（主室 x ±5 / z ±5，内室接在西侧 x -9..-5）
  clearBox(blocks, ax - 10, wy, az - 6, ax + 6, wy + 4, az + 6);
  floorBox(blocks, ax - 9, az - 5, ax + 5, az + 5, y0, QB);
  floorBox(blocks, ax - 9, az - 5, ax + 5, az + 5, y0 - 1, QB);
  wallsBox(blocks, ax - 5, wy, az - 5, ax + 5, wy + 3, az + 5, SB);
  floorBox(blocks, ax - 5, az - 5, ax + 5, az + 5, wy + 4, QB);

  // ② 内室（x -9..-5）：西墙/南北墙自成一体，与主室之间只隔 x = doorX 的门墙
  wallsBox(blocks, ax - 9, wy, az - 4, ax - 5, wy + 3, az + 4, SB);
  floorBox(blocks, ax - 9, az - 4, ax - 5, az + 4, wy + 4, QB);

  // ③ 风化与照明（纯装饰）；南门 2 宽 2 高；东墙内嵌荧石
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
  blocks.push([ax + 5, wy + 2, az + 3, SL]);
  blocks.push([ax - 9, wy + 2, az + 3, SL]);

  // ④ 门体（西墙 x = doorX 的 3 宽 3 高，普通石砖；阶段 2 解封写入空气）
  for (let z = L.doorZ0; z <= L.doorZ1; z++) {
    for (let y = L.doorY0; y <= L.doorY1; y++) blocks.push([ax + L.doorX, y0 + y, az + z, SB]);
  }

  // ⑤ 三处凹槽：槽心留空（clearBox 已清），四周镶边 = 所需材料（提示"这里要放这个"）
  for (const slot of P.slots) {
    blocks.push([slot.x - 1, sy, slot.z, slot.id]);
    blocks.push([slot.x + 1, sy, slot.z, slot.id]);
    blocks.push([slot.x, sy - 1, slot.z, slot.id]);   // 托架（关键件）
    blocks.push([slot.x, sy + 1, slot.z, slot.id]);
    blocks.push([slot.x, sy, slot.z, 0]);             // 槽心空气（后写覆盖，防镶边误占）
  }

  // ⑥ 料架：东墙内表面三列，每列上下两块同材料（可挖下来补槽；备 2 块容错）
  for (const rk of P.rack) {
    blocks.push([rk.x, wy, rk.z, rk.id]);
    blocks.push([rk.x, wy + 1, rk.z, rk.id]);
  }
  // 料架护沿（云绒，仅装饰，让料架在墙上可辨）
  blocks.push([ax + L.rackX, wy + 2, az - 2, CW]);
  blocks.push([ax + L.rackX, wy + 2, az, CW]);
  blocks.push([ax + L.rackX, wy + 2, az + 2, CW]);

  // ⑦ 内室纪念台（阶段 2 在此发放纪念物与蓝图）
  blocks.push([P.inner.x, wy, P.inner.z, QB]);
  blocks.push([P.inner.x, wy + 1, P.inner.z, SM]);

  return { blocks, meta };
}

export const FRAME_RACK_DEF = {
  cell: 24,          // 24 区块网格（384 格）——机关房稀有档
  attempts: 3,
  chance: 0.45,
  radius: 16,        // 覆盖主室 ±5 与内室（x 到 ax-9）
  salt: 7303,        // 与既有全部 salt 错开
  dims: ['aether'],
  place: placeRack,
  solve: solveRack,
};
