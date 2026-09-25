# Agent 备忘 · UI 与综合

> 本文件内容为 AGENTS.md 批次备忘**原文搬移（未改写）**，用于控制 AGENTS.md 体积（会话注入预算 65536 字节，超限会被静默截断）。
> 导航见 AGENTS.md「批次备忘索引」；新批次备忘按主题追加到对应小节，并同步更新 AGENTS.md 索引表。

### CubeWorld 改造批次备忘（防回退）—— 改名/全景/粒子/物品重绘/视频设置

- **仓库已改名 CubeWorld**（原 Web-MC），GitHub 仓库与本地 remote 均为新地址；**localStorage 存档前缀 `project-mc-save-` 特意不改**（改名会孤立所有浏览器现有存档）。物理目录 `project-mc/` 保留（会话工作目录依赖）。
- **渲染器包装类陷阱（曾致主菜单白屏）**：`game.renderer` 是 `Renderer` **包装类**，其 `render()` **无参**、固定渲染游戏 scene/camera——子系统想自己画别的场景（如 Panorama）必须取底层 `game.renderer.renderer`（THREE.WebGLRenderer），把 `(scene, camera)` 传给包装类会被静默忽略（不报错、帧帧渲染空游戏场景 → 白屏）。PanoramaBake 与 Panorama 两处均已按此写法，新渲染入口勿持包装类调 render。菜单期 `Game.loop` 因 `running=false` 自停，画布仅由 Panorama `_tick` 驱动，无双渲染打架。
- **主菜单全景背景（预烘焙播放器）**：`src/render/Panorama.js` 播放 `res/panorama/{px,nx,py,ny,pz,nz}.jpg`（512² 六面 90°，~280KB）——BoxGeometry(BackSide) 内壁天空盒自转 + 动态云层（`makeCloudTexture` 从 Sky.js 导出，纹理 offset 漂移）。**勿回退实时渲染小世界**：构建等待 2-4s、机位难控、无头验证困难。水平面贴图需 flipH（repeat.x=-1）校正盒内镜像，py/ny 旋转 180°。烘焙工具 `src/render/PanoramaBake.js`（URL `?bake-panorama=1` 触发，main.js 分支）——复用同款 vantage 评估（雪原占比/近景平整度），产出 `window.bakedFaces` 手动落盘 res/panorama/；换机位重烘即可。天空盒 BoxGeometry 面序 [+x,-x,+y,-y,+z,-z]。菜单期不再驱动体素光 uniform（无 chunk mesh）。激活期画布 CSS `blur(4px)+brightness(0.9)`，游戏期必须清除。
- **粒子系统**：`src/render/ParticleSystem.js`（THREE.Points + 顶点色 + 对象池 1600 swap-with-last）。两个实例：`game.particles`（方块碎屑 size 0.12，生成时从图集 canvas 采样贴图像素色并按体素光衰减）/ `game.fireParticles`（火焰烟 size 0.09，自发光不衰减）。**新建型子系统**：`start()` 创建、`_disposeWorld()` dispose。爆炸碎屑经 `redstone.onBlockDestroyed` / `mobManager.onBlockDestroyed` 回调（Game.start 注入，回调内必须判空 `this.particles`）。熔岩点燃：`_updateWaterState` 判脚/眼在熔岩 → `player.onFire=3`（入水即灭），`_updateFireEffects` 每秒 1 血（低频伤害不走红屏）+ 火焰粒子 + `hud.setOnFire` 火屏滤镜。
- **视频设置**：`src/core/Settings.js`（localStorage key `cubeworld-settings`，全局不按存档）+ `src/ui/VideoSettings.js`（**app 级单例**，PauseMenu 与 MenuScreen 共用）。渲染距离改的是 `game.settings.renderDistance`（旧 RENDER_DISTANCE 常量已删）；平滑光照开关写 `ChunkMesh.js` 导出的 `RenderQuality`，**切换后必须 `world.markAllDirty()`**；MenuScreen 的入口按钮用**事件委托挂构造期**（render() 重建 innerHTML 后仍有效，勿改回 per-render 绑定）。VideoSettings 的 ESC 用 document capture 拦截（stopPropagation），防止同一次按键穿透到暂停菜单切换。
- **物品重绘**：`ItemDefs.js` 用 `art()` 助手（g.s/g.r/g.d/g.h 对角柄/g.spi 撒点）+ `P` 调色板（[亮,基,暗] 三色纪律）；**撒点必须用确定性 `rng(seed)`**，勿回退 Math.random（破坏确定性生成约定）。注册名与 def 字段（stack/food/tool/tier/durability/damage）是存档/合成兼容面，**不得改动**。
- **Hud 准星**：构造期默认 display:none（原 updateVisibility('creative') 初始化会让准星在主菜单可见）；进游戏后 update()/updateVisibility() 按模式接管。
- **无头截图伪影**：本环境 agent-browser screenshot 对持续渲染的 WebGL 画布可能在数秒后冻结在旧帧（合成器表面不更新），**验证全景/粒子等画面以 `gl.readPixels` 帧缓冲导出为准**（eval 内 render→readPixels→小画布→toDataURL），DOM 截图不受影响。

### JEI 伴随面板批次备忘（防回退）—— 容器界面内嵌配方查询（原独立浮层已改版）

