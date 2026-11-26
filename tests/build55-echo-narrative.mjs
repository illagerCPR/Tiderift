// build55-echo-narrative.mjs -- Build 55 R3 回响碑 / 游记 / 蓝图（叙事层与形制图）
// 纯 node，不依赖服务器。断言：
//   ① 碑文表：四章追加在表尾、维度正确、标题 + 三行正文；旧章节没有被重排/改写
//   ② i18n：十语包齐备（4 标题 + 12 行 + 蓝图提示），占位符不丢
//   ③ 碑落地：四类遗迹的四格碑（底座/碑/荧石/顶帽）与 meta.steles / sm.steles / steleChapterAt 三向一致
//   ④ 蓝图：blueprintFromBlocks 从结构记录生成合法蓝图（确定性、尺寸/调色板/ID 规则、体素对拍），
//      非法输入被拒；四类遗迹各得一份、id 互不相同
//   ⑤ 接线：Game.grantEchoSteleBlueprint（去重 + 蓝图入个人收藏）、SteleScreen 读碑即记图、
//      JournalScreen 的「回响遗迹」段、Game._updateJournal 的发现记录
import { readFileSync } from 'fs';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { EndGenerator } from '../src/world/dimensions/end.js';
import { AetherGenerator } from '../src/world/dimensions/aether.js';
import { STELE_CHAPTERS, STELE_STELE_BY_DIM, STELE_BASE_BY_DIM, ECHO_RUIN_BLUEPRINTS } from '../src/world/steles.js';
import { blueprintFromBlocks, validateBlueprint, BLUEPRINT_LIMITS } from '../src/core/Blueprints.js';
import { Journal } from '../src/core/Journal.js';
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
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const MAGIC = { schema: 1, industry: false, magic: true };
const SEED = 5501;
const GEN = { overworld: TerrainGenerator, nether: NetherGenerator, end: EndGenerator, aether: AetherGenerator };
const KINDS = [
  { chapter: 'echo_rain', dim: 'overworld', title: '回响碑·雨停在半空', structure: 'echo_rain' },
  { chapter: 'echo_ember', dim: 'nether', title: '回响碑·火不肯落', structure: 'echo_ember' },
  { chapter: 'echo_gale', dim: 'aether', title: '回响碑·风替你走', structure: 'echo_gale' },
  { chapter: 'echo_tideless', dim: 'end', title: '回响碑·路中间什么都没有', structure: 'echo_tideless' },
];
// 每章必须触及的叙事词（回响来历的锚点，不是纯风景）
const THEME_WORDS = {
  echo_rain: ['雨', '停在半空'],
  echo_ember: ['火', '坠潮'],
  echo_gale: ['风', '渡'],
  echo_tideless: ['路', '空'],
};
// 结构名（与 StructureManager 的标签一致）
const LABELS = { echo_rain: '雨痕水龛', echo_ember: '烬痕炉龛', echo_gale: '风纹哨台', echo_tideless: '无潮静台' };
const genWith = (Ctor, extras) => { const g = new Ctor(SEED); g.extraContent = extras; return g; };
const findRecord = (gen, type) => {
  for (let cx = 0; cx < 40; cx++) {
    for (let cz = 0; cz < 40; cz++) {
      const rec = gen.structureManager.ensureRecord(type, cx, cz);
      if (rec) return rec;
    }
  }
  return null;
};
const blockAt = (rec, x, y, z) => {
  let id = null;
  for (const b of rec.blocks) if (b[0] === x && b[1] === y && b[2] === z) id = b[3];
  return id;
};

