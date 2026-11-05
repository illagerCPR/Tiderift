// Mob.js -- 怪物实体 + AI
import * as THREE from 'three';
import { Entity } from './Entity.js';
import { MobTypes } from './MobTextures.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { updateDragonAI } from './DragonAI.js';
import { updateWitherAI } from './WitherAI.js';
import { updateColossusAI } from './StormColossusAI.js';
import { audio } from '../audio/AudioEngine.js';

export class Mob extends Entity {
  constructor(typeName, world) {
    super();
    const type = MobTypes[typeName];
    this.type = type;
    this.typeName = typeName;
    this.isMob = true;   // 鸭子类型标记：chase 攻击分流用（instanceof 在 HMR 双模块实例下失效）
    this.world = world;
    this.width = type.width;
    this.height = type.height;
    this.maxHealth = type.health;
    this.health = type.health;
    this.attackDamage = type.damage;
    this.speed = type.speed;
    this.attackRange = type.attackRange;
    this.detectionRange = type.detectionRange;
    this.ranged = type.ranged || false;
    this.burningInDay = type.burningInDay || false;
    this.climbing = type.climbing || false;
    this.explosionRadius = type.explosionRadius || 0;
    this.neutral = type.neutral || false;       // 中立：受击才激怒索敌
    this.flying = type.flying || false;         // 悬浮：物理跳过重力，竖直悬停控制
    this.igniteOnHit = type.igniteOnHit || false; // 攻击命中点燃玩家
    this.witherOnHit = type.witherOnHit || false; // 攻击命中附加凋零 II（凋灵）

    // AI 状态
    this.target = null;
    this.aiState = 'idle';
    this.aiTimer = 0;
    this.attackCooldown = 0;
    this.fuseTimer = 0;
    this.isBurning = false;
    this.burnTime = 0;
    this.wanderDir = new THREE.Vector3();
    this.wanderTimer = 0;
    this.mesh = null;
    this.knockback = new THREE.Vector3();
    this.hitFlash = 0;          // 受击红光闪烁计时（秒）
    this.dyingAnim = null;      // 死亡动画状态 {progress, total}
    this.home = null;           // 村民：{x, z, radius} 村庄绳拴锚点（生成方注入）
    this.fleeTimer = 0;         // 村民：逃离最短持续时间
    this.aggro = false;         // 中立生物激怒态（MobManager.attackMob 设置）
    this.aggroTimer = 0;        // 激怒剩余时长（归零息怒）
    this.hoverPhase = Math.random() * Math.PI * 2; // 悬浮相位
    this.hoverBaseY = null;     // 悬浮基准高度（首帧取生成高度）
  }

