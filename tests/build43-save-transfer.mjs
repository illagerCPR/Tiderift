// build43-save-transfer.mjs -- Build 43 单人存档导出/导入回归（纯 node，无需服务器）
// 覆盖：gzip 往返 / magic 识别三分支 / 信封与裸档兼容 / V1→V2 迁移 / 版本与跨版本拒绝 /
//       净化六类脏数据 / 原型污染 / 解压上限 / 文件名 / SaveSystem 槽位读写 / 摘要
import { readFileSync } from 'node:fs';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
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
import { SaveSystem, normalizeSaveData, SAVE_VERSION } from '../src/core/SaveSystem.js';
import {
  buildSaveFile, decodeSaveFile, parseSaveText, sanitizeSaveData, makeFileName,
  summarize, formatBytes, isGzipBytes, gunzipBytes, SaveTransferError,
  SAVE_FILE_FORMAT, SAVE_FILE_VERSION, SAVE_IMPORT_ERROR_KEYS,
} from '../src/core/SaveTransfer.js';
import { BUILD } from '../src/version.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { ok, finish } from './harness.mjs';

const STONE_ID = BlockRegistry.getId('stone');
ok(STONE_ID > 0, 'stone 已注册（前置条件）');
ok(BlockRegistry.getByName('stone') != null, 'stone 方块定义可取');

// ── localStorage 内存桩（SaveSystem 直接引用全局） ──
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}
globalThis.localStorage = makeStorage();

// ── ① gzip 往返 ──
function sampleSave(extra = {}) {
  return {
    version: SAVE_VERSION,
    slot: 3,
    timestamp: 1762345678901,
    seed: 12345,
    dimension: 'overworld',
    gamemode: 'survival',
    cheatsEnabled: true,
    biomeScale: 'small',
    aetherDusk: false,
    player: {
      x: 12.5, y: 70, z: -3.25, yaw: 1.2, pitch: -0.4,
      health: 17, food: 14, saturation: 3, exhaustion: 0.5,
      xp: 42, xpLevel: 3, onFire: 0, airTicks: 300,
    },
    inventory: { slots: [{ n: 'stone', c: 12, d: null }], armor: [null, null, null, null] },
    dimensionBlocks: { overworld: { '0,64,0': STONE_ID } },
    dimensionContainers: { overworld: {} },
    dimensionFurnaces: { overworld: {} },
    dragonDefeated: false,
    finalePrimordial: null,
    finaleDone: false,
    emblemWorn: false,
    bedSpawn: null,
    redstone: null,
    journal: null,
    waymarks: null,
    ruins: null,
    races: null,
    blueprints: [],
    sky: { time: 0.5 },
    ...extra,
  };
}

{
  const file = await buildSaveFile(sampleSave(), { slot: 3, build: BUILD, now: 1762345678901, compress: true });
  ok(file.compressed === true, 'buildSaveFile 默认压缩');
  ok(isGzipBytes(file.bytes), '导出字节以 gzip magic 开头');
  ok(file.mime === 'application/gzip', '压缩文件 MIME 为 application/gzip');
  ok(file.fileName.endsWith('.tidersave'), '压缩导出扩展名 .tidersave');

  const decoded = await decodeSaveFile(file.bytes);
  ok(decoded.save.seed === 12345, 'gzip 往返：seed 一致');
  ok(decoded.save.player.x === 12.5 && decoded.save.player.pitch === -0.4, 'gzip 往返：玩家位姿一致');
  ok(decoded.save.dimensionBlocks.overworld['0,64,0'] === STONE_ID, 'gzip 往返：方块账本一致');
  ok(decoded.envelope.format === SAVE_FILE_FORMAT && decoded.envelope.fileVersion === SAVE_FILE_VERSION,
    '信封 format/fileVersion 正确');
  ok(decoded.envelope.build === BUILD, '信封记录导出时的 BUILD');
  ok(decoded.envelope.exportedAt === 1762345678901, '信封记录导出时间戳');
}

