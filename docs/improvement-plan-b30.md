# Tiderift B30 改进多轮修复计划

> 来源：`docs/improvement-audit-b30.md`（Build 30 全项目改进审查，共 40 条发现：高 11 / 中 17 / 低 12）
> 基准提交：`e7b9a17`（Beta Build 30）· 计划制定：B30 修复会话
> 交付口径：**每轮结束停下等待用户指令**；Build 递增推迟到四个批次全部完成后进行（见 D5），Release 事前确认。

## 一、已确认决策

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 轮次划分 | 审计文档「四、修复路线」的四批各为一轮（轮 1–4）；长期渐进项待前四轮完成后再排期 |
| D2 | 每轮收尾口径 | `node --check` 改动文件 → `./server/run-all-tests.sh` 全绿 → 签名提交 → push → CI 绿；**Build 递增与 Release 每次单独等用户批准** |
| D3 | 本轮（轮 1） | 立即开工 |
| D4 | 计划落盘 | 本文件与审计报告一并纳入版本控制 |
| D5 | Build 递增时机 | **四个批次全部完成后**再递增 BUILD 并发 Release（用户指示），中途批次只签名提交 + push + CI 绿 |
| D6 | README 审查 | 轮 4 按全局 AGENTS.md 执行：README 只保留用户向内容，开发者向章节（回归测试/项目结构/架构要点/开发命令）迁入 docs/ |
| D7 | 长期项排期 | 用户 2026-10-17 确认：轮 5 联机服务端打磨 → 轮 6 前端模式归一 → 轮 7 工程与覆盖 → 轮 8 F3 Game.js 拆分（先评估后迁移）；E11（three 升级）/E14（i18n 组织）判定不做；Build 递增与 Release 仍逐次单独批准 |

## 二、轮次总览

| 轮 | 主题 | 来源条目 | 状态 |
|---|---|---|---|
| 1 | 服务器安全加固 | S1 S2 S3 S4 S5 | 已完成（`a030689`，CI run 39037222541 绿） |
| 2 | 前端资源泄漏收口 | F1 F2 F4 | 已完成（`2f72c68`，CI run 39038154519 绿） |
| 3 | 工程卫生（计数失真 / 钉值收敛 / 测试入口 / 包名） | E1 E2 E7 E10 | 已完成（`e99aaa6`，CI run 39038850135 绿） |
| 4 | README 出仓（用户向化） | E3 | 已完成（`2f99b3f`） |
| 5 | 联机服务端打磨（限速扩档/皮肤代理/落盘节流/回放打包/删房清理/协议版本/心跳热生效/入口防御） | S6 S7 S8 S9 S10 S11 S12 S13 | 已完成（`4520a7b`，CI run 39091785891 绿） |
| 6 | 前端模式归一 | F5 F6 F7 F8 F9 F10 F11 F12 | 已完成（`d908532`，CI run 39120118156 绿） |
| 7 | 工程与覆盖 | E4 E5 E6 E8 E9 E12 E13 | 已完成（`6f5f3ec`，CI run 39122476650 绿） |
| 8 | F3 Game.js 拆分（门面委托形态；含步 0 回归网共 9 步） | F3 | 已完成（代码 `488de83`，CI run 39224682211 绿；Game.js 3769 → 2273 行，行为网 38 → 187 断言） |
| 9 | 既有缺陷 H1/H2：放置重叠右键被吞 / 空桶射线无法选中流体源 | H1 H2 | 步 1 已完成（`8d9d566`，CI run 39227588945 绿）；步 2 已完成（H2，提交 `f4e2a5c`；CI run 39239516263 绿；`game-behavior` 190 → 196、68 个套件块全绿；Build 32 / Release 未执行） |
| 不做 | E11 three 升级（阴影注入链路重写）、E14 i18n 组织（现状三重校验兜底） | E11 E14 | 已判定不做 |

## 三、轮 1：服务器安全加固（S1–S5）

范围仅 `server/`，拆两路并行实施，文件边界互斥（避免同文件并发写冲突）。

| 路 | 负责条目 | 独占文件 |
|---|---|---|
| A | S1 崩溃路径一（HTTP handler 顶层 try/catch + process 级兜底）、S4 房间名口径与 admin.html XSS、S5 入口侧（CREATE/JOIN 先退旧房） | `server/index.mjs`、`server/admin.html`、`server/run-all-tests.sh`（仅测试注册行）、新建 `server/test-hardening-edge.mjs` |
| B | S2 存档 restore 内层校验、S3 落盘原子化 + 坏档归档、S5 房间侧（createRoom hostId 空位守卫） | `server/room.js`、`server/store.js`、`server/config.js`、新建 `server/test-hardening-store.mjs` |

**验收标准（对照审计文档）**

1. 畸形 `Host` 头请求返回 400，进程存活（有自动化断言 + 手工复现输出）。
2. 坏存档（shape 畸形）经同步链/启动加载不再打崩进程：报警 + 跳过，坏档归档保留现场。
3. 生产落盘路径统一 tmp + rename 原子替换（`grep -rn 'renameSync' server/` > 0，持久化路径全覆盖）。
4. admin 面板房间名/玩家名注入不执行（统一过 `esc()`，静态断言 + 手工核对）。
5. 双会话同房间名重复创建，host 不被夺走；CREATE/JOIN 不再产生跨房间幽灵成员。
6. `./server/run-all-tests.sh` 全绿（含新增两套件）。

**证据要求**：关键 diff 片段、`node --check` 结果、跑批末尾输出、断言计数、未覆盖风险点。

## 四、轮 2：前端资源泄漏收口（F1/F2/F4）

两路并行实施，文件边界互斥。

| 路 | 负责条目 | 独占文件 |
|---|---|---|
| U | F1 `InventoryScreen` 补 `dispose()`（移除 3 个 document 监听器 + tooltip/cursorEl/el 三个 DOM 节点，幂等）、F2 `World.unloadChunk` 补 `lightMesh` geometry dispose | `src/ui/InventoryScreen.js`、`src/core/World.js` |
| G | F4 eyeFlight/arrows/witherSkulls/beacon 清理迁入 `_disposeWorld()` 单点收口、F1 调用点接线（`inventoryScreen.dispose()`） | `src/player/Game.js` |

**验收标准**：① `node --check` 全部改动文件；② 连续进出两次存档后 document 监听器计数不增长（浏览器探针）；③ `unloadChunk` 的 solid/water/light 三个 geometry 均被 dispose（node 行为级探针）；④ `returnToMenu()` 后共享 scene 不残留投射物与光标层，`_disposeWorld()` 是唯一收口点；⑤ 全套件跑批绿。

## 五、轮 3：工程卫生（E1/E2/E7/E10）

两路并行，文件边界互斥。

| 路 | 负责条目 | 独占文件 |
|---|---|---|
| X | E1 CI 步骤名去硬编码计数 + 开发者文档套件清单对账、E7 根 package.json 补 `test` 入口、E10 `server/package.json` 与 lock 包名改 `tiderift-server` | `.github/workflows/ci.yml`、`package.json`、`server/package.json`、`server/package-lock.json`、`AGENTS.md` |
| Y | E2 12 处 BUILD 钉值收敛到单文件 `tests/version-pin.mjs`（含"全仓无第二处钉值"元断言）、E1 跑批脚本头部注释口径 + 新套件注册 | `tests/**`、`server/run-all-tests.sh`（注释行与注册块） |

**验收标准**：① `grep -rn 'BUILD === ' tests/` 仅剩 `tests/version-pin.mjs`；② 12 个被摘除钉值的测试文件逐个单跑全绿；③ `npm test` 可跑通且 `./server/run-all-tests.sh` 全绿；④ CI 步骤名不再含写死计数；⑤ 三个 package JSON 的 server 侧 name 均为 `tiderift-server` 且 lock 与 manifest 一致；⑥ AGENTS.md 联机测试段套件清单完整、无易漂移计数。

## 六、轮 4：README 出仓（E3）

单路实施（唯一写入者持有 README.md 与新建 docs/development.md，避免同文件并发冲突）。

| 路 | 负责条目 | 独占文件 |
|---|---|---|
| R4 | E3：README 迁出「回归测试 / 项目结构 / 架构要点 / 开发命令」四节 → 新建 `docs/development.md` 承接并去重纠错；README 只留用户向内容 + 一条开发者入口 | `README.md`、新建 `docs/development.md` |

**验收标准**：① README 标题清单中不再有上述四节（联机小节编号 1/2/3 不乱）；② `docs/development.md` 覆盖原四节信息，命令与路径逐条真实存在（对照 package.json / 启动脚本 / run-all-tests.sh / docs 列表核对）；③ 迁出的回归测试段修正漂移（补 test-t5/test-dim/test-skinlog/test-hardening-edge/test-hardening-store 与 tests/ 纯 node 套件，去掉易漂移计数）；④ 与 AGENTS.md 去重（深水细节指向而非复制）；⑤ 按全局 AGENTS.md「README 面向用户、不得掺入开发者细节」逐节核对通过；⑥ 我复核后跑整批回归全绿。

