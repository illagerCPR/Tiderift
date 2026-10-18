// version-pin.mjs -- 版本钉值唯一来源（BUILD/VERSION_LABEL 断言 + tests/ 无第二处字面量版本钉值的元断言）
// 用法：node tests/version-pin.mjs（纯 node，不依赖浏览器与服务器）
// 版本常量唯一来源是 src/version.js：版本钉值只能写在 tests/version-pin.mjs；
// 其他套件一律引用常量，不得再写 ok(BUILD === N, ...) / ok(VERSION_LABEL === '<字面量>', ...)
// ——否则每次 bump 都要 sed 扫改（本文件 ③ 的元断言会直接判失败）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD, VERSION_LABEL } from '../src/version.js';
import { assert, finish } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

// ① BUILD：正整数且不低于当前离线线（Build 30 起只增不减）
assert('BUILD 为正整数', Number.isInteger(BUILD) && BUILD > 0, String(BUILD));
assert('BUILD ≥ 30', BUILD >= 30, String(BUILD));

// ② VERSION_LABEL 模板必须与 BUILD 同步（主界面/游戏内左下角引用它，改 BUILD 即改界面）
assert('VERSION_LABEL 与 BUILD 同步', VERSION_LABEL === `Tiderift Beta Build ${BUILD}`, JSON.stringify(VERSION_LABEL));
assert('VERSION_LABEL 形如 Tiderift Beta Build <数字>（格式断言，不钉死数字）', /^Tiderift Beta Build \d+$/.test(VERSION_LABEL), JSON.stringify(VERSION_LABEL));

// ③ 元断言：tests/ 下（递归）除本文件外不得再有字面量版本钉值（BUILD === / VERSION_LABEL ===）
const scanTests = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  if (d.isDirectory()) return scanTests(p);
  return d.name.endsWith('.mjs') ? [p] : [];
});
const others = scanTests(HERE).filter((p) => path.resolve(p) !== path.resolve(SELF));
const PIN_LITERALS = ['BUILD ===', 'VERSION_LABEL ==='];
const pinned = others.flatMap((p) => {
  const src = fs.readFileSync(p, 'utf8');
  return PIN_LITERALS.filter((pin) => src.includes(pin)).map((pin) => `${path.relative(HERE, p)}:${pin}`);
});
assert('元断言非空扫（tests/ 下确有多份套件被扫到）', others.length >= 30, String(others.length));
assert('tests/ 下无第二处字面量版本钉值（BUILD === / VERSION_LABEL ===）', pinned.length === 0, pinned.join(' '));

// ④ 本套件必须挂在跑批入口上（未注册的套件等于不存在）
const runner = fs.readFileSync(path.join(HERE, '..', 'server', 'run-all-tests.sh'), 'utf8');
const registered = /^\s*version-pin\s/m.test(runner);
const unregistered = /^\s*version-pin\s/m.test(runner.replace(/^[ \t]*version-pin[ \t].*$/m, ''));
assert('version-pin 已注册进 server/run-all-tests.sh（跑批清单）', registered && !unregistered);
finish('version-pin');
