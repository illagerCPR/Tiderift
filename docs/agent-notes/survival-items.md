# Agent 备忘 · 生存与物品

> 本文件内容为 AGENTS.md 批次备忘**原文搬移（未改写）**，用于控制 AGENTS.md 体积（会话注入预算 65536 字节，超限会被静默截断）。
> 导航见 AGENTS.md「批次备忘索引」；新批次备忘按主题追加到对应小节，并同步更新 AGENTS.md 索引表。

### P0 进度链批次备忘（防回退）—— 燧石/打火石/岩浆缘黑曜石（下界门生存闭环）

- **生存获取链全景**：砾石挖掉 10% 掉燧石（`Game._blockDropName`，`Math.random` 允许——掉落非世界账本，无确定性约束）→ 铁锭+燧石 shapeless 合成打火石 → 黑曜石自然生成于深层岩浆池缘 → 点火下界门。**新特殊方块掉落一律加在 `_blockDropName` 分支，勿在调用点散写**。
- **岩浆缘黑曜石（terrain.js）**：实心格 6 邻域存在岩浆腔 + `hash32(wx,y,wz,OBSIDIAN_SALT)%1000 < OBSIDIAN_P*1000` 置换（盐 7717/概率 0.07，改动会移动全服黑曜石——两端同版本）。先 hash 后邻域省 93% `_isCave` 开销。
- **`_lavaNeighbor` 竖向两向必须带门**（探针实测 badAdj 曾 6-8）：`y-1 ≥ CAVE_MIN_Y`（之下不 carve）且 `y+1 ≤ CAVE_LAVA_LEVEL`（之上 carve 是空气不是岩浆）——只查"carve 即岩浆"的深度带。height 传哨兵 999 合法：`_isCave` 的 height 仅用于水面壳门，深带（列高恒 >16）天然不触发，跨列邻居无需重算列高。
- **`_buildCaveField` 网格域已扩为 7 点（[x0-4, x0+20]）**：邻域判定含越出区块 1 格的邻居，5 点域在边界会插值错段；网格点世界对齐纯函数——扩域只增点不改原值，内部区块判定逐字节不变（cave/structure/dimension 确定性测试均绿）。
- **黑曜石 hardness 50→12**：当前挖掘速度无工具加成（`dt/hardness`），50s 不可玩；P1 工具速度系统落地后可回调。
- **flint 曾是"幽灵物品"**：fortress 战利品表一直引用 flint 但从未注册（箱子渲染空图标本 bug）——现已在 ItemDefs 注册（stack 64/燧石），表条目自动生效。
- **验证锚点**：seed42 6×6 区块 obs≈160/badAdj=0（seed7 obs≈200）；cave-determinism 11MB 字节一致、structure 71MB 正逆序一致、dimension 4 维×2 seeds 全绿；单区块生成 5.7-6.8ms（锚点内）。

### P1 批次备忘（防回退）—— 挖掘工具系统（速度/等级门控）

- **挖掘速度**：`breakingProgress += dt * speedMul / hardness`；speedMul **只看类型匹配**（`held.tool === def.tool`），tier 速度表 `TOOL_TIER_SPEED`={1:2,2:4,3:6,4:8}，**金质单独 9×**（原版金工具快但等级低）。剑不算挖掘工具（`_heldToolItem` 排除）。
- **掉落门控**：`def.minTier > 0` 时须工具类型匹配且 `held.tier ≥ minTier` 才掉落——**徒手/低级工具仍能挖碎，只是不掉**（原版式）。判定收口在 `Game._blockDropName`（返回 null=无掉落：单机不进背包、联机不发 drop_spawn）；特殊掉落（gravel→10% flint）也在此分支。
- **minTier 布局**：stone/深板岩/煤/石砖系/砂石系/熔炉=1；铁/铜/青金石矿=2；金/红石/钻石/绿宝石矿=3；黑曜石=4（仅钻石镐）。矿物块：铁块 2/金块·钻块 3。**金工具 tier=1**（ItemDefs toolMaterials，与 wood 同级）。
- **BlockRegistry.register 是白名单**——方块 def 新增字段必须在 register 里显式透传，否则静默丢弃（minTier 曾被吞，行为全错只有注册表探针能抓到；勿只看 BlockDefs 源码就以为生效）。
- **生存初始包自带木镐**（快捷栏槽 0）——agent-browser 验证"徒手挖掘"必须先 `inventory.hotbarSelected = 空槽`，否则速度/掉落断言全错。
- **本作石头掉 `stone` 不是 cobblestone**（cobblestone 是 stone 的合成/熔炼产物）——掉落断言勿写 cobblestone。

