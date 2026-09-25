# AGENTS.md

## 语言

- 对话回复使用简体中文（用户全局约束，见 `~/.claude/CLAUDE.md`）。
- 代码标识符用英文，不用汉语拼音。

## 开发命令

```bash
# Windows (PowerShell)
.\start.cmd start    # 启动 Vite 开发服务器 (127.0.0.1:5173)，后台常驻
.\start.cmd stop     # 停止服务器
.\start.cmd restart  # 重启
.\start.cmd status   # 查看是否在跑

# Linux / macOS
./start.sh start     # 同上（默认动作，可省略参数）
./start.sh stop      # 停止服务器
./start.sh restart   # 重启
./start.sh status    # 查看是否在跑

npm run build        # 生产构建
npm run preview      # 预览构建产物
node --check <file>  # 语法检查（唯一可自动化验证手段）
```

- 不走 `npm run dev`：`start.cmd`（Windows，最小化窗口标题 `vite-dev-server`）/ `start.sh`（Linux，`nohup` 后台常驻 + 日志 `dev-out.log`/`dev-err.log`）都直接后台拉起 `node node_modules/vite/bin/vite.js`。端口 5173 无响应时先 `status`，必要时 `restart`。
- 无测试框架、无 lint、无 typecheck。修改后必须 `node --check` 改动的每个文件，再用浏览器/playwright 手测。
- Vite 5 + Three.js 0.160，ESM 原生导入，无打包工具链额外配置。

## 验证 / playwright-cli

- （Windows）不要直接 `playwright-cli open <url>`（启动失败）。要用带 `.cmd` 扩展的完整路径：
  `& "C:\Users\illag\AppData\Roaming\npm\playwright-cli.cmd" reload|click|eval|console <args>`
- （Linux/macOS）直接 `playwright-cli reload|click|eval|console <args>`，无 `.cmd` 后缀问题。
- `playwright-cli eval` 中的字符串字面量常被 PowerShell 吃掉引号/反引号（Windows）；传含 `name: "torch"` 之类参数时改用 `String.fromCharCode(...)` 拼接，或把脚本写到临时文件再 `eval --filename`。Linux/macOS 下 bash 引号规则正常，此陷阱不适用。
- playwright 无 pointer lock 能力，ESC 暂停 / 死亡屏幕等 pointer-lock 相关流程只能 `eval` 直接调用 `pauseMenu.show()`/`deathScreen.show()` 验证。
- PNG 截图可直接用 Read 工具（read_image）查看，用于画面级渲染验证。

## 验证 / agent-browser（可真实操作 3D 世界，已实测 2026-08-31）

agent-browser（本机 0.35.2，`npm i -g agent-browser`）是本项目的**第二套浏览器冒烟工具**，与 playwright-cli 互补。核心差异：**能捕获指针锁 + 真实键盘/鼠标输入 → 单机与联机都能真实移动/转向/挖/放/聊天**（playwright-cli 做不到）。DOM UI 用快照 + `@eN` 语义引用（无需选择器），HUD DOM 直接桥接实时 3D 状态（坐标/生物群系/时间/准星方块）。详细实测见 `docs/agent-browser-eval.md`。

**PowerShell 使用注意（仅 Windows，每条命令都要记住；Linux/macOS 下会话变量用内联前缀 `AGENT_BROWSER_SESSION=my-session agent-browser <cmd>`，bash 不吃 `@` 但建议引号）**：
- `$env:AGENT_BROWSER_SESSION` 在**每次 pwsh 调用间不保留**（新进程）——每条命令内联设置：`$env:AGENT_BROWSER_SESSION="my-session"; agent-browser <cmd>`。
- `@eN` 参数会被 PowerShell 吃掉 `@`——必须加引号：`agent-browser click '@e7'`。
- `eval` 要传**表达式** `"(...)"`；传函数 `() => {...}` 会返回函数本身（显示 `{}`）而非结果。等价于 playwright-cli 的 eval，可读任意 game 状态。
- 会话隔离是硬要求：联机多会话（host/join）必须用不同命名会话，否则共享浏览器互抢页面。

**世界内交互（实测有效命令面）**：
- 指针锁：`click 'canvas[data-engine]'` 捕获（`canvas` 裸选择器命中 10 个元素 → strict mode 违规，必须精确定位主渲染 canvas）。
- 移动：`press w`（单次按压位移很小 ~0.01m，连续多按才有明显位移）；转向：`mouse move <dx> <dy>`。
- 挖/放：`mouse down left` + 延迟 + `mouse up left`（挖）；`mouse down right` + up（放）。CDP 鼠标事件能到达游戏 handler 并同步置位 `controls.mouseLeft/mouseRight`（已用同步监听器验证）。
- **高陷阱：用 eval 改 `player.pitch/yaw` 不会可靠同步相机 → 射线指偏、挖/放打不中目标**。瞄准必须用真实 `mouse move`，命中块以 `game.selectedBlock` 为准。
- 在自己脚下/身上放方块会被玩家重叠检查拒绝（游戏设计行为，非失败）；对墙放置即成功。
- 联机链路（已实测全通）：host/join 建/加入房间 → 互见（`game.remotePlayers`，位置在 `rp.group.position`）→ 挖方块同步 → 双向聊天（`press t` + `keyboard type` + `press Enter`，输入框自动聚焦）→ 移动同步。
- 服务端残留：联机测试房间落盘 `server/world/<房间名>.json`，用一次性房间名（如 `ab-eval-<ts>`）或测完删除；先起服务（Vite/LAN）再开会话，否则 `ERR_CONNECTION_REFUSED`。

