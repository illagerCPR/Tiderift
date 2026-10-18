// overworld-steles.mjs -- 主世界·雨土纪基石（世界观批次 W1）内容回归（node 直跑，无需服务器）
// 断言：
//   ① 苔纹石碑方块注册完备：displayName / 不可破坏 / SVG 键 / 追加纪律（id > ember_stele）
//   ② 雨潮残页物品注册完备：displayName / stack / lore / 创造分类 materials
//   ③ 凋灵骷髅头（物品）禁忌拼合 lore：2 行且与灵魂沙 lore 并存不冲突
//   ④ 雨土纪章节表：3 章在场且 dim='overworld'；全章 dim 计数 天域9/下界4/主世界3/末地0
//   ⑤ 章节行文纪律：标题非空 / 行数 1-6 / 行文非空 / id 无 ','
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../src/items/ItemDefs.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { STELE_CHAPTERS } from '../src/world/steles.js';
import { ok, finish } from './harness.mjs';

// ── ① 苔纹石碑 ──
const stele = BlockRegistry.getByName('moss_stele');
ok(!!stele, '方块注册: moss_stele');
ok(stele.displayName === '苔纹石碑', `displayName: moss_stele (${stele.displayName})`);
ok(stele.hardness === -1, 'moss_stele 不可破坏（-1，石碑家族同档）');
ok(BlockSVGDefinitions.moss_stele !== undefined, 'SVG 纹理键在场: moss_stele');
ok(stele.light === 0 && stele.solid === true, 'moss_stele 非光源实体方块');
ok(stele.id > BlockRegistry.getId('ember_stele'), '追加纪律: moss_stele id > ember_stele（append-only）');

// ── ② 雨潮残页 ──
const page = ItemRegistry.getByName('page_rain');
ok(!!page, '物品注册: page_rain');
ok(page.displayName === '雨潮残页', `displayName: page_rain (${page.displayName})`);
ok(page.stack === 16, `stack 16 (${page.stack})`);
ok(Array.isArray(page.lore) && page.lore.length === 2, 'page_rain lore 2 行');
ok(page.lore.some((l) => l.includes('雨是咸的')), 'page_rain lore 扣雨民祖训');
ok(ItemSVGDefinitions.page_rain !== undefined, 'SVG 纹理键在场: page_rain');
ok(getItemCategory('page_rain') === 'materials', '创造分类 materials（page_rain）');
ok(getItemCategory('moss_stele') === 'functional', '创造分类 functional（moss_stele）');

// ── ③ 凋灵骷髅头（物品）lore ──
const skull = ItemRegistry.getByName('wither_skeleton_skull');
ok(!!skull, '物品注册: wither_skeleton_skull');
ok(Array.isArray(skull.lore) && skull.lore.length === 2, '凋灵骷髅头物品 lore 2 行');
ok(skull.lore[0].includes('熏黑卫'), '骷髅头 lore 扣熏黑卫来历');
ok(skull.lore[1].includes('颅骨'), '骷髅头 lore 扣三头拼合');
const soul = BlockRegistry.getByName('soul_sand');
ok(Array.isArray(soul.lore) && soul.lore.length === 2, '灵魂沙 N1 lore 未被破坏（2 行）');

// ── ④ 雨土纪章节表 ──
const RAIN_IDS = ['rain_salted', 'rain_pattern', 'rain_hall'];
const RAIN_TITLES = { rain_salted: '咸雨', rain_pattern: '纹样', rain_hall: '门厅' };
for (const id of RAIN_IDS) {
  const ch = STELE_CHAPTERS[id];
  ok(!!ch, `雨土纪章节在场: ${id}`);
  ok(ch.dim === 'overworld', `章节 dim=overworld: ${id} (${ch.dim})`);
  ok(ch.title === RAIN_TITLES[id], `章节标题: ${id} (${ch.title})`);
}
const byDim = {};
for (const [id, ch] of Object.entries(STELE_CHAPTERS)) {
  byDim[ch.dim] = (byDim[ch.dim] || 0) + 1;
}
ok(byDim.aether === 11, `天域 11 章 (${byDim.aether})`);
ok(byDim.nether === 4, `下界 4 章 (${byDim.nether})`);
ok(byDim.overworld === 3, `主世界 3 章 (${byDim.overworld})`);
ok(byDim.end === 2, `末地 2 章（E1 已交付）(${byDim.end})`);

// ── ⑤ 行文纪律（全表兜底）──
for (const [id, ch] of Object.entries(STELE_CHAPTERS)) {
  ok(typeof ch.title === 'string' && ch.title.length > 0, `标题非空: ${id}`);
  ok(Array.isArray(ch.lines) && ch.lines.length >= 1 && ch.lines.length <= 6, `行数 1-6: ${id}`);
  ok(ch.lines.every((l) => typeof l === 'string' && l.length > 0), `行文非空: ${id}`);
  ok(!id.includes(','), `章节 id 不含 ',': ${id}`);
}
finish('overworld-steles');
