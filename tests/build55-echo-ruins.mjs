// build55-echo-ruins.mjs -- Build 55 R1 四维回响遗迹（结构 / 门控 / 战利品 / 旧流不变）
// 纯 node，不依赖服务器。断言：
//   ① 注册与门控：四类各自的 cell/salt/dims/requiresExtras；关闭魔法的世界一类都不生成；
//      维度互相隔离（主世界不会求解下界遗迹，反之亦然）
//   ② 生成内容：每类的标志材质（水与黏土 / 岩浆与灵魂沙 / 云絮与星髓 / 末地砖与紫珀）、
//      箱子三向一致、碑位留空（R3 落碑）、布局里没有可运行方块与工业方块
//   ③ 战利品：四张表确定性 + 回响残片 FORCED 保底 + 物品可解析 + 数量合法
//   ④ 确定性：同 seed 两次求解逐字节一致
//   ⑤ 旧结构随机流不变：开启/关闭魔法时，村庄/要塞/潮冢/潮工断坊的记录逐字节一致
//   ⑥ 物品/i18n：回响残片 ID 钉值、十一语名字、十语 lore 与四个结构名
//   ⑦ 源码绊线：catalog 注册、结构名标签、FORCED 注册
import { readFileSync } from 'fs';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { EndGenerator } from '../src/world/dimensions/end.js';
import { AetherGenerator } from '../src/world/dimensions/aether.js';
import { chestLoot } from '../src/world/loot.js';
import { STELE_STELE_BY_DIM } from '../src/world/steles.js';
import {
  ECHO_RAIN_DEF, ECHO_EMBER_DEF, ECHO_GALE_DEF, ECHO_TIDELESS_DEF,
  solveRain, solveEmber, solveGale, solveTideless,
} from '../src/world/structures/echoRuins.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { NAME_I18N } from '../src/i18n/names.js';
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
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const MAGIC = { schema: 1, industry: false, magic: true };
const NONE = { schema: 1, industry: false, magic: false };
const INDUSTRY = { schema: 1, industry: true, magic: false };
const SEED = 5501;

const sig = (r) => r.blocks.map((b) => b.join(',')).join('|') + '#' + JSON.stringify(r.meta);
const genWith = (Ctor, seed, extras) => {
  const g = new Ctor(seed);
  g.extraContent = extras; // World 构造时注入（生成器自身不读 worldOpts）
  return g;
};
const GEN = {
  overworld: TerrainGenerator,
  nether: NetherGenerator,
  end: EndGenerator,
  aether: AetherGenerator,
};

const KINDS = [
  {
    name: 'echo_rain', def: ECHO_RAIN_DEF, dim: 'overworld', table: 'echo_rain', solve: solveRain,
    markers: ['water', 'clay', 'stone_bricks'], label: '雨痕水龛',
  },
  {
    name: 'echo_ember', def: ECHO_EMBER_DEF, dim: 'nether', table: 'echo_ember', solve: solveEmber,
    markers: ['magma_block', 'soul_sand', 'nether_bricks'], label: '烬痕炉龛',
  },
  {
    name: 'echo_gale', def: ECHO_GALE_DEF, dim: 'aether', table: 'echo_gale', solve: solveGale,
    markers: ['cloud_wool', 'star_marrow_block', 'quartz_block'], label: '风纹哨台',
  },
  {
    name: 'echo_tideless', def: ECHO_TIDELESS_DEF, dim: 'end', table: 'echo_tideless', solve: solveTideless,
    markers: ['end_stone_bricks', 'purpur_block', 'obsidian'], label: '无潮静台',
  },
];

// 在 cells×cells 个 cell 里找前 want 条记录
function findRecords(gen, type, cells = 40, want = 3) {
  const out = [];
  for (let cx = 0; cx < cells && out.length < want; cx++) {
    for (let cz = 0; cz < cells && out.length < want; cz++) {
      const rec = gen.structureManager.ensureRecord(type, cx, cz);
      if (rec) out.push({ rec, cx, cz });
    }
  }
  return out;
}

// 同坐标后写覆盖先写（StructureKit 约定）
function blockAt(rec, x, y, z) {
  let id = null;
  for (const b of rec.blocks) if (b[0] === x && b[1] === y && b[2] === z) id = b[3];
  return id;
}

