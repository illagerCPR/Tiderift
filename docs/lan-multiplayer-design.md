# Tiderift 局域网联机设计文档

> 版本：v1.1（阶段 10 原阶段 8 的 LAN 增强清单已实现并通过验证）
> 状态：阶段 0（MVP）完成（2026-08-21）；阶段 1（掉落物/断线重连）完成（2026-08-22）；阶段 2（怪物事件同步 + 红石状态缓解）完成（2026-08-22）；阶段 3（多房间 + 世界落盘 + 玩家名着色）完成（2026-08-23）；阶段 4（插值优化 + 观战 + 服务器管理面板）完成（2026-08-23）；阶段 5（世界内换房/重建 + 时间戳对齐插值 + 管理面板鉴权）完成（2026-08-24）；阶段 6（手持物品外观同步 + 玩家死亡掉落物 + 观战视角平滑 + 鉴权增强 + 自适应插值延迟）完成（2026-08-25）；阶段 7（4 种怪物建模优化：法线光照 + 方形皮肤 + 细节纹理 + 模型细化）完成（2026-08-27）；阶段 8（怪物朝向修复 + 原版化贴图 + 天空盒修复）完成（2026-09-01）；阶段 9（方块材质重绘贴近原版 + 发光区块重建崩溃修复）完成（2026-09-01）；阶段 10（手持物品 3D 化 + 完整快捷栏同步 + 掉落归属锁 + 管理多账号/token 轮换 + RTT 直测）完成（2026-09-01）
> 阶段 0 新增：`server/`（index/room/protocol）、`src/net/NetworkManager.js`、`src/entity/RemotePlayer.js`、`src/ui/ChatBox.js`
> 阶段 0 改动：`World.js`（setBlock 上报钩子）、`Game.js`（联机集成）、`MobManager.js`（spawnEnabled）、`MenuScreen.js`/`main.js`（联机入口）、`start.cmd`（server 子命令）
> 阶段 0 验证：`server/test-mp.mjs` 协议 13/13 PASS；浏览器 host + Node 客户端双端链路验证通过
> 阶段 1 新增能力：掉落物生成/拾取/过期同步（`drop_spawn`/`drop_taken`）、服务器掉落物账本、断线指数退避自动重连（原位续玩不重启）、玩家离开广播带昵称、首次加入方块/掉落物账本回放缓冲修复
> 阶段 1 验证：`server/test-mp.mjs` 协议 19/19 PASS；浏览器 host + Node 客户端掉落物全链路（生成→广播→拾取→移除）+ 两轮服务器宕机/重启断线重连验证通过
> 阶段 2 新增能力（怪物**方案①事件同步** + 红石缓解）：host 端权威生成怪物 → `mob_spawn` 广播各端创建；`mob_attack` 广播受击扣血 + 位置校正（减少 AI 漂移）；`mob_died` 广播死亡（掉落物由击杀端产出）；`redstone_state` 低频广播 lever/button 状态对齐各端红石网络；`world_info` 携带 `hostId`（客户端据 `isHost` 决定是否自然生成）
> 阶段 2 验证：`server/test-mp.mjs` 协议 23/23 PASS；浏览器 host + Node 客户端怪物全链路（host 自然生成广播→远端创建、远端攻击扣血、死亡广播→各端移除）
> 阶段 3 新增能力（服务器能力增强）：**多房间**（同名房间共享同一世界，世界按房间名隔离；`welcome` 不再带玩家列表，进房后由 `joinRoom` 回放已有玩家）；**世界落盘**（`server/world/<房间名>.json`，方块/掉落物/种子/时间/计数器随变更保存，服务器重启后同名房间自动恢复，过期掉落物不恢复）；**换房/新建世界**（主菜单「房间名」决定进哪个世界，新房间名=新世界，游戏内 `/rooms` `/seed` 命令查看）；**玩家名着色**（昵称标签/聊天/进出提示按玩家 id 稳定配色，新增 `src/net/playerColor.js`）
> 阶段 3 验证：`server/test-mp.mjs` 协议 **34/34 PASS**（新增多房间隔离/自动建房/命令断言）+ `server/test-store.mjs` 落盘往返 **15/15 PASS** + 服务器重启后同名房间世界恢复 e2e **4/4 PASS** + 浏览器双端冒烟（开房/加入/着色）通过
> 阶段 4 新增能力（体验与管理）：**远端玩家插值优化**（`RemotePlayer` 重构为关节模型：速度自适应平滑 + 远距瞬移快照（防 respawn/传送"飞天滑行"）+ 行走摆动动画 + 头部俯仰，`pitch` 现已随 `player_state` 透传并应用）；**观战**（死亡屏新增「观战其他玩家」→ 旁观模式穿墙自由飞行，相机第一人称跟随房间内存活玩家，F5 循环切换目标、R 重生恢复原模式，观战不上报本地位置）；**服务器管理面板**（`http://<host>:3001/` Web 页 + `/api/*`：状态总览/配置读写（`dropTtlMs`/`heartbeatMs`/`maxPlayersPerRoom`，落盘 `server/config.json`）/系统广播/踢出玩家（新协议 `kicked`，客户端停止自动重连）/清空掉落物/删除房间重置世界；新增 `server/config.js` + `server/admin.html`）
> 阶段 4 验证：`server/test-mp.mjs` 协议 **34/34 PASS** + `server/test-store.mjs` **15/15 PASS** + 新增 `server/test-admin.mjs` 管理面板回归 **18/18 PASS**（人数上限/踢出/清掉落物/删房重建/配置非法值过滤/广播）+ 浏览器冒烟（行走动画 joints 生效、观战相机跟随+目标切换+重生、管理面板渲染+踢出后不自动重连）通过
> 阶段 5 新增能力（体验/流畅/安全）：**世界内换房/重建世界**（联机中 `/room <名>` 直接切换房间、`/rebuild` 重建当前世界（仅 host），保持 WebSocket 连接、客户端用新 seed 重启本地世界，新增协议 `switch_room`/`world_reset` 与 `world_info.restart` 标记）；**时间戳对齐插值**（`player_state` 广播带服务器 `ts`，`RemotePlayer` 改为样本缓冲 + 时钟偏移估计 + 固定 120ms 延迟的线性插值重放，消除指数平滑的拖影/橡皮筋，观战视角随之更稳）；**管理面板鉴权**（配置新增 `adminToken`，开启后 `/api/*` 须带 `Authorization: Bearer <token>`，`admin.html` 增加登录弹层与口令设置项，token 明文不随接口返回）
> 阶段 5 验证：`server/test-mp.mjs` 协议 **34/34 PASS** + `server/test-store.mjs` **15/15 PASS** + `server/test-admin.mjs` 管理面板回归 **26/26 PASS**（新增鉴权 8 项）+ 新增 `server/test-stage5.mjs` 换房/重建/时间戳回归 **16/16 PASS** + 浏览器冒烟（双端进房、换房后 host 变新房 host 且连接不断、`/rebuild` 种子变化、远端时间戳插值平滑跟随、管理面板登录弹层与口令校验）通过
> 阶段 6 新增能力（体验/安全/流畅）：**手持物品外观同步**（`player_state`/`player_full` 广播 `selected`+`held`，`RemotePlayer` 右臂挂 sprite 渲染手持物，修复左右臂/腿 role 重复导致摆臂从未生效的潜在 bug）；**玩家死亡掉落物**（死亡时客户端上报背包 → 服务器生成世界掉落物 `drop_spawn` 广播，各端可见可拾取；死亡清空背包、重生重发生存初始物品）；**观战视角平滑**（观战相机对目标位置/朝向做帧率无关指数平滑，切换目标/瞬移不跳变）；**管理面板鉴权增强**（`adminTokenExpires` 口令过期——到期后除 `POST /api/config` 续期外全部 401；操作日志内存环形缓冲 + `/api/logs`，记录配置/广播/踢人/清掉落物/删房/未授权访问；面板登录会话 TTL 与过期续期横幅）；**时间戳插值自适应延迟**（按缓冲"头余量"动态调插值延迟 0.05~0.4s，网络抖动大自动加大延迟吸收、干净时自动降低减少滞后）
> 阶段 6 验证：`server/test-mp.mjs` 协议 **34/34 PASS** + `server/test-store.mjs` **15/15 PASS** + `server/test-admin.mjs` **26/26 PASS** + `server/test-stage5.mjs` **16/16 PASS** + 新增 `server/test-stage6.mjs` 手持/死亡掉落/鉴权过期与日志 **20/20 PASS** + 浏览器双端冒烟（手持物切换渲染、死亡掉落全链路（死亡屏→掉落→清背包→重生重发）、观战平滑跟随、管理面板登录弹层 + `/api/logs` + 口令过期 401/横幅 + UI 续期）通过
> 开发中发现并修复：①服务器心跳误用协议层 pong（应用层 JSON ping 需客户端回 JSON pong，否则 30s 踢出）；②`set_time/time` 时间字段与消息类型键 `t` 冲突（改为 `time` 字段）；③方块同步需统一挂 `World.setBlock` 钩子（`bindWorld`）而非散点手动上报，保证爆炸/活塞也同步；④首次加入时 `world_info` 后紧接的方块/掉落物账本回放可能先于世界就绪到达而被丢弃——增加 `_ready` 预就绪缓冲队列；⑤重连关闭旧 socket 时旧 onclose 会误触发重连调度——用 `this.ws !== ws` 守卫只处理当前 socket；⑥`start.cmd server` 子进程继承 `PORT=5173` 误占用 Vite 端口——`:server` 分支启动前 `set "PORT="`；⑦多房间化后 `welcome` 无法携带玩家列表（hello 时尚未进房）——改为 `joinRoom` 回放已有玩家，且磁盘恢复的房间无 host 时由首个加入者接管；⑧`store.saveRoom` 序列化掉落物时漏掉 `id` 字段导致恢复被丢弃——改为 `[...drops.entries()]` 携带 id；⑨观战若在 update() 早期 `return` 会冻结怪物/红石/区块——改为只 gate 玩家移动/物理段（`specTarget` 分支），世界模拟照常跑；⑩被踢出的玩家若沿用断线自动重连会立刻回房——新增 `kicked` 消息置 `_explicitClose`，客户端停止自动重连；⑪`RemotePlayer` PARTS 中左右臂/腿 `role` 重复为 `'arm'`/`'leg'`（后者覆盖前者），`joints.armL/armR/legL/legR` 实际不存在——行走摆臂从未生效、阶段 6 手持 sprite 也挂不上右臂——拆分为 `armL/armR/legL/legR` 独立 role；⑫服务器回归测试对"复用同一 live 服务器"**非幂等**（遗留 `server/world/*.json` 与 `config.json` 中的 adminToken 会污染下一轮跑批：test-mp 的 block_change `by=` 断言会被账本回放干扰、test-admin 鉴权用例中途崩溃遗留口令）——跑批前清空 `server/world/` 与 `server/config.json`（或重启服务器），保证全新状态；⑬怪物渲染"同色纸片"根因（阶段 7 发现）：`MobManager.buildMaterials` 合并的 cuboid BufferGeometry **从未生成法线**（无 normal attribute → three.js 不绑定 → WebGL 默认 (0,0,0)）→ Lambert 材质 `max(dot(N,L),0)=0`，太阳光对怪物零贡献、只吃环境光 → 全表面同色无明暗。且 FACE_DEFS 每个面的两个三角形**绕序相反**（一个外法线朝外、一个朝内），直接 `computeVertexNormals` 会平均成 ~0。修复：索引绕序统一为 `(0,1,2)(1,3,2)`（不改 UV）+ `geo.computeVertexNormals()`（每面顶点不共享 → 平坦面法线 → 方向光明暗生效）

