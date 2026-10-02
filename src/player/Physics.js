// Physics.js -- 玩家物理：AABB 碰撞、重力
import { World } from '../core/World.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { cellBox } from '../core/blockShape.js';
import { CHUNK_HEIGHT } from '../core/Chunk.js';

const GRAVITY = -32;
const JUMP_VELOCITY = 9;
const WATER_GRAVITY = -8;       // 水中重力（约为陆地的 1/4）
const WATER_DRAG = 0.8;         // 水中垂直阻力（每帧速度衰减）
const WATER_HORZ_DRAG = 0.7;    // 水中水平阻力
const WATER_EXIT_BOOST = 4.0;   // 水中上岸助推（与 Space 上浮同级）：贴岸碰撞时抬升竖直速度
const WATER_EXIT_VY_GATE = -0.6; // 助推门限：下沉趋势（潜游/坠水掠墙）不助推，悬浮/上浮贴岸才触发
export const GLIDE_GRAVITY = -9;  // 鞘翅滑翔重力（约为落体的 1/3.5；Game._updateGliding 升力上限也引用）
const GLIDE_MAX_FALL = -3.9;    // 滑翔下沉速度上限（m/s，原版平飞下沉口径）
const GLIDE_WALL_CRASH_SPEED = 8; // 滑翔撞墙的最小水平冲击速度（低于此仅停下不受伤）

export class Physics {
  constructor(world) {
    this.world = world;
  }

  // 玩家 AABB：0.6 x 1.8 x 0.6
  collide(entity, dt) {
    const half = 0.3;
    const height = 1.8;
    
    // 应用重力（水中减弱 / 滑翔温和）
    if (!entity.flying && !entity.spectator) {
      if (entity.inWater) {
        entity.velocity.y += WATER_GRAVITY * dt;
        entity.velocity.y *= Math.pow(WATER_DRAG, dt * 60); // 帧率无关阻力
        // 限制水中垂直速度
        if (entity.velocity.y < -4) entity.velocity.y = -4;
        if (entity.velocity.y > 6) entity.velocity.y = 6;
      } else if (entity.gliding) {
        entity.velocity.y += GLIDE_GRAVITY * dt;
        // 下沉上限随机速变化：飞得越快升力越大，平飞下沉越缓（拉起转爬升的起
        // 点也更浅——否则每次拉起都要先从 -3.9 的深坑里爬出来，翱翔手感出不来）
        const vh = Math.hypot(entity.velocity.x, entity.velocity.z);
        const maxFall = GLIDE_MAX_FALL / (1 + vh * 0.10);
        if (entity.velocity.y < maxFall) entity.velocity.y = maxFall;
      } else {
        entity.velocity.y += GRAVITY * dt;
      }
    }

    // 限制速度
    const maxVel = 50;
    entity.velocity.x = Math.max(-maxVel, Math.min(maxVel, entity.velocity.x));
    entity.velocity.y = Math.max(-maxVel, Math.min(maxVel, entity.velocity.y));
    entity.velocity.z = Math.max(-maxVel, Math.min(maxVel, entity.velocity.z));

    // 冲击速度捕获：在 y 轴碰撞把 velocity 清零之前记录本帧重力应用后的速度，
    // 供摔落伤害 / 滑翔撞墙伤害判定（moveAxis 落地会清零 velocity.y，事后读不到）
    entity.impactVy = entity.velocity.y;
    entity.impactVh = Math.hypot(entity.velocity.x, entity.velocity.z);
    entity.wallCrash = 0;
    
    if (entity.spectator) {
      // 旁观：无碰撞
      entity.position.x += entity.velocity.x * dt;
      entity.position.y += entity.velocity.y * dt;
      entity.position.z += entity.velocity.z * dt;
      entity.onGround = false;
      return;
    }
    
    entity.onGround = false;

    // 身体浸水判定（脚部 + 躯干中点任一格为水）：水中上岸助推依赖它而非眼位 inWater——
    // 贴岸上爬时头先出水，眼位判定会翻 false 导致助推中断（原版 isInWater 语义）
    entity.bodyInWater = this._bodyInWater(entity, half);

    // 分轴移动 + 碰撞，每轴逐步检测所有可能碰撞的方块
    this.moveAxis(entity, 'y', entity.velocity.y * dt, half, height);
    this.moveAxis(entity, 'x', entity.velocity.x * dt, half, height);
    this.moveAxis(entity, 'z', entity.velocity.z * dt, half, height);
    
    // 防止掉出世界（主世界安全网）；虚空维度（末地/天域）不救援——交给虚空伤害/死亡重生
    if (entity.position.y < -10 && !(this.world && this.world.dimDef && this.world.dimDef.hasVoid)) {
      entity.position.y = 100;
      entity.velocity.y = 0;
    }
  }

