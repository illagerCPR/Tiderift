// blockShape.js -- B27 床/门形制：状态 ID 家族工具 + 碰撞盒换算
// 设计：状态 = 独立方块 ID（沿用 B26 流体"等级=ID"模式），存档/联机协议零迁移。
// 家族命名约定：
//   门  base = 'oak_door' | 'iron_door'
//       关态朝北下半 = base 本名（旧存档兼容）；其余 `${base}_${half}_${facing}`，
//       开态 `${base}_${half}_${facing}_open`
//   活板门 'oak_trapdoor'（关态朝北本名）/ `oak_trapdoor_${facing}` / `oak_trapdoor_${facing}_open`
//   床  'white_bed'（foot 朝北本名）/ `white_bed_${half}_${facing}`
// B28 定向面方块（箱子/熔炉/头颅/红石灯…）沿用同一约定：
//   `${base}` = 朝北态本名（旧存档零迁移）/ `_s` / `_e` / `_w`；点燃/充能等二次状态用派生家族名
//   （`furnace_lit` = 点燃朝北 / `furnace_lit_e` …），见 facingId()。
import { BlockRegistry } from './BlockRegistry.js';

export const DOOR_THICK = 3 / 16; // 门板厚度（原版 3 像素）
export const BED_HEIGHT = 9 / 16; // 床面高度（原版 9 像素）

// 朝向语义：'n'=-Z（北）'s'=+Z 'w'=-X（西）'e'=+X
// 门的 facing = 关态面板贴的格边；床的 facing = foot→head 方向

function box(x0, y0, z0, x1, y1, z1) {
  return { from: [x0, y0, z0], to: [x1, y1, z1] };
}

// 门关态：面板贴 facing 边（满宽薄板）
export function doorClosedShape(facing) {
  const T = DOOR_THICK;
  if (facing === 'n') return box(0, 0, 0, 1, 1, T);
  if (facing === 's') return box(0, 0, 1 - T, 1, 1, 1);
  if (facing === 'w') return box(0, 0, 0, T, 1, 1);
  return box(1 - T, 0, 0, 1, 1, 1); // e
}

// 门开态：绕固定铰链旋转 90°——n 朝向西铰链（开贴 w），s→e，w→n，e→s
export function doorOpenShape(facing) {
  if (facing === 'n') return doorClosedShape('w');
  if (facing === 's') return doorClosedShape('e');
  if (facing === 'w') return doorClosedShape('n');
  return doorClosedShape('s'); // e
}

// 活板门：关 = 格底水平板（facing 只决定开态方向）；开 = 竖板贴 facing 边
export function trapdoorShape(facing, open) {
  const T = DOOR_THICK;
  if (!open) return box(0, 0, 0, 1, T, 1);
  if (facing === 'n') return box(0, 0, 0, 1, 1, T);
  if (facing === 's') return box(0, 0, 1 - T, 1, 1, 1);
  if (facing === 'w') return box(0, 0, 0, T, 1, 1);
  return box(1 - T, 0, 0, 1, 1, 1); // e
}

export const BED_SHAPE = box(0, 0, 0, 1, BED_HEIGHT, 1);

// 门状态 id 查询（base + half('lower'|'upper') + facing + open）
export function doorId(base, half, facing, open) {
  if (open) return BlockRegistry.getId(`${base}_${half}_${facing}_open`);
  if (facing === 'n') return BlockRegistry.getId(half === 'lower' ? base : `${base}_${half}`);
  return BlockRegistry.getId(`${base}_${half}_${facing}`);
}

// 活板门状态 id
export function trapdoorId(facing, open) {
  if (open) return BlockRegistry.getId(`oak_trapdoor_${facing}_open`);
  if (facing === 'n') return BlockRegistry.getId('oak_trapdoor');
  return BlockRegistry.getId(`oak_trapdoor_${facing}`);
}

// 床状态 id（half = 'foot'|'head'）
export function bedId(half, facing) {
  if (half === 'foot' && facing === 'n') return BlockRegistry.getId('white_bed');
  return BlockRegistry.getId(`white_bed_${half}_${facing}`);
}

// B28 定向面方块状态 id：家族名 family + 朝向（'n' 用家族本名，其余 `${family}_${facing}`）。
// family 既可是基础名（'chest'）也可是派生家族名（'furnace_lit'）；未注册返回 0。
export function facingId(family, facing) {
  if (facing === 'n') return BlockRegistry.getId(family);
  return BlockRegistry.getId(`${family}_${facing}`);
}

// B28 熔炉点燃态：同一朝向的未点燃/点燃家族名互转（资源世界写方块时用）
export function furnaceLitId(facing, lit) {
  return facingId(lit ? 'furnace_lit' : 'furnace', facing);
}

// 碰撞盒：带 shape 的 solid 方块 → 世界坐标 AABB；无 shape 返回 null（调用方按满格处理）。
// 仅 shape 方块分配（世界中占比极小，热路径无常规分配）。
export function cellBox(def, bx, by, bz) {
  if (!def || !def.solid || !def.shape) return null;
  const { from, to } = def.shape;
  return [bx + from[0], by + from[1], bz + from[2], bx + to[0], by + to[1], bz + to[2]];
}
