// whale-barrow.mjs -- 鲸骨冢篇 K1 内容回归（node 直跑，无需服务器）
// 断言：
//   ① 鲸骨块注册：displayName / hardness / SVG 键 / names.js 11 列 / 追加纪律 / 分类
//   ② 归云章：dim=aether / 3 行 / 留白纪律（龙零出场）；dim 计数 aether 11
//   ③ solve 确定性 ×2 seed：块序列签名对拍 + 关键件在场（章位/箱/风柱/星髓/头骨拱门）
//   ④ 维度作用域与选址：dims ['aether']；非白名单群系 place 拒绝
//   ⑤ loot 表在场（零 FORCED 依赖线核对）
//   ⑥ 接线绊线：catalog 注册 / structureNameAt / 命令面板探索列表 / BUILD 不 bump
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { WHALE_BARROW_DEF, solveWhale } from '../src/world/structures/whale_barrow.js';
import { STELE_CHAPTERS } from '../src/world/steles.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { readFileSync } from 'fs';
import { BUILD } from '../src/version.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}

// ── ① 鲸骨块 ──
const wb = BlockRegistry.getByName('whale_bone_block');
ok(!!wb, '方块注册: whale_bone_block');
ok(wb.displayName === '鲸骨块', `displayName: whale_bone_block (${wb.displayName})`);
ok(wb.hardness === 1.5 && wb.tool === 'pickaxe', 'whale_bone_block 可采集建材（hardness 1.5 / pickaxe）');
ok(BlockSVGDefinitions.whale_bone_block !== undefined, 'SVG 纹理键在场: whale_bone_block');
ok(wb.id > BlockRegistry.getId('primordial_altar'), '追加纪律: whale_bone_block id > primordial_altar（append-only）');
ok(getItemCategory('whale_bone_block') === 'building', '创造分类 building（whale_bone_block）');
const wbName = NAME_I18N.whale_bone_block;
ok(Array.isArray(wbName) && wbName.length === 11 && wbName[0] === '鲸骨块', 'names.js 11 列首列简体（whale_bone_block）');

// ── ② 归云章 ──
const ch = STELE_CHAPTERS.aether_whale;
ok(!!ch, '归云章在场: aether_whale');
ok(ch.dim === 'aether', `章节 dim=aether (${ch.dim})`);
ok(ch.title === '归云', `章节标题: 归云 (${ch.title})`);
ok(ch.lines.length === 3, '归云章 3 行');
const chText = JSON.stringify(ch);
ok(!chText.includes('龙'), '归云章龙零出场（留白纪律）');
ok(!chText.includes('原初纹章') && !chText.includes('纹章'), '归云章不涉及终局信物（时序中立）');
ok(chText.includes('潮退的时候'), '归云章开场锚定退潮时刻');
const byDim = {};
for (const [, c] of Object.entries(STELE_CHAPTERS)) byDim[c.dim] = (byDim[c.dim] || 0) + 1;
ok(byDim.aether === 11, `天域 11 章 (${byDim.aether})`);
ok(byDim.nether === 4 && byDim.overworld === 3 && byDim.end === 2, `其余维度计数不变 (${byDim.nether}/${byDim.overworld}/${byDim.end})`);

// ── ③ solve 确定性 ×2 seed ──
function sig(seed) {
  const rng = (() => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  const { blocks, meta } = solveWhale(rng, 100, 65, 200);
  return JSON.stringify([blocks, meta]);
}
ok(sig(42) === sig(42), '同 seed 块序列逐字节一致（确定性）');
ok(sig(42) !== sig(20250916), '不同 seed 布局不同（掷签生效）');
const r1 = solveWhale((() => { let s = 42; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(), 100, 65, 200);
const { blocks, meta } = r1;
ok(meta.kind === 'whale_barrow' && meta.steles.length === 1 && meta.steles[0][3] === 'aether_whale', '章位注册: aether_whale');
ok(meta.chests.length === 1 && meta.chests[0][3] === 'whale_barrow', '考古箱注册: whale_barrow 表');
const has = (id, rx, ry, rz) => blocks.some((b) => b[0] === rx && b[1] === ry && b[2] === rz && b[3] === id);
ok(has(BlockRegistry.getId('wind_stele'), 100, 65, 202), '风纹石碑在场（章位方块）');
ok(has(BlockRegistry.getId('chest'), 100, 65, 198), '箱子在场');
const WC = BlockRegistry.getId('wind_current');
ok(blocks.filter((b) => b[3] === WC).length === 14, `风柱 ×2（8+6 段，${blocks.filter((b) => b[3] === WC).length} 格）`);
ok(blocks.some((b) => b[3] === BlockRegistry.getId('star_marrow_block')), '星髓碎屑在场');
ok(blocks.filter((b) => b[3] === BlockRegistry.getId('whale_bone_block')).length > 80, `骨块体量（${blocks.filter((b) => b[3] === BlockRegistry.getId('whale_bone_block')).length} 块）`);
// 头骨拱门顶横 + 风柱穿门（门心 y0+4 被风柱覆盖 = 通风口）
ok(has(BlockRegistry.getId('whale_bone_block'), 113, 69, 200), '头骨拱门顶横在场 (ax+13)');
ok(has(WC, 113, 69, 200), '风柱穿门心（后写覆盖顶横中格 = 通风口）');

// ── ④ 维度作用域与选址 ──
ok(JSON.stringify(WHALE_BARROW_DEF.dims) === '["aether"]', 'dims 仅天域');
const fakeGen = { getBiome: () => 'plains', generateChunk: () => {} };
ok(WHALE_BARROW_DEF.place(fakeGen, 0, 0) === -1, '非天域群系选址拒绝');
ok(WHALE_BARROW_DEF.cell === 48 && WHALE_BARROW_DEF.salt === 7291, '密度预案 cell48/salt7291（与既有 salt 错开）');

// ── ⑤ loot 表 ──
const lootSrc = readFileSync('./src/world/loot.js', 'utf8');
ok(lootSrc.includes('whale_barrow: ['), 'loot 表 whale_barrow 在场');
ok(lootSrc.includes("['star_marrow', 2, 4, 12]") && lootSrc.includes("['cloud_fluff', 2, 5, 10]"), '考古收获（星髓/云絮）');
ok(!/whale_barrow:\s*\[[^\]]*FORCED/s.test(lootSrc), '零 FORCED 依赖线（考古箱无保底挂钩）');

// ── ⑥ 接线绊线 ──
const catSrc = readFileSync('./src/world/structures/catalog.js', 'utf8');
ok(catSrc.includes("registerStructureType('whale_barrow', WHALE_BARROW_DEF);"), 'catalog 注册在场');
const smSrc = readFileSync('./src/world/structures/StructureManager.js', 'utf8');
ok(smSrc.includes("if (name === 'whale_barrow') return '鲸骨冢';"), 'structureNameAt 鲸骨冢在场');
const cpSrc = readFileSync('./src/ui/CommandPanel.js', 'utf8');
ok(cpSrc.includes("sm.recordsAround('whale_barrow', p.x, p.z, 2)"), '命令面板探索列表纳入（用户要求）');
ok(cpSrc.includes("name: '鲸骨冢'"), '探索列表条目名在场');
ok(BUILD === 28, `BUILD 24（Build 23 主菜单与皮肤面板批次统一 bump）`);

console.log(`whale-barrow: ${passed} assertions passed`);
