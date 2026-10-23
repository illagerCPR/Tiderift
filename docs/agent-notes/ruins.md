# Agent 备忘 · 可动手解开的遗迹（B35 · D）

> **阶段 1（世界内容 + 判定核心 + 纯模块单测）** 与 **阶段 2（房间账本协议 + 客户端接线 + 奖励 +
> 游记/界面 + 发布）** 均已交付（Build 35）。动手前先读 §八（阶段 2 实现细节）、§七（已知边界）与
> §九（已定偏差），别自行发明第二套键或判定。

## 一、交付物与职责边界（阶段 1）

| 文件 | 职责 |
|---|---|
| `src/core/Ruins.js` | 纯模块：键/清洗、机关定义推导 `ruinPuzzle`、判定 `evaluateRuin`、状态机 `Ruins`、解封写入 `applyUnlock`、世界采样器 `makeWorldSample` |
| `src/world/structures/tide_sluice.js` | 潮闸房（主世界）：选址 + 几何 + `meta.ruin` |
| `src/world/structures/ember_circuit.js` | 烬火回路房（下界）：同上 |
| `src/world/structures/frame_rack.js` | 构件架房（天域）：同上 |
| `src/world/structures/catalog.js` | 仅在**文件末尾**追加 3 个 import + 3 条 `registerStructureType`（既有条目一律未动） |
| `tests/ruin-unit.mjs` | 纯 node 套件（阶段 1：判定/状态机/结构接缝），已进 `PURE_NODE_SUITES` |
| `tests/ruin-reward.mjs` | 纯 node 套件（阶段 2：纪念方块/铭牌/奖励蓝图/领取去重/i18n 动态键） |
| `server/test-ruin.mjs` | 服务端套件（房间账本/领取去重/限速/快照往返/op 重置），已进 server 循环 |

**阶段 1 不新增任何方块类型**：机关房只用既有方块，门体是普通实体方块，靠阶段 2 的
`applyUnlock`（内部只走 `World.setBlock`）把门体换成空气。

**阶段 2 新增 4 个方块（BlockDefs 末尾追加，ID 213~216）**：三类"纪念方块"（`tide_keepsake` /
`ember_keepsake` / `rack_keepsake`）+ 一块通用"遗迹铭牌"（`ruin_plaque`）。全部显式传
`textures: { top, side, bottom }` 并各自生成三张 SVG，无配方、不自然生成，只由领取奖励时
`inventory.add` 发放。

## 二、键格式

```
ruinKey(dim, kind, ax, az) = "<维度>|<机关类型>|<锚点x>|<锚点z>"
例：overworld|tide_sluice|1008|-2032
```

- `dim` ∈ `overworld | nether | end | aether`（与生成器 `dimensionId` 同值），`kind` ∈ `tide_sluice | ember_circuit | frame_rack`。
- `ax/az` = **结构锚点（世界方块坐标）**，与 `StructureManager` 记录的 `rec.ax/rec.az` 逐位相同（向下取整）。
- 校验：`isValidRuinKey`（正则，四位整型，坐标 ≤ 9 位）；`parseRuinKey` 反解四元组。
- 键与 B 的塔键同构（维度 + 类型 + 确定性锚点），**不入 y**：同一锚点的机关只有一处。
- 账本上限 `RUIN_LIMIT = 96`（每存档 / 每房间），超限后拒绝新条目、不覆盖旧条目。

## 三、机关判定口径（三套规则，全部由注入的 sample 判定）

| 类型 | 维度 | `rule` | 判定格 `cells` | 关键件 `keys` | 解封 `unlock` |
|---|---|---|---|---|---|
| 潮闸房 `tide_sluice` | overworld | `water_line` | 沉沙池标线列 3 格，accept = 水源 + `water_flow_1..7` | 水口水源格（必须是**水源** id，流动水不算） | 池东墙 3 宽 × 3 高 |
| 烬火回路房 `ember_circuit` | nether | `lamps` | 四盏灯位，accept = **仅** `redstone_lamp_lit` | 红石火把 + 四盏灯（accept = `redstone_lamp` 或 `redstone_lamp_lit`） | 北墙 3 宽 × 3 高 |
| 构件架房 `frame_rack` | aether | `slots` | 北墙三槽槽心，accept = 该槽所需材料 id（材料由 seed + 锚点确定性挑选） | 每槽下方托架（同材料） | 西墙 3 宽 × 3 高 |

`evaluateRuin(puzzle, sample)` 返回：

