// build48-tnt.mjs -- B48 轮 2 回归：TNT 激活/引信/爆炸（纯 node，不依赖服务器）
// 断言：
//   ① 方块表：tnt_primed 尾部追加（ID 223）、既有 ID 零漂移、baseBlock='tnt'、三张 SVG 入表且比 tnt 更亮
//   ② 爆炸纯数学：衰减单调/边界、伤害与击退、球形判定、方向向量退化、黑曜石与基岩免疫
//   ③ 引信：4.0s 到期、帧率无关（30fps vs 120fps）、重复点燃不重置、方块被清除即取消、区块未加载冻结
//   ④ 爆炸结算：半径内方块清空 + 黑曜石/基岩留下、连锁点燃错峰、玩家按距离扣血与击退、远处无事
//   ⑤ 红石只点燃不当帧爆炸（旧 detonateTNT 已退场）；存档/区块重载把点燃态归一化回 tnt
//   ⑥ 怪物半径伤害（damageMobsInRadius 走同一套衰减与击退）
//   ⑦ 接线绊线：打火石分支 / 音效 / 批量写通道 / 远端落地通知 / Game 与 NetworkManager 接线
import { readFileSync } from 'fs';
import * as THREE from 'three';
import { World } from '../src/core/World.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { RedstoneSystem } from '../src/core/RedstoneSystem.js';
import { MobManager } from '../src/entity/MobManager.js';
import { TntSystem, FUSE_TIME, CHAIN_DELAY_MIN, CHAIN_DELAY_MAX } from '../src/player/TntSystem.js';
import {
  TNT_RADIUS, TNT_POWER, blastFalloff, blastDamage, blastKnockback, blastDir,
  inBlastSphere, isBlastProof,
} from '../src/core/Explosion.js';
import { ok, finish } from './harness.mjs';

function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
const id = (n) => BlockRegistry.getId(n);
const def = (n) => BlockRegistry.getById(id(n));
const TNT = id('tnt');
const PRIMED = id('tnt_primed');
const STONE = id('stone');
const OBSIDIAN = id('obsidian');
const BEDROCK = id('bedrock');

// ── ① 方块表 ──
{
  const p = def('tnt_primed');
  ok(!!p, 'tnt_primed 已注册');
  ok(p.id === 223, `tnt_primed ID = 223（尾部追加，当前 ${p.id}）`);
  ok(id('stone') === 1 && id('tnt') === 117 && id('grass_path') === 222,
    '既有方块 ID 零漂移（stone=1 / tnt=117 / grass_path=222）');
  ok(p.baseBlock === 'tnt' && p.hardness === 0 && p.transparent === false,
    'baseBlock=tnt / hardness=0 / 不透明（挖掉仍掉 TNT 物品）');
  ok(p.top === 'tnt_primed_top' && p.side === 'tnt_primed_side' && p.bottom === 'tnt_primed_bottom',
    `贴图三键 ${p.top}/${p.side}/${p.bottom}`);
  ok(p.icon === 'tnt_primed_side', `图标取点燃侧面（当前 ${p.icon}）`);
  ok(!!BlockSVGDefinitions.tnt_primed_top && !!BlockSVGDefinitions.tnt_primed_side &&
     !!BlockSVGDefinitions.tnt_primed_bottom, '三张 SVG 都进了图集表');

  const pxs = (svg) => {
    const out = [];
    const re = /<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="rgb\((\d+),(\d+),(\d+)\)"\/>/g;
    let m;
    while ((m = re.exec(svg))) out.push({ r: +m[3], g: +m[4], b: +m[5] });
    return out;
  };
  const lum = (list) => list.reduce((a, c) => a + 0.299 * c.r + 0.587 * c.g + 0.114 * c.b, 0) / (list.length || 1);
  const plain = lum(pxs(BlockSVGDefinitions.tnt_side));
  const primed = lum(pxs(BlockSVGDefinitions.tnt_primed_side));
  ok(primed > plain + 25, `点燃态侧面明显更亮（${primed.toFixed(1)} vs ${plain.toFixed(1)}）`);
  ok(OBSIDIAN > 0 && def('obsidian').blastResist >= 1200, '黑曜石带爆炸免疫抗性（1200）');
}

