// endgame-content.mjs -- 终局篇 F1「候潮基石」内容回归（node 直跑，无需服务器）
// 断言：
//   ① 原初祭坛方块注册完备：displayName / 不可破坏 / 光照 / SVG 键 / 追加纪律（id > tide_altar）/ 分类
//   ② 原初纹章物品注册：唯一信物 stack=1 / 终章 lore 3 行 / 不可合成（仪式发放）
//   ③ 龙蛋 lore 补段（§4 方案二「王所守之物」）：仅 lore，机制不动；留白纪律——不解释王在等什么
//   ④ names.js 十一语 2 行
//   ⑤ i18n 8 盲区键 ×10 包（纹章 lore / 龙蛋 lore / 候潮章，i18n-parity 动态收集兜底）
//   ⑥ 接线绊线：献证分支 / finalePrimordial 三处持久化 / 复潮章回落（不变量 6）/ BUILD 不 bump
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { getAllRecipes } from '../src/core/Crafting.js';
import { STELE_CHAPTERS } from '../src/world/steles.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { BUILD } from '../src/version.js';
import { readFileSync } from 'fs';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}

// ── ① 原初祭坛 ──
const altar = BlockRegistry.getByName('primordial_altar');
ok(!!altar, '方块注册: primordial_altar');
ok(altar.displayName === '原初祭坛', `displayName: primordial_altar (${altar.displayName})`);
ok(altar.hardness === -1, 'primordial_altar 不可破坏（-1，潮心祭坛同档）');
ok(altar.light === 13, 'primordial_altar light 13（潮心祭坛同档，兼任照明）');
ok(BlockSVGDefinitions.primordial_altar !== undefined, 'SVG 纹理键在场: primordial_altar');
ok(altar.id > BlockRegistry.getId('tide_altar'), '追加纪律: primordial_altar id > tide_altar（append-only）');
ok(getItemCategory('primordial_altar') === 'functional', '创造分类 functional（primordial_altar）');

// ── ② 原初纹章 ──
const emblem = ItemRegistry.getByName('primordial_emblem');
ok(!!emblem, '物品注册: primordial_emblem');
ok(emblem.displayName === '原初纹章', `displayName: primordial_emblem (${emblem.displayName})`);
ok(emblem.stack === 1, '原初纹章唯一信物（stack=1）');
ok(Array.isArray(emblem.lore) && emblem.lore.length === 3, '终章 lore 3 行（评审结论 3：纹章 lore 承载终章）');
ok(emblem.lore.some((l) => l.includes('一整片海')), '终章收束句在场（世界记起了自己曾经是一整片海）');
ok(emblem.lore.some((l) => l.includes('原初之潮')), '终章点题句在场（原初之潮的响法）');
ok(!getAllRecipes().some((r) => r.output === 'primordial_emblem'), '原初纹章不可合成（仪式发放，F3）');
ok(getItemCategory('primordial_emblem') === 'misc', '创造分类 misc（primordial_emblem，信物非材料）');

// ── ③ 龙蛋 lore（王所守之物）──
const egg = BlockRegistry.getByName('dragon_egg');
ok(!!egg, '方块注册: dragon_egg');
ok(Array.isArray(egg.lore) && egg.lore.length === 2, '龙蛋 lore 2 行（仅 lore，机制零改动）');
ok(egg.lore.some((l) => l.includes('衔来')), '龙蛋 lore 扣「王从滩涂尽头衔来」');
ok(egg.lore.some((l) => l.includes('潮的出生地')), '龙蛋 lore 扣守在潮的出生地');
const eggText = JSON.stringify(egg.lore);
ok(!eggText.includes('等什么'), '龙蛋 lore 不解释王在等什么（留白纪律）');
ok(!eggText.includes('回答') && !eggText.includes('答案'), '龙蛋 lore 不给答案（只给守的动作）');
ok(egg.hardness === 3 && egg.tool === 'pickaxe', '龙蛋挖掘机制未被 lore 破坏（hardness 3 / pickaxe）');

// ── ④ names.js 十一语 ──
for (const name of ['primordial_altar', 'primordial_emblem']) {
  const row = NAME_I18N[name];
  ok(Array.isArray(row) && row.length === 11, `names.js 11 列: ${name} (${row ? row.length : 'missing'})`);
  ok(row && row[0] === (name === 'primordial_altar' ? '原初祭坛' : '原初纹章'), `names.js 首列简体: ${name}`);
}

