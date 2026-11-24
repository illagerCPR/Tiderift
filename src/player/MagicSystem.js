// player/MagicSystem.js -- 四潮回响的客户端域：回响/冷却/施法/弹道表现/HUD（Build 51 R4 / B54 R1）
// 单机：本地权威（校验→扣回响→生效），怪物伤害走既有 mobManager.attackMob 链路。
// 联机：本机施法仍是**本端权威结算**（回响与背包沿用项目轻信任模型），另广播 MAGIC_EFFECT
//       给同维其他人做纯表现（远端不扣回响、不重复结算伤害、不替他回血/位移）。
// 边界：风步不穿墙、不变成飞行；烬矢不点燃地形、不炸方块、每发只结算一次；
//       回潮只恢复自己且不超过生命上限；折步不跨维、不穿墙、不落未加载区块或实心格。
// 生命周期：新建型——每次 Game.start 重建，_disposeWorld 释放（弹道 mesh 逐个 dispose）。
import * as THREE from 'three';
import {
  SPELLS, SPELL_IDS, FOCUS_SPELL, spellDef, ECHO_MAX,
  ECHO_REGEN_SECONDS, ECHO_REGEN_DELAY, ECHO_PER_LEVEL, CHARGE_FULL_SECONDS,
} from '../content/magic/defs.js';
import {
  clampEcho, checkCast, tuneEcho, resolveDashTarget, resolveBlinkTarget, planMend, cooldownLeft,
  spellAtCharge, castFeedback, sanitizeCooldowns, boltDamage,
} from '../core/Magic.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { PLAYER_EYE_HEIGHT } from './constants.js';
import { t } from '../i18n/index.js';
import { audio } from '../audio/AudioEngine.js';

// 弹道视觉资源（模块级懒建、永不 dispose——与箭矢同款；despawn 只摘 scene）
let boltGeo = null;
let boltMatLocal = null;
let boltMatRemote = null;

// 施法失败码 → 提示（B54 R2：文案与 HUD 脉冲都从 core/Magic.js 的 castFeedback 统一取，
// 这里不再自带一份码表，避免两处文案走样）

