# Agent 备忘 · 怪物与实体

> 本文件内容为 AGENTS.md 批次备忘**原文搬移（未改写）**，用于控制 AGENTS.md 体积（会话注入预算 65536 字节，超限会被静默截断）。
> 导航见 AGENTS.md「批次备忘索引」；新批次备忘按主题追加到对应小节，并同步更新 AGENTS.md 索引表。

### 怪物系统

- `MobManager` 管理生成（夜晚优先，MAX_MOBS=20）、更新、渲染、掉落物。
- 怪物模型用 **box-parts cuboid**：每只怪是一个 BufferGeometry，由若干 cuboid 部件合并而成（head/body/2 arm/2 leg 等），共 ≈ 6 部位 × 6 面 × 2 三角形 = 72 三角形/怪。**不再用 4 面 billboard**。
- 怪物纹理用**独立 96×64 皮肤 atlas**（4 行 × 6 列，cell 16×16 方形像素），每 type 一份私有 `CanvasTexture`，**不再合并到全局方块/物品图集**。
- 皮肤 atlas 布局：row 0=head, row 1=body, row 2=前组肢体(臂/前腿), row 3=后组肢体(腿/后腿)；col 0/1/2/3/4/5 = front/back/left/right/top/bot（**每面独立 cell，顶/底不再复用 front/back**——复用会导致"脸贴在头顶"）。UV 查表用 `mobSkinUV(partRow, faceCol)`，col 映射由 `FACE_COL`；atlas 尺寸常量 `MOB_ATLAS` 导出，`buildMaterials` 画布必须同步 96×64。每 face 按朝向套基础明暗（front 1.0 / back 0.80 / left 1.05 / right 0.88 / top 0.96 / bottom 0.70）。
- **法线是立体感关键（阶段 7 修复）**：`MobManager.buildMaterials()` 合并 geometry 后必须 `geo.computeVertexNormals()`，且 FACE_DEFS 每面两三角形绕序必须统一为 `(0,1,2)(1,3,2)`——若沿用 `(0,1,2)(0,2,3)`，每面两三角形一个朝外一个朝内，`computeVertexNormals` 平均成 ~0 法线，`MeshLambertMaterial` 方向光失效 → 全表面同色无明暗（"同色纸片"根因）。修绕序不改 UV。
- **UV 朝向（阶段 8 修复）**：FACE_DEFS 每面带显式 `uvs` 选择器——侧面统一 `[[1,0],[1,1],[0,0],[0,1]]`（u1 落在观察者右侧→从外看不镜像），top/bot 用 `[[0,0],[1,0],[0,1],[1,1]]`。旧写法 `c<2 ? u0 : u1` 会让 4 个侧面全部水平镜像，勿回退。
- **怪物朝向（阶段 8 修复）**：mesh 局部 **+Z 是脸/头的方向**；`Mob.js` 的 yaw 必须为 `atan2(nx, nz)`（nx/nz 指向移动/玩家方向），使 +Z 旋到移动方向。旧公式 `atan2(-nx, -nz)` 会让脸背对移动方向（蜘蛛头拖在身后），勿回退。
- 模型部件定义在 `MobTextures.js` 中 `HUMANOID_PARTS`（僵尸，**手臂沿 +Z 前伸**）/`SKELETON_PARTS`（骷髅，细肢 0.14 宽）/`CREEPER_PARTS`/`SPIDER_PARTS`（头胸在前 z∈[0.26,0.60]）常量；`MobTypes[type].model.parts` 引用。box = `[minX, minY, minZ, maxX, maxY, maxZ]`，**局部坐标系原点在脚 y=0，+Z 朝脸的方向**。
- `MobManager.buildMaterials()` 是 **async**（要 await SVG → Image → Canvas）；`Game.start()` 中必须 `await this.mobManager.buildMaterials()`，否则下一次 `start()` 时 master geometry/material 上下文未就绪。
- `Mob.js` 含 AI：chase/wander/attack/jump/burn/explode/lineOfSight。
- 注意 `Mob` 中攻击伤害属性名为 `attackDamage`（早期叫 `damage` 曾引发"该属性和同名方法冲突"的 bug，勿回退命名）。
- `MobManager.dispose()` 必须释放 type 级共享资源（`mobGeometries` 全 dispose、`mobMaterials.map` 全 dispose、`mobTextures` 清空），**`Game._disposeWorld()` 末尾必须调用 `mobManager.dispose()`**，否则切换存档时旧 master geometry/texture 会泄漏到 GPU。

### 怪物受击反馈系统（per-mob 资源、勿共享）

- `MobManager.spawnMob()` 中每只怪克隆 material（`mat.clone()`）—— **绝对不要让所有同 type 共享一份 material**，因为 emissive 是 per-mob 状态（受击红光 / 死亡红光 / 燃烧火光三态都靠 emissive 表达）。共享的话一只怪受击会让全部同 type 变红。
- 每只怪还挂载：`healthBarCanvas`（64×8 CanvasContext）+ `healthBarTex`（`CanvasTexture`，NearestFilter）+ `healthBarSprite`（`THREE.Sprite`，renderOrder=1000，depthTest=false）。受击时 `_updateHealthBar(mob)` 重绘并 `healthBarFadeTimer = 3.0`，3 秒中末 1 秒透明淡出。常量定义在文件头：`HIT_FLASH_DURATION=0.25` / `HEALTH_BAR_FADE=3.0` / `DEATH_ANIM_DURATION=0.4` / `HEALTH_BAR_WIDTH=1.0`。
- 死亡走两段式：`mob.dead=true` 当帧 → 末段设 `mob.dyingAnim={progress:0,total:0.4}` → 后续每帧 dyingAnim 分支累积进度（缩小 scale 到 0.05、旋转、`material.opacity` 1→0、emissive 红光淡出）→ `t>=1` 时才 `dropLoot` + `_removeMobResources` + splice。**不要在 dead 当帧立即 splice**，否则玩家看不到死亡动画。
- 玩家攻击 mob 不走 `Entity.damage()`（有无敌帧），改在 `MobManager.attackMob()` 内直接 `mob.health -= dmg` 并自己设 hitFlash / knockback / blood bar。
- `MobManager.dispose()` / `_removeMobResources()` 必须释放 per-mob 资源：material.dispose()、SpriteMaterial.dispose()、CanvasTexture.dispose()。geometry 是 type 共享不能 dispose。

