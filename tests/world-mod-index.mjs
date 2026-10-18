// world-mod-index.mjs -- F7 修改方块账本分桶索引 + F12 坐标键热路径回归（node 直跑，无需服务器）
// 断言：
//   ① ModifiedBlocks 对外语义与原生 Map 逐操作等价（size/get/has/迭代顺序/覆盖写/删除/clear/序列化形状）
//   ② applyModifications 只应用本区块格子：与迁移前全量扫描实现对同一账本逐字节等价（含负坐标/跨区块/空区块）
//   ③ 索引五条路径一致：setBlock 写入 / 覆盖写 / 删除 / 存档载入批量 set / 维度换桶 + loadDimensionBuckets
//   ④ 键格式不变：posKey↔parsePosKey 往返、账本键、FluidSim 静态 API、RedstoneSystem.key 全同格式
//   ⑤ 热路径去 split+Number：源码绊线（三文件 0 处）+ String.prototype.split 计数钩子（迁移前 N 次 → 迁移后 0 次）
import { readFileSync } from 'fs';
import { World } from '../src/core/World.js';
import { Chunk, CHUNK_SIZE } from '../src/core/Chunk.js';
import { ModifiedBlocks } from '../src/core/ModifiedBlocks.js';
import { posKey, parsePosKey } from '../src/core/posKey.js';
import { FluidSim, fluidIdAt } from '../src/core/FluidSim.js';
import { RedstoneSystem } from '../src/core/RedstoneSystem.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import '../src/blocks/BlockDefs.js'; // 副作用导入：方块注册表填充

function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
import { ok, finish } from './harness.mjs';

// 空地形 World（node 直跑）：生成器换全空气，区块内容只来自账本与 setBlock
function makeWorld(seed = 20261017, dimension = 'overworld') {
  const w = new World(seed, dimension);
  w.generator = { generateChunk(c) { c.generated = true; } };
  return w;
}

// 迁移前实现（对照）：全账本扫描 + 逐键 split
function legacyApplyModifications(ledger, chunk) {
  const { cx, cz } = chunk;
  for (const [key, id] of ledger) {
    const [gx, gy, gz] = key.split(',').map(Number);
    if (Math.floor(gx / CHUNK_SIZE) === cx && Math.floor(gz / CHUNK_SIZE) === cz) {
      chunk.set(gx - cx * CHUNK_SIZE, gy, gz - cz * CHUNK_SIZE, id);
    }
  }
}

// String.prototype.split 计数钩子：测量一段同步代码内的 split 调用次数
function splitsDuring(fn) {
  const orig = String.prototype.split;
  let n = 0;
  String.prototype.split = function (...args) { n++; return orig.apply(this, args); };
  try { fn(); } finally { String.prototype.split = orig; }
  return n;
}

