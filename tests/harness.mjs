// tests/harness.mjs -- tests/ 侧唯一 runner 框架：断言、计数、PASS/FAIL 打印、摘要与退出收口（审计 E5）
// 用法：import { ok, pass, fail, assert, check, finish } from './harness.mjs';
// 纪律：套件内不得再定义本地 runner 样板、不得调用 process.exit —— 退出统一由本文件收口。
// 打印口径：ok()/pass() 成功默认**只计数不打印**（与迁移前多数套件一致）；迁移前逐条打印的套件
//   在顶部调用 configure({ verbose: true }) 保持原输出。assert()/check()/softOk() 始终逐条打印。
import fs from 'node:fs';

let total = 0;
let passed = 0;
let verbose = false;
const failures = [];

// 打印口径开关：verbose=true 时 ok()/pass() 成功逐条打印 `PASS <msg>`（默认 false）
export function configure(opts = {}) {
  if (typeof opts.verbose === 'boolean') verbose = opts.verbose;
}

// 形态 1（fail-fast）：成功计数 +1（verbose 下打印 `PASS <msg>`）；失败打印 `FAIL: <msg>` 后立即 exit(1)
export function ok(cond, msg) {
  total++;
  if (!cond) fatal(msg);
  passed++;
  if (verbose) console.log('PASS ' + msg);
}

// 形态 2（单参 ok）：只记一条成功（verbose 下打印 `PASS <msg>`）
export function pass(msg) {
  total++;
  passed++;
  if (verbose) console.log('PASS ' + msg);
}

// 无条件的致命断言：打印 `FAIL: <msg>` 后立即 exit(1)
export function fail(msg) {
  fatal(msg);
}

// 形态 3/4（累积式）：打印 `PASS  <name> <extra>` / `FAIL  <name> <extra>`，失败不中断，由 finish() 结算
export function assert(name, cond, extra = '') {
  total++;
  if (cond) passed++;
  else failures.push(extra ? name + ' ' + extra : name);
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + ' ' + extra);
}

// 形态 3 的旧名，签名与语义同 assert
export const check = assert;

// 累积式「软 ok」：成功静默计数（保持既有套件输出量），失败收集 `FAIL: <msg>` 且不中断
export function softOk(cond, msg) {
  total++;
  if (cond) { passed++; return; }
  failures.push(msg);
  console.error('FAIL: ' + msg);
}

// 结算：无失败打印摘要后 exit(0)；有失败打印 FAILED 与失败清单后 exit(1)
export function finish(label = '') {
  if (failures.length > 0) {
    console.log('FAILED ' + failures.length + '/' + total + ' assertions failed' + (label ? ' (' + label + ')' : ''));
    for (const f of failures) console.log('  ✗ ' + f);
    end(1);
    return;
  }
  console.log(label ? label + ': ' + total + ' assertions ALL PASS' : 'ALL PASS (' + total + ' assertions)');
  end(0);
}

// 致命退出：stderr 同步写，保证管道下 FAIL 行不丢
function fatal(msg) {
  fs.writeSync(2, 'FAIL: ' + msg + '\n');
  process.exit(1);
}

// 退出收口：等 stdout 排空再退出（管道下 process.exit 会截断刚写的摘要行），
// 并以 unref 看门狗兜底套件里未释放的句柄，保证进程一定退出且退出码一致。
function end(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 2000).unref();
  process.stdout.write('', () => process.exit(code));
}
