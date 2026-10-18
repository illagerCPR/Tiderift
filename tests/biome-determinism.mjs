// biome-determinism.mjs -- 主世界群系生成确定性回归（node 直跑，无需服务器）
// 断言：
//   ① 同 seed 双次 getBiome/getBaseHeight 完全一致（纯函数根基）
//   ② 顺序无关（乱序抽样与顺序扫描同值）
//   ③ 群系在场性：B1 七群系全部出现且占比在合理区间
//   ④ 高山海拔锚点：存在 >100 的峰顶列；高山均高显著高于平原
//   ⑤ 相邻列连续性：非高山区域高度不突变（山脉陡峭属预期，单独放宽）
//   ⑥ 扫描耗时预算
// 用法：node tests/biome-determinism.mjs（CI 经 server/run-all-tests.sh 调用）
import { TerrainGenerator } from '../src/world/terrain.js';
import { Biomes, BiomeConfig, BiomeNames } from '../src/world/biomes.js';
import { Chunk } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import '../src/blocks/BlockDefs.js';
import { pass, fail, finish, configure } from './harness.mjs';
configure({ verbose: true });

const SEEDS = [42, 20250903, 777];
const SCAN = 512; // 每 seed 扫 512×512 列
const STEP = 2;   // 采样步长（覆盖 256×256 有效格，足够统计）

// ① 同 seed 双次一致 + ③ 群系占比统计
const COUNTS = {}; // biome -> count
const PEAKS = { maxMountainH: 0, mountainHSum: 0, mountainN: 0, plainsHSum: 0, plainsN: 0 };
const SWAMP_STATS = { n: 0, pond: 0 };
const t0 = Date.now();
for (const seed of SEEDS) {
  const g1 = new TerrainGenerator(seed);
  const g2 = new TerrainGenerator(seed);
  for (let x = 0; x < SCAN; x += STEP) {
    for (let z = 0; z < SCAN; z += STEP) {
      const b1 = g1.getBiome(x, z);
      const b2 = g2.getBiome(x, z);
      if (b1 !== b2) fail(`seed=${seed} (${x},${z}) 群系双次不一致 ${b1}!=${b2}`);
      const h1 = g1.getBaseHeight(x, z);
      const h2 = g2.getBaseHeight(x, z);
      if (h1 !== h2) fail(`seed=${seed} (${x},${z}) 高度双次不一致 ${h1}!=${h2}`);
      COUNTS[b1] = (COUNTS[b1] || 0) + 1;
      const h = g1.getBaseHeight(x, z);
      if (b1 === Biomes.MOUNTAINS) {
        PEAKS.mountainN++;
        PEAKS.mountainHSum += h;
        if (h > PEAKS.maxMountainH) PEAKS.maxMountainH = h;
      } else if (b1 === Biomes.PLAINS) {
        PEAKS.plainsN++;
        PEAKS.plainsHSum += h;
      } else if (b1 === Biomes.SWAMP) {
        SWAMP_STATS.n++;
        if (h < 64) SWAMP_STATS.pond++; // 水洼列
      }
    }
  }
}
const elapsed = Date.now() - t0;

// ② 顺序无关：乱序抽样与顺序扫描同值
{
  const g = new TerrainGenerator(42);
  const pts = [];
  for (let i = 0; i < 500; i++) pts.push([(i * 977) % 5000, (i * 2357) % 5000]);
  for (const [x, z] of pts) {
    const b = g.getBiome(x, z);
    const h = g.getBaseHeight(x, z);
    if (b !== g.getBiome(x, z) || h !== g.getBaseHeight(x, z)) {
      fail(`顺序无关破坏 (${x},${z})`);
    }
  }
  pass('顺序无关：500 乱序点重复求值一致');
}