**定位与边界**：覆盖并超出 playwright-cli 三会话冒烟（真实输入驱动）；不替代 `node server/test-*.mjs` 确定性回归；agent 驱动**不可重复**，产出需人工复核，不能进 CI 回归门槛。

## 架构要点

### 入口与主循环

- `src/main.js` -> 创建 `Game` 实例和 `MenuScreen`，`window.game`、`window.BlockRegistry`、`window.ItemRegistry`、`window.SaveSystem` 暴露用于调试。
- `src/player/Game.js` 是中央枢纽：持有所有子系统（World、Renderer、Physics、Controls、Inventory、MobManager、RedstoneSystem、Hotbar、InventoryScreen、Hud、InfoBar、PauseMenu、DeathScreen），`update(dt)` 每帧驱动所有子系统。
- 主循环受 `this.paused` 门控：暂停 / 死亡 / 物品栏打开时 `loop()` 仍渲染但跳过 `update()`。
- `game.onExit = () => menu.show()` 由 `main.js` 注册；`game.start(mode, seed, loadData, slot)` 启动，`game.returnToMenu(save=true)` 关闭所有 UI 并触发 `onExit`。`controls.enabled` 是 UI 进入/退出的统一开关，新加 UI 必须在 show/hide 中维护它。

### 存档切换时的状态清理（高陷阱，曾引发多个 bug）

`Game` 构造时一次性创建的子系统（Renderer/scene、Sky、Player、Physics、Inventory、Hud、InfoBar、highlight、breakMesh）**跨存档共享实例**，不会在 `start()` 中重建。其余（World、MobManager、RedstoneSystem、Hotbar、InventoryScreen、PauseMenu、DeathScreen）每次 `start()` 新建。若新增状态性子系统，必须决定它属于哪一组，否则会泄漏上一存档的状态：

- 共享型：必须在 `start()` 开头显式重置（例：`this.sky.time = 0.35` 在 loadData 覆盖之前；`this.inventory.slots.fill(null)` 在物品栏分支之前）。
- 新建型：必须在 `Game._disposeWorld()` 中从 scene 移除其 Three 资源并 dispose，否则切换存档后旧 mesh 残留为"幽灵方块"。
- `returnToMenu()` 末尾调用 `_disposeWorld()`，确保回到菜单前已释放 mesh 资源，避免下次 `start()` 再 add 时重复。

近期已修复的泄漏案例：Sky.time 沿用上一存档时间（未先重置）；Inventory 残留上一存档的物品（未先清空）；chunk mesh / mob mesh 未从 scene 移除（_disposeWorld 缺失）。

### 纹理管线（SVG 程序化生成为主）

纹理全由 SVG 字符串程序化生成（现存管线以 SVG 为准）：

1. `src/blocks/BlockDefs.js` 和 `src/items/ItemDefs.js` 在注册方块/物品时同时生成 SVG 字符串，分别导出 `BlockSVGDefinitions` 和 `ItemSVGDefinitions`（`{ 纹理名: svgString }`）。方块/物品建议同时填中文 `displayName`（用于 HUD/物品栏悬浮提示/快捷栏切换气泡）。
2. `Game.start()` 合并两个 SVG map，先注入 `MobManager.init()` 添加怪物 SVG，再调用 `SVGTextures.buildAtlas()` 打包为一张 Canvas 图集纹理 + UV map。
- **缺 `textures` 字段陷阱**：`reg(name, def, svgs)` 不传 `def.textures` 时 `BlockRegistry` 默认用 `name` 作 top/side/bottom（例如 `'piston'`），但 SVG map 里只有带后缀的名字（`piston_top/...`）。`ChunkMeshBuilder` 在 `atlasUV.get(name)` 查不到时 fallback 到整张 atlas UV `{0,0,1,1}`，方块面会**显示所有材质拼图**。修复：所有多面带不同纹理的方块必须显式传 `textures: { top, side, bottom }`。
- **方块重复注册陷阱**：BlockDefs.js 中同一 `reg(name,...)` 多次调用会互相覆盖 BlockRegistry 实例和 svgMap。例如曾出现两次 `reg('tnt',...)`，旧版只有 top/side 两张 svg 但带 textures，新版有三张 svg 但缺 textures —— 后注册覆盖前者，导致缺 textures 又全部 fallback 到整图集。修复原则：同一只能注册一次，且必须带 textures + 完整 SVG。
- **SVG 名后缀约定**：多面方块的三张 SVG 名通常用 `<block>_top` / `<block>_side` / `<block>_bottom`，方块名只在 SVG map 里挂带后缀的 key；单面统一方块（如圆石、活塞头 head）直接用 `<block>` 作 SVG key。
- **定向面（B28）**：需要在"六面不完全相同"之外再区分正面（箱子锁扣、熔炉炉口、头颅五官）时，传 `textures: { top, side, bottom, front }` + `facing: 'n'|'s'|'e'|'w'`。`BlockRegistry` 据此派生 `front` 与 `faceTex`（四水平面 → 纹理键表），`ChunkMesh` 逐面查 `faceTex`（`FACES[].key`）。**`icon` 默认取 `front || side`**（物品栏/快捷栏图标要看得出正面），side 不具代表性时（如耕地 side=dirt）显式传 `icon`。可放置朝向的方块（箱子/熔炉/头颅）用 `facingBase` + `baseBlock` + 尾部追加的 `${base}_${facing}` 变体，放置路径按玩家方位换态（`blockShape.facingId`）。
- **新增方块/状态变体一律追加在 `BlockDefs.js` 文件末尾（高危，勿插入中部）**：方块数字 ID 由注册顺序决定（`nextId++`），存档 `modifiedBlocks`、联机账本 `server/world/*.json` 全按数字 ID 落盘——在中部插入注册会让其后所有方块 ID 整体错位，旧存档里的方块变成别的东西（B27 门家族曾整段移位，B28 起改为尾部追加）。既存方块的 `reg(...)` 调用位置不可移动；新状态变体（`chest_e`、`furnace_lit_w`…）追加到文件末尾段，`build28-block-textures.mjs` 有 ID 零漂移钉值断言。
3. `MobManager.buildMaterials()` 必须在 `buildAtlas()` 之后调用（依赖图集 UV）。
4. `ChunkMeshBuilder` 用 `atlasUV` 查询每面的 UV 坐标。
5. UI（Hotbar、InventoryScreen）通过 `game.blockSvgMap` / `game.itemSvgMap` 查 SVG 字符串，用 `SVGTextures.svgToImage()` 绘制到 canvas。

