// aether-boss.mjs -- 守誓巨像 Boss 回归（天域批次 C，纯 node 直跑，无需服务器）
// 断言：
//   ① 注册：MobTypes.storm_colossus（boss 标记/HP/掉落/模型/皮肤/名字表）
//   ② 状态机：rise→guard→storm→rupture 阶段推进（只进不退）
//   ③ 齐射回调：风暴单段 3 发 / 裂心双段 2×5 发（stub mobManager 计数）
//   ④ 震地回调：岩卫周期震地 → onColossusSlam 触发（手动积分模拟位移）
//   ⑤ 合成：风暴图腾 3×3 配方匹配
import * as THREE from 'three';
import { MobTypes, generateMobSkinSVGs } from '../src/entity/MobTextures.js';
import { Mob } from '../src/entity/Mob.js';
import { updateColossusAI } from '../src/entity/StormColossusAI.js';
import { World } from '../src/core/World.js';
import { matchRecipe } from '../src/core/Crafting.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { ok, finish, configure } from './harness.mjs';
configure({ verbose: true });

const world = new World(42, 'aether');
const player = { position: new THREE.Vector3(0.5, 97, 0.5), dead: false, hurt: () => false };
let shootCount = 0, shootWide = false, slamCount = 0;
const mgr = {
  onColossusShoot: (mob, pl, wide) => { shootCount++; shootWide = !!wide; },
  onColossusSlam: () => { slamCount++; },
};

// ① 注册
{
  const t = MobTypes.storm_colossus;
  ok(!!t, 'MobTypes.storm_colossus 已注册');
  ok(t.displayName === '守誓巨像', '中文名');
  ok(t.boss === true && t.flying === true, 'boss + flying 标记');
  ok(t.health === 160 && t.damage === 7, 'HP160 / 伤7');
  ok(t.drops.some(d => d.name === 'storm_core') && t.drops.some(d => d.name === 'heart_shard'),
    '掉落 storm_core + heart_shard');
  ok(t.model.parts.length >= 6, '模型部件 ≥6');
  const skins = generateMobSkinSVGs();
  ok(typeof skins.storm_colossus === 'string' && skins.storm_colossus.includes('<svg'), '皮肤 SVG 已生成');
  ok(Array.isArray(NAME_I18N.storm_colossus) && NAME_I18N.storm_colossus.length === 11, 'names.js 十一语条目');
  for (const p of t.model.parts) {
    const [x0, y0, z0, x1, y1, z1] = p.box;
    ok(x0 < x1 && y0 < y1 && z0 < z1 && y1 <= t.height + 0.06, `部件 ${p.name} 盒合法且贴合高度`);
  }
}

// ② 状态机：rise → guard → storm → rupture（只进不退）
const boss = new Mob('storm_colossus', world);
boss.position.set(6.5, 97, 0.5);
boss.health = 160;
ok(boss.maxHealth === 160, 'maxHealth 160');
updateColossusAI(boss, 2.5, player, mgr); // rise(2.2s) 结束 → guard
ok(boss.colossusState === 'guard', `rise 后进入 guard（实测 ${boss.colossusState}）`);
boss.health = 100; // frac 0.625 ≤ 0.66 → storm
updateColossusAI(boss, 0.05, player, mgr);
ok(boss.colossusState === 'storm', '血线 66% 进入 storm');
boss.health = 40; // frac 0.25 ≤ 0.33 → rupture
updateColossusAI(boss, 0.05, player, mgr);
ok(boss.colossusState === 'rupture', '血线 33% 进入 rupture');

// ③ 齐射：裂心双段（主段立即 + 0.35s 后第二段）
boss.health = 40;
boss.colossusShootTimer = 0.01;
boss.colossusSecondVolley = 0;
shootCount = 0;
updateColossusAI(boss, 0.05, player, mgr);
ok(shootCount === 1, '裂心主段齐射 1 次');
ok(shootWide === false, '主段为常规扇形');
updateColossusAI(boss, 0.4, player, mgr);
ok(shootCount === 2 && shootWide === true, '0.35s 后第二段宽扇');
// 风暴阶段常规周期
boss.health = 100;
boss.colossusState = 'storm';
boss.colossusSecondVolley = 0;
boss.colossusShootTimer = 0.01;
boss.colossusDiveT = 0;
shootCount = 0;
updateColossusAI(boss, 0.05, player, mgr);
ok(shootCount === 1 && shootWide === false, '风暴阶段单段齐射');
// 血线回升不回退阶段
boss.health = 160;
updateColossusAI(boss, 0.05, player, mgr);
ok(boss.colossusState === 'storm', '血线回升不回退阶段（只进不退）');

// ④ 震地：岩卫周期震地 → onColossusSlam 触发（手动积分模拟位移）
{
  const b2 = new Mob('storm_colossus', world);
  b2.position.set(6.5, 97, 0.5);
  b2.health = 160;
  player.position.set(10.5, 97, 0.5); // 4 格外（< SLAM_RANGE 10）
  updateColossusAI(b2, 2.5, player, mgr); // rise → guard
  ok(b2.colossusState === 'guard', '震地前置于 guard');
  slamCount = 0;
  // 震地周期 7s：先快进到触发，再逐帧积分模拟跃起→坠砸→触底
  let slammed = false;
  for (let i = 0; i < 400 && !slammed; i++) {
    updateColossusAI(b2, 0.05, player, mgr);
    b2.position.addScaledVector(b2.velocity, 0.05);
    if (slamCount > 0) slammed = true;
  }
  ok(slammed, '岩卫周期震地触发 onColossusSlam');
  ok(b2.colossusSlamTimer > 0, '震地后计时器复位');
}

// ⑤ 合成：风暴图腾 3×3 配方
{
  const grid = [
    ['star_marrow', 'cloud_fluff', 'star_marrow'],
    ['cloud_fluff', 'gold_block', 'cloud_fluff'],
    ['star_marrow', 'cloud_fluff', 'star_marrow'],
  ];
  const out = matchRecipe(grid);
  ok(out && (out.name || out) === 'storm_totem' || (out && out.name === 'storm_totem'),
    `风暴图腾配方匹配（实测 ${JSON.stringify(out)}）`);
}
finish('守誓巨像回归');