export class MagicSystem {
  constructor(game) {
    this.game = game;
    this._lastCast = new Map(); // spellId -> 毫秒时间戳
    this._bolts = [];           // { x,y,z,vx,vy,vz,life,dead,spell,local,mesh }
    this._regenAcc = 0;
    this._lastSpendAt = 0;
    this._hudAt = 0;
    this._charge = { active: false, t: 0 }; // B54 R2：按住右键蓄力（0..CHARGE_FULL_SECONDS）
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

  // ── 蓄力（B54 R2）─────────────────────────────────────────────────────
  // 语义：按住右键蓄力、松手施放。单击 = charge≈0，走基础值；蓄满 = charged 上限值。
  get isCharging() { return this._charge.active; }

  chargeFrac() {
    if (!this._charge.active) return 0;
    return Math.max(0, Math.min(1, this._charge.t / CHARGE_FULL_SECONDS));
  }

  beginCharge() {
    if (!this.enabled) return false;
    this._charge.active = true;
    this._charge.t = 0;
    this._pushHud();
    return true;
  }

  advanceCharge(dt) {
    if (!this._charge.active) return;
    this._charge.t = Math.min(CHARGE_FULL_SECONDS, this._charge.t + Math.max(0, dt || 0));
  }

  cancelCharge() {
    if (!this._charge.active) return;
    this._charge.active = false;
    this._charge.t = 0;
    this._pushHud();
  }

  // 松手：按当前蓄力施放（返回 true = 本次右键已消费）
  releaseCharge() {
    if (!this._charge.active) return false;
    const charge = this.chargeFrac();
    this.cancelCharge();
    this.castHeld(charge);
    return true;
  }

  // ── 死亡 / 换维（B54 R3）：规则见 core/Magic.js 的 MAGIC_LIFECYCLE ─────────
  // 回响与冷却保留（冷却换维靠 loadData 透传，不进存档），蓄力/弹道/缓降/防护清空。
  exportCooldowns() {
    const out = {};
    for (const [id, at] of this._lastCast) out[id] = at;
    return out;
  }

  importCooldowns(raw) {
    this._lastCast.clear();
    for (const [id, at] of Object.entries(sanitizeCooldowns(raw))) this._lastCast.set(id, at);
    this._pushHud();
  }

  // 死亡：清运行态、留资源与冷却（防护由 respawn 的 clearEffects 统一清）
  onPlayerDeath() {
    this.cancelCharge();
    this._clearBolts();
    const p = this.game.player;
    if (p) p.slowFall = 0;
    this._pushHud();
  }

  _clearBolts() {
    const g = this.game;
    for (const bolt of this._bolts) {
      if (bolt.mesh && g.renderer) g.renderer.scene.remove(bolt.mesh);
      bolt.mesh = null;
    }
    this._bolts = [];
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
    // 第 5 参：蓄力进度（-1 = 未蓄力，回响条显示资源；0..1 = 蓄力中，改显示蓄力条与百分比）
    const charge = this._charge.active ? this.chargeFrac() : -1;
    g.hud.setEcho(clampEcho(p.echo, p.echoMax), p.echoMax, cdFrac, true, charge);
  }

  // 手持焦点时右键：施放该焦点对应的法术。返回 true = 本次右键已消费
  //   charge 0..1（B54 R2）：基础值 → 满蓄上限值（费用与冷却不变）
  castHeld(charge = 0) {
    const g = this.game;
    const p = g.player;
    const held = g.inventory ? g.inventory.getSelected() : null;
    if (!held) return false;
    const spellId = FOCUS_SPELL[held.name];
    if (!spellId) return false;
    const base = spellDef(spellId);
    const def = spellAtCharge(base, charge);
    const check = checkCast({
      spellId,
      held: held.name,
      echo: p.echo,
      cooldownLeft: this.cooldownLeft(spellId),
      magicEnabled: this.enabled,
      spectator: p.spectator,
      creative: p.creative,
    });
    if (!check.ok) { this._feedback(check.code); return true; }
    // 本体施法可能因「目标无效」（满血 / 没有落脚点）而失败：失败不扣回响、不进冷却
    const res = this._execute(spellId, def, charge);
    if (!res.ok) { this._feedback(res.code); return true; }
    p.echo = clampEcho(p.echo - base.cost, p.echoMax);
    this._lastCast.set(spellId, Date.now());
    this._lastSpendAt = Date.now();
    audio.spellCast(spellId, charge);
    this._pushHud(); // 施放当帧就把回响与冷却画对（否则最多晚 0.1s）
    return true;
  }

  // 施法失败统一反馈（B54 R2）：提示文案 + 回响条脉冲 + 拒绝音，三处同源（castFeedback）
  _feedback(code) {
    const g = this.game;
    const fb = castFeedback(code);
    g.hud && g.hud.showToast(t(fb.text));
    if (g.hud && g.hud.pulseEcho) g.hud.pulseEcho(fb.hud);
    audio.spellDeny();
  }

  _execute(spellId, def, charge = 0) {
    switch (spellId) {
      case 'gale_step': return this._castGaleStep(def);
      case 'ember_bolt': return this._castEmberBolt(def, charge);
      case 'tide_mend': return this._castTideMend(def);
      case 'void_step': return this._castVoidStep(def);
      default: return { ok: false, code: 'unknown' };
    }
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
      const standable = this._hasFloor(x, y, z);
      return { blocked: false, standable };
    };
    const dist = resolveDashTarget(def.distance, probe);
    if (!(dist > 0.3)) return { ok: false, code: 'target' };
    p.position.x += dir.x * dist;
    p.position.y += dir.y * dist;
    p.position.z += dir.z * dist;
    p.velocity.multiplyScalar(0.25);
    p.slowFall = def.slowFall;
    p.onGround = false;
    if (g.networkMode && g.net) g.net.sendMagicCast('gale_step', p.echo, this._eyeStart(), dir);
    return { ok: true };
  }

