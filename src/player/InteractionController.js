// InteractionController.js -- 鼠标交互控制器（B30 轮 8 步 8：Game.js 上帝类拆分最后一刀）
//
// 迁移清单（自 src/player/Game.js 原样搬入；Game 侧保留同名薄门面 handleMouseInput(dt)）：
//   原 handleMouseInput(1400-1822) 拆为四段——编排（UI 门控 + 未命中早退）/ 段① 弓蓄力通道 /
//   段② 左键链 / 段③ 右键链（末段）。段切点只取连续整块，段内语句与控制流逐字未动，
//   只做两处外观改写：this.→g.（Game 成员一律经 this.game 现取）+ 出口改成显式协议状态。
//   随迁模块级常量 TOOL_TIER_SPEED / ORE_XP（迁前全仓仅本域引用）；Game 侧对应 import 收窄。
//
// 域状态归属：**零自带状态**——控制器只存 this.game，正文里 this. 只出现 this.game。
//   world / player / mobManager / inventory / hud / raycast / controls / selectedBlock /
//   breakingProgress / breakMesh / hand / _bowCharging / _bowCharge / redstone / 各 UI 屏一律在
//   调用点经 this.game 现取（start() 会重建其中多数，构造期快照会指向已销毁的旧世界）。
//   跨域基础设施 _frameRay / _anyInputBlockingUI / updateRaycast / _cellOverlapsPlayer 刻意留在 Game。
//
// 生命周期判定：**构造器共享型（控制器零自带状态）**——Game 构造期一行
//   this.interactionController = new InteractionController(this);（紧随既有控制器）。
//   零 Three 资源 / 零 DOM / 零监听器 / 零容器 ⇒ start() 与 _disposeWorld() 零改动，重开存档无需复位。
//
// 调用面契约（「点击已消费」协议）：迁移前是隐式约定——分支靠顺手置位 controls.mouseLeft/mouseRight =
//   false 顺带表达「本次点击已消费」，而置位与 return 并不配对（实拆 30 处置位 / 32 处 return）。切段后
//   这个区别会丢语义，故显式化为四态，段出口一律走 exitsMethod()：
//     CLICK_CONSUMED       已消费（本段在该分支原地置位 controls.mouseX = false）+ 整方法退出
//     CLICK_ABORT          未消费 + 整方法退出（无目标/未命中/早退守卫/蓄力接管/放置重叠拒绝）
//     CLICK_CONSUMED_PASS  已消费 + 交后续段（左键段创造瞬破/挖穿/旁观后仍需处理右键段）
//     CLICK_PASS           未消费 + 交后续段
//   置位语句仍在原位置逐字保留（外部 Controls / update() / NetworkManager 都读 controls.mouse*，
//   置位时机与次数不得变）；「已消费但继续」由段内 leftConsumed 标记表达，不再拿置位本身当返回值。
//
// 已修复缺陷 H1（轮 9）：段③的放置重叠守卫（CLICK_ABORT）原先写在 if (blockDef) 之前，
//   手持弓/末影之眼对准「放置邻格与玩家 AABB 重叠」的目标时右键被静默吞掉（既不置位 mouseRight 也无动作）。
//   守卫现整体移入 if (blockDef) 内 —— 只对真正要放置的方块生效；非方块手持物继续走
//   弓蓄力 / 掷末影之眼 / 末尾兜底消费三条后续分支。钉子 Q25 已同步改写，并补真方块正对照。
import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { removeConnectedPortals } from '../core/Portals.js';
import { facingId } from '../core/blockShape.js';
import { t } from '../i18n/index.js';
import { audio } from '../audio/AudioEngine.js';
import { BLOCK_CENTER } from './constants.js';

// 工具挖掘速度倍率（按物品 tier；金质单独 9 倍——原版金工具挖得快但等级低）
const TOOL_TIER_SPEED = { 1: 2, 2: 4, 3: 6, 4: 8 };

