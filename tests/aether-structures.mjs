// aether-structures.mjs -- 天域三结构回归（node 直跑，无需服务器）
// 断言：
//   ① 结构类型注册 + 维度作用域（主世界/下界/末地生成器不求解 aether_*）
//   ② 选址漏斗：±4 cell 扫描（双 seed）三种结构各至少一例；神殿必须在水晶秘境
//   ③ 结构落地：底台石英/塔身白桦/沉船浮空进区块；bbox 一致
//   ④ 箱子三向一致：meta.chests ↔ chest 方块 ↔ sm.chests 注册（三表）
//   ⑤ loot：三表确定性 + 条目可解析
//   ⑥ 双次求解确定性：blocks 逐字节一致
import { Chunk, CHUNK_SIZE } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { AetherGenerator } from '../src/world/dimensions/aether.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { EndGenerator } from '../src/world/dimensions/end.js';
import { chestLoot } from '../src/world/loot.js';
import { STELE_CHAPTERS as steleChapters } from '../src/world/steles.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

const SEEDS = [42, 20250903];

const TYPES = ['aether_temple', 'aether_tower', 'aether_ship', 'aether_well', 'aether_gate'];

// ① 维度作用域：其他维度生成器不求解 aether_*
{
  const owGen = new TerrainGenerator(42);
  const nGen = new NetherGenerator(42);
  const eGen = new EndGenerator(42);
  for (const t of TYPES) {
    ok(!owGen.structureManager.ensureRecord(t, 0, 0), `主世界不应求解 ${t}（dims 过滤失效）`);
    ok(!nGen.structureManager.ensureRecord(t, 0, 0), `下界不应求解 ${t}（dims 过滤失效）`);
    ok(!eGen.structureManager.ensureRecord(t, 0, 0), `末地不应求解 ${t}（dims 过滤失效）`);
  }
}

const sig = (r) => r.blocks.map(b => b.join(',')).join('|') + '#' + JSON.stringify(r.meta.chests) + '#' + JSON.stringify(r.meta.steles || []);
const RES = { aether_temple: null, aether_tower: null, aether_ship: null, aether_well: null, aether_gate: null };

