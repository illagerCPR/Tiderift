// build44-anim-humanoid.mjs -- Build 44 第一轮（玩家动作）人类动作器回归（纯 node，不依赖服务器）
// 断言：
//   ① 相位按位移积分（不是时间）：1 秒 3 m/s 走出的相位 = 3 * STRIDE_RATE，且速度越快相位越快；
//   ② 停步平滑：从全速直接归零时，每帧关节变化有界（旧实现单帧从 ~0.9 跳到 0），0.5s 内衰减干净；
//   ③ 状态权重：腾空/游泳/飞行权重收敛，身体前倾/外展方向符合"前方 = -Z、正 rotation.x = 向前摆"的约定；
//   ④ 落地包络：腾空落地后 bodyY 下蹲再恢复；
//   ⑤ 冲刺幅度/前倾大于走路；挖掘挥臂叠加层会摆动；
//   ⑥ 姿态落点：applyHumanoidPose 的左右外展与头部俯仰、applyBodyOffset 的前倾/侧倾符号；
//   ⑦ 确定性 + 数值健康（无 NaN、dt 钳制）。
import { readFileSync } from 'fs';
import {
  HumanoidAnimator, damp, STRIDE_RATE, LAND_DURATION,
  applyHumanoidPose, applyBodyOffset,
} from '../src/entity/anim/HumanoidAnimator.js';
import { ok, finish } from './harness.mjs';

const DT = 1 / 60;
const TAU = Math.PI * 2;

// 推进 n 帧，返回每帧姿态快照（pose 是复用对象，按字段浅拷贝）
function run(anim, frames, ctx) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    anim.update(DT, ctx);
    out.push({ ...anim.pose });
  }
  return out;
}

function maxAbs(list, key) {
  let m = 0;
  for (const p of list) m = Math.max(m, Math.abs(p[key]));
  return m;
}

// ── ① 相位 = 位移积分 ────────────────────────────────────────────────────
{
  const a = new HumanoidAnimator();
  run(a, 60, { speed: 3, vy: 0, onGround: true });
  ok(Math.abs(a.moved - 3) < 1e-6, '相位积分：1 秒 3 m/s 的累计位移 = 3m');
  ok(Math.abs(a.phase - (3 * STRIDE_RATE) % TAU) < 1e-6, '相位积分：相位 = 位移 × STRIDE_RATE（取模后一致）');
  ok(a.phase >= 0 && a.phase < TAU, '相位积分：相位恒在 [0, 2π)');

  const slow = new HumanoidAnimator();
  const fast = new HumanoidAnimator();
  run(slow, 60, { speed: 2, onGround: true });
  run(fast, 60, { speed: 5, onGround: true });
  ok(Math.abs(fast.moved - 5) < 1e-6 && Math.abs(slow.moved - 2) < 1e-6, '相位积分：累计位移与速度成正比');
}

// ── ② 停步平滑（旧实现的反例：单帧阶跃） ─────────────────────────────────
{
  const a = new HumanoidAnimator();
  run(a, 36, { speed: 4, onGround: true });       // 0.6s 全速
  const movingFrames = run(a, 1, { speed: 4, onGround: true });
  const before = movingFrames[0].legL;
  const stopFrames = run(a, 60, { speed: 0, onGround: true });
  let maxJump = Math.abs(stopFrames[0].legL - before);
  for (let i = 1; i < stopFrames.length; i++) {
    maxJump = Math.max(maxJump, Math.abs(stopFrames[i].legL - stopFrames[i - 1].legL));
  }
  ok(maxJump < 0.3, '停步：每帧关节变化有界（无阶跃），实测最大 ' + maxJump.toFixed(3));
  ok(Math.abs(stopFrames[stopFrames.length - 1].legL) < 0.02, '停步：0.5 秒内摆腿幅度衰减到静止');
  ok(a.walkWeight < 0.01, '停步：步行权重收敛到 0');
}