### P1 批次备忘（防回退）—— 盔甲系统（4 部位/装备槽/减伤）

- **物品面**：`{mat}_{helmet|chestplate|leggings|boots}` 16 件（leather/iron/gold/diamond），def 带 `armorSlot: head|chest|legs|feet` + `armorPoints`（原版点数：皮 1/3/2/1、铁 2/6/5/2、金 2/5/3/1、钻 3/8/6/3）。**ItemRegistry.register 同样是白名单**——armorSlot/armorPoints 曾被静默丢弃，新物品字段必须显式透传（与 BlockRegistry 同款陷阱）。
- **数据面**：`inventory.armor[0..3]`；serialize() 已升 V2 对象形 `{slots, armor}`——deserialize 双形兼容（旧数组形=仅 slots），**勿把数组形分支删掉**（旧存档全靠它）。`inventory: game.inventory.serialize()` 的全部消费方（SaveSystem / 换维 _buildSwitchLoadData）都走本地 deserialize，服务器不感知该形状（死亡掉落是独立的 drops 列表）。
- **减伤**：`Player.hurt` 内 `amount *= 1 - min(20, armor) * 0.04`（原版公式，最高 80%）；`player.armor` 由 `Game._armorPoints()` 每帧从装备槽汇总（4 格查表）。
- **UI**：InventoryScreen 顶部行 = 合成区 + 盔甲 2×2（`data-slot="armor-0..3"` 顺序=头/胸/腿/靴）；左键=光标**对应部位**盔甲穿上（旧甲回光标）/光标空脱下，不匹配部位或普通物品**静默拒绝**——绑定在 `bindArmorSlotEvents`，与 bindSlots 全量刷新同生命周期。
- **死亡掉落**：联机死亡 drops 含盔甲（NetworkManager.sendPlayerDied 追加 armor 项）+ 死亡端清空 armor；SP 死亡不掉落（与背包行为一致）。
- **HUD**：armorRow（盾 SVG ×10，每盾 2 点，奇数点末位暗盾）在 bottom:104px，氧气 airBar 已上移 122px 防重叠；hideAll/创造/旁观分支都要隐藏 armorRow（跨存档共享实例残留陷阱）。

### P1 批次备忘（防回退）—— 经验系统 / 龙蛋

- **经验来源与口径**：击杀（MobTypes 新增 `xp` 字段：普通怪 5 / 烈焰人 10 / 龙 500；村民无）+ 挖矿（`ORE_XP` 表：煤1/红石2/青金3/钻7/绿宝7，铁金不给——原版口径）+ 经验瓶右键饮用 +3~11。**击杀经验 = 掉落同口径**：只奖励击杀端（`!mob.remoteDeath`）且 `mob.playerHitAt`（attackMob 内打点）5 秒内——仇恨杀村民等不给；创造模式不加（`onMobXpAward` 回调里 survival 门控）。掉落被 minTier 门控拒绝时挖矿经验也不给（与原版一致）。
- **进位公式**：`Player.addXp` 每级需 `level*10+10`（与 Hud 进度条 `need` 同式，改一处必改两处）。
- **龙蛋**：`_placeDragonEgg` 挂 `_activateEndRewards`（与返程门/折跃门同链）——主岛中心 (0,0) 从 y=80 下扫首个实心格顶面放置；真实方块进账本可挖走。dragonDefeated 标记保证单次。**注意（B30 轮 8 步 2 实测）**：它**并非幂等**——第二次调用会在已有龙蛋正上方再叠一枚（下扫遇到的第一个非空气格正是上一枚蛋），源码注释「幂等」与实测不符；现状由 `tests/game-behavior.mjs` 的 J7 按现状钉住，修幂等须同步改 J7。实现位于 `src/player/Endgame.js`。

