// end-steles.mjs -- 末地·无潮彼岸基石（世界观批次 E1）内容回归（node 直跑，无需服务器）
// 断言：
//   ① 界纹石碑方块注册完备：displayName / 不可破坏 / stele 家族标记 / SVG 键 / 追加纪律（id > moss_stele）
//   ② 彼岸碑文 2 章：dim='end'；全章 dim 计数 天域9/下界4/主世界3/末地2
//   ③ 潜影盒 / 鞘翅 / 紫颂 lore（拾遗者体系重释，§3.4）
//   ④ 龙刻意留白：末地碑文不直写龙（碑文不写满）
//   ⑤ 行文纪律（全表兜底）
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { STELE_CHAPTERS } from '../src/world/steles.js';
import { ok, finish } from './harness.mjs';

// ── ① 界纹石碑 ──
const stele = BlockRegistry.getByName('end_stele');
ok(!!stele, '方块注册: end_stele');
ok(stele.displayName === '界纹石碑', `displayName: end_stele (${stele.displayName})`);
ok(stele.hardness === -1, 'end_stele 不可破坏（-1，石碑家族同档）');
ok(stele.stele === true, 'end_stele 挂石碑家族标记（右键阅读走 targetDef.stele）');
ok(BlockSVGDefinitions.end_stele !== undefined, 'SVG 纹理键在场: end_stele');
ok(stele.id > BlockRegistry.getId('moss_stele'), '追加纪律: end_stele id > moss_stele（append-only）');
ok(getItemCategory('end_stele') === 'functional', '创造分类 functional（end_stele）');

// ── ② 彼岸碑文 2 章 ──
const END_IDS = ['end_gleaner', 'end_watch'];
const END_TITLES = { end_gleaner: '拾遗', end_watch: '守望' };
for (const id of END_IDS) {
  const ch = STELE_CHAPTERS[id];
  ok(!!ch, `彼岸碑文章节在场: ${id}`);
  ok(ch.dim === 'end', `章节 dim=end: ${id} (${ch.dim})`);
  ok(ch.title === END_TITLES[id], `章节标题: ${id} (${ch.title})`);
}
const byDim = {};
for (const [id, ch] of Object.entries(STELE_CHAPTERS)) {
  byDim[ch.dim] = (byDim[ch.dim] || 0) + 1;
}
ok(byDim.aether === 11, `天域 11 章 (${byDim.aether})`);
ok(byDim.nether === 4, `下界 4 章 (${byDim.nether})`);
ok(byDim.overworld === 3, `主世界 3 章 (${byDim.overworld})`);
ok(byDim.end === 2, `末地 2 章 (${byDim.end})`);

// ── ③ 潜影盒 / 鞘翅 / 紫颂 lore ──
const elytra = ItemRegistry.getByName('elytra');
ok(!!elytra, '物品注册: elytra');
ok(Array.isArray(elytra.lore) && elytra.lore.length === 2, '鞘翅 lore 2 行');
ok(elytra.lore.some((l) => l.includes('拾遗者')), '鞘翅 lore 扣膜翼来历（拾遗者滑过界壁）');
const chorus = ItemRegistry.getByName('chorus_fruit');
ok(!!chorus, '物品注册: chorus_fruit');
ok(Array.isArray(chorus.lore) && chorus.lore.length === 2, '紫颂果 lore 2 行');
ok(chorus.lore.some((l) => l.includes('种子')), '紫颂果 lore 扣彼岸种子');
ok(chorus.food === 4, '紫颂果 food 数值未被 lore 破坏（4）');
const shulker = BlockRegistry.getByName('shulker_box');
ok(!!shulker, '方块注册: shulker_box');
ok(Array.isArray(shulker.lore) && shulker.lore.length === 2, '潜影盒方块 lore 2 行');
ok(shulker.lore.some((l) => l.includes('行囊')), '潜影盒 lore 扣拾遗者行囊（仅 lore，机制不动）');
ok(shulker.hardness === 2, '潜影盒 hardness 未被 lore 破坏（2）');

// ── ④ 龙刻意留白 ──
const endText = JSON.stringify([STELE_CHAPTERS.end_gleaner, STELE_CHAPTERS.end_watch]);
ok(!endText.includes('龙'), '末地碑文不直写龙（§3.4 碑文不写满）');
ok(!endText.includes('末影龙'), '末地碑文不写末影龙全名（留白纪律）');

// ── ⑤ 行文纪律（全表兜底）──
const VALID_DIMS = ['aether', 'nether', 'overworld', 'end'];
for (const [id, ch] of Object.entries(STELE_CHAPTERS)) {
  ok(typeof ch.title === 'string' && ch.title.length > 0, `标题非空: ${id}`);
  ok(Array.isArray(ch.lines) && ch.lines.length >= 1 && ch.lines.length <= 6, `行数 1-6: ${id}`);
  ok(ch.lines.every((l) => typeof l === 'string' && l.length > 0), `行文非空: ${id}`);
  ok(!id.includes(','), `章节 id 不含 ',': ${id}`);
  ok(VALID_DIMS.includes(ch.dim), `dim 字段合法: ${id} (${ch.dim})`);
}
finish('end-steles');
