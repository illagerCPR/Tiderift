// Projectiles.js -- 弹射物域：末影之眼 / 箭矢 / 凋灵之首与风弹（自 Game.js 迁出）
//
// Game 侧保留同名薄门面（_throwEnderEye / _updateEyeFlight / _shootArrow / _ensureArrowAssets /
// spawnRemoteArrow / _cancelBowCharge / _releaseBow / _updateArrows / _despawnArrow /
// _ensureWitherSkullAssets / _spawnWitherSkullVolley / _spawnGaleVolley / _spawnWitherSkull /
// spawnRemoteWitherSkull / _updateWitherSkulls / _despawnWitherSkull），签名与返回语义不变；
// 外部调用面零 diff（NetworkManager:370/377 无 typeof 守卫直调 spawnRemoteArrow / spawnRemoteWitherSkull）。
//
// 生命周期：**构造器共享型**——控制器只存 this.game，零 Three/DOM/监听器状态，_disposeWorld 零改动。
// 容器（arrows / witherSkulls / eyeFlight）与收口段仍留在 Game；控制器一律在调用点经 this.game 现取，
// 不留构造期快照（updatePortals → switchDimension → start 可在同帧同步换新数组）。
//
// 静态共享资源（箭几何/材质、凋灵之首几何/材质、风弹材质）懒建且**永不 dispose**：迁前 grep 全仓
// （src / tests / server）确认引用面仅本域、无外部模块或测试读 Game._arrowGeo 等，故迁为模块级静态。
// 结算分流：箭命中怪经 mobManager.attackMob（远端视觉箭不结算，伤害由射端权威上报）；
// 凋灵之首/风弹各端本地结算本地玩家（kind === 'gale' 为风弹：6 伤 + 击退，无凋零）。

import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ringPoints } from '../world/structures/stronghold.js';
import { PLAYER_EYE_HEIGHT } from './constants.js';
import { audio } from '../audio/AudioEngine.js';
import { t } from '../i18n/index.js';

// 弹射物静态共享资源（懒建一次，跨弹共享；永不 dispose，despawn 只摘 scene）
let arrowGeo = null;
let arrowMat = null;
let skullGeo = null;
let skullMat = null;
let galeMat = null;

export class Projectiles {
  constructor(game) {
    this.game = game;
  }

