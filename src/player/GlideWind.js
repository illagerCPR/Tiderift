// GlideWind.js -- 鞘翅滑翔气动 + 上升气流/风阵柱（L9 域，自 Game.js 迁出）
//
// 含两簇：滑翔（展开门限 / 折叠收口 / 气动结算）与气流（气流柱判定、御风斗篷、风阵柱读写）。
// 气动常量随域搬迁（原先就在 Game.js 顶部）；重力与下沉上限仍在 Physics.js——GLIDE_GRAVITY
// 由那边导出、本模块 import。防回退条参见 docs/agent-notes/survival-items.md
// 「气动参数（Game.js 顶部常量，实测锚点）」：CLIMB 混合/上旋模型已被升力模型替换，勿回退。
//
// Game 侧保留同名薄门面。_inUpdraft 仍存在 **Game 实例**上（computeUpdraftState() 只返回判定
// 结果，由门面赋值）——Game.update 的抬升/缓降分支直接读 this._inUpdraft。
//
// 生命周期：**构造器共享型**——无 Three 资源 / 无 DOM / 无监听器，_disposeWorld 无收口义务。
// inventory / hud / world 一律在调用点经 this.game 现取，不留构造期快照（三者随 start() 重建）。

import { BlockRegistry } from '../core/BlockRegistry.js';
import { CHUNK_HEIGHT } from '../core/Chunk.js';
import { GLIDE_GRAVITY } from './Physics.js';

// 鞘翅滑翔气动参数（每秒口径；重力/下沉上限在 Physics.js）
const GLIDE_THRUST = 8;    // 俯冲推进加速度上限 m/s²（按 -sin(pitch) 比例；与气动阻尼平衡出俯冲极速 ~27m/s）
const GLIDE_DRAG = 0.994;  // 水平气动阻尼（pow 基，dt*60 口径；过强会把拉起后的翱翔窗口掐死）
const GLIDE_BRAKE = 0.5;   // 拉起刹车强度（sin(pitch) 比例的水平动能损耗；过大会瞬间失速翱翔不出）
const GLIDE_LIFT = 6;      // 拉起升力系数（升力 = sin(pitch)·vAlong·此值；升力超过滑翔重力才净爬升）
const GLIDE_DEPLOY_VY = -0.5; // 展开阈值：空中下落至此速度自动展开（落体展开，原版式）

export class GlideWind {
  constructor(game) {
    this.game = game;
  }

  // 上升气流检测（天域批次 B）：足部/身体任一格 def.updraft → 本帧处于气流柱内。
  // 只作用于玩家（怪物运动不接气流，避免 AI 被抬飞出控）；联机纯本地物理零协议。
  // 返回判定结果，由 Game 门面写入 this._inUpdraft。
  computeUpdraftState() {
    const g = this.game;
    const p = g.player;
    const bx = Math.floor(p.position.x);
    const bz = Math.floor(p.position.z);
    const yFeet = Math.floor(p.position.y + 0.1);
    const yBody = Math.floor(p.position.y + 1.0);
    const d1 = BlockRegistry.getById(g.world.getBlock(bx, yFeet, bz));
    const d2 = BlockRegistry.getById(g.world.getBlock(bx, yBody, bz));
    return !!(d1 && d1.updraft) || !!(d2 && d2.updraft);
  }

  // 御风斗篷穿戴检测（批次 C）：胸甲槽 = armor[1]
  hasGaleCloak() {
    const chest = this.game.inventory.armor && this.game.inventory.armor[1];
    return !!(chest && chest.name === 'gale_cloak');
  }

  // 风阵块放置：上方 12 格写风流柱（只填空气格；逐格 setBlock → 联机逐格自动上报）
  writeGaleColumn(x, y, z) {
    const g = this.game;
    const wid = BlockRegistry.getId('wind_current');
    for (let h = 1; h <= 12; h++) {
      if (y + h >= CHUNK_HEIGHT) break;
      if (g.world.getBlock(x, y + h, z) === 0) g.world.setBlock(x, y + h, z, wid);
    }
  }