---

## 1. 目标与范围

### 1.1 目标

在现有单机 CubeWorld（Vite 5 + Three.js 0.160 纯前端 Minecraft 风格游戏）上增加**局域网多人联机**能力：

- 多台局域网电脑（或同一台电脑多个浏览器标签）同时进入同一个世界。
- 玩家之间互相可见、可移动、可共建/破坏方块。
- 玩家状态（生命/食物/模式/手持物品/死亡重生）互相可见并可交互。
- 聊天与昼夜时间同步。

### 1.2 本期范围（阶段 0 MVP）

- [x] 独立 Node 房间服务器（`server/`）。
- [x] 方块修改的跨端同步（建造/破坏/TNT 爆炸）。
- [x] 远端玩家实体渲染与平滑移动。
- [x] 玩家状态全量/增量同步（健康、食物、模式、手持物品）。
- [x] 死亡/重生广播与互殴（玩家伤害玩家）。
- [x] 昼夜时间同步。
- [x] 聊天。
- [ ] 怪物同步（**明确本期不做**，见 §9）。
- [ ] 红石状态细同步（各端独立收敛，见 §9.3）。

### 1.3 非目标

- 互联网公网联机（不做 NAT 穿透 / 中继服务器）。
- 反作弊 / 权限体系（局域网信任环境）。
- 服务器权威物理（见 §3 架构取舍）。
- 无缝大世界流式（沿用现有渲染距离 6 区块的按需加载）。

---

## 2. 现状架构与关键约束

### 2.1 架构现状

| 层 | 现状 | 对联机的影响 |
|---|---|---|
| 入口 | `src/main.js` 创建单个 `Game` 实例，`window.game` 全局暴露 | 网络层可从这里挂载 |
| 主循环 | `Game.update(dt)` 每帧驱动物理/怪物/红石/方块/UI | 物理与 AI 全在浏览器端 |
| 世界 | `World` 用 `Map` 存 chunk，方块存 `Uint8Array` | **确定性生成**，见下 |
| 地形 | `TerrainGenerator(seed)`：SimplexNoise + LCG 伪随机（`generateStructures` 的 `rand()`），全流程**无 `Math.random`** | **同 seed 各端生成完全一致的地形**——联机无需传输地形 |
| 方块写入 | 唯一入口 `World.setBlock()`，同时维护 `this.modifiedBlocks`（`"x,y,z" -> id` 增量表） | **天然的网络广播 hook 点**，增量表即传输格式 |
| 存档 | localStorage 多槽位：`seed + modifiedBlocks + player + redstone + sky` | 多人下需改保存策略（§8） |
| 怪物 | `MobManager` 浏览器端运行 AI/受击/掉落，`Mob.js` AI 不依赖 DOM 但耦合 `world/physics` | 怪物同步最重，本期不做（§9） |
| 玩家模型 | 无玩家第三人称模型；`MobTextures.js` 有 `HUMANOID_PARTS`（zombie/skeleton 共用）可复用 | 远端玩家模型可复用 box-parts 方案 |

### 2.2 三个可利用的"架构红利"

1. **确定性世界生成** → 客户端只需拿到 `seed` 即可本地生成世界，网络只同步"修改增量"。
2. **`setBlock` 唯一写入入口** → 只要在 `World.setBlock` 挂一个回调，即可截获所有方块变更（含挖掘/放置/活塞/TNT）。
3. **`modifiedBlocks` 现成增量格式** → 与网络消息格式天然一致，`"x,y,z" -> id`。

### 2.3 必须绕开的坑

- 浏览器端无法监听 TCP 端口 → 房间主机必须是独立 Node 进程。
- `Game.update()` 中物理/AI/红石与 DOM、Three.js 渲染紧耦合 → **不要把核心逻辑搬到服务器**（方案 A 否决，见 §3）。
- `World.setBlock` 会被"远端落地方案"再次触发 → 必须区分"本地发起"与"远端落地"，避免回环重发（§6.2）。

---

## 3. 总体架构：轻量主机 + 各端自跑

### 3.1 方案对比（选型记录）

| 方案 | 思路 | 结论 |
|---|---|---|
| A. 权威服务器 | 世界/物理/AI 全在 Node，客户端只发输入 | 否决：`Game.update()` 与 DOM/Three 紧耦合，等价于把核心逻辑重写一遍到服务端，工作量与风险最大 |
| B. WebRTC P2P | 浏览器直连，无服务器 | 否决：信令握手/仲裁麻烦，且仍需要一个协调节点，对局域网收益低 |
| **C. 轻量主机 + 各端自跑（选用）** | Node 服务器做**房间管理 + 方块仲裁 + 玩家中继**；各客户端**同 seed 自行生成世界、自跑本地物理/AI**，只同步增量 | 改动可控、可渐进，符合本期目标 |

### 3.2 职责划分

```
                    ┌─────────────────────────────┐
                    │   Node 房间服务器 (server/)  │
                    │  · 房间/玩家管理             │
                    │  · seed 唯一来源（host 决定） │
                    │  · modifiedBlocks 主副本     │
                    │  · 方块修改仲裁(last-write)   │
                    │  · 消息广播/转发             │
                    │  · 昼夜时间权威              │
                    └──────────────┬──────────────┘
                     WebSocket  /ws (ws://主机IP:3001)
          ┌───────────────────────┴────────────────────────┐
          ▼                                                  ▼
   ┌───────────────┐                                  ┌───────────────┐
   │  客户端 A      │                                  │  客户端 B      │
   │  Game 实例     │                                  │  Game 实例     │
   │  · 本地生成世界 │       同 seed，各自生成          │  · 本地生成世界 │
   │  · 本地物理     │◄──── 地形完全一致 ────►          │  · 本地物理     │
   │  · 本地怪物AI   │   （本期关闭生成）               │  · 本地怪物AI   │
   │  · 方块修改→上报│                                  │  · 方块修改→上报│
   │  · 渲染远端玩家 │                                  │  · 渲染远端玩家 │
   └───────────────┘                                  └───────────────┘
```

关键原则：**服务器不是游戏权威，只是"方块账本 + 广播总线"**。每个客户端对本地世界完全自洽（能单机运行），联机只是把"本地产生的外部可见状态"上送并接收"别人产生的状态"。

### 3.3 为什么这个模型可行

- 方块：客户端本地 `setBlock` → 上报服务器 → 服务器更新主副本 → 广播 `block_change` → 其他客户端在本地 `setBlock` 落地并触发网格重建/红石。由于各端地形一致，同一坐标的方块修改在任意端产生相同的渲染结果。
- 玩家：各端本地物理（确定性+本地输入），位置/朝向按 20Hz 上报，远端用插值平滑（§7）。
- 怪物：本期直接不生成（见 §9），避免各端 AI 漂移造成"打空气"。

---

## 4. 主机模型与网络拓扑

### 4.1 运行形态

- **服务器**：`server/index.mjs`，原生 `node:http` + `ws` 依赖，监听 `0.0.0.0:3001`（端口可配）。
- **客户端**：普通浏览器页面（Vite dev `5173` 或 `npm run build` 产物）。
- **拓扑**：星型，所有客户端 WebSocket 直连服务器，不点对点。

### 4.2 启动流程

1. 开房者启动服务器：`node server/index.mjs`（或用扩展后的 `start.cmd server`）。
2. 开房者在页面"局域网联机"面板点击**创建房间** → 客户端连接 `ws://<本机IP>:3001`，发送 `create_room`（带 seed、模式、昵称）。
3. 其他玩家在页面输入 `ws://<开房机IP>:3001` → 发送 `join_room` → 服务器返回 `world_info`（含 seed）→ 客户端用该 seed 本地生成世界并进入游戏。
4. 服务器广播玩家进出，各端渲染远端玩家。