## 七、进度记录

| 轮 | 开始 | 结束 | 交付提交 | CI | 备注 |
|---|---|---|---|---|---|
| 1 | 2026-10-17 | 2026-10-17 | `a030689`（文档 `17cf02d`） | run 39037222541 绿 | 两路并行；独立验收探针 7/7；跑批 15 套件全绿 |
| 2 | 2026-10-17 | 2026-10-17 | `2f72c68` | run 39038154519 绿 | 浏览器探针：两次进出存档监听器净增 0、scene 无残留；新增 leak-guards 17/17 |
| 3 | 2026-10-17 | 2026-10-17 | `e99aaa6` | run 39038850135 绿 | 12 处 BUILD 钉值 + 2 处 VERSION_LABEL 钉值收敛到 tests/version-pin.mjs；反证测试证明元断言会 FAIL；npm test 入口上线 |
| 4 | 2026-10-17 | 2026-10-17 | `2f99b3f` | 见下（本提交后 push） | README 268→184 行；新增 docs/development.md（166 行）承接四节并修正漂移计数 |
| Build 31 | 2026-10-17 | 2026-10-17 | `070492d` | run 39039746519 绿 | BUILD 31 + 签名 tag `beta-build-31` + Release（Latest） |
| 5 | 2026-10-18 | 2026-10-18 | `4520a7b`（本轮含文档） | run 39091785891 绿 | 两路并行（N1 服务端加固 5 条 / N2 落盘节流+回放打包+客户端防御）；调度方独立黑盒探针 22/22（写盘 200→3 次、SIGTERM 强刷、600 格回放 512+88 分块、删房清理、心跳 2006ms 热生效、皮肤限频 429 与日志 35→1）；浏览器端到端冒烟通过（0 TypeError）；新增三套件 51/28/18 已并入跑批；文档同步 AGENTS.md / docs/development.md / docs/agent-notes/multiplayer.md |

| 6 | 2026-10-18 | 2026-10-18 | `d908532`（文档另提交） | run 39120118156 绿 | 两波四路（第一波 P/Q/S 并行，第二波 R）；F5 四屏光标层收编 CursorOverlay（leak-guards 47/47）；F6 球体判别式统一 raySphereHit（MobManager 两处 + 远端玩家，消除每怪每帧 new Vector3）；F7 modifiedBlocks 分桶索引（40k 账本 169 区块重放 2356ms→10ms，169×65536 格逐字节等价）；F8 dispose 复用 _removeMobResources（唯一清理实现 + 幂等）；F9 眼高/方块中心/移速常量集中；F10 帧射线缓存 + Boss 列表零分配；F11 _anyInputBlockingUI 唯一清单（六类界面阻断挖掘/攻击/弓蓄力）；F12 红石/流体待处理队列键化；新增三套件 tests/ray-sphere、tests/world-mod-index、tests/mob-ray-select 并入跑批 |

| 7 | 2026-10-18 | 2026-10-18 | `6f5f3ec`（本轮含文档） | run 39122476650 绿 | 三路并行 + 第二波一路；E4 run-all-tests.sh 477→124 行（PURE_NODE_SUITES 清单数组 + for 循环，清单即唯一注册点）；E5 两侧唯一 runner 框架（tests/harness.mjs 覆盖 46 套件 / server/test-lib.mjs 覆盖 16 套件），断言调用点数量顺序文案逐字不变、逐套件 PASS 行 943→949、日志 51.9KB→52.1KB；复审发现并返工一次（首版 ok() 无条件打印使日志涨到 1.30MB → 改 configure({ verbose }) 逐套件还原输出口径）；E6 新增 tests/cw1-mesh-stability.mjs（CW-1 稳定态收敛行为级钉值 34 断言，调度方独立反证：注释 World.js 反向标脏 → 6/34 FAIL）+ tests/ui-audio-smoke.mjs（src/ui 24 + src/audio 1 全量 import + 50 条跨模块具名导出核对，88 断言）+ tests/framework-guard.mjs（runner 唯一化元断言 8 断言）；E8 .nvmrc(24) + 根/server engines ">=18"（依据全局 fetch / AbortSignal.timeout 与 Vite 5 范围）+ CI node-version-file；E12 CI 全量 node --check（197 文件 0 失败）；E9 docs/TODO.md 状态对账 159→52 行（交付项归档、保留未排期 U-1）；E13 test-mp.mjs / build22-fixes.mjs / client-sim.mjs 三处陈旧注释 + docs/bug.md 补 CW 前缀续用约定；验收：npm test 全绿（67 套件段）、逐套件日志与轮前基线对照无断言丢失、73 改动文件 node --check 全过 |

| 8 | 2026-10-19 | 2026-10-19 | `488de83`（文档另提交） | run 39224682211 绿 | 九步串行（步 0 回归网 + 步 1–8 每步一域一提交）：Game.js 3769 → 2273 行（−39.7%），9 个域模块 `src/player/`——Summoning 102 / GlideWind 132 / Endgame 144 / Projectiles 301 / Beacon 127 / PortalSystem 244 / Placement 244 / AetherFinale 371 / InteractionController 514；每步口径＝先钉行为（绿）→ 逐条反证（改坏必红 + md5 逐字节还原）→ 搬家 + 薄门面 → `node --check` → 全量跑批 + 逐套件 PASS 行对照 → 断言数只增不减；行为网 tests/game-behavior.mjs 38 → 187 断言；禁改区（`constructor` / `start` / `update` / `_disposeWorld` / `_frameRay` / `updateRaycast` / `_anyInputBlockingUI`）逐步花括号切片与 HEAD 逐字节核对；调度方每步独立复核（自写扫描器复算 md5 / 独立改坏点 / 自跑全量跑批 / 逐方法 token 级保真比对） |

| 9（步 1） | 2026-10-19 | 2026-10-19 | `8d9d566`（文档另提交） | run 39227588945 绿 | H1 修复：段③放置重叠守卫整段移入 `if (blockDef)` 内（只对可放置方块生效），手持弓/末影之眼不再被静默吞掉右键；Q25 由「蓄力被吞」改写为「进入蓄力」，新增 Q25a 真方块正对照 / Q25b 末影之眼 / Q25c 手持杂物兜底消费；断言 187 → 190，逐套件 PASS 行仅 `game-behavior` 186 → 189（其余 65 套件零差异），66 套件全绿；调度方独立反证三组（删守卫 → Q25a 红；守卫放回 `if (blockDef)` 之前 → Q25/Q25b/Q25c 红；守卫出口改为置位消费 → Q25a 红）每组 md5 逐字节还原；`src/player/Game.js` 零改动 |
| 9（步 2） | 2026-10-19 | 2026-10-19 | `f4e2a5c` | run 39239516263 绿 | H2 源流体射线：Q20/Q20a/Q20b + 水下选择/挖掘、弓水面蓄力、末影之眼水面掷出；`game-behavior` 190 → 196；`npm test` 68 个套件块全绿且除该套件外 PASS/FAIL 行零差异；两种变异均被对应钉子捕获且 Raycast MD5 精确恢复；真实浏览器右键舀水通过。 |

## 八、轮 5 · 联机服务端打磨（S6–S13）

两路并行，文件边界互斥；跨文件接口由调度方冻结（见下），接线只允许一处（index.mjs 属 N1）。

| 路 | 负责条目 | 独占文件 |
|---|---|---|
| N1 | S6 限速扩档（join/skin/profile 三档 + 丢包上报口径扩展）、S7 `/api/skin/` 加固（IP 限频 / 缓存上限与清扫 / 三跳超时 / 域名白名单 / 日志节流）、S10 删房清理残留（玩家档案 + backups + lastBackupAt）、S11 服务端协议版本校验 + WELCOME 回显、S12 心跳热生效；并完成 11 个 `server/*.mjs` 的版本字面量迁移 | `server/index.mjs`、`server/ratelimit.js`、`server/config.js`、`server/protocol.js`、`server/admin.html`、`server/client-sim.mjs`、`server/test-*.mjs`（除 `test-mp.mjs` / `test-dim.mjs`）、新 `server/test-hardening-net.mjs` |
| N2 | S8 世界落盘节流（房间级脏标记 + 强刷）、S9 回放批量打包（`BLOCK_CHANGE_BATCH` 512 格/条 + `bufferedAmount` 背压）、S11 客户端上报 `PROTOCOL_VERSION`、S13 客户端消息入口空值防御 | `server/room.js`、`src/net/NetworkManager.js`、`server/test-mp.mjs`、`server/test-dim.mjs`、新 `src/net/netMessage.js`、新 `tests/room-persist-replay.mjs`、新 `tests/net-message-guard.mjs` |

