// player/MagicSystem.js -- 四潮回响的客户端域：回响/冷却/施法/弹道表现/HUD（Build 51 R4）
// 单机：本地权威（校验→扣回响→生效），怪物伤害走既有 mobManager.attackMob 链路。
// 联机：本机施法仍是**本端权威结算**（回响与背包沿用项目轻信任模型），另广播 MAGIC_EFFECT
//       给同维其他人做纯表现（远端不扣回响、不重复结算伤害）。
// 边界：风步不穿墙、不变成飞行；烬矢不点燃地形、不炸方块、每发只结算一次。
// 生命周期：新建型——每次 Game.start 重建，_disposeWorld 释放（弹道 mesh 逐个 dispose）。
import * as THREE from 'three';
import {
  SPELLS, SPELL_IDS, FOCUS_SPELL, spellDef, ECHO_MAX,
  ECHO_REGEN_SECONDS, ECHO_REGEN_DELAY, ECHO_PER_LEVEL,
} from '../content/magic/defs.js';
import {
  clampEcho, checkCast, tuneEcho, resolveDashTarget, cooldownLeft,
} from '../core/Magic.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { PLAYER_EYE_HEIGHT } from './constants.js';
import { t } from '../i18n/index.js';

// 弹道视觉资源（模块级懒建、永不 dispose——与箭矢同款；despawn 只摘 scene）
let boltGeo = null;
let boltMatLocal = null;
let boltMatRemote = null;

// 施法失败码 → 提示
const FAIL_TEXT = {
  disabled: '这个世界没有回响',
  'no-focus': '需要手持回响焦点',
  'wrong-focus': '手中的焦点不对应这个法术',
  mode: '创造/旁观模式不能施法',
  echo: '回响不足',
  cooldown: '法术还在冷却',
  unknown: '未知的法术',
};

export class MagicSystem {
  constructor(game) {
    this.game = game;
    this._lastCast = new Map(); // spellId -> 毫秒时间戳
    this._bolts = [];           // { x,y,z,vx,vy,vz,life,dead,spell,local,mesh }
    this._regenAcc = 0;
    this._lastSpendAt = 0;
    this._hudAt = 0;
  }

  // 世界是否启用魔法（关闭的世界：不生成弹道、不回复、不扣减、无 HUD）
  get enabled() {
    const w = this.game.world;
    return !!(w && w.extraContent && w.extraContent.magic === true);
  }

  isFocus(name) { return !!(name && FOCUS_SPELL[name]); }

  cooldownLeft(spellId) {
    return cooldownLeft(this._lastCast.get(spellId) || 0, Date.now(), spellId);
  }

  // 每帧：缓降计时 / 脱战回响恢复 / 弹道推进 / HUD 刷新
  update(dt) {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    if (p.slowFall > 0) p.slowFall = Math.max(0, p.slowFall - dt);

    if (this.enabled) {
      // 脱战自然恢复：每 ECHO_REGEN_SECONDS +1（施法后 ECHO_REGEN_DELAY 秒内不回复）
      const sinceSpend = (Date.now() - this._lastSpendAt) / 1000;
      if (p.echo < p.echoMax && sinceSpend >= ECHO_REGEN_DELAY) {
        this._regenAcc += dt;
        if (this._regenAcc >= ECHO_REGEN_SECONDS) {
          this._regenAcc -= ECHO_REGEN_SECONDS;
          p.echo = clampEcho(p.echo + 1, p.echoMax);
        }
      } else {
        this._regenAcc = 0;
      }
    }

    this._updateBolts(dt);

    // HUD 10Hz 刷新
    this._hudAt += dt;
    if (this._hudAt >= 0.1) {
      this._hudAt = 0;
      this._pushHud();
    }
  }

  _pushHud() {
    const g = this.game;
    if (!g.hud || !g.hud.setEcho) return;
    if (!this.enabled) { g.hud.setEcho(0, 0, 0, false); return; }
    const p = g.player;
    const held = g.inventory ? g.inventory.getSelected() : null;
    const spellId = held ? FOCUS_SPELL[held.name] : null;
    const cd = spellId ? this.cooldownLeft(spellId) : 0;
    const cdFrac = spellId ? Math.max(0, Math.min(1, cd / (SPELLS[spellId].cooldown || 1))) : 0;
    g.hud.setEcho(clampEcho(p.echo, p.echoMax), p.echoMax, cdFrac, true);
  }

  // 手持焦点时右键：施放该焦点对应的法术。返回 true = 本次右键已消费
  castHeld() {
    const g = this.game;
    const p = g.player;
    const held = g.inventory ? g.inventory.getSelected() : null;
    if (!held) return false;
    const spellId = FOCUS_SPELL[held.name];
    if (!spellId) return false;
    const def = spellDef(spellId);
    const check = checkCast({
      spellId,
      held: held.name,
      echo: p.echo,
      cooldownLeft: this.cooldownLeft(spellId),
      magicEnabled: this.enabled,
      spectator: p.spectator,
      creative: p.creative,
    });
    if (!check.ok) {
      g.hud && g.hud.showToast(t(FAIL_TEXT[check.code] || FAIL_TEXT.unknown));
      return true;
    }
    const ok = spellId === 'gale_step' ? this._castGaleStep(def) : this._castEmberBolt(def);
    if (!ok) return true;
    p.echo = clampEcho(p.echo - def.cost, p.echoMax);
    this._lastCast.set(spellId, Date.now());
    this._lastSpendAt = Date.now();
    return true;
  }

