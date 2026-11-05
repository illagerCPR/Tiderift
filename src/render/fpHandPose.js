// fpHandPose.js -- 第一人称手部姿态解算（B44 第一轮）
// 纯数学模块（不 import three、不碰 DOM），node 可单测（tests/build44-anim-fp-hand.mjs）。
// FirstPersonHand 只负责把这里算出的位移/旋转写到相机子节点上。
//
// 状态：走路 bob / 挖掘与放置挥动 / 拉弓蓄力 / 跳跃与下落 / 落地缓冲 / 游泳 / 换手抬起 / 冲刺。
// 与旧实现相比的核心改动：挥动、换手、落地、水面都走"权重或包络"过渡，没有硬切；
// 跳跃/下落按竖直速度给手臂一个反向位移（起跳下沉、下落上抬）。

import { damp } from '../entity/anim/HumanoidAnimator.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 手部基准位姿（与 FirstPersonHand 原实现同源：右下角、旋转 -0.35）
export const HAND_BASE = { x: 0.42, y: -0.30, z: -0.60 };
export const HAND_BASE_ROT = { x: 0, y: -0.35, z: 0.05 };

const EQUIP_DURATION = 0.18; // 换手抬起时长（秒）
const LAND_DURATION = 0.16;  // 落地缓冲时长（秒）

export class HandPose {
  constructor() {
    this.reset();
  }

  reset() {
    this.bobPhase = 0;
    this.swingT = 1;         // 挥动进度 0..1（1=结束）
    this.miningPeriod = 0.3; // 挖掘挥动周期（秒），由 Game 按方块硬度/工具速度写入
    this.equipT = 1;         // 换手抬起进度（1=已就位）
    this.landT = 0;          // 落地缓冲剩余时间
    this.bowDraw = null;     // 拉弓蓄力 0..1（null=未拉弓，由外部 setBowDraw 写入）
    this._autoSwingCd = 0;
    this._swimPhase = 0;
    this._swim = 0;          // 游泳权重 0..1（平滑过渡）
    this._sprint = 0;        // 冲刺权重 0..1（平滑过渡）
    this._prevOnGround = true;
  }

  // 触发一次挥动（放置/食用/命中等瞬时机点调用；按住左键的连续挖掘由 update 自动驱动）
  swing() {
    if (this.swingT >= 1) this.swingT = 0;
  }

  // 换手抬起（切换快捷栏物品时调用，从画面下沿抬回位）
  equip() {
    this.equipT = 0;
  }

  // ctx: { moving, sprinting, onGround, inWater, flying, vy, mining, bobOn, bowDraw }
  // 返回 { x, y, z, rx, ry, rz }（相机局部空间）
  update(dt, ctx = {}) {
    dt = clamp(Number(dt) || 0, 0, 0.1);
    const moving = !!ctx.moving;
    const sprinting = !!ctx.sprinting && moving;
    const onGround = ctx.onGround !== false;
    const inWater = !!ctx.inWater;
    const flying = !!ctx.flying;
    const vy = Number(ctx.vy) || 0;
    const mining = !!ctx.mining;
    const bobOn = ctx.bobOn !== false;
    const draw = ctx.bowDraw == null ? 0 : clamp(ctx.bowDraw, 0, 1);

    // 落地缓冲包络（上一帧腾空、这一帧着地）
    if (onGround && !this._prevOnGround && !inWater && !flying) this.landT = LAND_DURATION;
    this._prevOnGround = onGround;
    if (this.landT > 0) this.landT = Math.max(0, this.landT - dt);
    const landK = this.landT > 0 ? Math.sin(Math.PI * (1 - this.landT / LAND_DURATION)) : 0;

    // 换手抬起：从画面下沿抬回位（easeOutCubic 收尾，无硬切）
    if (this.equipT < 1) this.equipT = Math.min(1, this.equipT + dt / EQUIP_DURATION);
    const equipDown = (1 - this.equipT) ** 3;

    // 游泳/冲刺权重
    this._swim = damp(this._swim, inWater && !flying ? 1 : 0, 8, dt);
    this._sprint = damp(this._sprint, sprinting ? 1 : 0, 8, dt);
    if (this._swim > 0.001) this._swimPhase += dt * (3 + (moving ? 2 : 0));

    // 走路 bob（移动时幅度更大、频率更高）；设置可关
    this.bobPhase += dt * (moving ? (sprinting ? 11 : 8) : 2.5);
    const amp = bobOn ? (moving ? 0.016 : 0.004) : 0;
    const bobY = Math.sin(this.bobPhase * 2) * amp;
    const bobX = Math.cos(this.bobPhase) * amp * 1.4;

    // 挥动：swingT 0→1，正弦包络；挥速随挖掘周期缩放（硬块深而慢、软块轻快）
    const period = clamp(this.miningPeriod, 0.2, 1.0);
    const swingRate = 3.2 * (0.3 / period);
    const swAmp = 0.85 + 0.35 * clamp((period - 0.25) / 0.75, 0, 1);
    let swDown = 0, swRot = 0;
    if (this.swingT < 1) {
      this.swingT = Math.min(1, this.swingT + dt * swingRate);
      swDown = Math.sin(this.swingT * Math.PI) * swAmp;
      swRot = Math.sin(Math.min(1, this.swingT * 1.6) * Math.PI * 0.5) * 0.9 * swAmp;
    }
    // 按住左键（挖掘/攻击中）自动连续挥动（周期跟随 miningPeriod）
    if (mining) {
      this._autoSwingCd -= dt;
      if (this._autoSwingCd <= 0) { this._autoSwingCd = period; this.swing(); }
    } else {
      this._autoSwingCd = 0;
    }

    // 跳跃/下落：起跳时手略沉、下落时略抬（与竖直速度反向）
    const airY = flying ? 0 : clamp(-vy * 0.012, -0.06, 0.06);
    const airRot = flying ? 0 : clamp(-vy * 0.02, -0.10, 0.10);
    // 游泳：手压低并随划水轻摆
    const swimY = -0.05 * this._swim + Math.sin(this._swimPhase) * 0.02 * this._swim;
    const swimRotX = -0.22 * this._swim;
    // 拉弓蓄力：手持物向中心回拉 + 略抬，满蓄轻微颤动
    const tremble = (ctx.bowDraw != null && ctx.bowDraw >= 1) ? Math.sin(this.bobPhase * 12) * 0.0022 : 0;

    return {
      x: HAND_BASE.x + bobX - draw * 0.12,
      y: HAND_BASE.y + bobY - swDown * 0.10 + draw * 0.04 + tremble + airY + swimY - landK * 0.05 - equipDown * 0.35,
      z: HAND_BASE.z - swDown * 0.16 + draw * 0.14,
      rx: HAND_BASE_ROT.x - swRot * 0.85 - draw * 0.15 + airRot + swimRotX + landK * 0.08 + equipDown * 0.45,
      ry: HAND_BASE_ROT.y + swRot * 0.3 + draw * 0.25,
      rz: HAND_BASE_ROT.z + this._sprint * 0.035,
    };
  }
}
