// Beacon.js -- 信标域：金字塔基座等级 / 效果选择与 4s 脉冲续期 / 光柱（自 Game.js 迁出）
//
// Game 侧保留同名薄门面（_getBeaconPower / setBeaconEffect / _pulseBeacon / _updateBeaconPulse /
// _ensureBeaconBeam / _removeBeaconBeam / _breakBeacon / _clearBeaconState），签名与返回语义不变；
// 外部调用面零 diff（BeaconScreen.js:49 调 setBeaconEffect、:60 调 _getBeaconPower）。
//
// 生命周期：构造器共享型（this.beacon = new Beacon(this)），域状态随控制器持有——激活表 beacons /
// 光柱表 beams / 脉冲计时 pulseTimer。光柱是挂在跨存档共享 scene 上的 Three 资源，换世界时仍由
// Game._disposeWorld() 里的门面 _clearBeaconState() 收口（摘 scene + dispose geo/mat），不留幽灵光柱。
// world / player / renderer / chatBox 一律在调用点经 this.game 现取，不留构造期快照（start() 会重建它们）。
import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { BLOCK_CENTER } from './constants.js';
import { t } from '../i18n/index.js';
import { BEACON_EFFECTS } from '../ui/BeaconScreen.js';

// 信标效果名（英文）→ 当前语言显示名（语言包键 = 效果中文 label，见 BeaconScreen.BEACON_EFFECTS）
function beaconEffectLabel(name) {
  const e = BEACON_EFFECTS.find(x => x[0] === name);
  return t(e ? e[1] : name);
}

export class Beacon {
  constructor(game) {
    this.game = game;
    this.beacons = new Map();  // 激活表：key "x,y,z" -> { x, y, z, effect, level, lastPower }
    this.beams = new Map();    // 光柱表：同 key -> THREE.Mesh（纯视觉，换世界必须摘除并 dispose）
    this.pulseTimer = 0;       // 4s 脉冲计时
  }

  // 金字塔等级：从信标正下方逐层向上检测（层 1=3×3 … 层 4=9×9），断层即停
  // Build 5 修复：与原版一致，首层 3×3 起（原误为 5×5 起，整塔多耗 40 块）
  getBeaconPower(x, y, z) {
    const world = this.game.world;
    if (!world) return 0;
    const VALID = new Set(['iron_block', 'gold_block', 'diamond_block', 'emerald_block'].map(n => BlockRegistry.getId(n)));
    let power = 0;
    for (let l = 1; l <= 4; l++) {
      const half = l; // 层 1 → 3×3，层 2 → 5×5，层 3 → 7×7，层 4 → 9×9
      let ok = true;
      for (let dx = -half; dx <= half && ok; dx++) {
        for (let dz = -half; dz <= half && ok; dz++) {
          if (!VALID.has(world.getBlock(x + dx, y - l, z + dz))) ok = false;
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
    this.ensureBeam(key, x, y, z);
    this.pulseBeacon(this.beacons.get(key), level);
    const chatBox = this.game.chatBox;
    if (chatBox) chatBox.add(t('信标已激活：{n} ×{l}', { n: beaconEffectLabel(name), l: Math.min(2, level) }), '#ffd');
  }

  pulseBeacon(b, power) {
    const range = 10 * power;
    const p = this.game.player;
    if (!p || p.dead) return;
    const dx = p.position.x - (b.x + BLOCK_CENTER), dy = p.position.y - b.y, dz = p.position.z - (b.z + BLOCK_CENTER);
    if (dx * dx + dy * dy + dz * dz <= range * range) {
      p.applyEffect(b.effect, Math.min(2, power), 12); // 12s 时长 > 4s 脉冲周期，效果无缝续期
    }
  }

  updateBeaconPulse(dt) {
    if (!this.beacons.size) return;
    this.pulseTimer -= dt;
    if (this.pulseTimer > 0) return;
    this.pulseTimer = 4;
    for (const [key, b] of this.beacons) {
      const power = this.getBeaconPower(b.x, b.y, b.z);
      if (power <= 0) {
        // 基座被拆：信标失效（清效果选择 + 光柱）
        this.beacons.delete(key);
        this.removeBeam(key);
        continue;
      }
      if (power !== b.lastPower) {
        b.lastPower = power;
        b.level = Math.min(2, power); // 基座变化实时调整效果等级
        this.ensureBeam(key, b.x, b.y, b.z);
      }
      this.pulseBeacon(b, power);
    }
  }

  ensureBeam(key, x, y, z) {
    const renderer = this.game.renderer;
    if (!renderer || !renderer.scene) return;
    this.removeBeam(key);
    const h = Math.max(16, 250 - y);
    const geo = new THREE.BoxGeometry(0.4, h, 0.4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2f0dc, transparent: true, opacity: 0.22, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + BLOCK_CENTER, y + h / 2, z + BLOCK_CENTER);
    renderer.scene.add(mesh);
    this.beams.set(key, mesh);
  }

  removeBeam(key) {
    const mesh = this.beams.get(key);
    if (!mesh) return;
    this.game.renderer.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    this.beams.delete(key);
  }

  breakBeacon(x, y, z) {
    const key = `${x},${y},${z}`;
    this.beacons.delete(key);
    this.removeBeam(key);
  }

  clearBeaconState() {
    for (const key of [...this.beams.keys()]) this.removeBeam(key);
    this.beacons = new Map();
    this.pulseTimer = 0;
  }
}
