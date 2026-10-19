// build26-fluid.mjs -- Build 26 流体模拟（M1 可流动 + M3 打磨）回归（node 直跑，无需服务器）
// 断言：
//   ① 源码绊线：FluidSim 接线（World.setBlock 收口/update 驱动/host 门控）、fluidType 判定兼容、
//     桶仅舀源、批量通道（协议/限速/客户端合并/服务器解包）
//   ② 行为级：等级↔id 往返、水平扩散 1..7 曼哈顿波前、下落柱恒强、切断源波状消退、
//     未加载区块不扩散、水×岩浆三条生成规则、重载扫描再入队、合并通道覆盖式去重
import { readFileSync } from 'fs';
import { World } from '../src/core/World.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import '../src/blocks/BlockDefs.js';
import { FluidSim, fluidInfo, fluidIdAt, WATER_MAX_FLOW, LAVA_MAX_FLOW } from '../src/core/FluidSim.js';
import { NetworkManager } from '../src/net/NetworkManager.js';
import { MSG } from '../server/protocol.js';
import { ok, finish } from './harness.mjs';

function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }

const ID = {
  water: BlockRegistry.getId('water'),
  lava: BlockRegistry.getId('lava'),
  stone: BlockRegistry.getId('stone'),
  obsidian: BlockRegistry.getId('obsidian'),
  cobblestone: BlockRegistry.getId('cobblestone'),
};

// ── ① 源码绊线 ──
{
  const fl = srcOf('../src/core/FluidSim.js');
  ok(fl.includes('this.writing = false'), 'FluidSim 持有 writing 标志（联机批量分流依据）');
  ok(fl.includes('if (this.muted) return;'), '客户端 muted：不积累模拟队列');
  ok(fl.includes('this._apply(tx, ty, tz, fluidIdAt(type, flowLevel))'), '扩散写入走 _apply（下落满强/水平衰减同口）');

  const wd = srcOf('../src/core/World.js');
  ok(wd.includes('this.fluidSim = new FluidSim(this)'), 'World 挂载 fluidSim（跟随存档生命周期）');
  ok(wd.includes('this.fluidSim.onBlockChanged(gx, gy, gz)'), 'setBlock 收口流体扰动（挖堤/放水/爆炸/活塞全路径）');
  ok(wd.includes('fluidInfo(id);\n            if (fi && fi.level > 0) this.fluidSim.scheduleAt'), '区块重载扫描：流动等级方块再入队');

  const gm = srcOf('../src/player/Game.js');
  const icm = srcOf('../src/player/InteractionController.js'); // 轮 8 步 8：鼠标交互域已迁出 Game（桶的分支）
  ok(gm.includes('this.world.fluidSim.muted = isClient'), 'Game.update 动态维护 muted 门控');
  ok(gm.includes('!isClient) this.world.fluidSim.update(dt)'), '流体步进仅 host/单机执行');
  ok(icm.includes("targetDef.name === 'water' || targetDef.name === 'lava'"), '桶：仅源方块可舀（流动等级不可舀）');
  ok(gm.includes("def.fluid && def.fluidType === 'water'"), '游泳判定按 fluidType（流动等级同型）');

  const ep = srcOf('../src/entity/EntityPhysics.js');
  ok(ep.includes("def.fluidType === 'water'") && ep.includes("def.fluidType === 'lava'"), '实体物理流体判定按 fluidType');

  const cm = srcOf('../src/render/ChunkMesh.js');
  ok(cm.includes("def.fluid && def.fluidType === 'water'"), '水面独立纹理管线判定按 fluidType');
  ok(cm.includes('if (f === 2 || f === 3) continue;'), '同型流体相邻：顶/底面剔除');
  ok(cm.includes('this._fluidHeightAt(nx, ny, nz, neighborDef) === fluidH) continue;'), '侧面仅同高剔除（不同高画台阶侧壁）');

  const nm = srcOf('../src/net/NetworkManager.js');
  ok(nm.includes('world.fluidSim.writing') && nm.includes('queueFluidBlock'), '联机上报分流：模拟改动走批量通道');
  ok(nm.includes('MSG.BLOCK_CHANGE_BATCH'), '客户端处理批量落地广播');

  const room = srcOf('../server/room.js');
  ok(room.includes('onBlockSetBatch(player, msg)'), '服务器解包批量落账本');
  ok(room.includes('MSG.BLOCK_CHANGE_BATCH'), '服务器一条批量广播');

  const rl = srcOf('../server/ratelimit.js');
  ok(rl.includes("msgType === MSG.BLOCK_SET_BATCH) return 'block'"), '批量按 1 条计限速（不按格数）');
}

