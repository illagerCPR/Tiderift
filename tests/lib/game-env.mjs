// tests/lib/game-env.mjs -- src/player/Game.js 在 node 下的可跑假环境（轮 8 路标 B 探针的产品化）
//
// 定位：**共享环境模块，不是套件**。放 tests/lib/ 子目录是有意为之——
//   tests/framework-guard.mjs 用 fs.readdirSync('tests') 单层扫描 *.mjs 并把每个文件当套件
//   （断言其 import ./harness.mjs），共享模块放顶层会被误判为缺 import 的套件。
//
// 内容构成：
//   ① 最小 DOM / Canvas / WebAudio 壳（复用 tests/ui-audio-smoke.mjs 既有壳的语义）
//   ② WebGL2 Proxy 假上下文——three 的 WebGLRenderer 构造只需 16 个 GL 方法
//   ③ 进程内 Worker 仿真——TerrainWorker/MeshWorker 都是纯 self.onmessage 模块，可直接进程内跑
//   ④ Image(onload) 补丁——SVGTextures.svgToImage 靠 img.onload 推进，不触发会静默挂死
//
// 本文件只提供环境与驱动，**不定义任何断言函数**（ok / assert / check / fail / pass 一律不在此处）。
//
// 三个已实测的静默陷阱（改动本文件时勿踩）：
//   1) Game._frameRay() 的每帧缓存键是 this.frame，而 frame++ 只在 Game.loop() 里发生。
//      直接调 update() 会让射线永久冻在 boot 那一帧（表现为 selectedBlock 恒为 null）。
//      故 step() 必须镜像 loop()，替调用方执行 g.frame++。
//   2) Game.start() 全体包在 try/catch 里，失败只打一行 console.error('游戏启动失败:', e) 并让
//      running 停在 false。boot() 因此额外回传 running，调用方必须用 running 判定"启动成功"，
//      不能靠"没抛错"。
//   3) Game.loop() 末尾无条件 requestAnimationFrame 续链，只有 running=false 才会断。
//      boot() 在 start() 返回后立即 stop()，把主循环交还给调用方定步长驱动。

import { register as registerLoader } from 'node:module';

const GAME_URL = new URL('../../src/player/Game.js', import.meta.url).href;

let shellInstalled = false;

// 假 GL 不提供这两个扩展，three 每次建 WebGLRenderer 都会 warn。纯 mock 噪声（与真实行为无关），
// 按精确模式屏蔽以免淹没套件输出；其余任何 warn 原样放行。
const MOCK_GL_WARN = /^THREE\.WebGLRenderer: (EXT_blend_minmax|OES_vertex_array_object) extension not supported\.$/;

// ── 静态资源导入：Vite 语义（默认导出资源 URL 字符串）由内联 data: URL loader 复刻 ──
const ASSET_LOADER_SRC = [
  'export async function load(url, context, nextLoad) {',
  "  if (/.\\.(png|jpe?g|svg|gif|webp|css)$/.test(new URL(url).pathname)) {",
  "    return { format: 'module', shortCircuit: true, source: 'export default ' + JSON.stringify(url) + ';' };",
  '  }',
  '  return nextLoad(url, context);',
  '}',
].join('\n');

// ── ① DOM / Canvas / WebAudio 壳 ──
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

// canvas 2d：几何绘制全 no-op，渐变/图案/像素读取返回可用桩对象
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
    this._gl = null;
  }
  getContext(kind) {
    if (kind === '2d') { if (!this._ctx2d) { this._ctx2d = make2dContext(); this._ctx2d.canvas = this; } return this._ctx2d; }
    if (String(kind).indexOf('webgl') === 0) { if (!this._gl) this._gl = makeGL(); return this._gl; }
    return null;
  }
  getContextAttributes() { return GL_CONTEXT_ATTRS(); }
  toDataURL() { return 'data:image/png;base64,'; }
  toBlob(cb) { if (cb) cb(null); }
}

