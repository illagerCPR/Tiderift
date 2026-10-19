# Agent 备忘 · 世界生成与结构

> 本文件内容为 AGENTS.md 批次备忘**原文搬移（未改写）**，用于控制 AGENTS.md 体积（会话注入预算 65536 字节，超限会被静默截断）。
> 导航见 AGENTS.md「批次备忘索引」；新批次备忘按主题追加到对应小节，并同步更新 AGENTS.md 索引表。

### 自然建筑生成批次备忘（防回退）—— 结构基础设施/村庄/村民/要塞（T0-T4 进行中）

- **结构生成架构不变量**：布局只由 (seed, 结构类型, 锚点 cell) 决定；`StructureManager` 布局求解与逐区块裁剪严格分离，任意端/任意区块顺序结果逐字节一致（联机根基）。回归 = `node tests/structure-determinism.mjs`（同 seed 双次字节一致 / 生成顺序无关 / 跨区块连续 / 耗时预算），已接入 `server/run-all-tests.sh` 首位（纯 node 不占 3001）。新结构类型（要塞等）必须：`registerStructureType` 进 `structures/catalog.js` + solve 保持纯函数 + 追加顺序=绘制优先级。
- **StructureManager 高陷阱**：① `recordsNear` 只读缓存——LRU（maxCache=128）长距离探索后会把村庄记录挤出，**周期性运行时逻辑（村民生成）必须用 `recordsAround`（3×3 cell ensureRecord 按需重求解）**；② 选址门控别照搬 MC 直觉：本作河流/地形碎片化，海拔窗 65-92 + 坡度 ≤8 + `attempts: 6` + `probeR: [10,18]`（大探针环会系统性排除沙漠小斑块）才达到合理密度，改动前先跑 node 漏斗统计；③ 村民出生点必须 `spawnAt`（清柱+按 `baseAt` 实际地形垫台）——直接用 groundY+1 在坡地会卡实心方块掉虚空。
- **`EntityPhysics.moveAxis` z 轴碰撞回退曾误用 `bx`（存量高危 bug，已修）**：沿 z 撞墙的实体被瞬移到 z≈bx 的远点（一帧 ~180 格）——怪物游荡高频触发，表现为"怪物凭空消失/出现在远处地下后坠世界"。回退坐标必须取当前轴的方块坐标（`bc = axis==='z' ? bz : bx`），勿回退。`Mob` 攻击分流用 **`target.isMob` 鸭子标记**而非 instanceof（HMR 双模块实例下 instanceof 失效）。
- **村民系统**：`MobTypes.villager`（passive: true，damage 0/detectionRange 0，drops 空）；AI 三态 = 村庄绳拴游荡（home 半径 24，flee 时家向偏置防被拖远）/ 玩家 4 格注视 / 8 格敌对逃离（速度 ×1.6）；**僵尸/骷髅索敌含村民**（`findNearestMob` 取玩家与村民较近者；苦力怕/蜘蛛仅玩家——防自爆拆村），怪物咬村民走 `mobAttackMob`（伤害+hitFlash+击退），死亡走 update 通用链（sendMobDied 广播/drops 空）。村民不进存档，随村庄重载重生。
- **村民生成生命周期**：`MobManager.updateVillageSpawns` 每帧驱动——生成部分仅 host/单机（`spawnEnabled` 门控，联机经 mobNet 广播 mob_spawn，实体由回执创建）；**补挂 home 与随村清扫（村庄卸载 >120 格 → 村民移除+dedup 解除）全端执行**（客户端 spawnEnabled=false，早退会让客户端村民永无 home）。村民死亡本会话不重生；敌对 MAX_MOBS 上限不含村民。
- **重连丢房间名（存量 bug，已修）**：`NetworkManager` 重连重入房曾发空 payload `JOIN_ROOM {}` → 服务端落到 default 房（房间静默漂移，方块账本/村民全对不上）。重连必须 `JOIN_ROOM { room: this.room }`；排查"联机数据对不上"先查两端 `net.room` 是否一致。
- **要塞（T3）**：环带锚点走 `anchorForCell`（3 点 seed 派生 120°±抖动、半径 700-900；返回 null 即该 cell 无结构，attempts/chance 门不生效）；`place` 海拔门 60-100 拒绝深水/极峰（**个别 seed 第三座可被合理拒绝**，2-3 座属正常）。`hubY = min(surfaceY-26, minGround-9)`，minGround 取 ±40 步长 5 采样最低地表（步长 10 抓不到局部洼地，房间会戳出山体）。传送门室 = 12 框架环 + 3×3 未激活中心（末地维度另行立项）；风化混排 per-block 哈希 14% 苔/12% 裂。T5 后续候选（本批不做）：末地维度、战利品箱子（容器 UI+存档扩展）、村民交易。
- **批次性能锚点**：单区块地形生成+结构装饰 ≈ 8-10ms（node 实测，含锚点扫描/村庄求解首算进缓存）；结构装饰对多数区块为 O(cell数) 哈希跳过。基准 7ms 是 mesh build（另一条路径），二者不相加混淆。

