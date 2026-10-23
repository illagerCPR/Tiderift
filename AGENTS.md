# AGENTS.md

## 语言

- 对话回复使用简体中文。
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
npm test             # 一键回归（= ./server/run-all-tests.sh，需 bash）
node --check <file>  # 语法检查（唯一可自动化验证手段）
```

- 不走 `npm run dev`：`start.cmd`（Windows，最小化窗口标题 `vite-dev-server`）/ `start.sh`（Linux，`nohup` 后台常驻 + 日志 `dev-out.log`/`dev-err.log`）都直接后台拉起 `node node_modules/vite/bin/vite.js`。端口 5173 无响应时先 `status`，必要时 `restart`。
- 无 lint、无 typecheck；回归套件由 `npm test` 跑批，两侧各有**唯一** runner 框架（`tests/harness.mjs` / `server/test-lib.mjs`，B30 轮 7 收敛），套件内禁止再写 runner 样板与 `process.exit`（`tests/framework-guard.mjs` 会静态拦下）。修改后必须 `node --check` 改动的每个文件，再用浏览器/playwright 手测。
- `npm test` 与 `./server/run-all-tests.sh` 等价（清状态→起服→跑全部套件→停服，任一失败退出 1，跑前须 3001 空闲）；脚本是 bash，Windows 原生 cmd/PowerShell 下无 bash 会直接失败，须在 Git Bash / WSL 中执行或手动 `bash server/run-all-tests.sh`。
- Vite 5 + Three.js 0.160，ESM 原生导入，无打包工具链额外配置。

## 验证 / playwright-cli

- （Windows）不要直接 `playwright-cli open <url>`（启动失败）。要用带 `.cmd` 扩展的完整路径：
  `& "$env:APPDATA\npm\playwright-cli.cmd" reload|click|eval|console <args>`（npm 全局 bin 目录，路径随用户名变化，勿硬编码）
- （Linux/macOS）直接 `playwright-cli reload|click|eval|console <args>`，无 `.cmd` 后缀问题。
- `playwright-cli eval` 中的字符串字面量常被 PowerShell 吃掉引号/反引号（Windows）；传含 `name: "torch"` 之类参数时改用 `String.fromCharCode(...)` 拼接，或把脚本写到临时文件再 `eval --filename`。Linux/macOS 下 bash 引号规则正常，此陷阱不适用。
- playwright 无 pointer lock 能力，ESC 暂停 / 死亡屏幕等 pointer-lock 相关流程只能 `eval` 直接调用 `pauseMenu.show()`/`deathScreen.show()` 验证。
- PNG 截图可直接用 Read 工具（read_image）查看，用于画面级渲染验证。

## 验证 / agent-browser（可真实操作 3D 世界，已实测 2026-08-31）

agent-browser（实测 0.35.2，`npm i -g agent-browser`）是本项目的**第二套浏览器冒烟工具**，与 playwright-cli 互补。核心差异：**能捕获指针锁 + 真实键盘/鼠标输入 → 单机与联机都能真实移动/转向/挖/放/聊天**（playwright-cli 做不到）。DOM UI 用快照 + `@eN` 语义引用（无需选择器），HUD DOM 直接桥接实时 3D 状态（坐标/生物群系/时间/准星方块）。详细实测见 `docs/agent-browser-eval.md`。

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
- **F3 上帝类拆分已完成（B30 轮 8，共 9 步＝步 0 行为回归网 + 8 个域模块；Game.js 3769 → 2273 行）**：形态＝**门面委托**——逻辑迁到 `src/player/*` 新模块，Game 保留同名薄门面（签名不变），外部依赖面（NetworkManager / CommandPanel / BeaconScreen / `window.game` / tests 源码绊线）保持不变。已迁出：召唤（`Summoning.js`）、滑翔与气流（`GlideWind.js`）、终局（`Endgame.js`：末影龙生成守卫 / 龙败奖励链 / 回程垫 / 折跃门阵列 / 龙蛋 / 末影水晶击碎）、弹射物（`Projectiles.js`：箭 / 末影之眼 / 弓蓄力 / 凋灵之首 / 风弹）、信标（`Beacon.js`：金字塔等级 / 效果脉冲 / 光柱）、放置与容器（`Placement.js`：门/床/活板门形制放置与连动破坏 / 箱子与潜影盒内容散落 / 容器改动上报 / 熔炉推进与点燃态同步；域状态 `World.furnaces`/`World.containers` 仍归 World）、传送门（`PortalSystem.js`：点火 / 末影之眼嵌框 / 站门计时 / 到达落点与返程门 / 立地面下探；穿越三件套 `_portalTimer`/`_portalArmed`/`_portalCooldown` 与 `portalOverlay` 仍留 Game）、天域终局与复潮（`AetherFinale.js`：守誓巨像震地与风拽光环 / 复潮仪式 / 候潮献证 / 听潮门控 / 纹章发放 / 四界同潮演出窗口与四段粒子；演出窗口随迁控制器 `tide`，Game 侧保留只读访问器 `get _finaleTide()` 供 CommandPanel 探针）、鼠标交互（`InteractionController.js`：整段 `handleMouseInput`——UI 门控与未命中早退 / 弓蓄力通道 / 左键链（创造瞬破・生存挖掘・攻击・联机互殴）/ 右键链（食用・经验瓶・工作台・容器・红石・形制与普通放置・耕种・桶・弓・掷眼・上床・祭坛献证・石碑听潮）；Game 侧保留同名薄门面，域内调用面契约＝四态「点击已消费」协议 `CONSUMED`/`ABORT`/`CONSUMED_PASS`/`PASS` + `exitsMethod()`，30 处 `controls.mouse*` 置位语句仍在原位置逐字保留）；跨域基础设施（`constructor`/`start`/`update`/`_disposeWorld`/`_frameRay`/`updateRaycast`/`_anyInputBlockingUI`）不动。轮 9 步 1 修 H1：右键链的放置重叠守卫已移入 `if (blockDef)` 内——只对真正要放置的方块生效，手持弓/末影之眼等非方块物品不再被静默吞掉右键。迁移顺序、不变量与每步验收骨架见 `docs/archives/improvement-plan-b30.md` §十一。
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
5. UI（Hotbar、InventoryScreen）通过 `game.blockSvgMap` / `game.itemSvgMap` 查 SVG 字符串，用 `SVGTextures.svgToImage()` 绘制到 canvas。**B29 起图标绘制统一走 `src/render/BlockIcon.js` 的 `drawIconInto()`**（物品 SVG 平铺 → 立方方块等轴三面 → 其余单面兜底；等轴判定 `isIsoBlock`、技术方块过滤 `isTechnicalBlock` 均在 `ItemCategories.js`）——新 UI 禁止自绘方块图标链。

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
- `player.onHurt = (amount, source) => this.hud.flashDamage(amount)` 在 `Game.start()` 中注册。新加伤害源时**所有一次性攻击**（怪物 `Mob.attack`、摔落、爆炸）应调用 `player.hurt(amount, source, true)`；持续/低频伤害（溺水每秒 2 血、饥饿每秒 0.5 血）直接 `player.health -= amount`，**不要**触发红屏（连续闪屏很烦）。
- `Hud.flashDamage(damage)` 内部 set opacity 到 `Math.min(0.9, 0.3 + damage * 0.04)` 后用双层 `requestAnimationFrame` 启动 `transition: opacity 0.5s ease-out` → 0 的淡出。修改时**不要去掉双层 RAF**——少了会让 opacity 0 立刻写回覆盖 intensity。

### 玩家物理与游泳

- `Physics.moveAxis()` 对每个轴单独移动+碰撞回退，**收集所有碰撞方块取最保守的回退位置**（不要改回"命中即停"的早期实现，曾导致穿墙）。
- **auto-jump（自动台阶，仅陆上）**：`moveAxis` 中水平碰撞时若 `maxBlockTopY - entity.position.y > 0 && <= 1.0+0.01`，且抬升后 `[targetY, targetY+height]` 范围内无碰撞（`_yClearAt`），则直接抬升 y 而不回退水平位置。
- **水中上岸（B30 起，类原版，勿改回瞬抬）**：`moveAxis` 水平碰撞且 `entity.bodyInWater && !entity.flying` 时不再瞬抬台阶，改为**上浮助推** `velocity.y = max(vy, WATER_EXIT_BOOST=4.0)`（与 Space 上浮同级）——贴岸逐帧上爬、翻过岸沿后由水平移速自然带上岸；助推门限 `vy > WATER_EXIT_VY_GATE(-0.6)`（潜游下潜/坠水掠墙不打断）。**浸水判定用 `bodyInWater`（脚部+0.05/躯干+0.9 任一格为水，`Physics._bodyInWater`），勿用眼位 `inWater`**——贴岸上爬时头先出水，眼位判定会翻 false 使助推中断。岸沿可越（stepH≤1.0）是助推前置，水面以上的高墙因此爬不上去（原版语义）。
- 水中物理：`inWater` 由 `Game._updateWaterState(dt)` 根据眼睛位置方块 `def.fluid && fluidType==='water'` 判定；水中重力 -8、阻力 0.8、水平速度上限 ~4.3；Space 上浮、Shift 下潜（逻辑在 `Game.update()` 中而非 Physics）。
- 氧气/溺水（B30 起原版口径，`src/core/AirSupply.js` 纯函数，node 可测）：`airTicks` 语义=原版 tick（20 tick/s），满氧 300 = **15 秒**，逐帧按 `dt*20` 折算（帧率无关）；耗尽后 `drownTimer` 每 1 秒扣 2 血；出水约 0.5 秒回满。勿改回逐帧 -1（60fps 下只有 5 秒）。
- Hud 顶部 `airBar` 显示剩余氧气（仅 `inWater && airTicks<300` 时渲染；气泡公式 `(airTicks/300)*10` 以 300 为满）。

### 食物与饥饿

- `Player.eat(itemDef)` 是统一食用入口：创造/旁观 / `food >= maxFood` 时拒绝；否则 `food += itemDef.food`、`saturation += food * 0.6`，都 clamp 到 `maxFood`。返回 true 表示成功吃下。
- `InteractionController`（B30 轮 8 步 8 起；原 `Game.handleMouseInput`）右键分支**优先**检查食物：玩家 survival + 手持物品 `itemDef.food > 0` + `food < maxFood` 时调 `eat` 并消耗 1 个（`inventory.removeSelected(1)` + `hotbar.update()`）。饱腹时跳过食用分支继续走工作台/红石/放方块逻辑（与原版一致）。
- 饥饿衰减在 `Game.updateSurvival()`：`saturation > 0` 优先扣 saturation，否则扣 food；`food >= 18` 缓慢回血，`food <= 0` 持续掉血到 1。
- 物品 `food` 字段在 `ItemDefs.js` 注册：面包=5、苹果=4、牛排=8 等。新增食物必须填 `food` 数值。

### 合成系统

- `src/core/Crafting.js`：`addShaped()` 接受一维或二维 pattern，一维 9 元素=3×3、4 元素=2×2，二维如 `[['a'],['b']]`。内部自动转二维并收缩到最小包围盒。`matchRecipe()` 接受二维网格数组。
- `InventoryScreen.js`：E 键打开 2×2 背包合成；右键点击 `crafting_table` 方块打开 3×3 合成。支持鼠标拖放物品（左键交换/合并，右键取半）。点击输出槽获取合成结果并消耗材料。

### 红石系统

- `src/core/RedstoneSystem.js`：信号传播与方块交互。
- 支持：lever（拉杆切换）、button（1秒后自动关闭）、redstone_wire（信号传播）、redstone_torch/block（恒定电源）、piston/sticky_piston（推出/收回活塞头）、redstone_lamp（充能指示）、TNT（引爆）、door/trapdoor（切换状态）。
- 右键点击 lever/button 时调用 `redstone.onBlockInteract()`（右键路径 B30 轮 8 步 8 起在 `InteractionController.js`，Game 侧同名门面）；放置/破坏方块时调用 `redstone.onBlockChange()`；`update()` 中每帧调用 `redstone.update(dt)`。

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
- **Idea-4B/4C 备份+限速（已交付）**：B `store.roomSnapshot`（与 saveRoom 共用序列化）+ `GET /api/room/<name>/backup`（**op 专属**，viewer 对 GET 也 403 须路由内显式判；Content-Disposition 只放 ASCII）+ 自动备份 `backupIntervalMinutes`(0=关)/`backupKeep`(默认 10)；C `server/ratelimit.js` 令牌桶（**getLimit 闭包活读 config 热生效**，勿缓存容量）现为七档 `rateLimits {chat:30, block:900, state:1800, join:30, skin:30, profile:60, skinFetch:30}` 每分钟（0=不限；B30 轮 5 扩档），PING/握手豁免，`player.dropped` → 面板「限速丢包」列 + 10s WeakMap 增量聚合 adminLog（勿逐包写日志）。防回退见 `docs/agent-notes/multiplayer.md` Idea-4B/4C 节与「B30 审查轮 5」节。
- **联机测试**：起真实 server 后跑 server 侧套件（`node server/test-*.mjs`：test-mp / test-store / test-admin / test-stage5 / test-stage6 / test-stage10 / test-stage11 / test-idea2 / test-profile / test-idea4 / test-t5 / test-dim / test-skinlog / test-hardening-net / test-hardening-edge / test-hardening-store），另有 `tests/` 下不依赖服务器的纯 node 套件（structure-determinism / loot-determinism / cave-determinism / biome-determinism / dimension-determinism / biome-scale-determinism / portals-unit / nether-* / overworld-* / end-* / aether-* / i18n-parity / leak-guards / version-pin / room-persist-replay / net-message-guard 等）；全部套件须全绿，**套件清单与计数以 `./server/run-all-tests.sh` 输出为准，文档不维护 `(N/N)` 计数**。**一键跑批**：`npm test`（= `./server/run-all-tests.sh`，清状态→起服→跑全部套件→停服→**自动清除测试世界与鉴权账号**，任一失败退出 1；CI 同款入口，跑前须 3001 空闲）。**非幂等防线（Build 23 起）**：stage11 收尾 API 级清空 adminAccounts + 停服后文件级清 `server/world/` 与 `server/config.json`；若单独跑个别套件仍可能遗留鉴权态（重复跑批前手动清空或重启服务器，否则遗留世界存档/管理口令会污染断言）。**runner 框架唯一化（B30 轮 7 起）**：`tests/` 与 `server/` 各只有一份 runner（`tests/harness.mjs` / `server/test-lib.mjs`），套件内禁止自定义 runner 样板与 `process.exit`（`tests/framework-guard.mjs` 静态拦；server 侧 socket 关闭态套件用 `finish({ natural: true })` 走 `process.exitCode`）；`tests/harness.mjs` 的 `ok()` 成功默认静默，迁移前逐条打印的套件用 `configure({ verbose: true })`。**新增套件 = 新建文件 + 在 `run-all-tests.sh` 的 `PURE_NODE_SUITES` 数组（tests 侧）或 server 循环清单（server 侧）加一行**。**Game.js 行为回归网（B30 轮 8 起）**：`tests/lib/game-env.mjs` 提供 node 假环境（DOM / WebGL Proxy / 进程内 Worker / 内存 localStorage 桩），`tests/game-behavior.mjs` 用它按**真实运行时行为**断言 `src/player/Game.js`（boot / 帧循环 / 射线链 / 生存挖掘 / 重开生命周期 / 地形确定性 / 无人守契约），是 F3 拆分的安全网；**共享环境模块必须放 `tests/lib/` 子目录**——`framework-guard` 单层扫描 `tests/` 顶层，放顶层会被当成套件并要求 import 框架。该假环境的边界（渲染零覆盖、无 pointer lock、Worker 仅仿真）见 `docs/archives/improvement-plan-b30.md` §十一。浏览器冒烟用 playwright-cli 三会话 `-s=host/-s=join/-s=three`。CI：`.github/workflows/ci.yml` 在 push master/PR 时按 `.nvmrc`（当前 24）装 Node → 对 `src/`、`server/`、`tests/` 全量 `node --check`（E12 起，任一失败即整步失败）→ `npm run build` → 全套件跑批；agent 驱动冒烟不进 CI。

## 任务进度（Roadmap）

LAN 联机阶段 0-11 已全部完成（`https://github.com/illagerCPR/Tiderift.git`，原 Web-MC → CubeWorld → **Tiderift（裂潮，B29 定名，世界观见 `docs/worldview.md`）**，localStorage 前缀 `project-mc-save-` 为兼容保留不动）。各阶段交付内容与提交号用 `git log --oneline` 查看，设计细节见 `docs/lan-multiplayer-design.md`（v1.1）。

**交付约定（2026-09-12 起）**：每完成一个阶段性批次即 `git push origin master`，并用 `gh run watch <runId> --repo illagerCPR/Tiderift --exit-status` 确认 CI 绿后再收尾汇报；不积压未推送的本地提交。

**版本号与发布规则（2026-09-13 确立；B29 起更新）**：
- 版本格式 **Tiderift Beta Build X**（B29 前为 `CubeWorld Alpha Build X`；**前缀变动 Build 数不重置**，X 连续递增）；X 从 1 起，**每次功能交付完成（批次 push + CI 绿）递增 1**，一个批次 = 一个 Release。
- 版本常量唯一来源 `src/version.js`（`BUILD` 数字 + `VERSION_LABEL` 模板）：递增版本只改这一个数字，其他地方一律引用常量，禁止硬编码版本文本。
- **版本号同步纪律（2026-09-13 补强）**：每次变动版本号（BUILD 递增）**必须在同一批次提交内更新 `src/version.js` 的 `BUILD`**——主界面与游戏内左下角均引用 `VERSION_LABEL` 常量自动跟随，改常量即改界面，勿漏；发布 Release 前先核对 `src/version.js` 的 BUILD 数值 = 目标 Build 号（曾发生连发 3 个 Release 而常量停在 1、界面显示与实际版本脱节的失误）。
- 显示规则：主界面（`MenuScreen.versionEl`）与游戏内（`Hud.versionTag`）**左下角**常驻文本 `Tiderift Beta Build X`，格式勿改；新增 UI 不得遮挡/移除该元素（主菜单元素挂 body 勿挂 `MenuScreen.el`——`render()` 重建 innerHTML 会清除）。
- 发布：每批 CI 绿后 `gh release create beta-build-<X> --repo illagerCPR/Tiderift --title "Tiderift Beta Build <X>" --notes "<本批内容简述>"`，tag 指向已绿的 master 提交（B29 前的 tag 为 `alpha-build-1..28`，保留不改）。
- **发布授权（2026-10-23 用户确认）**：只要**本轮计划文件/交付计划已明确安排该 Release**（如 `docs/archives/new-horizon-plan-b34.md` 写明某轮发布 `beta-build-X`），CI 全绿后即**直接 `git tag -s` + push tag + `gh release create`，无需再向用户逐次确认**；计划未提及发布时才需要先问。
- **更名落地（B29）**：游戏内显示名/README/徽章/package.json 已改 Tiderift；仓库已 `gh repo rename`（旧 URL GitHub 自动重定向）；**本地工作区目录名 `project-mc` 保留不改**；`res/logo-tiderift-js-edition.png` 为当前 logo（旧 logo-cubeworld 素材保留未引用）。

后续候选（见 `docs/lan-multiplayer-design.md` §11 阶段 12）：Tab 玩家列表面板、远端盔甲外观同步、服务器性能面板（消息速率图表）、房间私聊/队伍分组。

**Build 34 · New Horizon Part.1（已交付）**：计划见 `docs/archives/new-horizon-plan-b34.md`，三个里程碑共用一个 Build/Release。**A 四界游记与手绘地图**（`src/core/Journal.js` + `src/ui/JournalScreen.js` + N 键 + 房间共享标记协议）、**B 旧航路修复**（`src/core/Waymarks.js` + `src/ui/WaymarkScreen.js` + 航标芯方块 + `waymark_*` 房间权威协议）均保持 Build 33 提交；**C 御风竞速与自建赛道**（`src/core/RaceTracks.js` + `src/core/RaceRun.js` + `src/ui/RaceScreen.js` + `src/ui/RaceHud.js` + `race_post` 方块 + `race_*` 房间权威账本）在自身提交内把 `BUILD` 升到 34 并发布 `beta-build-34`。防回退见 `docs/agent-notes/journal.md`、`waymarks.md` 与 `races.md`。

**Build 35 · E 建筑蓝图与材料清单（已交付，保持 Build 34，未发布）**：`src/core/Blueprints.js`（描述式模型 + RLE 编解码 + 区域捕获 + 材料统计）、`src/render/GhostPreview.js`（纯视觉体素预览 + 超限包围盒降级）、`src/ui/BlueprintScreen.js`（B 键界面：两次框选捕获、预览控制、材料三列、分享/删除）、`blueprint_*` 房间权威账本（服务器重算 `dim`/`byId`/`rev`，创建者或 op 可删改，20+10/min 令牌桶）。捕获只读已加载区块，未加载即拒不读成空气；空气进 RLE 但不渲染不计料。**发布仍与 D 同批**（本批不动 `src/version.js`）。防回退见 `docs/agent-notes/blueprints.md`。

**Build 35–37 · New Horizon Part.2–4（E 已交付，D/F/G 未交付；2026-10-23 定）**：计划见 `docs/new-horizon-plan-b35-37.md`。**Build 35** = E 建筑蓝图与材料清单（已交付，保持 Build 34）+ D 可动手解开的遗迹（后做，升 35 并发布）；**Build 36** = F 仓储与运输工程（F-1 漏斗与容器搬运、F-2 熔炉进出料，两次提交、升 36 一次发布）；**Build 37** = G 局部潮候与稀有景象（升 37 发布）。拆分判据：F 是唯一新增"服务器固定节拍权威物品流"的架构面且熔炉内容至今不在联机账本，必须独占一个 Build；D 的完整解法奖励发 E 的蓝图，故 E 与 D 同 Build 且 E 先做；G 只做可见现象与观测记录，红线是不改地形与水位。

## 批次备忘索引（按需必读，防回退）

本文件只保留每轮会话必需内容；各批次踩坑备忘已按主题搬到 `docs/agent-notes/`（原文搬移未改写）。**改动对应子系统前必须先读对应文件**；新批次备忘写入对应主题文件并同步更新下表，禁止直接追加到本文件（全局级陷阱除外）。

**文档归档约定（2026-10-23）**：已交付的审计 / 计划 / 设计稿用 `git mv` 移入 `docs/archives/`（只读留档，不再续写）；活文档不进归档——`README.md`、`AGENTS.md`、`docs/TODO.md`、`docs/bug.md`、`docs/development.md`、`docs/worldview.md`、`docs/lan-multiplayer-design.md`、`docs/agent-notes/` 与在办计划。归档后必须同步改完仓库内所有引用路径（含 `src/` 注释里的文档引用）。

| 文件 | 涵盖批次 | 何时必读 |
|---|---|---|
| `docs/agent-notes/world-ledger.md` | B30 审查轮 6（F7 modifiedBlocks 分桶索引、F12 红石/流体待处理队列键化） | 改动 World.setBlock/applyModifications、modifiedBlocks 账本、RedstoneSystem/FluidSim 待处理队列时 |
| `docs/agent-notes/fluid-sim.md` | B26 流体模拟（M1 可流动水/岩浆 + M3 联机批量/相遇固化 + M2 部分水位） | 流体、FluidSim、方块注册白名单、水面渲染高度 |
| `docs/agent-notes/worldgen-structures.md` | 自然建筑/村庄/要塞、T5 战利品箱与村民交易、W 水面/洞穴、生物群系规模、群系扩展、B25 树让位/村庄麦田/全景禁结构 | 地形生成、结构、群系、loot/容器/交易 |
| `docs/agent-notes/dimensions-portals.md` | 维度基建/下界/末地/天域/联机同步、传送门、下界优化、末地完善（龙/末地城）、天域叙事基石（批次 A）、天域群风与众生（批次 B）、天域守誓巨像（批次 C）、天域复潮（批次 D） | 维度、传送门、下界/末地、换维联机、天域内容注册/i18n 审计/气流与免摔落/Boss AI/复潮档案 |
| `docs/agent-notes/survival-items.md` | P0 燧石/打火石/黑曜石、P1 挖掘/盔甲/经验、P2 床/掷眼、P3 桶/弓/耕种、B27 床/门/活板门形制（状态 ID 家族/shape AABB/睡眠体验）、B30 水中上岸助推 + 氧气原版口径 | 生存机制、工具/盔甲/食物、合成/掉落、门/床形制与碰撞、游泳/氧气 |
| `docs/agent-notes/mobs-entities.md` | 怪物系统总备忘、受击反馈、被动动物/末影人、阶段 7 建模、阶段 8 朝向贴图 | 怪物/生物/AI/建模、实体物理 |
| `docs/agent-notes/rendering-lighting.md` | 光照视觉增强（反射/云影/泛光/体积光）、阶段 9 材质重绘、Idea-3B-② 网格 Worker、B28 方块材质（定向面/多面纠偏/状态家族）、B29 方块图标等轴三面（BlockIcon 统一入口） | 渲染、光照视觉、材质、后处理、网格构建、方块贴图、UI 图标链 |
| `docs/agent-notes/multiplayer.md` | 阶段 5 插值/鉴权、阶段 6 手持物/掉落物/观战、阶段 10 3D 手持/快捷栏/归属锁/多账号、阶段 11 挥动联动/头顶快捷栏/白名单权限/抖动、Idea-3C 玩家档案、Idea-4A 房间开关、B30 轮 5 服务端打磨（落盘节流/回放打包/协议版本/限速扩档/皮肤代理加固/心跳活读/入口防御） | 联机协议、插值、掉落物、管理面板、玩家档案、房间开关、落盘与回放、握手版本 |
| `docs/agent-notes/ui-misc.md` | CubeWorld 改造（改名/全景/粒子/物品重绘/视频设置）、JEI 伴随面板、命令面板、UI 子系统、Idea-3A 音频底座、B29 更名 Tiderift 落地 + 创造栏技术性方块过滤、B30 轮 6 光标层归一（CursorOverlay）与世界输入门控、B30 轮 8 步 8 鼠标交互域迁出（InteractionController + 点击消费协议） | 菜单/视频设置、粒子、UI 界面、作弊面板、音频、更名引用面、创造物品栏、鼠标交互域（点击消费协议） |
| `docs/agent-notes/journal.md` | B34 A 四界游记（探索揭图/遗迹发现/碑文回看/个人与房间共享标记） | 改动 Journal/JournalScreen/N 键、共享标记协议、房间账本或 `roomSnapshot` 时 |
| `docs/agent-notes/waymarks.md` | B34 B 旧航路修复（三阶段航标修复/航标芯方块/下一座航路导航/房间权威进度） | 改动 Waymarks/WaymarkScreen、航标协议、`StructureManager.waymarkTowerAt`/`nextTowerFrom` 或修复流程时 |
| `docs/agent-notes/races.md` | B34 C 御风竞速与自建赛道（标桩赛道定义/顺序检查点判定/个人与房间最佳/取消规则/房间账本） | 改动 RaceTracks/RaceRun/RaceScreen/RaceHud、`race_*` 协议、赛道账本、`PauseMenu`/`DeathScreen` 的取消收口时 |
| `docs/agent-notes/blueprints.md` | B35 E 建筑蓝图与材料清单（描述式模型/RLE 规范形式/只读已加载区块的捕获/预览资源释放/材料统计口径/`blueprint_*` 房间账本与限速） | 改动 Blueprints/GhostPreview/BlueprintScreen、`blueprint_*` 协议、蓝图快照或材料统计时 |

历史高危 bug 快查（细节见对应主题文件）：`EntityPhysics.moveAxis` z 轴碰撞回退曾误用 `bx` 致实体瞬移（回退坐标必须取当前轴 `bc`，勿回退）；`Mob` 攻击分流用 `target.isMob` 鸭子标记而非 instanceof（HMR 双模块实例下 instanceof 失效）；`NetworkManager` 重连必须 `JOIN_ROOM { room: this.room }`（空 payload 会静默掉进 default 房，两端数据对不上）。
