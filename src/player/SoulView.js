// SoulView.js -- 灵魂出窍相机（Build 41）
// 语义（用户 2026-11-02 定义）：在不移动人物、也不改变人物视角的前提下，让摄像机离体自由查看，
// 且可穿墙。因此本模块只持有一份**独立的相机位姿**，绝不写 player.position/yaw/pitch：
//   · 身体：位置/速度/朝向/生存状态全部冻结（由 Game.update 跳过移动与生存分支保证）
//   · 视角：鼠标经 Controls.lookTarget 改道写到这里，玩家朝向保持进入前的值，归体即回到原视角
//   · 相机：无碰撞（穿墙是特性），只能靠 Space/Shift 升降，水平移动沿相机 yaw
// 速度：基础 10 m/s，按住 Ctrl ×2（用户 2026-11-02 确认，不做滚轮调速）。
import * as THREE from 'three';
import { PLAYER_EYE_HEIGHT } from './constants.js';

export const SOUL_SPEED = 10;
export const SOUL_SPRINT_MULT = 2;

export class SoulView {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.position = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this._savedViewMode = 0;
  }

  // 进入：以玩家眼位/朝向为起点（归体后视角不变）
  enter() {
    if (this.active) return false;
    const p = this.game.player;
    this.position.copy(p.position);
    this.position.y += PLAYER_EYE_HEIGHT;
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this._savedViewMode = p.viewMode;
    this.active = true;
    if (this.game.controls) this.game.controls.lookTarget = this; // 鼠标位移改道到相机
    return true;
  }

  // 归体（幂等）：恢复视角模式，玩家的 position/yaw/pitch 全程未被改动
  exit() {
    if (!this.active) return false;
    this.active = false;
    if (this.game.controls && this.game.controls.lookTarget === this) this.game.controls.lookTarget = null;
    const p = this.game.player;
    if (p) p.viewMode = this._savedViewMode;
    return true;
  }

  // 每帧推进：水平沿相机 yaw（与创造飞行同款，抬头不骑俯仰），Space 升 / Shift 降
  step(dt, controls) {
    if (!this.active) return;
    const c = controls || this.game.controls;
    if (!c) return;
    const keys = c.keys || {};
    const up = (keys['Space'] ? 1 : 0) - ((keys['ShiftLeft'] || keys['ShiftRight']) ? 1 : 0);
    const sprint = !!(keys['ControlLeft'] || keys['ControlRight']);
    const speed = SOUL_SPEED * (sprint ? SOUL_SPRINT_MULT : 1);
    const move = c.getMoveVector(this.yaw);
    this.position.x += move.x * speed * dt;
    this.position.z += move.z * speed * dt;
    this.position.y += up * speed * dt;
  }
}