// ── ② 爆炸纯数学 ──
{
  ok(blastFalloff(0) === 1, '零距离衰减 = 1');
  ok(blastFalloff(TNT_RADIUS * 2) === 0 && blastFalloff(TNT_RADIUS * 3) === 0, '≥2R 衰减 = 0');
  ok(blastFalloff(-1) === 0 && blastFalloff(NaN) === 0 && blastFalloff(Infinity) === 0,
    '非法距离一律 0（联机脏数据兜底）');
  let prev = 1, mono = true;
  for (let d = 0; d <= TNT_RADIUS * 2; d += 0.25) {
    const f = blastFalloff(d);
    if (f > prev + 1e-9) mono = false;
    prev = f;
  }
  ok(mono, '衰减随距离单调不增');
  ok(Math.abs(blastDamage(0) - TNT_POWER) < 1e-9, `点爆伤害 = ${TNT_POWER}（当前 ${blastDamage(0)}）`);
  ok(blastDamage(TNT_RADIUS * 2) === 0, '2R 外无伤害');
  const kb0 = blastKnockback(0), kbFar = blastKnockback(TNT_RADIUS * 2);
  ok(kb0.h > 10 && kb0.v > 5, `点爆击退 (${kb0.h}, ${kb0.v})`);
  ok(kbFar.h === 0 && kbFar.v === 0, '2R 外无击退');
  ok(inBlastSphere(0, 0, 4) && !inBlastSphere(0, 0, 4.5), '球形判定含边界 R');
  ok(blastDir(0, 0, 0) === null, '零距离方向返回 null');
  const dir = blastDir(0, 3, 4);
  ok(dir && Math.abs(dir.dist - 5) < 1e-9 && Math.abs(dir.y - 0.6) < 1e-9, '方向向量单位化');
  ok(isBlastProof(def('bedrock')) && isBlastProof(def('obsidian')), '基岩/黑曜石免疫');
  ok(!isBlastProof(def('stone')) && !isBlastProof(def('tnt')), '石头/TNT 不免疫');
}

// ── 测试场地 ──
function flatWorld(seed = 7) {
  const w = new World(seed);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.ensureChunk(cx, cz);
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) {
    for (let y = 60; y <= 72; y++) w.setBlock(x, y, z, y <= 63 ? STONE : 0, false);
  }
  return w;
}
function makeGame(world) {
  const scene = { added: new Set(), add(o) { this.added.add(o); }, remove(o) { this.added.delete(o); } };
  const player = {
    position: new THREE.Vector3(100, 64, 100), velocity: new THREE.Vector3(), knockback: new THREE.Vector3(),
    spectator: false, dead: false, flying: false, creative: false, hurtCalls: [],
    hurt(a) { this.hurtCalls.push(a); return true; },
  };
  return { world, player, renderer: { scene }, particles: null, mobManager: null };
}

