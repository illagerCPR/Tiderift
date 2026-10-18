// ui-audio-smoke.mjs -- src/ui 与 src/audio 的 import 冒烟（审计 E6 覆盖空白，node 直跑，无需服务器）
// 断言：
//   ① 磁盘清单：src/ui/*.js 与 src/audio/*.js 全量从 readdirSync 发现（新增文件自动进入范围）
//   ② 逐模块 import：命名空间非空（挡住"模块被删/顶层语法或引用炸/循环依赖炸"）
//   ③ 静态资源 import：MenuScreen 的 logo png / Panorama 的六面 jpg 逐个 import，默认导出 URL 非空
//   ④ 跨模块具名导入核对：扫描 src/**/*.js 的静态 import，断言每个被导入名在目标模块命名空间里存在
//      （挡住"导出被改名/删除而调用方没跟着改"）
//   ⑤ 扫描器自检与命中数下限：防解析器静默失效导致核对恒真
// 最小 DOM 壳在 import 之前装好；壳撑不住 WebGL 等真浏览器能力时不得静默跳过，须显式列到用例里。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as registerLoader } from 'node:module';
import { assert, finish } from './harness.mjs';

// 静态资源导入（MenuScreen 的 logo png、Panorama 的六面 jpg）由 Vite 处理成"默认导出 URL 字符串"，
// node 原生 ESM 不认这些扩展名。注册一个内联（data: URL）最小 loader 复刻 Vite 语义，
// 使这些模块可在 node 下 import；不改动任何工程文件。
const assetLoaderSrc = [
  'export async function load(url, context, nextLoad) {',
  "  if (/\.(png|jpe?g|svg|gif|webp|css)$/.test(new URL(url).pathname)) {",
  "    return { format: 'module', shortCircuit: true, source: 'export default ' + JSON.stringify(url) + ';' };",
  '  }',
  '  return nextLoad(url, context);',
  '}',
].join('\n');
registerLoader('data:text/javascript,' + encodeURIComponent(assetLoaderSrc));

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const uiDir = path.join(SRC, 'ui');
const audioDir = path.join(SRC, 'audio');

// ── 最小 DOM / Canvas / WebAudio 壳（在 import 之前装好）──
function makeStyle() {
  const props = new Map();
  return {
    setProperty: (k, v) => props.set(k, String(v)),
    removeProperty: (k) => props.delete(k),
    getPropertyValue: (k) => props.get(k) || '',
    cssText: '',
  };
}

class FakeClassList {
  constructor() { this._set = new Set(); }
  add(...c) { for (const x of c) this._set.add(x); }
  remove(...c) { for (const x of c) this._set.delete(x); }
  toggle(c, force) {
    const on = force === undefined ? !this._set.has(c) : !!force;
    if (on) this._set.add(c); else this._set.delete(c);
    return on;
  }
  contains(c) { return this._set.has(c); }
  item(i) { return [...this._set][i] ?? null; }
  get length() { return this._set.size; }
  toString() { return [...this._set].join(' '); }
}

class HTMLElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1;
    this.id = ''; this.className = ''; this.innerHTML = ''; this.outerHTML = '';
    this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false;
    this.hidden = false; this.title = ''; this.src = ''; this.href = ''; this.type = '';
    this.placeholder = ''; this.maxLength = 0; this.selectedIndex = -1; this.scrollTop = 0;
    this.offsetWidth = 0; this.offsetHeight = 0; this.clientWidth = 0; this.clientHeight = 0;
    this.scrollWidth = 0; this.scrollHeight = 0;
    this.style = makeStyle();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.attributes = [];
    this.children = []; this.childNodes = [];
    this.parentNode = null; this.parentElement = null;
    this.firstChild = null; this.lastChild = null;
    this.ownerDocument = globalThis.document;
    this._listeners = new Map();
  }
  appendChild(c) { this.children.push(c); this.childNodes.push(c); if (c) c.parentNode = this; return c; }
  append(...c) { for (const x of c) this.appendChild(x); }
  insertBefore(c) { return this.appendChild(c); }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...c) { this.children = []; this.childNodes = []; this.append(...c); }
  setAttribute(k, v) { if (k === 'class') this.className = String(v); else if (k === 'id') this.id = String(v); this.attributes.push({ name: k, value: String(v) }); }
  getAttribute(k) { const a = this.attributes.find((x) => x.name === k); return a ? a.value : null; }
  hasAttribute(k) { return this.attributes.some((x) => x.name === k); }
  removeAttribute(k) { this.attributes = this.attributes.filter((x) => x.name !== k); }
  addEventListener(type, fn) { if (!this._listeners.has(type)) this._listeners.set(type, []); this._listeners.get(type).push(fn); }
  removeEventListener(type, fn) { const l = this._listeners.get(type); if (l) this._listeners.set(type, l.filter((x) => x !== fn)); }
  dispatchEvent() { return true; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getElementsByTagName() { return []; }
  getElementsByClassName() { return []; }
  closest() { return null; }
  contains() { return false; }
  matches() { return false; }
  cloneNode() { return new HTMLElement(this.tagName); }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  focus() {} blur() {} click() {} animate() { return { cancel() {}, finished: Promise.resolve() }; }
  scrollIntoView() {} insertAdjacentHTML() {} setPointerCapture() {} releasePointerCapture() {}
  requestPointerLock() {} requestFullscreen() { return Promise.resolve(); }
}