  moveAxis(entity, axis, amount, half, height) {
    if (amount === 0) return;

    entity.position[axis] += amount;

    // 玩家 AABB
    const minX = entity.position.x - half;
    const maxX = entity.position.x + half;
    const minY = entity.position.y;
    const maxY = entity.position.y + height;
    const minZ = entity.position.z - half;
    const maxZ = entity.position.z + half;

    // 遍历所有可能碰撞的方块
    const bxMin = Math.floor(minX);
    const bxMax = Math.floor(maxX);
    const byMin = Math.floor(minY);
    const byMax = Math.floor(maxY);
    const bzMin = Math.floor(minZ);
    const bzMax = Math.floor(maxZ);

    // 收集所有碰撞，取最保守的回退位置
    let bestResolve = null;
    // 同时收集最高阻挡方块顶面（用于水中自动上岸）
    let maxBlockTopY = -Infinity;
    // B27：最高阻挡面是否来自门/活板门面板——门不可 auto-jump 踏越（原版语义），
    // 否则站在坡顶对上格门板会触发 1.0 台阶"爬门"穿门
    let maxBlockTopIsDoor = false;

    for (let bx = bxMin; bx <= bxMax; bx++) {
      for (let by = byMin; by <= byMax; by++) {
        for (let bz = bzMin; bz <= bzMax; bz++) {
          const id = this.world.getBlock(bx, by, bz);
          if (id === 0) continue;
          const def = BlockRegistry.getById(id);
          if (!def || !def.solid) continue;
          // B27 形制方块（门/床）：碰撞收缩到格内 AABB（cellBox 仅 shape 方块分配）
          const box = def.shape ? cellBox(def, bx, by, bz) : null;
          const bX0 = box ? box[0] : bx, bY0 = box ? box[1] : by, bZ0 = box ? box[2] : bz;
          const bX1 = box ? box[3] : bx + 1, bY1 = box ? box[4] : by + 1, bZ1 = box ? box[5] : bz + 1;

          // AABB 重叠检测
          if (maxX > bX0 && minX < bX1 &&
              maxY > bY0 && minY < bY1 &&
              maxZ > bZ0 && minZ < bZ1) {
            let resolve;
            if (axis === 'y') {
              resolve = amount > 0 ? (bY0 - height - 0.0001) : (bY1 + 0.0001);
            } else if (axis === 'x') {
              resolve = amount > 0 ? (bX0 - half - 0.0001) : (bX1 + half + 0.0001);
            } else {
              resolve = amount > 0 ? (bZ0 - half - 0.0001) : (bZ1 + half + 0.0001);
            }
            // 取最保守的回退（向移动方向反方向最远）
            if (bestResolve === null) {
              bestResolve = resolve;
            } else if (amount > 0) {
              bestResolve = Math.min(bestResolve, resolve);
            } else {
              bestResolve = Math.max(bestResolve, resolve);
            }
            // 记录最高阻挡方块顶面（用于水中上岸；形制方块取盒顶）
            if (bY1 > maxBlockTopY) {
              maxBlockTopY = bY1;
              maxBlockTopIsDoor = def.part === 'door_lower' || def.part === 'door_upper' || def.part === 'trapdoor';
            }
          }
        }
      }
    }

    if (bestResolve !== null) {
      // 水平碰撞分流：
      // ① 陆上自动台阶（auto-jump）：阻挡方块顶面只高出 1 格以内且上方有空间 → 抬升 y 保留水平移动
      // ② 水中上岸（B30，类原版）：不做瞬抬台阶，改为给一记上浮助推（与 Space 上浮同级），
      //    沿岸壁逐帧上爬、翻过岸沿后由水平移速自然带上岸；身体（脚/躯干）离水助推即停，
      //    水面以上的高墙因此爬不上去（原版语义）。滑翔中两者都禁用（撞山应走 wallCrash 伤害停滑）
      if (axis !== 'y' &&
          !entity.gliding &&
          !maxBlockTopIsDoor && // B27：门板不可踏越
          isFinite(maxBlockTopY) &&
          maxBlockTopY - entity.position.y > 0 &&
          maxBlockTopY - entity.position.y <= 1.0 + 0.01) {
        const targetY = maxBlockTopY + 0.0001;
        if (entity.bodyInWater && !entity.flying) {
          // 水中：岸沿可越且顶部有空间、且无下沉意图（潜游/坠水掠墙不打断）→ 上浮助推
          if (entity.velocity.y > WATER_EXIT_VY_GATE &&
              this._yClearAt(entity, half, height, targetY)) {
            entity.velocity.y = Math.max(entity.velocity.y, WATER_EXIT_BOOST);
          }
        } else if (this._yClearAt(entity, half, height, targetY)) {
          // 陆上：抬升 y 到阻挡方块顶面，保留水平移动
          entity.position.y = targetY;
          return;
        }
      }
      // 否则按碰撞回退
      entity.position[axis] = bestResolve;
      if (axis === 'y') {
        entity.velocity.y = 0;
        if (amount < 0) entity.onGround = true;
      } else if (axis === 'x') {
        // 滑翔撞墙：记录清零前的水平冲击速度（Game 侧结算伤害并终止滑翔）
        if (entity.gliding && Math.abs(entity.velocity.x) > GLIDE_WALL_CRASH_SPEED) {
          entity.wallCrash = Math.max(entity.wallCrash, Math.abs(entity.velocity.x));
        }
        entity.velocity.x = 0;
      } else {
        if (entity.gliding && Math.abs(entity.velocity.z) > GLIDE_WALL_CRASH_SPEED) {
          entity.wallCrash = Math.max(entity.wallCrash, Math.abs(entity.velocity.z));
        }
        entity.velocity.z = 0;
      }
    }
  }

