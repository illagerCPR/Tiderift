# extra-content.md — B51 额外内容（工业 / 魔法）防回退备忘

> 覆盖 `docs/extra-content-master-plan.md` 的 Build 51–56 实现。改 `src/content/ExtraContent.js`、
> 注册表的 `requiresExtras`、`Crafting/Smelting` 归属过滤、`StructureManager.typeActive`、
> 创造栏/配方查询的归属闸口前**必读**。
> 分轮交付；本文按轮追加，当前：**B51 R4（魔法最小闭环：回响仪台 / 回响值 / 风步 + 烬矢）**。

## 一、总原则（违反即回退）

1. **注册永远全量**：方块/物品/配方/结构定义在任何世界都注册，数字 ID 由注册顺序决定、一律尾部追加。
   开关只决定「生成 / 获取 / 放置 / 交互 / 模拟 / 网络」是否启用。绝不按开关条件注册。
2. **清单显式传递**：世界清单由 `World.extraContent` 持有，`World` 构造时同时写到
   `world.generator.extraContent`（结构闸口与 Worker 同源）。禁止模块级「当前世界开关」。
3. **旧档/旧快照缺字段 = 双关**；**未知 schema = 拒绝**（`normalizeExtraContent` 返回 `null`，
   由调用方报错）。不允许静默降级成双关而丢失内容规则。
4. **fail-closed**：归属需求写错内容 ID（`typo_extra`）时该定义**永不启用**，不会被意外放行。

## 二、清单口径（`src/content/ExtraContent.js`）

```js
{ schema: 1, industry: false, magic: false }   // 规范化后的形状（冻结，不可就地改写）
```

| 输入 | 结果 |
|---|---|
| `undefined` / `null` / 缺字段 / `{}` | 双关（共享冻结实例 `NONE_EXTRA_CONTENT`） |
| 缺 `schema` 但有 `industry`/`magic` | 按 schema 1 读取（旧档旧快照形态） |
| `schema !== 1` | `null`（调用方拒绝加载/加入） |
| 非对象（字符串、数组、数字） | `null` |
| `industry: 1` / `'true'` | 视为关（**只认严格 `=== true`**） |

导出面：`normalizeExtraContent` / `serializeExtraContent` / `extrasEqual` / `enabledExtras` /
`isExtraEnabled` / `isAnyExtraEnabled` / `normalizeRequires` / `requiresSatisfied` /
`isContentEnabled` / `filterEnabled` / `extraContentCode`（记录用 `industry+magic`）。

## 三、归属元数据与五道闸

定义侧白名单字段 `requiresExtras`：`null` = 基础内容；`['industry']` / `['magic']` = 单模块；
`['industry','magic']` = 联动（不伪造第三个内容 ID）。注册表只附加元数据，不增删定义。

| 闸口 | 落点（R1 已接） | 后续轮次 |
|---|---|---|
| 注册 | `BlockRegistry` / `ItemRegistry` 的 `requiresExtras` | — |
| 获取 | `InventoryScreen`（创造栏 + 搜索）、`RecipeViewer`（列表 / 配方 / 用途）、`Crafting.matchRecipe`、`Smelting.getAllSmeltingRecipes` | 战利品/交易/掉落（R3+） |
| 放置 / 交互 | — | R2/R3（`InteractionController`、`BLOCK_SET`） |
| 生成 | `StructureManager.typeActive`（= `dimMatches` ∧ `extraMatches`，装饰 / 树让位 / 缓存查询 / 按需求解 / 游记命中全走它） | R2 Worker 键、R5 新结构 |
| 模拟 / 网络 | — | R2/R3（tick、协议、服务器拒绝） |

**要点**：`Crafting.matchRecipe(grid, manifest)` 与 `RecipeViewer` **共用** `recipeEnabled`，
配方列表和实际匹配不会各写一份。`matchRecipe` 的 `manifest` 缺省 = 双关，未传清单的旧调用点
不会命中带归属的配方（fail-closed）。

## 四、只读清单不许就地改

`World.extraContent` 是冻结对象；换维重建（`_composeSwitchLoadData`）与 `Game.start` 必须**显式透传**
同一份清单（见 R2）。`World` 构造对未知 schema 只做「兜底双关 + 告警」，真正的拒绝在调用方
（`Game.start` / `Room`）——不要依赖 `World` 兜底当校验。

## 五、回归网

| 套件 | 守什么 |
|---|---|
| `tests/extra-content-unit.mjs` | ①清单规范化与拒绝 ②相等/序列化 ③归属清洗与 fail-closed ④注册表只附加元数据 ⑤配方（合成+烧炼）闸口 ⑥结构闸口与维度过滤同点 ⑦World→生成器同源 ⑧源码绊线（闸口真的接上、无全局开关）⑨两个清单的生成器互不影响 ⑩**全关基线夹具**（种子 20251123，9 区块采样滚动哈希 = `511554064`） |

基线夹具口径：BUILD=50 时同种子生成 `(-1..1)²` 区块的采样滚动哈希（步长 13，FNV-1a）。
捕获时归属接线已存在但无任何定义带 `requiresExtras`，故与 Build 50 逐字节等价；
与 `biome-determinism` / `structure-determinism` / `loot-determinism` 三套既有 oracle 共同守住「全关不变」。
**新增任何生成内容（结构/矿脉/新生物）后，双开清单不得改变这条基线之外的基础地形**——
若确需改变，必须同时更新夹具并在本文记录理由。

## 六、R2：世界创建界面与全链路透传

### 6.1 界面（`src/ui/ExtraContentScreen.js`）

- 只在**创建新世界前**出现：单人页「额外内容: … 选择…」与 LAN 页建房区同一行入口，单例跨页复用。
- 两张独立卡片（工业 / 魔法），没有第三颗开关；两张都开才显示联动说明。
- 草稿由 `MenuScreen.selectedExtras` 持有（菜单会话内有效），界面只读写同一个引用。
- 文案一律在 `render()` 里以 `t(简体原文)` 字面量书写——**不要改回模块级文案表 + `t(table[key])`**：
  静态扫描覆盖不到动态键，翻译会静默回落中文。
- 徽标统一走 `MenuScreen.extrasBadgeLabel()`（存档槽 / 导入摘要），暂停菜单只读行由
  `PauseMenu._applyWorldRules()` 在 `show()` 时刷新，**没有任何修改入口**。

### 6.2 启动参数收口（`Game.start`）

```js
start(mode, seed, loadData, slot, cheatsEnabled, networkMode, { biomeScale, extraContent })
```

