// AetherFinale.js -- 天域终局 / 复潮域：守誓巨像震地与裂心拽引 / 天域复潮仪式 / 候潮献证 /
// 听潮门控 / 四界同潮演出窗口与四段粒子（自 Game.js 迁出）
//
// Game 侧保留同名薄门面（_colossusSlam / spawnRemoteColossusSlam / _applyColossusSlam /
// _updateColossusAura / _tryTideRitual / _tryPrimordialOffering / _tryListenTide /
// _grantPrimordialEmblem / _startFinaleTide / _stopFinaleTide / _updateFinaleTide /
// _finaleParticleTick / applyAetherDusk），签名与返回语义不变；Game 内其它调用点零 diff
//（update() 的 this._updateFinaleTide(dt)、start() 的 mobManager.onColossusSlam 箭头、
// 右键分支的 if (!this._tryListenTide(...)) / _tryTideRitual / _tryPrimordialOffering、
// returnToMenu 的 this._stopFinaleTide()），外部依赖面原样可用（NetworkManager:264/383/388/399、
// CommandPanel:273/291-292 的调试口与 game._finaleTide 只读探针、SaveSystem:29 的 aetherDusk、
// server/room.js 快照、tests 源码绊线）。
// 域内跨方法调用刻意仍走门面（g._applyColossusSlam / g._grantPrimordialEmblem /
// g._startFinaleTide / g._stopFinaleTide / g._finaleParticleTick / g.applyAetherDusk），
// 与迁前「Game 内部互调」的调用面逐字一致，外部 stub/覆盖仍然生效。
//
// 域状态归属：
//   · 演出窗口随迁入控制器（this.tide，原 Game._finaleTide；构造期置 null）——它是本域**唯一**
//     自带状态：全仓写入点只有本域方法；外部只有 CommandPanel:291 一处**只读**探针，故 Game 侧
//     保留同名只读访问器 get _finaleTide() 转发控制器，外部读取面逐字不变（初值 undefined → null，
//     同为假值，行为等价）。start() 刻意不重置它（窗口跨换维延续 = 追潮），不属跨存档共享状态。
//   · 天域复潮位 g.aetherDusk、WORLD_INFO 暂存 g.finaleInfo 留在 Game；world.finalePrimordial /
//     world.finaleDone（World）与 player.emblemWorn（Player）留在原主——外部读取方 =
//     SaveSystem:29、CommandPanel:273/449、NetworkManager:264/388、room.js 快照、start() 复位行。
//     控制器一律在调用点经 this.game 现取，不做任何转发/镜像。
//
// 生命周期：**构造器共享型**——控制器只存 this.game 与域内窗口状态；零 Three 资源 / 零 DOM /
// 零监听器 ⇒ _disposeWorld 无收口义务（`_disposeWorld()` 与 `async start(` 花括号切片与 HEAD
// 逐字节相同）。world / player / mobManager / net / sky / renderer / particles / inventory /
// hotbar / hud / chatBox / steleScreen 一律在调用点经 this.game 现取，不留构造期快照
//（start() 与换维都会重建 World 实例，快照会指向已销毁对象）。
import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { FINALE_TIDE_SEGMENTS, FINALE_TIDE_DURATION, finaleEnvelope, finalePulse, finaleListenGate } from '../world/finale-tide.js';
import { setAetherDuskProfile } from '../core/dimensions.js';
import { t } from '../i18n/index.js';
import { BLOCK_CENTER } from './constants.js';

export class AetherFinale {
  constructor(game) {
    this.game = game;
    this.tide = null; // 四界同潮演出窗口（原 Game._finaleTide）；start() 刻意不重置 = 换维追潮
  }

  // ── 守誓巨像震地（批次 C）────────────────────────────────────
  // StormColossusAI 触发回调：本地结算自己 + 广播 colossus_slam（各端各自结算本地玩家）
  colossusSlam(mob) {
    const g = this.game;
    const pos = mob.position.clone();
    g._applyColossusSlam(pos);
    if (g.networkMode && g.net) g.net.sendColossusSlam(pos);
  }

  // 联机：远端震地回执——本地结算（不回播）
  spawnRemoteColossusSlam(x, y, z) {
    const g = this.game;
    g._applyColossusSlam(new THREE.Vector3(x, y, z));
  }

