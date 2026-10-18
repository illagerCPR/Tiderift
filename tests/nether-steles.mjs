// nether-steles.mjs -- 下界·烬火纪基石（世界观批次 N1）内容回归（node 直跑，无需服务器）
// 断言：
//   ① 烬纹石碑方块注册完备：displayName / 不可破坏 / SVG 键 / 追加纪律（id > tide_altar）
//   ② 哀潮之泪物品注册完备：displayName / stack / lore / 创造分类 materials
//   ③ 方块 lore 落位：灵魂沙 / 荧石（BlockRegistry.lore，InventoryScreen._bindHover 消费）
//   ④ 石碑章节表跨维度完备：dim 字段必填且合法；天域 11 章 / 下界 4 章；标题行文非空且行数克制（≤6）
//   ⑤ 无字碑回落：STELE_BLANK 在场
//   ⑥ 命令面板按维度过滤的数据面：全章 dim 值与 world.dimension 值域一致（'overworld' 等不缺漏）
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../src/items/ItemDefs.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { STELE_CHAPTERS, STELE_BLANK } from '../src/world/steles.js';
import { ok, finish } from './harness.mjs';

// ── ① 烬纹石碑 ──
const stele = BlockRegistry.getByName('ember_stele');
ok(!!stele, '方块注册: ember_stele');
ok(stele.displayName === '烬纹石碑', `displayName: ember_stele (${stele.displayName})`);
ok(stele.hardness === -1, 'ember_stele 不可破坏（-1，风纹石碑同档）');
ok(BlockSVGDefinitions.ember_stele !== undefined, 'SVG 纹理键在场: ember_stele');
ok(stele.light === 0 && stele.solid === true, 'ember_stele 非光源实体方块');
ok(stele.id > BlockRegistry.getId('tide_altar'), '追加纪律: ember_stele id > tide_altar（append-only）');

// ── ② 哀潮之泪 ──
const tear = ItemRegistry.getByName('mourn_tear');
ok(!!tear, '物品注册: mourn_tear');
ok(tear.displayName === '哀潮之泪', `displayName: mourn_tear (${tear.displayName})`);
ok(tear.stack === 16, `stack 16 (${tear.stack})`);
ok(Array.isArray(tear.lore) && tear.lore.length === 2, 'mourn_tear lore 2 行');
ok(ItemSVGDefinitions.mourn_tear !== undefined, 'SVG 纹理键在场: mourn_tear');
ok(getItemCategory('mourn_tear') === 'materials', '创造分类 materials');
ok(getItemCategory('ember_stele') === 'functional', '创造分类 functional（ember_stele）');

// ── ③ 方块 lore 落位 ──
const soul = BlockRegistry.getByName('soul_sand');
const glow = BlockRegistry.getByName('glowstone');
ok(Array.isArray(soul.lore) && soul.lore.length === 2, '灵魂沙方块 lore 2 行');
ok(Array.isArray(glow.lore) && glow.lore.length === 2, '荧石方块 lore 2 行');
ok(soul.lore[0].includes('坠潮'), '灵魂沙 lore 扣坠潮设定');
ok(glow.lore[1].includes('长明灯石'), '荧石 lore 扣长明灯石重释');

// ── ④ 石碑章节表跨维度完备 ──
const VALID_DIMS = ['overworld', 'nether', 'end', 'aether'];
const byDim = {};
for (const [id, ch] of Object.entries(STELE_CHAPTERS)) {
  ok(ch && typeof ch.title === 'string' && ch.title.length > 0, `章节标题非空: ${id}`);
  ok(Array.isArray(ch.lines) && ch.lines.length >= 1 && ch.lines.length <= 6, `章节行数 1-6: ${id} (${(ch.lines || []).length})`);
  ok(ch.lines.every((l) => typeof l === 'string' && l.length > 0), `章节行文均为非空字符串: ${id}`);
  ok(VALID_DIMS.includes(ch.dim), `dim 字段合法: ${id} (${ch.dim})`);
  byDim[ch.dim] = (byDim[ch.dim] || 0) + 1;
}
ok(byDim.aether === 11, `天域 11 章 (${byDim.aether})`);
ok(byDim.nether === 4, `下界 4 章 (${byDim.nether})`);
ok(byDim.overworld === 3 && byDim.end === 2, '主世界 3 章 / 末地 2 章（E1 已交付）');
const EMBER_IDS = ['ember_sinking', 'ember_hearth', 'ember_sooted', 'ember_mourning'];
for (const id of EMBER_IDS) ok(!!STELE_CHAPTERS[id], `烬火纪章节在场: ${id}`);
ok(!!STELE_CHAPTERS.prologue && !!STELE_CHAPTERS.renewal, '天域既有章节未被破坏（prologue/renewal）');

// ── ⑤ 无字碑回落 ──
ok(STELE_BLANK && typeof STELE_BLANK.title === 'string' && Array.isArray(STELE_BLANK.lines), 'STELE_BLANK 在场（未注册石碑回落）');

// ── ⑥ 数据面：章节数与章 id 无分隔符冲突（steleChapterAt 以 ',' 连接键）──
for (const id of Object.keys(STELE_CHAPTERS)) {
  ok(!id.includes(','), `章节 id 不含 ','（注册表键格式安全）: ${id}`);
}
finish('nether-steles');
