// Player.js -- 玩家实体
import * as THREE from 'three';
import { Raycast } from './Raycast.js';

// Build 20 ⑤：第三人称相机与眼睛的默认距离（格）；贴墙时按射线遮挡裁剪拉近
const THIRD_PERSON_DIST = 4;

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(0, 100, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.gliding = false;   // 鞘翅滑翔中（Game 每帧维护；Physics 按此切换温和重力）
    this.emblemWorn = false; // 终局成就（Build 19 K3）：佩戴原初纹章（无敌+可飞行+基岩心）
    this.creative = false;
    this.spectator = false;
    this.survival = false;
    this.viewMode = 0; // Build 20 ⑤：0=第一人称 1=第三人称背后 2=第三人称正面（F5 循环）
    
    // 生存属性
    this.health = 20;
    this.maxHealth = 20;
    this.food = 20;
    this.maxFood = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.xp = 0;
    this.xpLevel = 0;
    this.armor = 0;
    
    // 状态
    this.gamemode = 'creative';
    this.inWater = false;
    this.onFire = 0;
    this.airTicks = 300;      // 氧气（原版口径：满氧 300 tick = 15 秒，20 tick/s 按 dt 折算）
    this.drownTimer = 1;      // 溺水伤害计时（秒，耗尽后每 1 秒扣 2 血）
    this.invulnerable = 0;     // 受击后无敌帧（秒），> 0 时阻止 hurt()
    this.effects = new Map();  // 状态效果（信标 buff + 凋零 debuff 统一管理）：name -> { level, time(秒) }
    this.onHurt = null;          // 受击回调 (amount, source) => void，由 Game 注册
    this.onDeath = null;
  }

  // 状态效果（Idea-2D-③）：信标 buff（speed/haste/resistance/jump_boost/strength）
  // 与凋零 debuff（wither）统一存放；同名取 max(level, time) 刷新
  applyEffect(name, level = 1, duration = 10) {
    const cur = this.effects.get(name);
    this.effects.set(name, {
      level: Math.max(level, cur ? cur.level : 0),
      time: Math.max(duration, cur ? cur.time : 0),
    });
  }

  // 当前生效的效果等级（过期返回 0）；挂钩点：移速/挖掘急迫/抗性/跳跃/力量/凋零扣血
  getEffectLevel(name) {
    const e = this.effects.get(name);
    return e && e.time > 0 ? e.level : 0;
  }

  tickEffects(dt) {
    for (const [name, e] of this.effects) {
      e.time -= dt;
      if (e.time <= 0) this.effects.delete(name);
    }
  }

  clearEffects() { this.effects.clear(); }

  // 凋零 II 附加（Idea-2D-②）：2 级效果，扣血节拍在 Game 统一走（每秒 1 血）
  applyWither(seconds = 10) {
    this.applyEffect('wither', 2, seconds);
  }

  // 统一受击入口：处理无敌帧 + 触发 onHurt 回调。
  //   amount   - 扣血量
  //   source   - 触发来源标签（'mob' / 'fall' / 'drown' / 'starve' / 'fire' / 'lava'）
  //   showVignette - 是否触发屏幕红闪（攻击 / 摔落是；溺水 / 饥饿否）
  // 返回 true 表示成功扣血，false 表示被无敌帧/模式拦截。
  hurt(amount, source = 'mob', showVignette = true) {
    if (this.creative || this.spectator) return false;
    if (this.emblemWorn) return false; // 终局成就（Build 19 K3）：佩戴原初纹章=无敌
    if (this.invulnerable > 0) return false;
    // 盔甲减伤：每点 4%、上限 20 点（原版公式，最高 80%）；armor 由 Game 每帧从装备槽汇总
    if (this.armor > 0) amount *= 1 - Math.min(20, this.armor) * 0.04;
    // 抗性效果（信标 buff）：每级 -20%
    const res = this.getEffectLevel('resistance');
    if (res > 0) amount *= 1 - 0.2 * res;
    this.health = Math.max(0, this.health - amount);
    this.invulnerable = 0.5;     // 10 tick 的受击无敌期
    if (showVignette && this.onHurt) this.onHurt(amount, source);
    if (this.health <= 0 && this.onDeath) this.onDeath();
    return true;
  }

  // 添加经验（击杀/挖矿/经验瓶）：跨级进位，每级需求 level*10+10（与 Hud 进度条同式）
  addXp(n) {
    if (!Number.isFinite(n) || n <= 0) return;
    this.xp += n;
    while (this.xp >= this.xpLevel * 10 + 10) {
      this.xp -= this.xpLevel * 10 + 10;
      this.xpLevel++;
    }
  }

  // 食用食物：增加 food / saturation，返回是否成功吃下。
  //   原版规则：food += item.food，saturation += food * 0.6（简化版无 saturation 越界控制）
  //   创造/旁观 / 饱腹 时直接拒绝，不消耗物品。
  eat(itemDef) {
    if (this.creative || this.spectator) return false;
    if (!itemDef || !itemDef.food) return false;
    if (this.food >= this.maxFood) return false;
    this.food = Math.min(this.maxFood, this.food + itemDef.food);
    this.saturation = Math.min(this.maxFood, this.saturation + itemDef.food * 0.6);
    return true;
  }

  setMode(mode) {
    this.gamemode = mode;
    this.creative = mode === 'creative';
    this.survival = mode === 'survival';
    this.spectator = mode === 'spectator';
    if (mode === 'creative') {
      this.flying = false;
      this.health = 20;
      this.food = 20;
    } else if (mode === 'spectator') {
      this.flying = true;
    } else {
      this.flying = false;
    }
  }

  // 相机位姿（Game.update 每帧调用；world 供第三人称遮挡裁剪，缺省跳过裁剪）。
  // Build 20 ⑤ 三态：0 第一人称（眼点） / 1 第三人称背后（视线反方向退距） /
  // 2 第三人称正面（视线正方向退距，相机回望玩家）。准星射线仍从眼睛发射（原版语义）。
  updateCamera(world = null) {
    this.camera.rotation.order = 'YXZ';
    if (this.viewMode === 0) {
      this.camera.position.copy(this.position);
      this.camera.position.y += 1.62; // 视点高度
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
      return;
    }
    const ex = this.position.x, ey = this.position.y + 1.62, ez = this.position.z;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const dx = -sy * cp, dy = sp, dz = -cy * cp; // 视线方向（yaw=0 朝 -Z，pitch 正抬头）
    const sign = this.viewMode === 1 ? -1 : 1;   // 背后=逆视线、正面=顺视线
    let dist = THIRD_PERSON_DIST;
    if (world) {
      if (!this._camRay) this._camRay = new Raycast(world);
      else this._camRay.world = world; // 存档切换时 world 实例更换，必须跟随
      const hit = this._camRay.cast(
        new THREE.Vector3(ex, ey, ez),
        new THREE.Vector3(dx * sign, dy * sign, dz * sign),
        dist
      );
      if (hit && hit.t != null) dist = Math.max(0.3, hit.t - 0.25); // 贴墙拉近防穿墙
    }
    this.camera.position.set(ex + dx * sign * dist, ey + dy * sign * dist, ez + dz * sign * dist);
    if (this.viewMode === 1) {
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
    } else {
      this.camera.rotation.y = this.yaw + Math.PI; // 正面视角：相机回望玩家
      this.camera.rotation.x = -this.pitch;
    }
  }
}
