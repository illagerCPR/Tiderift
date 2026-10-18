// aether-mobs.mjs -- 天域生物回归（纯 node）：类型注册/模型一致/生成表分布/悬浮与被动标记
// 批次 B：新增云绒兽/岚隼/潮鸣，生成表升级 pickAetherSpawnV2（潮鸣入水晶秘境表）
import { MobTypes, generateMobSkinSVGs } from '../src/entity/MobTextures.js';
import { Mob } from '../src/entity/Mob.js';
import { pickAetherSpawnV2, MobManager } from '../src/entity/MobManager.js';
import { World } from '../src/core/World.js';
import { ok, finish, configure } from './harness.mjs';
configure({ verbose: true });

// ① 类型注册与模型一致性
for (const name of ['wisp', 'aether_guard', 'cloud_lamb', 'gale_hawk', 'tide_echo']) {
  const t = MobTypes[name];
  ok(!!t, `MobTypes.${name} 已注册`);
  ok(!!t.displayName && !!t.model && t.model.parts.length >= 4, `MobTypes.${name} 有中文名与模型部件`);
  ok(t.drops && t.drops.every(d => d.name && d.max >= d.min), `MobTypes.${name} 掉落表合法`);
  for (const p of t.model.parts) {
    const [x0, y0, z0, x1, y1, z1] = p.box;
    ok(x0 < x1 && y0 < y1 && z0 < z1, `MobTypes.${name} 部件 ${p.name} 盒尺寸合法`);
    ok(y1 <= t.height + 0.06, `MobTypes.${name} 部件 ${p.name} 顶点 ${y1} 与实体高度 ${t.height} 一致`);
  }
  const skins = generateMobSkinSVGs();
  ok(typeof skins[name] === 'string' && skins[name].includes('<svg'), `${name} 皮肤 SVG 已生成`);
}
ok(MobTypes.wisp.flying === true && MobTypes.wisp.passive === true && MobTypes.wisp.damage === 0,
  '风灵 flying+passive+无伤');
ok(MobTypes.aether_guard.flying === true && !MobTypes.aether_guard.passive && MobTypes.aether_guard.damage >= 3,
  '天域守卫 flying+敌对+有伤');
ok(MobTypes.cloud_lamb.passive === true && MobTypes.cloud_lamb.flying !== true &&
   MobTypes.cloud_lamb.drops.some(d => d.name === 'cloud_fluff'),
  '云绒兽 陆行被动 + 掉云絮（批次 B）');
ok(MobTypes.gale_hawk.flying === true && !MobTypes.gale_hawk.passive && MobTypes.gale_hawk.damage >= 3,
  '岚隼 flying+敌对+有伤（批次 B）');
ok(MobTypes.tide_echo.neutral === true && MobTypes.tide_echo.flying === true && MobTypes.tide_echo.damage >= 3,
  '潮鸣 中立悬浮有伤（批次 B）');
ok(['wisp', 'aether_guard', 'cloud_lamb', 'gale_hawk', 'tide_echo'].every(n => MobTypes[n].burningInDay === false),
  '天域生物永昼不燃烧（burningInDay=false）');
ok(MobTypes.villager.passive === true, '村民 passive 标记仍在（威胁过滤通用化不回归）');

// ② Mob 实体标记传递（含生成所需 world 维度）
{
  const world = new World(42, 'aether');
  const wisp = new Mob('wisp', world);
  ok(wisp.flying === true && wisp.type.passive === true && wisp.hoverBaseY === null,
    'Mob(wisp) 悬浮被动标记就位（hoverBaseY 待首帧锚定）');
  const guard = new Mob('aether_guard', world);
  ok(guard.flying === true && guard.attackDamage === 4 && !guard.passive,
    'Mob(aether_guard) 悬浮 4 伤敌对');
  const lamb = new Mob('cloud_lamb', world);
  ok(lamb.type.passive === true && !lamb.flying && lamb.type.drops.some(d => d.name === 'cloud_fluff'),
    'Mob(cloud_lamb) 被动陆行（批次 B）');
  const hawk = new Mob('gale_hawk', world);
  ok(hawk.flying === true && !hawk.passive && hawk.attackDamage === 3,
    'Mob(gale_hawk) 悬浮 3 伤敌对（批次 B）');
  const echo = new Mob('tide_echo', world);
  ok(echo.neutral === true && echo.flying === true && echo.aggro === false && echo.aggroTimer === 0,
    'Mob(tide_echo) 中立未激怒（aggro/aggroTimer 初始零，批次 B）');
}