**冻结接口（两路共同遵守）**

```js
// server/protocol.js（N1 新增）
export const PROTOCOL_VERSION = 1;

// server/room.js（N2 新增/改动）
save()          // 不变：立即 onSave（结构性变更调用点保持原样）
saveSoon()      // 仅置 this._worldDirty = true，不落盘（高频方块/容器/掉落路径改用它）
flushWorld()    // 脏则立即 onSave 并清标记；不脏时空操作（幂等）
isWorldDirty()  // 布尔（测试用）
// removePlayer() 内：房间空置（players.size === 0）时 flushWorld()

// server/index.mjs（N1 接线；N2 不得改此文件）
const worldFlushSweep = setInterval(() => { for (const r of rooms.values()) r.flushWorld(); }, 1000);
// shutdown()：对每个房间 flushWorld()（store.saveRoom 兜底保留）；clearInterval(worldFlushSweep)
```

**握手口径**：客户端 `HELLO { name, version: PROTOCOL_VERSION }`；服务端 `Number(msg.version) !== PROTOCOL_VERSION` → `KICKED`（提示版本不一致、请刷新页面）并关闭连接；`version` 缺失（undefined/null）按旧客户端放行，`WELCOME` 带 `legacy: true`；`WELCOME` 恒带 `protocol: PROTOCOL_VERSION`。

**验收标准**：① 改动文件逐个 `node --check`；② 新增套件注册进 `./server/run-all-tests.sh`（由调度方统一加，两路均不得改该脚本）；③ `npm test` 全绿且套件数/断言数不下降；④ 八条发现逐条可验证——限速新档超限丢包并进面板计数、皮肤端点 IP 限频 + 缓存上限清扫 + 三跳超时 + 域名白名单 + 日志节流、删房后档案/备份/内存条目全部清空、落盘节流（突发方块改动不即时落盘、flush 后落盘、关服强刷）、回放以 `BLOCK_CHANGE_BATCH` 分块（>512 格分多条）+ 背压等待、版本不匹配被踢且匹配放行、心跳改配置后在线连接下一轮即生效、`_handle` 对 null/数组/非法 JSON 不抛异常。
## 九、轮 6 · 前端模式归一（F5–F12）

两波实施：第一波三路并行（文件边界互斥），第二波单路（消费第一波产出的共享模块）。

**第一波**

| 路 | 负责条目 | 独占文件 |
|---|---|---|
| P | F5 UI 光标层归一（CursorOverlay 组合件替换四个 Screen 逐字复制的光标层，并接管其资源释放） | 新建 `src/ui/CursorOverlay.js`、`src/ui/ChestScreen.js`、`src/ui/FurnaceScreen.js`、`src/ui/InventoryScreen.js`、`src/ui/TradeScreen.js`、`tests/leak-guards.mjs`（可选扩展） |
| Q | F6 Game 侧（远端玩家球体检测改纯函数）、F9 眼高/方块中心/移速常量集中（Game.js + Player.js）、F10 帧射线缓存、F11 `_anyInputBlockingUI()` 收口 | `src/player/Game.js`、`src/player/Player.js`、`src/player/Raycast.js`（仅追加导出）、新建常量模块（Q 定名，回报列出导出清单）、新建 `tests/ray-sphere.mjs` |
| S | F7 `modifiedBlocks` 分桶索引（applyModifications 去全量扫描）、F12 RedstoneSystem/FluidSim 热路径坐标 key | `src/core/World.js`、`src/core/RedstoneSystem.js`、`src/core/FluidSim.js`、新建 tests/ 下纯 node 套件 |

**第二波（第一波交付后开工；此时 `src/player/Game.js` 已由 Q 释放）**

| 路 | 负责条目 | 独占文件 |
|---|---|---|
| R | F6 MobManager 侧（attackMob/findMobByRay 改调 raySphereHit）、F8 dispose 复用 `_removeMobResources`、F9 MobManager 内 `+ 0.5` 换常量、F10 BossBar 数据源（MobManager 维护 boss 列表 + Game 侧读取点改直读） | `src/entity/MobManager.js`、`src/player/Game.js`（仅 boss 列表读取处，约 1105-1115） |

**冻结接口（第一波产出 → 第二波消费）**

```js
// src/player/Raycast.js（Q 追加导出；既有 Raycast 类语义不变）
export function raySphereHit(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius) // → number
// 与旧内联实现逐式等价：oc = origin - center，b = oc·d，c = oc·oc - r²，disc = b*b - c；
// disc < 0 → -1；t = -b - sqrt(disc)；t < 0 → -1；否则返回 t。未命中恒为 -1。
// MobManager 侧球心 (mob.position.y + mob.height*0.5)、半径 max(width,height)*0.5；
// ⚠ 勘误（R 路实施时发现并纠正）：本行初稿写作 position.y - height*0.5，是符号笔误。
//   旧式 oc = rayOrigin - mob.position 后再 oc.y -= height*0.5 ⟺ 球心 y = position.y + height/2；
//   raySphereHit 内部 ocy = oy - cy，传减号会与旧行为整整差一个 height（高个怪被静默漏判）。
//   代价：球心在调用方预计算，与旧式 (oy-py)-h/2 相比有 ≤1 ulp 的浮点重结合差异——
//   随机对拍 3000 组判定/命中选择零差异（t 最大差 1.1e-14），仅「旧式 disc 恰好为 0」的相切刀刃会翻转，属可接受边界。
// Game 侧远端玩家球心 rp.group.position、半径 0.5，命中后仍由调用方做 1.8 身高区间判定。

// 常量模块（Q 新建）：至少导出 PLAYER_EYE_HEIGHT = 1.62、BLOCK_CENTER = 0.5 与三档移速常量；
// 确切路径与导出清单以 Q 回报为准，第二波按实际文件 import，不得改动该文件。
```

**验收标准**：① 改动文件逐个 `node --check`；② `npm test` 全绿且套件/断言数不下降；③ F5 光标层代码仅存在于 `CursorOverlay.js`（grep 证明），四个 Screen 的 dispose 幂等；④ F6 全仓无第二份球体判别式，纯函数探针覆盖命中/未命中/背向/相切/球心落于射线；⑤ F7 `applyModifications` 不再全账本遍历，索引在「写入 / 删除 / 维度切换 / 存档载入 / 批量 set」五条路径保持一致，探针按区块验证只应用本区块格子；⑥ F8 与 `_removeMobResources` 只有一份清理代码，重复 dispose 幂等；⑦ F9 眼高/方块中心/移速在 Q、R 独占文件内不再硬编码（grep 前后计数对照）；⑧ F10 帧射线不再每帧 new，BossBar 数据源不再每帧 filter；⑨ F11 `_anyInputBlockingUI()` 单一清单，弓蓄力与挖掘早退清单补齐 beaconScreen/steleScreen；⑩ F12 热路径不再反复 split+Number，键格式与外部消费者（`FluidSim.rehydrate` 消费账本键）不变；⑪ 浏览器端到端冒烟：四个界面开合后 document 监听器净增 0、光标层与 tooltip 正常、console 0 TypeError，信标界面打开时弓不可蓄力/不可挖掘。

**证据要求**：每路给出改动清单、`node --check` 输出、定向探针输出与断言计数、迁移前后对照表、未覆盖风险点。


**轮 6 实施中发现（不在本轮范围，待排期）**

- 手持非方块（弓 / 末影之眼）且准星所指方块的「放置邻格」落在玩家自身 AABB 内时，右键会被 `Game.handleMouseInput` 的放置重叠守卫静默吞掉——`src/player/Game.js` 约 1884-1895 行的守卫条件只判 `sel && hit`，在 `BlockRegistry.getByName(sel.name)` 判断（1897 行）**之前**就 `return`，于是永远走不到 1938 行的弓蓄力分支。表现为「盯着脚边方块时弓无法蓄力 / 末影之眼掷不出」。
- 归属：`git show HEAD:src/player/Game.js` 同区结构一致 → **轮前既有行为，非本轮回归**；按范围纪律本轮未改（最小修复＝把重叠检查移进 `if (blockDef)` 分支内，仅对真正要放置的方块生效）。
- 证据：浏览器变体对照（`.run/round6-f11-diag2.mjs`）——`selectedBlock` 非空时同一 `handleMouseInput` 调用不进入蓄力；置空后立刻进入（无异常、无右键消费）。

## 十、轮 7 · 工程与覆盖（E4 E5 E6 E8 E9 E12 E13）

三路并行（含调度方两路），第二波单路补覆盖；文件边界互斥，同一文件只有一名写入者。