- **RecipeViewer 是"伴随面板"非独立浮层**：`updateFrame()` 每帧（Game.update 内）同步 `containerVisible`（inventory/chest/furnace/trade 四 screen 任一 visible）；`visible = containerVisible && userEnabled`（J 键偏好，localStorage `cubeworld-jei-panel-enabled`）。**不再接管 controls / 不进 ESC、handleMouseInput、pauseOnUnlock guard 登记**（随容器界面显隐，容器界面自身已处理指针与按键）——勿回退为给 Game 四处 guard 加 recipeViewer。
- **新增容器类 UI 必须把它的 visible 加进 `RecipeViewer.updateFrame` 的 containerVisible 检测**，否则面板不跟随新界面显隐。
- **J 键双语义**：容器界面打开时 `togglePanel()`；无容器界面时打开背包（面板随之自动出现）。R/U 作用目标优先级：面板内 `_hoverName` > `game._uiHoverName()`（容器内悬浮）> `current`（弹窗当前物品），全在 `_actionTarget()` 一处；showFor/showUsages 内 `_ensureShown()`——面板被 J 关闭时主动查询配方会重新启用面板。
- **布局**：右缘竖条（搜索 + 左收藏夹列 + 右全物品网格，fixed right:6px，z-index 35）；配方详情弹窗在竖条左侧（`popEl`，right:214px），显示条件 `current && _shown`，✕ 关闭；点物品/配方材料格继续导航，右键=用途，A 收藏（localStorage `cubeworld-jei-favorites` 全局持久）。
- **冒烟注意**：eval 内 show/toggle 后面板 DOM 状态下一帧才被 updateFrame 刷新，同步断言会假阴性——sleep ≥0.3s 再断言；物品名在 `title` 属性不在 innerText。
- **布局已二次重构（围绕物品栏，勿回退为右缘竖条）**：三块常驻 fixed 面板按**当前容器 panel 的 getBoundingClientRect 动态定位**——收藏夹（加宽 1-3 列 40px 格）贴 panel 左侧、全物品列表（加宽 3-9 列 40px 格，顶部搜索框）贴 panel 右侧、配方弹窗（z-index 36）居中覆盖 panel 之上；`_layout()` 在 updateFrame 内每帧 dirty-check（rect+视口+弹窗开关为 key，无变化不写 style 防 reflow），列数按 panel 两侧剩余空间自适应。`_visiblePanel()` 与 containerVisible 检测同源——**新增容器 UI 两处都要加**。弹窗显隐在 renderRecipe 内、定位在 _layout（key 含 popOn，弹窗开关会触发重排）。

### 命令面板（作弊系统）

- 仅 `game.cheatsEnabled === true` 的存档允许按 C 打开命令面板；该标志在存档创建时由菜单"启用命令"复选框一次性确定（与原版 Minecraft 创建世界时定"允许作弊"一致），存的存档载入后自动恢复。
- `src/ui/CommandPanel.js`：构造 `(game)`，挂 panel DOM 到 body。四大功能：① `_teleport()` 通过 `game.player.position.set(x,y,z)` + `velocity.set(0,0,0)` 实现；② 切换模式按钮直接调 `game.player.setMode(name)`；③ `_spawnMob(typeName)` 用 `new Mob(typeName, world)` + 把 `position` 设到玩家前方 3 格（按 `player.yaw` 计算 fx/fz）+ 地面高度 + 调 `mobManager.spawnMob(mob)`，类型限于 zombie/skeleton/creeper/spider；④ `_setTime(t)` 直接写 `game.sky.time = clamp(t,0,1)`，配合 4 个预设按钮（日出 0.25 / 正午 0.50 / 日落 0.75 / 半夜 0.00）和数字输入框 + "设为"按钮。`timeInput` step=0.05、min/max 0~1；`curTimeLabel` 显示当前值与中文时段（半夜/黎明前/日出/上午/正午/下午/日落/黄昏/入夜）。`show()` 时同步 `timeInput.value = sky.time.toFixed(2)` 并调用 `_refreshTimeLabel()`。
- `show()`/`hide()` 与其他 UI 一致：联动 `game.controls.enabled`、`exitPointerLock`、`game.paused=true/false`（与 PauseMenu/DeathScreen 同款设暂停）。`toggle()` 自管。
- `Game.setupKeyBindings()` 处理 C 键时三重门：`!this.cheatsEnabled` / `!this.running` / `deathScreen.visible` 任何一个为真不响应；ESC 优先关闭 commandPanel（point-lock unlock 路径里 `_setupPauseOnUnlock` 也加了 `commandPanel.visible` 防护，避免面板打开瞬间触发暂停菜单）。
- `CommandPanel` 是新建型 UI 子系统（每次 `start()` 重建，`_disposeWorld()` 末尾 `el.remove()`），与 InventoryScreen/PauseMenu/DeathScreen 同组。

### UI 子系统

