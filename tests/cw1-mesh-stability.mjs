// cw1-mesh-stability.mjs -- CW-1 区块边界伪影的行为级钉值（node 直跑，无需服务器）
// 背景：邻居区块尚未加载时构建的网格会把边界外当空气，多画本应剔除的边界面
//（水柱整列侧面远看呈区块对齐的直线分界）。修复链在 node 里可见的两层：
//   ChunkMeshBuilder._fillCache 记录"本次构建时缺失的边界邻居方向位" → Chunk._meshEdgeMask
//   World._finalizeChunk 在新区块就绪后，反向标脏此前把本区块当空气的邻居（n._meshEdgeMask & bit）
// 断言：
//   ① 方向位语义：首建时四向邻居全缺 → _meshEdgeMask = 15（1=-x 2=+x 4=-z 8=+z），逐位核对
//   ② 反向标脏：邻居逐个 ensureChunk 到位后本区块被重新标脏（每轮先把 dirty 清成 false）
//   ③ 稳定态收敛：邻居到齐并重建后，solid/water 各顶点属性与"邻居一开始就齐"的参照 World 逐位全等
//   ④ 非恒真防线：邻居缺失时构建的网格确实多画了边界面（顶点数严格更多）
//   ⑤ 因果隔离：桩断光照标脏通道后反向标脏仍发生（归属 _finalizeChunk 的掩码那几行）
//   ⑥ 假阳性防线：掩码未命中的邻居不被无谓标脏（同一条代码路径的正/负对照）
// 第三层修复（Game._applyMeshOut 不在落地清脏 / _dispatchMeshBuild 派发时清脏）在 node 里无法
// 实例化 Game，由既有源码绊线 tests/build24-fixes.mjs ④ 段覆盖；本套件补的是行为级证据。
import '../src/blocks/BlockDefs.js';
import { World } from '../src/core/World.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ChunkMeshBuilder } from '../src/render/ChunkMesh.js';
import { assert, finish } from './harness.mjs';

const THREE = await import('three');
const SEED = 20260214;
const STONE = BlockRegistry.getId('stone');
const WATER = BlockRegistry.getId('water');
const newBuilder = (world) => new ChunkMeshBuilder(world, new THREE.Texture(), new Map(), new THREE.Texture());

// 与 Game.rebuildDirtyChunks 同步路径同序：填方块缓存 → 填光缓存 → 刷不透明 LUT → 收集数据
function buildChunk(world, builder, cx, cz) {
  const chunk = world.ensureChunk(cx, cz);
  builder._fillCache(chunk);
  builder._fillLightCaches(chunk);
  builder._refreshOpaqueLUT();
  return { chunk, out: builder._collectData(chunk) };
}

// 场景：本区块内的石头平台（四边贴界）+ 贴着 +x 界的水柱（CW-1 症状的典型载体）
function fillInner(w) {
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) w.setBlock(x, 100, z, STONE, false);
  for (let y = 101; y <= 104; y++) for (let z = 0; z < 16; z++) w.setBlock(15, y, z, WATER, false);
}
// 邻居侧贴界补块：邻居在位时这些边界面应被剔除（邻居缺失时才会被多画）
function fillBorder(w) {
  for (let z = 0; z < 16; z++) {
    w.setBlock(16, 100, z, STONE, false); w.setBlock(-1, 100, z, STONE, false);
    for (let y = 101; y <= 104; y++) w.setBlock(16, y, z, WATER, false);
  }
  for (let x = 0; x < 16; x++) {
    w.setBlock(x, 100, 16, STONE, false); w.setBlock(x, 100, -1, STONE, false);
    for (let y = 101; y <= 104; y++) w.setBlock(x, y, 16, WATER, false);
  }
}

// 逐元素严格比较（同一代码路径应逐位一致）；失败时给出差异数/首差下标/最大绝对差
function assertSame(label, a, b) {
  if (!a || !b) { assert(label, false, `数组缺失 (A=${!!a} B=${!!b})`); return; }
  const n = Math.min(a.length, b.length);
  let diff = Math.abs(a.length - b.length), maxAbs = 0, first = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d !== 0) { diff++; if (first < 0) first = i; if (d > maxAbs) maxAbs = d; }
  }
  const same = diff === 0;
  assert(label, same, same ? `(${a.length} 元素逐位一致)` : `差异 ${diff} 元素，首差 idx=${first}，maxΔ=${maxAbs}`);
}