// ── ① 碑文表 ──────────────────────────────────────────────────────────
{
  const ids = Object.keys(STELE_CHAPTERS);
  ok(ids.slice(-4).join() === 'echo_rain,echo_ember,echo_gale,echo_tideless',
    '四章追加在表尾（键序不变，旧章节不被重排）');
  ok(ids.indexOf('tideworks') === ids.length - 5, '潮工断坊碑仍是回响碑之前最后一章');
  // 旧章节内容未被改写（抽查三处长期存在的锚点）
  ok(STELE_CHAPTERS.prologue && STELE_CHAPTERS.prologue.dim === 'aether', '旧章节 prologue 仍在且维度不变');
  ok(STELE_CHAPTERS.aether_whale && STELE_CHAPTERS.aether_whale.title === '归云', '鲸骨冢章未被改写');
  ok(STELE_CHAPTERS.tideworks && STELE_CHAPTERS.tideworks.title === '断坊碑·潮工的尺寸', '断坊碑未被改写');
  // 不触碰终局奖励：碑文表里不出现 finaleDone 相关的状态字段
  ok(!JSON.stringify(STELE_CHAPTERS).includes('finaleDone'), '碑文不参与 finaleDone 奖励');
  for (const k of KINDS) {
    const ch = STELE_CHAPTERS[k.chapter];
    ok(!!ch, `${k.chapter} 章节存在`);
    ok(ch.dim === k.dim, `${k.chapter} 维度 = ${k.dim}`);
    ok(ch.title === k.title, `${k.chapter} 标题正确`);
    ok(Array.isArray(ch.lines) && ch.lines.length === 3, `${k.chapter} 三行正文`);
    ok(ch.lines.every((l) => typeof l === 'string' && l.length > 0), `${k.chapter} 行文非空`);
    // 回响章必须真的在讲"这一潮在重演"，不是随手写的风景
    const text = ch.lines.join('');
    for (const word of THEME_WORDS[k.chapter]) {
      ok(text.includes(word), `${k.chapter} 行文涉及「${word}」（回响来历而非纯风景）`);
    }
  }
}

// ── ② i18n ────────────────────────────────────────────────────────────
{
  const packs = { 'zh-TW': zhTW, en, fr, de, ja, ko, ar, ru, es, pt };
  for (const [loc, pack] of Object.entries(packs)) {
    for (const k of KINDS) {
      ok(!!pack[k.title], `${loc}：${k.chapter} 标题有译文`);
      for (const line of STELE_CHAPTERS[k.chapter].lines) ok(!!pack[line], `${loc}：${k.chapter} 某行缺译文`);
    }
    ok(!!pack['记下蓝图「{name}」'], `${loc}：蓝图提示有译文`);
    ok(pack['记下蓝图「{name}」'].includes('{name}'), `${loc}：蓝图提示保留 {name}`);
  }
  // 占位符多重集一致（i18n-parity 之外的自检，防止某语把 {name} 吃掉）
  for (const pack of Object.values(packs)) {
    ok((pack['记下蓝图「{name}」'].match(/\{name\}/g) || []).length === 1, '蓝图提示占位符恰好一次');
  }
}

// ── ③ 碑落地（四格碑 + 三向注册）──────────────────────────────────────
{
  for (const k of KINDS) {
    const gen = genWith(GEN[k.dim], MAGIC);
    const rec = findRecord(gen, k.structure);
    ok(!!rec, `${k.chapter}：能取到一处遗迹记录`);
    if (!rec) continue;
    const [px, py, pz] = rec.meta.plinth;
    ok(rec.meta.steles.length === 1 && rec.meta.steles[0][3] === k.chapter, `${k.chapter}：meta.steles 指向本章`);
    ok(blockAt(rec, px, py, pz) === BlockRegistry.getId(STELE_STELE_BY_DIM[k.dim]), `${k.chapter}：碑身 = ${STELE_STELE_BY_DIM[k.dim]}`);
    ok(blockAt(rec, px, py - 1, pz) === BlockRegistry.getId(STELE_BASE_BY_DIM[k.dim]), `${k.chapter}：底座 = ${STELE_BASE_BY_DIM[k.dim]}`);
    ok(blockAt(rec, px, py + 1, pz) === BlockRegistry.getId('glowstone'), `${k.chapter}：碑上是荧石`);
    ok(blockAt(rec, px, py + 2, pz) === BlockRegistry.getId(STELE_BASE_BY_DIM[k.dim]), `${k.chapter}：顶帽 = 底座同料`);
    ok(gen.structureManager.steles.get([px, py, pz].join(',')) === k.chapter, `${k.chapter}：已注册进 sm.steles`);
    ok(gen.structureManager.steleChapterAt(px, py, pz) === k.chapter, `${k.chapter}：steleChapterAt 解析正确`);
    // 碑身四格不能把箱子挤掉
    const chest = rec.meta.chests[0];
    ok(!(chest[0] === px && chest[2] === pz), `${k.chapter}：碑与箱子不同列`);
  }
  // 四章各有蓝图映射
  ok(Object.keys(ECHO_RUIN_BLUEPRINTS).sort().join() === KINDS.map((k) => k.chapter).sort().join(),
    '四个回响章都有蓝图映射');
}