新增方块/物品时，必须同时：注册到 Registry + 生成对应 SVG + 确认 SVG map 中纹理名与 `block.textures` 引用一致 + 按需补 `displayName`。

### 区块、网格与光照

- 区块 16×16×256，`Uint8Array` 存储方块 ID，海平面 Y=64。每区块另有 `light` 数组（高 4 位天光 / 低 4 位方块光，0-15），由 `LightEngine` 维护，`hasLight` 标记是否已初始化。
- 渲染距离 6 区块半径，每帧最多重建 2 个脏区块网格。
- 网格构建：实体方块逐块生成面，**只有水顶面**做贪心合并（`_mergeWaterTops`）；build 前先填 18×256×18 局部方块缓存（`_fillCache`，跨构建复用 scratch）+ 不透明 LUT，剔除/AO/光照采样全走缓存查表。
- `World.setBlock` 会把当前 chunk 和边界邻居标记 `dirty=true`；任何写方块的路径必须走 `setBlock`，否则网格不更新。
- `ChunkMeshBuilder.build()` 输出三个 mesh：`solid` / `water`（半透明 DoubleSide） / `light`。`light` 是 `light >= 13` 的方块（火把/红石火把/荧石/海晶灯/岩浆/红石灯）单独用 `MeshBasicMaterial` 重画一遍，使其夜里也明亮。`Game.rebuildDirtyChunks` 和卸载逻辑必须同时处理三者。
- **UV 朝向陷阱**：solid 面 UV 顺序为 `(u0,v0)(u0,v1)(u1,v0)(u1,v1)`（顶点顺序 [底,顶,底,顶]，方块顶部对应 SVG 顶部）。cross 类型（火把/花/按钮）UV 顺序相同。颠倒这顺序会导致草侧面、火把等纹理上下倒置。
- **水体纹理独立于图集**：水面/侧面/底面用 `waterTexture`（独立 `CanvasTexture`，`RepeatWrapping`，16×16），UV 按**世界坐标** `(x+offX, z+offZ)` 平铺，跨 chunk 连续（不要改回图集子区域 UV，否则远处水面会出方格分界）。`ChunkMeshBuilder` 构造函数第 4 个参数接收 `waterTexture`；water mesh 的材质 `map` 必须指向它。
- **水下方块面剔除陷阱**：`ChunkMesh.build()` 中三段面剔除：① 邻居是不透明非流体 → 剔除；② 当前是水且邻居是同 id 水 → 剔除；③ 非水方块相邻流体且流体不透明 → 剔除。**关键**：水和岩浆都是 `transparent: true`，故其二段"剔除"条件包含 `&& !neighborDef.transparent`，否则水下方块（沙子/石头与水相邻的方向）会被错误剔除，导致水里看不到任何方块。曾经 bug 表现为"水下方块不渲染、远处只见 chunk 边界"——远 chunk 未生成时 `getBlock` 返回 0（air），邻居 air 时不触发任何剔除，所以 chunk 边界方块反而画了。
- **跨 chunk 邻居查询**：`ChunkMeshBuilder.build()` 的 `getBlock` 在 `x/z` 越界时调 `world.getBlock(gx,gy,gz)`（line 76-78）；`y` 越界直接返回 0（air）。`World.getBlock` 在 chunk 不存在时也返回 0，远 chunk 边界因此被当成 air 看——这是"远处只见区块边界"的隐藏成因。

### 体素光照管线（光影改造，防回退）

