// build40-greedy-uv-axis.mjs -- B40 贪心合并贴图 u/v 轴回归（纯 node，不依赖服务器）
// 背景：B39 的 FACE_UV_AXIS 把"纹理 u 方向"与"纹理 v 方向"写反，合并面的 repU/repV 互换，
// 非方形合并区（w≠d）的贴图被各向异性拉伸——横条 16×1 会压成 16 倍细条，视觉上是长条涂抹。
// 方形合并区 w=d 时互换无影响，故旧回归全部通过。
//
// 本套件用**独立 oracle**断言：不复用 FACE_UV_AXIS，直接从合并四边形的顶点几何反推
//   顶点 0 → 顶点 2 的物理位移 = 纹理 u 方向（顶点 UV 顺序 (u0,v0)(u0,v1)(u1,v0)(u1,v1)）
//   顶点 0 → 顶点 1 的物理位移 = 纹理 v 方向
// 该位移的格数必须等于 aUvTile 记录的 (repU, repV)。
// 断言：
//   ① 非方形合并（8×16 平板）：每个四边形的 repU/repV 都等于几何跨度
//   ② 场景确实覆盖了 w≠d 的合并（防"全部方形、测试恒真"）
//   ③ 六个面方向（顶/底/±X/±Z）都成立（浮空薄板，侧立面跨度 y/z 不同）
//   ④ 未被合并的逐面四边形 rep=(1,1)
//   ⑤ 天光切分后仍成立（合并区变小但 u/v 轴不变）
import '../src/blocks/BlockDefs.js';
import { World } from '../src/core/World.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ChunkMeshBuilder } from '../src/render/ChunkMesh.js';
import { assert, finish } from './harness.mjs';

const THREE = await import('three');
const STONE = BlockRegistry.getId('stone');
const GLOWSTONE = BlockRegistry.getId('glowstone');

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

function makeChunk(place, sky = 15) {
  const world = new World(4242);
  const chunk = world.ensureChunk(0, 0);
  chunk.blocks.fill(0);
  for (const [x, y, z, id] of place) chunk.blocks[idx3(x, y, z)] = id;
  for (let y = 0; y < 256; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const s = typeof sky === 'function' ? sky(x, y, z) : sky;
        chunk.light[idx3(x, y, z)] = (s << 4);
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

// 独立 oracle：逐四边形校验 repU/repV 与顶点几何跨度一致。
// 顶点 UV 顺序 (u0,v0)(u0,v1)(u1,v0)(u1,v1) → v0→v2 是 u 方向，v0→v1 是 v 方向。
// 面轴对齐，故用三维位移的非零分量（欧氏距离）。
function checkQuads(out, label) {
  const pos = out.solid.position, tile = out.solid.uvTile;
  const nQuad = out.solid.index.length / 6;
  let bad = 0, nonSquare = 0, firstBad = null;
  const dist = (i, j) => {
    const dx = pos[j] - pos[i], dy = pos[j + 1] - pos[i + 1], dz = pos[j + 2] - pos[i + 2];
    return Math.round(Math.hypot(dx, dy, dz) * 1000) / 1000;
  };
  for (let q = 0; q < nQuad; q++) {
    const b = q * 4;         // 顶点基址（position/uv 数组按顶点）
    const t = q * 16;        // aUvTile 每顶点 4 分量 → 四边形基址 = q*16
    const repU = tile[t + 2], repV = tile[t + 3];
    if (repU !== repV) nonSquare++;
    const spanU = dist(b * 3, (b + 2) * 3);   // 纹理 u 方向的物理跨度（格）
    const spanV = dist(b * 3, (b + 1) * 3);   // 纹理 v 方向的物理跨度（格）
    if (Math.abs(repU - spanU) > 1e-6 || Math.abs(repV - spanV) > 1e-6) {
      bad++;
      if (!firstBad) firstBad = `quad#${q} rep=(${repU},${repV}) 几何跨度=(u ${spanU}, v ${spanV})`;
    }
  }
  assert(`${label}：全部四边形 repU/repV = 顶点几何跨度`, bad === 0, `${bad}/${nQuad} 不一致，例：${firstBad}`);
  return { nonSquare, nQuad };
}

// ---- 场景 A：8 宽 × 16 深的顶面（x 8 格、z 16 格），顶面必为 8×16 非方形合并区 ----
{
  const place = [];
  for (let x = 0; x < 8; x++) for (let z = 0; z < 16; z++) place.push([x, 100, z, STONE]);
  const out = collect(makeChunk(place));
  const { nonSquare } = checkQuads(out, '① 8×16 平板');
  assert('② 场景覆盖 w≠d 的合并面（防测试恒真）', nonSquare > 0, '没有任何非方形合并区');
}

// ---- 场景 C：浮空薄板（1 格厚），六个面方向全覆盖，侧立面 y/z 跨度不同 ----
{
  const place = [];
  for (let x = 2; x < 12; x++) for (let z = 4; z < 9; z++) place.push([x, 120, z, STONE]);
  const out = collect(makeChunk(place));
  checkQuads(out, '③ 浮空薄板（六面方向）');
}

// ---- 场景 D：被切开的天光（合并区变小，u/v 轴不变） ----
{
  const place = [];
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) place.push([x, 100, z, STONE]);
  const out = collect(makeChunk(place, (x) => (x < 5 ? 15 : 12)));
  const { nonSquare } = checkQuads(out, '⑤ 天光切分后');
  assert('⑤ 天光切分后仍有非方形合并区（覆盖到位）', nonSquare > 0, '没有非方形合并区');
}

// ---- 场景 E：逐面直推路径（自发光方块不进合并桶）rep 恒 (1,1) ----
{
  const place = [];
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) place.push([x, 100, z, GLOWSTONE]);
  const out = collect(makeChunk(place));
  const tile = out.solid.uvTile;
  let bad = 0;
  for (let i = 0; i < tile.length; i += 4) if (tile[i + 2] !== 1 || tile[i + 3] !== 1) bad++;
  assert('④ 自发光面走逐面直推：rep 恒为 (1,1)', bad === 0, `${bad} 个顶点 rep≠1`);
}

finish();