// ── ①②③④ 主干：增量加载路径 vs 参照（邻居一开始就齐）──
{
  const wInc = new World(SEED);
  const bInc = newBuilder(wInc);
  wInc.ensureChunk(0, 0);          // 只加载本区块，四邻全缺
  fillInner(wInc);                 // 只在本区块内放块（setBlock 会 ensureChunk，不能碰邻居坐标）
  const naive = buildChunk(wInc, bInc, 0, 0);
  const c00 = naive.chunk;

  const mask = c00._meshEdgeMask;
  assert('CW-1 ①首建时 -x 邻居缺失 → 掩码位 1', (mask & 1) === 1, `mask=${mask}`);
  assert('CW-1 ①首建时 +x 邻居缺失 → 掩码位 2', (mask & 2) === 2, `mask=${mask}`);
  assert('CW-1 ①首建时 -z 邻居缺失 → 掩码位 4', (mask & 4) === 4, `mask=${mask}`);
  assert('CW-1 ①首建时 +z 邻居缺失 → 掩码位 8', (mask & 8) === 8, `mask=${mask}`);
  assert('CW-1 ①四向邻居全缺 → _meshEdgeMask = 15', mask === 15, `mask=${mask}`);

  for (const [dx, dz, dir] of [[1, 0, '+x'], [-1, 0, '-x'], [0, 1, '+z'], [0, -1, '-z']]) {
    c00.dirty = false;                       // 先清脏：断言的是"这一次 ensure 把它标脏了"
    wInc.ensureChunk(dx, dz);
    assert(`CW-1 ②${dir} 邻居 ensureChunk(${dx},${dz}) 后本区块被反向标脏`, c00.dirty === true, `dirty=${c00.dirty}`);
  }

  fillBorder(wInc);                // 邻居侧补块，与参照场景保持同一方块集
  const stable = buildChunk(wInc, bInc, 0, 0);
  assert('CW-1 ③邻居到齐后重建，掩码清零', stable.chunk._meshEdgeMask === 0, `mask=${stable.chunk._meshEdgeMask}`);

  const wRef = new World(SEED);
  const bRef = newBuilder(wRef);
  for (const [cx, cz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [0, 0]]) wRef.ensureChunk(cx, cz);
  fillInner(wRef); fillBorder(wRef);
  const ref = buildChunk(wRef, bRef, 0, 0);
  assert('CW-1 ③参照场景（邻居一开始就在）掩码始终为 0', ref.chunk._meshEdgeMask === 0, `mask=${ref.chunk._meshEdgeMask}`);

  const v = (out, g) => (out[g] ? out[g].position.length / 3 : 0);
  assert('CW-1 ④非恒真：邻居缺失时实心网格确实多画了边界面（顶点数严格更多）',
    v(naive.out, 'solid') > v(stable.out, 'solid'),
    `首建 ${v(naive.out, 'solid')} 顶点 > 稳定态 ${v(stable.out, 'solid')}`);
  assert('CW-1 ④非恒真：水面网格同样多画（水柱侧边界面的 CW-1 症状）',
    v(naive.out, 'water') > v(stable.out, 'water'),
    `首建 ${v(naive.out, 'water')} 顶点 > 稳定态 ${v(stable.out, 'water')}`);

  // 稳定态收敛：缺失邻居时构建的网格，在邻居到齐 + 反向标脏重建后与参照逐位全等
  for (const group of ['solid', 'water']) {
    const a = stable.out[group], b = ref.out[group];
    assert(`CW-1 ③${group} 几何组两端同时存在（都非空或同时为空）`, !!a === !!b, `稳定态=${!!a} 参照=${!!b}`);
    if (!a || !b) continue;
    for (const key of ['position', 'normal', 'uv', 'color', 'voxelLight', 'index']) {
      assertSame(`CW-1 ③稳定态全等：${group}.${key} 与参照逐元素一致`, a[key], b[key]);
    }
  }
}

// ── ⑤⑥ 因果隔离 + 假阳性防线（邻居对，桩断光照标脏通道）──
{
  const w = new World(SEED);
  const b = newBuilder(w);
  // 让 (-1,0) 的其余三邻在场，唯一缺席的是 +x 邻居 (0,0)
  for (const [cx, cz] of [[-2, 0], [-1, -1], [-1, 1]]) w.ensureChunk(cx, cz);
  const cNeg = w.ensureChunk(-1, 0);
  // _finalizeChunk 里能把邻居标脏的只有两条：光照泛洪（initChunkLight）与 CW-1 反向标脏。
  // 桩断前者（仅本测试实例上的桩，不改工程文件），之后邻居 dirty 的任何变化只能归属后者。
  w.lightEngine.initChunkLight = () => {};
  const probe = w.ensureChunk(-1, 0);  // 已存在 → 直接返回、不重新收尾（下面实验的对照前提）
  assert('CW-1 ⑤对照前提：已存在的区块 ensureChunk 不重复收尾', probe === cNeg);

  buildChunk(w, b, -1, 0);
  assert('CW-1 ⑤因果隔离准备：(-1,0) 三邻在场、仅 (0,0) 缺席时构建 → 掩码恰为 2',
    cNeg._meshEdgeMask === 2, `mask=${cNeg._meshEdgeMask}`);
  cNeg.dirty = false;
  w.ensureChunk(0, 0);                 // 邻居就绪：只有反向标脏这一条路径能改 cNeg.dirty
  assert('CW-1 ⑤因果隔离：屏蔽光照通道后，仅掩码反向标脏仍把 (-1,0) 标脏',
    cNeg.dirty === true, `dirty=${cNeg.dirty}`);

  // ⑥ 负向对照：邻居一开始就在（掩码未命中）→ 同一 ensure 路径不应再标脏
  buildChunk(w, b, -1, 0);
  assert('CW-1 ⑥负向对照准备：(-1,0) 四邻到齐后重建 → 掩码清零', cNeg._meshEdgeMask === 0, `mask=${cNeg._meshEdgeMask}`);
  cNeg.dirty = false;
  w.chunks.delete('0,0');              // 把邻居移回"未就绪"，再走同一条 ensureChunk 路径
  w.ensureChunk(0, 0);
  assert('CW-1 ⑥假阳性防线：掩码未命中的邻居不被无谓标脏',
    cNeg.dirty === false, `dirty=${cNeg.dirty}（true 说明反向标脏条件过宽）`);

  // ⑥ 正向对照：同一路径、同一桩断状态，把邻居再移走并重建使掩码位自然回置 → 必须标脏
  w.chunks.delete('0,0');
  buildChunk(w, b, -1, 0);
  assert('CW-1 ⑥正向对照准备：邻居移走后重建使掩码位 2 自然回置',
    cNeg._meshEdgeMask === 2, `mask=${cNeg._meshEdgeMask}`);
  cNeg.dirty = false;
  w.ensureChunk(0, 0);
  assert('CW-1 ⑥正向对照：同一路径下掩码命中即标脏（证明负向断言非恒真）',
    cNeg.dirty === true, `dirty=${cNeg.dirty}`);
}

finish('cw1-mesh-stability');