### 4.3 Windows 防火墙

- 监听端口需放行（Node 首次监听会弹防火墙授权，或手动 `netsh advfirewall` 放行 TCP 3001）。
- 客户端通过 `http://<开房机IP>:5173`（dev）或部署地址访问页面，**服务器 IP 与页面 IP 通常相同**（都在开房机）。

---

## 5. 通信协议设计

### 5.1 传输

- WebSocket 文本帧，JSON 消息。
- 消息统一为 `{ t: '<type>', ...fields }`，`t` 为类型。
- 连接建立即发送 `hello`，服务器回 `welcome`，随后进入房间流程。

### 5.2 客户端 → 服务器（C2S）

| `t` | 字段 | 说明 |
|---|---|---|
| `hello` | `name, version` | 连接握手，登记昵称 |
| `create_room` | `name, seed, mode, room?` | 开房：决定世界 seed（唯一来源）；`room` 指定房间名（缺省 `default`） |
| `join_room` | `room?` | 加入指定房间（同名房间共享同一世界；房间不存在则自动创建并随机 seed，首个加入者成为 host） |
| `leave_room` | — | 主动退出 |
| `switch_room` | `room` | 阶段5：世界内换房（保持连接，客户端用新 seed 重启本地世界；房间不存在自动创建，首个加入者成 host） |
| `world_reset` | — | 阶段5：重建当前房间世界（仅 host 采纳；新 seed + 清空方块/掉落，广播 `world_info(restart)`） |
| `block_set` | `x, y, z, id` | 客户端请求修改方块（含挖掘/放置/爆炸产物） |
| `drop_spawn` | `x, y, z, name, count` | 请求生成掉落物（服务器分配 id 并广播回执） |
| `drop_taken` | `id` | 拾取掉落物（从账本删除并广播） |
| `mob_spawn` | `type, x, y, z` | host 请求生成怪物（服务器分配 id 并广播回执） |
| `mob_attack` | `id, damage, x, y, z` | 玩家攻击怪物（x,y,z 供位置校正） |
| `mob_died` | `id` | 怪物死亡（掉落物由击杀端产出） |
| `redstone_state` | `x, y, z, on` | 红石源状态变化（lever/button 低频广播） |
| `player_state` | `x,y,z,yaw,pitch,onGround,flying,inWater,selected` | 高频状态（20Hz） |
| `player_full` | `health,food,saturation,mode,slot,inventory?` | 低频全量（加入时/变更时/重生后） |
| `attack_player` | `targetId, damage` | 玩家攻击玩家 |
| `player_died` | — | 本地玩家死亡（服务器广播，供他人 UI） |
| `respawn` | — | 重生请求 |
| `gamemode` | `mode` | 切换模式（host 才被采纳） |
| `chat` | `text` | 聊天消息 |
| `set_time` | `t` | host 专用：设定昼夜时间 |
| `ping` | `seq` | 心跳/延迟测量 |

### 5.3 服务器 → 客户端（S2C）

| `t` | 字段 | 说明 |
|---|---|---|
| `welcome` | `selfId, players: []` | 握手回执（**players 恒为空**：hello 时尚未进房，进房后由 `joinRoom` 回放已有玩家） |
| `world_info` | `seed, mode, time, hostId, room, restart?` | 客户端据此生成世界（进入房间后下发）；`room` 为房间名；`restart=true`（阶段5）表示换房/重建：客户端保持连接用新 seed 重启本地世界 |
| `room_created` | `roomId` | 开房确认 |
| `player_join` | `id, name, pos, mode` | 新玩家进入 |
| `player_leave` | `id` | 玩家离开 |
| `block_change` | `x,y,z,id,by` | 仲裁后的方块修改广播（**服务器唯一权威**） |
| `drop_spawn` | `id, x,y,z,name,count` | 掉落物生成广播（含发起者，各端创建同一实体） |
| `drop_taken` | `id, by` | 掉落物拾取/过期移除广播（by=0 为过期自然消失） |
| `mob_spawn` | `id, type, x,y,z` | 怪物生成广播（host 权威，各端创建同一实体） |
| `mob_attack` | `id, fromId, damage, x,y,z` | 怪物受击广播（except 发起者，含位置校正） |
| `mob_died` | `id` | 怪物死亡广播（except 发起者） |
| `redstone_state` | `x,y,z,on,by` | 红石源状态广播（except 发起者） |
| `player_state` | `id, ...(同 C2S 字段), ts` | 转发某玩家高频状态；`ts`（阶段5）为服务器时间戳（毫秒），客户端据此做时间对齐插值 |
| `player_full` | `id, ...(同 C2S 字段)` | 转发某玩家低频全量 |
| `player_died` | `id` | 某玩家死亡 |
| `respawn` | `id, x,y,z,health,food` | 某玩家重生位置 |
| `attack_player` | `fromId, targetId, damage` | 玩家互殴伤害广播 |
| `gamemode` | `id, mode` | 玩家模式变更 |
| `chat` | `from, text` | 聊天广播 |
| `time` | `t` | 昼夜时间广播（host 每 ~5s + 变更时） |
| `pong` | `seq` | 心跳回执 |
| `kicked` | `reason` | 服务器管理面板踢出（客户端置 `_explicitClose` 停止自动重连，返回主菜单） |

### 5.4 编号与来源

- `selfId` 由服务器分配（递增整数），客户端用它区分"自己 vs 远端"。
- 所有 S2C 消息带 `id` 表示来源玩家；客户端对 `id === selfId` 的消息一般忽略（自己已经本地应用过），`block_change` 除外（用于冲突校正）。

---

## 6. 客户端改造详细设计

### 6.1 `src/net/NetworkManager.js`（新增）

职责：连接管理、消息编解码、事件分发、心跳。

```
class NetworkManager {
  constructor(game)                    // 绑定 Game，但不要求在构造时已 start
  connect(url, name)                   // 建立 ws，注册 onopen/onmessage/onclose
  on(type, handler) / emit(type, data) // 内部事件总线
  send(type, data)                     // 序列化发送
  _handle(msg)                         // 消息路由：block_change / player_* / chat / time ...
  isConnected() / selfId
  sendState(player, lowFreq=false)     // 打包 player_state / player_full
  sendBlock(x,y,z,id)                  // 本地发起方块修改上报
  applyRemoteBlock(x,y,z,id)           // 远端落地（见 §6.2 防回环）
  close()
}
```

关键点：
- 高频 `player_state` 节流 50ms（20Hz），`player_full` 只在变更时发。
- 断线重连：指数退避重试（1s→15s 封顶，8 次）+ 提示"已断开/重连中"；重连成功重新 `hello`+`join_room`，由于世界已就绪（`_ready`），`world_info` 走"续玩分支"（不重启，仅同步时间/模式 + 账本回放纠正）。主动 `close()` 不重连。
- 消息容错：未知类型忽略；字段缺失按 0 处理，不让远端脏包崩游戏。
- 首次加入缓冲：`world_info` 与账本回放之间世界未就绪，`block_change`/`drop_*` 先入 `_pending*` 队列，`onWorldStarted()` 后统一落地。

### 6.2 `World.setBlock` 挂钩与防回环

```js
// World.js 增加
this.onLocalBlockChange = null; // 本地发起回调 (x,y,z,id) => void，由 NetworkManager 注册

setBlock(gx, gy, gz, id, recordMod = true) {
  // ...原有逻辑不变...
  if (this.onLocalBlockChange) this.onLocalBlockChange(gx, gy, gz, id);
}
```

**防回环**：`NetworkManager.applyRemoteBlock(x,y,z,id)` 内部：
```js
this._applyingRemote = true;
game.world.setBlock(x, y, z, id);
this._applyingRemote = false;
```
`onLocalBlockChange` 中判断 `if (this._applyingRemote) return;` —— 远端落地方案**只重建网格/红石，不再上报**，杜绝"广播回来又发回去"的无限回环。

同时：远端 `block_change` 落地时**跳过写入 `modifiedBlocks`**（联机模式下 `modifiedBlocks` 只存本地发起项，见 §8），或统一以服务器账本为准。

### 6.3 `src/player/Game.js` 改造点

| 位置 | 改动 |
|---|---|
| `constructor` | 创建 `this.remotePlayers = new Map()`；`this.net = null` |
| `start()` | 若 `net.connect` 已建立：**跳过本地怪物生成**（`mobManager.update` 中 spawn 分支关闭）、加载远端玩家全量、注册 `net.on('block_change', ...)` 等回调 |
| `update()` | 网络模式下每 50ms 上报 `player_state`；每帧更新 `remotePlayers`（插值） |
| `handleMouseInput()` | `setBlock` 分支（挖掘/放置/爆炸）在本地应用后调用 `net.sendBlock(...)` |
| `Player.hurt` / 互殴 | 联机模式下：攻击命中远端玩家 → `net.send('attack_player', {targetId, damage})`；被攻击 → 显示受击红闪/扣血 |
| 死亡/重生 | `deathScreen` 显示时发 `player_died`；`respawn()` 后发 `respawn` |
| 自动保存 | 联机模式下关闭（或降频），保存逻辑交给开房者（§8） |
| `returnToMenu()` | `net.close()`；清空 `remotePlayers` |

### 6.4 `src/entity/RemotePlayer.js`（新增）

远端玩家渲染实体，复用 `MobTextures.js` 的 box-parts 思路：

