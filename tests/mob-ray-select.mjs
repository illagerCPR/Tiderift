// mob-ray-select.mjs -- 第二波 R 路回归：MobManager 射线选怪（F6）/ 方块中心常量（F9）/
// per-mob 清理复用（F8）/ Boss 列表数据源（F10）。
// 纯 node 直跑：Object.create(MobManager.prototype) 驱动真实方法，不依赖服务器/浏览器/端口。
// 断言分组：
//   ① findMobByRay 手算样例：命中 / 未命中 / 背向 / 相切（disc=0）/ 球心恰在射线上 /
//      起点在球内 / 多怪取最近 / 死亡与淡出跳过 / maxDist 内外边界
//   ② 与改造前旧内联判别式参考实现逐例一致（随机对拍）+ 命中点必落在球面（独立几何不变量）
//   ③ attackMob 选择阶段：最近者命中、结算字段、未命中不结算
//   ④ F8：per-mob 清理实现唯一（源码计数）+ dispose() 复用 + 重复 dispose 幂等
//   ⑤ F9：BLOCK_CENTER 同源 + 无裸 +0.5 + 生成/瞬移落点仍是方块中心（行为等价）
//   ⑥ F10：Game 改读 getBosses() + BossBar 无每帧 filter（行为等价）+ Boss 入列/出列路径全覆盖
import { readFileSync } from 'fs';
import * as THREE from 'three';
import '../src/blocks/BlockDefs.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { MobManager } from '../src/entity/MobManager.js';
import { BossBar } from '../src/ui/BossBar.js';
import { BLOCK_CENTER } from '../src/player/constants.js';
import { tName } from '../src/i18n/name.js';

let passed = 0;
const failures = [];
function ok(cond, msg) {
  passed++;
  if (!cond) {
    failures.push(msg);
    console.error('FAIL: ' + msg);
  }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
function countOf(text, needle) { return text.split(needle).length - 1; }

// 伪造 mob：findMobByRay / attackMob 只读这些字段（position 用普通对象即可，方法内只取 x/y/z）
function mkMob(x, y, z, width, height, extra) {
  return Object.assign({
    position: { x, y, z },
    width,
    height,
    dead: false,
    dyingAnim: null,
    typeName: 'zombie',
    type: { name: 'zombie', displayName: '僵尸' },
    health: 20,
    maxHealth: 20,
    hitFlash: 0,
  }, extra || {});
}
function mgr(mobs) {
  const mm = Object.create(MobManager.prototype);
  mm.mobs = mobs;
  return mm;
}

// 改造前的内联判别式（逐字口径）：oc = origin - position; oc.y -= height*0.5; b/c/disc; t = -b - sqrt(disc)
function refFind(origin, dir, mobs, maxDist) {
  let closest = null;
  let closestDist = maxDist;
  for (const m of mobs) {
    if (m.dead || m.dyingAnim) continue;
    const oc = { x: origin.x - m.position.x, y: origin.y - m.position.y, z: origin.z - m.position.z };
    oc.y -= m.height * 0.5; // 球心 = 身体中点
    const b = oc.x * dir.x + oc.y * dir.y + oc.z * dir.z;
    const c = oc.x * oc.x + oc.y * oc.y + oc.z * oc.z - (Math.max(m.width, m.height) * 0.5) ** 2;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > closestDist) continue;
    closestDist = t;
    closest = m;
  }
  return closest ? { mob: closest, distance: closestDist } : null;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randDir(rnd) {
  const z = rnd() * 2 - 1;
  const phi = rnd() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: r * Math.cos(phi), y: z, z: r * Math.sin(phi) };
}

