// overworld-structures.mjs -- 潮冢回归（世界观批次 W2，node 直跑，无需服务器）
// 断言：
//   ① 结构类型注册 + 维度作用域（下界/末地/天域生成器不求解）
//   ② 选址漏斗（方案 A' 锚点随河）：cell28 扫描（双 seed）至少一例
//   ③ 坑体落地：显式水填（不改变水体语义）/ 星髓碎屑 / 骨环（毛块+四骷髅头）/ 沉船残骸在位
//   ④ 箱子三向一致：meta.chests ↔ chest 方块 ↔ sm.chests（tide_barrow 表）
//   ⑤ 石碑三向一致：meta.steles ↔ moss_stele 方块 ↔ sm.steles（rain_salted，整体没入水下）
//   ⑥ 陆地零命中：干燥锚点 place 返回 -1（河段门控不误放）
//   ⑦ structureNameAt：坑心报「潮冢」
//   ⑧ 双次求解确定性：blocks+meta 逐字节一致（同 seed 两管理器对拍）
//   ⑨ loot：tide_barrow 表确定性 + page_rain FORCED 必出
import { SEA_LEVEL } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { EndGenerator } from '../src/world/dimensions/end.js';
import { chestLoot } from '../src/world/loot.js';
import { TIDE_BARROW_DEF } from '../src/world/structures/tide_barrow.js';
import { Biomes } from '../src/world/biomes.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

const SEEDS = [42, 20250903];

const sig = (r) => r.blocks.map(b => b.join(',')).join('|') + '#' + JSON.stringify(r.meta);

// ① 维度作用域
{
  const nGen = new NetherGenerator(42);
  const eGen = new EndGenerator(42);
  ok(!nGen.structureManager.ensureRecord('tide_barrow', 0, 0), '下界不应求解 tide_barrow');
  ok(!eGen.structureManager.ensureRecord('tide_barrow', 0, 0), '末地不应求解 tide_barrow');
}
ok(TIDE_BARROW_DEF.cell === 28 && TIDE_BARROW_DEF.salt === 7267, '密度预案：cell 28 / salt 7267');
ok(TIDE_BARROW_DEF.chance === 1 && typeof TIDE_BARROW_DEF.anchorForCell === 'function',
  '概率门移入 anchorForCell（覆盖时管理器门不生效）');

for (const seed of SEEDS) {
  const gen = new TerrainGenerator(seed);

  // ② 选址漏斗：±3 cell 扫描至少一例（cell28 → 672 格见方）
  let found = null;
  const R = 3;
  outer:
  for (let cx = -R; cx <= R; cx++) {
    for (let cz = -R; cz <= R; cz++) {
      const rec = gen.structureManager.ensureRecord('tide_barrow', cx, cz);
      if (rec) { found = rec; break outer; }
    }
  }
  ok(!!found, `seed=${seed} 扫描区未找到 tide_barrow（河段门控过严或密度参数改动）`);
  if (!found) continue;
  const rec = found;
  const sm = gen.structureManager;

  // ③ 坑体落地：签名方块计数
  const count = {};
  for (const b of rec.blocks) count[b[3]] = (count[b[3]] || 0) + 1;
  const id = (n) => BlockRegistry.getId(n);
  ok((count[id('water')] || 0) > 500, `显式水填在场 (${count[id('water')] || 0})`);
  ok((count[id('star_marrow_block')] || 0) === 6, `星髓碎屑 6 枚 (${count[id('star_marrow_block')] || 0})`);
  ok((count[id('white_wool')] || 0) === 4, `骨环毛块 4 (${count[id('white_wool')] || 0})`);
  ok((count[id('wither_skeleton_skull')] || 0) === 4, `骨环骷髅头 4 (${count[id('wither_skeleton_skull')] || 0})`);
  ok((count[id('spruce_log')] || 0) === 2 && (count[id('spruce_planks')] || 0) === 3, '沉船残骸（云杉木半页）在位');
  ok((count[id('moss_stele')] || 0) === 1 && (count[id('chest')] || 0) === 1, '苔纹石碑×1 + 箱×1');
  ok(rec.blocks.every(b => b[3] !== id('water') || b[1] <= SEA_LEVEL), '水填不超海平面（不改变水体语义）');

  // ④ 箱子三向一致
  {
    const [x, y, z, table] = rec.meta.chests[0];
    ok(table === 'tide_barrow', `箱表名 tide_barrow (${table})`);
    ok(rec.blocks.some(b => b[0] === x && b[1] === y && b[2] === z && b[3] === id('chest')), '箱方块在声明坐标');
    ok(sm.chests.get(x + ',' + y + ',' + z) === 'tide_barrow', 'sm.chests 注册一致');
    const loot = chestLoot(seed, 'tide_barrow', x, y, z);
    ok(loot.some(s => s && s.name === 'page_rain' && s.count === 1), 'FORCED：雨潮残页必出 ×1');
  }

  // ⑤ 石碑三向一致 + 没入水下
  {
    const [x, y, z, chapter] = rec.meta.steles[0];
    ok(chapter === 'rain_salted', `碑章 rain_salted (${chapter})`);
    ok(rec.blocks.some(b => b[0] === x && b[1] === y && b[2] === z && b[3] === id('moss_stele')), '苔碑方块在声明坐标');
    ok(sm.steles.get(x + ',' + y + ',' + z) === 'rain_salted', 'sm.steles 注册一致');
    ok(y <= SEA_LEVEL - 1, `石碑整体没入水面下 (${y} ≤ ${SEA_LEVEL - 1})`);
    ok(y === rec.groundY - 2, `碑立于坑底（groundY-2） (${y})`);
  }

  // ⑦ structureNameAt：坑心报「潮冢」
  {
    const [mx, , mz] = rec.meta.center;
    ok(sm.structureNameAt(mx, mz) === '潮冢', `structureNameAt 坑心 = 潮冢 (${sm.structureNameAt(mx, mz)})`);
  }

  // ⑧ 双次求解确定性（新管理器同 seed 对拍）
  {
    const gen2 = new TerrainGenerator(seed);
    const rec2 = gen2.structureManager.ensureRecord('tide_barrow', Math.floor(rec.ax / 16 / TIDE_BARROW_DEF.cell), Math.floor(rec.az / 16 / TIDE_BARROW_DEF.cell));
    ok(!!rec2, '同 seed 二次求解命中同一 cell');
    ok(sig(rec) === sig(rec2), '同 seed 两管理器 blocks+meta 逐字节一致');
  }
}

