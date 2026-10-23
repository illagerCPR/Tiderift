# Tiderift Beta Build 35–37 · New Horizon Part.2–4 实施计划

> 2026-10-23 制定。来源：`docs/TODO.md` 的 `Idea-WV1-New-Horizon` 候选 D/E/F/G（A/B/C 已随 Build 34 交付，见 `docs/new-horizon-plan-b34.md`）。
> 结论：**D–G 分 3 个 Build（35 / 36 / 37）、5 个开发里程碑**（E → D → F-1 → F-2 → G）。每个里程碑一次签名提交 + 一次 push + 等 CI 绿；版本只在每个 Build 最后一个里程碑的提交内递增并发布。

## 一、为什么是 3 个 Build

判据（按权重排序）：

1. **权威面**：该项是否新增"谁来模拟"的架构面（客户端自模拟 / 房间账本 / 服务器固定节拍）。
2. **世界数据**：是否改动既有世界数据或生成随机流（结构选址、地形、水位）。
3. **闭环可验证性**：能否用一次浏览器流程 + 一组聚焦用例独立验收。
4. **失败隔离**：该项延期或回归时，会不会拖累其它项的发布。

| Build | 里程碑（实施顺序） | 权威面 | 新增全局面 | 判定 |
|---|---|---|---|---|
| 35 | E 建筑蓝图与材料清单 | 客户端 UI + 轻量房间账本（照抄 `race_*`） | 无 | 与 D 同 Build |
| 35 | D 可动手解开的遗迹 | 客户端判定 + 房间一次性领取 | 3 个新结构类型 | 产物依赖 E，必须排在 E 之后 |
| 36 | F-1 漏斗与容器搬运 | **服务器固定节拍权威（全新）** | 新方块 + 新 sweep + 新配置 | 必须独占 Build |
| 36 | F-2 熔炉进出料与生产链 | 同上 + 熔炉内容首次上账本 | 熔炉同步协议 | 必须独占 Build |
| 37 | G 局部潮候与稀有景象 | 时间权威（已有）+ 个人记录 | 无（红线：不改地形与水位） | 独立 Build |

- **F 必须独占 Build 36**：它引入本项目从未有过的"服务器持续模拟物品流"——现有 `container_set` 是「客户端改 → 服务器广播」，漏斗是「服务器改 → 广播」，两条路径要在一个房间里共存且不打架；同时熔炉内容至今**完全不在联机账本里**（`server/protocol.js` 无熔炉条目，`SaveSystem` 的 `dimensionFurnaces` 只服务单机）。把它和探索内容绑进同一个 Release，任何回归都会同时拖累两类内容。
- **D 与 E 同 Build 35，且 E 先做**：D 的完整解法奖励要发一张 E 的蓝图，闭环是「探测遗迹 → 动手解开 → 拿到蓝图 → 回家照着建」。先落地 E 的数据模型与预览 UI，D 的奖励在同一个 Build 内能直接复用，不必二次返工。
- **不为 4 个 Build**：D、E 各占一个发布，会把上面那条闭环劈成两个 Build，"拿到蓝图"在第一个 Build 里没有用途。
- **不为 2 个 Build**：把 F 塞进任何一个 Build，都会让该 Release 的最高风险与最低风险内容共用一个版本号与一份发布说明。
- **G 放最后**：它只做"看得见 + 记得到"，不新增协议与账本，适合作为 Part.4 收尾；同时它最早依赖 A 的游记记录能力（已交付），先让 D/E/F 把世界内容与工程补完，气氛层最后加。

## 二、交付节奏