// ── ③ 腾空 / 下落 / 游泳 / 飞行 ─────────────────────────────────────────
{
  const jump = new HumanoidAnimator();
  run(jump, 24, { speed: 0, vy: 6, onGround: false });
  ok(jump.airWeight > 0.9, '起跳：腾空权重收敛（实测 ' + jump.airWeight.toFixed(2) + '）');
  ok(jump.pose.armSpread > 0.3, '起跳：手臂外展');
  ok(jump.pose.bodyPitch >= 0, '起跳：身体不后仰（前倾角非负）');

  const fall = new HumanoidAnimator();
  run(fall, 24, { speed: 0, vy: -8, onGround: false });
  ok(fall.pose.armL > 0.08 && fall.pose.armR > 0.08, '下落：双臂略前伸（rotation.x 正 = 向前）');
  ok(fall.pose.armSpread > 0.3, '下落：手臂保持外展');

  const swim = new HumanoidAnimator();
  let swapped = false;
  let lastSign = 0;
  for (let i = 0; i < 90; i++) {
    swim.update(DT, { speed: 2, vy: 0, onGround: false, inWater: true });
    const sign = Math.sign(swim.pose.armL);
    if (lastSign !== 0 && sign !== 0 && sign !== lastSign) swapped = true;
    lastSign = sign;
  }
  ok(swim.swimWeight > 0.9, '游泳：权重收敛');
  ok(swim.pose.bodyPitch > 0.7 && swim.pose.bodyPitch <= 1.0, '游泳：身体前倾在合理区间');
  ok(swapped, '游泳：双臂交替划水（舵相会换向）');

  const fly = new HumanoidAnimator();
  run(fly, 30, { speed: 3, vy: 0, onGround: false, flying: true });
  ok(fly.flyWeight > 0.9, '飞行：权重收敛');
  ok(fly.pose.bodyPitch > 0.1, '飞行：身体随速度前倾');
  ok(fly.pose.legL < 0 && fly.pose.legR < 0, '飞行：双腿向后收');

  // 只有"腾空且未游泳/飞行"才走 air 权重（互斥关系是硬约束）
  const mixed = new HumanoidAnimator();
  run(mixed, 30, { speed: 2, onGround: false, inWater: true, flying: true });
  ok(mixed.airWeight < 0.01, '状态互斥：飞行/游泳时不叠加腾空权重');
}

// ── ④ 落地包络 ─────────────────────────────────────────────────────────
{
  const a = new HumanoidAnimator();
  run(a, 18, { speed: 0, vy: -9, onGround: false });   // 下落 0.3s
  ok(Math.abs(a.landing) < 1e-9, '落地：着地前无缓冲包络');
  const frames = run(a, 18, { speed: 0, vy: 0, onGround: true });
  let minBodyY = 0;
  for (const p of frames) minBodyY = Math.min(minBodyY, p.bodyY);
  ok(minBodyY < -0.04, '落地：着地后 bodyY 下蹲（实测 ' + minBodyY.toFixed(3) + '）');
  ok(frames[frames.length - 1].bodyY > -0.02, '落地：缓冲在 0.3 秒内基本恢复');
  ok(LAND_DURATION > 0.15 && LAND_DURATION < 0.4, '落地：缓冲时长在合理区间');
}

// ── ⑤ 冲刺 vs 走路；挖掘叠加 ────────────────────────────────────────────
{
  const walk = new HumanoidAnimator();
  const sprint = new HumanoidAnimator();
  const walkFrames = run(walk, 90, { speed: 4.3, onGround: true });
  const sprintFrames = run(sprint, 90, { speed: 4.3, onGround: true, sprinting: true });
  ok(sprint.sprintWeight > 0.9, '冲刺：权重收敛');
  ok(maxAbs(sprintFrames, 'legL') > maxAbs(walkFrames, 'legL') + 0.15, '冲刺：摆腿幅度大于走路');
  ok(sprint.pose.bodyPitch > walk.pose.bodyPitch + 0.08, '冲刺：前倾大于走路');

  const mine = new HumanoidAnimator();
  run(mine, 30, { speed: 0, onGround: true, mine: true });
  ok(mine.mineAmp > 0.9, '挖掘：挥臂权重收敛');
  const mineFrames = run(mine, 20, { speed: 0, onGround: true, mine: true });
  const lo = Math.min(...mineFrames.map((p) => p.armR));
  const hi = Math.max(...mineFrames.map((p) => p.armR));
  ok(hi - lo > 0.5, '挖掘：右臂在叠加层里摆动（实测幅度 ' + (hi - lo).toFixed(2) + '）');

  const still = new HumanoidAnimator();
  run(still, 30, { speed: 0, onGround: true, mine: false });
  ok(still.mineAmp < 0.01, '挖掘：未挖掘时不挥臂');
}

