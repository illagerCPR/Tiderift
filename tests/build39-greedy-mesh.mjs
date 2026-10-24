// build39-greedy-mesh.mjs -- B39 U-1 实体方块贪心合并回归（纯 node，不依赖服务器）
// 场景全部用合成区块（直接写入 chunk.blocks / chunk.light，四邻区块缺失即空气），光照可精确控制。
// 断言：
//   ① 均一平板合并到最少四边形：顶/底各 1 + 四侧各 1 = 6，顶点数 = 24
//   ② 负对照：天光被切开后不再合并（非恒真防线）
//   ③ aUvTile 与顶点数严格对齐（cross / flat / 形制盒 / 流体 / 自发光 各条直推路径都写满）
//   ④ 合并面平铺参数 = 合并区跨度（顶面 16 格 → rep 16）
//   ⑤ Worker 绊线：mesh worker 按 Object.values 转移属性且复用 _collectData
import '../src/blocks/BlockDefs.js';
import { World } from '../src/core/World.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ChunkMeshBuilder } from '../src/render/ChunkMesh.js';
import { readFileSync } from 'node:fs';
import { assert, finish } from './harness.mjs';

const THREE = await import('three');
const STONE = BlockRegistry.getId('stone');
const GLOWSTONE = BlockRegistry.getId('glowstone');
const TORCH = BlockRegistry.getId('torch');
const WATER = BlockRegistry.getId('water');

// 伪造图集 UV：同一纹理名返回同一定值对象（贪心合并靠引用比较判"同一贴图"）
class UvMap extends Map {
  constructor() { super(); this._n = 0; this._cache = new Map(); }
  get(name) {
    let v = this._cache.get(name);
    if (v) return v;
    const i = this._n++;
    v = { u0: i / 32, v0: 0, u1: (i + 1) / 32, v1: 1 / 16 };
    this._cache.set(name, v);
    return v;
  }
}

const idx3 = (x, y, z) => (y * 16 + z) * 16 + x;

// 合成区块：place = [[x,y,z,id], ...]；sky/blockL 可为常量或 (x,y,z)=>0..15
function makeChunk(place, sky = 15, blockL = 0) {
  const world = new World(4242);
  const chunk = world.ensureChunk(0, 0);
  chunk.blocks.fill(0);
  for (const [x, y, z, id] of place) chunk.blocks[idx3(x, y, z)] = id;
  for (let y = 0; y < 256; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const s = typeof sky === 'function' ? sky(x, y, z) : sky;
        const b = typeof blockL === 'function' ? blockL(x, y, z) : blockL;
        chunk.light[idx3(x, y, z)] = (s << 4) | b;
      }
    }
  }
  return { chunk, world };
}

function collect({ chunk, world }) {
  const builder = new ChunkMeshBuilder(world, new THREE.Texture(), new UvMap(), new THREE.Texture());
  builder._curChunk = chunk;
  builder._fillCache(chunk);
  builder._fillLightCaches(chunk);
  builder._refreshOpaqueLUT();
  return builder._collectData(chunk);
}

const quads = (out) => (out.solid ? out.solid.index.length / 6 : 0);
const verts = (out) => (out.solid ? out.solid.position.length / 3 : 0);

const slab = [];
for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) slab.push([x, 100, z, STONE]);

// ---- ① 均一平板 ----
{
  const out = collect(makeChunk(slab));
  assert('① 均一平板合并为 6 个四边形（顶/底/四侧各 1）', quads(out) === 6, `实际 ${quads(out)}`);
  assert('① 顶点数 = 6 × 4 = 24', verts(out) === 24, `实际 ${verts(out)}`);
}

// ---- ② 负对照：顶面天光被切成两半 → 不合并成一整张 ----
{
  const out = collect(makeChunk(slab, (x) => (x < 8 ? 15 : 12)));
  assert('② 天光不一致时顶面不再合并（四边形数增加）', quads(out) > 6, `实际 ${quads(out)}`);
}