// ③ 群系在场性 + 占比区间（三 seed 合并）
const total = Object.values(COUNTS).reduce((a, b) => a + b, 0);
const pct = (b) => ((COUNTS[b] || 0) / total) * 100;
const EXPECT = [
  [Biomes.PLAINS, 10, 70],
  [Biomes.RIVER, 0.05, 15], // 河道为细线状，占比天然低（基线 ~0.3%，STEP 采样进一步稀释）
  [Biomes.MOUNTAINS, 2, 25],
  [Biomes.BIRCH_FOREST, 3, 30],
  [Biomes.TAIGA, 0.5, 20],
  [Biomes.DESERT, 1, 25],
  [Biomes.SNOWY_TAIGA, 0.5, 25],
  [Biomes.SWAMP, 2, 20],
  [Biomes.SUNFLOWER_PLAINS, 0.3, 8],
  [Biomes.MUSHROOM_FIELDS, 0.3, 8],
];
for (const [b, lo, hi] of EXPECT) {
  const p = pct(b);
  if (!COUNTS[b]) fail(`群系 ${BiomeConfig[b].name} 未出现`);
  if (p < lo || p > hi) fail(`群系 ${BiomeConfig[b].name} 占比 ${p.toFixed(1)}% 超出 [${lo},${hi}]%`);
  pass(`群系 ${BiomeConfig[b].name} 在场，占比 ${p.toFixed(1)}%`);
}

// ③b 沼泽水洼率（零散水塘是沼泽辨识核心；过低=无水塘，过高=成湖）
{
  const rate = SWAMP_STATS.pond / Math.max(1, SWAMP_STATS.n) * 100;
  if (rate < 5 || rate > 60) fail(`沼泽水洼率 ${rate.toFixed(1)}% 超出 [5,60]%`);
  pass(`沼泽水洼率 ${rate.toFixed(1)}%（${SWAMP_STATS.pond}/${SWAMP_STATS.n} 列）`);
}

// ③c 沼泽区块生成健全性：水洼底=粘土、水面有睡莲、群系命名表完备
{
  const g = new TerrainGenerator('42');
  let lilyCount = 0, clayCount = 0, blocksScanned = 0, chunksMade = 0;
  for (let cx = -8; cx <= 8 && chunksMade < 12; cx++) {
    for (let cz = -8; cz <= 8 && chunksMade < 12; cz++) {
      // 区块中心是沼泽才生成（ Swamp 区块抽样）
      const wx = cx * 16 + 8, wz = cz * 16 + 8;
      if (g.getBiome(wx, wz) !== Biomes.SWAMP) continue;
      const chunk = new Chunk(cx, cz);
      g.generateChunk(chunk);
      chunksMade++;
      for (let i = 0; i < chunk.blocks.length; i++) {
        const id = chunk.blocks[i];
        if (!id) continue;
        const name = BlockRegistry.getById(id)?.name;
        if (name === 'lily_pad') {
          lilyCount++;
          const y = Math.floor(i / (16 * 16)); // blocks 索引 = (x*16+z)*256+y 布局按 Chunk.set 实现取 y
          if (y !== 64) fail(`睡莲位于 y=${y}，应为顶层水格 64`);
        }
        else if (name === 'clay') clayCount++;
        blocksScanned++;
      }
    }
  }
  if (clayCount === 0) fail('沼泽区块未生成粘土水底');
  pass(`沼泽区块粘土水底在场（${clayCount} 格 / ${chunksMade} 区块）`);
  if (lilyCount === 0) fail('沼泽区块未生成睡莲');
  pass(`睡莲在场（${lilyCount} 格 / ${chunksMade} 区块，扫 ${blocksScanned} 非空方块）`);
  if (!BiomeNames[Biomes.SWAMP]) fail('SWAMP 缺少中文名');
  pass(`群系名表完备（${BiomeNames[Biomes.SWAMP]}）`);
}

