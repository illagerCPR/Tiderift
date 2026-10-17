# Tiderift B30 改进多轮修复计划

> 来源：`docs/improvement-audit-b30.md`（Build 30 全项目改进审查，共 40 条发现：高 11 / 中 17 / 低 12）
> 基准提交：`e7b9a17`（Beta Build 30）· 计划制定：B30 修复会话
> 交付口径：**每轮结束停下等待用户指令**；Build 递增与 Release 逐轮单独经用户批准后执行。

## 一、已确认决策

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 轮次划分 | 审计文档「四、修复路线」的四批各为一轮（轮 1–4）；长期渐进项待前四轮完成后再排期 |
| D2 | 每轮收尾口径 | `node --check` 改动文件 → `./server/run-all-tests.sh` 全绿 → 签名提交 → push → CI 绿；**Build 递增与 Release 每次单独等用户批准** |
| D3 | 本轮（轮 1） | 立即开工 |
| D4 | 计划落盘 | 本文件与审计报告一并纳入版本控制 |

## 二、轮次总览

| 轮 | 主题 | 来源条目 | 状态 |
|---|---|---|---|
| 1 | 服务器安全加固 | S1 S2 S3 S4 S5 | 进行中 |
| 2 | 前端资源泄漏收口 | F1 F2 F4 | 未开始 |
| 3 | 工程卫生（计数失真 / 钉值收敛 / 测试入口 / 包名） | E1 E2 E7 E10 | 未开始 |
| 4 | README 出仓（用户向化） | E3 | 未开始 |
| 长期 | 渐进项：F3 Game.js 拆分、E4/E5 测试 harness 归一、S6–S10 联机打磨、F5–F9 前端模式归一、E6 覆盖补强 | 中低优先级余项 | 待排期 |

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

## 四、轮 2–4 概要

- **轮 2 · 前端资源泄漏**：`InventoryScreen` 补 `dispose()` 并接入统一调用点；`World.unloadChunk` 补 `lightMesh` geometry dispose；`Game` 存档切换清理双轨迁移到 `_disposeWorld` 单点收口（F4）。验收：`node --check`；进两次存档后 document 监听器计数不增长；远距卸载区块无 geometry 泄漏；跑批全绿。
- **轮 3 · 工程卫生**：CI 步骤名去硬编码计数；`run-all-tests.sh` 头部注释改口径（`server/run-all-tests.sh:2` 的「6 个套件」与实况不符）；BUILD 钉值 12 文件收敛到单文件；`package.json` 加 `test` 入口；`server/package.json` 改 `tiderift-server`。验收：跑批绿、CI 步骤名不含写死计数、升版本演练只改 1 处钉值。
- **轮 4 · README 出仓**：`README.md` 的「回归测试 / 项目结构 / 架构要点 / 开发命令」四节迁入 `docs/`（与 `AGENTS.md` 去重），README 只留用户向内容。验收：README 无开发命令/架构/目录树/回归表，docs 侧信息不丢失。

## 五、进度记录

| 轮 | 开始 | 结束 | 交付提交 | CI | 备注 |
|---|---|---|---|---|---|
| 1 | — | — | — | — | — |