  applyColossusSlam(pos) {
    const g = this.game;
    const p = g.player;
    if (p && !p.dead && !p.spectator && !p.creative) {
      const d = p.position.distanceTo(pos);
      if (d < 6) {
        const dmg = Math.max(1, Math.round(6 * (1 - d / 8)));
        if (p.hurt(dmg, 'mob', true)) {
          const dir = p.position.clone().sub(pos).setY(0);
          if (dir.lengthSq() > 0.0001) dir.normalize(); else dir.set(1, 0, 0);
          p.velocity.x += dir.x * 8;
          p.velocity.z += dir.z * 8;
          p.velocity.y += 5;
        }
      }
    }
    // 冲击环粒子（星髓青）+ 屏幕震动（复用受击红屏的 flash 通道太重，只做粒子）
    if (g.particles) {
      const def = BlockRegistry.getByName('star_marrow_block');
      if (def) g.particles.burstBlockBreak(pos.x, pos.y, pos.z, def, g.world);
    }
  }

  // 裂心阶段风拽光环（批次 C）：巨像残血时把附近玩家拖向自己（岛缘=真实代价）。
  // 各端对本地玩家结算（巨像位置经既有怪物同步收敛）；创造飞行/旁观免疫。
  updateColossusAura(dt) {
    const g = this.game;
    if (!g.mobManager || !g.player) return;
    const p = g.player;
    if (p.dead || p.spectator || p.flying) return;
    for (const m of g.mobManager.mobs) {
      if (m.dead || m.dyingAnim || m.typeName !== 'storm_colossus') continue;
      const frac = m.maxHealth ? m.health / m.maxHealth : 1;
      if (frac > 0.33) continue;
      const d = p.position.distanceTo(m.position);
      if (d > 11 || d < 0.5) continue;
      const dir = m.position.clone().sub(p.position).setY(0);
      if (dir.lengthSq() > 0.0001) dir.normalize();
      const k = 9 * (1 - d / 11);
      p.velocity.x += dir.x * k * dt * 6;
      p.velocity.z += dir.z * k * dt * 6;
      p.velocity.y += 2.5 * dt; // 微抬升——拖向岛缘的真实威胁
    }
  }

  // ── 天域复潮仪式（批次 D）────────────────────────────────────
  // 献祭三页潮汐残页 + 三枚心核碎片 → 恒昼祭坛置换潮心祭坛（setBlock 进账本）→ 永昼解除
  tryTideRitual(block) {
    const g = this.game;
    if (g.aetherDusk) return; // 已复潮
    const inv = g.inventory;
    const need = [['page_rising', 1], ['page_marrow', 1], ['page_sunder', 1], ['heart_shard', 3]];
    const hasAll = need.every(([n, c]) => {
      let have = 0;
      for (const s of inv.slots) if (s && s.name === n) have += s.count;
      return have >= c;
    });
    if (!hasAll) {
      if (g.chatBox) g.chatBox.add(t('祭坛沉默着——集齐三页潮汐残页与三枚心核碎片再来。'), '#cde');
      return;
    }
    need.forEach(([n, c]) => inv.removeItems(n, c));
    g.hotbar.update();
    // 祭坛置换：潮心祭坛（走 setBlock → 账本 + 光照 + 联机同步全自动）
    g.world.setBlock(block.x, block.y, block.z, BlockRegistry.getId('tide_altar'));
    g.applyAetherDusk(true);
    if (g.networkMode && g.net) g.net.sendAetherState(true);
    // 仪式演出：粒子潮涌 + 第九章碑文自动浮现
    if (g.particles) {
      const tideDef = BlockRegistry.getByName('tide_altar');
      if (tideDef) g.particles.burstBlockBreak(block.x + BLOCK_CENTER, block.y + 1.5, block.z + BLOCK_CENTER, tideDef, g.world);
    }
    g.steleScreen.open(block.x, block.y, block.z, 'renewal');
  }