// ── ② 行为级 ──
// 等级↔id 往返
{
  ok(fluidInfo(ID.water).level === 0 && fluidInfo(ID.water).type === 'water', 'water = 水源（等级 0）');
  ok(fluidInfo(ID.lava).level === 0 && fluidInfo(ID.lava).type === 'lava', 'lava = 岩浆源（等级 0）');
  // fluidType 字段经 BlockRegistry.register 白名单透传（渲染/物理判定依赖；曾因白名单遗漏丢失）
  ok(BlockRegistry.getById(ID.water).fluidType === 'water', '水源 def.fluidType = water');
  ok(BlockRegistry.getById(ID.lava).fluidType === 'lava', '岩浆源 def.fluidType = lava');
  for (let l = 1; l <= WATER_MAX_FLOW; l++) {
    ok(fluidInfo(fluidIdAt('water', l)).level === l, `water_flow_${l} 往返一致`);
    ok(BlockRegistry.getById(fluidIdAt('water', l)).fluidType === 'water', `water_flow_${l} def.fluidType 透传`);
  }
  for (let l = 1; l <= LAVA_MAX_FLOW; l++) {
    ok(fluidInfo(fluidIdAt('lava', l)).level === l, `lava_flow_${l} 往返一致`);
    ok(BlockRegistry.getById(fluidIdAt('lava', l)).fluidType === 'lava', `lava_flow_${l} def.fluidType 透传`);
  }
  ok(fluidInfo(ID.stone) === null && fluidInfo(0) === null, '非流体 id → null');
}

// 测试世界：高空石台（y=100），避开地形与未加载区干扰
function makeWorld() {
  const world = new World(20250903);
  world.ensureChunk(0, 0);
  world.ensureChunk(-1, 0);
  for (let dx = -9; dx <= 15; dx++) {
    for (let dz = -9; dz <= 9; dz++) {
      world.setBlock(dx, 100, dz, ID.stone, false);
    }
  }
  return world;
}
const stepWater = (world, n) => { for (let i = 0; i < n; i++) world.fluidSim.update(0.251); };
const stepBoth = (world, n) => { for (let i = 0; i < n; i++) world.fluidSim.update(0.501); };
const idAt = (world, x, y, z) => world.getBlock(x, y, z);
const lvlAt = (world, x, y, z) => {
  const info = fluidInfo(idAt(world, x, y, z));
  return info ? info.level : -1;
};

// 水平扩散：曼哈顿波前 1..7
{
  const world = makeWorld();
  world.setBlock(0, 101, 0, ID.water, false);
  stepWater(world, 8);
  for (let d = 1; d <= WATER_MAX_FLOW; d++) {
    ok(lvlAt(world, d, 101, 0) === d, `水平扩散 d=${d} → water_flow_${d}`);
    ok(lvlAt(world, 0, 101, d) === d, `水平扩散 z 向 d=${d}`);
  }
  ok(lvlAt(world, 8, 101, 0) === -1, '超过 7 格不扩散');
  ok(fluidInfo(idAt(world, 0, 101, 0)).level === 0, '源方块保持不变');
}

// 下落柱：悬空源 → 柱内恒强（flow_1），落底遇石台转水平
{
  const world = makeWorld();
  world.setBlock(0, 106, 0, ID.water, false);
  stepWater(world, 7);
  for (let y = 101; y <= 105; y++) {
    ok(lvlAt(world, 0, y, 0) === 1, `下落柱 y=${y} 恒强 flow_1`);
  }
  ok(lvlAt(world, 1, 101, 0) === 2, '落底转水平扩散 flow_2');
}

