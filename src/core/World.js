// World.js -- 世界管理：区块加载/卸载、方块访问、体素光照、容器（箱子）数据
// 维度化：构造时带 dimension，方块/容器账本按维度分桶（同坐标跨维度互不干扰）
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from './Chunk.js';
import { TerrainGenerator } from '../world/terrain.js';
import { BlockRegistry } from './BlockRegistry.js';
import { LightEngine } from './LightEngine.js';
import { chestLoot } from '../world/loot.js';
import { isCropId } from './crops.js';
import { FluidSim, fluidInfo } from './FluidSim.js';
import { doorId } from './blockShape.js';
import { getDimension, DEFAULT_DIMENSION } from './dimensions.js';
import { ModifiedBlocks } from './ModifiedBlocks.js';
import { parsePosKey } from './posKey.js';

export class World {
  constructor(seed = 0, dimension = DEFAULT_DIMENSION, worldOpts = null) {
    this.seed = seed;
    this.dimension = dimension;
    this.dimDef = getDimension(dimension) || getDimension(DEFAULT_DIMENSION);
    this.chunks = new Map();
    this.generator = this.dimDef.createGenerator(seed, worldOpts || {});
    // 维度分桶账本：modifiedBlocks/containers 是"当前维度"桶的指针
    //（切换维度 = 整体重建 World，指针永不跨维度换绑）
    this.dimensionBlocks = new Map();     // dimId -> ModifiedBlocks("x,y,z" -> 方块 id，带区块索引)
    this.dimensionContainers = new Map(); // dimId -> Map("x,y,z" -> 27 槽数组)
    this.dimensionFurnaces = new Map();   // dimId -> Map("x,y,z" -> 熔炉状态 {input,fuel,output,burnTime,burnMax,cookTime})
    this.modifiedBlocks = this.dimBucket(this.dimensionBlocks, true);
    this.containers = this.dimBucket(this.dimensionContainers);
    this.furnaces = this.dimBucket(this.dimensionFurnaces);
    // T5 容器：打开时惰性生成（结构箱子按 (seed,表名,坐标) 确定性 loot），
    // 玩家改动即落 Map（存档持久化；联机经 container_set 广播收敛）
    this.onLocalBlockChange = null;  // 本地发起方块修改回调 (x,y,z,id)，由 NetworkManager 注册（联机上报）
    this.onCropBlockChange = null;   // 作物方块增删回调 (x,y,z,oldId,newId)，由 Game 注册（生长登记表维护）
    this.cropMap = new Map();        // 作物生长登记表 key "x,y,z" -> {x,y,z}（setBlock 钩子 + 区块重载扫描维护）
    // B26 流体模拟：计划更新队列（扰动触发，静态海洋永不自发流动）；
    // World 每次 start 重建 → fluidSim 跟随存档生命周期，无需跨存档重置
    this.fluidSim = new FluidSim(this);
    this.lightEngine = new LightEngine(this); // 体素光照（纯客户端视觉，不进存档/协议）
    // B-①：地形 Worker 客户端（由 Game.start 注入，仅主世界；null = 全部走同步路径）
    this.terrainWorker = null;
    this._pendingChunks = new Map(); // "cx,cz" -> 在途 Promise
  }

  // 取（或建）当前维度的账本桶；indexed=true 建带区块索引的方块账本（容器/熔炉仍用原生 Map）
  dimBucket(store, indexed = false) {
    let m = store.get(this.dimension);
    if (!m) { m = indexed ? new ModifiedBlocks() : new Map(); store.set(this.dimension, m); }
    return m;
  }