// canvas 2d 上下文：几何绘制全 no-op，渐变/图案/像素读取返回可用桩对象
function make2dContext() {
  const noop = () => {};
  return {
    canvas: null, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt',
    lineJoin: 'miter', globalAlpha: 1, globalCompositeOperation: 'source-over',
    font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
    shadowBlur: 0, shadowColor: '#000', imageSmoothingEnabled: true,
    miterLimit: 10, lineDashOffset: 0, direction: 'inherit',
    save: noop, restore: noop, scale: noop, rotate: noop, translate: noop, transform: noop,
    setTransform: noop, resetTransform: noop, setLineDash: noop, getLineDash: () => [],
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, ellipse: noop, rect: noop, roundRect: noop,
    fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop, measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    drawImage: noop, putImageData: noop, drawFocusIfNeeded: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createConicGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({ setTransform: noop }),
    createImageData: (w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
    getImageData: (x = 0, y = 0, w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false, isPointInStroke: () => false,
  };
}

class HTMLCanvasElement extends HTMLElement {
  constructor(tagName = 'canvas') {
    super(tagName);
    this.width = 300; this.height = 150;
    this._ctx2d = null;
  }
  getContext(kind) {
    if (kind === '2d') { if (!this._ctx2d) { this._ctx2d = make2dContext(); this._ctx2d.canvas = this; } return this._ctx2d; }
    return null; // webgl/webgl2：node 无真上下文（import 期不需要，见文件头说明）
  }
  toDataURL() { return 'data:image/png;base64,'; }
  toBlob(cb) { if (cb) cb(null); }
}

class FakeImage extends HTMLElement {
  constructor() { super('img'); this.width = 0; this.height = 0; this.complete = true; this.naturalWidth = 0; this.naturalHeight = 0; this.crossOrigin = null; }
}

class FakeStorage {
  constructor() { this._m = new Map(); }
  getItem(k) { return this._m.has(String(k)) ? this._m.get(String(k)) : null; }
  setItem(k, v) { this._m.set(String(k), String(v)); }
  removeItem(k) { this._m.delete(String(k)); }
  clear() { this._m.clear(); }
  key(i) { return [...this._m.keys()][i] ?? null; }
  get length() { return this._m.size; }
}

const htmlEl = new HTMLElement('html');
const headEl = new HTMLElement('head');
const bodyEl = new HTMLElement('body');
htmlEl.appendChild(headEl); htmlEl.appendChild(bodyEl);
globalThis.document = {
  createElement: (tag) => (String(tag).toLowerCase() === 'canvas' ? new HTMLCanvasElement() : new HTMLElement(tag)),
  createElementNS: (ns, tag) => globalThis.document.createElement(tag),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
  createDocumentFragment: () => new HTMLElement('#fragment'),
  querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => null, getElementsByTagName: () => [], getElementsByClassName: () => [],
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
  documentElement: htmlEl, head: headEl, body: bodyEl,
  title: '', hidden: false, visibilityState: 'visible', readyState: 'complete',
  pointerLockElement: null, fullscreenElement: null, cookie: '',
  exitPointerLock: () => {}, exitFullscreen: () => {}, fonts: { ready: Promise.resolve() },
};
globalThis.window = {
  document: globalThis.document, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  location: { href: 'http://localhost/', hostname: 'localhost', protocol: 'http:', search: '' },
  localStorage: null, navigator: null, AudioContext: null, webkitAudioContext: null,
};
globalThis.self = globalThis.window;
// node 24 自带只读 navigator 全局 getter，必须用 defineProperty 覆盖
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'node-smoke', language: 'zh-CN', languages: ['zh-CN', 'en'], platform: 'linux', clipboard: null, maxTouchPoints: 0, onLine: false } });
globalThis.localStorage = new FakeStorage();
globalThis.window.localStorage = globalThis.localStorage;   // 有的模块走 window.localStorage
globalThis.window.navigator = globalThis.navigator;
globalThis.HTMLElement = HTMLElement;
globalThis.HTMLCanvasElement = HTMLCanvasElement;
globalThis.Element = HTMLElement;
globalThis.Node = HTMLElement;
globalThis.Image = FakeImage;
globalThis.getComputedStyle = globalThis.window.getComputedStyle;
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
// WebAudio：import 期不需要真上下文（AudioEngine 首次手势后才 new AudioContext），给出可辨识的桩
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.destination = { connect: () => {}, disconnect: () => {} }; }
  createGain() { return { gain: { value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {} }, connect: () => {}, disconnect: () => {} }; }
  createOscillator() { return { type: 'sine', frequency: { value: 440, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {}, disconnect: () => {}, start: () => {}, stop: () => {} }; }
  createBiquadFilter() { return { type: 'lowpass', frequency: { value: 350, setValueAtTime: () => {} }, Q: { value: 1, setValueAtTime: () => {} }, connect: () => {}, disconnect: () => {} }; }
  createBufferSource() { return { buffer: null, loop: false, playbackRate: { value: 1 }, connect: () => {}, disconnect: () => {}, start: () => {}, stop: () => {} }; }
  createBuffer(ch, len, rate) { return { length: len, sampleRate: rate, numberOfChannels: ch, getChannelData: () => new Float32Array(len) }; }
  createStereoPanner() { return { pan: { value: 0 }, connect: () => {}, disconnect: () => {} }; }
  createPanner() { return { connect: () => {}, disconnect: () => {}, positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } }; }
  resume() { return Promise.resolve(); }
}
globalThis.AudioContext = FakeAudioContext;
globalThis.window.AudioContext = FakeAudioContext;