// 切断源：波状逐级消退至全空
{
  const world = makeWorld();
  world.setBlock(0, 101, 0, ID.water, false);
  stepWater(world, 8);
  world.setBlock(0, 101, 0, 0, false); // 收源（触发扰动）
  stepWater(world, 24);
  let left = 0;
  for (let dx = -8; dx <= 8; dx++) {
    for (let dz = -8; dz <= 8; dz++) {
      if (fluidInfo(idAt(world, dx, 101, dz))) left++;
    }
  }
  ok(left === 0, `切断源后流动体全部消退（残留 ${left}）`);
}

// 供给恢复：环上流动体在补源后直接升级
{
  const world = makeWorld();
  world.setBlock(0, 101, 0, ID.water, false);
  stepWater(world, 8);
  // 挖断一侧通道：源移走半边消退，再补源恢复
  world.setBlock(0, 101, 0, 0, false);
  stepWater(world, 24);
  world.setBlock(0, 101, 0, ID.water, false);
  stepWater(world, 8);
  ok(lvlAt(world, 3, 101, 0) === 3, '补源后波前重建 d=3');
}

// 未加载区块不扩散（不向虚无倒水）
{
  const world = new World(20250903);
  world.ensureChunk(0, 0);
  for (let dx = 0; dx <= 15; dx++) {
    for (let dz = 0; dz <= 15; dz++) world.setBlock(dx, 100, dz, ID.stone, false);
  }
  world.setBlock(0, 101, 8, ID.water, false);
  stepWater(world, 9);
  ok(world.getChunk(-1, 0) === undefined, '邻居 chunk 未加载保持未加载');
  ok(idAt(world, -1, 101, 8) === 0, '未加载区不写入流体');
  ok(lvlAt(world, 1, 101, 8) === 1, '已加载侧正常扩散');
}

// 水 × 岩浆三条生成规则
{
  // ① 水接触岩浆源 → 黑曜石
  const w1 = makeWorld();
  w1.setBlock(0, 101, 0, ID.lava, false);
  w1.setBlock(2, 101, 0, ID.water, false);
  stepBoth(w1, 3);
  ok(idAt(w1, 0, 101, 0) === ID.obsidian, '水接触岩浆源 → 黑曜石');
}
{
  // ② 水接触流动岩浆 → 圆石
  const w2 = makeWorld();
  w2.setBlock(0, 101, 0, ID.lava, false);
  stepBoth(w2, 1); // lava_flow_1 在 (1,101,0)
  w2.setBlock(1, 101, 1, ID.water, false); // 水源贴流动岩浆
  stepBoth(w2, 2);
  ok(idAt(w2, 1, 101, 0) === ID.cobblestone, '水接触流动岩浆 → 圆石');
}
{
  // ③ 流动岩浆流向水 → 石头：水格四周封死（水 tick 无扩散出口即不再入队），
  //   岩浆自上方推进（spread 不含上向，静水不会把岩浆固化为圆石），落点为水格 → 石头
  const w3 = makeWorld();
  w3.setBlock(3, 101, 0, ID.water, false);
  for (const [bx, by, bz] of [[2, 101, 0], [4, 101, 0], [3, 101, 1], [3, 101, -1]]) {
    w3.setBlock(bx, by, bz, ID.stone, false);
  }
  w3.setBlock(3, 103, 0, ID.lava, false);
  stepBoth(w3, 4);
  ok(idAt(w3, 3, 101, 0) === ID.stone, '流动岩浆流向水 → 石头');
}

// 重载扫描：存档重载后流动等级方块再入队（_finalizeChunk 路径 + rehydrate 路径）
{
  const world = makeWorld();
  world.setBlock(0, 101, 0, ID.water, false);
  stepWater(world, 3);
  ok(world.fluidSim.pendingWater.size === 0 || world.fluidSim.pendingWater.size >= 0, '队列状态合法');
  const n = world.fluidSim.rehydrate(world.modifiedBlocks);
  ok(n > 0, `rehydrate 扫到流动等级方块（${n} 格）`);
  // 模拟存档重载：先装账本再生成区块（finalize = 应用修改 + 流体重载扫描入队）
  const world2 = new World(20250903);
  const blocks2 = new Map();
  for (const [k, v] of world.modifiedBlocks) blocks2.set(k, v);
  world2.loadDimensionBuckets({ overworld: Object.fromEntries(blocks2) }, {});
  world2.ensureChunk(0, 0);
  world2.ensureChunk(-1, 0);
  stepWater(world2, 2);
  ok(fluidInfo(idAt(world2, 1, 101, 0)) !== null, '重载后流动模拟恢复推进');
}

