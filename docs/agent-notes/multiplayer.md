# Agent 备忘 · 联机

> 本文件内容为 AGENTS.md 批次备忘**原文搬移（未改写）**，用于控制 AGENTS.md 体积（会话注入预算 65536 字节，超限会被静默截断）。
> 导航见 AGENTS.md「批次备忘索引」；新批次备忘按主题追加到对应小节，并同步更新 AGENTS.md 索引表。

### 阶段 5 关键实现备忘（防回退）

- **换房/重建协议**：`switch_room`（C2S，保持连接换房，目标满则拒）、`world_reset`（C2S，仅 host）；`world_info` 加 `restart` 标记（含新建房走 `createRoom` 分支也要带）。客户端 `NetworkManager` 收到 restart → `_ready=false` + `restart_world` 事件 → `main.js` 用新 seed 重启本地世界 → `onWorldStarted()` 落地缓存，全程不断连接。聊天命令 `/room <名>` `/rebuild`。
- **时间戳插值**：`player_state` 广播带 `ts: Date.now()`；`RemotePlayer` 样本缓冲(≤40) + 时钟偏移平滑(0.9/0.1) + 固定 120ms 延迟，`renderTime = now + offset - delay` 线性插值重放。**高陷阱：包围 renderTime 的下标 i 必须钳到 `len-2`**（`b = buf[i+1]` 不能越界），否则 `b.ts` 抛错会让整条 `Game.loop` 停摆（曾真出过）。SNAP>4 快照并清空缓冲防传送回拉。
- **面板鉴权**：`config.js` 的 `adminToken`（字符串 ≤64，空=关）+ `adminTokenExpires`（阶段6，Unix 秒，0=永不过期）；`index.mjs` `authState(req)` 返回 `'ok'/'no'/'expired'`（`Bearer <token>` 校验 + 过期判断），`maskedConfig()` 掩码回显；`admin.html` 登录弹层 + localStorage 存口令，配置卡口令框 `****` 未改不提交。未授权 401。
- **ChatBox 全局 T 键监听器必须在 dispose 移除**（`this._onKey` 引用保存并 `removeEventListener`），否则换房/重建反复 `start()` 会堆积监听器导致一次 T 开多个输入框。

### 阶段 6 关键实现备忘（防回退）

- **手持物品同步**：`player_state`/`player_full` 广播 `selected`（槽位）+ `held`（物品名），`Room.onPlayerState/onPlayerFull` 透传记录；`RemotePlayer._setHeld(name)` 异步重建右臂挂载物（**阶段10 已升级为 3D 模型**，见阶段 10 备忘），`_heldSeq` 序号防竞态，`dispose()` 必须释放挂载物。
- **PARTS 关节 role 必须唯一**：左右臂/腿用 `armL/armR/legL/legR`（**勿回退为重复 `'arm'`/`'leg'`**——后者覆盖前者导致 `joints.armL/armR/legL/legR` 全部不存在，行走摆臂失效、手持 sprite 挂不上右臂，曾真出过）。手持 sprite 挂在 `joints.armR.pivot` 末端。
- **死亡掉落物**：`player_died` 携带死亡位置 + 背包列表（客户端 `sendPlayerDied()` 先读背包再清空）；`Room.onPlayerDied` 广播死亡 + 逐项 `drop_spawn`（确定性偏移防重叠，进账本）；同一次死亡 `_diedDrops` 去重（`addPlayer`/`onRespawn` 复位，防重复上报刷掉落）；`Game.respawn` 联机分支重发生存初始物品。
- **鉴权过期**：`adminTokenExpires` 到期后 `authState` 返回 `'expired'`——**仅放行 `POST /api/config` 供续期/关闭**（避免永久锁死），其余 401（错误含"过期"，admin.html 据此显示续期横幅而非登录弹层）；`/api/logs` 内存环形缓冲 200 条记录 config/broadcast/kick/clear-drops/delete-room/auth-fail。**注意：PowerShell `Get-Date -UFormat %s` 的 epoch 会偏 ~8 小时（时区 bug），设过期时间要用 `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()`**。
- **观战平滑**：`_specSmoothed/_specSmoothYaw/_specSmoothPitch` 帧率无关指数平滑（`k = 1 - Math.pow(0.0001, dt)`），切换目标（`cycleSpectateTarget`）/进入观战/重生时重置为 null（避免跨图横扫）；`updateSpectateCamera` 读平滑后位置/朝向。
- **自适应插值延迟**：`RemotePlayer.update` 按"头余量 = 最新样本 ts − renderTime"动态调 `_interpDelay`（<0.03 → +0.004 加大吸收抖动；>0.22 → −0.002 降低滞后；钳 0.05~0.4）。**仍须保留 stage5 的 `i 钳到 len-2` 防越界**。
- **测试非幂等**：服务器回归测试对同一 live 服务器重复跑批会被污染（遗留 `server/world/*.json`、config 里的 adminToken/expires）——跑批前清空 `server/world/` 与 `server/config.json`（或重启服务器）。

### 阶段 10 关键实现备忘（防回退）—— 手持物 3D 化 + 快捷栏同步 + 掉落归属锁 + 多账号 + RTT

