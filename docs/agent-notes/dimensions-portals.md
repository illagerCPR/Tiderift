# Agent 备忘 · 维度与传送门

> 本文件内容为 AGENTS.md 批次备忘**原文搬移（未改写）**，用于控制 AGENTS.md 体积（会话注入预算 65536 字节，超限会被静默截断）。
> 导航见 AGENTS.md「批次备忘索引」；新批次备忘按主题追加到对应小节，并同步更新 AGENTS.md 索引表。

### 维度批次备忘（防回退）—— 维度基建/下界/末地/天域/联机同步（M1-M4 全部交付）

- **维度注册表 `src/core/dimensions.js`**：新增维度 = 加注册表项（生成器必须纯函数 of (seed, 坐标)）；`implemented:false` 不可达（面板不展示 / switchDimension 拒绝 / 服务器 safeDim 回退）。天空/光照/雾/出生点全走档案，勿在 Sky/LightEngine 里硬编码维度分支。
- **World 维度化**：`new World(seed, dimension)`；`modifiedBlocks`/`containers` 是"当前维度"桶的指针（全量在 `dimensionBlocks`/`dimensionContainers` 分桶），换维 = 整体重建 World（`switchDimension` 合成 loadData 重走 `start()`），指针永不跨维换绑。存档 V2：`dimension` + `dimensionBlocks/dimensionContainers`；`SaveSystem.load` 把 V1 平铺字段迁移进主世界桶（内存升级不回写）。
- **联机维度协议（M4）**：`switch_dimension`(C2S)/`player_dimension`(S2C 广播含自己，自己忽略)/`dimension_world`(S2C 目标维权威账本+同维掉落回放+同维玩家 join 回放)。服务器 `Room.dimensionBlocks/dimensionContainers` 分桶、drop 记录带 `dim`；`broadcastDim` 按维度过滤方块/容器/掉落/怪/红石/player_state/player_full；store 快照 `{dim: [entries]}`（旧平铺格式 restore 迁移）。客户端 `net.dim`+`_remoteDims` 表：异维玩家不建实体（player_dimension 异维 remove/同维重建）；BLOCK_CHANGE/DROP/MOB/CONTAINER 消息带 `d` 字段客户端二次防线。
- **`/dim <名>` 聊天命令**（index.mjs handleCommand）：联机换维统一入口（MP 无作弊面板）；`Game.switchDimension` 联机分支乐观发请求、`applyDimensionWorld(dim, blocks, containers)`（main.js 挂 dimension_world 事件）落地重建。
- **维度重建串行链（曾真出竞态）**：`Game._dimSwitchJob` promise 链——start() 不可重入，连续换维并发执行会互相覆盖共享子系统（表现为"切过去又弹回旧维度"）；switchDimension 单机与 applyDimensionWorld 全走 `_enqueueDimensionSwitch`。同维重复 dimension_world（重连）走账本覆盖+markAllDirty，不重建世界。
- **start() 网络钩子绑定时机（曾真出）**：`net.bindWorld(this.world)` 必须在 `new World` 后立即执行——start 的异步加载窗口（图集/区块/换维等待）内本地放方块也要上报；绑定过晚会静默丢失窗口内的方块改动（联机账本不收敛）。
- **无天光维度（下界）光照不变量**：LightEngine `!hasSkylight` → 整块填恒定环境天光 `ambientSky`（下界=5）+ **方块光源必须独立播种**（曾因光源播种随列循环被包进天光分支导致下界全黑——`_lt` 光源 LUT 独立扫描，勿回退）；`onBlockChanged` 天光通道整体跳过；`World.getSkyLight` 未加载兜底 = ambientSky（与 `_skyFallback` 同源）。浏览器冒烟必须断言 `getBlockLightAt(光源格)==15`——确定性测试不跑 LightEngine，此 bug 只有冒烟能抓到（已真出过）。
- **下界生成器（`dimensions/nether.js`）**：y0/y255 基岩 + 2 格保护壳；三通道 3D 噪声场（世界对齐 4 格网格 + 三线性插值，W3 同款）；空腔 = 奶酪 c>0.46 或意面 a²+b²<0.010；y≤31 熔岩海；表面斑块（上方露天+下方空腔/岩浆）= soul_sand>0.30 / gravel<-0.42 / 熔岩缘 6 格内 6% 黑曜石（per-block hash3）；荧石挂顶（上方实心 netherrack + 3D 噪声>0.52）。密度锚点：air 14-17%、荧石 ~100/区块。改阈值先跑 9×9 漏斗统计。
- **末地生成器（`dimensions/end.js`）**：透镜形主岛（r~60、顶 64±3、厚 (1-t²)×22+2），边缘半径用 (cos,sin) 角度域噪声保证 ±π 连续；黑曜石柱环 6-10 根（r 25±4、高 74-95、半径 2-4，全部 hashSeed(seed,i) 派生，顶端荧石）；外环小岛 r>180 阈值 0.60；无 bedrock 无天光（hasVoid）。出生探测上限 y=72（低于柱群，防出生在柱顶荧石上）；性能 0.1ms/块（纯列填充，无 3D 场）。
- **天域生成器（`dimensions/aether.js`）**：低频 2D fbm 圈独立浮岛（阈值 0.40，岛列占比锚点 7-10%），场值驱动透镜厚度（core×60+3）；**原点保底出生岛用 max(dome, noise) 合成**（dome=(1-d/48)×1.1-0.15，任何 seed 原点必有岛，findSpawn 三 seed 同值 (0.5,97,0.5)）；草/土(3)/石剖面；正常天光+昼夜（overworld 同款光照路径，LightEngine skyEnabled 分支）；无水体（CW-1 未关）；云层档案 190（浮岛之上）；hasVoid。性能 0.1ms/块。
- **Physics 坠落救援陷阱（M2 虚空，曾真出）**：`Physics.collide` 末尾有旧主世界安全网 `y<-10 → y=100`——**hasVoid 维度必须跳过**，否则玩家永远到不了 -16 虚空伤害线（表现为"末地/天域虚空不掉血"）；`EntityPhysics`（怪物）的 y<-10 → dead 是正确语义（虚空杀怪）保留。冒烟断言：置 y=-30 手动驱动 `game.update(0.1)`×8 → y 持续下降 + hp 递减；走到 deathScreen.visible → respawn() → 回维度出生点满血（eval 直调 respawn 不隐藏死亡屏属测试痕迹，正常流程按钮 hide()→respawn）。
- **Sky 维度档案**：`applyDimensionProfile(dimDef)`——fixedColor / 天体显隐 / 云显隐+高度；`noDayCycle` → `isDay()` 恒 false（怪物不燃烧）、`isNight()` 恒 true（生成无视昼夜）、`getLightLevel()` 走 `light.skyLightLevel`（uDayLight 恒定）；applySettings 的云开关改写 `sky.cloudsEnabled`（Sky.update 里与维度显隐相与，勿回退成直接写 clouds.visible）。
- **换维流程（单机）**：CommandPanel 维度区 → `game.switchDimension(id)` → 合成 loadData（`dimensionSpawn:true` 忽略坐标落维度出生点）→ 重走 `start()`（**必须透传 this.networkMode 第 6 参**，否则联机标志被重置）；联机分支 M1 拒绝（chat 提示），M4 接入。初始区块以落点为中心生成（不再固定原点 0,0）。
- **spawnScanTop**：下界 200（基岩天花之下）——MobManager 怪物扫描与生成器 findSpawn、CommandPanel 生成实体共用此语义，有天花维度勿用 CHUNK_HEIGHT-1 从顶扫（会落在天花上/被 bedrock 顶格拒绝）。
- **虚空伤害**：`dimDef.hasVoid && y<-16` 每秒 6 血（持续伤害口径不走红屏）；重生 = 当前维度出生点（`World.getSpawnPoint()`），不跨维重建；主世界 getSpawnPoint 与旧 `getHeightAt(0,0)+2` 逐字节同值。
- **测试**：`tests/dimension-determinism.mjs`（每实现维度 × 2 seeds：双次字节一致 / 顺序无关 / 孤立=区域 / 出生点确定性+落点安全 / 特征方块存在 / 耗时预算）已接入 `run-all-tests.sh`；新增维度必须先让它在该测试下全绿。