### P3 批次备忘（防回退）—— 被动动物 / 末影人（可再生掉落源）

- **四类新生物**：牛（beef+leather）、羊（white_wool）、鸡（feather+raw_chicken）——`passive: true` 走村民系 AI 分支，白天草地成群（2-3 只）生成，独立上限 `MAX_PASSIVE=12`（不含村民，不挤 MAX_MOBS 敌对名额）；末影人（ender_pearl 0-1）——`neutral: true` 受击激怒 + **受击 60% 瞬移**（`_teleportMob`：±16 格下扫首个"实心+2 格净空"，8 次失败原地不动），夜晚主世界表 10% 混入 + 末地主产。
- **trySpawn 结构**：被动动物分支插在"亮度门**之前**"（白天可生成）；`_spawnAt(typeName,wx,wy,wz)` 是 trySpawn 尾部提取的共用入口（群生成也走它，联机自动经 mobNet 广播）。末地原先 `return` 改为末影人 50% 生成。
- **⚠ 命中球改身体中点（攻击几何变更）**：attackMob/findMobByRay 的球心从**脚底**改为**身体中点**（oc.y -= height*0.5）、半径 `max(width,height)*0.5`——旧脚底球对高个怪（末影人/凋零骷髅）球顶只到 height/2，平射/平砍被切顶（disc≈-8e-15 浮点负零实测）几乎无法命中。改后平射可命中高个怪；矮怪（蜘蛛等）横向覆盖同步变准。
- **掉落是"世界实体"不是直进背包**：mob 掉落经 `dropLoot→spawnDrop→droppedItems`（pickupDelay 1s + 走近拾取）——验证掉落要数 `mm.droppedItems` 而非 inventory；挖矿/砾石掉落才是直进背包（Game._blockDropName 路径）。
- **agent-browser 生成验证**：trySpawn 有 SPAWN_INTERVAL=2.5s 节流——直连循环 `mm.trySpawn(playerPos, isNight)` 绕过节流；**敌对名额满员会让末影人挤不进**（清场必须驱动 update 让 dyingAnim 走完 splice，光标 dead=true 不够）；桩随机需用**循环值序列**（恒值会把生成落点也固定死在无效格）。

- **agent-browser 打怪验证**：怪会走位导致脱靶——`m0.speed = 0` 冻结 AI 再射；箭矢伤害断言读 `hpBefore-hpAfter`（=6），勿断言必杀（20 血怪一箭不死是正确行为）。

- **agent-browser 验证手法**：右键交互用 `controls.mouseRight = true + update(1/60) 步进`（真实处理器路径）；掷眼碎裂桩用 `random => 0.9`（**≥0.8 才碎**，0.1 是落回分支——桩方向勿写反）；床重生断言 respawn() 直调 + 位置比对床顶。

- **agent-browser 验证经验链**：夜晚奖励经验走真实路径（`sky.time=0` + RAF 实跑数秒等 MobManager 夜间生成 → attackMob 击杀）比 eval 造实体可靠（Mob 类未挂 window）；**跨级时"xp+level*100"复合度量会被升级权重污染**——断言分项读 `player.xp` 与 `xpLevel`；经验瓶消耗断言读数量（2→1）而非槽位消失。

- **agent-browser 断言注意**：存档 JSON 的槽位字段是 `n/c/d`（不是 name/count）——eval 断言读 `.n`；槽位点击可用 `el.dispatchEvent(new MouseEvent('mousedown', {button:0}))` 直击 InventoryScreen 的 onmousedown 处理器（a11y 树对纯 div 槽位不可见，@eN 引用拿不到）。

- **headless 挖掘时长验证必须手动驱动**：RAF 在软渲染下变速（~2.3× 慢），墙钟采样不可信——`g.running=false` 停循环 + 循环 `g.update(1/60)` 步进数帧（mouseLeft 直接置位），断言 `brokenAt` 帧数/背包增量；复用会话前记得 `running=true; requestAnimationFrame(g.loop)` 恢复。

### 阶段 7 关键实现备忘（防回退）—— 4 种怪物建模优化