### P2 批次备忘（防回退）—— 床（睡眠/重生点）/ 掷眼寻要塞

- **床**：方块 `white_bed` 早已注册（无物品注册，hotbar 直接挂方块名即可放置）；配方 3 羊毛×3 木板（`white_bed`，2x3）。右键床 = 记录 `game.bedSpawn {x,y,z,dimension}` + 夜间（`sky.isNight()`）`sky.time = 0.25` 跳日出。**交互分支挂在 furnaceDef 同名选择器链上**（selectedBlock 的 def 检查 `name === 'white_bed'`），位于熔炉分支之后。
- **床重生**：仅**单机**生效（联机重生位置由服务器协调，勿放开）且 `bedSpawn.dimension === world.dimension` 才用；respawn() 里替换 `world.getSpawnPoint()` 分支，站位 = 床位 +0.5/+1/+0.5（与"建门层高=立地面"同语义）。
- **掷眼**：`_throwEnderEye`（环带 3 锚点取最近 + 八方位提示）→ `eyeFlight {mesh,dir,t,total:2.5}` 在 Game.update 步进，落地 80% 落回/20% 碎裂（Math.random，原版概率）。**方向数组必须从'北'起顺时针**（`atan2(dx, -dz)`，北=-Z）——曾从'东'起全错位。**扔出分支必须在 hit 守卫之外**（对空掷出是原版手势）——顺带修复了 `if (sel)` 块无 hit 守卫、对空右键必崩的存量隐患（`if (sel && hit)` 勿回退）。（B30 轮 8 步 3 起 `_throwEnderEye`/`_updateEyeFlight` 实现在 `src/player/Projectiles.js`，Game 侧同名门面；`eyeFlight` 容器与「start() 重置」的清理仍属 Game。）
- **start() 重置**：`bedSpawn = loadData.bedSpawn || null`（新档 null）+ eyeFlight mesh 残留清理（scene remove + geometry/material dispose）——都是共享 Game 实例字段，换维重建/重开必须清。

### P3 批次备忘（防回退）—— 桶（舀/倒） / 弓射击