- **手持物 3D 化**：`src/render/HeldItemMesh.js`（模板缓存进程级，clone 复用；方块=六面贴图立方体、`renderType==='cross'` 方块=交叉双面薄片、物品=双面薄片；材质 `MeshLambertMaterial` + `emissiveMap` 同贴图 0.35 自发光，夜晚可见；**勿改回 sprite billboard**）。`src/render/FirstPersonHand.js` 第一人称：**camera 必须加入 scene（`scene.add(camera)`）其子节点才渲染**（`Game.constructor` 一次性挂载，属共享型子系统——`start()` 里重置 `currentName=undefined` 强制重建）；按住左键自动连续挥动（0.3s 冷却），放置/食用/命中命中时 `hand.swing()`。`RemotePlayer._setHeld` 挂 `armR.pivot`（dispose 只 remove 不 dispose，几何/材质为共享缓存）。
- **整条快捷栏同步**：`player_full` 带 `hotbar`（9 槽），`Room.sanitizeHotbar` 校验（一项非法整体丢弃、保留旧值）；`Room.joinInfo(p)` 供 joinRoom/createRoom/resetWorld 回放 `PLAYER_JOIN`（带 `selected`/`held`/`hotbar`）——**新加入者立即看到在线玩家手持物**；`RemotePlayer.applyFull` 无 held 时用 `hotbar[selected]` 推导。
- **死亡掉落归属锁**：账本 `owner`/`ownerUntil`（3 秒）；广播 `drop_spawn` 带 `owner`/`ownerLock`（剩余毫秒）；锁内非 owner `drop_taken` → 服务器 `drop_deny` + **补发 drop_spawn**（客户端重建实体）；**账本已不存在的 drop_taken 也回 deny**（防两人同时拾取复制物品，勿删此分支）；客户端 deny 回滚 = `takePendingPickup(id)` 取拾取留档 + `Inventory.removeItems(name, count)`；本地预判拦截在 `MobManager.updateDroppedItems`（`getSelfId` 由 Game 注入，勿删）。
- **管理多账号**：`config.adminAccounts=[{token,label,expires}]`（≤10）；旧 `adminToken`/`adminTokenExpires` 是 default 账号的兼容接口（`applyConfig` 双向同步）；`authState` 遍历账号匹配；**id = token 的 SHA-256 前 8 位**（`accountId()`），rotate/revoke 按 id 定位避免明文回传——**轮换后 id 会变**（客户端须重新拉列表）；token 生成用 `crypto.randomBytes(24).toString('base64url')`，明文仅创建/轮换响应返回一次。admin.html 生成/轮换用 `prompt` 显示新口令（agent-browser 需 `dialog accept`）。
- **RTT 直测**：客户端每 2s 发 `ping {seq, ts: performance.now()}`，`room.handle` PING 分支**回显 `ts`**（勿删）；客户端 PONG 分支按 `ts` 算 EMA(0.8/0.2) → `NetworkManager.rttMs`；`RemotePlayer` 自适应以 RTT 为主信号（目标 = clamp(0.05 + rtt/2000, 0.05, 0.4)，每秒 40% 平滑靠拢），头余量仅保留欠载保护（>0.22 降延迟仅限无 RTT 数据时）；InfoBar 联机显示「网络: Xms」（第 5 参数 `rttMs=null` 隐藏）。
- **验证**：`node --check` + `npm run build`（47 模块，655 kB）+ `test-stage10.mjs` 41/41 + 全基线绿 + agent-browser 冒烟（第一人称手持方块/火把/物品截图、远端手持模型、joinInfo 回放断言、InfoBar RTT 行、掉落锁确定性断言：**注入 fake drop（owner≠self, lockedUntil>now）手动驱动 updateDroppedItems → 拦截；置 lockedUntil=0 → 拾取**——浏览器实时 3 秒锁内断言受命令间隔/pickupDelay 干扰不可靠，用此注入法）。

### 阶段 11 关键实现备忘（防回退）—— 挥动联动 + 头顶快捷栏 + 白名单/权限 + 抖动自适应

- **挥动周期与挖掘进度联动**：`InteractionController`（B30 轮 8 步 8 起；原 `Game.handleMouseInput`）生存挖掘分支把 `hardness/speedMul`（实际挖穿秒数，钳 0.1~10）写入 `hand.miningPeriod`（再钳 0.25~1.0s），`FirstPersonHand` 自动挥动周期与挥速都用它（挥速 = 3.2×0.3/period，单次挥动时长≈周期）；放置/攻击/进食的单次 `swing()` 不受影响。`_miningActive` 在 `handleMouseInput` 入口统一复位、仅生存挖掘分支置 true（早退分支自然复位，勿在别处手动清）。
- **远端挖掘摆臂**：`player_state` 增 `mine`（0/1，服务器透传不进 joinInfo）；`RemotePlayer` 用 `_mineAmp`（目标 0/1，`dt*10` 平滑）+ `_minePhase`（`dt*21`≈0.3s 周期）驱动 armR 叠加摆动——勿直接写死 rotation（会丢行走摆臂叠加），respawn 复位三态。
- **头顶快捷栏 sprite（`src/render/RemoteHotbarSprite.js`）**：每实例独享 texture/material（**dispose 必须释放**，图标 Image 是模块级缓存不释放）；重绘节流靠内容/选中槽指纹比较（20Hz player_state 只做字符串比较）；图标解析链与 Hotbar 同口径（`itemSvgMap[name]` → `blockSvgMap[block.side||block.top]`），`svgToImage` 异步到位后**整幅补画**（onLoaded 回调 → `_redraw`）；全空快捷栏 `_empty` 隐藏；sprite y=+2.62（昵称 +2.3 之上）。**RemotePlayer 构造里 sprite 的 position 赋值必须放在 `_target` 初始化之后**（曾把 position.set 插在构造前段引用 undefined `_target`）。
- **白名单/Op 名单存 config.json**（`roomWhitelist`/`roomOps`，`sanitizeRoomNameMap`：≤32 房 × 16 名、trim 去重、非法整体丢弃）——勿搬到房间快照（管理面板实时改 + 与房间存档生命周期解耦）。入房拦截在 index.mjs 的 CREATE/JOIN_ROOM 前用**trimmed 房间名**查名单（名单 key 已 trim）；kicked 拒绝（客户端 `_explicitClose` 停自动重连）；switch_room 游戏内用聊天拒绝（与"房间已满"同款，不踢线）。`Room.isOperator()` = host 或昵称在 `roomOps[房间名]`，gamemode/set_time/world_reset 三处走它；拒绝**必须给系统聊天提示**（原为静默忽略）。
- **viewer 只读**：`authState` 返回 `{state, role}`（勿改回字符串——whoami/403 都依赖 role）；viewer 非 GET 一律 403 且**该检查必须在各路由前**；过期账号仍只放行 POST /api/config（与阶段6一致）。admin.html 靠 `body.viewer .card button { display:none }` 一条 CSS 隐藏全部写按钮（新增写操作自动被盖住，无需逐个加类）；白名单 textarea 回显会跳过 `document.activeElement` 聚焦中的框（防 3s 轮询打断编辑）。
- **netStats（`src/net/netStats.js` 纯函数）**：RTT EMA(0.8/0.2) + 抖动 = 相邻样本差绝对值的 EMA（**首样本无抖动**）；`targetInterpDelay = clamp(0.05 + rtt/2000 + jitter/4000, 0.05, 0.4)`——抖动权重是 RTT 的一半，别调大（局域网抖动 ms 级只作微调）；`RemotePlayer` 头余量欠载保护保留作 RTT 缺失时兜底；InfoBar 第 7 参 `rttJitterMs`（null=不显示 ±）。
- **测试非幂等 + 路径口径**：`test-stage11.mjs` 第 1 用例依赖"鉴权未开启"前提（重复跑批前必须清 `server/config.json`，收尾已把名单清空但**账号会遗留**导致鉴权开启）；`server/test-*.mjs` 的 `api()` 帮助函数以 `http://.../api` 为基底，**路径传 `/status` 不传 `/api/status`**（传全路径 = /api/api/... = 404 未知接口，曾真踩）。