- 第 7 参是选项对象；**不要再追加第 8 个位置参数**。读档时以 `loadData` 为准（草稿只在新建时生效，
  这正是"读旧档不采用当前草稿"的实现点）。
- `World` 构造携带清单并把同一份写进 `world.generator.extraContent`（结构闸口与 Worker 同源）。
- 换维：`_composeSwitchLoadData()` 必须带 `extraContent`（`serializeExtraContent(this.world.extraContent)`），
  漏掉会让换维后的世界悄悄变成双关。
- `resolveExtraContent()` 对未知 schema 只做「告警 + 兜底双关」——真正的拒绝在
  `normalizeSaveData`（存档）与服务器（房间），不要依赖这里的兜底当校验。

### 6.3 存档 / 导入导出

| 接入点 | 行为 |
|---|---|
| `SaveSystem.save` | 写 `extraContent`（来自 `game.world.extraContent`） |
| `normalizeSaveData` | 旧档缺字段 → 双关；未知 schema → 返回 `null`（读档失败） |
| `SaveSystem.listSaves` | 摘要带 `extraContent`（槽位徽标；未知 schema 回落双关不阻塞列表） |
| `SaveTransfer.sanitizeSaveData` | 导入净化保留并规范化清单 |
| `parseSaveText` | 未知 schema → `bad-extra-content`（新增错误码，文案已进 10 语言包） |
| `summarize` | 导入摘要带 `extraContent` |

### 6.4 LAN 权威与能力协商

- **消息**：`HELLO.extras = {schema, ids}`（能力声明）、`CREATE_ROOM.extraContent` / `JOIN_ROOM.extraContent`
  （建房草稿）、`WORLD_INFO.extraContent`（房间权威清单）。纯新增字段，**不升 `PROTOCOL_VERSION`**。
- **语义**：与 seed/biomeScale 同生命周期——首次创建固定；重复 `create_room` 不覆盖；加入已有房间**完全忽略**草稿；
  隐式创建（加入不存在房间）采用该请求的草稿；`/room` 换到新房间**继承当前房间清单**；`/rebuild` 保留清单。
- **拒绝**：房间启用了客户端不支持的内容 → `KICKED` 并点名缺失模块；能力声明缺失（旧客户端）= 只支持双关房间。
  **双关房间旧客户端照常可进**（默认体验不变）。
- **快照**：`store.roomSnapshot` 写 `extraContent`；`Room.restore` 遇到不支持的 schema 置 `extraBroken`，
  该房间**拒绝任何加入**（不静默降级）。
- **断线恢复**：恢复到已不存在的房间 → 中止恢复并回主菜单，**不得借恢复包定义新世界规则**。

## 七、R3：工业最小闭环（潮工）

### 7.1 三层分工

| 层 | 文件 | 职责 |
|---|---|---|
| 数据 | `src/content/industry/defs.js` | 方块名 / 潮压平衡 / 碎石配方 / 预算与节拍（单机与服务器共用的唯一一张表） |
| 纯算法 | `src/core/Industry.js` | 拓扑分量、供需效率、锅炉燃烧、碎石推进、槽位投料取出、状态清洗（node 可测） |
| 两端驱动 | `src/player/IndustrySystem.js`（单机 tick + 交互）/ `server/room.js` 的 `tickIndustrySweep`（权威 tick） | 只管调度与板端结算，不写第二套算法 |

**规则**：任何工业数值改动只改 `defs.js`；任何推进语义改动只改 `Industry.js`，两端自动同步。

### 7.2 方块与 ID（尾部追加，零漂移）

| id | 方块 | kind | 归属 |
|---|---|---|---|
| 224 | `tide_boiler` 潮压锅炉 | `boiler` | `requiresExtras: ['industry']` |
| 225 | `drive_shaft` 传动轴 | `shaft` | 同上 |
| 226 | `crusher` 碎石机 | `crusher` | 同上 |

`BlockRegistry` 透传 `industryKind`；`server/industry.js` 有同表（钉值断言在 `tests/industry-unit.mjs`）。
**新状态变体（点燃态/朝向）若将来新增，一律继续尾部追加，并同步两处 id 表。**

### 7.3 潮压与交互口径（首版）

- 锅炉：`燃料` + `桶装水` 各 1 个点火 → 燃烧 `getFuelTime()` 秒，期间供给 `BOILER_SUPPLY=4`；空桶回收到 `output`（满则停炉等取）。
- 网络：锅炉/轴/碎石机 6 邻接连通；`效率 = min(1, 供给/需求)`，全网同一口径；无供给停转保温；超 128 节点整网停摆。
- 碎石机：`cobblestone→gravel`、`gravel→sand`；满效率 4 秒一个；产物满阻塞保温；无料进度缓慢回退。
- 交互（**R3 简化，R52 再做完整机器界面**）：右键手持物品 = 投料；空手 = 取 `output`。投错的内容需拆机器取回（破坏散落）。
- 破坏机器 = 清账本 + 槽位内容散落（联机由服务器权威散落，客户端不再散第二次）。

### 7.4 权威与持久化

- **联机客户端一律不 tick**（`IndustrySystem.update` 首行 `networkMode` 早退）；它只发 `INDUSTRY_ACTION`，
  服务器结算后回 `INDUSTRY_STATE`（`res` 只随发起者那一份下发）。
- 服务器 200ms sweep（`flowSweep` 内），`dt` 钳到 ≤1s：**不追赶离线生产**；槽位变化即时广播，
  只有进度变化按 `INDUSTRY_SYNC_MS=500` 节流；静置机器零消息。
- 落盘：单机存档 `dimensionIndustry`（dim → {pos: state}）；房间快照 `dimensionIndustry`（dim → entries 数组）。
  状态只含**槽位 + 进度**；拓扑与方块索引纯派生自方块账本，**不落盘**。
- 方块消失路径两处都要清理：单机 `World.trackIndustry` + `IndustrySystem.onBreak`；服务器 `onBlockSet`
  与 `onBlockSetBatch` 的 `dropIndustryAt`。**漏一处就会出现幽灵机器继续产出。**
- 关闭工业的世界：客户端不 tick、服务器拒绝 `block_set` 写入工业方块（回滚），已存在的机器保留数据但不运行。

### 7.5 验收与回归

| 套件 | 守什么 |
|---|---|
| `tests/industry-unit.mjs` | 方块 ID 钉值与归属/名字表/分类、配方归属、拓扑分量与超限、锅炉点火与空桶回收、供需降速、槽位动作、dt 钳制与确定性、状态清洗、存档与导入净化、接线绊线 |
| `server/test-industry.mjs` | 关闭工业拒绝写入、投料/取物权威回执、服务器真的产出、两人同抢不复制、拆机器散落与账本清理、快照落盘与重启恢复 |