  // AI 更新（mobManager 由 MobManager.update 注入，供村民逃敌/敌对索敌村民查询）
  update(dt, player, sky, physics, mobManager) {
    if (this.dead) return;

    this.aiTimer -= dt;
    this.attackCooldown -= dt;
    this.wanderTimer -= dt;

    // A-②：环境叫声（随机计时 + 引擎全局限频 + 距离衰减；dragon/shulker 早退分支之前）
    this._voiceTimer = (this._voiceTimer ?? 4 + Math.random() * 8) - dt;
    if (this._voiceTimer <= 0) {
      this._voiceTimer = 7 + Math.random() * 9;
      const dist = player ? this.position.distanceTo(player.position) : 99;
      if (dist < 24) audio.mobIdle(this.typeName, dist);
    }

    // 燃烧判定（日光下）
    if (this.burningInDay && sky && sky.isDay() && this.isExposedToSky()) {
      this.isBurning = true;
      this.burnTime = 8;
    }
    if (this.isBurning) {
      this.burnTime -= dt;
      if (this.burnTime <= 0) {
        this.isBurning = false;
      } else {
        this.health -= dt * 1.5;
        if (this.health <= 0) { this.dead = true; }
      }
    }

    if (this.typeName === 'dragon') {
      // 末影龙：DragonAI 全接管（盘旋/俯冲/栖息回血），不走通用索敌链
      updateDragonAI(this, dt, player);
      physics.collide(this, dt);
      if (this.position.y < -20) this.dead = true;
      return;
    }

    if (this.typeName === 'wither') {
      // 凋灵：WitherAI 全接管（升空/环绕/齐射/狂暴），不走通用索敌链
      updateWitherAI(this, dt, player, mobManager);
      physics.collide(this, dt);
      if (this.position.y < -20) this.dead = true;
      return;
    }

    if (this.typeName === 'storm_colossus') {
      // 守誓巨像（天域批次 C）：三阶段全接管（岩卫震地/风暴齐射/裂心风拽），不走通用索敌链
      updateColossusAI(this, dt, player, mobManager);
      physics.collide(this, dt);
      if (this.position.y < -20) this.dead = true;
      return;
    }

    if (this.typeName === 'shulker') {
      // 潜影贝：原地附着 + 蓄力直线弹，不走通用索敌/游荡链
      this.updateShulker(dt, player);
      physics.collide(this, dt);
      if (this.position.y < -20) this.dead = true;
      return;
    }

    if (this.type.guardian) {
      // Idea-2E：铁傀儡护卫——索敌反击敌对怪/激怒追玩家，无敌情时村庄绳拴游荡
      this.updateGuardianAI(dt, player, physics, mobManager);
    } else if (this.type.passive) {
      // 村民等被动生物：游荡/注视/逃离，永不索敌
      this.updatePassiveAI(dt, player, physics, mobManager);
    } else if (this.neutral && !this.aggro) {
      // 中立生物（僵尸猪灵）：未被激怒只游荡，不索敌
      this.target = null;
      this.aiState = 'idle';
      this.wander(dt, physics);
    } else {
      const distToPlayer = this.position.distanceTo(player.position);
      // Build 20 ④：创造/旁观玩家不成为任何索敌目标（同原版——怪物不以创造玩家为敌）
      const playerTargetable = !player.creative && !player.spectator;

      // 敌对目标选择：玩家与村民（仅僵尸/骷髅，苦力怕/蜘蛛限玩家——防自爆拆村）取最近
      let target = null;
      let targetDist = Infinity;
      if (playerTargetable && distToPlayer < this.detectionRange && this.hasLineOfSight(player)) {
        target = player;
        targetDist = distToPlayer;
      }
      // 被激怒的中立生物：无视视线死追玩家（激怒期内）
      if (playerTargetable && this.aggro && distToPlayer < this.detectionRange * 2.5) {
        target = player;
        targetDist = distToPlayer;
      }
      const huntsVillagers = this.typeName === 'zombie' || this.typeName === 'skeleton';
      if (huntsVillagers && mobManager) {
        const v = mobManager.findNearestMob(this.position, this.detectionRange, 'villager');
        if (v) {
          const dv = this.position.distanceTo(v.position);
          if (dv < targetDist) { target = v; targetDist = dv; }
        }
      }

      if (target) {
        this.target = target;
        this.aiState = 'chase';
      } else if (this.aiState === 'chase' &&
                 (!this.target || this.target.dead ||
                  this.position.distanceTo(this.target.position) > this.detectionRange * 1.5)) {
        this.aiState = 'idle';
        this.target = null;
      }

      if (this.aiState === 'chase' && this.target) {
        this.chase(dt, this.target, physics, mobManager);
      } else {
        this.wander(dt, physics);
      }

      // 苦力怕爆炸（只对玩家目标——目标是村民时保持追行不引爆，护村）
      if (this.typeName === 'creeper' && this.target === player) {
        if (distToPlayer < this.attackRange) {
          this.fuseTimer += dt;
          if (this.fuseTimer > 1.5) {
            this.explode();
          }
        } else {
          this.fuseTimer = Math.max(0, this.fuseTimer - dt * 2);
        }
      }
    }

    // 中立生物息怒计时
    if (this.aggro) {
      this.aggroTimer -= dt;
      if (this.aggroTimer <= 0) {
        this.aggro = false;
        this.target = null;
        this.aiState = 'idle';
      }
    }

    // 悬浮竖直控制（烈焰人）：上下漂浮 + 追击时对齐目标高度；physics.collide 对 flying 不加重力
    if (this.flying) {
      if (this.hoverBaseY == null) this.hoverBaseY = this.position.y;
      this.hoverPhase += dt * 2.2;
      let vy = Math.sin(this.hoverPhase) * 0.7;
      if (this.aiState === 'chase' && this.target) {
        const ty = this.target.position.y + 1;
        vy += Math.max(-2.5, Math.min(2.5, (ty - this.position.y) * 1.1));
      } else {
        vy += Math.max(-1.2, Math.min(1.2, (this.hoverBaseY - this.position.y) * 0.5));
      }
      this.velocity.y = vy;
    }

    // 重力 + 物理
    physics.collide(this, dt);

    // 掉入虚空
    if (this.position.y < -20) {
      this.dead = true;
    }
  }

