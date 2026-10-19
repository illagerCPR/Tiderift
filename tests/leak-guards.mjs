// leak-guards.mjs -- 资源释放回归守卫（B30 修复批次二 + 轮 6 F5）：unloadChunk 三 mesh 释放、光标层组合件契约、_disposeWorld 单点收口
// 用法：node tests/leak-guards.mjs（纯 node，不依赖浏览器与服务器）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/core/World.js';
import { CursorOverlay, cursorPos, tooltipPos, tooltipContent } from '../src/ui/CursorOverlay.js';
import { ChestScreen } from '../src/ui/ChestScreen.js';
import { FurnaceScreen } from '../src/ui/FurnaceScreen.js';
import { InventoryScreen } from '../src/ui/InventoryScreen.js';
import { TradeScreen } from '../src/ui/TradeScreen.js';
import { getDisplayName } from '../src/ui/itemName.js';
import { assert, finish } from './harness.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const count = (s, sub) => s.split(sub).length - 1;

// F2：unloadChunk 必须释放 solid / water / light 三个 geometry（借原型造实例，不跑构造器）
const calls = [];
const spy = (tag) => ({ geometry: { dispose() { calls.push(tag); } } });
const w = Object.create(World.prototype);
w.key = (cx, cz) => `${cx},${cz}`;
w.chunks = new Map([['3,-7', { cx: 3, cz: -7, mesh: spy('solid'), waterMesh: spy('water'), lightMesh: spy('light') }]]);
w.unloadChunk(3, -7);
assert('unloadChunk 释放 solid/water/light 三个 geometry', calls.length === 3 && ['solid', 'water', 'light'].every((t) => calls.includes(t)), calls.join(','));
assert('unloadChunk 从 chunks 移除区块', w.chunks.size === 0);

// 边界：只有 solid / 无任何 mesh / 未加载区块均不得抛错
calls.length = 0;
w.chunks.set('0,0', { cx: 0, cz: 0, mesh: spy('only-solid') });
w.unloadChunk(0, 0);
let threw = false;
try { w.chunks.set('1,1', { cx: 1, cz: 1 }); w.unloadChunk(1, 1); w.unloadChunk(9, 9); } catch { threw = true; }
assert('边界用例不抛错（缺 lightMesh / 无 mesh / 未加载区块）', !threw && calls.length === 1, calls.join(','));

const inv = read('src/ui/InventoryScreen.js');
const game = read('src/player/Game.js');
const chunkMesh = read('src/render/ChunkMesh.js');
const svgTextures = read('src/render/SVGTextures.js');
const panorama = read('src/render/PanoramaBake.js');
const cursor = read('src/ui/CursorOverlay.js');
const uiFiles = ['src/ui/ChestScreen.js', 'src/ui/FurnaceScreen.js', 'src/ui/InventoryScreen.js', 'src/ui/TradeScreen.js'];