| 路 | 负责条目 | 独占文件 |
|---|---|---|
| A | E5 tests 侧共享框架：新建 \`tests/harness.mjs\`，46 个 \`tests/*.mjs\` 全部迁移（删各自 runner 与退出样板）；E13 \`tests/build22-fixes.mjs:10\` 头注释 BUILD 号漂移 | \`tests/*.mjs\`（不含 \`tests/framework-guard.mjs\` 与第二波新增文件） |
| B | E5 server 侧共享框架：新建 \`server/test-lib.mjs\`，16 个 \`server/test-*.mjs\` 全部迁移；E13 \`server/test-mp.mjs:1\`「临时，测完删除」陈旧注释 | \`server/test-*.mjs\`、新建 \`server/test-lib.mjs\` |
| C | E8 Node 版本契约机器化（\`.nvmrc\` + \`engines\` + CI 对齐 + 文档声称对齐）、E12 CI 全量 \`node --check\`、E9 \`docs/TODO.md\` 状态对账、E13 \`docs/bug.md\` CW 前缀续用约定 | 新建 \`.nvmrc\`、\`package.json\`、\`server/package.json\`、\`.github/workflows/ci.yml\`、\`docs/TODO.md\`、\`docs/bug.md\`、\`README.md\`、\`docs/development.md\` |
| 调度 | E4 \`server/run-all-tests.sh\` tests 侧 46 个复制粘贴 if 块改显式清单数组 + for 循环；新套件注册；新建 \`tests/framework-guard.mjs\`（「全仓无第二份 runner 样板」元断言） | \`server/run-all-tests.sh\`、新建 \`tests/framework-guard.mjs\` |
| D（第二波） | E6 覆盖空白：CW-1「稳定态顶点数 === 强制重建」行为级钉值；\`src/ui\` 23 文件 + \`src/audio\` 全量 import 冒烟 | 新建 \`tests/cw1-mesh-stability.mjs\`、\`tests/ui-audio-smoke.mjs\` |

**冻结接口（A 产出 \`tests/harness.mjs\`，D 直接消费；签名与语义不得变）**

\`\`\`js
export function ok(cond, msg)                    // 成功计数 +1 并打印 PASS <msg>；失败打印 FAIL: <msg> 后 exit(1)（沿用 36 个文件的 fail-fast 语义）
export function pass(msg)                        // 只记一条成功（biome-determinism 的 ok(msg) 单参形态）
export function fail(msg)                        // 打印 FAIL: <msg> 后 exit(1)
export function assert(name, cond, extra = '')   // 累积式，打印 PASS|FAIL  <name> <extra>，失败不中断
export const check = assert                      // 旧名别名（biome-scale-determinism）
export function finish(label = '')               // 打印摘要（<label>: <n> assertions ALL PASS / FAILED）并按累积失败数 exit
\`\`\`

- 语义红线：\`ok\` 与 \`pass\` 保持「失败即中断」，\`assert\`/\`check\` 保持「累积 + \`finish()\` 结算」，与迁移前逐文件语义一一对应；**断言条数不得减少**（每个断言仍须输出一行 PASS）。
- 允许新增计数访问器，但上述六个导出名与语义是契约；\`server/test-lib.mjs\` 可独立实现（不要求跨目录复用），同一目录内不得再有第二份 runner 样板。

**验收标准**：① 改动文件逐个 \`node --check\`；② \`./server/run-all-tests.sh\` 全绿，且**逐套件 PASS 行数不低于轮前基线**（基线 \`.run/baseline-round7.log\`）；③ \`tests/framework-guard.mjs\` 通过：\`tests/\` 与 \`server/\` 内除框架文件外无 \`function ok|assert|check|fail\` 定义、无逐文件退出样板；④ \`server/run-all-tests.sh\` tests 侧只剩 for 循环 + 清单数组一处，脚本行数由 477 降至约 280；⑤ \`.nvmrc\` = 24、根与 server \`engines.node\` 一致、CI \`setup-node\` 读 \`.nvmrc\`、README 与 \`docs/development.md\` 的 Node 声称与实际一致；⑥ CI 新增全量 \`node --check\` 步骤且本地实测 0 失败；⑦ \`docs/TODO.md\` 与 AGENTS.md 对账后无「已交付却仍列为待办」的条目；⑧ CW-1 行为级钉值可反证（故意破坏稳定态判定时该套件必须 FAIL）；⑨ \`src/ui\`/\`src/audio\` 全部模块在最小 DOM 壳下成功 import，模块被删或导出被改名时冒烟套件 FAIL。

**证据要求**：每路给出改动清单、\`node --check\` 输出、迁移前后逐套件 PASS 行数对照表、定向探针输出与断言计数、未覆盖风险点。

## 十一、轮 8 · F3 Game.js 拆分（可行性评估 + 迁移方案）

**评估方式**：三路只读评估并行（A 结构与边界 / B 接缝与验证手段 / C 外部不变量），硬约束＝只读（各自收尾自证 `git status --porcelain` 为空），证据落 `.run/round8-{A,B,C}.md`（gitignored）。调度方独立复核：复跑 B 的 node 探针 step7–14、用两种正则重数方法数、逐字核对 `ray-sphere`/`leak-guards` 断言原文。

**实测事实（HEAD `43cbda4`）**

| 项 | 实测 | 审计口径（基线 `e7b9a17`） |
|---|---|---|
| 行数 / 方法数 / 构造器字段 | 3769 / **119** / 59 | 3779 / 117 / — |
| `start` / `update` / `handleMouseInput` | 272-583 / 856-1178 / 1532-1954 | 252-580 / 855-1181 / 1523-1963 |
| 弹射物块 | 1957-2095 + Boss 弹射物 2101-2263 | ~1992-2253 |
| 天域 + 终局 | 2267-2522（**夹层 2526-2652 是脚步/召唤，不属天域**） | ~2253-2763 |
| 信标 / 传送门 / 末影龙 | 2661-2752 / 2756-2960 + `_resolveArrivalY`(3320-3336) / 2964-3028 | 混在 ~2253-3038 |

- 六个可迁移块合计 920 行 = 24.4%；审计「117 方法」是基线口径（轮 6 新增 `_anyInputBlockingUI@200`、`_frameRay@1482`，未删任何方法）。**引用行号一律回源码实测，不得沿用审计数字。**

**结论一：审计的迁移顺序应推翻。** `InteractionController`（423 行单方法 + 29 条域外出边 + `ray-sphere:145` 借原型实调）应**排最后**；实测 `controls` 出现在 `handleMouseInput` 27 段中的 26 段，方法体内 `controls.mouse*` 置位 36 处对 `return` 27 处**不配对**——切分前必须先把「点击已消费」协议显式化。天域块必须**按方法清单切**，不能按审计行区间切。

**结论二：迁移前必须先有回归网。** 现状 67 套件里 **0 个构造 Game**（仅 `ray-sphere:16` 借原型调两个方法），三个巨型方法运行时行为零覆盖；13 个套件约 110 条断言锚的是「代码长什么样」而非「做什么」。

**结论三：形态 = 门面委托**（用户批准）。Game 上保留**同名方法**（签名不变）作为薄门面委托新模块，外部依赖面（NetworkManager / CommandPanel / BeaconScreen / `window.game` / tests 绊线）保持原样可用 → 现有绊线与静默守卫继续有效，每步可回滚、可单独验证。

**步 0（已交付）**：`tests/lib/game-env.mjs`（526 行；放 `tests/lib/` 子目录以避开 `framework-guard` 的单层套件扫描）+ `tests/game-behavior.mjs`（252 行 / **38 断言** / 7.5s）+ `server/run-all-tests.sh:57` 注册。覆盖：A boot（用 `running` 判定，因 `start()` 内部吞异常）、B 定步长帧循环、C 真实瞄准链路 → 创造瞬破、D 生存挖掘（真实挖掘路径，30 帧挖穿）、E 重开生命周期收口、F 同 seed 地形确定性、G 九条**无人守契约**（`applyAetherDusk`/`_miningActive`/`_getBeaconPower`/主菜单期字段/原型方法可用性）、H 帧耗时宽松上界。三条反证均已验证（`update` 早退 → 9/38 FAIL；`applyAetherDusk` 改名 → 1/38 FAIL；`_disposeWorld` 的 `arrows` 清理被删 → 4/38 FAIL），还原后 `git status src/` 为空。

**node 假环境的边界（不得据此宣称"行为已全覆盖"）**：渲染层**零覆盖**（WebGL 是 Proxy，`renderer.render()` 不绘制）；Worker 是进程内仿真（忽略 transfer、不分离 buffer）；无 pointer lock（ESC 暂停/死亡屏/观战切目标不可测）；音频/2D 画布/Image 解码为桩；localStorage 为内存桩；LAN、非主世界维度、怪物战斗、存档往返未覆盖。

**迁移步骤（一步一域一提交，每步全绿）**

| 步 | 域 | 风险锚点 | 状态 |
|---|---|---|---|
| 1 | 召唤（L12）+ 滑翔/气流（L9） | 零锚定小域，首刀 | **已完成**：新建 `Summoning.js`(102) / `GlideWind.js`(132)；Game.js 3769 → 3643（+20/−146）；`game-behavior` 38 → 55 断言；全量跑批 ALL PASS，逐套件 `: OK` 行与基线完全一致 |
| 2 | Endgame（终局） | — | **已完成**：新建 `Endgame.js`(144)；Game.js 3643 → 3578（+12/−77）；8 方法全部门面化（含 `_breakCrystal`）；`game-behavior` 55 → 65 断言（J1–J10）；全量跑批 ALL PASS |
| 3 | Projectiles（弹射物） | `leak-guards:160/161/163-164` 四条断言需同步 | **已完成**：新建 `Projectiles.js`(301)；Game.js 3578 → 3405（+18/−191）；16 方法门面化（箭 / 末影之眼 / 弓蓄力 / 凋灵之首 / 风弹）；5 个静态共享资源迁模块级；`game-behavior` 65 → 74 断言（K1–K9）；全量跑批 ALL PASS |
| 4 | Beacon（信标） | `leak-guards:162`、`BeaconScreen:49/60` | **已完成**：新建 `Beacon.js`(127)；Game.js 3405 → 3314（+13/−104）；8 方法门面化（金字塔等级 / 效果 / 脉冲 / 光柱 / 破坏）；**域字段 `beacons`/`beams`/`pulseTimer` 随迁入控制器**；`game-behavior` 74 → 82 断言（L1–L8）；全量跑批 ALL PASS |
| 5 | PortalsSystem | 先定「到达回调」接口（`_afterPortalArrival` 被双向调用） | **已完成**：新建 `PortalSystem.js`(244，命名避开 `src/core/Portals.js` 纯函数库)；Game.js 3314 → 3144（+18/−187）；8 方法门面化（点火 / 嵌眼 / 站门计时 / 环境粒子 / 触发 / 折跃门 / 到达落点 / 立地面下探）；`game-behavior` 82 → 96 断言；全量跑批 ALL PASS |
| 6 | 放置 / 容器 | `build27:195,198,199` + `build28:260-263,270,271` 同步 | **已完成**：新建 `Placement.js`(244)；Game.js 3144 → 2973（+27/−198）；11 方法门面化（门/床/活板门形制放置与连动破坏 / 箱子与潜影盒 / 容器上报 / 熔炉推进与点燃态同步）；`game-behavior` 96 → 115 断言；4 条源码绊线同步改指新模块；全量跑批 ALL PASS |
| 7 | AetherFinale | 锚定最密（三 endgame 套件 35 条 `gameSrc.includes`）+ 6 个外部调用点 | **已完成**：新建 `AetherFinale.js`(371)；Game.js 2973 → 2705（+41/−309）；13 方法门面化（巨像震地与风拽光环 / 复潮仪式 / 候潮献证 / 听潮门控 / 纹章发放 / 四界同潮窗口与四段粒子 / 复潮状态切换）；演出窗口随迁控制器 `tide` + Game 侧只读访问器 `get _finaleTide()`；`game-behavior` 115 → 151 断言（P1–P36）；17 条锚点改指新模块；全量跑批 ALL PASS |
| 8 | InteractionController | 最后；前置＝显式化点击消费协议 | **已完成**：新建 `InteractionController.js`(514)；Game.js 2705 → 2273（+42/−435）；整方法四段化（编排 / 弓蓄力通道 / 左键链 / 右键链）+ 同名薄门面 + 构造期一行；**点击消费协议显式化**（四态 + `exitsMethod()`；30 处置位语句原位置逐字保留）；`game-behavior` 151 → 187 断言（Q1–Q38）；20 条断裂绊线改指新模块（7 个文件，同断言 / 同 message / 总数不变）；全量跑批 ALL PASS |

- 步 1 生命周期判定＝**构造器共享型**（控制器零状态、无资源可收口；`world`/`mobManager`/`inventory`/`hud` 一律在调用点经 `this.game` 现取，不留构造期快照）；内部调用点**一律走门面**（调用面零 diff）；`_trySummonWither` 的「头层判定 + 形状派发」约 14 行**刻意留在门面**（`build28-block-textures.mjs:266-269` 字面钉在 Game.js 文本上）。
- 反证已做：子代理侧四段（`GLIDE_LIFT` / `GLIDE_DEPLOY_VY` / 凋灵早退 / `GLIDE_DRAG`）＋调度方独立两段（`Summoning.commitWitherSummon` 早退 → I4/I5/I6 FAIL；`_disposeWorld` 的 `arrows` 清理被删 → 4/38 FAIL），还原后 MD5 逐字节一致、`git status src/` 空。子代理自查中还抓到并修掉一条**假钉子**（恒真式在 `GLIDE_LIFT` 6→7 时不报错）。

- 步 2 生命周期判定＝**构造器共享型**（`this.endgame = new Endgame(this)` 紧随 `glideWind`；控制器零状态、无 Three/DOM/监听器，`_disposeWorld` 零改动）；`world`/`mobManager`/`net`/`chatBox`/`networkMode` 全在调用点经 `this.game` 现取。终局域抵达末地维的钉子走**真实启动路径**（`loadData.dimension='end'` → 真实生成器 + 真实 mobManager + 真实账本）。
- 步 2 反证：子代理 10 例（J1–J10 每条至少在一例中变红，逐例 MD5 还原）；**调度方独立一段**：删 `Endgame.ensureEndReturnPad` 的 `endPadExists()` 守卫 → J5 FAIL（1/65），MD5 逐字节还原；调度方自跑全量跑批 `RESULT: ALL PASS`（EXIT=0 / 66 套件），逐套件 PASS 行对照仅 `game-behavior` 37 → 64，`build29-rename-icons` 409 → 412（该套件按 `src/**/*.js` 逐文件断言，+3 = 轮 8 新增三个模块文件，非回归）。
- 步 3 生命周期判定＝**构造器共享型**（`this.projectiles = new Projectiles(this)`；控制器零状态；容器 `this.arrows`/`this.witherSkulls`/`this.eyeFlight` 与 `_disposeWorld` 收口段**留在 Game**，控制器一律调用点现取）；`_arrowGeo`/`_arrowMat`/`_skullGeo`/`_skullMat`/`_galeMat` 五个懒建静态共享资源（全仓 grep 确认仅本域引用）迁为模块级静态、**不** dispose；更新链路 `mobManager.update → updatePortals → eyeFlight → arrows → witherSkulls → tickEffects` 与三处 `if (list.length)` 早退原样保留（勿新增维度/模式门控）。
- 步 3 反证：子代理 9 例（K1–K9，迁移前后各做一遍，逐例 MD5 还原）；**调度方独立一段**：`updateWitherSkulls` 的 `hurt(8,` → `hurt(9,` → K4 FAIL（1/74），MD5 逐字节还原；调度方自跑全量跑批 `RESULT: ALL PASS`（EXIT=0 / 66 套件），除 `game-behavior` 64 → 73、`ui-audio-smoke` 88 → 89（该套件扫描 `src/**/*.js` 的具名 import 逐个断言，新增模块 +1）外零差异。
- **对照口径补充（⑤ 的例外）**：`server/test-hardening-net.mjs` 含**外网探针**断言（`/api/skin/jeb_` 缓存命中），无外网时打 `SKIP` 行并少 1 条 PASS——逐套件对照须按 `SKIP` 行判定，不得当成回归（步 3 子代理的日志恰好命中该情况：`51 → 50`；调度方自跑复现为 51）。
- 步 4 生命周期判定＝**构造器共享型（控制器自带域状态）**：`this.beacon = new Beacon(this)` + 域字段（激活表 `beacons` / 光柱表 `beams` / `pulseTimer`）随迁——全仓无 `game.beacons` 等外部读取方；光柱 mesh 挂在跨存档共享 scene 上 ⇒ `_disposeWorld` 里那唯一一次 `this._clearBeaconState();`（仍在切片内、leak-guards:162 口径不变）经门面走控制器摘除 + dispose。实测探针：激活后 `sceneBeams=1`，真实 `start()` 重开后三表归零、连续三次 start 无残留。
- 步 4 反证：子代理 17 次改坏（迁移前 8 + 迁移后 8 + 删构造期实例化 1，后者直接 A1 FAIL + `start()` 崩——证收口链确经控制器）逐例 MD5 还原；**调度方独立一段**：`Beacon.pulseBeacon` 的 `10 * power` → `5 * power` → L6 FAIL（1/82），MD5 逐字节还原；调度方自跑全量跑批 `RESULT: ALL PASS`（EXIT=0 / 66 套件），除 `game-behavior` 73 → 81 与 `test-hardening-net` 50 → 51（外网探针可用，按 SKIP 口径非回归）外零差异。
- 步 6 生命周期判定＝**构造器共享型（控制器零自带状态）**：`this.placement = new Placement(this)`（紧随 beacon）；域状态全部来自 World（`world.furnaces`/`world.containers` 按维度分桶、随世界生命周期），控制器正文只有 `g.world.`×20 / `g.player.`×3 调用点现取，零 Three / 零 DOM / 零监听器 ⇒ `start()` 与 `_disposeWorld()` 零 diff。域内跨方法调用刻意仍走门面（`g._facingTowardPlayer`/`g._facingAwayFromPlayer`/`g._clearIfFamily`/`g._syncFurnaceLit`），仍留 Game 的 `_cellOverlapsPlayer` 亦经 `g` 现取。删除 `static SHAPED_DIRS`（全仓仅两个已迁方法读取）改为模块级常量；import 收窄（`blockShape` 只留 `facingId`，`SMELT_TIME`/`getSmeltingResult`/`getFuelTime` 随迁）——残留引用实测全为 0。
- 步 6 反证：子代理 24 次有效改坏（迁移前 13 + 迁移后 11，含删构造期实例化 → 19 条 FAIL + 帧循环崩），逐例 MD5 逐字节还原。**自查抓到 1 处覆盖缺口 + 1 条假钉子**：Q5「门上半连动方向反」当时全绿 ⇒ 补 O2b/O2c/O3b 三条分支钉子；R3「床脚方向反」全绿 ⇒ 床段几何使朝向实为 n、被检格恒空气，重写床段布局后复核变红。**调度方独立一段**：`Placement.tryPlaceShaped` 的床分支 `bedId('foot'|'head')` 对调 → O2/O2b/O2c FAIL（3/115），MD5 逐字节还原（`2bc5534e9f88661a54a7107700d2c39a`）后 115 ALL PASS；调度方另做**逐方法 token 级保真比对**（HEAD 方法体 vs 新模块方法体，归一化 `this.`→`g.`、剔除注入的 `const g = this.game;`、`Game.SHAPED_DIRS`→`SHAPED_DIRS`）11/11 等价。
- 步 6 绊线同步（计划行 6 授权的 4 条，同一断言 / 同一 message / 总数不变）：`build27` 的 `doorId(blockDef.baseBlock`、`build28` 的 `furnaceLitId(def.facing` 随 `_tryPlaceShaped`/`_syncFurnaceLit` 迁出；`build28` 的 `this._syncFurnaceLit(key, st)`/`if (!isClient) this._syncFurnaceLit` 唯一来源在 `updateFurnaces` 内，按同一方式改指新模块（其余绊线原样保留并继续通过）。
- 步 6 覆盖缺口（不得据此宣称已全覆盖）：三个破坏函数的**联机分支**（`networkMode && net.sendDropSpawn`）无钉子；盒中盒拒绝属服务器侧 `sanitizeItemData`（由 `server/test-idea2.mjs` 覆盖，假环境不可达）；`FurnaceScreen` 的破坏收口分支钉不了（假环境 DOM 桩 `show()` 抛错，已实测记录）；熔炉 `canSmelt` 的「输出槽满/异类不续烧」门控、`guard++ < 64` 有界循环、门 `open=true` 变体放置、SaveSystem 对 furnaces/containers 的落盘往返未钉。
- **实施中发现（未修，待排期）**：`_placeDragonEgg` **非幂等**——注释称「幂等（已有方块跳过）」，实测第二次调用会在已有龙蛋**正上方再叠一枚**（下扫遇到的第一个非空气格正是上一枚蛋）。当前按现状钉住（J7 消息已写明）；多端各自触发 `_onDragonDefeated` 时会堆蛋，修幂等须同步更新 J7。

- 步 7 生命周期判定＝**构造器共享型（控制器自带域状态）**：`this.aetherFinale = new AetherFinale(this)`（Game.js:128，紧随 `portalSystem`）；控制器只存 `this.game` 与演出窗口 `this.tide`（原 `Game._finaleTide`，构造期 `null`），零 Three / 零 DOM / 零监听器 ⇒ `_disposeWorld` 零改动，`start()`/`_disposeWorld()` 花括号切片与 HEAD 逐字节相同（调度方独立双扫描器复算 md5 一致：`318af74440bcd56f9ad5f943702d9c36` / `5f627a21242dfc2a6cae21e61f8688a8`）。**任务书事实修正**：`_finaleTide` 并非仅域内读写——`src/ui/CommandPanel.js:291` 有一处外部**只读**探针（终局调试按钮判「窗口进行中」）；若直接搬走该按钮会退化为「永远重开窗口」，故状态随迁后 Game 侧保留**同名只读访问器** `get _finaleTide()` 转发控制器，外部读取面逐字不变（初值 `undefined` → `null`，同为假值；全仓无第二处读写、无写入点）。`aetherDusk`/`finaleInfo`（Game）、`world.finalePrimordial`/`world.finaleDone`（World）、`player.emblemWorn`（Player）留原主，控制器调用点现取、不镜像不转发；域内互调仍走门面（`g._applyColossusSlam`/`g._grantPrimordialEmblem`/`g._startFinaleTide`/`g._stopFinaleTide`/`g._finaleParticleTick`/`g.applyAetherDusk`）。
- 步 7 反证：子代理 38 例（迁移前 6 + 迁移后 32 + 补充 3），逐例 md5 逐字节还原；**自查抓到 3 条假钉子**（P1 只断言 off 后 time 未变＝与「删 on 门控」等价；P29 上下界过宽使 0.55→0.50 落在界内；P30 未先清覆盖，直调残留使「三帧后仍在」恒真）已重写复证。**调度方独立两段**（不在子代理用例表内）：`updateColossusAura` 的 `9 * (1 - d / 11)` → `/ 12` → P7 FAIL（1/151）；`applyAetherDusk` 的 `sky.time = 0.32` → `0.35` → P1 FAIL（1/151）；两次还原后 md5 `cdc1b9a7ecfacd8e5386cb8a8c1e9898` 逐字节一致。调度方自跑全量跑批 `RESULT: ALL PASS`（EXIT=0 / 66 套件），逐套件对照 `game-behavior 114 → 150`（PASS 行 +36）为唯一差异。
- 步 7 锚点同步（严格限量，同一断言 / 同一 message / 同一语义 / 总数不变）：三 endgame 套件共 35 条 `gameSrc.includes` 钉 Game.js 文本，**实测断裂 17 条**（endgame-tide 2 / endgame-finale 10 / endgame-content 5）改指新模块；其余 22 条（薄门面签名、Game 内既有调用点、`start()`/换维透传/他处代码）实测原地通过故不动。`build20-fixes:262-268`（aetherDusk 三处）、`game-behavior:216` G7 原样通过；`build29-rename-icons` 416 → 417（+1 = 新模块文件，预期非回归）。逐方法 token 级保真 **13/13 等价**（调度方独立复算同结论；唯一标识符差异：`finaleParticleTick` 颜色分量 `g`→`g2`，因模块统一注入 `const g = this.game;`）。import 收窄实测残留 0（`finale-tide.js` 五个名字全迁、在模块内各 1–2 处实引用；`setAetherDuskProfile` 等保留项未误删）。
- 步 7 覆盖缺口（不得据此宣称已全覆盖）：渲染层零覆盖（钉子只钉「粒子以什么参数 spawn」，屏幕呈现与 `Sky.finaleOverride` 最终混色未覆盖）；联机只到「发送口调用 + 载荷」级（未跑 room.js 往返与 startTs 服务器重排）；换维追潮未真机跑（P28 用未知维度值代替真实 `switchDimension`）；听潮 `end_watch` 情形走 `structureManager` stub；龙影低头用假 mob 项（未跑 dragon AI）；定向未钉 `scaled % 1` 随机加成、`dir.lengthSq() <= 0.0001`、aether/nether 段的 else 周身粒子分支、overworld/end 段的 `sy <= 0` 分支、`applyAetherDusk` 的 sky 为空分支；主菜单期（`world=null`）本域方法未钉。
- **实施中发现（未修，待排期）**：① `tests/game-behavior.mjs` 末尾 `for (const x of games) shutdown(x);` **重复两行**（自步 6 起；`shutdown` 幂等故无行为影响）；② `src/player/Game.js` 的 `ringPoints`（stronghold.js）/ `matchRecipe`（Crafting.js）为**既存死 import**（HEAD 起即如此，随 Endgame / Placement 迁出后失效）；③ `applyColossusSlam` 门控的 `!p.creative && !p.spectator` 与 `Player.hurt` 顶部守卫重复（实测删除行为等价，属冗余非缺陷，故 P5 的判伪改用死亡分支）。`src/world/finale-tide.js:3` 的「`_finaleTide` 挂 Game 实例」注释漂移已在本步提交内订正。

- 步 5 生命周期判定＝**构造器共享型（域内仅存粒子节流计时器）**：`this.portalSystem = new PortalSystem(this)`（Game.js:126，紧随 beacon）；控制器只存 `this.game` 与域内 `partT`（原 `_portalPartT` 的懒建改为构造期 0，全仓 `_portalPartT` grep 归零），零 Three/DOM/监听器 ⇒ `_disposeWorld` 零改动。**穿越三件套 `_portalTimer`/`_portalArmed`/`_portalCooldown` 与 `portalOverlay` 刻意留在 Game**（`start()` 复位 / 新建，本轮禁改区），控制器一律 `this.game._portalX` 调用点现取——`updatePortals → _usePortal → switchDimension → start()` 可同帧换世界，控制器绝不留 `world`/`player` 快照。触发链刻意仍走门面（`this.game._usePortal` / `_useGatewayPortal`），与迁前调用面逐字一致，外部 stub/覆盖仍然生效。
- 步 5 反证：子代理 16 次改坏 → 14 次 FAIL（删萤石→天域映射 1/96、非法框也填充 1/96、12 眼放宽 ≥11 1/96、下界门阈值 2.0→1.0 2/96、删 armed 闸门 4/96、删 cooldown 闸门 1/96、建门站位 +0.5 1/96、吸附半径 24→240 1/96、无坐标冷却 4→0 2/96、未知维度 −1→64 1/96、折跃门阈值 1.0→2.0 1/96、删构造期实例化 5 FAIL + 帧循环崩、装配接缝改常量 1/96、删「下格实心」1/96），逐例 MD5 逐字节还原；两例（删「上方空气」判定 / 列偏移 +1）**经采样实证为行为等价**（51200 列逐值等价、相邻列恰好同高），非钉子缺陷。**调度方独立一段**：`findPortalNear(..., 24)` → `12` → M4b FAIL（1/96），MD5 逐字节还原（`5e42586297eae0c4869a8dac90c57bc9`）；调度方自跑全量跑批 `RESULT: ALL PASS`（EXIT=0 / 66 套件），除 `game-behavior` 81 → 95 与 `test-hardening-net` 51 → 50（本轮调度方机器命中外网探针 SKIP，按 SKIP 口径非回归）外零差异；`start()`/`_disposeWorld()` 花括号切片与 HEAD 逐字节相同。
- 步 5 覆盖缺口（不得据此宣称已全覆盖）：真实换维（`switchDimension` 重建世界 + 落点吸附/建门的真机表现）钉子用 stub 拦截；联机双端（`switch_dimension`/`dimension_world`、服务器清洗 pos）未跑；`PortalOverlay` 视觉无覆盖；`updatePortalParticles` 无行为钉子（假环境 chunk.portalCells 恒空，仅由每帧调用链兜 no-throw）。

- 步 8 生命周期判定＝**构造器共享型（控制器零自带状态）**：`this.interactionController = new InteractionController(this)`（Game.js:119，紧随 `aetherFinale`）；控制器正文里 `this.` 实测只出现 `this.game`（构造器 1 + 四段各注入 1）与三个自有段方法自调用，零 Three / 零 DOM / 零监听器 / 零容器 ⇒ `start()` 与 `_disposeWorld()` 零改动。域内互调仍走门面（`g._tryPlaceShaped` / `g._breakChest` / `g._tryTideRitual` / `g._frameRay` …），`world` / `player` / `mobManager` / `inventory` / `hud` / `controls` / `selectedBlock` / `breakingProgress` / `breakMesh` / `hand` / `_bowCharging` / `_bowCharge` / `redstone` 一律调用点现取。
- 步 8 前置＝**点击消费协议显式化**（本步真正的设计工作，不是搬家附赠）：迁移前是隐式惯例——分支靠顺手置位 `controls.mouseLeft/mouseRight = false` 顺带表达「本次点击已消费」，而置位与 `return` **并不配对**（实测 **30 处置位 / 32 处 return**；计划里的 36/27 是旧 HEAD 口径），423 行单方法一旦切段该区别就丢语义。协议＝四态 `CLICK_CONSUMED`（已消费 + 整方法退出）/ `CLICK_ABORT`（未消费 + 整方法退出）/ `CLICK_CONSUMED_PASS`（已消费 + 交后续段）/ `CLICK_PASS`（未消费 + 交后续段）+ `exitsMethod()` 判据；**置位语句仍在原位置逐字保留**（外部 `Controls` / `update()` / `NetworkManager` 都读 `controls.mouse*`，置位时机与次数不得变），「已消费但继续」由段内 `leftConsumed` 标记发布。逐条对照表见 `.run/step8-evidence.md` §1 与新模块文件头。**注意**：`CONSUMED` 与 `ABORT` 目前都归 `exitsMethod()`，故两者的区分**只是文档标签**（子代理已实证：把某出口的 ABORT 改成 CONSUMED 零行为差异）——行为仍由原位置位承载。
- 步 8 反证：子代理 38 个改坏点 → 36 个精确让目标钉子变红（无效两例如实报告：一个被外层饱腹门控短路、一个即上条标签问题），逐例 md5 逐字节还原。**调度方独立复核**：① 禁改区 7 段花括号切片与 HEAD 逐字节相同（自写双扫描器：`async start` `c262c4ac…` / `_disposeWorld` `80f120a5…` / `update` `9665f6dc…` / `updateRaycast` / `_frameRay` / `_anyInputBlockingUI` / `_cellOverlapsPlayer`）；② **归一化多重集比对：HEAD 方法体 364 行零丢失零改写**，新模块多出的行恰为 4×`const g = this.game;` + 驱动 3 行 + 4 段头与尾括号 + 6 条新增 `return;`（即段边界，非逻辑改写）；③ 正对照改坏（删食物分支的 `g.inventory.removeSelected(1)`）→ Q11 FAIL（1/187），md5 逐字节还原 `a771a8ad…`；④ 自跑全量跑批 `RESULT: ALL PASS`（EXIT=0 / 66 套件），逐套件对照仅 `game-behavior 150 → 186`（PASS 行 +36）与 `ui-audio-smoke 90 → 91`（+1＝新模块文件，该套件按 `src/**/*.js` 全量 import 计数）。
- 步 8 **调度方发现的两处「钉子不敏感点」（已记录；非缺陷，属覆盖缺口）**：① **挖速量级未钉**——`g.breakingProgress += dt * speedMul / hardness` → `/(hardness * 2)` 时 187 条全绿（Q3 只断言 `prog > 0`，Q4 的循环上限 200 帧对半速仍够挖穿）；② **放置重叠守卫的 0.3 边界未钉**——`Math.floor(px ∓ 0.3)` → `∓ 0.0` 全绿（Q25 的站位使 `placeX === Math.floor(px)` 恰好成立，守卫仍触发）。共性＝「分支存在性已钉、量级与边界未钉」。
- 步 8 绊线同步（严格限量，同一断言 / 同一 message / 总数不变）：用「55 个纯 node 套件逐个实跑 + 全仓锚点扫描」定位，**实测断裂 20 条 / 7 个文件**（`build27-doors-beds` 6 / `build28-block-textures` 6 / `endgame-content` 3 / `ray-sphere` 2 / `build26-fluid` 1 / `endgame-finale` 1 / `build20-fixes` 1），逐条改指新模块（`this.` → `g.`）；`ray-sphere` 的「帧射线 / UI 清单被四处消费」两条由单读数改为 `Game + InteractionController` 合计计数（语义不变，消除迁移后必然失配）。逐套件复跑计数不变。
- 步 8 覆盖缺口（不得据此宣称已全覆盖）：**空桶舀水分支经真实射线路不可达**（见 §十三 H2）；联机互殴用「真实 aim 帧 + 直调真实入口」驱动，PvP 关闭跳过远端检测与真实房间往返未钉；熔炉界面 / 村民交易 / 床在非主世界维度引爆三个分支假环境不可达（仅由保真比对兜底）；视觉与音频零覆盖（`hand.swing()` / `audio.*` 未断言到调用），工具 tier 表 / 金工具 9 倍 / 急迫加速 / 掉落与矿经验未钉；桶岩浆、恒昼祭坛图腾召唤、`_tryListenTide` 吞掉右键三条同源分支未钉；`controls.mouse*` 由测试直接置位，未走真实 DOM 鼠标事件（无浏览器手测）。
- **实施中发现（未修，待排期）**：① `_placeDragonEgg` 非幂等（见上文）；② 迁移会让 `tests/` 里的**负向断言**退化为恒真式——全仓实测 6 条 `!gameSrc.includes(...)` 的文本已不在 `src/player/` 任何模块中（轮 8 各步累计造成，本步新增 1 条：`build28-block-textures.mjs:265` 的 `if (def.name === 'chest') this._breakChest`），断言仍通过但已无约束力，建议后续对账时改为「新模块也不含」或删除。
**不动**：L1 世界/网格、L3 物理、L17 维度切换、L2 装配中枢（`constructor`/`start`/`update`/`_disposeWorld`/`_frameRay`/`updateRaycast`/`_anyInputBlockingUI` 等跨域基础设施）。

**每步验收骨架**：① 先为该域加**行为级**钉子（现状必须全绿）；② 反证钉子可证伪（改坏 → FAIL → MD5 逐字节还原）；③ 搬家 + 门面，判定生命周期归属（构造器共享 / `start()` 新建 / 无状态工具，新建型必须在 `_disposeWorld` 收口）；④ 改动文件逐个 `node --check`；⑤ 全量 `npm test` 全绿并与基线 `.run/baseline-round8.log` 逐套件对照（PASS 行数不得丢失；例外＝外网探针类断言，见下方 SKIP 口径）；⑥ `tests/game-behavior.mjs` 断言数只增不减。

**拆分不变量（必须保持）**：`_frameRay`/`_anyInputBlockingUI` 留在 `Game.prototype`（`ray-sphere:145/164/165`）；`this.arrows`/`this.witherSkulls`/`this._clearBeaconState()` 留在 `_disposeWorld()`…`async start(` 区间内各恰一次（`leak-guards:160-164`）；`applyAetherDusk` 对 NetworkManager 可达（`NetworkManager:264/388` 的 `typeof` 静默守卫，零覆盖，现由 `game-behavior` G7 守）；`_miningActive`/`_getBeaconPower` 保持可达；主菜单期字段（`networkMode`/`net`/`playerModel`/`hand`/`renderer`/`controls`）必须在 `new Game()` 后即存在（SkinScreen 在 `start()` 之前就读它们）。

## 十二、轮 9 · 既有缺陷 H1（准星指向自身重叠方块时右键被吞）

来源：轮 6 实施中发现（见上文「轮 6 实施中发现」），`git show HEAD:src/player/Game.js` 同区结构一致 → 轮前既有行为，非回归。**轮 8 步 8 迁移后落点已变**：该分支现在在 `src/player/InteractionController.js` 段③（右键链）的放置重叠守卫处，出口协议状态为 `CLICK_ABORT`（不置位 `controls.mouseRight`）。

**范围**：段③的放置重叠守卫当前在判定「准星方块是否可放置」之前就对 `sel && hit` 早退（判据 `placeX/placeZ ∈ [floor(p-0.3), floor(p+0.3)]`），导致手持弓 / 末影之眼等非方块物品时，只要准星所指方块的放置邻格落在玩家自身 AABB 内，右键就被静默吞掉（弓无法蓄力、末影之眼掷不出）。

**最小修复方向**：把重叠检查移入 `if (blockDef)` 分支（仅对真正要放置的方块生效），非方块物品继续走后续分支。

**步骤拆解（轮 9 = 2 步）**：
- 步 1（**已完成**，`8d9d566`，CI run 39227588945 绿）：H1 修复 —— 守卫整段（注释 + `px/py/pz` + 判据 + 出口）移入 `if (blockDef)` 内、置于 `g.hand.swing()` 之前（`placeX/Y/Z` 计算留原处），真方块行为逐字不变；Q25 由「蓄力被吞」改写为「进入蓄力」（未删除），新增 Q25a 真方块正对照 / Q25b 末影之眼 / Q25c 手持杂物兜底消费；`game-behavior` 断言 187 → 190、`src/player/Game.js` 零改动（md5 `07ea16d1…` 与 HEAD 一致）。反证：子代理三组（删守卫 → Q25a 红 5/190；守卫放回 → Q25/Q25b/Q25c 红 3/190；断开掷眼分支 → Q25b 红 3/190）＋调度方独立三组（删守卫 → Q25a 红并连带 Q27/Q28-Q30/Q31/Q33 共 5/190；守卫放回 → 同子代理 3/190；守卫出口改为置位消费 → Q25a 红 1/190），每次均备份逐字节还原并复核 md5。行为变更（必然推论，已钉死）：手持无专属分支的杂物在重叠格右键，旧「静默不消费」→ 新「末尾兜底置位消费」。
- 步 2（**已完成**，H2；代码提交 `f4e2a5c`，CI run 39239516263 绿）：`Raycast.cast` 消费 `includeFluid`，只命中水/岩浆源方块；Q20 现钉真实舀水链，岩浆源/流动等级与四条水准星无回归路径均有行为证据（见 §十三）。未递增 Build 32、未创建 GitHub Release。

**验收标准**：① 复现用例先红后绿——`game-behavior` 的 **Q25** 就是该缺陷的现状钉子（修复后必须同步改写成「进入蓄力」，不得直接删除）；② 放置路径零回归：贴身放方块仍被拒（重叠守卫对真正的方块放置仍然生效），Q18/Q24/Q26 全绿；③ 弓蓄力 / 末影之眼 / 食物 / 工作台 / 红石 / 容器交互全部分支逐一走查并给出对照；④ `npm test` 全绿。

## 十三、轮 9 步 2 · H2（已完成：`Raycast.cast` 消费 `includeFluid` → 空桶舀取源流体）

来源：轮 8 步 8 实施中发现（子代理发现，调度方读码独立复核）；本步按已批准任务完成。

**根因与修复**：`src/player/Raycast.js` 原签名 `cast(origin, direction, maxDist = 5, includeFluid = false)` 虽由 `Game.updateRaycast` 在手持空桶时传 true，但旧候选过滤排除全部流体。现只有 `includeFluid && def.fluid && def.name === def.fluidType` 才让流体成为命中候选（即 water/lava 源 ID）；`includeFluid=false` 仍穿透所有水/岩浆和流动等级。非流体的 solid/cross 选择规则不变。`Game.js` 与 `InteractionController.js` 未修改；满桶倒出 Q19 维持原状。

**行为钉子 / 红绿证据**：轮 9 步 1 的 `.run/round9-step1-dispatcher.log` 保留旧 Q20 现状 PASS（aim=null、water 留存、空桶未消费，190 assertions）；临时只修 Raycast 后、尚未改写 Q20 时，旧 Q20 明确 FAIL（aim 命中水、源格为空、手持 water_bucket、右键已消费），原始红测记录为 `.run/b30-r9-step2-h2-old-q20-red.log`。最终 `tests/game-behavior.mjs` 的 Q20 改钉真实右键舀水（bucket→water_bucket + 源格为空 + 消费右键），Q20a 钉岩浆源舀取，Q20b 钉 `water_flow_3` 不可选/不取走/不消费；Q20c/d 在玩家眼位真实浸水时由真实射线选中并挖除后方石块；Q20e/f 分别由水面真实准星与右键输入钉住弓蓄力、末影之眼掷出。无手动赋值 `selectedBlock` 或手动写最终交互结果。满桶倒水仍由 Q19 覆盖。

**验证与回归**：`node --check src/player/Raycast.js`、`node --check tests/game-behavior.mjs`、`node tests/game-behavior.mjs` 均通过；`game-behavior` 为 196 assertions ALL PASS（相较轮 9 步 1 的 190 增加 6）。完整 `npm test`：68 个套件块、`RESULT: ALL PASS`、EXIT=0，日志 `.run/b30-r9-step2-h2-npm-test.log`；聚焦行为日志 `.run/b30-r9-step2-h2-game-behavior-final.log`。另以隔离 `agent-browser` 会话锁定 `canvas[data-engine]` 后真实 mouse down/up 右键舀水，观察到 sourceId 11→0、bucket→water_bucket、mouseRight=false；记录 `.run/b30-r9-step2-h2-browser-manual.log`。逐套件 PASS/FAIL 行对照 `.run/b30-r9-step2-h2-suite-compare.log`：对轮 9 步 1 仅 `game-behavior` 从 190→196，其他 67 个套件 PASS/FAIL 行零差异；对轮 8 步 8 基线为 187→196（历史累计 +9），其他套件零差异。

**独立变异反证**：① 移除流体命中逻辑、恢复旧过滤 → Q20 和 Q20a 失败，日志 `.run/b30-r9-step2-h2-mutation-no-fluid.log`；② 去掉 `def.name === def.fluidType` 限制、使任意流动流体可选 → Q20b 失败（实际命中 `water_flow_3`），日志 `.run/b30-r9-step2-h2-mutation-flow-selectable.log`。两次变异前后 `src/player/Raycast.js` MD5 均为 `b22e9ae6c7387e3b4e0d630bc3f7578c`，已逐次校验精确还原；测试文件 MD5 `0f1984832635d65ae612dae89eca92f4`。

`docs/agent-notes/survival-items.md` 已同步桶的源/流动等级规则，并去除过时的「无流动模拟」说法。交付提交 `f4e2a5c`；CI run 39239516263 绿；本步未递增 Build 32，也未创建 GitHub Release（仍需单独批准）。