```
class RemotePlayer {
  constructor(scene, id, name)
  // 模型：复用 HUMANOID_PARTS 的部件拼接逻辑（可抽公共函数），
  //       或用简化方块人（头/身/四肢），皮肤用玩家名下发的颜色。
  // 状态缓冲：ring buffer 存最近 ~5 帧 {x,y,z,yaw,pitch,onGround,...}
  // update(dt)：对目标位置做指数插值（smooth = 1 - exp(-dt*10)），yaw 走最短角插值
  applyState(st) / applyFull(st)
  showNameTag()            // THREE.Sprite 显示昵称（可选）
  setMode(mode)            // 飞行/游泳/蹲伏姿态切换
  dispose()                // 释放 mesh/material（进 _disposeWorld 流程）
}
```

- 模型复用 `HUMANOID_PARTS`（`MobTextures.js:195`），皮肤可用单色材质 + 玩家颜色区分。
- 位置用插值而非直接 set：避免远端玩家"瞬移/抖动"。

### 6.5 `src/ui/MenuScreen.js` + `src/main.js`

- MenuScreen 增加"局域网联机"区块：
  - 创建房间：昵称 + 模式 + seed（留空随机）→ `net.connect('ws://<默认>', name)` + `create_room`。
  - 加入房间：昵称 + 服务器地址 → `net.connect(url, name)` + `join_room`。
- `main.js`：创建 `NetworkManager`，注入 `MenuScreen` 回调链，进游戏后由 `Game.start` 接管。

### 6.6 触发"本地修改 → 上报"的完整路径核对

挖掘：`Game.handleMouseInput` → `world.setBlock(..., 0)` → `onLocalBlockChange` → `net.sendBlock` ✓
放置：同上 → `world.setBlock(..., blockDef.id)` → 上报 ✓
TNT/爆炸：`MobManager.processExplosions` → `world.setBlock(..., 0)` → 上报 ✓（本端已生成爆炸的端会上报，未生成爆炸的端只收广播落地）
活塞：`RedstoneSystem` 推方块 → `world.setBlock` → 上报 ✓
红石拉杆/按钮：改方块 → 上报 ✓（状态漂移见 §9.3）

---

## 7. 同步策略细节

### 7.1 方块（核心，必然一致性）

- **仲裁**：服务器 `modifiedBlocks` 主副本 `Map<"x,y,z", id>`；收到 `block_set` 直接覆盖并广播 `block_change`（**last-write-wins**）。
- **收敛**：发送方本地已预测应用；若被后到消息覆盖，会收到新的 `block_change` 再覆盖回来。局域网 RTT < 5ms，冲突窗口极小。
- **记录**：`World.setBlock` 的 `recordMod` 在联机模式下对远端落地跳过，保证本地 `modifiedBlocks` 不混入远端改动导致存档膨胀/漂移。

### 7.2 玩家

- 高频 `player_state`（20Hz）：位置/朝向/姿态布尔 + 服务器 `ts` + `selected`/`held`（阶段6 手持物品）。远端插值。
- 阶段 4 插值细节（`RemotePlayer`）：关节模型（head/armL/armR/legL/legR pivot）+ 远距瞬移快照（>4 格直接 set 并丢弃旧样本）+ 行走摆动动画（水平速度驱动腿/手臂 pivot）+ 头部俯仰（`pitch` 透传应用）。
- 阶段 5 时间戳对齐插值（`RemotePlayer.applyState/update`）：收到带 `ts` 的状态压入样本缓冲（上限 40）；平滑估计时钟偏移 `offset = ts - now`（首样本直接采用，之后 0.9/0.1 递推）；每帧渲染时刻 `renderTime = now + offset - delay`，取缓冲中包围 `renderTime` 的两个样本做线性插值（位置直插、yaw 最短角、pitch 直插），速度由当前段位移/时间得出驱动走路动画；`renderTime` 晚于最新样本时停在最后两样本（f 钳到 1，静止停靠），早于最旧样本时停在首样本——**b 恒取 `buf[i+1]` 且 i 钳到 `len-2`**，防止越界崩溃（曾引发整条游戏主循环停摆）。
- 阶段 6 自适应插值延迟：`delay` 不再固定 120ms，按缓冲"头余量 = 最新样本 ts − 渲染时刻"动态调整（<0.03s → `+0.004` 加大吸收抖动；>0.22s → `-0.002` 降低减少滞后；钳制 0.05~0.4s）。干净网络稳定在 ~0.12s，抖动越大延迟自动抬升避免欠载（渲染时刻被钳到最新样本 = 零插值仍可用）。
- 低频 `player_full`：健康/食物/模式/手持物品槽位 + `held`（变更触发）。
- 互殴：`attack_player` 广播扣血 + 受击反馈；死亡/重生走独立消息。
- 手持物品（阶段6）：客户端 `player_state` 携带 `selected`（槽位）+ `held`（物品名），服务器随广播透传；`RemotePlayer` 按 `held` 变化把物品/方块 SVG 渲染成 sprite 挂在右臂 `armR.pivot` 末端（异步重建带序号防竞态），空手/换持实时切换。
- 玩家死亡掉落物（阶段6）：客户端本地检测死亡时 `player_died` 上报死亡位置 + 背包物品列表；服务器广播 `player_died`（其它端隐藏尸体）并逐一生成世界掉落物 `drop_spawn`（带微小确定性偏移，进账本持久化，各端可见可拾取）；同一次死亡去重（`_diedDrops`，重生时复位）；死亡端清空背包，重生重发生存初始物品。

### 7.3 昼夜时间

- 服务器持有 `time` 权威值；host 每 ~5 秒 + 每次 `set_time` 广播 `time`。
- 客户端收到后 `sky.time = msg.t`（只覆盖不追帧，避免频繁抖动）。

### 7.4 聊天

- `chat` 广播，HUD 底部滚动区显示 `[name] text`。`player_join/leave` 也生成系统提示。

---

## 8. 存档与联机策略

- **原则**：房间开房者负责世界持久化；其他客户端不保存多人世界。
- **实现**：
  - 服务器保留 `modifiedBlocks` 主副本于内存；可选落盘 `server/world/<room>.json`（阶段 3）。
  - 开房者客户端仍可用现有 `SaveSystem` 保存（其本地 `modifiedBlocks` 即自己+远端增量，见 6.2 处理），**不建议**其他客户端自动保存。
  - `Game.update` 中 `autoSave` 在联机模式关闭；F5 手动保存仅开房者有效（或全部禁用，避免互相覆盖槽位）。
- 进入房间时客户端**不回读**本地存档的地形增量——以服务器 `block_change` 历史为准：服务器在 `join_room` 时把主副本全部 `block_change` 回放给新玩家（**加入世界即见现状**）。

---

## 9. 怪物与红石：本期取舍与后续方案

### 9.1 本期（阶段 0）：不生成怪物

- 联机模式下 `MobManager.trySpawn` 直接 return（保留本地单机功能不变）。
- 好处：避开"各端 AI 漂移 → 打空气/双份怪"这一最大一致性难题，让 MVP 聚焦方块与玩家。

### 9.2 后续怪物同步三方案（阶段 2 决策）

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| ① 事件同步 | 各端独立跑 AI，只同步生成/受击/死亡/掉落 | 改动小 | 位置漂移，观感差 |
| ② 主机权威怪物流 | 把 `Mob.js` AI 抽成不依赖 DOM 的共享模块（`Mob` 只依赖 `world/physics`，抽离可行性高），服务器跑怪物流，客户端只渲染 | 一致性好 | 需做服务器端 AI 循环 + 快照同步，工作量 +300 行左右 |
| ③ 关怪 | 局域网玩纯建造 | 零成本 | 无打怪玩法 |

> **选型结论（已实施：方案①事件同步）**：实际代码评估中方案②的真实成本远超预估——`MobTypes` 依赖浏览器渲染模块（`SVGTextures`）、`World` 含 THREE 残留，抽离共享世界 + 服务器 AI 循环 + 快照同步约为方案①两倍工作量且确定性一致性风险高。方案①契合"轻量主机 + 各端自跑"架构，配合**受击位置校正**（`mob_attack` 带攻击者端位置，其它端对齐）可把 AI 漂移控制在可接受范围，符合局域网信任场景。已知局限：非攻击致死（燃烧/掉虚空）各端可能各自产生掉落、远端怪可能因各端 DESPAWN_DISTANCE 差异而数量不完全一致，均接受。

### 9.3 红石状态（阶段 2+）

- 各端独立跑 `RedstoneSystem`：给定相同世界状态，红石网络会收敛到相同结果，**无需逐 tick 同步**。
- 风险：两台机器 tick 进度不同步 → 高频红石（快速闪烁灯）会闪断/漂移。
- 缓解：低频广播红石关键方块（lever/button/torch）状态，或接受轻微漂移（局域网信任场景可接受）。

---

## 10. 服务端设计（`server/`）

```
server/
  index.mjs        # 入口：node:http 监听 + ws upgrade，房间生命周期（RoomManager 多房间）+ /api 管理接口 + 管理页
  room.js          # Room 类：seed、players Map、modifiedBlocks 主副本、time、restore 恢复、踢人/清掉落物/info
  store.js         # 世界落盘：server/world/<房间名>.json 读写、房间名安全化
  config.js        # 服务器配置：默认值 + 校验 + 读写 server/config.json（阶段 4；阶段 5 增 adminToken；阶段 6 增 adminTokenExpires）
  admin.html       # 服务器管理面板页面（房间/玩家/配置/世界管理，阶段 4；阶段 5 增登录弹层；阶段 6 增过期横幅/操作日志/会话 TTL）
  protocol.js      # 消息类型常量 + 轻量字段校验（防脏包）
  test-stage5.mjs  # 阶段 5 回归：换房/重建世界/PLAYER_STATE 时间戳（16 项）
  test-stage6.mjs  # 阶段 6 回归：手持物品/死亡掉落物/鉴权过期与操作日志（20 项）
  package.json     # 依赖：ws（^8）
```

