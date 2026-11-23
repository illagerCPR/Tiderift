// docker-image-files.mjs -- Docker 运行镜像的服务器文件清单回归（纯 node，不需要 docker）
// 教训（B51 R3）：Dockerfile 的服务器源码是**精确列举**拷贝，新增一个 server/*.js 而忘了加一行，
// 镜像构建照常成功、容器启动才 ERR_MODULE_NOT_FOUND（CI 只会在 Docker workflow 冒烟阶段暴露）。
// 断言：
//   ① 从 server/index.mjs 出发沿 ./xxx.js 相对导入做传递闭包，得到的每个文件都必须出现在
//      runtime 阶段的 COPY 列表里（含 server/ 前缀）；
//   ② 客户端共享模块走 `COPY src ./src`（AGENTS「Dockerfile 必须 COPY src ./src」的红线）；
//   ③ builder 阶段必须拷 server/protocol.js（NetworkManager 反向依赖它）。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, finish } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');

// runtime 阶段（最后一个 stage）里 COPY 落地的 server/* 文件清单
function runtimeServerFiles(text) {
  const runtimeStart = text.lastIndexOf('FROM ');
  const runtime = text.slice(runtimeStart);
  const files = new Set();
  // 把续行拼接起来再扫 COPY 行
  const joined = runtime.replace(/\\\n/g, ' ');
  for (const line of joined.split('\n')) {
    const m = line.match(/^\s*COPY\s+(?:--[a-z-]+=\S+\s+)*([^#]*)$/i);
    if (!m) continue;
    const parts = m[1].trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const dest = parts[parts.length - 1];
    for (const src of parts.slice(0, -1)) {
      if (/^--/.test(src)) continue;
      const norm = src.replace(/^\.\//, '');
      if (!norm.startsWith('server/')) continue;
      const target = dest === './server/' || dest === './server' ? norm.replace(/^server\//, '') : basename(norm);
      files.add(`server/${target}`);
    }
  }
  return files;
}

const inImage = runtimeServerFiles(dockerfile);

// 从入口出发做传递闭包（只跟 ./ 开头的同目录相对导入）
const SERVER_DIR = join(ROOT, 'server');
const seen = new Set();
const stack = ['index.mjs'];
while (stack.length) {
  const name = stack.pop();
  const key = `server/${name}`;
  if (seen.has(key)) continue;
  seen.add(key);
  let text;
  try { text = readFileSync(join(SERVER_DIR, name), 'utf8'); } catch { continue; }
  for (const m of text.matchAll(/from\s+'(\.\/[^']+\.(?:js|mjs))'/g)) {
    const next = m[1].replace(/^\.\//, '');
    if (!seen.has(`server/${next}`)) stack.push(next);
  }
}

const missing = [...seen].filter((f) => !inImage.has(f)).sort();
ok(seen.size >= 8, `入口闭包含足够多的服务器模块（${seen.size}）`);
ok(inImage.has('server/index.mjs'), '镜像包含入口 index.mjs');
ok(missing.length === 0, `runtime COPY 列表覆盖全部服务器模块（缺: ${missing.join(', ') || '无'}）`);

// 客户端共享模块与反向依赖
ok(/COPY\s+--chown=node:node\s+src\s+\.\/src/.test(dockerfile), 'runtime 阶段 COPY src ./src（共享纯模块）');
ok(/COPY\s+server\/protocol\.js\s+\.\/server\/protocol\.js/.test(dockerfile), 'builder 阶段拷 server/protocol.js');
ok(/COPY\s+src\s+\.\/src/.test(dockerfile), 'builder 阶段 COPY src ./src（NetworkManager 反向依赖）');

// 反向绊线：server 目录下存在多少个非测试源码，镜像里至少覆盖它们的入口闭包
const allServerSources = readdirSync(SERVER_DIR)
  .filter((n) => (n.endsWith('.js') || n.endsWith('.mjs')) && !n.startsWith('test-'));
ok(allServerSources.length >= seen.size, '镜像清单不小于入口闭包规模');
for (const name of allServerSources) {
  if (!seen.has(`server/${name}`)) continue;
  ok(inImage.has(`server/${name}`), `模块已入镜像: ${name}`);
}

finish('docker-image-files');
