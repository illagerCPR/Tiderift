// build44-anim-fp-hand.mjs -- Build 44 第一轮（玩家动作）第一人称手部姿态回归（纯 node，不依赖服务器）
// 断言：
//   ① 静止：位移贴基准位、无挥动；
//   ② 走路 bob、挥动包络、按住左键连续挥动（周期随 miningPeriod）；
//   ③ 换手抬起：从画面下沿抬回位并收尾（easeOut），不会瞬间弹回；
//   ④ 跳跃/下落：手随竖直速度反向位移；落地缓冲下蹲；
//   ⑤ 游泳：手压低 + 姿态前压；冲刺：轻微侧倾；
//   ⑥ 拉弓蓄力：手向中心回拉抬升；关闭 bob 时静止位移为 0；
//   ⑦ 确定性 + 数值健康；接线绊线（FirstPersonHand 用 HandPose、Game 传新 ctx）。
import { readFileSync } from 'fs';
import { HandPose, HAND_BASE, HAND_BASE_ROT } from '../src/render/fpHandPose.js';
import { ok, finish } from './harness.mjs';

const DT = 1 / 60;

function run(pose, frames, ctx) {
  const out = [];
  for (let i = 0; i < frames; i++) out.push(pose.update(DT, ctx));
  return out;
}

const idleCtx = { moving: false, sprinting: false, onGround: true, inWater: false, flying: false, vy: 0, mining: false, bobOn: true, bowDraw: null };

// ── ① 静止 ─────────────────────────────────────────────────────────────
{
  const pose = new HandPose();
  const frames = run(pose, 120, idleCtx);
  const last = frames[frames.length - 1];
  ok(Math.abs(last.x - HAND_BASE.x) < 0.01, '静止：x 贴基准位');
  ok(Math.abs(last.y - HAND_BASE.y) < 0.01, '静止：y 贴基准位');
  ok(Math.abs(last.z - HAND_BASE.z) < 1e-9, '静止：z 不受 bob 影响');
  ok(pose.swingT >= 1, '静止：无进行中的挥动');
  ok(pose.equipT >= 1, '静止：换手动画已就位');
}

// ── ② 走路 bob / 挥动 / 连续挖掘 ────────────────────────────────────────
{
  const pose = new HandPose();
  const frames = run(pose, 90, { ...idleCtx, moving: true });
  const xs = frames.map((f) => f.x);
  ok(Math.max(...xs) - Math.min(...xs) > 0.02, '走路：bob 横向摆幅可见');

  const swingPose = new HandPose();
  swingPose.swing();
  const swingFrames = run(swingPose, 40, idleCtx);
  const minY = Math.min(...swingFrames.map((f) => f.y));
  ok(minY < HAND_BASE.y - 0.05, '挥动：手向下压（实测最低 ' + minY.toFixed(3) + '）');
  ok(swingPose.swingT >= 1, '挥动：包络播完后复位');
  const after = run(swingPose, 30, idleCtx);
  ok(Math.abs(after[after.length - 1].y - HAND_BASE.y) < 0.01, '挥动：结束后回到基准位');

  const minePose = new HandPose();
  minePose.miningPeriod = 0.25;
  let dips = 0;
  let prevBelow = false;
  for (let i = 0; i < 90; i++) {
    const st = minePose.update(DT, { ...idleCtx, mining: true });
    const below = st.y < HAND_BASE.y - 0.03;
    if (below && !prevBelow) dips++;
    prevBelow = below;
  }
  ok(dips >= 2, '连续挖掘：按住左键自动反复挥动（1.5s 内 ' + dips + ' 次下压）');
  ok(Math.abs(minePose.miningPeriod - 0.25) < 1e-9, '连续挖掘：周期沿用外部写入值');

  const hard = new HandPose();
  hard.miningPeriod = 1.0;
  const hardFrames = run(hard, 20, { ...idleCtx, mining: true });
  ok(Math.min(...hardFrames.map((f) => f.rx)) < HAND_BASE_ROT.x, '连续挖掘：长周期（硬块）也推进挥动');
}

// ── ③ 换手抬起 ─────────────────────────────────────────────────────────
{
  const pose = new HandPose();
  pose.equip();
  const first = pose.update(DT, idleCtx);
  ok(first.y < HAND_BASE.y - 0.2, '换手：起始帧从画面下沿起抬');
  const frames = run(pose, 30, idleCtx);
  ok(Math.abs(frames[frames.length - 1].y - HAND_BASE.y) < 0.02, '换手：0.5 秒内回到基准位');
  ok(pose.equipT >= 1, '换手：进度收尾');
}