要点：
- `Room`：
  - `players: Map<id, {ws, name, pos, mode, health, food, ...}>`
  - `blocks: Map<"x,y,z", id>`（主副本）
  - `seed`（开房者 `create_room` 提供，不可再改）
  - `time`（权威）
  - `broadcast(type, data, exceptId?)`
- 事件流：
  - `create_room` → 设 seed，回 `room_created` + `world_info`，广播 `player_join`。
  - `join_room` → 回 `world_info`，回放 `blocks` 全量 `block_change`，广播 `player_join`。
  - `block_set` → 校验坐标/ID 合法 → 更新 `blocks` → `broadcast('block_change')`。
  - `player_state/player_full/chat/...` → 转发（`player_*` 除外自己）。
  - `attack_player` → 校验目标在线 → 扣服务器记录的 health → 广播 `attack_player`（若死亡发 `player_died`）。
  - `set_time`（仅 host）→ 更新 `time` → 广播。
- 心跳：每 `heartbeatMs`（默认 15s，可配置）ping，超时未收到 pong 踢出并广播 `player_leave`。
- 多房间（阶段 3）：`index.mjs` 持 `RoomManager = Map<房间名, Room>`，`create_room/join_room` 带 `room` 字段选房；同名房间共享同一世界，世界按房间名隔离互不可见。
- 世界落盘（阶段 3）：`store.js` 把房间世界写入 `server/world/<房间名>.json`（方块账本/掉落物/seed/时间/计数器），方块/掉落物变更即保存，SIGINT/SIGTERM 全量保存；服务器重启后同名房间经 `Room.restore` 恢复，过期掉落物不恢复、无 host 时首个加入者接管。
- 服务器聊天命令（阶段 3+5）：`/rooms` 列出房间、`/seed` 查看当前世界种子、`/room <名>` 世界内换房、`/rebuild`（别名 `/reset` `/regen`，仅 host）重建当前世界、`/help` 帮助（仅回给发起者，`fromId=0`）。
- 世界内换房/重建（阶段 5）：`switch_room` 保持 WebSocket 连接，离开旧房间 + 加入新房间（满员则拒绝并留在原房），回 `world_info(restart:true)`；`world_reset`（仅 host）新种子 + 清空方块/掉落，广播 `world_info(restart:true)` 并重放 `player_join` 让各端重建远端玩家。客户端 `NetworkManager` 收到 `restart` 后 `_ready=false` 缓存消息 → `main.js` 以新 seed 重启本地世界（`game.start`）→ `onWorldStarted()` 落地缓存，全程不中断连接。
- 管理面板（阶段 4+5）：`http://<host>:3001/` 返回 `admin.html`（自包含页面，轮询 `/api/status`），JSON 接口 `/api/status`（房间/玩家/配置状态）、`/api/config`（GET/POST 读写配置，落盘 `server/config.json`）、`/api/broadcast`（全房间系统广播）、`/api/kick`（按玩家 id 踢出，发 `kicked` 让客户端停止自动重连）、`/api/room/<name>/clear-drops`（清空掉落物）、`/api/room/<name>/delete`（踢出所有玩家 + 删磁盘存档 + 内存移除 = 重置世界）。
- 可配置项（阶段 4+5+6，`server/config.js` 校验，非法值忽略）：`dropTtlMs`（掉落物过期毫秒，默认 300000）、`heartbeatMs`（心跳间隔毫秒，默认 15000）、`maxPlayersPerRoom`（每房间人数上限，默认 10；`Room.addPlayer`/`isFull` 超限拒绝入房或拒绝换房）、`adminToken`（阶段 5 管理面板口令，默认空=不鉴权；非空时所有 `/api/*` 须带 `Authorization: Bearer <token>`，接口返回时掩码为 `****`）、`adminTokenExpires`（阶段 6 口令过期 Unix 秒，默认 0=永不过期；到期后除 `POST /api/config`（可续期/关闭鉴权）外全部 401）。
- 玩家死亡掉落物（阶段 6）：`player_died` 携带死亡位置 + 背包掉落列表，服务器广播死亡并逐个生成世界掉落物（`drop_spawn`，进掉落物账本持久化/回放），同一次死亡用 `_diedDrops` 去重（重生复位）。
- 管理操作日志（阶段 6）：`index.mjs` 内存环形缓冲（最近 200 条）记录配置/广播/踢人/清掉落物/删房/未授权访问，`GET /api/logs` 查询（最新在前，同样需鉴权）。
- 管理面板鉴权增强（阶段 6）：`adminTokenExpires` 到期后 `authState(req)` 返回 `'expired'`（非 config POST 一律 401，错误提示"口令已过期"）；`admin.html` 会话 TTL（本次会话/1h/24h/7天，localStorage 存 `{token,exp}`，过期自动清）与过期横幅（保留配置卡可编辑用于续期/关闭鉴权）。

---

## 11. 分阶段实施与验收

### 阶段 0（MVP）—— 本期目标

| 里程碑 | 验收标准 |
|---|---|
| M0 服务器骨架 | `node server/index.mjs` 启动，日志显示监听 3001 |
| M1 连接/房间 | 两台电脑（或两个浏览器标签）都能 join 同一房间，收到 `world_info` 并进入同一世界 |
| M2 方块同步 | A 建一块石头，B 端同步出现；B 破坏，A 端同步消失；TNT 爆炸双方一致 |
| M3 玩家可见 | A 看到 B 的人形模型，移动平滑无瞬移，昵称可见 |
| M4 状态/交互 | 生命/食物/模式同步；A 打 B 扣血；死亡/重生广播；昼夜一致；聊天可用 |

### 阶段 1（已完成）

- [x] 掉落物与拾取同步（`drop_spawn` / `drop_taken` 广播）。
  - 服务器维护掉落物账本（`Room.drops`，id 唯一、5 分钟过期自动清理）；新玩家加入回放现存掉落物。
  - 客户端 `MobManager` 扩展：网络掉落物实体（速度由 id 确定性派生，各端运动一致；去重防重连回放重复）、拾取按剩余数量扣减、拾取后 `drop_taken` 上报。
  - 联机模式挖矿改为生成物理掉落物（不再直接进背包），谁都能拾取；单机保持原「直接进背包」行为不变。
- [x] 断线重连 + 玩家离开清理。
  - 断线指数退避自动重连（1s/2s/4s/.../15s 封顶，最多 8 次）；重连成功后**原位续玩**（世界不重启，只同步时间/模式并刷新远端玩家 + 账本回放纠正），避免重进丢失背包/位置。
  - 主动返回菜单（`net.close()`）不触发重连；重连彻底失败才提示并回菜单。
  - `player_leave` 广播携带昵称，远端玩家实体移除 + 聊天系统提示「XXX 离开了游戏」。
- [x] 首次加入账本回放缓冲：`world_info` 后紧接的方块/掉落物回放先缓存，世界就绪后统一落地（修复首次加入丢包）。

### 阶段 2（已完成）

- [x] 怪物同步方案选型实施（§9.2，选定**方案①事件同步**）。
  - host 端权威自然生成（`isHost` 由 `world_info.hostId` 判定）：`trySpawn` 命中 → `mob_spawn` 广播 → 服务器分配唯一 id → 各端 `createMobFromNet` 创建同一实体（去重）。
  - 玩家攻击：`attackMob` 本地扣血/击退后广播 `mob_attack`（带攻击者端位置）→ 其它端 `applyRemoteMobAttack` 扣血 + 受击反馈 + 位置校正。
  - 死亡：击杀端在 `mob.dead` 当帧 `dropLoot`（掉落物走阶段 1 机制）+ 广播 `mob_died`；其它端 `applyRemoteMobDeath` 仅播死亡动画不产掉落（防双份）。`diedHandled` 防重复广播/重复掉落。
- [x] 红石状态缓解（§9.3）。
  - lever/button 交互与按钮自动关闭触发 `onStateChange` → `redstone_state` 广播 → 其它端 `applyRemoteState` 对齐 `poweredBlocks`/`buttonTimers`，红石网络随之收敛。torch/红石块为恒定电源（方块 id 表达状态，走方块同步）。

### 阶段 3（已完成）

- [x] 多房间（同名房间共享同一世界，按房间名隔离）。
  - 服务器 `RoomManager = Map<房间名, Room>`；`create_room`/`join_room` 带 `room` 字段，缺省 `default`；同名房间返回同一 `Room`（种子/方块/掉落物共享），不同房间完全隔离（互不广播、互不回放）。
  - 加入不存在房间自动创建（随机 seed，首个加入者成为 host）；磁盘恢复的房间无 host 时首个加入者接管。
  - `welcome.players` 恒为空（hello 时尚未进房），进房后由 `joinRoom` 向新玩家回放房间内已有玩家（`player_join`），客户端缓冲直至世界就绪。
- [x] 世界落盘（重启不丢世界）。
  - 新增 `server/store.js`：`saveRoom`/`loadRooms`/`roomFileName`，数据写 `server/world/<房间名>.json`（方块账本/掉落物/seed/时间/nextDropId/nextMobId）。
  - 方块、掉落物（生成/拾取/过期）、时间变更即落盘；SIGINT/SIGTERM 全量落盘；重启后同名房间 `Room.restore` 恢复，过期掉落物（>5min）不恢复。
- [x] 换房/新建世界。
  - 主菜单「局域网联机」新增**房间名**输入框：同一房间名 = 进同一世界（含落盘恢复）；换一个房间名 = 换世界/新建世界（host 在创建时决定该房 seed）。
  - 服务器聊天命令 `/rooms`（列出房间）、`/seed`（当前种子）、`/help`。