### T5 批次备忘（防回退）—— 战利品箱子 / 村民交易

- **容器惰性生成不变量**：箱子内容不在结构求解时生成——solve 只放 chest 方块并在 `meta.chests` 声明 `[x,y,z,表名]`；`StructureManager` 求解记录时注册进 `sm.chests` Map（**只增不减、幂等，不受布局缓存 LRU 驱逐影响**，与 recordsNear 缓存机制不同）。玩家打开箱子时 `World.getOrOpenContainer` 才按 `(seed, 表名, 坐标)` 生成 27 槽 loot；查不到注册 = 玩家自放箱子 = 空容器。`chestLoot`/`villagerTrades` 是纯函数（loot.js），任何改动都会改变全服所有箱子内容——两端一致性的根基，勿引入 Math.random。
- **联机容器同步**：`container_set` 整箱 27 槽 last-write-wins（与方块账本同策略）；服务器 `sanitizeStack` 将 count<1 清为 null 空槽（曾钳到 1 出过幻影物品，勿改回 Math.max(1,...)）；挖箱 `block_set id=0` 时服务器顺带删容器账本（内容散落由挖掘方 drop_spawn 上报，其他端不重复散落）；joinRoom 回放容器账本（只回放动过的箱子）。客户端收到远端挖箱（applyRemoteBlock）要清本地容器 + 关开着的 ChestScreen。
- **TradeScreen 交易种子**：`villagerTradeSeed(ax, az, i)` 是单机与 mob_spawn 广播共用的唯一派生函数——**勿在调用处各自造哈希**（两端表不一致即 bug）。`createMobFromNet` 接收广播值；`spawnMob` 内位置哈希只是旧广播/命令面板的兜底。村民不进存档 → 交易进度也不持久化（会话内），与村民生命周期一致。
- **新建型 UI 惯例**：ChestScreen/TradeScreen 与 InventoryScreen 同组——`start()` 重建、`_disposeWorld()` dispose；ChestScreen 保存 document 监听器引用并在 dispose 移除（InventoryScreen 的 document mousemove 监听器有跨存档残留，属存量问题）。E/ESC 关闭 + `pauseOnUnlock` 防护 + 世界输入 gate（B30 轮 8 步 8 起在 `InteractionController`，经 `g._anyInputBlockingUI()` 现取）三处都要挂新 UI 的 visible 检查。
- **测试**：`tests/loot-determinism.mjs`（5 表确定性/交易表发散/51 箱坐标-表名-方块三向一致/两端 chests 注册表一致）与 `server/test-t5.mjs`（容器协议 14 断言含脏包消毒/挖箱清账/回放/tradeSeed 透传/store 落盘）均接入 `run-all-tests.sh`。

### W 批次备忘（防回退）—— 水面叠加修复 / 建筑显示与探索 / 自然洞穴

