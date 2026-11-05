// LocalPlayerModel.js -- 本地玩家第三人称模型（Build 20 ⑤ 引入；Build 21 M1 原版 skin 化）
// F5 视角切换到第三人称时渲染本地玩家（关节方块人，布局与 RemotePlayer 同源 buildParts）：
// 直接驱动（零插值延迟），行走摆臂 + 挖掘挥臂 + 头部俯仰 + 右手持物。
// Build 21：部件尺寸对齐原版（classic/slim 双模型，按皮肤设置构造）；异步加载皮肤
//（默认内置 PNG / 本地上传，见 PlayerSkin）双层应用；颜色兜底：皮肤未加载前仍用
// playerColor 派生纯色（联机用自己的玩家 id，单机固定 id=1）。
import * as THREE from 'three';
import { buildParts } from './RemotePlayer.js';
import { playerColorHue } from '../net/playerColor.js';
import { buildHeldItemTemplate } from '../render/HeldItemMesh.js';
import { applySkinToRig, loadActiveSkin, SKIN_STORAGE_KEY } from './PlayerSkin.js';
import { applyEntityLight } from '../render/entityLight.js';
import { HumanoidAnimator, applyHumanoidPose, applyBodyOffset } from './anim/HumanoidAnimator.js';

export class LocalPlayerModel {
  constructor(scene, game) {
    this.game = game;
    this.scene = scene;
    const id = (game.net && game.net.selfId != null) ? game.net.selfId : 1;
    const color = new THREE.Color().setHSL(playerColorHue(id) / 360, 0.6, 0.45);
    this.color = color;
    // Build 21：皮肤模型（classic/slim）在构造期确定——部件几何宽度直接按模型生成
    this.skinModel = (typeof localStorage !== 'undefined' && getPrefsModel()) || 'classic';
    this._skinHandle = null;      // 当前皮肤纹理句柄（换肤先释放）
    this._skinSeq = 0;            // 异步加载序号（防旧结果覆盖新）

    this.group = new THREE.Group();
    this.bodyRoot = null; // B44：躯干中间节点（bob/前倾/侧倾），_buildRig 内创建
    this.parts = [];
    this.joints = {};
    this.partsByName = {}; // Build 21：全部件索引（body 无 pivot 不入 joints，皮肤双层需要）
    this.group.visible = false; // 第一人称默认隐藏
    scene.add(this.group);
    this._buildRig(this.skinModel);
    this.loadSkin(); // 异步加载皮肤（失败保持纯色兜底）

    // B44：动作器（与远端玩家共用同一套；本地直读玩家状态，零插值延迟）
    this.animator = new HumanoidAnimator();
    // 手持物（右臂挂 3D 模型，随物品切换异步重建）
    this.heldItem = undefined; // undefined=未初始化；null=空手
    this.heldGroup = null;
    this._heldSeq = 0;
  }