- **双通道体素光**：`src/core/LightEngine.js`——天光（日光柱 + BFS 横向扩散）与方块光（`def.light>=13` 作源）各 0-15。天光特例：**垂直向下穿过全透格无衰减（15 保持 15）**；其他方向 -1-不透明度。方块光每步 -1-不透明度。
- **增量更新**：`World.setBlock` 末尾调 `lightEngine.onBlockChanged(oldId, newId)`——移除走**双队列算法**（removal BFS + 前沿重泛洪），天光 removal 有"向下 15 光柱一并移除"特例；挖开方块走"列重播种（`_reseedColumn`）+ 邻居流入"；新光源直接 set+BFS。**任何写方块必须走 `World.setBlock`**，光照才会跟着更新（远程方块改动同样经它，视觉自动同步）。
- **新区块**：`ensureChunk` 生成+应用修改后立即 `initChunkLight`（列播种 + 光源 + 已加载邻居边界光入队，泛洪自然完成双向导入导出并标脏邻居）。未加载区块采样兜底：天光按 15、方块光按 0。
- **着色**：`ChunkMesh.js` 顶点携带 `voxelLight`（skyL/blockL 归一化）+ `color`（面向系数 × AO）。平滑光照 = 面邻格 + AO 三格中不透明格跳过后的均值；AO 用 `AO_SAMPLES` 静态偏移表 + `AO_CURVE`，**各向异性时翻转对角线**（`a[1]+a[2] > a[0]+a[3]` → 换对角索引，绕向不变）。cross 植物取自身格光；合并水顶面取每角上方格光。
- **材质**：solid/water 是 builder 上的**共享 MeshBasicMaterial**（`applyVoxelLight` 注入 onBeforeCompile：`max(uSunTint*skyL*uDayLight, uTorchTint*blockL)` 再抬底 `uMinLight=0.035`）。**勿改回 Lambert**——场景方向光/环境光会把洞穴再次照亮，体素光失效；**勿改回每区块新建材质**（泄漏 + uniform 失联）。发光方块 light mesh 保持全亮 Basic，**不乘 AO/voxelLight**。
- **昼夜**：`Game.update` 每帧只更新共享 uniform（`uDayLight = 0.10+0.90*getLightLevel()`、`uSunTint` 晨昏暖/夜晚冷，来源 `Sky.sunTint`）——**时间流逝零网格重建**。
- **怪物受光**：`MobManager.update` 普通帧按所在格光调制 `material.color`（洞穴变暗/火把旁暖色）；受击/死亡 emissive 反馈是独立通道不冲突。
- **边界**：光照纯客户端视觉，**不进存档**（由方块数据重算）、**不进联机协议**；服务器测试零感知。
- **性能锚点**（headless 软渲染）：单 chunk build ≈ 7ms（基线 3.5ms），仍在 2 chunk/帧预算内；真实 GPU 环境更宽裕。改动采样逻辑后必须重测。

### 天空与昼夜（修改前必读）

- `Sky.time` 语义：`sunY = sin(time*2π - π/2)`，即 `0=半夜, 0.25=日出, 0.5=正午, 0.75=日落, 1=半夜`。`Sky.dayLength = 1200` 秒。
- `skyColors` 数组的 t 锚点**必须**与上述太阳位置一一对应（0.25=粉橙日出，0.5=蓝天正午，0.75=粉橙日落，0/1=深夜）。错位会让玩家在白天看到夜空色，全屏偏暗。
- 光强：`sunLight = 0.15 + dayFactor*1.3`，`ambient = 0.30 + dayFactor*0.50`，`dayFactor = max(0, sin(angle))`。夜晚保留 0.15 余晖避免伸手不见五指。

### 玩家受击与无敌帧

- 玩家走 `Player.hurt(amount, source, showVignette=true)`，内部 0.5 秒无敌帧（`invulnerable`），创造/旁观模式直接返回 false。`Game.update()` 每帧衰减 `invulnerable`。
- `player.onHurt = (amount, source) => this.hud.flashDamage(amount)` 在 `Game.start()` 中注册。新加伤害源时**所有一次性攻击**（怪物 `Mob.attack`、摔落、爆炸）应调用 `player.hurt(amount, source, true)`；持续/低频伤害（溺水每秒 1 血、饥饿每秒 0.5 血）直接 `player.health -= amount`，**不要**触发红屏（连续闪屏很烦）。
- `Hud.flashDamage(damage)` 内部 set opacity 到 `Math.min(0.9, 0.3 + damage * 0.04)` 后用双层 `requestAnimationFrame` 启动 `transition: opacity 0.5s ease-out` → 0 的淡出。修改时**不要去掉双层 RAF**——少了会让 opacity 0 立刻写回覆盖 intensity。

### 玩家物理与游泳

- `Physics.moveAxis()` 对每个轴单独移动+碰撞回退，**收集所有碰撞方块取最保守的回退位置**（不要改回"命中即停"的早期实现，曾导致穿墙）。
- **auto-jump（自动台阶）**：`moveAxis` 中水平碰撞时若 `maxBlockTopY - entity.position.y > 0 && <= 1.0+0.01`，且抬升后 `[targetY, targetY+height]` 范围内无碰撞，则直接抬升 y 而不回退水平位置。陆上台阶和水中上岸共用此逻辑——不要依赖 `inWater` 触发水岸上岸（玩家头出水后 inWater 会变 false，会失败）。
- 水中物理：`inWater` 由 `Game._updateWaterState()` 根据眼睛位置方块 `def.fluid && name==='water'` 判定；水中重力 -8、阻力 0.8、水平速度上限 ~4.3；Space 上浮、Shift 下潜（逻辑在 `Game.update()` 中而非 Physics）；`airTicks=300`，水下递减，<0 溺水扣血。
- Hud 顶部 `airBar` 显示剩余氧气（仅 `inWater && airTicks<300` 时渲染）。

### 食物与饥饿

- `Player.eat(itemDef)` 是统一食用入口：创造/旁观 / `food >= maxFood` 时拒绝；否则 `food += itemDef.food`、`saturation += food * 0.6`，都 clamp 到 `maxFood`。返回 true 表示成功吃下。
- `Game.handleMouseInput` 右键分支**优先**检查食物：玩家 survival + 手持物品 `itemDef.food > 0` + `food < maxFood` 时调 `eat` 并消耗 1 个（`inventory.removeSelected(1)` + `hotbar.update()`）。饱腹时跳过食用分支继续走工作台/红石/放方块逻辑（与原版一致）。
- 饥饿衰减在 `Game.updateSurvival()`：`saturation > 0` 优先扣 saturation，否则扣 food；`food >= 18` 缓慢回血，`food <= 0` 持续掉血到 1。
- 物品 `food` 字段在 `ItemDefs.js` 注册：面包=5、苹果=4、牛排=8 等。新增食物必须填 `food` 数值。

### 合成系统