// 真 onload 的 Image：SVGTextures.svgToImage 靠它推进，永不触发会让 await start() 静默挂死
class LiveImage extends HTMLElement {
  constructor() {
    super('img');
    this.width = 16; this.height = 16; this.complete = true;
    this.naturalWidth = 16; this.naturalHeight = 16;
    this.crossOrigin = null;
    this.onload = null; this.onerror = null;
    this._src = '';
  }
  set src(v) {
    this._src = v;
    queueMicrotask(() => { if (this.onload) this.onload({ target: this }); });
  }
  get src() { return this._src; }
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

// WebAudio：import 期不需要真上下文（AudioEngine 首次手势后才 new AudioContext）
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

// ── ② WebGL2 Proxy 假上下文 ──
// three 的 WebGLRenderer 构造路径实测只用到 16 个 GL 方法；常量名当属性读时现分配一个稳定整数，
// 再用反查表让 getParameter/getProgramParameter 按"是哪条常量"返回合理值。
const GL_CONST = new Map();
const GL_RNAME = new Map();
let glNextConst = 1;
function glConstFor(name) {
  if (!GL_CONST.has(name)) { const v = glNextConst++; GL_CONST.set(name, v); GL_RNAME.set(v, name); }
  return GL_CONST.get(name);
}

const GL_PARAM = {
  MAX_TEXTURE_SIZE: 4096, MAX_CUBE_MAP_TEXTURE_SIZE: 4096, MAX_RENDERBUFFER_SIZE: 4096,
  MAX_TEXTURE_IMAGE_UNITS: 16, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
  MAX_VERTEX_UNIFORM_VECTORS: 1024, MAX_FRAGMENT_UNIFORM_VECTORS: 1024, MAX_VARYING_VECTORS: 30,
  MAX_VERTEX_ATTRIBS: 16, MAX_SAMPLES: 4, MAX_ARRAY_TEXTURE_LAYERS: 256,
  MAX_VERTEX_UNIFORM_BLOCKS: 12, MAX_FRAGMENT_UNIFORM_BLOCKS: 12,
  SAMPLES: 0, UNPACK_ROW_LENGTH: 0, UNPACK_SKIP_ROWS: 0, UNPACK_SKIP_PIXELS: 0,
  MAX_3D_TEXTURE_SIZE: 256, MAX_ELEMENT_INDEX: 4294967294,
};
const GL_BOOL_PARAMS = new Set(['LINK_STATUS', 'VALIDATE_STATUS', 'COMPILE_STATUS', 'DELETE_STATUS',
  'FRAMEBUFFER_COMPLETE', 'ACTIVE_UNIFORM_BLOCKS', 'SHADER_COMPILER']);

function GL_CONTEXT_ATTRS() {
  return { alpha: false, antialias: false, depth: true, stencil: true, premultipliedAlpha: true,
    preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false };
}

function glDefaultFor(prop, args) {
  switch (prop) {
    case 'getParameter': {
      const name = GL_RNAME.get(args[0]);
      if (name === 'VERSION') return 'WebGL 2.0 (mock)';
      if (name === 'SHADING_LANGUAGE_VERSION') return 'WebGL GLSL ES 3.00 (mock)';
      if (name === 'VENDOR' || name === 'RENDERER') return 'mock';
      if (name && GL_BOOL_PARAMS.has(name)) return true;
      return GL_PARAM[name] !== undefined ? GL_PARAM[name] : 4096;
    }
    case 'getExtension': return null;
    case 'getShaderPrecisionFormat': return { rangeMin: 127, rangeMax: 127, precision: 23 };
    case 'getProgramParameter':
    case 'getShaderParameter': {
      const name = GL_RNAME.get(args[1]);
      if (name === 'ACTIVE_UNIFORMS' || name === 'ACTIVE_ATTRIBUTES' || name === 'ACTIVE_UNIFORM_BLOCKS') return 0;
      return true;
    }
    case 'getProgramInfoLog': case 'getShaderInfoLog': return '';
    case 'getError': return 0;
    case 'isContextLost': return false;
    case 'getUniformLocation': case 'getAttribLocation': return null;
    case 'getActiveUniform': case 'getActiveAttrib': return null;
    case 'createShader': case 'createProgram': case 'createBuffer': case 'createTexture':
    case 'createFramebuffer': case 'createRenderbuffer': case 'createVertexArray':
    case 'createQuery': case 'createSampler': case 'createTransformFeedback': return {};
    case 'getSupportedExtensions': return [];
    case 'checkFramebufferStatus': return 36053;
    case 'getContextAttributes': return GL_CONTEXT_ATTRS();
    case 'fenceSync': return {};
    case 'clientWaitSync': return 37146;
    default: return undefined;
  }
}

function makeGL() {
  const t = {};
  return new Proxy(t, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in t) return t[prop];
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return glConstFor(prop);
      const fn = (...args) => glDefaultFor(prop, args);
      t[prop] = fn;
      return fn;
    },
  });
}

// ── ③ 进程内 Worker 仿真 ──
// TerrainWorker.js / MeshWorker.js 都是纯 self.onmessage + self.postMessage、零 DOM 的模块，
// 可在主进程直接求值。每个 Worker 实例用带查询串的 URL 重新求值以取得独立模块实例，
// 再用 current 指针把全局 self 路由到"当前正在求值 / 正在派发消息"的那个实例。
let workerSeq = 0;
let workerCurrent = null;
let workerChain = Promise.resolve();