- **桶**：Raycast.cast 加第 4 参 `includeFluid`（空桶手持时 updateRaycast 传入 → 准星可命中水/岩浆；其他物品准星仍穿透流体——勿全局开）。空桶对流体=舀取（setBlock 0 + 槽换满桶）；满桶对面=倒出邻格（必须空气，非空气静默拒）+ 槽换空桶。**槽位替换直接写 `inventory.slots[hotbarSelected]`**（不是 remove+add，防落到别的槽）。本作水体静态无流动模拟——舀水留洞/倒水不成流属设计边界。岩浆倒出经 LightEngine 自动给光 15。创造模式：世界可编辑但槽位不变。
- **弓**：Idea-2A 改**按住蓄力、松手发射**（原右键即射已废）——初速 `28×(0.3+0.7c)`、伤害 `2+round(6c)`（`_shootArrow(power,dmg)`，箭对象带 `dmg`，`_updateArrows` 用 `a.dmg||6`）。蓄力通道**独立于右键单击分支**：`Game._bowCharging/_bowCharge`，handleMouseInput **顶部**先于 UI 早退处理（松手检测必须在 UI 早退之前，否则 mouseup 漏检）；蓄力中吞掉全部右键分支防中途误触；换手持物/开 UI（背包/箱/熔炉/交易）/暂停(loop else 分支)/进观战四路取消（`_cancelBowCharge`）。对准可交互物时单击分支仍优先（走到弓分支才起蓄力）。**对空蓄力依赖 handleMouseInput 未命中早退的放宽**：`!(mouseRight && bowLikeHeld)`（bow/ender_eye）——勿回退该守卫。第一人称拉弓姿态 `FirstPersonHand.bowDraw`（`setBowDraw(0..1|null)`，满蓄轻微颤动）。消耗 arrow×1 移到 `_releaseBow`（创造不耗）。headless 软渲染下 charge 走帧 dt，墙钟慢 3-4 倍属环境帧率问题非 bug。箭本体仍是本地投射物 `{mesh,pos,vel,life:8,stuck,dmg}` 重力 -12，命中怪走 `findMobByRay`→`attackMob`（击退/掉落/XP 复用）、命中实体块钉住至寿命尽；几何/材质模块级共享不 dispose；`arrows` 数组 start() 无条件初始化（曾漏而炸循环）。（B30 轮 8 步 3 起 `_shootArrow`/`_releaseBow`/`_cancelBowCharge`/`_updateArrows`/`spawnRemoteArrow` 实现在 `src/player/Projectiles.js`，Game 侧同名门面；`_bowCharging`/`_bowCharge` 与 `arrows` 数组仍属 Game。）
- **右键分支顺序**：villager→furnace→床→crafting→红石→frame→(hit 内)桶/打火石/末影眼框→放置 `if (sel && hit)`→(hit 外)弓（蓄力起点）→掷眼。弓/掷眼分支不依赖命中（对空可用——依赖守卫放宽，见上）。

### P3 批次备忘（防回退）—— 耕种（锄地/播种/生长/收获） + Raycast cross 命中修复

- **方块三件套**：`farmland`（耕地，shovel 0.6，全面深湿土纹理）、`wheat_crop_0..7`（8 阶段 cross，阶段=独立方块 id，**不依赖 id 连续**——`src/core/crops.js` 惰性查表 `CROP_STAGE_IDS`，增删作物 id 必须同步该表）、`tall_grass`（草丛 cross，**种子主来源**：`grassChance` 装饰分支已填实——曾只是"用雪层占位"的空壳，破坏 40% 掉 wheat_seeds）。
- **生长架构（勿改成每帧随机刻）**：阶段本身是方块 id（随存档持久化）；`world.cropMap`（key "x,y,z"）是**易失运行期登记表**——`World.setBlock` 末尾钩子 `onCropBlockChange`（Game.start 注入 `_trackCrop`）全路径收口（种/长/收/破坏/远端 block_set 自动维护）；`ensureChunk` 末尾**重载扫描**（有监听者才扫，65k/chunk ~0.3ms）把田里现存作物登记回表。Game.update 每 **8s 一拍** `_growCrops()`：随机推进 1 段（`Math.random` 允许——host 权威+非世界账本），**水分加成** `isHydrated(world, x, y-1, z)`（耕地层 9×9 有水，概率 0.3→0.6）。
- **联机门控**：`networkMode && !net.isHost` 客户端不跑生长（host 权威，与 mobManager.spawnEnabled 同款策略）；host 的生长 setBlock 经 `onLocalBlockChange` 自动广播，客户端不用写生长逻辑。
- **右键链**：`_tryFarmInteract(hit, targetDef, sel)` 挂在 ender_eye 之后、放置分支之前，内部顺序 = 骨粉催熟(+1..+3 段)→ 成熟收获(破坏+`_blockDrops` 掉落)→ 播种(种子对耕地，上方须净空)→ 锄地(`item.tool==='hoe'` 对 grass/dirt，上方须空气)。上方是**非固体装饰（雪层/草丛）**时锄地/播种会先清掉它再落子（水下 dirt 被正确拒绝——出生点浅水边实测）。
- **⚠ Raycast cross 命中修复（存量缺陷，勿回退）**：旧条件 `def.solid && !def.fluid` 使**全部 cross 方块被准星穿透**——火把拆不掉、石按钮点不着、作物/草丛无法交互。现 `!def.fluid && (def.solid || def.renderType === 'cross')`；流体仍仅空桶 includeFluid。副作用核查过：对 cross 放置按 normal 贴边（原版对花同款）；紫颂/折越门无射线依赖（穿越走站立检测）。
- **掉落列表化**：挖掘调用点从 `_blockDropName`（单名）改为 **`_blockDrops`（[{name,count}] 数组）**——成熟=小麦×1+种子 1-3、未熟=种子×1、草丛 40% 种子或空；其余方块委托 `_blockDropName` 包装成单项。**勿删 `_blockDropName`**（gravel flint/minTier 门控仍在其中）。
- **配方/战利品**：`addShapeless('bone_meal', 3, ['bone'])`；village_big 加 `['wheat_seeds', 2, 5, 8]`。bone_meal 与 bone_meal_item **双注册共存**（历史遗留），交互分支两个名字都接受。
- **验证锚点**：草丛密度 grassChance 0.3 ≈ 7 株/chunk（169 chunk 1200 株实测）；生长对照桩——`Math.random=()=>0.35`：无水不长/放水后长（0.3<0.35<0.6 的窗口设计即为此对照）；重载断言 `cropMap.has(key)`。**cropMap 存的是作物层坐标（y=作物格）**，不是耕地层——探针别读错层。


