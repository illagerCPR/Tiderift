# Build 43 计划 · 单人存档导出 / 导入（.tidersave）

> 状态：实施中（2026-11-05）。交付后 `git mv` 进 `docs/archives/`。
> 用户拍板：gzip 单文件 `.tidersave` / 仅主菜单单人页槽位入口 / 弹窗选槽且覆盖需二次确认 / 不做批量备份 / build 高于当前客户端一律拒绝导入。

## 1. 范围

**做**：单人页按槽位导出为 gzip 单文件；导入该文件到任意槽位（空槽或覆盖）；全程校验与净化；10 语言文案；node 回归网。
**不做**：联机房间存档（已有 op 备份 API `GET /api/room/<name>/backup`）、云端、批量整机备份、存档缩略图、导入后自动开局。

## 2. 文件格式

`.tidersave` = gzip 压缩的 UTF-8 JSON，解压后为信封：

```json
{
  "format": "tiderift-save",
  "fileVersion": 1,
  "app": "Tiderift",
  "build": 43,
  "exportedAt": 1762345678901,
  "slot": 3,
  "save": { "version": 2, "seed": 12345, "dimension": "overworld", "...": "..." }
}
```

- `save` 即存档本体（与 localStorage 内同形状），原样搬运，未知字段不丢。
- 识别顺序：前两字节 `1f 8b` → gzip 解压；否则按 UTF-8 文本解析。信封认 `format`；无 `format` 但顶层有 `version` + `seed`/`gamemode` 时认裸存档（兼容手工 `.json`）；都不是 → `not-a-save`。
- 文件名：`Tiderift-save-<槽位>-<YYYYMMDD-HHmm>.tidersave`。
- 无 `CompressionStream`/`DecompressionStream` 的浏览器降级为未压缩 `.json`（同一份信封 JSON），导入端两种都认。

## 3. 数据层

**新建 `src/core/SaveTransfer.js`（纯函数，node 可测）**
- `buildSaveFile(saveData, { slot, build, now, compress })` → `{ envelope, bytes, compressed, fileName, mime }`
- `isGzipBytes / gzipBytes / gunzipBytes`
- `decodeSaveFile(input)` → `{ envelope, save }`（async；含 magic 识别与解压上限）
- `parseSaveText(text)` → 同上去掉解压
- `sanitizeSaveData(data)` → `{ data, dropped }`
- `makeFileName(slot, data, now, compressed)`
- `summarize(data)` / `formatBytes(n)`
- `SaveTransferError`（`code` 字段供 UI 映射文案）

**[SaveSystem.js](../../src/core/SaveSystem.js) 增补**
- 导出 `SAVE_VERSION` 与 `normalizeSaveData(data)`（V1→V2 迁移从 `load` 抽出，`load` 与导入共用一条路）
- `exportSlotRaw(slot)`：读原文 → JSON.parse → normalize → 对象或 null
- `importData(slot, data)`：写回（改写 `slot` 字段）；成功 true，失败返回 `'quota'` / `'write-failed'`
- `rawSize(slot)`：原文长度（字符数），供容量预检与摘要

## 4. UI 流程（MenuScreen 单人页）

- 槽位行：`[●] 槽 3 · 生存模式 … [导出] [删除]`
- 页内工具条（槽位列表与「新建游戏设置」之间）：`[⬆ 导入存档]` + 隐藏 `input[type=file] accept=".tidersave,.json"`
- 导出：读原文 → 规范化 → gzip → `a[download]` 触发下载 → 短暂提示「已导出」；`URL.revokeObjectURL` 必回收。
- 导入：选文件 → 读取/解压/校验 → 摘要弹窗（来源槽位、模式、维度、保存时间、种子、大小、清理项）+ 6 个槽位选择（空槽标「空」、已有槽标「将覆盖」）→ 覆盖需二次 `confirm` → 写入 → 重绘列表 + 提示。
- 异步期间禁用按钮防重复触发；错误码统一映射为本地化文案。

## 5. 校验与安全红线

| 项 | 规则 |
|---|---|
| 存档版本 | `save.version` 1 → 自动迁移到 2；其它 → `bad-save-version` |
| 文件版本 | `fileVersion` 必须等于 1，否则 `bad-file-version` |
| 跨版本 | `build > BUILD` → `newer-build`（拒绝，提示升级） |
| 解压上限 | 解压后 > 32MB 拒绝（流式累计，防压缩炸弹） |
| `seed` | 有限数 → `>>> 0`；否则 0 + 警告 |
| `dimension` | 白名单（`DIMENSIONS` 键），非法回落 `overworld` |
| `gamemode` | creative/survival/spectator，非法回落 creative |
| `player` | 坐标必须有限数（否则出生点默认值）；health/food/saturation 钳 0..20；airTicks 钳 0..300 |
| `inventory` | 槽数 36 / 盔甲 4；物品名必须在 `ItemRegistry` 或 `BlockRegistry`，数量钳 1..999；非法条目丢弃 |
| 方块账本 | 坐标键 `-?\d+,-?\d+,-?\d+`；ID 0..255 且已注册（0=空气合法）；非法丢弃 |
| 容器/熔炉 | 27 槽数组 / 状态对象字段类型校验；非法丢弃 |
| 原型污染 | 顶层与账本键跳过 `__proto__`/`prototype`/`constructor`，净化用 `Object.create(null)` |
| 写入容量 | `QuotaExceededError` → `'quota'`，不外抛 |

## 6. 多语言

新增约 16 个键（导出/已导出/导入存档/读取中/导入/导入成功/选择导入到哪个存档槽/存档摘要/覆盖确认/各类错误文案/已清理异常数据/存储空间不足），10 个语言包同步。错误码 → 文案映射由 `MenuScreen.SAVE_IMPORT_ERROR_KEYS` 导出，`tests/i18n-parity.mjs` 动态键表登记。

## 7. 回归网

`tests/build43-save-transfer.mjs`：gzip 往返逐字节、magic 识别三分支、信封/裸档兼容、V1 迁移、非法版本拒绝、`newer-build` 拒绝、净化六类脏数据、`__proto__` 不污染、解压炸弹拒绝、文件名格式、`SaveSystem.exportSlotRaw/importData` 写入与覆盖、菜单接线绊线（按钮 id / 事件委托 / `t()` / 隐藏 input / `createObjectURL` 回收）、i18n 10 包新键、`BUILD = 43`。
套件登记进 `server/run-all-tests.sh` 的 `PURE_NODE_SUITES`。

## 8. 交付

- `src/version.js` `BUILD` → 43；push master → CI 绿 → `beta-build-43`（计划已明确安排发布，按 2026-10-23 授权直接发）。
- [AGENTS.md](../../AGENTS.md)「存档系统（多槽位）」补导出/导入 API、格式与校验红线。
- 本文件交付后归档到 `docs/archives/`。

## 9. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | `SaveTransfer.js` + `SaveSystem` 增补 + 单测 | `node tests/build43-save-transfer.mjs` 绿 |
| M2 | 单人页导出按钮 + 导入弹窗 + 浏览器手测 | 新建世界→保存→导出→删槽→导入→继续游玩 |
| M3 | i18n 10 包 + 文档 + 版本 43 + 发布 | `npm test` 全绿、CI 绿、Release |