### 传送门批次备忘（防回退）—— 手持物透明修复 / 全维度群系 / 原版式传送门

- **手持物透明贴图（黑底曾真出）**：`HeldItemMesh.heldMaterial` 必须 `alphaTest: 0.5`（物品/十字方块 SVG 背景透明，不开 alphaTest 透明像素按 RGB(0,0,0) 渲染成黑底）；用 alphaTest 而非 transparent（保持深度写入、双面薄片无排序伪影）。第一人称与远端玩家手持物共用此材质。
- **全维度生物群系**：维度生成器实现 `getBiome(x,z)`（纯函数复用生成噪声）+ `biomeNames` 中文名表；InfoBar 按 `generator.biomeNames ? generator.biomeNames[b] : BiomeNames[b]` 统一取名，非主世界行格式 `维度: X ｜ 生物群系: Y`；noDayCycle 维度时间行显示"无昼夜"（读 `sky.dimDef.noDayCycle`）。dimension-determinism ⑦ 断言 getBiome 确定性+名表完备——新增维度必须带这两样。
- **Portals.js 职责边界**：纯 World 操作（框校验/点火填充/搜门/建门/拆门）；游戏时序（站门计时/武装门控）在 `Game.updatePortals`。`detectPortalInterior` 用轴无关 u 偏移坐标（曾写成 minX/dz 混淆使 z 轴扫描不前进——勿回退）。矩形框规则：内 ≥2 宽 ≥3 高，框边封闭，从点击面外邻格（空气）起检。
- **传送门发光阈值**：`light: 13` 起才会进光源 LUT + 亮块重绘（引擎源阈值 ≥13）；portal 方块 solid:false + transparent:true + cross（end_portal 为 cube+light:15）。
- **穿越门控（防回弹三件套）**：`_portalTimer`（站门 2s，末地门即触）+ `_portalArmed`（到达置 false，**离开门体才回 true**）+ `_portalCooldown`（4s 兜底）；start() 里复位三者，start 完成后 `_afterPortalArrival` 再置到达态。**（B30 轮 8 步 5 起：点火 `_tryLightPortal` / 嵌眼 `_tryPlaceEndEye` / 站门计时 `updatePortals` / 环境粒子 `updatePortalParticles` / 触发 `_usePortal` / 折跃门 `_useGatewayPortal` / 到达落点 `_afterPortalArrival` / 立地面 `_resolveArrivalY` 实现在 `src/player/PortalSystem.js`，Game 侧仅同名门面；**三件套与 `portalOverlay` 仍留 Game**（控制器一律调用点现取——`updatePortals → _usePortal → switchDimension → start()` 可同帧换世界，控制器不得留 world/player 快照）；粒子节流计时器随迁为控制器 `partT`）。Game.update 每帧把手持物同步回选中槽——eval 直调 `hand.setItem` 会被覆盖，测试时改 `inventory.hotbarSelected`。
- **落点协议**：`switch_dimension`/`dimension_world` 携带可选 `pos={x,z,portal}`；带 x/z（下界÷8/×8、天域 1:1 换算落点）或仅 portal 标记（末地出生点链）均可；服务器清洗后**只回传换维者本人**，非法类型置 null。`_afterPortalArrival`：有坐标 → 账本搜门 24 格吸附（无门自动建 4×5 返程门）；无坐标 + portal==='end' + 落在末地 → `_ensureEndReturnPad`（16 格内已有 end_portal 则跳过，幂等防重连重建；垫建于出生点偏移 +4 防出生即踩回程）。
- **建门层高语义**：`buildReturnPortal`/`buildEndReturnPad` 的 baseY = `findGroundY`（立地面首格空气层），框/门体在 baseY，**站位 baseY+1**——单测断言按此写（曾两次把期望层高写错）。无立地面按 `ARRIVAL_PLATFORM[dim]` 垫平台（下界/末地黑曜石、天域萤石）。
- **末地环激活（原版逐框 12 眼）**：`detectEndRing` 扫 5×5 窗口找"12 环位 ∈ {frame, frame_eye} + 中心 3×3 全空气"；**窗口原点相对点击格枚举 [-4..0]**（点击格可落环任一边，曾漏 -4 致远边点击失效——⑨ 远边断言防回退）；右键无眼框 → setBlock frame_eye → 复检 eyes===12 → `fillEndPortalCenter` 填 3×3 门体；散框（非环位）不消耗眼。要塞预填 30%：solve 内 per-block `hash32(...,2027)%100<30`——改 salt/比例会改变预填组合（确定性不受影响，联机两端必须同版本）。
- **拆框清波**：`removeConnectedPortals` 挂在 Game 两处破坏路径（creative/survival setBlock(0) 之后）——从被破坏格 6 邻域洪水清连通门方块；新增破坏入口（爆炸等）也要挂。
- **末影之眼获取链**：`blaze_rod→2 blaze_powder`、`blaze_powder+ender_pearl→ender_eye`（shaped，顺序敏感）；pearl/rod 进要塞三箱表 + village_big（powder 也进 village_big）。期望每要塞预填 2-4 眼、需补 ~8-10 眼 ≈ 三要塞+村庄箱子可持续供给。
- **冒烟陷阱**：单机无 `game.chatBox`（联机才建）；菜单浮层盖 canvas 需 DOM 隐藏后 `click 'canvas[data-engine]'` 抓指针锁；MP 换维重建窗口 10-20s——轮询断言要给足时间（曾三次误判"未触发"实为窗口中）。

