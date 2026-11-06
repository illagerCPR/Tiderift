// build47-mob-death.mjs -- Build 47 类原版死亡动画回归（纯 node，不依赖服务器）
// 断言：
//   ① 角度曲线：deathTilt 复刻原版 LivingEntityRenderer 的 sqrt 缓动（0 → 90°，约 0.68s 到位后钳住），
//     并带一份独立 oracle（按 tick 公式重算）逐点比对；NaN/负数/超时长度都不得漏进渲染；
//   ② 单帧推进：stepDeathAnim 的 t 单调、不倒退、到 1 才结束；受击红光前 0.5s 衰减到 0；
//   ③ 姿态语义：90° 侧倒是绕"本地前后轴"转（bodyRoot.rotation.z），身体点落到地面 y≈0 → 真的躺平；
//   ④ 接线绊线：MobManager 用 stepDeathAnim/makeDeathAnim，旧的"缩放 + 自旋 + 淡出"三件套已退场。
import { readFileSync } from 'fs';
import {
  deathTilt, stepDeathAnim, makeDeathAnim,
  DEATH_ANIM_DURATION, DEATH_TICKS, DEATH_FLASH_TIME,
} from '../src/entity/anim/DeathPose.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const HALF_PI = Math.PI / 2;

// 独立 oracle：原版按 tick 计（f = sqrt(min(1,(deathTime-1)/20*1.6))，roll = f*90°）
function oracle(tick, totalTicks = DEATH_TICKS) {
  const f = Math.min(1, Math.sqrt(Math.max(0, ((tick - 1) / totalTicks) * 1.6)));
  return (f * Math.PI) / 2;
}

// ── ① 角度曲线 ─────────────────────────────────────────────────────────
{
  ok(DEATH_ANIM_DURATION === 1.0, `总时长 = 1s（原版 20 tick，当前 ${DEATH_ANIM_DURATION}）`);
  ok(DEATH_TICKS === 20, `计时单位 20 tick（当前 ${DEATH_TICKS}）`);

  ok(deathTilt(0) === 0, 't=0 不倒（站立）');
  ok(deathTilt(-3) === 0 && deathTilt(NaN) === 0, '负时长 / NaN 按"刚死"处理（不倒转、不漏 NaN）');
  ok(Number.isFinite(deathTilt(Infinity)) && near(deathTilt(Infinity), HALF_PI), 'Infinity 直接钳到 90°（不返回 NaN）');

  // 逐 tick 与 oracle 比对（覆盖起步 / 中段 / 钳位段）
  let worst = 0;
  for (const tick of [0, 1, 2, 3, 6, 9, 12, 13, 14, 17, 20]) {
    const got = deathTilt(tick / DEATH_TICKS);
    const want = oracle(tick);
    worst = Math.max(worst, Math.abs(got - want));
  }
  ok(worst < 1e-12, `逐 tick 与 oracle 一致（最大偏差 ${worst.toExponential(2)}）`);

  // 原版在 deathTime=13.5 tick 触到 90°（= 0.675s），之后钳住
  ok(near(deathTilt(13.5 / DEATH_TICKS), HALF_PI, 1e-12), '13.5 tick（0.675s）恰好走到 90°');
  ok(deathTilt(0.6) < HALF_PI - 0.01, '0.6s 时仍未躺平（倒地有过程）');
  ok(deathTilt(0.675) === HALF_PI && deathTilt(0.9) === HALF_PI && deathTilt(5) === HALF_PI,
    '0.675s 之后钳在 90°（躺平不再继续转）');

  // 单调不减 + 全程在 [0, 90°]
  let mono = true;
  let prev = -1;
  for (let t = 0; t <= 1.2; t += 0.01) {
    const v = deathTilt(t);
    if (v < prev - 1e-12 || v < -1e-12 || v > HALF_PI + 1e-12) mono = false;
    prev = v;
  }
  ok(mono, 'deathTilt 全程单调不减且落在 [0, π/2]');

  // sqrt 缓动＝先快后慢：0.2s 已倒下 0.77rad（远超线性 0.31rad），触地前变慢
  const t02 = deathTilt(0.2);
  ok(t02 > (0.2 * Math.PI) / 2, '缓动是"先快后慢"（0.2s 已过线性中点）');
  const v50 = deathTilt(0.5);
  const v60 = deathTilt(0.6);
  ok(v60 - v50 < v50 - t02, '后段角速度小于前段（触地前减速）');

  ok(near(deathTilt(1, 2), deathTilt(0.5), 1e-12), 'total 参数可缩放（半程语义一致）');
  ok(deathTilt(0.5, 0) === deathTilt(0.5) && deathTilt(0.5, -1) === deathTilt(0.5),
    '非法 total 回落到默认 1s');
}

