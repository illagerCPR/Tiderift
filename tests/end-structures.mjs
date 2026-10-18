// end-structures.mjs -- 拾遗者石环 + 主岛守望界碑回归（世界观批次 E2，node 直跑，无需服务器）
// 断言：
//   ① 密度预案：cell 14 / attempts 2 / chance 0.5 / salt 7268；dims ['end']
//   ② 维度作用域：下界/主世界生成器不求解 gleaner_ring
//   ③ 选址门控：非高原群系（main_island/small_end_islands/void）place 一律 -1
//   ④ 选址漏斗（×2 seed）：外环 cell 扫描至少一例石环
//   ⑤ 石环落地：界碑三向一致（end_gleaner）/ 箱三向一致（gleaner_ring 表）/ 碎岛柱环 / 卫星碎岛
//   ⑥ structureNameAt：环心报「拾遗者石环」
//   ⑦ 双次求解确定性：blocks+meta 逐字节一致（同 seed 两生成器对拍）
//   ⑧ 主岛守望界碑：(26,top+1,26) 硬编码位 end_stele 方块 + sm.steles 注册 end_watch；
//      decorate=false 探针不注册（防递归污染）
//   ⑨ 不变量绊线：折跃门内缘半径 / 高原分界半径未被本批改动
//   ⑩ i18n 盲区键：「拾遗者石环」（structureNameAt 返回值，动态扫描盲区）×10 包在场
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { Chunk } from '../src/core/Chunk.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { EndGenerator, GATEWAY_INNER_R, HIGHLANDS_MIN_R } from '../src/world/dimensions/end.js';
import { chestLoot } from '../src/world/loot.js';
import { GLEANER_RING_DEF } from '../src/world/structures/gleaner_ring.js';
import { zhTW } from '../src/i18n/locales/zh-TW.js';
import { en } from '../src/i18n/locales/en.js';
import { fr } from '../src/i18n/locales/fr.js';
import { de } from '../src/i18n/locales/de.js';
import { ja } from '../src/i18n/locales/ja.js';
import { ko } from '../src/i18n/locales/ko.js';
import { ar } from '../src/i18n/locales/ar.js';
import { ru } from '../src/i18n/locales/ru.js';
import { es } from '../src/i18n/locales/es.js';
import { pt } from '../src/i18n/locales/pt.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

const SEEDS = [42, 20250903];

const sig = (r) => r.blocks.map((b) => b.join(',')).join('|') + '#' + JSON.stringify(r.meta);
const id = (n) => BlockRegistry.getId(n);

// ① 密度预案
ok(GLEANER_RING_DEF.cell === 14 && GLEANER_RING_DEF.attempts === 2 && GLEANER_RING_DEF.chance === 0.5
  && GLEANER_RING_DEF.salt === 7268, `密度预案 cell14/att2/chance0.5/salt7268 (${GLEANER_RING_DEF.cell}/${GLEANER_RING_DEF.attempts}/${GLEANER_RING_DEF.chance}/${GLEANER_RING_DEF.salt})`);
ok(Array.isArray(GLEANER_RING_DEF.dims) && GLEANER_RING_DEF.dims.length === 1 && GLEANER_RING_DEF.dims[0] === 'end', "dims ['end']");
ok(typeof GLEANER_RING_DEF.place === 'function' && typeof GLEANER_RING_DEF.solve === 'function', 'place/solve 均为函数（无 anchorForCell 覆盖，管理器概率门生效）');

// ② 维度作用域
{
  const nGen = new NetherGenerator(42);
  const tGen = new TerrainGenerator(42);
  ok(!nGen.structureManager.ensureRecord('gleaner_ring', 0, 0), '下界不应求解 gleaner_ring');
  ok(!tGen.structureManager.ensureRecord('gleaner_ring', 0, 0), '主世界不应求解 gleaner_ring');
}

// ③ 选址门控：非高原群系一律拒绝（biome 门先于临时区块探测）
{
  for (const biome of ['main_island', 'small_end_islands', 'void']) {
    const fake = { getBiome: () => biome };
    ok(GLEANER_RING_DEF.place(fake, 800, 800) === -1, `非高原拒绝: ${biome}`);
  }
}