### 下界优化批次备忘（防回退）—— 灵魂沙峡谷 / 下界要塞 / 下界怪物 / 面板布局

- **峡谷地面盖层**：原地表装饰只覆盖"下方悬空"的薄板面（below 为空腔/熔岩），厚实山体顶面永远保持下界岩 → 群系在地表不可辨识；`soul_sand_valley` 列另走"盖层"遍：NR 在下、空气在上 → 向下置换 3 层灵魂沙（仅置换 NR，不覆盖荧石/黑曜石/砂砾；曾笔误写成荧石挂顶方向"空气在上 NR 在上"致全列不生效）。装饰遍取群系一律走 `getBiome` 单一来源（与 InfoBar 显示一致）。dimension-determinism ⑧：峡谷在场 + 下探式扫描（穿悬挂体）行走地面=灵魂沙。
- **结构维度作用域**：StructureManager `def.dims`（缺省=任意维度），decorateChunk/recordsNear/recordsAround/ensureRecord/structureNameAt **全入口**按 `generator.dimensionId` 过滤——下界挂 structureManager 后若不过滤，会求解村庄/要塞并在缺少 `getBaseHeight` 的生成器上抛错。四个生成器都带 dimensionId（overworld/nether/end/aether）。
- **NetherGenerator.generateChunk(chunk, decorate=true)**：装饰开关——findSpawn 出生探测与要塞选址探针必须传 false：结构选址在 generateChunk 内部再入 generateChunk（临时区块），不关装饰会递归。
- **要塞选址（聚类，曾 0% 接受）**：下界可行走空腔主要在中段高度（50-200，y=90 探针窗口太低全灭）且呈多层分布（同锚点各列地面 92/135 两级）——探针从 y=150 下探穿悬挂体取首个暴露地面，9 列结果做 **±8 聚类取最大簇（≥4 列）以簇中位数定位**；单一中位数+全距门控会 0% 接受。接受率 ~24% × 概率门 0.84 → 每 cell(320 格) ~20% 有要塞。
- **下界立足面扫描（存量 bug 已修，勿回退）**：有天花维度的实体落点必须"下探穿悬挂体"（trySpawn 与 CommandPanel._spawnMob 两处）——原"首个实心即停 + 头部空间检查"被天花顶面拒绝 ~93% 列 → 下界自然生成近乎不可能；`findGroundY` 同理会命中天花返回 y≈201 把生成物嵌进岩层。
- **烈焰人仅要塞生成**：`pickNetherSpawn` 纯函数（要塞平台层 70% 烈焰人 / 20% 猪灵 / 10% 凋零骷髅；峡谷 45% 凋零骷髅；荒地 85% 猪灵）；`MobManager._fortressAt` 用 recordsAround+bbox（抗 LRU 驱逐）。要塞庭院刻意无顶 → spawn 下探直达平台层。
- **中立怪/悬浮怪机制**：`Mob.neutral` + attackMob 内 25s 激怒 + 16 格同族传播（息怒回游荡）；`Mob.flying`（EntityPhysics 已有 flying 分支跳重力）+ update 竖直悬停控制（chase 对齐目标 y、游荡漂回 hoverBaseY、chase 跳跃分支须 !flying）；`igniteOnHit` 命中点燃复用 player.onFire。测试 eval 直调 attackMob 的 rayDir 必须真 Vector3（内部 `rayDir.clone()`）。
- **命令面板布局**：双列卡片网格（左=传送/探索，右=维度/模式/时间，生成实体整宽 auto-fill 网格，关闭钮在头部）；面板 min(780px,94vw) + max-height 88vh 内滚兜底。生成实体列表 = **MobTypes 动态枚举**（MOB_ORDER 定序，未知类型排尾）——新增生物自动纳入面板，无需改本文件。布局重构不改任何元素 id/回调/refresh 通道；探索行传送用 `rec.groundY+2`（要塞）而 getHeightAt（主世界）。
- **测试**：`tests/nether-fortress.mjs`（36 断言×2 seeds：维度作用域/记录自洽/布局确定性/区块落地/要塞表确定性）与 `tests/nether-mobs.mjs`（70 断言：类型注册/模型盒一致/生成表分布/中立悬浮标记/全类型可构造）接入 run-all-tests.sh。