  // 风潮·风步：沿视线短距冲刺（碰撞裁剪，不穿墙；落点必须有站立空间），随后短暂缓降
  _castGaleStep(def) {
    const g = this.game;
    const p = g.player;
    const dir = this._viewDir();
    const startY = p.position.y;
    // 探针：沿视线逐 0.25 格检查，实心方块即停；并检查该点的玩家 AABB 是否可站。
    const half = 0.3;
    const height = 1.8;
    const probe = (d) => {
      const x = p.position.x + dir.x * d;
      const y = startY + dir.y * d;
      const z = p.position.z + dir.z * d;
      const blocked = !this._aabbFree(x, y, z, half, height);
      if (blocked) return { blocked: true, standable: false };
      // 脚下 3 格内要有可站立面（否则不前进——不把人送进虚空）
      let standable = false;
      for (let dy = 1; dy <= 3; dy++) {
        const below = g.world.getBlock(Math.floor(x), Math.floor(y - dy), Math.floor(z));
        const bd = BlockRegistry.getById(below);
        if (bd && bd.solid && !bd.passable) { standable = true; break; }
      }
      return { blocked: false, standable };
    };
    const dist = resolveDashTarget(def.distance, probe);
    if (!(dist > 0.3)) {
      g.hud && g.hud.showToast(t('前方没有落脚的地方'));
      return false;
    }
    p.position.x += dir.x * dist;
    p.position.y += dir.y * dist;
    p.position.z += dir.z * dist;
    p.velocity.multiplyScalar(0.25);
    p.slowFall = def.slowFall;
    p.onGround = false;
    if (g.networkMode && g.net) g.net.sendMagicCast('gale_step', p.echo, this._eyeStart(), dir);
    return true;
  }

  // 坠潮·烬矢：沿视线射出灼热弹（只伤人、不点燃地形/不炸方块/单次结算）
  _castEmberBolt(def) {
    const g = this.game;
    const p = g.player;
    const dir = this._viewDir();
    const start = this._eyeStart();
    const bolt = {
      x: start.x + dir.x * 0.6, y: start.y + dir.y * 0.6, z: start.z + dir.z * 0.6,
      vx: dir.x * def.speed, vy: dir.y * def.speed, vz: dir.z * def.speed,
      life: def.life, dead: false, spell: 'ember_bolt', local: true,
    };
    this._spawnBoltMesh(bolt, true);
    this._bolts.push(bolt);
    if (g.networkMode && g.net) g.net.sendMagicCast('ember_bolt', p.echo, start, dir);
    return true;
  }

  _viewDir() {
    const p = this.game.player;
    const cp = Math.cos(p.pitch);
    return new THREE.Vector3(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp).normalize();
  }

  _eyeStart() {
    const p = this.game.player;
    return { x: p.position.x, y: p.position.y + PLAYER_EYE_HEIGHT, z: p.position.z };
  }