// ── ② 未压缩导出与裸档兼容 ──
{
  const file = await buildSaveFile(sampleSave(), { slot: 2, now: 1762345678901, compress: false });
  ok(!isGzipBytes(file.bytes), '未压缩导出不以 gzip magic 开头');
  ok(file.fileName.endsWith('.json'), '未压缩导出扩展名 .json');
  const decoded = await decodeSaveFile(file.bytes);
  ok(decoded.save.seed === 12345, '未压缩往返：seed 一致');

  // 裸存档（无信封）：直接给存档对象
  const bare = JSON.stringify(sampleSave({ slot: 5 }));
  const parsed = parseSaveText(bare);
  ok(parsed.envelope.build === 0, '裸存档视作 build 0（不触发跨版本拒绝）');
  ok(parsed.save.seed === 12345, '裸存档可直接解析');

  // 裸存档的 UTF-8 文本（模拟手工 .json 文件）
  const decodedBare = await decodeSaveFile(new TextEncoder().encode(bare));
  ok(decodedBare.save.seed === 12345, '裸存档文本可经 decodeSaveFile 识别');
}

// ── ③ V1 → V2 迁移 ──
{
  const v1 = {
    version: 1,
    seed: 777,
    gamemode: 'creative',
    modifiedBlocks: { '1,2,3': STONE_ID },
    containers: { '4,5,6': new Array(27).fill(null) },
    inventory: [{ n: 'stone', c: 1 }],
  };
  const migrated = normalizeSaveData(JSON.parse(JSON.stringify(v1)));
  ok(migrated.version === SAVE_VERSION, 'V1 迁移到 V2');
  ok(migrated.dimension === 'overworld', 'V1 迁移补 dimension');
  ok(migrated.dimensionBlocks.overworld['1,2,3'] === STONE_ID, 'V1 平铺方块进主世界桶');
  ok(Array.isArray(migrated.dimensionContainers.overworld['4,5,6']), 'V1 容器进主世界桶');

  const decoded = parseSaveText(JSON.stringify(v1));
  ok(decoded.save.version === SAVE_VERSION, '导入路径同样执行 V1 迁移');
  const { data } = sanitizeSaveData(decoded.save);
  ok(data.dimensionBlocks.overworld['1,2,3'] === STONE_ID, '迁移后的方块经净化保留');
  ok(!('modifiedBlocks' in data), '净化后删除 V1 平铺字段（不重复存储）');
  ok(!('containers' in data), '净化后删除 V1 容器平铺字段');
}

// ── ④ 版本与跨版本拒绝 ──
{
  const expectCode = (fn, code, msg) => {
    let got = '';
    try { fn(); } catch (e) { got = e instanceof SaveTransferError ? e.code : 'thrown-' + e.name; }
    ok(got === code, msg + ` (got ${got})`);
  };

  expectCode(() => parseSaveText('not json'), 'bad-json', '非 JSON 文本拒绝');
  expectCode(() => parseSaveText('[]'), 'not-a-save', '数组不是存档');
  expectCode(() => parseSaveText('{"foo":1}'), 'not-a-save', '无关 JSON 拒绝');
  expectCode(() => parseSaveText(JSON.stringify({ format: SAVE_FILE_FORMAT, fileVersion: 2, save: {} })),
    'bad-file-version', '文件格式版本不符拒绝');
  expectCode(() => parseSaveText(JSON.stringify({ format: SAVE_FILE_FORMAT, fileVersion: 1, save: { version: 3, seed: 1 } })),
    'bad-save-version', '存档数据版本不符拒绝');
  expectCode(() => parseSaveText(JSON.stringify({
    format: SAVE_FILE_FORMAT, fileVersion: 1, build: BUILD + 1,
    save: sampleSave(),
  })), 'newer-build', '来自更新 BUILD 的存档拒绝');

  const sameBuild = parseSaveText(JSON.stringify({
    format: SAVE_FILE_FORMAT, fileVersion: 1, build: BUILD, save: sampleSave(),
  }));
  ok(sameBuild.save.seed === 12345, '同 BUILD 存档允许导入');

  // 截断的 gzip
  const bad = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00]);
  let code = '';
  try { await decodeSaveFile(bad); } catch (e) { code = e instanceof SaveTransferError ? e.code : 'x'; }
  ok(code === 'unreadable', `截断 gzip 归为不可读 (got ${code})`);
}