  // ── 终局篇 F1：候潮献证（原初之潮·潮归其位）──────────────────
  // 潮心祭坛右键：三潮之证齐（风暴之核/哀潮之泪/雨潮残页 各×1）→ 消耗并置换
  // 原初祭坛（setBlock 进账本），进入候潮态——finalePrimordial 记祭坛坐标
  //（F2 四界同潮演出的时间窗锚点；方块 id 本身即持久态，坐标位随存档/换维透传）。
  // 未集齐或已候潮 → 照旧浮现复潮章（不变量 6：复潮行为不回退）。
  // LAN：方块置换走账本天然一致；候潮 room flag 广播随 F3 听潮仪式接入。
  tryPrimordialOffering(block) {
    const g = this.game;
    if (!g.world.finalePrimordial) {
      const need = [['storm_core', 1], ['mourn_tear', 1], ['page_rain', 1]];
      const hasAll = need.every(([n, c]) => {
        let have = 0;
        for (const s of g.inventory.slots) if (s && s.name === n) have += s.count;
        return have >= c;
      });
      if (hasAll) {
        need.forEach(([n, c]) => g.inventory.removeItems(n, c));
        g.hotbar.update();
        g.world.setBlock(block.x, block.y, block.z, BlockRegistry.getId('primordial_altar'));
        g.world.finalePrimordial = { x: block.x, y: block.y, z: block.z };
        if (g.networkMode && g.net) {
          // F3：候潮状态上服务器（只进不退，广播全房间——其他人由广播置坐标位）
          g.net.sendFinaleState({ offered: true, x: block.x, y: block.y, z: block.z });
        }
        if (g.particles) {
          const altarDef = BlockRegistry.getByName('primordial_altar');
          if (altarDef) g.particles.burstBlockBreak(block.x + BLOCK_CENTER, block.y + 1.5, block.z + BLOCK_CENTER, altarDef, g.world);
        }
        // 候潮章浮现（复潮碑文浮现同款交互；联机提示通道 chatBox 由碑文统一替代）
        g.steleScreen.open(block.x, block.y, block.z, 'tide_waiting');
        return;
      }
    }
    g.steleScreen.open(block.x, block.y, block.z, 'renewal');
  }

  // ── 终局篇 F3：听潮仪式（原初之潮·潮归其位）──────────────────
  // 守望界碑右键门控（finaleListenGate 真值表）：候潮 ∧ 未听过 → 触发 60s
  // 四界同潮仪式窗口（end 段附加龙影低头粒子），窗口结束发放原初纹章。
  // LAN：sendFinaleState({done}) 上服务器——广播含发起者，各端（含自己）收到
  // done 后置 finaleDone 并以服务器重排的 startTs 启动窗口（host 权威时钟）。
  // 返回 true 表示右键已被仪式路径消费（不打开碑文浮层）。
  tryListenTide(block) {
    const g = this.game;
    const sm = g.world.generator && g.world.generator.structureManager;
    const chapterId = sm && sm.steleChapterAt ? sm.steleChapterAt(block.x, block.y, block.z) : null;
    const gate = finaleListenGate({
      chapterId,
      done: !!g.world.finaleDone,
      offered: !!g.world.finalePrimordial,
      windowActive: !!this.tide,
    });
    if (gate === 'read') return false;
    if (gate === 'swallow') return true;
    if (g.networkMode && g.net) {
      g.net.sendFinaleState({ done: true }); // 各端由广播统一驱动（含发起者）
    } else {
      g.world.finaleDone = true; // 单机：本地置位（SaveSystem 持久化）
      g._startFinaleTide({ ritual: true });
    }
    return true;
  }

  // 仪式收束：原初纹章发放（唯一信物，不可合成——lore 承载终章）
  grantPrimordialEmblem() {
    const g = this.game;
    if (!g.inventory) return;
    const left = g.inventory.add('primordial_emblem', 1);
    if (left > 0 && g.mobManager && !g.player.spectator) {
      // 背包满：落在脚下走掉落链（联机 sendDropSpawn 进账本）
      const p = g.player.position;
      if (g.networkMode && g.net) {
        g.net.sendDropSpawn(p.x, p.y + 1, p.z, 'primordial_emblem', 1);
      } else {
        g.mobManager.spawnDrop(new THREE.Vector3(p.x, p.y + 1, p.z), 'primordial_emblem', 1, null, { pickupDelay: 0.5 });
      }
    }
    g.hotbar.update();
    if (g.hud) g.hud.showFinaleBanner(); // 终局横幅 10s（Build 19 K3）
    if (g.chatBox) g.chatBox.add(t('潮声落定。碑座上留着一枚纹章。'), '#bfeee8');
  }