```js
{ state: 'locked' | 'solved',
  missing: [{ index, x, y, z, label, need, needName, have }],   // 未满足的判定格
  badIndex: -1 }                                                // ≥0 = 第几个关键件失效
```

- **单向**：`state` 只有当 `missing` 为空且 `badIndex === -1` 才是 `solved`；关键件损坏一律 `locked`。
- `sample(x, y, z)` 返回方块 id；**未加载区块必须返回 -1**，未知格一律判未满足（绝不当成空气满足）。
- 不允许在世界里"顺手判定"：`world.getBlock` 对未加载区块返回 0，会把"没加载"误判成"缺件"。

### 读方块唯一入口：`makeWorldSample(world)`

```js
const sample = makeWorldSample(world);   // 账本优先 → 未加载区块 -1 → 再读世界
```

优先级照 `Game._raceTrackValidity` / `_racePostAt` 的做法：**先查 `world.modifiedBlocks`（键 `posKey`），
命中即用账本值**（挖毁 = 0、玩家补回 = 新 id），未命中再判区块是否加载，最后才 `world.getBlock`。
所以"关键件被挖毁 → badIndex"在真实世界里由账本兜住，与是否重新加载区块无关。

## 四、锚点推导约定（阶段 2 必须照做，否则判定格与几何对不上）

```js
ruinPuzzle(seed, dim, kind, ax, ay, az) -> puzzle | null
//   seed = world.generator.seed（= structureManager.seed，字符串 seed 也行：内部 (seed|0)）
//   ay   = rec.groundY（结构 solve 收到的第 2 个 y 参数，就是地板层）
//   ax/az= rec.ax / rec.az
```

- 结构 `solve(rng, ax, y0, az, gen)` 内部就是用 `gen.seed` + 同一组 `(ax, y0, az)` 调 `ruinPuzzle`，
  几何与判定共用 `core/Ruins.js` 的 `SLUICE_LAYOUT / EMBER_LAYOUT / RACK_LAYOUT` 常量，**不存在第二份坐标**。
- 找附近机关用 `structureManager.recordsAround(kind, x, z)`（抗 LRU 驱逐；`recordsNear` 会被挤）。
  收下 `rec` 后：`const puzzle = ruinPuzzle(gen.seed, dim, kind, rec.ax, rec.groundY, rec.az)`。
- 结构 `meta.ruin = { kind, key, ax, ay, az }` 已随记录返回，可直接用 `rec.meta.ruin.key` 做键，
  省一次推导（`tests/ruin-unit.mjs` 有"记录几何与推导一致"的断言钉着）。
- 末地首版**没有**机关房；`ruinKindForDim('end') === null`。

## 五、机关机制细节（改之前先读，别凭直觉回退）

### 潮闸房：水怎么会流过去

- 出厂时水口是**水源方块**，暗渠里有两处**砂砾泥塞**（不是水），所以水不动（`FluidSim` 只调度被扰动过的格）。
- 玩家挖掉泥塞 → `World.setBlock` → `fluidSim.onBlockChanged` 把改动格与 6 邻居里**属于流体的格**重新入队
  → 水口被调度 → 沿暗渠逐格扩散（`WATER_STEP_MS = 250` 一步）。
- 水平距离必须 ≤ `WATER_MAX_FLOW = 7`：本布局从水口到标线列最远 6 级（源 0 → … → 池角 6），**留了一级余量**。
  改动暗渠长度/池宽时**必须重算这条链**，超过 7 级水就永远漫不到标线列。
- 标线列正下方是荧石（夜里发光）+ 池东墙同高的白色混凝土水位线 = "水要到这里"的视觉标线。
- 关键件只是水口那一格：玩家若挖掉水源，可以用桶补回（补回的必须是水源 id，流动水不计）。

### 烬火回路房：灯怎么才会亮

- 出厂：中央石墩上有 `redstone_torch`，四向各一条支路，**每条第 2 格的导线出厂缺失**（断线）。
- 预置的导线在区块加载时**不会自动通电**——`RedstoneSystem` 只处理被 `scheduleUpdate` 扰动过的格。
  玩家把补的那格导线放下去 → `onBlockChange` → 3×3×3 邻域入队 → 支路第 1 格（贴着火把）通电 → 下一帧灯亮。
  这是**为什么每条支路都必须留断线**：没有断线就永远点不亮（表现成"机关永远解不开"）。
- 灯被 `RedstoneSystem.setLampLit` 换成 `redstone_lamp_lit`，判定只认点亮态。
- 厅内两处料架上备着 `redstone_wire`（挖下来就是红石粉），玩家不必自备材料。