// ── ⑤ 解压上限（压缩炸弹防护） ──
{
  const small = await buildSaveFile(sampleSave(), { slot: 1, compress: true });
  // 用极小上限直接验证 gunzipBytes 的累计截断逻辑
  let code = '';
  try { await gunzipBytes(small.bytes, 16); } catch (e) { code = e instanceof SaveTransferError ? e.code : 'x'; }
  ok(code === 'too-large', `解压超过上限拒绝 (got ${code})`);

  // 真实 33MB 高压缩比输入：确认 decodeSaveFile 默认上限生效
  const bombText = '{"pad":"' + 'a'.repeat(33 * 1024 * 1024) + '"}';
  const bomb = await buildSaveFile(sampleSave(), { slot: 1, compress: true });
  void bomb;
  const bombBytes = await (async () => {
    const stream = new Blob([bombText]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  })();
  ok(bombBytes.length < 200 * 1024, '炸弹文件本身很小（压缩比高）');
  let bombCode = '';
  try { await decodeSaveFile(bombBytes); } catch (e) { bombCode = e instanceof SaveTransferError ? e.code : 'x'; }
  ok(bombCode === 'too-large', `33MB 解压输入被默认上限拒绝 (got ${bombCode})`);
}

// ── ⑥ 净化：玩家数值与坐标 ──
{
  const raw = JSON.parse(JSON.stringify(sampleSave()));
  raw.player = { x: NaN, y: 100, z: Infinity, yaw: 'x', pitch: null, health: 999, food: -5, saturation: 50, airTicks: 9999 };
  const { data } = sanitizeSaveData(raw);
  ok(data.player.x === 0 && data.player.z === 0, '非法坐标回落 0');
  ok(data.player.y === 100, '合法 y 保留');
  ok(data.player.yaw === 0 && data.player.pitch === 0, '非法朝向回落 0');
  ok(data.player.health === 20, 'health 上限钳到 20');
  ok(data.player.food === 0, 'food 下限钳到 0');
  ok(data.player.saturation === 20, 'saturation 上限钳到 20');
  ok(data.player.airTicks === 300, 'airTicks 上限钳到 300');
}

// ── ⑦ 净化：背包物品 ──
{
  const raw = JSON.parse(JSON.stringify(sampleSave()));
  raw.inventory = {
    slots: [
      { n: 'stone', c: 9999 },
      { n: 'not_a_real_item', c: 1 },
      { n: 'stone', c: 0 },
      'garbage',
      { n: 'stone', c: 3, d: { box: true } },
    ],
    armor: [{ n: 'iron_helmet', c: 1 }, null, null],
  };
  const { data, dropped } = sanitizeSaveData(raw);
  ok(data.inventory.slots.length === 36, '背包槽数固定 36');
  ok(data.inventory.armor.length === 4, '盔甲槽数固定 4');
  ok(data.inventory.slots[0].c === 64, '超过堆叠上限钳到 64');
  ok(data.inventory.slots[1] === null, '未注册物品丢弃');
  ok(data.inventory.slots[2] === null, '数量 0 的物品丢弃');
  ok(data.inventory.slots[3] === null, '非对象槽位丢弃');
  ok(data.inventory.slots[4].d && data.inventory.slots[4].d.box === true, '物品附加 data 保留（潜影盒）');
  ok(dropped.items >= 3, `丢弃计数记录物品异常 (got ${dropped.items})`);
}

// ── ⑧ 净化：方块/容器/熔炉账本 ──
{
  const raw = JSON.parse(JSON.stringify(sampleSave()));
  raw.dimensionBlocks = JSON.parse('{"overworld":{"1,2,3":9999,"badkey":5,"4,5,6":0,"7,8,9":' + STONE_ID + '},"unknown_dim":{"1,1,1":1},"__proto__":{"polluted":1}}');
  raw.dimensionContainers = {
    overworld: {
      '1,2,3': Array.from({ length: 27 }, (_, i) => (i === 0 ? { name: 'stone', count: 999 } : null)),
      '9,9,9': [1, 2, 3],
    },
    bogus_dim: { '1,2,3': new Array(27).fill(null) },
  };
  raw.dimensionFurnaces = {
    overworld: {
      '2,3,4': { input: { name: 'iron_ore', count: 1 }, fuel: { name: 'coal', count: 2 }, output: null, burnTime: 5, burnMax: 80, cookTime: 1 },
      '9,9,9': 'nope',
    },
  };
  const { data, dropped } = sanitizeSaveData(raw);
  const blk = data.dimensionBlocks.overworld;
  ok(blk['4,5,6'] === 0, '空气（id 0）账本保留（挖空记录）');
  ok(blk['7,8,9'] === STONE_ID, '合法方块保留');
  ok(!('1,2,3' in blk), '非法方块 ID 丢弃');
  ok(!('badkey' in blk), '非法坐标键丢弃');
  ok(!('unknown_dim' in data.dimensionBlocks), '未知维度桶丢弃');
  ok(({}).polluted === undefined, '__proto__ 键不污染 Object.prototype');

  const cont = data.dimensionContainers.overworld;
  ok(cont['1,2,3'].length === 27, '容器槽数组保留 27 槽');
  ok(cont['1,2,3'][0].count === 64, '容器物品数量钳到堆叠上限');
  ok(!('9,9,9' in cont), '槽数不对的容器丢弃');
  ok(!('bogus_dim' in data.dimensionContainers), '未知维度容器桶丢弃');

  const furn = data.dimensionFurnaces.overworld;
  ok(furn['2,3,4'].burnTime === 5 && furn['2,3,4'].input.name === 'iron_ore', '熔炉状态保留');
  ok(!('9,9,9' in furn), '非法熔炉状态丢弃');
  ok(dropped.blocks >= 2 && dropped.containers >= 1 && dropped.furnaces >= 1, '账本丢弃计数分类统计');
}

// ── ⑨ 净化：枚举字段与未知字段 ──
{
  const raw = JSON.parse(JSON.stringify(sampleSave()));
  raw.dimension = 'moon';
  raw.gamemode = 'godmode';
  raw.cheatsEnabled = 'yes';
  raw.timestamp = 'yesterday';
  raw.sky = { time: 9 };
  raw.blueprints = 'x';
  raw.finalCustomField = { keep: true };
  const { data } = sanitizeSaveData(raw);
  ok(data.dimension === 'overworld', '非法维度回落主世界');
  ok(data.gamemode === 'creative', '非法模式回落创造');
  ok(data.cheatsEnabled === true, '真值字段布尔化');
  ok(Number.isFinite(data.timestamp) && data.timestamp > 0, '非法时间戳回落当前时间');
  ok(data.sky.time === 1, '天空时间钳到 [0,1]');
  ok(Array.isArray(data.blueprints) && data.blueprints.length === 0, '非数组蓝图回落空表');
  ok(data.finalCustomField && data.finalCustomField.keep === true, '未知字段原样保留（跨版本不丢）');
}

// ── ⑩ 文件名 / 摘要 / 体积格式化 ──
{
  const name = makeFileName(3, new Date(2026, 10, 5, 16, 39).getTime(), true);
  ok(/^Tiderift-save-3-\d{8}-\d{4}\.tidersave$/.test(name), `文件名格式 (got ${name})`);
  ok(makeFileName(4, Date.now(), false).endsWith('.json'), '未压缩文件名 .json');

  const s = summarize(sampleSave());
  ok(s.gamemode === 'survival' && s.dimension === 'overworld', '摘要含模式与维度');
  ok(s.blocks === 1 && s.containers === 0, '摘要统计账本条目');
  ok(formatBytes(0) === '0 B' && formatBytes(2048).includes('KB'), '体积格式化');
}

// ── ⑪ SaveSystem 槽位读写（导出/导入落地） ──
{
  localStorage.clear();
  const data = sanitizeSaveData(sampleSave()).data;
  ok(SaveSystem.importData(2, data) === true, 'importData 写入成功');
  ok(SaveSystem.hasSave(2), '写入后槽位存在');
  const exported = SaveSystem.exportSlotRaw(2);
  ok(exported && exported.seed === 12345, 'exportSlotRaw 读回原存档');
  ok(exported.slot === 2, 'importData 改写 slot 字段为目标槽');

  const raw = localStorage.getItem('project-mc-save-2');
  const onDisk = JSON.parse(raw);
  ok(onDisk.slot === 2 && onDisk.version === SAVE_VERSION, '落盘内容 slot/version 正确');
  ok(SaveSystem.rawSize(2) === raw.length, 'rawSize 返回原文长度');

  // 覆盖导入
  const second = sanitizeSaveData(sampleSave({ seed: 999 })).data;
  ok(SaveSystem.importData(2, second) === true, '覆盖导入成功');
  ok(SaveSystem.exportSlotRaw(2).seed === 999, '覆盖后内容更新');

  // 空槽与删除
  ok(SaveSystem.exportSlotRaw(5) === null, '空槽导出返回 null');
  SaveSystem.deleteSave(2);
  ok(!SaveSystem.hasSave(2), '删除后槽位为空');

  // 容量不足：模拟 QuotaExceededError
  const fakeQuota = {
    getItem: () => null,
    setItem: () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; },
    removeItem: () => {},
    clear: () => {},
  };
  const savedStorage = globalThis.localStorage;
  globalThis.localStorage = fakeQuota;
  ok(SaveSystem.importData(1, data) === 'quota', '容量不足返回 quota 而不是抛错');
  globalThis.localStorage = savedStorage;
}