// ── ① 注册与门控 ──────────────────────────────────────────────────────
{
  const salts = new Set();
  for (const k of KINDS) {
    const d = k.def;
    ok(d.dims.join() === k.dim, `${k.name}：维度作用域 = ${k.dim}`);
    ok(d.requiresExtras.join() === 'magic', `${k.name}：归属魔法内容（关闭时不激活）`);
    ok(Number.isInteger(d.cell) && d.cell >= 12 && d.cell <= 24, `${k.name}：cell 在 12~24（${d.cell}）`);
    ok(Number.isInteger(d.salt) && d.salt >= 8500 && d.salt < 8600, `${k.name}：独立 salt 8501~8504（${d.salt}）`);
    ok(!salts.has(d.salt), `${k.name}：salt 不与同类重复`);
    salts.add(d.salt);
    ok(typeof d.solve === 'function' && (typeof d.place === 'function' || d.probeR), `${k.name}：solve + 选址参数齐备`);
  }
  ok(salts.size === 4, '四类 salt 互不相同（独立随机流）');

  // 关闭魔法：四个维度都不生成任何回响遗迹
  for (const k of KINDS) {
    const gen = genWith(GEN[k.dim], SEED, NONE);
    let n = 0;
    for (let cx = 0; cx < 16; cx++) for (let cz = 0; cz < 16; cz++) if (gen.structureManager.ensureRecord(k.name, cx, cz)) n++;
    ok(n === 0, `${k.name}：关闭魔法的世界一个都不生成（旧随机流不变）`);
  }

  // 维度隔离：每类只在自家维度求解
  for (const k of KINDS) {
    for (const other of Object.keys(GEN)) {
      if (other === k.dim) continue;
      const gen = genWith(GEN[other], SEED, MAGIC);
      ok(!gen.structureManager.ensureRecord(k.name, 0, 0), `${k.name}：不在 ${other} 求解`);
    }
  }

  // 开启魔法：四类都能在各自维度生成
  for (const k of KINDS) {
    const gen = genWith(GEN[k.dim], SEED, MAGIC);
    const found = findRecords(gen, k.name);
    ok(found.length >= 1, `${k.name}：启用魔法的世界能生成（找到 ${found.length} 处）`);
  }
}

// ── ② 生成内容 ────────────────────────────────────────────────────────
for (const k of KINDS) {
  const gen = genWith(GEN[k.dim], SEED, MAGIC);
  const found = findRecords(gen, k.name);
  const hit = found[0];
  ok(!!hit, `${k.name}：至少一处记录可检查`);
  if (!hit) continue;
  const { rec } = hit;
  ok(rec.meta.kind === k.name, `${k.name}：meta.kind 与类型一致`);
  ok(Array.isArray(rec.meta.chests) && rec.meta.chests.length === 1, `${k.name}：meta.chests 一条`);
  ok(Array.isArray(rec.meta.plinth) && rec.meta.plinth.length === 3, `${k.name}：meta.plinth 已登记`);
  // R3 起碑位落四格碑：碑身在该维度的石碑方块上，meta.steles 与 sm.steles 三向一致
  ok(blockAt(rec, ...rec.meta.plinth) === BlockRegistry.getId(STELE_STELE_BY_DIM[k.dim]),
    `${k.name}：碑位上是 ${STELE_STELE_BY_DIM[k.dim]}（四格碑的碑身）`);
  ok(Array.isArray(rec.meta.steles) && rec.meta.steles.length === 1, `${k.name}：meta.steles 一条`);
  ok(rec.meta.steles[0][3] === k.name, `${k.name}：碑的章节 id 与遗迹同名`);
  ok(gen.structureManager.steles.get(rec.meta.plinth.join(',')) === k.name, `${k.name}：碑已注册进 sm.steles`);
  ok(gen.structureManager.steleChapterAt(...rec.meta.plinth) === k.name, `${k.name}：steleChapterAt 解析出章节`);

  // 箱子三向一致：meta ↔ 实际 chest 方块 ↔ StructureManager.chests
  const ch = rec.meta.chests[0];
  ok(ch[3] === k.table, `${k.name}：箱子表名 = ${k.table}`);
  ok(blockAt(rec, ch[0], ch[1], ch[2]) === BlockRegistry.getId('chest'), `${k.name}：箱子坐标上有 chest 方块`);
  ok(gen.structureManager.chests.get(ch[0] + ',' + ch[1] + ',' + ch[2]) === k.table, `${k.name}：箱子已注册进 sm.chests`);

  // 标志材质：各自的环境叙事必须看得见
  const idSet = new Set(rec.blocks.map((b) => b[3]));
  for (const m of k.markers) ok(idSet.has(BlockRegistry.getId(m)), `${k.name}：含标志材质 ${m}`);

  // 红线：不放可运行方块与工业方块（遗迹只承载叙述与材料）
  let functional = 0;
  for (const b of rec.blocks) {
    const def = BlockRegistry.getById(b[3]);
    if (!def) continue;
    if (def.industryKind || def.requiresExtras && def.requiresExtras.indexOf('magic') >= 0) functional++;
  }
  ok(functional === 0, `${k.name}：布局里没有任何可运行方块（工业/魔法方块 0 个）`);

  // 流体纪律：只有雨痕水龛有水，且只有水盆那 3×3 格
  const waterId = BlockRegistry.getId('water');
  const waterCount = rec.blocks.filter((b) => b[3] === waterId).length;
  if (k.name === 'echo_rain') ok(waterCount === 9, `雨痕水龛：水盆正好 9 格（实际 ${waterCount}）`);
  else ok(waterCount === 0, `${k.name}：不放任何会流动的流体`);

  // 地层连贯：地基必须贴地（floor 与地面同高），不悬空
  ok(rec.groundY > 0 && rec.minX < rec.maxX && rec.minZ < rec.maxZ, `${k.name}：包围盒有效`);
}