- **水面"区块边界"两段真因（均已修，勿回退）**：① α 叠加——视线先后穿过两片分离水体（近滩+远海）时 α=0.7 叠 ~91% 遮盖，opacity 已降 0.48；② **雾距大于加载边界（W1 二次修复，主因）**——旧 fog near60/far160 而 6 区块加载圈只有 96 格，方形边界在雾起效前硬截断，"固定距离+直线+跟随玩家"即此（浅滩等高线不会跟随玩家）。现 `Settings.applyFogRange(fog, renderDistance)`：near=dist×0.5、far=dist×0.95，applySettings 与 Game.update 出水恢复**必须同源调用**（出水分支曾写死 60/160，改渲染距离即复发）；VideoSettings 改距离经 applySettings 自动联动。定位手法：先查 `scene.fog.far` 与 `settings.renderDistance×16` 的相对大小，再看水 mesh/α。
- **洞穴雕刻不变量（terrain.js W3）**：三通道 3D Simplex（seed+6/7/8），世界对齐 4 格采样网格 + 三线性插值——**采样点必须世界对齐**（跨区块连续的根基）；判定 = 意面 `a²+b²<0.006` 或奶酪 `c>0.66`；保护 = y<4 不挖 + 水面列（height<SEA_LEVEL+2）水下 6 格壳（防湖海倒灌，cave-determinism 有断言）+ y≤10 空腔填岩浆。密度锚点：空腔 6-7%、露头 2.3-3.4% 列、单区块 +0.6ms。改阈值先跑漏斗统计（`node` 双 seed 扫 17×17 区块）。
- **ringPoints 唯一来源**：`stronghold.js` 导出的环带 3 点计算同时供选址（ringAnchor）与命令面板探索列表——公式改动会移动全世界要塞，两处必须共用同一函数（loot-determinism ⑤ 有锚点一致性断言）。
- **建筑归属查询**：`structureNameAt` 走 recordsAround（抗 LRU），InfoBar 内部 0.5s 节流（performance.now，update 无 dt 参数）；CommandPanel 探索区在 `show()` 时重建（村庄 ±3 cell 扫描 + 要塞 O(1)），新增结构类型在 structureNameAt 加一个分支即可。

- **行走卡顿三件套（W-卡顿批次）**：① `LightEngine.initChunkLight` **价差入队**——只把"光照 <15 的格 + 与已处理邻列（左/后）价差 ≥2 的边缘格"入队 BFS，旧版全量入队 5 万+格致 48ms/块（跨区块行走 690ms/帧卡顿主犯），新版 2.2ms（22×）；对照验证：653 万格仅 0.09% 差异且**全部 +1**（新版传播是旧版超集，修复了旧版链式横向光漏一级的缺陷）。**勿回退全量入队**；改光照传播逻辑必须跑 node 新旧对照（653 万格 dark/哈希+单调性）。注意：光照 forward/reverse 顺序本就不幂等（存量，纯视觉不进存档/协议）。② `updateChunks` 分帧预算：缺口按距玩家排序、每帧限时 8ms（至少 1 块）；③ `rebuildDirtyChunks` 时间预算 12ms（洞穴后单块 mesh ~15ms，固定 2 个/帧会叠出 29ms）。实测跨边界：单帧 690ms → 13 帧×≤33ms 渐次补完。已知尖峰残余：30s 自动保存序列化长探索存档的单帧尖峰（未处理）。

### 生物群系规模批次备忘（防回退）—— 小/中/大/巨大 档位（world/biome-scale 批次）

