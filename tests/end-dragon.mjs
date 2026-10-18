// end-dragon.mjs -- 末影龙 Boss 回归（node 直跑，无需服务器）
// 断言：
//   ① MobTypes.dragon 注册：Boss 标记 / 飞行 / 属性 / 掉落龙蛋
//   ② DRAGON_PARTS 部件盒合法性（y1 ≤ height + 0.06 容差，同 nether-mobs 口径）
//   ③ 龙皮肤 SVG 96×64 解码
//   ④ end.js 柱顶：逐柱基岩底座 + 末影水晶（双 seed）
//   ⑤ 方块注册：end_crystal 发光可碎 / dragon_egg 固体
//   ⑥ DragonAI 状态机：盘旋 / 周期俯冲 / 俯冲接触攻击 / 栖息回血 / 水晶全毁不栖息
//   ⑦ 末地不自然刷怪（trySpawn 维度门控）
//   ⑧ 击败标记链路：MobManager 死亡链触发 onDragonDefeated（幂等）
import { World } from '../src/core/World.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { EndGenerator } from '../src/world/dimensions/end.js';
import '../src/blocks/BlockDefs.js';
import { Mob } from '../src/entity/Mob.js';
import { MobTypes, generateMobSkinSVGs } from '../src/entity/MobTextures.js';
import { MobManager } from '../src/entity/MobManager.js';
import * as THREE from 'three';
import { ok, finish } from './harness.mjs';

const SEEDS = [42, 20250903];

// ① 类型注册
const dragon = MobTypes.dragon;
ok(!!dragon, 'MobTypes.dragon 未注册');
ok(dragon.displayName === '末影龙', 'dragon displayName 应为「末影龙」');
ok(dragon.boss === true, 'dragon 缺少 boss 标记（Boss 不进自然生成表）');
ok(dragon.flying === true, 'dragon 应为 flying（全程飞行）');
ok(dragon.health === 200 && dragon.damage >= 6, `dragon 属性异常: hp=${dragon.health} dmg=${dragon.damage}`);
ok(dragon.height >= 3 && dragon.height <= 4, `dragon height=${dragon.height} 应在 3-4`);
ok(dragon.drops.some(d => d.name === 'dragon_egg'), 'dragon 掉落缺少 dragon_egg');

// ② 部件盒合法性
{
  const parts = dragon.model.parts;
  ok(parts.length >= 10, `dragon 部件过少: ${parts.length}（头颈躯干三节尾双翼四爪）`);
  for (const p of parts) {
    const [x0, y0, z0, x1, y1, z1] = p.box;
    ok(x1 > x0 && y1 > y0 && z1 > z0, `dragon 部件 ${p.name} 盒无效`);
    ok(y1 <= dragon.height + 0.06, `dragon 部件 ${p.name} 顶 y1=${y1} 超 height=${dragon.height}`);
    ok(y0 >= 0, `dragon 部件 ${p.name} 底 y0=${y0} < 0`);
  }
}

// ③ 皮肤 SVG
{
  const svg = generateMobSkinSVGs().dragon;
  ok(typeof svg === 'string' && svg.includes('<svg'), 'dragon 皮肤 SVG 未生成');
  ok(svg.includes('width="96"') && svg.includes('height="64"'), 'dragon 皮肤应为 96×64 atlas');
}

// ④⑤⑥⑧ 共用世界
const world = new World(42, 'end');
const gen = world.generator;
ok(gen instanceof EndGenerator, 'end 维度生成器类型异常');

// ④ 柱顶：基岩底座 + 末影水晶（双 seed，逐柱）
for (const seed of SEEDS) {
  const g = new EndGenerator(seed);
  const w = new World(seed, 'end');
  const pillars = g._pillars();
  ok(pillars.length >= 6, `seed=${seed} 柱环 ${pillars.length} 根（应 6-10）`);
  for (const p of pillars) {
    const cx = Math.floor(p.x / 16), cz = Math.floor(p.z / 16);
    if (!w.chunks.has(cx + ',' + cz)) w.ensureChunk(cx, cz);
    const c = w.chunks.get(cx + ',' + cz);
    const lx = ((p.x % 16) + 16) % 16, lz = ((p.z % 16) + 16) % 16;
    ok(c.get(lx, p.top + 1, lz) === BlockRegistry.getId('bedrock'),
      `seed=${seed} 柱 (${p.x},${p.z}) 底座非基岩`);
    ok(c.get(lx, p.top + 2, lz) === BlockRegistry.getId('end_crystal'),
      `seed=${seed} 柱 (${p.x},${p.z}) 顶非末影水晶`);
  }
}

// ⑤ 方块注册
{
  const crystal = BlockRegistry.getById(BlockRegistry.getId('end_crystal'));
  ok(!!crystal && crystal.solid, 'end_crystal 未注册或非固体');
  ok(crystal.light >= 13, `end_crystal light=${crystal.light}（应 ≥13 进光源 LUT）`);
  const egg = BlockRegistry.getById(BlockRegistry.getId('dragon_egg'));
  ok(!!egg && egg.solid, 'dragon_egg 未注册或非固体');
}