- [x] 玩家名着色。
  - 新增 `src/net/playerColor.js`（`playerColorHue`/`playerColorCss`，按玩家 id 稳定配色，id=0 为服务器系统色）。
  - 应用点：远端玩家昵称标签（`RemotePlayer._makeNameSprite` 填充色）、聊天消息 `<名字>`（`ChatBox.addSegments` 分段转义着色）、进出提示（「X 加入了/离开了游戏」名字着色）。

### 阶段 4（已完成）

- [x] 远端玩家插值优化（`src/entity/RemotePlayer.js` 重构）。
  - 关节模型：head/arm/leg 部件改为 pivot 支撑，可独立旋转（头部俯仰、手臂/腿部摆动）。
  - 速度自适应平滑：插值系数 `k = 1 - exp(-dt * (BASE_K + min(30, speed*1.5)))`，速度越快收敛越快（减少拖尾），静止时平滑停靠。
  - 远距瞬移快照：目标距当前位置 > 4 格直接快照（respawn/传送时避免"飞天滑行"）。
  - 行走摆动动画：水平速度驱动腿/手臂相位（`_walkPhase`），飞行/静止不摆动；`pitch` 现随 `player_state` 透传并应用（头部俯仰）。
- [x] 观战（死亡后旁观其他玩家）。
  - `DeathScreen` 新增「观战其他玩家」按钮 → `Game.enterSpectate()`：旁观模式（穿墙自由飞行）、隐藏死亡屏不重生、`_preSpectateMode` 记录原模式。
  - 相机第一人称跟随房间内存活玩家（`updateSpectateCamera` 贴合目标位置+朝向）；`F5` 循环切换目标（`cycleSpectateTarget`），无目标时自由飞行；`R` 重生退出观战恢复原模式。
  - 观战不广播本地位置（`NetworkManager.update` 跳过 `spectating`）；观战不响应 E/C/鼠标交互；`update()` 只 gate 玩家移动/物理段，怪物/红石/区块照常更新。
- [x] 服务器配置面板（Web 管理页 + JSON API + 持久化配置）。
  - 新增 `server/config.js`（默认值 + 范围校验 + 读写 `server/config.json`）、`server/admin.html`（自包含管理页，3s 轮询）。
  - `/api/*`：`status` / `config`（GET/POST）/ `broadcast` / `kick` / `room/<name>/clear-drops` / `room/<name>/delete`。
  - 新协议 `kicked`：踢出时发送，客户端置 `_explicitClose` 停止自动重连并返回主菜单（`src/net/NetworkManager.js` + `server/protocol.js`）。
  - 可配置：`dropTtlMs`、`heartbeatMs`、`maxPlayersPerRoom`（`Room.addPlayer` 超限拒绝入房）。
  - 验证：`server/test-admin.mjs` **18/18 PASS**（人数上限/踢出/清掉落物/删房重建/配置非法值过滤/广播）。

### 阶段 5（已完成）

- [x] 联机世界内直接换房/重建世界。
  - 新协议 `switch_room`（C2S `{room}`）/ `world_reset`（C2S，仅 host）；`world_info` 新增 `restart` 标记。
  - `server/index.mjs`：`switchRoom()` 保持连接换房（目标房满则拒绝留在原房）、`room.resetWorld()` 新种子+清空账本并广播。
  - `server/room.js`：`joinRoom(player, msg, {restart})` 透传标记（含新建房走 `createRoom` 分支）；`resetWorld()`；`isFull()`。
  - 客户端：`NetworkManager._handle(WORLD_INFO)` 对 `restart` 走 `_ready=false` + `restart_world` 事件；`main.js` 新增 `restart_world` 处理器以新 seed 重启本地世界；`Game` 欢迎语提示 `/room` `/rebuild`；修复 `ChatBox` 全局 T 键监听器泄漏（换房/重建反复 `start()` 不再堆积监听器）。
  - 聊天命令 `/room <名>`、`/rebuild`（`/reset`/`/regen` 别名，仅 host）。
- [x] 客户端视角插值/时间戳对齐。
  - `server/room.js` 的 `player_state` 广播携带 `ts: Date.now()`。
  - `RemotePlayer`：样本缓冲（≤40）+ 时钟偏移平滑估计 + 固定 120ms 插值延迟，按 `renderTime` 线性插值重放；`i` 钳到 `len-2` 防止越界崩溃（曾致主循环停摆，已修并冒烟验证）。
- [x] 管理面板鉴权。
  - `server/config.js` 新增字符串字段 `adminToken`（≤64 字符，空=关闭）。
  - `server/index.mjs`：`authOk(req)` 校验 `Authorization: Bearer <token>`（未开则放行），`maskedConfig()` 对外掩码口令；`/api/*` 未授权回 401。
  - `server/admin.html`：登录弹层（401 时出现，口令存 localStorage）、`api()` 自动带 Bearer、配置卡新增口令输入（`****` 未改不提交）、退出登录。
  - 验证：`server/test-admin.mjs` 新增鉴权 8 项 → **26/26 PASS**；新增 `server/test-stage5.mjs` 换房/重建/时间戳 **16/16 PASS**；浏览器双端冒烟（换房后 host 变新房 host 且连接不断、`/rebuild` 种子变化、远端时间戳插值平滑跟随、管理面板登录弹层 + 401/200）通过。

### 阶段 6（已完成）

- [x] 手持物品外观同步 / 快捷栏槽位可见。
  - `player_state`（20Hz）与 `player_full` 广播 `selected`（槽位）+ `held`（物品名）；`Room.onPlayerState/onPlayerFull` 透传并记录。
  - `RemotePlayer`：按 `held` 变化把物品/方块 SVG 渲染成 sprite 挂在右臂 `armR.pivot` 末端（`SVGTextures.svgToImage` + `CanvasTexture`，异步重建带 `_heldSeq` 序号防竞态），空手/换持实时切换。
  - 修复潜在 bug：PARTS 左右臂/腿 `role` 重复为 `'arm'`/`'leg'` → 拆分为 `armL/armR/legL/legR`（此前行走摆臂从未生效，手持 sprite 也挂不上右臂）。
- [x] 玩家死亡掉落物同步。
  - 客户端死亡时 `player_died` 上报死亡位置 + 背包列表；`Room.onPlayerDied` 广播 `player_died` + 逐项生成 `drop_spawn`（微小确定性偏移防重叠，进掉落物账本持久化）。
  - 同一次死亡去重（`player._diedDrops`，`onRespawn` 复位）；死亡端清空背包，重生重发生存初始物品（`Game.respawn` 联机分支）。
  - 验证：`server/test-stage6.mjs` 掉落广播/账本/去重/复活再掉落 + 浏览器冒烟（死亡屏→掉落实体→清背包→重生重发）通过。
- [x] 观战者视角平滑。
  - `Game` 观战跟随对目标位置/朝向做帧率无关指数平滑（`k = 1 - exp(-dt * -ln(0.0001))`，`_specSmoothed/_specSmoothYaw/_specSmoothPitch`）；切换目标/进入观战/重生时重置平滑（避免跨图横扫）；相机读取平滑后位置+视点高度。
- [x] 管理面板鉴权增强（token 过期 / 操作日志）。
  - `config.js` 新增 `adminTokenExpires`（Unix 秒，0=永不过期，范围 [0, 2100]）；`authState(req)` 三态 `ok/no/expired`——过期后除 `POST /api/config`（续期/关闭）外一律 401（`口令已过期` 提示）。
  - 操作日志：内存环形缓冲 200 条（config/broadcast/kick/clear-drops/delete-room/auth-fail），`GET /api/logs`（最新在前，需鉴权）。
  - `admin.html`：登录会话 TTL（本次会话/1h/24h/7天，`localStorage` 存 `{token,exp}`，过期自动清）、操作日志卡片（HTML 转义防注入）、口令过期横幅（保留配置卡可编辑用于续期/关闭）。
  - 验证：`server/test-stage6.mjs` 鉴权过期 + 日志 8 项 → **20/20 PASS**；浏览器冒烟（登录弹层、`/api/logs`、过期 401/横幅、UI 续期关闭）通过。
- [x] 时间戳插值自适应延迟。
  - `RemotePlayer.update` 按缓冲"头余量 = 最新样本 ts − 渲染时刻"动态调 `_interpDelay`（<0.03s 加大吸收抖动、>0.22s 降低减少滞后，钳制 0.05~0.4s，步进 0.004/0.002）。干净网络稳定 ~0.12s，抖动大自动抬升避免欠载。

### 阶段 7（已完成）—— 4 种怪物建模优化（"同色纸片" → 立体有细节）

> 注：阶段 7 原规划为 LAN 增强清单，经用户确认延后为**阶段 8**；阶段 7 改为打磨单机/联机共用的怪物渲染观感。

- [x] 修复"同色纸片"根因（法线缺失 → 无方向光）。
  - `MobManager.buildMaterials` 合并的 cuboid geometry 从未 `computeVertexNormals`，且 FACE_DEFS 每面两三角形绕序相反（会平均成 ~0 法线）。
  - 修复：索引绕序统一为 `(0,1,2)(1,3,2)`（UV 不变）+ `geo.computeVertexNormals()` → 平坦面法线 → `MeshLambertMaterial` 方向光生效（受光面亮/背光面暗）。
  - 验证：4 种怪 geometry `attributes.normal` 存在、144/144/144/240 条全单位向量、各轴平均绝对值恰为 1/3（轴向平面法线分布）。