- **档位定义**：`biomes.js` 导出 `BIOME_SCALES`（small freqMul=1.0 / medium=0.55 / large=0.35 / huge=0.22）+ `DEFAULT_BIOME_SCALE='small'` + `safeBiomeScale()` 清洗。**small=1.0 必须与旧版逐字节一致**（`getBiome` 全部频率 `× biomeFreqMul`，IEEE754 乘 1.0 精确无损）——旧存档/旧联机世界/全部确定性测试依赖此锚点；调任何档位数值先跑 `tests/biome-scale-determinism.mjs`（② 断言守护）。
- **只缩放群系布局噪声**（river/mountain/temp/humid/mushroom/sunflower 六组），**洞穴频率与基础地形噪声不缩放**（群系布局 ≠ 地形细节，与原版语义一致）；改动频率集合注意同步测试 ③ 的连通占比单调断言。
- **签名链（6 环一次改齐）**：MenuScreen `selectedBiomeScale`（单人页/LAN 页控件共享状态，仅对新建生效）→ `onStart` 第 6 参 → `Game.start` 第 7 参（有 loadData 走 `loadData.biomeScale`，与 cheatsEnabled 同款）→ `new World(seed, dim, {biomeScale})` → `dimDef.createGenerator(seed, opts)`（仅 overworld 消费，其余维度忽略第二参）→ `TerrainGenerator(seed, biomeScale)`；联机侧 `world_info`/`restart_world` 事件 payload 直透 msg 字段。
- **联机语义与 seed 同款**：房间 `biomeScale` 首次开房固定（`Room.createRoom` 仅 `this.biomeScale===null` 时写），重复开房/加入/重启恢复（store 快照 + `Room.restore`）不得覆盖；3 处 `WORLD_INFO` 发送都必须带 `biomeScale: this.biomeScale`，漏一处即该路径加入者群系与房间其他端分裂。测试断言在 `server/test-mp.mjs`（回传/跟随/重复开房不改档）。
- **换维必须透传**：`_composeSwitchLoadData` 带 `biomeScale: this.biomeScale`，`_resolveArrivalY` 的临时生成器直调 `createGenerator(seed, {biomeScale})`——漏传=传送门落点按 small 群系算，与实际世界（large/huge）地形不符，落点悬空/嵌墙。
- **存档**：`SaveSystem.save` 写 `data.biomeScale`，`listSaves` 返回读档显示（旧档无字段回落 small，不回写）；菜单槽位仅非 small 显示「群系:X」。
- **冒烟锚点**：新建 huge 世界 eval 断言 `game.biomeScale==='huge' && world.generator.biomeFreqMul===0.22`；联机 host 选档后 join 端 `biomeScale` 自动一致、两端 `generator.getBiome(同坐标)` 同值。

### B25 批次备忘（防回退）—— 树让位结构 / 村庄耕地麦田 / 全景禁结构

