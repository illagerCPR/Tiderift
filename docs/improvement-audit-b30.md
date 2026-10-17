# Tiderift 全项目改进审查报告（Build 30）

> 审查日期：2026-10-17 · 基准：master @ `e7b9a17`（Beta Build 30）· 全程只读，未改动任何文件
> 方式：三路并行分领域深审（前端核心 / 服务器与联机 / 工程化与文档），共 **40 条发现**（高 11 / 中 17 / 低 12）；
> 全部「高」级发现经主会话二次实证（读代码核对 + 语言级最小复现），两条崩溃路径均已复现。
> 状态：**报告留档，修复未排期**；修复路线见文末第四节，排期时按批次推进。

---

## 一、高优先级（11 条）

### A. 服务器安全与健壮性（S1-S5，全部在 server/，可一批修完）

| # | 问题 | 位置 | 影响与证据 |
|---|---|---|---|
| S1 | HTTP handler 的 `new URL` 在 try 之外，且全进程无 uncaughtException/unhandledRejection 兜底 | `server/index.mjs:254`（try 从 277 行才开始；全 server/ 无兜底，仅 628-629 SIGINT/SIGTERM） | **一条畸形 Host 头 curl 即打崩整个服务器**。已复现：`Host: a b` → `new URL` 抛 Invalid URL → async 回调变 unhandledRejection → Node 15+ 默认终止进程，所有房间与连接一并消失。方向：handler 顶层包 try/catch 返回 400 + process 级兜底日志 |
| S2 | `Room.restore` 内层 entries 无 Array.isArray 校验 | `server/room.js:156-158`（外层 155 只校验 typeof object；containers 168 与 drops 185 同款；loadRooms 仅校验 name/seed，store.js:59） | shape 畸形的合法 JSON 存档经 ws 消息同步链直接打崩进程。已复现 TypeError: entries is not iterable。方向：内层逐项校验或整个 restore 包 try/catch，坏档报警跳过而非崩服 |
| S3 | 全部落盘非原子：writeFileSync 直接覆盖，全 server/ 0 处 rename | `server/store.js:48`（saveRoom）、90（savePlayerProfiles）、112（backupRoom）、`server/config.js:223` | 写入中途崩溃/掉电 → 文件截断 → loadRooms 解析失败仅打日志跳过 → 同名房间拿到**全新随机 seed 的空世界，静默丢档**。方向：统一 writeFileSync(tmp) + renameSync 原子替换；坏档移 corrupt/ 保留现场 |
| S4 | 管理面板房间名/玩家名裸拼 innerHTML（XSS） | `server/admin.html:330/339`（`房间「${room.name}」`、`<td>${p.name}…`）；esc() 在同文件 219 行且日志/账号表已用（434/545），唯这两处漏 | 任意 LAN 玩家建带 `<img onerror>` 的房间名 → 管理员开面板即执行脚本 → 窃取 localStorage Bearer token 调用全部 op API（含删房/改鉴权）。服务器侧房间名仅 trim 无过滤（index.mjs:676、room.js:94）。方向：统一过 esc() + 房间名长度截断（对齐 roomFileName 40 字符口径） |
| S5 | CREATE_ROOM 无条件覆盖 hostId + CREATE/JOIN 不先退旧房 | `server/room.js:347-348`（`this.hostId = player.id` 无守卫；对照 344-346 seed/biomeScale 均有仅首次守卫）；`server/index.mjs:675-688`（不 removePlayer；对照换房路径 117-118 是先移除的） | **正常双人各按一次「创建房间」（同房间名）即后者夺走 host**（可 world_reset/set_time/gamemode 摧毁世界）；直发换房请求可在两房同时登记成幽灵成员，断线只清最后所在房。方向：hostId 仅在空/offline 时接管；CREATE/JOIN 入口先 removePlayer |