- `src/core/Crafting.js`：`addShaped()` 接受一维或二维 pattern，一维 9 元素=3×3、4 元素=2×2，二维如 `[['a'],['b']]`。内部自动转二维并收缩到最小包围盒。`matchRecipe()` 接受二维网格数组。
- `InventoryScreen.js`：E 键打开 2×2 背包合成；右键点击 `crafting_table` 方块打开 3×3 合成。支持鼠标拖放物品（左键交换/合并，右键取半）。点击输出槽获取合成结果并消耗材料。

### 红石系统

- `src/core/RedstoneSystem.js`：信号传播与方块交互。
- 支持：lever（拉杆切换）、button（1秒后自动关闭）、redstone_wire（信号传播）、redstone_torch/block（恒定电源）、piston/sticky_piston（推出/收回活塞头）、redstone_lamp（充能指示）、TNT（引爆）、door/trapdoor（切换状态）。
- `Game.js` 右键点击 lever/button 时调用 `redstone.onBlockInteract()`；放置/破坏方块时调用 `redstone.onBlockChange()`；`update()` 中每帧调用 `redstone.update(dt)`。

### 存档系统（多槽位）

- `src/core/SaveSystem.js`：localStorage 多槽位存档，`SAVE_PREFIX='project-mc-save-'`，`MAX_SAVE_SLOTS=6`，旧版无后缀键自动迁移到槽 1。API：`save(game, slot)` / `load(slot)` / `hasSave(slot)` / `listSaves()` / `deleteSave(slot)` / `findEmptySlot()`。
- `Game.currentSlot` 跟踪当前槽位，`Game.start(mode, seed, loadData, slot=1)` 接受槽位参数。
- `update()` 每 30 秒自动保存；F5 手动保存（注意要 `e.preventDefault()` 否则浏览器刷新）。
- `MenuScreen.js` 是三页主菜单（`page` 状态机：`main`/`single`/`lan`）：主页 = Logo + 「单人游戏」「局域网游戏」两颗石质大按钮 + 视频设置；单人页 = 6 个槽位列表（有存档显示模式/维度/时间/种子并可继续或删除，空槽用选定的模式+种子新建）+ 种子/模式/启用命令设置区；局域网页 = 昵称/服务器/房间名 + 创建/加入房间。`show()` 重置回主页。构造时默认 `display:flex`。按钮统一石质材质：模块级 `stoneSvgDataUri()`（确定性哈希噪点，同 BlockDefs `stoneTex` 风格）生成 data-URI 背景，构造期 `ensureMenuStyles()` 向 head 注入一次 `.cw-stone-btn` 样式表（hover/active/selected 伪类必须走 class，内联样式写不了）；页面导航与视频设置入口走构造期事件委托（render() 重建 innerHTML 无需重绑）。`setMpStatus` 暂存到 `mpStatus` 字段，非 LAN 页先存、进 LAN 页回显（DOM 存在时同步直更）。
- `cheatsEnabled` 持久化字段：存档数据 `data.cheatsEnabled` 由 `SaveSystem.save` 在 `game.cheatsEnabled` 上读取，`listSaves()` 返回项含 `cheatsEnabled`；`MenuScreen` 单人页"启用命令"复选框 → `selectedCheats` 状态 → `onStart(mode,seed,loadData,slot,cheatsEnabled)` 第 5 参数 → `Game.start(mode,seed,loadData,slot=1,cheatsEnabled=false)` 第 5 参数；加载存档时由 `loadData.cheatsEnabled` 覆盖（`Game.start` 第 145-149 行：有 loadData 走 `loadData.cheatsEnabled`，否则走函数参数）。改 API 要同步这 5 处签名。

## 代码风格

- 纯 vanilla JS（.js），无 TypeScript，无 JSX。
- 注释用中文，代码标识符用英文；不添加注释除非明确要求。
- 文件头部有简短中文说明注释（如 `// Game.js -- 游戏主类`），新文件保持此习惯。

## 平台

- 双平台开发环境：Windows（PowerShell 5.1，脚本 `start.cmd`）与 Linux/macOS（bash，脚本 `start.sh`），两脚本动作与语义对标。
- Windows：链式命令用 `;` + `if ($?)`，不要用 `&&`；路径含空格的可执行文件用 call 操作符 `& "..."`。
- Linux/macOS：标准 bash 语法，链式命令可用 `&&`；后台常驻进程由 `start.sh` 用 `nohup` 封装（pid 兜底在 `.run/`，日志落 `*.log`，均已 gitignore）。
- `Read` 工具对长文件有重复返回前几行的 bug，长文件请改用 `Read` 的 offset/limit 分段，或 `Select-String`（Windows）/ `grep`（Linux）。

## 局域网联机（LAN 多人，阶段 0-11 已完成）