### 末地完善批次备忘（防回退）—— 外岛锚点场 / 末影龙 / 龙败奖励链 / 末地城 / 传送门特效

- **外岛锚点场**：`end.js` 外岛从噪声阈值场改为模仿原版 island origin——96 格网格 per-cell `_cellHash` 派生 0-2 个岛心（58% cell 有岛），半径 24-40/顶面 55-74，圆锥+透镜剖面 + 角度域 (cos,sin) fbm 边缘扰动（per-anchor 偏移保证岛间独立）。`_anchorCache` memoization 上限 4096 清空。群系分界：`outer.rad ≥ HIGHLANDS_MIN_R(28)` = end_highlands（末地城候选）否则 small_end_islands；**主岛与柱环逻辑零改动**（出生/龙战链依赖）。`outerAnchors()` 主岛外圈锚点表（角度有序）是折跃门选址唯一来源——勿在别处另造锚点。
- **末影龙**：`DragonAI.js` 三态状态机（circle 盘旋 r30/h88 引导点切向飞行 → dive 周期俯冲 1.7x 速 → perch 低血<40% 栖息最近存活水晶柱顶回血 4/s）。`Mob.update` dragon 专用分支全接管（不走通用索敌链）。柱顶 = 基岩底座 + `end_crystal`（light 15）；水晶存活查询 `getBlock(p.x, p.top+2, p.z)`——**柱顶+2 是硬约定**（end.js 与 DragonAI 两处依赖）。水晶击碎爆炸走 `Endgame.breakCrystal`（Game 侧同名门面 `_breakCrystal`；B30 轮 8 步 2 迁出）（复用 mobManager.pendingExplosions 破坏路径 + 距离衰减伤害）。**末地/天域 trySpawn 直接 return**（末地唯一敌人是龙）——勿回退主世界表。
- **龙败链路**：`MobManager._fireDragonDefeated` 幂等（dragonDefeatedFired 标记），本地死亡链 + applyRemoteMobAttack 致死 + applyRemoteMobDeath 三个入口都挂（远端死亡链 diedHandled 已置 true，只在 diedHandled 分支挂会漏远端）。击败判定 = `world.dragonDefeated`（会话态）OR `_endPadExists()`（账本 16 格内 end_portal——跨会话/联机一致）；**击败标记持久化三处同改**：SaveSystem.save / _composeSwitchLoadData / start 恢复（漏一处=换维或存档后龙复活）。
- **末地回程门语义（M3 起变更）**：到达末地**不再自动建回程垫**（`_afterPortalArrival` 无坐标分支已移除 `_ensureEndReturnPad`）——龙败 `_activateEndRewards` 才建（喷泉造型 `buildEndReturnPad({fountain:true})` 中央 3 格基岩柱，站位偏门环西列防嵌柱）。portals-unit 旧断言按无喷泉默认参数不受影响。（B30 轮 8 步 2 起：`_ensureEndReturnPad`/`_endPadExists`/`_ensureDragon`/`_onDragonDefeated`/`_activateEndRewards`/`_placeDragonEgg`/`_ensureGateways` 实现在 `src/player/Endgame.js`，Game 侧仅同名门面。）
- **折跃门（gateway）**：`PORTAL_KINDS.gateway`（frame bedrock / portal end_gateway）+ `DIM_PORTAL_KINDS.end = ['end','gateway']`；`end_gateway` cross 非固体发光 hardness -1。选址 `gatewayPlacements(anchors, 4)` 纯函数（角度均布 4 对：主岛缘 r50 ↔ 外岛锚点边缘）——**两端门角度一致是 `gatewayTarget` 角度最近配对的前提**。站入触发：updatePortals gateway 分支探测**脚下格**（`cellId(-0.3)`，门嵌地面层 solid:false 陷入即踩）+ 1s 阈值；传送 `_useGatewayPortal` 账本扫描角度最近门直达（同维不换维，armed/cooldown 防回弹沿用）。`_ensureGateways` 幂等：账本已有 end_gateway 即全跳过。
- **末地死亡重生**：`respawn()` 末地分支 `switchDimension('overworld')`（异步串行链，落主世界出生点，背包经 loadData 保留）——防败龙前死亡软锁末地；勿回退为"重生当前维度出生点"。
- **末地城**：`endCity.js` END_CITY_DEF（cell16/chance0.6/attempts2，dims:['end']）——选址门 end_highlands + 9 列平坦全距≤8（外岛 fbm 扰动天然落差，结构后写覆盖地形，低侧悬空=原版悬浮基座风格；**全距门勿收紧回 6**——seed 20250903 会 0 接受）；布局=末地砖底台+双层紫珀塔（南门/三级阶梯）+战利品房 2 箱+紫颂花园，rng 门 40% 末地船（货舱+船长箱）。`meta.shulkerSpawns` 确定性点位供 MobManager 生成。loot 三表 + `FORCED` 必出机制（end_ship_captain 鞘翅保底；**FORCED 消耗同一 rng 流**，旧表无条目流不变——勿改 chestLoot 抽取顺序）。
- **潜影贝**：`MobTypes.shulker`（stationary，speed 0 原地附着）+ `Mob.updateShulker`——0.6s 蓄力（hitFlash 复用为紫闪提示）→ hasLineOfSight 直线判定命中（4 伤+击退），射击间隔 2.5s；**无投射物实体**（躲墙后=躲弹，玩家实测墙后不命中是设计行为）。生成走 `updateEndCitySpawns`（仿村民：host 权威广播 / spawnedEndCities 去重 / 随城清扫全端>200 格）。
- **紫颂果**：chorus_fruit food:4，`Game._chorusTeleport` ±8 格随机落点下探安全立地面（找不到=不传送不垫台）；velocity 清零即防摔伤（本作摔落伤害按落地瞬时速度算，无 fallDistance 累积——勿臆造字段）。
- **传送门屏幕特效**：`PortalOverlay.js` 纯表现层（只读 kind+progress，**不干预三件套**）；径向 vignette + conic 漩涡 + 末地系星点层，opacity=0.25+progress*0.75 线性渐强、离门 0.18s 渐隐；白闪 flash() 用 offsetWidth 重启动画；updatePortals 各早退分支（cooldown/未武装/离门）统一喂 update(null,0)——**未武装（到达站位在门内）不显特效**是防回弹语义的一部分。
- **测试**：`tests/end-islands.mjs`（181 断言：群系在场/密度带宽/锚点确定性/群系→方块单一来源）+ `tests/end-dragon.mjs`（104 断言：类型/柱顶水晶×2 seeds/DragonAI 六场景/击败幂等/末地门控）+ `tests/end-gateway.mjs`（41 断言：折跃门注册/选址/建门/角度配对/喷泉布局/幂等门控）+ `tests/end-city.mjs`（111 断言：注册/漏斗/落地/箱子三向/loot 保底/双次一致）全接入 run-all-tests.sh。
- **冒烟陷阱**：测试 eval 里建方块用 `BlockRegistry.getByName(name).id`（id 数字会变，勿硬编码 54/80——M5 冒烟曾因硬编码 id 误判"门未生成"）；站门特效采样必须先确认 `_portalArmed`（到达站位在门内时 armed=false 特效不显是正确语义）；换维窗口 10-20s，"未传送"结论前先排除窗口中。

