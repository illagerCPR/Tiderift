// aether-content.mjs -- 天域叙事基石（批次 A）内容回归（node 直跑，无需服务器）
// 断言：
//   ① 方块注册完备：6 新方块 + displayName + SVG 纹理键在场 + 关键 def 字段
//   ② 物品注册完备：10 新物品 + displayName + 战斗/护甲字段 + lore
//   ③ 创造分类：新内容均有登记分类（misc 为有意兜底）
//   ④ 碑文章节表：9 章 + 无字碑，标题/行文完备
//   ⑤ StructureManager 石碑注册表：键格式一致 + 未注册返回 null
//   ⑥ 追加纪律：新方块 id 恒大于既有尾部方块（beacon）——防中途插入导致存档 id 错位
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../src/items/ItemDefs.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { STELE_CHAPTERS, STELE_BLANK } from '../src/world/steles.js';
import { StructureManager } from '../src/world/structures/StructureManager.js';
import { setAetherDuskProfile, DIMENSIONS } from '../src/core/dimensions.js';
import { ok, finish } from './harness.mjs';

// ── ① 方块 ──
const BLOCKS = {
  star_marrow_ore: { displayName: '星髓矿石', tool: 'pickaxe', minTier: 2, light: 0 },
  star_marrow_block: { displayName: '星髓块', light: 13 },
  cloud_wool: { displayName: '云绒块', light: 0 },
  wind_stele: { displayName: '风纹石碑', hardness: -1 },
  aether_altar: { displayName: '恒昼祭坛', light: 13, hardness: -1 },
  wind_current: { displayName: '气流', solid: false, transparent: true },
  gale_block: { displayName: '风阵块', light: 0 },
  tide_altar: { displayName: '潮心祭坛', light: 13, hardness: -1 },
};
for (const [name, want] of Object.entries(BLOCKS)) {
  const b = BlockRegistry.getByName(name);
  ok(!!b, `方块注册: ${name}`);
  ok(b.displayName === want.displayName, `displayName: ${name} (${b.displayName})`);
  ok(BlockSVGDefinitions[name] !== undefined, `SVG 纹理键在场: ${name}`);
  for (const [k, v] of Object.entries(want)) {
    if (k === 'displayName') continue;
    ok(b[k] === v, `def.${k}: ${name} (${b[k]} != ${v})`);
  }
}
ok(BlockRegistry.getByName('cloud_wool').solid === true, 'cloud_wool solid');
ok(BlockRegistry.getByName('wind_current').hardness === 0.3, 'wind_current 可破坏（0.3）');
ok(BlockRegistry.getByName('wind_current').renderType === 'cross', 'wind_current cross 渲染（solid 材质 alphaTest 纪律）');
ok(BlockRegistry.getByName('wind_current').updraft === true, 'wind_current updraft 标记（Game._updateUpdraftState 消费）');
ok(BlockRegistry.getByName('star_marrow_ore').hardness === 3, 'star_marrow_ore hardness 3');
ok(BlockRegistry.getByName('gale_block').updraft === false, 'gale_block 本体非气流（发射器只写柱）');

// ── ② 物品 ──
const ITEMS = {
  cloud_fluff: { displayName: '云絮', stack: 64 },
  star_marrow: { displayName: '星髓', stack: 64 },
  page_rising: { displayName: '潮汐残页·涨潮', lore: 2 },
  page_marrow: { displayName: '潮汐残页·星髓', lore: 2 },
  page_sunder: { displayName: '潮汐残页·裂潮', lore: 2 },
  storm_totem: { displayName: '风暴图腾', stack: 1, lore: 2 },
  storm_core: { displayName: '风暴之核', lore: 1 },
  heart_shard: { displayName: '心核碎片', lore: 1 },
  wind_brand: { displayName: '缚风之剑', damage: 7, tool: 'sword' },
  gale_cloak: { displayName: '御风斗篷', armorSlot: 'chest', armorPoints: 3 },
};
for (const [name, want] of Object.entries(ITEMS)) {
  const it = ItemRegistry.getByName(name);
  ok(!!it, `物品注册: ${name}`);
  ok(it.displayName === want.displayName, `displayName: ${name} (${it.displayName})`);
  ok(ItemSVGDefinitions[name] !== undefined, `SVG 在场: ${name}`);
  for (const [k, v] of Object.entries(want)) {
    if (k === 'displayName') continue;
    if (k === 'lore') ok(Array.isArray(it.lore) && it.lore.length === v, `lore 行数: ${name}`);
    else ok(it[k] === v, `def.${k}: ${name} (${it[k]} != ${v})`);
  }
}

