# 动画系统（B44 起）

> 本批次把"玩家/实体动作僵硬"拆成两个可独立验收的轮次，同一个 Build 交付：
> 第一轮 = 玩家动作（本文档主体），第二轮 = 怪物骨架与体型模板（见文末「第二轮回填」）。
> 单元回归：`tests/build44-anim-humanoid.mjs`、`tests/build44-anim-fp-hand.mjs`（纯 node，无服务器）。

## 一、模块与职责

| 模块 | 职责 | 约束 |
|---|---|---|
| `src/entity/anim/HumanoidAnimator.js` | 方块人程序化动作器：相位/状态权重/一次性叠加层 → 输出 pose | **纯数学**，不 import three / 不碰 DOM，node 可直接单测 |
| `src/render/fpHandPose.js` | 第一人称手部姿态解算（`HandPose`） | 同上，纯数学 |
| `src/entity/RemotePlayer.js` | 远端玩家：插值缓冲 → 动作器 → `applyHumanoidPose` / `applyBodyOffset` | 不再持有自己的摆动相位 |
| `src/entity/LocalPlayerModel.js` | 本地第三人称（F5 / 灵魂出窍躯壳）：直读玩家状态 → 同一动作器 | 与远端共用同一套，禁止再复制第二份正弦逻辑 |
| `src/render/FirstPersonHand.js` | 把 `HandPose` 的输出写到相机子节点 | `miningPeriod` 仍是访问器（外部只写这个） |

## 二、符号约定（改动前必读，曾因轴/符号搞反返工）

- 模型朝 **-Z**（相机 `forward = (-sinYaw·cosPitch, sinPitch, -cosYaw·cosPitch)`；`FACE_MAP` 里 face 5 = front 也是 -Z）。
- 四肢是 rotation.x：**正 = 向前摆**（肢体自然下垂，`Rx(θ)` 把末端推向 -Z）。
- `applyHumanoidPose` 里左右臂外展：`armL.rotation.z = -armSpread`、`armR.rotation.z = +armSpread`（左臂在 -X，负 z 才是向外）。
- `bodyPitch`：**正 = 前倾**，落点时写 `bodyRoot.rotation.x = -bodyPitch`；`bodyRoll`：正 = 向 +X（右）倾，写 `rotation.z = -bodyRoll`。
- 头部：`rotation.x = 视角 pitch + headExtra`（pitch 正 = 抬头，与原实现一致）。

## 三、动作器核心口径

1. **相位按位移积分**：`phase += speed * STRIDE_RATE * dt`（`STRIDE_RATE = 2.6 rad/m`），水中/飞行才退化为按时间。
   旧实现是 `dt * (4 + speed * 0.8)` 的纯时间驱动 → 加速/减速时脚打滑；**不要改回去**。
2. **状态权重**：`walk / sprint / air / swim / fly` 五条权重，指数趋近 `damp(current, target, rate, dt)`。
   起停、起跳、入水都是权重过渡；**不要把权重改回布尔开关**（那是"阶跃"的来源）。
3. **state 互斥**：`airTarget = !onGround && !inWater && !flying`；`swimTarget = inWater && !flying`；`flyTarget = flying`。
   水中站底按游泳处理（判定用 `bodyInWater` 而不是眼位 `inWater`，后者贴岸会翻假）。
4. **落地包络**：上一帧腾空、这一帧着地 → `_landT = LAND_DURATION(0.22s)`，冲击强度 `|vy|/10` 钳 0.25~1，
   包络 `sin(π·(1-t/T))` 驱动下蹲/前倾/外展，**没有单帧跳变**。
5. **挖掘叠加层**：`mineAmp` 平滑进出，相位 `21 rad/s`（与原阶段 11 的 0.3s 敲击一致），叠加在右臂。
6. **dt 钳制**到 0.1s：后台标签页恢复时不会把权重一步推过 1。

## 四、躯干中间节点 bodyRoot（结构约束）

- `RemotePlayer` / `LocalPlayerModel` 都多了一层 `bodyRoot`（`group → bodyRoot → pivot/mesh`）：
  世界位姿（position / rotation.y）仍由 `group` 管，`bodyRoot` 只吃 bob（position.y）、前倾/侧倾。
