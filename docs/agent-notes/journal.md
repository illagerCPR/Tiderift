# B34 A 四界游记与手绘地图（New Horizon Part.1 · A）

> 2026-10-22 交付。计划见 `docs/archives/new-horizon-plan-b34.md` §三；B/C 尚未开始。改动涉及 `src/core/Journal.js`、`src/ui/JournalScreen.js`、`src/player/Game.js` 接线、`server/{protocol,room,store}.js` 与 `src/net/NetworkManager.js`。**改动这些文件前必读本文。**

## 数据模型（`src/core/Journal.js`，纯数据、可 node 直测）

- **维度分桶**：`explored: { dim -> Map<"cx,cz", biomeCode> }`，只含 `DIMENSIONS[dim].implemented` 的维度；格坐标 = `floor(world / 16)`。
- **上限**：`CELL_LIMIT=12000`（每维度）、`DISCOVERY_LIMIT=512`、`MARKER_LIMIT=64`、`SHARED_MARKER_LIMIT=256`。超限一律**丢最旧**（`set` 插入序即时间序）。
- **序列化**：explored 存成 `"cx36,cz36,biome;..."` 的 36 进制压缩串（省字节）；`deserialize` 同时接受压缩串与数组两种形态，坏项跳过不抛。**不要改成 JSON 对象数组**——12000 格的体积会翻数倍并拖慢自动保存。
- **清洗口径**：`cleanText` 去 `\u0000-\u001f\u007f`、trim、截断；坐标必须 `typeof number` 且 `|v| <= 30000000`（**不接受字符串强转**）；颜色必须 `#rrggbb`，否则回落 `#f4ca64`。
- **幂等键**：发现记录 = `dim|type|floor(x),floor(z)`；已读碑文 = 章节 id（标题正文仍从 `STELE_CHAPTERS` 取，**不把译文写进存档**）。

## 接线（`src/player/Game.js`）

- **新建型子系统**：`this.journal` 与 `this.journalScreen` 在 `start()` 创建、`_disposeWorld()` 释放。**顺序硬要求：先建 Journal 再 reset(loadData.journal)，最后才建 JournalScreen**——界面 `render()` 直接读 `game.journal`，反序会读到 null。
- **揭图**：`_updateJournal()` 中 `observe()` 每 **250ms** 一次（Journal 内部再按「维度|区块格」去重，跨格才求 3×3 群系）。**不要改成每帧调用**——`getBiome` 是重活。
- **发现**：每 **500ms** 调 `StructureManager.structureRecordAt(x,z)`，命中记 `recordDiscovery(dim, name, record.ax, record.az, label)`。幂等键取**结构锚点**而非玩家坐标：从包围盒任意位置进入只记一条。
- **键位**：**N 键**开合游记。与 E/C/J/Q 同款互斥（running/观战/死亡/暂停/聊天输入/命令面板/`_anyInputBlockingUI`），且已加入 `_anyInputBlockingUI()` 清单（挖掘/攻击/弓蓄力随之门控）。ESC 关闭。
- **换维不丢档**：`_composeSwitchLoadData()` 必须带 `journal` 字段——换维会先 `_disposeWorld()` 清空实例，不透传就会跨维清档。
- **观战/死亡不推进探索**：`_updateJournal` 首段守卫，位置来自他人或冻结的死亡实体时不得记账。

## 碑文回看

`SteleScreen` 打开时调 `game.journal.recordStele(id)`；`chapterIdOverride`（命令面板/调试指定章节）**不得计入探索**，现有判断已拦。

## 联机共享标记（房间权威账本）

- **协议**（`server/protocol.js`，5 条）：`journal_marker`(C2S 分享) / `journal_marker_add`(S2C) / `journal_marker_delete`(C2S) / `journal_marker_removed`(S2C) / `journal_markers`(S2C 进房全量)。
- **个人标记仅本人可见**：只有玩家明确点「分享」才上报；揭图数据**永不离开本机**（跨房不保留，符合「不把旧房间数据混入当前世界」）。
- **服务端清洗**（`room.js` 的 `sanitizeJournalMarker`）：维度白名单、有限坐标、label 48 / owner 24、颜色正则；**id 由服务端生成**（`j-<n>`），ownerId/owner 由服务端注入，客户端字段一律不可信。
- **幂等**：同 owner 的 `dim|x|y|z|label` 同内容视为同一条，重复分享只回发已有条目，不新增。
- **删除权限**：owner 或 `Room.isOperator()`；越权静默拒绝（不回错误码，避免探测他人标记）。
- **上限与限速**：账本 256 条丢最旧；写入令牌桶突发 90 / 每分钟补 30（挂在 `player._journalBucket`，未进 `ratelimit.js` 档位，硬上限由 room.js 自理）。
- **落盘**：`store.roomSnapshot` 写 `journalMarkers` + `nextJournalMarkerId`；`Room.restore` 逐条 `sanitizeStoredJournalMarker` 清洗，坏项跳过；**旧快照缺字段回落空表**。
- **客户端时序（高陷阱）**：服务端在 `WORLD_INFO` **之后**才下发 `journal_markers`，而客户端此时 `Game.start` 可能仍在重建世界——直接写入会被 `_disposeWorld` 清掉。`NetworkManager` 必须走 `_pendingJournalMarkers/_pendingJournalAdds/_pendingJournalRemoves` 缓存，在 `onWorldStarted()` 统一冲掉（与 `_pendingProfile` 同款模式）。
- **房间隔离**：`_clearJournalMarkers()` 在 `_clearPendingWorldMessages()`（重连/恢复）、`sendSwitchRoom()`、`close()` 三处清空本地共享标记，防旧房间串味。

## 测试

- `tests/journal-unit.mjs`（纯 node）：129 断言，覆盖清洗/幂等/上限/序列化往返/揭图/标记。
- `server/test-journal.mjs`（纯 node，不依赖服务器进程）：覆盖清洗、分享广播、幂等、owner/operator 删除权限、账本上限、写入限速、落盘往返、旧档兼容。
- 两者均已进 `server/run-all-tests.sh`（前者 `PURE_NODE_SUITES`、后者 server 清单）。

## 踩过的坑

- **`roomSnapshot` 必须对不完整房间对象鲁棒**：既有套件（`test-t5`）会用**对象字面量**当假 Room 调 `store.saveRoom`，直接 `room.journalMarkers.values()` 会让三个 server 套件全部 FAILED（断言全过、进程非 0 退出）。已改为 `room.journalMarkers ? [...] : []`。
- **`JournalScreen` 语法错误根因**：`t([...map])` 少右括号时解析器把报错点挪到下一行，别被行号误导。
- **界面文案全部用 `t('中文原文')` 包裹**，键已进 10 个语言包（zh-CN 零字典）；新增文案必须同步 `tests/i18n-parity.mjs`，否则跑批红。
