// Endgame.js -- 终局域：末影龙 + 龙败奖励（回程垫/折跃门/龙蛋）+ 末影水晶击碎（自 Game.js 迁出）
//
// Game 侧保留同名薄门面（_ensureEndReturnPad / _endPadExists / _ensureDragon / _onDragonDefeated /
// _activateEndRewards / _placeDragonEgg / _ensureGateways / _breakCrystal），签名与返回语义不变；
// Game 内其它调用点零 diff，外部依赖面（NetworkManager / window.game / tests 源码绊线）原样可用。
//
// 生命周期：**构造器共享型**——无 Three 资源 / 无 DOM / 无监听器，_disposeWorld 无收口义务。
// world / mobManager / net / chatBox / networkMode 一律在调用点经 this.game 现取，不留构造期快照：
// world / mobManager 每次 start() 新建、net / networkMode 随联机状态切换，快照会指向失效对象。
// 控制器内部相互调用（如 activateEndRewards → ensureGateways）走自身方法，不经 Game 门面。
//
// 迁前现状存档（行为零变化，实测得出）：placeDragonEgg 的原注释称「幂等（已有方块跳过）」，
// 但第二次调用会在已有龙蛋**正上方**再叠一枚——下扫遇到的第一个非空气格正是上一枚龙蛋。
// 本模块按现状搬运；tests/game-behavior.mjs 的 J7 钉子按现状钉住，将来若修幂等需同步更新该钉子。

import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { buildEndReturnPad, buildGatewayPad } from '../core/Portals.js';
import { gatewayPlacements } from '../world/dimensions/end.js';
import { Mob } from '../entity/Mob.js';
import { BLOCK_CENTER } from './constants.js';
import { t } from '../i18n/index.js';

export class Endgame {
  constructor(game) {
    this.game = game;
  }

  // 末地出生点旁的回程门垫（龙败激活，原版喷泉基座造型）：
  // 16 格内已有 end_portal 则跳过（重连/多端幂等），否则在出生点偏移 ~5 格建造
  ensureEndReturnPad() {
    const g = this.game;
    if (this.endPadExists()) return;
    const w = g.world;
    const sp = w.getSpawnPoint();
    buildEndReturnPad(w, Math.floor(sp.x) + 4, Math.floor(sp.z) + 4, {
      top: w.dimDef.spawnScanTop || 140,
      platformY: 64,
      fountain: true,
    });
    if (g.chatBox) g.chatBox.add(t('主岛中心升起基岩喷泉——踩上门垫返回主世界'), '#a7f');
  }

  // 出生点 16 格内是否已有激活回程门（ensureEndReturnPad 与 ensureDragon 共用）
  endPadExists() {
    const g = this.game;
    const w = g.world;
    const EP = BlockRegistry.getId('end_portal');
    const sp = w.getSpawnPoint();
    for (const [k, id] of w.modifiedBlocks) {
      if (id !== EP) continue;
      const p = k.split(',');
      if ((+p[0] - sp.x) ** 2 + (+p[2] - sp.z) ** 2 <= 256) return true;
    }
    return false;
  }

  // 末地开局生成末影龙（未击败时；单机/host 权威生成，联机经 mob_spawn 广播）
  // 击败判定：会话标记 OR 账本内已有回程门（跨会话/联机一致——门方块账本服务器权威持久化）
  ensureDragon() {
    const g = this.game;
    if (!g.world || g.world.dimension !== 'end') return;
    if (!g.mobManager) return;
    if (g.networkMode && g.net && !g.net.isHost) return; // 联机非 host 等广播
    if (g.world.dragonDefeated || this.endPadExists()) return;
    if (g.mobManager.mobs.some(m => m.typeName === 'dragon' && !m.dead)) return;
    const mob = new Mob('dragon', g.world);
    // 出生在柱环外缘上空（主岛中心偏移，盘旋半径与 DragonAI.CIRCLE_R 对齐）
    mob.position.set(0.5, 88, 30.5);
    if (g.networkMode && g.net) {
      g.net.sendMobSpawn('dragon', mob.position.x, mob.position.y, mob.position.z);
    } else {
      g.mobManager.spawnMob(mob);
    }
    if (g.chatBox) g.chatBox.add(t('末影龙的咆哮在虚空回荡……'), '#c5f');
  }

  // 末影龙被击败：置标记 + 激活末地奖励（返回门喷泉 + 主岛缘/外岛缘折跃门阵列）
  // 各端独立触发（本地死亡链/远端同步入口）——建门幂等（账本已有即跳过），位置确定性保证一致
  onDragonDefeated(mob) {
    const g = this.game;
    if (!g.world) return;
    g.world.dragonDefeated = true;
    if (g.chatBox) g.chatBox.add(t('末影龙被击败了！'), '#c5f');
    if (g.world.dimension === 'end') this.activateEndRewards();
  }

  // 龙败奖励：① 出生点旁激活基岩喷泉返程门（踩上回主世界）
  //           ② 主岛缘 + 外岛缘折跃门阵列（角度配对，站入同维传送）
  //           ③ 龙蛋立于主岛中央（原版喷泉柱位；真实方块进账本可挖走）
  activateEndRewards() {
    this.ensureEndReturnPad();
    this.ensureGateways();
    this.placeDragonEgg();
  }

  // 龙蛋：主岛中心 (0,0) 从上往下扫首个实心格的顶面放置；幂等（已有方块跳过）
  placeDragonEgg() {
    const g = this.game;
    const EGG = BlockRegistry.getId('dragon_egg');
    for (let y = 80; y > 40; y--) {
      const id = g.world.getBlock(0, y, 0);
      if (id !== 0) {
        if (g.world.getBlock(0, y + 1, 0) === 0) {
          g.world.setBlock(0, y + 1, 0, EGG);
          if (g.chatBox) g.chatBox.add(t('一枚龙蛋静静出现在主岛中央……'), '#c8f');
        }
        return;
      }
    }
  }

  // 折跃门阵列（幂等：账本已有 end_gateway 即跳过）
  ensureGateways() {
    const g = this.game;
    const GW = BlockRegistry.getId('end_gateway');
    for (const [, id] of g.world.modifiedBlocks) {
      if (id === GW) return;
    }
    const anchors = g.world.generator && typeof g.world.generator.outerAnchors === 'function'
      ? g.world.generator.outerAnchors() : [];
    if (!anchors.length) return;
    for (const place of gatewayPlacements(anchors, 4)) {
      buildGatewayPad(g.world, place.inner.x, place.inner.z, { top: 140, platformY: 64 });
      buildGatewayPad(g.world, place.outer.x, place.outer.z, { top: 140, platformY: 64 });
    }
    if (g.chatBox) g.chatBox.add(t('主岛边缘升起了数座折跃门——它们通向外岛'), '#a7f');
  }

  // 末影水晶被击碎：范围爆炸（复用怪物爆炸破坏路径）+ 按距离衰减伤害
  breakCrystal(x, y, z) {
    const g = this.game;
    const px = x + BLOCK_CENTER, py = y + BLOCK_CENTER, pz = z + BLOCK_CENTER;
    if (g.mobManager) {
      g.mobManager.pendingExplosions.push({ x: px, y: py, z: pz, radius: 3 });
    }
    const d = g.player.position.distanceTo(new THREE.Vector3(px, py, pz));
    if (d < 8) {
      const dmg = Math.round(14 * (1 - d / 8));
      if (dmg > 0) g.player.hurt(dmg, 'explosion', true);
    }
    if (g.chatBox) g.chatBox.add(t('末影水晶碎裂，爆发出紫色的冲击！'), '#c8f');
  }
}