手动闭环（浏览器）：放锅炉+轴+碎石机 → 投煤与水桶 → 投圆石 → 等 4 秒 → 空手右键取砾石 → 拆锅炉后全网停。

## 八、R4：魔法最小闭环（四潮回响）

### 8.1 三层分工

| 层 | 文件 | 职责 |
|---|---|---|
| 数据 | `src/content/magic/defs.js` | 方块/物品名、回响上限与调谐比例、法术表（费用/冷却/伤害/距离/缓降） |
| 纯逻辑 | `src/core/Magic.js` | 回响钳制、调谐、施法五关校验、风步落点裁剪、冷却记账、服务器形状校验（node 可测） |
| 客户端域 | `src/player/MagicSystem.js` | 施法、弹道推进与命中、缓降计时、脱战回响恢复、HUD 推送、远端表现 |
| 服务端 | `server/magic.js` + `Room.onMagicCast` | 启用闸口、形状/频率硬约束、同维转发表现（不结算） |

### 8.2 内容与 ID（尾部追加）

| id | 名称 | 归属 |
|---|---|---|
| 227 | `resonance_table` 回响仪台（`magicKind:'table'`） | `requiresExtras: ['magic']` |
| 141 | `echo_dust` 回响尘 | 同上 |
| 142 | `gale_focus` 风潮焦点 | 同上 |
| 143 | `ember_focus` 坠潮焦点 | 同上 |

配方：回响尘 = 1 星髓 → 2；仪台 = 石英环 + 回响尘心；风潮焦点 = 4 羽 + 尘；坠潮焦点 = 4 烈焰粉 + 尘。
关闭魔法的世界看不到、合不出、放不下（服务器拒绝写入并回滚），也不显示回响 HUD。

### 8.3 回响与施法口径（R4）

- 回响上限 100；仪台右键消耗 **1 级经验** → +25 回响（满了只补差额）；脱战每 6 秒 +1，施法后 4 秒内不回复。
- 施法五关（`checkCast`）：世界启用魔法 → 手持对应焦点 → 非创造/旁观 → 回响足够 → 冷却已过。
  失败给明确提示（回响不足 / 冷却中 / 焦点不对 / 模式限制）。
- **风步**：沿视线最多 6 格冲刺，0.25 格步进探针，实心方块即停 → **不穿墙**；落点 AABB 必须无碰撞；
  之后 4 秒缓降（`player.slowFall` 由 `Physics` 吃：轻重力 + 下落速度上限 -3），**不是飞行**。
- **烬矢**：直线弹道 28 m/s、寿命 1.4s；**方块挡停但不破坏**；怪物伤害走既有 `mobManager.attackMob`
  链路（受击红光/音效/XP 归属/联机上报全在内），一发只调用一次 → **不重复结算**。
- 创造/旁观不能施法（防在创造里刷弹道与伤害）。

### 8.4 权威边界

- 本机权威：客户端自己校验、扣回响、结算伤害；服务器**不**扣回响、不判伤害（项目轻信任玩家档案模型）。
- 服务器硬约束：房间启用魔法、法术 ID 合法、方向归一化、起点在本人附近（≤12 格）、
  每玩家每法术的**独立冷却**（服务器自己记账，不信客户端）、同维转发表现给其他人。
- 远端玩家只播表现（弹道球 + 撞击粒子），不扣回响、不结算伤害。风步的位移靠 `player_state` 自然同步。
- 回响持久化：单机存档 `player.echo` + 换维透传；LAN 进 `player_profile`（服务器清洗 0..100，
  旧档案缺字段 → 0，越界整条拒绝）。

### 8.5 回归

| 套件 | 守什么 |
|---|---|
| `tests/magic-unit.mjs` | 仪台/物品 ID 钉值、11 语名字、配方归属、回响钳制与调谐、施法五关真值表、风步落点裁剪、冷却、形状校验、存档与档案清洗、接线绊线 |
| `server/test-magic.mjs` | 关闭魔法拒绝写入与施法、表现只广播给同维他人、冷却内重复丢弃、起点过远拒绝、非法法术/方向拒绝、回响随档案恢复 |

手动闭环（浏览器）：造仪台 → 右键调谐拿到回响 → 换风潮焦点右键学会风步（撞墙即停）→
换坠潮焦点右键射烬矢（打怪一次伤害）→ 回响耗尽有提示 → 存读后回响保留。

## 九、术语与命名纪律

- 代码 ID（`industry` / `magic`，方块/物品名、协议字段）一经落地不随显示名变动；显示名走 i18n 键
  （`EXTRA_LABEL_KEYS`，界面主模块名始终是用户指定的「工业 / 魔法」）。
- 候选叙事术语（潮工 / 潮压 / 回响 / 回响焦点）在 R3/R4 落地前先登记，不边写边改。

## 十、B52 工业生产网络（切割机 / 离合闸 / 机器界面 / 网络不变量）

### 10.1 内容与数值（单点真相）

- `src/content/industry/defs.js` 是唯一数值来源：`MACHINE_DEMAND`（crusher 2 / cutter 3，boiler/shaft/clutch 0）、
  `CRUSH_TIME=4`、`CUT_TIME=3`、`MACHINE_SLOTS`、`CUT_RECIPES`（原木→6 板 / 骨→3 骨粉 / 石→石砖）、
  `CRUSH_BYPRODUCTS`（圆石→燧石、砾石→粘土球，每 8 个 +1）、`recipesFor(kind)`（界面与算法同源）。
- **切割表与碎石表互不回退**：`processorRecipeFor(kind, name)` 按机器种类选表；碎石机拿原木 = 无配方
  （进度回退），切割机拿圆石同理。别写成"两张表合并"。
- 副产物进独立的 `bonus` 槽：不与主产物混栈；每完成一个成品 `cycles++`，`cycles % every === 0` 才给 1 个；
  副产槽满就丢掉这一次（**不欠账、不吞主产物**）。`cycles` 随状态持久化，清洗钳到 ≤1e9。

### 10.2 离合闸 = 网络闸门（不是机器）

- 状态 `{kind:'clutch', manual, powered}`；`clutchEngaged(st) = manual !== false && powered !== true`，
  **红石信号优先**（通电必断，手动拗不过），缺状态按接通（不静默断网）。