// ── ② 单帧推进 ─────────────────────────────────────────────────────────
{
  const anim = makeDeathAnim();
  ok(anim && anim.progress === 0 && near(anim.total, DEATH_ANIM_DURATION), 'makeDeathAnim 初值 progress=0 / total=1s');

  let t = 0;
  let prevTilt = 0;
  let mono = true;
  let frames = 0;
  while (t < 1 && frames < 200) {
    const st = stepDeathAnim(anim, 0.02);
    frames++;
    if (st.tilt < prevTilt - 1e-12) mono = false;
    prevTilt = st.tilt;
    t = st.t;
  }
  ok(mono, '每帧 tilt 单调不致倒退');
  ok(frames >= 50 && frames <= 52, `0.02s×N 推进到 t=1 需 50±1 帧（实际 ${frames}）`);
  ok(prevTilt === HALF_PI, '结束帧已完全躺平');
  ok(stepDeathAnim(makeDeathAnim(), 0).flash === 1, '死亡瞬间受击红光满格（dt=0 那一帧）');

  const animFlash = makeDeathAnim();
  const mid = stepDeathAnim(animFlash, DEATH_FLASH_TIME / 2);
  ok(near(mid.flash, 0.5, 1e-9), `半程红光已衰半（${mid.flash.toFixed(3)}）`);
  const gone = stepDeathAnim(animFlash, DEATH_FLASH_TIME / 2 + 1e-6);
  ok(gone.flash === 0, '超过 DEATH_FLASH_TIME 后红光归零');

  const animNeg = makeDeathAnim();
  stepDeathAnim(animNeg, 0.3);
  const before = animNeg.progress;
  stepDeathAnim(animNeg, -5);
  ok(animNeg.progress === before, '负 dt 不倒退进度（钳 0）');
  stepDeathAnim(animNeg, NaN);
  ok(animNeg.progress === before, 'NaN dt 不推进');
  ok(Number.isFinite(stepDeathAnim(null, 0.1).tilt), 'anim 缺失时返回安全值（不抛异常）');
}

// ── ③ 姿态语义：绕本地前后轴 90° = 平躺在地面 ─────────────────────────
{
  // 独立于 three 的 2D 旋转：Rz(a) 作用于 (x,y)（z 轴为本地前后轴）
  const rotZ = (p, a) => ({
    x: p.x * Math.cos(a) - p.y * Math.sin(a),
    y: p.x * Math.sin(a) + p.y * Math.cos(a),
  });
  const tilt = deathTilt(1);
  ok(near(tilt, HALF_PI, 1e-12), '满程 = 90°');

  const body = [
    { name: 'head', p: { x: 0, y: 1.75 } },
    { name: 'waist', p: { x: 0, y: 0.9 } },
    { name: 'foot', p: { x: 0, y: 0 } },
  ];
  let flat = true;
  for (const b of body) {
    const r = rotZ(b.p, tilt);
    if (Math.abs(r.y) > 1e-9 || Math.abs(r.x + b.p.y) > 1e-9) flat = false;
  }
  ok(flat, '90° 侧倒后所有身体点的 y≈0、水平偏移=原高度（以脚为支点躺平）');

  const foot = rotZ({ x: 0, y: 0 }, tilt);
  ok(foot.x === 0 && foot.y === 0, '支点（脚）不动 → 尸体不会穿地/浮空');
}

// ── ④ 接线绊线 ─────────────────────────────────────────────────────────
{
  const mgr = src('../src/entity/MobManager.js');
  ok(mgr.includes("from './anim/DeathPose.js'"), 'MobManager 从 anim/DeathPose.js 取死亡姿态');
  ok(mgr.includes('stepDeathAnim(mob.dyingAnim, dt)'), '每帧走 stepDeathAnim 推进');
  ok(mgr.includes('mob.bodyRoot.rotation.z = st.tilt'), '侧倒角写到 bodyRoot.rotation.z（本地前后轴）');
  ok(mgr.includes('if (st.t >= 1)'), '到 t=1 才移除');
  ok(mgr.includes('makeDeathAnim()'), '死亡时用 makeDeathAnim 建状态');
  ok(!mgr.includes('DEATH_ANIM_DURATION'), '时长常量不再在 MobManager 里另立一份（单一来源）');

  const start = mgr.indexOf('// 死亡动画播放阶段（B47 类原版）');
  const end = mgr.indexOf('// 普通帧', start);
  ok(start > 0 && end > start, '定位死亡动画分支');
  const body = start > 0 && end > start ? mgr.slice(start, end) : '';
  ok(!body.includes('setScalar'), '绊线：旧"整体缩小"已移除（原版尸体不缩小）');
  ok(!/rotation\.y\s*\+=/.test(body), '绊线：旧"原地自旋"已移除（原版只侧倒）');
  ok(!body.includes('opacity'), '绊线：旧"透明渐隐"已移除（原版尸体不透明，到点消失）');
  ok(body.includes('healthBarSprite.visible = false'), '尸体隐藏血条（AI 血条会跟着躺倒，故直接隐藏）');

  ok(src('../src/entity/Mob.js').includes('this.dyingAnim = null'), 'Mob 侧 dyingAnim 字段仍在（AI/拾取门控依赖）');
}

finish('build47-mob-death');
