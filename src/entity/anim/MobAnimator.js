// MobAnimator.js -- 怪物程序化动作器（B44 第二轮）
// 纯数学模块（不 import three / 不碰 DOM），node 可单测；MobManager 只负责把 pose 落到关节。
//
// 体型模板（由 MobRig.inferPlan 按部件名推导）：
//   biped     人形（僵尸/骷髅/村民/猪灵/守卫…）：双腿双腿反相 + 摆臂 + 头部追视 + 攻击前倾
//   quadruped 四足（猪/牛/羊/云绒兽…）：对角步态（FR+BL 同相、FL+BR 反相）+ 头部起伏 + 尾巴摆
//   spider    蜘蛛八腿：三脚架步态（FL/MR/BL 同相、FR/ML/BR 反相）
//   flying    带翼（末影龙/岚隼/风灵…）：扇翅 + 悬停起伏 + 头部追视
//   floating  悬浮（烈焰人四杆）：杆体自转 + 悬浮起伏
//   static    其余（潜影贝等）：呼吸 + 头部追视
//
// 符号约定（怪物模型朝 +Z，与人形玩家的 -Z 相反）：
//   四肢 rotation.x 正 = 末端摆向 -Z（视觉上的"后摆"）；
//   wingL/wingR 是 rotation.z；bodyPitch 正 = 前倾，落点直接写 rotation.x（怪物侧与玩家相反，不要在两端混用同一个 apply）。

import { damp } from './HumanoidAnimator.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function makeMobPose() {
  return {
    armL: 0, armR: 0,
    legL: 0, legR: 0,
    legFL: 0, legFR: 0, legBL: 0, legBR: 0, legML: 0, legMR: 0,
    headX: 0, headY: 0,
    wingL: 0, wingR: 0,
    tailY: 0,
    rodSpin: 0, rodPhase: 0, tentSway: 0,
    bodyY: 0, bodyPitch: 0,
  };
}

export class MobAnimator {
  constructor(plan = 'static') {
    this.plan = plan;
    this.pose = makeMobPose();
    this.reset();
  }

  reset() {
    this.t = 0;
    this.phase = 0;
    this._walk = 0;
    this._air = 0;
    this._lookY = 0;
    this._lookX = 0;
    this._atk = 0;
    this._hurt = 0;
    for (const k of Object.keys(this.pose)) this.pose[k] = 0;
  }

  // 一次性事件（Mob.attack / 受击时调用；指数衰减，无硬切）
  noteAttack() { this._atk = 1; }
  noteHurt() { this._hurt = 1; }

  get walkWeight() { return this._walk; }
  get attack() { return this._atk; }

  // ctx: { speed, onGround, flying, lookYaw, lookPitch }
  update(dt, ctx = {}) {
    dt = clamp(Number(dt) || 0, 0, 0.1);
    this.t += dt;
    const speed = Math.max(0, Number(ctx.speed) || 0);
    const flying = !!ctx.flying;
    const grounded = ctx.onGround !== false && !flying;
    const moving = speed > 0.15;

    this._walk = damp(this._walk, grounded && moving ? clamp(speed / 2.6, 0, 1) : 0, 10, dt);
    this._air = damp(this._air, flying ? 1 : 0, 6, dt);
    this._lookY = damp(this._lookY, clamp(Number(ctx.lookYaw) || 0, -1.1, 1.1), 9, dt);
    this._lookX = damp(this._lookX, clamp(Number(ctx.lookPitch) || 0, -0.8, 0.8), 9, dt);
    this._atk = Math.max(0, this._atk - dt * 3);
    this._hurt = damp(this._hurt, 0, 8, dt);

    if (grounded && moving) this.phase = (this.phase + speed * 3.4 * dt) % TAU;

    const p = this.pose;
    for (const k of Object.keys(p)) p[k] = 0;
    const idle = clamp(1 - this._walk - this._air, 0, 1);
    const lunge = 0.35 * this._atk;   // 攻击前倾（正 = 朝 +Z 冲）
    const flinch = 0.18 * this._hurt; // 受击后仰

    if (this.plan === 'biped') {
      const s = Math.sin(this.phase) * 0.7 * this._walk;
      p.legL = s;
      p.legR = -s;
      p.armL = -s * 0.7;
      p.armR = s * 0.7;
      p.headX = -this._lookX;
      p.headY = this._lookY;
      p.bodyY = Math.sin(this.t * 1.8) * 0.012 * idle + Math.abs(Math.sin(this.phase)) * 0.02 * this._walk;
      p.bodyPitch = 0.06 * this._walk + lunge - flinch;
    } else if (this.plan === 'quadruped') {
      const s = Math.sin(this.phase) * 0.8 * this._walk;
      p.legFL = s;
      p.legBR = s;
      p.legFR = -s;
      p.legBL = -s;
      p.headX = -this._lookX + Math.sin(this.phase * 2) * 0.05 * this._walk;
      p.headY = this._lookY;
      p.bodyY = Math.sin(this.t * 1.6) * 0.012 * idle + Math.abs(Math.sin(this.phase * 2)) * 0.025 * this._walk;
      p.tailY = Math.sin(this.t * 1.6) * 0.18 * (0.4 + 0.6 * this._walk);
      p.bodyPitch = 0.03 * this._walk + lunge * 0.6 - flinch;
    } else if (this.plan === 'spider') {
      const s = Math.sin(this.phase) * 0.55 * this._walk;
      p.legFL = s;
      p.legMR = s;
      p.legBL = s;
      p.legFR = -s;
      p.legML = -s;
      p.legBR = -s;
      p.headX = -this._lookX;
      p.headY = this._lookY;
      p.bodyY = Math.sin(this.t * 2.2) * 0.01 * idle + Math.abs(Math.sin(this.phase * 2)) * 0.015 * this._walk;
      p.bodyPitch = lunge * 0.5 - flinch;
    } else if (this.plan === 'flying') {
      const flap = Math.sin(this.t * 5 + this.phase) * (0.22 + 0.3 * (this._walk + this._air));
      p.wingL = -flap;  // 双翼同向扇动（wingL 在 -X，负 z 才抬翼）
      p.wingR = flap;
      p.headX = -this._lookX;
      p.headY = this._lookY;
      p.bodyY = Math.sin(this.t * 2) * 0.03;
      p.bodyPitch = 0.08 * this._walk + lunge * 0.5 - flinch * 0.5;
      p.tailY = Math.sin(this.t * 1.4) * 0.12;
    } else if (this.plan === 'floating') {
      p.rodSpin = this.t * 2.4;
      p.tentSway = Math.sin(this.t * 2) * 0.22;
      p.headX = -this._lookX;
      p.headY = this._lookY;
      p.bodyY = Math.sin(this.t * 2.2) * 0.05;
      p.bodyPitch = 0.04 * Math.sin(this.t * 1.3) + lunge * 0.4 - flinch * 0.5;
    } else {
      // static / 兜底：呼吸 + 追视
      p.headX = -this._lookX;
      p.headY = this._lookY;
      p.bodyY = Math.sin(this.t * 1.5) * 0.01;
      p.bodyPitch = lunge * 0.4 - flinch;
    }

    return p;
  }
}
