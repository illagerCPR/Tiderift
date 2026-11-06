// build47-fly-lean.mjs -- Build 47 创造飞行前倾过渡回归（纯 node，不依赖服务器）
// 断言：
//   ① 静止悬停：只有 0.10 基础前倾，速度项为 0；
//   ② 起步过渡：速度从 0 瞬间拉到 12m/s 时，单帧前倾变化远小于"速度直映"的 0.22（旧写法），
//      0.1s 只走到约 0.20rad，1s 才到满幅 0.32rad；
//   ③ 停止过渡：松手瞬间同样不弹回，0.1s 仍在 0.22 附近，1s 回到 0.10；
//   ④ 帧率无关：30fps 与 120fps 跑同一段墙钟时间，前倾强度一致；
//   ⑤ 绊线：HumanoidAnimator 不再用 clamp(speed*0.03) 直映速度。
import { readFileSync } from 'fs';
import { HumanoidAnimator, FLY_LEAN_REF, FLY_LEAN_MAX, FLY_LEAN_RATE } from '../src/entity/anim/HumanoidAnimator.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const DT = 1 / 60;
const BASE = 0.10;              // 悬停基础前倾（rad）
const FULL = BASE + FLY_LEAN_MAX; // 满幅前倾（rad）
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// 飞行帧的上下文（创造飞行时速度是输入直给的：一按 W 就是 12m/s，松手立刻 0）
const flyCtx = (speed) => ({ speed, vy: 0, onGround: false, inWater: false, flying: true, sprinting: false, mine: false });
const step = (anim, dt, speed) => {
  const p = anim.update(dt, flyCtx(speed));
  return { pitch: p.bodyPitch, lean: anim.flyLean, fly: anim.flyWeight };
};

// ── ① 悬停：只有基础前倾 ───────────────────────────────────────────────
{
  const anim = new HumanoidAnimator();
  let st = null;
  for (let i = 0; i < 180; i++) st = step(anim, DT, 0);
  ok(near(st.lean, 0, 1e-6), `静止悬停时前倾强度 = 0（${st.lean.toFixed(6)}）`);
  ok(near(st.pitch, BASE, 0.002), `静止悬停前倾 = 0.10rad（${st.pitch.toFixed(4)}）`);
  ok(near(st.fly, 1, 1e-6), '飞行权重已到位（1.0）');
  ok(FLY_LEAN_REF > 0 && FLY_LEAN_MAX > 0 && FLY_LEAN_RATE > 0, '前倾参数为正（参考速度/上限/速率）');
}

// ── ② 起步：瞬间拉到 12m/s 也不秒趴 ────────────────────────────────────
{
  const anim = new HumanoidAnimator();
  for (let i = 0; i < 180; i++) step(anim, DT, 0);

  // 旧写法（速度直映）在该帧会立刻加满 0.22 —— 记录这个"反例量"
  const oldJump = Math.min(FLY_LEAN_MAX, 12 * 0.03);
  ok(oldJump > 0.2, `反例：速度直映会一帧加 ${oldJump.toFixed(3)}rad（用户看到的"瞬间前倾"）`);

  const before = anim.pose.bodyPitch;
  const first = step(anim, DT, 12);
  ok(first.pitch - before < 0.05, `起步第一帧只加 ${(first.pitch - before).toFixed(4)}rad（不阶跃）`);
  ok(first.pitch - before > 0, '起步第一帧确实开始前倾（不是死区）');

  // 0.1s、0.5s、1s 三个时刻的过渡形态
  let at10 = null;
  let at50 = null;
  let mono = true;
  let prev = first.pitch;
  for (let i = 2; i <= 60; i++) {
    const st = step(anim, DT, 12);
    if (st.pitch < prev - 1e-12) mono = false;
    prev = st.pitch;
    if (i === 6) at10 = st.pitch;
    if (i === 30) at50 = st.pitch;
  }
  ok(mono, '加速段前倾单调增大（无抖动/回弹）');
  ok(at10 > 0.17 && at10 < 0.23, `0.1s 只到 ${at10.toFixed(3)}rad（约 65% 行程，肉眼是"压下去"）`);
  ok(at50 > 0.29 && at50 < 0.32, `0.5s 到 ${at50.toFixed(3)}rad（接近满幅）`);
  ok(prev > FULL - 0.01 && prev <= FULL + 1e-9, `1s 到满幅 ${prev.toFixed(3)}rad（=${FULL.toFixed(2)}）`);
  ok(prev < BASE + FLY_LEAN_MAX + 1e-9, '前倾不超过"基础 + 上限"');

  // ── ③ 停止：同样有过渡 ────────────────────────────────────────────────
  const beforeStop = anim.pose.bodyPitch;
  const stop1 = step(anim, DT, 0);
  ok(beforeStop - stop1.pitch < 0.05, `松手第一帧只减 ${(beforeStop - stop1.pitch).toFixed(4)}rad（不瞬间复原）`);
  let at10s = null;
  let at100s = null;
  for (let i = 2; i <= 60; i++) {
    const st = step(anim, DT, 0);
    if (i === 6) at10s = st.pitch;
    if (i === 60) at100s = st.pitch;
  }
  ok(at10s > 0.19 && at10s < 0.25, `停手 0.1s 仍在 ${at10s.toFixed(3)}rad（有缓冲）`);
  ok(at100s < BASE + 0.01, `停手 1s 回到 ${at100s.toFixed(4)}rad（≈ 悬停基础前倾）`);
}

