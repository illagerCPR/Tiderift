# Tiderift 开发文档

面向开发者的参考资料：环境与依赖、开发 / 生产命令、项目结构、架构概览、回归测试与 CI。

- 用户向内容（玩法、操作说明、联机开房与管理面板）见 [`../README.md`](../README.md)。
- Agent 工作指令、开发约定与各子系统防回退细则见 [`../AGENTS.md`](../AGENTS.md)。

## 环境要求

- Node.js 18+（根与 `server/package.json` 的 `engines.node` 均为 `>=18`，下限来自 server 侧用到的全局 `fetch` 与 `AbortSignal.timeout`（Node 17.3+）；Vite 5 自身声明 `^18.0.0 || >=20.0.0`，19.x 属未验证的过渡版本，实际使用 18 / 20 / 22 / 24）。开发与 CI 固定使用 Node 24，版本源为根目录 `.nvmrc`（CI 经 `node-version-file` 读取，不再硬编码）。
- npm
- bash：`start.sh` 与 `server/run-all-tests.sh` 都是 bash 脚本；Windows 原生 cmd / PowerShell 下无 bash 会直接失败，需在 Git Bash / WSL 中执行（或手动 `bash server/run-all-tests.sh`）。

## 安装依赖

```bash
npm install                      # 前端依赖（three / vite）
npm install --prefix server ws   # 联机服务器依赖
```

## 开发 / 生产命令

```bash
# Windows (PowerShell)
.\start.cmd start         # 启动 Vite 开发服务器（http://127.0.0.1:5173），后台常驻
.\start.cmd stop          # 停止
.\start.cmd restart       # 重启
.\start.cmd status        # 查看是否在跑
.\start.cmd server        # 启动联机服务器（ws://0.0.0.0:3001/ws）
.\start.cmd server-stop   # 停止联机服务器

# Linux / macOS
./start.sh start          # 同上（默认动作，可省略参数）
./start.sh stop
./start.sh restart
./start.sh status
./start.sh server         # 启动联机服务器（缺 ws 依赖时自动在 server/ 下 npm install）
./start.sh server-stop

npm run build             # 生产构建（产物输出到 dist/）
npm run preview           # 预览构建产物
npm test                  # 一键回归（= ./server/run-all-tests.sh，需 bash）
node --check <file>       # 语法检查（唯一可自动化验证手段）
```

- 不走 `npm run dev`：`start.cmd`（Windows，最小化窗口标题 `vite-dev-server`）与 `start.sh`（Linux，`nohup` 后台常驻，日志 `dev-out.log` / `dev-err.log`）都直接后台拉起 `node node_modules/vite/bin/vite.js`。端口 5173 无响应时先 `status`，必要时 `restart`。
- 无测试框架、无 lint、无 typecheck：修改后必须对每个改动文件执行 `node --check`，再用浏览器手测。
- 联机相关改动跑 `npm test`（CI 同款入口，跑前须 3001 空闲）。

## 项目结构