for (const seed of SEEDS) {
  const gen = new AetherGenerator(seed);

  // ② 选址漏斗：按类型扫描（ship/gate 网格大，半径同步放大）找到各至少一例
  const CELLS = { aether_temple: 14, aether_tower: 14, aether_ship: 32, aether_well: 12, aether_gate: 24 };
  const found = {};
  for (const t of TYPES) {
    const CELL = CELLS[t] * CHUNK_SIZE;
    const R = (t === "aether_temple" || t === "aether_tower") ? 4 : 6;
    outer:
    for (let cx = -R; cx <= R; cx++) {
      for (let cz = -R; cz <= R; cz++) {
        const rec = gen.structureManager.ensureRecord(t, cx, cz);
        if (rec) { found[t] = rec; break outer; }
      }
    }
    ok(!!found[t], `seed=${seed} 扫描区未找到 ${t}（选址门过严或密度参数改动）`);
  }

  // ②b 神殿群系门：锚点必须在水晶秘境
  ok(gen.getBiome(found.aether_temple.ax, found.aether_temple.az) === 'crystal',
    `seed=${seed} 神殿锚点不在水晶秘境（群系门失效）`);

  // ③ 结构落地 + ④ 箱子三向一致
  const QB = BlockRegistry.getId('quartz_block');
  const BP = BlockRegistry.getId('birch_planks');
  const CH = BlockRegistry.getId('chest');
  for (const t of TYPES) {
    const rec = found[t];
    const touched = new Map();
    const chunkAt = (x, z) => {
      const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
      const k = cx + ',' + cz;
      if (!touched.has(k)) { const c = new Chunk(cx, cz); gen.generateChunk(c); touched.set(k, c); }
      return touched.get(k);
    };
    const blockAt = (x, y, z) => {
      const c = chunkAt(x, z);
      return c.get(((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, y, ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE);
    };
    // 落地抽查：每类结构的招牌方块在布局坐标处可读回
    const SB = BlockRegistry.getId('stone_bricks');
    const WC = BlockRegistry.getId('wind_current');
    const want = t === 'aether_temple' ? QB : t === 'aether_tower' ? BP : t === 'aether_ship' ? BP
      : t === 'aether_well' ? WC : QB;
    let hits = 0;
    for (const [x, y, z, id] of rec.blocks) {
      if (id === want && blockAt(x, y, z) === want) hits++;
    }
    ok(hits >= 20, `seed=${seed} ${t} 招牌方块落地不足: ${hits}/${rec.blocks.length}`);
    // 落地抽查：全部声明 chest 方块就位
    for (const c of rec.meta.chests) {
      ok(c[3].startsWith('aether_'), `未知 loot 表: ${c[3]}`);
      ok(blockAt(c[0], c[1], c[2]) === CH, `${t} chest 方块缺失 @(${c[0]},${c[1]},${c[2]})`);
      ok(gen.structureManager.chests.get(c[0] + ',' + c[1] + ',' + c[2]) === c[3],
        `${t} sm.chests 注册缺失 @(${c[0]},${c[1]},${c[2]})`);
    }
    // 石碑三向一致（批次 B）：meta.steles ↔ wind_stele 方块 ↔ sm.steles 注册
    const WS = BlockRegistry.getId('wind_stele');
    for (const s of (rec.meta.steles || [])) {
      ok(!!steleChapters[s[3]], `未知碑文章节: ${s[3]}`);
      ok(blockAt(s[0], s[1], s[2]) === WS, `${t} wind_stele 方块缺失 @(${s[0]},${s[1]},${s[2]})`);
      ok(gen.structureManager.steles.get(s[0] + ',' + s[1] + ',' + s[2]) === s[3],
        `${t} sm.steles 注册缺失 @(${s[0]},${s[1]},${s[2]})`);
    }
    // 沉船浮空：全部方块高于立地面 8 格以上（悬于岛上）
    if (t === 'aether_ship') {
      const minY = Math.min(...rec.blocks.map(b => b[1]));
      ok(minY >= rec.groundY + 8, `seed=${seed} 沉船未浮空（minY=${minY} < groundY+8=${rec.groundY + 8}）`);
    }
    // 漩风井（批次 B）：中央气流柱 ≥18 格且方块为 wind_current
    if (t === 'aether_well') {
      const WC = BlockRegistry.getId('wind_current');
      const cols = rec.blocks.filter(b => b[3] === WC);
      ok(cols.length >= 18, `seed=${seed} 漩风井气流柱不足: ${cols.length}`);
    }
    // 神殿内殿（批次 B）：恒昼祭坛 + 封门星髓块 + 圣所地面就位
    if (t === 'aether_temple') {
      const AL = BlockRegistry.getId('aether_altar');
      const SM = BlockRegistry.getId('star_marrow_block');
      const altar = rec.blocks.find(b => b[3] === AL);
      const hatch = rec.blocks.find(b => b[3] === SM);
      ok(!!altar, 'seed=' + seed + ' 神殿缺恒昼祭坛');
      ok(!!hatch, 'seed=' + seed + ' 神殿缺封门星髓块');
      ok(rec.meta.steles.length === 2, 'seed=' + seed + ' 内殿双碑（sundering/command）');
      ok(blockAt(altar[0], altar[1] - 1, altar[2]) === QB, '祭坛下方圣所地面缺失');
    }
    RES[t] = RES[t] || { seed, sig: sig(rec) };
  }

  // ⑥ 双次求解确定性
  const gen2 = new AetherGenerator(seed);
  for (const t of TYPES) {
    const CELL = CELLS[t] * CHUNK_SIZE;
    const R2 = (t === "aether_temple" || t === "aether_tower") ? 4 : 6;
    outer2:
    for (let cx = -R2; cx <= R2; cx++) {
      for (let cz = -R2; cz <= R2; cz++) {
        const rec2 = gen2.structureManager.ensureRecord(t, cx, cz);
        if (rec2) {
          ok(sig(rec2) === sig(found[t]), `seed=${seed} ${t} 双次求解不一致`);
          break outer2;
        }
      }
    }
  }
}

// ⑤ loot：确定性 + 条目可解析（含批次 B 内殿圣所表 + FORCED 星髓保底）
{
  const resolvable = (name) => !!ItemRegistry.getByName(name) || !!BlockRegistry.getById(BlockRegistry.getId(name));
  for (const t of ['aether_temple', 'aether_tower', 'aether_ship', 'aether_sanctum']) {
    const a = chestLoot(42, t, 10, 70, 10);
    const b = chestLoot(42, t, 10, 70, 10);
    ok(JSON.stringify(a) === JSON.stringify(b), `${t} loot 不确定`);
    ok(a.length === 27 && a.every(s => s === null || (s.count >= 1 && resolvable(s.name))), `${t} loot 结构非法`);
  }
  const sanctum = chestLoot(42, 'aether_sanctum', 10, 70, 10);
  ok(sanctum.some(s => s && s.name === 'star_marrow' && s.count >= 2), '内殿圣所 FORCED 星髓保底生效');
}

// ⑦ 出生岛引路碑（批次 B）：原点区块 (8,8) 列必置石碑且注册 prologue 章节
{
  const gen = new AetherGenerator(SEEDS[0]);
  const c = new Chunk(0, 0);
  gen.generateChunk(c);
  const WS = BlockRegistry.getId('wind_stele');
  let steleY = -1;
  for (let y = 130; y >= 40; y--) {
    if (c.get(8, y, 8) === WS) { steleY = y; break; }
  }
  ok(steleY > 0, `出生岛引路碑就位 (y=${steleY})`);
  ok(gen.structureManager.steles.get(`8,${steleY},8`) === 'prologue', '引路碑章节注册 prologue');
  // 出生态探针（decorate=false）不置碑不注册章节（递归防护）
  const gen2 = new AetherGenerator(SEEDS[0]);
  const c2 = new Chunk(0, 0);
  gen2.generateChunk(c2, false);
  let steleY2 = -1;
  for (let y = 130; y >= 40; y--) {
    if (c2.get(8, y, 8) === WS) { steleY2 = y; break; }
  }
  ok(steleY2 < 0, 'decorate=false 探针不置碑（递归防护）');
  ok(gen2.structureManager.steles.size === 0, 'decorate=false 探针不注册章节');
}
finish(`天域结构回归（${SEEDS.length} seeds）`);