// 挖矿经验（原版口径：煤/红石/青金/钻/绿宝给，铁金不给；门控掉落成功才结算）
const ORE_XP = {
  coal_ore: 1, deepslate_coal_ore: 1,
  redstone_ore: 2, lapis_ore: 3,
  diamond_ore: 7, deepslate_diamond_ore: 7, emerald_ore: 7,
};

// ── 「点击已消费」协议（交互域调用面契约，协议表见 InteractionController.js 文件头）──
const CLICK_CONSUMED = 'consumed';           // 已消费（分支内原地置位 controls.mouseX = false）+ 整方法退出
const CLICK_ABORT = 'abort';                 // 未消费 + 整方法退出（无目标/未命中/早期守卫/蓄力接管/放置重叠拒绝）
const CLICK_CONSUMED_PASS = 'consumed-pass'; // 已消费 + 交后续段
const CLICK_PASS = 'pass';                   // 未消费 + 交后续段
const exitsMethod = (state) => state === CLICK_CONSUMED || state === CLICK_ABORT;

export class InteractionController {
  constructor(game) {
    this.game = game;
  }

  handleMouseInput(dt) {
    const g = this.game;
    g._miningActive = false; // 默认非挖掘（早退分支自然复位）
    // 弓蓄力通道（Idea-2A）：独立于下方单击分支——蓄力中吞掉全部右键语义防中途误触，
    // 松手在此检测（mouseup 后 controls.mouseRight 变 false，下方 mouseRight 块不会再进）。
    if (exitsMethod(this._handleBowChannel(dt))) return;
    if (g._anyInputBlockingUI()) return; // 信标/石碑同样阻断（清单唯一入口）
    // 对空可持弓/掷眼（分支不依赖命中）——放宽未命中早退
    const heldNow = g.inventory.getSelected();
    const bowLikeHeld = !!heldNow && (heldNow.name === 'bow' || heldNow.name === 'ender_eye');
    if (!g.selectedBlock && !(g.controls.mouseLeft && g.mobManager) &&
        !(g.controls.mouseRight && bowLikeHeld)) return;

    if (exitsMethod(this._handleLeftClick(dt))) return;
    // 末段：右键链路（交互 → 放置 → 弓/掷眼），出口由段内协议自行收口
    this._handleRightClick();
  }

  // 段①：弓蓄力通道。CLICK_ABORT = 蓄力接管（不置位 mouseRight，需持续按住）。
  _handleBowChannel(dt) {
    const g = this.game;
    if (g._bowCharging) {
      if (g._anyInputBlockingUI()) { // 信标/石碑同样阻断（清单唯一入口）
        g._cancelBowCharge();
      } else if (!g.controls.mouseRight) {
        g._releaseBow();
      } else {
        const sel = g.inventory.getSelected();
        if (!sel || sel.name !== 'bow') {
          g._cancelBowCharge();
          g.controls.mouseRight = false; // 中途换手持物：本次按住作废，不触发其它分支
          return CLICK_CONSUMED_PASS; // 已消费（本次按住作废）+ 交后续段
        } else {
          g._bowCharge = Math.min(1, g._bowCharge + dt); // 1 秒满蓄
          g.hand.setBowDraw(g._bowCharge);
          return CLICK_ABORT; // 蓄力接管：不置位 mouseRight（按住期间），整方法退出
        }
      }
    }
    return CLICK_PASS; // 未蓄力 / 已取消（UI 或换物）/ 已松手：交后续段
  }

