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

- **挥动周期与挖掘进度联动**：`Game.handleMouseInput` 生存挖掘分支把 `hardness/speedMul`（实际挖穿秒数，钳 0.1~10）写入 `hand.miningPeriod`（再钳 0.25~1.0s），`FirstPersonHand` 自动挥动周期与挥速都用它（挥速 = 3.2×0.3/period，单次挥动时长≈周期）；放置/攻击/进食的单次 `swing()` 不受影响。`_miningActive` 在 `handleMouseInput` 入口统一复位、仅生存挖掘分支置 true（早退分支自然复位，勿在别处手动清）。
- **远端挖掘摆臂**：`player_state` 增 `mine`（0/1，服务器透传不进 joinInfo）；`RemotePlayer` 用 `_mineAmp`（目标 0/1，`dt*10` 平滑）+ `_minePhase`（`dt*21`≈0.3s 周期）驱动 armR 叠加摆动——勿直接写死 rotation（会丢行走摆臂叠加），respawn 复位三态。
- **头顶快捷栏 sprite（`src/render/RemoteHotbarSprite.js`）**：每实例独享 texture/material（**dispose 必须释放**，图标 Image 是模块级缓存不释放）；重绘节流靠内容/选中槽指纹比较（20Hz player_state 只做字符串比较）；图标解析链与 Hotbar 同口径（`itemSvgMap[name]` → `blockSvgMap[block.side||block.top]`），`svgToImage` 异步到位后**整幅补画**（onLoaded 回调 → `_redraw`）；全空快捷栏 `_empty` 隐藏；sprite y=+2.62（昵称 +2.3 之上）。**RemotePlayer 构造里 sprite 的 position 赋值必须放在 `_target` 初始化之后**（曾把 position.set 插在构造前段引用 undefined `_target`）。
- **白名单/Op 名单存 config.json**（`roomWhitelist`/`roomOps`，`sanitizeRoomNameMap`：≤32 房 × 16 名、trim 去重、非法整体丢弃）——勿搬到房间快照（管理面板实时改 + 与房间存档生命周期解耦）。入房拦截在 index.mjs 的 CREATE/JOIN_ROOM 前用**trimmed 房间名**查名单（名单 key 已 trim）；kicked 拒绝（客户端 `_explicitClose` 停自动重连）；switch_room 游戏内用聊天拒绝（与"房间已满"同款，不踢线）。`Room.isOperator()` = host 或昵称在 `roomOps[房间名]`，gamemode/set_time/world_reset 三处走它；拒绝**必须给系统聊天提示**（原为静默忽略）。
- **viewer 只读**：`authState` 返回 `{state, role}`（勿改回字符串——whoami/403 都依赖 role）；viewer 非 GET 一律 403 且**该检查必须在各路由前**；过期账号仍只放行 POST /api/config（与阶段6一致）。admin.html 靠 `body.viewer .card button { display:none }` 一条 CSS 隐藏全部写按钮（新增写操作自动被盖住，无需逐个加类）；白名单 textarea 回显会跳过 `document.activeElement` 聚焦中的框（防 3s 轮询打断编辑）。
- **netStats（`src/net/netStats.js` 纯函数）**：RTT EMA(0.8/0.2) + 抖动 = 相邻样本差绝对值的 EMA（**首样本无抖动**）；`targetInterpDelay = clamp(0.05 + rtt/2000 + jitter/4000, 0.05, 0.4)`——抖动权重是 RTT 的一半，别调大（局域网抖动 ms 级只作微调）；`RemotePlayer` 头余量欠载保护保留作 RTT 缺失时兜底；InfoBar 第 7 参 `rttJitterMs`（null=不显示 ±）。
- **测试非幂等 + 路径口径**：`test-stage11.mjs` 第 1 用例依赖"鉴权未开启"前提（重复跑批前必须清 `server/config.json`，收尾已把名单清空但**账号会遗留**导致鉴权开启）；`server/test-*.mjs` 的 `api()` 帮助函数以 `http://.../api` 为基底，**路径传 `/status` 不传 `/api/status`**（传全路径 = /api/api/... = 404 未知接口，曾真踩）。

### Idea-2B 关键实现备忘（防回退）—— 箭矢事件同步

- **事件式而非状态同步**（与怪物同步同款妥协）：`arrow_shot {id,x,y,z,dx,dy,dz}` 只传初速，各端本地确定性积分（重力 -12/寿命 8s 一致即视觉对齐）；`Room.onArrowShot` = 纯转发 except 发起者 + **broadcastDim 同维度**（异维端不收到）；不进方块/掉落账本（钉墙/消失各端本地处理）。
- **伤害射端权威**：`spawnRemoteArrow` 生成的箭带 `remote:true, dmg:0`，`_updateArrows` 命中怪分支 `if (!a.remote) attackMob(...)`——远端箭只 despawn 不结算；射端 `_releaseBow` 本地 spawn 后 `net.sendArrowShot(arrow.pos, arrow.vel)`（Vector3 引用即时序列化，无时序问题）。
- **服务器脏包校验必须先 typeof 再 isFinite**：`JSON.stringify(NaN)` 序列化成 **null**，`Number(null)=0` 会混过 `[...].map(Number).every(Number.isFinite)` 转换式校验（测试真踩：NaN 弹丸被静默放行为 x=0）；正确写法 `raw.every(v => typeof v === 'number' && Number.isFinite(v))`。
- **远端箭命中本地模拟的怪会即时消失**（设计行为）——冒烟时"没收到箭"先排除弹道撞怪再怀疑链路（曾误判丢包，ws.send 探针 + 复测定位）。
- **测试**：`server/test-idea2.mjs`（7/7，已入 run-all-tests.sh）：转发字段一致/携带射者 id/无回声/三类脏包（字符串、缺字段、NaN→null）全丢弃。

### Idea-2C 关键实现备忘（防回退）—— 潜影盒内容跟随物品

- **评审结论（"存档 V3 风险"解除）**：背包序列化 V2 本就带 `d`（data）字段、`Inventory.add(name,count,data)` 与 ChestScreen 游标早已支持 data、World/服务器容器账本 items 数组原样 JSON 序列化——**存档侧零改动**；真正要扩的只有掉落与容器两条协议 + 方块注册。
- **data 通道协议**：`drop_spawn`/`player_died.drops`/`container_set` 全部可选携带 data；服务器 `sanitizeItemData`（模块级）校验：≤27 槽、槽=null 或 {name,count}、**任一槽带嵌套 data（盒中盒）→ 整体拒绝降级普通物品**（all-or-nothing，勿改逐槽丢弃）；`Room.sanitizeStack` 同步扩展（曾只回 {name,count} 静默剥掉容器内盒子的 data）。服务器 drops 账本为会话内存（重启清空，与既有行为一致）。
- **客户端机制**：带 data 物品**不堆叠**（`Inventory.add` 堆叠条件加 `!s.data && !data`——漏了会串内容）；放置：`setContainer` 落账本 + 联机 `sendContainerSet` 整箱广播；破坏：`_breakShulkerBox` 内容不散落、单一掉落带 data（空盒 data=null），生存直入背包/创造与联机走实体掉落；`_blockDrops` 对 shulker_box 返回 []（防双掉落）；`onPickup(name,count,data)` 透传入包；容器 UI 复用 ChestScreen（分支条件扩 shulker_box）。
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