// F5：光标层实现只存在于 CursorOverlay.js，四个 Screen 只调用组合件、释放收口到组合件
assert('InventoryScreen 光标层移交 CursorOverlay 组合件', /this\.cursor = new CursorOverlay\(/.test(inv));
assert('InventoryScreen dispose 幂等（_disposed 守卫）', /dispose\(\)\s*\{\s*if \(this\._disposed\) return;/.test(inv));
assert('CursorOverlay 提供光标层全部入口', ['bindHover(', 'clearHover()', 'setItem(', 'dispose()', "document.removeEventListener('mousemove'"].every((s) => cursor.includes(s)));
for (const file of uiFiles) {
  const name = file.replace('src/ui/', '');
  const src = read(file);
  assert(`${name} 无自建 document 级光标监听`, !/document\.addEventListener\('(mousemove|contextmenu)'/.test(src));
  assert(`${name} 无自建光标层 DOM 字段`, !src.includes('this.cursorEl') && !src.includes('this.tooltip') && !src.includes('_bindHover('));
  assert(`${name} dispose 幂等并收口到组合件`, /dispose\(\)\s*\{\s*if \(this\._disposed\) return;/.test(src) && src.includes('this.cursor.dispose();'));
  assert(`${name} 离场清空悬浮态`, src.includes('this.cursor.clearHover();'));
}

// F5：组合件纯逻辑（坐标换算 / tooltip 内容）——不依赖浏览器
assert('cursorPos 图标居中跟随鼠标', JSON.stringify(cursorPos(100, 50)) === JSON.stringify({ left: 78, top: 28 }), JSON.stringify(cursorPos(100, 50)));
assert('tooltipPos 相对鼠标偏移 +14', JSON.stringify(tooltipPos(100, 50)) === JSON.stringify({ left: 114, top: 64 }), JSON.stringify(tooltipPos(100, 50)));
const title = getDisplayName('stone');
const plainTip = tooltipContent('stone');
assert('tooltipContent 无 lore 走纯文本名称', plainTip.text === title && plainTip.html === undefined, plainTip.text);
const loreTip = tooltipContent('stone', ['古老的低语']);
assert('tooltipContent 有 lore 走富文本残文行', typeof loreTip.html === 'string' && loreTip.html.includes(title) && loreTip.html.includes('古老的低语') && loreTip.text === undefined, loreTip.html);

// F5：组合件契约（最小 DOM 桩，纯 node 验证监听器成对与 dispose 幂等）
const documentStub = () => {
  const listeners = new Map();
  const removed = [];
  const makeEl = () => ({
    style: {}, textContent: '', children: [], _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this.children.length = 0; }, // 与 DOM 同义：清空子节点
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {},
    remove() { removed.push(this); },
    contains() { return false; },
  });
  return {
    body: { childCount: 0, appendChild() { this.childCount++; } },
    createElement: () => makeEl(),
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { const set = listeners.get(type); if (set) set.delete(fn); },
    count: (type) => (listeners.get(type) || new Set()).size,
    handlers: (type) => [...(listeners.get(type) || [])],
    removedCount: () => removed.length,
  };
};

const savedDocument = globalThis.document;
const doc = documentStub();
globalThis.document = doc;
try {
  const hovered = [];
  const overlay = new CursorOverlay({
    isVisible: () => true,
    getCursorItem: () => ({ name: 'stone', count: 1 }),
    blockContextMenu: true,
    onHover: (name) => hovered.push(name),
  });
  assert('CursorOverlay 挂载两节点并绑定 mousemove+contextmenu', doc.body.childCount === 2 && doc.count('mousemove') === 1 && doc.count('contextmenu') === 1);
  doc.handlers('mousemove')[0]({ clientX: 100, clientY: 50, target: {} });
  assert('mousemove 让手持图标居中跟随', overlay.cursorEl.style.left === '78px' && overlay.cursorEl.style.top === '28px');
  const menuEv = { preventDefault() { this.blocked = true; } };
  doc.handlers('contextmenu')[0](menuEv);
  assert('界面可见时屏蔽右键菜单', menuEv.blocked === true);
  const target = {};
  const slot = { contains: (t) => t === target };
  overlay.bindHover(slot, 'stone');
  slot.onmouseenter();
  assert('bindHover 显示名称并回调悬浮名', overlay.tooltip.textContent === title && overlay.tooltip.style.display === 'block' && hovered.join(',') === 'stone', overlay.tooltip.textContent);
  doc.handlers('mousemove')[0]({ clientX: 100, clientY: 50, target });
  assert('命中悬浮元素时 tooltip 跟随鼠标', overlay.tooltip.style.left === '114px' && overlay.tooltip.style.top === '64px');
  overlay.clearHover();
  assert('clearHover 收起提示并回调 null', overlay.tooltip.style.display === 'none' && hovered[hovered.length - 1] === null);
  overlay.setItem({ name: 'stone', count: 3 });
  assert('setItem 渲染图标与数量角标', overlay.cursorEl.style.display === 'block' && overlay.cursorEl.children.length === 2 && overlay.cursorEl.children[1].textContent === 3);
  overlay.setItem({ name: 'stone', count: 1 });
  assert('setItem 单件不画角标', overlay.cursorEl.children.length === 1);
  overlay.setItem(null);
  assert('setItem(null) 隐藏图标', overlay.cursorEl.style.display === 'none' && overlay.cursorEl.innerHTML === '');
  overlay.dispose();
  overlay.dispose();
  assert('dispose 幂等：监听器净清零、节点只移除一次', doc.count('mousemove') === 0 && doc.count('contextmenu') === 0 && doc.removedCount() === 2, `removed=${doc.removedCount()}`);

  const hidden = new CursorOverlay({ isVisible: () => false });
  assert('blockContextMenu 关闭时不绑定 contextmenu', doc.count('contextmenu') === 0);
  doc.handlers('mousemove')[0]({ clientX: 10, clientY: 10, target: {} });
  assert('无光标物品时图标不跟随', hidden.cursorEl.style.left === undefined);
  hidden.tooltip.style.display = 'block';
  hidden.bindHover({ contains: () => true }, 'stone');
  doc.handlers('mousemove')[0]({ clientX: 10, clientY: 10, target: {} });
  assert('界面不可见时 tooltip 立即归零', hidden.tooltip.style.display === 'none');
  hidden.dispose();
} finally {
  globalThis.document = savedDocument;
}

// F5：四个 Screen 的释放路径（构造 → dispose → 重复 dispose），组合件接管后的监听器计数与幂等
const screenGame = { controls: { enabled: true }, hotbar: { update() {} } };
const screenDoc = documentStub();
globalThis.document = screenDoc;
try {
  const screens = [
    new ChestScreen(screenGame),
    new FurnaceScreen(screenGame),
    new InventoryScreen({}, {}, screenGame),
    new TradeScreen(screenGame),
  ];
  assert('四个 Screen 构造后共绑定 7 个 document 监听器', screenDoc.count('mousemove') === 4 && screenDoc.count('contextmenu') === 3, `${screenDoc.count('mousemove')}/${screenDoc.count('contextmenu')}`);
  for (const s of screens) s.dispose();
  const removedOnce = screenDoc.removedCount();
  assert('四个 Screen dispose 后监听器全解绑、节点已摘除', screenDoc.count('mousemove') === 0 && screenDoc.count('contextmenu') === 0 && removedOnce === 12, `removed=${removedOnce}`);
  for (const s of screens) s.dispose();
  assert('四个 Screen dispose 幂等（重复调用不再摘除节点）', screenDoc.removedCount() === removedOnce, `removed=${screenDoc.removedCount()}`);
} finally {
  globalThis.document = savedDocument;
}

// F4：投射物 / 末影之眼 / 信标状态只在 _disposeWorld 收口一次（start 内不再重复清理）
assert('Game 以 inventoryScreen.dispose() 收口', game.includes('this.inventoryScreen.dispose(); this.inventoryScreen = null;'));
assert('arrows 数组仅在单点清空一次', count(game, 'this.arrows = [];') === 1, String(count(game, 'this.arrows = [];')));
assert('witherSkulls 数组仅在单点清空一次', count(game, 'this.witherSkulls = [];') === 1, String(count(game, 'this.witherSkulls = [];')));
assert('信标状态仅由单点清除一次', count(game, 'this._clearBeaconState();') === 1, String(count(game, 'this._clearBeaconState();')));
const disposeSlice = game.slice(game.indexOf('_disposeWorld()'), game.indexOf('async start('));
assert('清理语句位于 _disposeWorld 内', ['this.eyeFlight', 'this.arrows', 'this.witherSkulls', 'this._clearBeaconState()'].every((s) => disposeSlice.includes(s)));
assert('世界图集在网格材质之后释放，水纹理只清引用不 dispose',
  disposeSlice.indexOf('this.chunkBuilder.dispose()') < disposeSlice.indexOf('this.atlasTexture.dispose()') &&
  disposeSlice.includes('this.waterTexture = null') && !disposeSlice.includes('this.waterTexture.dispose()'));
const builderDispose = chunkMesh.slice(chunkMesh.indexOf('  dispose() {'), chunkMesh.indexOf('  // 判断方块面是否可见'));
assert('ChunkMeshBuilder.dispose 幂等并释放三种共享材质',
  builderDispose.includes('if (this._disposed) return') &&
  ['this.solidMaterial?.dispose()', 'this.waterMaterial?.dispose()', 'this.lightMaterial?.dispose()'].every((s) => builderDispose.includes(s)));
assert('SVG atlas 纹理与 canvas 由 buildAtlas 局部创建，UV 查询只保留最新映射',
  svgTextures.includes('let latestAtlasUV = new Map()') &&
  svgTextures.includes('const atlasCanvas = document.createElement(\'canvas\')') &&
  svgTextures.includes('const atlasTexture = new THREE.CanvasTexture(atlasCanvas)') &&
  !svgTextures.includes('let atlasTexture = null'));
assert('PanoramaBake 成功或失败退出都会释放网格 builder 与图集',
  panorama.includes('builder?.dispose();') && panorama.includes('atlasTexture.dispose();') &&
  panorama.includes('builder.dispose();') && panorama.includes('finally {'));
finish('leak-guards');