- `buildNetworks(blocks, states)` 里断开的闸**自身留在网内但不导流**（`conducts()` 早退）——等于把轴锯断，
  两侧成为两个连通分量；不要用"删掉这个节点"实现，会让界面节点数对不上。
- `pendingClutchSignals(blocks, states, powerAt)` 是红石观察的纯函数：只产出"本地观测 ≠ 已知状态"的条目。
  单机写状态 + `markDirty()`；联机只 `sendIndustryAction(op:'signal')`（服务器权威），1.5s 防重复等回执。
- 红石**只控制通断**，不控制转速：转速仍由全网供给/需求决定。

### 10.3 机器界面（B52 R2）

- 右键机器（锅炉/碎石机/切割机）→ `MachineScreen`；**潜行+右键**保留 B51 快捷投料/取物；离合闸右键直接拨杆。
- 界面数据：`machineStatus(kind, st, net)` 派生 `recipe / progress / reason / supply / demand / efficiency`；
  `reason` 是稳定代码（running/ready/no-input/no-recipe/output-full/no-fuel/no-water/no-power/over-limit/
  disengaged/stalled/idle），文案在 `MachineScreen.reasonText()` 用静态 `t('…')` 分支。
- 交互是**点格投/取**：点背包物品 → `insert`（自动路由到能收的槽，带 `inv` 让回执扣对应槽）；
  点机器槽位 → `extract`（按 `slot`）。不做拖拽游标（与 FurnaceScreen 不同，别照抄 CursorOverlay）。
- 联机：`INDUSTRY_OPEN`（打开 + 每 0.9s）由服务器**定向**回一条 `INDUSTRY_STATE`（无 `res`，带 `net`）。
- **槽位校验**：服务器对显式给的 `slot` 做 `isMachineSlot` 校验，不属于该机器直接回 `invalid`；
  **不要**回落到输出槽（一次点错会取走别的东西）。
- `net`（供需摘要）由 `netInfoFor(networks, key)` 提供；`buildNetworks` 建图时就会调 `evaluateNetworks`
  ——否则刚重建拓扑的一瞬间界面会读到 supply=0（服务器 tick 之窗）。

### 10.4 网络不变量（回归守着）

- 环路：BFS 去重，节点只计一次；`comp.nodes.length > 128` → `overLimit`，整网效率强制 0。
- 跨维隔离：每维各一张 `dimensionIndustryBlocks` / 拓扑缓存，`tickIndustrySweep` 按维遍历，绝不跨维并图。
- 拆轴：只让被切断的一侧失去供给；另一侧继续推进（进度保温，不丢料、不产出）。
- 断开期间：进度**保温**（不推进也不回退），上游锅炉照常燃烧（`burnTime` 继续走）；重新接通继续。
- 魔法关闭的世界不影响工业：`server/test-industry.mjs` 整轮就是 `{industry:true}`（magic 未启用）。

### 10.5 i18n 教训（B51 遗留，R2 修）

- 机器回执文案曾是模块级 `CODE_TEXT` 表 + `t(text)` 动态键 → `tests/i18n-parity.mjs` 扫不到，
  10 个语言包全漏（界面静默回落中文）。**规则**：UI 文案表一律写成 `switch` 里的字面量 `t('…')`；
  只有"表由别处导出、并在 parity 测试里登记"的动态键（如 `SAVE_IMPORT_ERROR_KEYS`）才允许动态。

### 10.6 回归

| 套件 | 守什么 |
|---|---|
| `tests/build52-industry-unit.mjs` | 228/229 ID 钉值、切割/碎石配方类型、网络闸门与环路与跨维、副产物确定性、指定槽位、机器状态原因、清洗与存档、纹理键 |
| `tests/build52-machine-ui.mjs` | 原因/槽位文案全覆盖、界面数据同源、右键与潜行分流、INDUSTRY_OPEN 与槽位校验、生命周期接线 |
| `tests/build52-network.mjs` | 红石观察纯函数、断开保温、两线并行、拆轴只影响子网、源码绊线 |
| `server/test-industry.mjs`（第七段） | INDUSTRY_OPEN 权威状态+网络摘要、指定槽位、切割机产出、离合闸红石优先 |

## 十一、B53 物流与自动化（分拣漏斗 / 收割机 / 潮压表 / 两道上限 / 潮工断坊）

### 11.1 分拣漏斗 = 「容器最后一格是过滤槽」

- **27 槽协议不变量不变**：分拣漏斗的容器仍是 27 格，只是**最后一格（下标 26，`FILTER_SLOT`）被征用为过滤槽**，
  缓冲只剩前 26 格（`FILTER_BUFFER_SLOTS`）。因此存档 / 联机 / 导入导出 / 容器界面**全部零改动**，
  过滤规则随容器本身一起落盘与同步——不要为了"多一个槽"去改成 28 格（会撞 `length === 27` 的一串校验）。
- 过滤规则只认**物品名**（带 data 的潜影盒也按名字），空过滤槽 = 全通；过滤同时管**出料**与**取料**
  （不认的物品连进都不进，否则缓冲会被不能出料的东西占满）。
- 过滤槽自身**永不流动、也不会被别的漏斗当目标格写**：`targetSlot/moveOneStack/pushIntoFurnace/pullFromFurnace`
  统统加了 `srcLimit/dstLimit/onlyName`，判定收口在 `tickHopperFlow` 的 `io.isFilterHopper`（服务器按方块账本、
  单机按 `BlockRegistry` 注入同一判定）。
- **满箱回退**：目标满 → 物品留在缓冲；缓冲 26 格满后不再从上游抽取。任何情况下物品守恒（不丢不复制）。
- 联机：过滤槽是"设置"不是搬运内容，走单开消息 `hopper_filter`（`HOPPER_FILTER`）；
  漏斗容器本体仍归服务器（`container_set` 对它继续整箱拒绝——这是 B36 的两条同步路径分界，别放宽）。

### 11.2 收割机 = 只收正前方成熟作物，产物进背面容器

- `harvester` 家族（234~237，`facingAway`：刀口朝玩家看的方向）。前方 = facing 方向，产物格 = **反方向那一格**。
- 三种**安全停止**都必须保留：前方区块未加载（用 `world.getChunk(x>>4,z>>4)` 真判，不靠 `getBlock=0` 猜）/
  背面没有容器 / 容器放不下。放不下用**副本干跑 + 整批原子**（`insertAllOrNothing`），只塞一半也拒绝，
  作物留在田里——绝不吞产物。
- 产物表与手割同源：`crops.js` 的 `cropHarvestDrops(name, rng)`；`Game._blockDrops` 已改为调用它，
  别在别处再写一份"种子 1-3"。