  // 段②：左键链（联机互殴 → 怪物 → 创造瞬破 → 生存挖掘 → 旁观）。
  _handleLeftClick(dt) {
    const g = this.game;
    let leftConsumed = false; // 本段是否已在分支内原地置位 controls.mouseLeft = false（协议：consumed-pass）
    if (g.controls.mouseLeft) {
      // 联机互殴：先检测远端玩家（射线命中优先于怪物）；Idea-4A：房间关闭 PvP 时跳过远端检测
      if (g.networkMode && g.net && g.net.roomSettings?.pvp !== false && !g.inventoryScreen?.visible) {
        const { origin, dir } = g._frameRay();
        const rp = g._findRemoteByRay(origin, dir, 4);
        if (rp) {
          g.hand.swing(); // 阶段10：命中远端玩家挥动
          g.net.sendAttackPlayer(rp.id, g.getAttackDamage());
          g.controls.mouseLeft = false;
          return CLICK_CONSUMED;
        }
      }
      // 先尝试攻击怪物
      if (g.mobManager && !g.inventoryScreen?.visible) {
        const { origin, dir } = g._frameRay();
        const damage = g.player.creative ? 100 : g.getAttackDamage();
        // Build 20 ④：创造玩家攻击不激怒中立/守卫生物（怪物不以创造玩家为敌）
        const hit = g.mobManager.attackMob(origin, dir, 4, damage, { provoke: !g.player.creative });
        if (hit) {
          g.hand.swing(); // 阶段10：命中怪物挥动
          g.controls.mouseLeft = false;
          return CLICK_CONSUMED;
        }
      }
      
      if (!g.selectedBlock) return CLICK_ABORT; // 未消费：整方法退出
      const hit = g.selectedBlock;
      const def = BlockRegistry.getById(hit.id);
      if (!def) return CLICK_ABORT; // 未消费：整方法退出
      
      if (g.player.creative) {
        if (g.particles) g.particles.burstBlockBreak(hit.block.x + BLOCK_CENTER, hit.block.y, hit.block.z + BLOCK_CENTER, def, g.world);
        audio.blockBreak(def);
        if (def.baseBlock === 'chest') g._breakChest(hit.block, false); // B28 家族（四朝向）
        if (def.name === 'beacon') g._breakBeacon(hit.block.x, hit.block.y, hit.block.z); // Idea-2D-③：清激活状态+光柱
        if (def.name === 'shulker_box') g._breakShulkerBox(hit.block, false); // Idea-2C：创造也掉盒（内容跟随）
        if (def.baseBlock === 'furnace') g._breakFurnace(hit.block); // B28 家族（四朝向 × 点燃态）
        if (def.name === 'end_crystal') g._breakCrystal(hit.block.x, hit.block.y, hit.block.z);
        // Build 20 ④：创造挖星髓不再激怒潮鸣（激怒调用仅生存分支保留）
        if (def.name === 'gale_block') g._clearGaleColumn(hit.block.x, hit.block.y, hit.block.z); // 批次 B：拆风阵块清气流柱
        g._removeShapedPartner(def, hit.block.x, hit.block.y, hit.block.z); // B27 门/床：创造瞬破同样连动另一半
        g.world.setBlock(hit.block.x, hit.block.y, hit.block.z, 0);
        removeConnectedPortals(g.world, hit.block.x, hit.block.y, hit.block.z);
        if (g.redstone) g.redstone.onBlockChange(hit.block.x, hit.block.y, hit.block.z);
        g.controls.mouseLeft = false;
        leftConsumed = true;
      } else if (g.player.survival) {
        // 挖掘进度（工具类型匹配加速：tier 速度表；无工具/类型不符 1 倍）
        const hardness = def.hardness;
        if (hardness < 0 || def.fluid) { g.controls.mouseLeft = false; return CLICK_CONSUMED; }
        const held = g._heldToolItem();
        // 信标急迫效果（Idea-2D-③）：每级 +30% 挖掘速度（叠加在工具速度倍率上）
        const haste = g.player.getEffectLevel ? g.player.getEffectLevel('haste') : 0;
        const speedMul = (held && held.tool === def.tool
          ? (held.name.startsWith('gold_') ? 9 : (TOOL_TIER_SPEED[held.tier] || 1)) : 1)
          * (1 + 0.3 * haste);
        // 阶段11：挥动节奏与挖掘进度联动——挥动周期 ≈ 实际挖穿耗时（硬块深而慢、软块轻快）
        const breakTime = Math.min(10, Math.max(0.1, hardness / speedMul));
        g.hand.miningPeriod = Math.min(1.0, Math.max(0.25, breakTime));
        g._miningActive = true;
        g.breakingProgress += dt * speedMul / hardness;
        g.breakMesh.visible = true;
        g.breakMesh.position.set(hit.block.x + BLOCK_CENTER, hit.block.y + BLOCK_CENTER, hit.block.z + BLOCK_CENTER);
        g.breakMesh.material.opacity = Math.min(0.5, g.breakingProgress * 0.5);
        // 挖掘中小碎粒（每 0.25s 一两粒）
        g._miningPuffTimer = (g._miningPuffTimer || 0) + dt;
        if (g._miningPuffTimer >= 0.25 && g.particles) {
          g._miningPuffTimer = 0;
          g.particles.puffMining(hit.block.x + BLOCK_CENTER, hit.block.y, hit.block.z + BLOCK_CENTER, def, g.world);
          audio.digHit(def); // 挖掘命中音（与碎粒同节奏，天然限频）
        }
        if (g.breakingProgress >= 1) {
          if (g.particles) g.particles.burstBlockBreak(hit.block.x + BLOCK_CENTER, hit.block.y, hit.block.z + BLOCK_CENTER, def, g.world);
          audio.blockBreak(def);
          if (def.baseBlock === 'chest') g._breakChest(hit.block, true); // B28 家族（四朝向）
          if (def.name === 'beacon') g._breakBeacon(hit.block.x, hit.block.y, hit.block.z); // Idea-2D-③：清激活状态+光柱
          if (def.name === 'shulker_box') g._breakShulkerBox(hit.block, true); // Idea-2C：内容跟随盒体
          if (def.baseBlock === 'furnace') g._breakFurnace(hit.block); // B28 家族（四朝向 × 点燃态）
          if (def.name === 'end_crystal') g._breakCrystal(hit.block.x, hit.block.y, hit.block.z);
          if (def.name === 'star_marrow_ore') g.mobManager?.angerTideEchoes(hit.block.x, hit.block.y, hit.block.z); // 批次 B：潮鸣激怒
          if (def.name === 'gale_block') g._clearGaleColumn(hit.block.x, hit.block.y, hit.block.z); // 批次 B：拆风阵块清气流柱
          g._removeShapedPartner(def, hit.block.x, hit.block.y, hit.block.z); // B27 门/床：破坏任一半连动另一半
          g.world.setBlock(hit.block.x, hit.block.y, hit.block.z, 0);
          removeConnectedPortals(g.world, hit.block.x, hit.block.y, hit.block.z);
          if (g.redstone) g.redstone.onBlockChange(hit.block.x, hit.block.y, hit.block.z);
          g.breakingProgress = 0;
          g.breakMesh.visible = false;
          g.controls.mouseLeft = false;
          leftConsumed = true;
          const drops = g._blockDrops(def);
          if (drops.length > 0) {
            for (const d of drops) {
              if (g.networkMode && g.net) {
                // 联机：生成物理掉落物（服务器广播 drop_spawn，各端看到同一个），谁都能拾取
                g.net.sendDropSpawn(hit.block.x + BLOCK_CENTER, hit.block.y + BLOCK_CENTER, hit.block.z + BLOCK_CENTER, d.name, d.count);
              } else {
                // 单机：简化直接进入背包
                g.inventory.add(d.name, d.count);
              }
            }
            g.hotbar.update();
            // 挖矿经验（掉落被门控拒绝时不给——与原版"错误工具无掉落也无经验"一致）
            const oreXp = ORE_XP[def.name];
            if (oreXp) g.player.addXp(oreXp);
          }
        }
      } else if (g.player.spectator) {
        g.controls.mouseLeft = false;
        leftConsumed = true;
      }
    } else {
      g.breakingProgress = 0;
      g.breakMesh.visible = false;
    }
    return leftConsumed ? CLICK_CONSUMED_PASS : CLICK_PASS; // 段末出口：已消费（创造瞬破/挖穿/旁观）或本段未命中
  }

