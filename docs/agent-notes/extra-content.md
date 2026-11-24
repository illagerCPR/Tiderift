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