  // 潜影贝 AI：原地附着（速度清零）；玩家进入射程 → 0.6s 蓄力（hitFlash 紫闪提示）
  // → 直线视线判定命中（4 伤 + 击退），射击间隔 2.5s；走位脱离视线即可躲（无投射物实体）
  // Build 20 ④：创造/旁观玩家不触发索敌与射击
  updateShulker(dt, player) {
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.target = null;
    const d = this.position.distanceTo(player.position);
    if (d > this.detectionRange || player.dead || player.creative || player.spectator) {
      this.shulkerCharge = 0;
      return;
    }
    this.shulkerCharge = (this.shulkerCharge || 0) + dt;
    if (this.shulkerCharge < 0.6) {
      this.hitFlash = Math.max(this.hitFlash, 0.08); // 蓄力提示：淡紫闪烁
      return;
    }
    this.shulkerCharge = 0;
    if (this.attackCooldown > 0) return;
    if (this.hasLineOfSight(player)) {
      const hit = player.hurt(this.attackDamage, 'mob', true);
      if (hit) this.knockbackPlayer(player);
    }
    this.attackCooldown = 2.5;
  }

  // 护卫 AI（铁傀儡 Idea-2E）：敌对怪进入索敌范围 → 追击（chase 的 isMob 分支走
  // mobAttackMob）；被玩家攻击激怒（aggro 由 MobManager.attackMob 设置）→ 死追攻击者；
  // 无敌情 → 村庄绳拴游荡（有 home）/ 普通游荡。不逃跑、不注视玩家。
  updateGuardianAI(dt, player, physics, mobManager) {
    this.target = null;
    let target = null;
    let targetDist = Infinity;

    // 被玩家攻击的激怒期：追击玩家（比普通索敌优先级低——敌对怪仍是主目标）
    // Build 20 ④：创造/旁观玩家不被追击
    if (this.aggro && player && !player.dead && !player.creative && !player.spectator) {
      const dp = this.position.distanceTo(player.position);
      if (dp < 24) { target = player; targetDist = dp; }
    }

    // 护卫索敌：最近的敌对怪（非被动且具攻击力）进入 detectionRange → 反击
    //（护卫在村内巡逻，"接近村民"由地缘覆盖；苦力怕也纳入——拦在玩家/村民前）
    if (mobManager) {
      for (const m of mobManager.mobs) {
        if (m === this || m.dead || m.dyingAnim || m.type.passive) continue;
        if (m.attackDamage <= 0) continue;
        const d = this.position.distanceTo(m.position);
        if (d < this.detectionRange && d < targetDist) { target = m; targetDist = d; }
      }
    }

    if (target) {
      this.target = target;
      this.aiState = 'chase';
      this.chase(dt, target, physics, mobManager);
      return;
    }
    this.aiState = 'idle';
    if (this.home) this.wanderVillage(dt, physics);
    else this.wander(dt, physics);
  }

