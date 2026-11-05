// build45-mob-turn.mjs -- Build 45 怪物转身平滑回归（纯 node，不依赖服务器）
// 断言：
//   ① 角度工具：归一化范围、跨 ±π 接缝走短边、零角差；
//   ② turnToward：单步限速、进入步长即落位（不过冲不抖）、零/负步长不动、NaN 安全、确定性；
//   ③ 行为：2.6 rad/s 的 180° 转身 ≈ π/rate ≈ 1.2s，全程单调收敛、单帧步长不超预算；
//   ④ 接线绊线：Mob 持 displayYaw/turnRate，MobManager 用 turnToward 追 yaw 并渲染 displayYaw，
//      Boss AI 仍只写 mob.yaw（期望朝向语义不变）。
import { readFileSync } from 'fs';
import { wrapAngle, angleDelta, turnToward, TAU } from '../src/entity/anim/YawTurn.js';
import { ok, finish } from './harness.mjs';

const DT = 1 / 60;
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── ① 角度工具 ─────────────────────────────────────────────────────────
{
  ok(wrapAngle(0) === 0, 'wrapAngle：0 不动');
  ok(near(wrapAngle(TAU + 0.3), 0.3), 'wrapAngle：2π+0.3 → 0.3');
  ok(near(wrapAngle(-TAU - 0.3), -0.3), 'wrapAngle：-2π-0.3 → -0.3');

  let inRange = true;
  for (let v = -20; v <= 20; v += 0.37) {
    const w = wrapAngle(v);
    if (!(w >= -Math.PI - 1e-12 && w < Math.PI + 1e-12)) inRange = false;
  }
  ok(inRange, 'wrapAngle：任意输入都落在 [-π, π)');

  ok(near(angleDelta(1.0, 1.0), 0), 'angleDelta：同向为 0');
  ok(near(angleDelta(3.0, -3.0), TAU - 6), 'angleDelta：跨 ±π 接缝取短边（+0.283rad 而非 -5.999rad）');
  ok(near(angleDelta(-3.0, 3.0), -(TAU - 6)), 'angleDelta：反方向也是短边（对称）');
}

// ── ② turnToward 单步语义 ──────────────────────────────────────────────
{
  ok(near(turnToward(0, 1.0, 0.1), 0.1), 'turnToward：单步不超过 maxStep');
  ok(near(turnToward(0.95, 1.0, 0.1), 1.0), 'turnToward：进入步长内直接落位（不过冲）');
  ok(turnToward(0, 1, 0) === 0, 'turnToward：零步长不动');
  ok(turnToward(0, 1, -0.1) === 0, 'turnToward：负步长不动');
  ok(Number.isFinite(turnToward(NaN, 1, 0.1)) && Number.isFinite(turnToward(0, NaN, 0.1)), 'turnToward：NaN 输入仍返回有限值');
  ok(Number.isFinite(turnToward(0, 1, Infinity)) && near(turnToward(0, 1, Infinity), 1), 'turnToward：Infinity 步长直接落位');

  // 跨接缝：3.0 → -3.0 走 +0.283 短边（越过 π 后折回 -3.18）
  const stepped = turnToward(3.0, -3.0, 0.1);
  ok(near(stepped, wrapAngle(3.1)), 'turnToward：跨接缝按最短方向推进（3.0→3.1→-3.183）');
  ok(near(angleDelta(3.0, stepped), 0.1), 'turnToward：跨接缝单步仍是 maxStep');

  const a = [];
  const b = [];
  let ya = 0.2;
  let yb = 0.2;
  for (let i = 0; i < 30; i++) { ya = turnToward(ya, 2.0, 0.07); yb = turnToward(yb, 2.0, 0.07); a.push(ya); b.push(yb); }
  ok(a.every((v, i) => v === b[i]), 'turnToward：确定性（同输入同序列）');
}

// ── ③ 行为：180° 缓缓转身 ──────────────────────────────────────────────
{
  const RATE = 2.6;
  const budget = RATE * DT;
  let yaw = 0;
  let t = 0;
  let frames = 0;
  let maxStep = 0;
  let monotonic = true;
  let prev = Math.abs(angleDelta(yaw, Math.PI));
  while (frames < 600) {
    const next = turnToward(yaw, Math.PI, budget);
    const step = Math.abs(angleDelta(yaw, next));
    if (step > maxStep) maxStep = step;
    const remain = Math.abs(angleDelta(next, Math.PI));
    if (remain > prev + 1e-12) monotonic = false;
    prev = remain;
    yaw = next;
    t += DT;
    frames++;
    if (remain < 1e-9) break;
  }
  ok(monotonic, '行为：整个转身过程单调收敛（无来回抖）');
  ok(maxStep <= budget + 1e-12, '行为：单帧步长不超过 turnRate*dt');
  ok(t > 1.05 && t < 1.30, `行为：2.6rad/s 转 180° 用时 ${t.toFixed(2)}s（≈π/rate=1.21s）`);
  ok(Math.abs(angleDelta(yaw, Math.PI)) < 1e-9, '行为：最终精确落在期望朝向');

  // 瞬转反例：同一帧直接跳到目标（旧实现）会让单帧步长 = π —— 新的单帧步长必须远小于它
  ok(maxStep < Math.PI / 10, '行为：单帧转角远小于 π（旧实现是整帧瞬转）');
}

// ── ④ 接线绊线 ─────────────────────────────────────────────────────────
{
  const mob = src('../src/entity/Mob.js');
  const mm = src('../src/entity/MobManager.js');
  ok(mob.includes('this.displayYaw = 0'), '接线：Mob 初始化渲染朝向 displayYaw');
  ok(mob.includes('this.turnRate = MOB_TURN_RATE[typeName]'), '接线：逐类型转身角速度（Boss 表 + 被动/敌对默认）');
  ok(mob.includes('PASSIVE_TURN_RATE = 2.6') && mob.includes('HOSTILE_TURN_RATE = 4.0'), '接线：被动 2.6 / 敌对 4.0 rad/s 常量在位');
  ok(mm.includes('mob.displayYaw = turnToward(mob.displayYaw, mob.yaw, mob.turnRate * dt)'), '接线：MobManager 每帧按 turnRate 追 AI 期望朝向');
  ok(mm.includes('mesh.rotation.y = mob.displayYaw'), '接线：渲染用 displayYaw');
  ok(!mm.includes('mesh.rotation.y = mob.yaw'), '绊线：渲染不再直接吃 AI 的 yaw（防瞬转回退）');
  ok(mm.includes('Math.atan2(dx, dz) - mob.displayYaw'), '接线：头部追视相对渲染朝向计算（转身时头先到、身子后到）');
  ok(src('../src/entity/DragonAI.js').includes('mob.yaw = ') &&
     src('../src/entity/WitherAI.js').includes('mob.yaw = ') &&
     src('../src/entity/StormColossusAI.js').includes('mob.yaw = '),
    '绊线：Boss AI 仍只写 mob.yaw（期望朝向语义不变）');
  ok(mob.includes('this.yaw = Math.atan2(nx, nz)'), '绊线：chase 仍写期望朝向（AI 逻辑未改）');
}

finish('build45-mob-turn');