// ── ③ 引信 ──
{
  const world = flatWorld();
  const g = makeGame(world);
  const tnt = new TntSystem(g);
  world.setBlock(2, 64, 2, TNT);
  ok(tnt.prime(2, 64, 2), '点燃 tnt');
  ok(world.getBlock(2, 64, 2) === PRIMED, '点燃后方块变 tnt_primed');
  ok(tnt.has(2, 64, 2) && Math.abs(tnt.remaining(2, 64, 2) - FUSE_TIME) < 1e-9,
    `引信 ${FUSE_TIME}s（当前 ${tnt.remaining(2, 64, 2)}）`);

  // 幂等：重复点燃不重置
  tnt.update(1.0);
  const rem = tnt.remaining(2, 64, 2);
  ok(tnt.prime(2, 64, 2) === true, '重复点燃返回 true（幂等）');
  ok(Math.abs(tnt.remaining(2, 64, 2) - rem) < 1e-9, `重复点燃不重置引信（${rem.toFixed(3)}）`);
  ok(g.renderer.scene.added.size === 1, `引信白光罩挂到场景（${g.renderer.scene.added.size} 个）`);

  // 方块被挖掉 → 取消（不炸）
  world.setBlock(2, 64, 2, 0);
  tnt.update(0.05);
  ok(!tnt.has(2, 64, 2), '方块消失后引信取消');
  ok(g.renderer.scene.added.size === 0, '取消后白光罩被摘除');
  ok(world.getBlock(2, 64, 2) === 0, '未爆炸（方块仍是空气，不是被爆炸清掉的）');

  // 帧率无关：30fps 与 120fps 在同一秒爆炸
  const runTo = (fps) => {
    const w = flatWorld(11);
    const gg = makeGame(w);
    const t = new TntSystem(gg);
    w.setBlock(4, 64, 4, TNT);
    t.prime(4, 64, 4);
    let elapsed = 0;
    const dt = 1 / fps;
    for (let i = 0; i < fps * 6; i++) {
      t.update(dt);
      elapsed += dt;
      if (!t.has(4, 64, 4)) return elapsed;
    }
    return Infinity;
  };
  const e30 = runTo(30), e120 = runTo(120);
  ok(Math.abs(e30 - FUSE_TIME) <= 1 / 30 + 1e-9 && Math.abs(e120 - FUSE_TIME) <= 1 / 120 + 1e-9,
    `30fps/120fps 都在 ${FUSE_TIME}s 爆炸（${e30.toFixed(3)} / ${e120.toFixed(3)}）`);
  ok(Math.abs(e30 - e120) <= 1 / 30, '帧率无关（误差 ≤ 一帧）');

  // 区块未加载 → 冻结（不推进也不取消）
  const w2 = flatWorld(13);
  const g2 = makeGame(w2);
  const t2 = new TntSystem(g2);
  w2.setBlock(2, 64, 2, TNT);
  t2.prime(2, 64, 2);
  t2.update(1.0);
  const chunk = w2.getChunk(0, 0);
  w2.chunks.delete('0,0');
  t2.update(2.0);
  ok(t2.has(2, 64, 2), '区块未加载时引信冻结（不取消）');
  w2.chunks.set('0,0', chunk);
  t2.update(0.1);
  ok(Math.abs(t2.remaining(2, 64, 2) - (FUSE_TIME - 1.1)) < 1e-6, '区块回来后接着烧');
}

