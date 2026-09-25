// Game.js -- 游戏主类：管理所有子系统
import * as THREE from 'three';
import { Renderer } from '../render/Renderer.js';
import { Sky } from '../render/Sky.js';
import { SVGTextures } from '../render/SVGTextures.js';
import { ChunkMeshBuilder, RenderQuality } from '../render/ChunkMesh.js';
import { World } from '../core/World.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { Player } from './Player.js';
import { Physics, GLIDE_GRAVITY } from './Physics.js';
import { CROP_MAX_STAGE, isCropId, cropStageOf, cropIdAtStage, isHydrated } from '../core/crops.js';
import { Controls } from './Controls.js';
import { Inventory } from './Inventory.js';
import { Raycast } from './Raycast.js';
import { Hotbar, setSvgMaps } from '../ui/Hotbar.js';
import { Hud } from '../ui/Hud.js';
import { InfoBar } from '../ui/InfoBar.js';
import { InventoryScreen } from '../ui/InventoryScreen.js';
import { ChestScreen } from '../ui/ChestScreen.js';
import { BeaconScreen, BEACON_EFFECTS } from '../ui/BeaconScreen.js';
import { SteleScreen } from '../ui/SteleScreen.js';
import { t } from '../i18n/index.js';
import { tName } from '../i18n/name.js';
import { getDisplayName } from '../ui/itemName.js';
import { FurnaceScreen } from '../ui/FurnaceScreen.js';
import { RecipeViewer } from '../ui/RecipeViewer.js';
import { TradeScreen } from '../ui/TradeScreen.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { DeathScreen } from '../ui/DeathScreen.js';
import { CommandPanel } from '../ui/CommandPanel.js';
import { ChatBox } from '../ui/ChatBox.js';
import { BossBar } from '../ui/BossBar.js';
import { PortalOverlay } from '../ui/PortalOverlay.js';
import { SleepOverlay } from '../ui/SleepOverlay.js';
import { CHUNK_SIZE, Chunk, CHUNK_HEIGHT } from '../core/Chunk.js';
import { FINALE_TIDE_SEGMENTS, FINALE_TIDE_DURATION, finaleEnvelope, finalePulse, finaleListenGate } from '../world/finale-tide.js';
import {
  PORTAL_KINDS, DIM_PORTAL_KINDS, ARRIVAL_PLATFORM,
  portalBlockId, portalTargetPos, detectPortalInterior, fillPortal,
  findPortalNear, buildReturnPortal, removeConnectedPortals,
  detectEndRing, fillEndPortalCenter, buildEndReturnPad,
  buildGatewayPad, gatewayTarget,
} from '../core/Portals.js';
import { gatewayPlacements } from '../world/dimensions/end.js';
import { ringPoints } from '../world/structures/stronghold.js';
import { matchRecipe } from '../core/Crafting.js';
import { SMELT_TIME, getSmeltingResult, getFuelTime } from '../core/Smelting.js';
import { MobManager } from '../entity/MobManager.js';
import { Mob } from '../entity/Mob.js';
import { LocalPlayerModel } from '../entity/LocalPlayerModel.js';
import { VoxelLightUniforms, GfxState, ShadowUniforms } from '../render/VoxelLight.js';
import { RedstoneSystem } from '../core/RedstoneSystem.js';
import { doorId, trapdoorId, bedId, facingId, furnaceLitId } from '../core/blockShape.js';
import { SaveSystem } from '../core/SaveSystem.js';
import { getDimension, setAetherDuskProfile } from '../core/dimensions.js';
import { DEFAULT_BIOME_SCALE, safeBiomeScale } from '../world/biomes.js';
import { FirstPersonHand } from '../render/FirstPersonHand.js';
import { ParticleSystem } from '../render/ParticleSystem.js';
import { loadSettings, applySettings, applyFogRange } from '../core/Settings.js';
import { audio } from '../audio/AudioEngine.js';
import { TerrainWorkerClient } from '../workers/TerrainWorkerClient.js';
import { MeshWorkerClient } from '../workers/MeshWorkerClient.js';
import { playerColorCss } from '../net/playerColor.js';

// 工具挖掘速度倍率（按物品 tier；金质单独 9 倍——原版金工具挖得快但等级低）
const TOOL_TIER_SPEED = { 1: 2, 2: 4, 3: 6, 4: 8 };

// 信标效果名（英文）→ 当前语言显示名（语言包键 = 效果中文 label，见 BeaconScreen.BEACON_EFFECTS）
function beaconEffectLabel(name) {
  const e = BEACON_EFFECTS.find(x => x[0] === name);
  return t(e ? e[1] : name);
}

// 挖矿经验（原版口径：煤/红石/青金/钻/绿宝给，铁金不给；门控掉落成功才结算）
const ORE_XP = {
  coal_ore: 1, deepslate_coal_ore: 1,
  redstone_ore: 2, lapis_ore: 3,
  diamond_ore: 7, deepslate_diamond_ore: 7, emerald_ore: 7,
};

// 鞘翅滑翔气动参数（每秒口径；重力/下沉上限在 Physics.js）
const GLIDE_THRUST = 8;    // 俯冲推进加速度上限 m/s²（按 -sin(pitch) 比例；与气动阻尼平衡出俯冲极速 ~27m/s）
const GLIDE_DRAG = 0.994;  // 水平气动阻尼（pow 基，dt*60 口径；过强会把拉起后的翱翔窗口掐死）
const GLIDE_BRAKE = 0.5;   // 拉起刹车强度（sin(pitch) 比例的水平动能损耗；过大会瞬间失速翱翔不出）
const GLIDE_LIFT = 6;      // 拉起升力系数（升力 = sin(pitch)·vAlong·此值；升力超过滑翔重力才净爬升）
const GLIDE_DEPLOY_VY = -0.5; // 展开阈值：空中下落至此速度自动展开（落体展开，原版式）

// 触发方块/物品定义注册
import '../blocks/BlockDefs.js';
import '../items/ItemDefs.js';
import { BlockSVGDefinitions } from '../blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';