- **装备面**：elytra def 带 `armorSlot: 'chest'` + `armorPoints: 0`（穿胸甲槽、不减伤，`_armorPoints` 对 0 点数自然跳过）；来源 = 末地船船长箱（FORCED 保底）。无耐久系统（盔甲系整体无耐久，elytra 同）。
- **滑翔状态机分两层（勿合并）**：① `Game._updateGlideFold()` 每帧在移动分支**之前**调用（update 开头，`_updateWaterState` 之后）——没穿/创造飞行/旁观/在水中/在地面 → 折叠；② `_updateGlideAero(dt)` 在移动分支 else-if 链调用（返回 true 时**不覆写水平速度**，动量主导）。分两层的原因：入水走游泳分支根本不进移动滑翔分支，若折叠只在 aero 里做，入水后 gliding 残留 true。
- **⚠ 展开抖动陷阱（曾真出）**：站立时每帧重力使 vy=-0.533，恰低于展开阈值 `GLIDE_DEPLOY_VY=-0.5` → 落地后每帧"fold 折叠 ↔ aero 展开"抖动、HUD 恒亮。修复：aero 展开前置条件**必须含 `!p.onGround`**（站地面不展开；走下悬崖/跳过 apex 正常展开）。
- **摔落伤害修复（存量死代码，本批修复）**：`moveAxis` y 轴落地把 `velocity.y` 清零，旧写法 `onGround && velocity.y < -15` 永假——摔落从未生效。现 `Physics.collide` 在 moveAxis 前**捕获冲击速度** `entity.impactVy/impactVh/wallCrash`（每帧开头重置），Game 侧读 `impactVy` 结算（`floor(-vy/3-3)`）。25 格坠 ≈ 扣 10 血。
- **滑翔禁用 auto-jump（moveAxis `!entity.gliding` 门控，勿删）**：否则俯冲撞山坡被逐级抬升"漂移爬山"（实测 20s 悬停 y 卡 97），撞山应走碰撞回退 → wallCrash 伤害停滑（原版语义）。撞墙：`wallCrash` 在 x/z 清速度前记录（阈值 8 m/s），Game 侧 `hurt(floor(speed/4))` 并折叠；撞停后仍在空中会重新展开（原版式，伤害只结算一次）。
- **气动参数（B30 轮 8 起在 `src/player/GlideWind.js` 顶部常量，实测锚点；滑翔/气流域实现在该模块，Game 只留同名薄门面 `_updateGlideFold`/`_updateGlideAero`/`_updateUpdraftState`/`_hasGaleCloak`/`_writeGaleColumn`/`_clearGaleColumn`，生命周期＝构造器共享型：零状态、无资源收口，世界/背包/HUD 一律在调用点经 `this.game` 现取，勿改成构造期快照）**：THRUST=8 / DRAG=0.994 / BRAKE=0.5 / LIFT=6 / DEPLOY_VY=-0.5；`GLIDE_GRAVITY=-9` 与**动态下沉上限** `-3.9/(1+vh*0.10)`（飞得快下沉缓——否则每次拉起都要先从 -3.9 深坑爬出，翱翔出不来）在 Physics.js（GLIDE_GRAVITY **导出**供 Game 升力上限引用）。锚点：俯冲 3s 8→10 m/s、极速 ~27；拉起（vh 9.5, pitch 0.5）爬升 ~4 格、vy 峰 +3 后失速；升力模型 = `sin(pitch)·vAlong·LIFT` 超过重力才净爬升（鼓励"俯冲攒速→拉起翱翔→失速回落"循环）。**CLIMB 混合/上旋模型已被升力模型替换**——混合模型被 collide 侧重力对抗压回负 vy（稳态 targetVy - 0.15/blend），勿回退。
- **HUD**：`hud.setGliding(on)` 开关 `glideTag`（准星下方偏上"🪂 鞘翅滑翔中"）；hideAll/start/respawn 三处都要隐藏（Hud 跨存档共享）。
- **验证手法**：滑翔读 `p.pitch` 字段不经相机——eval 直接设 pitch 可靠（与"射线瞄准必须真实 mouse move"的陷阱不冲突）；手动步进 `g.running=false + g.update(1/60)`；落地折叠断言要在循环退出后**再补一帧 update**（fold 在帧开头，落地帧内不折叠是正确时序）；断言"站立零抖动"跑 60 帧数 gliding 翻转次数（应为 0）。

