// extra-content-unit.mjs -- Build 51 额外内容基石回归（纯 node，不依赖服务器）
// 断言：
//   ① 清单规范化：旧形态回落双关、严格 boolean、未知 schema 拒绝（返回 null）、结果冻结；
//   ② 相等 / 序列化 / 启用列表口径；
//   ③ 归属元数据：requiresExtras 清洗、未知 ID fail-closed、双模块需求需两者齐备；
//   ④ 注册表只附加归属不增删定义（现存定义的元数据字段存在且为 null）；
//   ⑤ 配方闸口：带归属的合成/烧炼在双关世界不出现、启用后出现；
//   ⑥ 结构闸口：带归属的结构类型在双关世界求解不到、启用后可求解（与维度过滤同一中心点）；
//   ⑦ World 把清单写入生成器（StructureManager 与 Worker 同源）；
//   ⑧ 源码绊线：创造栏 / 配方查询真的接了归属过滤（不是只隐藏页签）；
//   ⑨ 无全局串状态：两个不同清单的生成器互不影响。
import { readFileSync } from 'fs';
import {
  EXTRA_CONTENT_SCHEMA, EXTRA_IDS, NONE_EXTRA_CONTENT,
  normalizeExtraContent, serializeExtraContent, extrasEqual, enabledExtras,
  isExtraEnabled, normalizeRequires, requiresSatisfied, isContentEnabled,
  filterEnabled, extraContentCode,
} from '../src/content/ExtraContent.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { getAllRecipes, recipeEnabled, matchRecipe } from '../src/core/Crafting.js';
import { addSmelting, getAllSmeltingRecipes } from '../src/core/Smelting.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { Chunk } from '../src/core/Chunk.js';
import { registerStructureType } from '../src/world/structures/StructureManager.js';
import { World } from '../src/core/World.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const ALL = normalizeExtraContent({ schema: 1, industry: true, magic: true });
const INDUSTRY = normalizeExtraContent({ schema: 1, industry: true, magic: false });
const MAGIC = normalizeExtraContent({ schema: 1, industry: false, magic: true });

// ── ① 规范化 ────────────────────────────────────────────────────────────────
{
  ok(EXTRA_CONTENT_SCHEMA === 1, '清单 schema 常量为 1');
  ok(Array.isArray(EXTRA_IDS) && EXTRA_IDS.length === 2 &&
    EXTRA_IDS[0] === 'industry' && EXTRA_IDS[1] === 'magic', '内容 ID 表 = industry/magic');
  ok(normalizeExtraContent(undefined) === NONE_EXTRA_CONTENT, '缺字段 → 双关（共享冻结实例）');
  ok(normalizeExtraContent(null) === NONE_EXTRA_CONTENT, 'null → 双关');
  ok(normalizeExtraContent({}) === NONE_EXTRA_CONTENT, '空对象 → 双关');
  ok(Object.isFrozen(NONE_EXTRA_CONTENT), '双关清单冻结（不可被就地改写）');
  {
    const m = normalizeExtraContent({ industry: true });
    ok(m.industry === true && m.magic === false, '缺 schema 的旧形态按 schema 1 读取');
    ok(m.schema === EXTRA_CONTENT_SCHEMA, '旧形态补全 schema=1');
    ok(Object.isFrozen(m), '规范化结果冻结');
  }
  {
    const m = normalizeExtraContent({ schema: 1, industry: 1, magic: 'true' });
    ok(m === NONE_EXTRA_CONTENT, '非严格 boolean 不启用（1 / "true" 均视为关）');
  }
  ok(normalizeExtraContent({ schema: 2, industry: true }) === null, '更新的 schema → null（调用方须拒绝）');
  ok(normalizeExtraContent({ schema: 0 }) === null, '未知 schema → null');
  ok(normalizeExtraContent('industry') === null, '非对象形态 → null（不静默降级）');
  ok(normalizeExtraContent([1, 2]) === null, '数组形态 → null');
}

