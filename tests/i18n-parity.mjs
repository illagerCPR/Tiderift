// i18n-parity.mjs -- 语言包三重校验回归（node 直跑，无需服务器；天域批次 A 固化）
// ① 键集对齐：10 语言包键集两两一致（防漏译/拼错键）
// ② 占位符对齐：每个键的 {x} 占位符多重集 = 每个译文的多重集（防占位符丢失/改名）
// ③ 覆盖审计（扩展审计）：静态 t('...') 键 ∪ 动态键表（群系名/碑文/lore/信标/分类标签）
//    ⊆ 每个语言包的键集 —— 动态路径（t(table[key])）是静态扫描盲区，必须显式并集
// 用法：node tests/i18n-parity.mjs（CI 经 server/run-all-tests.sh 调用）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { STELE_CHAPTERS, STELE_BLANK } from '../src/world/steles.js';
import { BEACON_EFFECTS } from '../src/ui/BeaconScreen.js';
import { CATEGORY_LABEL_KEYS } from '../src/core/ItemCategories.js';
import { BiomeNames } from '../src/world/biomes.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { AetherGenerator } from '../src/world/dimensions/aether.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { EndGenerator } from '../src/world/dimensions/end.js';
import { ok, finish } from './harness.mjs';

const PACKS = { 'zh-TW': zhTW, en, fr, de, ja, ko, ar, ru, es, pt };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 收集键源 ──
const staticKeys = new Set();
function scanDir(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { scanDir(p); continue; }
    if (!name.endsWith('.js')) continue;
    // 语言包自身不参与 t() 扫描
    if (p.includes(join('src', 'i18n', 'locales'))) continue;
    const text = readFileSync(p, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*')) continue; // 整行注释跳过
      for (const m of line.matchAll(/\bt\(\s*'((?:[^'\\\n]|\\.)*)'/g)) {
        staticKeys.add(m[1].replace(/\\'/g, "'"));
      }
    }
  }
}
scanDir(join(ROOT, 'src'));

// 动态键表（t(表[key]) 路径）
const dynamicKeys = new Set();
function addAll(arr) { for (const v of arr) if (v) dynamicKeys.add(String(v)); }
addAll(Object.values(BiomeNames));
for (const Gen of [TerrainGenerator, AetherGenerator, NetherGenerator, EndGenerator]) {
  const gen = new Gen(20250914);
  if (gen.biomeNames) addAll(Object.values(gen.biomeNames));
}
for (const ch of Object.values(STELE_CHAPTERS)) { dynamicKeys.add(ch.title); addAll(ch.lines); }
dynamicKeys.add(STELE_BLANK.title); addAll(STELE_BLANK.lines);
for (const item of ItemRegistry.all()) if (item.lore) addAll(item.lore);
for (const b of BlockRegistry.all()) if (b.lore) addAll(b.lore); // 世界观批次 N1：方块 lore
for (const [, label, desc] of BEACON_EFFECTS) { dynamicKeys.add(label); dynamicKeys.add(desc); }
addAll(Object.values(CATEGORY_LABEL_KEYS));

const master = new Set([...staticKeys, ...dynamicKeys]);
ok(master.size > 100, 'master key count sane (got ' + master.size + ')');

// ── ① 键集对齐 ──
const keySets = Object.entries(PACKS).map(([loc, pack]) => [loc, new Set(Object.keys(pack))]);
const [baseLoc, baseSet] = keySets[0];
for (const [loc, set] of keySets.slice(1)) {
  for (const k of baseSet) ok(set.has(k), `[${loc}] 缺键: ${k}`);
  for (const k of set) ok(baseSet.has(k), `[${loc}] 多余键: ${k}`);
}

// ── ② 占位符多重集对齐 ──
function placeholders(s) {
  const out = [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  return out;
}
for (const [loc, pack] of Object.entries(PACKS)) {
  for (const [k, v] of Object.entries(pack)) {
    ok(placeholders(k) === placeholders(v), `[${loc}] 占位符不一致: ${k} (${placeholders(k)} vs ${placeholders(v)})`);
  }
}

// ── ③ 覆盖审计 ──
for (const [loc, pack] of Object.entries(PACKS)) {
  for (const k of master) ok(Object.prototype.hasOwnProperty.call(pack, k), `[${loc}] 审计缺键: ${k}`);
}

// 语言包文件内重复键检测（对象字面量静默覆盖不会报错，必须文本级扫描）
for (const loc of Object.keys(PACKS)) {
  const text = readFileSync(join(ROOT, 'src', 'i18n', 'locales', loc + '.js'), 'utf8');
  const seen = new Map();
  for (const m of text.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)) {
    const key = m[1].replace(/\\'/g, "'");
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [k, n] of seen) ok(n === 1, `[${loc}] 重复键 ×${n}: ${k}`);
}
finish(`i18n-parity (master=${master.size} static=${staticKeys.size} dynamic=${dynamicKeys.size})`);
