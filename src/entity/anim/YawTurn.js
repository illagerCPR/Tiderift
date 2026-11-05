// YawTurn.js -- 朝向平滑（B45，纯数学，node 可测）
// 约定：AI 只写「期望朝向」，渲染朝向以有限角速度追上去——玩家靠近、绕圈、
// 换目标时整只怪不再瞬间转身。纯视觉层：不影响移动方向、攻击判定与联机（怪物朝向本就不同步）。

export const TAU = Math.PI * 2;

// 归一到 [-π, π)
export function wrapAngle(a) {
  const v = Number(a);
  if (!Number.isFinite(v)) return 0;
  let x = (v + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

// 从 from 转到 to 的最短角差，落在 [-π, π)（跨 ±π 接缝时走短边）
export function angleDelta(from, to) {
  return wrapAngle(to - from);
}

// 以每步最多 maxStep 弧度从 current 追向 target；进入步长内直接落在 target（不抖、不过冲）。
// maxStep 非有限值（Infinity）= 不限速；负数/NaN 视为不动（防御性调用）。
export function turnToward(current, target, maxStep) {
  const cur = wrapAngle(current);
  const tgt = wrapAngle(target);
  const step = Number(maxStep);
  if (Number.isNaN(step) || step < 0) return cur;
  if (!Number.isFinite(step)) return tgt;
  const d = angleDelta(cur, tgt);
  if (Math.abs(d) <= step) return tgt;
  return wrapAngle(cur + Math.sign(d) * step);
}