  // 掷末影之眼：消耗 1 颗，发光小球朝最近环带锚点飞 2.5s 后落回（20% 碎裂，原版）
  throwEnderEye() {
    const g = this.game;
    if (g.eyeFlight) return; // 飞行中不叠加
    g.inventory.removeSelected(1);
    g.hotbar.update();
    const p = g.player.position;
    let best = null, bestD = Infinity;
    for (const pt of ringPoints(g.world.seed)) {
      const d = (pt.x - p.x) ** 2 + (pt.z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = pt; }
    }
    if (best) {
      const dx = best.x - p.x, dz = best.z - p.z;
      // 八方位提示（北 = -Z，顺时针）
      const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
      const ang = Math.atan2(dx, -dz);
      const dirName = dirs[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
      if (g.chatBox) g.chatBox.add(t('末影之眼飞向{d}方（约 {n} 格）', { d: t(dirName), n: Math.round(Math.sqrt(bestD)) }), '#c8f');
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x66ffcc })
      );
      mesh.position.set(p.x, p.y + PLAYER_EYE_HEIGHT, p.z);
      g.renderer.scene.add(mesh);
      g.eyeFlight = { mesh, dir: new THREE.Vector3(dx, 6, dz).normalize(), t: 0, total: 2.5 };
    }
  }

  // 末影之眼飞行步进：到时落地——80% 落回背包，20% 碎裂（原版概率）
  updateEyeFlight(dt) {
    const g = this.game;
    const e = g.eyeFlight;
    e.t += dt;
    e.mesh.position.addScaledVector(e.dir, dt * 6);
    if (e.t >= e.total) {
      g.renderer.scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
      g.eyeFlight = null;
      if (Math.random() < 0.8) {
        g.inventory.add('ender_eye', 1);
        g.hotbar.update();
      }
    }
  }

  // 射箭：箭矢为本地投射物（几何/材质模块级共享），重力下坠、命中怪复用 attackMob 链
  // power = 初速系数（0.3~1 蓄力插值），dmg = 命中伤害（2~8 蓄力插值）；返回箭对象供联机上报
  shootArrow(power = 1, dmg = 6) {
    const g = this.game;
    const dir = new THREE.Vector3();
    g.renderer.camera.getWorldDirection(dir);
    const start = g.player.position.clone();
    start.y += PLAYER_EYE_HEIGHT;
    start.addScaledVector(dir, 0.6);
    this.ensureArrowAssets();
    const mesh = new THREE.Mesh(arrowGeo, arrowMat);
    mesh.position.copy(start);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    g.renderer.scene.add(mesh);
    const arrow = { mesh, pos: start, vel: dir.multiplyScalar(28 * power), life: 8, stuck: false, dmg };
    g.arrows.push(arrow);
    return arrow;
  }

  ensureArrowAssets() {
    if (!arrowGeo) arrowGeo = new THREE.BoxGeometry(0.06, 0.06, 0.5);
    if (!arrowMat) arrowMat = new THREE.MeshBasicMaterial({ color: 0x9a7442 });
  }

  // Idea-2B：远端玩家射箭——本地生成纯视觉箭（dmg=0/remote=true：命中怪只消失不结算，
  // 伤害由射端经 mob_attack 权威上报；钉墙/寿命消失各端本地处理）
  spawnRemoteArrow(x, y, z, dx, dy, dz) {
    const g = this.game;
    this.ensureArrowAssets();
    const pos = new THREE.Vector3(x, y, z);
    const vel = new THREE.Vector3(dx, dy, dz);
    const mesh = new THREE.Mesh(arrowGeo, arrowMat);
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vel.clone().normalize());
    g.renderer.scene.add(mesh);
    g.arrows.push({ mesh, pos, vel, life: 8, stuck: false, dmg: 0, remote: true });
  }

  cancelBowCharge() {
    const g = this.game;
    g._bowCharging = false;
    g._bowCharge = 0;
    g.hand.setBowDraw(null);
  }

  // 松手发射：charge→初速/伤害插值（vel=28×(0.3+0.7c)、dmg=2+round(6c)，即 8.4~28 m/s、2~8）
  releaseBow() {
    const g = this.game;
    const charge = g._bowCharge;
    this.cancelBowCharge();
    const sel = g.inventory.getSelected();
    if (!sel || sel.name !== 'bow') return; // 蓄力中途换了物品：只取消不射
    const hasArrow = g.player.creative || g.inventory.slots.some(s => s && s.name === 'arrow');
    if (!hasArrow) return;
    if (!g.player.creative) g.inventory.removeItems('arrow', 1);
    const arrow = this.shootArrow(0.3 + 0.7 * charge, 2 + Math.round(charge * 6));
    audio.bowShoot(charge);
    g.hand.swing();
    if (g.networkMode && g.net) g.net.sendArrowShot(arrow.pos, arrow.vel); // Idea-2B：初速广播
  }

  updateArrows(dt) {
    const g = this.game;
    for (let i = g.arrows.length - 1; i >= 0; i--) {
      const a = g.arrows[i];
      a.life -= dt;
      if (a.life <= 0) { this.despawnArrow(i); continue; }
      if (a.stuck) continue; // 钉在方块上直到寿命尽
      a.vel.y -= 12 * dt;
      const old = a.pos.clone();
      a.pos.addScaledVector(a.vel, dt);
      // 命中怪：整段位移作射线（球体口径同近战）
      const seg = new THREE.Vector3().subVectors(a.pos, old);
      const segLen = seg.length();
      if (segLen > 0 && g.mobManager) {
        const dirN = seg.clone().normalize();
        const mh = g.mobManager.findMobByRay(old, dirN, segLen + 0.2);
        if (mh && !mh.mob.dead) {
          if (!a.remote) g.mobManager.attackMob(old, dirN, segLen + 0.2, a.dmg || 6); // 伤害随蓄力；远端视觉箭不结算（射端权威）
          audio.arrowHit(); // 命中音（远端视觉箭也响，纯客户端效果）
          this.despawnArrow(i);
          continue;
        }
      }
      // 命中方块：钉住
      const bdef = BlockRegistry.getById(g.world.getBlock(Math.floor(a.pos.x), Math.floor(a.pos.y), Math.floor(a.pos.z)));
      if (bdef && bdef.solid && !bdef.fluid) {
        a.pos.copy(old);
        a.vel.set(0, 0, 0);
        a.stuck = true;
      }
      a.mesh.position.copy(a.pos);
    }
  }

  despawnArrow(i) {
    const g = this.game;
    const a = g.arrows[i];
    g.renderer.scene.remove(a.mesh); // 几何/材质为模块级共享，不 dispose
    g.arrows.splice(i, 1);
  }

  // ── 凋灵之首弹射物（Idea-2D-②）────────────────────────────────
  // 各端本地积分、命中本地玩家本地结算（同怪咬人语义：怪物 host 权威生成后各端自模拟）；
  // 广播仅视觉同步（服务器 except 发起者转发）。直线微坠弹，命中附加凋零 II。

  ensureWitherSkullAssets() {
    if (!skullGeo) skullGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
    if (!skullMat) skullMat = new THREE.MeshBasicMaterial({ color: 0x33333c });
    if (!galeMat) galeMat = new THREE.MeshBasicMaterial({ color: 0x5ee8d2 }); // 天域风弹（批次 C）
  }

  // WitherAI 齐射回调：三发扇形（中央直射 + 左右 ±偏航），从胸前高度射出
  spawnWitherSkullVolley(mob, player) {
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
      this.spawnWitherSkull(start.clone().addScaledVector(dir, 0.9), dir);
    }
  }

  // 守誓巨像风弹齐射（批次 C）：三发扇形；裂心(wide)=五发宽扇（经 k:'gale' 复用 skull 通道）
  spawnGaleVolley(mob, player, wide) {
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
      this.spawnWitherSkull(start.clone().addScaledVector(dir, 1.2), dir, 'gale');
    }
  }

  spawnWitherSkull(pos, dir, kind = 'wither') {
    const g = this.game;
    this.ensureWitherSkullAssets();
    const mesh = new THREE.Mesh(skullGeo, kind === 'gale' ? galeMat : skullMat);
    mesh.position.copy(pos);
    g.renderer.scene.add(mesh);
    g.witherSkulls.push({ mesh, pos: pos.clone(), vel: dir.clone().multiplyScalar(kind === 'gale' ? 18 : 16), life: 6, kind });
    if (g.networkMode && g.net) g.net.sendWitherSkull(pos, dir, kind); // 初速广播（纯视觉）
  }

  // 联机：远端凋灵弹/风弹初速回执——本地生成弹射物（不再广播，防回声环）
  spawnRemoteWitherSkull(x, y, z, dx, dy, dz, kind) {
    const g = this.game;
    this.ensureWitherSkullAssets();
    const pos = new THREE.Vector3(x, y, z);
    const dir = new THREE.Vector3(dx, dy, dz);
    const mesh = new THREE.Mesh(skullGeo, kind === 'gale' ? galeMat : skullMat);
    mesh.position.copy(pos);
    g.renderer.scene.add(mesh);
    g.witherSkulls.push({ mesh, pos, vel: dir.multiplyScalar(kind === 'gale' ? 18 : 16), life: 6, kind });
  }

  updateWitherSkulls(dt) {
    const g = this.game;
    for (let i = g.witherSkulls.length - 1; i >= 0; i--) {
      const s = g.witherSkulls[i];
      s.life -= dt;
      if (s.life <= 0) { this.despawnWitherSkull(i); continue; }
      s.vel.y -= 2.5 * dt; // 微坠（原版黑色头颅直线弹的轻度重力近似）
      s.pos.addScaledVector(s.vel, dt);
      // 命中本地玩家：水平 0.6 格半径 + 身高 1.8 线段距离（AABB 近似）
      const p = g.player;
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
          this.despawnWitherSkull(i);
          continue;
        }
      }
      // 命中方块：湮灭（钉墙语义不适用弹射物——原版凋灵之首触爆）
      const bdef = BlockRegistry.getById(g.world.getBlock(Math.floor(s.pos.x), Math.floor(s.pos.y), Math.floor(s.pos.z)));
      if (bdef && bdef.solid && !bdef.fluid) {
        audio.arrowHit();
        this.despawnWitherSkull(i);
        continue;
      }
      s.mesh.position.copy(s.pos);
    }
  }

  despawnWitherSkull(i) {
    const g = this.game;
    const s = g.witherSkulls[i];
    g.renderer.scene.remove(s.mesh);
    g.witherSkulls.splice(i, 1);
  }
}