- 名字牌、头顶快捷栏 sprite 挂在 **scene**（不在 group 里），不受 bob 影响。
- `PlayerSkin.applySkinToRig` 对 body 件用 `mesh.parent`（现在是 bodyRoot）挂 overlay 壳——**兼容**，不要改成写死 `group`。
- `LocalPlayerModel.refreshSkin()` 会重建整个 group 子节点，`_buildRig` 里必须重新创建 bodyRoot（否则引用悬空）。

## 五、第一人称手（HandPose）

- 状态：bob（可被「视角晃动」开关关掉）/ 挥动（周期随 `miningPeriod`）/ 换手抬起（0.18s，easeOutCubic）/
  起跳下沉、下落上抬（按 `vy` 反向）/ 落地缓冲（0.16s 包络）/ 游泳压低 + 划水 / 冲刺轻微侧倾 / 拉弓蓄力。
- `setItem()` 内部触发 `pose.equip()`：换擦拭从画面下沿抬回位，**别删**（否则切物品是硬切）。
- `miningPeriod` 保留 getter/setter 转发到 `pose`，`InteractionController` 的写入路径不变。
- `Game.update` 的调用签名是 `hand.update(dt, { moving, sprinting })`；其余环境量由手自己读 `game.player`
  （`onGround` / `bodyInWater` / `flying` / `velocity.y`）。

## 六、联机同步（可选字段，不升协议版本）

- `player_state` 新增 `sprint: 0|1`：客户端 `NetworkManager` 上送，服务端 `onPlayerState` 清洗后原样透传进 `state`。
- 远端 `RemotePlayer` 把 `sprint` 存进插值缓冲样本（`applyState` → `_buffer[].sprint`），按回放样本取值。
- 旧服务器/旧客户端缺字段时 `!!undefined = false`，远端退化为普通步态——**向后兼容**，`PROTOCOL_VERSION` 不动。
- 挖掘继续走既有 `mine` 标志；攻击/受击/进食等一次性事件目前**不**同步（远端不可见，见「遗留」）。

## 七、验证方式

### 单元（CI 门槛）

`tests/build44-anim-humanoid.mjs`：相位=位移积分、停步每帧变化有界（旧实现单帧从 ~0.9 跳到 0 是反例）、
腾空/游泳/飞行权重与互斥、落地包络、冲刺幅度/前倾、挖掘叠加、`applyHumanoidPose`/`applyBodyOffset` 符号、
确定性 + 随机状态无 NaN + dt 钳制。
`tests/build44-anim-fp-hand.mjs`：静止/bob/挥动包络/连续挖掘/换手抬起/跳跃下落落地/游泳/冲刺/拉弓/关闭 bob/确定性与接线绊线。

### 浏览器目测（无 pointer lock 也能做）

1. `./start.sh start`，`playwright-cli -s=anim open http://127.0.0.1:5173 --browser chrome`（系统 Chrome 有 WebGL）。
2. 跳过菜单：`game.start('creative', <seed>, null, 1)`，并把菜单根节点 `display:none`。
3. **第三人称**：`game.player.viewMode = 1`；直接在自然地形里走容易掉水里/被山体卡住 → 在 `y=110` 用
   `world.setBlock` 铺 31×31 石头平台，把玩家放到平台上，再改 `controls.keys['KeyW']=true` 驱动走路/冲刺。
4. **截帧**：`game.paused = true` 冻结 update（渲染继续），可稳定拍到跳跃/游泳姿势：
   用 `requestAnimationFrame` 循环在 `!player.onGround` 或 `animator.swimWeight>0.9` 时暂停。
5. 注意 Chrome 后台节流：页面不可见时 `setTimeout`/`setInterval` 会被拉长到几十秒，**不要用定时器量时间**，
   要看状态就 `eval` 读 `game`（`performance.now()` 同样会跳）。

## 八、遗留 / 第二轮

- 怪物仍是"每类型一个合并 BufferGeometry + 单个 Mesh"（`MobManager.buildMaterials`），零关节 → 全是平移。
  第二轮计划：按 `MobTextures` 的命名 parts 拆子几何 + 自动 pivot，上 biped / quadruped / spider / flying / Boss 五种体型模板。