- **"同色纸片"根因 = 法线缺失**：`MobManager.buildMaterials()` 合并的 cuboid geometry 原本**无 normal attribute**（three.js 不绑定 → WebGL 默认 (0,0,0)）→ `MeshLambertMaterial` 的 `max(dot(N,L),0)=0`，太阳光对怪物零贡献、只吃环境光 → 全表面同色无明暗。方块正常是因为 `ChunkMesh.js` 手动写死每面法线。修复：`geo.computeVertexNormals()`。
- **绕序陷阱（必读）**：FACE_DEFS 每个面 4 顶点的原索引 `(0,1,2)(0,2,3)` 使两个三角形**一个朝外一个朝内**（已验证 right 面 +X/-X 各一）——直接 computeVertexNormals 会平均成 ~0 法线，仍扁平。修复：索引改为 `(0,1,2)(1,3,2)`（绕序统一、**不改 UV**）。**勿回退成 `(0,2,3)`**。
- **atlas 64×64**：皮肤 atlas 由 64×32（cell 16×8）升级为 **64×64（cell 16×16 方形）**，修掉方形面上 UV 拉伸；`MobManager.buildMaterials` 的 canvas 与 `drawImage` 必须同步 64×64。`mobSkinUV(partRow, faceCol)` 公式不变。
- **面朝向亮度**：`MobTextures.js` `FACE_BRIGHTNESS`（front 1.0 / back 0.80 / left 1.05 / right 0.88）在生成 cell 时逐像素乘系数——方向光之外的静态体积感，夜晚也保持辨识。改色板 `C.*` 时保持 rgb 数组。
- **模型**：蜘蛛由 4 腿改为 **8 腿（4 对）+ 头胸 + 腹部**（SPIDER_PARTS 10 部件 → 240 顶点）；苦力怕身体更方；人形臂略细腿加粗。box 仍为 `[minX,minY,minZ,maxX,maxY,maxZ]`，原点脚底 y=0。
- **验证**：浏览器断言 `geo.attributes.normal` 存在、单位向量、各轴平均绝对值≈1/3（axial 法线分布）；`npm run build`（45 模块）；服务器单测不涉及（仅前端渲染）。

### 阶段 8 关键实现备忘（防回退）—— 怪物朝向 + 原版化贴图 + 天空盒

- **"脸贴头顶"根因 = top/bot 复用 front cell**：旧 `FACE_COL` 把 top→0 / bot→1，头顶画的是"脸"。修复：atlas 64×64 → **96×64（4 行 × 6 列，col 4=top / col 5=bot 独立绘制）**，`FACE_COL = {front:0, back:1, left:2, right:3, top:4, bot:5}`，`FACE_BRIGHTNESS` 增补 4:0.96 / 5:0.70。**`MobTextures.MOB_ATLAS` 导出尺寸常量，`buildMaterials` 画布必须 `canvas.width=96` + `drawImage(img,0,0,96,64)` 同步**（不同步会把 96 宽图压进 64 画布，UV 全错）。
- **"蜘蛛头在身后"根因 = yaw 公式反向**：`Mob.js` 的 `yaw = atan2(-nx,-nz)` 使局部 +Z（脸/头面）指向移动反方向。修复为 `atan2(nx, nz)`（chase 与 wander 两处）。**勿回退**。验证法：chase 中 `dot((sin yaw, cos yaw), normalize(playerPos-mobPos)) ≈ 1`。
- **侧面贴图镜像修复**：FACE_DEFS 每面带显式 `uvs` 选择器（侧面 `[[1,0],[1,1],[0,0],[0,1]]`、顶底 `[[0,0],[1,0],[0,1],[1,1]]`），`uvs.push(us ? uv.u1 : uv.u0, vs ? uv.v1 : uv.v0)`。旧 `c<2 ? u0 : u1` 是镜像根源。
- **原版化皮肤**：僵尸无发 + 青衫 + **HUMANOID_PARTS 手臂沿 +Z 前伸**（box y 1.28..1.50，z 0.14..0.89）；骷髅用 **SKELETON_PARTS**（细肢 0.14 宽，MobTypes.skeleton 引用）+ 全骨白；苦力怕经典脸（眼 4×4 @ rows4-7，嘴上窄中宽下分叉）；蜘蛛头前红眼。改皮肤时保持 6 面 partCells 结构。
- **天空盒跟随（防"远处纯黑"）**：`Sky.update()` 必须 `skyMesh.position.set(playerPos)` + 构造时 `frustumCulled = false`。天空球半径 500 固定在原点时，玩家离原点 >far(1000)−500 后球面被远裁剪面裁掉露出黑色 clearColor。
- **验证**：agent-browser 冒烟——atlas 96×64 断言（`mobTextures.get('zombie').image.width===96`）、top-cell UV 使用断言（u∈[0.667,0.833]）、4 怪正午特写截图（脸在头正面/手臂前伸/经典脸/蜘蛛红眼）、传送 (2500,95,2500) 天空蓝天无黑。拍摄技巧：`spawnEnabled=false` + `detectionRange=0` + `burningInDay=false` 防走位/爆炸/燃烧干扰；旁观模式瞬移后相机有平滑，需置 `_specSmoothed/_specSmoothYaw/_specSmoothPitch = null`。

### Idea-2E 批次备忘（防回退）—— 铁傀儡（村庄护卫）

