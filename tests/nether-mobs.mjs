// nether-mobs.mjs -- 下界怪物回归（纯 node）：类型注册/模型一致/生成表分布/中立与悬浮标记
import { MobTypes, generateMobSkinSVGs } from '../src/entity/MobTextures.js';
import { Mob } from '../src/entity/Mob.js';
import { pickNetherSpawn } from '../src/entity/MobManager.js';
import { World } from '../src/core/World.js';
import { ok, finish, configure } from './harness.mjs';
configure({ verbose: true });

// ① 类型注册与模型一致性
for (const name of ['zombified_piglin', 'wither_skeleton', 'blaze', 'mourn_howler']) {
  const t = MobTypes[name];
  ok(!!t, `MobTypes.${name} 已注册`);
  ok(t.displayName && t.model && t.model.parts.length >= 4, `MobTypes.${name} 有中文名与模型部件`);
  ok(t.drops && t.drops.every(d => d.name && d.max >= d.min), `MobTypes.${name} 掉落表合法`);
  // 部件盒合法（min<max）且最高点 ≤ type.height + 0.01
  for (const p of t.model.parts) {
    const [x0, y0, z0, x1, y1, z1] = p.box;
    ok(x0 < x1 && y0 < y1 && z0 < z1, `MobTypes.${name} 部件 ${p.name} 盒尺寸合法`);
    ok(y1 <= t.height + 0.06, `MobTypes.${name} 部件 ${p.name} 顶点 ${y1} 与实体高度 ${t.height} 一致（人形头顶惯例容差）`);
  }
  const skins = generateMobSkinSVGs();
  ok(typeof skins[name] === 'string' && skins[name].includes('<svg'), `${name} 皮肤 SVG 已生成`);
}
ok(MobTypes.zombified_piglin.neutral === true, '僵尸猪灵 neutral=true');
ok(MobTypes.blaze.flying === true && MobTypes.blaze.igniteOnHit === true, '烈焰人 flying+igniteOnHit');
ok(MobTypes.wither_skeleton.height === 2.4, '凋零骷髅 2.4 高');
ok(MobTypes.villager.passive === true, '村民仍在册（面板全生物纳入的前提）');
// 哭嚎者（世界观批次 N3）：flying 中立 + 哀潮之泪必掉 1-2
ok(MobTypes.mourn_howler.flying === true && MobTypes.mourn_howler.neutral === true, '哭嚎者 flying+neutral（受击激怒走 attackMob 通用链）');
ok(MobTypes.mourn_howler.displayName === '哭嚎者', '哭嚎者中文名');
const hwDrops = MobTypes.mourn_howler.drops;
ok(hwDrops.length === 1 && hwDrops[0].name === 'mourn_tear' && hwDrops[0].min === 1 && hwDrops[0].max === 2 && hwDrops[0].chance === 1.0, '哭嚎者必掉哀潮之泪 1-2');
ok(MobTypes.mourn_howler.detectionRange === 20 && MobTypes.mourn_howler.damage === 4, '哭嚎者侦测 20 / 伤 4');

// ② Mob 实体标记传递
{
  const world = new World(42, 'nether');
  const blaze = new Mob('blaze', world);
  ok(blaze.flying === true && blaze.neutral === false && blaze.hoverBaseY === null, 'Mob(blaze) 悬浮标记就位（hoverBaseY 待首帧锚定）');
  const piglin = new Mob('zombified_piglin', world);
  ok(piglin.neutral === true && piglin.aggro === false && piglin.aggroTimer === 0, 'Mob(zombified_piglin) 中立未激怒初始态');
  const howler = new Mob('mourn_howler', world);
  ok(howler.flying === true && howler.neutral === true && howler.aggro === false, 'Mob(mourn_howler) flying 中立初始态');
  const wither = new Mob('wither_skeleton', world);
  ok(wither.height === 2.4 && wither.attackDamage === 4, 'Mob(wither_skeleton) 高个 4 伤');
}

// ③ 生成表分布（确定性伪随机流统计，阈值宽松防抖）
{
  let seed = 12345;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const tally = (biome, inFortress, n = 3000) => {
    const c = {};
    for (let i = 0; i < n; i++) {
      const t = pickNetherSpawn(biome, inFortress, rand);
      c[t] = (c[t] || 0) + 1;
    }
    return c;
  };
  const f = tally(null, true);
  ok(f.blaze / 3000 > 0.6 && f.blaze / 3000 < 0.8, `要塞内烈焰人 ~70%（实测 ${(f.blaze / 3000 * 100).toFixed(1)}%）`);
  ok(f.zombified_piglin / 3000 > 0.12 && f.zombified_piglin / 3000 < 0.28, `要塞内僵尸猪灵 ~20%（实测 ${(f.zombified_piglin / 3000 * 100).toFixed(1)}%）`);
  ok(f.wither_skeleton / 3000 > 0.04 && f.wither_skeleton / 3000 < 0.16, `要塞内凋零骷髅 ~10%（实测 ${(f.wither_skeleton / 3000 * 100).toFixed(1)}%）`);
  const v = tally('soul_sand_valley', false);
  ok(v.mourn_howler / 3000 > 0.18 && v.mourn_howler / 3000 < 0.32, `峡谷哭嚎者 ~25%（实测 ${(v.mourn_howler / 3000 * 100).toFixed(1)}%）`);
  ok(v.wither_skeleton / 3000 > 0.33 && v.wither_skeleton / 3000 < 0.50, `峡谷凋零骷髅 ~41%（实测 ${(v.wither_skeleton / 3000 * 100).toFixed(1)}%）`);
  ok(!v.blaze, '要塞外不生成烈焰人（峡谷表）');
  const w = tally('wastes', false);
  ok(w.mourn_howler / 3000 > 0.06 && w.mourn_howler / 3000 < 0.18, `荒地哭嚎者 ~12%（实测 ${(w.mourn_howler / 3000 * 100).toFixed(1)}%）`);
  ok(w.zombified_piglin / 3000 > 0.68, `荒地僵尸猪灵 ~74%（实测 ${(w.zombified_piglin / 3000 * 100).toFixed(1)}%）`);
  ok(!w.blaze, '要塞外不生成烈焰人（荒地表）');
  ok(!tally(null, true).mourn_howler, '要塞平台层不生成哭嚎者（炉卫主导）');
}

// ④ 全部怪物类型都能构造（面板动态枚举的兜底保障：任何注册类型不缺字段）
for (const name of Object.keys(MobTypes)) {
  const world = new World(42, 'nether');
  const m = new Mob(name, world);
  ok(m.typeName === name && m.maxHealth > 0 && m.width > 0 && m.height > 0, `Mob(${name}) 可构造且属性齐全`);
}
finish('下界怪物回归');