  // 坠潮·烬矢：沿视线射出灼热弹（只伤人、不点燃地形/不炸方块/单次结算）
  //   charge 只影响伤害与弹体大小（视觉跟着伤害走，判定仍是一发一次）
  _castEmberBolt(def, charge = 0) {
    const g = this.game;
    const p = g.player;
    const dir = this._viewDir();
    const start = this._eyeStart();
    const bolt = {
      x: start.x + dir.x * 0.6, y: start.y + dir.y * 0.6, z: start.z + dir.z * 0.6,
      vx: dir.x * def.speed, vy: dir.y * def.speed, vz: dir.z * def.speed,
      life: def.life, dead: false, spell: 'ember_bolt', local: true,
      damage: def.damage, // B54 R4：蓄力插值出的伤害钉在弹体上（推进阶段不再回表）
    };
    this._spawnBoltMesh(bolt, true, charge);
    this._bolts.push(bolt);
    if (g.networkMode && g.net) g.net.sendMagicCast('ember_bolt', p.echo, start, dir);
    return { ok: true };
  }

  // 雨潮·回潮：只恢复自己（裁剪到生命上限）+ 短暂防护；满血直接拒绝（不扣回响）
  _castTideMend(def) {
    const g = this.game;
    const p = g.player;
    const plan = planMend(p.health, p.maxHealth, def.heal);
    if (!plan.ok) return { ok: false, code: 'wounded' };
    p.health = plan.health;
    p.applyEffect(def.guardEffect, def.guardLevel, def.guardSeconds);
    this._mendFx();
    g.hud && g.hud.showToast(t('回潮：生命 +{n}', { n: plan.heal }));
    if (g.networkMode && g.net) g.net.sendMagicCast('tide_mend', p.echo, this._eyeStart(), this._viewDir());
    return { ok: true };
  }