  // 从存档/换维数据装入全部维度桶，并把当前维度指针指向对应桶
  loadDimensionBuckets(blocksObj, containersObj, furnacesObj = null) {
    for (const [dim, entries] of Object.entries(blocksObj || {})) {
      const m = new ModifiedBlocks();
      for (const [k, v] of Object.entries(entries || {})) m.set(k, v | 0);
      this.dimensionBlocks.set(dim, m);
    }
    for (const [dim, entries] of Object.entries(containersObj || {})) {
      const m = new Map();
      for (const [k, v] of Object.entries(entries || {})) {
        if (Array.isArray(v) && v.length === 27) m.set(k, v);
      }
      this.dimensionContainers.set(dim, m);
    }
    if (furnacesObj) {
      for (const [dim, entries] of Object.entries(furnacesObj)) {
        const m = new Map();
        for (const [k, v] of Object.entries(entries || {})) {
          if (v && typeof v === 'object') m.set(k, v);
        }
        this.dimensionFurnaces.set(dim, m);
      }
    }
    this.modifiedBlocks = this.dimBucket(this.dimensionBlocks, true);
    this.containers = this.dimBucket(this.dimensionContainers);
    this.furnaces = this.dimBucket(this.dimensionFurnaces);
  }

  key(cx, cz) { return `${cx},${cz}`; }

  getChunk(cx, cz) {
    return this.chunks.get(this.key(cx, cz));
  }