- [x] 皮肤 atlas 64×64（cell 16×16 方形）。
  - 原 64×32（cell 16×8）贴到方形面上 UV 拉伸变形；改方形后每面贴图无畸变，可画更多细节。
  - 每 face 按朝向套基础明暗（front 1.0 / back 0.80 / left 1.05 / right 0.88），配合方向光在夜晚也保持辨识度。
- [x] 重写 4 种怪皮肤纹理（16×16/面像素细节）。
  - 僵尸：绿皮噪点 + 头发帘/眼睛/嘴（带牙）+ 眼下阴影 + 衬衫中缝/破洞露皮 + 皮带扣 + 裤磨破 + 鞋。
  - 骷髅：白骨 + 高光颅顶 + 大眼窝/鼻孔/颧骨 + 白牙列 + 衬衫肋骨/胸骨 + 脊柱 + 腰带。
  - 苦力怕：斑驳绿 + 标志性大眼睛（4 宽）+ 渐宽裂口嘴 + 腹部暗面。
  - 蜘蛛：近黑 + 8 只红眼（2×4）+ 口器 + 腹部背面浅斑。
- [x] 模型细化。
  - 苦力怕：身体更方更壮（0.5×0.7×0.28，贴近原版 8×12×4 比例）。
  - 蜘蛛：由"1 头 + 1 身 + 4 腿"改为"头胸（前小）+ 腹部（后大）+ **8 条腿**（4 对，薄长 box 斜向外）"，剪影更接近原版。
  - 人形：臂略细、腿加粗，微调比例。
- [x] 验证：`node --check` + `npm run build`（45 模块）+ 浏览器冒烟（法线属性/控制台 0 错误/世界投影取景确认 4 怪在画面内 + before/after 截图）+ 服务器单测保持全绿（34/15/26/16/20）。

### 阶段 8（已完成）—— 怪物朝向修复 + 原版化贴图 + 天空盒修复

> 注：用户反馈三个问题——①怪物的脸朝向头顶；②蜘蛛脑袋在身体后面；③天空盒走远后纯黑。原阶段 8（LAN 清单）延后为**阶段 10**；本阶段为渲染修复。

- [x] 修复"脸贴头顶"：皮肤 atlas 64×64 → **96×64（4 行 × 6 列）**，top/bottom 不再复用 front/back cell。
  - 根因：`FACE_COL` 把 top/bot 映射到 front/back 列，头顶画的是"脸"（眼+嘴），看起来"脸朝向头顶"。
  - 新布局：col 0-5 = front/back/left/right/top/bot，每面独立绘制（头=top 为皮肤/颅骨色、底=下巴暗面等）；`FACE_BRIGHTNESS` 增补 top 0.96 / bottom 0.70；`MOB_ATLAS` 常量导出供 `MobManager.buildMaterials` 同步画布尺寸（96×64）。
- [x] 修复"蜘蛛头在身体后面"（及怪物一律背对移动方向）：`Mob.js` yaw 公式反向。
  - 根因：`yaw = atan2(-nx, -nz)` 使 mesh 局部 +Z（脸/头所在面）指向移动方向**反方向**——追玩家时脸朝后、蜘蛛头拖尾。
  - 修复：chase/wander 均改为 `yaw = atan2(nx, nz)`，局部 +Z 旋到 (sin yaw, cos yaw) = 移动方向。验证：chase 中怪物"局部 +Z 与指向玩家方向的点积"= 1.000。
- [x] 修复 4 个侧面贴图水平镜像：FACE_DEFS 增加每面显式 UV 选择器。
  - 旧写法 `c<2 ? u0 : u1` 把 u0 固定给前两个 corner，恰好与 4 个侧面的"观察者右侧"全部相反 → 镜像。新写法：侧面统一 `[[1,0],[1,1],[0,0],[0,1]]`（u1 落在观察者右侧），top/bot 用 `[[0,0],[1,0],[0,1],[1,1]]`。
- [x] 4 种怪皮肤按原版重画（配色/特征校准）。
  - 僵尸：去头发（原版无发）+ 黑色双眼 + 青色衬衫 + 蓝紫裤 + **手臂前伸**（原版标志性姿势，HUMANOID_PARTS 臂 box 改为沿 +Z 前伸）。
  - 骷髅：全身骨白（去衬衫）+ 肋骨横条躯干 + 眼窝/鼻孔/牙列 + **SKELETON_PARTS 细肢专属模型**（臂 0.14 宽）。
  - 苦力怕：经典脸（4×4 黑眼 + 上窄中宽下分叉裂口嘴）+ 斑驳绿 + 身体 8×12×4 原版比例。
  - 蜘蛛：头前腹后 + 头部正面 1 对大红眼 + 下方 1 对暗红小眼 + 腹部背面浅斑。
- [x] 修复"天空盒走远后纯黑"：天空球每帧跟随玩家。
  - 根因：天空球（半径 500）固定在原点，玩家距原点超过 far(1000) 后整球被远裁剪面裁掉，露出黑色 clear color。
  - 修复：`Sky.update` 中 `skyMesh.position` = 玩家位置（太阳/月亮本就跟随）+ `frustumCulled = false`。验证：传送 (2500, 95, 2500) 后整屏蓝天无黑。
- [x] 验证：`node --check` × 4 + `npm run build`（45 模块）+ agent-browser 冒烟（4 怪正午特写截图：脸在头正面/头顶为皮肤色/前伸手臂/苦力怕经典脸/蜘蛛头前红眼 + 远距天空非黑）。

### 阶段 9（已完成）—— 方块材质重绘贴近原版

- [x] `BlockDefs.js` 全部方块 SVG 重绘（注册名 / textures key / 管线不变，仅替换生成实现）。
  - 通用像素画工具：`makeTex/setPx/fillRect/rgb([r,g,b],f)/hash2` + 三色噪声 `noiseTex`（基色为主 + 暗/亮碎点）+ 2×2 斑驳 `blotchTex`，替代旧"高变异随机噪声"。
  - 结构化像素画：圆石（4×4 砌块 + 奇数行错位 + 深缝）、石砖（2×2 大砖 + 受光边）、红砖（4 行交错 + 浅灰缝）、木板（4 横板 + 板缝 + 端缝 + 上沿受光）、原木（竖向断续纹 / 顶面年轮 + 树皮边 + 亮芯）、矿石（石底 + 4 组晶簇 + 高光/阴影点，深板岩同构）、砂岩（分层条带）、玻璃（白框 + 斜高光）、TNT（白带 + TNT 字样 + 顶部引信）、工作台（顶面 3×3 网格 + 侧面台面/工具影）、熔炉（石底 + 炉口）、荧石/海晶灯/红石灯/岩浆/下界岩/末地石/灵魂沙/黑曜石/矿物块斜面等按原版配色校准。
  - 顺手清理：`redstone_block` 双注册（light 15 被覆盖为 0）删除一处，保留 light 0 行为不变。
- [x] 修复 `ChunkMesh.js` 潜伏崩溃：light 面（发光方块，light≥13）顶点微抬引用了**从未定义的 `yOff`**——含发光方块（火把/荧石/岩浆等）的 chunk 重建即 `ReferenceError` → `Game.loop` rAF 链断裂 → 画面永久冻结。定义 `const yOff = 0.001`（顶面微抬防 z-fighting）。浏览器侧从未覆盖"放置发光方块后区块重建"路径，本次摆放含荧石的阵列时暴露。
- [x] 验证：`node --check` + `npm run build`（45 模块，649 kB）+ agent-browser 冒烟（创造物品栏一屏全图标核对 + 16 种方块阵列世界内特写：TNT 白带字样/红砖缝/石砖/圆石砌块/年轮/矿石晶簇/荧石 + 摆放发光方块后时间持续推进无冻结）。

### 阶段 10（完成，2026-09-01）