  // 无潮·折步：向可见落点短距折跃（必须已加载、AABB 空、脚下有立足面；不越过任何障碍）
  _castVoidStep(def) {
    const g = this.game;
    const p = g.player;
    const dir = this._viewDir();
    const half = 0.3;
    const height = 1.8;
    const probe = (d) => {
      const x = p.position.x + dir.x * d;
      const y = p.position.y + dir.y * d;
      const z = p.position.z + dir.z * d;
      // 未加载区块不落（不把人折进还没生成的空白）
      if (!g.world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4)) return { blocked: true };
      const free = this._aabbFree(x, y, z, half, height);
      if (!free) return { blocked: true, free: false };
      return { blocked: false, free: true, standable: this._hasFloor(x, y, z, def.standDepth) };
    };
    const dist = resolveBlinkTarget(def.distance, probe, def.step);
    if (!(dist > 0.5)) return { ok: false, code: 'target' };
    const from = { x: p.position.x, y: p.position.y, z: p.position.z };
    p.position.x += dir.x * dist;
    p.position.y += dir.y * dist;
    p.position.z += dir.z * dist;
    p.velocity.set(0, 0, 0);  // 折跃不留惯性：落地即站住
    p.slowFall = 0;
    p.onGround = false;
    const to = { x: p.position.x, y: p.position.y, z: p.position.z };
    this._blinkFx(from); this._blinkFx(to);
    if (g.networkMode && g.net) g.net.sendMagicCast('void_step', p.echo, from, dir, to);
    return { ok: true };
  }

  // 脚下 standDepth 格内是否有可站立面（风步与折步共用口径）
  _hasFloor(x, y, z, standDepth = 3) {
    const w = this.game.world;
    for (let dy = 1; dy <= standDepth; dy++) {
      const bd = BlockRegistry.getById(w.getBlock(Math.floor(x), Math.floor(y - dy), Math.floor(z)));
      if (bd && bd.solid && !bd.passable) return true;
    }
    return false;
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
  // charge 只缩放弹体（满蓄 1.0 → 1.5 倍），不改判定半径与伤害链
  _spawnBoltMesh(bolt, local, charge = 0) {
    if (!boltGeo) boltGeo = new THREE.SphereGeometry(0.18, 8, 6);
    if (!boltMatLocal) boltMatLocal = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    if (!boltMatRemote) boltMatRemote = new THREE.MeshBasicMaterial({ color: 0xff9a4a, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(boltGeo, local ? boltMatLocal : boltMatRemote);
    mesh.position.set(bolt.x, bolt.y, bolt.z);
    const c = Math.max(0, Math.min(1, Number(charge) || 0));
    if (c > 0) mesh.scale.setScalar(1 + 0.5 * c);
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
          const dir = new THREE.Vector3(dx / seg, dy / seg, dz / seg);
          const dmg = boltDamage(bolt, def); // 发射时定的伤害（蓄力结果），不回表
          // B54 R3：先看玩家（联机 + 房间开着 PvP）——伤害只走既有 PvP 闸门：
          // 本端只发一次 ATTACK_PLAYER，服务器校验 PvP 并结算/广播，本端不重复扣血。
          if (this._canPvP()) {
            const rp = g._findRemoteByRay(new THREE.Vector3(px, py, pz), dir, reach);
            if (rp) {
              g.net.sendAttackPlayer(rp.id, dmg, 'magic');
              hit = true;
            }
          }
          // 怪物伤害走既有 attackMob 链路（受击红光/音效/XP 归属/联机上报全在内），每发只调一次
          if (!hit) {
            hit = g.mobManager
              ? g.mobManager.attackMob(new THREE.Vector3(px, py, pz), dir, reach, dmg)
              : false;
          }
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

  // 联机且房间没关 PvP 时，烬矢才把玩家当作可命中目标（与近战同一闸门口径）
  _canPvP() {
    const g = this.game;
    return !!(g.networkMode && g.net && g.net.roomSettings && g.net.roomSettings.pvp !== false
      && g._findRemoteByRay && g.remotePlayers && g.remotePlayers.size > 0);
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

  // 回潮：贴着身体的青白色水汽（纯表现，不参与判定）
  _mendFx() {
    const g = this.game;
    const ps = g.particles;
    if (!ps || !ps.spawn) return;
    const p = g.player;
    const n = Math.max(4, Math.round(12 * (ps.densityScale || 1)));
    for (let i = 0; i < n; i++) {
      ps.spawn(
        p.position.x + (Math.random() - 0.5) * 0.8,
        p.position.y + 0.2 + Math.random() * 1.5,
        p.position.z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.9, (Math.random() - 0.5) * 0.6,
        0.46, 0.86, 0.9,
        0.5 + Math.random() * 0.35, -1.2, 0.94,
      );
    }
  }

  // 折步：起止两点各一团淡紫空隙尘（纯表现）
  _blinkFx(pos) {
    const g = this.game;
    const ps = g.particles;
    if (!ps || !ps.spawn) return;
    const n = Math.max(3, Math.round(9 * (ps.densityScale || 1)));
    for (let i = 0; i < n; i++) {
      ps.spawn(
        pos.x + (Math.random() - 0.5) * 0.5, pos.y + 0.3 + Math.random() * 1.2, pos.z + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 2.4, (Math.random() - 0.2) * 1.6, (Math.random() - 0.5) * 2.4,
        0.62, 0.52, 0.86,
        0.3 + Math.random() * 0.3, -3, 0.95,
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

  // ── 联机：远端施法表现（不结算伤害、不扣回响、不替他回血/位移）─────────────────
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
    if (msg.spell === 'tide_mend') {
      // 远端回潮：只播水汽（血量由对方本端结算，远端不替他回血）
      this._mendFxAt(msg.x, msg.y, msg.z);
      return;
    }
    if (msg.spell === 'void_step') {
      // 远端折步：起止两团尘；落点缺失时只画起点
      this._blinkFx({ x: msg.x, y: msg.y, z: msg.z });
      if (Number.isFinite(msg.x2)) this._blinkFx({ x: msg.x2, y: msg.y2, z: msg.z2 });
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

  // 远端回潮水汽（位置来自事件，不读本端玩家）
  _mendFxAt(x, y, z) {
    const ps = this.game.particles;
    if (!ps || !ps.spawn) return;
    const n = Math.max(3, Math.round(9 * (ps.densityScale || 1)));
    for (let i = 0; i < n; i++) {
      ps.spawn(
        x + (Math.random() - 0.5) * 0.8, y + 0.2 + Math.random() * 1.4, z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.9, (Math.random() - 0.5) * 0.6,
        0.46, 0.86, 0.9,
        0.5 + Math.random() * 0.3, -1.2, 0.94,
      );
    }
  }

  dispose() {
    const g = this.game;
    this._clearBolts();
    this._lastCast.clear();
    this._regenAcc = 0;
    this._charge.active = false;
    this._charge.t = 0;
    if (g.hud && g.hud.setEcho) g.hud.setEcho(0, 0, 0, false);
  }
}

// 供测试/服务器复用的导出
export { SPELLS, SPELL_IDS, ECHO_MAX, ECHO_PER_LEVEL };