### 天域叙事基石批次（批次 A，2026-09-14 交付，未发布——随 Build 14 统一发布）—— 天海纪元内容底座

- **发布单元订正**：天域四批（叙事基石/群风与众生/守誓巨像/复潮）为**开发里程碑**，中间批次只 push+CI 绿不 bump BUILD 不发 Release；BUILD=14 的递增放批次 D 提交内。设计总纲见 `docs/aether-storyline.md`。
- **注册追加纪律（存档根基）**：BlockDefs/ItemDefs 新内容只能**文件末尾追加**（自 beacon 起惯例）——chunk 存档按方块 id 存数字，中途插入=全存档地形错位；`tests/aether-content.mjs` 断言新方块 id > beacon id 防回退。
- **ItemRegistry 字段白名单陷阱（曾真出）**：`register()` 只拷贝白名单字段——def 里加新字段（本批 `lore`）必须同步在白名单加 `lore: def.lore || null`，否则**静默丢弃**（注册不报错、tooltip 永远空）。
- **气流命名**：`wind_current` displayName 用「气流」（「风流」现代汉语歧义），zh-TW「氣流」，id 不变；null 像素=透明（pixelSvg 跳过 falsy），淡青竖纹直接 rgba 填 fill 作视觉提示；solid:false + hardness 0.3 可拆。
- **石碑章节绑定**：`StructureManager` 新增 `steles` Map（"x,y,z"→章节id，键格式与 chests 注册表一致）+ `steleChapterAt()`；注册来源=结构 `meta.steles`（批次 B 起由 solve 填，与 meta.chests 同款幂等注册）；未注册石碑回落 `STELE_BLANK`（无字碑）。章节内容表 `src/world/steles.js`（9 章 + 无字碑，值=语言包键）。
- **SteleScreen 生命周期**：BeaconScreen 同款（start 新建 / _disposeWorld dispose / _setupPauseOnUnlock 守卫 / KeyE + ESC + backdrop 关闭）；Game.js 集成共 10 处：import、构造置 null、pauseOnUnlock 守卫、_disposeWorld、start 创建、KeyE 分支、KeyQ 守卫、ESC 分支、右键路由（wind_stele → open，旁观拒绝）、`_blockDrops` 星髓矿石→star_marrow（复用 `_blockDropName` 的镐 tier 门控）。
- **i18n 固化为永久测试**：`tests/i18n-parity.mjs`（10 包键集对齐 + 每键占位符多重集对齐 + **静态 t() ∪ 动态键表**（群系名/碑文/lore/信标效果/分类标签）覆盖审计 + 文本级重复键扫描）——碑文/lore 走 `t(表[key])` 动态路径，静态扫描盲区（§16 教训）必须显式并集；本批 master=236 键 × 10 包全绿。
- **eval import 实例分裂（§16 陷阱再次命中）**：browser eval 里 `import('/src/i18n/index.js')` 得到**第二模块实例**，setLocale 改的是副本、游戏 t() 无感——实时语言验证必须走真实 UI（主菜单「语言」按钮循环切换）后再进世界断言。
- **冒烟全绿**：创造搜索（星髓→4 项/残页→3 项）、tooltip 中英双语渲染（名称+灰斜体 lore 行）、石碑三路径（未注册→无字碑 / meta 注册→第一章 / 右键路由）、E 关闭还原 controls、控制台 0 错误；测试存档已删、语言已还原简体。

