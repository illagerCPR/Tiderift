// extra-matrix.mjs -- Build 56 R3 四组合世界规则矩阵（纯 node，不依赖服务器）
// 「四组合」= 双关 / 仅工业 / 仅魔法 / 双开。对每一种都跑同一套矩阵：
//   ① 创建：World 的清单、生成器同源、序列化往返
//   ② 读取：normalizeSaveData 保留清单；未知 schema 直接拒绝（不静默降级）
//   ③ 导入导出：sanitizeSaveData 保留清单（导入端以存档为准，不被本地草稿改写）
//   ④ 可见性：方块/物品/配方逐项该在就在、该不在就不在（联动方块只在双开）
//   ⑤ 门控：工业 tick / 魔法施法 / 联动机器 / 风压超载 的开关组合真值表
//   ⑥ 换维：serializeExtraContent 透传后重建的世界仍是同一套规则
//   ⑦ 无串扰：连续创建四种世界互不影响（没有"上一个世界的规则"泄漏）
import { readFileSync } from 'fs';
import { World } from '../src/core/World.js';
import {
  normalizeExtraContent, serializeExtraContent, extrasEqual, enabledExtras,
  isContentEnabled, extraContentCode, NONE_EXTRA_CONTENT,
} from '../src/content/ExtraContent.js';
import { normalizeSaveData } from '../src/core/SaveSystem.js';
import { sanitizeSaveData, SAVE_IMPORT_ERROR_KEYS } from '../src/core/SaveTransfer.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { getAllRecipes, recipeEnabled } from '../src/core/Crafting.js';
import { processorEnabledFor, PRESS_BLOCK, BOILER_BLOCK, CRUSHER_BLOCK, GAUGE_BLOCK } from '../src/content/industry/defs.js';
import { checkOverload } from '../src/core/Magic.js';
import { TABLE_BLOCK, ECHO_SHARD_ITEM, ALL_SPELLS, OVERLOAD_SPELL_ID } from '../src/content/magic/defs.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');

// 四组合（顺序即矩阵顺序）
const COMBOS = [
  { name: '双关', raw: null, industry: false, magic: false },
  { name: '仅工业', raw: { schema: 1, industry: true }, industry: true, magic: false },
  { name: '仅魔法', raw: { schema: 1, magic: true }, industry: false, magic: true },
  { name: '双开', raw: { schema: 1, industry: true, magic: true }, industry: true, magic: true },
];
for (const c of COMBOS) c.manifest = normalizeExtraContent(c.raw);
const both = COMBOS[3].manifest;

// ── ① 创建 + ② 读取 + ③ 导入导出 ────────────────────────────────────────
for (const c of COMBOS) {
  const tag = `[${c.name}]`;
  const world = new World(20260101, 'overworld', { extraContent: c.raw });
  ok(world.extraContent.industry === c.industry, `${tag} 创建：工业开关按清单落定`);
  ok(world.extraContent.magic === c.magic, `${tag} 创建：魔法开关按清单落定`);
  ok(world.generator.extraContent === world.extraContent, `${tag} 创建：生成器拿的是同一份清单（结构/地形同源）`);
  ok(world.overloads instanceof Map && world.overloads.size === 0, `${tag} 创建：过载账本从空开始`);
  ok(enabledExtras(world.extraContent).join() === enabledExtras(c.manifest).join(),
    `${tag} 创建：启用列表一致（${extraContentCode(c.manifest) || '无'}）`);

  // 序列化往返（存档 / 换维 / 房间快照共用）
  const wire = serializeExtraContent(world.extraContent);
  ok(wire.schema === 1 && wire.industry === c.industry && wire.magic === c.magic, `${tag} 序列化形状正确`);
  ok(extrasEqual(wire, c.manifest), `${tag} 序列化后可还原`);

  // 读取
  const loaded = normalizeSaveData({ version: 2, seed: 7, extraContent: wire });
  ok(!!loaded && extrasEqual(loaded.extraContent, c.manifest), `${tag} 读取：清单随存档保留`);
  ok(normalizeSaveData({ version: 2, seed: 7, extraContent: { schema: 99 } }) === null,
    `${tag} 读取：未知 schema 直接拒绝（不静默降级成双关）`);
  ok(extrasEqual(normalizeSaveData({ version: 2, seed: 7 }).extraContent, NONE_EXTRA_CONTENT),
    `${tag} 读取：旧档缺字段回落双关`);

  // 导入导出
  const imported = sanitizeSaveData({ version: 2, seed: 9, extraContent: wire, player: {} }).data;
  ok(extrasEqual(imported.extraContent, c.manifest), `${tag} 导入：清单原样保留（以存档为准）`);
  ok(!!SAVE_IMPORT_ERROR_KEYS['bad-extra-content'], `${tag} 导入：未知清单有明确失败文案`);
  // 导入后的世界仍按存档清单跑（这里用 World 模拟 loadData 分支）
  const loadedWorld = new World(9, 'overworld', { extraContent: imported.extraContent });
  ok(loadedWorld.extraContent.industry === c.industry && loadedWorld.extraContent.magic === c.magic,
    `${tag} 导入后重建世界：规则不变`);
}