### Idea-2B 关键实现备忘（防回退）—— 箭矢事件同步

- **事件式而非状态同步**（与怪物同步同款妥协）：`arrow_shot {id,x,y,z,dx,dy,dz}` 只传初速，各端本地确定性积分（重力 -12/寿命 8s 一致即视觉对齐）；`Room.onArrowShot` = 纯转发 except 发起者 + **broadcastDim 同维度**（异维端不收到）；不进方块/掉落账本（钉墙/消失各端本地处理）。
- **伤害射端权威**：`spawnRemoteArrow` 生成的箭带 `remote:true, dmg:0`，`_updateArrows` 命中怪分支 `if (!a.remote) attackMob(...)`——远端箭只 despawn 不结算；射端 `_releaseBow` 本地 spawn 后 `net.sendArrowShot(arrow.pos, arrow.vel)`（Vector3 引用即时序列化，无时序问题）。（B30 轮 8 步 3 起 `spawnRemoteArrow`/`_updateArrows`/`_releaseBow` 实现在 `src/player/Projectiles.js`，Game 侧同名门面。）
- **服务器脏包校验必须先 typeof 再 isFinite**：`JSON.stringify(NaN)` 序列化成 **null**，`Number(null)=0` 会混过 `[...].map(Number).every(Number.isFinite)` 转换式校验（测试真踩：NaN 弹丸被静默放行为 x=0）；正确写法 `raw.every(v => typeof v === 'number' && Number.isFinite(v))`。
- **远端箭命中本地模拟的怪会即时消失**（设计行为）——冒烟时"没收到箭"先排除弹道撞怪再怀疑链路（曾误判丢包，ws.send 探针 + 复测定位）。
- **测试**：`server/test-idea2.mjs`（7/7，已入 run-all-tests.sh）：转发字段一致/携带射者 id/无回声/三类脏包（字符串、缺字段、NaN→null）全丢弃。

### Idea-2C 关键实现备忘（防回退）—— 潜影盒内容跟随物品

- **评审结论（"存档 V3 风险"解除）**：背包序列化 V2 本就带 `d`（data）字段、`Inventory.add(name,count,data)` 与 ChestScreen 游标早已支持 data、World/服务器容器账本 items 数组原样 JSON 序列化——**存档侧零改动**；真正要扩的只有掉落与容器两条协议 + 方块注册。
- **data 通道协议**：`drop_spawn`/`player_died.drops`/`container_set` 全部可选携带 data；服务器 `sanitizeItemData`（模块级）校验：≤27 槽、槽=null 或 {name,count}、**任一槽带嵌套 data（盒中盒）→ 整体拒绝降级普通物品**（all-or-nothing，勿改逐槽丢弃）；`Room.sanitizeStack` 同步扩展（曾只回 {name,count} 静默剥掉容器内盒子的 data）。服务器 drops 账本为会话内存（重启清空，与既有行为一致）。
- **客户端机制**：带 data 物品**不堆叠**（`Inventory.add` 堆叠条件加 `!s.data && !data`——漏了会串内容）；放置：`setContainer` 落账本 + 联机 `sendContainerSet` 整箱广播；破坏：`_breakShulkerBox` 内容不散落、单一掉落带 data（空盒 data=null），生存直入背包/创造与联机走实体掉落；`_blockDrops` 对 shulker_box 返回 []（防双掉落）；`onPickup(name,count,data)` 透传入包；容器 UI 复用 ChestScreen（分支条件扩 shulker_box）。**（B30 轮 8 步 6 起 `_breakShulkerBox`/`_breakChest`/`onContainerChanged` 实现在 `src/player/Placement.js`，Game 侧仅同名门面；`ChestScreen` 经 `game.onContainerChanged` 的上报出口未动。）**
- **验证教训**：①eval 直调 `chestScreen.show()/hide()` 会把 `paused` 留成 true（真实 UI 流程管理该标志），后续掉落 age 不走全卡住——冒烟卡住先查 paused；②比对拾取结果时 data 是**补齐 27 槽**的版本，勿与原始短数组比；③指针锁精确放置依旧不可行，放置钩子靠代码审查（一行、坐标=放置坐标）+ 其余链路真实代码路径实测。

### Idea-3C 服务器玩家档案批次备忘（防回退）