// ── ④ 蓝图 ────────────────────────────────────────────────────────────
const built = {};
{
  for (const k of KINDS) {
    const gen = genWith(GEN[k.dim], MAGIC);
    const rec = findRecord(gen, k.structure);
    const def = ECHO_RUIN_BLUEPRINTS[k.chapter];
    ok(!!def && def.structure === k.structure, `${k.chapter}：蓝图映射指向同类遗迹`);
    const out = blueprintFromBlocks({ id: def.blueprintId, name: LABELS[k.chapter], dim: k.dim, blocks: rec.blocks });
    ok(out.ok, `${k.chapter}：结构记录能转成蓝图（${out.reason || 'ok'}）`);
    if (!out.ok) continue;
    built[k.chapter] = out;
    const bp = out.blueprint;
    const checked = validateBlueprint(bp);
    ok(checked.ok, `${k.chapter}：蓝图通过校验`);
    ok(bp.size.x <= BLUEPRINT_LIMITS.axis && bp.size.y <= BLUEPRINT_LIMITS.axis && bp.size.z <= BLUEPRINT_LIMITS.axis,
      `${k.chapter}：三轴都在 ${BLUEPRINT_LIMITS.axis} 以内`);
    ok(bp.size.x * bp.size.y * bp.size.z <= BLUEPRINT_LIMITS.volume, `${k.chapter}：体积在上限内`);
    ok(bp.palette[0] === 0, `${k.chapter}：调色板 0 号是空气`);
    ok(bp.palette.length <= BLUEPRINT_LIMITS.palette, `${k.chapter}：调色板不超上限`);
    ok(bp.dim === k.dim, `${k.chapter}：蓝图维度 = ${k.dim}`);
    ok(bp.byId === '' && bp.rev === 1, `${k.chapter}：个人蓝图（byId 空、rev 1）`);
    // 体素对拍：碑身那一格必须是石碑方块
    const [px, py, pz] = rec.meta.plinth;
    // 体素顺序与 captureBlueprint 同款：y → z → x（x 变化最快）
    const idx = (py - out.origin.y) * bp.size.x * bp.size.z
      + (pz - out.origin.z) * bp.size.x + (px - out.origin.x);
    ok(out.voxels[idx] === BlockRegistry.getId(STELE_STELE_BY_DIM[k.dim]), `${k.chapter}：蓝图里碑身格与遗迹一致`);
    // 确定性：同一份记录两次生成逐字节相同
    const again = blueprintFromBlocks({ id: def.blueprintId, name: LABELS[k.chapter], dim: k.dim, blocks: rec.blocks });
    ok(again.ok && JSON.stringify(again.blueprint) === JSON.stringify(bp), `${k.chapter}：同记录两次生成逐字节一致`);
  }
  ok(new Set(Object.values(built).map((b) => b.blueprint.id)).size === 4, '四份蓝图 id 互不相同');
  ok(Object.values(built).every((b) => b.blueprint.name && b.blueprint.name.length > 0), '蓝图名非空');
  for (const k of KINDS) {
    const entry = built[k.chapter];
    if (entry) ok(entry.blueprint.name === LABELS[k.chapter], `${k.chapter}：蓝图名 = 结构标签`);
  }

  // 非法输入
  const blocks = [[0, 64, 0, 1]];
  ok(blueprintFromBlocks({ id: 'Bad_ID', name: 'x', dim: 'overworld', blocks }).reason === 'id', '非法 ID（大写/下划线）被拒');
  ok(blueprintFromBlocks({ id: 'echorain02', name: '', dim: 'overworld', blocks }).reason === 'name', '空名字被拒');
  ok(blueprintFromBlocks({ id: 'echorain02', name: 'x', dim: 'void', blocks }).reason === 'dim', '未知维度被拒');
  ok(blueprintFromBlocks({ id: 'echorain02', name: 'x', dim: 'overworld', blocks: [] }).reason === 'empty', '空方块表被拒');
  ok(blueprintFromBlocks({ id: 'echorain02', name: 'x', dim: 'overworld', blocks: [[0, 64, 0, 0]] }).reason === 'empty',
    '只有空气也被拒（包围盒不撑起来）');
  const wide = [];
  for (let x = 0; x < 40; x++) wide.push([x, 64, 0, 1]);
  ok(blueprintFromBlocks({ id: 'echorain02', name: 'x', dim: 'overworld', blocks: wide }).reason === 'size',
    '超过 32 格的轴被拒');
}

