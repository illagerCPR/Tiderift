// tests/framework-guard.mjs -- 测试框架元断言：runner 样板唯一化（tests/ 与 server/ 各自只有一份）
// 断言：① 两份框架文件存在；② 除框架文件外无本地 runner 定义；③ 除框架文件外无复制粘贴的失败样板；
//       ④ 每个套件都 import 本侧框架；⑤ 套件数量不低于下限（防目录被清空导致的假绿）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, fail, finish } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_FRAMEWORK = 'tests/harness.mjs';
const SERVER_FRAMEWORK = 'server/test-lib.mjs';

const RUNNER_DEF = /function\s+(ok|assert|check|fail|pass)\s*\(/;
const FAIL_BOILER = /console\.error\(\s*['"`]FAIL:/;

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const listFiles = (dir, test) =>
  fs.readdirSync(path.join(ROOT, dir)).filter(test).sort().map((f) => dir + '/' + f);

for (const fw of [TESTS_FRAMEWORK, SERVER_FRAMEWORK]) {
  if (!fs.existsSync(path.join(ROOT, fw))) fail('框架文件缺失：' + fw);
}

const sides = [
  {
    label: 'tests/',
    framework: TESTS_FRAMEWORK,
    files: listFiles('tests', (f) => f.endsWith('.mjs')),
    importRe: /(?:from|import)\s*\(?\s*['"]\.\/harness\.mjs['"]/,
    min: 45,
  },
  {
    label: 'server/',
    framework: SERVER_FRAMEWORK,
    files: listFiles('server', (f) => f.startsWith('test-') && f.endsWith('.mjs')),
    importRe: /(?:from|import)\s*\(?\s*['"]\.\/test-lib\.mjs['"]/,
    min: 16,
  },
];

for (const s of sides) {
  const suites = s.files.filter((f) => f !== s.framework);
  const name = path.basename(s.framework);
  assert(s.label + '套件数不低于下限', suites.length >= s.min, '实际 ' + suites.length + '，期望 ≥ ' + s.min);
  const defs = suites.filter((f) => RUNNER_DEF.test(read(f)));
  assert(s.label + '无第二份 runner 定义', defs.length === 0, defs.join(', '));
  const boiler = suites.filter((f) => FAIL_BOILER.test(read(f)));
  assert(s.label + '无复制粘贴失败样板', boiler.length === 0, boiler.join(', '));
  const missing = suites.filter((f) => !s.importRe.test(read(f)));
  assert(s.label + '套件全部 import ' + name, missing.length === 0, missing.join(', '));
}

finish('framework-guard');