// ── ⑥ 姿态落点与符号约定 ───────────────────────────────────────────────
{
  const mkRotation = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
  const mkJoint = () => ({ pivot: { rotation: mkRotation() } });
  const joints = { head: mkJoint(), armL: mkJoint(), armR: mkJoint(), legL: mkJoint(), legR: mkJoint() };
  const pose = {
    armL: 0.3, armR: -0.2, armSpread: 0.4, legL: 0.1, legR: -0.1,
    headExtra: 0.05, bodyPitch: 0.2, bodyRoll: 0.1, bodyY: -0.03,
  };
  applyHumanoidPose(joints, pose, 0.7);
  ok(Math.abs(joints.head.pivot.rotation.x - 0.75) < 1e-9, '姿态：头部 = 视角俯仰 + 附加偏移');
  ok(joints.armL.pivot.rotation.z === -0.4, '姿态：左臂外展取负 z');
  ok(joints.armR.pivot.rotation.z === 0.4, '姿态：右臂外展取正 z');
  ok(joints.armR.pivot.rotation.x === -0.2, '姿态：手臂 rotation.x 原样落位');
  ok(joints.legL.pivot.rotation.x === 0.1 && joints.legR.pivot.rotation.x === -0.1, '姿态：双腿 rotation.x 原样落位');

  const bodyRoot = { position: { y: 0 }, rotation: { x: 0, z: 0 } };
  applyBodyOffset(bodyRoot, pose);
  ok(bodyRoot.position.y === -0.03, '躯干：bodyY 落到 position.y');
  ok(Math.abs(bodyRoot.rotation.x + 0.2) < 1e-9, '躯干：bodyPitch（正=前倾）落到 -rotation.x');
  ok(Math.abs(bodyRoot.rotation.z + 0.1) < 1e-9, '躯干：bodyRoll（正=右倾）落到 -rotation.z');
}

// ── ⑦ 确定性 + 数值健康 ─────────────────────────────────────────────────
{
  const a = new HumanoidAnimator();
  const b = new HumanoidAnimator();
  const ctx = { speed: 2.5, vy: 1, onGround: true, mine: true };
  run(a, 40, ctx);
  run(b, 40, ctx);
  let same = true;
  for (const k of Object.keys(a.pose)) if (a.pose[k] !== b.pose[k]) same = false;
  ok(same, '确定性：相同输入序列产出完全相同的姿态');

  // 随机状态扫描：任何组合都不产 NaN/Infinity
  const rand = (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); })();
  const sweep = new HumanoidAnimator();
  let bad = null;
  for (let i = 0; i < 300; i++) {
    sweep.update(rand() * 0.2, {
      speed: rand() * 6, vy: (rand() - 0.5) * 20,
      sprinting: rand() < 0.5, onGround: rand() < 0.7,
      inWater: rand() < 0.2, flying: rand() < 0.15, mine: rand() < 0.4,
    });
    for (const k of Object.keys(sweep.pose)) {
      if (!Number.isFinite(sweep.pose[k])) bad = k;
    }
  }
  ok(!bad, '数值健康：随机状态序列无 NaN/Infinity' + (bad ? '（' + bad + '）' : ''));

  // dt 钳制：超大 dt 不应把权重推过 1
  const clampAnim = new HumanoidAnimator();
  clampAnim.update(5, { speed: 4, onGround: true });
  ok(clampAnim.walkWeight <= 1 && clampAnim.walkWeight > 0, 'dt 钳制：超大帧间隔权重不越界');
  ok(Number.isFinite(clampAnim.pose.legL), 'dt 钳制：姿态仍为有限值');
  ok(Math.abs(damp(0, 1, 12, 0.1) - 0.6988) < 1e-3, 'damp 辅助函数：指数趋近公式稳定');
}

// ── 接线绊线（防止重构把两个模型又改回各自的正弦实现） ────────────────────
{
  const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
  const remote = src('../src/entity/RemotePlayer.js');
  const local = src('../src/entity/LocalPlayerModel.js');
  ok(remote.includes('new HumanoidAnimator()') && remote.includes('applyBodyOffset(this.bodyRoot, pose)'),
    '接线：RemotePlayer 走共享动作器 + bodyRoot');
  ok(local.includes('new HumanoidAnimator()') && local.includes('applyBodyOffset(this.bodyRoot, pose)'),
    '接线：LocalPlayerModel 走共享动作器 + bodyRoot');
  ok(!remote.includes('_walkPhase') && !local.includes('_walkPhase'),
    '绊线：两份正弦摆腿旧实现已删除（不得回退）');
  ok(remote.includes('sprint: !!s.sprint'), '接线：远端从 player_state 读 sprint 标志');
}

finish('build44-anim-humanoid');
