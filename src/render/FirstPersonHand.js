// FirstPersonHand.js -- 第一人称手持物渲染（阶段10）
// 相机子节点：右下角基座 + 空手肤色手臂 + 手持物挂点；走路 bob + 挖掘/放置挥动动画。
// Build 21 M1：applySkin 后手臂贴皮肤右臂 UV（原版第一人称效果），未加载前保持肤色兜底。
// Build 41：手臂盒长轴改为 Y（与原版模型同构）+ 与第三人称同一套 FACE_MAP/setFaceUV 逐面写入，
//   再整体绕 X 转 90° 让手（bottom 面）落在远端——此前长轴是 Z 却按 Y 贴图，顶面"肩在前"、
//   侧面横截面被沿长度拉伸（用户报的"像用肩膀交互"）。
// Build 46：补第二层皮肤（袖子）——同一部件几何写 overlay UV 区域，外扩 (px+0.5)/px 作子节点，
//   透明像素靠 alphaTest 丢弃；参数与第三人称 overlay 壳共用 PlayerSkin.overlayScaleFactor。
import * as THREE from 'three';
import { buildHeldItemTemplate } from './HeldItemMesh.js';
import { loadActiveSkin, buildPartBox, partRects, overlayScaleFactor } from '../entity/PlayerSkin.js';
import { applyEntityLight } from './entityLight.js';
import { HandPose, HAND_BASE, HAND_BASE_ROT } from './fpHandPose.js';

// 手臂盒几何常量（Build 41 收敛，测试与实现同源）：宽=4px 臂宽、长=12px 臂长、厚=4px；
// 绕 X 转 90° 后长轴指向 -Z（手在远端），再叠 ARM_PITCH 抬角还原原有观感。
const ARM_W = 0.16;        // 4px（classic 臂宽）
const SLIM_ARM_W = 0.12;   // 3px（slim 臂宽）
const ARM_DEPTH = 0.16;    // 4px（臂厚，旋转后成为竖直方向）
const ARM_LEN = 0.42;      // 12px（臂长）
const ARM_PITCH = 0.55;    // 抬角（与原实现一致）

