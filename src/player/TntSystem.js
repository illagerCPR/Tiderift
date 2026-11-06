// TntSystem.js -- B48 TNT：点燃态方块 + 引信表 + 爆炸结算（方块/玩家/怪物）
// 设计要点（与联机口径绑定，改前必读）：
//   ① 点燃 = 方块换成 tnt_primed（走既有 block_set 同步），引信是各端本地状态——
//      不新增协议消息、不升 PROTOCOL_VERSION；点燃态写方块用 recordMod=false（不落存档）。
//   ② 引信 4 秒按 dt 推进（帧率无关）；方块被挖/被替换 → 取消；区块未加载 → 冻结不推进。
//   ③ 爆炸的方块改动（几百条）在 world._batchBlockWrites 期间交付，由 NetworkManager
//      汇进既有 BLOCK_SET_BATCH 合批（避开 rateLimits.block=900/min）。
import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { CHUNK_SIZE } from '../core/Chunk.js';
import {
  TNT_RADIUS, blastDamage, blastKnockback, blastDir, inBlastSphere, isBlastProof,
} from '../core/Explosion.js';
import { BLOCK_CENTER } from './constants.js';
import { audio } from '../audio/AudioEngine.js';

export const FUSE_TIME = 4.0;        // 引信时长（秒）= 原版 80 tick
export const CHAIN_DELAY_MIN = 0.3;  // 连锁点燃延迟区间（错峰，避免同帧一起炸）
export const CHAIN_DELAY_MAX = 0.8;
const MAX_DEBRIS_BLOCKS = 10;        // 逐块碎屑上限（其余只清方块，防粒子池被打满）

export class TntSystem {
  constructor(game) {
    this.game = game;
    this.fuses = new Map();     // "x,y,z" -> 已燃烧秒数
    this.overlays = new Map();  // "x,y,z" -> 引信白光罩（可视层，见 _syncOverlay）
    this._balls = [];           // 火球 sprite（爆炸表现，存活期 0.3s）
    this._ballTex = null;       // 火球径向渐变纹理（懒建一次复用）
    this._geo = null;           // 共享立方几何（首个引信时懒建）
  }

  key(x, y, z) { return `${x},${y},${z}`; }

  // 点燃：tnt → tnt_primed。已点燃返回 true 且**不重置引信**（红石每帧重算 / 连锁重复都幂等）。
  prime(x, y, z, elapsed = 0) {
    const g = this.game;
    if (!g || !g.world) return false;
    const def = BlockRegistry.getById(g.world.getBlock(x, y, z));
    if (!def) return false;
    if (def.name === 'tnt_primed') return true;
    if (def.name !== 'tnt') return false;
    const primed = BlockRegistry.getId('tnt_primed');
    if (!primed) return false;
    g.world.setBlock(x, y, z, primed, false); // 点燃态不入存档账本（读档不留半炸的引信）
    this.fuses.set(this.key(x, y, z), Math.max(0, Math.min(FUSE_TIME, elapsed)));
    this._syncOverlay(x, y, z);
    return true;
  }

  // 取消（方块被挖/被替换/引信失效）：只清本地状态与可视层
  cancel(x, y, z) {
    this.fuses.delete(this.key(x, y, z));
    this._dropOverlay(x, y, z);
  }

  has(x, y, z) { return this.fuses.has(this.key(x, y, z)); }
  remaining(x, y, z) {
    const t = this.fuses.get(this.key(x, y, z));
    return t == null ? 0 : Math.max(0, FUSE_TIME - t);
  }

  // 远端方块落地（NetworkManager.applyRemoteBlock 调用）：点燃态登记引信，其它状态取消
  onRemoteBlockChange(x, y, z, id) {
    const def = BlockRegistry.getById(id);
    if (def && def.name === 'tnt_primed') {
      if (!this.fuses.has(this.key(x, y, z))) {
        this.fuses.set(this.key(x, y, z), 0);
        this._syncOverlay(x, y, z);
      }
    } else {
      this.cancel(x, y, z);
    }
  }