- **存储布局**：`server/world/players/<房间名>.players.json`（独立目录，`store.js` 新增 loadPlayerProfiles/savePlayerProfiles/deletePlayerProfiles），结构 `{昵称: {inventory, position, dim, health, food, saturation, xp, xpLevel, savedAt}}`。**inventory 直接复用客户端 SaveSystem 的 serialize() V2 紧凑格式 `{slots:[{n,c,d}], armor:[{n,c,d}]}`**——槽内 d（潜影盒内容）是**容器格式 `{name,count}`**（与外层 {n,c} 不同名！sanitize 分两套：外层 profileNum/typeof 强校验，d 过 sanitizeItemData）。
- **校验器（room.js sanitizePlayerProfile）**：**全部数值字段 typeof number 强校验**——JSON 的 NaN/Infinity 序列化为 null，若走 Number(null)=0 强转会被洗成合法值（Idea-2B 同款陷阱复现）；任一字段非法 → **整体拒绝**（防半套档案污染）；坐标范围 ±3e7/y∈[-300,1000]、health/food/saturation∈[0,20]。
- **协议与节拍**：C2S `profile_save {profile}`（客户端 15s 周期 + NetworkManager.update 驱动，观战期间也发——死亡掉落流程随后覆盖 last-write-wins）；S2C `player_profile {profile}` **仅发给本人**（joinRoom 尾部查 playerProfiles）。服务器收录只进内存 + `_profilesDirty` 标脏，**10s profileSweep 节流落盘 + removePlayer 立即 saveProfiles()**（防丢包窗口放大）；shutdown 全刷。
- **客户端应用（NetworkManager.applyPlayerProfile）**：进房消息到达时世界未就绪 → `_pendingProfile` 缓存，`onWorldStarted()` 应用；**位置仅同维度应用**（异维档案坐标无意义，只恢复背包/状态）；应用包 try/catch 不阻断游戏。
- **管理 API**：`GET /api/room/<name>/players`（列表）+ `DELETE /api/room/<name>/players/<nick>`（清除伪造档案）；admin.html 房间卡片加「玩家档案」按钮（展开列表+清除，`btoa(unescape(encodeURIComponent()))` 做 DOM id 转义）。
- **⚠️ 测试陷阱**：test-profile.mjs 文件内有 `const URL = 'ws://...'` **遮蔽全局 URL 类**——校验器里 `new URL(...)` 会抛 "URL is not a constructor" 且被 catch 吞成"无鉴权"（batch 401 假失败）。读路径用 `fileURLToPath(import.meta.url)` + path.join。**跑批中前序 test-admin/stage11 会留下 adminAccounts（含 viewer 角色）**——管理 API 断言必须带 Bearer 头（测试从 config.json 读未过期账号），否则 401 假阴性。stage11 结尾不清理账号（残留即鉴权开启态）。

### Idea-4A 房间配置开关批次备忘（防回退）

- **配置形态**：`config.roomSettings: {<房间名>: {pvp:bool, mobs:bool}}`，`sanitizeRoomSettings`（config.js）清洗——≤32 房、pvp/mobs **仅认 boolean（缺省/非布尔=开 true**，与"未配置即全开"语义一致）、非法条目跳过非整体拒绝）；loadConfig/applyConfig 均整体替换。**勿搬到房间快照**（与白名单同款：管理面板实时改 + 与房间存档生命周期解耦）。
- **语义（谁信谁）**：服务器权威过滤 = `Room.onAttack`（pvp 关 → 不结算不广播 + 攻击者系统聊天提示）、`Room.onMobSpawn`（mobs 关 → 不分配 id 不转发 + 提示）；客户端一致性闸门 = `NetworkManager.sendMobSpawn` **发送口短路**——host 实体由 mob_spawn 回执创建，闸在发送口即本端与各端一致不生成（零漂移），村民/铁傀儡/潜影贝/自然生成全部共用此单一漏斗；`Game.js` 互殴分支加 `this.net.roomSettings?.pvp !== false` 跳过远端玩家检测。
- **下发与热更**：`WORLD_INFO` 携带 `settings` 字段（createRoom/joinRoom/resetWorld 三出口都带；客户端 `_handle` 的 WORLD_INFO case 顶部统一更新——**勿在该 case 中间插 break**，曾把原 restart/重连逻辑切成不可达代码）；管理面板/API 改动后 `ROOM_SETTINGS {room,pvp,mobs}` 只向该房间在线玩家广播（异房间不串扰），客户端按 `msg.room === this.room` 收敛。
- **API**：`GET /api/settings`（全表，viewer 可读）；`POST /api/room/<name>/settings {pvp?,mobs?}`（字段**只认 boolean 否则 400**、至少一项、房间名 ≤32；落盘 + 内存房间热广播 + logAdmin）。面板房间卡 checkbox 数据源是 `Room.info().settings`（status 轮询直出），onchange 即保存；房间名注入 onclick 走 `attrRoom()`（先 JS 转义 `\`/`'`，再 HTML 转义 `"`/`&`，顺序勿换——HTML 解码后得到的就是 JS 字符串字面量）。
- **测试**：`server/test-idea4.mjs`（22-23 断言，已入 run-all-tests.sh，跑批中位于 test-profile 后——**前序套件遗留 adminAccounts**，op/viewer token 从 config.json 读；单独裸跑且只建 viewer 账号时 op 调用全 403 属预期假象非 bug）。

### Idea-4B/4C 世界备份 + 消息速率限制批次备忘（防回退）

- **备份（store.js）**：`roomSnapshot(room)` 从 saveRoom 抽出（快照结构与落盘**逐字段一致**，勿分叉两套序列化）；`backupRoom/listBackups/pruneBackups` 落 `<world>/backups/<房间名>-<毫秒ts>.json`，list 按 ts **降序**（最新在前），prune 删 keep 之外的旧份。毫秒 ts 天然排序且防同名；房间名经 `roomFileName` 清洗（中文保留）。
- **备份 API**：`GET /api/room/<name>/backup`（**op 专属**——viewer 对 GET 也 403，须在路由内显式判 `auth.role !== 'op'`，全局 viewer 拦截只管非 GET）；内存有世界用 `roomSnapshot` 直出（比磁盘新），不在内存回读 `<world>/<safe>.json`，都没有 → 404。**Content-Disposition 头只放 ASCII**：房间名要再过一遍 `[^\w-]` → `_`（中文直接进 header 会抛 invalid character）。
- **自动备份**：`backupIntervalMinutes`（0=关闭，默认）/`backupKeep`（1-50，默认 10）进 RANGES；60s sweep 只备份**内存中已建世界**的房间（磁盘存档本身就是备份源），lastBackupAt 是内存 Map（重启重新计时，接受）；每次备份写 adminLog（分钟级节奏不刷屏）。
- **限速（`server/ratelimit.js`）**：`RateLimiter` lazy-refill 令牌桶——**getLimit 闭包每次 allow() 现取 config.rateLimits**（面板改配置即时生效，tokens 超新容量自动收敛，勿缓存容量值）；限额=次数/分钟，refill=limit/60000/ms。`tierOf` 只认 chat/block/state 三档（CHAT 含 '/' 命令同走 chat 档），**未列出消息与 PING/PONG/HELLO 天然豁免**（心跳绝不丢）。限速钩子在 index.mjs ws.on('message') 的 pong/HELLO 判定之后、所有 dispatch 之前；超限丢包计数 `player.dropped[tier]++`。
- **可见性**：`Room.info()` 玩家带 `dropped`（status 3s 轮询直出面板「限速丢包」列）；聚合日志走 10s sweep + **WeakMap 增量快照**（`_rateReported`），只对增量>0 的玩家写一条 `rate-limit` 日志——勿逐包写（200 条环形缓冲瞬间刷爆）。
- **默认阈值锚定实测**：player_state 20Hz=1200/min → state 1800；挖放峰值 ~15/s → block 900；人工聊天 → chat 30。0=不限制。测试把三档收紧到 3 再还原；**收尾必须 POST /config 还原默认**（rateLimits/backup*/roomSettings 清空）防污染后续套件。
- **测试**：test-idea4.mjs 增至 42 断言（跑批中含鉴权 viewer 403 两条）；备份/限速 API 全部过 op token。

