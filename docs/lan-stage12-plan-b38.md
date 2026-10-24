# Tiderift Beta Build 38 · 局域网打磨三项 实施计划

> 状态：**在办（未开工）**。规划日期 2026-10-23。
> 交付形态：本文件只是计划，不含代码改动（用户明确要求本轮只规划）。
> 上游候选来源：`docs/lan-multiplayer-design.md` §11「阶段 12 及以后」。

## 一、范围

| 编号 | 内容 | 来源 | 批次 |
|---|---|---|---|
| L1 | Tab 键玩家列表面板（昵称/维度/ping） | §11 候选 1 | Build 38 |
| L2 | 服务器性能面板（每房间消息速率/字节量图表） | §11 候选 3 | Build 38 |
| L3 | 房间内私聊 / 队伍分组 | §11 候选 4 | Build 38 |
| — | ~~远端玩家盔甲外观同步~~ | §11 候选 2 | **废弃（用户 2026-10-23 决定）** |
| — | U-1 实体方块贪心合并 | `docs/TODO.md` | **Build 39 独立批**（见 §九 假设 1） |

三项合一个 Build（用户 2026-10-23 决定），本批发布 `beta-build-38`，`src/version.js` 的 `BUILD` 37 → 38。

## 二、现状核查（本次规划逐条实测，行号为准）

- **Tab 键完全空闲**：`grep "Tab" src/` 的有效命中只有 `InventoryScreen` 的页签状态机与 i18n 词条，没有任何 `e.code === 'Tab'` 绑定。
- **玩家列表的维度数据其实已齐**：`Room.joinInfo()` 已带 `dim`（`server/room.js:818`），客户端 `NetworkManager._remoteDims`（`src/net/NetworkManager.js:108`、写入点 677-680 与 1027）已维护 `id → 维度` 映射。
- **但「ping 一览」的前提不成立**（design doc 原判断有误）：`this.rttMs` 只是**本端到服务器**的 RTT（`NetworkManager.js:100`、1263-1266 每 2 秒 PING/PONG）；服务端从不向其他客户端下发某玩家的延迟。要做 ping 列必须先补数据通道。
- **性能面板数据完全不存在**：`server/room.js:914` 只有 `dropped`（限速丢包计数）。没有任何消息条数/字节量累计。**但钩子点现成**：入向在 `server/index.mjs:856` 的 `ws.on('message')`，出向在 `send()`（`index.mjs:828`）。
- **聊天没有频道概念**：`Room.onChat`（`server/room.js:2128`）截 120 字后全房 `broadcast`；客户端 `sendChat(text)`（`NetworkManager.js:1335`）只发 `{ text }`。
- **管理面板无图表**：`server/admin.html` 无任何 canvas/chart 代码，纯 3s 轮询表格；HTTP 路由集中在 `handleHttpRequest`（`index.mjs:361`，`const p = url.pathname`）。

## 三、共同约束

1. **版本号唯一来源**：只改 `src/version.js` 的 `BUILD`（当前 37），界面文本自动跟随。
2. **协议版本**：`PROTOCOL_VERSION = 2`（`server/protocol.js:6`），仅在 HELLO 校验（`index.mjs:869-876`）。本批原则：**纯新增消息类型 / 新增可选字段不升版本**（旧端忽略未知类型、缺字段按 undefined 处理，仓内已有多处先例）；若某项实现中不得不改变既有字段语义，**必须**在该提交内升 `PROTOCOL_VERSION` 并在本文件标注原因。
3. **i18n**：所有新增 UI 文本进 `src/i18n/locales/`，走 `t()`（`src/i18n/index.js:67`），禁止裸中文字符串——`tests/i18n-parity`（`server/run-all-tests.sh` 内）会做 10 包键集/占位符/静态∪动态键审计。
4. **回归**：改动文件逐个 `node --check`；`npm test` 必须全绿；新增 server 套件须在 `run-all-tests.sh` 的 `PURE_NODE_SUITES`（或 server 循环清单）登记。
5. **不落盘**：三项均不进世界存档与 `roomSnapshot`；队伍与统计均为会话级内存结构。
6. **UI 门控**：任何新 UI 打开时必须在 `Game._anyInputBlockingUI()` 生效，并能正确处理 `controls.enabled` 与 pointer lock 释放/恢复。

