// RemotePlayer.js -- 远端玩家实体：方块人模型 + 位置插值 + 昵称标签
// 阶段 3：昵称按玩家 id 着色；阶段 4：插值优化（关节模型 + 行走动画 + 头部俯仰 + 远距瞬移快照）
// 阶段 5：时间戳对齐插值——缓冲服务器带 ts 的状态样本，按"渲染时刻=本地时间+时钟偏移-延迟"线性插值，消除指数平滑的拖影
// 阶段 6：手持物品外观同步（右臂挂 sprite 渲染当前手持物）+ 插值延迟自适应（按缓冲头余量动态调延迟）
import * as THREE from 'three';
import { playerColorHue, playerColorCss } from '../net/playerColor.js';
import { targetInterpDelay } from '../net/netStats.js';
import { SVGTextures } from '../render/SVGTextures.js';
import { buildHeldItemTemplate } from '../render/HeldItemMesh.js';
import { RemoteHotbarSprite } from '../render/RemoteHotbarSprite.js';
import { applySkinToRig, loadImageFromURL, normalizeSkin } from './PlayerSkin.js';
import { applyEntityLight } from '../render/entityLight.js';

// 简化方块人部件（局部坐标原点在脚 y=0，单位：格；1px = 1/16 格）
// Build 21 M1：尺寸对齐原版（head 8³ / body 8×12×4 / arm 4×12×4 / leg 4×12×4 px），
// 关节 pivot 对齐原版（肩点/髋点比部件顶低 2px）；布局常量导出供 LocalPlayerModel 复用。
// slim（Alex 3px 臂）差异仅在双臂宽度，skin 应用时按 model 处理。
export function buildParts(model = 'classic') {
  const armW = model === 'slim' ? 3 / 16 : 4 / 16;
  const armIn = 0.25; // 臂内缘贴 body 侧（body 半宽 0.25），classic/slim 相同
  return [
    { box: [-0.25, 1.5, -0.25, 0.25, 2.0, 0.25], role: 'head', pivot: [0, 1.5, 0] },
    { box: [-0.25, 0.75, -0.125, 0.25, 1.5, 0.125], role: 'body' },
    { box: [armIn, 0.75, -0.125, armIn + armW, 1.5, 0.125], role: 'armR', pivot: [armIn + armW / 2, 1.375, 0] },
    { box: [-armIn - armW, 0.75, -0.125, -armIn, 1.5, 0.125], role: 'armL', pivot: [-armIn - armW / 2, 1.375, 0] },
    { box: [0, 0, -0.125, 0.25, 0.75, 0.125], role: 'legR', pivot: [0.125, 0.75, 0] },
    { box: [-0.25, 0, -0.125, 0, 0.75, 0.125], role: 'legL', pivot: [-0.125, 0.75, 0] },
  ];
}
export const PARTS = buildParts('classic');

// 远距瞬移阈值：插值目标距当前渲染位置超过该值视为传送，直接快照并丢弃旧样本
const SNAP_DIST = 4;

// 由玩家 id 派生稳定颜色（与聊天/昵称共用同一套色板，区分不同玩家）
function playerColor(id) {
  return new THREE.Color().setHSL(playerColorHue(id) / 360, 0.6, 0.45);
}