- 联机**主机权威**：与 `_growCrops` 同一条 `net.isHost` 门控（服务器只有方块账本，看不到地形作物）。
  产物经 `harvest_output` 上报，服务器核对「该格是容器 + 旁边那台机器朝外开刀」后写权威账本并广播；
  装不下的部分转掉落物。**不要**让客户端用 `container_set` 写机器产物（会被漏斗热窗口拒绝而丢货）。

### 11.3 潮压表与两道上限

- `pressure_gauge`（238，`industryKind: 'gauge'`）是纯只读仪表：不吃压、不产压、无槽位；
  `netInfoFor` 现在给 `boilers / machines / cuts / cutsTotal`（`cuts` 最多 6 条，payload 有界）。
- `machineStatus` 的 gauge 分支只看网络：`over-limit / cut / no-power / stalled / running`；
  `MACHINE_REASONS` 加了 `cut` 之后**必须同时给 `reasonText` 加 case**——B52 的「原因文案不重复」绊线
  会立刻抓到（否则该码会显示成「待机」）。
- 界面（`MachineScreen`）对 gauge 走只读布局：三行实时读数 + 状态行 + 只读提示，不渲染槽位与玩家背包；
  **首帧渲染要显式调一次 `_refreshGauge`**（暂停时 tick 不跑，否则只剩基本信息行）。
- 两道上限：`INDUSTRY_BLOCK_LIMIT`（512 方块，**按方块数**不是状态数）与 `NETWORK_MAX_NODES`（128 节点）。
  `projectedNetworkSize(networks, blocks, x, y, z, states)` 与建图同口径（断闸不导流）；
  客户端 `IndustrySystem.canPlaceAt` 预检 + 服务器 `onBlockSet` 权威回滚（回写该格旧值 + 系统提示）。
  注意：**拨通离合闸仍可能把两个网络并成超限网络**，此时整网停转（`over-limit` 原因保留），这是有意的。

### 11.4 潮工断坊（tide_workshop）

- 结构 def 带 `requiresExtras: ['industry']`：关闭工业的世界**一个都不生成**（旧结构随机流逐字节不变），
  自带 salt 8419 / cell 20 / `probeR: [10, 14]` / `maxSlope: 5`（小体量，默认探针环几乎全落选）。
- 布局里**没有任何工业方块**：遗迹只给叙述、材料与形制参考；机器靠配方即可获得（遗迹不是解锁点）。
- 箱子表 `tide_workshop`（铁/铜/煤/红石/石料，`bucket` FORCED 保底）；碑位注册 `tideworks` 章节
  （`STELE_CHAPTERS`，dim = overworld），四格形制走 `steleStack`。

### 11.5 回归

| 套件 | 守什么 |
|---|---|
| `tests/build53-filter-hopper.mjs` | 230~233 ID 钉值、27 槽不变量、过滤只认同名/空滤全通、过滤格不流动、满箱回退、26 格缓冲、熔炉两向、守恒与确定性、World 索引、接线绊线 |
| `tests/build53-harvester.mjs` | 234~237 ID 钉值、前后几何、只收成熟作物、产物同源手割、三种安全停止、原子入箱、一拍一格、World 索引、接线绊线 |
| `tests/build53-gauge-limits.mjs` | 238 ID 钉值、读数含锅炉·机器·断路位置、五种表状态、并网规模（含断闸口径）、512/128 常量、文案覆盖、预检与权威回滚绊线 |
| `tests/build53-workshop.mjs` | 断坊注册与工业门控、残墙/火把/箱子/断坊碑、四格形制、箱子三向 + loot 桶保底、确定性、旧结构随机流不变、布局无工业方块 |
| `tests/build53-soak.mjs` | 切割机 64 原木精确守恒、断网保温、槽满即停；12000 步整线扰动（投料/取货/拨闸/拆装轴/收割）不变量与确定性 |
| `server/test-flow.mjs` | 分拣漏斗过滤格广播与只搬同名物品、清空后全通、整箱改写仍被拒、收割产物入箱、溢出转掉落 |
| `server/test-industry.mjs` ⑧ | 第 129 节轴被拒并回滚、系统提示、128 节点网络读数正常且未超限 |

## 十二、B54 四潮齐备（雨潮回潮 / 无潮折步 / 蓄力与反馈 / 持久化与分流）

### 12.1 R1：雨潮与无潮落地（四系基础能力齐备）

| 项 | 值 |
|---|---|
| 物品 | `rain_focus` id **144**、`tideless_focus` id **145**（尾部追加，11 语名字，`requiresExtras:['magic']`，stack 1） |
| 配方 | 雨潮 = 4 `clay_ball` + 1 `echo_dust`；无潮 = 4 `ender_pearl` + 1 `echo_dust`（**不含任何工业件**，四系各自从基础材料起手） |
| 法术 | `tide_mend` 回潮：cost 20 / cd 8s / heal 6 / `resistance` I 6s；`void_step` 折步：cost 25 / cd 6s / 8 格 / standDepth 3 |

口径与不变量：

- **回潮只恢复自己且永不越上限**：治疗量走 `planMend(health, maxHealth, heal)` 裁剪；满血（或治疗量为 0）返回
  `ok:false` → 提示「身上没有需要回潮的伤」，**不扣回响、不进冷却**。防护复用 `Player.effects` 的 `resistance`
  （每级 -20% 伤害），不新造第四套 buff 系统；死亡 `respawn()` 已经 `clearEffects()`，不需要额外清理。
- **折步 = 沿视线找最远的可站立点**：纯函数 `resolveBlinkTarget(distance, probe, step)`，与风步的
  `resolveDashTarget` **不是同一个语义**——折步遇到任何被挡点（实心格 / 未加载区块）就整段停住，且终点必须
  `standable`（脚下 `standDepth` 格内有实心非可通行方块），所以不会折进半空、虚空或墙里；找不到落点（0）时
  提示「目标处没有可落的空隙」，同样不扣回响。落点还要求 AABB 无碰撞，落定后清速度与缓降（不留惯性）。
- **失败不扣费用的结构保证**：`castHeld()` 先 `checkCast` 五关，再 `_execute`，只有返回 `ok:true` 才
  `p.echo -= cost` 并写 `_lastCast` 冷却。提示统一走 `_feedback(code)`（`FAIL_TEXT` 一张码表）。
- **远端表现分流**：`MAGIC_EFFECT` 里回潮只播水汽（`_mendFxAt`，不替别人回血），折步画起止两团尘；折步落点
  `x2/y2/z2` 是**可选字段**（`sanitizeCast` 校验三点齐全、距起点 ≤16 格、高度带内才透传，非法则整字段丢弃），
  服务器 `onMagicCast` 原样随表现转发。协议不升版本，旧端缺字段即退化为只画起点。