- 玩家侧未做：受击退缩、死亡倒地（死亡界面会隐藏模型）、潜行姿态（本作没有潜行机制，Shift 只用于水中下潜）。
- 远端一次性动作（攻击/进食）未同步；若要同步需另开事件消息，不要塞进 20Hz 的 `player_state`。

## 九、第二轮：怪物骨架与体型模板（B44 第二轮）

第一轮只解决了玩家；怪物此前是「每类型一个合并 BufferGeometry + 一个 Mesh」，走路整体平移。第二轮把它拆成骨架。

### 模块

| 模块 | 职责 | 约束 |
|---|---|---|
| `src/entity/anim/MobRig.js` | 部件几何数据（顶点/UV/索引）、pivot 推导、体型判定、`applyMobPose` | 纯逻辑，不 import three；只依赖 `MobTextures.mobSkinUV` |
| `src/entity/anim/MobAnimator.js` | 六种体型模板的程序化动作（相位/权重/追视/攻击/受击） | 纯数学，node 可测 |
| `src/entity/MobManager.js` | 装配 group → bodyRoot → 关节 pivot → mesh；每帧落 pose | THREE 侧 |

### 几何与装配（关键陷阱）

- `buildPartGeometryData(part)` 输出与旧「合并几何」**逐顶点等价**（同一 FACE_DEFS/UV 选位，只是按 part 分组）。回归网用测试内独立 oracle 重算六面角点对拍，并钉住 `顶点数 = 部件数 × 24`。
- **几何顶点已经是模型局部坐标**：`mesh.position` 相对 pivot 只能平移 `-pivot`。曾误写成「部件中心 − pivot」（照搬玩家 BoxGeometry 居中的写法），结果所有部件被二次平移、整只怪散架——浏览器截图一眼可见。回归网有 `mesh.position.set(-part.pivot[0], …)` 与「不再调用 partCenter」两条绊线。
- 每只怪共享**一个** per-mob 材质实例（受击红光/燃烧/死亡淡出才会整只一起变）；几何是 type 级共享资源，销毁走 `mobRigs`。
- 死亡动画仍走 `group.scale/rotation.y` + 材质 opacity/emissive；`_removeMobResources` 清空 `mob.mesh/bodyRoot/joints/meshes/material/animator`。

### pivot 规则（按部件名）

| 名称 | 支点 |
|---|---|
| `head` / `neck` / `shell` / `bell` | 部件底面中心（颈根） |
| `arm` / `leg` / `rod` / `tent` | 部件顶面中心（肩/髋/根） |
| `wing` | x 靠近 0 的一端（翼根） |
| `tail` | z 靠近 0 的一端（尾根） |
| `orb` | 自身中心（自转） |
| `body` / `core` / `spine` / `ribs` | 无（随 bodyRoot） |

### 体型判定（`inferPlan(parts, flyingHint)`）

`wing → flying`；`flying 且无腿无臂 → floating`（凋灵/潮鸣/风灵/烈焰人）；`rod/orb/tent ≥ 4 → floating`；`legs ≥ 6 → spider`；`legs ≥ 3 → quadruped`；`arm → biped`；否则 `static`。
`flyingHint` 必须传 `!!type.flying`，否则无翼悬浮怪会被判成 static。

### 动作模板

- **biped**：双腿反相 + 摆臂 + 头部追视 + 攻击前冲/受击后仰。
- **quadruped**：对角步态（FR+BL 同相、FL+BR 反相）+ 头部起伏 + 尾巴摆动。
- **spider**：三脚架步态（FL/MR/BL 同相、FR/ML/BR 反相）。
- **flying**：双翼同向扇动（wingL 取负 z、wingR 取正 z）、悬停起伏、尾摆、追视。
- **floating**：杆/光球绕 y 自转（按名字方位角错相位）、触手摆动、悬浮起伏。
- **static**：呼吸 + 追视（潜影贝的 shell 也走追视）。

### 符号约定（怪物与玩家相反，勿混用）

- 怪物模型朝 **+Z**（玩家朝 -Z），`bodyPitch` 正 = 前倾，落点直接写 `bodyRoot.rotation.x = pose.bodyPitch`；
  不要套用玩家侧的 `applyBodyOffset`（那边取负）。
- 追视角度：`lookYaw` 钳 ±1.1 rad、`lookPitch` 钳 ±0.8；`headX` 内部取负（正 rotation.x 是低头）。