export class FirstPersonHand {
  constructor(game) {
    this.game = game;
    this.camera = game.renderer.camera;
    // camera 必须在场景中其子节点才会被渲染（此前场景图不含 camera）
    if (!this.camera.parent) game.renderer.scene.add(this.camera);

    this.group = new THREE.Group();
    // 右下角（B41：原 y=-0.38/z=-0.55 时手臂 95% 落在 75° 视锥外，只露一条边——
    // 用户看到的"肩膀"就是那条边。上抬并后移后手臂进入视野，观感与原版接近）
    this.basePos = new THREE.Vector3(HAND_BASE.x, HAND_BASE.y, HAND_BASE.z);
    this.group.position.copy(this.basePos);
    this.group.rotation.set(HAND_BASE_ROT.x, HAND_BASE_ROT.y, HAND_BASE_ROT.z);
    this.camera.add(this.group);

    // 空手手臂（肤色盒，从右下伸向前方）；尺寸与 applySkin 贴皮肤后保持一致（Build 22/41）
    // 长轴 = Y（0.42 臂长），绕 X 转 90° 后指向 -Z，手在远端
    this.armMesh = new THREE.Mesh(
      new THREE.BoxGeometry(ARM_W, ARM_LEN, ARM_DEPTH),
      new THREE.MeshLambertMaterial({ color: 0xe0b080 })
    );
    this.armMesh.position.set(0, -0.07, 0.30);
    this.armMesh.rotation.x = Math.PI / 2 + ARM_PITCH;
    this.group.add(this.armMesh);
    this.armOverlay = null; // B46：第二层皮肤（袖子）覆盖层，作为 armMesh 子节点随手臂运动

    // 手持物挂点（B41：挂到掌前——原 z=-0.10 在手掌外侧 0.2 格处，手臂可见后像"悬空举着"）
    this.itemGroup = new THREE.Group();
    this.itemGroup.position.set(0.02, 0.05, 0.12);
    this.itemGroup.rotation.set(0.15, Math.PI * 0.14, 0.1);
    this.group.add(this.itemGroup);

    this.currentName = undefined; // undefined=未初始化；null=空手
    this._buildSeq = 0;           // 异步构建序号（防旧结果覆盖新选择）
    this.pose = new HandPose();   // B44：姿态解算（bob/挥动/换手/落地/游泳/拉弓）
    this.bowDraw = null;          // Idea-2A：拉弓蓄力姿态（null=未拉弓；0..1=蓄力进度）
    this.visible = false;         // 默认隐藏（主菜单不显示第一人称手臂），Game.start 里 setVisible(true)
    this.group.visible = false;
    this.loadSkin(); // Build 21：异步贴皮肤右臂（失败保持肤色兜底）
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  // 阶段11：挖掘挥动周期（由 Game 按方块硬度/工具速度写入；纯解算在 HandPose 里）
  get miningPeriod() { return this.pose.miningPeriod; }
  set miningPeriod(v) { this.pose.miningPeriod = Number(v) || 0.3; }

  // Build 21 M1：按当前皮肤设置给手臂贴右臂 UV（原版第一人称效果，含内置默认皮肤）。
  // SkinScreen 保存后可重复调用（loadActiveSkin 读最新 prefs）。
  async loadSkin() {
    try {
      const { img, model } = await loadActiveSkin();
      this.applySkin(img, model);
    } catch (e) { /* 皮肤加载失败保持肤色兜底 */ }
  }

  applySkin(img, model = 'classic') {
    if (!this.armMesh) return;
    this._disposeArmOverlay(); // 旧袖子的壳/材质先摘掉（贴图在下方随旧材质一起释放）
    const tex = new THREE.CanvasTexture(img);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    // 第一人称手臂段：横截面 0.16×0.16（4px）、长 0.42（12px）；slim 臂宽 3px → 0.12。
    // 六面各取 armR 的对应区域（right/left/front/back/top/bottom），与第三人称完全同源。
    const w = model === 'slim' ? SLIM_ARM_W : ARM_W;
    const geo = buildPartBox('armR', model, { w, h: ARM_LEN, d: ARM_DEPTH });
    if (this.armMesh.material && this.armMesh.material.map) this.armMesh.material.map.dispose();
    if (this.armMesh.material) this.armMesh.material.dispose();
    this.armMesh.geometry.dispose();
    this.armMesh.geometry = geo;
    this.armMesh.material = new THREE.MeshLambertMaterial({ map: tex });
    this.armMesh.position.set(0, -0.07, 0.30);
    this.armMesh.rotation.x = Math.PI / 2 + ARM_PITCH;
    this._buildArmOverlay(tex, model, w); // B46：二层皮肤（无 overlay 内容的皮肤自动不可见）
  }

  // B46：第二层皮肤。几何与 base 同尺寸、只换 overlay UV 区域；外扩比例与第三人称共享。
  // 透明像素由 alphaTest 丢弃（皮肤 overlay 区大面积透明，不能用透明壳直接盖）。
  _buildArmOverlay(tex, model, w) {
    const geo = buildPartBox('armR', model, { w, h: ARM_LEN, d: ARM_DEPTH }, 'overlay');
    const mat = new THREE.MeshLambertMaterial({
      map: tex, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const d = partRects(model).armR.dims;
    mesh.scale.set(overlayScaleFactor(d.w), overlayScaleFactor(d.h), overlayScaleFactor(d.d));
    this.armMesh.add(mesh);
    this.armOverlay = mesh;
  }

  _disposeArmOverlay() {
    if (!this.armOverlay) return;
    if (this.armOverlay.parent) this.armOverlay.parent.remove(this.armOverlay);
    this.armOverlay.geometry.dispose();
    this.armOverlay.material.dispose();
    this.armOverlay = null;
  }

  // 弓蓄力姿态开关（Game 蓄力通道每帧写入；松手/取消传 null 复位）
  setBowDraw(v) {
    this.bowDraw = (v === null || v === undefined) ? null : Math.min(1, Math.max(0, v));
  }

  // 切换手持物（异步构建；重复调用以最后一次为准）
  async setItem(name) {
    if (name === this.currentName) return;
    this.currentName = name;
    this.pose.equip(); // B44：换手抬起动画
    const seq = ++this._buildSeq;
    this.itemGroup.clear(); // 模板几何/材质来自共享缓存，clone 不持有独立资源，无需 dispose
    this._syncArmVisible(); // B49：手持物品即藏空手臂（不等异步建模，切手当帧生效）
    if (!name) return;
    const tpl = await buildHeldItemTemplate(name);
    if (seq !== this._buildSeq) return; // 期间又切换了物品，丢弃旧结果
    if (tpl) {
      const m = tpl.clone();
      m.scale.set(0.20, 0.20, 0.20);
      this.itemGroup.add(m);
    } else {
      this.armMesh.visible = true; // 模板构建失败（未注册物品）：回退显示手臂，别让第一人称空成一片
    }
  }

  // B49：手持物品时隐藏空手臂——物品模型自己占位，手臂与方块/物品叠在一起会穿模；
  // 空手仍显示皮肤手臂。只切 armMesh.visible，袖子（armOverlay）是它的子节点随之隐藏。
  _syncArmVisible() {
    if (this.armMesh) this.armMesh.visible = !this.currentName;
  }

  // B49/阶段10：换存档复位手持内容——currentName 回到"未初始化"，下一帧由 Game 按快捷栏重新建模；
  // _buildSeq 自增丢弃上一存档在途的异步构建（否则旧世界的物品会被塞进新世界的手里）。
  resetForWorld() {
    this.currentName = undefined;
    this._buildSeq++;
    this.itemGroup.clear();
    this.armMesh.visible = true; // 待下一帧按实际手持物判定
  }

  // 触发一次挥动（放置/食用/命中等瞬时机点调用；按住左键的连续挖掘由 update 自动驱动）
  swing() {
    this.pose.swing();
  }

  // ctx: { moving, sprinting }（其余状态由本类直接读 game.player；B44 起新增跳跃/下落/游泳/换手/落地）
  update(dt, ctx = {}) {
    if (!this.visible) return;
    this._syncArmVisible(); // B49：每帧自愈（currentName 是唯一真相，别处改状态也不会漏）
    // Build 22：体素光染色——火把/荧石照亮第一人称手臂（按玩家眼睛所在格，与怪物同一公式）
    // B46：二层袖子共用同一套染色（两个材质各自快照基色）
    if (this.game.world && this.game.player) {
      applyEntityLight(this.game.world, this.game.sky, this.game.player.position, this.armMesh, this.armOverlay);
    }
    const p = this.game.player;
    const st = this.pose.update(dt, {
      moving: !!ctx.moving,
      sprinting: !!ctx.sprinting,
      onGround: p ? p.onGround : true,
      inWater: !!(p && p.bodyInWater),
      flying: !!(p && p.flying),
      vy: p ? p.velocity.y : 0,
      mining: this.game.controls.mouseLeft && !(this.game.inventoryScreen && this.game.inventoryScreen.visible),
      bobOn: !(this.game.settings && this.game.settings.viewBobbing === false),
      bowDraw: this.bowDraw,
    });
    this.group.position.set(st.x, st.y, st.z);
    this.group.rotation.set(st.rx, st.ry, st.rz);
  }
}