### 12.2 R2：焦点蓄力与失败反馈统一

- **蓄力 = 按住右键、松手施放**（与弓蓄力同构的独立通道）：`_handleFocusChannel` 排在弓通道之后；
  蓄力中 `CLICK_ABORT`（不置位 `mouseRight`），每次 `advanceCharge(dt)` 累到 `CHARGE_FULL_SECONDS=1.0`；
  松手 `releaseCharge()` → `castHeld(charge)`。**单击 = charge≈0** 走基础值，所以老手感不变。
  早退守卫要放行「手持焦点 + 右键」（`focusLikeHeld`），否则对空按右键进不到右键链。
- **蓄力只买效果、不买费用**：`spellAtCharge(def, charge)` 只在 `def.charged` 列出的字段上线性插值
  （整数基值/整数上限取整），费用与冷却永远取基础表；`p.echo -= base.cost`、冷却按 spellId 记账。
  满蓄上限：风步 6→8 格、缓降 2.5→5 秒；烬矢 6→10 伤害（弹体同步放大 1.5 倍，判定半径不变）；
  回潮 6→10 血、防护 6→10 秒；折步 8→10 格。
- **失败反馈三处同源**：`CAST_FAIL_TEXT`（defs，9 个码）→ `castFeedback(code)`（core）给出
  `{ text, hud }`，客户端只做「toast + 回响条脉冲 + 拒绝音」。脉冲分路：回响不足红、冷却白、
  目标无效/无伤可回琥珀、开关/模式类不脉冲。文案键是 `t()` 动态路径，不在 `i18n-parity` 的 master 里，
  所以 R2 套件自己导入 10 个语言包逐个断言（曾经 `target` 文案与语言包键不一致，靠这条才抓出来）。
- **作废点**：暂停（Game.loop 的 else 分支）、进入观战、UI 打开、中途换手持物都 `cancelCharge()`；
  `MagicSystem.dispose()`（换维/换档/回菜单）清蓄力与弹道。蓄力不进存档、不进协议。

### 12.3 R3：死亡 / 换维规则与四类结算分流

**生命周期表**（`src/core/Magic.js` 的 `MAGIC_LIFECYCLE`，不可变；注释与实现同源）：

| 事件 | 回响 | 冷却 | 蓄力 | 弹道 | 缓降 | 防护 |
|---|---|---|---|---|---|---|
| 死亡 | 保留 | 保留 | 清 | 清 | 清 | 清（respawn 的 clearEffects） |
| 换维 | 保留 | 保留 | 清 | 清 | 清 | 清（start 的 clearEffects） |

- 冷却属于**施法者**：换维通过 `_composeSwitchLoadData` 的**顶层** `magicCooldowns` 透传，`start()` 里
  `importCooldowns()` 恢复；`sanitizeCooldowns()` 丢弃未知法术、脏值、未来时间戳与一天前的记录。
  **坑**：这个字段必须挂在 loadData 顶层——塞进 `playerData` 时 `start()` 读不到，表现为「换维后冷却清零」
  （实测复现过；回归里有专门断言守住位置）。
- 冷却**不进存档**（`SaveSystem` 只写回响）：它是运行态，不该跨进程持久化，也不该借 reload 刷新。
- 死亡由 `Game.respawn()` 调 `magic.onPlayerDeath()`（清蓄力/弹道/缓降，**不动回响与冷却**），
  所以「跳崖换冷却」与「死亡蒸发资源」两条捷径都不成立。

**四类结算逐项分流（杜绝双结算）**：

| 类别 | 唯一结算点 | 不做什么 |
|---|---|---|
| 自我效果（回潮） | `_castTideMend` 里的 `p.health` / `p.applyEffect` | 全域名只有一处 `applyEffect`；远端回潮只播水汽 |
| 怪物伤害 | `_updateBolts` 里 `bolt.local` 分支的单次 `attackMob` | 玩家命中后不再对怪物补一刀；命中即 `bolt.dead` |
| PvP | `sendAttackPlayer(rp.id, def.damage, 'magic')` → 服务器 `onAttack` | 本端不直接改远端血量；PvP 关闭时连检测都跳过 |
| 远端视觉 | `applyRemoteEffect` → `local:false` 弹道 | 不结算伤害、不扣回响、不挂效果 |

- PvP 前提 `_canPvP()`：`networkMode && net.roomSettings.pvp !== false && 有远端玩家`（与近战同一闸门口径）；
  命中检测用 `_findRemoteByRay(origin, dir, reach)`，`reach` 已被最近的实心方块裁过 → **墙后的人打不到**。
- 服务器对 `kind:'magic'` 的攻击按 `MAGIC_PVP_DAMAGE_CAP = SPELLS.ember_bolt.charged.damage`（10）封顶，
  防止改包把法术伤害放大；近战消息不带 `kind`，沿用原有轻信任口径（行为不变）。

### 12.4 R4：四系生存实玩与收尾（Build 54 发布）

- **实玩口径**：`gamemode=survival`，材料与经验按探索所得用控制台补齐一次，之后**全程生存规则**——
  合成走真实 3×3 网格（`inventoryScreen.getCurrentRecipeMatch` + 输出槽 handler 扣料），放置走真实右键，
  调谐走真实右键盘（仪表台 `magicKind:'table'` 分支），施法走真实通道。
  实测：1 星髓 → 2 回响尘 ×3、仪台 1、四支焦点各 1（`gale/ember/rain/tideless`）；仪台放置后物品清零；
  调谐 4 次 25→51→76→100（等级 12→8）；风步（半蓄）x 0.5→−6.5、缓降 3.75、回响 −15；
  回潮 8→14 血 + 防护 I 6 秒、回响 −20（冷却内再按被拒）；折步 8 格、回响 −25；
  烬矢满蓄对僵尸**精确 10 点**（含 0.58 的白天燃烧）。
- **实玩抓到的真 bug（已修）**：`_updateBolts` 原本按 `spellDef(bolt.spell)` 回表读伤害，**蓄力插值出的伤害
  被基础值覆盖**（满蓄烬矢实际只打 6）。修法：伤害在**发射时钉在弹体上**（`bolt.damage`），
  推进阶段统一走新纯函数 `boltDamage(bolt, def)`（弹体值优先、脏值回落基础值），PvP 与怪物两条路
  共用同一个 `dmg`。回归补 `boltDamage` 真值表 + 「只有一处取伤害」的绊线。
  教训：**只测定义表的插值不算测通过**——效果链路上任何"回表"都可能把插值结果丢掉。