### 已知限制

- `spider` 的 `legML2/legMR2` 与 `legML` 同相（名字尾部没有 R，`/^legM/` 分支按 `endsWith('R')` 判相位）。
- Boss 只用通用模板（龙 flying、凋灵 floating、巨像 biped），没有专属技能前摇；攻击动作是纯表现，不改结算。
- 玩家侧未做受击退缩/死亡倒地（死亡界面隐藏模型）；远端一次性动作（攻击/进食）仍未同步。

### 验证

`tests/build44-mob-rig.mjs`（48 条）：几何 oracle 对拍、pivot 规则、体型全表、六模板关节运动、攻击/受击/追视钳制、确定性、接线绊线。
浏览器目测：`spawnMob` 后**必须让 Game 跑一帧**（或手动 `mesh.position.copy(mob.position)`）再截图，否则 group 还在原点；
Chrome 后台会节流 rAF，截图可能拿到旧帧——用 `renderer.render()` + `canvas.toDataURL()` 在同一任务内取帧最稳。

## 十、B45 转身平滑（怪物朝向）

- 问题：怪物 AI 每帧直接写 `mob.yaw`，渲染 `mesh.rotation.y = mob.yaw` → 玩家进入村民 4 格「注视」范围的那一帧整只怪瞬转 180°，很僵硬。
- 语义拆分：`mob.yaw` 仍是 **AI 期望朝向**（`chase`/`flee`/游荡/Boss 状态机一行不改）；新增 `mob.displayYaw` = **实际渲染朝向**。
- `src/entity/anim/YawTurn.js`（纯数学）：`wrapAngle`（[-π,π)）、`angleDelta`（跨 ±π 接缝走短边）、`turnToward(current, target, maxStep)`（进入步长即落位、不过冲；Infinity = 不限速）。
- `MobManager.update` 在 `mob.update(...)` 之后：`mob.displayYaw = turnToward(mob.displayYaw, mob.yaw, mob.turnRate * dt)`；`mesh.rotation.y` 与头部追视基线（`Math.atan2(dx, dz) - mob.displayYaw`）都改用 `displayYaw`，所以转身期间**头先到、身子后到**。
- 角速度表（`Mob.js` 顶部 `MOB_TURN_RATE`）：敌对 4.0 rad/s（≈229°/s）、被动 2.6 rad/s（≈149°/s，180° 约 1.2s）、dragon 1.4 / storm_colossus 1.2 / wither 2.0 / iron_golem 2.0。
- **纯视觉**：不动 `velocity`/攻击判定；怪物朝向本就不进联机协议，零协议改动。
- 回归：`tests/build45-mob-turn.mjs`（归一/短边/单步限速/落位/180° 用时/单调/接线绊线）。
- 浏览器实测（playwright，`m.update = () => {}` 冻结 AI 后直接设 `yaw=π, displayYaw=0`）：每帧 0.13 rad（dt 钳 0.05 × 2.6），24 帧 ≈1.2s 转到位、`mesh.rotation.y === displayYaw`、头部偏航在转身期间先摆到 ±1.1 再回正。

## 十一、B46 第一人称手臂二层皮肤（袖子）

- 问题：第三人称模型早就有第二层（hat/jacket/sleeve/pant 的 overlay 壳，`applySkinToRig` 里外扩 0.5px 的壳 mesh），
  但第一人称 `FirstPersonHand.applySkin` 只给手臂贴 base 层 → 用户皮肤上的袖子/外套在第一人称下"消失"。
- 做法（**不新写一套 UV 面表**）：
  - `PlayerSkin.buildPartBox(partKey, model, size, layer)` 增第 4 参：`layer='overlay'` 时写 `partRects` 的 overlay 区域（默认 `'base'` 行为不变）。
  - 新增导出纯函数 `overlayScaleFactor(px) = (px+0.5)/px`：第二层每边比第一层大 0.5px（原版语义）。第三人称 `applySkinToRig` 的壳 mesh 与本批第一人称袖子**共用这一个函数**（防两条路径各写一套公式漂移）；非法输入回落 1。
  - `FirstPersonHand._buildArmOverlay(tex, model, w)`：同尺寸盒几何（overlay UV）+ `MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.01, side: DoubleSide })`，按 `partRects('classic'|'slim').armR.dims` 设 `scale` 外扩，作为 **`armMesh` 的子节点**（随手臂抬起/挥动/换手/落地一起动，不用另算变换）。Alpha 透明像素由 alphaTest 丢弃，不能靠透明壳直接盖（overlay 区大面积透明）。
  - 换肤：`applySkin` 先 `_disposeArmOverlay()` 再 dispose 旧 base 几何/材质/贴图，然后重建两层；base 与 overlay **共用同一张 `CanvasTexture`**（只上传一次），释放时由 base 侧统一 dispose。
  - 体素光：`applyEntityLight(..., this.armMesh, this.armOverlay)`，两个材质各自快照基色 → 火把旁袖子同样被暖光染色。