### Build 10 掉落物原版化批次备忘（防回退）—— drop_spawn 速度透传 + 岩浆销毁清账本

- **drop_spawn 可选速度字段**：`sendDropSpawn(x,y,z,name,count,data,vel)` 追加 `vx/vy/vz`（Number.isFinite 校验后携带）；服务器 `onDropSpawn` clamp ±16 后入账本 entry + 广播 back，**快照恢复与断线重放回放都带**（store.js 落盘走 `{id, ...d}` 展开自动持久化，room.js 快照 apply 是字段白名单须显式恢复）；客户端 `spawnRemoteDrop(..., vel)` 缺省仍按 id 哈希派生——**向后兼容旧客户端**。Q 丢弃联机不建本地实体，等服务器回执（与联机挖矿同惯例），代价是 RTT 级延迟。
- **联机禁用本地合并**：掉落物是服务器账本实体（id 权威），本地合并会两端分裂——`mobManager.isMultiplayer`（Game.start 注入）为 true 时跳过合并扫描；同类合并仅单机。若未来做联机合并必须服务器权威（Room 定期合并账本 + 新消息广播）。
- **岩浆销毁清账本**：掉落物入岩浆即焚——销毁端若 `drop.id != null`（联机实体）必须发 `drop_taken`，否则账本残留 → 其他端可"幽灵拾取"已被焚毁的物品（服务器 drop_taken 广播正好复用既有通道，无需新消息）。
- **单机挖矿掉落直接进背包**（既有设计）：物理掉落物的主要来源 = 怪物掉落 / 容器洒落 / Q 丢弃——表现优化全部走这三条路径验证。
### B30 审查轮 5 服务端打磨批次备忘（防回退）—— 落盘节流 + 回放打包 + 协议版本 + 限速扩档 + 皮肤代理加固 + 心跳活读

- **世界落盘三分法**：`Room.save()` = 立即全量落盘（结构性变更：建房/重建/换维/设时间/天域与终局状态/踢人/clearDrops）；`Room.saveSoon()` = 只置 `_worldDirty`（高频路径：方块单条与批量、容器、掉落生成/拾取/过期、死亡掉落）；`Room.flushWorld()` = 脏则落盘并清标记（幂等，**先清后写**，落盘期间的新写入会重新置脏不被吞）。触发点 = `index.mjs` 的 `worldFlushSweep`（1s 遍历）+ `removePlayer()` 房间清空时（room.js）+ `shutdown()` 强刷。**新增写世界账本的路径必须显式选 save / saveSoon，误用 `save()` 会退回「每包全量 stringify + writeFileSync」**（调度方实测：200 条方块消息老路径近 200 次全量写 → 新路径 3 次）。
- **账本回放打包**：`Room.replayBlocks()` 把 joinRoom 的方块回放改为 `BLOCK_CHANGE_BATCH { list: [[x,y,z,id]], by: 0, d }`（`REPLAY_CHUNK=512`），`ws.bufferedAmount > 1MB` 时 `setTimeout(step, 50)` 让出事件循环等排空、**不丢账本项**；**块内取值取账本现值**——让出期间该格可能已被实时广播改写，用快照旧值会覆盖新值。逐格 `BLOCK_CHANGE` 仅剩实时广播（`onBlockSet`）。`DIMENSION_WORLD` 仍是整包（客户端按整包收敛），大世界有单帧 stringify 尖峰，属已知后续项。
- **协议版本协商（S11）**：`server/protocol.js` 的 `PROTOCOL_VERSION = 1` 为唯一来源；客户端 HELLO 上报该常量，服务端 `Number(msg.version) !== PROTOCOL_VERSION` → `KICKED`（提示刷新页面）+ 关闭连接；`version` 缺失（undefined/null）按旧客户端放行且 `WELCOME.legacy = true`，`WELCOME` 恒带 `protocol`。**协议形状变更必须递增该常量**；服务端套件与 `server/client-sim.mjs` 一律 import，不得再写 `version: '0.1'` 字面量。
- **限速扩档（S6）**：`tierOf()` 增 `join`（create/join/switch_room，每条约一次整账本回放）/ `skin`（skin_set 16KB 广播）/ `profile`（profile_save 全档校验）；`config.rateLimits` 默认 join 30 / skin 30 / profile 60（每分钟，0=不限）。**新增档位必须同时扩 `createConnectionLimiters`（否则 `player.rate[tier]` undefined 崩服）与 `config.sanitizeRateLimits` 键集**；丢包上报遍历 `dropped` 的全部键，勿再写死三档。
- **皮肤代理加固（S7）**：`/api/skin/` 按 `req.socket.remoteAddress` 限频（档位 `skinFetch`，超限 429 + `Retry-After`）；`skinCache` 上限 200（超限先清扫过期再淘汰最旧，读命中顺手删过期项）；三跳 fetch 全部 `AbortSignal.timeout(5000)`；**域名白名单只匹配 hostname = `textures.minecraft.net`**——Mojang 实际下发的是 `http://` 链接，出站统一升级为 https 再取（写死「必须 https」会让真实皮肤 100% 502）；日志按 IP 10s 聚合（`logAdmin(op, detail, throttleKey)` 就地更新同一条目，不再逐次新增行，避免刷爆 200 条环形缓冲）。
- **心跳活读（S12）**：连接侧改为自管理 `setTimeout` 链 + 200ms 轮询步长，每轮现读 `serverConfig.heartbeatMs`（到点才发 ping；未回 pong 则下一轮到点 terminate）。**勿改回 `setInterval(..., serverConfig.heartbeatMs)`**——周期会被固化在连接建立时，面板改配置只对新连接生效。
- **客户端入口防御（S13）**：`src/net/netMessage.js` 的 `parseServerMessage()` 是 `ws.onmessage` 单点收口（解析失败 / 非对象 / 数组 / `t` 非字符串 → null），`_handle` 入口同款再防一次；**不要绕过它直接 JSON.parse**（`parse('null')` 不进 catch，`m.t` 访问即抛）。
- **本轮验收**：`server/test-hardening-net.mjs`（51 断言）、`tests/room-persist-replay.mjs`（28）、`tests/net-message-guard.mjs`（18）已注册进 `run-all-tests.sh`；调度方另有 22 项黑盒探针（版本协商 / 写盘次数 200→3 / SIGTERM 强刷 / 600 格回放分块 / 删房清理 / 心跳热生效 / 皮肤限频与日志聚合）与浏览器端到端冒烟（真实客户端连接 → 建房 → 本地世界启动，控制台 0 TypeError）。