  // 身体浸水判定：AABB 脚部（+0.05）与躯干中点（+0.9）两层、水平覆盖格任一为水即真
  _bodyInWater(entity, half) {
    const bxMin = Math.floor(entity.position.x - half);
    const bxMax = Math.floor(entity.position.x + half);
    const bzMin = Math.floor(entity.position.z - half);
    const bzMax = Math.floor(entity.position.z + half);
    for (const dy of [0.05, 0.9]) {
      const by = Math.floor(entity.position.y + dy);
      for (let bx = bxMin; bx <= bxMax; bx++) {
        for (let bz = bzMin; bz <= bzMax; bz++) {
          const def = BlockRegistry.getById(this.world.getBlock(bx, by, bz));
          if (def && def.fluidType === 'water') return true;
        }
      }
    }
    return false;
  }

  // 验证实体抬升到 targetY 后 [targetY, targetY + height] 范围内无碰撞
  // （陆上 auto-step 与水中上岸助推共用的顶部空间检查；形制方块按格内盒判定）
  _yClearAt(entity, half, height, targetY) {
    const tMinX = entity.position.x - half;
    const tMaxX = entity.position.x + half;
    const tMinZ = entity.position.z - half;
    const tMaxZ = entity.position.z + half;
    const tbxMin = Math.floor(tMinX);
    const tbxMax = Math.floor(tMaxX - 0.0001);
    const tbyMin = Math.floor(targetY);
    const tbyMax = Math.floor(targetY + height - 0.0001);
    const tbzMin = Math.floor(tMinZ);
    const tbzMax = Math.floor(tMaxZ - 0.0001);
    for (let bx = tbxMin; bx <= tbxMax; bx++) {
      for (let by = tbyMin; by <= tbyMax; by++) {
        for (let bz = tbzMin; bz <= tbzMax; bz++) {
          const id = this.world.getBlock(bx, by, bz);
          if (id === 0) continue;
          const def = BlockRegistry.getById(id);
          if (!def || !def.solid) continue;
          // B27：形制方块按格内盒判定（床 9/16 顶上不算阻挡，auto-jump 才能直接走上床）
          const box = def.shape ? cellBox(def, bx, by, bz) : null;
          if (box) {
            if (tMaxX > box[0] && tMinX < box[3] &&
                targetY + height > box[1] && targetY < box[4] &&
                tMaxZ > box[2] && tMinZ < box[5]) return false;
          } else {
            return false;
          }
        }
      }
    }
    return true;
  }

  jump(entity) {
    if (entity.inWater) return; // 水中由上浮逻辑处理
    if (entity.onGround && !entity.flying) {
      entity.velocity.y = JUMP_VELOCITY;
      entity.onGround = false;
    }
  }
}
