# Docker 部署与镜像构建（B50）

> 本文记录 Tiderift 容器化的实现要点与**防回退红线**。改动 `Dockerfile`、`.dockerignore`、
> `.github/workflows/docker.yml` 或服务器静态托管逻辑前必读。

## 一、形态：单端口一体化

镜像内同时包含**客户端静态站**与**联机服务器**，由同一个 Node 进程在同一个端口（3001）提供：

| 路径 | 内容 |
|---|---|
| `GET /` | 客户端 `dist/index.html`（有构建产物时）；无产物则回退管理面板 |
| `GET /admin` | 管理面板 `server/admin.html`（恒可用） |
| `GET /assets/*` | 客户端静态资源（长缓存） |
| `GET /api/*` | 管理 API（行为不变） |
| `WS /ws` | 联机 WebSocket（行为不变） |

**为什么单端口**：玩家打开 `http://<主机IP>:3001/` 即可游玩，服务器地址由页面同源推导，
无需手填 IP；一个证书、一个反代块、一个端口映射即可完成 HTTPS 部署。

## 二、服务器静态托管（`server/index.mjs`）

### 关键常量

```js
const STATIC_DIR = process.env.TIDERIFT_STATIC_DIR || <仓库根>/dist;
const HAS_STATIC = fs.existsSync(path.join(STATIC_DIR, 'index.html'));
```

`HAS_STATIC` 在**进程启动时求值一次**。本地开发未 `npm run build` 时它为 `false`，
`GET /` 回退管理面板——**这是本地开发与跑批的行为基线，不能改**。

### 路由顺序（红线）

```
/api/skin/*  →  /admin  →  /  →  /api/*  →  静态兜底  →  404
```

- 静态兜底**必须**排在 `/api/*` 之后，否则会抢占接口路径。
- `/admin` 必须**独立于** `HAS_STATIC` 恒可用（健康检查依赖它）。

### 目录穿越防护（红线）

`serveStatic()` 用 `path.resolve` 解析后做前缀比对：

```js
const target = path.resolve(STATIC_DIR, '.' + rel);
const rootWithSep = STATIC_DIR.endsWith(path.sep) ? STATIC_DIR : STATIC_DIR + path.sep;
if (target !== STATIC_DIR && !target.startsWith(rootWithSep)) return false;
```

**不要**改成简单的 `path.join(STATIC_DIR, rel)`——`../` 会逃逸到仓库外。
已实测拦截：`/../package.json`、`/%2e%2e/package.json`、`/..%2fpackage.json`、
`/assets/..%2f..%2fpackage.json` 全部 404。

### 缓存策略

- `/assets/*`（Vite 产物带内容哈希）→ `public, max-age=31536000, immutable`
- 其余（`index.html` 等）→ `no-cache`，避免发版后拿到旧壳

## 三、数据目录环境变量（`store.js` / `config.js`）

```js
const DEFAULT_DIR = process.env.TIDERIFT_DATA_DIR
  ? path.join(process.env.TIDERIFT_DATA_DIR, 'world')
  : <原路径 server/world>;
```

**红线：默认值必须保持不变。** `server/test-hardening-store.mjs` 断言
「默认目录归档位于 `server/world/corrupt/`」，改默认值会让该套件变红。

容器内 `TIDERIFT_DATA_DIR=/data`，世界与配置同卷：

```
/data/world/<房间名>.json
/data/world/players/<房间名>.players.json
/data/config.json
```

**为什么用目录而不是分别挂两个文件**：单独挂 `config.json` 时，若宿主机上该文件不存在，
Docker 会把它建成**目录**，服务器写入时抛 `EISDIR`。统一挂目录可完全避开这个坑。

## 四、前端同源推导（`src/net/lanStatus.js`）

```js
export function defaultLanHost() {
  // http(s) 页面 → location.hostname（同源部署，服务器就在同一 host）
  // 无 location（node 测试）或 file: → 127.0.0.1
}
```

`getLanHost()` 在 localStorage 无持久化值时回退 `defaultLanHost()`。

**红线**：`DEFAULT_LAN_HOST` 常量保留（`tests/build23-menu-lan.mjs` 引用它），
但**不要**让 `getLanHost()` 直接返回它——否则容器部署后玩家会去连自己的 127.0.0.1。

## 五、皮肤候选链同源优先（`src/entity/PlayerSkin.js`）

`buildSkinCandidates(username, ctx)` 的 `ctx.origin` 为页面 origin 时，首条候选为
`${origin}/api/skin/<name>`——同源、无混合内容问题、能拿到 slim 标记。

顺序：**同源 origin → 联机代理 → 本机 3001（仅本地/http）→ minotar → mc-heads**。

`tests/build41-skin-candidates.mjs` 的第 ⑥ 组钉住这条链（含去重与 HTTPS 无混合内容）。

## 六、Dockerfile 要点

### 三阶段 + 多架构零 RUN

1. `builder`（`--platform=$BUILDPLATFORM`）：`npm ci` → `npm run build` → `/app/dist`
2. `deps`（`--platform=$BUILDPLATFORM`）：`cd server && npm ci --omit=dev` → `/app/server/node_modules`
3. `runtime`（`$TARGETPLATFORM`）：`node:26-alpine` + **零 `RUN`**，全部用 `COPY --chown` 落地

**为什么 runtime 阶段不能有 `RUN`**：`RUN` 会在**目标架构**下执行 `/bin/sh`。本地构建 arm64 时若没有
QEMU binfmt（如本机 RHEL10 未装 `qemu-user-static`），会直接 `exec format error`。
把所有文件准备放到构建机架构的 `builder`/`deps` 阶段，runtime 只做 `COPY`，arm64 构建就完全
不需要模拟执行——实测 `docker buildx build --platform linux/amd64,linux/arm64` 全程通过。