// ── ④ 跳跃 / 下落 / 落地 ───────────────────────────────────────────────
{
  const rising = new HandPose();
  const up = rising.update(DT, { ...idleCtx, onGround: false, vy: 6 });
  ok(up.y < HAND_BASE.y, '起跳：手随上升下沉');
  ok(up.rx < HAND_BASE_ROT.x, '起跳：手略微压下');

  const falling = new HandPose();
  const down = falling.update(DT, { ...idleCtx, onGround: false, vy: -6 });
  ok(down.y > HAND_BASE.y, '下落：手上抬');

  const land = new HandPose();
  run(land, 12, { ...idleCtx, onGround: false, vy: -7 });
  const landFrames = run(land, 12, { ...idleCtx, onGround: true, vy: 0 });
  const minY = Math.min(...landFrames.map((f) => f.y));
  ok(minY < HAND_BASE.y - 0.03, '落地：缓冲下蹲（实测 ' + minY.toFixed(3) + '）');
  ok(landFrames[landFrames.length - 1].y > minY + 0.01, '落地：缓冲随后回升');
}

// ── ⑤ 游泳 / 冲刺 ─────────────────────────────────────────────────────
{
  const swim = new HandPose();
  let st = null;
  for (let i = 0; i < 40; i++) st = swim.update(DT, { ...idleCtx, inWater: true, onGround: false });
  ok(st.y < HAND_BASE.y - 0.02, '游泳：手压低');
  ok(st.rx < HAND_BASE_ROT.x - 0.15, '游泳：姿态前压');

  const sprint = new HandPose();
  let sprintSt = null;
  for (let i = 0; i < 40; i++) sprintSt = sprint.update(DT, { ...idleCtx, moving: true, sprinting: true });
  ok(sprintSt.rz > HAND_BASE_ROT.z + 0.02, '冲刺：轻微侧倾');
}

// ── ⑥ 拉弓蓄力 / 关闭 bob ──────────────────────────────────────────────
{
  const bow = new HandPose();
  const st = bow.update(DT, { ...idleCtx, bowDraw: 1 });
  ok(st.y > HAND_BASE.y + 0.02, '拉弓：手持物抬升');
  ok(st.x < HAND_BASE.x - 0.1, '拉弓：向中心回拉');
  ok(st.z > HAND_BASE.z + 0.1, '拉弓：向前伸出');

  const noBob = new HandPose();
  const frames = run(noBob, 30, { ...idleCtx, moving: true, bobOn: false });
  const lastX = frames[frames.length - 1].x;
  ok(Math.abs(lastX - HAND_BASE.x) < 1e-9, '关闭 bob：静止位移归零');
}

// ── ⑦ 确定性 + 数值健康 ───────────────────────────────────────────────
{
  const a = new HandPose();
  const b = new HandPose();
  const ctx = { ...idleCtx, moving: true, mining: true, vy: 2 };
  const fa = run(a, 40, ctx);
  const fb = run(b, 40, ctx);
  ok(fa.every((f, i) => f.x === fb[i].x && f.y === fb[i].y && f.rx === fb[i].rx), '确定性：相同输入序列姿态一致');

  const rand = (() => { let s = 999; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); })();
  const sweep = new HandPose();
  let bad = null;
  for (let i = 0; i < 300; i++) {
    const st = sweep.update(rand() * 0.2, {
      moving: rand() < 0.6, sprinting: rand() < 0.4, onGround: rand() < 0.7,
      inWater: rand() < 0.2, flying: rand() < 0.1, vy: (rand() - 0.5) * 20,
      mining: rand() < 0.3, bobOn: rand() < 0.8, bowDraw: rand() < 0.3 ? rand() : null,
    });
    for (const k of Object.keys(st)) if (!Number.isFinite(st[k])) bad = k;
  }
  ok(!bad, '数值健康：随机状态序列无 NaN/Infinity' + (bad ? '（' + bad + '）' : ''));

  const clampPose = new HandPose();
  const st = clampPose.update(5, { ...idleCtx, moving: true });
  ok([st.x, st.y, st.z, st.rx, st.ry, st.rz].every(Number.isFinite), 'dt 钳制：超大帧间隔仍为有限值');
}

// ── 接线绊线 ───────────────────────────────────────────────────────────
{
  const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
  const hand = src('../src/render/FirstPersonHand.js');
  const game = src('../src/player/Game.js');
  const net = src('../src/net/NetworkManager.js');
  const room = src('../server/room.js');
  ok(hand.includes('new HandPose()') && hand.includes('this.pose.equip()'), '接线：FirstPersonHand 使用 HandPose 并在换手时触发抬起');
  ok(hand.includes('get miningPeriod()') && hand.includes('set miningPeriod('), '接线：miningPeriod 仍可被外部写入（访问器转发）');
  ok(game.includes('this.hand.update(dt, {') && game.includes('sprinting: this.controls.isSprinting()'), '接线：Game 以新 ctx 驱动第一人称手');
  ok(net.includes('sprint: this.game.controls && this.game.controls.isSprinting() ? 1 : 0'), '接线：客户端上送 sprint 标志');
  ok(room.includes('player.sprint = !!msg.sprint') && room.includes('sprint: player.sprint ? 1 : 0'), '接线：服务端清洗并透传 sprint');
}

finish('build44-anim-fp-hand');