// ── ④ 爆炸结算 ──
{
  const world = flatWorld();
  const g = makeGame(world);
  const tnt = new TntSystem(g);
  // 爆心 (2,64,2)：半径内放石头 / 黑曜石 / 基岩 / 远处石头
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) world.setBlock(2 + dx, 64, 2 + dz, STONE, false);
  world.setBlock(2, 64, 2, TNT, false);
  world.setBlock(2, 65, 2, STONE, false);   // 顶上一块
  world.setBlock(1, 64, 1, OBSIDIAN, false);
  world.setBlock(3, 64, 3, BEDROCK, false);
  world.setBlock(2, 64, 9, STONE, false);   // 半径 7 外
  g.player.position.set(2.5, 64, 3.5);      // 爆心旁 1 格
  tnt.prime(2, 64, 2);
  tnt.update(FUSE_TIME + 0.1);
  ok(world.getBlock(2, 64, 2) === 0, '爆心方块被清空');
  ok(world.getBlock(3, 64, 2) === 0 && world.getBlock(2, 65, 2) === 0, '半径内石头被清空');
  ok(world.getBlock(1, 64, 1) === OBSIDIAN, '黑曜石免疫（仍在）');
  ok(world.getBlock(3, 64, 3) === BEDROCK, '基岩免疫（仍在）');
  ok(world.getBlock(2, 64, 9) === STONE, '半径外石头不受影响');
  ok(g.player.hurtCalls.length === 1 && g.player.hurtCalls[0] > 10,
    `玩家近距离被炸伤（${g.player.hurtCalls[0]?.toFixed(2)}）`);
  ok(Math.hypot(g.player.knockback.x, g.player.knockback.z) > 1, '玩家被炸飞（水平冲量）');
  ok(g.player.velocity.y > 1, `玩家被上抛（vy=${g.player.velocity.y.toFixed(2)}）`);
  ok(g.renderer.scene.added.size === 0, '爆炸后白光罩清干净');

  // 远处玩家无事
  const w3 = flatWorld(21);
  const g3 = makeGame(w3);
  const t3 = new TntSystem(g3);
  g3.player.position.set(2.5, 64, 14.5);
  w3.setBlock(2, 64, 2, TNT);
  t3.prime(2, 64, 2);
  t3.update(FUSE_TIME + 0.1);
  ok(g3.player.hurtCalls.length === 0 && g3.player.knockback.length() === 0, '2R 外玩家无伤无击退');

  // 连锁：爆心旁的 tnt 被点燃且错峰；已点燃的只提前、不重置成整 4 秒
  const w4 = flatWorld(31);
  const g4 = makeGame(w4);
  const t4 = new TntSystem(g4);
  w4.setBlock(2, 64, 2, TNT);   // 爆心（先点，先炸）
  w4.setBlock(4, 64, 2, TNT);   // 未点燃的链上 TNT
  w4.setBlock(1, 64, 2, TNT);   // 后点燃的 TNT（剩余 4s，会被爆心提前）
  t4.prime(2, 64, 2);
  t4.update(1.0);               // 爆心先烧 1 秒
  t4.prime(1, 64, 2);           // 后点燃：剩余 4s（比爆心晚 3 秒）
  const rnd = Math.random;
  Math.random = () => 0;        // 固定连锁延迟 = CHAIN_DELAY_MIN
  let guard = 0;
  while (t4.has(2, 64, 2) && guard++ < 600) t4.update(1 / 60);
  Math.random = rnd;
  ok(!t4.has(2, 64, 2) && w4.getBlock(2, 64, 2) === 0, '爆心按时爆炸');
  ok(w4.getBlock(4, 64, 2) === PRIMED, '链上的 tnt 被点燃');
  const chainRem = t4.remaining(4, 64, 2);
  ok(chainRem > 0 && chainRem <= CHAIN_DELAY_MAX + 1e-6 && chainRem >= CHAIN_DELAY_MIN - 1e-6,
    `连锁延迟错峰在 ${CHAIN_DELAY_MIN}~${CHAIN_DELAY_MAX}s（${chainRem.toFixed(3)}）`);
  ok(Math.abs(chainRem - CHAIN_DELAY_MIN) < 0.05, `新点燃的同一帧不推进引信（${chainRem.toFixed(3)}）`);
  const lateRem = t4.remaining(1, 64, 2);
  ok(t4.has(1, 64, 2) && lateRem > 0 && lateRem < 3.0,
    `已点燃的只提前、不重置成整 4 秒（剩 ${lateRem.toFixed(3)}s）`);
  t4.update(1.0);
  ok(w4.getBlock(4, 64, 2) === 0 && w4.getBlock(1, 64, 2) === 0, '连锁 TNT 一秒内自行爆炸');
}

// ── ⑤ 红石只点燃 + 存档归一化 ──
{
  const world = flatWorld(41);
  const rs = new RedstoneSystem(world);
  const calls = [];
  rs.onTntPowered = (x, y, z) => calls.push([x, y, z]);
  world.setBlock(2, 64, 2, id('lever'), false);
  world.setBlock(3, 64, 2, TNT, false);
  rs.onBlockInteract(2, 64, 2, world.getBlock(2, 64, 2));
  rs.update(0.016);
  ok(calls.length === 1 && calls[0][0] === 3 && calls[0][2] === 2, '红石通电回调 TNT 坐标');
  ok(world.getBlock(3, 64, 2) === TNT, '红石不当帧爆炸（旧 detonateTNT 已退场）');
  ok(!srcOf('../src/core/RedstoneSystem.js').includes('detonateTNT'), '源码：detonateTNT 已删除');

  // 归一化：点燃态不落盘
  const w2 = flatWorld(43);
  const c = w2.getChunk(0, 0);
  c.set(2, 64, 2, PRIMED);
  w2._finalizeChunk(c);
  ok(w2.getBlock(2, 64, 2) === TNT, '_finalizeChunk 把 tnt_primed 归一化回 tnt');
}