  // ── 终局篇 F2：四界同潮演出管线（原初之潮·潮归其位）──────────
  // 60s 全局时间窗（finale-tide.js 配置），四界分段并行：窗口跨换维延续
  //（this.tide 挂控制器实例，start 重入不清），玩家换维即见彼界段落——
  // 单机可追潮跑四界。演出纪律：纯客户端零持久化（不进存档/账本）；
  // 天色/雾走逐帧写入（Sky.finaleOverride + 雾段之后最后写入者），停写即回落。
  // LAN：F3 起 done 广播以服务器时钟重排 startTs（命令面板调试口仍走本地时钟）。
  startFinaleTide(opts = {}) {
    // ritual=true = F3 听潮仪式窗口（end 段附加龙影低头粒子；结束时发放原初纹章）
    // startTs 可由 LAN 广播传入（服务器时钟重排），单机/调试口取本地时钟
    this.tide = {
      startTs: typeof opts.startTs === 'number' ? opts.startTs : Date.now(),
      ritual: !!opts.ritual,
      granted: false,
    };
  }

  stopFinaleTide() {
    const g = this.game;
    const ft = this.tide;
    this.tide = null;
    if (g.sky) g.sky.finaleOverride = null; // 天色每帧重算，停写自动回落
    // 听潮仪式收束：潮声落定，碑座上的纹章交到玩家手里（§6 文案——断句处收束）
    if (ft && ft.ritual && !ft.granted) g._grantPrimordialEmblem();
  }

  updateFinaleTide(dt) {
    const g = this.game;
    const ft = this.tide;
    if (!ft) return;
    const t = (Date.now() - ft.startTs) / 1000;
    if (t >= FINALE_TIDE_DURATION) { g._stopFinaleTide(); return; }
    const dim = g.world && g.world.dimension;
    const seg = FINALE_TIDE_SEGMENTS[dim];
    if (!seg) return; // 未知维度跳过渲染（窗口继续计时）
    const p = finaleEnvelope(t);
    const pulse = finalePulse(t);
    if (g.sky) {
      // 天色包络混入 + 涌潮呼吸（强度脉动）
      g.sky.finaleOverride = p > 0
        ? { sky: seg.skyTint, strength: p * (0.55 + 0.25 * pulse), fogPull: seg.fogPull * (0.7 + 0.3 * pulse) }
        : null;
    }
    // 雾拉近（本函数在 applyFogRange 之后调用 = 最后写入者；停写自动回落）
    const fog = g.renderer && g.renderer.scene && g.renderer.scene.fog;
    if (fog && p > 0 && g.sky && g.sky.finaleOverride && !g.player.inWater) {
      const k = 1 - g.sky.finaleOverride.fogPull;
      fog.near *= k;
      fog.far *= 1 - (1 - k) * 0.5;
    }
    if (g.particles && p > 0) g._finaleParticleTick(seg, p, t, dt);
  }

