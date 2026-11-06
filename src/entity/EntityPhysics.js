// EntityPhysics.js -- 通用实体物理（AABB 碰撞）
import { World } from '../core/World.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { cellBox } from '../core/blockShape.js';
import { CHUNK_HEIGHT } from '../core/Chunk.js';

const GRAVITY = -32;

export class EntityPhysics {
  constructor(world) {
    this.world = world;
  }

  collide(entity, dt) {
    if (entity.dead) return;

    const half = entity.half;
    const height = entity.height;

    if (!entity.flying && !entity.noClip) {
      entity.velocity.y += GRAVITY * dt;
    }

    const maxVel = 50;
    entity.velocity.x = Math.max(-maxVel, Math.min(maxVel, entity.velocity.x));
    entity.velocity.y = Math.max(-maxVel, Math.min(maxVel, entity.velocity.y));
    entity.velocity.z = Math.max(-maxVel, Math.min(maxVel, entity.velocity.z));

    if (entity.noClip) {
      entity.position.x += entity.velocity.x * dt;
      entity.position.y += entity.velocity.y * dt;
      entity.position.z += entity.velocity.z * dt;
      entity.onGround = false;
      return;
    }

    entity.onGround = false;

    const moveAxis = (axis, amount) => {
      if (amount === 0) return;
      entity.position[axis] += amount;

      const min = [
        entity.position.x - half,
        entity.position.y,
        entity.position.z - half
      ];
      const max = [
        entity.position.x + half,
        entity.position.y + height,
        entity.position.z + half
      ];

      for (let bx = Math.floor(min[0]); bx <= Math.floor(max[0]); bx++) {
        for (let by = Math.floor(min[1]); by <= Math.floor(max[1]); by++) {
          for (let bz = Math.floor(min[2]); bz <= Math.floor(max[2]); bz++) {
            const id = this.world.getBlock(bx, by, bz);
            if (id === 0) continue;
            const def = BlockRegistry.getById(id);
            if (!def || !def.solid) continue;
            if (def.passable) continue; // B48：开门态门板只画不挡（村民/僵尸/玩家同一口径）
            // B27 形制方块（门/床）：碰撞收缩到格内 AABB
            const box = def.shape ? cellBox(def, bx, by, bz) : null;
            const bX0 = box ? box[0] : bx, bY0 = box ? box[1] : by, bZ0 = box ? box[2] : bz;
            const bX1 = box ? box[3] : bx + 1, bY1 = box ? box[4] : by + 1, bZ1 = box ? box[5] : bz + 1;
            if (max[0] > bX0 && min[0] < bX1 &&
                max[1] > bY0 && min[1] < bY1 &&
                max[2] > bZ0 && min[2] < bZ1) {
              // 回退到碰撞盒边界（盒 = 满格或格内 shape；z 轴边界必须取 bz 侧盒边界，
              // 曾误用 bx 致沿 z 撞墙的实体被瞬移到 z≈x 的远点，村民游荡高频触发）
              if (axis === 'y') {
                entity.position.y = (amount > 0) ? bY0 - height - 0.001 : bY1 + 0.001;
              } else if (axis === 'x') {
                entity.position.x = (amount > 0) ? bX0 - half - 0.001 : bX1 + half + 0.001;
              } else {
                entity.position.z = (amount > 0) ? bZ0 - half - 0.001 : bZ1 + half + 0.001;
              }
              if (axis === 'y') {
                if (amount < 0) entity.onGround = true;
                entity.velocity.y = 0;
              } else {
                entity.velocity[axis] = 0;
              }
              return;
            }
          }
        }
      }
    };

    moveAxis('y', entity.velocity.y * dt);
    moveAxis('x', entity.velocity.x * dt);
    moveAxis('z', entity.velocity.z * dt);

    if (entity.position.y < -10) {
      entity.dead = true;
    }
  }

  isStandingOn(entity) {
    const half = entity.half;
    const px = entity.position.x;
    const py = entity.position.y;
    const pz = entity.position.z;
    for (let bx = Math.floor(px - half); bx <= Math.floor(px + half); bx++) {
      for (let bz = Math.floor(pz - half); bz <= Math.floor(pz + half); bz++) {
        const id = this.world.getBlock(bx, Math.floor(py - 0.1), bz);
        if (id !== 0) {
          const def = BlockRegistry.getById(id);
          if (def && def.solid) return true;
        }
      }
    }
    return false;
  }

  isInWater(entity) {
    const id = this.world.getBlock(
      Math.floor(entity.position.x),
      Math.floor(entity.position.y + entity.height * 0.5),
      Math.floor(entity.position.z)
    );
    if (id === 0) return false;
    const def = BlockRegistry.getById(id);
    return def && def.fluidType === 'water';
  }

  isInLava(entity) {
    const id = this.world.getBlock(
      Math.floor(entity.position.x),
      Math.floor(entity.position.y + entity.height * 0.5),
      Math.floor(entity.position.z)
    );
    if (id === 0) return false;
    const def = BlockRegistry.getById(id);
    return def && def.fluidType === 'lava';
  }
}