- **树让位机制（Build 25）**：`StructureManager.footprintsNear(cx, cz, margin=3)` 复用 decorateChunk 的 cell 扫描与记录缓存（纯查询不写块，确定性、区块顺序无关）；`generateChunk` 在树 pass 前取足迹盒传入 `generateStructures(chunk, footprints)`，树/巨型蘑菇判定加 `!inFootprint(wx, wz)`。**margin=3 的依据**：树冠半径 ≤2（橡木球状/云杉层状最大 r=2）+ 树干让位 → 树冠最远 bbox+2，建筑本体与外扩 1 均零树冠（build25-fixes 行为断言）；**回归验证盒只能用 bbox 本体或外扩 1**，bbox+2~3 出现树冠属预期（树站在足迹外 4 格、树冠伸到 +2 是合法风景），勿误判为漏。守卫放在 rand() 判定之后：footprints 为空的区块植被 rand 流与旧版逐字节一致；足迹覆盖区块内命中列之后的植被序列移位（村庄周边本就清场，无碍）。
- **村庄农田（Build 25）**：`buildFarm` = 原木边框 + 中央水渠 + farmland 耕地 + `wheat_crop_0..7`（`Math.floor(rng()*8)` 抛签）；farm 是村庄 rng 流的最后消费者，其内 rng 消耗次数变化不影响房屋/道路/料堆布局；`ID.melon` 已移除（别处勿再引用）。旧 seed 农田方块因此变化属本批明确要求。
- **全景禁结构（Build 25）**：`StructureManager.disabled`（decorateChunk 开头短路）只影响装饰写入，**不影响记录查询**（chestTableAt/recordsAround 照常）——烘焙世界 `world.generator.structureManager.disabled = true` 后画面零建筑。全景机位：`FACE_PLANS` 六群系各一面（蘑菇岛/沙漠/向日葵平原/针叶林/积雪针叶林/沼泽）+ `pickBiomeSpot` 纯函数环形扫描（步长 24、maxR 6000、八向探针同群系+陆地+平整）+ `avoidWaterYaw`；**per-face 生命周期**（prepareFace 加载±5→建mesh→拍→releaseFace dispose+`world.chunks.clear()`）控制内存峰值=单机位；`Sky.update(0.016, faceCenter)` 每面落地天穹。烘焙时长 15s→~2 分钟（6 机位各自加载）属预期。
- **全景单机位返工（Build 25 内修复，用户验收后返工）**：六面独立机位（每面一个群系）造成 cubemap 接缝"极其突兀的分界"——播放器贴球面旋转时跨面跳变不可接受，**全景必须同一地点拍摄**。返工方案：`pickPanoramaSpot` 单机位多群系交界选点（蘑菇岛斑块锚点周边 0~96 格找交界带，多样性 24 探针 distinct 打分 + 蘑菇入镜优先 + 低地优先 `-(h-76)*20` + vantageOk 陆地平整 `h≤84` 排高山顶），六面共享一个 center（固定 FACES 方向 + 水平面各自基准方向绕 y 轴旋转避水 yaw）。**高陷阱：水平面旋转必须按各自基准 dir 旋转（`dir[0]*cs + dir[2]*sn`），不能整体替换成 `[cos yaw,0,sin yaw]`——否则 yaw=0 时四张水平面字节级相同**（实际踩到）。相机高度只取脚下 ±3 格 max（大范围 ±10 max 会把 10 格外山体算进机位 → "山顶俯瞰雾中远景"，画面大半是雾）；fog near 30→38（多样性远景更清晰，far 90 遮边缘不变）。seed 20250903 选中点 (16,-28)，周围 24 探针 8 类群系（蘑菇岛/高山/平原/针叶林/河流/沙漠/沼泽/桦木森林）。
- **seed 类型陷阱重申（冒烟必查）**：node 验证用数字 seed（`20250903`），游戏菜单/`game.start` 传字符串（`'20250903'`）——**完全不同的噪声场与村庄位置**。浏览器冒烟坐标与 node 断言对不上时，先核对两侧 seed 类型是否一致（本批实际踩到：字符串世界同坐标 farmland=0）。

### 群系扩展批次备忘（防回退）—— B1 基建/高山/桦木森林/针叶林（B2 沼泽、B3 向日葵平原+蘑菇岛待做）