export class RemotePlayer {
  constructor(scene, id, name, pos, game = null) {
    this.id = id;
    this.name = name;
    this.game = game;         // 阶段6：用于取物品/方块 SVG 图渲染手持物
    this.dead = false;
    this.hitFlash = 0;
    const color = playerColor(id);

    this.group = new THREE.Group();
    this.parts = [];     // 普通 mesh 列表（渲染 / 受击红光）
    this.joints = {};    // role -> { pivot: Group, mesh: Mesh }
    this.partsByName = {}; // Build 21：全部件索引（body 无 pivot 不入 joints，皮肤双层需要）
    for (const def of PARTS) {
      const [minX, minY, minZ, maxX, maxY, maxZ] = def.box;
      const geo = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
      let c;
      if (def.role === 'head') c = 0xe0b080;
      else if (def.role === 'body') c = color;
      else if (def.role === 'leg') c = color.clone().multiplyScalar(0.75);
      else c = color.clone();
      const mat = new THREE.MeshLambertMaterial({ color: c });
      const mesh = new THREE.Mesh(geo, mat);

      if (def.pivot) {
        // 关节部件：mesh 相对 pivot 放置（原点在脚），旋转 pivot 实现肢体摆动
        const pivot = new THREE.Group();
        pivot.position.set(def.pivot[0], def.pivot[1], def.pivot[2]);
        mesh.position.set((minX + maxX) / 2 - def.pivot[0], (minY + maxY) / 2 - def.pivot[1], (minZ + maxZ) / 2 - def.pivot[2]);
        pivot.add(mesh);
        this.group.add(pivot);
        this.joints[def.role] = { pivot, mesh };
      } else {
        mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        this.group.add(mesh);
      }
      this.partsByName[def.role] = mesh;
      this.parts.push(mesh);
    }

    this.nameSprite = this._makeNameSprite(name);
    scene.add(this.nameSprite);
    scene.add(this.group);
    // 阶段11：头顶快捷栏 sprite（昵称上方；hotbar 数据经 applyFull/setHotbar 驱动）
    this.hotbarSprite = new RemoteHotbarSprite();
    scene.add(this.hotbarSprite.sprite);

    this.yaw = (pos && pos.yaw) || 0;
    this.pitch = (pos && pos.pitch) || 0;
    this._target = new THREE.Vector3(pos ? pos.x : 0, pos ? pos.y : 100, pos ? pos.z : 0);
    this._targetYaw = this.yaw;
    this._targetPitch = this.pitch;
    this.group.position.copy(this._target);
    this.nameSprite.position.set(this._target.x, this._target.y + 2.3, this._target.z);
    this.hotbarSprite.sprite.position.set(this._target.x, this._target.y + 2.62, this._target.z);
    this.flying = false;
    this.rttMs = null;        // B38 L1：该玩家自报的往返延迟（joinInfo 回放 / player_state.rtt）
    this.skinModel = 'classic'; // Build 21：几何默认按 classic 构建（skin 消息到达 slim 时重建双臂）
    this.inWater = false;
    this.onGround = false;
    // 阶段5 时间戳插值：状态样本缓冲 + 时钟偏移估计 + 插值延迟（阶段6 自适应）
    this._buffer = [];        // {ts, x,y,z,yaw,pitch,flying,inWater,onGround}，按 ts 升序
    this._clockOffset = 0;    // 服务器时钟 - 本地时钟（平滑估计，秒）
    this._interpDelay = 0.12; // 插值延迟（秒）：回放"延迟秒前"的状态，平滑网络抖动；阶段6 按缓冲头余量自适应
    // 阶段6/10 手持物品：右臂挂 3D 模型显示当前手持物 + 完整快捷栏快照
    this.heldItem = null;     // 当前手持物品名（null=空手）
    this.heldGroup = null;    // 手持物 3D 模型（挂在 armR pivot 下）
    this._heldSeq = 0;        // 异步重建手持模型的序号（防旧结果覆盖新）
    this.selectedSlot = 0;    // 阶段10：远端玩家当前选中的快捷栏槽位
    this.hotbar = null;       // 阶段10：远端玩家完整快捷栏快照（[{name,count}|null ×9] 或 null）
    // 行走动画状态：摆动相位 + 估算水平速度（由缓冲段位移算出）
    this._walkPhase = 0;
    this._speed = 0;
    // 阶段11：挖掘挥臂（player_state 的 mine 标志驱动，叠加在行走摆臂上）
    this.mining = false;
    this._minePhase = 0;
    this._mineAmp = 0; // 0..1 挥臂强度（进出挖掘状态平滑过渡，防关节跳变）
  }