// ④-⑥ 选址漏斗 + 落地 + 名称（×2 seed）
for (const seed of SEEDS) {
  const gen = new EndGenerator(seed);
  const sm = gen.structureManager;

  let found = null;
  outer:
  for (let cx = 2; cx <= 8; cx++) {
    for (let cz = 2; cz <= 8; cz++) {
      const rec = sm.ensureRecord('gleaner_ring', cx, cz);
      if (rec) { found = rec; break outer; }
    }
  }
  ok(!!found, `seed=${seed} 外环扫描区未找到 gleaner_ring（高原门控过严或密度参数改动）`);
  if (!found) continue;
  const rec = found;

  // ⑤ 石环落地：签名方块计数 + 三向注册
  const count = {};
  for (const b of rec.blocks) count[b[3]] = (count[b[3]] || 0) + 1;
  ok((count[id('end_stele')] || 0) === 1, `界纹石碑 ×1 (${count[id('end_stele')] || 0})`);
  ok((count[id('end_stone_bricks')] || 0) >= 8, `碎岛柱环砖石在位 (${count[id('end_stone_bricks')] || 0})`);
  ok((count[id('end_stone')] || 0) >= 10, `末地石底座/卫星碎岛在位 (${count[id('end_stone')] || 0})`);
  ok((count[id('chest')] || 0) === 1, `存物箱 ×1 (${count[id('chest')] || 0})`);
  ok((count[id('chorus_flower')] || 0) === 2, `卫星碎岛紫颂 ×2 (${count[id('chorus_flower')] || 0})`);

  {
    const [x, y, z, chapter] = rec.meta.steles[0];
    ok(chapter === 'end_gleaner', `碑章 end_gleaner (${chapter})`);
    ok(rec.blocks.some((b) => b[0] === x && b[1] === y && b[2] === z && b[3] === id('end_stele')), '界碑方块在声明坐标（环心圆台上）');
    ok(sm.steles.get(x + ',' + y + ',' + z) === 'end_gleaner', 'sm.steles 注册一致');
    ok(y === rec.groundY, `碑立于圆台上（groundY） (${y})`);
  }
  {
    const [x, y, z, table] = rec.meta.chests[0];
    ok(table === 'gleaner_ring', `箱表名 gleaner_ring (${table})`);
    ok(rec.blocks.some((b) => b[0] === x && b[1] === y && b[2] === z && b[3] === id('chest')), '箱方块在声明坐标');
    ok(sm.chests.get(x + ',' + y + ',' + z) === 'gleaner_ring', 'sm.chests 注册一致');
    const loot = chestLoot(seed, 'gleaner_ring', x, y, z);
    const items = loot.filter(Boolean);
    ok(items.length > 0, `箱表可开出物品 (${items.length} 组)`);
    ok(items.every((s) => s && s.name && s.count >= 1), '箱表条目结构合法');
  }
  ok(rec.blocks.every((b) => Math.abs(b[0] - rec.ax) <= 20 && Math.abs(b[2] - rec.az) <= 20), '方块均在锚点 ±20 内（环体规模不失控）');
  ok(rec.blocks.every((b) => b[1] >= 30 && b[1] <= 96), '方块高度在末地外岛合理域');

  // ⑥ structureNameAt：环心报「拾遗者石环」
  ok(sm.structureNameAt(rec.ax, rec.az) === '拾遗者石环', `structureNameAt 环心 = 拾遗者石环 (${sm.structureNameAt(rec.ax, rec.az)})`);

  // ⑦ 双次求解确定性（新生成器同 seed 对拍）
  {
    const gen2 = new EndGenerator(seed);
    let rec2 = null;
    for (let cx = 2; cx <= 8 && !rec2; cx++) {
      for (let cz = 2; cz <= 8 && !rec2; cz++) {
        rec2 = gen2.structureManager.ensureRecord('gleaner_ring', cx, cz);
      }
    }
    ok(!!rec2 && sig(rec2) === sig(rec), '同 seed 两生成器求解逐字节一致');
  }
}

// ⑧ 主岛守望界碑（×2 seed）：块写入 + 注册；探针路径不注册
for (const seed of SEEDS) {
  const gen = new EndGenerator(seed);
  const span = gen._islandSpan(26, 26);
  ok(!!span, `seed=${seed} (26,26) 在主岛内（守望碑位有效）`);
  if (!span) continue;
  const c = new Chunk(1, 1);
  gen.generateChunk(c, true);
  const lx = 26 - 16, lz = 26 - 16;
  ok(c.get(lx, span.top + 1, lz) === id('end_stele'), `守望碑方块在 (26,${span.top + 1},26)`);
  ok(gen.structureManager.steles.get(`26,${span.top + 1},26`) === 'end_watch', 'sm.steles 注册 end_watch');
  // 周边无柱环冲突绊线：Build 20 ① 四格形制——碑座=紫珀底座、碑列完整、下方仍是主岛末地石
  ok(c.get(lx, span.top, lz) === id('purpur_block'), '碑座为紫珀底座（Build 20 ① 四格形制）');
  ok(c.get(lx, span.top + 2, lz) === id('glowstone') && c.get(lx, span.top + 3, lz) === id('purpur_block'),
    '碑列荧石/顶帽完整（四格形制）');
  ok(c.get(lx, span.top - 1, lz) === id('end_stone'), '碑位下方为主岛末地石（未被黑曜石柱覆盖）');

  const gen2 = new EndGenerator(seed);
  const c2 = new Chunk(1, 1);
  gen2.generateChunk(c2, false);
  ok(gen2.structureManager.steles.size === 0, 'decorate=false 选址/出生探针不注册碑章（防递归污染）');
}

// ⑨ 不变量绊线：本批不得改动折跃门/群系边界常量
ok(GATEWAY_INNER_R === 50, `折跃门内缘半径不变 (${GATEWAY_INNER_R})`);
ok(HIGHLANDS_MIN_R === 28, `高原分界半径不变 (${HIGHLANDS_MIN_R})`);

// ⑩ i18n 盲区键：structureNameAt 返回值 ×10 包在场
for (const [loc, pack] of Object.entries({ 'zh-TW': zhTW, en, fr, de, ja, ko, ar, ru, es, pt })) {
  ok(Object.prototype.hasOwnProperty.call(pack, '拾遗者石环'), `[${loc}] 盲区键在场: 拾遗者石环`);
}
finish('end-structures');