// ── ② 相等 / 序列化 / 启用列表 ──────────────────────────────────────────────
{
  ok(extrasEqual({ industry: true }, INDUSTRY), '相等：旧形态与规范化形态等价');
  ok(!extrasEqual(INDUSTRY, MAGIC), '不相等：工业 ≠ 魔法');
  ok(!extrasEqual(INDUSTRY, null), '未知 schema 与已启用不相等（不误判）');
  const s = serializeExtraContent(ALL);
  ok(s.schema === 1 && s.industry === true && s.magic === true, '序列化形状 = {schema,industry,magic}');
  ok(Object.keys(s).length === 3, '序列化只含三个字段');
  ok(enabledExtras(ALL).join(',') === 'industry,magic', '启用列表顺序同 EXTRA_IDS');
  ok(enabledExtras(NONE_EXTRA_CONTENT).length === 0, '双关无启用项');
  ok(isExtraEnabled(INDUSTRY, 'industry') && !isExtraEnabled(INDUSTRY, 'magic'), '单开判定');
  ok(!isExtraEnabled(ALL, 'nether_magic'), '未知内容 ID 恒关');
  ok(extraContentCode(ALL) === 'industry+magic', '记录用简述');
}

// ── ③ 归属元数据 ────────────────────────────────────────────────────────────
{
  ok(normalizeRequires(null) === null && normalizeRequires([]) === null, '无需求 → null');
  ok(normalizeRequires('industry').join() === 'industry', '字符串需求 → 数组');
  ok(normalizeRequires(['industry', 'industry']).length === 1, '需求去重');
  ok(normalizeRequires([' industry ', '']).length === 1, '需求去空白并丢空项');
  ok(requiresSatisfied(null, NONE_EXTRA_CONTENT), '无需求恒满足');
  ok(!requiresSatisfied(['industry'], NONE_EXTRA_CONTENT), '双关世界不满足工业需求');
  ok(requiresSatisfied(['industry'], INDUSTRY), '工业世界满足工业需求');
  ok(!requiresSatisfied(['industry', 'magic'], INDUSTRY), '双模块需求在单开世界不满足');
  ok(requiresSatisfied(['industry', 'magic'], ALL), '双模块需求在双开世界满足');
  ok(!requiresSatisfied(['industry'], null), '未知 schema 清单恒不满足（fail-closed）');
  ok(!requiresSatisfied(['typo_extra'], ALL), '写错的内容 ID 永不满足（不会被意外放行）');
  ok(isContentEnabled({}, MAGIC) && isContentEnabled({}, null),
    '无归属需求的定义不受清单合法性影响（基础内容恒在）');
  ok(!isContentEnabled({ requiresExtras: ['magic'] }, null),
    '带归属需求的定义在非法清单下不启用（fail-closed）');
  ok(filterEnabled([{ name: 'a' }, { name: 'b', requiresExtras: ['magic'] }, null], NONE_EXTRA_CONTENT)
    .map((d) => d.name).join() === 'a', '列表过滤丢掉关闭模块的定义');
  ok(filterEnabled([{ name: 'a' }, { name: 'b', requiresExtras: ['magic'] }], MAGIC).length === 2,
    '启用后列表保留全部定义');
}

// ── ④ 注册表：只附加归属，不按开关增删 ──────────────────────────────────────
{
  const stone = BlockRegistry.getByName('stone');
  const bow = ItemRegistry.getByName('bow');
  ok(stone && Object.prototype.hasOwnProperty.call(stone, 'requiresExtras') && stone.requiresExtras === null,
    '方块定义带 requiresExtras 字段且基础内容为 null');
  ok(bow && Object.prototype.hasOwnProperty.call(bow, 'requiresExtras') && bow.requiresExtras === null,
    '物品定义带 requiresExtras 字段且基础内容为 null');
  ok(BlockRegistry.all().every((b) => b.name === 'air' || isContentEnabled(b, NONE_EXTRA_CONTENT)),
    '全部现存方块在双关世界仍然启用（注册不随开关增删）');
}