## 四、L1 · Tab 玩家列表面板

### 4.1 数据通道（唯一需要新补的部分）

- `MSG.PLAYER_STATE`（20Hz）增加 **可选**字段 `rtt`（整数毫秒，客户端把 `netStats` 的 `rttMs` 四舍五入后钳 0~9999 上报；未测得时省略）。
- 服务端 `Room.onPlayerState` 原样透传给同维度其他人；同时 `joinInfo()` 增 `rtt` 字段，让**新加入者**立即拿到在线玩家延迟（否则要等下一次 20Hz 包）。
- 客户端 `RemotePlayer` 增 `rttMs` 字段与 `setRtt(v)` 写入点；`_addRemote` 时从 `joinInfo` 初始化。

### 4.2 UI

- 新增 `src/ui/PlayerListScreen.js`：**按住 Tab 显示、松开隐藏**（原版语义）。半透明居中列表，行 = 昵称（`src/net/playerColor.js` 着色）+ 维度名 + ping + 队长标记。
- 分区：先同维度、后异维度，各带小标题；单选高亮本端行。
- 单人 / 未联机时完全不创建 DOM（`networkManager` 缺失即早退）。

### 4.3 接线点

- `src/player/Game.js` 的 `document.addEventListener('keydown')`（728 行区）新增 `e.code === 'Tab'` 分支，必须 `e.preventDefault()`（否则焦点跳转）；`keyup` 隐藏。
- 门控顺序：UI 打开时 `controls.enabled = false`（沿用统一开关），关闭时恢复；`returnToMenu()`/`_disposeWorld()` 中强制隐藏，避免切档残留。

### 4.4 验收

- 双会话（agent-browser）：同房不同维度时，Tab 能看到两行、维度正确、ping 有数值且与本端 InfoBar 的 RTT 同量级。
- 单人模式按 Tab 无任何变化、不报错。
- 列表可见期间点左键不会挖方块（`_anyInputBlockingUI` 生效）。
- `node --check` + `npm test` 全绿；`i18n-parity` 覆盖新键。

## 五、L2 · 服务器性能面板

### 5.1 计数（服务端）

- `server/index.mjs`：连接级累加器 `stat = { inMsgs, outMsgs, inBytes, outBytes }`——入向在 `ws.on('message')`（856）记 1 条 + `raw.length` 字节；出向在 `send()`（828 行）记 1 条 + 序列化后长度。
- 每房间维护**定长环形缓冲 60 点**（1 点/秒，只存 5 个数值），防无限增长；房空即回收。
- 计数**不**进 `roomSnapshot`、不落盘（与 §三.5 一致）。

### 5.2 API

- 新增 `GET /api/stats`（viewer 可读；非 GET 仍按现有 rule 403），返回各房间当前计数 + 60 点序列。
- 路由挂在 `handleHttpRequest`（`index.mjs:361`）内，复用现有 `authState`。

### 5.3 面板

- `server/admin.html`：每张房间卡内嵌一个小 canvas 折线（消息/秒 与 字节/秒 两条），纯原生 canvas 绘制，**不引入任何图表库**；随现有 3s 轮询重绘。

### 5.4 验收

- 新增 `server/test-stage12.mjs`：两个客户端连同一房间发 N 条消息后，`/api/stats` 的条数/字节单调递增且量级正确；连发 200s 模拟（或加速 tick）后序列长度恒 ≤ 60。
- viewer 账号 `GET /api/stats` 通过、`POST /api/config` 仍 403。
- 面板在负载变化时曲线可见变化；房空后对应房间从返回中消失。

## 六、L3 · 房间私聊 / 队伍分组

### 6.1 协议（新增，不升 PROTOCOL_VERSION）

