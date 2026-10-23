# 御风竞速与自建赛道（Build 34 C）备忘

交付于 Build 34 第三个里程碑。玩家用「御风标桩」方块摆点位 → 在 G 界面按顺序选点命名存档 →
穿过起点开始计时 → 依序过检查点 → 终点结算本次用时与个人最佳。联机赛道定义与成绩归房间账本。

## 一、交付面

| 面 | 内容 |
|---|---|
| 数据 | `src/core/RaceTracks.js`（纯模块）：赛道/成绩校验、清洗、存取；`RACE_*` 上限常量 |
| 计时 | `src/core/RaceRun.js`（纯模块）：armed→running→finished/cancelled 状态机、线段触发判定、`formatRaceTime` |
| 方块 | `race_post`（御风标桩，ID 212，`BlockDefs.js` 尾部追加）：light 12，右键开赛道界面 |
| 界面 | `src/ui/RaceScreen.js`（赛道列表/建改删/选点/开始）、`src/ui/RaceHud.js`（计时条，挂 body） |
| 接线 | `Game`：G 键、`_racePosts/_raceTrackValidity/_armRaceTrack/_updateRace/_finishRace/_cancelRace/_applyRaceRecord` |
| 协议 | `race_save/race_delete/race_record`（C2S）、`races/race_update/race_removed/race_record_update/race_deny`（S2C） |
| 服务端 | `server/room.js` 的 `races`（定义）与 `raceRecords`（逐人最佳）两张账本 + `server/store.js` 落盘 |
| 存档 | `SaveSystem` 的 `races` 字段；换维经 `_composeSwitchLoadData` 透传 |
| 用例 | `tests/race-unit.mjs`（97）、`server/test-race.mjs`（73） |

## 二、格式与规则

- 赛道：`{id, name, dim, mode, revision, byId, byName, points[]}`。`points[0]`=起点、
  `points[last]`=终点、中间=有序检查点；点位 3..12、相邻两点 ≤512 格、坐标 ±30,000,000、y∈0..255。
- 成绩键：`id#revision#byId`（单机 `byId` 为空串）。**编辑递增 revision 并清掉旧修订成绩**——
  旧成绩永远不充当新赛道的纪录（服务器保存时清、快照恢复时按 `track.revision` 过滤）。
- 模式：`glide`（御风：鞘翅/气流）/ `free`（自由：创造飞行）。创造/旁观/终局纹章御风照常计时但
  `assisted=true`，不入最佳、不上报（两条赛道各自成榜，永不混排）。
- 计时必须「主动报名 + 穿过起点」：`_armRaceTrack` 只落 armed，真正开始计时是第一次进入起点触发球。
**取消规则**：暂停 / 死亡 / 换维 / 换房 / 断线 / 赛道被编辑或删除 / 标桩被拆（每秒巡检） / 待出发超时（5 分钟）。

## 三、高危点（改动前必读）

1. **暂停与死亡必须由 show() 收口取消**：`PauseMenu.show`/`DeathScreen.show` 会置 `game.paused=true`，
   而 `Game.update` 在 paused 时整段跳过——`_updateRace` 里的 `if (this.paused)` 永远等不到那一帧。
   两处 show 各自显式调 `game._cancelRace(…)`；其余条件（换维/标桩被拆）仍留在 `_updateRace` 里。
2. **上报成绩必须是整数毫秒**：`sendRaceRecord` 用 `Number.isInteger` 校验，`run.elapsedMs` 是浮点，
   直接传会被静默丢弃（无服务端日志，只有「跑到终点却没成绩」）。`_finishRace` 里 `Math.round` 后再发。
3. **`byId` 是字符串**：服务器 `player.id` 是数字，客户端 `sanitizeTrack` 与 `_applyRaceRecord` 都要
   `String(...)` 归一，否则「是不是我保存的」「我的最佳」全部对不上。`_raceSelfKey()` 用 `String(net.selfId)`。
4. **缓存落地两级兜底**：`RACES` 紧跟 `WORLD_INFO` 到达，此时 `Game.start` 可能还在重建世界。
   消息先进 `NetworkManager._pendingRaces`，由 `onWorldStarted()` 与 `Game.start()` 末尾各调一次
   `flushPendingRaces()`——只挂一处会在「消息晚于世界就绪」的时序里丢掉整张赛道表。
5. **点位有效性只认方块账本**：`world.modifiedBlocks`（当前维度桶）里记的是玩家放置结果，
   拆掉的桩会被写成 0，因此不会出现幽灵点位；**不要用 `world.getBlock` 判有效**——未加载区块恒返回 0。
6. **触发用线段而非逐帧点距**：滑翔单帧位移可达数格，掉帧时更大。`RaceRun` 用「上一帧位置→本帧位置」
   到点位的线段距离 ≤ `RACE_TRIGGER_RADIUS(7)`；单帧最多推进一个点位（检查点与终点同帧只算前者）。
7. **只认当前该过的点**：已过点、未来点穿过一律忽略——乱序、折返、重复触碰天然无效，无需额外状态。
8. **赛道失效要显式**：界面列出缺失点位坐标并禁用「开始」；跑动中每秒巡检一次，失效即取消本次尝试。

## 四、验收锚点（复测用）

- `npm test`：`race-unit` 97 断言 + `test-race` 73 断言。
- 单机（种子 1398856851，生存）：摆 3 根标桩 → G 建赛道「登云试炼」→ 面板显示「3 个点位 · 全长 200 格」
  → 开始 → 依次穿过 → HUD「本次用时 0:0X.XXX / 刷新纪录！/ 个人最佳 …」→ F6 存档后重开该槽，
  赛道与个人最佳仍在。
- 联机（双端）：host 建赛道 → 服务端回执 revision=1、byId=host → 另一端 `races.list()` 立即有该赛道；
  底盘标桩经方块账本同步（`game._racePosts().length === 3`）；成绩回执后两端显示「房间最佳」。
- 取消：暂停/死亡各回 `计时取消：暂停|死亡`；换维回「换维」；拆掉任一标桩后回「标桩已缺失」并 `validity.ok=false`。

## 五、已知边界

- 成绩由客户端本地计时上报，服务器只做结构与上限校验，**不验证真实运动轨迹**；界面不宣称已验证。
- 公开排行榜、幽灵回放、防作弊验证留待后续单独评审。
- 赛道点位数量、单段长度、赛道条数与成绩条数均有硬上限（24/12/512/240），不做跨房间汇总。
- 标桩被拆后赛道保留但标记为失效，不会自动删除，也不会静默允许开跑。

## 六、本轮踩坑（工具向）

- agent-browser：含多个 `await wait(...)` 的异步 eval 在这套重场景下容易触发 CDP 30s 超时；改成分步同步
  eval（中间用 shell `sleep`）稳定。HMR 编辑后若世界正在运行，页面可能长时间卡死——关会话重开最省事。
- 主菜单的 `input[type=text]`（LAN IP 输入框）与赛道面板的输入框同名，`document.querySelector` 会拿错；
  查询一律限定在 `game.raceScreen.panel` 内。