// ── ③ 创造分类 ──
const WANT_CAT = {
  star_marrow_ore: 'nature', star_marrow_block: 'building', cloud_wool: 'building',
  wind_stele: 'functional', aether_altar: 'functional', wind_current: 'functional', gale_block: 'functional',
  cloud_fluff: 'materials', star_marrow: 'materials', storm_core: 'materials',
  page_rising: 'misc', page_marrow: 'misc', page_sunder: 'misc',
  storm_totem: 'misc', heart_shard: 'misc', wind_brand: 'tools', gale_cloak: 'tools',
};
for (const [name, cat] of Object.entries(WANT_CAT)) {
  ok(getItemCategory(name) === cat, `分类: ${name} → ${cat} (got ${getItemCategory(name)})`);
}

// ── ④ 碑文章节表（世界观批次 N1 起表为跨维度共享：本测试只锁天域碑文章的相对顺序）──
const EXPECT_CHAPTERS = ['prologue', 'tide', 'voyage', 'marrow', 'gate', 'delving', 'sundering', 'command', 'renewal'];
const allIds = Object.keys(STELE_CHAPTERS);
ok(JSON.stringify(allIds.slice(0, EXPECT_CHAPTERS.length)) === JSON.stringify(EXPECT_CHAPTERS),
  `天域章节前缀顺序不变 (${allIds.slice(0, EXPECT_CHAPTERS.length).join(',')})`);
for (const id of allIds) {
  ok(['aether', 'nether', 'overworld', 'end'].includes(STELE_CHAPTERS[id].dim),
    `章节 dim 值域（四维度合法值）: ${id}`);
}
for (const [id, ch] of Object.entries(STELE_CHAPTERS)) {
  ok(typeof ch.title === 'string' && ch.title.length > 1, `章节标题: ${id}`);
  ok(Array.isArray(ch.lines) && ch.lines.length >= 3, `章节行文 ≥3 行: ${id}`);
  for (const l of ch.lines) ok(typeof l === 'string' && l.length > 4, `行文非空: ${id}`);
}
ok(!!STELE_BLANK.title && STELE_BLANK.lines.length === 1, '无字碑回落内容');

// ── ⑤ StructureManager 石碑注册表 ──
const fakeGen = { dimensionId: 'aether' };
const sm = new StructureManager(fakeGen, 42);
ok(sm.steles instanceof Map && sm.steles.size === 0, 'steles 注册表初始化为空');
ok(sm.steleChapterAt(1, 2, 3) === null, '未注册石碑返回 null');
sm.steles.set('1,2,3', 'prologue');
ok(sm.steleChapterAt(1, 2, 3) === 'prologue', '键格式 "x,y,z" 一致');

// ── ⑥ 追加纪律（防存档 id 错位）──
const beaconId = BlockRegistry.getId('beacon');
for (const name of [...Object.keys(BLOCKS)]) {
  ok(BlockRegistry.getId(name) > beaconId, `id 追加纪律: ${name} (${BlockRegistry.getId(name)}) > beacon (${beaconId})`);
}

// ── ⑦ 复潮档案切换（批次 D，§5.4 不变量 1/2/3）──
{
  setAetherDuskProfile(true);
  const d = DIMENSIONS.aether;
  ok(d.sky.fixedColor === null, '复潮：fixedColor 置 null（昼夜锚点生效）');
  ok(d.sky.polarDay === false, '复潮：polarDay 关闭（太阳正常升落）');
  ok(d.light.skyLightLevel === null, '复潮：skyLightLevel 置 null（体素光跟随昼夜）');
  setAetherDuskProfile(false);
  ok(Array.isArray(d.sky.fixedColor) && d.sky.polarDay === true && d.light.skyLightLevel === 1.0,
    '回滚：档案一键还原永昼');
}

// ── ⑧ 生物名 i18n 全员覆盖（Build 19 K2：堵命令面板怪物下拉的翻译盲区）──
const { MobTypes } = await import('../src/entity/MobTextures.js');
const { NAME_I18N } = await import('../src/i18n/names.js');
const missingNames = Object.keys(MobTypes).filter((k) => !Array.isArray(NAME_I18N[k]) || NAME_I18N[k].length !== 11);
ok(missingNames.length === 0, `MobTypes 全员 names.js 11 列覆盖（缺: ${missingNames.join(',') || '无'}）`);
ok(NAME_I18N.cloud_lamb && NAME_I18N.gale_hawk && NAME_I18N.tide_echo, 'K2 补全三行: cloud_lamb/gale_hawk/tide_echo');
finish('aether-content');