// ── ⑫ 菜单接线绊线（Build 43 UI 面） ──
{
  const menuSrc = readFileSync(new URL('../src/ui/MenuScreen.js', import.meta.url), 'utf-8');
  ok(menuSrc.includes('id="import-save-btn"'), '单人页有导入按钮');
  ok(menuSrc.includes('id="import-file"'), '隐藏文件选择器存在');
  ok(menuSrc.includes('data-export="${s.slot}"'), '槽位渲染导出按钮');
  ok(menuSrc.includes('accept=".tidersave,.json'), '文件选择器接受 .tidersave/.json');
  ok(menuSrc.includes('this._exportSlot('), '导出按钮接到 _exportSlot');
  ok(menuSrc.includes('this._importFromFile('), '文件变更接到 _importFromFile');
  ok(menuSrc.includes('this._showImportDialog('), '解析成功进入摘要弹窗');
  ok(menuSrc.includes('URL.revokeObjectURL'), '下载对象 URL 回收');
  ok(menuSrc.includes("e.target.closest('button')"), '槽内按钮不再触发开局');
  ok(menuSrc.includes('导入将覆盖槽 {n} 的存档，确定继续吗？'), '覆盖前二次确认');
  ok(menuSrc.includes('SaveSystem.importData('), '导入落到 SaveSystem.importData');
  ok(menuSrc.includes('SaveSystem.exportSlotRaw('), '导出走 SaveSystem.exportSlotRaw');
}