// ⑥ 陆地零命中：干燥锚点（PLAINS 且海拔 > 70）place 返回 -1
{
  const gen = new TerrainGenerator(42);
  let tested = 0;
  for (let x = -512; x <= 512 && tested < 3; x += 64) {
    for (let z = -512; z <= 512 && tested < 3; z += 64) {
      if (gen.getBiome(x, z) !== Biomes.PLAINS) continue;
      if (gen.getBaseHeight(x, z) <= 70) continue;
      ok(TIDE_BARROW_DEF.place(gen, x, z) === -1, `干燥锚点零命中 (${x},${z})`);
      tested++;
    }
  }
  ok(tested === 3, `陆地零命中样本数 3 (${tested})`);
}

// ── W3 碑位布点：村庄井旁（纹样）+ 要塞门厅（门厅）──
{
  const gen = new TerrainGenerator(42);
  const sm = gen.structureManager;

  // 村庄（cell20）：门控严（平原/沙漠+海拔窗），±10 cell 扫描
  let vil = null;
  for (let cx = -10; cx <= 10 && !vil; cx++) {
    for (let cz = -10; cz <= 10 && !vil; cz++) vil = sm.ensureRecord('village', cx, cz);
  }
  ok(!!vil, '扫描区找到村庄（W3 村庄碑位前置）');
  if (vil) {
    ok(Array.isArray(vil.meta.steles) && vil.meta.steles.length === 1, `村庄碑位 1 处 (${(vil.meta.steles || []).length})`);
    const [sx, sy, sz, ch] = vil.meta.steles[0];
    ok(ch === 'rain_pattern', `村庄碑章 rain_pattern (${ch})`);
    ok(vil.blocks.some(b => b[0] === sx && b[1] === sy && b[2] === sz && b[3] === BlockRegistry.getId('moss_stele')), '村庄苔碑方块在声明坐标');
    ok(sm.steles.get(sx + ',' + sy + ',' + sz) === 'rain_pattern', '村庄碑 sm.steles 注册一致');
    ok(sx === vil.ax + 3 && sz === vil.az - 2 && sy === vil.groundY + 1, '碑位在井旁 (ax+3, groundY+1, az-2)');
    ok(sm.structureNameAt(vil.ax, vil.az) === '村庄', `村庄 bbox 判定不受碑位影响 (${sm.structureNameAt(vil.ax, vil.az)})`);
    ok(sx >= vil.minX && sx <= vil.maxX && sz >= vil.minZ && sz <= vil.maxZ, '碑位不外扩村庄 bbox');
    // 村民出生景位未被碑位侵占（井旁两景位仍在）
    ok(vil.meta.villagerSpawns.length >= 2, '村民出生景位不受碑位影响');
  }

  // 要塞（cell48 环带）：ccx/ccz -2..2 扫描（环带半径 700-956 → cell 索引 ±2 内）
  let sho = null;
  for (let cx = -2; cx <= 2 && !sho; cx++) {
    for (let cz = -2; cz <= 2 && !sho; cz++) sho = sm.ensureRecord('stronghold', cx, cz);
  }
  ok(!!sho, '扫描区找到要塞（W3 门厅碑位前置）');
  if (sho) {
    ok(Array.isArray(sho.meta.steles) && sho.meta.steles.length === 1, `要塞碑位 1 处 (${(sho.meta.steles || []).length})`);
    const [sx, sy, sz, ch] = sho.meta.steles[0];
    ok(ch === 'rain_hall', `要塞碑章 rain_hall (${ch})`);
    ok(sho.blocks.some(b => b[0] === sx && b[1] === sy && b[2] === sz && b[3] === BlockRegistry.getId('moss_stele')), '要塞苔碑方块在声明坐标');
    ok(sm.steles.get(sx + ',' + sy + ',' + sz) === 'rain_hall', '要塞碑 sm.steles 注册一致');
    ok(sx === sho.ax + 4 && sz === sho.az + 2, '碑位在枢纽东墙内侧 (ax+4, az+2)');
    ok(sy >= 14 && sy <= 38 && sy < sho.groundY, `碑位在地下枢纽（hubY） (${sy})`);
    ok(sm.structureNameAt(sho.ax, sho.az) === '要塞', `要塞 bbox 判定正常 (${sm.structureNameAt(sho.ax, sho.az)})`);
  }
}
finish('overworld-structures');
