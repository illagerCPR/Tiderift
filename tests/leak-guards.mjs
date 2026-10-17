// leak-guards.mjs -- 资源释放回归守卫（B30 修复批次二）：unloadChunk 三 mesh 释放、InventoryScreen dispose 接线、_disposeWorld 单点收口
// 用法：node tests/leak-guards.mjs（纯 node，不依赖浏览器与服务器）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/core/World.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const count = (s, sub) => s.split(sub).length - 1;
const results = [];
const ok = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
};

// F2：unloadChunk 必须释放 solid / water / light 三个 geometry（借原型造实例，不跑构造器）
const calls = [];
const spy = (tag) => ({ geometry: { dispose() { calls.push(tag); } } });
const w = Object.create(World.prototype);
w.key = (cx, cz) => `${cx},${cz}`;
w.chunks = new Map([['3,-7', { cx: 3, cz: -7, mesh: spy('solid'), waterMesh: spy('water'), lightMesh: spy('light') }]]);
w.unloadChunk(3, -7);
ok('unloadChunk 释放 solid/water/light 三个 geometry', calls.length === 3 && ['solid', 'water', 'light'].every((t) => calls.includes(t)), calls.join(','));
ok('unloadChunk 从 chunks 移除区块', w.chunks.size === 0);

// 边界：只有 solid / 无任何 mesh / 未加载区块均不得抛错
calls.length = 0;
w.chunks.set('0,0', { cx: 0, cz: 0, mesh: spy('only-solid') });
w.unloadChunk(0, 0);
let threw = false;
try { w.chunks.set('1,1', { cx: 1, cz: 1 }); w.unloadChunk(1, 1); w.unloadChunk(9, 9); } catch { threw = true; }
ok('边界用例不抛错（缺 lightMesh / 无 mesh / 未加载区块）', !threw && calls.length === 1, calls.join(','));

const inv = read('src/ui/InventoryScreen.js');
const game = read('src/player/Game.js');

// F1：3 个 document 监听器改为实例字段并可在 dispose 中成对解绑
for (const [type, field] of [['mousemove', '_onCursorMove'], ['contextmenu', '_onContextMenu'], ['mousemove', '_onTooltipMove']]) {
  ok(`InventoryScreen ${type} 监听器已保存引用 ${field}`, inv.includes(`document.addEventListener('${type}', this.${field})`));
  ok(`InventoryScreen dispose 解绑 ${field}`, inv.includes(`document.removeEventListener('${type}', this.${field})`));
}
ok('InventoryScreen 无残留匿名 document 监听器', !/document\.addEventListener\('[a-z]+', \(e\) =>/.test(inv));
ok('InventoryScreen dispose 幂等（_disposed 守卫）', /dispose\(\)\s*\{\s*if \(this\._disposed\) return;/.test(inv));
ok('InventoryScreen dispose 移除 el/cursorEl/tooltip', ['this.el.remove()', 'this.cursorEl.remove()', 'this.tooltip.remove()'].every((s) => inv.includes(s)));

// F4：投射物 / 末影之眼 / 信标状态只在 _disposeWorld 收口一次（start 内不再重复清理）
ok('Game 以 inventoryScreen.dispose() 收口', game.includes('this.inventoryScreen.dispose(); this.inventoryScreen = null;'));
ok('arrows 数组仅在单点清空一次', count(game, 'this.arrows = [];') === 1, String(count(game, 'this.arrows = [];')));
ok('witherSkulls 数组仅在单点清空一次', count(game, 'this.witherSkulls = [];') === 1, String(count(game, 'this.witherSkulls = [];')));
ok('信标状态仅由单点清除一次', count(game, 'this._clearBeaconState();') === 1, String(count(game, 'this._clearBeaconState();')));
const disposeSlice = game.slice(game.indexOf('_disposeWorld()'), game.indexOf('async start('));
ok('清理语句位于 _disposeWorld 内', ['this.eyeFlight', 'this.arrows', 'this.witherSkulls', 'this._clearBeaconState()'].every((s) => disposeSlice.includes(s)));

const failed = results.filter(([, pass]) => !pass).length;
console.log(`---\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