### 天域群风与众生批次（批次 B，2026-09-14 交付，未发布——随 Build 14 统一发布）—— 生物/结构/气流

- **结构新增**：漩风井（aether_well，cell12/attempts2/chance0.5/salt7264，石环+wind_current 柱 20 格）/ 天海之门遗迹（aether_gate，cell24/attempts4/chance0.5/salt7265，半埋荧石拱+rng 腐蚀塌顶+核心石碑）；catalog.js 登记；structureNameAt 增中文名。**测试扫描 ±4 cell 找不到低密度结构时先放大扫描半径（well 需 R≥6）再怀疑生成参数**。
- **神殿内殿改造**：solveTemple 追加 ⑥ 段——下沉 3×3×3 圣所（净空 y0-2..y0、底 y0-3）+ 恒昼祭坛 + 双碑（sundering/command）+ 第三箱 aether_sanctum + 东侧地板开口两级踏步（1 格跳距闭环）+ 殿心海晶灯改封门星髓块（挖开坠入）。结构块**后写覆盖先写**（air 开口压地板层，同 solveTemple 门的旧例）。
- **出生岛引路碑**：aether.js generateChunk 原点区块 (8,8) 列置 wind_stele + structureManager.steles 注册 prologue；**碑位列跳过 _decorate**（防树干覆盖成浮叶）；decorate=false 探针不置碑不注册（防递归路径污染）。注意石碑上方可能有邻树树叶——顶扫首个非空格不一定是碑（冒烟扫描要按 id 找）。
- **BlockRegistry 白名单字段**：新增 `updraft`——与 ItemRegistry lore 同款陷阱：register 白名单外的 def 字段**静默丢弃**，新字段必须同步加白名单。
- **气流渲染纪律（曾真错）**：solid 材质 `alphaTest:0.1 + transparent:false` → **rgba 半透明像素按不透明 RGB 画成色块**；wind_current 必须 `renderType:'cross'` + 二值 alpha（全画/全透，火把同款）；rgba 只在 transparent 材质（水面）可用。
- **上升气流实现**（B30 轮 8 起判定与风阵柱读写实现在 `src/player/GlideWind.js`，Game 同名门面保留）：`_updateUpdraftState()`（足/身任一格 def.updraft）+ 移动分支（水平弱操控 0.6x、Shift -4 下潜脱出）+ **physics.collide 之后**追加升力 `vy=min(6, vy+45dt)`——升力若加在 collide 前会被当帧重力抵消；只作用玩家（flying/spectator/inWater/gliding 全跳过）；实测 3s 升 ~10 格、柱顶悬停回落再托举。风阵块放置 `_writeGaleColumn` 上方 12 格逐格 setBlock（联机 World.setBlock 钩子自动逐格上报），拆块 `_clearGaleColumn` 顺柱清除（遇非风流格即停）。
- **云绒块免摔落**：摔落判定（impactVy<-15）先查 `_blockUnderFoot()`，cloud_wool 全免；生存模式对照实测：石头 30 格 20→11.7 血 / 云绒 20→20。**创造模式 hurt 恒 false——摔落/伤害类冒烟必须切生存**（CommandPanel 生存按钮），且面板开着 update 暂停、物理不走。
- **生物三新增**：cloud_lamb（陆行被动，掉云絮 2-3——云絮唯一常规来源）/ gale_hawk（flying 敌对 3 伤）/ tide_echo（flying 中立）；`Mob.passive` 无实例字段（构造器只抄 neutral/flying），断言用 `type.passive`；生成表 **pickAetherSpawn→pickAetherSpawnV2**（crystal 守卫40/潮鸣30/风灵30；frost 守卫10/岚隼12/风灵余；草地岚隼8/风灵余；神殿周边守卫主导不变）；aether 被动群生成并入 trySpawn 草地块（`overworld||aether`，aether 组=cloud_lamb）。
- **angerTideEchoes**：MobManager 新方法（挖矿触发器版同族群怒，末影人 attackMob 模式换触发器）；挂 creative+survival 两破坏路径（与 _breakBeacon 同位）；真实鼠标冒烟：挖穿星髓矿石 → 16 格内潮鸣 aggro=true。
- **测试**：aether-mobs 351 断言（V2 分布 + 真实 MobManager 激怒链路）/ aether-structures 126 断言 ×2 seeds（新结构选址/石碑三向 meta↔方块↔sm.steles/内殿/引路碑/探针防护）/ aether-content 156 断言（cross+updraft/gale_block）。