- **皮肤数据语义**：默认皮肤（`res/default_skin/*.png`）第二层**全透明**，所以默认皮肤下袖子不可见——这是原版语义（默认 Steve 没有外套），不是 bug；验证要用带 overlay 像素的皮肤（浏览器里可直接用 canvas 在手臂 overlay 区域涂色）。
- **参数/尺寸**：手臂盒仍是 `0.16×0.42×0.16`（classic）/ `0.12×0.42×0.16`（slim）；袖子外扩后约 `1.125×1.0417×1.125`。`alphaTest` 必须 >0（0.01），否则完全透明像素仍会写入深度、在近裁面附近出现"黑边/空洞"。
- 回归：`tests/build46-fp-arm-overlay.mjs`（47 条）——overlay 区域钉值（classic 正面 (44,36,4,12) / slim 3 宽）、`overlayScaleFactor` 数值与非法输入、`buildPartBox(layer='overlay')` 六面 UV 全不同于 base（负控）、**真 `FirstPersonHand`** 应用皮肤后袖子壳的父子关系/缩放/材质/同贴图、重复换肤只留一层且旧几何·材质·贴图各 dispose 一次、第三人称 `applySkinToRig` 同源比例与 dispose 保持。
- 浏览器目测（playwright + 系统 Chrome，`game.paused = true` 后 `renderer.render()` 稳定取帧）：
  用默认皮肤 + canvas 在 `(40,36,16,12)` 四侧面涂红 → 手臂可见面变红（overlay 生效）；
  只涂 `(40,36,16,6)`（另半段）→ 可见处仍是肤色 base（alphaTest 透明像素不遮挡 base，且映射与第三人称同源）。

## 十二、B47 类原版死亡动画 + 飞行前倾过渡

### 12.1 死亡动画（怪物）

- 旧实现（B44 前的临时方案）：0.4s 内 `mesh.scale.setScalar(1-t)` + `rotation.y += dt*8` 原地自旋 + 材质 `opacity = 1-t` 渐隐 + 红光。用户 2026-11-06 要求改成"类原版"。
- 原版口径（`LivingEntityRenderer.setupRotations`）：本地空间绕 **Z 轴**（模型前后轴）侧倒，
  `f = sqrt(min(1, (deathTime-1)/20*1.6))`，`roll = f*90°`；`deathTime` 到 20 tick（=1s）整只移除。
  → 约 0.675s 触地躺平（先快后慢），之后保持躺平，1s 到点直接消失（掉落物同帧弹出）。**不缩放、不自旋、不淡出**。
- 实现：`src/entity/anim/DeathPose.js`（纯数学，node 可测）：
  - `DEATH_ANIM_DURATION = 1.0`、`DEATH_TICKS = 20`、`DEATH_FLASH_TIME = 0.5`；
  - `deathTilt(elapsed, total)` → 弧度（0..π/2；NaN/负数按"刚死"，+Infinity 视为躺平）；
  - `stepDeathAnim(anim, dt)` → `{t, tilt, flash}`（就地推进 `anim = {progress, total}`；负/NaN dt 不倒退）；
  - `makeDeathAnim()`（`MobManager` 触发死亡时建状态）。