### 构件架房：材料怎么读懂

- 每个凹槽的**镶边就是它要的材料**（槽心空着，四周 4 块同材料），东墙料架各备 2 块同材料可挖下来补。
- 材料由 `ruinPuzzle` 用 seed + 锚点从 `RACK_MATERIALS` 里确定性挑 3 种互不相同（调色板：
  quartz_block / glowstone / sea_lantern / star_marrow_block / cloud_wool / blue_ice）。
- 槽距 3 格（`RACK_LAYOUT.slotXs = [-3, 0, 3]`）：相邻槽镶边（±1）**不能重叠**，否则两种材料在同一格互相覆盖。

## 六、状态机与轮询（`class Ruins`）

```js
const ruins = new Ruins(game);
ruins.reset(rawSaveData);           // null/旧档 → 空账本
ruins.serialize();                  // { ruins: { "<key>": { state, byName, at } }, claims: { "<key>": { byName, at } } }
ruins.stateAt(key);                 // 'locked' | 'solved'
ruins.isSolved(key);
ruins.markSolved(key, byName, at);  // locked → solved 单向，重复写入返回 false
ruins.isClaimed(key);              // 纪念奖励领取记录（阶段 2）
ruins.markClaimed(key, byName, at); // 单向：同一处机关只记一次领取，重复返回 false
ruins.track(puzzle);                // 登记一处待判定机关（同 key 覆盖）
ruins.setTargets(puzzles);          // 换维/换存档时整体替换
ruins.poll(nowMs, sample);          // 0.25s 节流；返回 { sampled, results, solved: [key...] }
ruins.results();                    // 最近一轮的 [{ key, kind, state, missing, badIndex }]（界面提示）
ruins.entries(); ruins.size; ruins.clear();
```

- `poll` **不足 `RUIN_POLL_MS = 250` 毫秒直接早退，一次 sample 都不调**（单测钉死）。时钟回退（nowMs 变小）时
  自动放行，不强求等待。
- `poll` 的 `solved` 是"本次新解开"的键（阶段 2 据此发奖 + 广播 + 写游记）；已解开的机关自动移出待判定集。
- 调用方只管把**当前维度、附近、未解开**的机关 `track` 进去；远处机关别登记（`sample` 会回 -1，白判）。
- `byName` 在本地 `poll` 判定时为空串：真正的"谁解开的"以房间账本（`RUIN_STATE.by`）为准。

## 七、已知边界（诚实清单）

1. **判定只读**：`Ruins` 不写世界，除了 `applyUnlock`（且只走 `world.setBlock`）；开门由 `Game._onRuinsSolved` 触发。
2. **未加载区块 = 未知**：`makeWorldSample` 回 -1，因此**只在机关附近（区块已加载、半径 ≤64 格）轮询**。
3. **构件架房不校验顺序**：三槽相互独立（乱序放对也行）；规格里的"按序"未实现（已定偏差，见 §九）。
4. **烬火回路房的自通电线依赖 `scheduleUpdate`**：若以后把世界生成的导线做成"加载即通电"，四条断线的必要性可重评。
5. **潮闸房水位只判"是水"**：不校验具体 level（`water_flow_1` 也算达标）；要更严就收窄 `accept`（已定偏差，见 §九）。
6. **三种机关房都没有箱子/石碑**（`loot.js` 与 `steles.js` 未改）——纪念物由 §八 的领取流程发放。
7. **净空未逐列上探**：下界/天域选址只按 5 列地面高差取中位（与 `tidefire_hearth` 同款取舍），
   腔顶特别低的锚点可能让屋顶戳出岩层；天域浮岛较薄时房间可能悬在岛缘下方（`probeIsland` 只保证 ±5 平坦）。
8. **无浏览器画面验收（本轮）**：UI/奖励链路用 `game-env` 假环境与纯 node 套件覆盖，
   真实画面的"一眼看懂"仍只靠布局设计与单测断言保证；agent 驱动冒烟未在本轮执行。
9. **领取不可撤销**：`ruinClaims` 一旦写入即为终态；只有 op 重置（`Room.resetRuins` / 管理面板）会清掉它。
10. **重放不恢复领取记录的行礼顺序**：快照只存"key → 领取者"，不含发奖明细，
    因此**不会**在重启后补发物品——奖励已经进了玩家背包/档案。