let lcg = 987654321;
const rnd = () => ((lcg = (lcg * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// ── ① 账本对外语义（与原生 Map 逐操作对照） ──
{
  const ref = new Map();
  const led = new ModifiedBlocks();
  const step = (fn, name) => {
    fn(ref); fn(led);
    ok(led.size === ref.size, name + '：size 一致');
    ok(JSON.stringify([...led]) === JSON.stringify([...ref]), name + '：迭代内容与顺序一致');
    ok(JSON.stringify(Object.fromEntries(led)) === JSON.stringify(Object.fromEntries(ref)), name + '：序列化形状一致');
  };
  step(m => m.set('1,64,2', 5), '新增写入');
  step(m => m.set('33,64,1', 9), '第二区块写入');
  step(m => m.set('1,64,2', 7), '覆盖写');
  step(m => m.set('1,64,2', 0), '覆盖写为空气 0');
  step(m => m.delete('33,64,1'), '删除');
  step(m => m.delete('99,99,99'), '删除不存在的键');
  step(m => m.set('33,64,1', 4), '删除后重写');
  ok(led.get('33,64,1') === 4 && led.has('1,64,2') && !led.has('33,64,0'), 'get/has 语义未变');
  ok(led.keysInChunk(0, 0).has('1,64,2') && !led.keysInChunk(0, 0).has('33,64,1'), '区块 (0,0) 索引只含本区块键');
  ok(led.keysInChunk(2, 0).has('33,64,1'), '区块 (2,0) 索引含 33,64,1');
  ok(led.keysInChunk(5, 5) === null, '无修改区块索引为 null');
  led.clear();
  ok(led.size === 0 && [...led].length === 0 && led.keysInChunk(0, 0) === null, 'clear 同时清空账本与索引');
  const led2 = new ModifiedBlocks([['5,64,5', 1]]);
  led2.delete('5,64,5');
  ok(led2.size === 0 && led2.keysInChunk(0, 0) === null, '删除后空桶被回收（索引不残留）');
}

// ── ② 与迁移前实现逐字节等价（随机账本 + 负坐标 + 跨区块） ──
{
  const led = new ModifiedBlocks();
  const ids = [0, 1, 4, 9, 33, 255];
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(rnd() * 160) - 80;
    const y = Math.floor(rnd() * 250) + 1;
    const z = Math.floor(rnd() * 160) - 80;
    led.set(posKey(x, y, z), ids[Math.floor(rnd() * ids.length)]);
  }
  for (let i = 0; i < 400; i++) {
    led.delete(posKey(Math.floor(rnd() * 160) - 80, Math.floor(rnd() * 250) + 1, Math.floor(rnd() * 160) - 80));
  }
  const w = makeWorld();
  const plain = new Map(led); // 兜底分支：账本被外部整体换成普通 Map
  let cells = 0;
  for (let cx = -6; cx <= 5; cx++) {
    for (let cz = -6; cz <= 5; cz++) {
      const a = new Chunk(cx, cz);
      legacyApplyModifications(led, a);
      const b = new Chunk(cx, cz);
      w.modifiedBlocks = led;
      w.applyModifications(b);
      const c = new Chunk(cx, cz);
      w.modifiedBlocks = plain;
      w.applyModifications(c);
      ok(same(a.blocks, b.blocks), `区块 (${cx},${cz}) 索引路径与迁移前逐字节一致`);
      ok(same(a.blocks, c.blocks), `区块 (${cx},${cz}) 兜底路径与迁移前逐字节一致`);
      for (let i = 0; i < a.blocks.length; i++) if (a.blocks[i]) cells++;
    }
  }
  ok(cells > 500, `对照样本非空（共应用 ${cells} 格）`);
  const empty = new Chunk(30, 30);
  w.modifiedBlocks = led;
  w.applyModifications(empty);
  ok([...empty.blocks].every(v => v === 0), '无修改区块不被写入');
}

// ── ②b 区块边界与负坐标局部换算 ──
{
  const led = new ModifiedBlocks();
  led.set('-1,70,-1', 3); // 区块 (-1,-1) 局部 (15,70,15)
  led.set('16,70,16', 4); // 区块 (1,1) 局部 (0,70,0)
  led.set('0,70,0', 5);   // 区块 (0,0) 局部 (0,70,0)
  const w = makeWorld();
  w.modifiedBlocks = led;
  const c00 = new Chunk(0, 0);
  w.applyModifications(c00);
  ok(c00.get(0, 70, 0) === 5 && c00.get(15, 70, 15) === 0, '区块 (0,0) 只应用本区块格子');
  const cm1 = new Chunk(-1, -1);
  w.applyModifications(cm1);
  ok(cm1.get(15, 70, 15) === 3 && cm1.get(0, 70, 0) === 0, '负坐标区块局部换算正确且不串扰');
  const c11 = new Chunk(1, 1);
  w.applyModifications(c11);
  ok(c11.get(0, 70, 0) === 4 && c11.get(15, 70, 15) === 0, '正边界区块局部换算正确');
}

// ── ③ 五条路径索引一致 ──
{
  const STONE = BlockRegistry.getId('stone');
  const DIRT = BlockRegistry.getId('dirt');
  const w = makeWorld();
  ok(w.modifiedBlocks instanceof ModifiedBlocks && w.dimensionBlocks.get('overworld') === w.modifiedBlocks,
    '当前维度桶即索引账本（modifiedBlocks 指针不变）');

  w.setBlock(1, 70, 2, STONE);
  ok(w.modifiedBlocks.get(posKey(1, 70, 2)) === STONE, '写入：setBlock 落账本且键格式不变');
  w.setBlock(18, 70, 2, DIRT);
  w.unloadChunk(0, 0);
  w.unloadChunk(1, 0);
  const c0 = w.ensureChunk(0, 0);
  const c1 = w.ensureChunk(1, 0);
  ok(c0.get(1, 70, 2) === STONE && c0.get(2, 70, 2) === 0, '区块 (0,0) 只应用本区块账本');
  ok(c1.get(2, 70, 2) === DIRT && c1.get(1, 70, 2) === 0, '区块 (1,0) 只应用本区块账本');

  w.setBlock(1, 70, 2, DIRT);
  w.unloadChunk(0, 0);
  ok(w.ensureChunk(0, 0).get(1, 70, 2) === DIRT, '覆盖写：重载后取最新值');

  w.modifiedBlocks.delete(posKey(1, 70, 2));
  ok(w.modifiedBlocks.keysInChunk(0, 0) === null, '删除：索引同步移除（空桶回收，不再命中该键）');
  w.unloadChunk(0, 0);
  ok(w.ensureChunk(0, 0).get(1, 70, 2) === 0, '删除：重载后不再应用该格');

  // 存档载入（Game.js 约 369-372 的 V1 迁移写法：外部直接调原生 set 批量灌入）
  const w2 = makeWorld();
  const loadData = { modifiedBlocks: { '3,64,3': STONE, '20,64,3': DIRT, '-1,64,-1': STONE } };
  for (const [key, id] of Object.entries(loadData.modifiedBlocks)) w2.modifiedBlocks.set(key, id);
  ok(w2.modifiedBlocks.keysInChunk(0, 0).size === 1 && w2.modifiedBlocks.keysInChunk(1, 0).size === 1,
    '批量灌入：外部原生 set 也进索引');
  ok(w2.ensureChunk(0, 0).get(3, 64, 3) === STONE, '批量灌入：区块 (0,0) 应用');
  ok(w2.ensureChunk(1, 0).get(4, 64, 3) === DIRT, '批量灌入：跨区块 (1,0) 应用');
  ok(w2.ensureChunk(-1, -1).get(15, 64, 15) === STONE, '批量灌入：负坐标区块应用');

  // 维度换桶（Game.js 约 366-367 的 loadDimensionBuckets）
  const w3 = makeWorld(7, 'overworld');
  w3.loadDimensionBuckets({ overworld: { '1,70,2': STONE }, nether: { '3,70,4': DIRT } }, {}, null);
  ok(w3.modifiedBlocks === w3.dimensionBlocks.get('overworld') && w3.modifiedBlocks instanceof ModifiedBlocks,
    '换桶后指针指向当前维度索引账本');
  ok(w3.dimensionBlocks.get('nether') instanceof ModifiedBlocks, '其他维度桶同为索引账本');
  ok(w3.modifiedBlocks.keysInChunk(0, 0).has('1,70,2') && !w3.modifiedBlocks.keysInChunk(0, 0).has('3,70,4'),
    '索引不跨维度共享');
  ok(w3.dimensionBlocks.get('nether').keysInChunk(0, 0).has('3,70,4'), '下界桶自持索引');
  w3.unloadChunk(0, 0);
  ok(w3.ensureChunk(0, 0).get(1, 70, 2) === STONE, '换桶后 applyModifications 用当前维度桶');

  const w4 = makeWorld(7, 'end');
  w4.loadDimensionBuckets({ overworld: { '1,70,2': STONE } }, {}, null);
  ok(w4.modifiedBlocks instanceof ModifiedBlocks && w4.modifiedBlocks.size === 0,
    '存档缺当前维度桶时新建空索引账本');
}

// ── ④ 键格式不变 ──
{
  ok(posKey(1, 64, -3) === '1,64,-3', 'posKey 输出格式不变');
  let round = 0;
  for (let i = 0; i < 500; i++) {
    const x = Math.floor(rnd() * 4000) - 2000;
    const y = Math.floor(rnd() * 256);
    const z = Math.floor(rnd() * 4000) - 2000;
    const p = parsePosKey(posKey(x, y, z));
    if (p.x === x && p.y === y && p.z === z) round++;
  }
  ok(round === 500, `posKey↔parsePosKey 往返 500/500（实测 ${round}）`);
  ok(FluidSim.posKey(1, 64, -3) === posKey(1, 64, -3), 'FluidSim.posKey 与共享编码器同格式');
  const fp = FluidSim.parseKey('1,64,-3');
  ok(fp.x === 1 && fp.y === 64 && fp.z === -3, 'FluidSim.parseKey 语义不变（返回 {x,y,z}）');
  const rs = new RedstoneSystem({ getBlock: () => 0, setBlock: () => {} });
  ok(rs.key(1, 64, -3) === posKey(1, 64, -3) && rs.key(-7, 0, 12) === posKey(-7, 0, 12),
    'RedstoneSystem.key 与共享编码器同格式');
  const w = makeWorld();
  w.setBlock(-3, 71, 21, BlockRegistry.getId('stone'));
  ok(w.modifiedBlocks.has(posKey(-3, 71, 21)), '账本键 = posKey(坐标)');
}

// ── ⑤ 热路径 split+Number 计数（迁移前后对照） ──
{
  const rs = new RedstoneSystem({ getBlock: () => 0, setBlock: () => {} });
  const anchors = [];
  for (let i = 0; i < 40; i++) anchors.push([i, 64, i % 7]);
  const legacyKeys = [];
  for (const [x, y, z] of anchors)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      legacyKeys.push(posKey(x + dx, y + dy, z + dz));
  const newSplits = splitsDuring(() => { for (const [x, y, z] of anchors) rs.scheduleUpdate(x, y, z); rs.update(0.016); });
  ok(rs.pendingUpdates.size === 0 && newSplits === 0,
    `红石 BFS 热路径 0 次 split（实测 ${newSplits}；迁移前同一波 ${legacyKeys.length} 键 = ${legacyKeys.length} 次）`);
  let sink = 0;
  const legacySplits = splitsDuring(() => {
    for (const k of legacyKeys) { const [x, y, z] = k.split(',').map(Number); sink += x + y + z; }
  });
  ok(legacySplits === legacyKeys.length && Number.isFinite(sink), `迁移前对照：${legacySplits} 次 split+Number`);
  // 联机远端状态落地仍走同一键路径
  rs.applyRemoteState(2, 65, 3, true);
  ok(rs.pendingUpdates.size === 27 && rs.poweredBlocks.get(posKey(2, 65, 3)) === true,
    'applyRemoteState 键与队列语义不变');
}
{
  const sim = new FluidSim({ getBlock: () => 0, getChunk: () => null });
  const keys = [];
  for (let i = 0; i < 50; i++) {
    const k = posKey(10, 64, i);
    keys.push(k);
    sim.pendingWater.set(k, [10, 64, i]);
  }
  const newSplits = splitsDuring(() => sim._step('water'));
  ok(sim.pendingWater.size === 0 && newSplits === 0,
    `流体步进热路径 0 次 split（${keys.length} 键，实测 ${newSplits}）`);
  let sink = 0;
  const legacySplits = splitsDuring(() => { for (const k of keys) { const c = k.split(','); sink += +c[0] + +c[1] + +c[2]; } });
  ok(legacySplits === keys.length && Number.isFinite(sink), `迁移前对照：步进 ${legacySplits} 次 split`);

  // rehydrate：消费账本键（一次性解析，非每步）
  const sim2 = new FluidSim({ getBlock: () => 0, getChunk: () => null });
  const led = new ModifiedBlocks();
  led.set('4,64,4', fluidIdAt('water', 1));
  led.set('5,64,4', fluidIdAt('water', 0)); // 源：不调度
  led.set('6,64,4', BlockRegistry.getId('lava')); // 岩浆源：不调度
  let n = 0;
  const reSplits = splitsDuring(() => { n = sim2.rehydrate(led); });
  ok(n === 1 && sim2.pendingWater.size === 1 && sim2.pendingWater.get('4,64,4')[0] === 4,
    'rehydrate 只登记流动等级并携带坐标（账本键格式不变）');
  ok(reSplits === 0, `rehydrate 键解析不走 split（实测 ${reSplits}）`);
  // 流动水体经 World.setBlock 扰动入队后仍能步进（队列类型由 Set 改 Map，语义不变）
  const w = makeWorld();
  const F1 = fluidIdAt('water', 1);
  w.setBlock(2, 64, 2, F1);
  ok(w.fluidSim.pendingWater.has(posKey(2, 64, 2)) && w.fluidSim.pendingWater.size === 1,
    'World.setBlock 扰动入队（队列仍以 posKey 为键）');
}
{
  const rs = new RedstoneSystem({ getBlock: () => 0, setBlock: () => {} });
  const events = [];
  const scheduled = [];
  rs.onStateChange = (x, y, z, on) => events.push([x, y, z, on]);
  rs.scheduleUpdate = (x, y, z) => scheduled.push([x, y, z]);
  rs.buttonTimers.set(posKey(7, 70, 9), 0.5);
  const splits = splitsDuring(() => rs.update(1.0));
  ok(events.length === 1 && events[0].join(',') === '7,70,9,false' && scheduled[0].join(',') === '7,70,9',
    '按钮到期回调坐标正确（键解析等价）');
  ok(splits === 0 && rs.buttonTimers.size === 0, `按钮到期路径 0 次 split（实测 ${splits}）`);
  ok(rs.isPowered(7, 70, 9) === false, '到期后状态归零');
}

// ── ⑤b 源码绊线（迁移前后 grep 对照的自动化版本） ──
{
  const rsSrc = srcOf('../src/core/RedstoneSystem.js');
  const fsSrc = srcOf('../src/core/FluidSim.js');
  const wSrc = srcOf('../src/core/World.js');
  ok(!rsSrc.includes("split(',')") && !fsSrc.includes("split(',')") && !wSrc.includes("split(',')"),
    '三个独占文件不再有逐键 split(,)（迁移前 RedstoneSystem 2 处 / FluidSim 1 处 / World 1 处）');
  ok(wSrc.includes('keysInChunk') && wSrc.includes('new ModifiedBlocks()'), 'World 建账本/应用账本均走索引');
  ok(fsSrc.includes('parsePosKey') && rsSrc.includes('parsePosKey'), '两处热路径共用 posKey.js 编解码');
  const gameSrc = srcOf('../src/player/Game.js');
  ok(gameSrc.includes('this.world.modifiedBlocks.set(key, id)'),
    '存档载入仍走原生 Map API 写入（索引由账本自身维护，Game.js 无需改动）');
  const saveSrc = srcOf('../src/core/SaveSystem.js');
  ok(saveSrc.includes('Object.fromEntries'), '存档序列化仍走 entries 迭代（账本对外形态不变）');
}
finish('world-mod-index');