### 天域守誓巨像批次（批次 C，2026-09-15 交付，未发布——随 Build 14 统一发布）—— Boss 与奖励链

- **召唤路由**：恒昼祭坛右键 + 手持 storm_totem（创造不消耗/生存扣 1）；召唤点 = 祭坛东侧底台（`altar+6.5, y+2.05`）；**房间闸门走 `net.roomSettings.mobs`（客户端预检）**——sendMobSpawn 漏斗兜底但图腾已扣，所以预检拒绝在前（提示走 chatBox，单机无提示）。
- **StormColossusAI（仿 WitherAI 事件同步）**：rise(0.6s 立起)→guard 岩卫（贴地横扫 + 周期 7s 跳跃震地：跃起→坠砸→触底触发 onColossusSlam）→storm（66% 环绕悬浮 + 2.6s 齐射 + 9s 俯冲）→rupture（33% 更贴脸 + 1.7s 双段齐射 + 风拽光环）。**高危：初始化漏字段 = NaN 污染**——`colossusPhase` 未在 init 块赋值，`undefined += dt` → NaN → 位置/距离全 NaN、齐射静默失效（曾真出）；新 AI 状态字段必须全部在 init 块赋值。
- **风拽光环**：不在 AI 内（mob 是 host 权威，拉本地玩家会跨端错位）——`Game._updateColossusAura(dt)` 各端对**本地玩家**结算（读 mob.health/maxHealth 判阶段——health 经攻击同步收敛）；creative flying/spectator 免疫。（B30 轮 8 步 7 起风拽光环 `_updateColossusAura` 与巨像震地 `_colossusSlam`/`spawnRemoteColossusSlam`/`_applyColossusSlam` 实现在 `src/player/AetherFinale.js`，Game 侧仅同名门面。）
- **风弹复用 wither_skull 通道**：`_spawnWitherSkull(pos, dir, kind)` kind='gale' → 青色弹、18 速、命中 6 伤+击退（无凋零）；payload 加 `k:'gale'`（protocol/room/NetworkManager 三处透传，room 端 `msg.k === 'gale'` 才带，缺省凋灵首）；震地为新消息 `COLOSSUS_SLAM`（事件式 except 发起者，各端 `_applyColossusSlam` 本地结算伤害+击退+粒子）。（B30 轮 8 步 3 起 `_spawnWitherSkull` 实现在 `src/player/Projectiles.js`，Game 侧同名门面；震地 `_applyColossusSlam` 仍在 Game，留轮 8 步 7。）
- **BossBar 零成本接入**：`type.boss: true` 即自动多实例血条（与龙/凋灵并存）。
- **御风斗篷效果**：缓降 = **physics.collide 之后**钳 `vy ≥ -8`（不到摔伤线 -15 天然免摔，实测两采样点 vy=-8.0）；跳跃 = 天域内 jump 后 `velocity.y *= 1.2`（底 9.0→10.8 实测）。穿戴检测 `_hasGaleCloak()` 读 `inventory.armor[1]`。
- **死亡掉落零新增**：type.drops（storm_core 1-2 + heart_shard 1）走标准死亡链，**不需要龙败式持久化**（可重复召唤）；远端死亡链 applyRemoteMobAttack/Death 天然覆盖。
- **测试**：tests/aether-boss.mjs（27 断言：注册/状态机只进不退/双段齐射计数/震地触发/图腾配方）——AI 测试用真实 Mob + stub mobManager，**player stub 必须带 hurt()（AI 近战咬合会调）**；冒烟时 attackMob 的 rayOrigin/rayDir 必须真 Vector3（§16 陷阱）。
- **冒烟全绿**：祭坛召唤（BossBar 即现）/三阶段推进/风弹在飞/风拽拖近 1.7 格/击杀掉落 storm_core+heart_shard/缓降钳制/测试存档已删。

### 天域复潮批次（批次 D，2026-09-15 交付）—— 终局与永昼解除