| Build | 里程碑 | 提交与推送 | 版本与发布 |
|---|---|---|---|
| 35 | E 建筑蓝图与材料清单 | 独立提交 + push，CI 绿后停下 | 保持 Build 34 |
| 35 | D 可动手解开的遗迹 | 独立提交 + push，CI 绿后交付 Part.2 | 在 D 提交内 `BUILD` → 35，发布 `beta-build-35` |
| 36 | F-1 漏斗与容器搬运 | 独立提交 + push，CI 绿后停下 | 保持 Build 35 |
| 36 | F-2 熔炉进出料与生产链 | 独立提交 + push，CI 绿后交付 Part.3 | 在 F-2 提交内 `BUILD` → 36，发布 `beta-build-36` |
| 37 | G 局部潮候与稀有景象 | 独立提交 + push，CI 绿后交付 Part.4 | 在 G 提交内 `BUILD` → 37，发布 `beta-build-37` |

规则沿用 `docs/new-horizon-plan-b34.md` §一：不合并不提前升版；CI 失败先修复再重新评估提交边界，失败提交不算交付；每轮验收、推送、CI 完成后停下；计划文件与 `docs/TODO.md` 的状态更新并入该 Build 的首个提交；执行前先核对远端 Build 号与分支状态，不据记忆推断。

三个 Build 均为**计划内 Release**，按 `AGENTS.md`「发布授权」在 CI 全绿后直接 `git tag -s` + push tag + `gh release create`，无需逐次再确认。

## 三、已确认的接入点与共同约束

- **结构登记**：`src/world/structures/catalog.js` 尾部 `registerStructureType`；新 def 自带 `dims`。不得改动既有类型的选址随机流与几何——旧存档/旧房间里的村庄、要塞、天域塔位置不得漂移。
- **机关动作复用既有系统**：`FluidSim`（可流动水）、`RedstoneSystem`（红石信号）、活塞与 `World.setBlock`。**任何方块写入口必须走 `World.setBlock`**，否则网格与光照不更新。
- **房间权威账本**：`server/room.js` 的 `races`/`waymarks` 是现成模板（`onXxxSave` + payload + `_purge` + `allowXxxWrite` 限速桶）；`server/store.js` 的 `roomSnapshot`/`isRoomSnapshot` 必须同步扩展，恢复路径要能识别缺字段的旧快照。
- **容器账本**：`World.containers`/`World.furnaces` 是**维度分桶 Map**（`World.dimBucket`）；容器改动经 `_sendContainerSet` → `MSG.CONTAINER_SET`（带 `by` 防回环、带 `d` 维度）。**熔炉内容目前不联机**（只有点燃态经方块同步），F-2 的核心工作量就在这里。
- **服务器节拍**：`server/index.mjs` 已有 `dropSweep`(10s) / `worldFlushSweep`(1s) / `profileSweep` / `backupSweep`(60s)；F 的漏斗 tick 按同样方式新增 sweep，并随进程退出清理。
- **界面与键位**：已占用 `E` 背包 / `C` 创造 / `Q` 丢弃 / `J` / `N` 游记 / `G` 赛道 / `R``U``A` 合成查询 / `T` 聊天 / `Esc` / `F5``F6`；`KeyB` 目前未占用，E 的蓝图屏用它。新 UI 必须维护 `controls.enabled`、进 `_anyInputBlockingUI()`，并在 `start()`/`_disposeWorld()` 里成对创建与释放。
- **i18n**：10 个 locale 包（`src/i18n/locales/`：zh-TW/en/fr/de/ja/ko/ar/ru/es/pt，zh-CN 用源文）；键即中文原文；新文本必须 10 包齐全，`tests/i18n-parity.mjs` 会拦住漏项。
- **方块与物品**：只能追加在 `BlockDefs.js`/`ItemDefs.js` **尾部**（ID 由注册顺序决定，中部插入会让旧存档方块错位；`race_post` 是当前末尾）；多面方块必须显式传 `textures`，图标一律走 `src/render/BlockIcon.js` 的 `drawIconInto`。
- **存档兼容**：`SaveSystem` 新字段一律缺省回落（旧档无字段 → 空）；不改 `localStorage` 前缀；联机档案同理。
- **性能预算**：每帧最多重建 2 个脏区块网格；新 UI/预览不得造成单帧尖峰；材质与几何走共享实例，禁止每个对象新建材质。