// ── ① findMobByRay 手算样例 ──
const O0 = { x: 0, y: 65, z: 0 };
const DZ = { x: 0, y: 0, z: 1 };
{
  // 命中：球心 (0,65,5)、半径 max(0.6,2)*0.5 = 1 → t = 5 - 1 = 4
  const mob = mkMob(0, 64, 5, 0.6, 2);
  const r = mgr([mob]).findMobByRay(O0, DZ, 6);
  ok(r !== null && r.mob === mob, '命中：返回命中的 mob');
  ok(r !== null && near(r.distance, 4, 1e-12), '命中：t = 5 - 1 = 4，实得 ' + (r && r.distance));
}
{
  // 球心恰落在射线上（正对）——同上口径，另验证返回距离即近根
  const mob = mkMob(0, 64, 5, 0.6, 2);
  const r = mgr([mob]).findMobByRay({ x: 0, y: 65, z: 0 }, { x: 0, y: 0, z: 1 }, 100);
  ok(near(r.distance, 4, 1e-12), '球心恰在射线上：近根 t = 4');
}
{
  // 半径取 max(width, height)：width 1.8 / height 0.9 → r = 0.9，球心 y = 64 + 0.45
  const mob = mkMob(0, 64, 5, 1.8, 0.9);
  const r = mgr([mob]).findMobByRay({ x: 0, y: 64.45, z: 0 }, DZ, 10);
  ok(near(r.distance, 4.1, 1e-12), '半径口径 = max(width,height)*0.5，t = 5 - 0.9 = 4.1，实得 ' + (r && r.distance));
}
{
  // 完全未命中（横向偏移 10 格，半径 1）
  const mob = mkMob(10, 64, 5, 0.6, 2);
  ok(mgr([mob]).findMobByRay(O0, DZ, 100) === null, '完全未命中：横向 10 格 → null');
}
{
  // 背向：球心在射线反方向（z = -5），近根为负 → 未命中
  const mob = mkMob(0, 64, -5, 0.6, 2);
  ok(mgr([mob]).findMobByRay(O0, DZ, 100) === null, '背向：球心在射线反方向 → null');
}
{
  // 背向但半径大到几何上包含起点（球心 z=-0.5，r=1）——旧口径只取近根，仍判未命中
  const mob = mkMob(0, 64.75, -0.5, 2, 2);
  ok(mgr([mob]).findMobByRay({ x: 0, y: 65.75, z: 0 }, DZ, 100) === null, '起点落在球内：近根 < 0 → null（不取远根）');
}
{
  // 起点与球心重合
  const mob = mkMob(0, 64, 5, 0.6, 2);
  ok(mgr([mob]).findMobByRay({ x: 0, y: 65, z: 5 }, DZ, 100) === null, '起点 = 球心：近根 -1 → null');
}
{
  // 相切：球心 (5,1,0)、r=1、起点 (0,0,0) 沿 +X → disc 恰为 0，t = 5
  const mob = mkMob(5, 0, 0, 2, 2);
  const r = mgr([mob]).findMobByRay({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10);
  ok(r !== null && near(r.distance, 5, 1e-12), '相切（disc = 0）：t = 5，实得 ' + (r && r.distance));
}
{
  // 相切外侧擦过：起点下移 0.01（离球心 > r）→ disc < 0 → 未命中
  const mob = mkMob(5, 0, 0, 2, 2);
  ok(mgr([mob]).findMobByRay({ x: 0, y: -0.01, z: 0 }, { x: 1, y: 0, z: 0 }, 10) === null, '相切外侧 0.01：disc < 0 → null');
  ok(mgr([mob]).findMobByRay({ x: 0, y: 0.01, z: 0 }, { x: 1, y: 0, z: 0 }, 10) !== null, '相切内侧 0.01：起点在球内一侧但仍命中（近根为正）');
}
{
  // 多怪取最近（遍历顺序刻意乱序：先远后近）
  const far = mkMob(0, 64, 9, 0.6, 2);
  const mid = mkMob(0, 64, 6, 0.6, 2);
  const near1 = mkMob(0, 64, 3, 0.6, 2);
  const r = mgr([far, near1, mid]).findMobByRay(O0, DZ, 20);
  ok(r !== null && r.mob === near1, '多怪取最近：选中 z=3 的 mob');
  ok(r !== null && near(r.distance, 2, 1e-12), '多怪取最近：distance = 2');
  ok(mgr([far, near1, mid]).findMobByRay({ x: 0, y: 65, z: 4.5 }, DZ, 20).mob === mid,
    '多怪取最近：从更靠前的位置出发选中 z=6 的 mob（不越过射程内的遮挡语义）');
}
{
  // 死亡 / 淡出中跳过（更近但 dead）
  const deadNear = mkMob(0, 64, 3, 0.6, 2, { dead: true });
  const alive = mkMob(0, 64, 6, 0.6, 2);
  ok(mgr([deadNear, alive]).findMobByRay(O0, DZ, 20).mob === alive, 'dead 怪被跳过');
  const dying = mkMob(0, 64, 3, 0.6, 2, { dyingAnim: { progress: 0 } });
  ok(mgr([dying]).findMobByRay(O0, DZ, 20) === null, 'dyingAnim 怪被跳过');
}
{
  // maxDist 边界：t = 4 恰好等于射程时仍命中（旧条件 t > closestDist 才跳过）
  const mob = mkMob(0, 64, 5, 0.6, 2);
  ok(mgr([mob]).findMobByRay(O0, DZ, 4) !== null, 'maxDist 恰等于 t：命中（边界含等号）');
  ok(mgr([mob]).findMobByRay(O0, DZ, 4 - 1e-9) === null, 'maxDist 略小于 t：跳过');
  ok(mgr([mob]).findMobByRay(O0, DZ, 4 + 1e-9) !== null, 'maxDist 略大于 t：命中');
}
{
  // 近怪超射程、远怪在射程内（近怪 t = 4 > maxDist 3 → 跳到远怪 t = 9 > 3 亦超程 → null）
  const a = mkMob(0, 64, 5, 0.6, 2);
  const b = mkMob(0, 64, 10, 0.6, 2);
  ok(mgr([a, b]).findMobByRay(O0, DZ, 3.5) === null, '全部超射程 → null');
  ok(mgr([a, b]).findMobByRay(O0, DZ, 4) !== null, '射程恰好覆盖最近者 → 命中');
}
{
  // 斜向单位方向（与相机 getWorldDirection 输出同口径）
  const dx = 0.6, dy = 0.8;
  const origin = { x: 0, y: 0, z: 0 };
  const dir = { x: dx, y: dy, z: 0 };
  const mob = mkMob(dx * 10, dy * 10 - 1, 0, 2, 2); // 球心 (6,8,0) 在射线上，距起点 10；r = 1 → t = 9
  const r = mgr([mob]).findMobByRay(origin, dir, 20);
  ok(r !== null && near(r.distance, 9, 1e-12), '斜向单位方向：t = 9，实得 ' + (r && r.distance));
}

// ── ② 随机对拍：与旧内联判别式逐例一致 + 命中点落球面 ──
{
  const rnd = mulberry32(0x5EED1234);
  const CONFIGS = 900;
  let hits = 0, bitExact = 0, maxDelta = 0;
  for (let c = 0; c < CONFIGS; c++) {
    const origin = { x: rnd() * 40 - 20, y: rnd() * 40 - 20, z: rnd() * 40 - 20 };
    const dir = randDir(rnd);
    const mobs = [];
    const n = 1 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) {
      const width = 0.3 + rnd() * 1.2;
      const height = 0.5 + rnd() * 3.5;
      let x, y, z;
      if (rnd() < 0.55) {
        // 瞄准射线：球心落在射线上并加小抖动（保证命中样本充足且含擦边）
        const d = 1 + rnd() * 30;
        const cx = origin.x + dir.x * d + (rnd() * 2 - 1) * 0.35;
        const cy = origin.y + dir.y * d + (rnd() * 2 - 1) * 0.35;
        const cz = origin.z + dir.z * d + (rnd() * 2 - 1) * 0.35;
        x = cx; y = cy - height * 0.5; z = cz;
      } else {
        x = origin.x + (rnd() * 60 - 30);
        y = origin.y + (rnd() * 60 - 30);
        z = origin.z + (rnd() * 60 - 30);
      }
      const roll = rnd();
      const extra = roll < 0.08 ? { dead: true } : (roll < 0.16 ? { dyingAnim: { progress: 0 } } : null);
      mobs.push(mkMob(x, y, z, width, height, extra));
    }
    let maxDist = 1 + rnd() * 35;
    // 一半样本把射程推到最近命中 t 附近，专打 maxDist 边界
    const probe = refFind(origin, dir, mobs, Number.POSITIVE_INFINITY);
    if (probe && rnd() < 0.5) maxDist = Math.max(0.001, probe.distance + (rnd() - 0.5));

    const got = mgr(mobs).findMobByRay(origin, dir, maxDist);
    const ref = refFind(origin, dir, mobs, maxDist);
    ok((got === null) === (ref === null), '#' + c + ' 命中判定与旧内联实现一致');
    if (got && ref) {
      hits++;
      ok(got.mob === ref.mob, '#' + c + ' 命中对象与旧内联实现一致');
      const tol = 1e-9 * Math.max(1, Math.abs(ref.distance));
      const delta = Math.abs(got.distance - ref.distance);
      if (delta > maxDelta) maxDelta = delta;
      if (got.distance === ref.distance) bitExact++;
      ok(delta <= tol, '#' + c + ' t 与旧内联实现一致（Δ = ' + delta + '）');
      // 独立几何不变量：命中点必落在球面（球心 = position + height/2，半径 = max(w,h)/2）
      const m = got.mob;
      const cx = m.position.x, cy = m.position.y + m.height * 0.5, cz = m.position.z;
      const px = origin.x + dir.x * got.distance;
      const py = origin.y + dir.y * got.distance;
      const pz = origin.z + dir.z * got.distance;
      const radius = Math.max(m.width, m.height) * 0.5;
      const off = Math.hypot(px - cx, py - cy, pz - cz);
      ok(Math.abs(off - radius) <= 1e-6 * Math.max(1, radius), '#' + c + ' 命中点落在球面（|p-c| - r = ' + (off - radius) + '）');
    }
  }
  console.log('随机对拍: ' + CONFIGS + ' 组配置，命中 ' + hits + ' 组，t 逐位相同 ' + bitExact + ' 组，'
    + '最大 Δ = ' + maxDelta);
  ok(hits >= 300, '随机对拍样本量：命中组数 ' + hits + ' >= 300');
}