  // 段③：右键链（村民/熔炉/食物/容器/红石/桶/门床/放置/弓/掷眼），末段。
  _handleRightClick() {
    const g = this.game;
    if (g.controls.mouseRight) {
      // T5：右键村民优先交互（开交易屏；旁观不可）
      if (g.mobManager && g.tradeScreen && !g.player.spectator) {
        const { origin: o, dir: d } = g._frameRay();
        const mh = g.mobManager.findMobByRay(o, d, 4);
        if (mh && mh.mob.typeName === 'villager' && !mh.mob.dead) {
          g.tradeScreen.show(mh.mob);
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
      }

      // 右键熔炉打开熔炉界面（方块交互优先于手持食物食用，与原版一致）
      const furnaceHit = g.selectedBlock;
      const furnaceDef = furnaceHit ? BlockRegistry.getById(furnaceHit.id) : null;
      if (furnaceDef && furnaceDef.baseBlock === 'furnace' && g.furnaceScreen && !g.player.spectator) {
        g.furnaceScreen.show(furnaceHit.block.x, furnaceHit.block.y, furnaceHit.block.z);
        g.controls.mouseRight = false;
        return CLICK_CONSUMED;
      }

      const hit = g.selectedBlock;
      const sel = g.inventory.getSelected();

      // 先处理食用：手持物品是食物且玩家不在创造/旁观模式且饥饿未满
      if (sel && g.player.survival) {
        const itemDef = ItemRegistry.getByName(sel.name);
        if (itemDef && itemDef.food && g.player.food < g.player.maxFood) {
          if (g.player.eat(itemDef)) {
            g.hand.swing(); // 阶段10：进食挥动
            audio.eat();
            g.inventory.removeSelected(1);
            g.hotbar.update();
            if (itemDef.name === 'chorus_fruit') g._chorusTeleport(); // 紫颂果随机短距传送
          }
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
      }

      // 经验瓶：饮用 +3~11 经验（原版区间 3-11），消耗 1 个
      if (sel && g.player.survival && sel.name === 'experience_bottle') {
        g.hand.swing();
        g.inventory.removeSelected(1);
        g.hotbar.update();
        g.player.addXp(3 + Math.floor(Math.random() * 9));
        g.controls.mouseRight = false;
        return CLICK_CONSUMED;
      }

      // B27 门/活板门：右键开关（木门/活板门切换整扇；铁门仅红石——原版语义）
      if (furnaceDef && furnaceDef.part && !g.player.spectator &&
          (furnaceDef.part === 'door_lower' || furnaceDef.part === 'door_upper' || furnaceDef.part === 'trapdoor')) {
        if (furnaceDef.baseBlock === 'oak_door' || furnaceDef.part === 'trapdoor') {
          if (g.redstone) {
            g.redstone.toggleDoor(furnaceHit.block.x, furnaceHit.block.y, furnaceHit.block.z);
            audio.blockPlace(furnaceDef); // 开关音沿用材质分路（wood）
          }
        }
        g.controls.mouseRight = false;
        return CLICK_CONSUMED;
      }

      // 床：非主世界引爆（原版语义——床只能在主世界睡）；主世界记重生点 + 夜间入睡
      if (furnaceDef && (furnaceDef.part === 'bed_foot' || furnaceDef.part === 'bed_head') && !g.player.spectator) {
        if (g.world.dimension !== 'overworld') {
          g.bedSpawn = null;
          const bx = furnaceHit.block.x + BLOCK_CENTER, by = furnaceHit.block.y + BLOCK_CENTER, bz = furnaceHit.block.z + BLOCK_CENTER;
          if (g.mobManager) g.mobManager.pendingExplosions.push({ x: bx, y: by, z: bz, radius: 3 }); // 另一半床体一并清除
          const d = g.player.position.distanceTo(new THREE.Vector3(bx, by, bz));
          const dmg = Math.round(12 * Math.max(0, 1 - d / 6));
          if (dmg > 0) g.player.hurt(dmg, 'bed', true);
          if (g.chatBox) g.chatBox.add(t('床在这个维度无法安眠——轰！'), '#faa');
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
        g.bedSpawn = { x: furnaceHit.block.x, y: furnaceHit.block.y, z: furnaceHit.block.z, dimension: g.world.dimension };
        if (!g.networkMode && g.sky.isNight()) {
          if (g._hostileNearby(8)) {
            if (g.chatBox) g.chatBox.add(t('你现在无法入睡，附近有怪物在游荡'), '#fcc');
          } else {
            if (g.chatBox) g.chatBox.add(t('你睡了一觉，重生点已设置'), '#cfc');
            g.sleepOverlay.show(() => { g.sky.time = 0.25; }); // 全黑瞬间跳日出
          }
        } else if (g.chatBox) {
          g.chatBox.add(g.networkMode ? t('重生点已设置（联机时间由服务器管理）') : t('重生点已设置（夜晚右键床可直接入睡）'), '#cfc');
        }
        audio.blockPlace(furnaceDef); // 床交互音（cloth 分路）
        g.controls.mouseRight = false;
        return CLICK_CONSUMED;
      }

      // 先检查是否右键点击了工作台
      if (hit) {
        const targetDef = BlockRegistry.getById(hit.id);
        if (targetDef && targetDef.name === 'crafting_table') {
          g.inventoryScreen.show(3);
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
        // T5：右键箱子/潜影盒打开容器界面（创造/生存都可；旁观不可）
        if (targetDef && (targetDef.baseBlock === 'chest' || targetDef.name === 'shulker_box') && g.chestScreen && !g.player.spectator) {
          g.chestScreen.show(hit.block.x, hit.block.y, hit.block.z);
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
        // Idea-2D-③：右键信标打开效果选择界面（旁观不可）
        if (targetDef && targetDef.name === 'beacon' && g.beaconScreen && !g.player.spectator) {
          g.beaconScreen.show(hit.block.x, hit.block.y, hit.block.z);
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
        // 天域批次 A：右键石碑读碑文（世界观批次 W3 起按 stele 家族标记判定——
        // 修复 wind_stele 硬编码导致 ember/moss 石碑无法右键阅读的遗漏；章节走 steleChapterAt）
        // 终局篇 F3：守望界碑听潮门控（候潮 ∧ 未听过 → 触发仪式；否则照旧读章）
        if (targetDef && targetDef.stele && g.steleScreen && !g.player.spectator) {
          if (!g._tryListenTide(hit.block)) {
            g.steleScreen.open(hit.block.x, hit.block.y, hit.block.z);
          }
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
        // 天域批次 C：恒昼祭坛——持风暴图腾右键召唤守誓巨像（可重复；房间 mobs:false 拒绝）
        // 天域批次 D：无图腾右键 → 尝试复潮仪式
        if (targetDef && targetDef.name === 'aether_altar' && !g.player.spectator) {
          if (sel && sel.name === 'storm_totem') {
            if (g.networkMode && g.net && g.net.roomSettings && g.net.roomSettings.mobs === false) {
              if (g.chatBox) g.chatBox.add(t('该房间已关闭怪物生成，祭坛无视图腾。'), '#fbb');
            } else {
              if (g.player.survival) {
                g.inventory.removeSelected(1);
                g.hotbar.update();
              }
              // 殿前苏醒：底台东缘（门侧）地面高度，rise 阶段立起后进入岩卫
              g.mobManager?._spawnAt('storm_colossus', hit.block.x + 6.5, hit.block.y + 2.05, hit.block.z + BLOCK_CENTER);
              if (g.particles) {
                const marrowDef = BlockRegistry.getByName('star_marrow_block');
                if (marrowDef) g.particles.burstBlockBreak(hit.block.x + BLOCK_CENTER, hit.block.y + 2, hit.block.z + BLOCK_CENTER, marrowDef, g.world);
              }
            }
          } else {
            g._tryTideRitual(hit.block); // 批次 D：无图腾 → 尝试复潮仪式
          }
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
        // 天域批次 D：潮心祭坛——献证候潮（终局篇 F1）/ 浮现第九章碑文（复潮）
        if (targetDef && targetDef.name === 'tide_altar' && g.steleScreen && !g.player.spectator) {
          g._tryPrimordialOffering(hit.block); // 三证齐 → 置换原初祭坛候潮；否则照旧浮现复潮章
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
        // 终局篇 F1/K2：原初祭坛——右键浮现候潮章（候潮态受体，随时可复读）
        if (targetDef && targetDef.name === 'primordial_altar' && g.steleScreen && !g.player.spectator) {
          g.steleScreen.open(hit.block.x, hit.block.y, hit.block.z, 'tide_waiting');
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
        // 红石交互：拉杆/按钮
        if (targetDef && g.redstone) {
          const interacted = g.redstone.onBlockInteract(hit.block.x, hit.block.y, hit.block.z, hit.id);
          if (interacted) {
            g.controls.mouseRight = false;
            return CLICK_CONSUMED;
          }
        }
        // 桶：空桶只舀流体源（流动等级方块不可舀，原版规则）/ 满桶对任意面倒出（倒出即触发流动模拟）
        if (sel && sel.name === 'bucket' && targetDef && targetDef.fluid
            && (targetDef.name === 'water' || targetDef.name === 'lava')) {
          const filled = targetDef.name === 'water' ? 'water_bucket' : 'lava_bucket';
          g.world.setBlock(hit.block.x, hit.block.y, hit.block.z, 0);
          if (g.player.survival) {
            g.inventory.slots[g.inventory.hotbarSelected] = { name: filled, count: 1, data: null };
            g.hotbar.update();
          }
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
        if (sel && (sel.name === 'water_bucket' || sel.name === 'lava_bucket') && hit) {
          const fluid = sel.name === 'water_bucket' ? 'water' : 'lava';
          const fx = hit.block.x + hit.normal.x, fy = hit.block.y + hit.normal.y, fz = hit.block.z + hit.normal.z;
          if (g.world.getBlock(fx, fy, fz) === 0) {
            g.world.setBlock(fx, fy, fz, BlockRegistry.getId(fluid));
            if (g.player.survival) {
              g.inventory.slots[g.inventory.hotbarSelected] = { name: 'bucket', count: 1, data: null };
              g.hotbar.update();
            }
            g.controls.mouseRight = false;
            return CLICK_CONSUMED;
          }
        }
        // 传送门点火：打火石右键黑曜石框→下界门 / 萤石框→天域门（迭代 M2）
        if (sel && sel.name === 'flint_and_steel' && targetDef) {
          if (g._tryLightPortal(hit, targetDef)) {
            g.controls.mouseRight = false;
            return CLICK_CONSUMED;
          }
        }
        // 末地传送门逐框激活：末影之眼右键无眼框架（迭代 M3）
        if (sel && sel.name === 'ender_eye' && targetDef) {
          if (g._tryPlaceEndEye(hit, targetDef)) {
            g.controls.mouseRight = false;
            return CLICK_CONSUMED;
          }
        }
        // 耕种：骨粉催熟/右键收获/播种/锄地（作物与耕地专属，不与放置路径冲突）
        if (g._tryFarmInteract(hit, targetDef, sel)) {
          g.controls.mouseRight = false;
          return CLICK_CONSUMED;
        }
      }
      
      if (sel && hit) {
        const placeX = hit.block.x + hit.normal.x;
        const placeY = hit.block.y + hit.normal.y;
        const placeZ = hit.block.z + hit.normal.z;

        const blockDef = BlockRegistry.getByName(sel.name);
        if (blockDef) {
          // 检查是否会与玩家重叠（H1 修复：守卫只对可放置方块生效，非方块手持物不被吞）
          const px = g.player.position.x, py = g.player.position.y, pz = g.player.position.z;
          if (placeX >= Math.floor(px - 0.3) && placeX <= Math.floor(px + 0.3) &&
              placeY >= Math.floor(py) && placeY <= Math.floor(py + 1.8) &&
              placeZ >= Math.floor(pz - 0.3) && placeZ <= Math.floor(pz + 0.3)) {
            return CLICK_ABORT; // 放置邻格与玩家重叠：未消费
          }
          g.hand.swing(); // 阶段10：放置方块挥动
          // B27：门/床/活板门形制放置（多格 + 朝向；失败不消耗）
          if (blockDef.part && g._tryPlaceShaped(placeX, placeY, placeZ, blockDef)) {
            if (g.player.survival) {
              g.inventory.removeSelected(1);
              g.hotbar.update();
            }
            g.controls.mouseRight = false;
            return CLICK_CONSUMED;
          }
          // B28 定向面方块（箱子/熔炉/头颅）：正面朝玩家 → 放置时换成对应朝向态 ID
          // （家族态之间共享同一物品；掉落/取物经 baseBlock 映射回基础名）
          const placedId = blockDef.facingBase
            ? (facingId(blockDef.facingBase, g._facingTowardPlayer(placeX, placeZ)) || blockDef.id)
            : blockDef.id;
          g.world.setBlock(placeX, placeY, placeZ, placedId);
          audio.blockPlace(blockDef);
          if (g.redstone) g.redstone.onBlockChange(placeX, placeY, placeZ);
          g._trySummonIronGolem(placeX, placeY, placeZ); // Idea-2E：铁傀儡召唤检测（南瓜/铁块完成 T 型）
          g._trySummonWither(placeX, placeY, placeZ); // Idea-2D-②：凋灵召唤检测（灵魂沙 + 头颅 T 型）
          // Idea-2C：潜影盒放置——物品内容落入容器账本并整箱广播（远端账本一致）
          if (blockDef.name === 'shulker_box') {
            const items = Array.isArray(sel.data) ? sel.data.slice(0, 27) : [];
            while (items.length < 27) items.push(null);
            g.world.setContainer(placeX, placeY, placeZ, items);
            if (g.networkMode && g.net) g.net.sendContainerSet(placeX, placeY, placeZ, items);
          }
          // 天域批次 B：风阵块放置 → 上方 12 格写风流柱（逐格 setBlock，联机自动逐格上报）
          if (blockDef.name === 'gale_block') g._writeGaleColumn(placeX, placeY, placeZ);
          if (g.player.survival) {
            g.inventory.removeSelected(1);
            g.hotbar.update();
          }
        }
      }
      // 弓：按住蓄力，松手发射（初速/伤害随 charge 插值；命中怪复用 attackMob 链）
      // 对准可交互物时上方单击分支优先，只有走到这里才进入蓄力——单击语义不误触。
      if (sel && sel.name === 'bow') {
        const hasArrow = g.player.creative || g.inventory.slots.some(s => s && s.name === 'arrow');
        if (hasArrow) {
          g._bowCharging = true; // 不消耗 mouseRight：按住期间由顶部蓄力通道累计，松手在顶部检测
          g._bowCharge = 0;
          g.hand.setBowDraw(0);
        } else {
          g.controls.mouseRight = false; // 无箭：维持原行为（不射）
          return CLICK_CONSUMED; // 无箭：已消费 + 整方法退出
        }
        return CLICK_ABORT; // hasArrow：蓄力接管（不置位，按住期间由顶部通道累计）
      }
      // 掷末影之眼：不依赖命中（对空掷出——原版手势）；嵌入框架分支已在上方 return
      if (sel && sel.name === 'ender_eye' && g.world.dimension === 'overworld') {
        g._throwEnderEye();
        return CLICK_ABORT; // 掷出分支自身不置位：右键状态留待后续帧收口
      }
      g.controls.mouseRight = false;
      return CLICK_CONSUMED; // 末尾兜底：已消费（置位在上）+ 整方法退出
    }
    return CLICK_PASS; // 右键未按下（或被前段消费）：本段无动作
  }
}