## 四、Build 35 · E 建筑蓝图与材料清单

**玩家流程**：框选自己建好的一块区域 → 命名保存为蓝图 → 到新地点打开蓝图 → 世界内幽灵线框预览（可旋转、可升降）→ 对照材料清单补齐缺料 → 一块块手动建造。联机时把蓝图分享到房间，朋友各自看轮廓、各自运料。

1. **数据模型**（`src/core/Blueprints.js`，纯模块，可 node 测）：`{ id, name, dim, rev, byId, size:{x,y,z}, palette:[blockId], data:<RLE 串> }`；键沿用 `id#rev#byId`（个人记录 `byId=''`）。上限：边长 ≤ 32、体积 ≤ 32768 格、压缩串 ≤ 16 KB、名称 ≤ 24 字、每存档/每房间 ≤ 24 张。
2. **捕获规则**：两次点选（准星命中的方块），各自距玩家 ≤ 32 格，展成包围盒；**只读取已加载区块**，未加载格视为未知并拒绝保存——不能把未加载区读成空气，否则蓝图会记成空洞房。捕获不改世界。
3. **预览**：新增 `src/render/GhostPreview.js`（共享 geometry/material，实例数超阈值降级为包围盒 + 分区提示）；不写世界、不生成区块、不触发光照重算；关闭、换维、重开即 dispose。
4. **材料清单**：按 palette 统计非空气块 → 扣除背包（`inventory.slots`）→ 按 `ItemCategories`/`BlockIcon.drawIconInto` 列出「需求 / 持有 / 缺失」三列，点条目走 `RecipeViewer` 查配方。首版**不统计容器与掉落物**（联机时容器内容异步到达，统计会抖动）。
5. **联机**：`BLUEPRINT_SAVE`/`BLUEPRINT_DELETE` + `BLUEPRINTS`/`BLUEPRINT_UPDATE`/`BLUEPRINT_REMOVED`/`BLUEPRINT_DENY`（照抄 `race_*` 结构）；服务器重算 `dim`/`byId`/`rev` 并清洗尺寸与体积；创建者或 `isOperator` 可删改，编辑升修订号；限速桶照 `races` 的 20/+10 每分钟。
6. **生命周期**：`SaveSystem` 增 `blueprints` 字段（旧档缺 → 空）；`Game._disposeWorld()` 释放界面与预览资源；`start()` 里重置并按 `flushPendingRaces` 的时序补 `flushPendingBlueprints()`（这条时序坑在 C 里已经踩过一次）。

**E 验收**：单机两次框选 → 保存 → `F6` 读档后列表与内容不变；预览可旋转升降，关闭后 scene 中无残留对象；缺料统计与手工摆放对照一致；联机 A 保存后 B 立即看到、编辑后旧修订号不冒充新蓝图、服务端重启后仍在；服务端对超限尺寸/体积/名称/跨维输入全部拒绝；新增 `tests/blueprint-unit.mjs` 与 `server/test-blueprint.mjs` 接入 `server/run-all-tests.sh`。

## 五、Build 35 · D 可动手解开的遗迹

**玩家流程**：从游记看到已发现的遗迹 → 进入机关房 → 从建筑痕迹读出解法 → 动手调水路 / 接红石 / 拼构件 → 内室开启 → 领取纪念物与蓝图 → 游记标记为「已解开」。

