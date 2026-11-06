// HumanoidAnimator.js -- 方块人程序化动作器（B44 第一轮）
// 纯数学模块：不 import three、不碰 DOM，node 可直接单测（tests/build44-anim-humanoid.mjs）。
//
// 设计要点（防回退）：
//   1) 相位按"水平位移积分"推进（phase += speed * STRIDE_RATE * dt）——步幅与速度同源，不脚滑；
//      不要再改回"按时间推进"（旧实现 dt*(4+speed*0.8)，加减速时脚会打滑/倒滑）。
//   2) 状态不硬切：walk / sprint / air / swim / fly 各一条权重曲线，指数趋近（damp）；
//      起停、起跳、落地由权重与缓冲包络过渡，没有阶跃。**不要**把权重改回布尔开关。
//   3) 挖掘挥臂是叠加层（21 rad/s，与原阶段 11 节奏一致），行走时也能叠在上面。
//   4) 模块只输出角度/位移，落地到 three 的 pivot/bodyRoot 由 applyHumanoidPose / applyBodyOffset 完成。
//   5) B47：飞行前倾强度（_flyLean）也必须走 damp——创造飞行的速度是输入直给的（瞬间 0↔12m/s），
//      直接把速度映射成角度会让身体"秒趴/秒起"；不要再写回 clamp(speed * 0.03)。
//
// 符号约定（模型朝 -Z，与相机 forward 一致）：
//   armL/armR/legL/legR 是 rotation.x，**正 = 向前摆**；
//   armSpread 是双臂外展（调用方 armL.z = -s、armR.z = +s）；
//   headExtra 是附加在视角 pitch 上的偏移（正 = 抬头）；
//   bodyPitch 是前倾角（正 = 前倾，调用方 rotation.x = -bodyPitch）；
//   bodyRoll 是右倾角（正 = 向 +X 倾斜，调用方 rotation.z = -bodyRoll）。

export const STRIDE_RATE = 2.6;      // 弧度/米（约每 1.2m 一个完整步态周期的一半）
export const WALK_SPEED_REF = 4.3;   // 步行参考速度（m/s）
export const LAND_DURATION = 0.22;   // 落地缓冲时长（秒）
export const MINE_RATE = 21;         // 挖掘挥臂角速度（rad/s，≈0.3s 一次敲击）
export const FLY_LEAN_REF = 8;       // 飞行前倾满幅参考速度（m/s）——创造飞行巡航 12 → 满幅
export const FLY_LEAN_MAX = 0.22;    // 飞行前倾附加角上限（rad，叠加在 0.10 基础前倾上）
export const FLY_LEAN_RATE = 6;      // 飞行前倾过渡速率（≈0.3s 走到 84%，≈0.5s 到位）

const TAU = Math.PI * 2;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 指数趋近：与帧率无关的平滑（rate 越大越跟手）
export function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)));
}

export function makePose() {
  return {
    armL: 0, armR: 0, armSpread: 0,
    legL: 0, legR: 0,
    headExtra: 0,
    bodyPitch: 0, bodyRoll: 0, bodyY: 0,
  };
}

export class HumanoidAnimator {
  constructor() {
    this.pose = makePose();
    this.reset();
  }

  reset() {
    this._t = 0;
    this._phase = 0;
    this._walk = 0;       // 步行权重 0..1（随速度）
    this._sprint = 0;     // 冲刺附加权重 0..1
    this._air = 0;        // 腾空权重 0..1
    this._swim = 0;       // 游泳权重 0..1
    this._fly = 0;        // 飞行/旁观权重 0..1
    this._flyLean = 0;    // 飞行前倾强度 0..1（B47：速度经阻尼，起停有过渡）
    this._landT = 0;      // 落地缓冲剩余时间
    this._landImpact = 0; // 落地冲击 0.25..1（由落地前的竖直速度决定）
    this._mineAmp = 0;
    this._minePhase = 0;
    this._prevOnGround = true;
    this._lastVy = 0;
    this._speed = 0;
    this._moved = 0;      // 累计水平位移（测试锚点：相位应与位移成正比）
    for (const k of Object.keys(this.pose)) this.pose[k] = 0;
  }