- **类型定义**：`MobTypes.iron_golem`（passive:true + guardian:true 双标记）——passive 使其不占敌对 MAX_MOBS/动物 MAX_PASSIVE 名额（`_passiveCount` 已排除）且被动族互不威胁（村民不逃铁傀儡、僵尸不猎铁傀儡）；guardian 驱动专属 AI 分支（先于 passive 分支判断）。血 100/伤 12/速 2.8（须能咬住 2.5 的僵尸骷髅）/xp:0。
- **护卫 AI（`Mob.updateGuardianAI`）**：敌对怪（非 passive 且 attackDamage>0）进入 detectionRange(12) → `chase()`（chase 的 `target.isMob` 分支自动走 `mobAttackMob`，勿另写攻击路径）；被玩家攻击 → `attackMob` 里 guardian 分支设 aggro(20s) 死追攻击者（复用中立 aggro 计时衰减，该衰减块对任意 mob 生效）；无敌情 → 有 home 走 `wanderVillage`，无则 `wander`。
- **大击退**：`mobAttackMob` 按 attacker.typeName==='iron_golem' 加倍击退（水平 12/垂直 7）——勿改成通用参数化（会动到僵尸咬村民的手感）。
- **村庄自动补员**：挂 `updateVillageSpawns` 的 spawnEnabled 块内（**必须在 for(rec) 循环体内**，曾插错作用域引用不到 rec）；门控 = 存活村民(home 匹配)≥5 且无存活护卫；冷却 = `villageGolemSeen` Map 记录"最后存活时刻"，死亡后 60s 补员，村庄卸载清记录（卸载即补）；生成点 = `meta.villagerSpawns[0] + x偏2`（确定性，两端一致）；联机走 `_spawnAt`→mob_spawn 回执（与村民同惯例，勿本地直接 spawnMob）。home 补挂与随村清扫两个循环都已扩到 iron_golem（清扫时同步删 seen 记录）。
- **手工召唤（`Game._trySummonIronGolem`；B30 轮 8 起实现在 `src/player/Summoning.js`，Game 保留同名薄门面）**：只在**本地放置成功路径**调用（放置分支内）——联机远端 block_set 不检测，防多端重复召唤；T 型 = 南瓜头 + 2 格铁柱 + 双臂（头/柱底/柱中三个完成入口都识别）；命中后 5 块 setBlock(0)（自动广播账本）+ `_spawnAt` 就地召唤。**验证教训**：agent-browser 瞄准放置精确格位不可行（mouse move 是绝对坐标制、movement=相邻两次差，且指针锁瞄准本就不可靠）——方法体用 eval 补块后直调 `_trySummonIronGolem` 走真实代码路径验证，钩子布线靠代码审查（单行、坐标即放置坐标）。
- **实测锚点**：索敌 chase+targetIsZombie、一拳 20→6.9、追至 0.81、击杀后回 idle；死亡掉落 iron_ingot 3-5；白天燃烧的亡灵尸体堆属正常现象（sky.time=0.5 引发，非 bug）。

### Idea-2D-① 备忘 —— 凋零骷髅头颅

- `wither_skeleton_skull` 物品（焦黑颅骨图标，stack 64）；凋零骷髅 drops 增 10% 掉率（原版 2.5%+抢夺，本作无附魔取 10%，200 次采样实测 8.5%）。凋零骷髅本身早已全挂钩生成表（`pickNetherSpawn` 纯函数：要塞 10%/灵魂沙峡谷 45%/其余 15%，有单测）——本批只补头颅。
- **凋灵 Boss + 信标维持独立立项**（TODO.md D 节）：召唤检测复用 `_trySummonIronGolem`/`detectEndRing` 套路，Boss 三段血条可参考 DragonAI + BossBar，玩家 buff 系统是 Player 状态机新领域——立项时先评审。

### Idea-2D-② 批次备忘（防回退）—— 凋灵 Boss + 头颅方块化

- **命名陷阱**：`WITHER_PARTS` 常量早已被**凋零骷髅**占用——凋灵 Boss 部件必须用 `WITHER_BOSS_PARTS`（勿复用旧名）。
- **头颅方块化**：BlockDefs 文件**末尾**追加 `wither_skeleton_skull` 方块（追加位置防 ID 错位）；与同名物品互通 = 放置走 `BlockRegistry.getByName(sel.name)` 命中（Game.js 通用放置分支）、破坏走 `_blockDropName` 默认同名词掉回物品——**零额外掉落/放置代码**。方块纹理三张（top/side/bottom，face 只在 side）。
- **召唤检测 `_trySummonWither`（Build 8 起双结构，原版 T 优先；B30 轮 8 起扫描/落地在 `src/player/Summoning.js`，但「头层由放置物决定 + 形状派发」约 14 行**刻意留在 Game 门面**——`tests/build28-block-textures.mjs:266-269` 把 `isSkull` 家族判定三行字面钉在 Game.js 文本上，整段搬走即红）**：①原版 T 型 = 柱底 1 沙在中列（头层-2）+ 沙排 3 同列（头层-1）+ 头排 3 头颅；②兼容平铺两层 = 沙排 4 连（头层-1）+ 头排 3 左/右两种对齐（初版摆法，曾误标"原版 T 型"——原版摆法不触发，Build 8 补齐）。层位由**放置物**决定：放头→头层 y；放沙→沙排 y（头层 y+1）或柱底 y（头层 y+2，scan(y+2) 先于 scan(y+1)）。h0 枚举 [-3,3] 由校验保证正确性（宽枚举无害）。只在本地放置分支调用（同铁傀儡防多端重复）；移除 7 块 setBlock 自动广播 + `_spawnAt('wither')`（联机自动 mob_spawn 回执，零额外协议）。**探针坑：`Game.start` 是 async（图集 + buildMaterials await）——eval 同步调用 start 后立即测召唤，mobGeometries 为空致 spawnMob 早退，spawned=0 假象（hit/cleared 不受影响）；async 等待 start 完成后再测**。
- **WitherAI**（`src/entity/WitherAI.js`）：rise（升空蓄能 4s）→ hover（绕玩家 8 格切向引导点，同 DragonAI circle 套路 + 正弦浮沉）→ 血量 <50% 狂暴（速度 ×1.45、射程 1.6s）。齐射经 `mobManager.onWitherShoot` 回调（Game.start 注入 `_spawnWitherSkullVolley` 三发扇形 ±0.14rad）——AI 不直接碰渲染层。Mob.js 分发插在 dragon 分支后、**传 mobManager**（dragon 分支不传）。
- **弹射物语义**（凋灵之首）：各端本地积分 + **命中本地玩家本地结算**（同怪咬人语义，非箭矢"射端权威"——箭矢打怪、弹丸打人）；广播纯视觉（服务器 `WITHER_SKULL` 同 arrow_shot except 发起者转发，server/room.js `onWitherSkull`）。命中判定 = 水平 0.6 格半径 + 1.8 身高线段（AABB 近似）；`spawnRemoteWitherSkull` 不再广播（防回声环）。限速：tierOf 未列出 → 天然不限速。
- **凋零 II**：`player.withered` 秒数（`applyWither` 取最大值刷新，创造/旁观拒绝）；**扣血节拍在 Game.updateSurvival**（每秒 1 血直扣不走 hurt、可致死、统一死亡判定在函数尾部）；**满食物回血会抵消凋零扣血**——验证时先 `player.food = 5`，否则 hp 不变误判失效。视觉 `Hud.setWithered` 紫黑滤镜（update 每帧同步 >0），hideAll 复位 + Game.start 重置 withered（Player 是共享型子系统）。
- **BossBar 多实例**：`update(mobs[])` 改传 **type.boss 数组**（Game 917 行 find 单龙旧调用勿回退）；内部 Map<typeName, row> 惰性建行，凋灵红条/龙紫条；新增 Boss 类型在 `_row` 补配色分支。
- **免击退**：`attackMob` 击退段包 `if (!closest.type.boss)`——只包玩家攻击路径，mobAttackMob 不动（铁傀儡仍可击退凋灵，可接受）。
- **实测锚点**：召唤→hover 索敌 41→28.5 收敛；自动齐射 skulls 0→2；弹丸命中 8 伤 + withered 8.4s；击杀掉 rotten_flesh+nether_star；BossBar fill 100%→1.7%；模型 168 顶点（7 部件 ×24）/皮肤 96×64。**冒烟陷阱**：召唤点选玩家脚下——上方有实心方块时 mob 嵌入被 collide 钳制（位置不动非 AI 失效），先传送开阔地再验；headless 页面 RAF 会停转（截图冻结帧），恢复 `g.running=true + requestAnimationFrame(g.loop)`，逻辑验证一律手动 `g.update(1/60)` 步进。