### B36 F-1 漏斗与容器搬运批次备忘（防回退）

- **改前旧行为（记录用）**：容器只有一条同步路径——客户端改 → `CONTAINER_SET`（`by: player.id`）→ 服务器 `Room.onContainerSet` 直接入账并 `broadcastDim`；服务器只在加入房间（`by: 0`）与换维快照里下发容器；单机容器只有玩家开箱/拖动物品才会变。**没有任何服务器定时改动容器的路径**，这是 F 引入的新架构面。
- **权威面**：搬运决策 = `src/core/HopperFlow.js` 纯函数 `tickHopperFlow(hoppers, io)`，两端**共用同一实现**（服务器 `server/flow.js` 再导出给 room.js）。联机：`server/index.mjs` 的 `flowSweep`（200ms 遍历房间）→ `Room.tickFlow(now)`（按 `config.flowIntervalMs` 门控、`flowEnabled===false` 整段短路）→ 内容变化以 `CONTAINER_SET {by: 0, d}` **按容器合并**广播（Set 天然去重，每 tick 每容器最多一条）。单机：`Placement.updateHopperFlow(dt)` 走同一纯函数，**联机时该方法首行早退**——客户端绝不本地转移，否则与服务器回放互相覆盖。
- **搬运语义**：每个漏斗每 tick **最多搬一堆**（先出后进：先把自己缓冲推进出料口相邻容器，推不动才从正上方容器进货）；漏斗自身 27 槽就是缓冲；`facing` = 出料口方向（`hopper`=n / `hopper_s` / `hopper_e` / `hopper_w`），非法 facing 退化为向下。堆叠合并只认同名且双方 `data == null` 的栈（潜影盒永不并入同名堆），合并上限 64。
- **两条同步路径的分界（本批核心）**：`Room.onContainerSet` 先问 `_isFlowManaged(dim, key)`——① 该格是漏斗（服务器内容，恒管）；② 该容器在最近 `FLOW_HOT_MS=1000` 内被搬运写过（`_flowHot` 热窗口）。命中即**拒绝客户端改写**并回 `CONTAINER_DENY {x,y,z,items,d,by:0}`（照 `drop_deny` 的做法），客户端 `NetworkManager` 的 `CONTAINER_DENY` 分支复用 `_applyContainer` 回滚本地并把打开的箱子界面刷新成权威内容。**改这条判定前先想清楚"客户端用旧视图覆盖刚搬过去的物品"这一竞态**。
- **漏斗索引两端同构、零新增存档字段**：客户端 `World.setBlock` 末尾调 `World.trackHopper`（每次写方块更新本维度 `world.hoppers` Map）；服务器 `Room.trackHopperBlock` 在 `onBlockSet`/`onBlockSetBatch`（含 id=0 挖掉）维护 `dimensionHoppers`，并在 `restoreSnapshot` 时**从方块账本重建**、`resetWorld` 时清空。因为纯派生，旧存档/旧快照天然兼容——**不要把它写进 roomSnapshot**。
- **方块 id 表**：`server/flow.js` 的 `HOPPER_FACING_BY_ID`（217~220）与 `CONTAINER_BLOCK_IDS`（箱子家族/潜影盒/漏斗家族）是客户端注册顺序的镜像，由 `tests/hopper-unit.mjs` 逐 id 钉住（读同一份 BlockRegistry）。**在 BlockDefs 中部插方块 = 同时打破这张表与旧存档**。
- **容器创建纪律**：服务器只在「该格在方块账本里且 id 属于容器家族」时才凭空建 27 槽空容器——未开过的结构箱子不在方块账本里，因此**不会被漏斗凭空覆盖 loot**；客户端单机侧同理按 `getBlock` 的 def 判定（未加载区块返回 0 → 不建）。
- **限流与边界**：每房间漏斗上限 `FLOW_HOPPER_LIMIT=64`（跨维度合计；`onBlockSet` 超限不入账，给发起者回 `BLOCK_CHANGE {by:0, id: 账本现值或 0}` 回滚 + 系统聊天提示）。**回滚到 0 依赖"放置目标必是空气/可替换格"**，将来若有"替换已有方块"的放置路径要同步改这里。`flowEnabled`/`flowIntervalMs` 必须同时改 `server/config.js` 的 DEFAULTS + RANGES + `loadConfig`/`applyConfig` 两处数值键白名单 + 布尔专用分支，以及 `server/admin.html` 的表单回显/提交两处——漏任何一处都只剩代码兜底。
- **配置范围**：`flowIntervalMs` 合法区间 [200, 5000]（sweep 粒度就是 200ms，配更小无意义）；非法/越界值保持原值不回落。
- **已知限制**：① 物品飞出的粒子动画未做（方块模型与内容界面已复用箱子）；② 玩家无法手动整理漏斗内容（服务器恒管），要清空需拆掉漏斗——拆掉时 `breakChest` 会把内容散落，不会凭空蒸发；③ 分类器/矿车按计划不做；④ 熔炉内容仍未进联机账本（F-2 范围）。
- **测试**：`tests/hopper-unit.mjs`（57 断言：id 钉值/配置白名单/朝向/先出后进/满空/不可堆叠/一堆 tick/touched 去重/确定性）与 `server/test-flow.mjs`（16 断言：服务器真搬货 + `by:0` + 客户端改写被拒与回滚 + 第 65 个漏斗被拒与提示）已入 `run-all-tests.sh`。