### B. 前端资源泄漏（F1-F2）

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| F1 | InventoryScreen 3 个匿名 document 监听器无 dispose（全文 0 处 dispose） | `src/ui/InventoryScreen.js:93/101/105`（mousemove×2 + contextmenu）；`Game.js` start() 每次新建实例、_disposeWorld 只 remove DOM 不摘监听 | 每次进存档净泄漏 3 个监听器，随存档切换累积。对照正确做法 `ChestScreen.js:62-65`（存引用 + dispose）。方向：补 dispose() 并统一走它 |
| F2 | unloadChunk 漏 lightMesh 的 geometry.dispose | `src/core/World.js:179-186`（只 dispose mesh/waterMesh）；调用方 `Game.js:1217` 只 scene.remove；对照正确路径 Game.js:212 与 1299-1302 | 远距移动卸载含光源区块时泄漏 BufferGeometry；AGENTS 要求卸载逻辑处理三 mesh，唯此路径漏。方向：unloadChunk 内补一行 |

### C. 工程化数字失真（E1-E3）

| # | 问题 | 证据（已实跑统计） |
|---|---|---|
| E1 | 套件/断言计数全面漂移 | `server/run-all-tests.sh:2` 注释写「6 个套件」实为 **52**（tests/ 注册块 39 + server 循环 13）；`.github/workflows/ci.yml:39` 写「152 assertions」实为约 **1,550** 处断言记号（server 侧 assert/ok 349 + tests/ 侧 ok 1243）；152 写于 2026-09-03 be49642 后从未更新。文档侧：AGENTS.md 漏列 dim/t5/skinlog 三套件、README 回归表漏 skinlog、test-mp 39 调用点 vs 文档 34。方向：CI 步骤名去硬编码数字（或脚本末尾动态汇总），注释改「以脚本内清单为准」 |
| E2 | BUILD 钉值断言散布 12 个文件且标签漂移 | `grep 'BUILD === 30' tests/` → 12 文件 12 处；`tests/build20-fixes.mjs:276` 断言 30 标签写「BUILD 24」、`build25-fixes.mjs:163` 断言 30 标签写「BUILD 27」；git log 70ea5dc 自述靠 sed 扫改。违背 src/version.js 单一来源原则。方向：钉值收敛到 1 个文件（如 tests/version-pin.mjs），其余删除或改引共享常量 |
| E3 | README 混入 4 大节开发者内容 | `README.md:142`（### 4. 回归测试）、190（## 项目结构）、231（## 架构要点）、241（## 开发命令）——违反「README 只面向用户」全局规范。方向：四节迁 docs/（大部分 AGENTS.md 已承载，去重合并），README 保留特性/操作/联机指南/已知限制 |

### D. 架构债（F3，渐进处理）

- **F3 · Game.js 上帝类**：3779 行 / 117 方法 / 构造器持 ~40 实例字段；巨型方法 `update`(855-1181, 327 行)、`handleMouseInput`(1523-1963, 441 行/78 分支)、`start`(252-580, 329 行)；职责 ≥12 域。可迁移块仅依赖 world/player/controls/net 窄接口：弹射物 ~260 行(1992-2253)、天域+beacon+终局 ~510 行(2253-2763)、传送门+末影龙 ~275 行(2763-3038)。建议拆分顺序：**InteractionController → ProjectileSystem → AetherRituals**。

---

## 二、中优先级（17 条）

### 前端（F4-F9）