export const workerStats = { created: 0, failed: 0, errors: [] };

const SELF_PROXY = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'postMessage') return (data) => { if (workerCurrent) workerCurrent._emit(data); };
    if (prop === 'onmessage') return workerCurrent ? workerCurrent._handler : null;
    if (prop === 'addEventListener') return (type, fn) => { if (workerCurrent && type === 'message') workerCurrent._handler = (e) => fn(e); };
    if (prop === 'removeEventListener') return () => {};
    if (prop === 'location') return { href: 'file:///mock-worker', origin: 'file://' };
    if (prop === 'close') return () => {};
    if (prop === 'name') return workerCurrent ? workerCurrent._name : '';
    return undefined;
  },
  set(_t, prop, v) {
    if (prop === 'onmessage') { if (workerCurrent) workerCurrent._handler = v; return true; }
    return true;
  },
});

function installWorker() {
  class WorkerStub {
    constructor(url) {
      this._name = 'w' + (++workerSeq);
      this._handler = null;   // worker 模块内 self.onmessage 赋的处理器
      this._queue = [];       // 模块就绪前客户端发来的消息
      this.onmessage = null;  // 客户端处理器（与 _handler 分槽，避免互相覆盖）
      this.onerror = null;
      this._terminated = false;
      workerStats.created++;
      const u = new URL(url);
      u.searchParams.set('__w', this._name);
      const self = this;
      workerChain = workerChain.then(async () => {
        const prev = workerCurrent; workerCurrent = self;
        try {
          await import(u.href);
        } catch (err) {
          workerStats.failed++;
          workerStats.errors.push(this._name + ': ' + (err && err.message));
          queueMicrotask(() => { if (self.onerror) self.onerror({ message: String((err && err.message) || err) }); });
        } finally {
          workerCurrent = prev;
        }
        if (self._terminated) return;
        for (const m of self._queue) self._dispatch(m);
        self._queue.length = 0;
      });
    }
    _emit(data) { queueMicrotask(() => { if (!this._terminated && this.onmessage) this.onmessage({ data }); }); }
    _dispatch(m) {
      const prev = workerCurrent; workerCurrent = this;
      try { if (this._handler) this._handler({ data: m }); } finally { workerCurrent = prev; }
    }
    postMessage(data) {
      if (this._terminated) return;
      if (!this._handler) this._queue.push(data);
      else this._dispatch(data);
    }
    terminate() { this._terminated = true; }
  }
  globalThis.Worker = WorkerStub;
  globalThis.self = SELF_PROXY;
}

// ── 组装 ──
function installShell() {
  if (shellInstalled) return;
  shellInstalled = true;

  registerLoader('data:text/javascript,' + encodeURIComponent(ASSET_LOADER_SRC));

  const origWarn = console.warn;
  console.warn = (...a) => {
    if (MOCK_GL_WARN.test(a.map(String).join(' '))) return;
    origWarn.apply(console, a);
  };

  const htmlEl = new HTMLElement('html');
  const headEl = new HTMLElement('head');
  const bodyEl = new HTMLElement('body');
  htmlEl.appendChild(headEl); htmlEl.appendChild(bodyEl);

  const stubEl = (id) => { const e = new HTMLElement('div'); e.id = id; return e; };
  globalThis.document = {
    createElement: (tag) => (String(tag).toLowerCase() === 'canvas' ? new HTMLCanvasElement() : new HTMLElement(tag)),
    createElementNS: (ns, tag) => globalThis.document.createElement(tag),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    createDocumentFragment: () => new HTMLElement('#fragment'),
    querySelector: () => null, querySelectorAll: () => [],
    // index.html 里真实存在的两个加载节点：给桩以覆盖 start() 的加载界面路径，其余按真实返回 null
    getElementById: (id) => (id === 'loading' || id === 'load-fill') ? stubEl(id) : null,
    getElementsByTagName: () => [], getElementsByClassName: () => [],
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

  // node 24 自带只读 navigator 全局 getter，必须用 defineProperty 覆盖
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'node-game-env', language: 'zh-CN', languages: ['zh-CN', 'en'], platform: 'linux', clipboard: null, maxTouchPoints: 0, onLine: false } });
  globalThis.localStorage = new FakeStorage();
  globalThis.window.localStorage = globalThis.localStorage;
  globalThis.window.navigator = globalThis.navigator;

  globalThis.HTMLElement = HTMLElement;
  globalThis.HTMLCanvasElement = HTMLCanvasElement;
  globalThis.Element = HTMLElement;
  globalThis.Node = HTMLElement;
  globalThis.Image = LiveImage;
  globalThis.window.Image = LiveImage;
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.matchMedia = globalThis.window.matchMedia;
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;

  if (typeof globalThis.URL.createObjectURL !== 'function') {
    let n = 0;
    globalThis.URL.createObjectURL = () => 'blob:mock/' + (++n);
    globalThis.URL.revokeObjectURL = () => {};
  }

  globalThis.AudioContext = FakeAudioContext;
  globalThis.window.AudioContext = FakeAudioContext;

  installWorker();
}

