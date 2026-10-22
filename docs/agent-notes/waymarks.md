# 天域旧航路航标（Build 34 B）防回退备忘

改动 `src/core/Waymarks.js`、`src/ui/WaymarkScreen.js`、`StructureManager.waymarkTowerAt/nextTowerFrom/towerRecordAt`、
航标协议（`waymark_submit/update/deny/waymarks`）或房间账本 `waymarks` 字段前必须读本文件。

## 交付面（2026-10-22，保持 Build 33 不升版本）

| 层 | 内容 |
|---|---|
| 数据 | `src/core/Waymarks.js`：`Map<"ax,az", {stage, byName}>`，阶段 1..3，上限 96 座；纯模块（不 import 注册表，node 可直接测） |
| 界面 | `src/ui/WaymarkScreen.js`：右键塔顶航标位打开；三阶段材料/进度、缺件重建、下一座航路方向与距离 |
| 交互 | `InteractionController` 右键链、**红石交互之前**：`glowstone` 或 `aether_waymark` 命中 `StructureManager.waymarkTowerAt` 才开界面 |
| 方块 | `BlockDefs.js` 末尾追加 `aether_waymark`（light 15、无配方、不自然生成），只由修复流程经 `World.setBlock` 放置 |
| 联机 | 服务器权威账本 `Room.waymarks`，严格顺序 + 一次性；客户端**收到本人触发的回执后才扣材料** |
| 存档 | `SaveSystem` 的 `waymarks` 字段 + `_composeSwitchLoadData` 跨维透传 |

## 高危点（改前必读）

1. **不得改动 `solveTower()` 的几何**。塔的选址/箱子/碑文在既有世界里已经落盘；航标不是生成物，而是修复后才 `World.setBlock` 放上去的。若把航标方块加进 solver，新老存档会出现两种塔，且 `structure-determinism` 会拦。
2. **"重新点亮"不能写成"旧荧石原本是灭的"**。四角荧石一直是普通照明（light 15），修复产生的是**新的**航标芯方块 + 游记已修复标记 + 导航，不是给旧荧石换状态。
3. **材料只在回执里扣**。联机提交是"客户端发 → 服务器校验 → 广播含本人"。若在点击时先扣材料，被服务器拒绝（别人抢先、阶段不对、非天域、限速）就会白扣。`NetworkManager._applyWaymarkUpdate` 用 `byId === this.selfId` 判定本人。
4. **航标芯只由提交方放置**。`_applyWaymarkProgress(..., place)` 的 `place` 参数为 false 时（远端回执）不得 `setBlock`——否则各端重复写方块，广播放大。其余端靠方块账本同步收到。
5. **`_placeWaymarkBlock` 前置检查**：脚下 (`groundY+9`) 必须是实心，否则不重建（拆改塔顶后不留幽灵航标）。已被 `aether_waymark` 占位时幂等返回 false。
6. **`roomSnapshot` 必须对不完整房间对象鲁棒**：`room.waymarks ? [...room.waymarks.entries()] : []`。B34-A 已因 `journalMarkers` 踩过一次"断言全过但进程非 0"（test-t5 用对象字面量当假 Room）。
7. **客户端时序**：服务端在 `WORLD_INFO` 之后才发 `waymarks`，此时 `Game.start` 还在重建世界。必须走 `NetworkManager` 的 pending 缓存，在 `onWorldStarted()` 统一冲掉；换房/断线/重连一律清空。
8. **`nextTowerFrom` 默认半径 6**：cell=14 区块（224 格），稀疏种子下最近的可修复塔可能在 r=4 环（实测 910 格外）。半径 0 时如实返回 null，界面给"附近找不到下一座瞭望塔"，不得伪造目标。`_waymarkNavCache` 按锚点缓存，**换世界必须清空**（在 `start()` 重建）。
9. **方位词序**：中文是"东西在前、南北在后"（东北/西北/东南/西南）。写成"南西"是 bug（`compassLabel`）。
10. **`t(def.title)/t(def.hint)` 是动态键**：`WAYMARK_STAGES` 的标题与说明已并入 `tests/i18n-parity.mjs` 的 dynamicKeys；新增阶段文案必须同时补 10 语言包，否则 parity ③ 会拦。
11. **`t('关闭')` 是设置页的 "OFF"**，不是"关闭面板"。面板关闭按钮统一用 `'关闭 (ESC)'`（B34-B 顺手修掉 JournalScreen 的同一处历史失误）。

## 验收锚点（B 轮）

- `tests/waymarks-unit.mjs`（53 断言）：阶段定义 / 键与清洗 / 递增一次性 / 序列化往返与上限 / 材料缺口 / **同种子双端解出同一塔锚点与同一"下一座航路"**。
- `server/test-waymark.mjs`（34 断言）：键与阶段清洗 / 严格顺序 / 并发同阶段先到者胜 / 维度门控 / 账本上限 96 / 令牌桶 30 / 落盘往返 / 旧快照与坏项兼容 / `roomSnapshot` 对不完整对象鲁棒。
- 浏览器实走（种子 1398856851，房间=单机存档 1，维度天域）：右键塔顶四角荧石 → 面板 0/3 → 三阶段提交（材料逐项扣净）→ 航标芯落在 `(ax, groundY+10, az)`（id 211）→ 游记"浮空瞭望塔 · 已修复" → 下一座航路"西南 约 910 格" → 抵达第二座塔并记入游记；存档重开后进度与方块均保留。

## 已知边界（未做，别当 bug 修）

- 材料不由服务器校验：服务器不持有背包，协议只保证"顺序 + 一次性"，客户端在收到本人回执后扣料。防作弊不是首版目标。
- 航标进度是**房间共享**状态，不是个人档案；单机进存档，联机进房间账本，二者不互转。
- 无排行榜、无全服航路网：`nextTowerFrom` 只找"最近的一座别的塔"，不做链式路线规划。
