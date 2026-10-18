// biome-scale-determinism.mjs -- 生物群系规模档位回归（node 直跑，无需服务器）// 断言四条不变量：
//   ① 同 seed 同档位双次 getBiome → 完全一致（确定性根基）
//   ② small 档位与无参构造 → getBiome 逐采样一致 + 区块字节一致（旧世界零变化锚点）
//   ③ 群系斑块尺寸随档位单调放大（相邻 16 格同群系占比 small < medium < large < huge）
//   ④ 采样与单区块生成耗时在预算内（频率缩放不引入可感知开销）
// 用法：node tests/biome-scale-determinism.mjs（CI 经 server/run-all-tests.sh 调用）
import { TerrainGenerator } from '../src/world/terrain.js';
import { Chunk } from '../src/core/Chunk.js';
import { BIOME_SCALES, DEFAULT_BIOME_SCALE, safeBiomeScale } from '../src/world/biomes.js';
import '../src/blocks/BlockDefs.js';
import { check, finish } from './harness.mjs';

const SEED = 42;
const SAMPLE_STEP_X = 7, SAMPLE_STEP_Z = 11, SAMPLE_RANGE = 2000;

// 采样网格：固定步长覆盖 ±2000（覆盖群系特征周期的多倍，避免小窗口假阴性）
function sampleBiomes(gen) {
  const out = [];
  for (let x = -SAMPLE_RANGE; x < SAMPLE_RANGE; x += SAMPLE_STEP_X)
    for (let z = -SAMPLE_RANGE; z < SAMPLE_RANGE; z += SAMPLE_STEP_Z)
      out.push(gen.getBiome(x, z));
  return out;
}

// 区块字节摘要（双滚动哈希，步长 7 采样）
function chunkDigest(gen, cx, cz) {
  const c = new Chunk(cx, cz);
  gen.generateChunk(c);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const b = c.blocks;
  for (let i = 0; i < b.length; i += 7) {
    h1 = (h1 ^ b[i]) * 16777619 >>> 0;
    h2 = (h2 + b[i] * (i + 1)) >>> 0;
  }
  return `${h1},${h2}`;
}

console.log('=== biome-scale-determinism ===');

// ① 同 seed 同档位双次一致
{
  const a = sampleBiomes(new TerrainGenerator(SEED, 'large'));
  const b = sampleBiomes(new TerrainGenerator(SEED, 'large'));
  check('① 同档位双次 getBiome 一致', a.length === b.length && a.every((v, i) => v === b[i]),
    `${a.length} 采样点`);
}

// ② small 与无参构造一致（旧世界不变锚点）——getBiome 与区块字节双验证
{
  const g0 = new TerrainGenerator(SEED);
  const g1 = new TerrainGenerator(SEED, 'small');
  const b0 = sampleBiomes(g0), b1 = sampleBiomes(g1);
  const same = b0.length === b1.length && b0.every((v, i) => v === b1[i]);
  check('②a small 与无参构造 getBiome 一致', same, `${b0.length} 采样点`);
  const d0 = chunkDigest(g0, 3, -5), d1 = chunkDigest(g1, 3, -5);
  check('②b small 与无参构造区块字节一致', d0 === d1, `chunk(3,-5) digest=${d0}`);
}

// ③ 斑块尺寸单调放大：相邻 16 格同群系占比（步长抽稀控制耗时，2 seeds 取均值）
{
  function continuity(scale, seed) {
    const g = new TerrainGenerator(seed, scale);
    let same = 0, n = 0;
    for (let x = 0; x < 3000; x += 3)
      for (let z = 0; z < 3000; z += 16) {
        if (g.getBiome(x, z) === g.getBiome(x + 16, z)) same++;
        n++;
      }
    return same / n;
  }
  const scales = Object.keys(BIOME_SCALES);
  const avg = {};
  for (const s of scales) avg[s] = (continuity(s, 7) + continuity(s, 2027)) / 2;
  const mono = avg.small < avg.medium && avg.medium < avg.large && avg.large < avg.huge;
  check('③ 群系连通占比单调放大', mono,
    scales.map(s => `${BIOME_SCALES[s].label}=${avg[s].toFixed(3)}`).join(' '));
  // small（现状）应明显低于 huge：档位间要有可感知差异，不是装饰性参数
  check('③b huge 与 small 差异可感知', avg.huge - avg.small > 0.1,
    `Δ=${(avg.huge - avg.small).toFixed(3)}（阈值 0.1）`);
}

// ④ 档位清洗 + 耗时预算
{
  check('④a safeBiomeScale 非法值回落 small',
    safeBiomeScale('xxx') === DEFAULT_BIOME_SCALE && safeBiomeScale(undefined) === DEFAULT_BIOME_SCALE
      && safeBiomeScale('HUGE') === DEFAULT_BIOME_SCALE && safeBiomeScale('huge') === 'huge');
  const t0 = performance.now();
  sampleBiomes(new TerrainGenerator(SEED, 'huge'));
  const ms = performance.now() - t0;
  check('④b 采样耗时预算', ms < 3000, `${ms.toFixed(0)}ms / ${sampleBiomes(new TerrainGenerator(SEED, 'huge')).length} 点（阈值 3000ms）`);
}
finish('biome-scale-determinism');