11. **服务器不重跑结构生成，无法证明"锚点处真有机关"**：`sanitizeRuinKey` 只保证
    "格式合法 + 坐标量级 + 类型属于该维度 + 玩家在该维度"，伪造一个格式合法的键仍能入账并领取。
    这与 `waymark_*`/`race_*` 是同级的信任模型（服务器不持有世界生成结果，也不为稀有操作付
    生成开销）。真要堵死需在服务器侧按 seed 重解 `StructureManager.ensureRecord`（含下界腔体生成），
    开销与复杂度都另立提案。
12. **联机解开瞬间若正好处于世界重建/未就绪**（`net._ready === false`）：`sendRuinState/sendRuinClaim`
    返回 false 且**不重试** —— 该处机关的"已解开"与奖励都可能没进服务器账本；同一时刻解封产生的方块改动
    （走 `onLocalBlockChange` → `sendBlock`）也可能因为未就绪而丢失，表现为"门好像开了但没同步"。
    重连后**重复上报是幂等的**，因此不会重复发奖；但若状态确实没送达，玩家需要再走近机关房观察/再解一次
    （判定读的是本地世界，解封与开门会在下次判定通过时重来）。**不要为此新增协议或补发逻辑**。

## 八、阶段 2 落地（协议 / 账本 / 客户端 / 奖励）

### 8.1 协议（照抄 `waymark_*` 的四件套）

| 消息 | 方向 | payload | 说明 |
|---|---|---|---|
| `RUIN_STATE` | C2S | `{ key }` | 上报本人解开了某处机关 |
| `RUIN_STATE`（同一条） | S2C | `{ ruins: { "<key>": { state, byName, at } } }` | 进房/重连/op 重置后的**全量**下发（形状与 `Ruins.serialize()` 同构，客户端直接 `reset`） |
| `RUIN_UPDATE` | S2C | `{ key, state:'solved', byId, byName, at }` | 入账广播（含提交者本人，多端顺序一致） |
| `RUIN_CLAIM` | C2S | `{ key }` | 领取纪念奖励 |
| `RUIN_CLAIMED` | S2C | `{ key, byId, byName, at }` | 领取成功回执，**只发领取者本人** |
| `RUIN_DENY` | S2C | `{ key, reason }` | reason ∈ `key｜dim｜rate｜limit｜locked｜claimed` |

- 服务器不重跑判定（判定读本地世界），只重算三件事：**键合法性**（`isValidRuinKey` + 坐标量级 + 类型必须属于该维度）、
  **玩家维度与键的维度一致**、**一次性语义**。
- 幂等：已解开的键再次上报**静默返回**（不广播、不改写 `at`）——两人同时解开只记一次。
- 领取是**全房一次性**（不是"每人一次"）：第一个领取者拿走奖励，其余人 `RUIN_DENY reason='claimed'`。
  这是按计划 §五 D.3「两人同时解开时只有一人的领取得到物品」取的口径（比"每人一次"更严）。

### 8.2 房间账本与快照

```js
// Room（server/room.js）
this.ruins = new Map();       // key -> { state:'solved', byName, at }
this.ruinClaims = new Map();  // key -> { byId, byName, at }

// 快照（server/store.js roomSnapshot）
ruins:       { "<key>": { state, byName, at } },      // 对象映射
ruinClaims:  [ ["<key>", byId, byName, at], ... ],    // 数组，便于逐项校验
```

- `Room.restore`：旧快照缺 `ruins`/`ruinClaims` → 空表；坏项逐条跳过（`sanitizeStoredRuin` / `sanitizeStoredRuinClaim`）；
  **无主机关的领取记录不恢复**（`ruins` 里没有该 key 就丢弃）。
- `isRoomSnapshot` 增补：`ruins` 必须是对象、`ruinClaims` 必须是数组（`isRoomSnapshot` 已 `export` 供套件断言）。
- `Room.resetWorld()`（`/rebuild`）会连账本与领取记录一起清空——新种子下旧键全部失效。
- op 入口：`Room.resetRuins(player, key)`（单处 / 全房，非 op 拒绝）+ 管理面板
  `GET/POST /api/room/<name>/ruins`（POST 体 `{ key? }`，缺省重置全房；viewer 被全局 403 拦）+ 面板「重置遗迹」按钮。

### 8.3 限速