// ③ 生成表分布（确定性伪随机流统计，阈值宽松防抖）——批次 B pickAetherSpawnV2
{
  let seed = 98765;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const tally = (biome, nearTemple, n = 3000) => {
    const c = {};
    for (let i = 0; i < n; i++) {
      const t = pickAetherSpawnV2(biome, nearTemple, false, rand);
      c[t] = (c[t] || 0) + 1;
    }
    return c;
  };
  const plain = tally('verdant', false);
  ok(plain.wisp / 3000 > 0.85 && (plain.gale_hawk || 0) / 3000 > 0.05 && (plain.gale_hawk || 0) / 3000 < 0.11,
    `草原风灵主导、岚隼 ~8%（实测岚隼 ${((plain.gale_hawk || 0) / 3000 * 100).toFixed(1)}%）`);
  ok(!plain.aether_guard && !plain.tide_echo, '草原不出守卫/潮鸣');
  const crystal = tally('crystal', false);
  ok(crystal.aether_guard / 3000 > 0.30 && crystal.aether_guard / 3000 < 0.50,
    `水晶秘境守卫 ~40%（实测 ${(crystal.aether_guard / 3000 * 100).toFixed(1)}%）`);
  ok((crystal.tide_echo || 0) / 3000 > 0.20 && (crystal.tide_echo || 0) / 3000 < 0.40,
    `水晶秘境潮鸣 ~30%（实测 ${((crystal.tide_echo || 0) / 3000 * 100).toFixed(1)}%）`);
  const temple = tally('crystal', true);
  ok(temple.aether_guard / 3000 > 0.45 && temple.aether_guard / 3000 < 0.65,
    `神殿周边守卫主导 ~55%（实测 ${(temple.aether_guard / 3000 * 100).toFixed(1)}%）`);
  const frost = tally('frost', false);
  ok(frost.aether_guard / 3000 > 0.05 && frost.aether_guard / 3000 < 0.15,
    `银霜守卫少量 ~10%（实测 ${(frost.aether_guard / 3000 * 100).toFixed(1)}%）`);
  ok((frost.gale_hawk || 0) / 3000 > 0.07 && (frost.gale_hawk || 0) / 3000 < 0.17,
    `银霜岚隼 ~12%（实测 ${((frost.gale_hawk || 0) / 3000 * 100).toFixed(1)}%）`);
}

// ④ 表覆盖完备性：全部天域群系返回已注册类型
{
  let seed = 24680;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const biome of ['verdant', 'crystal', 'frost', 'autumn', null]) {
    for (let i = 0; i < 50; i++) {
      const t = pickAetherSpawnV2(biome, false, false, rand);
      ok(!!MobTypes[t], `群系 ${biome} 生成类型 ${t} 已注册`);
      const tN = pickAetherSpawnV2(biome, false, true, rand); // 批次 D：夜表也全部合法
      ok(!!MobTypes[tN], `群系 ${biome} 夜间类型 ${tN} 已注册`);
    }
  }
  // 夜表威胁加成（批次 D）：夜晚岚隼/守卫显著高于白天
  {
    let s1 = 13579;
    const r1 = () => { s1 = (Math.imul(s1, 1664525) + 1013904223) >>> 0; return s1 / 4294967296; };
    const tallyN = (biome, n = 2000) => {
      const c = {};
      for (let i = 0; i < n; i++) { const t = pickAetherSpawnV2(biome, false, true, r1); c[t] = (c[t] || 0) + 1; }
      return c;
    };
    const night = tallyN('verdant');
    ok((night.gale_hawk || 0) / 2000 > 0.14 && (night.gale_hawk || 0) / 2000 < 0.22,
      `夜表岚隼加成 ~18%（实测 ${((night.gale_hawk || 0) / 2000 * 100).toFixed(1)}%）`);
    const nightCrystal = tallyN('crystal');
    ok((nightCrystal.aether_guard || 0) / 2000 > 0.42 && (nightCrystal.aether_guard || 0) / 2000 < 0.58,
      `夜表水晶守卫加成 ~50%（实测 ${((nightCrystal.aether_guard || 0) / 2000 * 100).toFixed(1)}%）`);
  }
}

// ⑤ angerTideEchoes（真实 MobManager）：挖星髓激怒 16 格内潮鸣 + 同族一层传播（批次 B）
{
  const world = new World(42, 'aether');
  const fakeScene = { add() {}, remove() {} };
  const mgr = new MobManager(world, fakeScene, new Map(), {});
  const mk = (type, x, z) => {
    const m = new Mob(type, world);
    m.position.set(x, 90, z);
    mgr.mobs.push(m);
    return m;
  };
  const echoNear = mk('tide_echo', 10, 10);
  const echoNear2 = mk('tide_echo', 14, 12); // 传播目标（距近潮鸣 ~5 格）
  const echoFar = mk('tide_echo', 200, 200);
  const guard = mk('aether_guard', 12, 12);  // 非潮鸣不受影响
  mgr.angerTideEchoes(8, 90, 8);
  ok(echoNear.aggro === true && echoNear.aggroTimer === 25, '16 格内潮鸣被激怒 25s');
  ok(echoNear2.aggro === true, '同族一层传播生效');
  ok(echoFar.aggro === false, '远处潮鸣不受影响');
  ok(guard.aggro === false, '非潮鸣生物不受影响');
  mgr.dispose?.();
}
finish('天域生物回归');