  // Build 21：皮肤设置变更（SkinScreen 保存）后调用——按最新 prefs 重建部件与纹理
  refreshSkin() {
    const model = (typeof localStorage !== 'undefined' && getPrefsModel()) || 'classic';
    if (model === this.skinModel && this._skinHandle) {
      // 仅数据变了（换图/上传）：重贴纹理即可
      this.loadSkin();
      return;
    }
    this.skinModel = model;
    const visible = this.group.visible;
    if (this._skinHandle) { this._skinHandle.dispose(); this._skinHandle = null; }
    if (this.heldGroup) { if (this.heldGroup.parent) this.heldGroup.parent.remove(this.heldGroup); this.heldGroup = null; }
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const m of this.parts) { m.geometry.dispose(); m.material.dispose(); }
    for (const child of [...this.group.children]) this.group.remove(child);
    this.parts = [];
    this.joints = {};
    this.partsByName = {};
    this._buildRig(model);
    this.group.visible = visible;
    this.scene.add(this.group);
    this.loadSkin();
    this.heldItem = undefined; // 手持物模型按新臂几何重建
  }

  // 按 model 档位构建全部部件（构造/refreshSkin 共用）
  _buildRig(model) {
    const color = this.color;
    this.bodyRoot = new THREE.Group();
    this.group.add(this.bodyRoot);
    for (const def of buildParts(model)) {
      const [minX, minY, minZ, maxX, maxY, maxZ] = def.box;
      const geo = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
      let c;
      if (def.role === 'head') c = 0xe0b080;
      else if (def.role === 'body') c = color;
      else c = color.clone();
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: c }));
      if (def.pivot) {
        const pivot = new THREE.Group();
        pivot.position.set(def.pivot[0], def.pivot[1], def.pivot[2]);
        mesh.position.set((minX + maxX) / 2 - def.pivot[0], (minY + maxY) / 2 - def.pivot[1], (minZ + maxZ) / 2 - def.pivot[2]);
        pivot.add(mesh);
        this.bodyRoot.add(pivot);
        this.joints[def.role] = { pivot, mesh };
      } else {
        mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        this.bodyRoot.add(mesh);
      }
      this.partsByName[def.role] = mesh;
      this.parts.push(mesh);
    }
  }

  // Build 21：按 prefs 加载皮肤并双层应用（异步；序号防竞态）
  async loadSkin() {
    const seq = ++this._skinSeq;
    try {
      const { img, model } = await loadActiveSkin();
      if (seq !== this._skinSeq) return; // 期间已刷新，丢弃旧结果
      if (this._skinHandle) { this._skinHandle.dispose(); this._skinHandle = null; }
      this._skinHandle = applySkinToRig(this, img, model);
      this.skinModel = model;
    } catch (e) { /* 皮肤加载失败保持纯色兜底 */ }
  }

  // Game.update 每帧调用；visible 由 Game 按视角模式/观战/死亡决定
  update(dt, player, visible, mining) {
    this.group.visible = !!visible;
    // B44：动作器始终推进（隐藏期间也保持相位/权重连续），切回第三人称时不从陈旧姿态起跳
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const pose = this.animator.update(dt, {
      speed,
      vy: player.velocity.y,
      sprinting: !!(this.game.controls && this.game.controls.isSprinting()),
      onGround: player.onGround,
      inWater: !!player.bodyInWater,
      flying: player.flying,
      mine: mining,
    });
    if (!this.group.visible) return;
    this.group.position.copy(player.position);
    this.group.rotation.y = player.yaw;
    // Build 22：体素光染色——火把/荧石照亮玩家本体（base+overlay，与怪物同一公式）
    if (this.game.world) {
      applyEntityLight(this.game.world, this.game.sky, this.group.position, this.parts, this.overlayMeshes);
    }
    applyHumanoidPose(this.joints, pose, player.pitch);
    applyBodyOffset(this.bodyRoot, pose);

    // 手持物同步（物品变化时重建）
    const sel = this.game.inventory ? this.game.inventory.getSelected() : null;
    const name = sel ? sel.name : null;
    if (name !== this.heldItem) this._setHeld(name);
  }

  // 与 RemotePlayer._setHeld 同款：右臂末端挂 3D 模型（共享缓存构建）。
  // Build 21 修复 B：挂点从背后侧（z=+0.22）移到掌前（-Z）。
  async _setHeld(name) {
    this.heldItem = name || null;
    const seq = ++this._heldSeq;
    if (this.heldGroup) {
      if (this.heldGroup.parent) this.heldGroup.parent.remove(this.heldGroup);
      this.heldGroup = null;
    }
    if (!this.heldItem) return;
    const tpl = await buildHeldItemTemplate(this.heldItem);
    if (seq !== this._heldSeq) return;
    if (!tpl) return;
    const g = tpl.clone();
    g.scale.set(0.26, 0.26, 0.26);
    g.position.set(0, -0.85, -0.28);
    g.rotation.set(-0.5, 0.35, 0.15);
    const arm = this.joints.armR;
    if (arm) { arm.pivot.add(g); this.heldGroup = g; }
  }

  dispose() {
    this._skinSeq++;
    if (this._skinHandle) { this._skinHandle.dispose(); this._skinHandle = null; }
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const m of this.parts) { m.geometry.dispose(); m.material.dispose(); }
    this.parts = [];
    this.joints = {};
    if (this.heldGroup) {
      if (this.heldGroup.parent) this.heldGroup.parent.remove(this.heldGroup);
      this.heldGroup = null;
    }
  }
}

// 延迟引入避免顶层 localStorage 访问（node import 安全）；键名与 PlayerSkin 常量同源
function getPrefsModel() {
  try {
    const raw = localStorage.getItem(SKIN_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && (p.model === 'slim' || p.model === 'classic')) return p.model;
    }
  } catch (e) { /* 忽略 */ }
  return 'classic';
}