  get phase() { return this._phase; }
  get speed() { return this._speed; }
  get moved() { return this._moved; }
  get walkWeight() { return this._walk; }
  get sprintWeight() { return this._sprint; }
  get airWeight() { return this._air; }
  get swimWeight() { return this._swim; }
  get flyWeight() { return this._fly; }
  get flyLean() { return this._flyLean; }
  get mineAmp() { return this._mineAmp; }
  get landing() { return this._landT > 0 ? Math.sin(Math.PI * (1 - this._landT / LAND_DURATION)) * this._landImpact : 0; }

  // ctx: { speed, vy, sprinting, onGround, inWater, flying, mine }
  // 返回本帧姿态（复用同一个 pose 对象，调用方不要保存引用）。
  update(dt, ctx = {}) {
    dt = clamp(Number(dt) || 0, 0, 0.1);
    const speed = Math.max(0, Number(ctx.speed) || 0);
    const vy = Number(ctx.vy) || 0;
    const onGround = ctx.onGround !== false;
    const inWater = !!ctx.inWater;
    const flying = !!ctx.flying;
    const sprinting = !!ctx.sprinting;

    this._t += dt;
    this._speed = speed;

    // 落地检测：上一帧腾空、这一帧着地 → 开一个缓冲包络（冲击强度取落地前的竖直速度）
    if (onGround && !this._prevOnGround && !inWater && !flying) {
      this._landT = LAND_DURATION;
      this._landImpact = clamp(Math.abs(this._lastVy) / 10, 0.25, 1);
    }
    this._prevOnGround = onGround;
    this._lastVy = vy;
    if (this._landT > 0) this._landT = Math.max(0, this._landT - dt);

    const grounded = onGround && !inWater && !flying;

    // 状态权重（指数趋近，起停无阶跃）
    this._walk = damp(this._walk, grounded ? clamp(speed / WALK_SPEED_REF, 0, 1) : 0, 12, dt);
    this._sprint = damp(this._sprint, grounded && sprinting && speed > 0.5 ? 1 : 0, 8, dt);
    this._air = damp(this._air, !onGround && !inWater && !flying ? 1 : 0, 10, dt);
    this._swim = damp(this._swim, inWater && !flying ? 1 : 0, 8, dt);
    this._fly = damp(this._fly, flying ? 1 : 0, 8, dt);
    // B47 飞行前倾强度：速度是"输入直给"的（创造飞行一按 W 就 12m/s），直接映射会让
    // 身体瞬间趴下去、松手瞬间弹回；这里再套一层指数趋近做加速/减速过渡。
    this._flyLean = damp(this._flyLean, flying ? clamp(speed / FLY_LEAN_REF, 0, 1) : 0, FLY_LEAN_RATE, dt);

    // 相位：地面按位移、水中按时间（划水节奏与速度弱相关）、飞行只做轻微摆动
    if (grounded) {
      const step = speed * dt;
      this._moved += step;
      this._phase += step * STRIDE_RATE;
    } else if (inWater) {
      this._phase += dt * (2.4 + Math.min(6, speed) * 1.0);
    } else if (flying) {
      this._phase += dt * 1.6;
    }
    if (this._phase >= TAU) this._phase %= TAU;

    // 挖掘挥臂叠加层
    this._mineAmp = damp(this._mineAmp, ctx.mine && !flying ? 1 : 0, 10, dt);
    if (this._mineAmp > 0.01) this._minePhase = (this._minePhase + dt * MINE_RATE) % TAU;

    const p = this.pose;
    p.armL = 0; p.armR = 0; p.armSpread = 0;
    p.legL = 0; p.legR = 0;
    p.headExtra = 0; p.bodyPitch = 0; p.bodyRoll = 0; p.bodyY = 0;

    // ── idle：呼吸/重心微晃（完全静止时也不"站尸"） ────────────────────────
    const idle = clamp(1 - (this._walk + this._sprint * 0.4 + this._air + this._swim + this._fly), 0, 1);
    if (idle > 0.001) {
      p.bodyY += Math.sin(this._t * 1.6) * 0.006 * idle;
      p.bodyRoll += Math.sin(this._t * 0.8) * 0.008 * idle;
      p.armL += Math.sin(this._t * 1.1) * 0.02 * idle;
      p.armR -= Math.sin(this._t * 1.1) * 0.02 * idle;
      p.headExtra += Math.sin(this._t * 0.9) * 0.01 * idle;
    }

    // ── 步行 / 冲刺：正弦摆腿 + 反向摆臂 + 前倾 + 重心侧倾 ──────────────────
    const stride = Math.sin(this._phase);
    const amp = 0.75 * this._walk + 0.35 * this._sprint;
    if (amp > 0.0001) {
      p.legL += stride * amp;
      p.legR -= stride * amp;
      p.armL -= stride * amp * 0.8;   // 同侧手脚反向
      p.armR += stride * amp * 0.8;
      p.bodyRoll += stride * 0.02 * amp;
      p.bodyPitch += 0.05 * this._walk + 0.16 * this._sprint;
      p.headExtra += Math.sin(this._phase * 2) * 0.012 * amp;
    }

    // ── 腾空：起跳收腿、下落张开；手臂外展 ─────────────────────────────────
    if (this._air > 0.0001) {
      const a = this._air;
      const rise = clamp(vy / 6, -1, 1);      // >0 上升，<0 下落
      const tuck = 1 - 0.6 * Math.max(0, rise); // 上升时收得更多
      p.armSpread += 0.42 * a;
      p.armL += 0.18 * a * Math.max(0, -rise);  // 下落时手臂略前伸
      p.armR += 0.18 * a * Math.max(0, -rise);
      p.legL += 0.16 * a * tuck;
      p.legR -= 0.16 * a * tuck * 0.4;          // 两腿不完全对称，避免"剪刀脚"
      p.bodyPitch += 0.06 * rise * a;
    }

    // ── 游泳：俯身 + 交替划水 + 打腿 ──────────────────────────────────────
    if (this._swim > 0.0001) {
      const sw = this._swim;
      const paddle = Math.sin(this._phase);
      p.bodyPitch += 0.9 * sw;
      p.armL += paddle * 0.85 * sw;
      p.armR -= paddle * 0.85 * sw;
      p.armSpread += 0.12 * sw;
      p.legL += Math.sin(this._phase * 2.4) * 0.22 * sw;
      p.legR -= Math.sin(this._phase * 2.4) * 0.22 * sw;
      p.bodyY += Math.sin(this._t * 2.2) * 0.015 * sw;
    }

    // ── 飞行 / 旁观：身体前倾幅值随速度、手臂微展、双腿并拢 ─────────────────
    if (this._fly > 0.0001) {
      const f = this._fly;
      // B47：前倾强度走 _flyLean（已阻尼），不要再直接 clamp(speed*0.03) —— 那是秒趴/秒起的根因
      p.bodyPitch += (0.10 + FLY_LEAN_MAX * this._flyLean) * f;
      p.armSpread += 0.22 * f;
      p.legL -= 0.08 * f;
      p.legR -= 0.08 * f;
      p.bodyY += Math.sin(this._t * 2) * 0.02 * f;
    }

    // ── 落地缓冲：下蹲 + 前倾 + 轻微外展（包络 sin，无阶跃） ─────────────────
    if (this._landT > 0) {
      const k = Math.sin(Math.PI * (1 - this._landT / LAND_DURATION)) * this._landImpact;
      p.bodyY -= 0.10 * k;
      p.bodyPitch += 0.10 * k;
      p.armSpread += 0.12 * k;
      p.legL += 0.10 * k;
      p.legR -= 0.10 * k;
    }

    // ── 挖掘挥臂（叠加层） ────────────────────────────────────────────────
    if (this._mineAmp > 0.001) {
      p.armR += Math.sin(this._minePhase) * 0.8 * this._mineAmp;
      p.bodyPitch += 0.05 * this._mineAmp;
    }

    return p;
  }
}

// 把姿态写到关节 pivot（headPitch 是视角俯仰，原样传入；正 = 抬头）
export function applyHumanoidPose(joints, pose, headPitch = 0) {
  if (!joints || !pose) return;
  const limb = (joint, x, z) => {
    if (!joint) return;
    joint.pivot.rotation.x = x;
    joint.pivot.rotation.z = z;
  };
  limb(joints.armL, pose.armL, -pose.armSpread);
  limb(joints.armR, pose.armR, pose.armSpread);
  limb(joints.legL, pose.legL, 0);
  limb(joints.legR, pose.legR, 0);
  if (joints.head) joints.head.pivot.rotation.set(headPitch + pose.headExtra, 0, 0);
}

// 躯干偏移（bob / 前倾 / 侧倾）——bodyRoot 必须是包住全部部件、且不含世界位姿的中间节点
export function applyBodyOffset(bodyRoot, pose) {
  if (!bodyRoot || !pose) return;
  bodyRoot.position.y = pose.bodyY;
  bodyRoot.rotation.x = -pose.bodyPitch;
  bodyRoot.rotation.z = -pose.bodyRoll;
}