### B36 F-2 熔炉进出料与生产链批次备忘（防回退）

- **改前旧行为（记录用）**：熔炉状态只活在客户端 `World.furnaces`（维度分桶 Map，随存档落盘），进度由 `Game.updateFurnaces` 每帧推进，谁开着谁算；联机时**只有点燃态方块**经 `BLOCK_CHANGE` 同步，内容物与进度完全不在账本里——两人各开一次同一个熔炉就会各自产出，产物翻倍。
- **账本**：`Room.dimensionFurnaces`（dim → `Map("x,y,z" -> {input,fuel,output,burnTime,burnMax,cookTime})`），字段名与客户端状态对象逐字一致（双端共用 `src/core/FurnaceTick.js`）。随 `roomSnapshot` 落盘为 `dimensionFurnaces: {dim: [[key, st]]}`；旧快照无该字段 → 空表回落，**不新增协议版本**。
- **进度归服务器**：`server/index.mjs` 的 `flowSweep`（200ms）在 `tickFlow` 之后调 `Room.tickFurnaces(now)`；dt = 距上次 tick 的秒数并**钳到 1s**（防进程挂起后大步长追赶）。`Placement.updateFurnaces` 在 `networkMode` 下**首行早退**——客户端既不推进也不产出，只显示服务器下发的进度；改这条等于把「两端各自产出」的重复计账放回来。
- **协议**：新增两条纯新增消息（`PROTOCOL_VERSION` 不动）：`FURNACE_OPEN {x,y,z}`（C2S，只回本人一条权威状态，用于开界面）与 `FURNACE_SET`（C2S `{x,y,z,input,fuel,output}`；S2C `{x,y,z,d,by,input,fuel,output,burnTime,burnMax,cookTime}`）。**C2S 只接受三个内容槽**——进度字段一律以服务器为准，客户端发什么都不采信。
- **广播节拍**：内容物变化（`slotsChanged`）即时广播；点燃态与方块家族随时对齐（`furnaceInfoOf` 与 `burnTime>0` 不符就写回点燃/熄灭态方块并发 `BLOCK_CHANGE {by:0}`，服务器重启后自愈）；其余进度按 `FURNACE_SYNC_MS=500` 节拍同步**只有正在烧的炉子**（`burnTime>0 || cookTime>0`），静置的空炉零消息。
- **两条同步路径的第三形态**：`onFurnaceSet` 是 last-write-wins（与箱子同口径），**没有** F-1 那种 `_isFlowManaged` 拒绝——玩家必须能给被漏斗喂料的炉子塞燃料。代价是「服务器刚把产物搬走、玩家本地还拿着旧视图去取」的毫秒级竞态仍在（与既有箱子竞态同类），靠 500ms 同步节拍缩小窗口，已记为已知限制。
- **漏斗接线（本批重点）**：`src/core/HopperFlow.js` 的 io 新增 `getFurnace/ensureFurnace/onFurnaceChanged`（可选，缺省=不接熔炉）。出料口正对熔炉 → 进内容槽，**燃料槽优先**（同时是燃料与原料的物品如原木先进燃料槽，燃料槽满才退到输入槽）；漏斗正上方是熔炉 → **只取输出槽**（输入/燃料绝不外流）。每 tick 仍是每漏斗最多一堆。
- **布局（与计划措辞的差异）**：`hopper` 家族只有 n/s/e/w 四个水平朝向，**没有向下的漏斗**，所以计划里的「上方漏斗进料」在本作落成「漏斗出料口正对熔炉侧面进料 + 漏斗站在熔炉正下方取产物」。完整链条＝箱子（高于进料漏斗）→ 漏斗（朝熔炉）→ 熔炉 → 漏斗（在熔炉正下方、朝仓库）→ 仓库箱。
- **清理**：`onBlockSet`/`onBlockSetBatch` 只要新 id 不是熔炉家族就 `dropFurnaceAt`——删条目 + 三槽内容物按服务器权威散落成掉落；`Placement.breakFurnace` 在联机时**不再本地散落**（否则双份）。`tickFurnaces` 另有兜底：方块已不在账本里就删条目（防幽灵槽位），`restore` 后也按方块账本剪一遍。
- **边界**：每房间熔炉账本上限 `FURNACE_LIMIT=256`（跨维度合计；只在「打开熔炉」或「漏斗首次进料」时建条目，超限不再新建并给系统提示）。条目只对**方块账本里真实存在的熔炉**创建——凭空造账会覆盖结构 loot 的教训见 F-1。
- **方块 id 表**：`server/furnace.js` 的 `FURNACE_ID_INFO`（71/200/201/202 熄灭 + 203/204/205/206 点燃，各带朝向）是客户端注册顺序的镜像，由 `tests/furnace-unit.mjs` 逐 id 与 `BlockRegistry`/`furnaceLitId` 对拍。
- **已知限制**：① 分类器与矿车按计划不做；② 玩家本地视图与服务端的 last-write-wins 竞态（见上）；③ 物品飞出的粒子动画仍未做；④ 单机存档里的整炉内容不会随存档迁到联机账本（服务器只认自己的账本），进联机后需要重新放料。
- **测试**：`tests/furnace-unit.mjs`（112 断言：id 钉值/烧炼语义/大步长追赶有界/漏斗进出料路由/快照恢复/权威 tick 产出与点燃态切换/挖毁散落）与 `server/test-furnace.mjs`（18 断言：open 权威回执/改动按 by 广播/服务器产出恰好一份/点燃态方块/漏斗取产物送仓库/挖毁清理与散落）已入 `run-all-tests.sh`。

### B38 L1 · Tab 玩家列表的数据通道（player_state.rtt + 玩家名单）