  // 玩家 AABB 在该位置是否无碰撞（只用实心方块判定，够用且不依赖 Physics 内部）
  _aabbFree(x, y, z, half, height) {
    const w = this.game.world;
    const x0 = Math.floor(x - half), x1 = Math.floor(x + half);
    const z0 = Math.floor(z - half), z1 = Math.floor(z + half);
    const y0 = Math.floor(y + 0.01), y1 = Math.floor(y + height - 0.01);
    for (let bx = x0; bx <= x1; bx++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (let by = y0; by <= y1; by++) {
          const def = BlockRegistry.getById(w.getBlock(bx, by, bz));
          if (def && def.solid && !def.passable) return false;
        }
      }
    }
    return true;
  }

  // ── 弹道 ────────────────────────────────────────────────────────────────
  _spawnBoltMesh(bolt, local) {
    if (!boltGeo) boltGeo = new THREE.SphereGeometry(0.18, 8, 6);
    if (!boltMatLocal) boltMatLocal = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    if (!boltMatRemote) boltMatRemote = new THREE.MeshBasicMaterial({ color: 0xff9a4a, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(boltGeo, local ? boltMatLocal : boltMatRemote);
    mesh.position.set(bolt.x, bolt.y, bolt.z);
    this.game.renderer.scene.add(mesh);
    bolt.mesh = mesh;
  }

  _updateBolts(dt) {
    const g = this.game;
    if (!this._bolts.length) return;
    const keep = [];
    for (const bolt of this._bolts) {
      if (!bolt.dead) {
        const def = spellDef(bolt.spell);
        const px = bolt.x, py = bolt.y, pz = bolt.z;
        const nx = px + bolt.vx * dt, ny = py + bolt.vy * dt, nz = pz + bolt.vz * dt;
        const dx = nx - px, dy = ny - py, dz = nz - pz;
        const seg = Math.hypot(dx, dy, dz);
        // 方块先挡：弹道最多走到墙前（不炸方块、不烧地形）
        const blockDist = seg > 0 ? this._blockDistance(px, py, pz, dx / seg, dy / seg, dz / seg, seg) : 0;
        const reach = Math.min(seg, blockDist);
        let hit = false;
        if (bolt.local && def && reach > 1e-6) {
          // 怪物伤害走既有 attackMob 链路（受击红光/音效/XP 归属/联机上报全在内），每发只调一次
          hit = g.mobManager
            ? g.mobManager.attackMob(new THREE.Vector3(px, py, pz), new THREE.Vector3(dx / seg, dy / seg, dz / seg), reach, def.damage)
            : false;
        }
        bolt.x = px + (dx / (seg || 1)) * reach;
        bolt.y = py + (dy / (seg || 1)) * reach;
        bolt.z = pz + (dz / (seg || 1)) * reach;
        bolt.life -= dt;
        const blocked = reach + 1e-6 < seg;
        if (hit || blocked || bolt.life <= 0) {
          bolt.dead = true;
          this._impactFx(bolt.x, bolt.y, bolt.z);
        }
      }
      if (bolt.dead) {
        if (bolt.mesh) {
          g.renderer.scene.remove(bolt.mesh);
          bolt.mesh = null;
        }
        continue;
      }
      if (bolt.mesh) bolt.mesh.position.set(bolt.x, bolt.y, bolt.z);
      keep.push(bolt);
    }
    this._bolts = keep;
  }

  // 一段射线上第一处实心方块的距离（无命中返回 maxDist）；步长 ≤0.2 格，薄墙不穿
  _blockDistance(px, py, pz, dx, dy, dz, maxDist) {
    const g = this.game;
    const steps = Math.max(1, Math.ceil(maxDist / 0.2));
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * maxDist;
      const bd = BlockRegistry.getById(g.world.getBlock(
        Math.floor(px + dx * d), Math.floor(py + dy * d), Math.floor(pz + dz * d),
      ));
      if (bd && bd.solid && !bd.passable) return Math.max(0, d - 0.2);
    }
    return maxDist;
  }

  _impactFx(x, y, z) {
    const g = this.game;
    const ps = g.particles;
    if (!ps || !ps.spawn) return;
    const n = Math.max(3, Math.round(6 * (ps.densityScale || 1)));
    for (let i = 0; i < n; i++) {
      ps.spawn(
        x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 3, Math.random() * 2.4 + 0.6, (Math.random() - 0.5) * 3,
        1.0, 0.62, 0.28,
        0.3 + Math.random() * 0.25, -6, 0.97,
      );
    }
  }

  // ── 仪台调谐 ────────────────────────────────────────────────────────────
  tuneTable() {
    const g = this.game;
    const p = g.player;
    const res = tuneEcho({ echo: p.echo, xpLevel: p.xpLevel, magicEnabled: this.enabled });
    if (res.code === 'disabled') { /* 关闭魔法的世界：仪台无字 */ return true; }
    if (res.code === 'full') { g.hud && g.hud.showToast(t('回响已满')); return true; }
    if (res.code === 'no-level') { g.hud && g.hud.showToast(t('需要至少 1 级经验才能调谐')); return true; }
    p.xpLevel = Math.max(0, p.xpLevel - res.levels);
    p.xp = 0;
    p.echo = clampEcho(p.echo + res.gain, p.echoMax);
    g.hud && g.hud.showToast(t('调谐完成：回响 +{n}', { n: res.gain }));
    return true;
  }

  // ── 联机：远端施法表现（不结算伤害、不扣回响）───────────────────────────
  applyRemoteEffect(msg) {
    if (!msg || !spellDef(msg.spell)) return;
    if (!this.enabled) return;
    const dir = new THREE.Vector3(msg.dx, msg.dy, msg.dz);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    if (msg.spell === 'gale_step') {
      // 远端风步：起手位置一团风尘（位移由 player_state 自己同步，不在这里挪人）
      this._impactFx(msg.x, msg.y, msg.z);
      return;
    }
    const def = spellDef(msg.spell);
    const bolt = {
      x: msg.x, y: msg.y, z: msg.z,
      vx: dir.x * def.speed, vy: dir.y * def.speed, vz: dir.z * def.speed,
      life: def.life, dead: false, spell: def.id, local: false,
    };
    this._spawnBoltMesh(bolt, false);
    this._bolts.push(bolt);
  }

  dispose() {
    const g = this.game;
    for (const bolt of this._bolts) {
      if (bolt.mesh && g.renderer) g.renderer.scene.remove(bolt.mesh);
      bolt.mesh = null;
    }
    this._bolts = [];
    this._lastCast.clear();
    this._regenAcc = 0;
    if (g.hud && g.hud.setEcho) g.hud.setEcho(0, 0, 0, false);
  }
}

// 供测试/服务器复用的导出
export { SPELLS, SPELL_IDS, ECHO_MAX, ECHO_PER_LEVEL };