// ── ⑤ 配方闸口 ──────────────────────────────────────────────────────────────
{
  // 合成：直接往全局表追加一条带归属的测试配方（不改注册顺序，仅本进程可见）
  const recipes = getAllRecipes();
  // 用一个无人认领的材料名，避免命中既有配方
  const probe = { type: 'shaped', output: '__extra_probe', count: 1, pattern: [['__extra_in']], requiresExtras: normalizeRequires(['industry']) };
  recipes.push(probe);
  ok(recipeEnabled(probe, INDUSTRY) && !recipeEnabled(probe, NONE_EXTRA_CONTENT), '配方启用判定');
  const grid = [['__extra_in']];
  ok(matchRecipe(grid, NONE_EXTRA_CONTENT) === null, '双关世界不命中带归属配方');
  const hit = matchRecipe(grid, INDUSTRY);
  ok(hit && hit.name === '__extra_probe', '工业世界命中带归属配方');

  // 烧炼：addSmelting 是公开注册入口
  addSmelting('__extra_in', '__extra_out', 1, ['magic']);
  const off = getAllSmeltingRecipes(NONE_EXTRA_CONTENT).some((r) => r.output === '__extra_out');
  const on = getAllSmeltingRecipes(MAGIC).some((r) => r.output === '__extra_out');
  ok(!off, '双关世界不列出带归属的烧炼配方');
  ok(on, '魔法世界列出该烧炼配方');
  ok(getAllSmeltingRecipes().some((r) => r.output === 'iron_ingot'),
    '既有烧炼配方不受影响（缺省清单仍列出基础配方）');
}

// ── ⑥ 结构闸口 ──────────────────────────────────────────────────────────────
{
  const SEED = 20251123;
  registerStructureType('test-extra-structure', {
    cell: 16,
    radius: 8,
    chance: 1,
    salt: 4242,
    biomes: null,
    maxSlope: 255,
    requiresExtras: ['magic'],
    // 覆盖选址：绕开群系探针环（本用例只验证归属闸口，不验证选址）
    place: (gen, ax, az) => gen.getBaseHeight(ax, az),
    // 一行方块：让记录的包围盒非退化（树让位/命中查询要靠 bbox）
    solve(rng, ax, groundY, az) {
      return { blocks: [[ax, groundY + 1, az, BlockRegistry.getId('stone')]], meta: {} };
    },
  });
  registerStructureType('test-nether-only', {
    cell: 16,
    radius: 8,
    chance: 1,
    salt: 4243,
    biomes: null,
    maxSlope: 255,
    requiresExtras: [],
    dims: ['nether'],
    place: (gen, ax, az) => gen.getBaseHeight(ax, az),
    solve(rng, ax, groundY, az) {
      return { blocks: [[ax, groundY + 1, az, BlockRegistry.getId('stone')]], meta: {} };
    },
  });

  const genOff = new TerrainGenerator(SEED);
  const genOn = new TerrainGenerator(SEED);
  genOn.extraContent = MAGIC;
  ok(genOff.structureManager.ensureRecord('test-extra-structure', 0, 0) === null,
    '双关世界求解不到带归属的结构');
  const recOn = genOn.structureManager.ensureRecord('test-extra-structure', 0, 0);
  ok(recOn !== null, '魔法世界可求解该结构');
  // 锚点 cell 坐标是区块单位：拿记录的真实锚点换算成查询区块
  const ccx = Math.floor(recOn.ax / 16), ccz = Math.floor(recOn.az / 16);
  ok(genOff.structureManager.footprintsNear(ccx, ccz).every((f) => f.name !== 'test-extra-structure'),
    '双关世界的树让位查询看不到该结构');
  ok(genOn.structureManager.footprintsNear(ccx, ccz).some((f) => f.name === 'test-extra-structure'),
    '启用世界的树让位查询看得到该结构');
  ok(genOn.structureManager.ensureRecord('test-nether-only', 0, 0) === null,
    '维度过滤仍然生效（下界专用结构不在主世界求解）');
  // ⑨ 无全局串状态：两个生成器互不影响
  ok(genOff.structureManager.ensureRecord('test-extra-structure', 0, 0) === null,
    '另一清单的生成器不受影响（无全局当前世界开关）');
}