// ── ④ 帧率无关（damp 的指数趋近性质）──────────────────────────────────
{
  const a = new HumanoidAnimator();
  const b = new HumanoidAnimator();
  for (const anim of [a, b]) for (let i = 0; i < 180; i++) step(anim, DT, 0);
  for (let i = 0; i < 15; i++) step(a, 1 / 30, 12);   // 0.5s @30fps
  for (let i = 0; i < 60; i++) step(b, 1 / 120, 12);  // 0.5s @120fps
  ok(Math.abs(a.flyLean - b.flyLean) < 1e-6, `30fps/120fps 前倾强度一致（相差 ${Math.abs(a.flyLean - b.flyLean).toExponential(2)}）`);
  ok(a.flyLean > 0.93 && a.flyLean < 0.97, `0.5s 到位约 95%（${a.flyLean.toFixed(4)}）`);
}

// ── ⑤ 地面切飞行：模式切换本身也不跳变 / 复位 ──────────────────────────
{
  const anim = new HumanoidAnimator();
  let walked = null;
  for (let i = 0; i < 72; i++) walked = anim.update(DT, { speed: 4.3, vy: 0, onGround: true });
  const before = walked.bodyPitch;
  const switched = anim.update(DT, flyCtx(12));
  ok(Math.abs(switched.bodyPitch - before) < 0.08,
    `地面走→起飞第一帧前倾变化 ${Math.abs(switched.bodyPitch - before).toFixed(3)}rad（< 0.08）`);

  anim.reset();
  ok(anim.flyLean === 0 && anim.pose.bodyPitch === 0, 'reset 清空前倾强度与姿态（重开存档不继承）');

  // 非飞行状态速度再大也不吃飞行前倾
  const g = new HumanoidAnimator();
  let gp = null;
  for (let i = 0; i < 60; i++) gp = g.update(DT, { speed: 12, vy: 0, onGround: true });
  ok(gp.bodyPitch < BASE, `地面高速（12m/s）不走飞行前倾（${gp.bodyPitch.toFixed(3)} < ${BASE}）`);
}

// ── ⑥ 绊线 ─────────────────────────────────────────────────────────────
{
  const s = src('../src/entity/anim/HumanoidAnimator.js');
  ok(s.includes('this._flyLean = damp('), '绊线：飞行前倾强度走 damp 指数趋近');
  ok(!s.includes('p.bodyPitch += 0.10 * f + clamp('), '绊线：旧的"速度直映前倾"表达式已移除');
  ok(s.includes('p.bodyPitch += (0.10 + FLY_LEAN_MAX * this._flyLean) * f;'), '绊线：前倾角改由阻尼强度驱动');
  ok(s.includes('get flyLean()'), '绊线：暴露 flyLean 供回归/调试读取');
  ok(s.includes('FLY_LEAN_RATE') && s.includes('FLY_LEAN_MAX'), '绊线：前倾参数集中成模块顶部常量');
}

finish('build47-fly-lean');