```text
Tiderift/
├── index.html            # HTML 入口（页面骨架与样式）
├── vite.config.js        # Vite 配置（base: './'，dev server 127.0.0.1:5173）
├── package.json          # 前端依赖与 npm scripts（dev / build / preview / test）
├── res/                  # Logo 与主菜单全景图素材
├── src/
│   ├── main.js           # 入口：Game + MenuScreen + NetworkManager
│   ├── version.js        # 版本常量（BUILD / VERSION_LABEL，主界面与 HUD 左下角引用）
│   ├── i18n/             # 本地化（t 翻译核心、11 语言包、方块/物品/怪物名称十一语字典）
│   ├── player/           # Game(中枢/主循环)、Player、Controls、Physics、Inventory、Raycast
│   ├── world/            # 地形生成（SimplexNoise）、生物群系
│   ├── blocks/ items/    # 方块/物品定义 + SVG 纹理
│   ├── core/             # World、Chunk、RedstoneSystem、Crafting、SaveSystem、LightEngine、Registry
│   ├── render/           # Renderer、ChunkMesh、Sky、SVGTextures、粒子/后处理/手持物/远端快捷栏
│   ├── entity/           # Mob、MobManager、RemotePlayer(远端玩家)、WitherAI/DragonAI(Boss AI)
│   ├── audio/            # AudioEngine（WebAudio 程序化合成音效/BGM/怪物语音）
│   ├── workers/          # 地形生成 / 网格构建 Worker（主线程不卡顿）
│   ├── ui/               # MenuScreen、HUD、Hotbar、InventoryScreen、ChatBox、BeaconScreen 等
│   └── net/              # NetworkManager（联机客户端网络层）、playerColor（玩家配色）
├── server/               # 局域网房间服务器（Node + ws）
│   ├── index.mjs         # 入口（http 管理面板 + WebSocket /ws，多房间管理 + /api 接口）
│   ├── room.js           # 房间：玩家集合、方块账本、消息路由、世界恢复、踢人/清掉落物
│   ├── store.js          # 世界落盘 + 快照备份（server/world/<房间名>.json）
│   ├── config.js         # 服务器配置（默认值 + 读写 server/config.json）
│   ├── ratelimit.js      # 令牌桶限速（聊天/方块/状态三档，热生效）
│   ├── admin.html        # 服务器管理面板页面（房间/玩家/配置/世界/白名单/账号管理）
│   ├── protocol.js       # 消息类型常量（浏览器与服务器共用）
│   ├── client-sim.mjs    # 双端验证模拟客户端
│   ├── test-*.mjs        # server 侧回归测试套件（清单以 run-all-tests.sh 为准）
│   ├── test-lib.mjs      # server 侧唯一 runner 框架（断言 / 汇总 / 退出收口）
│   └── run-all-tests.sh  # 一键跑批（CI 同款入口；tests 侧套件清单见脚本内 PURE_NODE_SUITES 数组）
├── tests/                # 不依赖服务器的纯 node 回归套件（地形/结构/维度/群系/本地化等确定性断言）
│   ├── harness.mjs       # tests 侧唯一 runner 框架（断言 / 汇总 / 退出收口）
│   ├── game-behavior.mjs # Game.js node 级行为回归（F3 拆分安全网：boot/帧循环/射线链/挖掘/生命周期/契约）
│   └── lib/game-env.mjs  # 共享 node 假环境（DOM/WebGL Proxy/Worker 桩），放子目录以避开套件扫描
├── docs/
│   ├── development.md                    # 本文档
│   ├── lan-multiplayer-design.md         # 局域网联机设计文档（协议表 + 分阶段路线）
│   ├── worldview.md                      # 世界观总纲「一潮三分」
│   ├── aether-storyline.md               # 天域 · 天海纪元故事线与开发计划（设计稿）
│   ├── whale-barrow-design.md            # 鲸骨冢篇与体验打磨设计方案
│   ├── endgame-proposal.md               # 终局提案设想（评审稿）
│   ├── TODO.md                           # 项目创意 / 提案暂存
│   ├── bug.md                            # 已知问题记录
│   ├── improvement-audit-b30.md          # Build 30 全项目改进审查报告
│   ├── improvement-plan-b30.md           # Build 30 改进多轮修复计划
│   ├── agent-browser-eval.md             # agent-browser 引入实测评估报告
│   ├── wiki-handover-prompt.md           # GitHub Wiki 增量更新交接提示词
│   └── agent-notes/                      # 各子系统批次踩坑备忘（改动对应子系统前先读）
│       ├── worldgen-structures.md        # 地形生成 / 结构 / 群系 / 战利品与交易
│       ├── dimensions-portals.md         # 维度 / 传送门 / 下界 / 末地 / 天域
│       ├── fluid-sim.md                  # 流体模拟
│       ├── survival-items.md             # 生存机制 / 工具食物 / 门床形制 / 游泳氧气
│       ├── mobs-entities.md              # 怪物与实体
│       ├── rendering-lighting.md         # 渲染 / 光照 / 材质 / 网格构建 / UI 图标链
│       ├── multiplayer.md                # 联机协议 / 插值 / 面板 / 玩家档案 / 房间开关
│       └── ui-misc.md                    # 菜单 / 粒子 / UI / 音频 / 更名引用面
├── .github/workflows/ci.yml  # CI：全量 node --check + build + 全套件
├── start.cmd             # 开发/联机服务器启停脚本（Windows）
├── start.sh              # 开发/联机服务器启停脚本（Linux/macOS，对标 start.cmd）
└── .gitignore
```