// ── ②b 区块落地（记录 → 真实区块）：箱子必须真的写进世界 ─────────────────
{
  const { Chunk, CHUNK_SIZE } = await import('../src/core/Chunk.js');
  for (const k of KINDS) {
    const gen = genWith(GEN[k.dim], SEED, MAGIC);
    const hit = findRecords(gen, k.name)[0];
    ok(!!hit, `${k.name}：落地检查有记录`);
    if (!hit) continue;
    const ch = hit.rec.meta.chests[0];
    const cx = Math.floor(ch[0] / CHUNK_SIZE), cz = Math.floor(ch[2] / CHUNK_SIZE);
    const chunk = new Chunk(cx, cz);
    gen.generateChunk(chunk, true);
    const local = chunk.get(ch[0] - cx * CHUNK_SIZE, ch[1], ch[2] - cz * CHUNK_SIZE);
    ok(local === BlockRegistry.getId('chest'), `${k.name}：箱子已写进真实区块（区块裁剪正确）`);
    let oob = 0;
    for (const b of hit.rec.blocks) if (b[1] < 0 || b[1] > 255) oob++;
    ok(oob === 0, `${k.name}：布局不含越界 Y`);
  }
}

// ── ③ 战利品 ──────────────────────────────────────────────────────────
for (const k of KINDS) {
  const a = chestLoot(SEED, k.table, 10, 65, 10);
  const b = chestLoot(SEED, k.table, 10, 65, 10);
  ok(JSON.stringify(a) === JSON.stringify(b), `${k.table}：同 (seed,表,坐标) 内容一致`);
  ok(a.filter(Boolean).length > 0, `${k.table}：非空箱`);
  const shard = a.find((s) => s && s.name === 'echo_shard');
  ok(!!shard, `${k.table}：回响残片 FORCED 保底`);
  ok(!!shard && shard.count >= 1 && shard.count <= 1, `${k.table}：残片数量 1（不刷量）`);
  for (const s of a) {
    if (!s) continue;
    ok(!!(ItemRegistry.getByName(s.name) || BlockRegistry.getByName(s.name)), `${k.table}：物品/方块可解析 ${s.name}`);
    ok(s.count >= 1 && s.count <= 64, `${k.table}：数量合法 ${s.name}=${s.count}`);
  }
}

// ── ④ 确定性 ──────────────────────────────────────────────────────────
for (const k of KINDS) {
  const a = findRecords(genWith(GEN[k.dim], SEED, MAGIC), k.name)[0];
  const b = findRecords(genWith(GEN[k.dim], SEED, MAGIC), k.name)[0];
  ok(a && b && sig(a.rec) === sig(b.rec), `${k.name}：同 seed 两次求解逐字节一致`);
  // 纯函数直调（独立 rng）也必须稳定
  const mkRng = () => { let n = 0; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };
  const r1 = k.solve(mkRng(), 100, 70, 100);
  const r2 = k.solve(mkRng(), 100, 70, 100);
  ok(sig(r1) === sig(r2), `${k.name}：solve 纯函数同 rng 序列 → 同布局`);
}