// ── ③ attackMob 选择阶段 ──
{
  const near1 = mkMob(0, 64, 3, 0.6, 2, { knockback: new THREE.Vector3() });
  const far1 = mkMob(0, 64, 6, 0.6, 2, { knockback: new THREE.Vector3() });
  const mm = Object.create(MobManager.prototype);
  mm.mobs = [far1, near1];
  mm._playerPos = null; // node 侧无玩家位置：命中音距离走兜底 10
  const O = new THREE.Vector3(0, 65, 0);
  const D = new THREE.Vector3(0, 0, 1);
  const hit = mm.attackMob(O, D, 8, 3);
  ok(hit === true, 'attackMob：命中返回 true');
  ok(near1.health === 17, 'attackMob：最近怪扣血 3（实得 ' + near1.health + '）');
  ok(far1.health === 20, 'attackMob：更远的怪未被结算');
  ok(typeof near1.playerHitAt === 'number' && near1.playerHitAt > 0, 'attackMob：写入 playerHitAt（击杀归属判定）');
  ok(near1.hitFlash > 0, 'attackMob：置受击红光');
  ok(near1.knockback.z === 6.5 && near1.knockback.y === 5, 'attackMob：击退按射线方向施加（水平 6.5 / 上抛 5）');
  ok(near1.dead === false, 'attackMob：伤害未致死时不置 dead');
}
{
  // 未命中：射线方向偏开（球心在反方向）
  const mob = mkMob(0, 64, -6, 0.6, 2, { knockback: new THREE.Vector3() });
  const mm = Object.create(MobManager.prototype);
  mm.mobs = [mob];
  const miss = mm.attackMob(new THREE.Vector3(0, 65, 0), new THREE.Vector3(0, 0, 1), 8, 3);
  ok(miss === false, 'attackMob：背向未命中返回 false');
  ok(mob.health === 20 && mob.hitFlash === 0, 'attackMob：未命中不结算任何副作用');
}
{
  // maxDist 口径与 findMobByRay 一致（t = 5 > 4.5 → 未命中）
  const mob = mkMob(0, 64, 6, 0.6, 2, { knockback: new THREE.Vector3() });
  const mm = Object.create(MobManager.prototype);
  mm.mobs = [mob];
  const O = new THREE.Vector3(0, 65, 0);
  const D = new THREE.Vector3(0, 0, 1);
  ok(mm.attackMob(O, D, 4.5, 3) === false, 'attackMob：maxDist 不足时未命中');
  ok(mob.health === 20, 'attackMob：超射程不扣血');
  ok(mm.attackMob(O, D, 5, 3) === true && mob.health === 17, 'attackMob：maxDist 恰等于 t 时命中并扣血');
}
{
  // 死亡 / 淡出中不可被攻击
  const dead = mkMob(0, 64, 3, 0.6, 2, { dead: true, knockback: new THREE.Vector3() });
  const dying = mkMob(0, 64, 3, 0.6, 2, { dyingAnim: { progress: 0 }, knockback: new THREE.Vector3() });
  const O = new THREE.Vector3(0, 65, 0);
  const D = new THREE.Vector3(0, 0, 1);
  const mmDead = Object.create(MobManager.prototype); mmDead.mobs = [dead];
  const mmDying = Object.create(MobManager.prototype); mmDying.mobs = [dying];
  ok(mmDead.attackMob(O, D, 8, 3) === false, 'attackMob：dead 怪不可被攻击');
  ok(mmDying.attackMob(O, D, 8, 3) === false, 'attackMob：dyingAnim 怪不可被攻击');
}
{
  // 致死：health 归零且不为负；Boss 免疫击退
  const mob = mkMob(0, 64, 3, 0.6, 2, { knockback: new THREE.Vector3(), type: { name: 'dragon', displayName: '末影龙', boss: true } });
  const mm = Object.create(MobManager.prototype);
  mm.mobs = [mob];
  ok(mm.attackMob(new THREE.Vector3(0, 65, 0), new THREE.Vector3(0, 0, 1), 8, 999) === true, 'attackMob：致死一击返回 true');
  ok(mob.health === 0 && mob.dead === true, 'attackMob：血量归零并置 dead（不为负）');
  ok(mob.knockback.length() === 0, 'attackMob：type.boss 免疫击退');
}
{
  // 中立生物激怒（未被本次改造触碰，验证选择分支后的既有路径未被破坏）
  const piglin = mkMob(0, 64, 3, 0.6, 2, {
    knockback: new THREE.Vector3(), typeName: 'zombified_piglin', type: { name: 'zombified_piglin', displayName: '僵尸猪灵', neutral: true },
  });
  const mm = Object.create(MobManager.prototype);
  mm.mobs = [piglin];
  mm.attackMob(new THREE.Vector3(0, 65, 0), new THREE.Vector3(0, 0, 1), 8, 3);
  ok(piglin.aggro === true && piglin.aggroTimer === 25, 'attackMob：中立怪被激怒 25s');
  const piglin2 = mkMob(0, 64, 3, 0.6, 2, {
    knockback: new THREE.Vector3(), typeName: 'zombified_piglin', type: { name: 'zombified_piglin', displayName: '僵尸猪灵', neutral: true },
  });
  const mm2 = Object.create(MobManager.prototype);
  mm2.mobs = [piglin2];
  mm2.attackMob(new THREE.Vector3(0, 65, 0), new THREE.Vector3(0, 0, 1), 8, 3, { provoke: false });
  ok(piglin2.aggro === undefined, 'attackMob：opts.provoke=false 不激怒（创造玩家口径）');
}