// ── ④ 可见性矩阵：方块 / 物品 / 配方 ─────────────────────────────────────
for (const c of COMBOS) {
  const tag = `[${c.name}]`;
  const has = (def) => isContentEnabled(def, c.manifest);
  ok(has(BlockRegistry.getByName(BOILER_BLOCK)) === c.industry, `${tag} 方块：潮压锅炉 ${c.industry ? '可见' : '不可见'}`);
  ok(has(BlockRegistry.getByName(TABLE_BLOCK)) === c.magic, `${tag} 方块：回响仪台 ${c.magic ? '可见' : '不可见'}`);
  ok(has(BlockRegistry.getByName(PRESS_BLOCK)) === (c.industry && c.magic),
    `${tag} 方块：刻纹压印机只在双开可见`);
  ok(has(ItemRegistry.getByName(ECHO_SHARD_ITEM)) === c.magic, `${tag} 物品：回响残片随魔法`);
  ok(has(ItemRegistry.getByName('gale_cross_focus')) === c.magic, `${tag} 物品：风渡焦点随魔法`);

  const pressRecipe = getAllRecipes().find((r) => r.output === PRESS_BLOCK);
  ok(!!pressRecipe && recipeEnabled(pressRecipe, c.manifest) === (c.industry && c.magic),
    `${tag} 配方：压印机本体只在双开出配方`);
  const inscribe = getAllRecipes().find((r) => r.output === 'gale_cross_focus');
  ok(!!inscribe && recipeEnabled(inscribe, c.manifest) === c.magic, `${tag} 配方：纹样加工随魔法`);
  const shaftRecipe = getAllRecipes().find((r) => r.output === 'drive_shaft');
  ok(!!shaftRecipe && recipeEnabled(shaftRecipe, c.manifest) === c.industry, `${tag} 配方：传动轴随工业`);
  const cutRecipe = getAllRecipes().find((r) => r.requiresExtras && r.requiresExtras.includes('industry') && r.output === 'filter_hopper');
  ok(!!cutRecipe && recipeEnabled(cutRecipe, c.manifest) === c.industry, `${tag} 配方：分拣漏斗随工业`);
}