// ── ① 磁盘清单（新增文件自动进入冒烟范围）──
const listJs = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const uiFiles = listJs(uiDir);
const audioFiles = listJs(audioDir);
assert('src/ui 磁盘清单非空（发现 ' + uiFiles.length + ' 个 .js）', uiFiles.length >= 20, '[' + uiFiles.length + ']');
assert('src/audio 磁盘清单非空（发现 ' + audioFiles.length + ' 个 .js）', audioFiles.length >= 1, '[' + audioFiles.length + ']');

// ── ② 逐模块 import 冒烟 ──
const namespaces = new Map(); // 绝对路径 -> 命名空间
async function smokeDir(dir, files, label) {
  for (const f of files) {
    const abs = path.join(dir, f);
    const rel = path.relative(fileURLToPath(new URL('../', import.meta.url)), abs).split(path.sep).join('/');
    try {
      const ns = await import(pathToFileURL(abs).href);
      namespaces.set(abs, ns);
      const names = Object.keys(ns);
      assert(rel + ' 可 import 且导出非空（' + names.length + ' 导出）', names.length >= 1, names.length ? '' : '空命名空间');
    } catch (err) {
      assert(rel + ' 可 import 且导出非空（' + label + '）', false, 'import 抛错: ' + (err && err.message ? err.message : String(err)));
    }
  }
}
await smokeDir(uiDir, uiFiles, 'ui');
await smokeDir(audioDir, audioFiles, 'audio');

// ── ④ 跨模块具名导入核对（扫描 src/**/*.js，自动维护）──
function walkJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const targets = new Map(); // 绝对路径 -> 相对仓库路径（仅 ui/audio 目录）
for (const f of uiFiles) targets.set(path.join(uiDir, f), 'src/ui/' + f);
for (const f of audioFiles) targets.set(path.join(audioDir, f), 'src/audio/' + f);