| # | 问题 | 位置 | 方向 |
|---|---|---|---|
| F4 | 存档切换清理双轨：eyeFlight/arrows/witherSkulls/beacon 清理在 start() 开头而非 _disposeWorld 收口，returnToMenu 后残留共享 scene | `Game.js:461-476` vs `_disposeWorld(202-250)` | 迁入 _disposeWorld 单点收口 |
| F5 | UI 光标层（cursorEl/tooltip/mousemove/contextmenu ~45 行）在 4 个 Screen 逐字复制 | ChestScreen/FurnaceScreen 30-70、InventoryScreen 76-110、TradeScreen 41-52 | 抽 CursorOverlay 组合件，顺带消灭 F1 |
| F6 | 射线-球体命中检测三处同构，每 mob 每次 new Vector3 | `MobManager.js:1179/1275`、`Game.js:3735` | 抽 raySphereHit 纯函数 + 模块级 scratch |
| F7 | applyModifications 每次生成区块全量扫描整个 modifiedBlocks 账本并逐条 split | `World.js:167-177`（ensureChunk:99 每区块触发） | 写入时维护 Map<"cx,cz"> 分桶索引 |
| F8 | MobManager.dispose 与 _removeMobResources 两份手工同步的清理代码 | `MobManager.js:823-841` vs `1289-1303` | dispose 循环内复用 _removeMobResources |
| F9 | 魔法数字：眼高 1.62 硬编码 10 处、方块中心 +0.5 共 22 处、移速 4.3/5.6/12 | Game.js:761/1482/1562/1576/1680/1985/2014/3714、Player.js:143/148 等；对照 Physics.js:7-16 已有常量表示范 | PLAYER_EYE_HEIGHT 等常量集中导出 |

### 服务器（S6-S10）

| # | 问题 | 位置 | 方向 |
|---|---|---|---|
| S6 | 限速只覆盖 chat/block/state 三档；JOIN_ROOM 全量回放、SWITCH_DIMENSION 双桶序列化、SKIN_SET 16KB 广播、PROFILE_SAVE 全档校验全部豁免——最重的操作无护栏 | `server/ratelimit.js:39-43` | 握手/换房/皮肤/档案类增设低容量档（6-30 次/分）或每连接冷却 |
| S7 | /api/skin/ 无鉴权无频控；skinCache 只查 TTL 永不清理（Map 无上限）；fetch 三跳无超时；每调写 adminLog 可刷爆 200 条审计环形缓冲；skinUrl 未校验域名（SSRF 纵深缺失） | `server/index.mjs:260-264/157/180/185-202` | IP 限频 + 缓存上限/清扫 + AbortSignal.timeout + 校验 textures.minecraft.net |
| S8 | 每条方块消息同步全量序列化整个世界并落盘（无节流）：挖矿峰值 15 msg/s = 15 次全量 stringify+writeFileSync；对照玩家档案已做 10s 脏扫描节流，标准不一致 | `server/room.js:514-515/539/550/574/604` | 房间级脏标记 + 1-5s 定时 flush，退房/shutdown 强刷 |
| S9 | joinRoom/换维回放逐格单条消息（每格一次 stringify+send，无 backpressure 检查）；换维 DIMENSION_WORLD 已用数组打包，两种风格不一致，客户端批量解析能力已具备 | `server/room.js:373-375/267-269` vs `869-872`、`NetworkManager.js:327-335` | 回放统一走 BLOCK_CHANGE_BATCH 分块（512 格/条）+ 检查 ws.bufferedAmount |
| S10 | 删除房间只删主存档：玩家档案文件、backups 目录、lastBackupAt Map 条目全部残留，同房间名重建旧档案「复活」 | `server/index.mjs:515-517`、`store.js:68-70` | delete 分支补 deletePlayerProfiles + pruneBackups + lastBackupAt.delete |

### 工程（E4-E9）