- 房间内写入桶 `allowRuinWrite`：突发 20 + 每分钟补 10（与 waymarks/races/blueprints 同口径）。
- 连接档：`server/ratelimit.js` 的 `tierOf` 把 `RUIN_STATE`/`RUIN_CLAIM` 归入 `ruin` 档，
  `createConnectionLimiters` 增 `ruin` 限速器；`server/config.js` 的 `DEFAULTS.rateLimits.ruin = 120`
  与 `sanitizeRateLimits` 白名单**均已收录该键**（管理面板可改、热生效），
  `ratelimit.js` 的 `TIER_FALLBACK.ruin = 120` 只作为"config 里没有该键"时的代码兜底
  （例如裸传 `{ rateLimits: {} }` 的单元测试路径）。

### 8.4 Game 接线（新建型子系统）

| 位置 | 内容 |
|---|---|
| `Game.start()` | `this.ruins = new Ruins(this)` + `reset(loadData ? loadData.ruins : null)`；随后 `net.flushPendingRuins()` |
| `Game._disposeWorld()` | `this.ruins = null`，`_ruinPuzzles` 重建，`_ruinScanAt/_ruinCell/_ruinSample` 归零 |
| `Game.update(dt)` | `_updateRuins()`（紧跟 `_updateJournal()`，位置取本帧物理结算后的最终坐标） |
| `_composeSwitchLoadData` | `ruins: this.ruins.serialize()`（换维重建不丢账本与领取记录） |
| `SaveSystem` | `ruins` 字段；旧档缺/形状非法 → `null` → `reset(null)` 回落空账本 |

**`_updateRuins()` 的节拍（防每帧全扫）**：

1. 目标集每 **2 秒**或**跨区块格**时重建一次：`ruinKindForDim(dim)` → `sm.recordsAround(kind, x, z, 1)`
   → 距离 ≤ `RUIN_SCAN_RADIUS = 64` 的才算 → `ruinPuzzle(gen.seed, dim, kind, rec.ax, rec.groundY, rec.az)`
   → 校验 `rec.meta.ruin.key === puzzle.key` → `ruins.setTargets(list)`。离开半径的机关在整体替换时自动 untrack。
2. 采样器 `makeWorldSample(world)` 与目标集**同一节拍重建一次**（不放每帧新建闭包）。
3. `ruins.poll(now, this._ruinSample)` 每帧调用，但模块内部 **0.25s 节流**，不足节拍一次 sample 都不调。

**解开链路（`_onRuinsSolved`）**：`applyUnlock`（开门，只走 `setBlock`）→ `journal.recordDiscovery(dim, 'ruin_<kind>', ax, az, 中文名)`
→ 联机则 `sendRuinState` + `sendRuinClaim`（奖励等服务器回执）/ 单机直接 `_grantRuinReward` → `hud.showToast` + `chatBox` + `audio.pop()`。

**联机收敛**：`RUIN_STATE` 全量 → `ruins.reset({ ruins })`（服务器权威覆盖本地，随后重放本端 `_ruinClaimed`）；
`RUIN_UPDATE` → `markSolved` + `untrack` + 从 `_ruinPuzzles` 移除（**不重复开门/发奖**）；换房/断线/重连一律 `_clearRuins()`。

### 8.5 奖励（每处机关只发一次）

```js
// src/core/Ruins.js
RUIN_REWARD_BLOCK = { tide_sluice:'tide_keepsake', ember_circuit:'ember_keepsake', frame_rack:'rack_keepsake' }
RUIN_REWARD_PLAQUE = 'ruin_plaque'
RUIN_REWARD_BLUEPRINT_ID   = { tide_sluice:'ruintide001', ember_circuit:'ruinember01', frame_rack:'ruinrack001' }
RUIN_REWARD_BLUEPRINT_NAME = { ..., 中文名走 t()（10 包齐全） }
ruinReward(kind, name?) -> { kind, block, plaque, blueprint }   // 固定体素表 → encodeBlueprintRLE → validateBlueprint
```

- 蓝图由**固定体素表**生成（潮闸 7×5×5 / 烬火 7×3×7 / 构件架 9×3×3，实例 90/58/45，RLE 串 144/73/35 字节），
  按 `(kind, name)` 缓存，返回的是**副本**（外部改动污染不到缓存）。
- 落地顺序：`isClaimed(key)` 早退 → `markClaimed` → `inventory.add(纪念方块 1 + 铭牌 1)` →
  `Blueprints.addPersonalUnique(blueprint)`（**按 id 或名字去重**，换语言后同名不同串也不会重复塞）。
- 联机时只有收到 `RUIN_CLAIMED` 的那一端会发奖（服务器去重在前）；`RUIN_DENY reason='claimed'` 只记 `markClaimed` 不发奖。

### 8.6 游记与提示