### B27 批次备忘（防回退）—— 床/门/活板门形制（状态 ID 家族 + shape AABB + 睡眠体验）

- **状态 = 独立方块 ID 家族（沿用 B26 流体"等级=ID"模式，勿改回 metadata 副数组）**：门 32 状态（oak/iron × lower/upper × 4 朝向 × 开合，合计 16/材质）、活板门 8、床 8（头尾 ×4 朝向）。**base 本名保留旧语义**（`oak_door`=下半/朝北/关态、`white_bed`=床尾/朝北、`oak_trapdoor`=关态/朝北）——旧存档/联机账本零迁移。命名与 id 查询统一走 `src/core/blockShape.js`（`doorId/trapdoorId/bedId`），勿散写字符串拼接。注册总数 197/255，**再加分批前先核 Uint8 余量**。
- **BlockRegistry 白名单又添 6 字段**：`shape/part/facing/open/baseBlock`（+B26 的 fluidType）——register() 是字段白名单式重建，新 def 字段漏加白名单=静默丢弃（B26 fluidType 同款陷阱），测试必须含逐字段透传断言（build27 ①段）。
- **shape AABB 双消费者**：渲染 `ChunkMesh.addBox`（格内盒 6 面、无 AO、盒空间坐标即 UV 比例——窄条面天然取切条；**贴边内缩 E=0.0008 防与邻格同面 z-fighting**）与碰撞 `cellBox`（仅 shape 方块分配，满格路径零分配）。渲染内缩不影响碰撞（碰撞用原 shape 值）。UV 逐面映射表含镜像补偿（+Z/-X 面与实体面图案对齐），改 addBox 前先读注释表。
- **碰撞改造（勿回退到满格判定）**：`Physics.moveAxis` 与 `EntityPhysics.moveAxis` 的重叠检测+回退全部按盒边界（满格=无 shape 分支）；**auto-jump 目标位校验同样盒感知**（床 9/16 顶上不算阻挡才能走上床）。**门/活板门面板禁 auto-jump 踏越**（`maxBlockTopIsDoor` 门控）——实测坑：站在坡顶（ feet+1.0 恰好=上格门板顶）时 auto-jump 会"爬门"翻过关门，原版语义门不可踏越。`EntityPhysics.isStandingOn` 等其余 def.solid 检查点保持满格语义（导航/出生点/活塞推挡）。
- **红石切换（删除式开门已废除）**：`toggleDoor(x,y,z)` 家族判定（`def.part`）→ `setDoorOpen` 整扇上下半同步切换（从任一半调用均可）；活板门单格切换。供电 rising-edge 触发保留。新门状态全部走 `world.setBlock` → 账本/联机自动同步（零协议改动）。
- **右键链位次**：门/活板门分支插在熔炉分支之后、床分支之前——**村民交互仍在最前**（村民优先=原版语义，实测站在村口对门右键会被 4 格内村民截胡，属正确行为，测门要离村民远点）。铁门右键无动作（仅红石）；木门/活板门 toggleDoor + `audio.blockPlace`（wood 分路）。
- **形制放置 `_tryPlaceShaped`**：门=下半贴玩家近边+上半（`_facingTowardPlayer`）；床=脚+头朝远离玩家方向（`_facingAwayFromPlayer`）；活板门=关态贴近边。**任一格非空气或与玩家重叠 → 整体失败不消耗**（创造不消耗、生存扣 1）。放置路径在通用 setBlock 之前分流。**（B30 轮 8 步 6 起本段实现在 `src/player/Placement.js`，Game 侧仅同名门面 `_tryPlaceShaped`/`_facingTowardPlayer`/`_facingAwayFromPlayer`；`_cellOverlapsPlayer` 仍留 Game。）**
- **破坏连动（两处都要挂，勿漏）**：`_removeShapedPartner` 在**生存挖掘分支**和**创造瞬破分支**各挂一次（本批实测漏了创造分支——半扇门残留）。掉落 `_blockDrops` 按 `def.baseBlock` 返回 1 个基础物品（另一半连动消失不重复掉）。爆炸路径（TNT/床爆炸）不连动——残半扇门保留可开关，可接受。**（B30 轮 8 步 6 起 `_removeShapedPartner`/`_clearIfFamily` 实现在 `src/player/Placement.js`；Game 内两处调用点零 diff 未动。）**
- **床交互（原版语义集）**：非主世界（nether/end/aether）右键 → `mobManager.pendingExplosions.push({radius:3})` 爆炸（带碎屑粒子，另一半一并清除）+ 距离衰减伤害 + 聊天提示；主世界=设 `bedSpawn` + 夜间 `_hostileNearby(8)`（`!type.passive && !dead`）通过后 `sleepOverlay.show(onBlack)` 黑屏过渡 0.95s 全黑瞬间 `sky.time=0.25`（**废除瞬跳**；双层 RAF 启动 transition——display 切后同帧写 opacity 不生效，Hud.flashDamage 同款教训）。联机保持"只设重生点不跳时间"（时间权威在服务器）。
- **respawn 床失效校验**：重生时校验 bedSpawn 格仍是床（part bed_*），失效清 bedSpawn + 提示回世界出生点。仅单机 bedSpawn 生效（联机位置服务器权威，勿放开）。
- **村庄门**：`village.js` buildHouse 用 `doorId('oak_door', half, facing)` 放上下两格，face 映射 `z-→n / z+→s / x-→w / x+→e`（面板贴外墙面）。旧存档村庄区块重生成时自动获得双格门（结构块不进账本）；**玩家手放的旧式单格门**靠 `World._finalizeChunk` 迁移扫描补上半（lower+上方空气 → 直写 upper，幂等不进账本——账本重放后重扫，幂等兜底）。
- **agent-browser 实机陷阱（本批新增）**：①右键链里村民优先——村庄里测门会被村民截胡开交易屏，先离开村庄或在远空平台测；②headless 后台 tab rAF 节流到 ~2fps，`mouse down→up` 间隔必须 >1 帧周期（≥1.5s）否则 update 看不到按下沿；③`controls.enabled` 会被 UI 开关置 false——ESC 关屏顺序错乱后需 eval 置回；④会话崩溃后换新会话名重开（不同会话=不同浏览器 profile，localStorage 存档不跨会话）；⑤斜着走向关门会从门格侧面绕过（门只挡自己格的面板，正常）——直走测试必须 yaw 对准。