  ensureChunk(cx, cz) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk(cx, cz);
      this.generator.generateChunk(c);
      this.chunks.set(k, c);
      this._finalizeChunk(c);
    }
    return c;
  }

  // 区块就绪后的公共收尾（同步 ensureChunk 与 worker 回执两路共用，顺序勿变：
  // 先应用修改再初始化光照，最后作物重载扫描——与 LightEngine 邻居导入语义耦合）
  _finalizeChunk(c) {
    // 应用修改
    this.applyModifications(c);
    // 光照初始化（含从已加载邻居导入边界光，改动的邻居会被标 dirty）
    this.lightEngine.initChunkLight(c);
    // 重载扫描：存档载入/区块重载后恢复易失运行期结构——
    // ① 作物登记回生长表（作物阶段随方块 id 持久化，登记表只是加速结构）
    // ② 流动等级流体重新入队（源静态不调度；防存档重载后瀑布断流）
    {
      const { cx, cz } = c;
      const baseX = cx * CHUNK_SIZE, baseZ = cz * CHUNK_SIZE;
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const id = c.blocks[Chunk.index(x, y, z)];
            if (id === 0) continue;
            // ③ B27 旧存档迁移：旧版单格门（下半态 + 上方空气）补齐上半格（幂等，直写不进账本）
            const sDef = BlockRegistry.getById(id);
            if (sDef && sDef.part === 'door_lower' && y + 1 < CHUNK_HEIGHT && c.get(x, y + 1, z) === 0) {
              const uid = doorId(sDef.baseBlock, 'upper', sDef.facing, false);
              if (uid) {
                c.set(x, y + 1, z, uid);
                c.dirty = true;
              }
            }
            if (this.onCropBlockChange && isCropId(id)) {
              this.onCropBlockChange(baseX + x, y, baseZ + z, 0, id);
              continue;
            }
            const fi = fluidInfo(id);
            if (fi && fi.level > 0) this.fluidSim.scheduleAt(baseX + x, y, baseZ + z);
          }
        }
      }
    }
    // CW-1 修补：新区块就绪后，反向重建曾把本区块当空气构建过网格的邻居。
    // 旧网格在缺失方向多画了边界面（水柱整列侧面远看呈区块对齐的直线分界）；
    // 仅靠 initChunkLight 光照泛洪标脏不够——露天海面等无价差边界不触发泛洪，
    // 多余面会永久残留（放置方块重建后消失的正是这些面）
    const edgeFix = [[-1, 0, 2], [1, 0, 1], [0, -1, 8], [0, 1, 4]]; // [dx, dz, 邻居缺失位]
    for (const [dx, dz, bit] of edgeFix) {
      const n = this.getChunk(c.cx + dx, c.cz + dz);
      if (n && (n._meshEdgeMask & bit)) n.dirty = true;
    }
  }

  // B-①：异步预取区块（worker 生成，Transferable 回传）。
  // 返回 true = 已有/已在途；false = 当前不可用（非主世界/worker 失败）→ 调用方回退 ensureChunk 同步路径。
  requestChunk(cx, cz) {
    const k = this.key(cx, cz);
    if (this.chunks.has(k)) return true;
    if (!this.terrainWorker || this.terrainWorker.broken) return false;
    if (this._pendingChunks.has(k)) return true;
    const p = this.terrainWorker.generate(cx, cz, this.generator.seed, this.generator.biomeScale || null)
      .then(({ blocks }) => {
        this._pendingChunks.delete(k);
        if (this.chunks.has(k)) return; // 同步路径抢先建好：丢弃 worker 结果
        const c = new Chunk(cx, cz);
        c.blocks.set(blocks);
        this.chunks.set(k, c);
        this._finalizeChunk(c);
      })
      .catch(() => {
        this._pendingChunks.delete(k);
        if (this.terrainWorker) this.terrainWorker.broken = true; // 失败即回退同步生成
      });
    this._pendingChunks.set(k, p);
    return true;
  }

  // 应用账本里属于本区块的修改：索引账本只遍历本区块桶（旧实现每次全账本扫描 + 逐键 split）
  applyModifications(chunk) {
    const ledger = this.modifiedBlocks;
    if (typeof ledger.keysInChunk === 'function') {
      const keys = ledger.keysInChunk(chunk.cx, chunk.cz);
      if (!keys) return;
      for (const key of keys) this._applyLedgerEntry(chunk, key, ledger.get(key));
      return;
    }
    // 兜底：账本被外部整体换成普通 Map 时全量遍历（越界坐标由 Chunk.set 守卫丢弃，与旧实现等价）
    for (const [key, id] of ledger) this._applyLedgerEntry(chunk, key, id);
  }

  _applyLedgerEntry(chunk, key, id) {
    const p = parsePosKey(key);
    chunk.set(p.x - chunk.cx * CHUNK_SIZE, p.y, p.z - chunk.cz * CHUNK_SIZE, id);
  }

  unloadChunk(cx, cz) {
    const k = this.key(cx, cz);
    const c = this.chunks.get(k);
    if (c) {
      if (c.mesh) c.mesh.geometry.dispose();
      if (c.waterMesh) c.waterMesh.geometry.dispose();
      if (c.lightMesh) c.lightMesh.geometry.dispose();
      this.chunks.delete(k);
    }
  }

  getBlock(gx, gy, gz) {
    if (gy < 0 || gy >= CHUNK_HEIGHT) return 0;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c) return 0;
    return c.get(gx - cx * CHUNK_SIZE, gy, gz - cz * CHUNK_SIZE);
  }

  setBlock(gx, gy, gz, id, recordMod = true) {
    if (gy < 0 || gy >= CHUNK_HEIGHT) return;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const c = this.ensureChunk(cx, cz);
    const lx = gx - cx * CHUNK_SIZE;
    const lz = gz - cz * CHUNK_SIZE;
    const oldId = c.get(lx, gy, lz);
    c.set(lx, gy, lz, id);
    c.dirty = true;
    if (recordMod) this.modifiedBlocks.set(`${gx},${gy},${gz}`, id);
    if (this.onLocalBlockChange) this.onLocalBlockChange(gx, gy, gz, id);
    // 作物登记表维护（种/长/收/破坏/远端同步全路径收口于此）
    if (this.onCropBlockChange) this.onCropBlockChange(gx, gy, gz, oldId, id);
    // B26 流体扰动：改动格与 6 邻中的流体进入模拟队列（挖堤/放水/爆炸/活塞全路径收口）
    this.fluidSim.onBlockChanged(gx, gy, gz);
    // 标记邻居区块 dirty（边界方块）
    if (lx === 0) { const n = this.getChunk(cx - 1, cz); if (n) n.dirty = true; }
    if (lx === CHUNK_SIZE - 1) { const n = this.getChunk(cx + 1, cz); if (n) n.dirty = true; }
    if (lz === 0) { const n = this.getChunk(cx, cz - 1); if (n) n.dirty = true; }
    if (lz === CHUNK_SIZE - 1) { const n = this.getChunk(cx, cz + 1); if (n) n.dirty = true; }
    // 增量光照更新（天光 + 方块光），受影响区块同样被标 dirty
    this.lightEngine.onBlockChanged(gx, gy, gz, oldId, id);
  }

  // 体素光查询（网格构建采样用；未加载区块按维度兜底：主世界露天 15，无天光维度恒定环境光）
  getSkyLight(gx, gy, gz) {
    const amb = this.dimDef.light.hasSkylight ? 15 : (this.dimDef.light.ambientSky || 0);
    if (gy >= CHUNK_HEIGHT) return amb;
    if (gy < 0) return 0;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c || !c.hasLight) return amb;
    return c.getSky(gx - cx * CHUNK_SIZE, gy, gz - cz * CHUNK_SIZE);
  }

  getBlockLightAt(gx, gy, gz) {
    if (gy < 0 || gy >= CHUNK_HEIGHT) return 0;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c || !c.hasLight) return 0;
    return c.getBlockLight(gx - cx * CHUNK_SIZE, gy, gz - cz * CHUNK_SIZE);
  }

  // 全部区块标记脏（视频设置改平滑光照/AO 后重建网格用）
  markAllDirty() {
    for (const [, c] of this.chunks) c.dirty = true;
  }

  // ── 容器（箱子）──
  static containerKey(x, y, z) { return `${x},${y},${z}`; }

  // 打开箱子：优先取已实例化内容；否则确定性生成（结构箱子查 StructureManager 的 chests
  // 注册表拿表名，玩家自放箱子无记录 = 空容器）。生成即写入（打开过的箱子进存档）。
  getOrOpenContainer(x, y, z) {
    const k = World.containerKey(x, y, z);
    if (this.containers.has(k)) return this.containers.get(k);
    const sm = this.generator && this.generator.structureManager;
    const table = (sm && sm.chestTableAt) ? sm.chestTableAt(x, y, z) : null;
    const items = table ? chestLoot(this.seed, table, x, y, z) : new Array(27).fill(null);
    this.containers.set(k, items);
    return items;
  }

  // 远端/账本收敛：直接覆盖容器内容（不触发生成）
  setContainer(x, y, z, items) {
    this.containers.set(World.containerKey(x, y, z), items);
  }

  getContainer(x, y, z) {
    return this.containers.get(World.containerKey(x, y, z)) || null;
  }

  removeContainer(x, y, z) {
    this.containers.delete(World.containerKey(x, y, z));
  }

  // ── 熔炉状态（单机持久化；打开时惰性创建，进度随 Game.update 推进）──
  static furnaceKey(x, y, z) { return `${x},${y},${z}`; }

  getFurnace(x, y, z) {
    return this.furnaces.get(World.furnaceKey(x, y, z)) || null;
  }

  // 取（或建）熔炉状态：新建返回默认空状态并落账本（打开过的熔炉进存档）
  getOrOpenFurnace(x, y, z) {
    const k = World.furnaceKey(x, y, z);
    let st = this.furnaces.get(k);
    if (!st) {
      st = { input: null, fuel: null, output: null, burnTime: 0, burnMax: 0, cookTime: 0 };
      this.furnaces.set(k, st);
    }
    return st;
  }

  removeFurnace(x, y, z) {
    this.furnaces.delete(World.furnaceKey(x, y, z));
  }

  // 获取高度图（用于玩家生成位置；仅主世界生成器有此语义）
  getHeightAt(wx, wz) {
    return this.generator.getBaseHeight(wx, wz);
  }

  getBiomeAt(wx, wz) {
    return this.generator.getBiome(wx, wz);
  }

  // 维度出生点：主世界 (0.5, 地表+2, 0.5)；其他维度由生成器 findSpawn 纯函数求解
  getSpawnPoint() {
    const g = this.generator;
    if (g && typeof g.findSpawn === 'function') return g.findSpawn();
    return { x: 0.5, y: this.getHeightAt(0, 0) + 2, z: 0.5 };
  }

  // 从 top 向下扫描第一个可站立面（实心方块上方的空气格 y；无则 -1）。
  // 维度无关——下界等有天花维度请传 top 限制扫描起点（如 dimDef.spawnScanTop）。
  findGroundY(x, z, top = CHUNK_HEIGHT - 2) {
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let y = Math.min(top, CHUNK_HEIGHT - 2); y >= 1; y--) {
      const def = BlockRegistry.getById(this.getBlock(bx, y, bz));
      if (def && def.solid) return y + 1;
    }
    return -1;
  }
}