- [x] **手持物品 3D 化渲染**：新文件 `src/render/HeldItemMesh.js`——手持物 3D 模型构建器（方块 = 六面贴图小立方体，cross 方块 = 交叉双面薄片，物品 = 双面薄片；SVG → 32×32 CanvasTexture 最近邻采样；材质 = MeshLambertMaterial + emissiveMap 同贴图 0.35 自发光，夜晚可见；模板按物品名进程级缓存，clone 复用）。新文件 `src/render/FirstPersonHand.js`——第一人称手持物（相机子节点，右下基座 + 空手肤色手臂 + 挥动/走路 bob 动画；按住左键自动连续挥动，放置/食用/命中触发单次挥动）。**注意**：camera 必须加入 scene（`scene.add(camera)`）其子节点才渲染。`RemotePlayer._setHeld` 由 sprite 升级为 3D 模型（挂 armR pivot 随摆臂）。
- [x] **快捷栏槽位完整可见（整条快捷栏同步）**：`player_full` 携带 `hotbar`（9 槽 `[{name,count}|null]`，服务器 `sanitizeHotbar` 校验后记录在 `player.hotbar`）；`joinRoom` 回放的 `PLAYER_JOIN` 扩展为 `joinInfo()`（含 `selected`/`held`/`hotbar`）——新加入者立即看到所有在线玩家的选中槽位/手持物；脏 hotbar（空名/超界）整体丢弃不改状态。`RemotePlayer.applyFull` 存 `hotbar`/`selectedSlot`，消息未带 held 时由 `hotbar[selected]` 推导。
- [x] **死亡掉落物拾取归属/捡起冷却细同步**：死亡掉落带 3 秒归属锁（账本 `owner`/`ownerUntil`，广播 `owner`/`ownerLock` 毫秒）；锁内非 owner 拾取：本地预判跳过 + 服务器权威拒绝（`drop_deny` + 补发 `drop_spawn` 供客户端重建实体）；账本已不存在的 `drop_taken` 也回 `drop_deny`（防两人同时拾取复制物品）；客户端 `drop_deny` → 从背包扣回（`Inventory.removeItems` + `MobManager.takePendingPickup` 拾取留档）。普通挖矿掉落无锁（先到先得不变）。
- [x] **管理面板多账号 / 踢出原因 / token 轮换**：`config.adminAccounts = [{token,label,expires}]`（≤10 个，任一未过期账号可通过鉴权；全部撤销 = 鉴权自动关闭）；旧 `adminToken`/`adminTokenExpires` 保留为兼容接口（等价于 label='default' 的账号，读写同步）。新 API：`POST /api/tokens`（生成，crypto 强随机 32 字符，明文仅返回一次）、`POST /api/tokens/rotate`（轮换，旧口令立即失效，按 `id`=token 哈希定位避免明文回传）、`POST /api/tokens/revoke`（撤销）。`admin.html` 新增「管理账号」卡（生成/轮换/撤销 + 有效期倒计时），踢出弹窗支持填写原因（透传 `kicked.reason`，日志记录）。
- [x] **插值延迟 RTT 直测**：客户端每 2s 发 `ping {seq, ts}`（应用层），服务器回显 `{seq, ts}`，客户端 PONG 分支算 EMA(0.8/0.2) 平滑 RTT（`NetworkManager.rttMs`）；`RemotePlayer` 自适应以 RTT 为主信号（目标延迟 ≈ 0.05s + RTT/2，钳 0.05~0.4s，平滑靠拢），头余量仅保留欠载保护（<0.03s 加大延迟）；InfoBar 联机时显示「网络: Xms」行。
- [x] 验证：`node --check` + `npm run build`（47 模块，655 kB）+ 新增 `server/test-stage10.mjs` **41/41**（RTT 回显/完整快捷栏透传与 joinRoom 回放/归属锁拒绝与补发实体/owner 放行/普通掉落先到先得/账本不存在 deny 防复制/多账号生成轮换撤销与旧接口兼容/踢出原因透传）+ 全基线 test-mp 34/34、test-store 15/15、test-admin 26/26、test-stage5 16/16、test-stage6 20/20 全绿 + agent-browser 冒烟（第一人称手持方块/火把/物品截图、挥动动画、远端玩家手持 3D 模型、joinInfo 回放断言、InfoBar RTT 行、掉落锁确定性断言：锁内拦截/过期放行、管理面板生成→轮换→撤销全流程）。

### 阶段 11（完成，2026-09-02）—— 打磨包：挥动联动 / 头顶快捷栏 / 白名单与权限 / 抖动自适应

- [x] **手持物挥动与挖掘进度联动**：`Game.handleMouseInput` 生存挖掘分支按 `hardness/speedMul` 算实际挖穿耗时，写入 `hand.miningPeriod`（钳 0.25~1.0s）；`FirstPersonHand` 自动挥动周期从固定 0.3s 改为跟随该值，挥速同步缩放（单次挥动时长 ≈ 周期）、幅度随硬度微调（硬块更深 swAmp 0.85~1.2）。**联机可见**：`player_state` 增 `mine` 标志（本端挖掘中，20Hz 消息 +1 字节）→ `Room.onPlayerState` 透传 → `RemotePlayer` 记录 `mining`，右臂在行走摆臂上叠加 ~0.3s 周期敲击动作（`_mineAmp` 平滑进出防关节跳变；飞行/死亡/重生复位）。
- [x] **远端玩家头顶快捷栏可视化**：新文件 `src/render/RemoteHotbarSprite.js`——9 槽 canvas sprite（每实例独享 texture/material，dispose 释放；昵称上方 y+2.62，renderOrder 999 / depthTest false）。图标走与 Hotbar 同口径的解析链（`itemSvgMap[name]` → `blockSvgMap[block.side||top]`），`svgToImage` 异步加载完成后补画，Image 模块级缓存复用。**重绘节流**：内容/选中槽指纹比较（player_state 20Hz 触发仅字符串比较），变化才重绘；全空快捷栏隐藏；死亡隐藏、重生恢复。
- [x] **房间白名单 + 权限分级**（名单存 `config.json`，管理面板实时改）：
  - `config.js`：新增 `roomWhitelist` / `roomOps`（`{<房间名>: [昵称...]}`，≤32 房 × 16 名，trim 去重，非法整体丢弃）；`adminAccounts` 每项增 `role: 'op'|'viewer'`（缺省归一 op，旧配置兼容）。
  - 入房拦截：`CREATE_ROOM` / `JOIN_ROOM` 白名单拒 → `kicked`（客户端停自动重连）+ 断开；`SWITCH_ROOM`（含 `/room` 命令）游戏内用系统聊天拒绝（与"房间已满"同款，不踢下线）。
  - 角色分级：`authState` 返回 `{state, role}`；**viewer 所有非 GET 请求 403**（config/whitelist/kick/tokens/broadcast 全拒，写操作日志记录）；`GET /api/whoami` 供面板取角色；未开启鉴权 = op。`POST /api/whitelist`（op）整卡替换两份名单。
  - 房间 op：`Room.isOperator()`（host 或昵称在 `roomOps[房间名]`）放行 `gamemode` / `set_time` / `world_reset`（原仅 hostId）；拒绝从静默改为系统聊天提示「只有房主(HOST)/op 可以…」。
  - `admin.html`：角色标签（顶部）+ viewer 隐藏全部写按钮（`body.viewer .card button`）+ 账号表增角色列 + 生成账号可选 op/viewer + 新「房间白名单 / Op 名单」卡（每行 `房间名=昵称1,昵称2`，textarea 聚焦编辑中不被 3s 轮询回显覆盖）。
- [x] **插值延迟结合抖动方差**：新文件 `src/net/netStats.js` 纯函数模块（无 DOM/three 依赖，node 直测）——`pushRttSample`（RTT EMA 0.8/0.2 + 抖动 = 相邻样本差绝对值的 EMA，非法样本忽略）与 `targetInterpDelay`（= 0.05 + rtt/2000 + jitter/4000，钳 0.05~0.4，抖动权重取 RTT 一半）。`NetworkManager` PONG 分支改走 netStats（`rttMs` + `rttJitterMs`）；`RemotePlayer` 自适应目标延迟叠加抖动项（RTT 缺失时保留头余量欠载保护兜底；样本下标 `i ≤ len-2` 防越界不变）；InfoBar 网络行 `网络: Xms ±Yms`（第 7 参，旧签名兼容）。
- [x] 验证：`node --check` × 10 + `npm run build`（100 模块）+ 新增 `server/test-stage11.mjs` **33/33**（netStats EMA/抖动/钳位、白名单 trim 回读、名单外 join/create 被 kicked 断开、名单内放行、换房聊天拒绝且留原房、无名单对照、whoami 三态、viewer GET 放行 / 全部写 403、无 role 旧账号归一 op、房间 op gamemode/set_time/world_reset 放行与名单外拒绝提示、清空名单失权）+ 全基线 test-mp 34/34、test-store 15/15、test-admin 26/26、test-stage5 16/16、test-stage6 20/20、test-stage10 41/41 全绿 + agent-browser 双会话冒烟（头顶快捷栏随切槽高亮、挖掘挥动软/硬块节奏、远端挖掘摆臂、InfoBar ±抖动行、白名单拒绝提示）。

### 阶段 12 及以后（候选项）

> **状态：搁置（2026-09-12）**——优先完成 TODO.md Idea-2 机制池（弓蓄力→箭联机→铁傀儡→潜影盒→凋灵链）；本节候选保留为后续备选。

- 玩家列表面板（Tab 键）：房间内玩家/维度/ping 一览（数据已齐）。
- 远端玩家盔甲外观同步（盔甲槽已有数据通道，缺外观渲染）。
- 服务器性能面板：每房间消息速率 / 字节量统计（管理面板图表化）。
- 房间内私聊 / 队伍分组。

---

## 12. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 怪物各端漂移 | 高（若不处理） | 本期关闭生成；阶段 2 按 §9.2 选型 |
| 客户端逻辑无法直接搬服务端 | 高 | 架构采用"各端自跑 + 服务器只仲裁增量"，不搬运核心逻辑 |
| `setBlock` 回环广播 | 中 | 6.2 的 `_applyingRemote` 防回环标志，必须实现并测试 |
| 方块冲突 | 低 | last-write-wins，局域网信任场景接受 |
| 红石 tick 漂移 | 中 | 阶段 2 缓解，MVP 接受 |
| 防火墙/端口 | 低 | 文档说明 + `start.cmd server` 辅助脚本 |
| 存档互相覆盖 | 中 | 联机关自动保存，仅开房者持久化（§8） |
| 远端脏包导致崩溃 | 中 | 服务端/客户端双重字段校验，未知类型忽略 |

---

## 13. 实现工作量估算

| 项 | 新增/修改 | 规模 |
|---|---|---|
| `server/`（index/room/protocol/package.json） | 新增 | ~250–350 行 |
| `src/net/NetworkManager.js` | 新增 | ~250–300 行 |
| `src/entity/RemotePlayer.js` | 新增 | ~150–200 行 |
| `src/core/World.js` | 修改 | +10 行（钩子 + 防回环） |
| `src/player/Game.js` | 修改 | +80–120 行（钩子/上报/远端更新/存档策略） |
| `src/ui/MenuScreen.js` + `main.js` | 修改 | +60–100 行（联机入口） |
| `start.cmd` | 修改 | +20 行（server 子命令） |
| 依赖 | 新增 | `ws`（仅 server） |

合计：新增 ~700–850 行，修改 ~200–300 行。规模可控，建议按 §11 里程碑推进。