- **架构 thin-host（方案C）**：Node 服务器 = 房间管理 + 方块/掉落物账本 + 消息中继 + 时间权威；每个客户端本地自模拟世界（确定性生成 `TerrainGenerator(seed)`，不用 Math.random），只同步增量。消息键 `t`（type），`server/protocol.js` 集中定义；S2C 表见 `docs/lan-multiplayer-design.md` §7。
- **端口**：服务器 TCP **3001**（`.\start.cmd server` / `./start.sh server`），前端 5173（`.\start.cmd start` / `./start.sh start`），管理面板 `http://127.0.0.1:3001/`。
- **多房间（阶段3）**：`RoomManager = Map<房间名, Room>`，同名房间 = 同世界，种子首次创建固定。`welcome.players` 恒为 `[]`，已有玩家经 join_room 里 `player_join` 重放。世界落盘 `server/store.js`（`server/world/<房间名>.json`，`server/*.json` 已 gitignore），重启恢复（hostId=null → 首个加入者成 host）。**换房（阶段5）**：游戏中 `/room <名>` 或 `switch_room` 直接换（保持连接，目标满则拒），客户端用新 seed 重启本地世界。
- **怪物/红石（阶段2）**：方案①事件同步——host 权威生成 + 攻击位置纠正，掉落只由击杀侧发；红石方块状态同步 + 周期性状态缓解。
- **玩家名着色**：`src/net/playerColor.js`（HUES 调色板）。
- **断线重连（阶段1）**：心跳 pong、断线自动重连（保位置/物品）；被踢 `kicked` → `_explicitClose` 停止自动重连。
- **远端插值（阶段4-①+5+6）**：`src/entity/RemotePlayer.js` 关节模型（head/armL/armR/legL/legR pivot 组），**阶段5 时间戳对齐插值**（样本缓冲 + 时钟偏移 + 延迟线性插值，见下方备忘），**阶段6 自适应延迟**（按缓冲"头余量"动态调 0.05~0.4s），距离>4 快照，行走摆臂 + 头部俯仰 + **右手手持物 3D 模型**（`held` 同步 + `HeldItemMesh` 共享缓存构建，阶段10 由 sprite 升级）。
- **死亡观战（阶段4-②+6）**：`Game.spectating/spectateTargetId`，死亡界面 `hideForSpectate()`（勿用 `hide()`，会重生），F5 切目标、R 重生，观战不广播位置（`NetworkManager.update` 早退）；**阶段6 相机平滑**（`_specSmoothed/_specSmoothYaw/Pitch` 指数平滑跟随，切换目标/瞬移不跳变）。
- **管理面板（阶段4-③+5+6+10）**：`server/admin.html` 自包含页 3s 轮询；`/api/status|config|broadcast|kick|logs|tokens|tokens/rotate|tokens/revoke|room/<name>/clear-drops|delete`；配置持久化 `server/config.json` 热生效（dropTtlMs/heartbeatMs/maxPlayersPerRoom/adminToken/adminTokenExpires/adminAccounts，范围校验非法值忽略）；**阶段10 多账号** `adminAccounts=[{token,label,expires}]` 任一未过期账号可通过鉴权，全部撤销=鉴权自动关闭；**阶段6** 过期后除 `POST /api/config` 续期外全 401 + 内存操作日志 200 条 `/api/logs` + 登录会话 TTL；**阶段10** 踢出 API 带可填写原因（透传 `kicked.reason`）。
- **死亡掉落物（阶段6+10）**：客户端死亡 `player_died` 上报背包 → 服务器 `Room.onPlayerDied` 广播死亡 + 逐项 `drop_spawn`（进账本持久化）；同一次死亡 `_diedDrops` 去重（`onRespawn` 复位）；死亡端清空背包、重生重发生存初始物品（`Game.respawn` 联机分支）；**阶段10 归属锁**：死亡掉落带 `owner`/`ownerUntil`（3 秒），锁内非 owner 拾取被服务器拒（`drop_deny` + 补发 `drop_spawn` 重建实体），客户端预判拦截 + deny 回滚背包（`Inventory.removeItems` + `takePendingPickup`）。
- **阶段11 打磨包**：①挥动联动——挖掘挥动周期≈实际挖穿耗时（`hand.miningPeriod` ← `hardness/speedMul` 钳 0.25~1.0s），`player_state` 增 `mine` 标志驱动远端 armR 摆臂；②头顶快捷栏——`src/render/RemoteHotbarSprite.js` 9 槽 canvas sprite（昵称上方，指纹节流重绘，每实例 texture/material dispose）；③白名单/权限——`config.roomWhitelist`/`roomOps`（`{房间名:[昵称]}`，存 config.json），入房/换房拦截（join/create 回 `kicked`、switch_room 聊天拒），`adminAccounts[].role='op'|'viewer'`（viewer 非 GET 全 403），`Room.isOperator()` 放行 gamemode/set_time/world_reset，API `GET/POST /api/whitelist` + `/api/whoami`；④抖动自适应——`src/net/netStats.js` 纯函数（RTT EMA + 相邻差抖动 EMA，目标延迟 = 0.05+rtt/2000+jitter/4000 钳 0.05~0.4），InfoBar 显示 `网络: Xms ±Yms`。细节防回退见 `docs/agent-notes/multiplayer.md` 阶段 11 节。
- **Idea-3 进展（体验与性能补强池，已完成）**：A 音频（A-① `src/audio/AudioEngine.js` WebAudio 程序化合成单例、惰性解锁、材质九类分路、六处接线，`sound`/`volume` 进 Settings；A-② 怪物语音 VOICE_PRESETS+全局限频+距离衰减、距离驱动脚步/落地/水花、计划式风声+BGM 走 music 分轨、`music` 开关）；B Worker 化（B-0 探针通过：**worker 图必须补 BlockDefs 副作用导入否则全空气**；B-① 地形生成 TerrainWorker/Client 主世界专用、`World.requestChunk` 异步预取 + ensureChunk 同步不变 + broken 熔断；B-② 网格构建：ChunkMesh 收集/装配分离、体素光缓存解耦、**`geo.setIndex(TypedArray)` 必须包 BufferAttribute 否则渲染崩溃且 rAF 静默死亡**、版本化派发+熔断）；C 服务器玩家档案（`server/world/players/<房间>.players.json` 独立目录、`profile_save`/`player_profile` 协议、**数值字段 typeof 强校验防 Number(null)=0 洗白**、10s 节流落盘+退房即刷、同维度才应用位置、op 清理 API+面板入口、`test-profile.mjs` 22/22 已并入跑批）。防回退见 `docs/agent-notes/ui-misc.md` Idea-3A/3A-②/3B 节、`rendering-lighting.md` Idea-3B-② 节、`multiplayer.md` Idea-3C 节（含 **eval 探针 Vite ?t= 实例分裂陷阱**与**测试文件 const URL 遮蔽全局类陷阱**）。
- **Idea-2 进展（TODO.md 机制池）**：A 弓蓄力（按住蓄力/松手发射/初速伤害插值/拉弓姿态，`_bowCharging` 通道独立于右键单击分支，未命中早退守卫放宽 bow/ender_eye 修复对空不可用）；B 箭矢联机（`arrow_shot` 事件式初速广播、同维度转发 except 发起者、远端箭 `remote:true` 纯视觉不结算伤害射端权威，`test-idea2.mjs` 7/7）；E 铁傀儡（`guardian` AI 分支索敌反击/大击退/村庄≥5 村民自动补员 60s 冷却/南瓜+铁块 T 型手工召唤，passive+guardian 双标记不占怪名额）；C 潜影盒（`shulker_box` 27 槽容器方块，内容跟随物品：`drop_spawn`/`player_died`/`container_set` 可选 data 通道 + `sanitizeItemData` 拒绝盒中盒，带 data 物品不堆叠，破坏单一掉落/放置落账本广播，`test-idea2.mjs` 12/12）；D 凋零（D-① 头颅物品 10% 掉落；**D-② 凋灵 Boss 已交付**：头颅方块化同名互通 + `_trySummonWither` T 型召唤 + `WitherAI` rise/hover/狂暴齐射 + 凋灵之首弹射物（各端本地结算本地玩家，广播纯视觉）+ 凋零 II（`player.withered` 每秒扣血）+ BossBar 多实例 + 下界之星，`test-idea2.mjs` 16/16；**D-③ 信标 + buff 系统已交付**：`Player.effects` Map（凋零已迁入）五挂钩移速/急迫/抗性/跳跃/力量 + beacon 方块（原版式合成）+ 金字塔检测 1~4 层降级/失效 + BeaconScreen 选效果 + 4s 脉冲无缝续期 + 内存级激活状态与光柱）。见 `docs/agent-notes/multiplayer.md` Idea-2B/2C 节、`mobs-entities.md` Idea-2E/2D 节、`survival-items.md` 弓条目。
- **Idea-4A 房间开关（已交付）**：`config.roomSettings {房间名:{pvp,mobs}}`（缺省全开，`sanitizeRoomSettings` 清洗）——服务器权威过滤（`Room.onAttack`/`onMobSpawn` 短路+系统提示）+ 客户端闸门（`WORLD_INFO.settings` 下发、`room_settings` 热广播、`NetworkManager.sendMobSpawn` 发送口短路=零漂移单一漏斗）；`GET /api/settings` + `POST /api/room/<n>/settings`（boolean 严格校验，viewer 403）；面板房间卡 checkbox。防回退见 `docs/agent-notes/multiplayer.md` Idea-4A 节。
- **Idea-4B/4C 备份+限速（已交付）**：B `store.roomSnapshot`（与 saveRoom 共用序列化）+ `GET /api/room/<name>/backup`（**op 专属**，viewer 对 GET 也 403 须路由内显式判；Content-Disposition 只放 ASCII）+ 自动备份 `backupIntervalMinutes`(0=关)/`backupKeep`(默认 10)；C `server/ratelimit.js` 令牌桶（**getLimit 闭包活读 config 热生效**，勿缓存容量）三档 `rateLimits {chat:30, block:900, state:1800}` 每分钟（0=不限），PING/握手豁免，`player.dropped` → 面板「限速丢包」列 + 10s WeakMap 增量聚合 adminLog（勿逐包写日志）。防回退见 `docs/agent-notes/multiplayer.md` Idea-4B/4C 节。
- **联机测试**：起真实 server 后跑 `node server/test-mp.mjs`（34/34）、`server/test-store.mjs`（15/15）、`server/test-admin.mjs`（26/26）、`server/test-stage5.mjs`（16/16）、`server/test-stage6.mjs`（20/20）、`server/test-stage10.mjs`（41/41）、`server/test-stage11.mjs`（45/45）、`server/test-idea2.mjs`（16/16）、`server/test-profile.mjs`（22/22）、`server/test-idea4.mjs`（42 断言），须保持全绿。**一键跑批**：`./server/run-all-tests.sh`（清状态→起服→跑全部套件→停服→**自动清除测试世界与鉴权账号**，任一失败退出 1；CI 同款入口，跑前须 3001 空闲）。**非幂等防线（Build 23 起）**：stage11 收尾 API 级清空 adminAccounts + 停服后文件级清 `server/world/` 与 `server/config.json`；若单独跑个别套件仍可能遗留鉴权态（重复跑批前手动清空或重启服务器，否则遗留世界存档/管理口令会污染断言）。浏览器冒烟用 playwright-cli 三会话 `-s=host/-s=join/-s=three`。CI：`.github/workflows/ci.yml` 在 push master/PR 时跑 build + 全套件（`node --check` 级语法由 build 与套件加载覆盖）；agent 驱动冒烟不进 CI。