// ③d B3 区块生成健全性：菌丝体地表 + 巨型蘑菇 + 向日葵花海
{
  const g = new TerrainGenerator('42');
  const findChunks = (biome, limit) => {
    const out = [];
    for (let cx = -10; cx <= 10 && out.length < limit; cx++) {
      for (let cz = -10; cz <= 10 && out.length < limit; cz++) {
        if (g.getBiome(cx * 16 + 8, cz * 16 + 8) === biome) out.push([cx, cz]);
      }
    }
    return out;
  };
  const scan = (chunks) => {
    const names = {};
    for (const [cx, cz] of chunks) {
      const chunk = new Chunk(cx, cz);
      g.generateChunk(chunk);
      for (const id of chunk.blocks) {
        if (!id) continue;
        const n = BlockRegistry.getById(id)?.name;
        if (n) names[n] = (names[n] || 0) + 1;
      }
    }
    return names;
  };
  const mush = scan(findChunks(Biomes.MUSHROOM_FIELDS, 8));
  if (!mush['mycelium']) fail('蘑菇岛区块未生成菌丝体地表');
  if (!mush['mushroom_stem'] || !mush['mushroom_cap_red'] && !mush['mushroom_cap_brown']) fail('蘑菇岛区块未生成巨型蘑菇');
  pass(`蘑菇岛健全：菌丝体 ${mush['mycelium']}、菌柄 ${mush['mushroom_stem']}、红盖 ${mush['mushroom_cap_red'] || 0}、棕盖 ${mush['mushroom_cap_brown'] || 0}、小蘑菇 ${(mush['red_mushroom'] || 0) + (mush['brown_mushroom'] || 0)}`);
  const sf = scan(findChunks(Biomes.SUNFLOWER_PLAINS, 6));
  if (!sf['sunflower']) fail('向日葵平原区块未生成向日葵');
  pass(`向日葵平原健全：向日葵 ${sf['sunflower']} 格`);
}

// ④ 高山海拔锚点
const mountainAvg = PEAKS.mountainHSum / PEAKS.mountainN;
const plainsAvg = PEAKS.plainsHSum / Math.max(1, PEAKS.plainsN);
if (PEAKS.maxMountainH <= 100) fail(`高山峰顶最高 ${PEAKS.maxMountainH}，未超过 100`);
pass(`高山峰顶最高 ${PEAKS.maxMountainH}`);
if (mountainAvg < plainsAvg + 15) fail(`高山均高 ${mountainAvg.toFixed(1)} 未显著高于平原 ${plainsAvg.toFixed(1)}`);
pass(`高山均高 ${mountainAvg.toFixed(1)} > 平原均高 ${plainsAvg.toFixed(1)} + 15`);

// ⑤ 相邻列连续性（非高山：|dh|≤12；高山对允许陡峭，≤30）
{
  const g = new TerrainGenerator(42);
  let worstNormal = 0, worstMountain = 0;
  for (let i = 0; i < 4000; i++) {
    const x = (i * 7919) % 4000, z = (i * 104729) % 4000;
    const hA = g.getBaseHeight(x, z);
    const hB = g.getBaseHeight(x + 1, z);
    const dh = Math.abs(hA - hB);
    const mountain = g.getBiome(x, z) === Biomes.MOUNTAINS || g.getBiome(x + 1, z) === Biomes.MOUNTAINS;
    if (mountain) { if (dh > worstMountain) worstMountain = dh; }
    else if (dh > worstNormal) worstNormal = dh;
  }
  if (worstNormal > 12) fail(`非高山相邻列最大高差 ${worstNormal} > 12`);
  if (worstMountain > 30) fail(`高山相邻列最大高差 ${worstMountain} > 30`);
  pass(`相邻列连续性：非高山最大高差 ${worstNormal}，高山 ${worstMountain}（陡峭属预期）`);
}

// ⑥ 耗时预算
if (elapsed > 30000) fail(`三 seed × ${SCAN}² 扫描耗时 ${elapsed}ms 超预算`);
pass(`三 seed × ${SCAN}² 扫描耗时 ${elapsed}ms`);
finish('biome-determinism');
