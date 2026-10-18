// end-city.mjs -- 末地城结构回归（node 直跑，无需服务器）
// 断言：
//   ① 末地城方块注册：紫珀/末地砖/紫颂（textures 与 SVG 一致性）
//   ② 潜影贝类型注册：stationary / 属性 / 掉落 / 部件盒 / 皮肤
//   ③ 选址漏斗：±2 cell 扫描（双 seed）找到末地城记录；仅 end 维度参与
//   ④ 结构落地：底台/塔身/战利品房方块进区块；紫颂花园；bbox 一致
//   ⑤ 箱子三向一致：meta.chests ↔ chest 方块 ↔ sm.chests 注册（end_city/end_ship 表）
//   ⑥ loot：末地城三表确定性 + 船长箱鞘翅必出 + 旧表（fortress）内容不受 forced 改动影响
//   ⑦ 末地城确定性：双次求解 blocks 逐字节一致
import { World } from '../src/core/World.js';
import { Chunk, CHUNK_SIZE } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { EndGenerator } from '../src/world/dimensions/end.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { chestLoot } from '../src/world/loot.js';
import { MobTypes, generateMobSkinSVGs } from '../src/entity/MobTextures.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

const SEEDS = [42, 20250903];

// ① 方块注册
for (const name of ['purpur_block', 'purpur_pillar', 'end_stone_bricks', 'chorus_plant', 'chorus_flower']) {
  const id = BlockRegistry.getId(name);
  ok(!!BlockRegistry.getById(id), `方块 ${name} 未注册`);
}
{
  const pillar = BlockRegistry.getById(BlockRegistry.getId('purpur_pillar'));
  ok(pillar.top === 'purpur_pillar_top' && pillar.side === 'purpur_pillar_side' && pillar.bottom === 'purpur_pillar_top',
    'purpur_pillar 纹理字段缺失（多面方块必须显式声明，防图集 fallback）');
}

// ② 潜影贝注册
{
  const sh = MobTypes.shulker;
  ok(!!sh, 'MobTypes.shulker 未注册');
  ok(sh.displayName === '潜影贝' && sh.stationary === true, '潜影贝 stationary/displayName 异常');
  ok(sh.health === 30 && sh.damage >= 3, '潜影贝属性异常');
  ok(sh.drops.some(d => d.name === 'shulker_shell'), '潜影贝掉落缺少 shulker_shell');
  ok(ItemRegistry.getByName('shulker_shell'), 'shulker_shell 物品未注册');
  ok(ItemRegistry.getByName('elytra'), 'elytra 物品未注册');
  ok(ItemRegistry.getByName('chorus_fruit').food > 0, 'chorus_fruit 缺 food 字段');
  const parts = sh.model.parts;
  ok(parts.length === 2, '潜影贝部件应为壳+底座');
  for (const p of parts) {
    const [x0, y0, z0, x1, y1, z1] = p.box;
    ok(x1 > x0 && y1 > y0 && z1 > z0 && y1 <= sh.height + 0.06, `潜影贝部件 ${p.name} 盒无效`);
  }
  ok(typeof generateMobSkinSVGs().shulker === 'string', '潜影贝皮肤未生成');
}