  // 被动 AI（村民）：8 格内敌对怪 → 背向逃离；4 格内玩家 → 注视；否则绳拴游荡
  updatePassiveAI(dt, player, physics, mobManager) {    this.target = null;

    let threat = null;
    let threatDist = Infinity;
    if (mobManager) {
      for (const m of mobManager.mobs) {
        if (m === this || m.dead || m.type.passive) continue;  // 被动族互不威胁（村民/风灵等）
        if (m.attackDamage <= 0) continue;
        const d = this.position.distanceTo(m.position);
        if (d < 8 && d < threatDist) { threat = m; threatDist = d; }
      }
    }

    if (threat) {
      this.aiState = 'flee';
      this.fleeTimer = 1.5;   // 脱离威胁后再保持逃跑一小段
    } else if (this.aiState === 'flee') {
      this.fleeTimer -= dt;
      if (this.fleeTimer <= 0) this.aiState = 'idle';
    }

    if (this.aiState === 'flee') {
      // 逃跑方向：有威胁背向逃离，无威胁按上帧方向继续；
      // 离家超过半径+8 时朝家偏置（防被追击怪一路拖离村庄）
      let fx = 0, fz = 0;
      if (threat) {
        fx = this.position.x - threat.position.x;
        fz = this.position.z - threat.position.z;
        const d = Math.sqrt(fx * fx + fz * fz) || 1;
        fx /= d; fz /= d;
      } else {
        fx = Math.sin(this.yaw); fz = Math.cos(this.yaw); // 沿当前朝向
      }
      if (this.home) {
        const dxh = this.home.x - this.position.x;
        const dzh = this.home.z - this.position.z;
        const dh = Math.sqrt(dxh * dxh + dzh * dzh);
        if (dh > this.home.radius + 8) {
          const w = 1.2; // 家向权重 > 1：净位移朝村
          fx = fx + (dxh / dh) * w;
          fz = fz + (dzh / dh) * w;
          const n = Math.sqrt(fx * fx + fz * fz) || 1;
          fx /= n; fz /= n;
        }
      }
      const sp = this.speed * 1.6;
      this.velocity.x = fx * sp + this.knockback.x;
      this.velocity.z = fz * sp + this.knockback.z;
      this.yaw = Math.atan2(fx, fz);   // 同 chase：+Z 朝移动方向（脸朝逃跑方向）
      if (this.isBlocked(fx, fz) && this.onGround) this.velocity.y = 8;
      this.knockback.multiplyScalar(0.85);
      return;
    }

    // 注视：玩家 4 格内站立面向玩家（不移动）
    const dp = this.position.distanceTo(player.position);
    if (dp < 4) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      this.yaw = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
      return;
    }

