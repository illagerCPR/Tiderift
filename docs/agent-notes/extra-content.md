# extra-content.md — B51 额外内容（工业 / 魔法）防回退备忘

> 覆盖 `docs/extra-content-master-plan.md` 的 Build 51–56 实现。改 `src/content/ExtraContent.js`、
> 注册表的 `requiresExtras`、`Crafting/Smelting` 归属过滤、`StructureManager.typeActive`、
> 创造栏/配方查询的归属闸口前**必读**。
> 分轮交付；本文按轮追加，当前：**B51 R1（基石）**。

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

## 六、术语与命名纪律

- 代码 ID（`industry` / `magic`，方块/物品名、协议字段）一经落地不随显示名变动；显示名走 i18n 键
  （`EXTRA_LABEL_KEYS`，界面主模块名始终是用户指定的「工业 / 魔法」）。
- 候选叙事术语（潮工 / 潮压 / 回响 / 回响焦点）在 R3/R4 落地前先登记，不边写边改。