| # | 问题 | 证据 | 方向 |
|---|---|---|---|
| E4 | run-all-tests.sh 59% 行数（244/414）是 39 个复制粘贴 if 块；同文件 server 套件已是 for 循环，两套注册机制并存 | 脚本 11-361 行 | tests/ 侧改 for 循环 + 显式清单数组，可砍约 200 行 |
| E5 | 断言 helper 4 种签名并存（ok(cond,msg)/ok(msg)/check(name,ok,detail)/assert(name,cond)+ok(name,cond,extra)）；52 个测试文件各自复制 runner 框架与退出样板 | 32 个 tests 文件各自定义 function ok；i18n-parity 用 ok(msg)；server 套件 assert/ok 两款 | 抽 tests/harness.mjs 与 server/test-lib.mjs 共享框架 |
| E6 | 覆盖空白：src/ui 23 文件 0 行为级测试、src/audio 0、Game.js 中枢 0；CW-1 的「稳定态顶点数 === 强制重建」行为差分未自动化（build24-fixes.mjs:97-110 只有源码字符串绊线）；注：ChunkMeshBuilder 有几何级测试（build26:246-274、build28:107-136），node 可实例化已被证明 | grep 引用扫描 | 优先把 CW-1 差分沉淀为行为级钉值；UI/audio 至少加 import 冒烟 |
| E7 | npm scripts 仅 dev/build/preview，无 test/lint 入口；无 ESLint（tsc 全量 checkJs 噪音大，性价比低于 ESLint flat config） | package.json | 先加 "test": "./server/run-all-tests.sh"（零成本），再评估 ESLint |
| E8 | Node 版本契约无机器保障：无 engines、无 .nvmrc，CI 硬编码 24，README 声称 18+ 从未验证 | 根/server package.json、ci.yml:23 | engines.node + .nvmrc(24) + README/CI 对齐 |
| E9 | TODO.md 停在 Build 24 时代（最后更新 2026-09-16, 57903cb）：Idea-2D 仍写「剩余凋灵 Boss/信标独立立项」但 AGENTS.md 记录 D-②/D-③ 均已交付（test-idea2 16/16） | docs/TODO.md vs AGENTS.md | 做一次状态对账，完结项归档；或明示「仅暂存未排期提案」约定 |

---

## 三、低优先级（12 条）

| # | 问题 | 位置/证据 |
|---|---|---|
| S11 | 协议无版本协商：客户端 HELLO 带 version '0.1' 但服务器完全不读，protocol.js 无版本常量，版本漂移静默发生 | `NetworkManager.js:89`、`index.mjs:658-663`；方向：PROTOCOL_VERSION 常量 + 校验回 kicked + WELCOME 回显 |
| S12 | 心跳周期连接建立时闭包固化，面板改 heartbeatMs 只对新连接生效，与限速「活读热生效」哲学不一致 | `index.mjs:642-646`；方向：自管理 setTimeout 每轮现读，或面板明示 |
| S13 | 客户端 _handle 对 JSON.parse 结果无 null/非对象防御（parse('null') 不进 catch，m.t 访问即抛）；对照服务器入口有守卫 | `NetworkManager.js:103-104` vs `index.mjs:651`；补同款守卫 |
| S14 | （已并入 E4：跑批脚本样板归一，server 侧 for 循环化） | — |
| F10 | updateRaycast 与攻击分支每帧重复建射线（clone+new）；BossBar 每帧 mobs.filter 分配数组 | `Game.js:1481-1485/1560-1577/1113-1116`；缓存帧射线 + MobManager 维护 boss 列表 |
| F11 | 「哪些 UI 阻断输入」清单在 Game.js 出现 4 处且各不相同（弓蓄力/挖掘早退清单缺 beaconScreen/steleScreen） | `Game.js:190-191/616-618/1528-1531/1538-1541`；抽 _anyInputBlockingUI() 收口 |
| F12 | RedstoneSystem/FluidSim 字符串坐标 key 在 BFS 热路径反复 split+Number（规模小、有 tick 预算，影响有限） | `RedstoneSystem.js:70/123`、`FluidSim.js:92-96`；数字位编码 key 或缓存解析 |
| E10 | server/package.json name 仍为 cubeworld-server（B29 改名残留，根已是 tiderift） | `server/package.json:2` |
| E11 | three ^0.160 钉死系已知记录（L4-B 阴影注入与 shader chunk 强耦合，升级=注入链路重写级）；现状合理，升级前先做耦合面清单 | docs/TODO.md Idea-1 |
| E12 | CI 小项：concurrency 已有✓；node --check 全量可加（当前实测 121 文件 0 引用盲区，机制无防护）；artifact 未上传（Release 流程未用到） | ci.yml |
| E13 | 过时注释：test-mp.mjs:1「临时，测完删除」等（grep '临时' 命中 3 文件，其中 test-store 为「临时目录」误命中）；build22-fixes.mjs:10 头部注释 BUILD=23 实钉 30；bug.md 的 CW 前缀续用约定未在文件头明示 | server/test-mp.mjs:1 等 |
| E14 | i18n 组织整体良好（三重校验兜底）；仅 names.js 63KB/317 行单文件 diff 粒度粗，可接受 | src/i18n/ |