let gameClassPromise = null;

/** 取得 Game 类（首次调用时装壳并 import；必须在壳装好之后再求值 Game.js 模块体）。 */
export function gameClass() {
  installShell();
  if (!gameClassPromise) gameClassPromise = import(GAME_URL).then((ns) => ns.Game);
  return gameClassPromise;
}

/** 只装环境、只构造 Game，不调用 start()——用于"主菜单期"契约断言。 */
export async function createGame() {
  const Game = await gameClass();
  const errs = [];
  const origError = console.error;
  console.error = (...a) => { errs.push(a.map(String).join(' ')); };
  let g;
  try {
    g = new Game(globalThis.document.createElement('div'));
  } finally {
    console.error = origError;
  }
  const snapshot = { created: workerStats.created, failed: workerStats.failed, errors: workerStats.errors.slice() };
  return { g, errs, workerStats: snapshot, running: false };
  // workerStats 是模块级累计量，createGame/boot 各自按调用前后的差值回报
}

/**
 * 启动一个可跑的假环境。
 * 返回 { g, errs, workerStats, running }：
 *   - running 是 start() 返回那一刻的 g.running（start 内部吞异常，必须用它判定成功）
 *   - errs 是 start 期间捕获的全部 console.error 文本（调用方按需窄化已知良性噪声）
 * 返回前已 g.stop()，主循环交给调用方用 step() 定步长驱动。
 */
export async function boot(opts = {}) {
  const Game = await gameClass();
  const before = { created: workerStats.created, failed: workerStats.failed };
  const errs = [];
  const origError = console.error;
  console.error = (...a) => { errs.push(a.map(String).join(' ')); };
  let g;
  let running = false;
  try {
    g = new Game(globalThis.document.createElement('div'));
    await g.start(opts.mode || 'creative', opts.seed === undefined ? 12345 : opts.seed,
      opts.loadData || null, opts.slot === undefined ? 1 : opts.slot,
      opts.cheats === undefined ? true : opts.cheats);
    running = g.running === true;
    g.stop();
  } finally {
    console.error = origError;
  }
  const snapshot = {
    created: workerStats.created - before.created,
    failed: workerStats.failed - before.failed,
    errors: workerStats.errors.slice(),
  };
  return { g, errs, workerStats: snapshot, running };
}

/**
 * 定步长驱动 N 帧。返回异常描述数组（空数组 = 全程无异常）。
 * 关键：先 g.frame++ 再 update()——镜像 Game.loop()，否则 _frameRay() 的每帧缓存永不失效。
 */
export async function step(g, frames, dt = 1 / 60, drainEvery = 10) {
  const bad = [];
  const durations = [];
  for (let i = 0; i < frames; i++) {
    g.frame++;
    const t0 = performance.now();
    try { g.update(dt); } catch (e) { bad.push('frame ' + i + ': ' + (e && e.message)); if (bad.length > 3) break; }
    durations.push(performance.now() - t0);
    if (drainEvery > 0 && i % drainEvery === drainEvery - 1) await new Promise((r) => setTimeout(r, 0));
  }
  step.lastDurations = durations;
  return bad;
}

/** 等 worker 在途请求归零（让"刚构建完的 mesh"全部落地），供泄漏/稳态快照使用。 */
export async function quiesce(g, maxIters = 400) {
  for (let i = 0; i < maxIters; i++) {
    const w = g && g.world;
    const tp = w && w.terrainWorker ? w.terrainWorker._pending.size : 0;
    const mp = w && w.meshWorker ? w.meshWorker._pending.size : 0;
    if (tp === 0 && mp === 0 && i > 20) return i;
    await new Promise((r) => setTimeout(r, 0));
  }
  return -1;
}

/** 关停：停主循环 + 释放两个 worker（不留悬空句柄）。 */
export function shutdown(g) {
  if (!g) return;
  try { g.stop(); } catch { /* 已停 */ }
  try {
    if (g.world) {
      if (g.world.terrainWorker) g.world.terrainWorker.dispose();
      if (g.world.meshWorker) g.world.meshWorker.dispose();
    }
  } catch { /* worker 已释放 */ }
}