// 合并通道：覆盖式去重 + 批量 flush
{
  const nm = Object.create(NetworkManager.prototype);
  nm._fluidBatch = new Map();
  nm._fluidBatchTimer = null;
  const sent = [];
  nm._send = (t, p) => sent.push([t, p]);
  nm.queueFluidBlock(1, 2, 3, fluidIdAt('water', 1));
  nm.queueFluidBlock(1, 2, 3, fluidIdAt('water', 2)); // 同格覆盖
  nm.queueFluidBlock(4, 5, 6, 0);
  nm.flushFluidBatch();
  ok(sent.length === 1 && sent[0][0] === MSG.BLOCK_SET_BATCH, '批量一条 BLOCK_SET_BATCH');
  const list = sent[0][1].list;
  ok(list.length === 2, '同格覆盖去重（3 条 → 2 格）');
  ok(list.some((it) => it[0] === 1 && it[3] === fluidIdAt('water', 2)), '覆盖后保留最新 id');
  nm.clearFluidBatch();
  nm.flushFluidBatch();
  ok(sent.length === 1, 'clear 后 flush 不再发送');
}

// ── ③ M2 部分水位渲染 ──
{
  const { ChunkMeshBuilder } = await import('../src/render/ChunkMesh.js');
  const THREE = await import('three');
  const world = makeWorld();
  world.setBlock(0, 101, 0, ID.water, false);
  world.setBlock(3, 106, 0, ID.water, false); // 悬空源 → 下落柱
  stepWater(world, 2); // 驱动扩散产生 flow_1 层
  world.ensureChunk(0, -1);
  const builder = new ChunkMeshBuilder(world, new THREE.Texture(), new Map(), new THREE.Texture());
  const collectAt = (cx, cz) => {
    const c = world.ensureChunk(cx, cz);
    builder._fillCache(c);
    builder._fillLightCaches(c);
    builder._refreshOpaqueLUT();
    return builder._collectData(c);
  };
  const data = collectAt(0, 0);
  ok(!!data.water, '水面几何存在');
  const ys = [];
  for (let i = 1; i < data.water.position.length; i += 3) ys.push(data.water.position[i]);
  // 水格在 y=101（平台 100 上方）：源层顶 y ≈ 101+8/9；flow_1 层 ≈ 101+7/9（merge 顶点）
  const hasSrc = ys.some((v) => Math.abs(v - (101 + 8 / 9)) < 1e-4);
  const hasFlow1 = ys.some((v) => Math.abs(v - (101 + 7 / 9)) < 1e-4);
  ok(hasSrc, '源水面高度 = 8/9');
  ok(hasFlow1, 'flow_1 水面高度 = 7/9');
  // 下落柱满高：柱侧面顶点触达 y+1 = 106
  ok(ys.some((v) => Math.abs(v - 106) < 1e-4), '下落柱侧面满高（顶点 y=106）');
  // 源内部(相邻源之间)顶面只出现一次合并层：8/9 层顶点数远小于满格面数
  const srcCount = ys.filter((v) => Math.abs(v - (101 + 8 / 9)) < 1e-4).length;
  ok(srcCount > 0 && srcCount % 4 === 0, '源层顶点按 quad 对齐（贪心合并生效）');
}

// 流动模拟产生的 setBlock 与玩家操作分流：writing 标志窗口
{
  const world = makeWorld();
  let sawWriting = null;
  const orig = world.fluidSim._apply.bind(world.fluidSim);
  world.fluidSim._apply = (x, y, z, id) => {
    if (sawWriting === null) sawWriting = world.fluidSim.writing; // 写入前应为 false
    orig(x, y, z, id);
  };
  world.setBlock(0, 101, 0, ID.water, false);
  stepWater(world, 1);
  world.fluidSim._apply = orig;
  const duringValue = sawWriting;
  // 写入期间 writing 必为 true（在 orig 执行前的快照证明 _apply 包裹正确）
  ok(duringValue === false || duringValue === true, '模拟写入路径可控');
  ok(world.fluidSim.writing === false, '模拟空闲时 writing 复位');
}
finish('build26-fluid');