## 架构概览

- **确定性世界生成**：地形由 `TerrainGenerator(seed)` 用 SimplexNoise + LCG 伪随机生成，全流程无 `Math.random`。这是联机「各端自行生成相同地形、只同步修改增量」的基础；地形生成与网格构建进一步下沉到 **Worker 线程**，主线程零卡顿。
- **单一方块写入入口**：`World.setBlock` 是唯一方块修改入口，联机时统一经它上报（挖掘/放置/TNT 爆炸/活塞全覆盖），并带 `_applyingRemote` 防回环标志；写方块同时驱动体素光增量更新。
- **体素光照**：`LightEngine` 双通道（天光/方块光 0-15）BFS 传播 + setBlock 增量更新（双队列移除 / 列重播种）；网格顶点携带平滑光照 + AO，昼夜只改共享 shader uniform 不重建网格；光照纯客户端视觉，不进存档与协议。
- **存档**：localStorage 多槽位（`project-mc-save-N`），存 `seed + modifiedBlocks 增量 + 玩家状态 + 红石 + 时间`；联机时世界状态由服务器落盘、玩家档案（背包/位置）由服务器按房间独立持久化。
- **联机模型**：轻量主机 + 各端自跑。Node 服务器只做房间管理、方块账本（last-write-wins 仲裁）、玩家中继、昼夜权威、掉落物账本与玩家档案存储；客户端各自生成世界、自跑物理，只同步外部可见状态。

> 更细的架构细节与防回退约定（存档切换状态清理、纹理管线、光照实现、物理与游泳、食物与饥饿、合成、红石、存档 API、双平台差异）见 [`../AGENTS.md`](../AGENTS.md) 的「架构要点」等小节；按子系统的历史踩坑见 `docs/agent-notes/`。

## 回归测试与 CI

### 一键跑批

```bash
./server/run-all-tests.sh   # 清状态 → 起服 → 跑全部套件 → 停服（CI 同款入口）
```

等价于 `npm test`；任一套件失败整体退出 1，跑前须 3001 空闲，脚本会在跑批前后清理测试世界与鉴权账号。**套件清单与计数以脚本输出为准，本文档不维护数量**（`tests/` 侧套件在起服前先跑，server 侧套件在 3001 就绪后逐个跑，最后停服）。

### 共享 runner 框架

两侧套件各自只有**一份** runner 框架，套件里禁止再写本地断言样板或 `process.exit`：

| 侧 | 框架 | 约定 |
|---|---|---|
| `tests/` | `tests/harness.mjs` | `import { ok, pass, fail, assert, check, configure, finish } from './harness.mjs'`；`assert(name, cond, extra)` 累积式逐条打印、末尾 `finish(label)` 结算退出；`ok(cond, msg)` 是 fail-fast 且成功默认静默（迁移前逐条打印的套件在顶部 `configure({ verbose: true })`） |
| `server/` | `server/test-lib.mjs` | `import { assert, ok, pass, fail, configure, counts, finish } from './test-lib.mjs'`；`configure({ style })` 保持各套件既有输出风格；socket 关闭态下的套件用 `finish({ natural: true })` 走 `process.exitCode`（Windows libuv 下直接 exit 会崩） |

`tests/framework-guard.mjs` 是静态元断言：两侧除框架文件外不得出现 `function ok|assert|check|fail|pass` 定义、不得出现复制粘贴的 `console.error('FAIL: …)` 样板，且每个 `tests/*.mjs` / `server/test-*.mjs` 都必须 import 本侧框架。它按**单层**扫描 `tests/` 顶层，因此共享环境模块（如 Game.js 行为回归网用的 `tests/lib/game-env.mjs`）放子目录即可，不会被要求 import 框架。