- **复潮仪式**：恒昼祭坛右键（无图腾分支）→ 校验材料（page_rising/page_marrow/page_sunder 各 1 + heart_shard 3，背包线性计数）→ 全扣 → 祭坛 setBlock 置换 **tide_altar 潮心祭坛**（走账本=存档/联机天然一致）→ `applyAetherDusk(true)` → 第九章「复潮」碑文自动浮现（SteleScreen.open 第 4 参 chapterIdOverride）。（B30 轮 8 步 7 起天域终局 / 复潮域 13 方法——复潮仪式 / 候潮献证 / 听潮门控 / 纹章发放 / 四界同潮窗口与四段粒子 / 复潮状态切换——实现在 `src/player/AetherFinale.js`，Game 侧仅同名门面；演出窗口随迁为控制器 `this.tide`，Game 侧保留只读访问器 `get _finaleTide()` 供 `CommandPanel:291` 探针，外部读取面不变。`aetherDusk`/`finaleInfo`/`world.finalePrimordial`/`world.finaleDone`/`player.emblemWorn` 仍留原主。）
- **档案运行时覆盖（§5.4 不变量 1/2/3）**：`dimensions.js setAetherDuskProfile(on)`——on=true：fixedColor→null（昼夜锚点生效）/ polarDay→false / skyLightLevel→null（Sky.getLightLevel 对 null 走真实昼夜，uDayLight 跟随）；on=false：一键还原永昼（回滚路径）。**Sky.applyDimensionProfile 是一次性快照**——改 dimDef 后必须重跑它，且 start() 中须在 applyDimensionProfile 之前调用。
- **状态持久化三路**：①单机存档 `data.aetherDusk`（SaveSystem save/load）；②换维透传 `_composeSwitchLoadData` 加字段；③MP `AETHER_STATE` 消息（protocol/room/NetworkManager）——服务器权威单向开关（只进不退）、broadcast 全房间、room.aetherDusk 进 roomSnapshot 落盘 + WORLD_INFO 三处下发（首次/换房 restart/重连）。**start() 恢复顺序陷阱**：MP 下 WORLD_INFO 先于 start() 到达（已写 game.aetherDusk），start 里 loadData 无字段时保留现值、有字段才覆盖。
- **夜表**：pickAetherSpawnV2 加 isNight 第 3 参（永昼期恒 false）——夜表守卫/岚隼加成（草地岚隼 18%/水晶守卫 50%/银霜岚隼 45% 上限段）；云绒兽被动组白天限定=天然夜间缩群。复潮后 sky.time 锚定 0.32（玩家亲眼看到第一次日落）。
- **Boss 清除豁免（顺手修历史缺陷）**：despawn 条件加 `!mob.type.boss`——80 格静态清除半径曾会把走远的守誓巨像/龙/凋灵直接抹掉（Boss 只经死亡链移除）。
- **冒烟全绿**：仪式全链路（材料扣/置换/档案三项/时间锚定/第九章）/真实昼夜（0.78 夜 light 0.0、0.5 昼 1.0）/存档往返（duskRestored+polarDay false+潮心祭坛在）/MP 三路状态字段就位；测试存档已删。

### Build 20 修复与改进批次（2026-09-16 交付）—— 石碑四格形制 / 折跃门传送门式 / 永昼泄漏修复

- **石碑四格形制（①）**：单格碑升 4 格——底座=维度特色方块、第 2 格石碑、第 3 格荧石、顶帽=维度特色方块（`src/world/steles.js` 新增 `STELE_STELE_BY_DIM`/`STELE_BASE_BY_DIM`/`steleStack(x,y0,z,dim)` 单一来源；steleStack 内 `BlockRegistry.getId` 转数字 id——solve 在方块注册后运行）。维度特色块：overworld=mossy_cobblestone（苔石·雨土苔痕）/ nether=magma_block（岩浆块·烬火余温，**项目里无踩踏伤害逻辑**）/ end=purpur_block（紫珀·拾遗者遗物）/ aether=star_marrow_block（星髓·潮的骨头）。**14 处碑位逐一核对净空后全部原位升级**：结构内 9 处（temple 内殿×2 碑位 y0-2 底座压圣所地面、顶帽压台面海晶灯十字两端；sea_gate/whale/gleaner_ring/ring 中心碑；fortress y0+7 底座嵌顶盖；hearth×3 clearBox 清至 y0+10；tide_barrow 水下碑荧石在水中发光）+ 维度直写 2 处（aether.js 出生岛 8,8/end.js 主岛 26,26——end 侧净空条件从 top+1 收紧为 top+4）+ village/stronghold 各 1 处（village clearBox 已清 groundY+1..+4；stronghold room 清腔至 hubY+4）。**碑位注册键（meta.steles 与 steles.set）仍取碑体格 y0 不变**——steleChapterAt 兼容零改动。碑列条目全部在结构 blocks 序列**末尾追加**（后写覆盖先写=压过砾石/基座材/水）。
- **折跃门传送门式（②）**：`end_gateway` 去 `renderType:'cross'`（走 end_portal 同款正常立方面渲染）+ 纹理改黑洞星空（微绿底 + 绿色星点，区分 end_portal 蓝白星点）；solid:false 陷入触发（脚下 cellId(-0.3) 探测）/light 15/ambientParticles 不变；ParticleSystem PORTAL_TINTS.end_gateway 同步绿色星尘。基岩框内嵌语义不变——视觉从"十字光束片"变"黑洞星空面"。
- **永昼泄漏修复（⑦）**：`this.aetherDusk` 挂在跨存档共享的 Game 实例上，旧逻辑"loadData 无字段时保留现值"使存档 A（已复潮）的状态泄进新开存档 B（B 进天域=永昼被解除，表现为"解除效果对全存档生效"）。修法：start() 中**单机只信存档字段**（`this.aetherDusk = !!(loadData && loadData.aetherDusk)`——换维透传的 loadData 合成总是携带该字段故不受影响；旧存档无字段=未复潮正确）；联机保留现值（WORLD_INFO 先达，房间权威）；`returnToMenu()` 末尾复位 `this.aetherDusk=false`（防残留；DIMENSIONS.aether 全局档案在下一次进天域 start 时按存档重设，闭环）。
- **测试**：`tests/build20-fixes.mjs`（153 断言，含 steleStack 纯函数四维映射/9 个结构 solve 行为级四格验证/维度生成器绊线）；end-gateway.mjs 增"去 cross"断言。