// ── ④ F8：per-mob 清理唯一 + dispose 复用 + 幂等 ──
const mmSrc = srcOf('../src/entity/MobManager.js');
{
  ok(countOf(mmSrc, 'mob.mesh.material.dispose()') === 1, 'per-mob 清理：mesh material dispose 全仓唯一');
  ok(countOf(mmSrc, 'mob.healthBarSprite.material.dispose()') === 1, 'per-mob 清理：血条 material dispose 全仓唯一');
  ok(countOf(mmSrc, 'mob.healthBarTex.dispose()') === 1, 'per-mob 清理：血条 texture dispose 全仓唯一');
  ok(countOf(mmSrc, 'this.scene.remove(mob.mesh)') === 1, 'per-mob 清理：scene.remove(mesh) 全仓唯一');
  ok(countOf(mmSrc, 'this.scene.remove(mob.healthBarSprite)') === 1, 'per-mob 清理：scene.remove(sprite) 全仓唯一');
  ok(mmSrc.includes('for (const mob of this.mobs) this._removeMobResources(mob);'), 'dispose() 逐只复用 _removeMobResources');
  ok(countOf(mmSrc, 'this._removeMobResources(') === 5, 'per-mob 清理调用点共 5 处（死亡动画/随村清扫/末地城清扫/despawn/dispose）');
}
{
  const removed = [];
  const disposed = [];
  const scene = { remove: (o) => { removed.push(o); } };
  const mm = Object.create(MobManager.prototype);
  mm.scene = scene;
  const mesh = { material: { dispose: () => disposed.push('meshMat') } };
  const sprite = { material: { dispose: () => disposed.push('barMat') } };
  const barTex = { dispose: () => disposed.push('barTex') };
  const mob = { mesh, healthBarSprite: sprite, healthBarTex: barTex, healthBarCanvas: {}, healthBarCtx: {} };
  mm.mobs = [mob];
  mm._bosses = [mob];
  mm.mobGeometries = new Map([['zombie', { dispose: () => disposed.push('geo') }]]);
  mm.mobMaterials = new Map([['zombie', { map: { dispose: () => disposed.push('skinTex') }, dispose: () => disposed.push('mat') }]]);
  mm.mobTextures = new Map([['zombie', {}]]);
  mm.droppedItems = [];
  mm._pendingPickup = new Map();

  mm.dispose();
  ok(removed.length === 2 && removed[0] === mesh && removed[1] === sprite, 'dispose()：从 scene 移除 mesh 与血条 sprite');
  ok(disposed.filter((x) => x === 'meshMat').length === 1, 'dispose()：per-mob mesh material 释放一次');
  ok(disposed.filter((x) => x === 'barMat').length === 1, 'dispose()：血条 material 释放一次');
  ok(disposed.filter((x) => x === 'barTex').length === 1, 'dispose()：血条 texture 释放一次');
  ok(disposed.filter((x) => x === 'geo').length === 1, 'dispose()：type 级共享 geometry 仍释放一次');
  ok(disposed.filter((x) => x === 'mat').length === 1 && disposed.filter((x) => x === 'skinTex').length === 1,
    'dispose()：type 级共享 material + skin texture 仍释放一次');
  ok(mob.healthBarSprite === null && mob.healthBarTex === null && mob.healthBarCanvas === null && mob.healthBarCtx === null,
    'F8 语义增强：_removeMobResources 置空血条字段（旧 dispose 未置空）');
  ok(mm.mobs.length === 0 && mm._bosses.length === 0, 'dispose()：清空 mobs 与 Boss 登记表');
  ok(mm.mobGeometries.size === 0 && mm.mobMaterials.size === 0, 'dispose()：清空 type 级共享资源表');

  const removedBefore = removed.length;
  const disposedBefore = disposed.length;
  let threw = null;
  try { mm.dispose(); } catch (e) { threw = e; }
  ok(threw === null, '重复 dispose() 不抛错（实得 ' + threw + '）');
  ok(removed.length === removedBefore, '重复 dispose() 不再从 scene 移除对象');
  ok(disposed.length === disposedBefore, '重复 dispose() 不重复释放已释放对象');
}

