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

export const FUSE_TIME = 4.0;        // 引信时长（秒）= 原版 80 tick
export const CHAIN_DELAY_MIN = 0.3;  // 连锁点燃延迟区间（错峰，避免同帧一起炸）
export const CHAIN_DELAY_MAX = 0.8;
const MAX_DEBRIS_BLOCKS = 10;        // 逐块碎屑上限（其余只清方块，防粒子池被打满）

export class TntSystem {
  constructor(game) {
    this.game = game;
    this.fuses = new Map();     // "x,y,z" -> 已燃烧秒数
    this.overlays = new Map();  // "x,y,z" -> 引信白光罩（可视层，见 _syncOverlay）
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

  // 表现钩子：轮 3 填充（白闪/烟尘/火球/震屏/音效），轮 2 只保留引信白罩
  blastFx() {}

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
    if (this._geo) { this._geo.dispose(); this._geo = null; }
  }
}
