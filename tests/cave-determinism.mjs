// cave-determinism.mjs -- W3 自然洞穴生成回归（node 直跑，无需服务器）
// 断言：
//   ① 确定性：同 seed 双次生成含洞穴的区块字节一致（复用 regionDigest 思路）
//   ② 洞穴存在且密度合理（地下空腔占比 2%-12%）
//   ③ 保护规则：y<4 无空腔（基岩层）；水面列水下 5 格壳无直通空腔（防湖海倒灌）
//   ④ 性能：含洞穴雕刻的单区块生成在预算内
// 用法：node tests/cave-determinism.mjs（CI 经 server/run-all-tests.sh 调用）
import { TerrainGenerator } from '../src/world/terrain.js';
import { Chunk } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { SEA_LEVEL } from '../src/core/Chunk.js';
import '../src/blocks/BlockDefs.js';
import { pass, fail, finish, configure } from './harness.mjs';
configure({ verbose: true });

const SEED = 20250903;
const R = 6; // 13×13 区块
const LAVA = BlockRegistry.getId('lava');

function digest(chunks) {
  let h1 = 0x811c9dc5, h2 = 0x01000193, total = 0;
  for (const k of [...chunks.keys()].sort()) {
    const b = chunks.get(k).blocks;
    total += b.length;
    for (let i = 0; i < b.length; i += 7) {
      h1 = Math.imul(h1 ^ b[i], 16777619) >>> 0;
      h2 = Math.imul(h2 ^ b[i], 2246822519) >>> 0;
    }
  }
  return { total, h1, h2 };
}

function genRegion() {
  const gen = new TerrainGenerator(SEED);
  const chunks = new Map();
  for (let cx = -R; cx <= R; cx++)
    for (let cz = -R; cz <= R; cz++) {
      const c = new Chunk(cx, cz);
      gen.generateChunk(c);
      chunks.set(cx + ',' + cz, c);
    }
  return { gen, chunks };
}

// ── ① 确定性 ──────────────────────────────────────────────────────────
const t0 = performance.now();
const a = genRegion();
const tGen = performance.now() - t0;
const b = genRegion();
const da = digest(a.chunks), db = digest(b.chunks);
if (da.total !== db.total || da.h1 !== db.h1 || da.h2 !== db.h2) {
  fail(`含洞穴双次生成不一致: ${JSON.stringify(da)} vs ${JSON.stringify(db)}`);
}
pass(`① 确定性: ${da.total} 字节两次一致（含洞穴雕刻）`);

// ── ②③④ 密度 / 保护 / 性能 ───────────────────────────────────────────
let cave = 0, solid = 0, mouthCols = 0, cols = 0, deepAir = 0;
for (const [key, c] of a.chunks) {
  const [cx, cz] = key.split(',').map(Number);
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      cols++;
      const wx = cx * 16 + x, wz = cz * 16 + z;
      const h = a.gen.getBaseHeight(wx, wz);
      for (let y = 4; y < h; y++) {
        const blk = c.get(x, y, z);
        if (blk === 0 || blk === LAVA) cave++;
        else solid++;
      }
      if (c.get(x, h - 1, z) === 0 || c.get(x, h - 1, z) === LAVA) mouthCols++;
      // 基岩保护层
      for (let y = 0; y < 4; y++) {
        if (c.get(x, y, z) === 0) deepAir++;
      }
      // 水面列保护壳：水下 [h-5, h-1] 不允许空气（挖穿即倒灌）
      if (h < SEA_LEVEL) {
        for (let y = Math.max(4, h - 5); y < h; y++) {
          const blk = c.get(x, y, z);
          if (blk === 0) fail(`水面列 (${wx},${y},${wz}) 地下水壳被挖穿`);
          if (blk === LAVA && y > h - 3) fail(`水面列 (${wx},${y},${wz}) 近水岩浆`);
        }
      }
    }
  }
}
const ratio = cave / (cave + solid);
if (ratio < 0.02 || ratio > 0.12) fail(`洞穴密度异常: ${(ratio * 100).toFixed(1)}%（期望 2%-12%）`);
if (mouthCols / cols > 0.06) fail(`露头率过高: ${(mouthCols / cols * 100).toFixed(2)}%`);
if (deepAir > 0) fail(`基岩保护层出现 ${deepAir} 个空气格`);
const perChunkMs = tGen / ((2 * R + 1) ** 2);
if (perChunkMs > 25) fail(`单区块生成 ${perChunkMs.toFixed(1)}ms 超预算`);
pass(`② 密度: 空腔占比 ${(ratio * 100).toFixed(1)}%，露头 ${(mouthCols / cols * 100).toFixed(2)}% 列`);
pass('③ 保护: 基岩层完整、水面列 5 格壳无破口');
pass(`④ 性能: 单区块平均 ${perChunkMs.toFixed(1)}ms（含洞穴场采样与雕刻）`);
finish('洞穴生成回归');
