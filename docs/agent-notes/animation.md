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