// ── ③ 静态资源 import 冒烟（Vite 语义：默认导出资源 URL 字符串；由上面的内联 loader 桩提供）──
const assetImports = [];
const ASSET_IMPORT_RE = /^\s*import\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+\.(?:png|jpe?g|svg|gif|webp|css))['"]/gm;
for (const file of walkJs(SRC)) {
  for (const m of fs.readFileSync(file, 'utf-8').matchAll(ASSET_IMPORT_RE)) {
    assetImports.push({ from: 'src/' + path.relative(SRC, file).split(path.sep).join('/'), spec: m[1], abs: fileURLToPath(new URL(m[1], pathToFileURL(file))) });
  }
}
assert('静态资源导入发现 ≥ 7 处（当前 ' + assetImports.length + '）', assetImports.length >= 7, '[' + assetImports.length + ']');
for (const a of assetImports) {
  try {
    const ns = await import(pathToFileURL(a.abs).href);
    assert(a.from + ' 的资源导入 ' + a.spec + ' 默认导出为非空 URL 字符串', typeof ns.default === 'string' && ns.default.length > 0, 'default=' + String(ns.default).slice(0, 60));
  } catch (err) {
    assert(a.from + ' 的资源导入 ' + a.spec + ' 默认导出为非空 URL 字符串', false, 'import 抛错: ' + (err && err.message ? err.message : String(err)));
  }
}

const IMPORT_RE = /^\s*import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm;
const NAMED_RE = /\{([^}]*)\}/;

// 解析一段源码里的静态 import，筛出指向 src/ui、src/audio 的具名/默认导入
function scanImports(text, file) {
  const out = [];
  const fromRel = path.relative(SRC, file).split(path.sep).join('/');
  for (const m of text.matchAll(IMPORT_RE)) {
    const clause = m[1];
    const spec = m[2];
    if (!spec.endsWith('.js')) continue;
    let abs;
    try { abs = fileURLToPath(new URL(spec, pathToFileURL(file))); } catch { continue; }
    if (!targets.has(abs)) continue;
    const toRel = targets.get(abs);
    if (/^\s*\*\s+as\s/.test(clause)) continue; // 命名空间导入：非具名，跳过
    if (!clause.trim().startsWith('{') && /^[A-Za-z_$][\w$]*\s*(,|$)/.test(clause.trim())) {
      out.push({ fromRel: 'src/' + fromRel, toRel, name: 'default' });
    }
    const named = clause.match(NAMED_RE);
    if (named) {
      for (const raw of named[1].split(',')) {
        const t = raw.trim();
        if (!t) continue;
        const name = t.split(/\s+as\s+/)[0].trim(); // 'a as b' 取被导入原名 a
        if (name) out.push({ fromRel: 'src/' + fromRel, toRel, name });
      }
    }
  }
  return out;
}

// 扫描器自检：默认导入→default、具名 as 取原名、命名空间导入跳过（防解析器静默失效）
{
  const st = scanImports(
    "import Anything from '../ui/Hud.js';\nimport { InfoBar, Hotbar as HB } from '../ui/Hotbar.js';\nimport * as NS from '../ui/Hud.js';\n",
    path.join(SRC, 'player', 'Game.js'));
  const got = st.map((f) => f.name + '@' + f.toRel).sort().join(' ');
  const want = ['default@src/ui/Hud.js', 'InfoBar@src/ui/Hotbar.js', 'Hotbar@src/ui/Hotbar.js'].sort().join(' ');
  assert('导入扫描器自检（默认导入→default / as 取原名 / 命名空间跳过）：' + got, got === want, '期望 [' + want + ']');
}

const findings = [];
for (const file of walkJs(SRC)) findings.push(...scanImports(fs.readFileSync(file, 'utf-8'), file));
// ── ⑤ 扫描命中数下限（防解析器静默失效导致核对恒真）──
assert('跨模块具名导入扫描命中 ≥ 20 条（扫描器未失效，当前 ' + findings.length + '）', findings.length >= 20, '[' + findings.length + ']');
assert('跨模块具名导入覆盖到 src/ui 与 src/audio 两侧', new Set(findings.map((f) => f.toRel.split('/')[1])).size === 2, '[' + [...new Set(findings.map((f) => f.toRel.split('/')[1]))].join(',') + ']');

for (const f of findings) {
  const ns = namespaces.get(path.join(SRC, f.toRel.slice(4)));
  if (!ns) { assert(f.fromRel + ' → ' + f.toRel + '：' + f.name + '（目标模块 import 失败，见上）', false); continue; }
  assert(f.fromRel + ' → ' + f.toRel + ' 的' + (f.name === 'default' ? '默认导出' : '具名导出') + ' ' + f.name + ' 存在', f.name in ns);
}

finish('ui-audio-smoke');
