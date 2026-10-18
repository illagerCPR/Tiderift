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
| 5 | 联机服务端打磨（限速扩档/皮肤代理/落盘节流/回放打包/删房清理/协议版本/心跳热生效/入口防御） | S6 S7 S8 S9 S10 S11 S12 S13 | 实施中（详见第八节） |
| 6 | 前端模式归一 | F5 F6 F7 F8 F9 F10 F11 F12 | 待启动 |
| 7 | 工程与覆盖 | E4 E5 E6 E8 E9 E12 E13 | 待启动 |
| 8 | F3 Game.js 拆分（先只读可行性评估，确认后逐域迁移） | F3 | 待启动 |
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