export class Game {
  constructor(container) {
    this.container = container;
    this.renderer = new Renderer(container);
    this.sky = new Sky(this.renderer.scene);
    this.player = new Player(this.renderer.camera);
    this.physics = new Physics(null);
    this.controls = new Controls(this.renderer.domElement, this.player);
    this.controls.onPickBlock = () => this._pickBlock(); // Build 20 ③：创造中键取物
    this.inventory = new Inventory();
    this.hud = new Hud();
    this.infoBar = new InfoBar();
    this.sleepOverlay = new SleepOverlay(); // B27 睡眠黑屏过渡（无状态表现层，跨存档复用）
    // 视频设置：加载并实时套用（FOV/亮度/云/灵敏度/AO 等，主菜单期即可生效）
    this.settings = loadSettings();
    applySettings(this);
    this.raycast = null;
    this.chunkBuilder = null;
    this.world = null;
    this.hotbar = null;
    this.inventoryScreen = null;
    this.chestScreen = null;
    this.beaconScreen = null;
    this.steleScreen = null;
    this.tradeScreen = null;
    this.pauseMenu = null;
    this.deathScreen = null;
    this.commandPanel = null;
    this.cheatsEnabled = false;
    this.aetherDusk = false; // 天域批次 D：复潮状态（存档/联机恢复，档案覆盖见 start）
    this.finaleInfo = null; // 终局篇 F3：WORLD_INFO 先达暂存（offered/done/坐标，start 落地）
    this.biomeScale = DEFAULT_BIOME_SCALE; // 生物群系规模档位（新建走参数/联机消息，载入走存档）
    this.paused = false;
    // 阶段10：第一人称手持物（跨存档共享相机挂点，start 时重置手持内容）
    this.hand = new FirstPersonHand(this);
    // Build 20 ⑤：本地玩家第三人称模型（跨存档共享场景挂点，可见性随视角模式）
    this.playerModel = new LocalPlayerModel(this.renderer.scene, this);
    this.currentSlot = 1;
    this.onExit = null;
    this.mobManager = null;
    this.selectedBlock = null;
    this.breakingProgress = 0;
    this._miningActive = false; // 阶段11：本端正在挖掘（联机随 player_state 广播 mine 标志）
    this._bowCharging = false;  // Idea-2A：弓蓄力中（右键按住期间，独立于单击分支）
    this._bowCharge = 0;        // 蓄力进度 0..1（1 秒满蓄）
    this.lastTime = 0;
    this.running = false;
    this.frame = 0;
    this.autoSaveTimer = 0;
    this.autoSaveInterval = 30; // 每30秒自动保存
    // 传送门穿越状态：站门累积计时 / 武装标记（离开门体才重新触发）/ 到达冷却
    this._portalTimer = 0;
    this._portalArmed = true;
    this._portalCooldown = 0;
    this.networkMode = false;   // 局域网联机模式
    this.net = null;            // NetworkManager 实例（由 main.js 注入）
    this.remotePlayers = new Map(); // id -> RemotePlayer 远端玩家
    this.chatBox = null;        // 联机聊天框
    this.spectating = false;    // 是否处于观战模式（死亡后旁观其他玩家）
    this.spectateTargetId = null; // 当前观战跟随的玩家 id（null=自由飞行）
    // 阶段6 观战相机平滑：跟随目标时对位置/朝向做指数平滑，切换目标/目标瞬移时不跳变
    this._specSmoothed = null;    // Vector3，平滑后的观战位置
    this._specSmoothYaw = 0;
    this._specSmoothPitch = 0;
    
    this.blockSvgMap = BlockSVGDefinitions;
    this.itemSvgMap = ItemSVGDefinitions;
    setSvgMaps(ItemSVGDefinitions, BlockSVGDefinitions);
    
    // 高亮选中方块的线框
    const wireGeo = new THREE.BoxGeometry(1.001, 1.001, 1.001);
    const edges = new THREE.EdgesGeometry(wireGeo);
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
    this.highlight.visible = false;
    this.renderer.scene.add(this.highlight);
    
    // 破坏进度方块
    const breakGeo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
    this.breakMesh = new THREE.Mesh(breakGeo, new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, depthWrite: false }));
    this.breakMesh.visible = false;
    this.renderer.scene.add(this.breakMesh);
    
    this.setupKeyBindings();
    this._setupPauseOnUnlock();
  }

  _setupPauseOnUnlock() {
    document.addEventListener('pointerlockchange', () => {
      if (!this.running || this.paused) return;
      if (document.pointerLockElement) return;
      if (!this.controls.enabled) return;
      if (this.chatBox && this.chatBox.input) return; // 聊天输入中不弹暂停
      if (this.inventoryScreen && this.inventoryScreen.visible) return;
      if (this.chestScreen && this.chestScreen.visible) return;
      if (this.beaconScreen && this.beaconScreen.visible) return;
      if (this.steleScreen && this.steleScreen.visible) return;
      if (this.furnaceScreen && this.furnaceScreen.visible) return;
      if (this.tradeScreen && this.tradeScreen.visible) return;
      if (this.commandPanel && this.commandPanel.visible) return;
      if (this.pauseMenu && this.pauseMenu.visible) return;
      if (this.deathScreen && this.deathScreen.visible) return;
      this.pauseMenu?.show();
    });
  }

  // 清理旧世界所有 Three.js 资源和 UI DOM，防止切换存档时残留"幽灵方块"等
  _disposeWorld() {
    const scene = this.renderer.scene;
    // B-①/B-②：地形/网格 Worker 随世界销毁（新建型资源，跨存档/换维必须 terminate）
    if (this.world && this.world.terrainWorker) this.world.terrainWorker.dispose();
    if (this.world && this.world.meshWorker) this.world.meshWorker.dispose();
    // 旧区块网格
    if (this.world && this.world.chunks) {
      for (const chunk of this.world.chunks.values()) {
        if (chunk.mesh) { scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); }
        if (chunk.waterMesh) { scene.remove(chunk.waterMesh); chunk.waterMesh.geometry.dispose(); }
        if (chunk.lightMesh) { scene.remove(chunk.lightMesh); chunk.lightMesh.geometry.dispose(); }
      }
    }
    // 旧怪物和掉落物 + 释放 type 级共享 mesh/texture/material 资源
    if (this.mobManager) {
      this.mobManager.dispose();
    }
    // 高亮和破坏进度
    this.selectedBlock = null;
    this.breakingProgress = 0;
    if (this.highlight) this.highlight.visible = false;
    if (this.breakMesh) this.breakMesh.visible = false;
    // 粒子系统（新建型：随世界销毁）
    if (this.particles) { this.particles.dispose(); this.particles = null; }
    if (this.fireParticles) { this.fireParticles.dispose(); this.fireParticles = null; }
    // 旧 UI DOM
    if (this.hotbar) { this.hotbar.el.remove(); this.hotbar = null; }
    if (this.inventoryScreen) {
      if (this.inventoryScreen.tooltip) this.inventoryScreen.tooltip.remove();
      if (this.inventoryScreen.cursorEl) this.inventoryScreen.cursorEl.remove();
      this.inventoryScreen.el.remove();
      this.inventoryScreen = null;
    }
    if (this.chestScreen) { this.chestScreen.dispose(); this.chestScreen = null; }
    if (this.beaconScreen) { this.beaconScreen.dispose(); this.beaconScreen = null; }
    if (this.steleScreen) { this.steleScreen.dispose(); this.steleScreen = null; }
    if (this.furnaceScreen) { this.furnaceScreen.dispose(); this.furnaceScreen = null; }
    if (this.recipeViewer) { this.recipeViewer.dispose(); this.recipeViewer = null; }
    if (this.tradeScreen) { this.tradeScreen.dispose(); this.tradeScreen = null; }
    if (this.pauseMenu) { this.pauseMenu.el.remove(); this.pauseMenu = null; }
    if (this.deathScreen) { this.deathScreen.el.remove(); this.deathScreen = null; }
    if (this.commandPanel) { this.commandPanel.dispose(); this.commandPanel = null; }
    if (this.bossBar) { this.bossBar.dispose(); this.bossBar = null; }
    if (this.portalOverlay) { this.portalOverlay.dispose(); this.portalOverlay = null; }
    // 远端玩家与联机聊天框
    for (const rp of this.remotePlayers.values()) rp.dispose();
    this.remotePlayers.clear();
    if (this.chatBox) { this.chatBox.dispose(); this.chatBox = null; }
  }

  async start(mode, seed, loadData = null, slot = 1, cheatsEnabled = false, networkMode = false, biomeScale = DEFAULT_BIOME_SCALE) {
    try {
    // 清理旧世界资源，防止切换存档时残留
    this._disposeWorld();
    this.currentSlot = slot;
    this.networkMode = networkMode;
    this.paused = false;
    this.running = false;
    this.spectating = false;        // 阶段4：新世界默认不观战
    this.spectateTargetId = null;
    this._specSmoothed = null;      // 阶段6：观战平滑状态重置
    this._specSmoothYaw = 0;
    this._specSmoothPitch = 0;
    // 阶段10：重置第一人称手持物（跨存档共享实例，物品由下方物品栏初始化后同步）
    this.hand.currentName = undefined;
    this.hand.itemGroup.clear();
    this.hand.setVisible(true);
    // 显示加载界面
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
      loadingEl.style.display = 'flex';
      const fill = document.getElementById('load-fill');
      if (fill) fill.style.width = '0%';
    }
    // 如果有存档数据，使用存档的种子和模式
    if (loadData) {
      seed = loadData.seed;
      mode = loadData.gamemode;
      this.cheatsEnabled = !!loadData.cheatsEnabled;
      // 生物群系规模：存档携带（旧存档无字段回落 small，与旧世界逐字节一致）
      this.biomeScale = safeBiomeScale(loadData.biomeScale);
    } else {
      this.cheatsEnabled = !!cheatsEnabled;
      this.biomeScale = safeBiomeScale(biomeScale);
    }

    // 维度：存档携带（V2）或新建默认主世界；世界与天空档案按维度装配
    const dimension = (loadData && loadData.dimension) || 'overworld';
    this.world = new World(seed, dimension, { biomeScale: this.biomeScale });
    // B-①：主世界注入地形 Worker（其余维度生成器类不同，走同步路径）
    if (dimension === 'overworld') this.world.terrainWorker = new TerrainWorkerClient(2);
    this.world.dragonDefeated = !!(loadData && loadData.dragonDefeated); // 末影龙击败标记（存档恢复）
    this.world.finalePrimordial = (loadData && loadData.finalePrimordial) || null; // 候潮状态（终局篇 F1：祭坛坐标，存档恢复）
    this.world.finaleDone = !!(loadData && loadData.finaleDone); // 听潮完成（终局篇 F3：存档恢复）
    this.player.emblemWorn = !!(loadData && loadData.emblemWorn) && this.world.finaleDone; // 佩戴状态（Build 19 K3：仅通关存档有效）
    // LAN：WORLD_INFO 先于 start 到达的候潮/听潮状态（NetworkManager 暂存 finaleInfo）在此落地
    if (this.finaleInfo) {
      if (this.finaleInfo.offered && !this.world.finalePrimordial) {
        this.world.finalePrimordial = { x: this.finaleInfo.x, y: this.finaleInfo.y, z: this.finaleInfo.z };
      }
      if (this.finaleInfo.done) this.world.finaleDone = true; // 历史事实恢复，不重播演出
    }
    // 天域复潮状态（批次 D）：Build 20 ⑦ 修复跨存档泄漏——this.aetherDusk 挂在跨存档
    // 共享的 Game 实例上，旧逻辑"loadData 无字段时保留现值"会让上一存档（A 已复潮）的
    // 状态泄进新开存档 B（B 进天域即永昼被解除）。单机改为只信存档字段（无字段=未复潮；
    // 换维重建的 loadData 合成总是携带该字段，不受影响）；联机保留现值（WORLD_INFO 可能
    // 先于 start 到达，房间状态权威）。
    if (this.networkMode) {
      // 联机：保留现值（WORLD_INFO 先达时 NetworkManager 已写入房间权威状态）
    } else {
      this.aetherDusk = !!(loadData && loadData.aetherDusk);
    }
    if (dimension === 'aether') {
      setAetherDuskProfile(this.aetherDusk);
      this.sky.time = this.aetherDusk ? 0.32 : 0.35; // 复潮后从上午起（能亲眼看到第一次日落）
    }
    if (this.sky) this.sky.applyDimensionProfile(this.world.dimDef);
    // L4-B 太阳阴影：shadow 相机挂在 sunLight 上（Sky 跨存档共享，幂等），target 需入场景
    if (this.renderer.sunShadow) this.renderer.sunShadow.init(this.sky.sunLight, this.renderer.scene);
    this.physics.world = this.world;
    // M4：网络方块钩子必须趁早绑定——start 的异步加载窗口（图集构建/区块加载/
    // 换维等待）内 world 已可用，此时本地放置方块也要上报服务器（曾因绑定过晚
    // 丢失换维后立即放置的方块，联机账本不收敛）
    if (this.networkMode && this.net) this.net.bindWorld(this.world);
    // 耕种：作物登记表钩子（setBlock 全路径收口：种/长/收/破坏/远端同步）+ 生长计时复位
    this.world.onCropBlockChange = (x, y, z, oldId, newId) => this._trackCrop(x, y, z, oldId, newId);
    this._cropTimer = 0;
    // 重置跨存档共享的玩家运行时状态（避免上一存档的 invulnerable / 状态效果残留）
    this.player.invulnerable = 0;
    this.player.clearEffects();
    this.player.viewMode = 0; // Build 20 ⑤：视角回落第一人称（Player 跨存档共享）
    this.playerModel.update(0, this.player, false, false); // 第三人称模型同步隐藏
    // 受击红屏：所有调用 player.hurt(amount, ..., true) 的源都触发
    this.player.onHurt = (amount, source) => {
      if (this.hud) this.hud.flashDamage(amount);
      audio.hurt(amount); // 受击音（与红屏同源触发）
    };
    // 死亡屏的统一入口仍由 updateSurvival 末段处理，这里不重设 onDeath
    this.raycast = new Raycast(this.world);
    this.redstone = new RedstoneSystem(this.world);
    this.redstone.onExplosion = (x, y, z, radius) => {
      const dx = this.player.position.x - x;
      const dy = this.player.position.y + 1 - y;
      const dz = this.player.position.z - z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist < radius * 1.5) {
        const dmg = Math.max(0, (radius * 1.5 - dist) * 8);
        this.player.hurt(dmg, 'explosion', true);
      }
    };
    
    // 恢复修改的方块/容器：V2 按维度分桶装入；V1 旧档字段直接进当前维度桶（迁移）
    if (loadData && (loadData.dimensionBlocks || loadData.dimensionContainers)) {
      this.world.loadDimensionBuckets(loadData.dimensionBlocks, loadData.dimensionContainers, loadData.dimensionFurnaces);
    } else {
      if (loadData && loadData.modifiedBlocks) {
        for (const [key, id] of Object.entries(loadData.modifiedBlocks)) {
          this.world.modifiedBlocks.set(key, id);
        }
      }
      // T5：恢复打开过/改过的容器（箱子）
      if (loadData && loadData.containers) {
        for (const [key, items] of Object.entries(loadData.containers)) {
          if (Array.isArray(items) && items.length === 27) this.world.containers.set(key, items);
        }
      }
    }
    
    // 构建纹理图集（包含怪物纹理）
    const allSvgs = { ...this.blockSvgMap, ...this.itemSvgMap };
    // 先创建 MobManager 并注入怪物 SVG
    this.mobManager = new MobManager(this.world, this.renderer.scene, null, null);
    await this.mobManager.init(allSvgs);
    
    const { atlasTexture, atlasUV } = await SVGTextures.buildAtlas(allSvgs);
    this.atlasUV = atlasUV;
    // 水面独立纹理：RepeatWrapping + 世界坐标 UV 平铺，避免 chunk 边界方格
    this.waterTexture = await SVGTextures.buildRepeatTexture(allSvgs['water'] || '', 'water');
    this.chunkBuilder = new ChunkMeshBuilder(this.world, atlasTexture, atlasUV, this.waterTexture);
    // B-②：网格构建 Worker（维度无关——收集只依赖缓存+图集表；随世界销毁重建）
    this.world.meshWorker = new MeshWorkerClient([...atlasUV.entries()]);
    // 粒子系统（新建型：每次 start 重建，_disposeWorld 释放）
    this.particles = new ParticleSystem(this.renderer.scene, atlasTexture, atlasUV, 0.12);
    this.fireParticles = new ParticleSystem(this.renderer.scene, atlasTexture, atlasUV, 0.09);
    // 爆炸销毁方块时的碎屑粒子出口（TNT / 苦力怕爆炸共用）
    this.redstone.onBlockDestroyed = (x, y, z, def) => {
      if (this.particles) this.particles.burstBlockBreak(x + 0.5, y, z + 0.5, def, this.world, 10);
    };
    this.mobManager.onBlockDestroyed = (x, y, z, def) => {
      if (this.particles) this.particles.burstBlockBreak(x + 0.5, y, z + 0.5, def, this.world, 8);
    };
    // 末影龙击败事件（本地死亡链 + 远端同步入口，幂等）：置击败标记 + M3 建返回门/折跃门
    this.mobManager.onDragonDefeated = (mob) => this._onDragonDefeated(mob);
    // 凋灵齐射回调（Idea-2D-②）：WitherAI 经此生成三发凋灵之首（本地弹 + 联机广播）
    this.mobManager.onWitherShoot = (mob, player) => this._spawnWitherSkullVolley(mob, player);
    // 守誓巨像回调（天域批次 C）：风弹齐射（k:'gale' 复用 wither_skull 通道）+ 震地广播
    this.mobManager.onColossusShoot = (mob, player, wide) => this._spawnGaleVolley(mob, player, wide);
    this.mobManager.onColossusSlam = (mob) => this._colossusSlam(mob);
    this.mobManager.onMobXpAward = (mob, xp) => { if (this.player.survival) this.player.addXp(xp); };
    // 新建的粒子系统按视频设置套密度（其余项已在构造时套用，跨存档不变）
    applySettings(this);
    // 用图集初始化怪物材质
    this.mobManager.atlasUV = atlasUV;
    this.mobManager.atlasTexture = atlasTexture;
    await this.mobManager.buildMaterials();
    
    // 出生点：存档坐标 > 维度出生点（新建存档 / 换维，dimensionSpawn 标记忽略存档坐标）
    const spawn = this.world.getSpawnPoint();
    // 生成初始区块（以落点为中心，保证周围有地形；主世界 (0.5, 地表+2, 0.5) 行为不变）
    const center = (loadData && loadData.player && !loadData.dimensionSpawn) ? loadData.player : spawn;
    const pcx = Math.floor(center.x / CHUNK_SIZE), pcz = Math.floor(center.z / CHUNK_SIZE);
    const loadFill = document.getElementById('load-fill');
    const chunks = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        chunks.push([pcx + dx, pcz + dz]);
      }
    }
    let i = 0;
    for (const [dx, dz] of chunks) {
      this.world.ensureChunk(dx, dz);
      if (loadFill) loadFill.style.width = `${(i / chunks.length) * 100}%`;
      i++;
      await new Promise(r => setTimeout(r, 0));
    }

    // 玩家位置
    if (loadData && loadData.player && !loadData.dimensionSpawn) {
      const p = loadData.player;
      this.player.position.set(p.x, p.y, p.z);
      this.player.yaw = p.yaw || 0;
      this.player.pitch = p.pitch || 0;
      this.player.health = p.health ?? 20;
      this.player.food = p.food ?? 20;
      this.player.saturation = p.saturation ?? 5;
      this.player.exhaustion = p.exhaustion ?? 0;
      this.player.xp = p.xp ?? 0;
      this.player.xpLevel = p.xpLevel ?? 0;
      this.player.onFire = p.onFire ?? 0;
      this.player.airTicks = p.airTicks ?? 300;
    } else {
      this.player.position.set(spawn.x, spawn.y, spawn.z);
    }
    this.player.setMode(mode);
    // 滑翔瞬态复位（Player 跨存档共享实例；掉落展开由 _updateGliding 逐帧重判）
    this.player.gliding = false;
    if (this.hud) this.hud.setGliding(false);
    // 传送门穿越状态复位（传送门到达的吸附/建门在 start 完成后由 _afterPortalArrival 处理）
    this._portalTimer = 0;
    this._portalCooldown = 0;
    this._portalArmed = true;
    
    // 物品栏：先清空，避免上一个存档的物品残留（含盔甲槽）
    this.inventory.slots = new Array(this.inventory.size).fill(null);
    this.inventory.armor = new Array(4).fill(null);
    this.inventory.hotbarSelected = 0;
    // 床重生点：旧档读取 / 新档清空；末影之眼飞行与弓箭投射物残留清理
    this.bedSpawn = (loadData && loadData.bedSpawn) || null;
    if (this.eyeFlight) {
      this.renderer.scene.remove(this.eyeFlight.mesh);
      this.eyeFlight.mesh.geometry.dispose();
      this.eyeFlight.mesh.material.dispose();
      this.eyeFlight = null;
    }
    if (this.arrows) {
      for (const a of this.arrows) this.renderer.scene.remove(a.mesh);
    }
    this.arrows = [];
    if (this.witherSkulls) {
      for (const s of this.witherSkulls) this.renderer.scene.remove(s.mesh);
    }
    this.witherSkulls = [];
    // Idea-2D-③：信标激活状态（内存级——效果选择随会话，方块本身走账本；换世界清光柱）
    this._clearBeaconState();
    this._meshBuildSeq = 0; // B-②：网格派发版本号（跨存档共享实例，单调递增即可）
    this._bowCharging = false; // 存档切换：清掉上一存档的蓄力状态
    this._bowCharge = 0;
    if (loadData && loadData.inventory) {
      this.inventory.deserialize(loadData.inventory);
    } else if (mode === 'creative') {
      // 创造开局空背包（原版式：物品自取自放，从物品栏拿取）
      this.inventory.slots = new Array(this.inventory.size).fill(null);
    } else {
      // 生存初始物品
      this.inventory.add('wood_pickaxe');
      this.inventory.add('wood_axe');
      this.inventory.add('wood_sword');
      this.inventory.add('torch', 16);
      this.inventory.add('bread', 5);
    }
    
    // 恢复红石状态
    if (loadData && loadData.redstone && this.redstone) {
      this.redstone.deserialize(loadData.redstone);
    }
    
    // 天空时间：始终先重置为新存档默认（早上），再按存档恢复
    if (this.sky) this.sky.time = 0.35;
    if (loadData && loadData.sky && this.sky) {
      this.sky.time = loadData.sky.time || 0.35;
    }
    // A-②：环境音调度相位随世界重置（避免新存档继承上一局节拍）
    audio.resetAmbient();

    this.hotbar = new Hotbar(this.inventory);
    await this.hotbar.update();
    this.inventoryScreen = new InventoryScreen(this.inventory, this.player, this);
    this.chestScreen = new ChestScreen(this);
    this.beaconScreen = new BeaconScreen(this); // Idea-2D-③：信标效果选择（新建型：_disposeWorld 移除）
    this.steleScreen = new SteleScreen(this); // 天域批次 A：风纹石碑浮层（新建型：_disposeWorld 移除）
    this.furnaceScreen = new FurnaceScreen(this);
    this.recipeViewer = new RecipeViewer(this);
    this.tradeScreen = new TradeScreen(this);
    this.pauseMenu = new PauseMenu(this);
    this.deathScreen = new DeathScreen(this);
    this.commandPanel = new CommandPanel(this);
    this.bossBar = new BossBar(); // 末影龙血条（新建型：_disposeWorld 移除）
    this.portalOverlay = new PortalOverlay(); // 传送门屏幕特效（新建型：纯表现层）

    // 联机模式初始化：host 端跑怪物自然生成（事件同步）、绑定方块同步钩子、注册网络回调、创建聊天框
    if (this.networkMode && this.net) {
      // 阶段 2 怪物事件同步：host 端权威生成（mob_spawn 广播），非 host 端只接收广播创建
      if (this.mobManager) {
        this.mobManager.spawnEnabled = !!this.net.isHost;
        this.mobManager.mobNet = this.net; // 生成/攻击/死亡事件上报接口
        this.mobManager.isMultiplayer = true; // Build 10：联机时禁用本地掉落物合并（服务器账本权威）
      }
      // 方块同步钩子已在 start() 前段趁早绑定（见 new World 处），此处不重复
      // 联机拾取掉落物：通知服务器移除并广播
      if (this.mobManager) this.mobManager.onDropTaken = (id) => this.net.sendDropTaken(id);
      // 阶段10：归属锁判定需要本地联机 id（死亡掉落物锁定期内他人不可拾取）
      if (this.mobManager) this.mobManager.getSelfId = () => (this.net ? this.net.selfId : null);
      // 阶段10：拾取被归属锁拒绝（drop_deny）→ 从背包扣回 + 凭服务器补发的 drop_spawn 重建实体
      this.net.on('drop_deny', ({ id }) => {
        const info = this.mobManager ? this.mobManager.takePendingPickup(id) : null;
        if (!info) return; // 未抢先拾取（本地预判已拦下），无需回滚
        this.inventory.removeItems(info.name, info.count);
        if (this.hotbar) this.hotbar.update();
        if (this.chatBox) this.chatBox.add(t('该掉落物仍归属其主人，已归还。'), '#fa8');
      });
      // 红石源状态（lever/button）：低频广播让各端 poweredBlocks 对齐
      if (this.redstone) this.redstone.onStateChange = (x, y, z, on) => this.net.sendRedstoneState(x, y, z, on);
      this.net.on('time', (t) => { if (this.sky) this.sky.time = t; });
      this.net.on('chat', ({ from, fromId, text }) => {
        if (!this.chatBox) return;
        if (fromId === 0) { this.chatBox.add(text, '#aaa'); return; } // 服务器系统回复
        this.chatBox.addSegments([{ text: `<${from}> `, color: playerColorCss(fromId) }, { text, color: '#fff' }]);
      });
      this.net.on('system', (m) => {
        if (!this.chatBox) return;
        if (m && m.parts) this.chatBox.addSegments(m.parts);
        else this.chatBox.add(typeof m === 'string' ? m : (m && m.text) || String(m), '#aaa');
      });
      this.net.on('attacked', ({ damage }) => { this.player.hurt(damage, 'player', true); });
      this.chatBox = new ChatBox(this, (text) => this.net.sendChat(text));
      this.chatBox.add(t('已进入局域网世界 · 房间「{r}」 · 按 T 聊天（/room 换房 /rebuild 重建世界 host）', { r: this.net.room || 'default' }), '#ff8');
    }

    // 隐藏加载界面
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';

    this.running = true;
    this.controls.enabled = true;
    this.infoBar.show();
    this.lastTime = performance.now();
    this.loop();
    // 末地开局生成末影龙（未击败时；联机由 host 生成广播）
    this._ensureDragon();
    } catch (e) {
      console.error('游戏启动失败:', e);
      const loading = document.getElementById('loading');
      if (loading) {
        loading.innerHTML = `<div style="color:#f88;font-size:16px;text-align:center;padding:20px;">${t('游戏启动失败: {msg}', { msg: e.message })}<br><br>${t('请按 F5 刷新或清除 localStorage 后重试')}</div>`;
      }
    }
  }

  setupKeyBindings() {
    document.addEventListener('keydown', (e) => {
      // Build 12：文本输入焦点（创造/JEI 搜索框、命令面板输入框等）或输入法合成中，
      // 不触发任何游戏快捷键，也不再 preventDefault（避免打断输入法合成）；
      // 放行：非合成态 ESC（关界面）与 F6（手动保存防误刷新）；聊天输入的 ESC/Enter 由 ChatBox 自理不放行。
      const t = e.target;
      const editable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.isComposing || e.keyCode === 229) return; // 输入法合成中一律不处理（ESC 先交给输入法取消合成）
      if (editable && !((e.key === 'Escape' && !(this.chatBox && this.chatBox.input)) || e.code === 'F6')) return;
      if (e.code === 'KeyE') {
        if (this.paused || this.spectating || (this.deathScreen && this.deathScreen.visible)) return;
        if (this.chestScreen && this.chestScreen.visible) { this.chestScreen.hide(); return; }
        if (this.beaconScreen && this.beaconScreen.visible) { this.beaconScreen.hide(); return; }
        if (this.steleScreen && this.steleScreen.visible) { this.steleScreen.hide(); return; }
        if (this.furnaceScreen && this.furnaceScreen.visible) { this.furnaceScreen.hide(); return; }
        if (this.tradeScreen && this.tradeScreen.visible) { this.tradeScreen.hide(); return; }
        if (this.inventoryScreen) {
          this.inventoryScreen.toggle(2);
        }
      }
      // C 键：命令面板（仅在启用命令的存档可用）
      if (e.code === 'KeyC') {
        if (!this.running || this.spectating || !this.cheatsEnabled) return;
        if (this.deathScreen && this.deathScreen.visible) return;
        if (this.pauseMenu && this.pauseMenu.visible) return;
        if (this.commandPanel) this.commandPanel.toggle();
      }
      // Q 键丢弃（Build 10 原版化）：Q 丢 1 个 / Ctrl+Q 丢整组，沿视线初速抛出，2 秒后才可拾取
      if (e.code === 'KeyQ') {
        // 界面/文本焦点时早退（不 preventDefault，避免吃掉聊天与命令面板输入框的字符）
        if (!this.running || this.spectating || (this.deathScreen && this.deathScreen.visible)) return;
        if (this.pauseMenu && this.pauseMenu.visible) return;
        if (this.chatBox && this.chatBox.input) return;
        if (this.inventoryScreen && this.inventoryScreen.visible) return;
        if (this.commandPanel && this.commandPanel.visible) return;
        if ((this.chestScreen && this.chestScreen.visible) || (this.furnaceScreen && this.furnaceScreen.visible) ||
            (this.beaconScreen && this.beaconScreen.visible) || (this.steleScreen && this.steleScreen.visible) ||
            (this.tradeScreen && this.tradeScreen.visible)) return;
        e.preventDefault(); // 拦截浏览器 Ctrl+Q（Linux 关窗）等默认行为
        const stack = this.inventory.getSelected();
        if (!stack || !stack.name) return;
        const count = e.ctrlKey ? Math.min(stack.count, 64) : 1;
        const dir = new THREE.Vector3();
        this.renderer.camera.getWorldDirection(dir);
        const pos = new THREE.Vector3(this.player.position.x, this.player.position.y + 1.4, this.player.position.z)
          .addScaledVector(dir, 0.4);
        const vel = dir.clone().multiplyScalar(6).add(new THREE.Vector3(0, 1.5, 0));
        const data = stack.data ?? null;
        this.inventory.removeSelected(count);
        this.hotbar.update();
        if (this.networkMode && this.net) {
          // 联机：本地不建实体，等服务器 drop_spawn 回执（与联机挖矿同惯例），速度透传
          this.net.sendDropSpawn(pos.x, pos.y, pos.z, stack.name, count, data, vel);
        } else if (this.mobManager) {
          this.mobManager.spawnDrop(pos, stack.name, count, data, { velocity: vel, pickupDelay: 2.0 });
        }
      }
      // J 键：JEI 伴随面板——容器界面打开时切换面板显隐（偏好持久化）；
      // 无容器界面时打开背包（JEI 面板随背包自动出现）
      if (e.code === 'KeyJ') {
        if (!this.running || (this.deathScreen && this.deathScreen.visible)) return;
        if (this.pauseMenu && this.pauseMenu.visible) return;
        if (this.chatBox && this.chatBox.input) return;
        if (!this.recipeViewer) return;
        const containerOpen = (this.inventoryScreen && this.inventoryScreen.visible) ||
          (this.chestScreen && this.chestScreen.visible) ||
          (this.beaconScreen && this.beaconScreen.visible) ||
          (this.furnaceScreen && this.furnaceScreen.visible) ||
          (this.tradeScreen && this.tradeScreen.visible);
        if (containerOpen) {
          this.recipeViewer.togglePanel();
          return;
        }
        this.recipeViewer.setUserEnabled(true);
        if (this.inventoryScreen) this.inventoryScreen.show(2); // Build 11：JEI 独立伴随面板（内嵌已回退）
      }
      // R/U/A：配方查询键。浮层内作用于悬浮/当前物品；
      // 背包/箱子/熔炉界面内悬浮物品按 R 查配方、按 U 查用途
      if ((e.code === 'KeyR' || e.code === 'KeyU' || e.code === 'KeyA') && this.recipeViewer
          && this.running && !(this.deathScreen && this.deathScreen.visible)
          && !(this.chatBox && this.chatBox.input)) {
        const rv = this.recipeViewer;
        if (rv.visible) {
          if (e.code === 'KeyR') rv.onKeyR();
          else if (e.code === 'KeyU') rv.onKeyU();
          else if (e.code === 'KeyA') rv.onKeyA();
          return;
        }
        const hover = this._uiHoverName();
        if (hover) {
          if (e.code === 'KeyR') { rv.showFor(hover); return; }
          if (e.code === 'KeyU') { rv.showUsages(hover); return; }
        }
      }
      // 数字键切换快捷栏
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5)) - 1;
        if (n >= 0 && n < 9) {
          this.inventory.setSelected(n);
          if (this.hotbar) { this.hotbar.update(); this.hotbar.flashName(); }
        }
      }
      // Build 20 ⑤：F5 = 第一/二/三人称视角循环（0 第一人称 → 1 第三人称背后 →
      // 2 第三人称正面）；观战模式下 F5 仍为切换观战目标（死亡观战键位不变）。
      // 未运行时早退不 preventDefault——启动失败页保留浏览器 F5 刷新语义。
      if (e.code === 'F5') {
        if (!this.running || !this.world) return;
        e.preventDefault();
        if (this.spectating) {
          this.cycleSpectateTarget();
          this._spectateHint();
        } else if (!this.player.spectator) {
          this.player.viewMode = (this.player.viewMode + 1) % 3;
        }
      }
      // Build 20 ⑤：F6 = 手动保存（原 F5 功能挪位；联机模式不保存本地槽位）
      if (e.code === 'F6') {
        e.preventDefault();
        if (this.running && this.world && !this.networkMode) SaveSystem.save(this);
      }
      // R 键：观战模式重生退出观战
      if (e.code === 'KeyR' && this.spectating) {
        this.respawn();
        return;
      }
      // ESC 兜底：pointer lock 未激活时也切换暂停菜单（pointerlockchange 不会触发）
      if (e.code === 'Escape') {
        if (!this.running || (this.deathScreen && this.deathScreen.visible)) return;
        // 优先关闭命令面板
        if (this.commandPanel && this.commandPanel.visible) {
          this.commandPanel.hide();
          return;
        }
        // 物品栏打开时 ESC 关闭（Build 6 修复：原为裸 return 什么都不做，与其他容器不一致）
        if (this.inventoryScreen && this.inventoryScreen.visible) {
          this.inventoryScreen.hide();
          return;
        }
        if (this.chestScreen && this.chestScreen.visible) {
          this.chestScreen.hide();
          return;
        }
        if (this.furnaceScreen && this.furnaceScreen.visible) {
          this.furnaceScreen.hide();
          return;
        }
        if (this.tradeScreen && this.tradeScreen.visible) {
          this.tradeScreen.hide();
          return;
        }
        // 天域石碑浮层：ESC 合上（阅读型浮层，与 E 键同效）
        if (this.steleScreen && this.steleScreen.visible) {
          this.steleScreen.hide();
          return;
        }
        if (this.pauseMenu && this.pauseMenu.visible) {
          this.pauseMenu.hide();
        } else if (!this.controls.locked) {
          this.pauseMenu?.show();
        }
      }
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  loop = () => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.frame++;
    if (!this.paused) this.update(dt);
    else if (this._bowCharging) this._cancelBowCharge(); // 暂停/死亡：蓄力作废（防恢复后误射）
    this.renderer.render();
    requestAnimationFrame(this.loop);
  };

  // 检测眼睛位置是否在水里，更新 inWater / 氧气 / 溺水
  _updateWaterState() {
    const p = this.player;
    const eyeY = p.position.y + 1.62;
    const bx = Math.floor(p.position.x);
    const by = Math.floor(eyeY);
    const bz = Math.floor(p.position.z);
    const id = this.world.getBlock(bx, by, bz);
    const def = BlockRegistry.getById(id);
    p.inWater = !!(def && def.fluid && def.fluidType === 'water');

    if (p.survival) {
      if (p.inWater) {
        p.airTicks -= 1;
        if (p.airTicks <= 0) {
          // 溺水：每秒扣 1 血（约每 20 帧一次）
          p.airTicks = 20;
          p.health = Math.max(0, p.health - 1);
        }
      } else {
        p.airTicks = Math.min(300, p.airTicks + 10);
      }
      // 熔岩点燃（离开熔岩后延续 onFire 秒再熄灭）；入水即灭火
      if (p.inWater) {
        p.onFire = 0;
      } else {
        const feetDef = BlockRegistry.getById(this.world.getBlock(bx, Math.floor(p.position.y + 0.2), bz));
        const inLava = !!(def && def.fluidType === 'lava') || !!(feetDef && feetDef.fluidType === 'lava');
        if (inLava) p.onFire = 3;
      }
    }
  }

  // 上升气流检测（天域批次 B）：足部/身体任一格 def.updraft → 本帧处于气流柱内。
  // 只作用于玩家（怪物运动不接气流，避免 AI 被抬飞出控）；联机纯本地物理零协议。
  _updateUpdraftState() {
    const p = this.player;
    const bx = Math.floor(p.position.x);
    const bz = Math.floor(p.position.z);
    const yFeet = Math.floor(p.position.y + 0.1);
    const yBody = Math.floor(p.position.y + 1.0);
    const d1 = BlockRegistry.getById(this.world.getBlock(bx, yFeet, bz));
    const d2 = BlockRegistry.getById(this.world.getBlock(bx, yBody, bz));
    this._inUpdraft = !!(d1 && d1.updraft) || !!(d2 && d2.updraft);
  }

  // 御风斗篷穿戴检测（批次 C）：胸甲槽 = armor[1]
  _hasGaleCloak() {
    const chest = this.inventory.armor && this.inventory.armor[1];
    return !!(chest && chest.name === 'gale_cloak');
  }

  // 风阵块放置：上方 12 格写风流柱（只填空气格；逐格 setBlock → 联机逐格自动上报）
  _writeGaleColumn(x, y, z) {
    const wid = BlockRegistry.getId('wind_current');
    for (let h = 1; h <= 12; h++) {
      if (y + h >= CHUNK_HEIGHT) break;
      if (this.world.getBlock(x, y + h, z) === 0) this.world.setBlock(x, y + h, z, wid);
    }
  }

  // 拆风阵块：同步清除其上方气流柱（遇非风流格即停，玩家建筑不受影响）
  _clearGaleColumn(x, y, z) {
    const wid = BlockRegistry.getId('wind_current');
    for (let h = 1; h <= 12; h++) {
      if (this.world.getBlock(x, y + h, z) !== wid) break;
      this.world.setBlock(x, y + h, z, 0);
    }
  }

  // 燃烧表现：着火实体喷火焰+烟，玩家着火叠屏幕火光
  _updateFireEffects(dt) {
    // 玩家自身
    const p = this.player;
    if (p.onFire > 0) {
      if (this.fireParticles) {
        this.fireParticles.flameBox(p.position.x, p.position.y + 0.3, p.position.z, 0.5, 1.4, 0.5);
      }
      if (this.hud) this.hud.setOnFire(true);
      p.onFire = Math.max(0, p.onFire - dt);
      // 火焰灼烧：每秒 1 血（生存；低频伤害按约定不走红屏）
      if (p.survival) {
        this._fireTick = (this._fireTick || 0) + dt;
        if (this._fireTick >= 1) {
          this._fireTick = 0;
          p.health = Math.max(0, p.health - 1);
        }
      }
    } else {
      this._fireTick = 0;
      if (this.hud) this.hud.setOnFire(false);
    }
    // 燃烧中的怪物（日光燃烧的僵尸/骷髅等）
    if (this.fireParticles && this.mobManager && this.mobManager.mobs) {
      const emit = (this.frame % 5) === 0; // ~0.3s 一波
      if (emit) {
        for (const mob of this.mobManager.mobs) {
          if (!mob.isBurning || mob.dead) continue;
          this.fireParticles.flameBox(mob.position.x, mob.position.y + 0.2, mob.position.z,
            Math.max(0.5, mob.width * 0.8), mob.height * 0.95, Math.max(0.5, mob.width * 0.8));
        }
      }
    }
  }

  update(dt) {
    // 检测玩家是否在水中（眼睛位置）
    this._updateWaterState();
    // 检测玩家是否在上升气流柱内（天域批次 B：足部/身体任一格为 wind_current）
    this._updateUpdraftState();
    // 守誓巨像裂心风拽光环（天域批次 C：各端本地结算）
    this._updateColossusAura(dt);
    // 鞘翅滑翔折叠判定（水中/落地等环境变化要在移动分支前收口，gliding 不得跨分支残留）
    this._updateGlideFold();

    // 受击无敌帧衰减
    if (this.player.invulnerable > 0) {
      this.player.invulnerable = Math.max(0, this.player.invulnerable - dt);
    }

    // 玩家移动
    // 观战模式：跟随目标时本地实体吸附到目标（无碰撞）+ 相机贴合目标视角；无目标时 spectator 自由飞行（穿墙）
    let specTarget = this.spectating ? this.remotePlayers.get(this.spectateTargetId) : null;
    if (specTarget && specTarget.dead) { this.spectateTargetId = null; specTarget = null; } // 目标死亡/离开 → 回自由
    if (specTarget) {
      // 观战跟随：吸附（平滑）+ 相机贴合 + 天空跟随（区块加载以吸附后的位置为中心，正好加载目标周围）
      // 阶段6 平滑：对目标插值位置再做指数平滑（帧率无关系数），切换目标/目标瞬移时不跳变
      const targetPos = specTarget.group.position;
      if (!this._specSmoothed) {
        this._specSmoothed = targetPos.clone();
        this._specSmoothYaw = specTarget.yaw;
        this._specSmoothPitch = specTarget.pitch;
      } else {
        const k = 1 - Math.pow(0.0001, dt); // ~0.9 @60fps，帧率无关
        this._specSmoothed.lerp(targetPos, k);
        let dy = specTarget.yaw - this._specSmoothYaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this._specSmoothYaw += dy * k;
        this._specSmoothPitch += (specTarget.pitch - this._specSmoothPitch) * k;
      }
      this.player.position.copy(this._specSmoothed);
      this.player.velocity.set(0, 0, 0);
      this.updateSpectateCamera();
      this.sky.update(dt, this.player.position);
    } else {
      const move = this.controls.getMoveVector();
      // 信标速度效果（Idea-2D-③）：每级 +20% 移速
      const speed = (this.player.flying ? 12 : (this.player.survival ? 4.3 : 5.6))
        * (1 + 0.2 * (this.player.getEffectLevel ? this.player.getEffectLevel('speed') : 0));
      const sprint = this.controls.isSprinting() ? 1.3 : 1;
      
      if (this.player.flying || this.player.spectator) {
        this.player.velocity.x = move.x * speed * sprint;
        this.player.velocity.z = move.z * speed * sprint;
        let vy = 0;
        if (this.controls.isJumping()) vy = speed * 0.6;
        if (this.controls.isSneaking()) vy = -speed * 0.6;
        this.player.velocity.y = vy;
      } else if (this.player.inWater) {
        // 游泳：水平速度降低，Space 上浮 / Shift 下潜
        const swimSpeed = speed * 0.5 * sprint;
        this.player.velocity.x = move.x * swimSpeed;
        this.player.velocity.z = move.z * swimSpeed;
        if (this.controls.isJumping()) this.player.velocity.y = 4.0;
        else if (this.controls.isSneaking()) this.player.velocity.y = -4.0;
        // 其余交给 Physics 的水中重力与阻力
      } else if (this._inUpdraft && !this.player.gliding) {
        // 上升气流（天域批次 B）：水平弱操控（保留跃出动量感）；Shift 下潜脱出；
        // 竖直抬升在 physics.collide 之后结算（抵消当帧重力并反超，钳上限）
        const gustSpeed = speed * 0.6 * sprint;
        this.player.velocity.x = move.x * gustSpeed;
        this.player.velocity.z = move.z * gustSpeed;
        if (this.controls.isSneaking()) this.player.velocity.y = -4.0;
      } else if (this._updateGlideAero(dt)) {
        // 鞘翅滑翔帧：速度由动量主导（俯冲推进/拉起刹车已在 _updateGliding 内结算），
        // 不走地面移动的速度覆写，否则动量每帧被清成 4.3m/s 滑翔无从谈起
      } else {
        this.player.velocity.x = move.x * speed * sprint;
        this.player.velocity.z = move.z * speed * sprint;
        if (this.controls.isJumping()) {
          this.physics.jump(this.player);
          // 信标跳跃效果（Idea-2D-③）：每级 +25% 跳跃初速
          const jb = this.player.getEffectLevel ? this.player.getEffectLevel('jump_boost') : 0;
          if (jb > 0 && this.player.velocity.y > 0) this.player.velocity.y *= 1 + 0.25 * jb;
          // 御风斗篷（批次 C）：天域内跳跃 +20%（御风者的跳岛底气）
          if (this._hasGaleCloak() && this.world.dimension === 'aether' && this.player.velocity.y > 0) {
            this.player.velocity.y *= 1.2;
          }
        }
      }
      
      this.physics.collide(this.player, dt);
      // 气流抬升（批次 B）：物理重力落地后追加升力（净加速 +13 m/s²，钳 +6 m/s）
      if (this._inUpdraft && !this.controls.isSneaking() &&
          !this.player.flying && !this.player.spectator && !this.player.inWater && !this.player.gliding) {
        this.player.velocity.y = Math.min(6, this.player.velocity.y + 45 * dt);
      }
      // 御风斗篷缓降（批次 C）：下落末段限速（-8 m/s 不及摔伤线 -15，天然免摔）
      if (this._hasGaleCloak() && !this.player.onGround && !this.player.flying &&
          !this.player.inWater && !this.player.gliding && this.player.velocity.y < -8) {
        this.player.velocity.y = -8;
      }
      this.player.updateCamera(this.world);
      this.sky.update(dt, this.player.position);
    }
    
    // 体素光昼夜系数与天光染色：所有区块材质共享 uniform，逐帧更新无需重建网格
    //（Sky.getLightLevel 已按维度档案覆盖——下界/末地恒定；sunTint 可被维度档案固定）
    const lp = this.world.dimDef.light;
    VoxelLightUniforms.uDayLight.value = 0.10 + 0.90 * this.sky.getLightLevel();
    if (lp.sunTint) {
      VoxelLightUniforms.uSunTint.value.setRGB(lp.sunTint[0], lp.sunTint[1], lp.sunTint[2]);
    } else if (this.sky.sunTint) {
      VoxelLightUniforms.uSunTint.value.copy(this.sky.sunTint);
    }

    // 光照视觉增强（L1）：太阳方向/颜色、天空反射色、云影参数、波纹时钟——全部共享 uniform
    VoxelLightUniforms.uTime.value += dt;
    VoxelLightUniforms.uSunDir.value.copy(this.sky.sunLight.position);
    VoxelLightUniforms.uSunColor.value.copy(this.sky.sunLight.color);
    VoxelLightUniforms.uSkyColor.value.copy(this.sky.skyMesh.material.color);
    VoxelLightUniforms.uWind.value = this.sky.wind;
    VoxelLightUniforms.uCloudsY.value = this.sky._cloudsY || 140;
    // 云影 = 设置档位 ∧ 维度云显隐（下界/末地云隐藏，clouds.visible 已含此判断）
    const gfxOn = this.settings.gfx === 'basic' || this.settings.gfx === 'full';
    VoxelLightUniforms.uCloudShadow.value = (gfxOn && this.sky.clouds.visible) ? 1 : 0;
    // 完整档专属：云色按昼夜调制（云是无光照材质，夜里不调制会白亮并触发"夜空发光云"）、
    // 光源块提亮 HDR 供泛光取源（2.2：荧石/岩浆纹 ×2.2 > 泛光阈 1.05；雪面 0.98 不再过阈——
    // 阈 0.72 时代雪原整个被 bloom 当光源发光，用户实测白天反光刺眼）；其余档保持原值
    const full = this.settings.gfx === 'full';
    if (this.sky.clouds) this.sky.clouds.material.color.setScalar(full ? 0.35 + 0.50 * this.sky.getLightLevel() : 1);
    GfxState.lightBoost = full ? 2.2 : 1.0;
    if (this.chunkBuilder) this.chunkBuilder.lightMaterial.color.setScalar(GfxState.lightBoost);
    // 太阳盘同样 HDR 提亮（1.25）：泛光阈上移到 1.05 后靠它保持日冕光晕；
    // 非 full 档回 1.0（直渲输出 clamp 到 1，画面与旧版一致）
    if (this.sky.sun) this.sky.sun.material.color.setScalar(full ? 1.25 : 1);
    // 完整档隐藏日落/日出日晕 sprite（基础/关闭档保持可见=现状）：sunGlow 是 43° 加法混合
    // sprite，晨昏时 opacity 爬到 0.9，与"晨昏天空亮度扫描区间(0.62-0.66)骑在泛光阈值上"叠加
    // → 全屏白化（t 0.27/0.71-0.76 曾真出）。太阳圆盘自身的泛光 halo 就是更好的日晕；
    // 可见性门 = 档位 ∧ 维度天体显隐（sunGlow 与 sun 同进退）
    if (this.sky.sunGlow) this.sky.sunGlow.visible = !full && this.sky.sun.visible;
    // 体积光逐帧状态：白天太阳/夜晚月亮取源、屏幕投影与强度（下界/末地无天体自动关）
    if (this.renderer.postfx) this.renderer.postfx.updateGodRays(this.sky, this.renderer.camera);
    // L4-A 平面真反射门控：完整档 ∧ 设置子开关 ∧ 主世界（其余维度无水体）∧ 眼睛未入水；
    // 入水即时关断（RT 跳渲 + uReflOn 归零走 L1 天空色回退），出水恢复零重建
    if (this.renderer.postfx) {
      this.renderer.postfx.reflectionEnabled = full
        && this.settings.gfxWaterReflection !== false
        && this.world.dimDef.id === 'overworld'
        && !this.player.inWater;
    }
    // L4-B 太阳阴影门控：完整档 ∧ 设置子开关 ∧ 天体可见（下界/末地自动关）∧ 白天
    // （sunLight.position 此刻仍是 Sky.update 写入的单位方向；夜晚月光阴影直接关）。
    // update 在喂块后跑：摆 shadow 相机（含 snap-to-texel）+ 节流 shadow pass + 同步
    // 手工挂载的 lights shadow uniforms；receiveShadow 批量切换仅在实际变化时遍历。
    if (this.renderer.sunShadow) {
      const ss = this.renderer.sunShadow;
      const shadowOn = full && this.settings.gfxShadows !== false
        && this.sky.sun.visible && this.sky.sunLight.position.y > 0;
      ss.enabled = shadowOn;
      ss.update(this.player.position, this.settings.renderDistance);
      ss.setReceive(shadowOn, this.world);
      GfxState.shadowReceive = shadowOn;
      ShadowUniforms.uShadowOn.value = (shadowOn && ss.ready) ? 1 : 0;
    }

    // 水下视野雾效（出水恢复的雾距与 applySettings 同源，随渲染距离收口 + 维度雾系数）
    const fog = this.renderer.scene.fog;
    if (fog) {
      if (this.player.inWater) {
        fog.color.setRGB(0.1, 0.25, 0.45);
        fog.near = 0;
        fog.far = 24;
      } else {
        applyFogRange(fog, this.settings.renderDistance, this.world.dimDef.sky ? this.world.dimDef.sky.fog : null);
      }
    }
    // 终局演出（终局篇 F2「四界同潮」）：写在本雾段之后 = 每帧最后写入者，
    // 停写即回落 applyFogRange 值（零还原动作，纯客户端零持久化）
    this._updateFinaleTide(dt);
    // 水下屏幕滤镜（HUD 蓝色薄纱）
    this.hud.setUnderwater(this.player.inWater);

    // 粒子系统推进
    if (this.particles) this.particles.update(dt);
    if (this.fireParticles) this.fireParticles.update(dt);
    this._updateFireEffects(dt);

    // 水面流动（水纹理 UV 沿 v 滚动，RepeatWrapping）
    if (this.waterTexture) {
      this.waterTexture.offset.y = (this.waterTexture.offset.y + dt * 0.06) % 1;
    }
    // 熔炉烧炼推进（所有已开炉状态；界面可见时同步刷新进度显示）
    this.updateFurnaces(dt);
    if (this.furnaceScreen && this.furnaceScreen.visible) this.furnaceScreen.tick();
    // JEI 伴随面板：跟随容器界面（背包/箱子/合成台/熔炉/交易）显隐
    if (this.recipeViewer) this.recipeViewer.updateFrame();
    // 滚轮切换
    if (this.controls.wheelDelta !== 0) {
      let idx = this.inventory.hotbarSelected + this.controls.wheelDelta;
      if (idx < 0) idx = 8;
      if (idx > 8) idx = 0;
      this.inventory.setSelected(idx);
      this.hotbar.update();
      this.hotbar.flashName();
      this.controls.wheelDelta = 0;
    }
    
    // 区块加载/卸载
    this.updateChunks();
    
    // 重新构建脏区块网格
    this.rebuildDirtyChunks();
    
    // 射线选择
    this.updateRaycast();
    
    // 鼠标交互（观战模式不操作方块/物品）
    if (this.spectating) {
      if (this._bowCharging) this._cancelBowCharge(); // 进入观战：蓄力作废
      this.controls.mouseLeft = false;
      this.controls.mouseRight = false;
      this.breakingProgress = 0;
      if (this.breakMesh) this.breakMesh.visible = false;
    } else {
      this.handleMouseInput(dt);
    }
    
    // HUD
    this.hud.update(this.player);
    if (this.infoBar && this.world && this.world.generator) {
      this.infoBar.update(this.player, this.world.generator, this.sky, this.crosshairInfo,
        this.networkMode && this.net ? this.net.rttMs : null, // 阶段10：联机时显示 RTT
        this.world.dimension !== 'overworld' ? this.world.dimDef.name : null, // 非主世界显示维度
        this.networkMode && this.net ? this.net.rttJitterMs : null); // 阶段11：抖动 ± 显示
    }

    // 阶段10：第一人称手持物（物品变化检测 + bob/挥动；观战与旁观隐藏）
    // Build 20 ⑤：第三人称视角隐藏第一人称手，同步驱动本地玩家模型（F5 切换）
    const thirdPerson = !this.spectating && !this.player.spectator && !this.player.dead && this.player.viewMode > 0;
    this.hand.setVisible(!this.spectating && !this.player.spectator && this.player.viewMode === 0);
    this.playerModel.update(dt, this.player, thirdPerson, this._miningActive);
    {
      const sel = this.inventory.getSelected();
      const selName = sel ? sel.name : null;
      if (selName !== this.hand.currentName) this.hand.setItem(selName);
    }
    this.hand.update(dt,
      Math.hypot(this.player.velocity.x, this.player.velocity.z) > 0.8,
      this.controls.isSprinting());

    // 怪物系统
    if (this.mobManager) {
      this.mobManager.onPickup = (name, count, data) => {
        const remaining = this.inventory.add(name, count, data ?? null);
        this.hotbar.update();
        return remaining; // 返回未放入的剩余数量（0 = 全部拾取）
      };
      this.mobManager.update(dt, this.player, this.sky);
    }
    // Boss 血条（存活的 type.boss 实体：末影龙 / 凋灵可并存各占一条）
    if (this.bossBar) {
      this.bossBar.update(this.mobManager
        ? this.mobManager.mobs.filter(m => m.type && m.type.boss)
        : []);
    }
    
    // 红石系统
    if (this.redstone) {
      this.redstone.update(dt);
    }

    // 联机网络更新：本地状态上报 + 远端玩家插值
    if (this.networkMode && this.net) {
      this.net.update(dt);
      for (const rp of this.remotePlayers.values()) rp.update(dt);
    }
    
    // 盔甲点数汇总（4 格查表，每帧重算 → player.armor；hurt 内做减伤）
    this.player.armor = this._armorPoints();

    // 生存模式更新
    if (this.player.survival) {
      this.updateSurvival(dt);
    }

    // 耕种：作物生长节拍（host/单机权威；客户端看 host 的 block_set 广播收敛）
    this._cropTimer += dt;
    if (this._cropTimer >= 8) {
      this._cropTimer = 0;
      this._growCrops();
    }

    // B26 流体模拟（host/单机权威；客户端看 host 的方块广播收敛，与作物同款门控）
    if (this.world && this.world.fluidSim) {
      const isClient = !!(this.networkMode && this.net && !this.net.isHost);
      this.world.fluidSim.muted = isClient; // 客户端不积累模拟队列（靠广播收敛）
      if (!isClient) this.world.fluidSim.update(dt);
    }

    // 传送门穿越检测（所有模式；观战/死亡在函数内早退）
    this.updatePortals(dt);

    // 末影之眼飞行（寻要塞指引）
    if (this.eyeFlight) this._updateEyeFlight(dt);

    // 弓箭投射物 + 凋灵之首弹射物（Idea-2D-②）
    if (this.arrows.length) this._updateArrows(dt);
    if (this.witherSkulls.length) this._updateWitherSkulls(dt);
    // 状态效果计时（信标 buff / 凋零 debuff 统一 tick）+ 凋零滤镜
    if (this.player) this.player.tickEffects(dt);
    if (this.hud && this.player) this.hud.setWithered(this.player.getEffectLevel('wither') > 0);
    this.updatePortalParticles(dt);
    // 信标脉冲（Idea-2D-③）：每 4s 给范围内玩家刷新已激活信标的效果
    this._updateBeaconPulse(dt);

    // A-② 音频：脚步/落地（距离驱动步频）+ 环境风声/BGM 计划调度
    this._updateFootsteps(dt);
    audio.tickAmbient(dt, this.sky ? this.sky.getLightLevel() : 0.8);

    // 自动保存（联机模式不自动保存，避免覆盖本地槽位）
    if (!this.networkMode) {
      this.autoSaveTimer += dt;
      if (this.autoSaveTimer >= this.autoSaveInterval) {
        this.autoSaveTimer = 0;
        SaveSystem.save(this);
      }
    }
  }

  updateChunks() {
    const pcx = Math.floor(this.player.position.x / CHUNK_SIZE);
    const pcz = Math.floor(this.player.position.z / CHUNK_SIZE);
    const renderDistance = this.settings ? this.settings.renderDistance : 6;

    // 加载（分帧预算）：跨入新区块列时一次会缺 13+ 个区块，全量同步生成曾致单帧
    // 690ms 卡顿。收集缺口 → 按距玩家距离排序（脚下优先）→ 每帧限时生成。
    // 生成是纯函数且顺序无关（structure-determinism 顺序测试背书），分帧无正确性影响。
    const missing = [];
    for (let dx = -renderDistance; dx <= renderDistance; dx++) {
      for (let dz = -renderDistance; dz <= renderDistance; dz++) {
        if (!this.world.getChunk(pcx + dx, pcz + dz)) {
          missing.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
        }
      }
    }
    if (missing.length) {
      missing.sort((a, b) => a[2] - b[2]);
      const t0 = performance.now();
      let made = 0;
      for (const [cx, cz] of missing) {
        // B-①：优先 worker 异步预取（立即返回不卡帧）；不可用回退同步生成分帧
        if (!this.world.requestChunk(cx, cz)) this.world.ensureChunk(cx, cz);
        made++;
        // 至少 1 块保证推进（首次进入世界也按预算渐次补齐）；超 8ms 停手让出帧
        if (made >= 1 && performance.now() - t0 > 8) break;
      }
    }

    // 卸载（距离过远）
    const maxDist = renderDistance + 2;
    for (const [key, chunk] of this.world.chunks) {
      const dx = chunk.cx - pcx, dz = chunk.cz - pcz;
      if (Math.abs(dx) > maxDist || Math.abs(dz) > maxDist) {
        if (chunk.mesh) this.renderer.scene.remove(chunk.mesh);
        if (chunk.waterMesh) this.renderer.scene.remove(chunk.waterMesh);
        if (chunk.lightMesh) this.renderer.scene.remove(chunk.lightMesh);
        this.world.unloadChunk(chunk.cx, chunk.cz);
      }
    }
  }

  rebuildDirtyChunks() {
    // 时间预算制（W-卡顿批次）：单块 mesh 收集 ~7-15ms，改为限时 ~12ms（至少 1 块保证推进）。
    // B-②：优先派发 mesh worker（主线程只做缓存填充+拷贝 ~1-2ms/块）；不可用回退同步 build。
    const t0 = performance.now();
    let count = 0;
    for (const [, chunk] of this.world.chunks) {
      if (!chunk.dirty) continue;
      if (chunk._meshInFlight) continue; // 在途：结果落地时若期间被改脏会再次进入本循环
      if (!this._dispatchMeshBuild(chunk)) this._buildChunkSync(chunk);
      count++;
      if (count >= 1 && performance.now() - t0 > 12) break;
    }
  }

  // B-②：同步网格重建（原 rebuildDirtyChunks 主体；worker 不可用/失败时回退路径）
  _buildChunkSync(chunk) {
    this._removeChunkMeshes(chunk);
    const meshes = this.chunkBuilder.build(chunk);
    this._attachChunkMeshes(chunk, meshes);
    chunk.dirty = false;
  }

  // worker 异步派发：填缓存 → 拷贝转移 → 回执校验版本后装配上屏。
  // 返回 false 表示当前不可用（无 worker/已熔断），调用方走同步路径。
  _dispatchMeshBuild(chunk) {
    const mw = this.world.meshWorker;
    if (!mw || mw.broken) return false;
    const builder = this.chunkBuilder;
    builder._curChunk = chunk;
    builder._fillCache(chunk);
    builder._fillLightCaches(chunk);
    builder._refreshOpaqueLUT();
    const version = ++this._meshBuildSeq;
    chunk._meshVersion = version;
    chunk._meshInFlight = true;
    // 派发快照吸收当前 dirty（回执落地后不再清）：
    // 在途窗口内的新标脏（邻居加载/光照泛洪/setBlock）会保留到落地后、下帧重建——
    // 旧版回执无条件清 dirty，在途期间的重建请求被吞，边界面伪影残留（CW-1）
    chunk.dirty = false;
    mw.build(chunk.cx, chunk.cz,
      builder._cache.slice(), builder._skyCache.slice(), builder._blockLCache.slice(),
      { smoothLighting: RenderQuality.smoothLighting, aoEnabled: RenderQuality.aoEnabled },
      version)
      .then((out) => {
        chunk._meshInFlight = false;
        // 过期/世界已换：丢弃（期间被改脏 → 下一帧循环重新派发）
        if (this.world.getChunk(chunk.cx, chunk.cz) !== chunk || chunk._meshVersion !== version) return;
        this._applyMeshOut(chunk, out);
      })
      .catch(() => {
        chunk._meshInFlight = false;
        mw.broken = true; // 熔断：后续全部回退同步 build
        this._buildChunkSync(chunk);
      });
    return true;
  }

  // worker 回执落地：装配并替换旧网格。
  // 不在此清 dirty——派发时已吸收为 false；在途期间被标脏则保持 true、下帧重建
  _applyMeshOut(chunk, out) {
    this._removeChunkMeshes(chunk);
    const meshes = this.chunkBuilder.assembleMeshes(out, chunk);
    this._attachChunkMeshes(chunk, meshes);
  }

  _removeChunkMeshes(chunk) {
    if (chunk.mesh) {
      this.renderer.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }
    if (chunk.waterMesh) {
      this.renderer.scene.remove(chunk.waterMesh);
      chunk.waterMesh.geometry.dispose();
      chunk.waterMesh = null;
    }
    if (chunk.lightMesh) {
      this.renderer.scene.remove(chunk.lightMesh);
      chunk.lightMesh.geometry.dispose();
      chunk.lightMesh = null;
    }
  }

  _attachChunkMeshes(chunk, meshes) {
    if (meshes.solid) {
      chunk.mesh = meshes.solid;
      this.renderer.scene.add(chunk.mesh);
    }
    if (meshes.water) {
      chunk.waterMesh = meshes.water;
      this.renderer.scene.add(chunk.waterMesh);
    }
    if (meshes.light) {
      chunk.lightMesh = meshes.light;
      this.renderer.scene.add(chunk.lightMesh);
    }
  }

  // T5：箱子被本地破坏 → 容器内容散落 + 清容器数据；开着的箱子界面一并关闭
  _breakChest(block, dropContents) {
    const items = this.world.getContainer(block.x, block.y, block.z);
    this.world.removeContainer(block.x, block.y, block.z);
    if (this.chestScreen && this.chestScreen.visible && this.chestScreen.pos &&
        this.chestScreen.pos.x === block.x && this.chestScreen.pos.y === block.y &&
        this.chestScreen.pos.z === block.z) {
      this.chestScreen._changed = false; // 容器已销毁，hide 不再上报
      this.chestScreen.hide();
    }
    if (!items || !dropContents) return;
    for (const s of items) {
      if (!s) continue;
      if (this.networkMode && this.net) {
        this.net.sendDropSpawn(block.x + 0.5, block.y + 0.5, block.z + 0.5, s.name, s.count);
      } else if (this.mobManager) {
        this.mobManager.spawnDrop(
          new THREE.Vector3(block.x + 0.5, block.y + 0.5, block.z + 0.5), s.name, s.count, null, { pickupDelay: 0.5 });
      }
    }
  }

  // Idea-2C：潜影盒破坏——内容不散落，跟随盒体成单一掉落（data 通道）
  // toInventory：单机生存直接入背包（与普通方块掉落同惯例）；联机/创造走实体掉落
  _breakShulkerBox(block, toInventory) {
    const items = this.world.getContainer(block.x, block.y, block.z);
    this.world.removeContainer(block.x, block.y, block.z);
    if (this.chestScreen && this.chestScreen.visible && this.chestScreen.pos &&
        this.chestScreen.pos.x === block.x && this.chestScreen.pos.y === block.y &&
        this.chestScreen.pos.z === block.z) {
      this.chestScreen._changed = false; // 容器已销毁，hide 不再上报
      this.chestScreen.hide();
    }
    const data = (items && items.some(s => s)) ? items : null; // 空盒不带 data
    if (this.networkMode && this.net) {
      this.net.sendDropSpawn(block.x + 0.5, block.y + 0.5, block.z + 0.5, 'shulker_box', 1, data);
    } else if (toInventory && this.player.survival) {
      this.inventory.add('shulker_box', 1, data);
    } else if (this.mobManager) {
      this.mobManager.spawnDrop(
        new THREE.Vector3(block.x + 0.5, block.y + 0.5, block.z + 0.5), 'shulker_box', 1, data, { pickupDelay: 0.5 });
    }
    if (this.hotbar) this.hotbar.update();
  }

  // T5：容器修改上报出口（ChestScreen 每次改动调用）；联机整箱广播，单机 noop
  onContainerChanged(pos, items) {
    if (this.networkMode && this.net) this.net.sendContainerSet(pos.x, pos.y, pos.z, items);
  }

  // 各物品 UI 当前悬浮的物品名（R/U 配方查询的作用目标）
  _uiHoverName() {
    const screens = [this.inventoryScreen, this.chestScreen, this.furnaceScreen, this.tradeScreen];
    for (const s of screens) {
      if (s && s.visible && s._hoverName) return s._hoverName;
    }
    return null;
  }

  // 熔炉烧炼推进：遍历当前维度全部已开炉状态（惰性创建，只有打开过/放料过的炉子在表里）
  // 语义对齐原版：燃料燃尽暂停（进度保温缓慢回退）、输出槽同类未满才续烧、燃料点燃即扣 1 个
  updateFurnaces(dt) {
    if (!this.world || !this.world.furnaces) return;
    // B28 点燃态方块切换仅 host/单机权威（客户端不写方块，靠 block_set 广播收敛——同流体模拟门控）
    const isClient = !!(this.networkMode && this.net && !this.net.isHost);
    for (const [key, st] of this.world.furnaces) {
      const recipe = st.input ? getSmeltingResult(st.input.name) : null;
      const canSmelt = !!(recipe && (!st.output ||
        (st.output.name === recipe.output && st.output.count + recipe.count <= 64)));
      if (st.burnTime > 0) st.burnTime -= dt;
      // 点火：火焰熄了但还能烧且有燃料
      if (st.burnTime <= 0 && canSmelt && st.fuel) {
        const ft = getFuelTime(st.fuel.name);
        if (ft > 0) {
          st.burnMax = ft;
          st.burnTime = ft;
          st.fuel.count--;
          if (st.fuel.count <= 0) st.fuel = null;
        }
      }
      if (st.burnTime > 0 && canSmelt) {
        st.cookTime += dt;
        // 有界循环：大步长 dt（卡顿/追赶）也能连续产出，不积压 cookTime
        let guard = 0;
        while (st.cookTime >= SMELT_TIME && guard++ < 64) {
          const r = st.input ? getSmeltingResult(st.input.name) : null;
          if (!r || (st.output && (st.output.name !== r.output || st.output.count + r.count > 64))) break;
          st.cookTime -= SMELT_TIME;
          if (st.output) st.output.count += r.count;
          else st.output = { name: r.output, count: r.count, data: null };
          st.input.count--;
          if (st.input.count <= 0) st.input = null;
        }
        if (!st.input) st.cookTime = 0; // 断料清进度（原版语义）
      } else if (st.cookTime > 0) {
        // 熄火/断料：进度缓慢回退而不是瞬间清零
        st.cookTime = Math.max(0, st.cookTime - dt * 2);
      }
      // B28：燃烧起止边沿切换点燃态方块（保留朝向；light:13 由光照引擎增量更新）
      if (!isClient) this._syncFurnaceLit(key, st);
    }
  }

  // B28：熔炉点燃态方块同步（key = World.furnaceKey "x,y,z"）。
  // 只在「方块仍是熔炉家族 + 点燃与否发生变化」时写一次；写走 World.setBlock（账本/联机/光照全路径收口）。
  _syncFurnaceLit(key, st) {
    const parts = key.split(',').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return;
    const [x, y, z] = parts;
    const def = BlockRegistry.getById(this.world.getBlock(x, y, z));
    if (!def || def.baseBlock !== 'furnace') return; // 已被挖掉/替换：状态表由 _breakFurnace 清理
    const lit = st.burnTime > 0;
    if (def.lit === lit) return;
    const nid = furnaceLitId(def.facing || 'n', lit);
    if (nid) this.world.setBlock(x, y, z, nid);
  }

  // 挖毁熔炉：清理状态 + 内容物散落（箱子同款语义），关掉正开着的炉界面
  _breakFurnace(block) {
    const st = this.world.getFurnace(block.x, block.y, block.z);
    this.world.removeFurnace(block.x, block.y, block.z);
    if (this.furnaceScreen && this.furnaceScreen.visible && this.furnaceScreen.pos &&
        this.furnaceScreen.pos.x === block.x && this.furnaceScreen.pos.y === block.y &&
        this.furnaceScreen.pos.z === block.z) {
      this.furnaceScreen.hide();
    }
    if (!st) return;
    for (const s of [st.input, st.fuel, st.output]) {
      if (!s) continue;
      if (this.networkMode && this.net) {
        this.net.sendDropSpawn(block.x + 0.5, block.y + 0.5, block.z + 0.5, s.name, s.count);
      } else if (this.mobManager) {
        this.mobManager.spawnDrop(
          new THREE.Vector3(block.x + 0.5, block.y + 0.5, block.z + 0.5), s.name, s.count, null, { pickupDelay: 0.5 });
      }
    }
  }

  // Build 20 ③：创造模式中键取物（同原版 pick block）——准星指向的方块进入快捷栏：
  // 热栏已有该物品 → 直接选中那格；否则以 1 个替换当前选中格。仅创造响应，生存/旁观忽略。
  _pickBlock() {
    if (!this.player.creative || !this.selectedBlock || !this.world) return;
    // B28：状态家族方块（门/床/箱子/熔炉/头颅…）取物映射回基础物品名（否则拿到 _e/_open 这类不存在的物品）
    const def = BlockRegistry.getById(this.selectedBlock.id);
    const name = (def && def.baseBlock) || BlockRegistry.getNameById(this.selectedBlock.id);
    if (!name) return;
    const slots = this.inventory.slots;
    for (let i = 0; i < 9; i++) {
      if (slots[i] && slots[i].name === name && !slots[i].data) {
        this.inventory.setSelected(i);
        if (this.hotbar) { this.hotbar.update(); this.hotbar.flashName(); }
        return;
      }
    }
    const sel = this.inventory.hotbarSelected;
    slots[sel] = { name, count: 1 };
    if (this.hotbar) { this.hotbar.update(); this.hotbar.flashName(); }
  }

  updateRaycast() {
    const origin = this.player.position.clone();
    origin.y += 1.62;
    const dir = new THREE.Vector3();
    this.renderer.camera.getWorldDirection(dir);

    const maxDist = this.player.creative ? 5 : 4.5;
    // 空桶对准流体：射线需命中水/岩浆（否则准星穿透无法舀取）
    const held = this.inventory.getSelected();
    const hit = this.raycast.cast(origin, dir, maxDist, !!held && held.name === 'bucket');
    this.selectedBlock = hit;

    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5);
    } else {
      this.highlight.visible = false;
      this.breakingProgress = 0;
    }

    // 计算准星目标 —— 方块与实体取较近者，用于 InfoBar 显示
    let blockDist = Infinity;
    if (hit) {
      const cx = hit.block.x + 0.5 - origin.x;
      const cy = hit.block.y + 0.5 - origin.y;
      const cz = hit.block.z + 0.5 - origin.z;
      blockDist = Math.sqrt(cx * cx + cy * cy + cz * cz);
    }
    let info = null;
    if (this.mobManager) {
      const mh = this.mobManager.findMobByRay(origin, dir, maxDist);
      if (mh && mh.distance < blockDist) {
        const t = mh.mob.type;
        info = { type: 'mob', displayName: tName(t.name, t.displayName || t.name), name: t.name };
      }
    }
    if (!info && hit) {
      const def = BlockRegistry.getById(hit.id);
      info = { type: 'block', displayName: def ? getDisplayName(def.name) : t('未知'), name: def ? def.name : '?' };
    }
    this.crosshairInfo = info;
  }

  handleMouseInput(dt) {
    this._miningActive = false; // 默认非挖掘（早退分支自然复位）
    // 弓蓄力通道（Idea-2A）：独立于下方单击分支——蓄力中吞掉全部右键语义防中途误触，
    // 松手在此检测（mouseup 后 controls.mouseRight 变 false，下方 mouseRight 块不会再进）。
    if (this._bowCharging) {
      const uiOpen = (this.inventoryScreen && this.inventoryScreen.visible) ||
        (this.chestScreen && this.chestScreen.visible) ||
        (this.furnaceScreen && this.furnaceScreen.visible) ||
        (this.tradeScreen && this.tradeScreen.visible);
      if (uiOpen) {
        this._cancelBowCharge();
      } else if (!this.controls.mouseRight) {
        this._releaseBow();
      } else {
        const sel = this.inventory.getSelected();
        if (!sel || sel.name !== 'bow') {
          this._cancelBowCharge();
          this.controls.mouseRight = false; // 中途换手持物：本次按住作废，不触发其它分支
        } else {
          this._bowCharge = Math.min(1, this._bowCharge + dt); // 1 秒满蓄
          this.hand.setBowDraw(this._bowCharge);
          return;
        }
      }
    }
    if (this.inventoryScreen && this.inventoryScreen.visible) return;
    if (this.chestScreen && this.chestScreen.visible) return;
    if (this.furnaceScreen && this.furnaceScreen.visible) return;
    if (this.tradeScreen && this.tradeScreen.visible) return;
    // 对空可持弓/掷眼（分支不依赖命中）——放宽未命中早退
    const heldNow = this.inventory.getSelected();
    const bowLikeHeld = !!heldNow && (heldNow.name === 'bow' || heldNow.name === 'ender_eye');
    if (!this.selectedBlock && !(this.controls.mouseLeft && this.mobManager) &&
        !(this.controls.mouseRight && bowLikeHeld)) return;
    
    if (this.controls.mouseLeft) {
      // 联机互殴：先检测远端玩家（射线命中优先于怪物）；Idea-4A：房间关闭 PvP 时跳过远端检测
      if (this.networkMode && this.net && this.net.roomSettings?.pvp !== false && !this.inventoryScreen?.visible) {
        const origin = this.player.position.clone();
        origin.y += 1.62;
        const dir = new THREE.Vector3();
        this.renderer.camera.getWorldDirection(dir);
        const rp = this._findRemoteByRay(origin, dir, 4);
        if (rp) {
          this.hand.swing(); // 阶段10：命中远端玩家挥动
          this.net.sendAttackPlayer(rp.id, this.getAttackDamage());
          this.controls.mouseLeft = false;
          return;
        }
      }
      // 先尝试攻击怪物
      if (this.mobManager && !this.inventoryScreen?.visible) {
        const origin = this.player.position.clone();
        origin.y += 1.62;
        const dir = new THREE.Vector3();
        this.renderer.camera.getWorldDirection(dir);
        const damage = this.player.creative ? 100 : this.getAttackDamage();
        // Build 20 ④：创造玩家攻击不激怒中立/守卫生物（怪物不以创造玩家为敌）
        const hit = this.mobManager.attackMob(origin, dir, 4, damage, { provoke: !this.player.creative });
        if (hit) {
          this.hand.swing(); // 阶段10：命中怪物挥动
          this.controls.mouseLeft = false;
          return;
        }
      }
      
      if (!this.selectedBlock) return;
      const hit = this.selectedBlock;
      const def = BlockRegistry.getById(hit.id);
      if (!def) return;
      
      if (this.player.creative) {
        if (this.particles) this.particles.burstBlockBreak(hit.block.x + 0.5, hit.block.y, hit.block.z + 0.5, def, this.world);
        audio.blockBreak(def);
        if (def.baseBlock === 'chest') this._breakChest(hit.block, false); // B28 家族（四朝向）
        if (def.name === 'beacon') this._breakBeacon(hit.block.x, hit.block.y, hit.block.z); // Idea-2D-③：清激活状态+光柱
        if (def.name === 'shulker_box') this._breakShulkerBox(hit.block, false); // Idea-2C：创造也掉盒（内容跟随）
        if (def.baseBlock === 'furnace') this._breakFurnace(hit.block); // B28 家族（四朝向 × 点燃态）
        if (def.name === 'end_crystal') this._breakCrystal(hit.block.x, hit.block.y, hit.block.z);
        // Build 20 ④：创造挖星髓不再激怒潮鸣（激怒调用仅生存分支保留）
        if (def.name === 'gale_block') this._clearGaleColumn(hit.block.x, hit.block.y, hit.block.z); // 批次 B：拆风阵块清气流柱
        this._removeShapedPartner(def, hit.block.x, hit.block.y, hit.block.z); // B27 门/床：创造瞬破同样连动另一半
        this.world.setBlock(hit.block.x, hit.block.y, hit.block.z, 0);
        removeConnectedPortals(this.world, hit.block.x, hit.block.y, hit.block.z);
        if (this.redstone) this.redstone.onBlockChange(hit.block.x, hit.block.y, hit.block.z);
        this.controls.mouseLeft = false;
      } else if (this.player.survival) {
        // 挖掘进度（工具类型匹配加速：tier 速度表；无工具/类型不符 1 倍）
        const hardness = def.hardness;
        if (hardness < 0 || def.fluid) { this.controls.mouseLeft = false; return; }
        const held = this._heldToolItem();
        // 信标急迫效果（Idea-2D-③）：每级 +30% 挖掘速度（叠加在工具速度倍率上）
        const haste = this.player.getEffectLevel ? this.player.getEffectLevel('haste') : 0;
        const speedMul = (held && held.tool === def.tool
          ? (held.name.startsWith('gold_') ? 9 : (TOOL_TIER_SPEED[held.tier] || 1)) : 1)
          * (1 + 0.3 * haste);
        // 阶段11：挥动节奏与挖掘进度联动——挥动周期 ≈ 实际挖穿耗时（硬块深而慢、软块轻快）
        const breakTime = Math.min(10, Math.max(0.1, hardness / speedMul));
        this.hand.miningPeriod = Math.min(1.0, Math.max(0.25, breakTime));
        this._miningActive = true;
        this.breakingProgress += dt * speedMul / hardness;
        this.breakMesh.visible = true;
        this.breakMesh.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5);
        this.breakMesh.material.opacity = Math.min(0.5, this.breakingProgress * 0.5);
        // 挖掘中小碎粒（每 0.25s 一两粒）
        this._miningPuffTimer = (this._miningPuffTimer || 0) + dt;
        if (this._miningPuffTimer >= 0.25 && this.particles) {
          this._miningPuffTimer = 0;
          this.particles.puffMining(hit.block.x + 0.5, hit.block.y, hit.block.z + 0.5, def, this.world);
          audio.digHit(def); // 挖掘命中音（与碎粒同节奏，天然限频）
        }
        if (this.breakingProgress >= 1) {
          if (this.particles) this.particles.burstBlockBreak(hit.block.x + 0.5, hit.block.y, hit.block.z + 0.5, def, this.world);
          audio.blockBreak(def);
          if (def.baseBlock === 'chest') this._breakChest(hit.block, true); // B28 家族（四朝向）
          if (def.name === 'beacon') this._breakBeacon(hit.block.x, hit.block.y, hit.block.z); // Idea-2D-③：清激活状态+光柱
          if (def.name === 'shulker_box') this._breakShulkerBox(hit.block, true); // Idea-2C：内容跟随盒体
          if (def.baseBlock === 'furnace') this._breakFurnace(hit.block); // B28 家族（四朝向 × 点燃态）
          if (def.name === 'end_crystal') this._breakCrystal(hit.block.x, hit.block.y, hit.block.z);
          if (def.name === 'star_marrow_ore') this.mobManager?.angerTideEchoes(hit.block.x, hit.block.y, hit.block.z); // 批次 B：潮鸣激怒
          if (def.name === 'gale_block') this._clearGaleColumn(hit.block.x, hit.block.y, hit.block.z); // 批次 B：拆风阵块清气流柱
          this._removeShapedPartner(def, hit.block.x, hit.block.y, hit.block.z); // B27 门/床：破坏任一半连动另一半
          this.world.setBlock(hit.block.x, hit.block.y, hit.block.z, 0);
          removeConnectedPortals(this.world, hit.block.x, hit.block.y, hit.block.z);
          if (this.redstone) this.redstone.onBlockChange(hit.block.x, hit.block.y, hit.block.z);
          this.breakingProgress = 0;
          this.breakMesh.visible = false;
          this.controls.mouseLeft = false;
          const drops = this._blockDrops(def);
          if (drops.length > 0) {
            for (const d of drops) {
              if (this.networkMode && this.net) {
                // 联机：生成物理掉落物（服务器广播 drop_spawn，各端看到同一个），谁都能拾取
                this.net.sendDropSpawn(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5, d.name, d.count);
              } else {
                // 单机：简化直接进入背包
                this.inventory.add(d.name, d.count);
              }
            }
            this.hotbar.update();
            // 挖矿经验（掉落被门控拒绝时不给——与原版"错误工具无掉落也无经验"一致）
            const oreXp = ORE_XP[def.name];
            if (oreXp) this.player.addXp(oreXp);
          }
        }
      } else if (this.player.spectator) {
        this.controls.mouseLeft = false;
      }
    } else {
      this.breakingProgress = 0;
      this.breakMesh.visible = false;
    }
    
    if (this.controls.mouseRight) {
      // T5：右键村民优先交互（开交易屏；旁观不可）
      if (this.mobManager && this.tradeScreen && !this.player.spectator) {
        const o = this.player.position.clone();
        o.y += 1.62;
        const d = new THREE.Vector3();
        this.renderer.camera.getWorldDirection(d);
        const mh = this.mobManager.findMobByRay(o, d, 4);
        if (mh && mh.mob.typeName === 'villager' && !mh.mob.dead) {
          this.tradeScreen.show(mh.mob);
          this.controls.mouseRight = false;
          return;
        }
      }

      // 右键熔炉打开熔炉界面（方块交互优先于手持食物食用，与原版一致）
      const furnaceHit = this.selectedBlock;
      const furnaceDef = furnaceHit ? BlockRegistry.getById(furnaceHit.id) : null;
      if (furnaceDef && furnaceDef.baseBlock === 'furnace' && this.furnaceScreen && !this.player.spectator) {
        this.furnaceScreen.show(furnaceHit.block.x, furnaceHit.block.y, furnaceHit.block.z);
        this.controls.mouseRight = false;
        return;
      }

      const hit = this.selectedBlock;
      const sel = this.inventory.getSelected();

      // 先处理食用：手持物品是食物且玩家不在创造/旁观模式且饥饿未满
      if (sel && this.player.survival) {
        const itemDef = ItemRegistry.getByName(sel.name);
        if (itemDef && itemDef.food && this.player.food < this.player.maxFood) {
          if (this.player.eat(itemDef)) {
            this.hand.swing(); // 阶段10：进食挥动
            audio.eat();
            this.inventory.removeSelected(1);
            this.hotbar.update();
            if (itemDef.name === 'chorus_fruit') this._chorusTeleport(); // 紫颂果随机短距传送
          }
          this.controls.mouseRight = false;
          return;
        }
      }

      // 经验瓶：饮用 +3~11 经验（原版区间 3-11），消耗 1 个
      if (sel && this.player.survival && sel.name === 'experience_bottle') {
        this.hand.swing();
        this.inventory.removeSelected(1);
        this.hotbar.update();
        this.player.addXp(3 + Math.floor(Math.random() * 9));
        this.controls.mouseRight = false;
        return;
      }

      // B27 门/活板门：右键开关（木门/活板门切换整扇；铁门仅红石——原版语义）
      if (furnaceDef && furnaceDef.part && !this.player.spectator &&
          (furnaceDef.part === 'door_lower' || furnaceDef.part === 'door_upper' || furnaceDef.part === 'trapdoor')) {
        if (furnaceDef.baseBlock === 'oak_door' || furnaceDef.part === 'trapdoor') {
          if (this.redstone) {
            this.redstone.toggleDoor(furnaceHit.block.x, furnaceHit.block.y, furnaceHit.block.z);
            audio.blockPlace(furnaceDef); // 开关音沿用材质分路（wood）
          }
        }
        this.controls.mouseRight = false;
        return;
      }

      // 床：非主世界引爆（原版语义——床只能在主世界睡）；主世界记重生点 + 夜间入睡
      if (furnaceDef && (furnaceDef.part === 'bed_foot' || furnaceDef.part === 'bed_head') && !this.player.spectator) {
        if (this.world.dimension !== 'overworld') {
          this.bedSpawn = null;
          const bx = furnaceHit.block.x + 0.5, by = furnaceHit.block.y + 0.5, bz = furnaceHit.block.z + 0.5;
          if (this.mobManager) this.mobManager.pendingExplosions.push({ x: bx, y: by, z: bz, radius: 3 }); // 另一半床体一并清除
          const d = this.player.position.distanceTo(new THREE.Vector3(bx, by, bz));
          const dmg = Math.round(12 * Math.max(0, 1 - d / 6));
          if (dmg > 0) this.player.hurt(dmg, 'bed', true);
          if (this.chatBox) this.chatBox.add(t('床在这个维度无法安眠——轰！'), '#faa');
          this.controls.mouseRight = false;
          return;
        }
        this.bedSpawn = { x: furnaceHit.block.x, y: furnaceHit.block.y, z: furnaceHit.block.z, dimension: this.world.dimension };
        if (!this.networkMode && this.sky.isNight()) {
          if (this._hostileNearby(8)) {
            if (this.chatBox) this.chatBox.add(t('你现在无法入睡，附近有怪物在游荡'), '#fcc');
          } else {
            if (this.chatBox) this.chatBox.add(t('你睡了一觉，重生点已设置'), '#cfc');
            this.sleepOverlay.show(() => { this.sky.time = 0.25; }); // 全黑瞬间跳日出
          }
        } else if (this.chatBox) {
          this.chatBox.add(this.networkMode ? t('重生点已设置（联机时间由服务器管理）') : t('重生点已设置（夜晚右键床可直接入睡）'), '#cfc');
        }
        audio.blockPlace(furnaceDef); // 床交互音（cloth 分路）
        this.controls.mouseRight = false;
        return;
      }

      // 先检查是否右键点击了工作台
      if (hit) {
        const targetDef = BlockRegistry.getById(hit.id);
        if (targetDef && targetDef.name === 'crafting_table') {
          this.inventoryScreen.show(3);
          this.controls.mouseRight = false;
          return;
        }
        // T5：右键箱子/潜影盒打开容器界面（创造/生存都可；旁观不可）
        if (targetDef && (targetDef.baseBlock === 'chest' || targetDef.name === 'shulker_box') && this.chestScreen && !this.player.spectator) {
          this.chestScreen.show(hit.block.x, hit.block.y, hit.block.z);
          this.controls.mouseRight = false;
          return;
        }
        // Idea-2D-③：右键信标打开效果选择界面（旁观不可）
        if (targetDef && targetDef.name === 'beacon' && this.beaconScreen && !this.player.spectator) {
          this.beaconScreen.show(hit.block.x, hit.block.y, hit.block.z);
          this.controls.mouseRight = false;
          return;
        }
        // 天域批次 A：右键石碑读碑文（世界观批次 W3 起按 stele 家族标记判定——
        // 修复 wind_stele 硬编码导致 ember/moss 石碑无法右键阅读的遗漏；章节走 steleChapterAt）
        // 终局篇 F3：守望界碑听潮门控（候潮 ∧ 未听过 → 触发仪式；否则照旧读章）
        if (targetDef && targetDef.stele && this.steleScreen && !this.player.spectator) {
          if (!this._tryListenTide(hit.block)) {
            this.steleScreen.open(hit.block.x, hit.block.y, hit.block.z);
          }
          this.controls.mouseRight = false;
          return;
        }
        // 天域批次 C：恒昼祭坛——持风暴图腾右键召唤守誓巨像（可重复；房间 mobs:false 拒绝）
        // 天域批次 D：无图腾右键 → 尝试复潮仪式
        if (targetDef && targetDef.name === 'aether_altar' && !this.player.spectator) {
          if (sel && sel.name === 'storm_totem') {
            if (this.networkMode && this.net && this.net.roomSettings && this.net.roomSettings.mobs === false) {
              if (this.chatBox) this.chatBox.add(t('该房间已关闭怪物生成，祭坛无视图腾。'), '#fbb');
            } else {
              if (this.player.survival) {
                this.inventory.removeSelected(1);
                this.hotbar.update();
              }
              // 殿前苏醒：底台东缘（门侧）地面高度，rise 阶段立起后进入岩卫
              this.mobManager?._spawnAt('storm_colossus', hit.block.x + 6.5, hit.block.y + 2.05, hit.block.z + 0.5);
              if (this.particles) {
                const marrowDef = BlockRegistry.getByName('star_marrow_block');
                if (marrowDef) this.particles.burstBlockBreak(hit.block.x + 0.5, hit.block.y + 2, hit.block.z + 0.5, marrowDef, this.world);
              }
            }
          } else {
            this._tryTideRitual(hit.block); // 批次 D：无图腾 → 尝试复潮仪式
          }
          this.controls.mouseRight = false;
          return;
        }
        // 天域批次 D：潮心祭坛——献证候潮（终局篇 F1）/ 浮现第九章碑文（复潮）
        if (targetDef && targetDef.name === 'tide_altar' && this.steleScreen && !this.player.spectator) {
          this._tryPrimordialOffering(hit.block); // 三证齐 → 置换原初祭坛候潮；否则照旧浮现复潮章
          this.controls.mouseRight = false;
          return;
        }
        // 终局篇 F1/K2：原初祭坛——右键浮现候潮章（候潮态受体，随时可复读）
        if (targetDef && targetDef.name === 'primordial_altar' && this.steleScreen && !this.player.spectator) {
          this.steleScreen.open(hit.block.x, hit.block.y, hit.block.z, 'tide_waiting');
          this.controls.mouseRight = false;
          return;
        }
        // 红石交互：拉杆/按钮
        if (targetDef && this.redstone) {
          const interacted = this.redstone.onBlockInteract(hit.block.x, hit.block.y, hit.block.z, hit.id);
          if (interacted) {
            this.controls.mouseRight = false;
            return;
          }
        }
        // 桶：空桶只舀流体源（流动等级方块不可舀，原版规则）/ 满桶对任意面倒出（倒出即触发流动模拟）
        if (sel && sel.name === 'bucket' && targetDef && targetDef.fluid
            && (targetDef.name === 'water' || targetDef.name === 'lava')) {
          const filled = targetDef.name === 'water' ? 'water_bucket' : 'lava_bucket';
          this.world.setBlock(hit.block.x, hit.block.y, hit.block.z, 0);
          if (this.player.survival) {
            this.inventory.slots[this.inventory.hotbarSelected] = { name: filled, count: 1, data: null };
            this.hotbar.update();
          }
          this.controls.mouseRight = false;
          return;
        }
        if (sel && (sel.name === 'water_bucket' || sel.name === 'lava_bucket') && hit) {
          const fluid = sel.name === 'water_bucket' ? 'water' : 'lava';
          const fx = hit.block.x + hit.normal.x, fy = hit.block.y + hit.normal.y, fz = hit.block.z + hit.normal.z;
          if (this.world.getBlock(fx, fy, fz) === 0) {
            this.world.setBlock(fx, fy, fz, BlockRegistry.getId(fluid));
            if (this.player.survival) {
              this.inventory.slots[this.inventory.hotbarSelected] = { name: 'bucket', count: 1, data: null };
              this.hotbar.update();
            }
            this.controls.mouseRight = false;
            return;
          }
        }
        // 传送门点火：打火石右键黑曜石框→下界门 / 萤石框→天域门（迭代 M2）
        if (sel && sel.name === 'flint_and_steel' && targetDef) {
          if (this._tryLightPortal(hit, targetDef)) {
            this.controls.mouseRight = false;
            return;
          }
        }
        // 末地传送门逐框激活：末影之眼右键无眼框架（迭代 M3）
        if (sel && sel.name === 'ender_eye' && targetDef) {
          if (this._tryPlaceEndEye(hit, targetDef)) {
            this.controls.mouseRight = false;
            return;
          }
        }
        // 耕种：骨粉催熟/右键收获/播种/锄地（作物与耕地专属，不与放置路径冲突）
        if (this._tryFarmInteract(hit, targetDef, sel)) {
          this.controls.mouseRight = false;
          return;
        }
      }
      
      if (sel && hit) {
        const placeX = hit.block.x + hit.normal.x;
        const placeY = hit.block.y + hit.normal.y;
        const placeZ = hit.block.z + hit.normal.z;

        // 检查是否会与玩家重叠
        const px = this.player.position.x, py = this.player.position.y, pz = this.player.position.z;
        if (placeX >= Math.floor(px - 0.3) && placeX <= Math.floor(px + 0.3) &&
            placeY >= Math.floor(py) && placeY <= Math.floor(py + 1.8) &&
            placeZ >= Math.floor(pz - 0.3) && placeZ <= Math.floor(pz + 0.3)) {
          return;
        }

        const blockDef = BlockRegistry.getByName(sel.name);
        if (blockDef) {
          this.hand.swing(); // 阶段10：放置方块挥动
          // B27：门/床/活板门形制放置（多格 + 朝向；失败不消耗）
          if (blockDef.part && this._tryPlaceShaped(placeX, placeY, placeZ, blockDef)) {
            if (this.player.survival) {
              this.inventory.removeSelected(1);
              this.hotbar.update();
            }
            this.controls.mouseRight = false;
            return;
          }
          // B28 定向面方块（箱子/熔炉/头颅）：正面朝玩家 → 放置时换成对应朝向态 ID
          // （家族态之间共享同一物品；掉落/取物经 baseBlock 映射回基础名）
          const placedId = blockDef.facingBase
            ? (facingId(blockDef.facingBase, this._facingTowardPlayer(placeX, placeZ)) || blockDef.id)
            : blockDef.id;
          this.world.setBlock(placeX, placeY, placeZ, placedId);
          audio.blockPlace(blockDef);
          if (this.redstone) this.redstone.onBlockChange(placeX, placeY, placeZ);
          this._trySummonIronGolem(placeX, placeY, placeZ); // Idea-2E：铁傀儡召唤检测（南瓜/铁块完成 T 型）
          this._trySummonWither(placeX, placeY, placeZ); // Idea-2D-②：凋灵召唤检测（灵魂沙 + 头颅 T 型）
          // Idea-2C：潜影盒放置——物品内容落入容器账本并整箱广播（远端账本一致）
          if (blockDef.name === 'shulker_box') {
            const items = Array.isArray(sel.data) ? sel.data.slice(0, 27) : [];
            while (items.length < 27) items.push(null);
            this.world.setContainer(placeX, placeY, placeZ, items);
            if (this.networkMode && this.net) this.net.sendContainerSet(placeX, placeY, placeZ, items);
          }
          // 天域批次 B：风阵块放置 → 上方 12 格写风流柱（逐格 setBlock，联机自动逐格上报）
          if (blockDef.name === 'gale_block') this._writeGaleColumn(placeX, placeY, placeZ);
          if (this.player.survival) {
            this.inventory.removeSelected(1);
            this.hotbar.update();
          }
        }
      }
      // 弓：按住蓄力，松手发射（初速/伤害随 charge 插值；命中怪复用 attackMob 链）
      // 对准可交互物时上方单击分支优先，只有走到这里才进入蓄力——单击语义不误触。
      if (sel && sel.name === 'bow') {
        const hasArrow = this.player.creative || this.inventory.slots.some(s => s && s.name === 'arrow');
        if (hasArrow) {
          this._bowCharging = true; // 不消耗 mouseRight：按住期间由顶部蓄力通道累计，松手在顶部检测
          this._bowCharge = 0;
          this.hand.setBowDraw(0);
        } else {
          this.controls.mouseRight = false; // 无箭：维持原行为（不射）
        }
        return;
      }
      // 掷末影之眼：不依赖命中（对空掷出——原版手势）；嵌入框架分支已在上方 return
      if (sel && sel.name === 'ender_eye' && this.world.dimension === 'overworld') {
        this._throwEnderEye();
        return;
      }
      this.controls.mouseRight = false;
    }
  }

  // 掷末影之眼：消耗 1 颗，发光小球朝最近环带锚点飞 2.5s 后落回（20% 碎裂，原版）
  _throwEnderEye() {
    if (this.eyeFlight) return; // 飞行中不叠加
    this.inventory.removeSelected(1);
    this.hotbar.update();
    const p = this.player.position;
    let best = null, bestD = Infinity;
    for (const pt of ringPoints(this.world.seed)) {
      const d = (pt.x - p.x) ** 2 + (pt.z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = pt; }
    }
    if (best) {
      const dx = best.x - p.x, dz = best.z - p.z;
      // 八方位提示（北 = -Z，顺时针）
      const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
      const ang = Math.atan2(dx, -dz);
      const dirName = dirs[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
      if (this.chatBox) this.chatBox.add(t('末影之眼飞向{d}方（约 {n} 格）', { d: t(dirName), n: Math.round(Math.sqrt(bestD)) }), '#c8f');
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x66ffcc })
      );
      mesh.position.set(p.x, p.y + 1.62, p.z);
      this.renderer.scene.add(mesh);
      this.eyeFlight = { mesh, dir: new THREE.Vector3(dx, 6, dz).normalize(), t: 0, total: 2.5 };
    }
  }

  // 末影之眼飞行步进：到时落地——80% 落回背包，20% 碎裂（原版概率）
  _updateEyeFlight(dt) {
    const e = this.eyeFlight;
    e.t += dt;
    e.mesh.position.addScaledVector(e.dir, dt * 6);
    if (e.t >= e.total) {
      this.renderer.scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
      this.eyeFlight = null;
      if (Math.random() < 0.8) {
        this.inventory.add('ender_eye', 1);
        this.hotbar.update();
      }
    }
  }

  // 射箭：箭矢为本地投射物（几何/材质模块级共享），重力下坠、命中怪复用 attackMob 链
  // power = 初速系数（0.3~1 蓄力插值），dmg = 命中伤害（2~8 蓄力插值）；返回箭对象供联机上报
  _shootArrow(power = 1, dmg = 6) {
    const dir = new THREE.Vector3();
    this.renderer.camera.getWorldDirection(dir);
    const start = this.player.position.clone();
    start.y += 1.62;
    start.addScaledVector(dir, 0.6);
    this._ensureArrowAssets();
    const mesh = new THREE.Mesh(Game._arrowGeo, Game._arrowMat);
    mesh.position.copy(start);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    this.renderer.scene.add(mesh);
    const arrow = { mesh, pos: start, vel: dir.multiplyScalar(28 * power), life: 8, stuck: false, dmg };
    this.arrows.push(arrow);
    return arrow;
  }

  _ensureArrowAssets() {
    if (!Game._arrowGeo) Game._arrowGeo = new THREE.BoxGeometry(0.06, 0.06, 0.5);
    if (!Game._arrowMat) Game._arrowMat = new THREE.MeshBasicMaterial({ color: 0x9a7442 });
  }

  // Idea-2B：远端玩家射箭——本地生成纯视觉箭（dmg=0/remote=true：命中怪只消失不结算，
  // 伤害由射端经 mob_attack 权威上报；钉墙/寿命消失各端本地处理）
  spawnRemoteArrow(x, y, z, dx, dy, dz) {
    this._ensureArrowAssets();
    const pos = new THREE.Vector3(x, y, z);
    const vel = new THREE.Vector3(dx, dy, dz);
    const mesh = new THREE.Mesh(Game._arrowGeo, Game._arrowMat);
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vel.clone().normalize());
    this.renderer.scene.add(mesh);
    this.arrows.push({ mesh, pos, vel, life: 8, stuck: false, dmg: 0, remote: true });
  }

  _cancelBowCharge() {
    this._bowCharging = false;
    this._bowCharge = 0;
    this.hand.setBowDraw(null);
  }

  // 松手发射：charge→初速/伤害插值（vel=28×(0.3+0.7c)、dmg=2+round(6c)，即 8.4~28 m/s、2~8）
  _releaseBow() {
    const charge = this._bowCharge;
    this._cancelBowCharge();
    const sel = this.inventory.getSelected();
    if (!sel || sel.name !== 'bow') return; // 蓄力中途换了物品：只取消不射
    const hasArrow = this.player.creative || this.inventory.slots.some(s => s && s.name === 'arrow');
    if (!hasArrow) return;
    if (!this.player.creative) this.inventory.removeItems('arrow', 1);
    const arrow = this._shootArrow(0.3 + 0.7 * charge, 2 + Math.round(charge * 6));
    audio.bowShoot(charge);
    this.hand.swing();
    if (this.networkMode && this.net) this.net.sendArrowShot(arrow.pos, arrow.vel); // Idea-2B：初速广播
  }

  _updateArrows(dt) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      if (a.life <= 0) { this._despawnArrow(i); continue; }
      if (a.stuck) continue; // 钉在方块上直到寿命尽
      a.vel.y -= 12 * dt;
      const old = a.pos.clone();
      a.pos.addScaledVector(a.vel, dt);
      // 命中怪：整段位移作射线（球体口径同近战）
      const seg = new THREE.Vector3().subVectors(a.pos, old);
      const segLen = seg.length();
      if (segLen > 0 && this.mobManager) {
        const dirN = seg.clone().normalize();
        const mh = this.mobManager.findMobByRay(old, dirN, segLen + 0.2);
        if (mh && !mh.mob.dead) {
          if (!a.remote) this.mobManager.attackMob(old, dirN, segLen + 0.2, a.dmg || 6); // 伤害随蓄力；远端视觉箭不结算（射端权威）
          audio.arrowHit(); // 命中音（远端视觉箭也响，纯客户端效果）
          this._despawnArrow(i);
          continue;
        }
      }
      // 命中方块：钉住
      const bdef = BlockRegistry.getById(this.world.getBlock(Math.floor(a.pos.x), Math.floor(a.pos.y), Math.floor(a.pos.z)));
      if (bdef && bdef.solid && !bdef.fluid) {
        a.pos.copy(old);
        a.vel.set(0, 0, 0);
        a.stuck = true;
      }
      a.mesh.position.copy(a.pos);
    }
  }

  _despawnArrow(i) {
    const a = this.arrows[i];
    this.renderer.scene.remove(a.mesh); // 几何/材质为模块级共享，不 dispose
    this.arrows.splice(i, 1);
  }

  // ── 凋灵之首弹射物（Idea-2D-②）────────────────────────────────
  // 各端本地积分、命中本地玩家本地结算（同怪咬人语义：怪物 host 权威生成后各端自模拟）；
  // 广播仅视觉同步（服务器 except 发起者转发）。直线微坠弹，命中附加凋零 II。

  _ensureWitherSkullAssets() {
    if (!Game._skullGeo) Game._skullGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
    if (!Game._skullMat) Game._skullMat = new THREE.MeshBasicMaterial({ color: 0x33333c });
    if (!Game._galeMat) Game._galeMat = new THREE.MeshBasicMaterial({ color: 0x5ee8d2 }); // 天域风弹（批次 C）
  }

  // WitherAI 齐射回调：三发扇形（中央直射 + 左右 ±偏航），从胸前高度射出
  _spawnWitherSkullVolley(mob, player) {
    const start = mob.position.clone();
    start.y += mob.height * 0.75;
    const base = player.position.clone().add(new THREE.Vector3(0, 1, 0)).sub(start).normalize();
    for (let i = -1; i <= 1; i++) {
      const yaw = i * 0.14;
      const dir = new THREE.Vector3(
        base.x * Math.cos(yaw) - base.z * Math.sin(yaw),
        Math.max(-0.25, base.y + i * 0.05),
        base.x * Math.sin(yaw) + base.z * Math.cos(yaw)
      ).normalize();
      this._spawnWitherSkull(start.clone().addScaledVector(dir, 0.9), dir);
    }
  }

  // 守誓巨像风弹齐射（批次 C）：三发扇形；裂心(wide)=五发宽扇（经 k:'gale' 复用 skull 通道）
  _spawnGaleVolley(mob, player, wide) {
    const start = mob.position.clone();
    start.y += mob.height * 0.7;
    const base = player.position.clone().add(new THREE.Vector3(0, 1, 0)).sub(start).normalize();
    const spread = wide ? 0.22 : 0.15;
    const n = wide ? 2 : 1;
    for (let i = -n; i <= n; i++) {
      const yaw = i * spread;
      const dir = new THREE.Vector3(
        base.x * Math.cos(yaw) - base.z * Math.sin(yaw),
        Math.max(-0.2, base.y + Math.abs(i) * 0.03),
        base.x * Math.sin(yaw) + base.z * Math.cos(yaw)
      ).normalize();
      this._spawnWitherSkull(start.clone().addScaledVector(dir, 1.2), dir, 'gale');
    }
  }

  _spawnWitherSkull(pos, dir, kind = 'wither') {
    this._ensureWitherSkullAssets();
    const mesh = new THREE.Mesh(Game._skullGeo, kind === 'gale' ? Game._galeMat : Game._skullMat);
    mesh.position.copy(pos);
    this.renderer.scene.add(mesh);
    this.witherSkulls.push({ mesh, pos: pos.clone(), vel: dir.clone().multiplyScalar(kind === 'gale' ? 18 : 16), life: 6, kind });
    if (this.networkMode && this.net) this.net.sendWitherSkull(pos, dir, kind); // 初速广播（纯视觉）
  }

  // 联机：远端凋灵弹/风弹初速回执——本地生成弹射物（不再广播，防回声环）
  spawnRemoteWitherSkull(x, y, z, dx, dy, dz, kind) {
    this._ensureWitherSkullAssets();
    const pos = new THREE.Vector3(x, y, z);
    const dir = new THREE.Vector3(dx, dy, dz);
    const mesh = new THREE.Mesh(Game._skullGeo, kind === 'gale' ? Game._galeMat : Game._skullMat);
    mesh.position.copy(pos);
    this.renderer.scene.add(mesh);
    this.witherSkulls.push({ mesh, pos, vel: dir.multiplyScalar(kind === 'gale' ? 18 : 16), life: 6, kind });
  }

  _updateWitherSkulls(dt) {
    for (let i = this.witherSkulls.length - 1; i >= 0; i--) {
      const s = this.witherSkulls[i];
      s.life -= dt;
      if (s.life <= 0) { this._despawnWitherSkull(i); continue; }
      s.vel.y -= 2.5 * dt; // 微坠（原版黑色头颅直线弹的轻度重力近似）
      s.pos.addScaledVector(s.vel, dt);
      // 命中本地玩家：水平 0.6 格半径 + 身高 1.8 线段距离（AABB 近似）
      const p = this.player;
      if (p && !p.dead && !p.spectator && !p.creative) {
        const clampedY = Math.max(0, Math.min(1.8, s.pos.y - p.position.y));
        const dx = s.pos.x - p.position.x, dz = s.pos.z - p.position.z;
        const dy = s.pos.y - (p.position.y + clampedY);
        if (dx * dx + dz * dz < 0.36 && dy * dy < 0.09) {
          if (s.kind === 'gale') {
            // 天域风弹（批次 C）：6 伤 + 击退（无凋零）
            if (p.hurt(6, 'mob', true)) {
              const dir = p.position.clone().sub(s.pos).setY(0);
              if (dir.lengthSq() > 0.0001) dir.normalize(); else dir.set(0, 0, 1);
              p.velocity.x += dir.x * 7;
              p.velocity.z += dir.z * 7;
              p.velocity.y += 3.5;
            }
          } else if (p.hurt(8, 'mob', true) && p.applyWither) {
            p.applyWither(10); // 8 伤 + 凋零 II 10s
          }
          audio.arrowHit();
          this._despawnWitherSkull(i);
          continue;
        }
      }
      // 命中方块：湮灭（钉墙语义不适用弹射物——原版凋灵之首触爆）
      const bdef = BlockRegistry.getById(this.world.getBlock(Math.floor(s.pos.x), Math.floor(s.pos.y), Math.floor(s.pos.z)));
      if (bdef && bdef.solid && !bdef.fluid) {
        audio.arrowHit();
        this._despawnWitherSkull(i);
        continue;
      }
      s.mesh.position.copy(s.pos);
    }
  }

  _despawnWitherSkull(i) {
    const s = this.witherSkulls[i];
    this.renderer.scene.remove(s.mesh);
    this.witherSkulls.splice(i, 1);
  }

  // ── 守誓巨像震地（批次 C）────────────────────────────────────
  // StormColossusAI 触发回调：本地结算自己 + 广播 colossus_slam（各端各自结算本地玩家）
  _colossusSlam(mob) {
    const pos = mob.position.clone();
    this._applyColossusSlam(pos);
    if (this.networkMode && this.net) this.net.sendColossusSlam(pos);
  }

  // 联机：远端震地回执——本地结算（不回播）
  spawnRemoteColossusSlam(x, y, z) {
    this._applyColossusSlam(new THREE.Vector3(x, y, z));
  }

  _applyColossusSlam(pos) {
    const p = this.player;
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
    if (this.particles) {
      const def = BlockRegistry.getByName('star_marrow_block');
      if (def) this.particles.burstBlockBreak(pos.x, pos.y, pos.z, def, this.world);
    }
  }

  // 裂心阶段风拽光环（批次 C）：巨像残血时把附近玩家拖向自己（岛缘=真实代价）。
  // 各端对本地玩家结算（巨像位置经既有怪物同步收敛）；创造飞行/旁观免疫。
  _updateColossusAura(dt) {
    if (!this.mobManager || !this.player) return;
    const p = this.player;
    if (p.dead || p.spectator || p.flying) return;
    for (const m of this.mobManager.mobs) {
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
  _tryTideRitual(block) {
    if (this.aetherDusk) return; // 已复潮
    const inv = this.inventory;
    const need = [['page_rising', 1], ['page_marrow', 1], ['page_sunder', 1], ['heart_shard', 3]];
    const hasAll = need.every(([n, c]) => {
      let have = 0;
      for (const s of inv.slots) if (s && s.name === n) have += s.count;
      return have >= c;
    });
    if (!hasAll) {
      if (this.chatBox) this.chatBox.add(t('祭坛沉默着——集齐三页潮汐残页与三枚心核碎片再来。'), '#cde');
      return;
    }
    need.forEach(([n, c]) => inv.removeItems(n, c));
    this.hotbar.update();
    // 祭坛置换：潮心祭坛（走 setBlock → 账本 + 光照 + 联机同步全自动）
    this.world.setBlock(block.x, block.y, block.z, BlockRegistry.getId('tide_altar'));
    this.applyAetherDusk(true);
    if (this.networkMode && this.net) this.net.sendAetherState(true);
    // 仪式演出：粒子潮涌 + 第九章碑文自动浮现
    if (this.particles) {
      const tideDef = BlockRegistry.getByName('tide_altar');
      if (tideDef) this.particles.burstBlockBreak(block.x + 0.5, block.y + 1.5, block.z + 0.5, tideDef, this.world);
    }
    this.steleScreen.open(block.x, block.y, block.z, 'renewal');
  }

  // ── 终局篇 F1：候潮献证（原初之潮·潮归其位）──────────────────
  // 潮心祭坛右键：三潮之证齐（风暴之核/哀潮之泪/雨潮残页 各×1）→ 消耗并置换
  // 原初祭坛（setBlock 进账本），进入候潮态——finalePrimordial 记祭坛坐标
  //（F2 四界同潮演出的时间窗锚点；方块 id 本身即持久态，坐标位随存档/换维透传）。
  // 未集齐或已候潮 → 照旧浮现复潮章（不变量 6：复潮行为不回退）。
  // LAN：方块置换走账本天然一致；候潮 room flag 广播随 F3 听潮仪式接入。
  _tryPrimordialOffering(block) {
    if (!this.world.finalePrimordial) {
      const need = [['storm_core', 1], ['mourn_tear', 1], ['page_rain', 1]];
      const hasAll = need.every(([n, c]) => {
        let have = 0;
        for (const s of this.inventory.slots) if (s && s.name === n) have += s.count;
        return have >= c;
      });
      if (hasAll) {
        need.forEach(([n, c]) => this.inventory.removeItems(n, c));
        this.hotbar.update();
        this.world.setBlock(block.x, block.y, block.z, BlockRegistry.getId('primordial_altar'));
        this.world.finalePrimordial = { x: block.x, y: block.y, z: block.z };
        if (this.networkMode && this.net) {
          // F3：候潮状态上服务器（只进不退，广播全房间——其他人由广播置坐标位）
          this.net.sendFinaleState({ offered: true, x: block.x, y: block.y, z: block.z });
        }
        if (this.particles) {
          const altarDef = BlockRegistry.getByName('primordial_altar');
          if (altarDef) this.particles.burstBlockBreak(block.x + 0.5, block.y + 1.5, block.z + 0.5, altarDef, this.world);
        }
        // 候潮章浮现（复潮碑文浮现同款交互；联机提示通道 chatBox 由碑文统一替代）
        this.steleScreen.open(block.x, block.y, block.z, 'tide_waiting');
        return;
      }
    }
    this.steleScreen.open(block.x, block.y, block.z, 'renewal');
  }

  // ── 终局篇 F3：听潮仪式（原初之潮·潮归其位）──────────────────
  // 守望界碑右键门控（finaleListenGate 真值表）：候潮 ∧ 未听过 → 触发 60s
  // 四界同潮仪式窗口（end 段附加龙影低头粒子），窗口结束发放原初纹章。
  // LAN：sendFinaleState({done}) 上服务器——广播含发起者，各端（含自己）收到
  // done 后置 finaleDone 并以服务器重排的 startTs 启动窗口（host 权威时钟）。
  // 返回 true 表示右键已被仪式路径消费（不打开碑文浮层）。
  _tryListenTide(block) {
    const sm = this.world.generator && this.world.generator.structureManager;
    const chapterId = sm && sm.steleChapterAt ? sm.steleChapterAt(block.x, block.y, block.z) : null;
    const gate = finaleListenGate({
      chapterId,
      done: !!this.world.finaleDone,
      offered: !!this.world.finalePrimordial,
      windowActive: !!this._finaleTide,
    });
    if (gate === 'read') return false;
    if (gate === 'swallow') return true;
    if (this.networkMode && this.net) {
      this.net.sendFinaleState({ done: true }); // 各端由广播统一驱动（含发起者）
    } else {
      this.world.finaleDone = true; // 单机：本地置位（SaveSystem 持久化）
      this._startFinaleTide({ ritual: true });
    }
    return true;
  }

  // 仪式收束：原初纹章发放（唯一信物，不可合成——lore 承载终章）
  _grantPrimordialEmblem() {
    if (!this.inventory) return;
    const left = this.inventory.add('primordial_emblem', 1);
    if (left > 0 && this.mobManager && !this.player.spectator) {
      // 背包满：落在脚下走掉落链（联机 sendDropSpawn 进账本）
      const p = this.player.position;
      if (this.networkMode && this.net) {
        this.net.sendDropSpawn(p.x, p.y + 1, p.z, 'primordial_emblem', 1);
      } else {
        this.mobManager.spawnDrop(new THREE.Vector3(p.x, p.y + 1, p.z), 'primordial_emblem', 1, null, { pickupDelay: 0.5 });
      }
    }
    this.hotbar.update();
    if (this.hud) this.hud.showFinaleBanner(); // 终局横幅 10s（Build 19 K3）
    if (this.chatBox) this.chatBox.add(t('潮声落定。碑座上留着一枚纹章。'), '#bfeee8');
  }

  // ── 终局篇 F2：四界同潮演出管线（原初之潮·潮归其位）──────────
  // 60s 全局时间窗（finale-tide.js 配置），四界分段并行：窗口跨换维延续
  //（_finaleTide 挂 Game 实例，start 重入不清），玩家换维即见彼界段落——
  // 单机可追潮跑四界。演出纪律：纯客户端零持久化（不进存档/账本）；
  // 天色/雾走逐帧写入（Sky.finaleOverride + 雾段之后最后写入者），停写即回落。
  // LAN：F3 起 done 广播以服务器时钟重排 startTs（命令面板调试口仍走本地时钟）。
  _startFinaleTide(opts = {}) {
    // ritual=true = F3 听潮仪式窗口（end 段附加龙影低头粒子；结束时发放原初纹章）
    // startTs 可由 LAN 广播传入（服务器时钟重排），单机/调试口取本地时钟
    this._finaleTide = {
      startTs: typeof opts.startTs === 'number' ? opts.startTs : Date.now(),
      ritual: !!opts.ritual,
      granted: false,
    };
  }

  _stopFinaleTide() {
    const ft = this._finaleTide;
    this._finaleTide = null;
    if (this.sky) this.sky.finaleOverride = null; // 天色每帧重算，停写自动回落
    // 听潮仪式收束：潮声落定，碑座上的纹章交到玩家手里（§6 文案——断句处收束）
    if (ft && ft.ritual && !ft.granted) this._grantPrimordialEmblem();
  }

  _updateFinaleTide(dt) {
    const ft = this._finaleTide;
    if (!ft) return;
    const t = (Date.now() - ft.startTs) / 1000;
    if (t >= FINALE_TIDE_DURATION) { this._stopFinaleTide(); return; }
    const dim = this.world && this.world.dimension;
    const seg = FINALE_TIDE_SEGMENTS[dim];
    if (!seg) return; // 未知维度跳过渲染（窗口继续计时）
    const p = finaleEnvelope(t);
    const pulse = finalePulse(t);
    if (this.sky) {
      // 天色包络混入 + 涌潮呼吸（强度脉动）
      this.sky.finaleOverride = p > 0
        ? { sky: seg.skyTint, strength: p * (0.55 + 0.25 * pulse), fogPull: seg.fogPull * (0.7 + 0.3 * pulse) }
        : null;
    }
    // 雾拉近（本函数在 applyFogRange 之后调用 = 最后写入者；停写自动回落）
    const fog = this.renderer && this.renderer.scene && this.renderer.scene.fog;
    if (fog && p > 0 && this.sky && this.sky.finaleOverride && !this.player.inWater) {
      const k = 1 - this.sky.finaleOverride.fogPull;
      fog.near *= k;
      fog.far *= 1 - (1 - k) * 0.5;
    }
    if (this.particles && p > 0) this._finaleParticleTick(seg, p, t, dt);
  }

  // 各段粒子发射（视觉演出，不与方块/实体/掉落交互）
  _finaleParticleTick(seg, p, t, dt) {
    const pt = seg.particle;
    const scaled = pt.rate * p * dt * (this.particles.densityScale || 1);
    const count = Math.floor(scaled) + (Math.random() < scaled % 1 ? 1 : 0);
    if (count <= 0) return;
    const pos = this.player.position;
    const WATER = BlockRegistry.getId('water');
    for (let i = 0; i < count; i++) {
      const [r, g, b] = pt.color;
      const jx = (Math.random() - 0.5) * 2, jz = (Math.random() - 0.5) * 2;
      if (seg.id === 'aether') {
        // 风涨：原初祭坛涌泉（候潮锚点）+ 周身风粒上行
        if (this.world.finalePrimordial && Math.random() < 0.5) {
          const a = this.world.finalePrimordial;
          this.particles.spawn(
            a.x + 0.5 + jx * 1.2, a.y + 1 + Math.random() * 0.8, a.z + 0.5 + jz * 1.2,
            jx * 0.6, pt.rise * (0.7 + Math.random() * 0.6), jz * 0.6,
            r, g, b, pt.life * (0.8 + Math.random() * 0.4), pt.grav, 0.995
          );
        } else {
          const ang = Math.random() * Math.PI * 2, rr = 2 + Math.random() * pt.spread;
          this.particles.spawn(
            pos.x + Math.cos(ang) * rr, pos.y + (Math.random() - 0.3) * 4, pos.z + Math.sin(ang) * rr,
            -Math.sin(ang) * 1.2, pt.rise * (0.6 + Math.random() * 0.8), Math.cos(ang) * 1.2,
            r, g, b, pt.life * (0.8 + Math.random() * 0.4), pt.grav, 0.995
          );
        }
      } else if (seg.id === 'nether') {
        // 熔岩潮涌：岩浆海面（y≈31）火花上喷 + 周身余烬
        if (Math.random() < 0.7) {
          const sx = pos.x + jx * pt.spread, sz = pos.z + jz * pt.spread;
          this.particles.spawn(
            sx, 31.6 + Math.random() * 0.5, sz,
            jx * 0.8, pt.rise * (0.6 + Math.random() * 0.8), jz * 0.8,
            r, g, b, pt.life * (0.7 + Math.random() * 0.5), pt.grav, 0.99
          );
        } else {
          this.particles.spawn(
            pos.x + jx * 5, pos.y + (Math.random() - 0.2) * 3, pos.z + jz * 5,
            jx * 0.5, 1 + Math.random() * 1.5, jz * 0.5,
            r * 0.9, g * 0.8, b * 0.7, 1.4, -0.4, 0.99
          );
        }
      } else if (seg.id === 'overworld') {
        // 逆雨：海面（y=64 水下 1 格是水才发——雨只在海上倒着落回天上）
        const sx = Math.round(pos.x + jx * pt.spread), sz = Math.round(pos.z + jz * pt.spread);
        if (this.world.getBlock(sx, 62, sz) === WATER) {
          this.particles.spawn(
            sx + 0.5, 63.8 + Math.random() * 0.5, sz + 0.5,
            jx * 0.3, pt.rise * (0.7 + Math.random() * 0.6), jz * 0.3,
            r, g, b, pt.life * (0.8 + Math.random() * 0.4), pt.grav, 0.998
          );
        }
      } else if (seg.id === 'end') {
        // 潮声过岸：环形采样点找滩涂地表，潮雾带贴地横掠（不落地、不沾岸）
        const ang = Math.random() * Math.PI * 2;
        const rr = 8 + Math.random() * pt.spread;
        const sx = Math.round(pos.x + Math.cos(ang) * rr), sz = Math.round(pos.z + Math.sin(ang) * rr);
        let sy = 0;
        for (let y = 72; y >= 58; y--) {
          if (this.world.getBlock(sx, y, sz) !== 0) { sy = y; break; }
        }
        if (sy > 0) {
          const tang = ang + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1); // 沿切线方向掠过
          this.particles.spawn(
            sx + 0.5, sy + 1.2 + Math.random() * 1.6, sz + 0.5,
            Math.cos(tang) * 1.6, pt.rise * 0.3, Math.sin(tang) * 1.6,
            r, g, b, pt.life * (0.9 + Math.random() * 0.4), pt.grav, 0.998
          );
        }
        // 听潮仪式附加：龙影低头——紫黑粒子环自龙头位置缓缓垂落旋转（§4 方案二：
        // 只给低头的动作，不解释等待的内容；dragon AI 零改动，纯视觉）
        if (this._finaleTide && this._finaleTide.ritual && p > 0.25 && this.mobManager) {
          const dragon = this.mobManager.mobs.find((m) => m.typeName === 'dragon');
          const hx = dragon ? dragon.position.x : 0;
          const hy = dragon ? dragon.position.y : 76;
          const hz = dragon ? dragon.position.z : 0;
          const la = t * 1.1 + i * 1.7; // 慢旋相位（i 错开多粒成环）
          this.particles.spawn(
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
    this.aetherDusk = !!on;
    if (this.world && this.world.dimension === 'aether') {
      setAetherDuskProfile(this.aetherDusk);
      if (this.sky) {
        this.sky.applyDimensionProfile(this.world.dimDef);
        if (this.aetherDusk) this.sky.time = 0.32; // 从上午起——玩家将亲眼看到天域第一次日落
      }
    }
  }

  // A-② 脚步/落地音：水平位移累计达步长触发（走速 4.3m/s ≈ 每 0.5s 一步），涉水步长更短播水花；
  // 落地 = 上一帧下落速度 >8m/s 且本帧触地（inWater 落水不播闷响）
  _updateFootsteps(dt) {
    const p = this.player;
    if (!p || !p.velocity) return;
    if (p.onGround && !this._wasOnGround && this._prevFallSpeed > 8 && !p.inWater) {
      const def = this._blockUnderFoot();
      if (def) audio.land(def);
    }
    this._wasOnGround = p.onGround;
    this._prevFallSpeed = Math.max(0, -p.velocity.y);
    if (!p.onGround && !p.inWater) { this._stepDist = 0; return; }
    const dx = p.position.x - (this._stepLastX ?? p.position.x);
    const dz = p.position.z - (this._stepLastZ ?? p.position.z);
    this._stepLastX = p.position.x;
    this._stepLastZ = p.position.z;
    this._stepDist = (this._stepDist || 0) + Math.hypot(dx, dz);
    if (this._stepDist >= (p.inWater ? 1.6 : 2.1)) {
      this._stepDist = 0;
      if (p.inWater) audio.splash();
      else {
        const def = this._blockUnderFoot();
        if (def) audio.step(def);
      }
    }
  }

  // 脚下方块（优先贴脚格，其次脚下半格内；流体不算脚步材质）
  _blockUnderFoot() {
    const p = this.player;
    const x = Math.floor(p.position.x), z = Math.floor(p.position.z);
    let id = this.world.getBlock(x, Math.floor(p.position.y - 0.15), z);
    if (!id) id = this.world.getBlock(x, Math.floor(p.position.y - 0.6), z);
    const def = BlockRegistry.getById(id);
    return def && !def.fluid ? def : null;
  }

  // Idea-2E：铁傀儡召唤检测——南瓜头 + 2 格铁块身柱 + 双臂铁块（原版 T 型）。
  // 只在本地放置成功路径调用（联机远端方块变更不检测，防多端重复召唤）；
  // 命中则移除 5 块（走 setBlock 自动广播）并就地召唤护卫（联机经 mob_spawn 回执全端创建）。
  _trySummonIronGolem(x, y, z) {
    if (!this.world || !this.mobManager) return false;
    const IRON = BlockRegistry.getId('iron_block');
    const PUMPKIN = BlockRegistry.getId('pumpkin');
    if (!IRON || !PUMPKIN) return false;
    const get = (bx, by, bz) => this.world.getBlock(bx, by, bz);
    // 推定南瓜头位置：本次放的是头 / 柱底（头在其上 2 格）/ 柱中或臂（头在其上 1 格）
    const placed = get(x, y, z);
    let hx = x, hy = y, hz = z;
    if (placed === PUMPKIN) {
      // 本次放的是头
    } else if (placed === IRON && get(x, y + 1, z) === IRON && get(x, y + 2, z) === PUMPKIN) {
      hy = y + 2;
    } else if (placed === IRON && get(x, y - 1, z) === IRON && get(x, y + 1, z) === PUMPKIN) {
      hy = y + 1;
    } else {
      return false;
    }
    // 身柱 2 格 + 双臂各 1（臂与身上段同层）
    if (get(hx, hy - 1, hz) !== IRON || get(hx, hy - 2, hz) !== IRON) return false;
    if (get(hx - 1, hy - 1, hz) !== IRON || get(hx + 1, hy - 1, hz) !== IRON) return false;
    for (const [bx, by, bz] of [[hx, hy, hz], [hx, hy - 1, hz], [hx, hy - 2, hz], [hx - 1, hy - 1, hz], [hx + 1, hy - 1, hz]]) {
      this.world.setBlock(bx, by, bz, 0);
    }
    this.mobManager._spawnAt('iron_golem', hx + 0.5, hy - 2 + 0.1, hz + 0.5);
    if (this.chatBox) this.chatBox.add(t('铁傀儡从方块中苏醒了…'), '#cfc');
    return true;
  }

  // Idea-2D-②：凋灵召唤检测——双结构：原版 T 型（柱底 1 + 沙排 3 + 头排 3，Build 8 起）
  // 与兼容平铺两层（沙排 4 + 头排 3，初版摆法）；原版 T 优先匹配。
  // 只在本地放置成功路径调用（同铁傀儡：远端 block_set 不检测，防多端重复召唤）；
  // 命中则移除 7 块（setBlock 自动广播账本）并就地召唤凋灵（联机经 mob_spawn 回执全端创建）。
  // 枚举：轴向 x/z × 头排起点 [-3,3]（宽枚举无害，校验保证正确性）。
  _trySummonWither(x, y, z) {
    if (!this.world || !this.mobManager) return false;
    const SAND = BlockRegistry.getId('soul_sand');
    const SKULL = BlockRegistry.getId('wither_skeleton_skull');
    if (!SAND || !SKULL) return false;
    const get = (bx, by, bz) => this.world.getBlock(bx, by, bz);
    const placed = get(x, y, z);
    const isSkull = (id) => { const d = BlockRegistry.getById(id); return !!(d && d.baseBlock === 'wither_skeleton_skull'); }; // B28：头颅四朝向家族
    if (placed !== SAND && !isSkull(placed)) return false;
    // 扫描头层 ty 的 3 连头颅排，再按形状补验下层；命中返回待清除块与召唤点
    const scan = (ty, shape) => {
      for (const [ax, az] of [[1, 0], [0, 1]]) {       // 水平轴向：x / z
        for (let h0 = -3; h0 <= 3; h0++) {             // 头排起点相对放置点（沿轴标量）
          const hx = x + ax * h0, hz = z + az * h0;
          let ok = true;
          for (let i = 0; i < 3 && ok; i++) if (!isSkull(get(hx + ax * i, ty, hz + az * i))) ok = false;
          if (!ok) continue;
          if (shape === 'flat') {                      // 兼容平铺：沙排 4 连，头排左/右两种对齐
            for (const off of [0, -1]) {
              const bx0 = hx + ax * off, bz0 = hz + az * off;
              let ok2 = true;
              for (let i = 0; i < 4 && ok2; i++) if (get(bx0 + ax * i, ty - 1, bz0 + az * i) !== SAND) ok2 = false;
              if (!ok2) continue;
              const blocks = [];
              for (let i = 0; i < 3; i++) blocks.push([hx + ax * i, ty, hz + az * i]);
              for (let i = 0; i < 4; i++) blocks.push([bx0 + ax * i, ty - 1, bz0 + az * i]);
              return { blocks, cx: bx0 + ax * 1.5, cz: bz0 + az * 1.5, sy: ty };
            }
          } else {                                     // 原版 T：沙排 3 连同列 + 柱底在沙排中列下方一层
            let ok2 = true;
            for (let i = 0; i < 3 && ok2; i++) if (get(hx + ax * i, ty - 1, hz + az * i) !== SAND) ok2 = false;
            if (!ok2) continue;
            if (get(hx + ax, ty - 2, hz + az) !== SAND) continue;
            const blocks = [];
            for (let i = 0; i < 3; i++) blocks.push([hx + ax * i, ty, hz + az * i]);
            for (let i = 0; i < 3; i++) blocks.push([hx + ax * i, ty - 1, hz + az * i]);
            blocks.push([hx + ax, ty - 2, hz + az]);
            return { blocks, cx: hx + ax + 0.5, cz: hz + az + 0.5, sy: ty - 1 };
          }
        }
      }
      return null;
    };
    // 头/沙的层位由放置物决定：放头 → 头层 y；放沙 → 沙排 y（头层 y+1）或柱底 y（头层 y+2）
    // B28：头颅是四朝向家族，判层必须按家族判（曾用 placed === SKULL 基名，
    // 朝南/东/西的头颅会被当成"放的是沙"去扫上层，T 型召唤静默失效）
    const hit = isSkull(placed)
      ? (scan(y, 't') || scan(y, 'flat'))
      : (scan(y + 2, 't') || scan(y + 1, 't') || scan(y + 1, 'flat'));
    if (!hit) return false;
    for (const [bx, by, bz] of hit.blocks) this.world.setBlock(bx, by, bz, 0);
    this.mobManager._spawnAt('wither', hit.cx, hit.sy + 0.1, hit.cz);
    if (this.chatBox) this.chatBox.add(t('凋灵从方块中苏醒了…'), '#c9c');
    return true;
  }

  // ── 信标（Idea-2D-③）────────────────────────────────────────
  // 金字塔基座（铁/金/钻石/绿宝石块 1~4 层）激活；右键 BeaconScreen 选效果后
  // 每 4s 给范围内玩家刷新效果（12s 时长，金字塔等级决定强度与范围）。
  // 效果选择为内存级状态（随会话）；方块本身走账本；光柱为纯视觉 mesh。

  // 金字塔等级：从信标正下方逐层向上检测（层 1=3×3 … 层 4=9×9），断层即停
  // Build 5 修复：与原版一致，首层 3×3 起（原误为 5×5 起，整塔多耗 40 块）
  _getBeaconPower(x, y, z) {
    if (!this.world) return 0;
    const VALID = new Set(['iron_block', 'gold_block', 'diamond_block', 'emerald_block'].map(n => BlockRegistry.getId(n)));
    let power = 0;
    for (let l = 1; l <= 4; l++) {
      const half = l; // 层 1 → 3×3，层 2 → 5×5，层 3 → 7×7，层 4 → 9×9
      let ok = true;
      for (let dx = -half; dx <= half && ok; dx++) {
        for (let dz = -half; dz <= half && ok; dz++) {
          if (!VALID.has(this.world.getBlock(x + dx, y - l, z + dz))) ok = false;
        }
      }
      if (!ok) break;
      power = l;
    }
    return power;
  }

  // BeaconScreen 确认回调：记录激活状态 + 建光柱 + 立即脉冲一次
  setBeaconEffect(x, y, z, name, level) {
    const key = `${x},${y},${z}`;
    this.beacons.set(key, { x, y, z, effect: name, level, lastPower: level });
    this._ensureBeaconBeam(key, x, y, z);
    this._pulseBeacon(this.beacons.get(key), level);
    if (this.chatBox) this.chatBox.add(t('信标已激活：{n} ×{l}', { n: beaconEffectLabel(name), l: Math.min(2, level) }), '#ffd');
  }

  _pulseBeacon(b, power) {
    const range = 10 * power;
    const p = this.player;
    if (!p || p.dead) return;
    const dx = p.position.x - (b.x + 0.5), dy = p.position.y - b.y, dz = p.position.z - (b.z + 0.5);
    if (dx * dx + dy * dy + dz * dz <= range * range) {
      p.applyEffect(b.effect, Math.min(2, power), 12); // 12s 时长 > 4s 脉冲周期，效果无缝续期
    }
  }

  _updateBeaconPulse(dt) {
    if (!this.beacons || !this.beacons.size) return;
    this._beaconPulseTimer = (this._beaconPulseTimer || 0) - dt;
    if (this._beaconPulseTimer > 0) return;
    this._beaconPulseTimer = 4;
    for (const [key, b] of this.beacons) {
      const power = this._getBeaconPower(b.x, b.y, b.z);
      if (power <= 0) {
        // 基座被拆：信标失效（清效果选择 + 光柱）
        this.beacons.delete(key);
        this._removeBeaconBeam(key);
        continue;
      }
      if (power !== b.lastPower) {
        b.lastPower = power;
        b.level = Math.min(2, power); // 基座变化实时调整效果等级
        this._ensureBeaconBeam(key, b.x, b.y, b.z);
      }
      this._pulseBeacon(b, power);
    }
  }

  _ensureBeaconBeam(key, x, y, z) {
    if (!this.renderer || !this.renderer.scene) return;
    this._removeBeaconBeam(key);
    const h = Math.max(16, 250 - y);
    const geo = new THREE.BoxGeometry(0.4, h, 0.4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2f0dc, transparent: true, opacity: 0.22, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + 0.5, y + h / 2, z + 0.5);
    this.renderer.scene.add(mesh);
    this._beaconBeams.set(key, mesh);
  }

  _removeBeaconBeam(key) {
    const mesh = this._beaconBeams && this._beaconBeams.get(key);
    if (!mesh) return;
    this.renderer.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    this._beaconBeams.delete(key);
  }

  _breakBeacon(x, y, z) {
    const key = `${x},${y},${z}`;
    if (this.beacons) this.beacons.delete(key);
    this._removeBeaconBeam(key);
  }

  _clearBeaconState() {
    if (!this._beaconBeams) this._beaconBeams = new Map();
    for (const key of [...this._beaconBeams.keys()]) this._removeBeaconBeam(key);
    this.beacons = new Map();
    this._beaconPulseTimer = 0;
  }

  // 打火石点火传送门：点击框体 → 内部候选格 = 点击面外邻格 → 框校验 → 填充门方块。
  // 返回 true 表示本次右键已被处理（无论点火成败——打火石无"生火"语义可回退）。
  _tryLightPortal(hit, targetDef) {
    const kind = { obsidian: 'nether', glowstone: 'aether' }[targetDef.name];
    if (!kind) return false;
    const cx = hit.block.x + hit.normal.x;
    const cy = hit.block.y + hit.normal.y;
    const cz = hit.block.z + hit.normal.z;
    if (this.world.getBlock(cx, cy, cz) !== 0) return false;
    const det = detectPortalInterior(this.world, cx, cy, cz, targetDef.id);
    if (!det) {
      if (this.chatBox) this.chatBox.add(t('传送门框架不完整（内部至少 2×3，框边须封闭）'), '#fa8');
      return true;
    }
    this.hand.swing();
    fillPortal(this.world, det, portalBlockId(kind));
    if (this.chatBox) this.chatBox.add(kind === 'nether' ? t('下界传送门被点亮了…') : t('天域传送门被点亮了…'), '#a7f');
    return true;
  }

  // 末影之眼嵌入要塞传送门框架：无眼框→带眼框（消耗 1）；12 眼集齐→中心 3×3 填门体。
  // 返回 true 表示本次右键已被处理；非环位散框不消耗（原版语义）。
  _tryPlaceEndEye(hit, targetDef) {
    if (targetDef.name !== 'end_portal_frame') return false;
    const { x: bx, y: by, z: bz } = hit.block;
    const FRAME = BlockRegistry.getId('end_portal_frame');
    const EYE = BlockRegistry.getId('end_portal_frame_eye');
    const PORTAL = BlockRegistry.getId('end_portal');
    if (!detectEndRing(this.world, bx, by, bz, FRAME, EYE)) return false;
    this.hand.swing();
    this.world.setBlock(bx, by, bz, EYE);
    if (this.player.survival) {
      this.inventory.removeSelected(1);
      this.hotbar.update();
    }
    const after = detectEndRing(this.world, bx, by, bz, FRAME, EYE);
    if (after && after.eyes === 12) {
      fillEndPortalCenter(this.world, after, PORTAL);
      if (this.chatBox) this.chatBox.add(t('末地传送门被激活了——跳进去！'), '#a7f');
    } else if (after) {
      if (this.chatBox) this.chatBox.add(t('末影之眼嵌入框架（{n}/12）', { n: after.eyes }), '#a7f');
    }
    return true;
  }

  // 传送门穿越检测：站入门方块累积 2s 触发（末地门即触）；到达后须离开门体才重新武装（防立即回传）
  updatePortals(dt) {
    if (!this.world || this.spectating || !this.player || this.player.dead) return;
    if (this._portalCooldown > 0) {
      this._portalCooldown -= dt;
      if (this.portalOverlay) this.portalOverlay.update(null, 0);
      return;
    }
    const kinds = DIM_PORTAL_KINDS[this.world.dimension] || [];
    if (!kinds.length) { this._portalTimer = 0; if (this.portalOverlay) this.portalOverlay.update(null, 0); return; }
    const p = this.player.position;
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    const cellId = (dy) => this.world.getBlock(bx, Math.floor(p.y + dy), bz);
    let kindIn = null;
    for (const kind of kinds) {
      const pid = portalBlockId(kind);
      // gateway 是"踩入式"（嵌地面层，非固体）——额外探测脚下格
      const probes = kind === 'gateway' ? [-0.3, 0.1, 1.0] : [0.1, 1.0];
      if (probes.some(dy => cellId(dy) === pid)) { kindIn = kind; break; }
    }
    if (!kindIn) {
      this._portalTimer = 0;
      this._portalArmed = true;
      if (this.portalOverlay) this.portalOverlay.update(null, 0);
      return;
    }
    if (!this._portalArmed) {
      if (this.portalOverlay) this.portalOverlay.update(null, 0);
      return;
    }
    // 折跃门站入 1s 触发（同维传送）；下界/天域门 2s；末地门陷入即触
    const threshold = kindIn === 'gateway' ? 1.0 : 2.0;
    if (this.portalOverlay) this.portalOverlay.update(kindIn, Math.min(1, this._portalTimer / threshold));
    this._portalTimer += dt;
    if (this._portalTimer >= threshold) {
      this._portalTimer = 0;
      this._portalArmed = false;
      if (this.portalOverlay) this.portalOverlay.update(kindIn, 1);
      if (kindIn === 'gateway') this._useGatewayPortal();
      else this._usePortal(kindIn);
    }
  }

  // 传送门环境粒子（M3）：从已加载区块的 portalCells 随机抽样发射（mesh build 时收集，与方块数据同步）。
  // 纯视觉客户端本地效果，不进存档/协议；密度随视频设置 densityScale 缩放。
  updatePortalParticles(dt) {
    if (!this.fireParticles || !this.world || this.paused) return;
    this._portalPartT = (this._portalPartT || 0) + dt;
    if (this._portalPartT < 0.04) return;
    this._portalPartT = 0;
    const cand = [];
    for (const [, chunk] of this.world.chunks) {
      if (chunk.portalCells && chunk.portalCells.length) cand.push(chunk);
    }
    if (!cand.length) return;
    const n = Math.max(1, Math.round(4 * this.fireParticles.densityScale));
    for (let k = 0; k < n; k++) {
      const chunk = cand[(Math.random() * cand.length) | 0];
      const cells = chunk.portalCells;
      const i = ((Math.random() * cells.length) / 3 | 0) * 3;
      const wx = chunk.cx * CHUNK_SIZE + cells[i], wy = cells[i + 1], wz = chunk.cz * CHUNK_SIZE + cells[i + 2];
      const def = BlockRegistry.getById(this.world.getBlock(wx, wy, wz));
      if (!def || !def.ambientParticles) continue; // 方块可能已被改动（mesh 尚未重建）
      this.fireParticles.portalAmbient(wx, wy, wz, def.name);
    }
  }

  // 传送门触发：目标维度 = 门种类配对的另一端
  //（下界 overworld↔nether 1:8 / 天域 overworld↔aether 1:1 / 末地 overworld↔end 落出生点）
  _usePortal(kind) {
    if (this.portalOverlay) this.portalOverlay.flash();
    const dim = this.world.dimension;
    let target = null;
    let arrival = null;
    if (kind === 'nether') {
      target = { nether: 'overworld', overworld: 'nether' }[dim];
      if (target) {
        const pos = portalTargetPos('nether', dim, this.player.position.x, this.player.position.z);
        arrival = { x: pos.x, z: pos.z, portal: kind };
      }
    } else if (kind === 'aether') {
      target = { aether: 'overworld', overworld: 'aether' }[dim];
      if (target) {
        const pos = portalTargetPos('aether', dim, this.player.position.x, this.player.position.z);
        arrival = { x: pos.x, z: pos.z, portal: kind };
      }
    } else if (kind === 'end') {
      // 末地：原版语义——去程落末地出生点（到达后自动建回程垫），回程落主世界出生点
      target = dim === 'end' ? 'overworld' : 'end';
      arrival = { portal: kind };
    }
    if (!target) return;
    const def = getDimension(target);
    if (this.chatBox) this.chatBox.add(t('传送门轰鸣着将你送往「{d}」…', { d: t(def.name) }), '#a7f');
    this.switchDimension(target, arrival);
  }

  // 折跃门传送（末地同维）：不换维，账本扫描"角度最近"的配对门直达
  //（两端门角度一致由 gatewayPlacements 保证；armed/cooldown 防回弹由 updatePortals 统一处理）
  _useGatewayPortal() {
    if (this.portalOverlay) this.portalOverlay.flash();
    const p = this.player.position;
    const target = gatewayTarget(this.world, p.x, p.z);
    if (!target) return;
    p.set(target.x + 0.5, target.y + 1, target.z + 0.5);
    this.player.velocity.set(0, 0, 0);
    if (this.chatBox) this.chatBox.add(t('折跃门的光束把你送往远方的岛屿……'), '#a7f');
  }

  // 传送门到达落地：有坐标落点 → 半径 24 搜既有同类门吸附、无门自动建返程门（原版语义）；
  // 无坐标落点（末地链）→ 仅落维度出生点（M3 起回程门由击败末影龙激活，到达不再自动建垫）
  _afterPortalArrival(arrival) {
    if (!this.world || !this.running) return;
    const kind = arrival.portal && PORTAL_KINDS[arrival.portal] ? arrival.portal : null;
    if (!Number.isFinite(arrival.x) || !Number.isFinite(arrival.z)) {
      this._portalCooldown = 4;
      this._portalArmed = false;
      return;
    }
    const portalId = kind ? portalBlockId(kind) : 0;
    let pos = portalId ? findPortalNear(this.world, arrival.x, arrival.z, portalId, 24) : null;
    if (pos) {
      this.player.position.set(pos.x, pos.y, pos.z);
    } else if (kind) {
      pos = buildReturnPortal(this.world, kind, arrival.x, arrival.z, {
        top: this.world.dimDef.spawnScanTop || CHUNK_HEIGHT - 2,
        platform: ARRIVAL_PLATFORM[this.world.dimension] || null,
      });
      this.player.position.set(pos.x, pos.y, pos.z);
      if (this.chatBox) this.chatBox.add(t('你在落点建造了一座返程传送门'), '#a7f');
    }
    if (pos) this.player.velocity.set(0, 0, 0);
    this._portalCooldown = 4;
    this._portalArmed = false;
  }

  // 末地出生点旁的回程门垫（龙败激活，原版喷泉基座造型）：
  // 16 格内已有 end_portal 则跳过（重连/多端幂等），否则在出生点偏移 ~5 格建造
  _ensureEndReturnPad() {
    if (this._endPadExists()) return;
    const w = this.world;
    const sp = w.getSpawnPoint();
    buildEndReturnPad(w, Math.floor(sp.x) + 4, Math.floor(sp.z) + 4, {
      top: w.dimDef.spawnScanTop || 140,
      platformY: 64,
      fountain: true,
    });
    if (this.chatBox) this.chatBox.add(t('主岛中心升起基岩喷泉——踩上门垫返回主世界'), '#a7f');
  }

  // 出生点 16 格内是否已有激活回程门（_ensureEndReturnPad 与 _ensureDragon 共用）
  _endPadExists() {
    const w = this.world;
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
  _ensureDragon() {
    if (!this.world || this.world.dimension !== 'end') return;
    if (!this.mobManager) return;
    if (this.networkMode && this.net && !this.net.isHost) return; // 联机非 host 等广播
    if (this.world.dragonDefeated || this._endPadExists()) return;
    if (this.mobManager.mobs.some(m => m.typeName === 'dragon' && !m.dead)) return;
    const mob = new Mob('dragon', this.world);
    // 出生在柱环外缘上空（主岛中心偏移，盘旋半径与 DragonAI.CIRCLE_R 对齐）
    mob.position.set(0.5, 88, 30.5);
    if (this.networkMode && this.net) {
      this.net.sendMobSpawn('dragon', mob.position.x, mob.position.y, mob.position.z);
    } else {
      this.mobManager.spawnMob(mob);
    }
    if (this.chatBox) this.chatBox.add(t('末影龙的咆哮在虚空回荡……'), '#c5f');
  }

  // 末影龙被击败：置标记 + 激活末地奖励（返回门喷泉 + 主岛缘/外岛缘折跃门阵列）
  // 各端独立触发（本地死亡链/远端同步入口）——建门幂等（账本已有即跳过），位置确定性保证一致
  _onDragonDefeated(mob) {
    if (!this.world) return;
    this.world.dragonDefeated = true;
    if (this.chatBox) this.chatBox.add(t('末影龙被击败了！'), '#c5f');
    if (this.world.dimension === 'end') this._activateEndRewards();
  }

  // 龙败奖励：① 出生点旁激活基岩喷泉返程门（踩上回主世界）
  //           ② 主岛缘 + 外岛缘折跃门阵列（角度配对，站入同维传送）
  //           ③ 龙蛋立于主岛中央（原版喷泉柱位；真实方块进账本可挖走）
  _activateEndRewards() {
    this._ensureEndReturnPad();
    this._ensureGateways();
    this._placeDragonEgg();
  }

  // 龙蛋：主岛中心 (0,0) 从上往下扫首个实心格的顶面放置；幂等（已有方块跳过）
  _placeDragonEgg() {
    const EGG = BlockRegistry.getId('dragon_egg');
    for (let y = 80; y > 40; y--) {
      const id = this.world.getBlock(0, y, 0);
      if (id !== 0) {
        if (this.world.getBlock(0, y + 1, 0) === 0) {
          this.world.setBlock(0, y + 1, 0, EGG);
          if (this.chatBox) this.chatBox.add(t('一枚龙蛋静静出现在主岛中央……'), '#c8f');
        }
        return;
      }
    }
  }

  // 折跃门阵列（幂等：账本已有 end_gateway 即跳过）
  _ensureGateways() {
    const GW = BlockRegistry.getId('end_gateway');
    for (const [, id] of this.world.modifiedBlocks) {
      if (id === GW) return;
    }
    const anchors = this.world.generator && typeof this.world.generator.outerAnchors === 'function'
      ? this.world.generator.outerAnchors() : [];
    if (!anchors.length) return;
    for (const place of gatewayPlacements(anchors, 4)) {
      buildGatewayPad(this.world, place.inner.x, place.inner.z, { top: 140, platformY: 64 });
      buildGatewayPad(this.world, place.outer.x, place.outer.z, { top: 140, platformY: 64 });
    }
    if (this.chatBox) this.chatBox.add(t('主岛边缘升起了数座折跃门——它们通向外岛'), '#a7f');
  }

  // 盔甲点数合计（armorSlot 未识别/普通物品不计）
  _armorPoints() {
    let pts = 0;
    for (const s of this.inventory.armor) {
      if (!s) continue;
      const def = ItemRegistry.getByName(s.name);
      if (def && def.armorPoints) pts += def.armorPoints;
    }
    return pts;
  }

  // 手持工具物品 def（未持物/非工具/剑返回 null——剑不是挖掘工具）
  _heldToolItem() {
    const sel = this.inventory.getSelected();
    if (!sel) return null;
    const item = ItemRegistry.getByName(sel.name);
    return item && item.tool && item.tool !== 'sword' ? item : null;
  }

  // 方块破坏掉落映射（默认掉自身；特殊掉落统一加分支，勿在调用点散写——
  // 联机 drop_spawn 的 name 由破坏端决定上报，无确定性约束，但两端须同版本）
  // minTier > 0 的方块需工具类型匹配且 tier 达标才掉落（原版式采收门控；
  // 速度不受门控影响——空手/低级工具能挖碎但不掉落）
  _blockDropName(def) {
    if (def.minTier > 0) {
      const held = this._heldToolItem();
      if (!held || held.tool !== def.tool || (held.tier || 0) < def.minTier) return null;
    }
    if (def.name === 'gravel') return Math.random() < 0.1 ? 'flint' : 'gravel';
    return def.name;
  }

  // 掉落列表化（耕种 P3-4）：作物/草丛多样掉落；其余复用 _blockDropName 单项掉落
  _blockDrops(def) {
    // Idea-2C：潜影盒不走通用掉落（_breakShulkerBox 已产出内容跟随盒体的单一掉落）
    if (def.name === 'shulker_box') return [];
    // B28：家族态方块（门/床/箱子/熔炉/红石灯/头颅）先过工具门控再映射基础物品——
    // 熔炉 minTier:1 若被 baseBlock 短路绕过，空手也能把熔炉整块抱走（原版不允许）
    if (def.minTier > 0) {
      const held = this._heldToolItem();
      if (!held || held.tool !== def.tool || (held.tier || 0) < def.minTier) return [];
    }
    // B27 门/床/活板门家族：任一状态破坏只掉 1 个基础物品（另一半连动消失不重复掉）
    if (def.baseBlock) return [{ name: def.baseBlock, count: 1 }];
    // 小麦成熟：小麦×1 + 种子 1-3（原版式）；未熟：仅种子×1
    if (def.name === `wheat_crop_${CROP_MAX_STAGE}`) {
      return [
        { name: 'wheat', count: 1 },
        { name: 'wheat_seeds', count: 1 + Math.floor(Math.random() * 3) },
      ];
    }
    if (isCropId(BlockRegistry.getId(def.name))) {
      return [{ name: 'wheat_seeds', count: 1 }];
    }
    // 草丛：40% 掉种子（种子获取主来源），否则无掉落
    if (def.name === 'tall_grass') {
      return Math.random() < 0.4 ? [{ name: 'wheat_seeds', count: 1 }] : [];
    }
    // 天域星髓矿石：不掉矿块本体，直接给星髓×1（批次 A；_blockDropName 复用镐 tier 门控）
    if (def.name === 'star_marrow_ore') {
      const n = this._blockDropName(def);
      return n ? [{ name: 'star_marrow', count: 1 }] : [];
    }
    const name = this._blockDropName(def);
    return name ? [{ name, count: 1 }] : [];
  }

  // ── B27 门/床/活板门形制工具 ──────────────────────────────────────────
  static SHAPED_DIRS = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };

  // 玩家相对目标格的水平朝向键：门/活板门面板贴"玩家近边"
  _facingTowardPlayer(bx, bz) {
    const dx = this.player.position.x - (bx + 0.5);
    const dz = this.player.position.z - (bz + 0.5);
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : (dz > 0 ? 's' : 'n');
  }

  _facingAwayFromPlayer(bx, bz) {
    const f = this._facingTowardPlayer(bx, bz);
    return { n: 's', s: 'n', e: 'w', w: 'e' }[f];
  }

  // 目标格是否与玩家 AABB 重叠（同放置主检查口径，供多格形制的第二格使用）
  _cellOverlapsPlayer(x, y, z) {
    const px = this.player.position.x, py = this.player.position.y, pz = this.player.position.z;
    return x >= Math.floor(px - 0.3) && x <= Math.floor(px + 0.3) &&
           y >= Math.floor(py) && y <= Math.floor(py + 1.8) &&
           z >= Math.floor(pz - 0.3) && z <= Math.floor(pz + 0.3);
  }

  // 形制放置（门=下半贴近边+上半；床=脚+头朝远离玩家方向；活板门=关态贴近边）。
  // 目标格必须为空气，任一格不满足即整体失败（返回 false，不消耗物品）。
  _tryPlaceShaped(x, y, z, blockDef) {
    const DIRS = Game.SHAPED_DIRS;
    if (this.world.getBlock(x, y, z) !== 0) return false;
    if (blockDef.part === 'door_lower') {
      const uy = y + 1;
      if (this.world.getBlock(x, uy, z) !== 0 || this._cellOverlapsPlayer(x, uy, z)) return false;
      const facing = this._facingTowardPlayer(x, z);
      const lid = doorId(blockDef.baseBlock, 'lower', facing, false);
      const uid = doorId(blockDef.baseBlock, 'upper', facing, false);
      if (!lid || !uid) return false;
      this.world.setBlock(x, y, z, lid);
      this.world.setBlock(x, uy, z, uid);
      audio.blockPlace(blockDef);
      if (this.redstone) { this.redstone.onBlockChange(x, y, z); this.redstone.onBlockChange(x, uy, z); }
      return true;
    }
    if (blockDef.part === 'bed_foot') {
      const facing = this._facingAwayFromPlayer(x, z);
      const [dx, dz] = DIRS[facing];
      const hx = x + dx, hz = z + dz;
      if (this.world.getBlock(hx, y, hz) !== 0 || this._cellOverlapsPlayer(hx, y, hz)) return false;
      const fid = bedId('foot', facing), hid = bedId('head', facing);
      if (!fid || !hid) return false;
      this.world.setBlock(x, y, z, fid);
      this.world.setBlock(hx, y, hz, hid);
      audio.blockPlace(blockDef);
      return true;
    }
    if (blockDef.part === 'trapdoor') {
      const facing = this._facingTowardPlayer(x, z);
      const tid = trapdoorId(facing, false);
      if (!tid) return false;
      this.world.setBlock(x, y, z, tid);
      audio.blockPlace(blockDef);
      if (this.redstone) this.redstone.onBlockChange(x, y, z);
      return true;
    }
    return false;
  }

  // 破坏门/床任一半时连动清除另一半（另一半经家族掉落规则不重复产出）
  _removeShapedPartner(def, x, y, z) {
    const DIRS = Game.SHAPED_DIRS;
    if (def.part === 'door_lower') this._clearIfFamily(x, y + 1, z, def.baseBlock);
    else if (def.part === 'door_upper') this._clearIfFamily(x, y - 1, z, def.baseBlock);
    else if (def.part === 'bed_foot') {
      const [dx, dz] = DIRS[def.facing];
      this._clearIfFamily(x + dx, y, z + dz, def.baseBlock);
    } else if (def.part === 'bed_head') {
      const [dx, dz] = DIRS[def.facing];
      this._clearIfFamily(x - dx, y, z - dz, def.baseBlock);
    }
  }

  _clearIfFamily(x, y, z, baseBlock) {
    const d = BlockRegistry.getById(this.world.getBlock(x, y, z));
    if (d && d.baseBlock === baseBlock) this.world.setBlock(x, y, z, 0);
  }

  // 半径内是否有存活敌对怪（入睡门控；村民/铁傀儡/动物等 passive 不算）
  _hostileNearby(radius) {
    if (!this.mobManager) return false;
    const p = this.player.position;
    for (const m of this.mobManager.mobs) {
      if (m.dead || !m.type || m.type.passive) continue;
      if (m.position.distanceToSquared(p) <= radius * radius) return true;
    }
    return false;
  }

  // 作物登记表维护（World.setBlock 钩子）：作物入表、非作物出表（懒清理兜底在 _growCrops）
  _trackCrop(x, y, z, oldId, newId) {
    const key = `${x},${y},${z}`;
    if (isCropId(newId)) {
      this.world.cropMap.set(key, { x, y, z });
    } else if (isCropId(oldId)) {
      this.world.cropMap.delete(key);
    }
  }

  // 作物生长节拍（每 8s 一拍）：随机推进 + 水分加成；host/单机权威（客户端
  // 不跑生长，看 host 的 block_set 广播收敛——与怪物生成同款门控策略）。
  // 登记表懒清理：指向格已不是作物（收获/破坏/远端改动）则移出。
  _growCrops() {
    if (!this.world || !this.world.cropMap) return;
    if (this.networkMode && this.net && !this.net.isHost) return;
    for (const [key, c] of this.world.cropMap) {
      const id = this.world.getBlock(c.x, c.y, c.z);
      if (!isCropId(id)) { this.world.cropMap.delete(key); continue; }
      const stage = cropStageOf(id);
      if (stage < 0 || stage >= CROP_MAX_STAGE) continue;
      // 水分：耕地所在层 9×9 有水 → 概率翻倍（0.3 → 0.6）
      const chance = isHydrated(this.world, c.x, c.y - 1, c.z) ? 0.6 : 0.3;
      if (Math.random() < chance) {
        this.world.setBlock(c.x, c.y, c.z, cropIdAtStage(stage + 1));
      }
    }
  }

  // 右键耕作交互（右键链内、放置分支前）：骨粉催熟 / 成熟收获 / 播种 / 锄地。
  // 返回 true 表示本次点击已被消费（调用方置 mouseRight=false 并 return）。
  _tryFarmInteract(hit, groundDef, sel) {
    const { x, y, z } = hit.block;

    // 骨粉催熟：对作物推进 1-3 段（clamp 到成熟）
    if (sel && (sel.name === 'bone_meal' || sel.name === 'bone_meal_item') && groundDef && isCropId(groundDef.id)) {
      const stage = cropStageOf(groundDef.id);
      if (stage >= 0 && stage < CROP_MAX_STAGE) {
        const next = Math.min(CROP_MAX_STAGE, stage + 1 + Math.floor(Math.random() * 3));
        this.world.setBlock(x, y, z, cropIdAtStage(next));
        if (this.player.survival) {
          this.inventory.removeSelected(1);
          this.hotbar.update();
        }
        this.hand.swing();
        return true;
      }
      return false; // 已成熟：不消耗不拦截（落回通用分支）
    }

    // 右键收获：成熟作物直接破坏+掉落（空手/任意物品均可；骨粉已在上面优先）
    if (groundDef && groundDef.id === cropIdAtStage(CROP_MAX_STAGE)) {
      const drops = this._blockDrops(groundDef);
      this.world.setBlock(x, y, z, 0);
      for (const d of drops) {
        if (this.networkMode && this.net) {
          this.net.sendDropSpawn(x + 0.5, y + 0.5, z + 0.5, d.name, d.count);
        } else {
          this.inventory.add(d.name, d.count);
        }
      }
      this.hotbar.update();
      this.hand.swing();
      return true;
    }

    // 播种：手持小麦种子对耕地（上方空气），种下 0 阶段作物
    if (sel && sel.name === 'wheat_seeds' && groundDef && groundDef.name === 'farmland' &&
        this.world.getBlock(x, y + 1, z) === 0) {
      this.world.setBlock(x, y + 1, z, cropIdAtStage(0));
      if (this.player.survival) {
        this.inventory.removeSelected(1);
        this.hotbar.update();
      }
      this.hand.swing();
      return true;
    }

    // 锄地：锄头类物品对草/土 → 耕地（上方须空气；对已耕地/砂石等无效）
    if (sel && groundDef && (groundDef.name === 'grass_block' || groundDef.name === 'dirt')) {
      const item = ItemRegistry.getByName(sel.name);
      if (item && item.tool === 'hoe' && this.world.getBlock(x, y + 1, z) === 0) {
        this.world.setBlock(x, y, z, BlockRegistry.getId('farmland'));
        this.hand.swing();
        return true;
      }
    }
    return false;
  }

  // 末影水晶被击碎：范围爆炸（复用怪物爆炸破坏路径）+ 按距离衰减伤害
  _breakCrystal(x, y, z) {
    const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
    if (this.mobManager) {
      this.mobManager.pendingExplosions.push({ x: px, y: py, z: pz, radius: 3 });
    }
    const d = this.player.position.distanceTo(new THREE.Vector3(px, py, pz));
    if (d < 8) {
      const dmg = Math.round(14 * (1 - d / 8));
      if (dmg > 0) this.player.hurt(dmg, 'explosion', true);
    }
    if (this.chatBox) this.chatBox.add(t('末影水晶碎裂，爆发出紫色的冲击！'), '#c8f');
  }

  // 紫颂果食用后随机短距传送（原版机制）：±8 格水平随机落点，下探找立地面，
  // 找不到安全面则原地不动（不垫台——保底是"不传送"而非"造出悬空平台"）
  _chorusTeleport() {
    const p = this.player.position;
    const ang = Math.random() * Math.PI * 2;
    const dist = 4 + Math.random() * 8;
    const tx = Math.floor(p.x + Math.cos(ang) * dist);
    const tz = Math.floor(p.z + Math.sin(ang) * dist);
    const top = Math.min(CHUNK_HEIGHT - 3, Math.floor(p.y) + 12);
    let y = top;
    while (y >= 1) {
      if (this.world.getBlock(tx, y, tz) !== 0 || this.world.getBlock(tx, y + 1, tz) !== 0) { y--; continue; }
      const def = BlockRegistry.getById(this.world.getBlock(tx, y - 1, tz));
      if (def && def.solid) break;
      y--;
    }
    if (y < 1) return;
    p.set(tx + 0.5, y, tz + 0.5);
    this.player.velocity.set(0, 0, 0); // 传送落地速度清零（摔落伤害按落地速度计算）
    if (this.chatBox) this.chatBox.add(t('紫颂果把你拉向了虚空中的另一处……'), '#c8f');
  }

  // 传送门落点立足面预解析：临时生成器 + 临时区块探测（纯函数，不碰当前世界）；
  // 无立足面返回 -1（到达后由 buildReturnPortal 按维度档案垫平台）
  _resolveArrivalY(dim, x, z) {
    const def = getDimension(dim);
    if (!def) return -1;
    const gen = def.createGenerator(this.world.seed, { biomeScale: this.biomeScale });
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const c = new Chunk(cx, cz);
    gen.generateChunk(c);
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    const top = Math.min(def.spawnScanTop || 140, CHUNK_HEIGHT - 2);
    for (let y = top; y >= 1; y--) {
      if (c.get(lx, y, lz) === 0 && c.get(lx, y + 1, lz) === 0) {
        const d = BlockRegistry.getById(c.get(lx, y - 1, lz));
        if (d && d.solid) return y;
      }
    }
    return -1;
  }

  // 鞘翅滑翔折叠判定（每帧在移动分支之前调用）：没穿鞘翅 / 创造飞行 / 旁观 /
  // 在水中 / 已在地面 → 折叠。独立于气动结算——水中走游泳分支不进移动滑翔分支，
  // 若不在此处统一折叠，入水后 gliding 会残留 true。
  _updateGlideFold() {
    const p = this.player;
    if (!p.gliding) return;
    const chest = this.inventory ? this.inventory.armor[1] : null;
    if (!chest || chest.name !== 'elytra' || p.flying || p.spectator || p.inWater || p.onGround) {
      p.gliding = false;
      if (this.hud) this.hud.setGliding(false);
    }
  }

  // 鞘翅滑翔气动结算（移动分支调用）：返回 true 表示本帧处于滑翔（移动分支不再
  // 覆写水平速度，动量得以保留）。展开条件：胸甲槽穿鞘翅 + 空中下落（落体展开）。
  // 气动模型（简化原版）：低头俯冲加速、抬头迎角升力翱翔、常驻水平阻尼。
  _updateGlideAero(dt) {
    const p = this.player;
    if (!p.gliding) {
      const chest = this.inventory ? this.inventory.armor[1] : null;
      // onGround 必须排除：站立时每帧重力使 vy=-0.53 恰好越过展开阈值，
      // 会与 _updateGlideFold 的落地折叠形成逐帧抖动（HUD 闪烁）
      if (!chest || chest.name !== 'elytra' || p.flying || p.spectator || p.inWater || p.onGround) return false;
      if (p.velocity.y > GLIDE_DEPLOY_VY) return false; // 起跳上升段不展开，过 apex 后触发
      p.gliding = true;
      if (this.hud) this.hud.setGliding(true);
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

  updateSurvival(dt) {
    // 饥饿/生命恢复
    this.player.exhaustion += dt * 0.4;
    if (this.player.exhaustion >= 4) {
      this.player.exhaustion -= 4;
      if (this.player.saturation > 0) {
        this.player.saturation = Math.max(0, this.player.saturation - 1);
      } else if (this.player.food > 0) {
        this.player.food = Math.max(0, this.player.food - 1);
      }
    }
    
    if (this.player.food >= 18 && this.player.health < this.player.maxHealth) {
      this.player.health = Math.min(this.player.maxHealth, this.player.health + dt);
    }
    
    if (this.player.food <= 0 && this.player.health > 1) {
      this.player.health -= dt * 0.5;
    }
    
    // 摔落伤害（读落地前的冲击速度 impactVy——moveAxis 落地会把 velocity.y 清零，
    // 旧写法 onGround && velocity.y<-15 永远为假，摔落从未生效，本批修复）
    // 天域批次 B：落点为云绒块 → 免摔落（群岛基建核心，绒毛卸掉全部冲击）
    const impactVy = this.player.impactVy || 0;
    if (this.player.onGround && impactVy < -15) {
      const landDef = this._blockUnderFoot();
      if (!landDef || landDef.name !== 'cloud_wool') {
        const dmg = Math.floor(-impactVy / 3 - 3);
        if (dmg > 0) {
          this.player.hurt(dmg, 'fall', true);
        }
      }
    }

    // 滑翔撞墙伤害（wallCrash 由 Physics.moveAxis 在清零水平速度前捕获；撞停即折叠）
    if (this.player.gliding && this.player.wallCrash > 0) {
      const dmg = Math.max(1, Math.floor(this.player.wallCrash / 4));
      this.player.hurt(dmg, 'flyIntoWall', true);
      this.player.gliding = false;
      if (this.hud) this.hud.setGliding(false);
    }

    // 虚空伤害（末地/天域等无底维度）：y<-16 持续扣血（持续伤害口径，不走红屏）
    if (this.world.dimDef.hasVoid && this.player.position.y < -16) {
      this.player.health -= dt * 6;
    }

    // 凋零 II（Idea-2D-②）：每秒扣 1 血持续到效果到期；可致死（统一死亡判定在下方）；
    // 持续伤害口径不走红屏，视觉走 Hud 紫黑滤镜（update 内 setWithered）
    if (this.player.getEffectLevel('wither') > 0 && !this.player.creative && !this.player.spectator) {
      this._witherTick = (this._witherTick || 0) + dt;
      if (this._witherTick >= 1) {
        this._witherTick -= 1;
        this.player.health = Math.max(0, this.player.health - 1);
      }
    }

    if (this.player.health <= 0) {
      this.player.health = 0;
      if (this.deathScreen && !this.deathScreen.visible) {
        this.deathScreen.show();
        if (this.networkMode && this.net) {
          // 阶段6：死亡上报（含背包掉落列表）→ 服务器生成世界掉落物广播；随后清空背包
          this.net.sendPlayerDied();
          this.inventory.slots = new Array(this.inventory.size).fill(null);
          this.inventory.armor = new Array(4).fill(null);
          this.inventory.hotbarSelected = 0;
          if (this.hotbar) this.hotbar.update();
        }
      }
    }
  }

  respawn() {
    this.player.health = 20;
    this.player.food = 20;
    this.player.saturation = 5;
    this.player.exhaustion = 0;
    this.player.onFire = 0;
    this.player.invulnerable = 0;
    this.player.clearEffects();
    this._witherTick = 0;
    this.player.gliding = false;
    if (this.hud) this.hud.setGliding(false);
    // 末地死亡回主世界重生（原版语义；防"败龙前死亡软锁在末地"）：
    // switchDimension 重建世界并落主世界出生点（背包/账本经 loadData 保留）
    if (this.world && this.world.dimension === 'end') {
      this.switchDimension('overworld');
      if (this.spectating) {
        this.spectating = false;
        this.spectateTargetId = null;
        this._specSmoothed = null;
        if (this._preSpectateMode && this.player.spectator) this.player.setMode(this._preSpectateMode);
        this._preSpectateMode = null;
      }
      return;
    }
    // 重生到床重生点（仅单机；同维度才生效），否则当前维度出生点。
    // B27：床失效校验——床被挖掉/非床方块占位 → 清重生点回世界出生点（原版语义）
    let sp;
    if (!this.networkMode && this.bedSpawn && this.bedSpawn.dimension === this.world.dimension) {
      const bedDef = BlockRegistry.getById(this.world.getBlock(this.bedSpawn.x, this.bedSpawn.y, this.bedSpawn.z));
      if (bedDef && (bedDef.part === 'bed_foot' || bedDef.part === 'bed_head')) {
        sp = { x: this.bedSpawn.x + 0.5, y: this.bedSpawn.y + 1, z: this.bedSpawn.z + 0.5 };
      } else {
        this.bedSpawn = null;
        if (this.chatBox) this.chatBox.add(t('你的床已不见或被挡住了，回到世界出生点'), '#fcc');
        sp = this.world.getSpawnPoint();
      }
    } else {
      sp = this.world.getSpawnPoint();
    }
    this.player.position.set(sp.x, sp.y, sp.z);
    this.player.velocity.set(0, 0, 0);
    // 观战结束：重置观战状态并恢复正常模式
    if (this.spectating) {
      this.spectating = false;
      this.spectateTargetId = null;
      this._specSmoothed = null;
      if (this._preSpectateMode && this.player.spectator) this.player.setMode(this._preSpectateMode);
      this._preSpectateMode = null;
    }
    if (this.networkMode && this.net) {
      // 阶段6：联机重生——背包已在死亡时清空，重新发放生存初始物品
      this.inventory.slots = new Array(this.inventory.size).fill(null);
      this.inventory.hotbarSelected = 0;
      this.inventory.add('wood_pickaxe');
      this.inventory.add('wood_axe');
      this.inventory.add('wood_sword');
      this.inventory.add('torch', 16);
      this.inventory.add('bread', 5);
      if (this.hotbar) this.hotbar.update();
      this.net.sendRespawn(this.player.position.x, this.player.position.y, this.player.position.z);
    }
  }

  // 维度切换（M1 单机 / M4 联机）：把当前完整状态合成 loadData 重走 start()——
  // 保留背包/血量/xp/时间与全部维度账本，落到目标维度出生点；
  // 传送门穿越（迭代 M2）传 arrival {x,z,portal}：落到换算坐标并在到达后搜门/建返程门
  async switchDimension(dim, arrival = null) {
    if (!this.running || !this.world) return false;
    const def = getDimension(dim);
    if (!def || !def.implemented) return false;
    if (this.networkMode) {
      // M4 联机：服务器权威——发请求（携带落点），收 DIMENSION_WORLD 回执后由 applyDimensionWorld 落地
      if (!this.net || dim === this.world.dimension) return false;
      if (this.chatBox) this.chatBox.add(t('正在切换到「{d}」…', { d: t(def.name) }), '#8f8');
      this.net.sendSwitchDimension(dim, arrival);
      return true;
    }
    if (dim === this.world.dimension) return false;
    return this._enqueueDimensionSwitch(async () => {
      // 检查在出队时再做（排队期间维度可能已被更早的任务改变）
      if (!this.running || !this.world || dim === this.world.dimension) return false;
      const loadData = this._composeSwitchLoadData(dim, null, null, arrival);
      await this.start(loadData.gamemode, loadData.seed, loadData, this.currentSlot, loadData.cheatsEnabled, this.networkMode);
      if (arrival) this._afterPortalArrival(arrival);
      return true;
    });
  }

  // 维度重建串行化：start() 不可重入——连续换维（上一次重建未完成）并发执行会互相
  // 覆盖共享子系统，表现为"切过去又弹回旧维度"。所有维度重建走同一 promise 链。
  _enqueueDimensionSwitch(job) {
    const run = (this._dimSwitchJob || Promise.resolve()).then(job, job);
    this._dimSwitchJob = run.catch(() => {});
    return run;
  }

  // 合成换维用 loadData（单机用本地全维账本；联机传入服务器权威的目标维账本覆盖）
  // arrival：传送门落点 {x,z,portal}——预解析立足面高度并写进 player 坐标（dimensionSpawn=false）
  _composeSwitchLoadData(dim, dimBlocksOverride, dimContainersOverride, arrival = null) {
    const p = this.player;
    const dimBuckets = {};
    for (const [d, m] of this.world.dimensionBlocks) dimBuckets[d] = Object.fromEntries(m);
    if (dimBlocksOverride) dimBuckets[dim] = dimBlocksOverride;
    const contBuckets = {};
    for (const [d, m] of this.world.dimensionContainers) contBuckets[d] = Object.fromEntries(m);
    if (dimContainersOverride) contBuckets[dim] = dimContainersOverride;
    const furnBuckets = {};
    for (const [d, m] of this.world.dimensionFurnaces) furnBuckets[d] = Object.fromEntries(m);
    const playerData = {
      yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food,
      saturation: p.saturation, exhaustion: p.exhaustion,
      xp: p.xp, xpLevel: p.xpLevel, onFire: 0, airTicks: 300
    };
    // 传送门落点：带坐标（下界/天域）→ 预解析立足面高度并写进 player 坐标；
    // 仅带 portal 标记（末地）→ 落维度出生点，到达后由 _afterPortalArrival 建回程垫
    const hasPos = arrival && Number.isFinite(arrival.x) && Number.isFinite(arrival.z);
    if (hasPos) {
      const ay = this._resolveArrivalY(dim, arrival.x, arrival.z);
      const plat = ARRIVAL_PLATFORM[dim];
      playerData.x = arrival.x + 0.5;
      playerData.z = arrival.z + 0.5;
      playerData.y = ay > 0 ? ay : (plat ? plat.y : 64);
    }
    return {
      seed: this.world.seed,
      gamemode: p.gamemode,
      cheatsEnabled: this.cheatsEnabled,
      biomeScale: this.biomeScale, // 群系规模跨维透传（换维重建世界后主世界群系布局不变）
      dimension: dim,
      dimensionSpawn: !hasPos, // 传送门落点带坐标；否则忽略坐标落到目标维度出生点
      dragonDefeated: !!this.world.dragonDefeated, // 击败标记跨维透传（换维重建不丢）
      finalePrimordial: this.world.finalePrimordial || null, // 候潮状态跨维透传（终局篇 F1：换维重建不丢）
      finaleDone: !!this.world.finaleDone, // 听潮完成跨维透传（终局篇 F3：换维重建不丢）
      emblemWorn: !!this.player.emblemWorn, // 纹章佩戴跨维透传（Build 19 K3）
      aetherDusk: !!this.aetherDusk, // 天域复潮状态跨维透传（批次 D：换维重建不丢）
      player: playerData,
      inventory: this.inventory.serialize(),
      dimensionBlocks: dimBuckets,
      dimensionContainers: contBuckets,
      dimensionFurnaces: furnBuckets,
      redstone: this.redstone ? this.redstone.serialize() : null,
      sky: { time: this.sky ? this.sky.time : 0.35 }
    };
  }

  // M4 联机换维落地：服务器 dimension_world 回执（目标维度权威账本）→ 重建本地世界
  //（走维度重建串行链——连续换维不并发 start()）
  // pos：传送门落点 {x,z,portal}（服务器原样回传给换维者本人）→ 到达后搜门/建返程门
  applyDimensionWorld(dim, blockList, containerList, pos = null) {
    if (!this.running || !this.world) return Promise.resolve(false);
    const def = getDimension(dim);
    if (!def || !def.implemented) return Promise.resolve(false);
    return this._enqueueDimensionSwitch(async () => {
      if (!this.running || !this.world) return false;
      const key3 = (v) => { const n = Number(v); return Number.isInteger(n) && Math.abs(n) <= 30000000 ? n : 0; };
      const dimBlocks = {};
      for (const b of blockList || []) dimBlocks[`${key3(b.x)},${key3(b.y)},${key3(b.z)}`] = key3(b.id) | 0;
      const dimContainers = {};
      for (const c of containerList || []) {
        if (Array.isArray(c.items) && c.items.length === 27) {
          dimContainers[`${key3(c.x)},${key3(c.y)},${key3(c.z)}`] = c.items;
        }
      }
      const sameDim = this.world.dimension === dim;
      if (sameDim) {
        // 同维账本收敛（重连/重复回执）：不重建世界，直接覆盖本地桶并重载受影响区块
        this.world.loadDimensionBuckets(
          { [dim]: dimBlocks }, { [dim]: dimContainers }
        );
        this.world.markAllDirty();
        return true;
      }
      const arrival = (pos && (typeof pos.portal === 'string' || (Number.isFinite(pos.x) && Number.isFinite(pos.z))))
        ? {
            x: Number.isFinite(pos.x) ? key3(pos.x) : undefined,
            z: Number.isFinite(pos.z) ? key3(pos.z) : undefined,
            portal: typeof pos.portal === 'string' ? pos.portal : null,
          }
        : null;
      const loadData = this._composeSwitchLoadData(dim, dimBlocks, dimContainers, arrival);
      await this.start(loadData.gamemode, loadData.seed, loadData, this.currentSlot, loadData.cheatsEnabled, this.networkMode);
      if (arrival) this._afterPortalArrival(arrival);
      if (this.chatBox) this.chatBox.add(t('已切换到「{d}」', { d: t(def.name) }), '#8f8');
      return true;
    });
  }

  // 进入观战模式（死亡后）：旁观模式自由飞行，相机可第一人称跟随存活玩家
  enterSpectate() {
    if (!this.running || this.spectating) return;
    this.spectating = true;
    this.spectateTargetId = null;
    this._specSmoothed = null;
    this._specSmoothYaw = 0;
    this._specSmoothPitch = 0;
    this._preSpectateMode = this.player.gamemode === 'spectator' ? 'survival' : this.player.gamemode;
    this.player.setMode('spectator'); // 旁观：穿墙自由飞行
    if (this.deathScreen) this.deathScreen.hideForSpectate();
    this.paused = false;
    if (this.controls) { this.controls.enabled = true; }
    if (document.pointerLockElement) document.exitPointerLock();
    // 自动跟随第一个存活玩家（若有）
    this.cycleSpectateTarget();
    this._spectateHint();
  }

  // 观战目标循环：在存活远端玩家间切换（targetId 循环）
  cycleSpectateTarget() {
    const alive = [...this.remotePlayers.values()].filter((rp) => !rp.dead);
    if (!alive.length) { this.spectateTargetId = null; return; }
    const ids = alive.map((rp) => rp.id);
    const idx = ids.indexOf(this.spectateTargetId);
    this.spectateTargetId = ids[(idx + 1) % ids.length];
    this._specSmoothed = null; // 阶段6：切换目标即重置平滑，直接贴合新目标（避免跨图横扫）
    this._specSmoothYaw = 0;
    this._specSmoothPitch = 0;
  }

  // 观战提示（聊天栏显示当前跟随目标 / 操作说明）
  _spectateHint() {
    if (!this.chatBox) return;
    const rp = this.spectateTargetId != null ? this.remotePlayers.get(this.spectateTargetId) : null;
    const who = rp ? `跟随 ${rp.name}` : '自由飞行（无存活玩家）';
    this.chatBox.add(t('观战中 · {who} · F5 切换目标 / R 重生', { who }), '#aac');
  }

  // 每帧观战相机：跟随目标时第一人称视角贴合目标（平滑后的位置/朝向）；无目标则自由飞行（spectator 已穿墙）
  updateSpectateCamera() {
    if (!this.spectating) return;
    const rp = this.spectateTargetId != null ? this.remotePlayers.get(this.spectateTargetId) : null;
    if (!rp || rp.dead) {
      if (this.spectateTargetId != null) this.spectateTargetId = null; // 目标死亡/离开，回到自由
      return;
    }
    const cam = this.renderer.camera;
    cam.position.copy(this.player.position); // 已被 update() 平滑吸附到目标附近
    cam.position.y += 1.62; // 视点高度
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this._specSmoothed ? this._specSmoothYaw : rp.yaw;
    cam.rotation.x = this._specSmoothed ? this._specSmoothPitch : rp.pitch;
  }

  getAttackDamage() {
    const sel = this.inventory.getSelected();
    // 信标力量效果（Idea-2D-③）：每级 +2 近战伤害
    const str = this.player.getEffectLevel ? this.player.getEffectLevel('strength') : 0;
    if (!sel) return 1 + 2 * str;
    const item = ItemRegistry.getByName(sel.name);
    if (item && item.tool === 'sword') return 2 + (item.tier || 1) + 2 + 2 * str;
    if (item && item.tool === 'axe') return 2 + (item.tier || 1) + 2 * str;
    return 1 + 2 * str;
  }

  // 射线检测远端玩家（简化球体检测，半径 0.5，高度 1.8），返回命中的 RemotePlayer 或 null
  _findRemoteByRay(origin, dir, maxDist) {
    let best = null, bestDist = maxDist;
    for (const rp of this.remotePlayers.values()) {
      if (rp.dead) continue;
      const oc = new THREE.Vector3().subVectors(origin, rp.group.position);
      const b = oc.dot(dir);
      const c = oc.dot(oc) - 0.5 * 0.5;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > bestDist) continue;
      const hy = origin.y + dir.y * t;
      if (hy < rp.group.position.y || hy > rp.group.position.y + 1.8) continue;
      bestDist = t;
      best = rp;
    }
    return best;
  }

  stop() {
    this.running = false;
  }

  // 返回主菜单，save=true 时保存存档到当前槽位
  returnToMenu(save = true) {
    if (save && this.world && !this.networkMode) {
      SaveSystem.save(this);
    }
    this.stop();
    // 清理旧世界 Three.js 资源和 UI DOM，防止回到菜单再进新存档时残留
    this._disposeWorld();
    // 终局演出窗口随回菜单终止（换维不经过此处——start 重入保留窗口实现追潮）
    this._stopFinaleTide();
    // 联机：断开网络连接并复位联机状态
    if (this.net) this.net.close();
    this.networkMode = false;
    this.aetherDusk = false; // Build 20 ⑦：回菜单复位复潮状态（防跨存档残留；全局档案在下次进天域 start 时按存档重设）
    if (this.infoBar) this.infoBar.hide();
    if (this.hud) { this.hud.setUnderwater(false); this.hud.hideAll(); }
    this.paused = false;
    if (this.controls) this.controls.enabled = false;
    if (this.hand) this.hand.setVisible(false); // 回菜单不显示第一人称手臂
    if (this.playerModel) this.playerModel.update(0, this.player, false, false); // 第三人称模型一并隐藏（Build 20 ⑤）
    if (this.hud) this.hud.setOnFire(false);
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.onExit) this.onExit();
  }
}