- `MSG.CHAT` 增**可选** `ch`（`'room' | 'team' | 'dm'`，缺省视为 `room`，旧端兼容）与 `to`（dm 目标昵称）。
- 新增 C2S：`TEAM_JOIN` / `TEAM_LEAVE` / `TEAM_LIST`；S2C：`TEAMS`（全量队伍结构，进房与变更后下发）。

### 6.2 服务端

- `Room.teams: Map<key, { leaderId, members:Set<id> }>` + `player.team`；**会话级内存**，不落盘、不进快照、重连即清。
- `onChat` 按 `ch` 分流：`room` 维持现状全房广播；`team` 只发队友（含发送者回显）；`dm` 只发目标 + 发送者回显，目标不在线按现有系统提示模式回一条（复用 `sendTo(player, MSG.CHAT, { from: '系统', ... })`，见 `room.js:1240` 写法）。
- 限速：复用现有 `chat` 档（30/min），不新开档；队伍规模上限（建议 8 人）在加入时校验。

### 6.3 客户端

- `ChatBox` 增命令解析：`/msg <昵称> <文本>`、`/t <文本>`；普通输入仍是房间频道。
- `PlayerListScreen`（L1）显示队伍色与队长标记，两里程碑共用一处队伍状态。

### 6.4 验收

- 三会话：房间聊天三人可见；`/msg` 只有目标收到；组队后 `/t` 只有队友收到；退队后不再收到。
- 私聊目标离线时发送者收到系统提示、不静默失败。
- 重连/换房后队伍清空（不残留）。
- `test-stage12.mjs` 覆盖分流与 30/min 限速。

## 七、每轮验收与收尾清单

每个里程碑完成即跑，避免堆积：

1. `node --check` 逐个改动文件。
2. `npm test`（= `./server/run-all-tests.sh`）全绿，3001 端口需空闲。
3. i18n：新文本进 10 个语言包，`i18n-parity` 通过。
4. 浏览器验证：L1/L3 用 agent-browser 多会话（指针锁与真实输入），L2 用管理面板 + API 直查。
5. 备忘：踩坑写入 `docs/agent-notes/multiplayer.md`（协议/面板）与 `docs/agent-notes/ui-misc.md`（列表 UI），并同步 AGENTS.md 索引表。
6. 收尾：`git push origin master` → `gh run watch <runId> --exit-status` → 绿后 `src/version.js` 的 BUILD=38 → tag `beta-build-38` + Release（按 AGENTS.md 发布授权，本文件已明确安排该 Release，无需再确认）。

## 八、风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| `player_state` 加字段导致旧端/新端错位 | 低 | 字段可选，服务端只做透传；`joinInfo` 与 20Hz 两条路径都要给缺省值 |
| 统计累加器泄漏（房间/连接不回收） | 中 | 定长环形缓冲 + 房空回收，测试断言序列长度上限 |
| Tab 键与浏览器默认焦点行为冲突 | 中 | `preventDefault()`；仅在联机且无输入框聚焦时生效 |
| 私聊绕过白名单/被用于骚扰 | 低 | 复用 chat 限速档；不接受陌生人私聊的开关列为后续可选项，不在本批 |
| 队伍状态与会话生命周期不一致（重连残留） | 中 | 队伍只存在内存且随 `player` 对象销毁；重连测试必须覆盖 |
| 三项合批导致回归面大 | 中 | 每个里程碑独立提交 + 独立自检，最后统一跑 `npm test` |

## 九、本次规划记录的假设

1. **U-1 排在 Build 39，不并入本批**：`docs/TODO.md` 已写明其前置条件是「真机帧时间对比基线（渲染距离 12）」且「软渲染环境数据无参考价值」；与 LAN 三项零共享代码面。若你要求塞进 38，验收面会翻倍。
2. **玩家列表用「按住 Tab」**而非 toggle（原版语义，松手即收）。
3. **性能面板只读**：不参与限速/踢人/自动告警决策。
4. **私聊/队伍不落盘**，重启即清，不进 `roomSnapshot`。
5. **不升 PROTOCOL_VERSION**（除非实现中出现既有字段语义变更）。
6. 废弃条目（盔甲外观同步）**只从候选清单移除**，不建立任何后续待办。