## 任务进度（Roadmap）

LAN 联机阶段 0-11 已全部完成（`https://github.com/illagerCPR/CubeWorld.git`，原 Web-MC 已改名 CubeWorld，localStorage 前缀 `project-mc-save-` 为兼容保留）。各阶段交付内容与提交号用 `git log --oneline` 查看，设计细节见 `docs/lan-multiplayer-design.md`（v1.1）。

**交付约定（2026-09-12 起）**：每完成一个阶段性批次即 `git push origin master`，并用 `gh run watch <runId> --repo illagerCPR/CubeWorld --exit-status` 确认 CI 绿后再收尾汇报；不积压未推送的本地提交。

**版本号与发布规则（2026-09-13 确立）**：
- 版本格式 **Alpha Build X**；X 从 1 起，**每次功能交付完成（批次 push + CI 绿）递增 1**，一个批次 = 一个 Release。
- 版本常量唯一来源 `src/version.js`（`BUILD` 数字 + `VERSION_LABEL` 模板）：递增版本只改这一个数字，其他地方一律引用常量，禁止硬编码版本文本。
- **版本号同步纪律（2026-09-13 补强）**：每次变动版本号（BUILD 递增）**必须在同一批次提交内更新 `src/version.js` 的 `BUILD`**——主界面与游戏内左下角均引用 `VERSION_LABEL` 常量自动跟随，改常量即改界面，勿漏；发布 Release 前先核对 `src/version.js` 的 BUILD 数值 = 目标 Build 号（曾发生连发 3 个 Release 而常量停在 1、界面显示与实际版本脱节的失误）。
- 显示规则：主界面（`MenuScreen.versionEl`）与游戏内（`Hud.versionTag`）**左下角**常驻文本 `CubeWorld Alpha Build X`，格式勿改；新增 UI 不得遮挡/移除该元素（主菜单元素挂 body 勿挂 `MenuScreen.el`——`render()` 重建 innerHTML 会清除）。
- 发布：每批 CI 绿后 `gh release create alpha-build-<X> --repo illagerCPR/CubeWorld --title "CubeWorld Alpha Build <X>" --notes "<本批内容简述>"`，tag 指向已绿的 master 提交。

