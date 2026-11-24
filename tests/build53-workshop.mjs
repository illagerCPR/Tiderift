// build53-workshop.mjs -- Build 53 R4 潮工断坊（结构 / 碑文 / 箱子 / 旧流不变）
// 纯 node，不依赖服务器。断言：
//   ① 注册与门控：cell/salt/dims/requiresExtras/probeR；关闭工业的世界一个都不生成（旧随机流不变）
//   ② 生成内容：地基砖面、三面残墙、火把、箱子（tide_workshop 表）、四格石碑（tideworks 章节）、
//      且布局里**没有任何工业方块**（遗迹不是机器主线的解锁点，只是叙述与材料）
//   ③ 碑文：STELE_CHAPTERS.tideworks 存在且 dim = overworld、四行正文；sm.steleChapterAt 能解析
//   ④ 箱子三向一致：meta.chests ↔ chest 方块 ↔ sm.chests；loot 确定 + 桶 FORCED 保底
//   ⑤ 确定性：同 seed 两套管理器求解逐字节一致
//   ⑥ 旧结构随机流不变：同 seed 在"关工业/开工业"下，村庄/要塞/潮冢的记录逐字节一致
//   ⑦ 源码绊线：catalog 注册、结构名标签、loot 保底
import { readFileSync } from 'fs';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { chestLoot } from '../src/world/loot.js';
import { TIDE_WORKSHOP_DEF, solveWorkshop } from '../src/world/structures/tide_workshop.js';
import { StructureManager } from '../src/world/structures/StructureManager.js';
import { STELE_CHAPTERS } from '../src/world/steles.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { en } from '../src/i18n/locales/en.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const INDUSTRY = { schema: 1, industry: true, magic: false };
const NONE = { schema: 1, industry: false, magic: false };
const sig = (r) => r.blocks.map((b) => b.join(',')).join('|') + '#' + JSON.stringify(r.meta);
const genWith = (seed, extras) => {
  const g = new TerrainGenerator(seed);
  g.extraContent = extras; // World 构造时注入（生成器自身不读 worldOpts）
  return g;
};
// 在 cs×cs 个 cell 里找前 n 个断坊记录
function findWorkshops(seed, cells = 24, want = 3) {
  const gen = genWith(seed, INDUSTRY);
  const out = [];
  for (let cx = 0; cx < cells && out.length < want; cx++) {
    for (let cz = 0; cz < cells && out.length < want; cz++) {
      const rec = gen.structureManager.ensureRecord('tide_workshop', cx, cz);
      if (rec) out.push({ rec, cx, cz, gen });
    }
  }
  return out;
}

// ── ① 注册与门控 ──────────────────────────────────────────────────────
{
  ok(TIDE_WORKSHOP_DEF.cell === 20 && TIDE_WORKSHOP_DEF.salt === 8419, '密度与盐：cell 20 / salt 8419');
  ok(TIDE_WORKSHOP_DEF.dims.join() === 'overworld', '维度作用域 = 主世界');
  ok(TIDE_WORKSHOP_DEF.requiresExtras.join() === 'industry', '归属工业内容（关闭时不激活）');
  ok(Array.isArray(TIDE_WORKSHOP_DEF.probeR) && TIDE_WORKSHOP_DEF.maxSlope === 5, '小体量选址参数已收窄');
  const off = genWith(9091, NONE);
  let offCount = 0;
  for (let cx = 0; cx < 24; cx++) for (let cz = 0; cz < 24; cz++) {
    if (off.structureManager.ensureRecord('tide_workshop', cx, cz)) offCount++;
  }
  ok(offCount === 0, '关闭工业的世界：一个断坊都不生成（旧随机流不变）');
  const nether = new NetherGenerator(9091);
  nether.extraContent = INDUSTRY;
  ok(!nether.structureManager.ensureRecord('tide_workshop', 0, 0), '下界不求解断坊（维度门控）');
  const found = findWorkshops(9091);
  ok(found.length >= 1, `启用工业的世界能生成断坊（找到 ${found.length} 处）`);
}