    this.wanderVillage(dt, physics);
  }

  // 村庄绳拴游荡：超出 home 半径 → 朝家折返
  wanderVillage(dt, physics) {
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 3 + Math.random() * 4;
      const angle = Math.random() * Math.PI * 2;
      this.wanderDir.set(Math.cos(angle), 0, Math.sin(angle));
      if (Math.random() < 0.4) {
        this.wanderDir.set(0, 0, 0);   // 常态驻足
      }
    }
    if (this.home) {
      const dxh = this.home.x - this.position.x;
      const dzh = this.home.z - this.position.z;
      const dh = Math.sqrt(dxh * dxh + dzh * dzh);
      if (dh > this.home.radius) {
        this.wanderDir.set(dxh / dh, 0, dzh / dh);
      }
    }
    this.velocity.x = this.wanderDir.x * this.speed * 0.5;
    this.velocity.z = this.wanderDir.z * this.speed * 0.5;
    if (this.wanderDir.lengthSq() > 0) {
      this.yaw = Math.atan2(this.wanderDir.x, this.wanderDir.z); // 同 chase：+Z 朝移动方向
    }
  }

  chase(dt, target, physics, mobManager) {
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    let nx = 0, nz = 0;
    if (dist > 0.001) {
      nx = dx / dist;
      nz = dz / dist;
      this.velocity.x = nx * this.speed + this.knockback.x;
      this.velocity.z = nz * this.speed + this.knockback.z;
      // mesh 局部 +Z 是脸/头朝向：rotation.y=yaw 把 +Z 旋到 (sin yaw, cos yaw)，
      // yaw=atan2(nx,nz) 使 +Z 指向移动方向（脸朝目标、蜘蛛头在前）。
      // 旧公式 atan2(-nx,-nz) 会让脸背对移动方向（蜘蛛头拖在身后），勿回退。
      this.yaw = Math.atan2(nx, nz);
    }

    // 蜘蛛可以攀爬
    if (this.climbing && this.isAgainstWall()) {
      this.velocity.y = 3;
    }

    // 跳跃跨越障碍（悬浮生物不跳——竖直由悬停控制）
    if (!this.flying && (nx !== 0 || nz !== 0) && this.isBlocked(nx, nz) && this.onGround) {
      this.velocity.y = 8;
    }

    // 攻击：目标是怪物（村民）走怪物伤害路径，目标是玩家走 player.hurt
    if (dist < this.attackRange && this.attackCooldown <= 0) {
      if (target.isMob) {
        if (mobManager) mobManager.mobAttackMob(this, target);
      } else {
        this.attack(target);
      }
      this.attackCooldown = 1.0;
    }

    this.knockback.multiplyScalar(0.85);
  }

  isBlocked(nx, nz) {
    const checkX = this.position.x + nx * 0.6;
    const checkZ = this.position.z + nz * 0.6;
    const id = this.world.getBlock(
      Math.floor(checkX),
      Math.floor(this.position.y + 0.1),
      Math.floor(checkZ)
    );
    if (id === 0) return false;
    const def = BlockRegistry.getById(id);
    return def && def.solid;
  }

  isAgainstWall() {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      const id = this.world.getBlock(
        Math.floor(this.position.x + dx * 0.5),
        Math.floor(this.position.y + 0.5),
        Math.floor(this.position.z + dz * 0.5)
      );
      if (id !== 0) return true;
    }
    return false;
  }

  wander(dt, physics) {
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 3 + Math.random() * 4;
      const angle = Math.random() * Math.PI * 2;
      this.wanderDir.set(Math.cos(angle), 0, Math.sin(angle));
      if (Math.random() < 0.3) {
        this.wanderDir.set(0, 0, 0);
      }
    }
    this.velocity.x = this.wanderDir.x * this.speed * 0.5;
    this.velocity.z = this.wanderDir.z * this.speed * 0.5;
    if (this.wanderDir.lengthSq() > 0) {
      this.yaw = Math.atan2(this.wanderDir.x, this.wanderDir.z); // 同 chase：+Z 朝移动方向
    }
  }

  attack(player) {
    if (this.typeName === 'creeper') return;
    if (this.animator) this.animator.noteAttack(); // B44：攻击前冲动作（纯表现，不影响结算）
    if (this.ranged) {
      // 骷髅射箭（简化：直接造成伤害）
      const dist = this.position.distanceTo(player.position);
      if (dist < this.attackRange) {
        const hit = player.hurt(this.attackDamage, 'mob', true);
        if (hit) this.knockbackPlayer(player);
      }
    } else {
      const hit = player.hurt(this.attackDamage, 'mob', true);
      if (hit) {
        this.knockbackPlayer(player);
        if (this.igniteOnHit) player.onFire = Math.max(player.onFire || 0, 3); // 烈焰人命中点燃
        if (this.witherOnHit && player.applyWither) player.applyWither(10); // 凋灵命中：凋零 II 10s
      }
    }
  }

  knockbackPlayer(player) {
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.001) {
      player.velocity.x += (dx / d) * 8;
      player.velocity.z += (dz / d) * 8;
      player.velocity.y += 5;
    }
  }

  hasLineOfSight(target) {
    // 简化：检查中间是否有实心方块阻挡
    const from = this.position.clone();
    from.y += this.height * 0.5;
    const to = target.position.clone();
    to.y += 1.0;
    const steps = Math.ceil(from.distanceTo(to));
    const step = to.clone().sub(from).divideScalar(steps);
    for (let i = 1; i < steps; i++) {
      const p = from.clone().add(step.clone().multiplyScalar(i));
      const id = this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      if (id !== 0) {
        const def = BlockRegistry.getById(id);
        if (def && def.solid && !def.transparent) return false;
      }
    }
    return true;
  }

  isExposedToSky() {
    const x = Math.floor(this.position.x);
    const z = Math.floor(this.position.z);
    const y = Math.floor(this.position.y + this.height);
    for (let yy = y; yy < 256; yy++) {
      const id = this.world.getBlock(x, yy, z);
      if (id !== 0) {
        return false;
      }
    }
    return true;
  }

  explode() {
    this.dead = true;
    this.pendingExplosion = {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      radius: this.explosionRadius,
    };
  }
}
