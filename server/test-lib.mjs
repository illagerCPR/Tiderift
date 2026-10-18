// test-lib.mjs -- server/ 侧唯一测试 runner 框架：累积式断言 + 逐套件输出风格 + 统一收尾
// 用法：import { assert, finish, counts } from './test-lib.mjs';
// 约定：断言失败不中断（累积式），finish() 汇总失败清单并决定退出方式。
// 退出纪律：套件内不得出现 process.exit / process.exitCode——普通套件用 finish()，
// socket 关闭态下需自然退出的套件（Windows libuv 陷阱）用 finish({ natural: true })。

const results = [];   // [name, passed]
let style = 'plain';  // plain | spaced | bracket | admin

// 输出风格：默认 plain；迁移前各套件的既有行格式用 configure 显式声明，保证输出逐字不变
export function configure({ style: next = 'plain' } = {}) {
  style = next;
}

function emit(name, cond, extra) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (style === 'admin') {
    console.log(cond ? `  ✓ ${name}` : `  ✗ ${name} ${extra}`);
    return;
  }
  if (style === 'bracket') {
    console.log(`${verdict}  ${name}${extra ? `  [${extra}]` : ''}`);
    return;
  }
  if (style === 'spaced') {
    console.log(`${verdict}  ${name} ${extra}`);
    return;
  }
  console.log(`${verdict}  ${name}${extra ? ` ${extra}` : ''}`);
}

// 累积式断言：失败不中断，只登记并打印
export function assert(name, cond, extra = '') {
  const passed = !!cond;
  results.push([name, passed]);
  emit(name, passed, extra);
}

// test-admin 的 (name, cond, extra) 兼容入口
export const ok = assert;

export function pass(name) {
  assert(name, true);
}

export function fail(name, extra = '') {
  assert(name, false, extra);
}

// 当前统计：total 为累计断言数，passed 为通过数
export function counts() {
  const passed = results.filter(([, isOk]) => isOk).length;
  return { total: results.length, passed, failed: results.length - passed };
}

// 收尾：打印失败清单后退出。natural=true 走 process.exitCode（Windows libuv 在 socket
// 关闭态直接 process.exit 会触发断言崩溃），否则直接 process.exit()。
export function finish({ natural = false } = {}) {
  const failures = results.filter(([, isOk]) => !isOk);
  if (failures.length) {
    console.log('失败项：');
    for (const [name] of failures) console.log('  - ' + name);
  }
  if (natural) process.exitCode = failures.length ? 1 : 0;
  else process.exit(failures.length ? 1 : 0);
}