// ── ②③④ 生成内容 / 碑文 / 箱子 ────────────────────────────────────────
{
  const found = findWorkshops(9091);
  const hit = found[0];
  ok(!!hit, '至少一处断坊记录可检查');
  const { rec } = hit;
  const at = (x, y, z) => {
    // 同坐标后写覆盖先写（StructureKit 约定）
    let id = null;
    for (const b of rec.blocks) if (b[0] === x && b[1] === y && b[2] === z) id = b[3];
    return id;
  };
  ok(rec.meta.kind === 'tide_workshop' && Array.isArray(rec.meta.chests) && Array.isArray(rec.meta.steles), 'meta 结构完整');
  // 箱子三向一致
  const ch = rec.meta.chests[0];
  ok(ch[3] === 'tide_workshop' && at(ch[0], ch[1], ch[2]) === BlockRegistry.getId('chest'),
    '箱子：meta 表名 ↔ 实际 chest 方块一致');
  ok(hit.gen.structureManager.chests.get(ch[0] + ',' + ch[1] + ',' + ch[2]) === 'tide_workshop',
    '箱子已注册进 StructureManager.chests（首次打开按表生成）');
  // 石碑三向一致 + 章节解析
  const st = rec.meta.steles[0];
  ok(st[3] === 'tideworks' && at(st[0], st[1], st[2]) === BlockRegistry.getId('moss_stele'),
    '石碑：meta 章节 ↔ 实际 moss_stele 方块一致');
  ok(hit.gen.structureManager.steles.get(st[0] + ',' + st[1] + ',' + st[2]) === 'tideworks', '石碑已注册进 sm.steles');
  ok(hit.gen.structureManager.steleChapterAt(st[0], st[1], st[2]) === 'tideworks', 'steleChapterAt 解析出潮工纪');
  const chapter = STELE_CHAPTERS.tideworks;
  ok(!!chapter && chapter.dim === 'overworld', '章节存在且 dim = overworld');
  ok(!!chapter && chapter.title === '断坊碑·潮工的尺寸' && chapter.lines.length === 4, '碑文标题与四行正文');
  for (const line of chapter.lines) ok(!!en[line], `碑文有英文译文：${line.slice(0, 8)}…`);
  ok(!!en[chapter.title] && !!en['潮工断坊'], '标题与结构名都有译文');
  // 四格形制：底座/碑/荧石/顶帽
  ok(at(st[0], st[1] - 1, st[2]) === BlockRegistry.getId('mossy_cobblestone'), '石碑底座 = 苔石');
  ok(at(st[0], st[1] + 1, st[2]) === BlockRegistry.getId('glowstone'), '石碑上方 = 荧石');
  ok(at(st[0], st[1] + 2, st[2]) === BlockRegistry.getId('mossy_cobblestone'), '石碑顶帽 = 苔石');
  // 残墙与火把
  const ids = new Set(rec.blocks.map((b) => b[3]));
  ok(ids.has(BlockRegistry.getId('stone_bricks')) || ids.has(BlockRegistry.getId('cracked_stone_bricks')),
    '有砖砌结构（地基/残墙）');
  ok(ids.has(BlockRegistry.getId('torch')), '有两盏火把');
  ok(ids.has(BlockRegistry.getId('mossy_cobblestone')) || ids.has(BlockRegistry.getId('gravel')), '有碎石与苔痕');
  // 红线：断坊里不许有任何工业方块（否则会变成"免费机器"且不在账本里、单元失效）
  let industryBlocks = 0;
  for (const b of rec.blocks) {
    const def = BlockRegistry.getById(b[3]);
    if (def && def.industryKind) industryBlocks++;
  }
  ok(industryBlocks === 0, '断坊不含任何工业方块（遗迹不是机器主线的解锁点）');
}

// ── ⑤ 确定性 ──────────────────────────────────────────────────────────
{
  const a = findWorkshops(9091)[0];
  const b = findWorkshops(9091)[0];
  ok(sig(a.rec) === sig(b.rec), '同 seed 两次求解逐字节一致');
  // 纯函数直调（固定 rng）也应稳定
  const rng1 = (() => { let n = 0; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); })();
  const r1 = solveWorkshop(rng1, 100, 70, 100);
  const rng2 = (() => { let n = 0; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); })();
  const r2 = solveWorkshop(rng2, 100, 70, 100);
  ok(sig(r1) === sig(r2), 'solve 纯函数：同 rng 序列 → 同布局');
}

// ── ⑥ 旧结构随机流不变 ────────────────────────────────────────────────
{
  const on = genWith(9091, INDUSTRY);
  const off = genWith(9091, NONE);
  let checked = 0;
  for (const type of ['village', 'stronghold', 'tide_barrow']) {
    for (let cx = 0; cx < 12; cx++) {
      for (let cz = 0; cz < 12; cz++) {
        const a = on.structureManager.ensureRecord(type, cx, cz);
        const b = off.structureManager.ensureRecord(type, cx, cz);
        const sa = a ? sig(a) : 'null';
        const sb = b ? sig(b) : 'null';
        ok(sa === sb, `${type} @cell(${cx},${cz}) 在开关工业下一致`);
        checked++;
        if (checked >= 20) break;
      }
      if (checked >= 20) break;
    }
    if (checked >= 20) break;
  }
  ok(checked >= 20, `已对拍 ${checked} 组既有结构记录`);
}

// ── ⑦ 箱子战利品 ──────────────────────────────────────────────────────
{
  const a = chestLoot(9091, 'tide_workshop', 10, 65, 10);
  const b = chestLoot(9091, 'tide_workshop', 10, 65, 10);
  ok(JSON.stringify(a) === JSON.stringify(b), 'loot：同 (seed,表,坐标) 内容一致');
  ok(a.filter(Boolean).length > 0, 'loot：非空箱');
  ok(a.some((s) => s && s.name === 'bucket'), 'loot：桶 FORCED 保底（锅炉的门槛件）');
  for (const s of a) {
    if (!s) continue;
    ok(!!ItemRegistry.getByName(s.name), `loot 物品可解析：${s.name}`);
    ok(s.count >= 1 && s.count <= 64, `loot 数量合法：${s.name}=${s.count}`);
  }
}

// ── ⑧ 源码绊线 ────────────────────────────────────────────────────────
{
  const cat = src('../src/world/structures/catalog.js');
  ok(cat.includes("registerStructureType('tide_workshop'"), 'catalog 注册断坊');
  const smSrc = src('../src/world/structures/StructureManager.js');
  ok(smSrc.includes("'tide_workshop') return '潮工断坊'"), 'structureNameAt 认识断坊');
  ok(smSrc.includes("label = '潮工断坊'"), 'structureRecordAt 标签 = 潮工断坊');
  const lootSrc = src('../src/world/loot.js');
  ok(lootSrc.includes("tide_workshop: [['bucket', 1, 1]]"), 'loot 保底注册');
  const defSrc = src('../src/world/structures/tide_workshop.js');
  ok(defSrc.includes("requiresExtras: ['industry']"), '断坊带工业归属门');
  ok(!/industrialKind|industryKind/.test(defSrc), '布局里没有工业方块引用');
}

finish('build53-workshop');
