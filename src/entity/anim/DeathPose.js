// DeathPose.js -- 实体死亡躺倒姿态（B47，类原版）
// 纯数学模块：不 import three、不碰 DOM，node 可直接单测（tests/build47-mob-death.mjs）。
//
// 原版口径（防回退，勿改回"缩小 + 自旋 + 淡出"）：
//   原版 LivingEntityRenderer.setupRotations 在实体本地空间（已偏航）绕 Z 轴侧倒：
//     f = sqrt(min(1, (deathTime - 1) / 20 * 1.6))，roll = f * 90°
//   deathTime 到 20 tick（= 1s）整只移除。也就是：约 0.68s 加速倒向一侧并躺平（sqrt 缓动，
//   倒下时角速度快、触地前变慢），尸体保持不透明、不缩放，到点直接消失（掉落物同一帧弹出）。
//   本模块只产出"秒 → 弧度"，落到 bodyRoot.rotation.z 由 MobManager 完成。

export const DEATH_ANIM_DURATION = 1.0; // 总时长（秒）= 原版 20 tick
export const DEATH_TICKS = 20;          // 原版死亡计时单位
export const DEATH_FLASH_TIME = 0.5;    // 受击红光在尸体上的衰减时长（原版 hurtTime 10 tick）

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 亡故经过 elapsed 秒后的侧倒角（弧度，0..π/2）。
// total 是本体死亡动画总时长（默认 1s）；非法输入按"刚死"处理，绝不让 NaN 漏进渲染。
export function deathTilt(elapsed, total = DEATH_ANIM_DURATION) {
  const dur = Number.isFinite(total) && total > 0 ? total : DEATH_ANIM_DURATION;
  // NaN/负时长按"刚死"处理；+Infinity 视为"早已死透"→ 直接躺平
  const e = Number.isFinite(elapsed) ? Math.max(0, elapsed) : (elapsed === Infinity ? Infinity : 0);
  const ticks = (e / dur) * DEATH_TICKS;
  const raw = ((ticks - 1) / DEATH_TICKS) * 1.6;
  const f = clamp(Math.sqrt(Math.max(0, raw)), 0, 1);
  return (f * Math.PI) / 2;
}

// 死亡动画单帧推进（就地修改 anim = {progress, total}）→ { t, tilt, flash }
//   t     : 归一化进度 0..1（到 1 表示该移除）
//   tilt  : 侧倒角（弧度）
//   flash : 受击红光强度 0..1（前 DEATH_FLASH_TIME 内衰减）
export function stepDeathAnim(anim, dt) {
  if (!anim || typeof anim !== 'object') return { t: 1, tilt: Math.PI / 2, flash: 0 };
  const total = Number.isFinite(anim.total) && anim.total > 0 ? anim.total : DEATH_ANIM_DURATION;
  const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  anim.total = total;
  anim.progress = Math.max(0, (Number.isFinite(anim.progress) ? anim.progress : 0) + step);
  const t = clamp(anim.progress / total, 0, 1);
  return {
    t,
    tilt: deathTilt(anim.progress, total),
    flash: clamp(1 - (t * total) / DEATH_FLASH_TIME, 0, 1),
  };
}

// 新建死亡动画状态（MobManager 触发死亡时调用；total 可省略走默认 1s）
export function makeDeathAnim(total = DEATH_ANIM_DURATION) {
  const dur = Number.isFinite(total) && total > 0 ? total : DEATH_ANIM_DURATION;
  return { progress: 0, total: dur };
}