1. **结构身份**：三种机关房登记在 `catalog.js` 尾部，def 自带 `dims`：潮闸房（`overworld`）、烬火回路房（`nether`）、构件架房（`aether`）。键 = 维度 + 类型 + 确定性锚点（与 B 的塔键同构）；末地首版不加机关房。
2. **三种机关（各一种）**：潮闸房用可流动水把水位引到标线格（读 `FluidSim` 的 fluid id + level）；烬火回路房接好红石线路让四盏灯全亮（读 `RedstoneSystem` 信号）；构件架房按序用活塞推出/收回或用指定材料填满三个凹槽（读槽位方块 id）。
3. **判定模块**（`src/core/Ruins.js`，纯模块）：每处机关持有「格坐标 + 期望状态」定义与 `locked → solved` 状态机；轮询节拍 0.25s（不每帧读世界）；解法触发的一次性方块变化（开门/降梯）走 `World.setBlock`。
4. **绕过与失效**：允许挖掘绕过（不做硬门禁），但只有完整解法给纪念奖励；关键件被挖毁时用 `world.modifiedBlocks` 账本判定（照 `_raceTrackValidity` 的做法，**不要**用 `getBlock`——未加载区块返回 0 会误判为缺失），返回 `{ok:false,badIndex}` 并在界面提示缺件。
5. **奖励与联机**：纪念奖励 = 装饰方块 + 铭牌 + **一张 E 蓝图**；「已解开」与领取按房间账本去重（`RUIN_STATE`/`RUIN_CLAIM`，照抄 `waymark_*`），op 可重置；新玩家入房、重连与服务器重启后状态一致，两人同时解开不重复发奖。
6. **游记接线**：解开后写 `journal.recordDiscovery(dim, 'ruin_<kind>', …)`，游记里显示「已解开」——复用 A 的发现记录，不新增第二套地图数据。

**D 验收**：同种子双端识别同一机关房；三种机关在单机各走一次完整解法；乱序、半解、挖毁都有明确提示；联机两人同时操作不重复发奖；重启与重连后状态一致；新增 `tests/ruin-unit.mjs` 与 `server/test-ruin.mjs` 接入跑批。

## 六、Build 36 · F 仓储与运输工程

### F-1 漏斗与容器搬运

1. **方块**：`hopper` 追加在 `BlockDefs.js` 尾部（`race_post` 之后），六向朝向用 `textures:{top,side,bottom}` + `facing`；配方照 `race_post` 的风格进 `Crafting.js`。
2. **权威面（本 Build 的核心）**：搬运由**服务器**决定——`server/index.mjs` 新增 `flowSweep = setInterval(…, 200)` 逐房间推进；客户端只播「物品飞出」动画，**不得本地转移**，否则与 `CONTAINER_SET` 回环打架。漏斗内容仍存 `World.containers`（维度分桶），服务器以 `by:0` + `d` 下发。
3. **节流与边界**：每 tick 每漏斗最多移动一堆；每房间漏斗 ≤ 64，超出拒绝放置并提示；自动产生的 `CONTAINER_SET` 按容器合并（每 tick 每容器最多一条）；新增配置 `flowEnabled`（默认开）与 `flowIntervalMs`；玩家手动写容器仍走现有 `container` 限速档。
4. **两条同步路径共存**：现有 `container_set` 是「客户端改 → 服务器广播」，漏斗是「服务器改 → 广播」。`Room.onContainerSet` 必须区分来源：客户端改写正被漏斗管理的容器要拒绝并回滚（照 `drop_deny` 的做法）。这是 F-1 最需要聚焦用例覆盖的点。
5. **视觉**：漏斗方块模型、物品飞出的小方块粒子、内容界面复用 `ChestScreen`。

**F-1 验收**：单机漏斗从箱子搬到箱子；朝向错误不搬运；满/空/不可堆叠/上限边界正确；联机两端内容一致且无重复搬运；64 个漏斗在 200ms tick 下不造成帧或 CPU 尖峰；客户端篡改被拒并回滚；新增 `tests/hopper-unit.mjs` 与 `server/test-flow.mjs` 接入跑批。

### F-2 熔炉进出料与生产链

1. **熔炉内容上账本**：新增 `FURNACE_SET`（或给 `CONTAINER_SET` 加 `kind:'furnace'`），服务器保存输入/燃料/输出/进度；`roomSnapshot` 与恢复路径同步扩展，旧快照缺字段回落为空。
2. **漏斗接线**：上方漏斗进料（燃料槽优先），侧向/下方漏斗出料；熔炉推进仍由 `Smelting.js` 的时间逻辑算，但**进度归服务器**，客户端只显示，否则两端产物数不一致。
3. **最小生产链**：矿场 → 漏斗 → 熔炉 → 漏斗 → 仓库。分类器与矿车运输明确留作后续（见 `docs/TODO.md` F 行首版范围）。
4. **清理**：熔炉被挖毁或改向时清账本，避免幽灵槽位。