// ── ⑤ 接线与游记 ──────────────────────────────────────────────────────
{
  const gameSrc = src('../src/player/Game.js');
  ok(/grantEchoSteleBlueprint\(chapterId, x, y, z\)/.test(gameSrc), 'Game 提供读碑记图入口');
  ok(/blueprintFromBlocks\(\{/.test(gameSrc), 'Game 用结构记录生成蓝图');
  ok(/_addRuinBlueprint\(built\.blueprint\)/.test(gameSrc), '蓝图进个人收藏（同名/同 id 去重）');
  ok(/personal\.some\(\(b\) => b\.id === def\.blueprintId\)/.test(gameSrc), '同一座遗迹的图只记一次');
  ok(/structureRecordAt\(x, z\)/.test(gameSrc) && /hit\.name !== def\.structure/.test(gameSrc),
    '只有站在对应类型遗迹的碑前才发图（不造假蓝图）');

  const steleSrc = src('../src/ui/SteleScreen.js');
  ok(/this\.game\.grantEchoSteleBlueprint\(id, x, y, z\)/.test(steleSrc), '读碑时调用记图入口');
  ok(steleSrc.indexOf('recordStele(id)') < steleSrc.indexOf('grantEchoSteleBlueprint'), '先记碑文再记图');

  const journalSrc = src('../src/ui/JournalScreen.js');
  ok(journalSrc.includes("'回响遗迹'"), '游记有「回响遗迹」段');
  for (const k of KINDS) ok(journalSrc.includes(`'${k.structure}'`), `游记列出 ${k.structure}`);
  ok(journalSrc.includes("t('已记录')") && journalSrc.includes("t('未记录')"), '游记显示已记录/未记录');

  // 发现记录走既有通用路径（按结构类型幂等），无需新协议
  const j = new Journal({ world: { generator: { getBiome: () => 'plains' } } });
  ok(j.recordDiscovery('overworld', 'echo_rain', 100, 100, '雨痕水龛') === true, '游记首次记录回响遗迹');
  ok(j.recordDiscovery('overworld', 'echo_rain', 100, 100, '雨痕水龛') === false, '同锚点重复记录被去重');
  ok(j.discoveries.filter((d) => d.type.startsWith('echo_')).length === 1, '回响遗迹进入发现表');
  ok(journalSrc.includes('journal.discoveries.some((d) => d.type === type)'), '游记按类型判断是否已发现');
}

finish('build55-echo-narrative');