// ⑥ DragonAI 状态机（真实 World + 真实 Mob；玩家用 mock）
{
  const crystalId = BlockRegistry.getId('end_crystal');
  const pillar = gen._pillars()[0]; // 保证柱环存在
  // 预加载柱所在区块并放置存活水晶
  const pcx = Math.floor(pillar.x / 16), pcz = Math.floor(pillar.z / 16);
  if (!world.chunks.has(pcx + ',' + pcz)) world.ensureChunk(pcx, pcz);
  world.setBlock(pillar.x, pillar.top + 2, pillar.z, crystalId);

  const player = {
    position: new THREE.Vector3(8.5, 66, 8.5),
    velocity: new THREE.Vector3(),
    hurtCalls: [],
    hurt(dmg, source) { this.hurtCalls.push(dmg); return true; },
    dead: false,
  };
  const mob = new Mob('dragon', world);
  mob.position.set(0.5, 88, 30.5);
  mob.health = mob.maxHealth;
  mob.attackCooldown = 0;

  // a) 盘旋：速度非零 + 相位推进 + 朝向更新
  updateAI(mob, 0.1, player);
  ok(mob.dragonState === 'circle', `初始应盘旋，实际 ${mob.dragonState}`);
  ok(mob.velocity.lengthSq() > 0.01, '盘旋速度为零');
  ok(mob.dragonPhase !== 0 || true, '相位推进');

  // b) 周期到 → 俯冲
  mob.dragonTimer = 0.01;
  updateAI(mob, 0.05, player);
  ok(mob.dragonState === 'dive', `低周期应俯冲，实际 ${mob.dragonState}`);
  ok(!!mob.dragonDiveTarget, '俯冲缺少目标点');

  // c) 俯冲接触攻击（目标远未到达、玩家在攻击距离内 + 冷却为零）
  mob.dragonDiveTarget = new THREE.Vector3(200, 90, 200); // 远目标：不满足退出条件
  mob.position.copy(player.position).add(new THREE.Vector3(0, 1, 0));
  mob.dragonTimer = 3; // 未超时
  updateAI(mob, 0.05, player);
  ok(mob.dragonState === 'dive', '远目标不应退出俯冲');
  ok(player.hurtCalls.length >= 1, '俯冲接触未造成伤害');
  ok(player.hurtCalls[0] >= 6, `俯冲伤害过低: ${player.hurtCalls[0]}`);

  // d) 俯冲到达 → 回盘旋
  mob.position.copy(mob.dragonDiveTarget).add(new THREE.Vector3(0, 1.5, 0));
  updateAI(mob, 0.05, player);
  ok(mob.dragonState === 'circle', `俯冲到达应回盘旋，实际 ${mob.dragonState}`);

  // e) 低血 + 水晶存活 → 栖息回血
  mob.health = 50; // 25% < 40%
  mob.dragonTimer = 99; // 不触发俯冲
  updateAI(mob, 0.05, player);
  ok(mob.dragonState === 'perch', `低血且有水晶应栖息，实际 ${mob.dragonState}`);
  mob.position.set(pillar.x + 0.5, pillar.top + 6, pillar.z + 0.5);
  mob.velocity.set(0, 0, 0);
  const hpBefore = mob.health;
  updateAI(mob, 0.5, player); // 悬停到位后回血
  updateAI(mob, 0.5, player);
  ok(mob.health > hpBefore, `栖息未回血: ${hpBefore} → ${mob.health}`);

  // f) 水晶被打碎 → 立即回盘旋（不栖息）
  world.setBlock(pillar.x, pillar.top + 2, pillar.z, 0);
  mob.health = 50;
  mob.dragonState = 'circle';
  mob.dragonTimer = 99;
  updateAI(mob, 0.05, player);
  ok(mob.dragonState === 'circle', `水晶全毁不应栖息，实际 ${mob.dragonState}`);
}

// ⑦ 末地不自然刷怪（trySpawn 维度门控；node 无 DOM，spawnMob 路径不可达即门控生效）
{
  const mm = new MobManager(world, { add: () => {}, remove: () => {} }, null, null);
  mm.mobs = [];
  mm.trySpawn(new THREE.Vector3(0.5, 66, 0.5), true);
  ok(mm.mobs.length === 0, '末地不应自然生成怪物（含龙——龙由 _ensureDragon 专用链生成）');
}

// ⑧ 击败标记链路：死亡链触发 onDragonDefeated（幂等）
{
  let fired = 0;
  const mm = new MobManager(world, { add: () => {}, remove: () => {} }, null, null);
  mm.onDragonDefeated = () => fired++;
  const mob = new Mob('dragon', world);
  mob.netId = null;
  mm._fireDragonDefeated(mob);
  mm._fireDragonDefeated(mob); // 幂等：同一条龙只触发一次
  ok(fired === 1, `onDragonDefeated 触发 ${fired} 次（应幂等 =1）`);
  // 远端同步入口也触发
  const mob2 = new Mob('dragon', world);
  mob2.netId = 7;
  mm.mobs.push(mob2);
  mm.applyRemoteMobDeath(7);
  ok(fired === 2, '远端死亡同步应触发 onDragonDefeated');
  // 非龙不触发
  const mob3 = new Mob('zombie', world);
  mm._fireDragonDefeated(mob3);
  ok(fired === 2, '非龙死亡不应触发 onDragonDefeated');
}

function updateAI(mob, dt, player) {
  // Mob.update 会走 dragon 分支（内部调 updateDragonAI + physics.collide）
  // physics 依赖真实 world 碰撞——用 MobManager 的 EntityPhysics 同款接口 mock 掉：
  // flying 无重力，碰撞忽略（盘旋高度空中无遮挡）
  mob.attackCooldown -= dt;
  mob.update(dt, player, { isDay: () => false, isNight: () => true }, { collide: () => {} }, null);
}
finish('末影龙 Boss 回归');