- `Hotbar`：`flashName()` 在切换快捷栏槽位时显示物品名气泡 2 秒；数字键 / 滚轮切换处需主动调用。
- `Hud`：血量/饥饿行 `bottom:86px`，经验条 `bottom:72px`，都贴在快捷栏上方，改动二者距离时务必同步避免遮挡快捷栏。
- `InfoBar`：游戏内左上角 4+1 行 —— 坐标 / 生物群系 / 时间 / **准星目标**（`targetLine`）/ **网络 RTT**（联机时显示「网络: Xms」，`rttLine`）。`update(player, generator, sky, crosshairInfo, rttMs = null)` 第 4 个参数是 `{type:'block'|'mob', displayName, name}` 或 null，第 5 个参数为联机平滑 RTT（毫秒，null=单机隐藏该行）。`crosshairInfo` 由 `Game.updateRaycast()` 每帧算好并存到 `this.crosshairInfo`：方块 hit + mob hit 取较近者。Mob 命中靠 `MobManager.findMobByRay(origin, dir, maxDist)`（不伤害的纯查询版，球体射线检测半径 = `mob.height/2`，与 `attackMob` 同口径）。ator.getBiome()` 更新。
- `InventoryScreen`：每个 slot 通过 `_bindHover()` 挂载 mouseenter/mouseleave 悬浮 tooltip（显示 `displayName`）。`returnCursorItem()` / `hide()` 必须同时隐藏 tooltip。
- **创造栏去重陷阱**：`renderCreative()` 用 `[...BlockRegistry.all(), ...ItemRegistry.all()]` 合并展示列表。部分方块名在两边都注册——`lever` / `stone_button` 既在 `BlockDefs.js` 作方块又在 `ItemDefs.js` 作物品注册——不去重会出现两个相同物品槽。修复：方块优先，同名物品在合并时跳过。新加"既是方块也是物品"的项目时务必检查是否双注册。
- `PauseMenu` / `DeathScreen`：禁用 `controls.enabled` + `exitPointerLock`，hide 时恢复。`PauseMenu` 不要再自带 ESC 监听器（会与 Game 的 ESC 切换同一事件内既打开又关闭）。`Game._setupPauseOnUnlock()` 监听 `pointerlockchange` 在指针锁意外丢失时自动弹暂停菜单。

### Idea-3A 音频底座批次备忘（防回退）

- **`src/audio/AudioEngine.js` 模块级单例 `audio`**：WebAudio 程序化合成（零资产，延续 SVG 纹理思路），总线 sfx/music → master（音量+静音统一控制）。**所有发声入口 `if (!this.ctx) return` 静默早退**——headless/未解锁环境零副作用。
- **自动播放策略**：AudioContext 必须首次真实用户手势后创建——`main.js` 调 `audio.installUnlock()` 在 document capture 挂 pointerdown/keydown，`unlock()` 幂等（无 ctx 则建 + suspended 则 resume）。eval 里 `document.body.click()` 这类**合成事件不解锁**，必须 agent-browser 真实 `click`。
- **设置面**：`Settings.js` 新增 `sound: true` / `volume: 60`（clamp 0-100），`applySettings` 实时套 `audio.setEnabled/setVolume`；VideoSettings 面板加「音量」(步进 10 循环)、「音效」两行。**unlock 前改设置也不丢**——volume/enabled 记在实例字段，`_buildGraph()` 时回放。
- **材质分路**：`blockCategory(def)` 按名称启发式把方块归 9 类（stone/wood/gravel/grass/glass/metal/cloth/snow/liquid），`CATEGORY_PARAMS` 定滤波器/时长/增益，未命中回退 stone。新方块若音色怪，先查是否被启发式误分类。
- **接线锚点（全在 Game.js）**：挖掘命中音挂 **0.25s 挖掘碎粒定时器**（`_miningPuffTimer`，天然限频勿另加节流）；创造/生存破坏、放置、`player.onHurt`（与 flashDamage 同源）、食用（`player.eat` 成功分支）、`_releaseBow`、箭命中（`_updateArrows`，远端视觉箭也响）。
- **验证口径**：headless 听不到声，断言走引擎内部——eval 动态 `import('/src/audio/AudioEngine.js')`（与 Game.js 同模块实例，`window.__ae` 缓存）→ 包一层 `_noise/_tone` 计数 → 直调 7 个事件方法断言调用数/滤波频率；真实路径抽 3 条（创造挖掘/放置/生存长按）用同一计数探针验证。**headless 帧极慢**，生存长按 0.6s 可能攒不满 0.25s 碎粒节拍——延长按住时间再断言。

### Idea-3A-② 怪物音/脚步/BGM 批次备忘（防回退）

- **怪物语音**：`AudioEngine` 内 `VOICE_PRESETS` 按typeName 预设合成参数（tones+noise，音量克制 0.05~0.16），`_mobVoice(typeName, dist, mode)` mode=idle/hurt/death 决定音高（×1.35/×0.75）时长增益倍率；距离衰减 `att = 1 - dist/28`，>28 格全静音。**全局限频 `_gate('voice', 0.3)` 只门 idle**——受击/死亡是反馈音必须即时。新怪类型若不匹配预设回退 VOICE_DEFAULT；新增怪时在 VOICE_PRESETS 补一行。
- **钩子位置**：环境叫声在 `Mob.update` 顶部（dragon/shulker 早退分支**之前**，`_voiceTimer` 4-12s 随机）；受击/死亡在 `MobManager.attackMob`（扣血处判 dead）与 `applyRemoteMobAttack`（远端同步伤害也响）两处；距离用 `MobManager._playerPos`（update(dt,player,sky) 开头存）。**怪 vs 怪（mobAttackMob 链）不播受击音**——避免混战噪音，防回退勿加。
- **脚步/落地**：`Game._updateFootsteps(dt)` 在 Game.update 末段调用——**距离驱动步频**（累计水平位移 ≥2.1m，涉水 1.6m 播 splash），`_blockUnderFoot()` 贴脚格→脚下 0.45m 兜底（流体不算材质）；落地 = 上一帧 `_prevFallSpeed > 8` 且本帧 onGround 且不在水中。跨帧状态 `_wasOnGround/_prevFallSpeed/_stepDist` 是 Game 共享型字段，构造函数无需重置（数值型零值无害）。
- **环境音/BGM**：`audio.tickAmbient(dt, daylight)` 每帧由 Game.update 驱动——**计划式调度**（风声 swell 9-23s 随机 + BGM 和弦垫 4.6s 节拍 C-G-Am-F 低音区），无常驻节点，**暂停时 update 停止调用即自然静默**；全部走 music 分轨。`audio.resetAmbient()` 必须在 `Game.start` 调（sky.time 重置旁）——新存档继承上一局调度相位会显得"闹鬼"。
- **music 设置**：Settings `music: true` → `applySettings` 调 `audio.setMusicEnabled`（music 分轨 gain 0/0.5），VideoSettings 面板第三行「音乐」。
- **⚠️ eval 探针的 Vite HMR 实例分裂陷阱（重要）**：页面开着时编辑过某模块后，Vite 会给 importer 的 import 规格永久加 `?t=<时间戳>`（dev server 生命周期内不消失）——**动态 `import('/src/xxx.js')` 裸 URL 会拿到与页面不同的模块实例**，探针量的是假实例（单例字段如 `_unlockWired`/patch 计数全对不上）。正确姿势：先 `fetch('/src/main.js')` 提取页面实际 import 的 URL（含 ?t=）再 import 同一 URL。生产 build 无此问题（单 bundle）。

### Idea-3B-0/B-① 地形 Worker 化批次备忘（防回退）

- **B-0 探针结论（2026-09-12 通过）**：地形模块图（noise/biomes/terrain/Chunk/structures/catalog + BlockDefs）纯计算零 DOM，Worker 可直接运行。三区块字节级一致（确定性生成跨线程成立）、Transferable 回传正常、build 产出独立 worker chunk（`TerrainWorker-*.js`）。headless 软渲染 worker 反而慢（12.1ms vs 8.3ms/块）——收益是主线程解堵不是裸生成速度，真机帧时间才作数。
- **⚠️ 最高危坑：worker 图必须补 `import '../blocks/BlockDefs.js'`（副作用注册）**。方块 id 注册在 BlockDefs 模块顶层执行，主线程由 Game.js 导入完成；worker 图缺它 → BlockRegistry 空 → getByName 全 undefined → 生成**全空气**（表面 ok:true 不报错，只表现为 17500/65536 字节差异、非零块数 0）。BlockDefs 顶层只做 SVG 字符串生成，DOM 全在函数体内，worker 安全。
- **架构（B-①）**：`TerrainWorker.js`（每 seed+规模缓存生成器 LRU≤4，`chunk.blocks.buffer` Transferable）+ `TerrainWorkerClient`（请求队列 RR 分发 2 worker，`broken` 标志熔断）。**World.ensureChunk 保持同步**（setBlock 等大量调用方依赖）；新增 `requestChunk(cx,cz)`：已有/在途返回 true，不可用返回 false，调用方 `if (!requestChunk()) ensureChunk()` 回退。`_finalizeChunk(c)` = applyModifications → initChunkLight → 作物扫描公共收尾，**顺序勿变**（LightEngine 邻居导入语义耦合）；worker 回执在 `chunks.set` 后 finalize，与同步路径逐语句一致。回执落地时同步路径已建 → 丢弃；`.catch` 置 `broken=true` 熔断回退。
- **门控与生命周期**：仅主世界注入（dimension==='overworld'，nether/end/aether 生成器类不同）；注入点在 `Game.start` 的 `new World` 后（换维/联机重启全走 start，天然覆盖）；`_disposeWorld` 首行 `terrainWorker.dispose()` terminate（新建型资源，跨存档必须销毁）。
- **验证锚点**：瞬移远端 → `world.chunks.size==169` 且 patch 实例 `generator.generateChunk` 计数 **syncGens==0**（全 worker）；`terrainWorker.broken=true` 后再瞬移 → syncGens 增 169（回退接管）；worker 生成块 `hasLight==true`；returnToMenu 后 worker terminate。headless 无 Worker 环境自动走同步路径（构造失败 onerror→broken）。

### Build 5 本地化（i18n）批次备忘（防回退）

- **核心约定：t() 以简体中文原文为键**（`t('单人游戏')`）——zh-CN 零字典直接返回原文，`zh-TW`/`en` 查包缺项回落原文。**勿改成英文 key 体系**（等于重写全部接线）；新加界面文本时 zh-TW/en 两包要同步补键（grep 原文即可找全）。
- **模块**：`src/i18n/index.js`（`t` / `initLocale`（启动静默）/ `setLocale`（用户切换+通知）/ `onLocaleChange` / `LOCALES` / `localeLabel`）+ `locales/zh-TW.js`、`locales/en.js`；**语言选择持久化在 Settings.language**（loadSettings 白名单清洗，非法值回落 zh-CN），`main.js` 最先 `initLocale(loadSettings().language)` 并替换 index.html 静态"世界生成中..."。
- **名称三语走 `src/i18n/names.js`**（`NAME_I18N[注册名] = [简,繁,en]`，覆盖 BlockCN+ItemCN+内联 displayName+MobTypes ≈ 226 条）+ `src/i18n/name.js` 的 `tName(name, fallback)`（简体 idx=0 直接返回 fallback=注册侧中文，繁/英查表缺项回落）。**注册侧（BlockCN/ItemCN/MobTypes.displayName）保持简体不动**——数据层中文，出口处翻译。
- **显示名统一出口 `src/ui/itemName.js` 的 `getDisplayName(name)`**：原 Hotbar/InventoryScreen/ChestScreen/FurnaceScreen/TradeScreen/RecipeViewer 六份本地副本已删除改共享 import——**勿再新建本地副本**（会绕过翻译）。怪物名出口：`tName(mob.type.name, mob.type.displayName)`（BossBar/CommandPanel/crosshair 三处）。
- **语言切换入口**：VideoSettings「音频与操作」组「语言」行（循环三语，`setLocale` + `_apply` 即存）。**常驻 UI 刷新靠 `onLocaleChange`**：MenuScreen（render 当前页）/ PauseMenu / DeathScreen（`_applyLang()` + dispose 解绑）；容器类界面打开时才渲染天然自愈。新加常驻 UI（构造时写死文本）必须注册 onLocaleChange。
- **陷阱 1（t 变量名遮蔽）**：Game.js 准星分支与 CommandPanel._refreshTimeLabel 有局部变量 `t`——后者已改名 `timeVal`，前者块内只用 `tName`；新代码在含局部 `t` 的作用域内需要翻译函数时用 `tName` 或重命名局部变量。
- **陷阱 2（_mkBtn 约定）**：PauseMenu/DeathScreen/CommandPanel 的 `_mkBtn(label)` 约定 label 传**简体中文原文**、内部统一 `t(label)`——调用点不要再包一层 t（双重翻译目前无害但语义错）。
- **服务器侧文本不翻译**（踢出原因/房间开关提示等随协议下发）——客户端 `chatBox.add` 里对 `fromId===0` 服务器系统回复原样显示；本批只本地化客户端自身文案（Game.js ~25 条系统提示已 t() 化）。
- **存档时间本地化**：MenuScreen 槽位 `toLocaleString(getLocale())`（原硬编码 'zh-CN'）。
- **验证锚点**：视频设置切 English → 主菜单/HUD/暂停/信标界面全英文；`localStorage['cubeworld-settings'].language` 持久化；刷新后仍英文；方块名（快捷栏气泡/准星）三语切换。

### Build 6 扩语批次备忘（防回退）

- **七语言**：zh-CN（键）/ zh-TW / en / fr / de / ja / ko——`LOCALES`（VideoSettings 语言行循环顺序）与 `PACKS` 在 `i18n/index.js`；名称字典 `names.js` **七列数组** `[简,繁,En,Fr,De,Ja,Ko]`，`name.js` 的 `LANG_IDX` 按语言 id 映射下标——**新增语言三处同步**：index.js（LOCALES+PACKS）、name.js（LANG_IDX）、names.js（扩列）+ 新 locales 文件；Settings.language 白名单走 `LOCALES.some` 自动放行，无需改。
- **多语言包生成口径**：以 en.js 键集为基准逐键翻译（键一字不改、值按 MC 对应官方语言 fr_fr/de_de/ja_jp/ko_kr 术语），完成后程序化校验三件事——键集 missing/extra 双向为零、占位符 `{n}…` 多重集一致、`node --check`。自创词全书统一（Nether/l'End/Aether、wisp=Aspiritelle/Irrlicht/ウィスプ/위스프 等）。
- **⚠️ eval 探针验 i18n 的实例分裂扩展**：页面模块链被 HMR 编辑过（如 Game.js）后，裸 `import('/src/i18n/index.js')` 是新实例——对它 setLocale 后再用页面实例的 tName 读会得到**切换前的语言值**（假象）。验语言切换走 UI 真实路径（语言行点击 + 断言主菜单按钮文本），不要裸 import 探针。
- **Esc 关闭物品栏（Build 6 修复）**：Game.js ESC 分支原对 `inventoryScreen.visible` 裸 `return`（什么都不做，与其他容器 hide 不一致）——改为 `inventoryScreen.hide()` 后 return；`_setupPauseOnUnlock` 已排除全部界面，Esc 关背包不会误弹暂停。

### Build 7 批次备忘（防回退）—— 语言界面独立 + 阿语 + 手持物像素挤出

- **LanguageScreen.js（语言切换独立界面）**：主界面与暂停菜单的地球小按钮（`globeIconDataUri()` 像素风 SVG data-URI，无文本）进入；单例挂 `game.languageScreen`（main.js 创建），列出 `LOCALES` 全部语言（各语言自称，label 不走 t()），当前语言 `.selected`；点击 = settings.language + saveSettings + setLocale（onLocaleChange 通知各常驻 UI）；ESC/遮罩/返回键关闭；onHide 机制与 VideoSettings 同款（暂停菜单保持暂停态交还）。**主界面按钮挂 MenuScreen 主页 row（`language-btn`，事件委托构造期分支）；暂停菜单按钮 `pauseMenu.langBtn`（videoBtn 同模式：mainView 隐藏 + title 改 + onHide 恢复）**。
- **八语言**：+ar（العربية）——LOCALES/PACKS/LANG_IDX（'ar': 7）/names.js 第八列四处同步。**阿语仅翻译不做 RTL 布局镜像**（ar.js 头注释已声明，MC ar_sa 官方是镜像的，属已知限制）；术语全书统一（النيثر/النهاية/الأثير/المنارة/بوابة العبور 与 بوابة النهاية 有意区分）。
- **手持物像素挤出（Build 7，HeldItemMesh.js）**：物品与 cross 方块从双面薄片改为 **MC 风格像素挤出**——`extrudeSpriteGeometry(data, w, h, depth=0.125)`：32×32 贴图 alpha≥128 的像素各生成一个带厚度小立方，**只输出暴露面**（前后总暴露，±x/±y 相邻透明才生成），front/back 用像素 UV、侧面窄条 UV；尺寸归一 [-0.5,0.5]²、Y 轴翻转（canvas 行号→世界坐标 `Y=(y)=>0.5-y/h`）。普通方块仍是 BoxGeometry 六面、portal 保持薄片。材质沿用 heldMaterial（Lambert+DoubleSide 兜底绕向+alphaTest+低强度自发光）。构建一次进进程缓存（cache Map），clone 零拷贝。**勿改回 PlaneGeometry 薄片**。

### Build 9 批次备忘（防回退）—— 俄/西/葡三语（11 语言）

- **十一语言**：+ru（Русский）/ es（Español）/ pt（Português，pt-BR 口径）——四处同步同 Build 6/7：index.js（imports+LOCALES+PACKS，追加在 ar 之后）、name.js LANG_IDX（'ru':8 / 'es':9 / 'pt':10）、names.js 272 行 ×11 列、新 locales 文件。**names.js 扩列用逐行变换脚本**（regex `^(\s+)(\w+): \[(.*)\],$` 行尾追加 3 个 JSON.stringify 值），既有 8 列字节零改动 + 变换前后前 8 列深度比对断言——勿手抄 272 行（必错）；脚本断言映射键集与 NAME_I18N 双向相等、每条恰 3 列。
- **翻译口径**：en.js 键集基准逐键译（Build 9 起 223 键=222+新增'语言'），程序化校验三件套照旧（键集双向零差 + 占位符多重集 + node --check）。ru 术语 ru_ru 现代口径：Незер/Энд/Эфир、Редстоун 系、Бедрок、Визер/Визер-скелет、Маяк、Эндермен；es：Nether/End/Éter、Wither、Faro、Roca(圆石)；pt-BR：Nether/End/Éter、Wither、Farol、Pedregulho、Rocha matriz。自创词全书统一：wisp=Висп/Fuego fatuo/Fogo-fátuo，aether_guard=Страж Эфира/Guardián del Éter/Guardião do Éter。
- **'语言' 漏接补修（Build 7 遗留，随 Build 9 顺带）**：LanguageScreen 标题与 MenuScreen 地球按钮 `t('语言')` 无此键——全部 10 包回填（zh-CN 走键本身零成本）。**全量审计法**：正则扫 src 内 `t('…')`/`t("…")` 字面量第一参（跳过注释行），与 en.js 键集比对——动态查表键（模式名/效果名等经变量传入）会被列为"未调用"，属正常勿误删。
- **实测陷阱复刻**：裸 import 探针在 agent-browser eval 里再次出现实例分裂（`import('/src/i18n/index.js').getLocale()` 返回切换前值，而同 eval 里 name.js 的 tName 却返回新语言）——**UI 真实路径仍是唯一权威**（主菜单/暂停菜单语言按钮点击 + InfoBar 断言）；agent-browser 点击槽位卡片可能被内层 `.cw-stone-btn` 遮挡报 covered，改 eval 派发 `new MouseEvent('click', {bubbles:true})`。

### Build 10 批次备忘（防回退）—— 掉落物原版化 + 物品栏页签

- **掉落物渲染（DropMesh.js）**：复用 HeldItemMesh 模板（方块=六面贴图小立方 / 物品与 cross=像素挤出 / portal=薄片），掉落组 = 模型（缩放 0.25，自旋+触地正弦浮动）+ 阴影贴片 + 数量角标精灵（count≥2 显示，剩 1 自动隐藏）；模板异步就绪，resolve 时**必须自检 drop 仍存活**（拾取/焚毁可能早于模板完成）；模板进程级缓存共享 clone，drop 移除仅 scene.remove 不 dispose。getDropColor 色块方案已删，勿回退。
- **掉落物物理**：逐轴点级碰撞（半径=模型半边 0.125，高速细分步 ≤4 防穿薄地板）、落地高速轻微弹跳（vy<-8 时 *-0.18）+ 落地摩擦、水中强阻尼浮力（耦合 10/s + 终端沉降 -2.5，入水快速减速漂浮——耦合 3/s 会**穿透单格水**沉底）、岩浆即焚、磁吸拾取（1.6 格吸附飞向玩家 / 0.9 格入包）、拾取延迟分级（方块 0.5s / 怪物 1.0s / Q 丢弃 2.0s）。
- **物品栏页签（InventoryScreen）**：`activeTab` 生存 inv|recipes、创造 = 分类 id（ItemCategories.js 集中映射 253 物品，未登记落 misc）；创造页 = 分类页签 + 搜索框（input 事件**只重绘网格保焦点**，勿整面板重渲染）+ 摧毁槽（✗，mousedown 销毁光标物品）；配方页签宿主 `inventoryScreen.recipeHost`。
- **JEI 内嵌模式（RecipeViewer）**：`_ensureEmbedded(invOpen)` 每帧幂等切换——**按 favEl.parentElement === host 判定**（页签宿主每次 render 重建，按 flag 判会漏重挂）；内嵌=static 定位固定尺寸（3 列收藏 + 8 列列表），伴随=fixed 由 _layout 动态定位；弹窗 popEl 恒驻 body（两种模式都覆盖物品栏居中，定位提取 `_layoutPopup`）；`_syncDisplay` 内嵌分支以 `_tabShown` 驱动 `visible/_shown`（R/U/A 弹窗依赖 visible）；J 键 = 开背包直落配方页签 show(2,'recipes')。**实测陷阱**：测试断言里 `div.textContent === '✗'` 会同时命中摧毁槽与其外层容器（input 无 textContent），要按 `title` 过滤；创造网格 slot 无 data-slot 属性，选择器用 children。
- **i18n（Build 10）**：新增 10 键（8 分类 + 配方 + 摧毁物品）×10 包，键集 223→233；'背包' 复用既有键。
- **环境坑**：`./start.sh stop` 会把 **Vite 与 LAN 服务器一起停**（本次实测踩到）——只想停服务器时用 `start.sh stop` 后记得重启 Vite，或直接 kill 3001 进程。

### Build 11 批次备忘（防回退）—— JEI 内嵌回退 + 创造「生存物品栏」页签

- **⚠️ JEI 内嵌已回退（Build 11，用户实测效果不佳）**：RecipeViewer.js 已整体还原到 Build 9 版本（`git show 8da99ba:src/ui/RecipeViewer.js`）——伴随模式（fixed 贴容器两侧）、J 键语义（无容器时开背包 show(2)）、_layout 内联弹窗定位全部复原。**勿再尝试把 JEI reparent 进页签**：双模式切换的状态面（样式内联覆盖 × 显隐语义 × 弹窗定位 × 宿主重建重挂）远超收益，回退干净 = 整文件还原而非选择性摘除。
- **创造「生存物品栏」页签（Build 11 保留项）**：创造页签行 = 8 分类 + `['survival', t('生存物品栏')]`（末位，原版式）；选中时 `craftSize=2` + `_renderSurvivalContent(false)` 渲染与生存背包同布局（盔甲穿戴/合成/背包/快捷栏全功能）。生存内容抽成 `_renderSurvivalContent(withTitle)` 供生存单页与创造页签共用。
- **回退残留检查法**：改回去的功能要 grep 全部符号（本次 `_syncRecipeTab` 在 show() 残留一处调用 → 运行时 TypeError，node --check 查不出——**方法删除后必须 grep 方法名全仓**）。
- **eval 测试语言坑**：上一轮测试把 settings.language 存成了 en，中文标签选择器会全部落空（本次 '创造模式'/'生存模式' 找不到）——测试前先确认 UI 语言或用语言无关选择器（id/class）；裸 import setLocale 改语言**不会重绘菜单**（实例分裂，监听器在页面实例上），改持久化语言后必须 reload 页面。

### Build 12 批次备忘（防回退）—— 文本输入焦点与游戏快捷键隔离

- **全局 keydown 三层守卫（输入法安全）**：① Game.setupKeyBindings 顶部——`editable`(INPUT/TEXTAREA/isContentEditable) 或 `e.isComposing || e.keyCode === 229` 直接 return（不触发快捷键、不 preventDefault 防打断合成）；放行集 = 非聊天态 ESC（关界面）+ F5（走手动保存防浏览器刷新），聊天输入的 ESC/Enter 由 ChatBox 自理不放行；② Controls.onKeyDown——editable/composing **不记录 keys[]**（输入法打断会吞 keyup → 按键卡死"按键失灵"），onKeyUp 永远清位**不得加对称守卫**（否则另一方向卡死）；③ ChatBox._onKey——editable/composing 中 T 不抢开聊天。
- **keyCode 229 = IME 合成 keydown 的特征值**（isComposing 不可靠跨浏览器）；KeyboardEvent 构造器可派发 `{keyCode: 229}` 模拟合成态测试。测试脚本注意：改 settings.language 后裸 import setLocale 不重绘菜单（实例分裂），必须 reload 页面。

### i18n 补漏批次备忘（Build 12 后，未发布）—— JEI 提示 + 维度群系名翻译

- **JEI 面板 5 处漏 t()**：收藏夹空态两串（'对物品按 A 键收藏'/'对物品按 A 键加入收藏夹'）+ '无匹配物品' + '仅显示前 {n} 个，搜索可缩小范围'（400 从模板字面量提为参数）+ 熔炼燃料 tooltip 模板串（改 `t('熔炉 {t}s · 燃料如煤炭（煤可烧 {n} 个）', {t, n})`）。**漏因**：这些行用模板字面量/裸赋值绕过了 t()，正则审计 `t('…')` 扫不出来——审计脚本要同时扫"含 CJK 但未包 t 的赋值行"。
- **维度群系名 14 键 ×10 包（233→252）**：InfoBar 显示路径 `t(generator.biomeNames[biome])` 一直存在，但下界 5/末地 4/天域 5 的名表值从未进语言包（t() 缺项回落中文）。各语言术语对齐既有维度名（ru Незер/Энд/Эфир、ja ネザー/ジ・エンド、zh-TW 地獄/終界+靈魂砂、ar النيثر/النهاية）；原版自带群系按官方译名（Nether Wastes/Soul Sand Valley/End Highlands/Small End Islands 等）。
- **三重校验升级**：除键集双向/占位符/node --check 外，本次跑了"静态 t() 键 + 生物群系名表值 全量 ⊆ en 键集"审计（误报只有注释里的 t('...') 示例）；>400 截断提示实际物品总数 253 < 400，属防御分支。
- **实测口径**：主世界/下界/末地/天域四维 InfoBar 断言（en）+ 游戏内暂停菜单实时切日语断言（翠緑の浮島）+ JEI 收藏空态/无匹配/燃料 tooltip 断言；语言屏重渲染后 refs 全部失效，agent-browser 必须每次重 snapshot 再取 ref。

### Build 13 批次备忘（防回退）—— 创造模式原版化：开局空背包 + 光标取物

- **创造开局不再有预设物品**：Game.start 的 `mode==='creative'` 分支从 `fillCreative(前9个注册物品)` 改为直接清空 `inventory.slots`；`Inventory.fillCreative` 已删（grep 全仓零残留）。生存初始物品分支与 respawn 联机重生物品**原样保留**（respawn 无条件给生存初始物，创造玩家不会死、不构成问题）。
- **创造网格取物 = 容器式光标拿取（同步原版）**：左键点创造物品 → `setCursorItem(name, 64)` 一整组上光标（原版 doClick 语义：空手拿整组/同类 grow 封顶/异类替换——三分支在"上限 64"下同一条语句即可表达）；放置走既有槽位事件（swapCursorWithSlot 左键换/合、rightClickSlot 右键放 1）；右键创造物品=拿 1 个（保留）；✗ 摧毁槽销毁光标物品；关闭物品栏光标物品自动 `inventory.add` 回包（hide 既有逻辑，创造下同样成立）。
- **eval 引用别名读数陷阱**：断言 `cursorItem` 后又对它做变更操作的同一 IIFE 里，先前捕获的是**对象引用**——序列化发生在 return 时，读数是变更后的值（本次右键拿 1 显示 count:0 实为放置后递减）——要快照值就 `[...item]` 浅拷贝或分两次 eval。
- **i18n 补漏批（同车，未随 Build 12 发布）**：JEI 5 处漏 t() + 14 个维度群系名 ×10 包（233→252 键），详见上一节备忘；本批随 Build 13 一并发布。

### Build 20 批次（2026-09-16 交付）—— F5 视角三态 / 中键取物 / 命令面板终局演出全维度

- **F5 视角循环 + F6 保存（⑤）**：`Player.viewMode`（0=第一人称 1=第三人称背后 2=第三人称正面，F5 循环；观战模式 F5 仍为切目标，死亡观战键位不变）。`updateCamera(world)` 重写：第三人称从眼点沿视线 ±4 格退距 + **遮挡裁剪**（`Raycast.cast` 新增返回命中距离 `t`——既有消费方不受影响；命中格前 0.25 拉近防穿墙；存档切换时 `_camRay.world` 必须跟随更新）；正面视角相机 `rotation.y=yaw+PI / x=-pitch` 回望。**准星射线仍从眼睛发射**（原版语义，第三人称射击/挖掘判定不变）。本地玩家模型 `src/entity/LocalPlayerModel.js`（与 RemotePlayer **共用导出的 PARTS 布局常量**，零插值直驱：行走摆臂/挖掘挥臂/头俯仰/右臂挂手持物 buildHeldItemTemplate；颜色=联机 selfId 派生色与远端看到的一致，单机 id=1）；Game.update 中 `thirdPerson` 时隐藏 FirstPersonHand（`viewMode===0` 才显示）并驱动模型；**Player/hand/playerModel 均跨存档共享**——start 复位 viewMode=0 + 隐藏模型，returnToMenu 同步隐藏（防主菜单全景残影）。F6=原 F5 手动保存（editable 输入放行同步改 F6）；F5 分支在 `!running` 时早退**不 preventDefault**——启动失败页保留浏览器刷新语义（原提示"按 F5 刷新"不矛盾化）。MenuScreen 键位提示整句换键（10 语言包同步）。
- **创造中键取物（③）**：Controls.onMouseDown `button===1` → preventDefault（防浏览器自动滚动）→ `onPickBlock` 回调（Game 构造注入）；`Game._pickBlock()`：仅创造响应（生存/旁观早退）、准星 `selectedBlock.id` 经 `BlockRegistry.getNameById`（BlockRegistry 新增 id→name Map 反查导出）取方块名；热栏 0..8 已有该物品（无 data）→ setSelected 选中那格；否则以 1 个替换当前选中格。原版创造 pick-block 同语义。
- **命令面板终局演出全维度（⑥）**：finaleBtn/finaleLabel 从 duskWrap 拆出独立 `finaleWrap`（aetherCard 直属），duskWrap 仍仅天域（复潮控件），`_refreshDimTools` 末尾 `aetherCard.style.display='flex'` 恒显——终局演出（60s 四界分段）本就全维度并行，任意维度可调试预览。`_startFinaleTide` 本身无维度门，纯 UI 解锁。

## Build 23 批次（2026-09-16 交付）—— 皮肤面板输入框加宽 / 鉴权账号收尾 / 主界面 LAN 状态组件

- **皮肤面板用户名输入框自适应加宽**：`_fitNameInput(input)` 用 canvas measureText 实测占位文本宽度（13px "Segoe UI"/"Microsoft YaHei"）+24（padding 20+边框 2+舍入余量），钳位 [160,460]px——各语言文案长度差异大（es 最长 ~360px），固定宽度必截断。**高坑：调用必须在 `style.cssText` 赋值之后**——cssText 整体覆盖 width，赋值前调用被静默冲掉（冒烟抓到）。show() 每次 render()，语言切换后重开即生效。
- **测试后自动清除鉴权账号（Build 23）**：两道防线——① `test-stage11.mjs` 收尾 `POST /api/config {adminAccounts: []}`（API 级：清内存+落盘，恢复默认无鉴权；该套件是跑批中最后一个建号的）；② `run-all-tests.sh` 停服后 `rm -f server/config.json && rm -rf server/world`（文件级兜底，与跑批前清理对称）。背景：面板/多账号套件持久化账号后，遗留鉴权态让后续套件/人工调用 401（Build 22 冒烟实测踩到 /api/logs 401）。
- **主界面右下角 LAN 状态组件（`src/net/lanStatus.js` + MenuScreen）**：IP 输入框 + 在线/离线文本 + SVG 刷新按钮（refreshIconDataUri 本地函数，石质浅描边风格）。**探测必须 `mode:'no-cors'`**——菜单页(5173)与服务器(3001)跨端口，常规 fetch 被 CORS 拦响应抛 TypeError（服务器在线也误判离线，冒烟抓到）；no-cors 不透明响应（浏览器 status=0；node undici 透传真实 status）= 端口有 HTTP 服务应答，对鉴权开/关都成立。任何响应（含 401）算在线，网络错误/超时算离线。IP 持久化 localStorage `project-mc-lan-host`（normalizeLanHost 去 scheme/端口/路径/方括号，非法回退当前值），**LAN 游戏页 #mp-url 以 `lanWsUrl(getLanHost())` 预填**——组件与联机页单一来源不脱节。挂载点：_renderMain 末尾 absolute right:12px bottom:8px（避让左下角版本号），探测回写有元素存在性守卫（切页 render() 重建后自然重探）；IP 输入走 change 事件委托（构造期注册免重绑），刷新按钮走既有 click 委托。probeLanServer 用 fetch+AbortController（node 18+/现代浏览器双环境可测，测试里临时端口起真 http 服务断言在线/离线双态）。

## Build 29 批次（2026-09-25 交付）—— 更名 Tiderift（裂潮）+ 创造栏技术性方块过滤

- **更名落地清单（英文名 Tiderift ↔ 中文名 裂潮，取自世界观「一潮三分」主链——`docs/worldview.md`；版本格式 `Tiderift Beta Build X`，**前缀变动 Build 数不重置**，Release tag 自本批起 `beta-build-<X>`，历史 `alpha-build-1..28` 保留）**：`src/version.js`（BUILD=29 + VERSION_LABEL）/ `index.html`（title + favicon）/ `MenuScreen`（logo 换 `res/logo-tiderift-js-edition.png` + alt）/ `package.json` name / `server/package.json` description / `server/admin.html` 面板标题 / README（logo + 徽章 + 仓库 URL）/ 活文档标题（bug.md、lan-multiplayer-design、worldview、wiki-handover）。**不动**：localStorage 存档前缀 `project-mc-save-` 与 JEI 键 `cubeworld-jei-*`（用户数据兼容面）、本地工作区目录名 `project-mc`、历史 tag；GitHub 仓库经 `gh repo rename` 改名（旧 URL 自动重定向），`src/**` 不允许再出现 "CubeWorld" 字样（build29 ①段全目录扫描断言）。
- **技术性方块过滤 `isTechnicalBlock(def)`（ItemCategories.js 纯函数，与 `isIsoBlock` 同文件）**：三规则——① `def.fluidType`（水/岩浆 + `*_flow_N` 流动等级）；② `def.baseBlock && def.name !== def.baseBlock`（B27 门/床/活板门 + B28 箱/炉/头颅/灯的**全部状态家族变体**，规则化覆盖未来家族，勿逐名维护）；③ `TECHNICAL_NAMES` 显式清单（`piston_head`、`end_portal`/`nether_portal`/`aether_portal`/`end_gateway`、`end_portal_frame_eye`、`wind_current`、`wheat_crop_0..7`）。**过滤点在 `InventoryScreen._renderCreativeGrid` 的 blocks 源头**（搜索与非搜索双路径都生效）；**类JEI（RecipeViewer）明确不过滤**（`_allItems` 原样，防回退绊线 = 该文件不得出现 `isTechnicalBlock`）。`farmland`/红石件/石碑/祭坛保留（原版创造栏同样提供耕地）。
- **验证**：`tests/build29-rename-icons.mjs` 405 断言；实机 agent-browser：创造搜索 water→仅水桶 1 项、piston→2（无活塞头）、oak_door→1、JEI 搜 piston_head/furnace_lit/门变体仍全量在列、菜单与 HUD 版本标签 `Tiderift Beta Build 29`。