// ── ⑤ F9：BLOCK_CENTER ──
{
  ok(BLOCK_CENTER === 0.5, 'BLOCK_CENTER 冻结值 = 0.5');
  ok(!/\+\s*0\.5\b/.test(mmSrc), 'MobManager 内已无裸 +0.5 方块中心魔数');
  ok(countOf(mmSrc, 'x + BLOCK_CENTER') === 5, 'x 方向方块中心改用 BLOCK_CENTER 共 5 处');
  ok(countOf(mmSrc, 'z + BLOCK_CENTER') === 5, 'z 方向方块中心改用 BLOCK_CENTER 共 5 处');
  ok(countOf(mmSrc, 'Math.random() < 0.5') === 2, '概率判断（Math.random() < 0.5）保持原样 2 处');
  ok(mmSrc.includes('mob.position.set(x + BLOCK_CENTER, y + 1, z + BLOCK_CENTER);'), '_teleportMob：只换方块中心，y + 1 不变');
  ok(countOf(mmSrc, 'BLOCK_CENTER') === 11, 'BLOCK_CENTER 在该文件出现 11 次（1 import + 10 处偏移）');
}
{
  // 行为等价：trySpawn 被动群落点仍是整数格 + 0.5
  const grass = BlockRegistry.getId('grass_block');
  ok(grass != null, 'BlockRegistry 已注册 grass_block（node 侧导入 BlockDefs 生效）');
  const world = { dimension: 'overworld', getBlock: (x, y, z) => (y === 63 ? grass : 0) };
  const mm = Object.create(MobManager.prototype);
  mm.world = world;
  mm.mobs = [];
  mm.spawnEnabled = true;
  const spawns = [];
  mm._spawnAt = (typeName, x, y, z) => spawns.push([typeName, x, y, z]);
  const seq = [0.5, 0.5, 0.1, 0.0, 0.0];
  let i = 0;
  const origRandom = Math.random;
  Math.random = () => (i < seq.length ? seq[i++] : 0.5);
  try { mm.trySpawn({ x: 0, y: 64, z: 0 }, false); } finally { Math.random = origRandom; }
  ok(spawns.length === 2, '被动群生成 2 只（n = 2 + floor(0*2)），实得 ' + spawns.length);
  ok(spawns[0][0] === 'cow' && spawns[0][2] === 64, '落点：类型 cow、立足面 y = 64 上方一格');
  let centers = 0;
  for (const s of spawns) {
    if (s[1] === Math.floor(s[1]) + 0.5 && s[3] === Math.floor(s[3]) + 0.5) centers++;
  }
  ok(centers === spawns.length, '落点 x/z 恒为方块中心（+0.5）：' + centers + '/' + spawns.length);
}
{
  // 行为等价：_teleportMob 瞬移落点仍是方块中心，y 仍是实心顶面 + 1
  const stone = BlockRegistry.getId('stone');
  ok(stone != null, 'BlockRegistry 已注册 stone');
  const world = { dimension: 'overworld', getBlock: (x, y, z) => (y === 63 ? stone : 0) };
  const mm = Object.create(MobManager.prototype);
  mm.world = world;
  const mob = mkMob(7.3, 70, -3.2, 0.6, 1.95, {
    position: new THREE.Vector3(7.3, 70, -3.2), velocity: new THREE.Vector3(),
  });
  const origRandom = Math.random;
  Math.random = () => 0.5;
  let tp = null;
  try { tp = mm._teleportMob(mob); } finally { Math.random = origRandom; }
  ok(tp === true, '_teleportMob：下探找到落点返回 true');
  ok(mob.position.x === Math.floor(mob.position.x) + BLOCK_CENTER
    && mob.position.z === Math.floor(mob.position.z) + BLOCK_CENTER, '瞬移落点 x/z 仍是方块中心');
  ok(mob.position.y === 64, '瞬移落点 y = 实心顶面(63) + 1，未被 F9 改动');
  ok(mob.velocity.x === 0 && mob.velocity.y === 0 && mob.velocity.z === 0, '瞬移清零速度（未受影响）');
}