### Idea-2D-③ 批次备忘（防回退）—— 信标 + 玩家 buff 系统

- **`Player.effects` Map**（`name -> {level, time}`）：`applyEffect` 同名取 max(level,time) 刷新；`getEffectLevel` 过期返 0；`tickEffects(dt)` Game.update 每帧走。**凋零已迁入**（`applyWither` = applyEffect('wither',2,s)，扣血节拍仍在 Game.updateSurvival 读 `getEffectLevel('wither')`）。Player 是共享型子系统：`Game.start` 用 `clearEffects()` 重置（勿再找 `player.withered` 字段——已删）。
- **五个挂钩点**（改手感勿绕开）：移速 = Game 742 `speed` 式（+20%/级）；跳跃 = physics.jump 后乘（+25%/级，仅 velocity.y>0 时）；急迫 = 挖掘 `speedMul` 式（+30%/级，叠加在工具倍率上）；力量 = `getAttackDamage()` 尾部（+2/级，空手/剑/斧全分支）；抗性 = `Player.hurt` 盔甲减伤之后（-20%/级）。
- **信标方块**：BlockDefs **末尾**追加（light:15 进 light mesh 夜亮）；合成 = Crafting.js `['glass'×3, 'obsidian','nether_star','obsidian', 'obsidian'×3]`（原版式，node 侧 matchRecipe 断言过）。
- **金字塔检测 `_getBeaconPower`**：信标正下逐层 3×3/5×5/7×7/9×9（层 l @ y-l，half=l；**Build 5 修复**：原 half=l+1 从 5×5 起与原版不符，整塔多耗 40 块——勿改回），**连续**层全为铁/金/钻石/绿宝石块才计数，断层即停。拆 1 层 = 降级（power 变小仍激活，效果等级 min(2,power) 实时调整）；全拆 = 失效（beacons.delete + 光柱移除 + 已上身 buff 自然衰减）。
- **脉冲**：`_updateBeaconPulse` 每 4s 遍历 beacons Map，范围 10×power，效果时长 12s > 周期 4s = **无缝续期**。效果选择是**内存级**（Game.beacons Map，换世界/重启丢失，方块本身走账本可重建激活）——勿当 bug。
- **光柱**：`_beaconBeams` Map<key, Mesh>（BoxGeometry 半透明白，y 到 250），`_ensureBeaconBeam` 先 remove 再建；`_breakBeacon`/失效/`_clearBeaconState`（Game.start 换世界）三处都清 + dispose。
- **BeaconScreen**：ChestScreen 同款生命周期（show 设 controls.enabled=false + 退指针锁 / hide 恢复 / E 键关闭 / paused 判定 / `_disposeWorld` dispose）。事件委托挂 **panel** 构造期（render 重建 innerHTML 无需重绑）。无基座只显示提示不出效果按钮。
- **实测锚点**：power:4 / 脉冲 lv2 无缝续期（time 9.8@5s 步进）/ 抗性 hurt(5)→3.0 / 力量 1→5 / 拆层降级 & 全拆 beacons:0 beams:0 / UI"金字塔 3 级"实时 / beacon 方块 ID 129 / 配方 matchRecipe→beacon x1。

### Build 20 批次（2026-09-16 交付）—— 创造模式不激怒生物（④）