- 游记侧栏（`JournalScreen._section`）：`d.type` 以 `ruin_` 开头的发现行追加「已解开 / 未解开」
  （读 `ruins.stateAt(ruinKey(dim, kind, x, z))`）；未解开时给一行缺件提示：
  `badIndex >= 0` → "关键件被挖毁"，否则按 `ruins.results()` 的 `missing[].needName` 归类成
  「还差 N 处未就位：<材料> ×k」。**没走近过机关时没有 `results()`**，提示改为"走近机关房才会显示缺件"。
- 解开瞬间的提示走 `Hud.showToast()`（准星下方一行，2.6s 后淡出；HUD 是共享实例，`hideAll()` 会收起它），
  联机同时写 `chatBox`。不新开热键、不新开大屏。

### 8.7 解封写入的联机链路（别绕开 `World.setBlock`）

门体解封**不走任何新协议**，全靠既有的方块同步链路：

```
applyUnlock(world, puzzle)
  → world.setBlock(x, y, z, 0)        // 唯一写入口（同时标脏、更新光照、写 modifiedBlocks）
    → world.onLocalBlockChange(x,y,z,id)   // World.setBlock 末尾的本地改动钩子
      → NetworkManager.bindWorld 的接线：sendBlock / queueFluidBlock
        → 服务器方块账本（dimensionBlocks）+ BLOCK_CHANGE 广播给同维度其他客户端
```

- 因此**解开者本人开门 = 全房开门**，其他人重连后由服务器方块账本回放（`BLOCK_CHANGE_BATCH`）恢复；
  `applyUnlock` 内部只调 `world.setBlock`，不会出现"只有本地开门"。
- **禁止绕开 `World.setBlock` 直接写 `chunk.set(...)`**：那样门只在本地开、不进账本、不同步、重连后复活。
  `tests/ruin-reward.mjs` §八 钉住了这条：给真 `World` 挂替身 `onLocalBlockChange` 计数，
  断言 `applyUnlock` 的写入次数 = `puzzle.unlock.length` = 钩子触发次数，并断言解封格进了 `modifiedBlocks`；
  另有源码绊线确认 `NetworkManager` 仍接线该钩子、`Ruins.js` 里没有任何 `chunk.set(`。

## 九、已定偏差（不要返工，写清楚就够）

1. **构件架房三槽无序**：材料按槽位由 seed + 锚点确定性指定，玩家可以任意顺序放对；规格里的"按序"未实现。
2. **潮闸房只判"该格是水"**：不校验 `level`（`water_flow_1` 也算达标）；要更严就把 `SLUICE` 的 `accept` 收窄成只有水源。

## 十、密度参数与实测（B35 D 调参）

- **问题**：`ember_circuit`（下界）用 cell 24 / attempts 2 / chance 0.5 时，下界腔体门控通过率远高于另外两维的
  群系/平坦度门控，同面积出现数高一个数量级。
- **改法**：只动 `EMBER_CIRCUIT_DEF` 自己的常量 —— `cell: 24 → 32`、`chance: 0.5 → 0.05`（attempts 2 / salt 7302 不变），
  另两维与所有其它结构的常量一字未动（`ember_circuit` 的选址随机流本就随常量变化，属既定范围）。
- **实测**（等面积扫描：以世界方块 ±4608 格 = 9216×9216 区域，各维按自己的 cell 换算 cell 范围）：

| 维度/结构 | 调参前 | 调参后（seed 20250903） | 其它 seed（42 / 7） |
|---|---|---|---|
| 主世界 `tide_sluice` | 11 | 11 | 8 / 13 |
| 下界 `ember_circuit` | **298**（25×25 cell 扫描；换等面积约 298） | **24** | 19 / 16 |
| 天域 `frame_rack` | 28 | 28 | 21 / 19 |

复跑：`node tests/nether-structures.mjs`（66 断言）、`node tests/structure-determinism.mjs`（4 断言）、
`node tests/ruin-unit.mjs`（206 断言）全绿。

## 十一、i18n 与发布

- 新增静态文案 10 条 + 动态键（机关名 3 / 蓝图名 3 / 方块 lore 4 / 拒绝原因 6）全部 10 包齐全；
  `node tests/i18n-parity.mjs` 全绿（master=485）。
- 方块 lore 走 `BlockRegistry.all()` 的动态键审计，**漏翻会被 i18n-parity 直接拦下**。
- `src/version.js` 的 `BUILD` 升到 **35**（本批发布 `beta-build-35`）。