  // 各段粒子发射（视觉演出，不与方块/实体/掉落交互）
  finaleParticleTick(seg, p, t, dt) {
    const g = this.game;
    const pt = seg.particle;
    const scaled = pt.rate * p * dt * (g.particles.densityScale || 1);
    const count = Math.floor(scaled) + (Math.random() < scaled % 1 ? 1 : 0);
    if (count <= 0) return;
    const pos = g.player.position;
    const WATER = BlockRegistry.getId('water');
    for (let i = 0; i < count; i++) {
      const [r, g2, b] = pt.color;
      const jx = (Math.random() - 0.5) * 2, jz = (Math.random() - 0.5) * 2;
      if (seg.id === 'aether') {
        // 风涨：原初祭坛涌泉（候潮锚点）+ 周身风粒上行
        if (g.world.finalePrimordial && Math.random() < 0.5) {
          const a = g.world.finalePrimordial;
          g.particles.spawn(
            a.x + BLOCK_CENTER + jx * 1.2, a.y + 1 + Math.random() * 0.8, a.z + BLOCK_CENTER + jz * 1.2,
            jx * 0.6, pt.rise * (0.7 + Math.random() * 0.6), jz * 0.6,
            r, g2, b, pt.life * (0.8 + Math.random() * 0.4), pt.grav, 0.995
          );
        } else {
          const ang = Math.random() * Math.PI * 2, rr = 2 + Math.random() * pt.spread;
          g.particles.spawn(
            pos.x + Math.cos(ang) * rr, pos.y + (Math.random() - 0.3) * 4, pos.z + Math.sin(ang) * rr,
            -Math.sin(ang) * 1.2, pt.rise * (0.6 + Math.random() * 0.8), Math.cos(ang) * 1.2,
            r, g2, b, pt.life * (0.8 + Math.random() * 0.4), pt.grav, 0.995
          );
        }
      } else if (seg.id === 'nether') {
        // 熔岩潮涌：岩浆海面（y≈31）火花上喷 + 周身余烬
        if (Math.random() < 0.7) {
          const sx = pos.x + jx * pt.spread, sz = pos.z + jz * pt.spread;
          g.particles.spawn(
            sx, 31.6 + Math.random() * 0.5, sz,
            jx * 0.8, pt.rise * (0.6 + Math.random() * 0.8), jz * 0.8,
            r, g2, b, pt.life * (0.7 + Math.random() * 0.5), pt.grav, 0.99
          );
        } else {
          g.particles.spawn(
            pos.x + jx * 5, pos.y + (Math.random() - 0.2) * 3, pos.z + jz * 5,
            jx * 0.5, 1 + Math.random() * 1.5, jz * 0.5,
            r * 0.9, g2 * 0.8, b * 0.7, 1.4, -0.4, 0.99
          );
        }
      } else if (seg.id === 'overworld') {
        // 逆雨：海面（y=64 水下 1 格是水才发——雨只在海上倒着落回天上）
        const sx = Math.round(pos.x + jx * pt.spread), sz = Math.round(pos.z + jz * pt.spread);
        if (g.world.getBlock(sx, 62, sz) === WATER) {
          g.particles.spawn(
            sx + BLOCK_CENTER, 63.8 + Math.random() * 0.5, sz + BLOCK_CENTER,
            jx * 0.3, pt.rise * (0.7 + Math.random() * 0.6), jz * 0.3,
            r, g2, b, pt.life * (0.8 + Math.random() * 0.4), pt.grav, 0.998
          );
        }
      } else if (seg.id === 'end') {
        // 潮声过岸：环形采样点找滩涂地表，潮雾带贴地横掠（不落地、不沾岸）
        const ang = Math.random() * Math.PI * 2;
        const rr = 8 + Math.random() * pt.spread;
        const sx = Math.round(pos.x + Math.cos(ang) * rr), sz = Math.round(pos.z + Math.sin(ang) * rr);
        let sy = 0;
        for (let y = 72; y >= 58; y--) {
          if (g.world.getBlock(sx, y, sz) !== 0) { sy = y; break; }
        }
        if (sy > 0) {
          const tang = ang + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1); // 沿切线方向掠过
          g.particles.spawn(
            sx + BLOCK_CENTER, sy + 1.2 + Math.random() * 1.6, sz + BLOCK_CENTER,
            Math.cos(tang) * 1.6, pt.rise * 0.3, Math.sin(tang) * 1.6,
            r, g2, b, pt.life * (0.9 + Math.random() * 0.4), pt.grav, 0.998
          );
        }
        // 听潮仪式附加：龙影低头——紫黑粒子环自龙头位置缓缓垂落旋转（§4 方案二：
        // 只给低头的动作，不解释等待的内容；dragon AI 零改动，纯视觉）
        if (this.tide && this.tide.ritual && p > 0.25 && g.mobManager) {
          const dragon = g.mobManager.mobs.find((m) => m.typeName === 'dragon');
          const hx = dragon ? dragon.position.x : 0;
          const hy = dragon ? dragon.position.y : 76;
          const hz = dragon ? dragon.position.z : 0;
          const la = t * 1.1 + i * 1.7; // 慢旋相位（i 错开多粒成环）
          g.particles.spawn(
            hx + Math.cos(la) * 2.6, hy - 1.2 - Math.sin(la * 2) * 0.9, hz + Math.sin(la) * 2.6,
            Math.cos(la + Math.PI / 2) * 0.5, -1.4, Math.sin(la + Math.PI / 2) * 0.5,
            0.42, 0.30, 0.58, 1.8, -0.2, 0.995
          );
        }
      }
    }
  }

  // 复潮状态切换（§5.4 不变量 1/2/3）：档案覆盖 + Sky 快照重跑 + 时间锚定上午
  applyAetherDusk(on) {
    const g = this.game;
    g.aetherDusk = !!on;
    if (g.world && g.world.dimension === 'aether') {
      setAetherDuskProfile(g.aetherDusk);
      if (g.sky) {
        g.sky.applyDimensionProfile(g.world.dimDef);
        if (g.aetherDusk) g.sky.time = 0.32; // 从上午起——玩家将亲眼看到天域第一次日落
      }
    }
  }
}