// ── ⑬ i18n：B43 新键 10 包在场 ──
{
  const PACKS = { 'zh-TW': zhTW, en, fr, de, ja, ko, ar, ru, es, pt };
  const keys = [
    '导出', '导出失败：存档不可读', '已导出：{name}', '导出失败', '读取存档中…',
    '导入存档', '⬆ 导入存档', '文件：{name}', '存档摘要：{mode} · {dim} · {time}',
    '方块 {n}', '已清理 {n} 条异常数据', '选择导入到哪个存档槽', '槽 {n}（空）',
    '槽 {n}（覆盖）', '已导入到槽 {n}', '导入将覆盖槽 {n} 的存档，确定继续吗？',
    ...Object.values(SAVE_IMPORT_ERROR_KEYS),
  ];
  for (const [loc, pack] of Object.entries(PACKS)) {
    for (const k of keys) ok(Object.prototype.hasOwnProperty.call(pack, k), `[${loc}] 缺 B43 键: ${k}`);
  }
  const placeholder = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [loc, pack] of Object.entries(PACKS)) {
    for (const k of keys) {
      if (!Object.prototype.hasOwnProperty.call(pack, k)) continue;
      ok(placeholder(k) === placeholder(pack[k]), `[${loc}] 占位符不一致: ${k}`);
    }
  }
}

// ── ⑭ 版本下限（字面量钉值只在 version-pin 里，本套件只做下限断言） ──
ok(Number.isInteger(BUILD) && BUILD >= 43, `BUILD ≥ 43（当前 ${BUILD}）`);

finish('build43-save-transfer');