- **文档**：README 魔法章节改写为四系表（材料、蓄力、反馈与边界），已知限制改为四系齐备 + 死亡/换维规则 +
  联机 PvP 口径；worldview §10.7 补 B54 交付与「四潮术语沿用既有身份层」。`src/version.js` BUILD=54。

### 12.5 回归

| 套件 | 守什么 |
|---|---|
| `tests/build54-four-tides.mjs` | 144/145 ID 钉值、11 语名字、创造分类、魔法配方只认 magic 且不含工业件、四支法术真值表、`planMend` 不溢出/满血拒绝/脏值、`resolveBlinkTarget` 最远可站立点与不越墙不落未加载、落点形状校验、失败不扣回响与折步安全检查的源码绊线 |
| `tests/build54-charge-feedback.mjs` | 蓄力插值（0→上限/中点取整/脏值钳制/费用冷却不涨/不污染定义表）、四系都有蓄力收益且不破硬上限、9 个失败码都有文案与 HUD 脉冲分路、10 个语言包逐个覆盖反馈文案、蓄力通道与暂停作废/弹体只缩放视觉的源码绊线 |
| `tests/build54-lifecycle-split.mjs` | 生命周期表（死亡/换维都留回响与冷却、清蓄力弹道缓降防护）、冷却清洗、自我效果只作用本人、怪物伤害单点一次、PvP 走既有闸门且墙后不打、远端只表现、换维冷却挂在 loadData 顶层的绊线 |
| `tests/build54-charge-feedback.mjs` ④ | `boltDamage` 真值表：发光弹体自带的蓄力伤害优先、脏值回落基础值、PvP 与怪物共用同一个 dmg、全域只有一处取伤害 |
| `server/test-magic.mjs` | 回潮/折步表现广播、折步落点透传、越界落点被清洗（冷却 6s 必须等满才发第二次）；⑤ 魔法 PvP 伤害走既有闸门并按烬矢满蓄封顶、近战不受影响 |

手动闭环（浏览器实测）：`rain_focus` 施放 hp 9→15、回响 100→80、`resistance` I 6s；满血施放 hp/回响不变、
冷却仍为 0；`tideless_focus` 平地折跃 8 格（回响 -25）、有墙时停在墙前 3 格；无立足点时原地不动且回响不扣。

## 十三、B55 回响探索（四维遗迹 / 回响残片 / 四潮进阶 / 碑文与蓝图）

### 13.1 R1：四维回响遗迹（`src/world/structures/echoRuins.js`）

- **四类各占一维**（`dims` 与 `salt` 都在 def 里，互不共流）：

| 类型 | 维度 | cell / chance | 环境语言 | 战利品表 |
|---|---|---|---|---|
| `echo_rain` 雨痕水龛 | overworld | 15 / 0.7 | 砖龛 + 3×3 水盆（恰好 9 格水）+ 黏土镶边 + 悬着的海晶灯 | `echo_rain` |
| `echo_ember` 烬痕炉龛 | nether | 24 / 0.18 | 3×3 岩浆块炉心 + 灵魂沙灰坑 + 黑曜石柱顶荧石 | `echo_ember` |
| `echo_gale` 风纹哨台 | aether | 14 / 0.75 | 7×7 白石台（四边缺口）+ 星髓芯 + 云絮 | `echo_gale` |
| `echo_tideless` 无潮静台 | end | 16 / 0.5 | 末地砖外环 + 1 格空槽 + 紫珀内台 + 黑曜石矮柱 | `echo_tideless` |

- 全部 `requiresExtras: ['magic']`：关闭魔法的世界一类都不激活，旧结构随机流逐字节不变。
- **碑位与碑**：`meta.plinth` 是龛位，R3 起落四格碑；`meta.chests` 一条，表名即类型名。
- **红线**：布局里没有任何可运行方块（工业/魔法方块 0 个）；只有雨痕水龛有流体且限定水盆 9 格
  （水盆四面黏土/砖、上方留空 → 不扩散）；三类不放任何会流动的东西。
- **回响残片**（`echo_shard`，ID 146，stack 16）：四张表各 `FORCED` 1 枚，且**没有任何合成配方**——
  进阶材料只能靠探索，不设概率刷取。

### 13.2 R2：四潮进阶（数据表 + handler 复用，`content/magic/defs.js`）

- 进阶法术放**独立表** `ADVANCED_SPELLS`，`SPELLS` / `SPELL_IDS` 仍是四支基础——
  既有断言（`SPELL_IDS.length === 4`）与 UI 迭代面零改动；`spellDef` / 冷却清洗 / 服务器形状校验走 `ALL_SPELLS`。
- 每支进阶带 `handler: '基础法术'`，`MagicSystem._execute` 按 `switch (def.handler || spellId)` 分派：
  **落点探针 / 治疗裁剪 / 折跃判定只有一份实现**，进阶只换数据。
- 四支的差异：

| 进阶 | 相对基础 | 安全口径 |
|---|---|---|
| 风渡 `gale_cross` | 10 格（满蓄 13）、缓降 8s、下落上限 −1.5（基础 −3） | 仍是短距冲刺，落点探针不变 |
| 烬环 `ember_ring` | 直击 12（满蓄 15）、`splash{radius 3.2, damage 5, maxTargets 2}` | 溅射只走 `damageMobsNear`（怪物专用） |
| 潮护 `tide_ward` | 治疗 10、抗性 II 10s、`cleanse:['wither']` | 只清负面白名单，不动 buff |
| 长折 `void_dash` | 14 格（满蓄 18）、`standDepth 5`、`softLanding 1.5` | 仍不跨维/不穿墙/不落未加载区块 |

- 费用/冷却都高于基础（22/20/30/35 vs 15/10/20/25；8/3/12/9 vs 3/1.2/8/6）——基础版不被取代。
- **配方**：`addShapeless(进阶焦点, 1, ['echo_shard', 基础焦点], ['magic'])`；一枚残片只能刻一支。
- **缓降上限**：`slowFallVy` 此前是死字段（Physics 一直用常量 −3），R2 改成 `entity.slowFallVy` 优先、
  缺省回落 `SLOW_FALL_MAX`；死亡 / 换维 / 换存档都清零（`MAGIC_LIFECYCLE.clearSlowFall` 的实际落点）。
