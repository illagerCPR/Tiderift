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
