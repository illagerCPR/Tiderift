// Game.js -- 游戏主类：管理所有子系统
import * as THREE from 'three';
import { Renderer } from '../render/Renderer.js';
import { Sky } from '../render/Sky.js';
import { SVGTextures } from '../render/SVGTextures.js';
import { ChunkMeshBuilder, RenderQuality } from '../render/ChunkMesh.js';
import { World } from '../core/World.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { updateAirSupply } from '../core/AirSupply.js';
import { Player } from './Player.js';
import { Physics } from './Physics.js';
import { Summoning } from './Summoning.js';
import { GlideWind } from './GlideWind.js';
import { Endgame } from './Endgame.js';
import { Projectiles } from './Projectiles.js';
import { Beacon } from './Beacon.js';
import { Placement } from './Placement.js';
import { PortalSystem } from './PortalSystem.js';
import { AetherFinale } from './AetherFinale.js';
import { InteractionController } from './InteractionController.js';
import { CROP_MAX_STAGE, isCropId, cropStageOf, cropIdAtStage, isHydrated } from '../core/crops.js';
import { Controls } from './Controls.js';
import { Inventory } from './Inventory.js';
import { Raycast, raySphereHit } from './Raycast.js';
import { PLAYER_EYE_HEIGHT, BLOCK_CENTER, MOVE_SPEED_FLYING, MOVE_SPEED_SURVIVAL, MOVE_SPEED_CREATIVE } from './constants.js';
import { Hotbar, setSvgMaps } from '../ui/Hotbar.js';
import { Hud } from '../ui/Hud.js';
import { InfoBar } from '../ui/InfoBar.js';
import { InventoryScreen } from '../ui/InventoryScreen.js';
import { ChestScreen } from '../ui/ChestScreen.js';
import { BeaconScreen } from '../ui/BeaconScreen.js';
import { SteleScreen } from '../ui/SteleScreen.js';
import { JournalScreen } from '../ui/JournalScreen.js';
import { WaymarkScreen } from '../ui/WaymarkScreen.js';
import { RaceScreen } from '../ui/RaceScreen.js';
import { RaceHud } from '../ui/RaceHud.js';
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
import { CHUNK_SIZE, CHUNK_HEIGHT } from '../core/Chunk.js';
import { ARRIVAL_PLATFORM, removeConnectedPortals } from '../core/Portals.js';
import { ringPoints } from '../world/structures/stronghold.js';
import { matchRecipe } from '../core/Crafting.js';
import { MobManager } from '../entity/MobManager.js';
import { LocalPlayerModel } from '../entity/LocalPlayerModel.js';
import { VoxelLightUniforms, GfxState, ShadowUniforms } from '../render/VoxelLight.js';
import { RedstoneSystem } from '../core/RedstoneSystem.js';
import { SaveSystem } from '../core/SaveSystem.js';
import { Blueprints, captureBlueprint } from '../core/Blueprints.js';
import { GhostPreview } from '../render/GhostPreview.js';
import { BlueprintScreen } from '../ui/BlueprintScreen.js';
import { Journal } from '../core/Journal.js';
import { Waymarks, waymarkKey, waymarkStageDef } from '../core/Waymarks.js';
import { RaceTracks, trackLength } from '../core/RaceTracks.js';
import { RaceRun, formatRaceTime } from '../core/RaceRun.js';
import { getDimension, setAetherDuskProfile } from '../core/dimensions.js';
import { DEFAULT_BIOME_SCALE, safeBiomeScale } from '../world/biomes.js';
import { FirstPersonHand } from '../render/FirstPersonHand.js';
import { ParticleSystem } from '../render/ParticleSystem.js';
import { loadSettings, applySettings, applyFogRange } from '../core/Settings.js';
import { audio } from '../audio/AudioEngine.js';
import { TerrainWorkerClient } from '../workers/TerrainWorkerClient.js';
import { MeshWorkerClient } from '../workers/MeshWorkerClient.js';
import { playerColorCss } from '../net/playerColor.js';

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
    this.atlasTexture = null;
    this.atlasUV = null;
    this.waterTexture = null;
    this._worldStartToken = 0;
    this._loopToken = 0;
    this.world = null;
    this.hotbar = null;
    this.inventoryScreen = null;
    this.chestScreen = null;
    this.beaconScreen = null;
    this.steleScreen = null;
    this.journal = null;        // 四界游记数据（新建型：start 创建 / _disposeWorld 释放）
    this.journalScreen = null;  // 四界游记界面（新建型：_disposeWorld 摘 DOM 与监听器）
    this.blueprints = null;
    this.blueprintScreen = null;
    this.ghostPreview = null;
    this._journalObserveAt = 0;   // 揭图节流时间戳（performance.now）
    this._journalDiscoveryAt = 0; // 结构发现节流时间戳
    this.waymarks = null;         // 天域旧航路航标进度（新建型：start 创建 / _disposeWorld 释放）
    this.waymarkScreen = null;    // 旧航标界面（新建型：_disposeWorld 摘 DOM 与监听器）
    this.races = null;            // 御风赛道与个人成绩（新建型：start 创建 / _disposeWorld 释放）
    this.raceScreen = null;       // 御风赛道界面（新建型：_disposeWorld 摘 DOM 与监听器）
    this.raceHud = null;          // 竞速计时条（新建型：挂 body，_disposeWorld 移除）
    this.raceRun = null;          // 当前竞速尝试（RaceRun；无尝试时 null）
    this._raceHudAt = 0;          // 计时条刷新节流
    this._raceCheckAt = 0;        // 赛道完整性巡检节流
    this._waymarkNavCache = null; // 下一座航路查询缓存（随世界重建清空）
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
    // 轮 8 首刀域（构造器共享型，无资源可收口）：手工召唤 / 滑翔与气流。二者一律在调用点
    // 经 this.game 现取 world / mobManager / inventory / hud，不留构造期快照（那些随 start() 重建）。
    this.summoning = new Summoning(this);
    this.glideWind = new GlideWind(this);
    this.endgame = new Endgame(this);
    this.projectiles = new Projectiles(this);
    this.beacon = new Beacon(this);
    this.placement = new Placement(this);
    this.portalSystem = new PortalSystem(this);
    this.aetherFinale = new AetherFinale(this);
    this.interactionController = new InteractionController(this);
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
      if (this._anyInputBlockingUI()) return; // 容器界面开着时不弹暂停
      if (this.commandPanel && this.commandPanel.visible) return;
      if (this.pauseMenu && this.pauseMenu.visible) return;
      if (this.deathScreen && this.deathScreen.visible) return;
      this.pauseMenu?.show();
    });
  }

  // F11：唯一「阻断世界输入的 UI」清单（背包/箱子/熔炉/交易/信标/石碑/游记）。
  // 这些界面 show() 时置 controls.enabled=false 并退指针锁，但鼠标按键状态可能残留，
  // 故挖掘/攻击/弓蓄力与指针锁自动暂停都必须先问这里——新增此类界面只改这一处。
  _anyInputBlockingUI() {
    return !!((this.blueprintScreen && this.blueprintScreen.visible) ||
      (this.inventoryScreen && this.inventoryScreen.visible) ||
      (this.chestScreen && this.chestScreen.visible) ||
      (this.furnaceScreen && this.furnaceScreen.visible) ||
      (this.tradeScreen && this.tradeScreen.visible) ||
      (this.beaconScreen && this.beaconScreen.visible) ||
      (this.steleScreen && this.steleScreen.visible) ||
      (this.journalScreen && this.journalScreen.visible) ||
      (this.waymarkScreen && this.waymarkScreen.visible) ||
      (this.raceScreen && this.raceScreen.visible));
  }

  // 清理旧世界所有 Three.js 资源和 UI DOM，防止切换存档时残留"幽灵方块"等
  _disposeWorld() {
    this._worldStartToken = (this._worldStartToken || 0) + 1;
    this._loopToken = (this._loopToken || 0) + 1;
    const scene = this.renderer.scene;
    if (this.blueprintScreen) { this.blueprintScreen.dispose(); this.blueprintScreen = null; }
    if (this.ghostPreview) { this.ghostPreview.dispose(); this.ghostPreview = null; }
    this.blueprints = null;
    // B-①/B-②：地形/网格 Worker 随世界销毁（新建型资源，跨存档/换维必须 terminate）
    if (this.world && this.world.terrainWorker) {
      this.world.terrainWorker.dispose();
      this.world.terrainWorker = null;
    }
    if (this.world && this.world.meshWorker) {
      this.world.meshWorker.dispose();
      this.world.meshWorker = null;
    }
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
      this.mobManager = null;
    }
    // 高亮和破坏进度
    this.selectedBlock = null;
    this.breakingProgress = 0;
    if (this.highlight) this.highlight.visible = false;
    if (this.breakMesh) this.breakMesh.visible = false;
    // 粒子系统（新建型：随世界销毁）
    if (this.particles) { this.particles.dispose(); this.particles = null; }
    if (this.fireParticles) { this.fireParticles.dispose(); this.fireParticles = null; }
    if (this.chunkBuilder) { this.chunkBuilder.dispose(); this.chunkBuilder = null; }
    if (this.atlasTexture) { this.atlasTexture.dispose(); this.atlasTexture = null; }
    this.atlasUV = null;
    this.waterTexture = null;
    // 投射物与末影之眼飞行（内存级运行时列表，mesh 挂在跨存档共享 scene 上——新建型收口点）
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
    // 旧 UI DOM
    if (this.hotbar) { this.hotbar.el.remove(); this.hotbar = null; }
    if (this.inventoryScreen) { this.inventoryScreen.dispose(); this.inventoryScreen = null; }
    if (this.chestScreen) { this.chestScreen.dispose(); this.chestScreen = null; }
    if (this.beaconScreen) { this.beaconScreen.dispose(); this.beaconScreen = null; }
    if (this.steleScreen) { this.steleScreen.dispose(); this.steleScreen = null; }
    // 四界游记（新建型：DOM/监听器随界面回收，数据随世界清空——换维由 _composeSwitchLoadData 透传）
    if (this.journalScreen) { this.journalScreen.dispose(); this.journalScreen = null; }
    this.journal = null;
    this._journalObserveAt = 0;
    this._journalDiscoveryAt = 0;
    // 天域旧航路航标（新建型：界面摘 DOM，进度随世界清空——换维由 _composeSwitchLoadData 透传）
    if (this.waymarkScreen) { this.waymarkScreen.dispose(); this.waymarkScreen = null; }
    this.waymarks = null;
    this._waymarkNavCache = null;
    // 御风赛道（新建型：界面/计时条摘 DOM，赛道与成绩随世界清空——换维由 _composeSwitchLoadData 透传）
    if (this.raceScreen) { this.raceScreen.dispose(); this.raceScreen = null; }
    if (this.raceHud) { this.raceHud.dispose(); this.raceHud = null; }
    this.races = null;
    this.raceRun = null;
    this._raceHudAt = 0;
    this._raceCheckAt = 0;
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
    this.raycast = null;
    this.redstone = null;
    if (this.physics) this.physics.world = null;
    this.world = null;
  }

  async start(mode, seed, loadData = null, slot = 1, cheatsEnabled = false, networkMode = false, biomeScale = DEFAULT_BIOME_SCALE) {
    let startToken = null;
    try {
    // 清理旧世界资源，防止切换存档时残留
    this._disposeWorld();
    startToken = this._worldStartToken;
    const isCurrentStart = () => this._worldStartToken === startToken;
    this.currentSlot = slot;
    this.networkMode = networkMode;
    if (!networkMode) this.finaleInfo = null;
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
    if (this.networkMode && this.finaleInfo && this.finaleInfo.room === this.net?.room) {
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
    const mobManager = new MobManager(this.world, this.renderer.scene, null, null);
    this.mobManager = mobManager;
    await mobManager.init(allSvgs);
    if (!isCurrentStart()) return;
    
    const { atlasTexture, atlasUV } = await SVGTextures.buildAtlas(allSvgs);
    if (!isCurrentStart()) {
      atlasTexture.dispose();
      return;
    }
    this.atlasTexture = atlasTexture;
    this.atlasUV = atlasUV;
    // 水面独立纹理：RepeatWrapping + 世界坐标 UV 平铺，避免 chunk 边界方格
    const waterTexture = await SVGTextures.buildRepeatTexture(allSvgs['water'] || '', 'water');
    if (!isCurrentStart()) return;
    this.waterTexture = waterTexture;
    this.chunkBuilder = new ChunkMeshBuilder(this.world, atlasTexture, atlasUV, waterTexture);
    // B-②：网格构建 Worker（维度无关——收集只依赖缓存+图集表；随世界销毁重建）
    this.world.meshWorker = new MeshWorkerClient([...atlasUV.entries()]);
    // 粒子系统（新建型：每次 start 重建，_disposeWorld 释放）
    this.particles = new ParticleSystem(this.renderer.scene, atlasTexture, atlasUV, 0.12);
    this.fireParticles = new ParticleSystem(this.renderer.scene, atlasTexture, atlasUV, 0.09);
    // 爆炸销毁方块时的碎屑粒子出口（TNT / 苦力怕爆炸共用）
    this.redstone.onBlockDestroyed = (x, y, z, def) => {
      if (this.particles) this.particles.burstBlockBreak(x + BLOCK_CENTER, y, z + BLOCK_CENTER, def, this.world, 10);
    };
    this.mobManager.onBlockDestroyed = (x, y, z, def) => {
      if (this.particles) this.particles.burstBlockBreak(x + BLOCK_CENTER, y, z + BLOCK_CENTER, def, this.world, 8);
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
    mobManager.atlasUV = atlasUV;
    mobManager.atlasTexture = atlasTexture;
    await mobManager.buildMaterials();
    if (!isCurrentStart()) return;
    
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
      if (!isCurrentStart()) return;
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
      this.player.drownTimer = 1; // 溺水计时器不进存档，加载即复位
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
    // 床重生点：旧档读取 / 新档清空（投射物/光柱等 scene 残留由 _disposeWorld 单点收口）
    this.bedSpawn = (loadData && loadData.bedSpawn) || null;
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
    if (!isCurrentStart()) return;
    // 四界游记（Build 34 A）：数据必须先于界面创建——JournalScreen.render 直接读 this.journal。
    // 旧档/旧联机档案缺 journal 字段时 reset(null) 回落为空游记（reset 内部即全量重建）。
    this.journal = new Journal(this); // 新建型：_disposeWorld 释放
    this.journal.reset(loadData ? loadData.journal : null);
    this.blueprints = new Blueprints();
    this.blueprints.resetPersonal(loadData ? loadData.blueprints : null);
    this._journalObserveAt = 0;
    this._journalDiscoveryAt = 0;
    this.journalScreen = new JournalScreen(this); // 新建型：_disposeWorld 摘 DOM/监听器
    this.ghostPreview = new GhostPreview(this.renderer.scene);
    this.blueprintScreen = new BlueprintScreen(this);
    // 天域旧航路航标（Build 34 B）：进度是存档/房间共享状态，界面直接读 this.waymarks，故先建数据再建界面。
    this.waymarks = new Waymarks(this);
    this.waymarks.reset(loadData ? loadData.waymarks : null);
    this._waymarkNavCache = new Map();
    this.waymarkScreen = new WaymarkScreen(this); // 新建型：_disposeWorld 摘 DOM/监听器
    // 御风赛道（Build 34 C）：数据先于界面创建（RaceScreen.render 直接读 this.races）。
    // 旧档/旧联机档案缺 races 字段时 reset(null) 回落为空赛道表；换维/换档一律重新开始，竞速尝试不跨世界。
    this.races = new RaceTracks(this);
    this.races.reset(loadData ? loadData.races : null);
    this.raceRun = null;
    this._raceHudAt = 0;
    this._raceCheckAt = 0;
    this.raceHud = new RaceHud(this); // 新建型：挂 body，_disposeWorld 移除
    this.raceScreen = new RaceScreen(this); // 新建型：_disposeWorld 摘 DOM/监听器
    // 联机：世界重建期间到达的赛道/蓝图消息只进了 NetworkManager 缓存，这里主动兜底落地一次
    // （时序与 C 阶段一致：模型与界面都已重建之后才 flush，否则落到被 _disposeWorld 置空/替换的旧实例上）
    if (this.net && typeof this.net.flushPendingRaces === 'function') this.net.flushPendingRaces();
    if (this.net && typeof this.net.flushPendingBlueprints === 'function') this.net.flushPendingBlueprints();
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
        this.inventory.removeItems(info.name, info.count, info.data ?? null);
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
      if (startToken !== null && startToken !== this._worldStartToken) return;
      console.error('游戏启动失败:', e);
      this.running = false;
      if (this.controls) this.controls.enabled = false;
      this._disposeWorld();
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
        if (this.journalScreen && this.journalScreen.visible) { this.journalScreen.hide(); return; }
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
        if (this.journalScreen && this.journalScreen.visible) return; // 游记开着不叠加命令面板
        if (this.commandPanel) this.commandPanel.toggle();
      }
      // Q 键丢弃（Build 10 原版化）：Q 丢 1 个 / Ctrl+Q 丢整组，沿视线初速抛出，2 秒后才可拾取
      if (e.code === 'KeyQ') {
        // 界面/文本焦点时早退（不 preventDefault，避免吃掉聊天与命令面板输入框的字符）
        if (!this.running || this.spectating || (this.deathScreen && this.deathScreen.visible)) return;
        if (this.pauseMenu && this.pauseMenu.visible) return;
        if (this.chatBox && this.chatBox.input) return;
        if (this.commandPanel && this.commandPanel.visible) return;
        if (this._anyInputBlockingUI()) return; // 容器界面开着时不丢弃（清单唯一入口）
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
        if (this.journalScreen && this.journalScreen.visible) return; // 游记开着不叠加背包
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
      // N 键：四界游记（探索地图 / 已发现遗迹 / 已读碑文 / 个人标记）。
      // 与 E/C/J/Q 同款互斥：暂停、观战、死亡、聊天输入、命令面板、容器界面一律不开；
      // 已开着时再按 N 合上（hide 恢复 controls.enabled，招牌惯例见 BeaconScreen）。
      if (e.code === 'KeyN') {
        if (!this.running || this.spectating || (this.deathScreen && this.deathScreen.visible)) return;
        if (this.pauseMenu && this.pauseMenu.visible) return;
        if (this.chatBox && this.chatBox.input) return;
        if (this.commandPanel && this.commandPanel.visible) return;
        if (this.journalScreen && this.journalScreen.visible) { this.journalScreen.hide(); return; }
        if (this._anyInputBlockingUI()) return; // 容器/石碑以外的界面开着时不叠加
        if (this.journalScreen) this.journalScreen.show();
      }
      if (e.code === 'KeyB') {
        if (!this.running || this.spectating || (this.deathScreen && this.deathScreen.visible)) return;
        if (this.pauseMenu && this.pauseMenu.visible) return;
        if (this.chatBox && this.chatBox.input) return;
        if (this.commandPanel && this.commandPanel.visible) return;
        if (this.blueprintScreen && this.blueprintScreen.visible) { this.blueprintScreen.hide(); return; }
        if (this._anyInputBlockingUI()) return;
        this.blueprintScreen?.show();
      }
      // G 键：御风赛道（建赛道 / 开始 / 编辑 / 删除 / 看成绩）。互斥规则与 N 键同款.
      if (e.code === 'KeyG') {
        if (!this.running || this.spectating || (this.deathScreen && this.deathScreen.visible)) return;
        if (this.pauseMenu && this.pauseMenu.visible) return;
        if (this.chatBox && this.chatBox.input) return;
        if (this.commandPanel && this.commandPanel.visible) return;
        if (this.raceScreen && this.raceScreen.visible) { this.raceScreen.hide(); return; }
        if (this._anyInputBlockingUI()) return;
        if (this.raceScreen) this.raceScreen.show();
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
        // 四界游记：ESC 合上（pointer lock 未激活时也不依赖界面内监听器）
        if (this.journalScreen && this.journalScreen.visible) {
          this.journalScreen.hide();
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

  loop = (token = this._loopToken) => {
    if (!this.running || token !== this._loopToken) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.frame++;
    if (!this.paused) this.update(dt);
    else if (this._bowCharging) this._cancelBowCharge(); // 暂停/死亡：蓄力作废（防恢复后误射）
    this.renderer.render();
    requestAnimationFrame(() => this.loop(token));
  };

  // 检测眼睛位置是否在水里，更新 inWater / 氧气 / 溺水
  _updateWaterState(dt) {
    const p = this.player;
    const eyeY = p.position.y + PLAYER_EYE_HEIGHT;
    const bx = Math.floor(p.position.x);
    const by = Math.floor(eyeY);
    const bz = Math.floor(p.position.z);
    const id = this.world.getBlock(bx, by, bz);
    const def = BlockRegistry.getById(id);
    p.inWater = !!(def && def.fluid && def.fluidType === 'water');

    if (p.survival) {
      // 氧气/溺水（B30 起原版口径：满氧 15 秒、溺水每秒 2 血，逐帧按 dt 折算帧率无关）
      updateAirSupply(p, p.inWater, dt);
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
    this._inUpdraft = this.glideWind.computeUpdraftState(); // 判定实现在 GlideWind，字段仍归 Game
  }

  // 四界游记（Build 34 A）：揭图与结构发现。两者都按时间节流——observe 只在跨区块格时求解
  // 3×3 群系（Journal 内部去重），structureRecordAt 只在玩家真实落入结构包围盒时命中；
  // 重复进入由 Journal.recordDiscovery 的「维度+类型+锚点」键幂等去重。
  // 观战/旁观/死亡不推进个人探索（位置来自他人或被冻结的死亡实体）。
  _updateJournal() {
    const journal = this.journal;
    const world = this.world;
    if (!journal || !world || !world.generator) return;
    if (this.spectating || this.player.spectator || this.player.dead) return;
    const now = performance.now();
    const pos = this.player.position;
    if (now - this._journalObserveAt >= 250) { // ≥0.25s：不每帧重算群系
      this._journalObserveAt = now;
      journal.observe(world.dimension, pos.x, pos.z);
    }
    if (now - this._journalDiscoveryAt >= 500) { // ≥0.5s：与 InfoBar 建筑行同节奏
      this._journalDiscoveryAt = now;
      const sm = world.generator.structureManager;
      const hit = (sm && sm.structureRecordAt) ? sm.structureRecordAt(pos.x, pos.z) : null;
      if (hit && hit.record) {
        // 幂等键取结构锚点而非玩家坐标：从包围盒任意位置进入只记唯一一条
        journal.recordDiscovery(world.dimension, hit.name, hit.record.ax, hit.record.az, hit.label);
      }
    }
  }

// ── 天域旧航路航标（Build 34 B）─────────────────────────────────────────
  // 下一座航路：只依赖种子与锚点（StructureManager.nextTowerFrom），按锚点缓存一次求解结果。
  // 找不到时返回 null，界面给明确提示而不伪造目标。
  _waymarkNextTower(ax, az) {
    const sm = this.world && this.world.generator && this.world.generator.structureManager;
    if (!sm || typeof sm.nextTowerFrom !== 'function') return null;
    if (!this._waymarkNavCache) this._waymarkNavCache = new Map();
    const key = waymarkKey(ax, az);
    if (this._waymarkNavCache.has(key)) return this._waymarkNavCache.get(key);
    const rec = sm.nextTowerFrom(ax, az);
    const out = rec ? { ax: rec.ax, az: rec.az } : null;
    this._waymarkNavCache.set(key, out);
    return out;
  }

  // 阶段材料扣除（联机在服务器回执后扣，单机提交即扣——两边都走这里）
  _consumeWaymarkMaterials(stage) {
    const def = waymarkStageDef(stage);
    if (!def || !this.inventory) return;
    for (const need of def.needs) this.inventory.removeItems(need.name, need.count);
    if (this.hotbar) this.hotbar.update();
  }

  // 进度落地（单机与联机回执共用）。place=true 时才放置航标芯：联机只由提交方放置，
  // 其余客户端经 World 方块账本同步收到，避免各端重复 setBlock 造成广播放大。
  _applyWaymarkProgress(ax, az, stage, byName, place) {
    if (!this.waymarks) return false;
    const changed = this.waymarks.setStage(ax, az, stage, byName);
    if (!changed) return false;
    if (stage >= 3) {
      if (place) {
        const sm = this.world && this.world.generator && this.world.generator.structureManager;
        const rec = sm && sm.towerRecordAt ? sm.towerRecordAt(ax, az) : null;
        if (rec) this._placeWaymarkBlock(rec);
      }
      if (this._waymarkNavCache) this._waymarkNavCache.delete(waymarkKey(ax, az));
      if (this.chatBox) this.chatBox.add(t('旧航标重新亮起，下一座航路已记入游记。'), '#8fd0c4');
    } else if (this.chatBox) {
      const who = byName ? t('{name} ', { name: byName }) : '';
      this.chatBox.add(t('{who}修复航标 {n}/3。', { who, n: stage }), '#8fd0c4');
    }
    return true;
  }

  // 单机提交：校验阶段与材料 → 扣料 → 落地进度（含放置航标芯）
  _completeWaymarkStage(tower, stage, byName) {
    if (!tower || !this.waymarks) return false;
    if (this.waymarks.stageAt(tower.ax, tower.az) !== stage - 1) return false;
    if (this.waymarks.missingFor(stage, this.inventory).length) return false;
    this._consumeWaymarkMaterials(stage);
    return this._applyWaymarkProgress(tower.ax, tower.az, stage, byName, true);
  }

  // 航标芯放置：塔顶平台仍存在才落地（拆改塔顶后不留幽灵航标）。
  // 走 World.setBlock——联机时由 NetworkManager 的 onLocalBlockChange 钩子自动上报。
  _placeWaymarkBlock(tower) {
    const world = this.world;
    if (!world || !tower) return false;
    const id = BlockRegistry.getId('aether_waymark');
    if (id === undefined || id === null) return false;
    const x = tower.ax;
    const y = tower.groundY + 10;
    const z = tower.az;
    if (world.getBlock(x, y - 1, z) === 0) return false; // 脚下平台已毁 → 不重建
    if (world.getBlock(x, y, z) === id) return false;    // 幂等
    world.setBlock(x, y, z, id);
    return true;
  }

  // ── 御风竞速与自建赛道（Build 34 C）─────────────────────────────────
  // 赛道点位只认「御风标桩」方块，且以方块账本为权威：区块未加载也能判定，
  // 被拆掉的桩在账本里记为 0（World.setBlock 覆盖写入），因此不会出现幽灵点位。
  _racePosts(maxRadius = 512) {
    const world = this.world;
    if (!world || !world.modifiedBlocks) return [];
    const id = BlockRegistry.getId('race_post');
    if (id === undefined || id === null) return [];
    const pos = (this.player && this.player.position) || { x: 0, y: 64, z: 0 };
    const out = [];
    for (const [key, blockId] of world.modifiedBlocks) {
      if (blockId !== id) continue;
      const parts = key.split(',');
      if (parts.length !== 3) continue;
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const dist = Math.hypot(x - pos.x, y - pos.y, z - pos.z);
      if (dist > maxRadius) continue;
      out.push({ x, y, z, dist: Math.round(dist) });
    }
    out.sort((a, b) => a.dist - b.dist || a.x - b.x || a.z - b.z);
    return out.slice(0, 80); // 界面一次最多列 80 根，避免超长列表拖慢渲染
  }

  _racePostAt(point) {
    const world = this.world;
    if (!world || !world.modifiedBlocks || !point) return false;
    const id = BlockRegistry.getId('race_post');
    if (id === undefined || id === null) return false;
    return world.modifiedBlocks.get(`${point.x},${point.y},${point.z}`) === id;
  }

  // 赛道完整性：点位必须仍是真实的御风标桩，且必须落在当前维度（跨维点位视为失效）
  _raceTrackValidity(track) {
    if (!track || !Array.isArray(track.points) || !track.points.length) return { ok: false, badIndex: 0 };
    if (!this.world || this.world.dimension !== track.dim) return { ok: false, badIndex: 0 };
    for (let i = 0; i < track.points.length; i++) {
      if (!this._racePostAt(track.points[i])) return { ok: false, badIndex: i };
    }
    return { ok: true, badIndex: -1 };
  }

  _raceTrackLength(track) {
    return trackLength(track);
  }

  // 联机以 selfId 区分「我的最佳」与「房间最佳」；单机 who 恒为空串
  _raceSelfKey() {
    const net = this.networkMode ? this.net : null;
    return net && net.selfId ? String(net.selfId) : '';
  }

  _raceBest(track) {
    if (!this.races || !track) return null;
    return this.races.best(track.id, track.revision, this._raceSelfKey());
  }

  _raceRoomBest(track) {
    if (!this.races || !track) return null;
    return this.races.roomBest(track.id, track.revision, this._raceSelfKey());
  }

  // 创造/旁观/终局纹章御风：照常计时，但不入最佳成绩（御风赛道与自由赛道不混榜）
  _raceAssisted(track) {
    const p = this.player;
    if (!p) return false;
    if (p.gamemode === 'creative' || p.gamemode === 'spectator') return true;
    if (track && track.mode === 'glide' && p.emblemWorn) return true;
    return false;
  }

  // 单机落库（联机走服务器回执 → NetworkManager 调 applyTrack + setRecord）
  _saveRaceTrack(track) {
    if (!this.races || !track) return null;
    const existing = this.races.get(track.id);
    const revision = existing ? Math.min(99999, existing.revision + 1) : 1;
    const saved = this.races.applyTrack({ ...track, revision });
    if (!saved) return null;
    if (this.raceRun && this.raceRun.track.id === saved.id) this._cancelRace('赛道已编辑');
    this._raceAddJournalMarker(saved);
    if (this.chatBox) this.chatBox.add(t('赛道「{name}」已保存（修订 {rev}）。', { name: saved.name, rev: saved.revision }), '#8fd0c4');
    if (this.raceScreen && this.raceScreen.visible) this.raceScreen.render();
    return saved;
  }

  _removeRaceTrack(id) {
    if (!this.races) return false;
    const existing = this.races.get(id);
    if (!this.races.remove(id)) return false;
    if (this.raceRun && this.raceRun.track.id === id) this._cancelRace('赛道已删除');
    if (existing && this.chatBox) this.chatBox.add(t('赛道「{name}」已删除。', { name: existing.name }), '#8fd0c4');
    if (this.raceScreen && this.raceScreen.visible) this.raceScreen.render();
    return true;
  }

  // 赛道起点同时登记为游记个人标记（A 轮标记体系可直接管理/删除）
  _raceAddJournalMarker(track) {
    const journal = this.journal;
    if (!journal || !track || !track.points.length) return;
    const start = track.points[0];
    const exists = (journal.markers || []).some((m) => m.dim === track.dim
      && m.label === track.name && Math.abs(m.x - start.x) <= 4 && Math.abs(m.z - start.z) <= 4);
    if (exists) return;
    journal.addMarker(track.dim, start.x, start.y, start.z, track.name);
  }

  // 报名：先落 armed，真正穿过起点才计时（「必须从起点主动开始」）
  _armRaceTrack(track) {
    if (!track || !this.races || !this.player) return false;
    if (!this.world || this.world.dimension !== track.dim) return false;
    const valid = this._raceTrackValidity(track);
    if (!valid.ok) {
      if (this.chatBox) this.chatBox.add(t('赛道有御风标桩已缺失，请编辑后重新保存。'), '#fbb');
      return false;
    }
    this.raceRun = new RaceRun(track, { now: performance.now(), pos: this.player.position, assisted: this._raceAssisted(track) });
    this._raceHudAt = 0;
    this._raceCheckAt = 0;
    this._raceHudClearAt = 0;
    if (this.chatBox) this.chatBox.add(t('已报名「{name}」：穿过起点开始计时。', { name: track.name }), '#8fd0c4');
    return true;
  }

  _cancelRace(reason) {
    const run = this.raceRun;
    this.raceRun = null;
    this._raceLastFinish = null;
    if (!run) return false;
    run.cancel(reason);
    if (this.raceHud) this.raceHud.setState('cancelled', { reason });
    this._raceHudClearAt = performance.now() + 2600;
    return true;
  }

  _raceDirLabel(dx, dz) {
    const ew = dx > 0 ? t('东') : (dx < 0 ? t('西') : '');
    const ns = dz < 0 ? t('北') : (dz > 0 ? t('南') : '');
    return (ew + ns) || t('原地');
  }

  // 竞速主循环：取消条件优先，其次推进判定、刷新计时条、给下一目标打点
  _updateRace(dt) {
    const now = performance.now();
    const hud = this.raceHud;
    const run = this.raceRun;
    if (!run) {
      if (this._raceHudClearAt && now >= this._raceHudClearAt) {
        this._raceHudClearAt = 0;
        if (hud) hud.hide();
      }
      return;
    }
    if (this.paused) { this._cancelRace('暂停'); return; }
    if (this.spectating || (this.deathScreen && this.deathScreen.visible) || (this.player && this.player.health <= 0)) {
      this._cancelRace('死亡');
      return;
    }
    if (!this.world || this.world.dimension !== run.track.dim) { this._cancelRace('换维'); return; }
    // 每秒巡检一次赛道完整性：标桩被拆 → 本次尝试作废（不静默保留不可完成的跑道）
    if (now >= this._raceCheckAt) {
      this._raceCheckAt = now + 1000;
      if (!this._raceTrackValidity(run.track).ok) { this._cancelRace('标桩已缺失'); return; }
    }
    const pos = this.player.position;
    const events = run.update(now, pos);
    for (const ev of events) {
      if (ev.type === 'start') {
        if (this.chatBox) this.chatBox.add(t('已过起点，计时开始。'), '#8fd0c4');
      } else if (ev.type === 'checkpoint') {
        audio.pop();
        if (this.chatBox) this.chatBox.add(t('检查点 {i}/{n}', { i: run.checkpointsPassed, n: run.checkpointTotal }), '#8fd0c4');
      } else if (ev.type === 'finish') {
        this._finishRace(run);
        audio.pop();
        return;
      } else if (ev.type === 'timeout') {
        this._cancelRace('出发超时');
        return;
      }
    }
    // 下一目标打点（每 0.5 秒一簇，96 格内才发射，离开即停止——不堆常驻特效）
    if (run.state === 'running' && this.particles && now >= (this._raceNoticeAt || 0)) {
      this._raceNoticeAt = now + 500;
      const target = run.nextPoint();
      const near = Math.hypot(target.x - pos.x, target.y - pos.y, target.z - pos.z) <= 96;
      if (near) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          this.particles.spawn(
            target.x + 0.5 + Math.cos(a) * 1.7, target.y + 0.5 + (i % 3) * 0.5, target.z + 0.5 + Math.sin(a) * 1.7,
            Math.cos(a) * 0.3, 0.75, Math.sin(a) * 0.3, 0.55, 0.95, 0.92, 1.1, -0.25, 0.9,
          );
        }
      }
    }
    // 计时条节流刷新（66ms ≈ 15Hz：毫秒位看得清，又不每帧重建 DOM）
    if (hud && now >= this._raceHudAt) {
      this._raceHudAt = now + 66;
      const target = run.state === 'armed' ? run.track.points[0] : run.nextPoint();
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.round(Math.hypot(dx, target.y - pos.y, dz));
      const dir = this._raceDirLabel(dx, dz);
      if (run.state === 'armed') {
        hud.setState('armed', { name: run.track.name, dist, dir });
      } else {
        hud.setState('running', {
          name: run.track.name, elapsed: run.elapsedMs,
          passed: run.checkpointsPassed, total: run.checkpointTotal, dist, dir,
        });
      }
    }
  }

  // 完赛：单机直接记个人最佳，联机上报服务器（只收清洗后的成绩，不宣称验证轨迹）
  _finishRace(run) {
    const track = run.track;
    const elapsed = run.elapsedMs;
    const assisted = run.assisted || this._raceAssisted(track);
    this.raceRun = null;
    let isBest = false;
    if (!assisted) {
      const net = this.networkMode ? this.net : null;
      if (net && typeof net.sendRaceRecord === 'function') {
        const prev = this._raceBest(track);
        isBest = prev === null || elapsed < prev;
        // 成绩按整数毫秒上报（服务器只接受整数；计时本身是浮点）
        net.sendRaceRecord(track.id, track.revision, Math.round(elapsed));
      } else if (this.races) {
        isBest = !!this.races.submitBest(track.id, track.revision, elapsed, '', '').isBest;
      }
    }
    this._raceLastFinish = { trackId: track.id, revision: track.revision, elapsed, assisted, isBest };
    if (this.raceHud) {
      this.raceHud.setState('finished', { elapsed, best: this._raceBest(track), isBest, assisted });
    }
    this._raceHudClearAt = performance.now() + 6000;
    if (this.chatBox) this.chatBox.add(t('「{name}」完赛：{t}', { name: track.name, t: formatRaceTime(elapsed) }), '#ffe9a8');
  }

  // 联机成绩回执：更新本地成绩表，并在结算条仍显示时刷新「个人最佳」
  _applyRaceRecord(msg) {
    if (!this.races || !msg || !msg.id) return;
    this.races.setRecord(msg.id, msg.revision, msg.byId || '', msg.ms, msg.byName || '');
    if (this._raceLastFinish && this._raceLastFinish.trackId === msg.id
      && this._raceLastFinish.revision === (msg.revision | 0) && this.raceHud) {
      const track = this.races.get(msg.id);
      if (track) {
        this.raceHud.setState('finished', {
          elapsed: this._raceLastFinish.elapsed,
          best: this._raceBest(track),
          isBest: this._raceLastFinish.isBest,
          assisted: this._raceLastFinish.assisted,
        });
      }
    }
    if (this.raceScreen && this.raceScreen.visible) this.raceScreen.render();
  }

  // 御风斗篷穿戴检测（批次 C）：胸甲槽 = armor[1]
  _hasGaleCloak() {
    return this.glideWind.hasGaleCloak();
  }

  // 风阵块放置：上方 12 格写风流柱（只填空气格；逐格 setBlock → 联机逐格自动上报）
  _writeGaleColumn(x, y, z) {
    this.glideWind.writeGaleColumn(x, y, z);
  }

  // 拆风阵块：同步清除其上方气流柱（遇非风流格即停，玩家建筑不受影响）
  _clearGaleColumn(x, y, z) {
    this.glideWind.clearGaleColumn(x, y, z);
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
    if (this.networkMode && this.net && this.net.isRecovering) return;
    // 检测玩家是否在水中（眼睛位置）
    this._updateWaterState(dt);
    // 检测玩家是否在上升气流柱内（天域批次 B：足部/身体任一格为 wind_current）
    this._updateUpdraftState();
    // 守誓巨像裂心风拽光环（天域批次 C：各端本地结算）
    this._updateColossusAura(dt);
    // 鞘翅滑翔折叠判定（水中/落地等环境变化要在移动分支前收口，gliding 不得跨分支残留）
    this._updateGlideFold();
    // 御风竞速：推进计时与顺序检查点判定（取消条件也在此收口）
    this._updateRace(dt);

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
      const speed = (this.player.flying ? MOVE_SPEED_FLYING : (this.player.survival ? MOVE_SPEED_SURVIVAL : MOVE_SPEED_CREATIVE))
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
    if (this.ghostPreview && this.ghostPreview.blueprint) {
      const anchor = this.selectedBlock ? this.selectedBlock.block : this.player.position;
      const blueprint = this.ghostPreview.blueprint;
      const rotation = this.ghostPreview.rotation;
      const widthX = rotation % 2 ? blueprint.size.z : blueprint.size.x;
      const widthZ = rotation % 2 ? blueprint.size.x : blueprint.size.z;
      this.ghostPreview.setAnchor(Math.floor(anchor.x) + 0.5 - widthX / 2, Math.floor(anchor.y), Math.floor(anchor.z) + 0.5 - widthZ / 2);
    }
    
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
    
    // 四界游记：按节流推进揭图与结构发现（位置取本帧物理结算后的最终坐标）
    this._updateJournal();

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
      this.bossBar.update(this.mobManager ? this.mobManager.getBosses() : []);
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
        if (!this.world || this.world.getChunk(chunk.cx, chunk.cz) !== chunk || chunk._meshVersion !== version) return;
        this._applyMeshOut(chunk, out);
      })
      .catch(() => {
        chunk._meshInFlight = false;
        if (!this.world || this.world.getChunk(chunk.cx, chunk.cz) !== chunk || this.chunkBuilder !== builder) return;
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

  // breakChest（逻辑在 Placement，见 src/player/Placement.js）
  _breakChest(block, dropContents) { return this.placement.breakChest(block, dropContents); }

  // breakShulkerBox（逻辑在 Placement，见 src/player/Placement.js）
  _breakShulkerBox(block, toInventory) { return this.placement.breakShulkerBox(block, toInventory); }

  // onContainerChanged（逻辑在 Placement，见 src/player/Placement.js）
  onContainerChanged(pos, items) { return this.placement.onContainerChanged(pos, items); }

  // 各物品 UI 当前悬浮的物品名（R/U 配方查询的作用目标）
  _uiHoverName() {
    const screens = [this.inventoryScreen, this.chestScreen, this.furnaceScreen, this.tradeScreen];
    for (const s of screens) {
      if (s && s.visible && s._hoverName) return s._hoverName;
    }
    return null;
  }

  // updateFurnaces（逻辑在 Placement，见 src/player/Placement.js）
  updateFurnaces(dt) { return this.placement.updateFurnaces(dt); }

  // syncFurnaceLit（逻辑在 Placement，见 src/player/Placement.js）
  _syncFurnaceLit(key, st) { return this.placement.syncFurnaceLit(key, st); }

  // breakFurnace（逻辑在 Placement，见 src/player/Placement.js）
  _breakFurnace(block) { return this.placement.breakFurnace(block); }

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

  // F10：帧射线缓存——同一帧内眼位起点与视线方向只构建一次（updateRaycast/挖掘与攻击/右键交互共用）。
  // 令牌为 this.frame：跨帧必重建，不存在脏数据；返回对象是共享只读量，调用方一律不得改写
  // （改写会污染本帧后续使用者）；需要改方向的分支（射箭 multiplyScalar）自建局部向量。
  _frameRay() {
    if (this._rayFrame === this.frame && this._rayCache) return this._rayCache;
    this._rayFrame = this.frame;
    const cache = this._rayCache || (this._rayCache = { origin: new THREE.Vector3(), dir: new THREE.Vector3() });
    cache.origin.copy(this.player.position);
    cache.origin.y += PLAYER_EYE_HEIGHT;
    this.renderer.camera.getWorldDirection(cache.dir);
    return cache;
  }

  updateRaycast() {
    const { origin, dir } = this._frameRay(); // F10：本帧射线（与 handleMouseInput 共用同一份）

    const maxDist = this.player.creative ? 5 : 4.5;
    // 空桶对准流体：射线需命中水/岩浆（否则准星穿透无法舀取）
    const held = this.inventory.getSelected();
    const hit = this.raycast.cast(origin, dir, maxDist, !!held && held.name === 'bucket');
    this.selectedBlock = hit;

    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.block.x + BLOCK_CENTER, hit.block.y + BLOCK_CENTER, hit.block.z + BLOCK_CENTER);
    } else {
      this.highlight.visible = false;
      this.breakingProgress = 0;
    }

    // 计算准星目标 —— 方块与实体取较近者，用于 InfoBar 显示
    let blockDist = Infinity;
    if (hit) {
      const cx = hit.block.x + BLOCK_CENTER - origin.x;
      const cy = hit.block.y + BLOCK_CENTER - origin.y;
      const cz = hit.block.z + BLOCK_CENTER - origin.z;
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

  handleMouseInput(dt) { return this.interactionController.handleMouseInput(dt); }

  saveBlueprints() {
    if (this.networkMode || !this.blueprints) return false;
    return SaveSystem.save(this, this.currentSlot);
  }

  _finishBlueprintCapture() {
    const screen = this.blueprintScreen;
    if (!screen || screen.corners.length !== 2 || !this.world) return;
    const result = captureBlueprint(this.world, screen.corners[0], screen.corners[1], { id: this._newBlueprintId(), name: 'blueprint', byId: '' }); // 占位名，仅用于校验，真实名称在草稿面板里填
    if (!result.ok) {
      screen.captureMode = true;
      screen.visible = true;
      screen.el.style.display = 'flex';
      screen.render();
      const warning = result.reason === 'unloaded' ? '所选区域包含未加载区块，无法捕获。'
        : result.reason === 'size' ? '区域边长不能超过 32，体积不能超过 32768 格。'
          : result.reason === 'data' ? '蓝图数据超过 16 KB 上限。'
            : '数据格式无效。';
      screen.status && (screen.status.textContent = t('捕获失败：{reason}', { reason: t(warning) }));
      return;
    }
    screen.draftCorners = screen.corners.map((point) => ({ ...point }));
    screen.captureMode = false;
    screen.visible = true;
    screen.el.style.display = 'flex';
    screen.render();
  }

  _newBlueprintId() {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
    const bytes = new Uint8Array(10);
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('').slice(0, 16);
  }
  // 掷末影之眼：消耗 1 颗，发光小球朝最近环带锚点飞 2.5s 后落回（20% 碎裂，原版）
  _throwEnderEye() {
    this.projectiles.throwEnderEye();
  }

  // 末影之眼飞行步进：到时落地——80% 落回背包，20% 碎裂（原版概率）
  _updateEyeFlight(dt) {
    this.projectiles.updateEyeFlight(dt);
  }

  // 射箭：箭矢为本地投射物（几何/材质模块级共享），重力下坠、命中怪复用 attackMob 链
  // power = 初速系数（0.3~1 蓄力插值），dmg = 命中伤害（2~8 蓄力插值）；返回箭对象供联机上报
  _shootArrow(power = 1, dmg = 6) {
    return this.projectiles.shootArrow(power, dmg);
  }

  _ensureArrowAssets() {
    this.projectiles.ensureArrowAssets();
  }

  // Idea-2B：远端玩家射箭——本地生成纯视觉箭（dmg=0/remote=true：命中怪只消失不结算，
  // 伤害由射端经 mob_attack 权威上报；钉墙/寿命消失各端本地处理）
  spawnRemoteArrow(x, y, z, dx, dy, dz) {
    this.projectiles.spawnRemoteArrow(x, y, z, dx, dy, dz);
  }

  _cancelBowCharge() {
    this.projectiles.cancelBowCharge();
  }

  // 松手发射：charge→初速/伤害插值（vel=28×(0.3+0.7c)、dmg=2+round(6c)，即 8.4~28 m/s、2~8）
  _releaseBow() {
    this.projectiles.releaseBow();
  }

  _updateArrows(dt) {
    this.projectiles.updateArrows(dt);
  }

  _despawnArrow(i) {
    this.projectiles.despawnArrow(i);
  }

  // ── 凋灵之首弹射物（Idea-2D-②）────────────────────────────────
  // 各端本地积分、命中本地玩家本地结算（同怪咬人语义：怪物 host 权威生成后各端自模拟）；
  // 广播仅视觉同步（服务器 except 发起者转发）。直线微坠弹，命中附加凋零 II。

  _ensureWitherSkullAssets() {
    this.projectiles.ensureWitherSkullAssets();
  }

  // WitherAI 齐射回调：三发扇形（中央直射 + 左右 ±偏航），从胸前高度射出
  _spawnWitherSkullVolley(mob, player) {
    this.projectiles.spawnWitherSkullVolley(mob, player);
  }

  // 守誓巨像风弹齐射（批次 C）：三发扇形；裂心(wide)=五发宽扇（经 k:'gale' 复用 skull 通道）
  _spawnGaleVolley(mob, player, wide) {
    this.projectiles.spawnGaleVolley(mob, player, wide);
  }

  _spawnWitherSkull(pos, dir, kind = 'wither') {
    this.projectiles.spawnWitherSkull(pos, dir, kind);
  }

  // 联机：远端凋灵弹/风弹初速回执——本地生成弹射物（不再广播，防回声环）
  spawnRemoteWitherSkull(x, y, z, dx, dy, dz, kind) {
    this.projectiles.spawnRemoteWitherSkull(x, y, z, dx, dy, dz, kind);
  }

  _updateWitherSkulls(dt) {
    this.projectiles.updateWitherSkulls(dt);
  }

  _despawnWitherSkull(i) {
    this.projectiles.despawnWitherSkull(i);
  }

  // ── 天域终局 / 复潮域（逻辑在 AetherFinale，见 src/player/AetherFinale.js）──────
  // 域状态归属：演出窗口（原 this._finaleTide）随迁入控制器，Game 侧只保留只读访问器；
  // aetherDusk / finaleInfo / world.finalePrimordial / world.finaleDone / player.emblemWorn 留在原主。

  // colossusSlam（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  _colossusSlam(mob) { return this.aetherFinale.colossusSlam(mob); }

  // spawnRemoteColossusSlam（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  spawnRemoteColossusSlam(x, y, z) { return this.aetherFinale.spawnRemoteColossusSlam(x, y, z); }

  // applyColossusSlam（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  _applyColossusSlam(pos) { return this.aetherFinale.applyColossusSlam(pos); }

  // updateColossusAura（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  _updateColossusAura(dt) { return this.aetherFinale.updateColossusAura(dt); }

  // tryTideRitual（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  _tryTideRitual(block) { return this.aetherFinale.tryTideRitual(block); }

  // tryPrimordialOffering（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  _tryPrimordialOffering(block) { return this.aetherFinale.tryPrimordialOffering(block); }

  // tryListenTide（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  _tryListenTide(block) { return this.aetherFinale.tryListenTide(block); }

  // grantPrimordialEmblem（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  _grantPrimordialEmblem() { return this.aetherFinale.grantPrimordialEmblem(); }

  // startFinaleTide（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  _startFinaleTide(opts = {}) { return this.aetherFinale.startFinaleTide(opts); }

  // stopFinaleTide（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  _stopFinaleTide() { return this.aetherFinale.stopFinaleTide(); }

  // updateFinaleTide（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  _updateFinaleTide(dt) { return this.aetherFinale.updateFinaleTide(dt); }

  // finaleParticleTick（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  _finaleParticleTick(seg, p, t, dt) { return this.aetherFinale.finaleParticleTick(seg, p, t, dt); }

  // applyAetherDusk（逻辑在 AetherFinale，见 src/player/AetherFinale.js）
  applyAetherDusk(on) { return this.aetherFinale.applyAetherDusk(on); }

  // 四界同潮演出窗口只读探针（CommandPanel:291 的 game._finaleTide）：转发控制器，外部读取面不变
  get _finaleTide() { return this.aetherFinale.tide; }

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
    return this.summoning.trySummonIronGolem(x, y, z);
  }

  // Idea-2D-②：凋灵召唤检测——双结构：原版 T 型（柱底 1 + 沙排 3 + 头排 3，Build 8 起）
  // 与兼容平铺两层（沙排 4 + 头排 3，初版摆法）；原版 T 优先匹配。
  // 只在本地放置成功路径调用（同铁傀儡：远端 block_set 不检测，防多端重复召唤）；
  // 命中则移除 7 块（setBlock 自动广播账本）并就地召唤凋灵（联机经 mob_spawn 回执全端创建）。
  // 枚举：轴向 x/z × 头排起点 [-3,3]（宽枚举无害，校验保证正确性）。
  _trySummonWither(x, y, z) {
    // 头层由放置物决定 + 形状派发**刻意留在门面**：头颅是 B28 四朝向家族，判层必须按家族判
    //（tests/build28-block-textures.mjs:266-269 把这三行字面钉在 Game.js 上，整段搬走即红）。
    // 扫描与落地实现在 src/player/Summoning.js。
    if (!this.world || !this.mobManager) return false;
    const SAND = BlockRegistry.getId('soul_sand');
    const SKULL = BlockRegistry.getId('wither_skeleton_skull');
    if (!SAND || !SKULL) return false;
    const placed = this.world.getBlock(x, y, z);
    const isSkull = (id) => { const d = BlockRegistry.getById(id); return !!(d && d.baseBlock === 'wither_skeleton_skull'); }; // B28：头颅四朝向家族
    if (placed !== SAND && !isSkull(placed)) return false;
    const scan = (ty, shape) => this.summoning.scanWitherShape(x, y, z, ty, shape, SAND, isSkull);
    const hit = isSkull(placed)
      ? (scan(y, 't') || scan(y, 'flat'))
      : (scan(y + 2, 't') || scan(y + 1, 't') || scan(y + 1, 'flat'));
    return this.summoning.commitWitherSummon(hit);
  }

  // ── 信标（Idea-2D-③）：门面委托 Beacon（金字塔等级 / 效果脉冲 / 光柱）─────
  // 金字塔基座（铁/金/钻石/绿宝石块 1~4 层）激活；右键 BeaconScreen 选效果后
  // 每 4s 给范围内玩家刷新效果（12s 时长，金字塔等级决定强度与范围）。
  // 激活表 / 光柱表 / 脉冲计时随控制器持有；换世界仍由 _disposeWorld 清光柱。
  _getBeaconPower(x, y, z) { return this.beacon.getBeaconPower(x, y, z); }
  setBeaconEffect(x, y, z, name, level) { return this.beacon.setBeaconEffect(x, y, z, name, level); }
  _pulseBeacon(b, power) { return this.beacon.pulseBeacon(b, power); }
  _updateBeaconPulse(dt) { return this.beacon.updateBeaconPulse(dt); }
  _ensureBeaconBeam(key, x, y, z) { return this.beacon.ensureBeam(key, x, y, z); }
  _removeBeaconBeam(key) { return this.beacon.removeBeam(key); }
  _breakBeacon(x, y, z) { return this.beacon.breakBeacon(x, y, z); }
  _clearBeaconState() { return this.beacon.clearBeaconState(); }

  // ── 传送门域（轮 8 步 5）：门面委托 PortalSystem（点火 / 嵌眼 / 站门计时 / 到达落点 / 立地面）──
  // 穿越三件套 _portalTimer/_portalArmed/_portalCooldown 留在 Game（start() 里复位，本轮禁改区）；
  // portalOverlay 亦留在 Game（start 新建 / _disposeWorld 释放）。控制器一律调用点现取，不留构造期快照。
  // 打火石点火传送门：点击框体 → 内部候选格 = 点击面外邻格 → 框校验 → 填充门方块。
  // 返回 true 表示本次右键已被处理（无论点火成败——打火石无"生火"语义可回退）。
  _tryLightPortal(hit, targetDef) { return this.portalSystem.tryLightPortal(hit, targetDef); }

  // 末影之眼嵌入要塞传送门框架：无眼框→带眼框（消耗 1）；12 眼集齐→中心 3×3 填门体。
  // 返回 true 表示本次右键已被处理；非环位散框不消耗（原版语义）。
  _tryPlaceEndEye(hit, targetDef) { return this.portalSystem.tryPlaceEndEye(hit, targetDef); }

  // 传送门穿越检测：站入门方块累积 2s 触发（末地门即触）；到达后须离开门体才重新武装（防立即回传）
  updatePortals(dt) { return this.portalSystem.updatePortals(dt); }

  // 传送门环境粒子（M3）：从已加载区块的 portalCells 随机抽样发射（mesh build 时收集，与方块数据同步）。
  // 纯视觉客户端本地效果，不进存档/协议；密度随视频设置 densityScale 缩放。
  updatePortalParticles(dt) { return this.portalSystem.updatePortalParticles(dt); }

  // 传送门触发：目标维度 = 门种类配对的另一端
  //（下界 overworld↔nether 1:8 / 天域 overworld↔aether 1:1 / 末地 overworld↔end 落出生点）
  _usePortal(kind) { return this.portalSystem.usePortal(kind); }

  // 折跃门传送（末地同维）：不换维，账本扫描"角度最近"的配对门直达
  //（两端门角度一致由 gatewayPlacements 保证；armed/cooldown 防回弹由 updatePortals 统一处理）
  _useGatewayPortal() { return this.portalSystem.useGatewayPortal(); }

  // 传送门到达落地：有坐标落点 → 半径 24 搜既有同类门吸附、无门自动建返程门（原版语义）；
  // 无坐标落点（末地链）→ 仅落维度出生点（M3 起回程门由击败末影龙激活，到达不再自动建垫）
  _afterPortalArrival(arrival) { return this.portalSystem.afterPortalArrival(arrival); }

  // 末地出生点旁的回程门垫（龙败激活，原版喷泉基座造型）：
  // 16 格内已有 end_portal 则跳过（重连/多端幂等），否则在出生点偏移 ~5 格建造
  _ensureEndReturnPad() {
    this.endgame.ensureEndReturnPad();
  }

  // 出生点 16 格内是否已有激活回程门（_endPadExists 与 _ensureDragon 共用）
  _endPadExists() {
    return this.endgame.endPadExists();
  }

  // 末地开局生成末影龙（未击败时；单机/host 权威生成，联机经 mob_spawn 广播）
  // 击败判定：会话标记 OR 账本内已有回程门（跨会话/联机一致——门方块账本服务器权威持久化）
  _ensureDragon() {
    this.endgame.ensureDragon();
  }

  // 末影龙被击败：置标记 + 激活末地奖励（返回门喷泉 + 主岛缘/外岛缘折跃门阵列）
  // 各端独立触发（本地死亡链/远端同步入口）——建门幂等（账本已有即跳过），位置确定性保证一致
  _onDragonDefeated(mob) {
    this.endgame.onDragonDefeated(mob);
  }

  // 龙败奖励：① 出生点旁激活基岩喷泉返程门（踩上回主世界）
  //           ② 主岛缘 + 外岛缘折跃门阵列（角度配对，站入同维传送）
  //           ③ 龙蛋立于主岛中央（原版喷泉柱位；真实方块进账本可挖走）
  _activateEndRewards() {
    this.endgame.activateEndRewards();
  }

  // 龙蛋：主岛中心 (0,0) 从上往下扫首个实心格的顶面放置；幂等（已有方块跳过）
  _placeDragonEgg() {
    this.endgame.placeDragonEgg();
  }

  // 折跃门阵列（幂等：账本已有 end_gateway 即跳过）
  _ensureGateways() {
    this.endgame.ensureGateways();
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

  // facingTowardPlayer（逻辑在 Placement，见 src/player/Placement.js）
  _facingTowardPlayer(bx, bz) { return this.placement.facingTowardPlayer(bx, bz); }

  // facingAwayFromPlayer（逻辑在 Placement，见 src/player/Placement.js）
  _facingAwayFromPlayer(bx, bz) { return this.placement.facingAwayFromPlayer(bx, bz); }

  // 目标格是否与玩家 AABB 重叠（同放置主检查口径，供多格形制的第二格使用）
  _cellOverlapsPlayer(x, y, z) {
    const px = this.player.position.x, py = this.player.position.y, pz = this.player.position.z;
    return x >= Math.floor(px - 0.3) && x <= Math.floor(px + 0.3) &&
           y >= Math.floor(py) && y <= Math.floor(py + 1.8) &&
           z >= Math.floor(pz - 0.3) && z <= Math.floor(pz + 0.3);
  }

  // tryPlaceShaped（逻辑在 Placement，见 src/player/Placement.js）
  _tryPlaceShaped(x, y, z, blockDef) { return this.placement.tryPlaceShaped(x, y, z, blockDef); }

  // removeShapedPartner（逻辑在 Placement，见 src/player/Placement.js）
  _removeShapedPartner(def, x, y, z) { return this.placement.removeShapedPartner(def, x, y, z); }

  // clearIfFamily（逻辑在 Placement，见 src/player/Placement.js）
  _clearIfFamily(x, y, z, baseBlock) { return this.placement.clearIfFamily(x, y, z, baseBlock); }

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
          this.net.sendDropSpawn(x + BLOCK_CENTER, y + BLOCK_CENTER, z + BLOCK_CENTER, d.name, d.count);
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
    this.endgame.breakCrystal(x, y, z);
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
    p.set(tx + BLOCK_CENTER, y, tz + BLOCK_CENTER);
    this.player.velocity.set(0, 0, 0); // 传送落地速度清零（摔落伤害按落地速度计算）
    if (this.chatBox) this.chatBox.add(t('紫颂果把你拉向了虚空中的另一处……'), '#c8f');
  }

  // 传送门落点立足面预解析：临时生成器 + 临时区块探测（纯函数，不碰当前世界）；
  // 无立足面返回 -1（到达后由 buildReturnPortal 按维度档案垫平台）
  _resolveArrivalY(dim, x, z) { return this.portalSystem.resolveArrivalY(dim, x, z); }

  // 鞘翅滑翔折叠判定（每帧在移动分支之前调用）：没穿鞘翅 / 创造飞行 / 旁观 /
  // 在水中 / 已在地面 → 折叠。独立于气动结算——水中走游泳分支不进移动滑翔分支，
  // 若不在此处统一折叠，入水后 gliding 会残留 true。
  _updateGlideFold() {
    this.glideWind.updateGlideFold();
  }

  // 鞘翅滑翔气动结算（移动分支调用）：返回 true 表示本帧处于滑翔（移动分支不再
  // 覆写水平速度，动量得以保留）。展开条件：胸甲槽穿鞘翅 + 空中下落（落体展开）。
  // 气动模型（简化原版）：低头俯冲加速、抬头迎角升力翱翔、常驻水平阻尼。
  _updateGlideAero(dt) {
    return this.glideWind.updateGlideAero(dt);
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
        sp = { x: this.bedSpawn.x + BLOCK_CENTER, y: this.bedSpawn.y + 1, z: this.bedSpawn.z + BLOCK_CENTER };
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
      playerData.x = arrival.x + BLOCK_CENTER;
      playerData.z = arrival.z + BLOCK_CENTER;
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
      bedSpawn: this.bedSpawn ? { ...this.bedSpawn } : null,
      player: playerData,
      inventory: this.inventory.serialize(),
      dimensionBlocks: dimBuckets,
      dimensionContainers: contBuckets,
      dimensionFurnaces: furnBuckets,
      redstone: this.redstone ? this.redstone.serialize() : null,
      journal: this.journal ? this.journal.serialize() : null, // 游记跨维透传（换维重建不丢探索记录）
      waymarks: this.waymarks ? this.waymarks.serialize() : null, // 航标进度跨维透传（换维重建不丢）
      races: this.races ? this.races.serialize() : null, // 御风赛道与成绩跨维透传（换维重建不丢；进行中的尝试按规则取消）
      blueprints: this.blueprints ? this.blueprints.serializePersonal() : [],
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
    cam.position.y += PLAYER_EYE_HEIGHT; // 视点高度
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

  // 射线检测远端玩家（F6：球体判别式走共享纯函数 raySphereHit，半径 0.5），返回命中的 RemotePlayer 或 null；
  // 命中后仍按 1.8 身高区间过滤，并始终取最近者。
  _findRemoteByRay(origin, dir, maxDist) {
    let best = null, bestDist = maxDist;
    for (const rp of this.remotePlayers.values()) {
      if (rp.dead) continue;
      const c = rp.group.position;
      const t = raySphereHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, c.x, c.y, c.z, 0.5);
      if (t < 0 || t > bestDist) continue;
      const hy = origin.y + dir.y * t;
      if (hy < c.y || hy > c.y + 1.8) continue;
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
    // 终止潮汐时先完成可能的仪式奖励，再释放其世界对象。
    this._stopFinaleTide();
    // 清理旧世界 Three.js 资源和 UI DOM，防止回到菜单再进新存档时残留
    this._disposeWorld();
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
    // 联机：断开网络连接并复位联机状态
    if (this.net) this.net.close();
    this.networkMode = false;
    this.aetherDusk = false; // Build 20 ⑦：回菜单复位复潮状态（防跨存档残留；全局档案在下次进天域 start 时按存档重设）
    this.finaleInfo = null;
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