// ── ⑤ 门控真值表 ────────────────────────────────────────────────────────
for (const c of COMBOS) {
  const tag = `[${c.name}]`;
  ok(processorEnabledFor('press', c.manifest) === (c.industry && c.magic),
    `${tag} 联动机器：刻纹压印机 ${(c.industry && c.magic) ? '能跑' : '不跑'}`);
  ok(processorEnabledFor('crusher', c.manifest) === c.industry, `${tag} 工业：碎石机只认工业开关`);
  ok(processorEnabledFor('gauge', c.manifest) === c.industry, `${tag} 工业：潮压表只认工业开关`);
  const gate = checkOverload({
    dualEnabled: c.industry && c.magic, kind: 'crusher', dist: 2,
  });
  ok(gate.ok === (c.industry && c.magic),
    `${tag} 风压超载：${gate.ok ? '可施放' : `拒绝（${gate.code}）`}`);
  ok(!!ALL_SPELLS[OVERLOAD_SPELL_ID] && ALL_SPELLS[OVERLOAD_SPELL_ID].requiresExtras.join() === 'industry,magic',
    `${tag} 法术表：联动法术恒注册（开关只决定能不能用）`);
  // 注册永远全量：方块数量与清单无关
  ok(BlockRegistry.getByName(PRESS_BLOCK).id === 239,
    `${tag} 注册：联动方块 id 与清单无关（注册全量、开关只决定启用）`);
}

// ── ⑥ 换维：清单透传后重建的世界仍是同一套规则 ──────────────────────────
for (const c of COMBOS) {
  const tag = `[${c.name}]`;
  const wire = serializeExtraContent(c.manifest);
  const rebuilt = new World(555, 'nether', { extraContent: wire });
  ok(rebuilt.dimension === 'nether', `${tag} 换维：新维度建立成功`);
  ok(extrasEqual(rebuilt.extraContent, c.manifest), `${tag} 换维：规则随 loadData 顶层字段透传`);
  ok(rebuilt.generator.extraContent === rebuilt.extraContent, `${tag} 换维：新生成器同样拿同一份清单`);
  // 换维时过载账本必须清空（临时增益不跨维）
  const ledger = rebuilt.overloads;
  ledger.set('1,2,3', { left: 10, rate: 1.5 });
  rebuilt.loadDimensionBuckets({}, {});
  ok(rebuilt.overloads.size === 0, `${tag} 换维：过载账本清空（临时增益不跨维、不跨存档）`);
}

// ── ⑦ 无串扰：连续创建互不影响 ──────────────────────────────────────────
{
  const seen = [];
  for (const c of COMBOS) {
    const w = new World(4242, 'overworld', { extraContent: c.raw });
    seen.push([w.extraContent.industry, w.extraContent.magic]);
  }
  ok(JSON.stringify(seen) === JSON.stringify([[false, false], [true, false], [false, true], [true, true]]),
    '连续创建四种世界：规则互不串（没有"上一个世界的清单"泄漏）');
  // 全关世界与首次创建的全关世界逐字段一致
  ok(extrasEqual(normalizeExtraContent(null), COMBOS[0].manifest), '双关清单是同一个冻结对象语义');
}

// ── ⑧ 接线：三条入口都读世界清单（不在别处另写一份规则）───────────────────
{
  const game = src('../src/player/Game.js');
  ok(/resolveExtraContent\(loadData\.extraContent, '存档'\)/.test(game), '单机读档：以存档清单为准');
  ok(/resolveExtraContent\(startOpts\.extraContent, networkMode \? '房间' : '新建'\)/.test(game),
    '新建/联机：以入口清单为准');
  ok(/extraContent: serializeExtraContent\(this\.world\.extraContent\)/.test(game),
    '换维：清单随 loadData 顶层透传');
  const sys = src('../src/player/IndustrySystem.js');
  ok(/world\.extraContent\.industry !== true/.test(sys), '工业 tick 外层闸只看工业开关');
  ok(/processorEnabledFor|tickIndustry\(world\.industryBlocks, world\.industry, step, nets, world\.extraContent/.test(sys),
    '联动机器另有逐台门控（清单传进纯算法）');
  const magic = src('../src/player/MagicSystem.js');
  ok(/get enabled\(\)[\s\S]{0,140}extraContent\.magic === true/.test(magic), '魔法能力只看魔法开关');
  ok(/_dualEnabled\(\)[\s\S]{0,200}industry === true && w\.extraContent\.magic === true/.test(magic),
    '联动法术要求两个开关同时开');
}

finish('extra-matrix');