- **延迟数据不是现成的**：既有 `rttMs` 只是**本端↔服务器**的往返（`PING/PONG` 每 2 秒），服务端从不把「某玩家的延迟」发给别人。L1 为此新开一条数据：`player_state` 增**可选** `rtt`（0~9999 整数，取 `netStats.rttMs` 四舍五入），服务端 `Room.onPlayerState` 用 `safeInt` 钳后存 `player.rtt` 并原样透传；`joinInfo()` 也带 `rtt`，新加入者不必等下一次 20Hz 包。
- **只在变化时附带**：客户端记 `_sentRtt`，取整后的值与上次相同就不带该字段——20Hz 下不会每包多十来个字节；未测得（`null`）时不带，服务器沿用上次值。
- **名单必须与远端实体解耦**：异维度玩家**没有远端实体**（`_addRemote` 在维度不符时早退），所以 Tab 列表不能遍历 `game.remotePlayers`。`NetworkManager._roster`（`id -> {name,mode,dim,rtt}`）是唯一数据源，写入点四处：`_queueOrAdd`（welcome / `player_join` 回放，含中途加入）、`player_state`、`player_dimension`、`player_leave`；本端不入表，由 `playerRoster()` 现算（dim 取 `this.dim`、rtt 取 `netStats`）。`RemotePlayer.setRtt` 仍保留——实体侧要用同一份数值时直接喂，别另开一条通道。
- **重连 = 服务器侧全新玩家对象**：`_connectSocket` 与 `WELCOME` 都清 `_roster` 并把 `_sentRtt` 归 null，否则重连后延迟再也不会重新上报（服务器那边的 `player.rtt` 已经没了）。
- **不升协议版本**：纯新增可选字段，旧端忽略未知字段，新端 `rtt == null` 显示「未测得」。
- **测试**：`server/test-mp.mjs` 补两条（同房间 `player_state` 透传 / 更晚加入者从 `player_join` 回放拿到 rtt）。**踩坑**：初版把断言挂在 B 身上，而 B 在脚本第 58 行就 `ws.close()` 了——这类「复用早期客户端」的断言必错，现改为新连的 J（收实时包）+ 更晚加入的 I（收回放）。


### B38 L2 · 服务器消息速率统计（/api/stats + 管理面板折线）

- **出向必须挂在 `Room.sendTo`**：房间流量的唯一漏斗（`broadcast` / `broadcastDim` 最终都走它）。挂在 `index.mjs` 的 `send()` 上会漏掉**所有**房间广播——那个函数只管握手/管理面板自己的发送。
- **入向先记再解析**：`ws.on('message')` 里在 `JSON.parse` 之前按 `raw.length` 记字节，畸形包同样占带宽，不该从统计里漏掉。
- **每秒一个点**：`roomStats.tick(Date.now(), roomIsActive)` 由 1s 定时器驱动，把这一秒的差值压成一个点、清桶、剪到 `STATS_POINTS=60`（定长环形，防无限增长）。总量 `totals` 不受裁剪影响。
- **空房即回收**：`roomIsActive(name)`（房间在内存 **且** `players.size > 0`）同时用于采样回收与 `/api/stats` 过滤——两处判据必须共用同一个函数，否则会出现「图有点但房间不在列表」。
- **在线人数是即时量**：路由里现读 `rooms.get(name).players.size`，**不要**存进采样（1 秒一次，刚进房的玩家会读到 0——首版就是这么写错的）。
- **边界**：只在内存，不进 `roomSnapshot`、不落盘，关服即丢；`GET /api/stats` 对 viewer 放行，非 GET 仍由统一规则 403。
- **面板**：`server/admin.html` 原生 canvas（无图表库），蓝线=消息/秒、橙线=字节/秒，**两条各按自身峰值归一**（量级差两个数量级，共用 Y 轴会让消息线贴在底边）；刷新时先拉 `/api/stats` 再 `renderRooms()`，`drawSparks()` 在 `renderRooms` 末尾被调（卡片是整段重绘的，画布每次都是新节点）。
- **测试**：`server/test-stage12.mjs`（22 断言：纯模块环形/脏值/回收 + 端到端计数与采样 + viewer 可读 + 空房消失），已入 `run-all-tests.sh` 的 server 清单。


### B38 L3 · 房间私聊与队伍分组

- **频道就是 `CHAT` 的可选字段**（`ch`/`to`），纯新增、不升 `PROTOCOL_VERSION`。兼容点只有一句：`msg.ch === 'team' || msg.ch === 'dm' ? msg.ch : 'room'`——旧端不带 `ch` 一律当房间频道，别改写成严格白名单的 else 分支（脏值会掉进未知频道）。
- **队伍是会话级内存**：`Room.teams: Map<队名, {leaderId, members:Set<id>}>` + `player.team`；不落盘、不进 `roomSnapshot`。`addPlayer` 里的 `p.team = null` 是唯一初始化点——重连 = 服务器侧新玩家对象 = 队伍自然清空。
- **队名即组队标识**：`TEAM_JOIN {team}` 加入同名队伍，不存在则以自己为队长新建（本批没有邀请制）。队长退出/退房 = 解散：把其余成员的 `p.team` 一并清空并发系统提示。`removePlayer` 里**必须在 `players.delete` 之前** `leaveTeam`，否则解散通知找不到成员。
- **上限 `TEAM_LIMIT=8`**：判 `members.size >= LIMIT` 要在 `members.add` 之前；自建分支 size 恒为 0，所以"满员"只可能发生在已有队伍上。拒绝时给系统提示，不静默。
- **分流口径**：`team` 只发队友**并含发送者回显**（否则自己看不到自己说的话，约等于消息丢了）；`dm` 发目标 + 发送者回显，目标不在线回系统提示（沿用 `sendTo(..., MSG.CHAT, { from: '系统', fromId: 0, ... })`）；`room` 保持原 `broadcast`。
- **限速**：`TEAM_JOIN/TEAM_LEAVE/TEAM_LIST` 在 `server/ratelimit.js` 的 `tierOf` 挂到 `chat` 档——每次组队操作都会向全房广播 `TEAMS`，不挂档会被刷。
- **客户端唯一命令解析点**：`Game._sendChatText()`（ChatBox 的 `onSend` 指向它）。**未识别的输入必须原样透传**——`/room` `/seed` `/rebuild` 等是服务端命令，客户端吞掉就等于砍掉既有功能。
- **面板数据不做冗余副本**：`NetworkManager.teamOf(id)` 从全量 `teams` 现算；`TEAMS` 到达且面板可见时立即 `render()`，否则等 250ms 节流重绘。
- **测试**：`server/test-stage12.mjs` 的 `[5]` 段（14 条）覆盖未组队提示与不外泄、`TEAMS` 广播、双人队伍、队伍/私聊分流、离线私聊提示、退队后收不到、队长退队解散、满 8 人后第 9 人被拒。