后续候选（见 `docs/lan-multiplayer-design.md` §11 阶段 12）：Tab 玩家列表面板、远端盔甲外观同步、服务器性能面板（消息速率图表）、房间私聊/队伍分组。

## 批次备忘索引（按需必读，防回退）

本文件只保留每轮会话必需内容；各批次踩坑备忘已按主题搬到 `docs/agent-notes/`（原文搬移未改写）。**改动对应子系统前必须先读对应文件**；新批次备忘写入对应主题文件并同步更新下表，禁止直接追加到本文件（全局级陷阱除外）。

| 文件 | 涵盖批次 | 何时必读 |
|---|---|---|
| `docs/agent-notes/fluid-sim.md` | B26 流体模拟（M1 可流动水/岩浆 + M3 联机批量/相遇固化 + M2 部分水位） | 流体、FluidSim、方块注册白名单、水面渲染高度 |
| `docs/agent-notes/worldgen-structures.md` | 自然建筑/村庄/要塞、T5 战利品箱与村民交易、W 水面/洞穴、生物群系规模、群系扩展、B25 树让位/村庄麦田/全景禁结构 | 地形生成、结构、群系、loot/容器/交易 |
| `docs/agent-notes/dimensions-portals.md` | 维度基建/下界/末地/天域/联机同步、传送门、下界优化、末地完善（龙/末地城）、天域叙事基石（批次 A）、天域群风与众生（批次 B）、天域守誓巨像（批次 C）、天域复潮（批次 D） | 维度、传送门、下界/末地、换维联机、天域内容注册/i18n 审计/气流与免摔落/Boss AI/复潮档案 |
| `docs/agent-notes/survival-items.md` | P0 燧石/打火石/黑曜石、P1 挖掘/盔甲/经验、P2 床/掷眼、P3 桶/弓/耕种、B27 床/门/活板门形制（状态 ID 家族/shape AABB/睡眠体验） | 生存机制、工具/盔甲/食物、合成/掉落、门/床形制与碰撞 |
| `docs/agent-notes/mobs-entities.md` | 怪物系统总备忘、受击反馈、被动动物/末影人、阶段 7 建模、阶段 8 朝向贴图 | 怪物/生物/AI/建模、实体物理 |
| `docs/agent-notes/rendering-lighting.md` | 光照视觉增强（反射/云影/泛光/体积光）、阶段 9 材质重绘、Idea-3B-② 网格 Worker、B28 方块材质（定向面/多面纠偏/状态家族） | 渲染、光照视觉、材质、后处理、网格构建、方块贴图 |
| `docs/agent-notes/multiplayer.md` | 阶段 5 插值/鉴权、阶段 6 手持物/掉落物/观战、阶段 10 3D 手持/快捷栏/归属锁/多账号、阶段 11 挥动联动/头顶快捷栏/白名单权限/抖动、Idea-3C 玩家档案、Idea-4A 房间开关 | 联机协议、插值、掉落物、管理面板、玩家档案、房间开关 |
| `docs/agent-notes/ui-misc.md` | CubeWorld 改造（改名/全景/粒子/物品重绘/视频设置）、JEI 伴随面板、命令面板、UI 子系统、Idea-3A 音频底座 | 菜单/视频设置、粒子、UI 界面、作弊面板、音频 |

历史高危 bug 快查（细节见对应主题文件）：`EntityPhysics.moveAxis` z 轴碰撞回退曾误用 `bx` 致实体瞬移（回退坐标必须取当前轴 `bc`，勿回退）；`Mob` 攻击分流用 `target.isMob` 鸭子标记而非 instanceof（HMR 双模块实例下 instanceof 失效）；`NetworkManager` 重连必须 `JOIN_ROOM { room: this.room }`（空 payload 会静默掉进 default 房，两端数据对不上）。