  update(dt) {
    this._updateBalls(dt);
    if (this.fuses.size === 0) return;
    const g = this.game;
    const world = g && g.world;
    if (!world) return;
    // 快照本轮要推进的键：连锁点燃会在爆炸里新增引信，新点燃的不该在同一帧就吃掉整帧 dt
    // （大 dt 下会让刚点着的 TNT 立刻爆炸）
    const keys = [...this.fuses.keys()];
    for (const k of keys) {
      const t = this.fuses.get(k);
      if (t == null) continue;
      const [x, y, z] = k.split(',').map(Number);
      // 区块未加载：冻结（不推进也不取消），卸载期间等同于"暂停燃烧"
      if (!world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))) continue;
      const def = BlockRegistry.getById(world.getBlock(x, y, z));
      if (!def || def.name !== 'tnt_primed') { this.cancel(x, y, z); continue; }
      const nt = t + dt;
      if (nt >= FUSE_TIME) this.explode(x, y, z);
      else { this.fuses.set(k, nt); this._syncOverlay(x, y, z, nt); }
    }
  }

  // 爆炸结算：方块破坏 → 连锁点燃 → 玩家伤害/击退 → 怪物伤害/击退 → 表现
  explode(x, y, z) {
    const g = this.game;
    this.fuses.delete(this.key(x, y, z));
    this._dropOverlay(x, y, z);
    if (!g || !g.world) return;
    const world = g.world;
    const cx = x + BLOCK_CENTER, cy = y + BLOCK_CENTER, cz = z + BLOCK_CENTER;
    const R = TNT_RADIUS;
    let debris = 0;

    // ① 方块破坏 + 连锁点燃（批量写：几百条改动合成一条 BLOCK_SET_BATCH）
    world._batchBlockWrites = true;
    try {
      if (BlockRegistry.getById(world.getBlock(x, y, z))?.name === 'tnt_primed') world.setBlock(x, y, z, 0);
      for (let dx = -R; dx <= R; dx++) {
        for (let dy = -R; dy <= R; dy++) {
          for (let dz = -R; dz <= R; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            if (!inBlastSphere(dx, dy, dz, R)) continue;
            const bx = x + dx, by = y + dy, bz = z + dz;
            const id = world.getBlock(bx, by, bz);
            if (id === 0) continue;
            const def = BlockRegistry.getById(id);
            if (!def) continue;
            // 连锁：未点燃的 TNT 直接点着（错峰），已点燃的只提前、不重置
            if (def.name === 'tnt') {
              const delay = CHAIN_DELAY_MIN + Math.random() * (CHAIN_DELAY_MAX - CHAIN_DELAY_MIN);
              this.prime(bx, by, bz, FUSE_TIME - delay);
              continue;
            }
            if (def.name === 'tnt_primed') {
              const k = this.key(bx, by, bz);
              const cur = this.fuses.get(k);
              const delay = CHAIN_DELAY_MIN + Math.random() * (CHAIN_DELAY_MAX - CHAIN_DELAY_MIN);
              if (cur != null && FUSE_TIME - cur > delay) {
                this.fuses.set(k, FUSE_TIME - delay);
                this._syncOverlay(bx, by, bz, FUSE_TIME - delay);
              }
              continue;
            }
            if (isBlastProof(def)) continue; // 基岩 / 黑曜石
            world.setBlock(bx, by, bz, 0);
            if (debris < MAX_DEBRIS_BLOCKS && g.particles) {
              g.particles.burstBlockBreak(bx + BLOCK_CENTER, by, bz + BLOCK_CENTER, def, world, 4);
              debris++;
            }
          }
        }
      }
    } finally {
      world._batchBlockWrites = false;
    }

    // ② 玩家：伤害走 player.hurt（盔甲/抗性/无敌帧/创造免疫全在内部），击退走独立冲量通道
    const p = g.player;
    if (p && !p.spectator && !p.dead) {
      const dx = p.position.x - cx, dy = (p.position.y + 0.9) - cy, dz = p.position.z - cz;
      const d = Math.hypot(dx, dy, dz);
      const dmg = blastDamage(d);
      if (dmg > 0) p.hurt(dmg, 'explosion', true);
      const kb = blastKnockback(d);
      if (kb.h > 0) {
        const dir = blastDir(dx, dy, dz);
        if (dir && p.knockback) {
          p.knockback.x += dir.x * kb.h;
          p.knockback.z += dir.z * kb.h;
        }
        if (!p.flying) p.velocity.y = Math.max(p.velocity.y, kb.v);
      }
    }

    // ③ 怪物：半径内按距离衰减扣血 + 击退（各端本地结算，与既有苦力怕爆炸同口径）
    if (g.mobManager && typeof g.mobManager.damageMobsInRadius === 'function') {
      g.mobManager.damageMobsInRadius(cx, cy, cz);
    }

    // ④ 表现（火球/烟尘/白闪/震屏/音效）
    this.blastFx(cx, cy, cz);
  }

  // 表现：火球 + 火花/浓烟 + 白闪 + 镜头震动 + 低频轰鸣（距离越近越强）
  blastFx(cx, cy, cz) {
    const g = this.game;
    const p = g.player ? g.player.position : null;
    const dist = p ? Math.hypot(p.x - cx, (p.y + 1.0) - cy, p.z - cz) : Infinity;
    const near = Math.max(0, 1 - dist / 24);
    audio.explosion(dist);
    if (near <= 0) return;
    if (g.hud && g.hud.flashBlast) g.hud.flashBlast(near);
    if (g.addCameraShake) g.addCameraShake(near);
    this._spawnFireball(cx, cy, cz);

    const ps = g.particles;
    if (!ps) return;
    const dens = ps.densityScale || 1;
    const sparks = Math.max(6, Math.round(26 * dens));
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const sp = 4 + Math.random() * 7;
      const t = Math.random();
      ps.spawn(
        cx + (Math.random() - 0.5) * 1.2, cy + (Math.random() - 0.5) * 1.2, cz + (Math.random() - 0.5) * 1.2,
        Math.cos(a) * sp, 2 + up * 7, Math.sin(a) * sp,
        1.0, 0.55 + t * 0.35, 0.12 + t * 0.2,
        0.35 + Math.random() * 0.45, -9, 0.97
      );
    }
    const smokes = Math.max(8, Math.round(28 * dens));
    for (let i = 0; i < smokes; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3.5;
      const shade = 0.34 + Math.random() * 0.24; // 浅灰烟团（太深会读成飞溅的碎屑）
      ps.spawn(
        cx + (Math.random() - 0.5) * 1.6, cy + Math.random() * 1.4, cz + (Math.random() - 0.5) * 1.6,
        Math.cos(a) * sp, 1.4 + Math.random() * 2.2, Math.sin(a) * sp,
        shade, shade, shade,
        1.1 + Math.random() * 1.1, 1.4, 0.94 // grav 正 = 上飘（烟柱）
      );
    }
  }

  // 火球：加法混合 sprite，0.3s 内从 1.6 格扩到 ~7 格并淡出（只在浏览器建纹理）
  _spawnFireball(cx, cy, cz) {
    const g = this.game;
    const scene = g && g.renderer && g.renderer.scene;
    if (!scene || typeof document === 'undefined') return;
    if (!this._ballTex) this._ballTex = this._makeFireballTexture();
    if (!this._ballTex) return;
    const mat = new THREE.SpriteMaterial({
      map: this._ballTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 1,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(cx, cy, cz);
    sp.scale.setScalar(1.4);
    scene.add(sp);
    this._balls.push({ sprite: sp, mat, t: 0, dur: 0.26 });
  }

  _makeFireballTexture() {
    try {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const ctx = cv.getContext('2d');
      const grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
      grd.addColorStop(0, 'rgba(255,246,206,1)');
      grd.addColorStop(0.28, 'rgba(255,198,96,0.95)');
      grd.addColorStop(0.6, 'rgba(240,108,36,0.55)');
      grd.addColorStop(0.85, 'rgba(150,54,16,0.18)');
      grd.addColorStop(1, 'rgba(90,30,8,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    } catch {
      return null;
    }
  }

  _updateBalls(dt) {
    if (!this._balls.length) return;
    const scene = this.game && this.game.renderer && this.game.renderer.scene;
    for (let i = this._balls.length - 1; i >= 0; i--) {
      const b = this._balls[i];
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      b.sprite.scale.setScalar(1.4 + 2.8 * k);
      b.mat.opacity = 0.85 * Math.pow(1 - k, 2);
      if (k >= 1) {
        if (scene) scene.remove(b.sprite);
        b.mat.dispose();
        this._balls.splice(i, 1);
      }
    }
  }

  // —— 引信白光罩（纯可视层：不写方块、不触发区块重建）——
  _syncOverlay(x, y, z, t = this.fuses.get(this.key(x, y, z)) || 0) {
    const g = this.game;
    const scene = g && g.renderer && g.renderer.scene;
    if (!scene) return;
    const k = this.key(x, y, z);
    let o = this.overlays.get(k);
    if (!o) {
      if (!this._geo) this._geo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false,
      });
      const mesh = new THREE.Mesh(this._geo, mat);
      mesh.position.set(x + BLOCK_CENTER, y + BLOCK_CENTER, z + BLOCK_CENTER);
      mesh.frustumCulled = false;
      scene.add(mesh);
      o = { mesh, mat };
      this.overlays.set(k, o);
    }
    // 原版手感：越接近爆炸闪得越快（2Hz → 6Hz），并轻微膨胀
    const rem = Math.max(0, FUSE_TIME - t);
    const rate = 2 + 4 * (1 - rem / FUSE_TIME);
    const phase = Math.sin(t * Math.PI * 2 * rate);
    o.mat.opacity = 0.28 + 0.34 * (0.5 + 0.5 * phase);
    const s = 1 + 0.05 * (0.5 + 0.5 * phase);
    o.mesh.scale.set(s, s, s);
  }

  _dropOverlay(x, y, z) {
    const k = this.key(x, y, z);
    const o = this.overlays.get(k);
    if (!o) return;
    const scene = this.game && this.game.renderer && this.game.renderer.scene;
    if (scene) scene.remove(o.mesh);
    o.mat.dispose();
    this.overlays.delete(k);
  }

  dispose() {
    for (const k of [...this.overlays.keys()]) {
      const [x, y, z] = k.split(',').map(Number);
      this._dropOverlay(x, y, z);
    }
    this.overlays.clear();
    this.fuses.clear();
    const scene = this.game && this.game.renderer && this.game.renderer.scene;
    for (const b of this._balls) {
      if (scene) scene.remove(b.sprite);
      b.mat.dispose();
    }
    this._balls.length = 0;
    if (this._ballTex) { this._ballTex.dispose(); this._ballTex = null; }
    if (this._geo) { this._geo.dispose(); this._geo = null; }
  }
}