// ---- ③ 各条直推路径都写满 aUvTile ----
{
  const place = slab.slice();
  place.push([2, 101, 2, TORCH]);
  place.push([3, 101, 2, GLOWSTONE]);
  const door = BlockRegistry.getId('oak_door');
  if (door) place.push([6, 101, 6, door]);
  const lily = BlockRegistry.getId('lily_pad');
  if (lily) place.push([4, 101, 10, lily]);
  for (let x = 8; x < 12; x++) for (let z = 8; z < 12; z++) place.push([x, 101, z, WATER]);
  const out = collect(makeChunk(place));
  const v = verts(out);
  assert('③ aUvTile 长度 = 顶点数 × 4', out.solid.uvTile.length === v * 4, `${out.solid.uvTile.length} vs ${v * 4}`);
  assert('③ color/voxelLight 与顶点数对齐', out.solid.color.length === v * 3 && out.solid.voxelLight.length === v * 2);
  assert('③ 水面组不带 aUvTile（走独立 RepeatWrapping 纹理）', out.water === null || out.water.uvTile === null);
}

// ---- ④ 平铺参数 ----
{
  const t = collect(makeChunk(slab)).solid.uvTile;
  let maxRep = 1, bad = 0;
  for (let i = 0; i < t.length; i += 4) {
    const ru = t[i + 2], rv = t[i + 3];
    if (!(ru >= 1) || !(rv >= 1)) bad++;
    if (ru > maxRep) maxRep = ru;
    if (rv > maxRep) maxRep = rv;
  }
  assert('④ 所有顶点平铺重复次数 ≥ 1', bad === 0, `异常 ${bad} 个`);
  assert('④ 顶/底面横向合并到 16 格（rep = 16）', maxRep === 16, `实际 ${maxRep}`);
}

// ---- ⑤ Worker 绊线 ----
{
  const src = readFileSync(new URL('../src/workers/MeshWorker.js', import.meta.url), 'utf8');
  assert('⑤ MeshWorker 按 Object.values 枚举属性做 transfer（勿改成写死列表）', /Object\.values\(g\)/.test(src));
  assert('⑤ MeshWorker 复用 _collectData（同步/Worker 单一实现）', /_collectData/.test(src));
}

// ---- ⑥ 片元采样公式等价：合并四边形的平铺采样与逐面采样落在同一纹素 ----
// 复刻 VoxelLight 的 ATLAS_TILED_MAP_GLSL：
//   tileLocal = fract((vMapUv - lo) / span * rep * 0.999999)
// 未合并面 rep=(1,1) → 退化为原采样；合并面 rep=(w,d) → 每格一次 tile。
{
  const span = 1 / 16;
  const lo = { u: 0.25, v: 0.5 };
  const sampleMerged = (s, t, w, d) => {
    const tl = ((s * w) * 0.999999) % 1;
    const tv = ((t * d) * 0.999999) % 1;
    return [lo.u + tl * span, lo.v + tv * span];
  };
  let worst = 0;
  const w = 5, d = 3;
  for (let j = 0; j < 64; j++) {
    for (let i = 0; i < 64; i++) {
      const s = (i + 0.5) / 64, t = (j + 0.5) / 64;
      const [mu, mv] = sampleMerged(s, t, w, d);
      // 逐面：落点所在格的格内局部坐标
      const ci = Math.min(w - 1, Math.floor(s * w));
      const cj = Math.min(d - 1, Math.floor(t * d));
      const su = lo.u + (s * w - ci) * span;
      const sv = lo.v + (t * d - cj) * span;
      worst = Math.max(worst, Math.abs(mu - su), Math.abs(mv - sv));
    }
  }
  assert('⑥ 合并平铺采样与逐面采样逐点一致（误差 < 一个纹素的 1%）', worst < span / 100, `最大偏差 ${worst.toExponential(2)}`);
}

finish();