// ── ⑦ World 把清单写入生成器 ────────────────────────────────────────────────
{
  const w = new World(12345, 'overworld', { biomeScale: 'small', extraContent: { schema: 1, industry: true, magic: false } });
  ok(w.extraContent.industry === true && w.extraContent.magic === false, 'World 保存规范化清单');
  ok(w.generator.extraContent === w.extraContent, '生成器与 World 共用同一份清单（结构闸口同源）');
  const w2 = new World(12345, 'overworld', { biomeScale: 'small' });
  ok(w2.extraContent === NONE_EXTRA_CONTENT, '未声明清单的世界回落双关');
  const w3 = new World(12345, 'overworld', { biomeScale: 'small', extraContent: { schema: 9 } });
  ok(w3.extraContent === NONE_EXTRA_CONTENT, '未知 schema 在 World 侧兜底双关（调用方仍须前置拒绝）');
}

// ── ⑧ 源码绊线：闸口真的接上了 ──────────────────────────────────────────────
{
  const inv = src('../src/ui/InventoryScreen.js');
  const rv = src('../src/ui/RecipeViewer.js');
  const cw = src('../src/core/Crafting.js');
  const sm = src('../src/world/structures/StructureManager.js');
  ok(/isContentEnabled\(b, extras\)/.test(inv), '创造栏按内容归属过滤方块与物品');
  ok(/matchRecipe\(grid2d, extras\)/.test(inv), '合成匹配带上世界清单');
  ok(/isContentEnabled\(b, extras\)/.test(rv), '配方查询列表按归属过滤');
  ok(/recipeEnabled\(r, extras\)/.test(rv), '配方查询详情按归属过滤');
  ok(/recipeEnabled\(r, manifest\)/.test(cw), 'matchRecipe 内部逐条过滤（不是只隐藏界面）');
  ok(/extraMatches\(def, gen\)/.test(sm) && /typeActive\(def, gen\)/.test(sm),
    '结构过滤在维度过滤同一中心点');
  ok(!/dimMatches\(def, this\.generator\)/.test(sm), '结构入口不再绕过归属过滤');
  ok(!/export let .*currentExtra|globalThis\.__extraContent/.test(src('../src/content/ExtraContent.js')),
    '不引入可写的全局"当前世界开关"');
}

// ── ⑩ 全关基线夹具（Build 50 字节级） ─────────────────────────────────────
// 夹具口径：BUILD=50 时同种子生成 [(-1..1)×(-1..1)] 9 个区块的采样滚动哈希。
// 捕获时归属元数据接线已存在但没有任何内容带 requiresExtras，故与 Build 50 逐字节等价；
// 该夹具与 biome/structure/loot determinism 三套既有 oracle 共同守住"全关不变"。
// 启用模块（尚无生成内容）不得改变地形——这是 R2 之后新增生成内容时的对拍基线。
{
  const SEED = 20251123;
  const BASE = 511554064;
  const digestOf = (manifest) => {
    const gen = new TerrainGenerator(SEED);
    if (manifest) gen.extraContent = manifest;
    let h = 0x811c9dc5 >>> 0;
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const c = new Chunk(cx, cz);
        gen.generateChunk(c);
        const b = c.blocks;
        for (let i = 0; i < b.length; i += 13) {
          h = (h ^ b[i]) >>> 0;
          h = Math.imul(h, 16777619) >>> 0;
        }
        h = (h ^ (cx + 7)) >>> 0; h = Math.imul(h, 16777619) >>> 0;
        h = (h ^ (cz + 7)) >>> 0; h = Math.imul(h, 16777619) >>> 0;
      }
    }
    return h >>> 0;
  };
  const base = digestOf(null);
  ok(base === BASE, `全关世界与 Build 50 基线逐字节一致（${base}）`);
  ok(digestOf({ schema: 1, industry: true, magic: true }) === BASE,
    '双开清单在尚无生成内容时不改变地形（基线对拍）');
}

finish('extra-content-unit');
