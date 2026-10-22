// StructureManager.js -- 自然建筑生成：锚点网格选址 + 确定性布局求解 + 逐区块裁剪
// 核心不变量：建筑布局只由 (seed, 结构类型, 锚点 cell) 决定——布局求解与区块裁剪严格分离，
// 任意端 / 任意区块生成顺序下，同一锚点的求解结果逐字节一致（联机"各端同世界"的根基）。
// 管线：TerrainGenerator.generateChunk -> decorateChunk(chunk)：
//   ① 扫描锚点网格 cell（哈希门控 + 抖动）→ ② 纯函数选址（群系/平坦度/海拔窗）
//   → ③ 布局求解（每锚点独立 RNG，结果按 cell 缓存 LRU）→ ④ 包围盒相交测试 + 逐块裁剪写入。
import { CHUNK_SIZE, CHUNK_HEIGHT } from '../../core/Chunk.js';
import { BlockRegistry } from '../../core/BlockRegistry.js';
import { fillBox } from './StructureKit.js';

// 32 位确定性哈希（seed/坐标/盐 → uint32），不同盐的流互不相关
function hash32(seed, a, b, salt) {
  let h = ((seed | 0) ^ Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(salt, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// LCG 随机数（与 terrain.js 树木生成同族），返回 [0,1)
function makeRng(seed) {
  let r = seed >>> 0;
  return () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
}

export { makeRng, hash32 };

// 注册结构类型。def 字段：
//   cell        网格边长（区块数），每 cell 至多一个锚点
//   attempts    每 cell 候选锚点尝试次数（MC 同款：首个通过选址者胜出，提升可放置率且不破坏间距）
//   radius      结构最大水平半径（方块），决定扫描范围与包围盒
//   chance      单次尝试通过概率（0-1，哈希门控，用 h 高 16 位与抖动位分离）
//   salt        整型盐，跨类型去相关
//   biomes      允许的群系数组（null = 不限）
//   probeR      [内环, 外环] 探针半径（默认 [16,28]；小斑块群系配小环）
//   minTop/maxTop 地表海拔窗（可选）；maxSlope 平坦度容差（默认 4）
//   solve(rng, ax, groundY, az, gen) -> { blocks: [[wx,wy,wz,id],...], meta }  纯函数布局求解
//   place(gen, ax, az) -> groundY | -1   可选选址覆盖（要塞等非地表逻辑用），默认走平坦度检查
//   anchorForCell(sm, ccx, ccz) -> {cx,cz} | null  可选锚点覆盖（环带等非网格锚点；覆盖时
//   attempts/chance 门不生效，返回 null 即该 cell 无结构）
const structureTypes = new Map();

export function registerStructureType(name, def) {
  structureTypes.set(name, def);
}

// 维度作用域：def.dims 缺省 = 任意维度；声明时仅列出的维度参与
//（生成器 dimensionId：主世界 overworld / 下界 nether / 末地 end / 天域 aether）。
// 过滤必须覆盖全部入口（装饰/查询），否则下界的 StructureManager 会求解村庄/要塞
// 并在缺少 getBaseHeight 等地表接口的生成器上抛错。
function dimMatches(def, gen) {
  if (!def || !def.dims || !Array.isArray(def.dims)) return true;
  const d = gen && gen.dimensionId;
  return !d || def.dims.indexOf(d) >= 0;
}

export class StructureManager {
  constructor(generator, seed) {
    this.generator = generator;
    this.seed = seed;
    // 烘焙开关：置 true 时 decorateChunk 短路（全景烘焙要求画面零建筑），不影响记录查询
    this.disabled = false;
    // 布局缓存：key = "type|ccx|ccz" -> record | null（null=选址未通过，同样缓存避免重复评估）
    this.cache = new Map();
    this.maxCache = 128; // 长距离探索会积累 null 记录，调小会挤掉村庄记录（村民生成路径已抗驱逐，此为兜底）
    // T5 箱子注册表："x,y,z" -> loot 表名。记录求解时从 meta.chests 注册（确定性、可重复注册），
    // 打开箱子时 World.getOrOpenContainer 用它查表生成内容；查不到 = 玩家自放箱子 = 空容器。
    this.chests = new Map();
    // 天域石碑注册表（批次 A）："x,y,z" -> 章节id（steles.js STELE_CHAPTERS 键）。
    // 记录求解时从 meta.steles 注册；右键石碑时 Game 走 steleChapterAt 查表，
    // 查不到 = 玩家自放石碑 → SteleScreen 回落无字碑。
    this.steles = new Map();
  }

  // 由 cell 推导锚点记录（带缓存）。record: { name, ax, az, groundY, blocks, meta, minX..maxZ }
  _cellRecord(typeName, def, ccx, ccz) {
    const key = typeName + '|' + ccx + '|' + ccz;
    if (this.cache.has(key)) return this.cache.get(key);

    let rec = null;
    // 多次锚点尝试：首个通过选址者胜出（每次尝试独立哈希流，盐加质数步长去相关）
    // anchorForCell 覆盖：环带等非网格锚点（要塞）——返回 null 表示该 cell 无锚点
    const tries = def.anchorForCell ? 1 : (def.attempts || 1);
    for (let k = 0; k < tries && !rec; k++) {
      const h = hash32(this.seed, ccx, ccz, def.salt + k * 7919);
      if (!def.anchorForCell && !((h >>> 16) / 65536 < def.chance)) continue;
      let anchorCx, anchorCz;
      if (def.anchorForCell) {
        const a = def.anchorForCell(this, ccx, ccz);
        if (!a) break;
        anchorCx = a.cx; anchorCz = a.cz;
      } else {
        // 概率门用高 16 位，抖动用低 16 位（各 8 位，互不侵占）
        // 抖动约束在 cell 中心 4..cell-4 区间：保证相邻 cell 锚点最小间距 ≥ 8 区块，避免相邻建筑重叠
        const span = Math.max(1, def.cell - 8);
        const jx = 4 + ((h & 255) % span);
        const jz = 4 + (((h >>> 8) & 255) % span);
        anchorCx = ccx * def.cell + (jx % def.cell);
        anchorCz = ccz * def.cell + (jz % def.cell);
      }
      const ax = anchorCx * CHUNK_SIZE + 8;
      const az = anchorCz * CHUNK_SIZE + 8;
      const groundY = def.place
        ? def.place(this.generator, ax, az)
        : this._surfacePlacement(def, ax, az);
      if (groundY < 0) continue;
      const rng = makeRng(hash32(this.seed, anchorCx, anchorCz, def.salt + 1));
      const layout = def.solve(rng, ax, groundY, az, this.generator);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const b of layout.blocks) {
        if (b[0] < minX) minX = b[0]; if (b[0] > maxX) maxX = b[0];
        if (b[2] < minZ) minZ = b[2]; if (b[2] > maxZ) maxZ = b[2];
      }
      rec = {
        name: typeName, ax, az, groundY,
        blocks: layout.blocks, meta: layout.meta || {},
        minX, maxX, minZ, maxZ,
      };
      // 注册该结构的全部箱子（meta.chests: [[x,y,z,表名],...]）——重复求解重复注册，幂等
      if (rec.meta.chests) {
        for (const c of rec.meta.chests) {
          this.chests.set(c[0] + ',' + c[1] + ',' + c[2], c[3]);
        }
      }
      // 注册该结构的全部石碑（meta.steles: [[x,y,z,章节id],...]）——天域叙事基石（批次 A）
      if (rec.meta.steles) {
        for (const s of rec.meta.steles) {
          this.steles.set(s[0] + ',' + s[1] + ',' + s[2], s[3]);
        }
      }
    }

    this.cache.set(key, rec);
    if (this.cache.size > this.maxCache) {
      this.cache.delete(this.cache.keys().next().value); // LRU：丢最旧（重求解结果不变）
    }
    return rec;
  }

  // 默认地表选址：群系白名单 + 海拔窗 + 12 样点平坦度/群系一致性（全部纯函数，零区块依赖）
  _surfacePlacement(def, ax, az) {
    const gen = this.generator;
    const biome = gen.getBiome(ax, az);
    if (def.biomes && !def.biomes.includes(biome)) return -1;
    const y = gen.getBaseHeight(ax, az);
    if (def.minTop !== undefined && y < def.minTop) return -1;
    if (def.maxTop !== undefined && y > def.maxTop) return -1;
    const maxSlope = def.maxSlope !== undefined ? def.maxSlope : 4;
    let min = y, max = y;
    // 探针环：8 向内环 + 4 向外环（半径可调；村庄用小环适配小型群系斑块）
    const [r1, r2] = def.probeR || [16, 28];
    const probes = [];
    for (const [dx, dz] of [[r1,0],[-r1,0],[0,r1],[0,-r1],[r1,r1],[-r1,r1],[r1,-r1],[-r1,-r1]]) probes.push([dx, dz]);
    probes.push([r2, 0], [-r2, 0], [0, r2], [0, -r2]);
    for (const [dx, dz] of probes) {
      if (gen.getBiome(ax + dx, az + dz) !== biome) return -1;
      const h = gen.getBaseHeight(ax + dx, az + dz);
      if (h < min) min = h;
      if (h > max) max = h;
    }
    if (max - min > maxSlope) return -1;
    return y;
  }

  // 区块装饰入口：树之后调用。绝大多数区块在包围盒测试处 O(cell数) 跳过。
  decorateChunk(chunk) {
    if (this.disabled) return;
    if (structureTypes.size === 0) return;
    const { cx, cz } = chunk;
    for (const [name, def] of structureTypes) {
      if (!dimMatches(def, this.generator)) continue;
      const rChunks = Math.ceil(def.radius / CHUNK_SIZE) + 1;
      const c0x = Math.floor((cx - rChunks) / def.cell);
      const c1x = Math.floor((cx + rChunks) / def.cell);
      const c0z = Math.floor((cz - rChunks) / def.cell);
      const c1z = Math.floor((cz + rChunks) / def.cell);
      for (let ccx = c0x; ccx <= c1x; ccx++) {
        for (let ccz = c0z; ccz <= c1z; ccz++) {
          const rec = this._cellRecord(name, def, ccx, ccz);
          if (!rec) continue;
          // 包围盒相交测试（区块块坐标范围）
          if (rec.maxX < cx * CHUNK_SIZE || rec.minX > cx * CHUNK_SIZE + CHUNK_SIZE - 1) continue;
          if (rec.maxZ < cz * CHUNK_SIZE || rec.minZ > cz * CHUNK_SIZE + CHUNK_SIZE - 1) continue;
          this._writeChunk(chunk, rec);
        }
      }
    }
  }

  // 树让位查询：返回与本区块（外扩 margin）相交的结构足迹盒数组。
  // 树 pass 在结构 pass 之前，树/巨型蘑菇生成前查此表跳过，避免树冠伸进建筑
  // （原版 MC 同款"树让位结构"）。与 decorateChunk 同一套 cell 扫描与记录缓存——
  // 纯查询、不写块、确定性、与区块生成顺序无关（联机两端一致）。
  footprintsNear(cx, cz, margin = 3) {
    if (structureTypes.size === 0) return [];
    const out = [];
    const bx0 = cx * CHUNK_SIZE - margin, bx1 = cx * CHUNK_SIZE + CHUNK_SIZE - 1 + margin;
    const bz0 = cz * CHUNK_SIZE - margin, bz1 = cz * CHUNK_SIZE + CHUNK_SIZE - 1 + margin;
    for (const [name, def] of structureTypes) {
      if (!dimMatches(def, this.generator)) continue;
      const rChunks = Math.ceil(def.radius / CHUNK_SIZE) + 1;
      const c0x = Math.floor((cx - rChunks) / def.cell);
      const c1x = Math.floor((cx + rChunks) / def.cell);
      const c0z = Math.floor((cz - rChunks) / def.cell);
      const c1z = Math.floor((cz + rChunks) / def.cell);
      for (let ccx = c0x; ccx <= c1x; ccx++) {
        for (let ccz = c0z; ccz <= c1z; ccz++) {
          const rec = this._cellRecord(name, def, ccx, ccz);
          if (!rec) continue;
          if (rec.maxX < bx0 || rec.minX > bx1 || rec.maxZ < bz0 || rec.minZ > bz1) continue;
          out.push({
            name,
            minX: rec.minX - margin, maxX: rec.maxX + margin,
            minZ: rec.minZ - margin, maxZ: rec.maxZ + margin,
          });
        }
      }
    }
    return out;
  }

  // 逐块裁剪：只写落在当前区块内的方块；同坐标后写覆盖先写（求解方的追加顺序即绘制优先级）
  _writeChunk(chunk, rec) {
    const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cz * CHUNK_SIZE;
    const blocks = rec.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const lx = blocks[i][0] - x0;
      if (lx < 0 || lx >= CHUNK_SIZE) continue;
      const lz = blocks[i][2] - z0;
      if (lz < 0 || lz >= CHUNK_SIZE) continue;
      const wy = blocks[i][1];
      if (wy < 1 || wy >= CHUNK_HEIGHT) continue;
      chunk.set(lx, wy, lz, blocks[i][3]);
    }
  }

  // 查询：位置附近 radius 内的结构记录（村民生成等运行时逻辑用，不触发求解）
  recordsNear(x, z, radius, typeName = null) {
    const out = [];
    for (const rec of this.cache.values()) {
      if (!rec) continue;
      if (typeName && rec.name !== typeName) continue;
      if (!dimMatches(structureTypes.get(rec.name), this.generator)) continue;
      const dx = Math.max(rec.minX - x, 0, x - rec.maxX);
      const dz = Math.max(rec.minZ - z, 0, z - rec.maxZ);
      if (dx * dx + dz * dz <= radius * radius) out.push(rec);
    }
    return out;
  }

  // 运行时按需求解指定 cell 的记录（村庄传送/村民生成定位等），结果同样进缓存
  ensureRecord(typeName, ccx, ccz) {
    const def = structureTypes.get(typeName);
    if (!def || !dimMatches(def, this.generator)) return null;
    return this._cellRecord(typeName, def, ccx, ccz);
  }

  // 运行时：位置附近 (2r+1)² cell 的记录（ensureRecord 按需重求解，抗 LRU 驱逐）。
  // 村民生成等周期性逻辑用这个而不是 recordsNear——后者只读缓存，长距离探索后记录会被挤出。
  recordsAround(typeName, x, z, r = 1) {
    const def = structureTypes.get(typeName);
    if (!def || !dimMatches(def, this.generator)) return [];
    const cellBlocks = def.cell * CHUNK_SIZE;
    const ccx = Math.floor(x / cellBlocks);
    const ccz = Math.floor(z / cellBlocks);
    const out = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const rec = this._cellRecord(typeName, def, ccx + dx, ccz + dz);
        if (rec) out.push(rec);
      }
    }
    return out;
  }

  // 调试用：当前缓存中的全部记录（确定性测试断言用）
  debugRecords() {
    return [...this.cache.values()].filter(Boolean);
  }

  // T5：坐标 → loot 表名（无注册 = 玩家自放箱子）
  chestTableAt(x, y, z) {
    return this.chests.get(x + ',' + y + ',' + z) || null;
  }

  // 天域石碑：坐标 → 章节id（无注册 = 玩家自放石碑，SteleScreen 回落无字碑）
  steleChapterAt(x, y, z) {
    return this.steles.get(x + ',' + y + ',' + z) || null;
  }

  // W2：玩家所处建筑名（荒野返回 null）。bbox 判定走 recordsAround（按需重求解，抗 LRU），
  // 调用方须自行节流（InfoBar 0.5s）——每次调用至多 2 类型 × 9 cell 求解（多数有缓存）。
  structureNameAt(x, z) {
    for (const [name, def] of structureTypes) {
      if (!dimMatches(def, this.generator)) continue;
      for (const rec of this.recordsAround(name, x, z)) {
        if (x < rec.minX || x > rec.maxX || z < rec.minZ || z > rec.maxZ) continue;
        if (name === 'village') return rec.meta && rec.meta.variant === 'desert' ? '沙漠村庄' : '村庄';
        if (name === 'stronghold') return '要塞';
        if (name === 'fortress') return '下界要塞';
        if (name === 'end_city') return '末地城';
        if (name === 'aether_temple') return '天空神殿';
        if (name === 'aether_tower') return '浮空瞭望塔';
        if (name === 'aether_ship') return '天域沉船';
        if (name === 'aether_well') return '漩风井';
        if (name === 'aether_gate') return '天海之门遗迹';
        if (name === 'tidefire_hearth') return '潮火之炉';
        if (name === 'tide_barrow') return '潮冢';
        if (name === 'gleaner_ring') return '拾遗者石环';
        if (name === 'whale_barrow') return '鲸骨冢';
        return name;
      }
    }
    return null;
  }

  // 游记探索：当前位置命中的结构实例（只返回已靠近并落入包围盒的结构）。
  structureRecordAt(x, z) {
    for (const [name, def] of structureTypes) {
      if (!dimMatches(def, this.generator)) continue;
      for (const rec of this.recordsAround(name, x, z)) {
        if (x < rec.minX || x > rec.maxX || z < rec.minZ || z > rec.maxZ) continue;
        let label = name;
        if (name === 'village') label = rec.meta && rec.meta.variant === 'desert' ? '沙漠村庄' : '村庄';
        else if (name === 'stronghold') label = '要塞';
        else if (name === 'fortress') label = '下界要塞';
        else if (name === 'end_city') label = '末地城';
        else if (name === 'aether_temple') label = '天空神殿';
        else if (name === 'aether_tower') label = '浮空瞭望塔';
        else if (name === 'aether_ship') label = '天域沉船';
        else if (name === 'aether_well') label = '漩风井';
        else if (name === 'aether_gate') label = '天海之门遗迹';
        else if (name === 'tidefire_hearth') label = '潮火之炉';
        else if (name === 'tide_barrow') label = '潮冢';
        else if (name === 'gleaner_ring') label = '拾遗者石环';
        else if (name === 'whale_barrow') label = '鲸骨冢';
        return { name, label, record: rec };
      }
    }
    return null;
  }
}

// 便捷导出：布局求解里常用的方块 id 解析（懒取，避免模块加载顺序问题）
export function blockId(name) { return BlockRegistry.getId(name); }

export { fillBox };
