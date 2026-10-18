// loot-determinism.mjs -- T5 战利品/交易表确定性回归（node 直跑，无需服务器）
// 断言：
//   ① chestLoot 同 (seed,表,坐标) 双次生成逐字节一致，27 槽、内容非空
//   ② villagerTrades 同 tradeSeed 双次一致、结构合法（6 条、数量≥1、物品存在）
//   ③ 村庄/要塞 solve 产出的 meta.chests：坐标处确有 chest 方块、表名合法
//   ④ 两端独立求解同一区域 → StructureManager.chests 注册表完全一致（联机打开箱子内容一致的根基）
// 用法：node tests/loot-determinism.mjs（CI 经 server/run-all-tests.sh 调用）
import { TerrainGenerator } from '../src/world/terrain.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { chestLoot, villagerTrades } from '../src/world/loot.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { pass, fail, finish, configure } from './harness.mjs';
configure({ verbose: true });

const SEED = 20250903;
const CHEST_ID = BlockRegistry.getId('chest');
const TABLE_NAMES = new Set([
  'village_house', 'village_big', 'stronghold_hub', 'stronghold_library', 'stronghold_storage',
]);

function nameExists(name) {
  return !!(ItemRegistry.getByName(name) || BlockRegistry.getByName(name));
}

// ── ① chestLoot 确定性 ────────────────────────────────────────────────
for (const table of TABLE_NAMES) {
  const a = chestLoot(SEED, table, 123, 70, -456);
  const b = chestLoot(SEED, table, 123, 70, -456);
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(`chestLoot(${table}) 双次生成不一致`);
  if (a.length !== 27) fail(`chestLoot(${table}) 槽数错误: ${a.length}`);
  const filled = a.filter(Boolean);
  if (filled.length < 4) fail(`chestLoot(${table}) 内容过少: ${filled.length} 组`);
  for (const s of filled) {
    if (!nameExists(s.name)) fail(`chestLoot(${table}) 含未知物品: ${s.name}`);
    if (!(s.count >= 1 && s.count <= 64)) fail(`chestLoot(${table}) 数量非法: ${s.name}×${s.count}`);
  }
}
const c1 = chestLoot(SEED, 'stronghold_storage', 100, 20, 100);
const c2 = chestLoot(SEED, 'stronghold_storage', 101, 20, 100);
if (JSON.stringify(c1) === JSON.stringify(c2)) fail('相邻坐标战利品完全相同（坐标未参与种子）');
pass('① chestLoot: 5 张表确定性一致、27 槽、物品/数量合法、相邻坐标去相关');

// ── ② villagerTrades 确定性与结构 ─────────────────────────────────────
{
  const t1 = villagerTrades(SEED, 424242);
  const t2 = villagerTrades(SEED, 424242);
  if (JSON.stringify(t1) !== JSON.stringify(t2)) fail('villagerTrades 双次生成不一致');
  if (t1.length !== 6) fail(`交易条数错误: ${t1.length}`);
  for (const tr of t1) {
    for (const side of [tr.give, tr.get]) {
      if (!nameExists(side.name)) fail(`交易含未知物品: ${side.name}`);
      if (!(side.count >= 1 && side.count <= 64)) fail(`交易数量非法: ${side.name}×${side.count}`);
    }
  }
  const diverge = new Set();
  for (let i = 0; i < 24; i++) diverge.add(JSON.stringify(villagerTrades(SEED, 1000 + i)));
  if (diverge.size < 20) fail(`24 个 tradeSeed 只产生 ${diverge.size} 种交易表（去相关性不足）`);
  pass(`② villagerTrades: 确定性一致、6 条合法、24 seed 产生 ${diverge.size} 种表`);
}

// ── ③/④ 结构箱子注册：坐标=chest 方块、表名合法、两端一致 ────────────
function scanStructures() {
  const gen = new TerrainGenerator(SEED);
  const sm = gen.structureManager;
  const found = [];
  // 村庄：cell=20；要塞：cell=48（环带点落进才放置，取全部记录）
  for (let ccx = -3; ccx <= 3; ccx++) {
    for (let ccz = -3; ccz <= 3; ccz++) {
      const v = sm.ensureRecord('village', ccx, ccz);
      if (v) found.push(v);
      const s = sm.ensureRecord('stronghold', ccx, ccz);
      if (s) found.push(s);
    }
  }
  return { gen, sm, found };
}

const r1 = scanStructures();
const r2 = scanStructures();
if (r1.found.length === 0) fail('扫描区未找到任何村庄/要塞记录（选址异常）');
let chestCount = 0;
for (const rec of r1.found) {
  const chestSet = new Set(rec.blocks.filter(b => b[3] === CHEST_ID).map(b => b[0] + ',' + b[1] + ',' + b[2]));
  const declared = rec.meta.chests || [];
  if (chestSet.size !== declared.length) {
    fail(`${rec.name}@(${rec.ax},${rec.az}) chest 方块 ${chestSet.size} 个但 meta.chests 声明 ${declared.length} 个`);
  }
  for (const [x, y, z, table] of declared) {
    if (!TABLE_NAMES.has(table)) fail(`${rec.name} 箱子表名非法: ${table}`);
    if (!chestSet.has(x + ',' + y + ',' + z)) fail(`${rec.name} meta.chests 坐标 (${x},${y},${z}) 无 chest 方块`);
    chestCount++;
  }
}
const keys1 = [...r1.sm.chests.keys()].sort().join('|');
const keys2 = [...r2.sm.chests.keys()].sort().join('|');
const vals1 = [...r1.sm.chests.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(e => e.join('=')).join('|');
const vals2 = [...r2.sm.chests.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(e => e.join('=')).join('|');
if (keys1 !== keys2 || vals1 !== vals2) fail('两端独立求解的 chests 注册表不一致');
if (r1.sm.chests.size !== chestCount) fail(`注册表 ${r1.sm.chests.size} 项 ≠ 声明总数 ${chestCount}`);
pass(`③④ 结构箱子: ${r1.found.length} 个结构、${chestCount} 个箱子坐标/表名/方块三向一致，两端注册表逐项一致`);

// ── ⑤ W2:建筑归属查询与要塞环带点 ─────────────────────────────────────
{
  const sm = r1.sm;
  const village = r1.found.find(v => v.name === 'village');
  if (village) {
    const at = sm.structureNameAt(village.ax, village.az);
    const expect = village.meta.variant === 'desert' ? '沙漠村庄' : '村庄';
    if (at !== expect) fail(`structureNameAt(村庄锚点) = ${at}，期望 ${expect}`);
  }
  if (sm.structureNameAt(999999, -999999) !== null) fail('荒野坐标应返回 null');
  const { ringPoints } = await import('../src/world/structures/stronghold.js');
  const pts = ringPoints(SEED);
  if (pts.length !== 3) fail(`环带点数 ${pts.length} ≠ 3`);
  // 环带点必须与 stronghold 记录锚点一致（同一公式，勿漂移）
  const strongholds = r1.found.filter(v => v.name === 'stronghold');
  for (const rec of strongholds) {
    const hit = pts.some(p => Math.abs(p.x - rec.ax) <= 8 && Math.abs(p.z - rec.az) <= 8);
    if (!hit) fail(`要塞锚点 (${rec.ax},${rec.az}) 不在 ringPoints 内（公式漂移）`);
  }
  pass(`⑤ 建筑归属: structureNameAt 正确、ringPoints 3 点与 ${strongholds.length} 座要塞锚点一致`);
}
finish('T5 战利品确定性回归');