  _makeNameSprite(name) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 24;
    const ctx = cv.getContext('2d');
    ctx.font = 'bold 14px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.strokeText(name, 64, 12);
    ctx.fillStyle = playerColorCss(this.id);
    ctx.fillText(name, 64, 12);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.6, 0.3, 1);
    sp.renderOrder = 999;
    return sp;
  }

  // B38 L1：远端玩家自报延迟（服务器只做钳制透传，不参与任何判定；null=尚未测得）
  setRtt(v) {
    if (typeof v === 'number' && v >= 0) this.rttMs = Math.min(9999, Math.round(v));
  }

  // 高频状态（位置/朝向/姿态）：压入带时间戳的样本缓冲（不直接驱动位置，由 update 插值回放）
  applyState(s) {
    const now = performance.now() / 1000;
    const hasTs = typeof s.ts === 'number' && s.ts > 0;
    const ts = hasTs ? s.ts / 1000 : now; // 服务器 ts 单位毫秒；无 ts（旧服务器）退化为本地到达时间
    if (hasTs) {
      // 平滑估计时钟偏移：offset = 服务器时钟 - 本地时钟
      const off = ts - now;
      if (this._clockOffset === 0) this._clockOffset = off;
      else this._clockOffset = this._clockOffset * 0.9 + off * 0.1;
    }
    this._buffer.push({
      ts,
      x: s.x, y: s.y, z: s.z,
      yaw: s.yaw || 0, pitch: s.pitch || 0,
      flying: !!s.flying, inWater: !!s.inWater, onGround: !!s.onGround,
    });
    if (this._buffer.length > 40) this._buffer.shift();
    // 阶段6/10：手持物品变化时更新右臂挂载的 3D 模型；selected 槽位随状态更新
    if (typeof s.selected === 'number') {
      this.selectedSlot = s.selected;
      this._refreshHotbarSprite(); // 滚轮切槽 20Hz 高频：sprite 内部签名比较挡掉无效重绘
    }
    if (typeof s.held === 'string' && s.held !== this.heldItem) this._setHeld(s.held);
    this.mining = !!s.mine; // 阶段11：远端挖掘标志
    if (typeof s.rtt === 'number') this.setRtt(s.rtt); // B38 L1
  }

  applyFull(s) {
    if (s.mode) this.setMode(s.mode);
    if (typeof s.rtt === 'number') this.setRtt(s.rtt); // B38 L1：进房回放带的延迟
    // 阶段10：完整快捷栏 + 选中槽位（joinRoom 回放 / player_full 广播）
    if (typeof s.selected === 'number') this.selectedSlot = s.selected;
    if (Array.isArray(s.hotbar)) this.hotbar = s.hotbar;
    if (typeof s.held === 'string') {
      if (s.held !== this.heldItem) this._setHeld(s.held);
    } else if (this.hotbar && this.hotbar[this.selectedSlot] && this.hotbar[this.selectedSlot].name) {
      // 消息未带 held 时用 快捷栏[选中槽位] 推导（joinRoom 回放兼容）
      const name = this.hotbar[this.selectedSlot].name;
      if (name !== this.heldItem) this._setHeld(name);
    }
    this._refreshHotbarSprite();
  }

  // 阶段11：头顶快捷栏重绘（内部签名比较，内容未变只做字符串比较零重绘）
  _refreshHotbarSprite() {
    if (this.hotbarSprite) this.hotbarSprite.setHotbar(this.hotbar, this.selectedSlot);
  }

  // 阶段6→10：更新手持物品并异步重建右臂挂载的 3D 模型（带序号防竞态）
  // 模型由 HeldItemMesh 共享缓存构建（方块=六面贴图立方体 / 物品=双面薄片），随摆臂关节运动
  async _setHeld(name) {
    this.heldItem = name || null;
    const seq = ++this._heldSeq;
    if (this.heldGroup) {
      if (this.heldGroup.parent) this.heldGroup.parent.remove(this.heldGroup);
      this.heldGroup = null;
    }
    if (!this.heldItem) return;
    const tpl = await buildHeldItemTemplate(this.heldItem);
    if (seq !== this._heldSeq) return; // 期间已换成别的物品，丢弃旧结果
    if (!tpl) return;
    const g = tpl.clone();
    g.scale.set(0.26, 0.26, 0.26);
    // Build 21 修复 B：原 z=+0.22 挂在模型背后侧（面朝 -Z），移到掌前（-Z 方向）
    g.position.set(0, -0.85, -0.28);
    g.rotation.set(-0.5, 0.35, 0.15);  // 斜握姿态
    const arm = this.joints.armR;
    if (arm) { arm.pivot.add(g); this.heldGroup = g; }
  }

  setMode(mode) { this.flying = mode === 'spectator'; }

  // Build 21：应用皮肤（img 须为已归一化 64×64 HTMLImageElement；model: 'classic'|'slim'）。
  // 模型档位变化（classic↔slim）时先重建双臂几何（臂宽/pivot 不同），再贴双层纹理。
  applySkinFromImage(img, model = 'classic') {
    if (this.skinModel !== model) this.rebuildArmsForModel(model);
    if (this._skinHandle) { this._skinHandle.dispose(); this._skinHandle = null; }
    this._skinHandle = applySkinToRig(this, img, model);
    this.skinModel = model;
  }

  // Build 21 M2：按模型档位重建双臂（slim 臂宽 3px、肩点内移；仅 x 维度变化，y/z 不变）。
  // heldGroup 挂在 armR.pivot 下，pivot 平移会带着手持物一起动，无需重挂。
  rebuildArmsForModel(model) {
    const armW = model === 'slim' ? 3 / 16 : 4 / 16;
    const armIn = 0.25;
    for (const [role, sgn] of [['armR', 1], ['armL', -1]]) {
      const joint = this.joints[role];
      if (!joint) continue;
      const minX = sgn > 0 ? armIn : -armIn - armW;
      const maxX = sgn > 0 ? armIn + armW : -armIn;
      const pivotX = sgn * (armIn + armW / 2);
      joint.pivot.position.x = pivotX;
      const old = joint.mesh;
      old.geometry.dispose();
      old.geometry = new THREE.BoxGeometry(armW, 0.75, 0.25);
      old.position.set(0, -0.25, 0); // 臂中心在 pivot 正下 0.25（y 0.75..1.5，pivot y=1.375）
    }
  }

  // Build 21 M2：从 URL/dataURL 加载并应用皮肤（联机 skin_set 消息的 data 为 dataURL）
  async applySkinFromURL(url, model = 'classic') {
    try {
      const img = await loadImageFromURL(url);
      this.applySkinFromImage(normalizeSkin(img), model);
    } catch (e) { /* 皮肤加载失败保持纯色兜底 */ }
  }

  playHit() { this.hitFlash = 0.2; }

  playDeath() {
    this.dead = true;
    this.group.visible = false;
    if (this.nameSprite) this.nameSprite.visible = false;
  }

  respawn(s) {
    this.dead = false;
    this.group.visible = true;
    if (this.nameSprite) this.nameSprite.visible = true;
    this._buffer.length = 0; // 重生=瞬移，丢弃旧样本避免轨迹回拉
    this.mining = false; this._mineAmp = 0; this._minePhase = 0; // 阶段11：复位挖掘挥臂
    this._target.set(s.x, s.y, s.z);
    this._targetYaw = s.yaw || this.yaw;
    this._targetPitch = s.pitch || this.pitch;
    this.group.position.copy(this._target);
    this.yaw = this._targetYaw;
    this.pitch = this._targetPitch;
  }

  update(dt) {
    // Build 22：体素光染色——火把/荧石照亮远端玩家本体（base+overlay，与怪物同一公式）。
    // 受击红光帧跳过（emissive 让位红光通道；红光结束的下一帧由本调用重写火光辉光）
    if (this.hitFlash <= 0 && this.game && this.game.world) {
      applyEntityLight(this.game.world, this.game.sky, this.group.position, this.parts, this.overlayMeshes);
    }

    // 受击红光（per-player 材质 emissive）
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      for (const m of this.parts) {
        m.material.emissive.setRGB(0.8, 0.05, 0.05);
        m.material.emissiveIntensity = Math.max(0, this.hitFlash / 0.2) * 0.8;
      }
    }

    // 阶段5 时间戳对齐插值：从缓冲找包围"渲染时刻"的两个样本，线性插值出目标位姿
    const buf = this._buffer;
    if (buf.length) {
      const now = performance.now() / 1000;
      const renderTime = now + this._clockOffset - this._interpDelay;
      // 裁剪过旧的样本（至少保留两个作边界），避免缓冲无限增长
      while (buf.length > 2 && buf[1].ts < renderTime - 0.5) buf.shift();
      let a = buf[0], b = buf[buf.length - 1];
      if (buf.length >= 2) {
        // 找 renderTime 落在 [a.ts, b.ts] 的那一对；i 最多到 len-2，保证 b 恒有定义
        // （renderTime 晚于最新样本时停在最后两样本，f 被钳到 1 = 停在最新位置）
        let i = 0;
        const maxI = buf.length - 2;
        while (i < maxI && buf[i + 1].ts < renderTime) i++;
        a = buf[i]; b = buf[i + 1];
      }
      const span = b.ts - a.ts;
      let f = span > 0 ? (renderTime - a.ts) / span : 0;
      f = Math.max(0, Math.min(1, f));
      this._target.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
      // yaw 最短角插值
      let dy = b.yaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this._targetYaw = a.yaw + dy * f;
      this._targetPitch = a.pitch + (b.pitch - a.pitch) * f;
      // 移动速度（当前段位移/时间）驱动走路动画；缓冲耗尽时自然归 0（静止停靠）
      this._speed = span > 0.001 ? Math.hypot(b.x - a.x, b.z - a.z) / span : 0;
      this.flying = b.flying; this.inWater = b.inWater; this.onGround = b.onGround;

      // 阶段6/10 自适应插值延迟：
      // ① RTT 直测可用（应用层 ping/pong 平滑值）→ 以 RTT 为主信号：目标延迟 ≈ 单向延迟(RTT/2) + 状态包缓冲
      // ② 阶段11：叠加抖动吸收项（jitter/4000，抖动大 → 延迟略增），经 netStats.targetInterpDelay 统一计算
      // ③ 头余量仅作欠载保护（渲染时刻逼近最新样本时加大延迟吸收抖动）
      const net = this.game && this.game.net ? this.game.net : null;
      const rttS = net && typeof net.rttMs === 'number' ? net.rttMs : null;
      if (rttS != null) {
        const jitterS = net && typeof net.rttJitterMs === 'number' ? net.rttJitterMs : 0;
        const target = targetInterpDelay(rttS, jitterS);
        this._interpDelay += (target - this._interpDelay) * Math.min(1, dt * 0.5); // 平滑靠拢，RTT 突变不猛拉
      }
      const headroom = buf[buf.length - 1].ts - renderTime;
      if (headroom < 0.03) this._interpDelay = Math.min(0.4, this._interpDelay + 0.004);
      else if (headroom > 0.22 && rttS == null) this._interpDelay = Math.max(0.05, this._interpDelay - 0.002);
    }

    // 落位：传送（respawn/远距移动）直接快照并丢弃旧样本，否则置于插值目标
    if (this.group.position.distanceTo(this._target) > SNAP_DIST) {
      this._buffer.length = 0;
    }
    this.group.position.copy(this._target);
    this.yaw = this._targetYaw;
    this.pitch = this._targetPitch;
    this.group.rotation.y = this.yaw;

    // 头部俯仰（绕颈部 pivot）。Build 21 修复 A：原为 -pitch——抬头时模型反向低头，
    // 翻正符号（pitch 正=抬头 → 头顶向后仰）
    if (this.joints.head) {
      this.joints.head.pivot.rotation.x = this.pitch;
    }

    // 行走摆动动画：水平速度驱动腿/手臂相位，飞行/水中/静止不摆动
    const moving = this._speed > 0.6 && !this.flying;
    if (moving) {
      this._walkPhase += dt * (4 + Math.min(8, this._speed * 0.8));
    } else {
      this._walkPhase += dt * 2; // 缓慢归位
    }
    const swing = moving ? Math.min(0.9, this._speed * 0.09) : 0;
    const s = Math.sin(this._walkPhase) * swing;
    const s2 = Math.sin(this._walkPhase + Math.PI) * swing;
    if (this.joints.armL) this.joints.armL.pivot.rotation.x = s;
    // 阶段11：挖掘挥臂——右臂在行走摆臂之上叠加固定节奏（~0.3s）的敲击动作，飞行时不挥
    const mineTarget = (this.mining && !this.flying) ? 1 : 0;
    this._mineAmp += (mineTarget - this._mineAmp) * Math.min(1, dt * 10);
    if (this._mineAmp > 0.01) {
      this._minePhase += dt * 21; // 2π/21 ≈ 0.3s 一个敲击周期
      if (this._minePhase > Math.PI * 2) this._minePhase -= Math.PI * 2;
    }
    const mineSw = Math.sin(this._minePhase) * 0.8 * this._mineAmp;
    if (this.joints.armR) this.joints.armR.pivot.rotation.x = s2 - mineSw;
    if (this.joints.legL) this.joints.legL.pivot.rotation.x = s2;
    if (this.joints.legR) this.joints.legR.pivot.rotation.x = s;

    // 昵称标签跟随（阶段11：头顶快捷栏 sprite 一并跟随）
    if (this.nameSprite) {
      this.nameSprite.position.set(this.group.position.x, this.group.position.y + 2.3, this.group.position.z);
    }
    if (this.hotbarSprite) {
      this.hotbarSprite.sprite.position.set(this.group.position.x, this.group.position.y + 2.62, this.group.position.z);
      this.hotbarSprite.setVisible(!this.dead); // 死亡隐藏（内部再按"有物品"过滤）
    }
  }

  dispose() {
    if (this._skinHandle) { this._skinHandle.dispose(); this._skinHandle = null; }
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const m of this.parts) { m.geometry.dispose(); m.material.dispose(); }
    this.parts = [];
    this.joints = {};
    // 阶段10：释放手持物 3D 模型（几何/材质来自共享缓存，无需 dispose）
    if (this.heldGroup) {
      if (this.heldGroup.parent) this.heldGroup.parent.remove(this.heldGroup);
      this.heldGroup = null;
    }
    if (this.nameSprite) {
      if (this.nameSprite.parent) this.nameSprite.parent.remove(this.nameSprite);
      if (this.nameSprite.material) {
        if (this.nameSprite.material.map) this.nameSprite.material.map.dispose();
        this.nameSprite.material.dispose();
      }
      this.nameSprite = null;
    }
    // 阶段11：释放头顶快捷栏 sprite（texture/material 每实例独享，必须 dispose）
    if (this.hotbarSprite) {
      this.hotbarSprite.dispose();
      this.hotbarSprite = null;
    }
  }
}