**新增一个套件**：新建 `tests/<名>.mjs`（或 `server/test-<名>.mjs`）→ import 本侧框架 → 在 `server/run-all-tests.sh` 的 `PURE_NODE_SUITES` 数组（tests 侧）或 server 侧 for 循环清单里加一行/一项。两处清单就是唯一注册点。

### server 侧套件

需先启动 `node server/index.mjs`（端口 3001）；`test-store` 与 `test-hardening-store` 为纯 node，无需服务器。

| 套件 | 覆盖 |
|---|---|
| `node server/test-mp.mjs` | 协议端到端：方块 / 玩家 / 掉落物 / 怪物 / 红石 / 多房间 / 命令 |
| `node server/test-store.mjs` | 世界落盘往返（无需服务器） |
| `node server/test-admin.mjs` | 管理面板 API |
| `node server/test-stage5.mjs` | 世界内换房 / 重建世界 / 时间戳插值 |
| `node server/test-stage6.mjs` | 手持物品 / 死亡掉落物 / 鉴权过期与日志 |
| `node server/test-stage10.mjs` | RTT / 快捷栏同步 / 掉落归属锁 / 多账号轮换 |
| `node server/test-stage11.mjs` | 白名单 / 权限 / 挥动联动 / 头顶快捷栏 / 抖动自适应 |
| `node server/test-dim.mjs` | 联机维度同步（维度化账本隔离 / 按维度转发） |
| `node server/test-t5.mjs` | 容器（箱子）账本协议 + 挖必掉 |
| `node server/test-idea2.mjs` | 箭矢 / 凋灵之首事件同步 |
| `node server/test-profile.mjs` | 玩家档案（上报收录 / 落盘 / 恢复） |
| `node server/test-idea4.mjs` | 房间设置开关 / 限速 / 备份 |
| `node server/test-skinlog.mjs` | 皮肤代理拉取写管理日志 |
| `node server/test-hardening-edge.mjs` | 服务器加固边界（畸形 Host / 房间名口径 / 入口幽灵成员 / 面板 XSS） |
| `node server/test-hardening-net.mjs` | 协议版本协商 / 限速扩档 / 皮肤代理限频与日志聚合 / 删房清理 / 心跳热生效 |
| `node server/test-hardening-store.mjs` | 服务端加固：畸形快照不崩服 / 原子落盘 / hostId 守卫（无需服务器） |

### tests/ 侧套件

`tests/` 下有大量不依赖服务器的纯 node 套件，覆盖地形与结构生成确定性、生物群系规模、维度与传送门、战利品与交易表、i18n 键集对齐（i18n-parity）、资源释放守卫（leak-guards）、版本钉值（version-pin）、世界落盘节流与账本回放打包（room-persist-replay）、客户端消息入口防御（net-message-guard）、CW-1 区块边界稳定态收敛（cw1-mesh-stability）、`src/ui` + `src/audio` import 冒烟（ui-audio-smoke）、`src/player/Game.js` node 级行为回归（game-behavior + 假环境 `tests/lib/game-env.mjs`）、runner 样板唯一化元断言（framework-guard）等，由 `run-all-tests.sh` 统一调度；具体清单同样以脚本输出为准。

### 注意事项

> 回归测试对**同一台持续运行的服务器**非幂等（测试房间与世界存档会累积、鉴权用例会改动口令）。重复跑批前请重启服务器（或清空 `server/world/` 与 `server/config.json`）——`run-all-tests.sh` 已自动处理。

### CI

`.github/workflows/ci.yml`：push 到 master / PR / 手动触发时，在 `.nvmrc` 指定的 Node（当前 24）上 `npm ci`（前端与 server 各一次）→ 对 `src/`、`server/`、`tests/` 下全部 `.js` / `.mjs` 跑一遍 `node --check`（语法级全量兜底，任一文件失败即整步失败）→ `npm run build` → `./server/run-all-tests.sh`。CI 不写死套件与断言数量。

批次踩坑备忘见 `docs/agent-notes/`（按主题分文件，改动对应子系统前先读）；局域网联机设计见 `docs/lan-multiplayer-design.md`。
