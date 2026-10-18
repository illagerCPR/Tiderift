// structure-determinism.mjs -- 结构生成确定性回归（node 直跑，无需服务器）
// 断言四条不变量：
//   ① 同 seed 双次生成 → 区块字节完全一致
//   ② 区块生成顺序无关（正向 vs 逆序）→ 字节一致（跨区块裁剪正确性的根基）
//   ③ 跨区块结构连续：测试平台横跨多个区块，逐列读回不断裂
//   ④ 单区块生成耗时在预算内（结构扫描不拖垮区块管线）
// 用法：node tests/structure-determinism.mjs（CI 经 server/run-all-tests.sh 调用）
import { TerrainGenerator } from '../src/world/terrain.js';
import { Chunk } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { registerStructureType } from '../src/world/structures/StructureManager.js';
import { fillBox } from '../src/world/structures/StructureKit.js';
import '../src/blocks/BlockDefs.js';
import { pass, fail, finish, configure } from './harness.mjs';
configure({ verbose: true });

const SEED = 20250903;
const REGION = 16; // 区块范围 [-16,16]，33×33=1089 块（cell=16 的锚点抖动跨 16 区块，区域须盖满候选）
const PLATFORM_ID_NAME = 'stone_bricks';

// 测试结构：chance=1 + 无坡度限制 → 命中 cell 必放置；平台 97×5 横跨约 6 个区块
registerStructureType('test-platform', {
  cell: 16,
  radius: 48,
  chance: 1,
  salt: 777,
  biomes: null,
  maxSlope: 255,
  solve(rng, ax, groundY, az) {
    const blocks = [];
    fillBox(blocks, ax - 48, groundY, az - 2, ax + 48, groundY, az + 2,
      BlockRegistry.getId(PLATFORM_ID_NAME));
    return { blocks, meta: {} };
  },
});

function makeGen() { return new TerrainGenerator(SEED); }

function genRegion(order = 'forward') {
  const gen = makeGen();
  const coords = [];
  for (let cx = -REGION; cx <= REGION; cx++)
    for (let cz = -REGION; cz <= REGION; cz++)
      coords.push([cx, cz]);
  if (order === 'reverse') coords.reverse();
  const chunks = new Map();
  for (const [cx, cz] of coords) {
    const c = new Chunk(cx, cz);
    gen.generateChunk(c);
    chunks.set(cx + ',' + cz, c);
  }
  return { gen, chunks };
}

function regionDigest(chunks) {
  // 按键名排序后串联哈希（Map 插入序=生成序，直接遍历会对顺序敏感）；
  // 区块内步长 7 采样双滚动哈希
  let h1 = 0x811c9dc5, h2 = 0x01000193, total = 0;
  const keys = [...chunks.keys()].sort();
  for (const k of keys) {
    const b = chunks.get(k).blocks;
    total += b.length;
    for (let i = 0; i < b.length; i += 7) {
      h1 = Math.imul(h1 ^ b[i], 16777619) >>> 0;
      h2 = Math.imul(h2 ^ b[i], 2246822519) >>> 0;
    }
  }
  return { total, h1, h2 };
}

function readBlock(chunks, wx, wy, wz) {
  const cx = Math.floor(wx / 16), cz = Math.floor(wz / 16);
  const c = chunks.get(cx + ',' + cz);
  if (!c) return -1;
  return c.get(wx - cx * 16, wy, wz - cz * 16);
}

// ── ① 同 seed 双次生成字节一致 ─────────────────────────────────────────
const a = genRegion('forward');
const b = genRegion('forward');
const da = regionDigest(a.chunks), db = regionDigest(b.chunks);
if (da.total !== db.total || da.h1 !== db.h1 || da.h2 !== db.h2) {
  fail(`双次生成不一致: ${JSON.stringify(da)} vs ${JSON.stringify(db)}`);
}
pass(`① 确定性: ${da.total} 字节, 两次一致`);

// ── ② 生成顺序无关 ─────────────────────────────────────────────────────
const r = genRegion('reverse');
const dr = regionDigest(r.chunks);
if (dr.total !== da.total || dr.h1 !== da.h1 || dr.h2 !== da.h2) {
  fail(`顺序相关: 正序 ${JSON.stringify(da)} vs 逆序 ${JSON.stringify(dr)}`);
}
pass('② 顺序无关: 正序/逆序字节一致');

// ── ③ 跨区块结构连续 ───────────────────────────────────────────────────
const worldMin = -REGION * 16, worldMax = REGION * 16 + 15;
const allRecs = a.gen.structureManager.debugRecords().filter(x => x.name === 'test-platform');
// 只断言完全落在生成区域内的记录（边界处的锚点其平台延伸到未生成区块，属正常）
const recs = allRecs.filter(x => x.minX >= worldMin && x.maxX <= worldMax && x.minZ >= worldMin && x.maxZ <= worldMax);
if (allRecs.length === 0) fail('区域内未找到任何测试结构锚点（扫描/选址失效）');
if (recs.length === 0) fail(`${allRecs.length} 个锚点全部越出区域（区域过小或抖动异常），无法做连续性断言`);
const platformId = BlockRegistry.getId(PLATFORM_ID_NAME);
let checked = 0;
for (const rec of recs) {
  for (let wx = rec.minX; wx <= rec.maxX; wx++) {
    const id = readBlock(a.chunks, wx, rec.groundY, rec.az);
    if (id !== platformId) {
      fail(`平台断裂 @(${wx},${rec.groundY},${rec.az}) 期望 ${platformId} 实得 ${id}（锚点 ${rec.ax},${rec.az}）`);
    }
    checked++;
  }
}
pass(`③ 跨区块连续: ${recs.length} 个锚点平台逐列检查 ${checked} 列无断裂`);

// ── ④ 单区块生成耗时预算 ───────────────────────────────────────────────
{
  const gen = makeGen();
  const c = new Chunk(0, 0);
  const t0 = performance.now();
  gen.generateChunk(c);
  const ms = performance.now() - t0;
  if (ms > 200) fail(`单区块生成耗时异常: ${ms.toFixed(1)}ms`);
  pass(`④ 性能: 单区块生成 ${ms.toFixed(1)}ms（含测试结构扫描）`);
}
finish('结构生成确定性回归');
