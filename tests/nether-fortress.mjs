// nether-fortress.mjs -- 下界要塞结构回归（纯 node，不占 3001）
// 断言：
//   ① 结构注册 + 维度作用域（下界可见 fortress，主世界不可见；村庄/要塞不进下界）
//   ② cell 扫描能找到要塞记录，bbox/方块/箱子声明自洽
//   ③ 布局确定性：两个独立生成器同 cell 记录逐字节一致
//   ④ 区块装饰落地：要塞方块真实出现在覆盖区块内；首次求解耗时预算
//   ⑤ 箱子战利品表确定性（fortress 表惰性生成两次一致）
import { Chunk, CHUNK_SIZE } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { DIMENSIONS } from '../src/core/dimensions.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { chestLoot } from '../src/world/loot.js';
import '../src/blocks/BlockDefs.js';
import { ok, finish, configure } from './harness.mjs';
configure({ verbose: true });

const SEEDS = [42, 20250903];

const BRICK_ID = BlockRegistry.getId('nether_bricks');
const CHEST_ID = BlockRegistry.getId('chest');

for (const seed of SEEDS) {
  const gen = new NetherGenerator(seed);
  ok(gen.structureManager && gen.dimensionId === 'nether', `[${seed}] 下界生成器带 structureManager + dimensionId=nether`);

  // ① cell 扫描找要塞
  const sm = gen.structureManager;
  let found = null;
  for (let ccx = -2; ccx <= 2 && !found; ccx++) {
    for (let ccz = -2; ccz <= 2 && !found; ccz++) {
      const rec = sm.ensureRecord('fortress', ccx, ccz);
      if (rec) found = rec;
    }
  }
  ok(!!found, `[${seed}] ±2 cell 扫描存在下界要塞记录`);

  // ② 记录自洽：bbox / 方块 / 箱子声明
  const keyOf = (x, y, z) => x + ',' + y + ',' + z;
  const chestKeys = new Set(found.blocks.filter(b => b[3] === CHEST_ID).map(b => keyOf(b[0], b[1], b[2])));
  ok(found.blocks.every(b => b[1] >= 33 && b[1] <= found.groundY + 10), `[${seed}] 要塞方块 y 都在 [33, groundY+10] 内`);
  ok(found.blocks.some(b => b[3] === BRICK_ID), `[${seed}] 布局含下界砖`);
  ok(found.meta.chests.length === 4, `[${seed}] 箱子声明 4 处（主堡×2/桥头堡/南桥头）`);
  ok(found.meta.chests.every(c => chestKeys.has(keyOf(c[0], c[1], c[2]))), `[${seed}] 每个箱子声明坐标都有 chest 方块`);
  ok(found.minX <= found.ax && found.ax <= found.maxX && found.minZ <= found.az && found.az <= found.maxZ,
    `[${seed}] bbox 覆盖锚点（烈焰人生成门控依赖 bbox）`);
  ok(sm.chests.get(keyOf(found.meta.chests[0][0], found.meta.chests[0][1], found.meta.chests[0][2])) === 'fortress',
    `[${seed}] chests 注册表含 fortress 表名`);

  // ③ 确定性：独立生成器同 cell 记录一致
  const gen2 = new NetherGenerator(seed);
  const rec2 = gen2.structureManager.ensureRecord('fortress', Math.floor(found.ax / (20 * CHUNK_SIZE)), Math.floor(found.az / (20 * CHUNK_SIZE)));
  ok(JSON.stringify(rec2.blocks) === JSON.stringify(found.blocks), `[${seed}] 同 cell 两生成器布局逐字节一致`);

  // ④ 区块装饰落地 + 首次求解耗时预算
  const platformBlock = found.blocks.find(b => b[3] === BRICK_ID);
  const fcx = Math.floor(platformBlock[0] / CHUNK_SIZE), fcz = Math.floor(platformBlock[2] / CHUNK_SIZE);
  const g3 = new NetherGenerator(seed);
  const c3 = new Chunk(fcx, fcz);
  const t0 = performance.now();
  g3.generateChunk(c3);
  const ms = performance.now() - t0;
  ok(ms < 200, `[${seed}] 要塞区块生成耗时 ${ms.toFixed(1)}ms < 200ms`);
  ok(c3.get(platformBlock[0] - fcx * CHUNK_SIZE, platformBlock[1], platformBlock[2] - fcz * CHUNK_SIZE) === BRICK_ID,
    `[${seed}] 平台方块真实落入区块`);

  // ①维度作用域：主世界不可见 fortress，下界不可见村庄/主世界要塞
  const ov = new TerrainGenerator(seed);
  ok(ov.structureManager.recordsAround('fortress', 0, 0, 2).length === 0, `[${seed}] 主世界 recordsAround('fortress') 为空`);
  ok(sm.recordsAround('village', found.ax, found.az, 1).length === 0, `[${seed}] 下界 recordsAround('village') 为空`);
  ok(sm.recordsAround('stronghold', found.ax, found.az, 1).length === 0, `[${seed}] 下界 recordsAround('stronghold') 为空`);
  ok(sm.structureNameAt(found.ax, found.az) === '下界要塞', `[${seed}] structureNameAt(锚点) = 下界要塞`);
  ok(ov.structureManager.structureNameAt(found.ax, found.az) === null, `[${seed}] 主世界 structureNameAt(要塞锚点) = null`);
}

// ⑤ fortress 表确定性 + 合法性
{
  const a = chestLoot(42, 'fortress', 100, 47, -200);
  const b = chestLoot(42, 'fortress', 100, 47, -200);
  ok(JSON.stringify(a) === JSON.stringify(b), 'fortress 表两次生成逐字节一致');
  ok(a.some(s => s && s.name), 'fortress 表生成非空内容');
  const legal = new Set(['gold_nugget', 'gold_ingot', 'iron_ingot', 'coal', 'bone', 'obsidian', 'flint', 'blaze_rod', 'golden_apple', 'diamond', 'saddle']);
  ok(a.every(s => !s || legal.has(s.name)), 'fortress 表条目全部在声明清单内');
}

// 主世界结构回归不受 dims 过滤影响（村庄锚点仍可解）
{
  const ov = new TerrainGenerator(42);
  const v = ov.structureManager.ensureRecord('village', 1, 1);
  ok(v === null || v.name === 'village', '主世界村庄 ensureRecord 行为不变（null 或 village）');
}
finish(`下界要塞回归（${SEEDS.length} seeds）`);