- 接线：`MobManager.update` 的 `dyingAnim` 分支只写 `mob.bodyRoot.rotation.z = st.tilt`——怪物模型朝 +Z、bodyRoot 在脚部，绕本地 Z 转 = **以脚为支点向侧面躺平**；`bodyRoot.rotation.x` 是 MobAnimator 的前倾通道，别抢。红光改走尸体上的 `emissive` 衰减（`st.flash`），不再动 `opacity`/`scale`。
- **不要**改写成 `mob.mesh.rotation.z`：group 上已有 `rotation.y = displayYaw`，Euler XYZ 下等价于"绕偏航后的轴"再叠加，改动后语义容易漂移；bodyRoot 是 animator 专门留的中间节点（只吃 bob / 前倾 / 侧倾）。
- 回归 `tests/build47-mob-death.mjs`：逐 tick 与独立 oracle 对拍、单调/钳位/NaN、单帧推进到 t=1 的帧数、红光衰减、**姿态语义**（Rz(π/2) 后身体各点 y≈0、水平偏移 = 原高度，支点不动）、以及"缩放/自旋/淡出已退场"的源码绊线。
- 浏览器目测：`m.dyingAnim.progress = 0.35 / 0.7` 后调一次 `mobManager.update(0, ...)` + `renderer.render()` 就能取到"倒下中 / 躺平"两帧（`.playwright-anim/32~34-b47-death-*.png`）。

### 12.2 创造飞行前倾过渡（玩家 / 远端玩家）

- 症状：创造飞行一按 W 速度立刻 12m/s，旧写法 `p.bodyPitch += 0.10*f + clamp(speed*0.03, 0, 0.22)*f` 把速度**直接**映射成角度 → 身体瞬间前倾；松手速度归零 → 瞬间复原。
- 修法：`HumanoidAnimator` 新增 `_flyLean`（0..1，`damp(..., FLY_LEAN_RATE = 6)`），速度先按 `FLY_LEAN_REF = 8`（巡航 12 → 满幅）归一化，前倾角改成 `(0.10 + FLY_LEAN_MAX(0.22) * _flyLean) * _fly`。
  - 真 `Game.update` 60fps 实测：单帧最多 0.021rad（旧写法一帧 0.22）；起步 0.1s → 0.199、0.5s → 0.309、1s → 0.3195；松手 0.1s 仍 0.215、1s 回 0.1005。
  - `damp` 让过渡**帧率无关**（30fps 与 120fps 跑 0.5s 相差 <1e-6）——不要按帧数写死 lerp 系数。
  - 只在 `flying` 时累积（`_flyLean` 的 target 非飞行时为 0），地面高速行走不会吃到飞行前倾。
- 回归 `tests/build47-fly-lean.mjs`：悬停基准 / 起步首帧增量 / 0.1·0.5·1s 三点 / 停止过渡 / 帧率无关 / 地面切飞行连续 / `reset()` 清零 / 旧"速度直映"表达式绊线。

### 12.3 手持物品隐藏手臂（B49）

- 用户口径：「手持物品时应该隐藏手臂」——物品模型自己占位，手臂与方块/物品叠在一起会穿模。
- 判据单一化：**`hand.currentName` 是唯一真相**，`_syncArmVisible()` 是唯一入口（`armMesh.visible = !this.currentName`）。
  - `setItem(name)` 在**异步建模之前**就切一次（切手当帧生效，不等 `buildHeldItemTemplate`）；
  - `update()` 每帧再同步一次（自愈：别处改了状态、或模板构建失败回退 `visible = true` 之后都不会漏）；
  - `resetForWorld()` 换存档复位（`currentName = undefined` + `_buildSeq++` 丢弃在途构建 + 手臂回可见）。
- **只切 `armMesh.visible`**：B46 的二层皮肤（袖子）是 `armMesh` 的子节点，跟着一起隐藏；**不要**去动 `armOverlay.visible`（那会留下"半只袖子"的状态残留）。
- 物品挂点在 `itemGroup`（`group` 的子节点，`z=0.12`），与 `armMesh`（`z=0.30`）互不隶属 → 藏手臂不影响物品显示、挥动、拉弓姿态。
- 排查假象：物品挂点比手臂**更靠近相机**（0.12 vs 0.30），贴着崖壁/树冠时只看得见物品、看不见手臂——不是"手臂没渲染"。验收要在开阔地，并且**先确认空手时手臂可见**再对比手持态。
- 回归 `tests/build49-debug-hand.mjs` 第 ④ 组：真 `FirstPersonHand` + 假 game —— 空手/未初始化可见、手持隐藏、换回空手恢复、袖子随藏、`resetForWorld` 三项复位。