**F-2 验收**：单机与联机熔炉产出数一致；两人同时开同一熔炉不双倍产出；服务端重启后进度与产物保留；挖掉熔炉后账本清理；`npm test` 全绿（含既有 `test-store` / `test-mp`）。

## 七、Build 37 · G 局部潮候与稀有景象

1. **四种现象**（每维一种，首版只做「看得见 + 记得到」）：主世界「岸线荧光」（夜间海岸荧光带，随潮汐周期重现）、下界「灰烬潮」（周期飘灰 + 岩浆湖泛光）、末地「无声之潮」（虚空边缘的静默光带）、天域「风光带」（云海流光，沿气流走向）。
2. **预兆**：现象开始前 60 秒有明确预兆（天色、风向、音频，并在游记里提示），不允许突然出现。
3. **观测记录**：站在可见范围内持续 N 秒才计数，写入 `Journal` 新增的 `phenomena` 桶（`recordPhenomenon(dim, kind, anchorKey)`）；四种集齐给一次性纪念（装饰方块或铭牌，纹理尾部追加）。
4. **时间权威**：联机沿用现有服务器时间权威，各端同时看见；现象由种子 + 时间确定性推导，不新增账本、不新增协议。
5. **红线**：不改变地形、水位、方块与既有生成随机流；粒子池复用、按距离与可见性节流、离开即回收；新材质共享实例，不写光照数组。

**G 验收**：四维各触发一次现象并成功记录；未观测不计；集齐四种只发一次纪念；联机两端同时看到且预兆同步；开关现象不造成帧尖峰与资源残留；重启后记录保留；新增 `tests/phenomena-unit.mjs` 接入跑批。

## 八、每轮验收与收尾

1. 实施前先记录该轮旧行为与设计中的数据格式，再改代码。新增自动化用例只覆盖真实风险，按需接入唯一 runner；改动的每个 JS/MJS 都要 `node --check`。
2. 跑对应聚焦用例、`npm run build`、`npm test`（`bash server/run-all-tests.sh`，跑前确认 3001 空闲）；用 agent-browser 实际手测 UI、指针锁移动与联机流程，记录种子、房间与维度；测试用一次性房间，结束后按既有跑批清理流程收尾。
3. 记录数据兼容、性能与未覆盖边界，更新 `docs/TODO.md` 与相应 `docs/agent-notes/`，再做该轮唯一一次提交与推送，等 CI 绿并核对远端提交哈希。
4. 每个 Build 的最后一轮核对 `src/version.js` 的 `BUILD` 数值 = 目标 Build 号，tag 指向已绿的该里程碑提交，发布说明覆盖本 Build 的全部里程碑。

## 九、本次规划记录的假设

用户已授权由我决定拆分数量与顺序（2026-10-23），以下口径按此执行；如需调整请提出，未提出即视为接受。

1. Build 35 内先做 E 再做 D（奖励依赖蓝图的产物），版本在 D 的提交内升到 35。
2. D 的三种机关房分布在主世界 / 下界 / 天域，末地首版不加机关房。
3. D 允许挖掘绕过，不设硬门禁，只有完整解法给纪念奖励。
4. E 首版上限：边长 32、体积 32768 格、压缩串 16 KB、每房 24 张；材料清单只统计背包。
5. E 不做自动建造与自动放置，只做幽灵预览 + 缺料清单。
6. F 首版不做矿车与分类器；漏斗由服务器 tick 权威，客户端只播动画。
7. F-2 把熔炉内容纳入联机账本（此前只有点燃态经方块同步）。
8. G 不改地形、水位与既有生成随机流；若将来要动水位，另立提案单独评审。