  // 拆风阵块：同步清除其上方气流柱（遇非风流格即停，玩家建筑不受影响）
  clearGaleColumn(x, y, z) {
    const g = this.game;
    const wid = BlockRegistry.getId('wind_current');
    for (let h = 1; h <= 12; h++) {
      if (g.world.getBlock(x, y + h, z) !== wid) break;
      g.world.setBlock(x, y + h, z, 0);
    }
  }

  // 鞘翅滑翔折叠判定（每帧在移动分支之前调用）：没穿鞘翅 / 创造飞行 / 旁观 /
  // 在水中 / 已在地面 → 折叠。独立于气动结算——水中走游泳分支不进移动滑翔分支，
  // 若不在此处统一折叠，入水后 gliding 会残留 true。
  updateGlideFold() {
    const g = this.game;
    const p = g.player;
    if (!p.gliding) return;
    const chest = g.inventory ? g.inventory.armor[1] : null;
    if (!chest || chest.name !== 'elytra' || p.flying || p.spectator || p.inWater || p.onGround) {
      p.gliding = false;
      if (g.hud) g.hud.setGliding(false);
    }
  }

  // 鞘翅滑翔气动结算（移动分支调用）：返回 true 表示本帧处于滑翔（移动分支不再
  // 覆写水平速度，动量得以保留）。展开条件：胸甲槽穿鞘翅 + 空中下落（落体展开）。
  // 气动模型（简化原版）：低头俯冲加速、抬头迎角升力翱翔、常驻水平阻尼。
  updateGlideAero(dt) {
    const g = this.game;
    const p = g.player;
    if (!p.gliding) {
      const chest = g.inventory ? g.inventory.armor[1] : null;
      // onGround 必须排除：站立时每帧重力使 vy=-0.53 恰好越过展开阈值，
      // 会与 _updateGlideFold 的落地折叠形成逐帧抖动（HUD 闪烁）
      if (!chest || chest.name !== 'elytra' || p.flying || p.spectator || p.inWater || p.onGround) return false;
      if (p.velocity.y > GLIDE_DEPLOY_VY) return false; // 起跳上升段不展开，过 apex 后触发
      p.gliding = true;
      if (g.hud) g.hud.setGliding(true);
    }

    // 气动结算：视线水平方向 = forward = (-sin(yaw), 0, -cos(yaw))；低头 pitch 为负
    const fwdX = -Math.sin(p.yaw);
    const fwdZ = -Math.cos(p.yaw);
    const pitch = p.pitch;
    const vAlong = p.velocity.x * fwdX + p.velocity.z * fwdZ; // 沿视线的前向速度分量

    if (pitch < 0) {
      // 俯冲：沿视线水平分量推进（越低头推力越大）
      const thrust = -Math.sin(pitch) * GLIDE_THRUST;
      p.velocity.x += fwdX * thrust * dt;
      p.velocity.z += fwdZ * thrust * dt;
    } else if (pitch > 0) {
      // 拉起：机翼迎角升力 = sin(pitch)·前向速度·GLIDE_LIFT，超过滑翔重力才净爬升
      // （鼓励"俯冲攒速→拉起翱翔"循环；速度被刹车耗尽后升力不足，自然失速下坠）
      if (vAlong > 1) {
        const lift = Math.sin(pitch) * vAlong * GLIDE_LIFT;
        p.velocity.y += Math.min(lift, -GLIDE_GRAVITY * 1.35) * dt;
      }
      const brake = Math.min(1, Math.sin(pitch) * GLIDE_BRAKE * dt);
      p.velocity.x -= p.velocity.x * brake;
      p.velocity.z -= p.velocity.z * brake;
    }

    // 常驻水平气动阻尼（帧率无关）+ 爬升上限保护
    const drag = Math.pow(GLIDE_DRAG, dt * 60);
    p.velocity.x *= drag;
    p.velocity.z *= drag;
    if (p.velocity.y > 9) p.velocity.y = 9;

    return true;
  }
}