- **索敌排除（同原版：怪物不以创造玩家为敌）**：`Mob.update` 通用索敌链加 `playerTargetable = !player.creative && !player.spectator`（普通视线索敌与 aggro 死追两处目标选择都排除；旁观顺手一并排除——此前旁观会被追打只是 hurt() 无效）；`updateShulker` 射击入口排除；`updateGuardianAI` 激怒追击分支排除；苦力怕引爆条件 `this.target === player` 因 target 不再指向创造玩家而自然短路。**Boss AI（DragonAI/WitherAI/StormColossusAI）刻意不动**——Boss 战由召唤/龙战触发，不在"激怒"语义内，且终局调试（F2/F3）依赖创造打龙。
- **激怒设置排除**：`MobManager.attackMob(origin,dir,maxDist,damage,opts)` 新增 `opts.provoke`（默认 true 不改既有调用）——创造玩家命中仍生效（伤害/击退/受击反馈/掉落）但不设置 neutral/guardian 激怒（怪物无力反击创造玩家，激怒态失去意义）；Game 攻击调用传 `{ provoke: !this.player.creative }`。创造分支挖星髓的 `angerTideEchoes` 调用移除（生存分支保留）。联机重放走 `applyRemoteMobAttack`（不经 attackMob），激怒语义零漂移。
- **测试**：build20-fixes.mjs 行为级——mock mob 验证 provoke=false 命中生效不激怒 / true 激怒 25s / 缺省保持旧行为。

### Build 21 M1 批次（2026-09-16 交付）—— 玩家模型原版 skin 化（单机层）

- **皮肤核心 `src/entity/PlayerSkin.js`**：`partRects(model)` 纯函数区域表（classic/slim 双模型；slim 仅臂宽 3px，公式 top=(u+d,v,w,d)/bottom=(u+d+w,v)/右前三连排布一次推导全部件）+ `applySkinToRig(rig, img, model)` 双层应用（base 覆写 mesh UV+材质 / overlay 克隆几何+外扩 0.5px 壳挂同 pivot，`alphaTest 0.01` 防透明排序）。**BoxGeometry 面序映射**（模型面朝 -Z）：px=right/nx=left/py=top/ny=bottom/pz=back/nz=front；镜像标志推导：px/nx/nz 无镜像、py 水平镜像、pz 水平镜像（背面十字展开翻正）、ny 双翻转——截图对拍校准。**rig 索引陷阱**：joints 只含 pivot 部件（body 无 pivot）——`rig.partsByName` 全部件索引必须建立，否则 body 层被跳过（冒烟 overlays=5 抓到）。
- **布局对齐原版**：`buildParts(model)` 取代裸 PARTS（仍导出兼容）：head 8³/body 8×12×4/arm 4(3)×12×4/leg 4×12×4 px（1px=1/16 格），pivot=肩点 (±(0.25+armW/2), 1.375)/髋点 (±0.125, 0.75)（比部件顶低 2px），总高 32px=2.0 格。
- **修复 A（抬头反向低头）**：模型头部俯仰 `rotation.x` 原为 `-pitch`——pitch>0（抬头）时头顶转向面向方向=低头。翻正为 `+pitch`（LocalPlayerModel.update 与 RemotePlayer 同步改，联机两端一致）。第二人称正面+抬头截图：看到仰起的脸 ✓。
- **修复 B（手持物在手后面）**：`_setHeld` 挂点原 `z=+0.22` 在模型背后侧（面朝 -Z），移至 `set(0, -0.85, -0.28)` 掌前（LocalPlayerModel 与 RemotePlayer 两处同源）。侧后视角截图：钻石镐清晰挂掌前 ✓。
- **FirstPersonHand 第一人称手臂贴 skin**：`applySkin(img, model)` 重建 armMesh 几何（4×4×8px 段）+ 六面全贴右臂 front 区 + NearestFilter；`loadSkin()` 构造期异步调用（loadActiveSkin 读 prefs，含内置默认回退）。
- **皮肤来源链**：`getSkinPrefs/saveSkinPrefs/clearSkinPrefs`（localStorage `project-mc-skin-v1`：{data: dataURL|null, model, source}）→ `loadActiveSkin()`（上传 dataURL → 内置默认回退，`DEFAULT_SKIN_URLS` 用 `new URL(..., import.meta.url)` 引入 res/default_skin/——Vite dev/build 双兼容且 node import 无副作用）。legacy 64×32 自动归一化（上半区拷贝 + arm/leg 行下移 16px 补位）。
- **SkinScreen**（主菜单多语言按钮右侧小按钮 personIconDataUri）：2D 正面预览（base+overlay drawImage 叠加 ×6 pixelated）/ classic-slim 切换 / 上传 PNG（FileReader→尺寸校验→归一化→dataURL 存储）/ 恢复默认；保存后 `window.game.playerModel.refreshSkin()` + `hand.loadSkin()` 实时换肤。LocalPlayerModel.refreshSkin：model 不变仅重贴纹理，model 变化整体重建部件（dispose 幂等 + `_skinSeq` 防异步竞态）。
- **测试**：tests/build21-skins.mjs（340 断言：partRects 锚点/完备性/无重叠/buildParts 布局/修复 A 行为级+B 绊线/接线/i18n 10 包）；冒烟：SkinScreen 预览渲染默认皮肤 ✓ 第三人称全部件贴图（overlays=6）✓ slim 臂宽切换 ✓ 修复 A/B 截图 ✓。

### Build 21 M2/M3 批次（2026-09-16 交付）—— 联机皮肤同步 + Mojang 代理