// ── ⑤ i18n 盲区键 ×10 包 ──
const LORE_KEYS = [
  '「风潮、坠潮、雨潮——三枚旧心跳在掌心合成了一声。」',
  '「无潮的岸边，你听见了它：海还没有名字的时候，原初之潮就是这样响的。」',
  '「潮不会回来。但世界记起了自己曾经是一整片海。」',
  '王从滩涂尽头衔来的、涨潮之前的东西。',
  '它一直被守在潮的出生地——守着它的人，从不去解释为什么。',
  '候潮',
  '祭坛饮下了三枚旧心跳。原初之潮在极远处翻了身。',
  '无潮的岸边听不见的话，在这里听见了——海还没有忘。',
  '现在，去潮的出生地。滩涂尽头有一块碑，碑上的字断在最后一刻——去把它听完。',
];
const PACKS = ['zh-TW', 'en', 'fr', 'de', 'ja', 'ko', 'ar', 'ru', 'es', 'pt'];
for (const pack of PACKS) {
  const src = readFileSync(`./src/i18n/locales/${pack}.js`, 'utf8');
  for (const key of LORE_KEYS) {
    ok(src.includes(JSON.stringify(key)), `盲区键 ×${pack}: ${key.slice(0, 12)}…`);
  }
}

// ── ⑥ 接线绊线 ──
const gameSrc = readFileSync('./src/player/Game.js', 'utf8');
ok(gameSrc.includes('_tryPrimordialOffering(block) {'), '献证方法定义在场（_tryPrimordialOffering）');
ok(gameSrc.includes("this._tryPrimordialOffering(hit.block)"), '潮心祭坛右键走献证分支');
ok(gameSrc.includes("BlockRegistry.getId('primordial_altar')"), '献证置换原初祭坛（setBlock 进账本）');
ok(gameSrc.includes('this.world.finalePrimordial = { x: block.x, y: block.y, z: block.z }'), '候潮状态位记祭坛坐标');
ok(gameSrc.includes("(loadData && loadData.finalePrimordial) || null"), '存档恢复 finalePrimordial');
ok(gameSrc.includes('finalePrimordial: this.world.finalePrimordial || null, // 候潮状态跨维透传'), '换维透传 finalePrimordial');
ok(gameSrc.includes("this.steleScreen.open(block.x, block.y, block.z, 'renewal')"), '未集齐回落复潮章（不变量 6：复潮行为不回退）');
const saveSrc = readFileSync('./src/core/SaveSystem.js', 'utf8');
ok(saveSrc.includes('finalePrimordial: game.world.finalePrimordial || null'), 'SaveSystem 序列化 finalePrimordial');
ok(gameSrc.includes("this.steleScreen.open(block.x, block.y, block.z, 'tide_waiting')"), '献证成功浮现候潮章（复潮碑文浮现同款交互）');
ok(gameSrc.includes("targetDef.name === 'primordial_altar'"), 'K2：原初祭坛右键分支在场');
ok(gameSrc.includes("this.steleScreen.open(hit.block.x, hit.block.y, hit.block.z, 'tide_waiting');"), 'K2：右键原初祭坛复读候潮章');
ok(gameSrc.includes("this.steleScreen.open(block.x, block.y, block.z, 'renewal')"), '未集齐/已候潮回落复潮章（不变量 6：复潮行为不回退）');
const waiting = STELE_CHAPTERS.tide_waiting;
ok(!!waiting && waiting.dim === 'aether' && waiting.title === '候潮', '候潮章注册（aether/候潮）');
ok(waiting.lines.length === 3, '候潮章 3 行（状态章克制）');
const waitText = JSON.stringify(waiting);
ok(!waitText.includes('龙') && !waitText.includes('一整片海'), '候潮章不写龙、不写终章内容（终章走纹章 lore，不变量 7）');
ok(waitText.includes('潮的出生地'), '候潮章承载去向引导（去潮的出生地听完断句）');
ok(BUILD === 29, `BUILD 24（Build 23 主菜单与皮肤面板批次统一 bump）`);
ok(emblem.lore.every((l) => l.length > 0) && egg.lore.every((l) => l.length > 0), 'lore 行文非空（行文纪律兜底）');

console.log(`endgame-content: ${passed} assertions passed`);