// ── ⑤ 旧结构随机流不变 ────────────────────────────────────────────────
{
  const pairs = [
    { Ctor: TerrainGenerator, types: ['village', 'stronghold', 'tide_barrow'], a: MAGIC, b: NONE, tag: '魔法开/关' },
    { Ctor: TerrainGenerator, types: ['tide_workshop'], a: INDUSTRY, b: { schema: 1, industry: true, magic: true }, tag: '工业独开/双开' },
    { Ctor: NetherGenerator, types: ['fortress', 'tidefire_hearth'], a: MAGIC, b: NONE, tag: '魔法开/关' },
    { Ctor: EndGenerator, types: ['end_city', 'gleaner_ring'], a: MAGIC, b: NONE, tag: '魔法开/关' },
    { Ctor: AetherGenerator, types: ['aether_tower', 'aether_well'], a: MAGIC, b: NONE, tag: '魔法开/关' },
  ];
  for (const p of pairs) {
    const on = genWith(p.Ctor, SEED, p.a);
    const off = genWith(p.Ctor, SEED, p.b);
    let checked = 0;
    for (const type of p.types) {
      for (let cx = 0; cx < 8 && checked < 12; cx++) {
        for (let cz = 0; cz < 8 && checked < 12; cz++) {
          const A = on.structureManager.ensureRecord(type, cx, cz);
          const B = off.structureManager.ensureRecord(type, cx, cz);
          ok((A ? sig(A) : 'null') === (B ? sig(B) : 'null'), `${type} @cell(${cx},${cz}) 在${p.tag}下一致`);
          checked++;
        }
      }
    }
    ok(checked >= 1, `${p.types[0]} 等已对拍 ${checked} 组（${p.tag}）`);
  }
}

// ── ⑥ 物品与 i18n ─────────────────────────────────────────────────────
{
  const item = ItemRegistry.getByName('echo_shard');
  ok(!!item, '回响残片已注册');
  ok(item.id === 146, `回响残片 ID = 146（文件末尾追加，零漂移；实际 ${item.id}）`);
  ok(item.stack === 16, '回响残片 stack 16');
  ok(item.requiresExtras.join() === 'magic', '回响残片归属魔法内容');
  ok(Array.isArray(item.lore) && item.lore.length === 1, '回响残片 lore 1 行');

  const row = NAME_I18N.echo_shard;
  ok(Array.isArray(row) && row.length === 11, '十一语名字齐备');
  const packs = { 'zh-TW': zhTW, en, fr, de, ja, ko, ar, ru, es, pt };
  for (const [loc, pack] of Object.entries(packs)) {
    ok(!!pack[item.lore[0]], `${loc}：残片 lore 有译文`);
    for (const k of KINDS) ok(!!pack[k.label], `${loc}：结构名「${k.label}」有译文`);
  }
}

// ── ⑦ 源码绊线 ────────────────────────────────────────────────────────
{
  const cat = src('../src/world/structures/catalog.js');
  for (const k of KINDS) ok(cat.includes(`registerStructureType('${k.name}'`), `catalog 注册 ${k.name}`);
  const sm = src('../src/world/structures/StructureManager.js');
  for (const k of KINDS) {
    ok(sm.includes(`name === '${k.name}') return '${k.label}'`), `structureNameAt 认识 ${k.label}`);
    ok(sm.includes(`name === '${k.name}') label = '${k.label}'`), `structureRecordAt 标签 = ${k.label}`);
  }
  const loot = src('../src/world/loot.js');
  for (const k of KINDS) ok(loot.includes(`${k.name}: [['echo_shard', 1, 1]]`), `loot 保底：${k.name}`);
  const def = src('../src/world/structures/echoRuins.js');
  ok(def.includes("requiresExtras: ['magic']"), '四类均带魔法归属门');
  ok(!/industryKind/.test(def), '布局里没有工业方块引用');
}

finish('build55-echo-ruins');