**代价**：`COPY` 必须显式带 `--chown=node:node`。曾漏加导致容器启动即
`EACCES: permission denied, open '/app/src/world/structures/StructureManager.js'`
（`COPY` 默认 root 属主，`USER node` 读不了）。**新增任何 COPY 都要带 `--chown`。**

### 必须拷贝 `src/`

**这是最容易漏的一条**：`server/room.js`、`flow.js`、`furnace.js` 直接 `import '../src/…'`，
依赖闭包共 **33 个 `src` 文件**（维度表、地形生成器、结构表、方块注册表、Smelting 等），
且随功能增长。因此 Dockerfile 用 `COPY src ./src` 整体拷贝，**不要**改成逐个文件列举——
新增共享模块时会静默漏拷，容器启动即 `ERR_MODULE_NOT_FOUND`。

### 前端也依赖 server/

`src/net/NetworkManager.js` 有 `import { MSG, PROTOCOL_VERSION } from '../../server/protocol.js'`
（消息类型与协议版本单一来源）。builder 阶段必须 `COPY server/protocol.js`，否则
`vite build` 报 `Could not resolve "../../server/protocol.js"`。

### 健康检查用 `/admin`

```dockerfile
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/admin')..."
```

**不要**用 `/api/status`：管理口令开启后该接口返回 401，健康检查会误判为不健康。
`/admin` 恒 200。

### 非 root 运行

`USER node` + 所有 `COPY --chown=node:node`。数据卷 `/data` 属主必须是 `node`（UID 1000），
否则容器内无法写入世界存档。

### 镜像体积

约 **260 MB**，其中基础镜像 `node:26-alpine` 占 179 MB（`node` 二进制本身 139.5 MB，
Node 26 带完整调试符号）。应用层仅约 6 MB（dist 2.7 MB + src 2.9 MB + server 0.3 MB）。
**不要**试图用 `RUN rm -rf npm` 瘦身——删除上层文件不会缩小下层，实测只省 24.6 kB。

## 七、GitHub Actions（`.github/workflows/docker.yml`）

| 触发 | 推送 tag |
|---|---|
| push `master` | `:master`、`:sha-<短哈希>` |
| push `beta-build-*` | `:beta-build-<X>`、`:latest` |
| Release published | `:beta-build-<X>`、`:latest` |
| pull_request | **只构建不推送**（验证 Dockerfile 可构建） |
| workflow_dispatch | 手动补发 |

- 平台：`linux/amd64,linux/arm64`（`ws` 纯 JS 无原生编译，QEMU 下也快）
- 缓存：`type=gha,mode=max`
- `smoke` job：单平台构建后起容器，验证 `/`、`/admin`、`/api/status`、目录穿越、WS 握手、重启后数据保留

### 首次推送后的人工一步

GHCR 包**首次推送后**需在仓库 → Packages → 包设置里确认可见性为 **Public**，
否则匿名 `docker pull` 会 401。这一步无法由 workflow 完成。

## 八、验收清单

```bash
# 1. 构建
docker build -t tiderift:test .

# 2. 起容器
docker run -d --name t -p 3001:3001 -v t-data:/data tiderift:test

# 3. 四条链路
curl -fsS http://127.0.0.1:3001/ | grep '<title>Tiderift</title>'   # 客户端
curl -fsS http://127.0.0.1:3001/admin | grep '服务器管理面板'          # 管理面板
curl -fsS http://127.0.0.1:3001/api/status | grep bootTime           # API
# WS 握手：见 docker.yml 的 smoke job

# 4. 目录穿越必须 404
curl -s -o /dev/null -w '%{http_code}' --path-as-is 'http://127.0.0.1:3001/../package.json'

# 5. 数据持久化
docker restart t && curl -fsS -o /dev/null http://127.0.0.1:3001/admin
```

## 九、已知限制

- 镜像内**不含** `tests/`、`docs/`、`server/test-*.mjs`、`server/world/`、`server/config.json`。
- 客户端静态站与服务器**必须同源**才能享受「自动填服务器地址」；若把 `dist` 单独部署到
  CDN，玩家仍需手填服务器 IP（`LAN_PORT` 固定 3001，端口不可改）。
- 镜像不内置 TLS。需要 HTTPS 时在前面加反向代理（Caddy/Nginx），并把 `ws://` 升级为 `wss://`
  ——**当前 `lanWsUrl()` 硬编码 `ws://`**，HTTPS 部署需另行改造（尚未实现）。

## B51 R3：新增 server/*.js 必须同时加进 Dockerfile（镜像 smoke 才会翻车的坑）

runtime 阶段对服务器源码是**精确列举**拷贝（`COPY server/index.mjs server/room.js … ./server/`）。
新增一个 `server/xxx.js`（本轮是 `server/industry.js`）而忘了补一行时：

- `npm test` 全绿（本机文件都在），CI 的 `Build frontend + 全量回归` 也绿；
- 只有 Docker workflow 的「Smoke test HTTP endpoints」才会失败，容器日志是
  `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/server/industry.js' imported from /app/server/room.js`。

防回退：`tests/docker-image-files.mjs` 从 `server/index.mjs` 出发沿 `./xxx.js` 做传递闭包，
断言每个模块都在 runtime COPY 列表里（并守住 `COPY src ./src` 两条红线）。**新增服务器模块后连这个套件一起跑。**