// ── ⑥ 怪物半径伤害 ──
{
  const mob = {
    position: new THREE.Vector3(2.5, 64, 4.5), height: 1.8, typeName: 'zombie', type: {},
    health: 20, knockback: new THREE.Vector3(), velocity: new THREE.Vector3(),
    hitFlash: 0, dead: false, dyingAnim: null, healthBarSprite: null,
  };
  const fake = { mobs: [mob], _playerPos: null, _updateHealthBar() {} };
  const hits = MobManager.prototype.damageMobsInRadius.call(fake, 2.5, 64.5, 2.5);
  ok(hits === 1, `命中 1 只怪（${hits}）`);
  ok(mob.health < 20, `怪物掉血（${mob.health.toFixed(2)}）`);
  ok(mob.hitFlash > 0, '受击红光');
  ok(Math.hypot(mob.knockback.x, mob.knockback.z) > 1, '怪物被炸退');
  ok(mob.velocity.y > 1, '怪物被上抛');
  // 半径外不挨打
  const far = {
    position: new THREE.Vector3(2.5, 64, 20.5), height: 1.8, typeName: 'zombie', type: {},
    health: 20, knockback: new THREE.Vector3(), velocity: new THREE.Vector3(),
    hitFlash: 0, dead: false, dyingAnim: null, healthBarSprite: null,
  };
  const fake2 = { mobs: [far], _playerPos: null, _updateHealthBar() {} };
  ok(MobManager.prototype.damageMobsInRadius.call(fake2, 2.5, 64.5, 2.5) === 0, '半径外怪物无伤');
}

// ── ⑦ 接线绊线 ──
{
  const ic = srcOf('../src/player/InteractionController.js');
  ok(ic.includes("sel.name === 'flint_and_steel' && targetDef && targetDef.name === 'tnt'") &&
     ic.includes('g.tnt.prime('), '打火石右键 TNT → TntSystem.prime');
  ok(ic.includes('audio.fuseLight('), '点燃有引信音');

  const au = srcOf('../src/audio/AudioEngine.js');
  ok(au.includes('fuseLight(dist = 0)') && au.includes('explosion(dist = 0)'), '音效：引信/爆炸');

  const gm = srcOf('../src/player/Game.js');
  ok(gm.includes('this.redstone.onTntPowered = (x, y, z) => this.tnt.prime(x, y, z)'), 'Game：红石→TNT 接线');
  ok(gm.includes('if (this.tnt) this.tnt.update(dt);'), 'Game：每帧推进引信');
  ok(gm.includes('this.tnt.dispose(); this.tnt = null;'), 'Game：换世界释放 TntSystem');
  ok(gm.includes('this.player.knockback') && gm.includes('Math.pow(0.02, dt)'),
    'Game：玩家击退冲量通道（帧率无关衰减）');

  const nm = srcOf('../src/net/NetworkManager.js');
  ok(nm.includes('world._batchBlockWrites'), '联机：爆炸改动走批量合批通道');
  ok(nm.includes('this.game.tnt.onRemoteBlockChange('), '联机：远端点燃态落地通知 TntSystem');

  const ts = srcOf('../src/player/TntSystem.js');
  ok(ts.includes('world.setBlock(x, y, z, primed, false)'), '点燃态写方块不进存档账本（recordMod=false）');
  ok(ts.includes('world._batchBlockWrites = true') && ts.includes('world._batchBlockWrites = false'),
    '爆炸：批量写开关成对出现（finally 复位）');
  ok(!ts.includes('sendBlock(') && !ts.includes('this.game.net'), 'TNT 不自己发协议消息（只写方块，同步交给 NetworkManager）');
}
finish('build48-tnt');