- **联机协议 `skin_set`**：C2S {data: dataURL, model} → 服务器 `Room.playerSkins`（Map id→{data,model}，**内存态**：退房 removePlayer 即删、重连后客户端 WELCOME 重发，不进快照）→ 校验（`data:image/png;base64,` 前缀 + ≤16KB + model 归一）→ broadcast except 发送者（S2C 带 id）。joinRoom 回放：新加入者逐个收房内已有皮肤（除本人）。客户端：`sendSkin()`（WELCOME 即发 + SkinScreen 保存时重发；loadActiveSkin→canvas toDataURL 统一 64×64）；case SKIN_SET→`_applySkin`（selfId 跳过、`_pendingSkins` 世界就绪前缓存、onWorldStarted 冲掉）；`RemotePlayer.applySkinFromURL(dataURL, model)`（dataURL 无 CORS 问题）+ **rebuildArmsForModel**（skin 档位与几何不符时重建双臂——slim 臂宽 3px/pivot 内移；heldGroup 挂 pivot 下随平移无需重挂）。**CORS 陷阱**：前端 5173 fetch 服务器 3001 的代理 API 跨端口，响应必须带 `Access-Control-Allow-Origin: *`（skin 专用 sendSkinJson），否则浏览器静默失败。
- **Mojang 代理 `GET /api/skin/:username`（公开路由，鉴权外——玩家无管理口令）**：三跳 api.mojang.com（用户名→uuid）→ sessionserver（textures base64 → decode → SKIN.url + metadata.model）→ textures.minecraft.net PNG → `{data, model, source:'mojang'}`；5min 内存缓存防限速；用户名正则校验 3-16。**评估结论：浏览器直连 Mojang API 不可行（无 CORS 头），服务器中转可行**。客户端回退链：联机走 `net._url` ws→http 同 host 代理 → 单机试本机 3001 → 第三方镜像 minotar（PNG 直取无 slim 标记按 classic）。**实测**：`/api/skin/Notch` 200（classic/mojang）；SkinScreen 输入 Notch 拉取成功预览渲染真皮肤 ✓。
- **冒烟**：双会话（host/join）同房——joinRoom 回放 skin ✓ 实时广播（host 切 slim → join 端 rp.armW 0.25→0.1875 + model slim + overlays 6）✓ 双向互见 ✓。**教训**：Vite dev 下编辑前端模块会对运行中页面触发 full-reload（游戏世界丢失+断线），联机冒烟时改代码要预期两端重连（NetworkManager 自动重连 ✓ id 变化，remotePlayers 残留旧 id 需重进清理）。

### Build 22 修复批次（2026-09-16 交付）—— overlay 对齐 / 第一人称手臂 / 实体体素光 / 拉取日志

- **修复① overlay 双层错位（猫耳变眼镜）**：`applySkinToRig` 的 overlay 壳 mesh 挂 pivot 原点但**没复制 base 部件相对 pivot 的偏移**——buildParts 的 pivot 都不在部件几何中心（head 颈部 +0.25 / 臂肩部 -0.25 / 腿髋部 -0.375 / body 相对 group (0,1.125,0)），导致 hat 层整体下移 4px、袖层上移、jacket 层错到腿部（默认皮肤 overlay 全透明，Build 21 冒烟未暴露）。修复：`ovMesh.position.copy(mesh.position)` + `rotation.copy`。**防回退**：任何"克隆部件几何挂同 pivot"的做法都必须复制原 mesh 的局部变换；测试用真 rig+假 img 跑完整管线逐部件断言（tests/build22-fixes.mjs 功能级，非源码绊线）。
- **修复② 第一人称手臂过大**：applySkin 把手臂段几何换成 4px 臂宽 1:1 世界尺寸 0.25×0.25×0.5，截面比 Build 21 前（0.13）近乎翻倍。收敛到 **0.16×0.16×0.42** + 挂位 (0,-0.07,0.30)，构造期肤色兜底与 applySkin 贴肤两处尺寸必须同步（否则贴皮肤前后跳变）。
- **修复③ 发光方块照亮实体（`src/render/entityLight.js` 单一来源）**：怪物原有逐帧体素光染色（`max(天光×昼夜, 方块光)` → 0.55~1.0 亮度+暖色），玩家三处模型（LocalPlayerModel/RemotePlayer/FirstPersonHand）完全没有。**关键坑：仅调 material.color 夜晚无效**——Lambert 场景光夜里≈0，color 再亮也渲染不出（冒烟抓到：数值 1.09 画面仍黑）。必须补"火光直发光"通道：`emissive = uTorchTint(1.0,0.82,0.58) × 基色`、`emissiveIntensity = 0.85 × glow`，`glow = blkL × (1-天光×昼夜)`（白天地表自动归零）；**蒙皮材质必须设 `emissiveMap = mat.map`**（albedo 在贴图里、color 是白）——否则平铺 emissive 把皮肤纹理冲成泛白剪影（冒烟两次迭代抓到）。通道互斥：受击红光/燃烧火光写同一 emissive → MobManager/RemotePlayer 的"常态清零 emissive"分支必须删除（辉光每帧重写、临时态让位：RemotePlayer 在 hitFlash>0 帧整体跳过 applyEntityLight）。怪物染色改调同一 `applyEntityLight`（白基色下输出逐字节一致）。**HeldItemMesh 不参与**：模板材质共享缓存直接染色会跨玩家串色，且自带 0.35 emissive 夜视设计。基色快照在 `material.userData.entityLightBase`，换肤换材质自动重建。
- **④ 皮肤拉取管理日志**：`handleSkinLookup` 各出口返回 `{code, note}`（缓存/mojang/classic、404 用户名不存在、400 格式无效、502 上游错误），路由层 `logAdmin('skin-fetch', '<IP> 拉取皮肤 "<用户名>" → <code>（<note>）')`；IP 清洗 `::ffff:` 前缀。面板 /api/logs 通用渲染无需改。测试 `server/test-skinlog.mjs`：**走 400 快速失败出口验证日志链路，不触外网**（Mojang 三跳留给浏览器冒烟，CI 不依赖外部网络）。
- **⑤ i18n**：皮肤面板「正版用户名」→「Minecraft®: Java Edition档案用户名」（键即中文源文案，10 包键名同步替换；服务器错误文案与注释里的旧词不属键面，保持原样）。
- **版本钉值纪律**：各批次测试的 `BUILD === X` 断言在下一批次**必须全部前移**（本批漏了 4 个世界观套件 endgame-tide/content/finale、whale-barrow 钉在 21，全量回归才炸出）。建议：改 BUILD 时 grep `BUILD ===` 全量同步。
- **测试/冒烟**：tests/build22-fixes.mjs 104 断言 + server/test-skinlog.mjs 6 断言并入 run-all-tests.sh；冒烟：test.png 猫耳回头顶（第三人称正面截图 + SkinScreen 预览）✓ 夜晚荧石旁玩家被暖光照亮且纹理保留（emissiveMap 迭代后截图）✓ 白天 glow=0 ✓ 远处 0.595/荧石旁 1.09 数值锚点 ✓ 怪物暗处 0.55 染色回归 ✓ `/api/skin/Notch` 200 + 日志 `mojang/classic` ✓。

