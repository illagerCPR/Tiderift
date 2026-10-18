// Raycast.js -- DDA 射线选择方块
import { BlockRegistry } from '../core/BlockRegistry.js';

export class Raycast {
  constructor(world) {
    this.world = world;
  }

  // 从 origin 沿 direction 射出，最大距离 maxDist
  // includeFluid: 命中流体（空桶舀水/岩浆用）——默认跳过（准星穿透水）
  // 返回 { block: {x,y,z}, normal: {x,y,z} } 或 null
  cast(origin, direction, maxDist = 5, includeFluid = false) {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    
    const stepX = direction.x > 0 ? 1 : -1;
    const stepY = direction.y > 0 ? 1 : -1;
    const stepZ = direction.z > 0 ? 1 : -1;
    
    const tDeltaX = direction.x !== 0 ? Math.abs(1 / direction.x) : Infinity;
    const tDeltaY = direction.y !== 0 ? Math.abs(1 / direction.y) : Infinity;
    const tDeltaZ = direction.z !== 0 ? Math.abs(1 / direction.z) : Infinity;
    
    let tMaxX = direction.x !== 0 ? (stepX > 0 ? (x + 1 - origin.x) / direction.x : (origin.x - x) / -direction.x) : Infinity;
    let tMaxY = direction.y !== 0 ? (stepY > 0 ? (y + 1 - origin.y) / direction.y : (origin.y - y) / -direction.y) : Infinity;
    let tMaxZ = direction.z !== 0 ? (stepZ > 0 ? (z + 1 - origin.z) / direction.z : (origin.z - z) / -direction.z) : Infinity;
    
    let lastFace = { x: 0, y: 0, z: 0 };
    let t = 0;
    
    while (t <= maxDist) {
      const id = this.world.getBlock(x, y, z);
      if (id !== 0) {
        const def = BlockRegistry.getById(id);
        // 可选中：实心非流体 / cross 装饰（作物/草丛/火把/按钮/花——原版语义，
        // 否则火把拆不掉、按钮点不着、作物无法右键）；流体仅 includeFluid（空桶）
        if (def && !def.fluid && (def.solid || def.renderType === 'cross')) {
          return {
            block: { x, y, z },
            normal: lastFace,
            id,
            t          // 射程参数（Build 20 ⑤：第三人称相机遮挡裁剪用；既有消费方不受影响）
          };
        }
      }
      
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        lastFace = { x: -stepX, y: 0, z: 0 };
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        lastFace = { x: 0, y: -stepY, z: 0 };
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        lastFace = { x: 0, y: 0, z: -stepZ };
      }
    }
    return null;
  }
}

// 球体-射线求交（F6：远端玩家/怪物命中检测的共享纯函数，标量入参零分配）。
// 与旧内联实现逐式等价：oc = origin - center，b = oc·d，c = oc·oc - r²，disc = b*b - c；
// disc < 0 → -1；t = -b - sqrt(disc)；t < 0 → -1；否则返回 t；未命中恒为 -1。
// 口径：判别式按单位方向推导（与旧实现一致），d 非单位向量时 t 不随 |d| 归一，不再是几何距离；
// 调用方一律传单位向量（camera.getWorldDirection 的输出）。
export function raySphereHit(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius) {
  const ocx = ox - cx, ocy = oy - cy, ocz = oz - cz;
  const b = ocx * dx + ocy * dy + ocz * dz;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? -1 : t;
}