// ── ⑥ F10：Boss 列表数据源 ──
{
  const gameSrc = srcOf('../src/player/Game.js');
  ok(gameSrc.includes('this.bossBar.update(this.mobManager ? this.mobManager.getBosses() : []);'),
    'Game 侧改读 mobManager.getBosses()');
  ok(!gameSrc.includes('this.mobManager.mobs.filter(m => m.type && m.type.boss)'),
    'Game 侧每帧 filter 分配已删除');
  ok(countOf(gameSrc, 'getBosses()') === 1, 'getBosses() 调用点唯一');
  ok(countOf(gameSrc, '// Boss 血条（存活的 type.boss 实体：末影龙 / 凋灵可并存各占一条）') === 1, '原注释保持不变');
  ok(/if \(this\.bossBar\) \{\s*\n\s*this\.bossBar\.update\(/.test(gameSrc), 'bossBar 判空守卫保持不变');

  const bbSrc = srcOf('../src/ui/BossBar.js');
  ok(countOf(bbSrc, '.filter(') === 0, 'BossBar 每帧不再 filter 新建数组');
  ok(bbSrc.includes('// F10：只读单循环遍历（不新建数组）——先计数决定显隐，再逐只建行'), 'BossBar 单循环实现（先计数后建行）');
  ok(bbSrc.includes('r.label.textContent = tName(mob.type.name, mob.type.displayName);'), 'label 用 tName(name, displayName) 口径不变');
  ok(bbSrc.includes("r.fill.style.width = (ratio * 100).toFixed(1) + '%';"), '宽度 ratio 公式与 toFixed(1) 不变');

  ok(mmSrc.includes('this._bosses = []; // F10：type.boss 实体登记表（与 this.mobs 同步增删，getBosses() 零分配返回）'),
    'MobManager 构造期建 _bosses 登记表');
  ok(/getBosses\(\) \{\n    return this\._bosses;\n  \}/.test(mmSrc), 'getBosses() 直接返回内部数组（零分配）');
  ok(mmSrc.includes('if (mob.type && mob.type.boss) this._bosses.push(mob);'), 'spawnMob 登记 Boss（判据 mob.type.boss）');
  ok(countOf(mmSrc, 'this.mobs.push(mob)') === 1, 'this.mobs 只有 spawnMob 一个入列点');
  const lines = mmSrc.split('\n');
  let spliceCount = 0;
  let covered = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('this.mobs.splice(i, 1)')) {
      spliceCount++;
      if (lines[i - 1].includes('this._untrackBoss(')) covered++;
    }
  }
  ok(spliceCount === 4, 'this.mobs 出列路径共 4 处，实得 ' + spliceCount);
  ok(covered === spliceCount, '每条出列路径都先 _untrackBoss（' + covered + '/' + spliceCount + '）');
  const disposeBody = mmSrc.slice(mmSrc.indexOf('dispose() {'));
  ok(disposeBody.includes('this._bosses = [];'), 'dispose() 清空 Boss 登记表');
}
{
  const mm = Object.create(MobManager.prototype);
  const boss = mkMob(0, 0, 0, 1, 1, { type: { name: 'dragon', displayName: '末影龙', boss: true } });
  const boss2 = mkMob(0, 0, 0, 1, 1, { type: { name: 'wither', displayName: '凋灵', boss: true } });
  const normal = mkMob(0, 0, 0, 1, 1);
  mm._bosses = [boss];
  mm._untrackBoss(normal);
  ok(mm._bosses.length === 1 && mm._bosses[0] === boss, '_untrackBoss：非 Boss 无操作');
  mm._untrackBoss(boss);
  ok(mm._bosses.length === 0, '_untrackBoss：Boss 出列');
  let threw = null;
  try { mm._untrackBoss(boss); } catch (e) { threw = e; }
  ok(threw === null && mm._bosses.length === 0, '_untrackBoss：重复出列不抛错');
  const arr = [boss2];
  mm._bosses = arr;
  ok(mm.getBosses() === arr, 'getBosses() 返回内部数组本体（零分配，不 filter 不复刻）');
  ok(mm.getBosses() === mm.getBosses(), 'getBosses() 多次调用返回同一引用');
}
{
  // BossBar.update 行为等价（stub 掉 _row，只验证显隐/建行/文本/宽度）
  const rows = [];
  const bb = Object.create(BossBar.prototype);
  bb.el = { style: {} };
  bb.rows = new Map();
  // stub _row：按 typeName 缓存（复刻真实实现的行复用语义），只记录新建的行
  bb._row = (mob) => {
    let r = bb.rows.get(mob.type.name);
    if (!r) {
      r = { label: { textContent: '' }, fill: { style: {} } };
      bb.rows.set(mob.type.name, r);
      rows.push(r);
    }
    return r;
  };
  const alive = { type: { name: 'dragon', displayName: '末影龙' }, health: 100, maxHealth: 200, dead: false, dyingAnim: null };
  const deadBoss = { type: { name: 'wither', displayName: '凋灵' }, health: 0, maxHealth: 300, dead: true, dyingAnim: null };
  const dyingBoss = { type: { name: 'wither', displayName: '凋灵' }, health: 1, maxHealth: 300, dead: false, dyingAnim: { progress: 0.1 } };
  const list = [alive, deadBoss, dyingBoss];
  bb.update(list);
  ok(bb.el.style.display === 'block', '有存活 Boss：display = block');
  ok(rows.length === 1, '死亡 / 淡出中的 Boss 不建行，实得 ' + rows.length + ' 行');
  ok(rows[0].label.textContent === tName('dragon', '末影龙'), '行 label 用 tName(name, displayName)');
  ok(rows[0].fill.style.width === '50.0%', '宽度 = ratio*100 保留 1 位小数，实得 ' + rows[0].fill.style.width);
  ok(list.length === 3 && list[0] === alive, 'update() 只读遍历，不修改传入数组');

  bb.update([alive]);
  ok(rows.length === 1, '同一 Boss 复用已有行（不重复建行）');
  bb.update([]);
  ok(bb.el.style.display === 'none', '空列表：display = none');
  bb.update(null);
  ok(bb.el.style.display === 'none', 'null：display = none（防御不变）');
  bb.update([null, undefined, alive]);
  ok(bb.el.style.display === 'block' && rows.length === 1, '数组含 null/undefined 项：跳过且不影响显隐');
  const bleeding = { type: { name: 'dragon', displayName: '末影龙' }, health: 250, maxHealth: 200, dead: false, dyingAnim: null };
  bb.update([bleeding]);
  ok(rows[0].fill.style.width === '100.0%', '血量超额：ratio clamp 到 1 → 100.0%');
}

// ── 汇总 ──
const failed = failures.length;
const total = passed;
if (failed === 0) {
  console.log('mob-ray-select: ' + total + ' 断言全部通过');
  console.log('RESULT: ALL PASS — ' + total + '/' + total);
} else {
  console.log('mob-ray-select: ' + (total - failed) + '/' + total + ' 断言通过，' + failed + ' 失败');
  console.log('RESULT: FAIL — ' + failed + '/' + total + ' assertions failed');
  process.exitCode = 1;
}