- **BiomeConfig 参数化高度（勿回退硬编码）**：`getBaseHeight` 群系调制全部查配置——`heightScale`（fbm 振幅）/`heightOffset`（固定抬升，原雪原+8/沙漠-2 已迁入）/`peakBoost`（高山超出 MOUNTAIN_T 的余量加成，山脊越核心越高）/`snowLine`（≥ 此高度表面铺雪块+顶部雪层）/`gravelPatch`（detailNoise>0.55 成片置换表面为砾石）。新增群系先填这些字段，勿在 terrain.js 加 if 分支。
- **判定链优先级（getBiome）**：河流(ridge<0.06) → 高山(mountainNoise.fbm2D 0.0035 > 0.45，可出现在任何温区) → 沙漠 → `temp<-0.3` 按 humid 分积雪针叶林(>0)/针叶林(≤0) → 温和带 humid∈(0.05,0.25)=桦木森林 → 平原兜底。**B2 沼泽插在高山区之后、沙漠之前（temp 温和带 && humid>0.25）；B3 蘑菇岛用独立罕见噪声插在最前（河/高山之后）；向日葵平原 = 平原带 variant 噪声**。mountainNoise 用 seed+9（terrain.js 现占 0-8；维度系列用 seed*31/37/41 乘法系不冲突，新增继续取空闲加法偏移）。
- **字符串 seed 拼接陷阱（冒烟必知）**：菜单传入的 seed 是**字符串**（如 '42'），TerrainGenerator 内 `seed+N` 是字符串拼接（'42'+9='429'）→ 游戏内噪声场 = node 里 `new TerrainGenerator('42')`（字符串），与 `new TerrainGenerator(42)`（数字）**完全不同场**。node 找冒烟坐标必须用字符串 seed；联机两端 seed 类型须经协议保持一致（既有行为，两端一致即确定性成立）。主世界 getBiome/getBaseHeight 每列被 getBaseHeight 与 generateChunk 重复求值属既有模式，新增噪声同样直接复算即可。
- **测试**：`tests/biome-determinism.mjs`（同 seed 双次一致 / 顺序无关 / 七群系占比区间（**河流细线状基线 ~0.3%，区间下限勿设 1%**） / 高山峰顶>100+均高>平原+15 / 相邻列连续性（非山≤12、高山≤30 陡峭属预期） / 耗时）已接入 run-all-tests.sh；改判定/阈值先跑它再冒烟。
- **冒烟锚点（seed '42'）**：高山 (-2000,928) 峰 106 雪顶 / 桦木森林 (-2000,-1984) / 针叶林 (-2000,-1976)；高山冒烟先传 y=130 等落地（getHeightAt 对未生成区返回错误值），断言 InfoBar 群系名+地表方块名+周围 log 统计。
- **B2 沼泽（勿回退要点）**：判定 = 温和带 `temp∈(-0.1,0.35) && humid>=0.25`（插在高山区之后、沙漠之前，抢占平原高湿区，占比锚点 ~11%）；`swampNoise`(seed+10) >0.55 的列 getBaseHeight 压到 SEA_LEVEL-1 形成零散水塘（水洼率锚点 ~27%）；`pondClay` 水下列表面铺粘土；睡莲 `lilyPadChance 0.06` **必须放在顶层水格 `chunk.get(x, SEA_LEVEL, z)===WATER`——勿回退 `surfaceY+1`（水洼深 2 格时会沉到水下，曾真出）**；水塘列自动受洞穴水面保护壳（height<SEA+2）防倒灌，无需新增规则。
- **cross 顶点索引错位（高危渲染 bug 已修，勿回退）**：`addCross` 画 2 交叉面共 8 顶点且内部 `idx+=4`×2，**调用处必须接收返回值 `idx = this.addCross(...)`**——旧写法调用后只 `idx+=4`，cross 之后整个区块所有方块索引引用错位 4（最小实验：火把+石头 maxIdx 27≠31 实锤）。新增特殊 renderType 一律仿 portal/flat 模式：**方法返回推进后索引，调用处接收**。flat（水平薄板，睡莲）顶面微抬 y+1.002 防与水面贪心合并顶面 z-fighting，正反双面索引（水下仰视可见）。
- **冒烟锚点（seed '42'）**：沼泽 (-2000,-1616) 水塘+睡莲；lily_pad 方块 solid:false+transparent（穿过落水、不挡光、邻水面剔除正确）；`renderType:'flat'` 方块不走 6 面剔除循环（build 循环 early-continue），无邻居剔除交互。
- **B3 向日葵平原/蘑菇岛（勿回退要点）**：向日葵平原 = 平原带变体（`temp∈(-0.3,0.35) && humid<0.05 && sunflowerNoise(seed+11)>0.55`），**判定插在桦木森林之前**（条件含 humid<0.05 保证不蚕食桦木带，占比锚点 ~1.6%）；蘑菇岛 = 罕见独立区（`mushroomNoise(seed+12)>0.62`，插在高山区之后沼泽之前与温湿无关，占比锚点 ~2.2%）。蘑菇岛无普通树（treeChance 0）+ 菌丝体地表（top/side 双纹理+复用 dirt 底）+ 巨型蘑菇 `placeMushroom`（柄 2-4 格柱 + 顶层 3×3 盖，红/棕由 `(x*31+z*17)%2` per-position 哈希定——确定性）+ 地面小蘑菇 cross。全部新方块确定性像素画（hash2，无 Math.random），seed 编号 116-123 续接。