---

## 四、修复路线（计划，未排期）

> 每批次交付遵循项目惯例：node --check 改动文件 → `$ ./server/run-all-tests.sh` 全绿 → 签名提交 → push 后 `gh run watch` 确认 CI 绿。版本号递增按 AGENTS.md 发布规则（每批一 Build 一 Release）。

### 批次一 · 服务器安全加固（S1-S5，半天级，收益最大）

- 范围：仅 `server/`（index.mjs / room.js / store.js / config.js / admin.html）。
- 改动点：① handler 顶层 try/catch + process 级异常兜底；② restore 内层逐项校验（含 containers/drops 分支）；③ 落盘统一 tmp+rename 原子写（4 处）+ 坏档移 corrupt/；④ admin.html room.name/p.name 过 esc() + 服务器侧房间名长度截断；⑤ createRoom hostId 空位接管守卫 + CREATE/JOIN 先退旧房。
- 验收：修复后复现两条崩溃路径均不崩（畸形 Host → 400；坏存档 → 报警跳过）；grep rename > 0；admin 面板房间名注入不执行；双会话同房间名双击创建 host 不被抢；全套件跑批绿。

### 批次二 · 前端资源泄漏（F1/F2 + F4 收口，小时级）

- 范围：`src/ui/InventoryScreen.js`、`src/core/World.js`、`src/player/Game.js`（清理双轨迁移）。
- 验收：node --check；进两次存档后 getEventListeners(document) 监听器计数不增长；远距飞行卸载区块无 geometry 泄漏（性能面板对照）；全套件跑批绿。

### 批次三 · 工程卫生（E1/E2/E7/E10，小时级）

- 改动点：CI 步骤名去硬编码数字；run-all-tests.sh 注释改口径；BUILD 钉值收敛单文件（12→1）；package.json 加 "test" 入口；server 包名改 tiderift-server。
- 验收：跑批绿；CI 步骤名不再含写死计数；升版本演练只改 1 处钉值。

### 批次四 · README 出仓（E3）

- 四节迁 docs/（与 AGENTS.md 去重合并），README 保留用户向内容；i18n/操作说明不变。
- 验收：README 无开发命令/架构/目录树/回归表；docs 侧信息不丢失。

### 长期渐进（按机会穿插，不单开批次）

- F3 Game.js 拆分（InteractionController → ProjectileSystem → AetherRituals，每次迁移一个域并全量回归）
- E4/E5 测试 harness 归一（runner for 循环 + 共享断言框架）
- S6-S10 联机打磨（限速扩档、皮肤代理加固、快照节流、回放批量打包、删除清理）
- F5-F9 前端模式归一（CursorOverlay、raySphereHit、账本分桶、常量集中）
- E6 覆盖补强（CW-1 行为差分钉值 → UI/audio import 冒烟）

---

## 五、审查方法与验收说明

- 三路子代理并行深审，任务书硬性要求：每条发现带 文件:行号 + ≤3 行代码摘录 + 高/中/低分级；已知已解决问题（AGENTS.md / docs/bug.md / agent-notes 已记录）不列为新发现。
- 主会话对全部「高」级发现二次实证：S1（new URL 位置 + Invalid URL 语言级复现）、S2（TypeError 复现）、S4（裸拼代码核对）、S5（hostId 覆盖核对）、F1（grep 全文 0 dispose）、F2（unloadChunk 代码核对 + 对照两处正确路径）、E1/E2/E3（计数与章节实跑统计）。
- 修正记录：审查会话口头汇报曾称「10 高/19 中/11 低」，准确计数为 **11 高 / 17 中 / 12 低**（S14 与 E4 重复计为一条后为 12 低）；本文档以逐条清点为准。
- 全程只读：未修改/创建/删除任何文件，未起停任何服务器进程。