## B30 审查轮 6 · 第二波 R 路（F6 / F8 / F9 / F10）

### F6 球体射线检测统一走 raySphereHit（高陷阱：球心 y 的符号）

- `attackMob` 与 `findMobByRay` 的内联判别式删除，改调 `src/player/Raycast.js` 的 `raySphereHit`（标量入参，零分配；旧实现每怪一次 `new THREE.Vector3()`）。
- **球心 y = `mob.position.y + mob.height * 0.5`（加号！）**：旧式 `oc = rayOrigin - mob.position` 后再 `oc.y -= height*0.5`，展开即球心 `position.y + height/2`（`MobTypes` 部件盒 `y0 ≥ 0` → position 是脚底）。传减号会让球心整体下移一个 height，**高个怪被静默漏判**（实测 900 组随机配置里 374 组本该命中却判未命中）。轮 6 计划书初稿此处即写错，由实施方发现。
- 调用口径变化带来的唯一差异：球心在调用方预计算，与旧式 `(oy - py) - h/2` 相比存在 ≤1 ulp 浮点重结合——随机对拍 3000 组判定与命中选择零差异（命中距离最大差 1.1e-14），仅「旧式 disc 恰为 0」的相切刀刃会翻转命中与否（测度为零，可接受）。
- `Game._findRemoteByRay` 同理改调 `raySphereHit`（远端玩家球心 `rp.group.position`、半径 0.5，无 y 偏移 → 无重结合问题），命中后仍按 1.8 身高区间过滤并取最近者。

### F8 dispose 复用 _removeMobResources

- `MobManager.dispose()` 内逐只 mob 的清理改为调用 `_removeMobResources(mob)`；全仓 per-mob 释放代码只剩一份（`scene.remove(mob.mesh)` / `healthBarSprite.material.dispose` / `healthBarTex.dispose` 各一处）。
- 语义增强（有意）：`_removeMobResources` 会多释放 `healthBarTex` 并置空 `healthBarSprite/healthBarTex/healthBarCanvas/healthBarCtx`；`mob.mesh` 依旧不置空（与旧一致）。重复 `dispose()` 幂等（第二次零新增释放、不抛错），幂等性由末尾 `this.mobs = []` 保证。

### F9 MobManager 内方块中心常量

- 5 行 / 6 处 `x + 0.5` / `z + 0.5` → `BLOCK_CENTER`（被动群生成、小群散布、末影人、常规刷怪、`_teleportMob` 落点）。
- **不要顺手改**：`Math.random() < 0.5` 概率判断、`y + 1`（站上顶面）、掉落物半高 0.5、球体半径 `* 0.5`。

### F10 Boss 血条数据源（MobManager 维护，零分配）

- `MobManager._bosses` 登记表：`spawnMob()` 末尾是全仓唯一 `this.mobs.push` 入列点（联机 `createMobFromNet` 也走它），此处按 `mob.type && mob.type.boss` 登记；**四条 `this.mobs.splice` 出列路径**（随村清扫 >120、末地城清扫 >200、死亡动画播完、despawn >80）各自先调 `_untrackBoss`，`dispose()` 同时清空两个数组——漏一条就是永久幽灵血条。
- `getBosses()` 直接返回内部数组（零分配，调用方只读）；`Game` 每帧 `this.bossBar.update(this.mobManager ? this.mobManager.getBosses() : [])`，不再 `filter` 新建数组；`BossBar.update` 改为只读单循环（先计数决定显隐、再逐只建行）。
- **BossBar 内的 `m.dead / m.dyingAnim` 防御不能删**：Boss 死亡后到死亡动画播完（最长 0.4s）仍留在 `_bosses` 里。
- 预存在行为（本轮未改）：某只 Boss 的 DOM 行不会被回收，靠整体 `display:none` 隐藏；另一只 Boss 存活时死亡 Boss 的行会停在最后血量。