- **广播**统一用 `def.id`（不再写死基础 ID），服务器 `sanitizeCast` 直接接受进阶 ID；
  折步落点跨度上限 16 → **22**（满蓄长折 18 格），仍拒伪造的 40 格落点。
- **音色**：`AudioEngine` 的 `SPELL_SOUND_FAMILY` 把四支进阶映射回本潮音色。

### 13.3 R3：回响碑 / 游记 / 形制蓝图

- 四章追加在 `STELE_CHAPTERS` **表尾**（键序不变、旧章一字不改、不触碰 `finaleDone`）：
  `echo_rain` / `echo_ember` / `echo_gale` / `echo_tideless`，各 3 行，十语齐备。
- 龛位落四格碑（`steleStack`，底座用该维度 `STELE_BASE_BY_DIM`）：`meta.steles ↔ 方块 ↔ sm.steles ↔ steleChapterAt`
  四向一致；碑与箱子不同列（回归守着）。
- **形制蓝图**：`core/Blueprints.blueprintFromBlocks({id, name, dim, blocks})` 把结构记录转成合法蓝图
  （同坐标后写覆盖；包围盒只按非空气格取；体素顺序与 `captureBlueprint` 同款 y→z→x）。
  读到回响碑时 `Game.grantEchoSteleBlueprint` 发一张个人蓝图（`ECHO_RUIN_BLUEPRINTS` 的 id：
  `echorain01` / `echoember1` / `echogale01` / `echotidel1`），`addPersonalUnique` 按 id 去重；
  只有站在**对应类型**遗迹的碑前才发图（`hit.name !== def.structure` 直接拒）。
- **游记**：新增「回响遗迹」段（四潮各一处，已记录/未记录）；发现仍走既有 `structureRecordAt → recordDiscovery`，
  **零新协议、零新存档字段**（`journal.discoveries` 里按 `type = echo_*` 过滤）。
- 既有 6 处碑文章节计数断言同步（主世界 5 / 下界 5 / 天域 12 / 末地 3）。

### 13.4 R4：四界实玩 / 经济复评 / 文档与发布

**实玩（survival，真实路径）**
- 主世界：读 `moss_stele` → 章节「回响碑·雨停在半空」+ 蓝图 `echorain01` 入库；真实 3×3 网格
  `echo_shard + rain_focus → tide_ward_focus`（材料清零、产出进光标）；潮护 10 血 + 凋零 → 20 血、凋零消失、
  抗性 II 10s、回响 100→70。
- **风渡**：位移 10 格、`slowFall 8`、`slowFallVy −1.5`、回响 −22（与数据表一致）。
- **长折**：自建 89 层石台后位移**精确 14 格**、回响 −35、`slowFall 1.5`；在自然地形上只走 5.5 格——
  **停在最后一个可立足点**（安全口径正确，不是 bug）。
- **烬环**：直击僵尸 12 点、2.5 格外的第二只 5 点、12 格外的不受影响、回响 −20。
- 换维（`switchDimension`）到 下界/末地/天域 各读一次碑：`ember_stele` / `end_stele` / `wind_stele`，
  章节与蓝图 id 全部正确；**个人蓝图与已读碑文随换维保留**（`_composeSwitchLoadData` 的 `blueprints`）。
- 游记「回响遗迹」段在四维都能渲染出四个条目。

**实玩抓到的真 bug（已修）**：烬环溅射把**直击目标**又打了一次——僵尸 20 → 3（应为 8）。
根因：`damageMobsNear` 只按半径挑「活的」目标，直击那只没死就被也算进溅射。
修法：`attackMob` 命中时记 `this.lastHitMob`（未命中清空），`_splashHit` 把它作为 `exclude` 传进去并即时清空。
回归补四条源码绊线（记录 / 清空 / 读取 / 真的传参）。复测：20 → 8（直击）/ 15（溅射）/ 20（范围外）。

**经济复评（实测密度 → 调参）**：16×16 个 cell 的建设窗口内计数（seed 5501/777）：

| 类型 | 调参前 | 调参后 | 结论 |
|---|---|---|---|
| 雨痕水龛 | 2~4 | 20~21（cell 16→15、chance 0.45→0.7、探针 [7,11]→[6,10]、坡度 4→5） | 原先要走两三千格才撞见第一座 |
| 烬痕炉龛 | **136~138** | 27（cell 18→24、chance 0.5→0.18、要求 4/5 列同层） | 原先每 400 格一座，明显过量 |
| 风纹哨台 | 3~7 | 7~10（chance 0.5→0.75） | 天域浮岛本身稀疏，靠概率补 |
| 无潮静台 | 19~25 | 19~25（未动） | 与其他三维同量级 |

据此估算：每类约 **每 800~1600 格一处**，四座遗迹 = 四枚残片 = 四支进阶；费用 20~35 点回响
≈ 1~1.4 级经验，一次性投入不会长期锁死资源。

**文档**：README 魔法章节新增「回响遗迹与进阶」小节（四类遗迹、残片、四支进阶对照表、蓝图与游记），
已知限制补进阶边界（溅射只打怪物、PvP 仍封顶、长折仍要立足面）；worldview §10.7 补 B55 交付与「回响纪」；
`src/version.js` BUILD=55，发布 `beta-build-55`。

### 13.5 回归

| 套件 | 守什么 |
|---|---|
| `tests/build55-echo-ruins.mjs` | 四类 cell/salt/dims/requiresExtras、关魔法零生成、维度隔离、标志材质、水盆恰好 9 格、碑位四格、箱子三向一致、**记录真的写进真实区块**、四表确定性、残片 FORCED 且无配方、旧结构随机流不变、残片 ID 146 与十语 lore |
| `tests/build55-advanced-tides.mjs` | 四支 handler 复用、费用冷却均高于基础、蓄力只插值 `charged`、ID 147~150、十语 lore 与潮护提示、落点上限 22、冷却清洗认进阶、溅射真值表（最近优先/越界剔除/dead 跳过/并列按 id）、**唯一玩家伤害入口**、溅射排除直击目标四条绊线 |
| `tests/build55-echo-narrative.mjs` | 四章在表尾且旧章不动、十语 16 键（含 `{name}` 占位符）、四格碑四向一致、`blueprintFromBlocks` 合法/确定/体素对拍/非法输入、读碑记图接线、游记「回响遗迹」段 |
| `server/test-magic.mjs` | 服务器接受进阶法术 ID、越界落点（500 格）仍被清洗、PvP 封顶仍按基础烬矢满蓄 |
| 既有套件 | `magic-unit` / `build54-*` 的计数与字面量断言随「进阶独立表 + `def.id` 广播」同步；碑文计数四处同步 |