// ③④⑤⑥⑦ 共用：真末地生成器（结构经 catalog 注册）
for (const seed of SEEDS) {
  const gen = new EndGenerator(seed);
  // ③ 选址：±3 cell 扫描（cell=16 区块=256 格）找城（主岛外真空区需跳过近距 cell）
  let rec = null;
  const CELL = 16 * CHUNK_SIZE;
  outer:
  for (let cx = -3; cx <= 3; cx++) {
    for (let cz = -3; cz <= 3; cz++) {
      rec = gen.structureManager.ensureRecord('end_city', cx, cz);
      if (rec) break outer;
    }
  }
  ok(!!rec, `seed=${seed} ±3 cell 未找到末地城（选址门过严或密度参数改动）`);

  // ③b 维度作用域：主世界/下界生成器不求解 end_city
  const owGen = new TerrainGenerator(seed);
  ok(!owGen.structureManager.ensureRecord('end_city', 0, 0), '主世界不应求解末地城（dims 过滤失效）');
  const nGen = new NetherGenerator(seed);
  ok(!nGen.structureManager.ensureRecord('end_city', 0, 0), '下界不应求解末地城（dims 过滤失效）');

  // ④ 结构落地：底台 end_stone_bricks / 塔身 purpur_block 进区块
  const EB = BlockRegistry.getId('end_stone_bricks');
  const PB = BlockRegistry.getId('purpur_block');
  const CF = BlockRegistry.getId('chorus_flower');
  const CH = BlockRegistry.getId('chest');
  const touched = new Map(); // "cx,cz" -> chunk
  const chunkAt = (x, z) => {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const k = cx + ',' + cz;
    if (!touched.has(k)) { const c = new Chunk(cx, cz); gen.generateChunk(c); touched.set(k, c); }
    return touched.get(k);
  };
  const blockAt = (x, y, z) => {
    const c = chunkAt(x, z);
    return c.get(((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, y, ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE);
  };
  let ebCount = 0, pbCount = 0, cfCount = 0, chestCount = 0;
  for (const [x, y, z, id] of rec.blocks) {
    if (id === EB) ebCount++;
    if (id === PB) pbCount++;
    if (id === CF) cfCount++;
    if (id === CH) chestCount++;
  }
  ok(ebCount >= 100, `底台末地砖不足: ${ebCount}`);
  ok(pbCount >= 80, `塔身紫珀不足: ${pbCount}`);
  ok(cfCount >= 4, `紫颂花不足: ${cfCount}`);
  ok(chestCount === rec.meta.chests.length, `chest 方块 ${chestCount} 与声明 ${rec.meta.chests.length} 不一致`);
  // 落地抽查：底台四角 + 中心
  const y0 = rec.groundY - 1;
  for (const [tx, tz] of [[rec.ax - 6, rec.az - 6], [rec.ax + 6, rec.az + 6], [rec.ax, rec.az]]) {
    ok(blockAt(tx, y0, tz) === EB, `底台未落地 @(${tx},${y0},${tz})`);
  }
  // 落地抽查：战利品房门洞（东侧）为空气
  ok(blockAt(rec.ax + 4, rec.groundY + 9, rec.az) === 0, '战利品房东门未开洞');

  // ⑤ 箱子三向一致
  for (const c of rec.meta.chests) {
    ok(c[3] === 'end_city' || c[3] === 'end_ship' || c[3] === 'end_ship_captain',
      `未知 loot 表: ${c[3]}`);
    ok(blockAt(c[0], c[1], c[2]) === CH, `chest 方块缺失 @(${c[0]},${c[1]},${c[2]})`);
    ok(gen.structureManager.chests.get(c[0] + ',' + c[1] + ',' + c[2]) === c[3],
      `sm.chests 注册缺失 @(${c[0]},${c[1]},${c[2]})`);
  }

  // ⑤b 潜影贝点位在城内
  for (const [x, , z] of rec.meta.shulkerSpawns) {
    ok(x >= rec.minX && x <= rec.maxX && z >= rec.minZ && z <= rec.maxZ, '潜影贝点位越出 bbox');
  }

  // ⑦ 确定性：重新求解（新缓存）逐字节一致（同扫描序找到同一城）
  const gen2 = new EndGenerator(seed);
  let rec2 = null;
  outer2:
  for (let cx = -3; cx <= 3; cx++) {
    for (let cz = -3; cz <= 3; cz++) {
      rec2 = gen2.structureManager.ensureRecord('end_city', cx, cz);
      if (rec2) break outer2;
    }
  }
  const sig = (r) => r.blocks.map(b => b.join(',')).join('|') + '#' + JSON.stringify(r.meta.chests);
  ok(sig(rec) === sig(rec2), `seed=${seed} 末地城双次求解不一致`);
}

// ⑥ loot：确定性 + 鞘翅保底 + 旧表不变性
{
  // 船长箱：鞘翅必出（30 个坐标全部含 elytra）
  for (let i = 0; i < 30; i++) {
    const slots = chestLoot(42, 'end_ship_captain', i * 7, 70, i * 13);
    ok(slots.some(s => s && s.name === 'elytra'), `船长箱鞘翅保底失效 @i=${i}`);
  }
  // 确定性：同坐标两次一致
  const a = chestLoot(42, 'end_city', 10, 70, 10);
  const b = chestLoot(42, 'end_city', 10, 70, 10);
  ok(JSON.stringify(a) === JSON.stringify(b), 'end_city loot 不确定');
  // 旧表不受 forced 改动影响：fortress 表不含 elytra 且条目可解析（物品或方块）
  const resolvable = (name) => !!ItemRegistry.getByName(name) || !!BlockRegistry.getById(BlockRegistry.getId(name));
  for (let i = 0; i < 10; i++) {
    const slots = chestLoot(42, 'fortress', i * 11, 70, i * 3);
    ok(!slots.some(s => s && s.name === 'elytra'), 'fortress 表不应含鞘翅（forced 污染旧表）');
    ok(slots.length === 27 && slots.every(s => s === null || (s.count >= 1 && resolvable(s.name))), 'fortress loot 结构非法');
  }
  // end_city/end_ship 表合法性
  for (const t of ['end_city', 'end_ship', 'end_ship_captain']) {
    const slots = chestLoot(42, t, 5, 70, 5);
    ok(slots.every(s => s === null || resolvable(s.name)), `${t} 表含未注册物品`);
  }
}
finish(`末地城结构回归（${SEEDS.length} seeds）`);
