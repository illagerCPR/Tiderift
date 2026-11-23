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