### B30 批次备忘（防回退）—— 水中上岸助推（类原版） + 氧气原版口径

- **水中上岸 = 上浮助推，不再是瞬抬台阶（勿改回）**：`Physics.moveAxis` 水平碰撞且 `entity.bodyInWater && !entity.flying` 时，若岸沿可越（stepH ∈ (0, 1.0+ε]）且顶部有空间（`_yClearAt`，与陆上 auto-step 共用）且 `vy > WATER_EXIT_VY_GATE(-0.6)`，给 `velocity.y = max(vy, WATER_EXIT_BOOST=4.0)`（与 Space 上浮同级）。原实现走 auto-step 瞬抬 +1（`position.y = targetY; return`）——玩家观感是"从水里被吸上岸"，B30 起改为贴岸逐帧上爬、翻沿后由水平移速带上去（node 仿真：Space 按住 30 帧后松开仅按前进，1.1 秒上岸，全程单帧 Δy ≤ 0.052）。陆上 auto-step 行为原样保留（回归钉值在 build30 ③段：瞬抬到 65.0001 且水平保留）。
- **浸水判定 = `bodyInWater`（脚部+0.05/躯干+0.9 任一格为水），勿用眼位 `inWater`**：贴岸上爬时头先出水，眼位判定翻 false 会拦腰打断爬岸。`Physics.collide` 开头每帧调 `_bodyInWater` 计算（AABB 覆盖格 × 两层）。但**游戏逻辑分路仍用眼位**：游泳/下潜/氧气在 `Game._updateWaterState`，两套判定并存、各管各的（物理助推 vs 玩法状态）。
- **助推门限 `vy > -0.6` 的取舍**：被动下沉稳态 ≈ -0.53（60fps；-8 重力 × 0.8 阻力），-0.6 恰好放行"悬浮贴岸助推"；潜游（Shift 每帧 vy=-4）、坠水掠墙（高速下沉）被拦住不打断。若调门限注意 30fps 稳态 ≈ -0.47、低 fps ≈ -0.42，门限必须低于全部稳态。
- **氧气原版口径（`src/core/AirSupply.js` 纯函数，node 可测）**：旧实现逐帧 -1（60fps 下满氧仅 5 秒，与 Player.js 注释"原版 15 秒"脱节）、溺水每 20 帧扣 1 血（≈3HP/s）。现 `airTicks` 语义 = 原版 tick（20 tick/s），`-=` `dt*20`（帧率无关，60/30fps 均 15 秒耗尽，钉值 895..905 帧）；耗尽后 `drownTimer` 每秒扣 2 血（原版口径）；出水 `+dt*600`（约 0.5 秒回满）并复位计时。`airTicks` 仍进存档（SaveSystem），`drownTimer` 不进（加载复位 1，Game.start 有显式复位行）。Hud 气泡公式 `(airTicks/300)*10` 未动（满值 300 不变）。
- **测试基建**：`tests/build30-water-exit-air.mjs`（44 断言）——物理场景用**稀疏 Map stub world + 最小实体对象**直跑真 `Physics`（无需 World/Renderer）；贴岸场景起始 x=0.68（0.5 起步单帧位移 0.036 碰不到墙，曾假 FAIL）；全程爬岸仿真模拟 Game 双分支速度覆写（inWater→2.15 / 陆上→4.3 + 眼位 inWater 折算）。AGENTS.md「玩家物理与游泳」节已重写为 B30 口径。
