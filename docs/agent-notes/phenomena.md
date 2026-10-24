# phenomena.md — B37 G 局部潮候与稀有景象（防回退备忘）

> 本文覆盖 Build 37 · G 的实现与口径。改 `src/core/Phenomena.js`、`src/player/PhenomenaView.js`、
> `Journal` 的 `phenomena` 桶、`tide_plaque` 方块或潮候音效前**必读**。

## 一、B37 之前的旧行为（改回去会立刻踩坑）

- 世界里没有任何周期性环境现象：天空只走昼夜，粒子只服务于挖掘/方块破坏/传送门/末影水晶等一次性事件。
- `Journal` 只有 `explored` / `discoveries` / `readSteles` / `markers` / `sharedMarkers` / `lastPosition` 六个面，没有「现象」这一层。
- 因此 G 是**纯新增体验**：不迁移旧存档、不改协议、不动方块账本与生成随机流。

## 二、三层分工（别把它们混在一起）

| 层 | 文件 | 职责 |
|---|---|---|
| 纯推导 | `src/core/Phenomena.js` | 由「维度 + 当日时间 + 一天时长」算阶段/进度/强度/倒计时；不读世界、不写方块、不用 `Math.random` |
| 表现与记录 | `src/player/PhenomenaView.js` | 预兆播报、粒子发射、观测累计、日记记录、一次性纪念发放 |
| 数据 | `src/core/Journal.js` 的 `phenomena` 桶 | 已记录的现象（每维一条）+ 纪念发放标记 |

**时间权威**：联机时 `sky.time` 来自服务器 `MSG.TIME`（`Room.time`），两端拿同一个当日时间 → 阶段推导天然一致，
所以 G **不新增协议、不新增服务器账本、不改 `roomSnapshot`**。单机则用本地 `sky.time`。

## 三、阶段机（核心口径）

```
每维一个窗口 window = [start, end)（当日时间，0=半夜 0.5=正午 1=半夜），一律不跨 1.0
omenFraction = min(0.25, OMEN_SECONDS / dayLength)   // 60 秒折算成当日比例
omenStart = start - omenFraction

t ∈ [omenStart, start) → phase='omen'    secondsToStart=剩余秒数
t ∈ [start, end)        → phase='active'  progress / intensity / secondsLeft
其余                     → phase='idle'   secondsToOmen=到下一次预兆的秒数（跨午夜 +1 天回绕）
```

- 窗口（`PHENOMENA`）：主世界 0.78~0.86 岸线荧光、下界 0.30~0.38 灰烬潮、末地 0.55~0.63 无声之潮、天域 0.18~0.26 风光带。**四窗互不重叠**（`phenomena-unit` 有断言），同一时刻只会有一个维度在现象里。
- `intensity` 在窗口首尾各 12% 做淡入淡出；`observable()` 要求 `phase==='active' && intensity >= 0.45`，即**刚起和将散都不计数**。
- 窗口时长 = `(end-start) * dayLength`；默认一天 1200 秒 → 约 96 秒的涌现，预兆 60 秒。改 `dayLength` 时预兆秒数不变（按比例折算）。

## 四、观测与记录

- **可见范围**是「局部」的落点：主世界要求 12 格内采样到水（水面荧光），下界要求采样到岩浆，末地要求脚下 8 格全空（站在岛缘朝虚空），天域要求 `y >= 70` 或处于气流柱。采样节流 400ms（`SCAN_MS`）。
- **累计**：`advanceDwell(dwell, ok, dt, OBSERVE_SECONDS=8)`——满足条件时累加，不满足按**两倍速回退**（走开一会不清零，隔空也攒不满）。
- 记录键是「维度 + 现象种类」，`Journal.recordPhenomenon(dim, kind, anchorKey)` 同维度只记一条（重复返回 `false` 不刷新）；`anchorKey` = `anchorKeyOf(x,z)` = 64 格一个区域，用 `^-?d+,-?d+$` 清洗，非法回落 `0,0`。
- 已记录的维度 **不再累计**（`_observe` 首行 `hasPhenomenon` 早退），所以不会反复弹提示。

## 五、一次性纪念（潮候铭牌）

- 方块 `tide_plaque`（潮候铭牌）**追加在 `BlockDefs.js` 末尾**，ID 顺延；三面纹理 `tide_plaque_top/side/bottom`，四道线分别对应四种现象配色。
- 集齐判定 `Journal.phenomenaComplete()`：按 `PHENOMENON_ORDER` 逐维检查 `hasPhenomenon`，未实现的维度不参与要求。
- `claimPhenomenaSouvenir()` 只有「集齐且未发放」时返回一次 `true` 并落标记；标记随存档序列化（`phenomenaSouvenir`），换档/重启不重发。
- **背包满不吞奖励**：`inventory.add` 剩料 > 0 时把标记改回 `false` 并进入 5 秒重试冷却（`_souvenirRetryAt`），提示「背包已满」。
  - 陷阱：早期用 `now() - this._souvenirAt < RETRY_MS` 判冷却，`performance.now()` 从进程启动计时，**开局 5 秒内永远不会发放**——现在改成「到期时刻」语义。

## 六、表现与开关

- 粒子直接走共享 `ParticleSystem.spawn`，每 120ms 发射一次，数量 = `2 * densityScale * intensity`（跟随「粒子」设置档位）；四种现象各自的配色来自 `PHENOMENA[dim].color`。
- **只 spawn 不持有**：没有常驻 mesh/material，也不写光照数组；离开现象、切维度或关开关后粒子自然过期，无需回收逻辑。
- 开关：`Settings.phenomena`（默认 `true`），视频设置里一行「潮候现象」。关掉后不发射粒子、不播预兆提示、不计数；**已记录的游记数据不受影响**。
- 音效三段：`audio.phenomenonOmen(dim)`（预兆低频持续音）/ `phenomenonSurge(dim)`（涌现上扬双音）/ `phenomenonRecord(dim)`（记录清响），都走 `sfx` 轨、单次计划式节点。

## 七、数据格式（存档兼容）

```js
{
  phenomena: [{ dim: 'overworld', kind: 'shore_glow', anchor: '3,-2', at: 1690000000000 }, ...]  // 最多 4 条
  phenomenaSouvenir: false,   // 纪念是否已发放
}
```

- 旧档没有这两个字段 → `reset`/`deserialize` 回落空表与 `false`，不迁移、不报错。
- 反序列化时按定义表校验：维度非法、种类与维度不匹配、同维度重复的条目直接丢弃；`anchor` 不合法回落 `0,0`。

## 八、红线（G 的验收纪律）

1. **不改地形、不改水位、不写方块、不碰光照数组**——`phenomena-unit` 直接扫 `PhenomenaView.js` 源码断言没有 `setBlock(`。
2. **不新增协议与账本**：联机同步靠既有 `MSG.TIME`，`roomSnapshot` 无新字段。
3. **不碰既有生成随机流**：现象与地形无关，纯由时间推导。
4. 粒子池复用、按距离/强度节流；没有常驻资源，所以「开关现象不造成帧尖峰与资源残留」是结构性保证而不是靠回收代码。

## 九、接线点（改这些地方时要成对检查）

- `Game.start()` 在 `journalScreen` 之后 `new PhenomenaView(this)`；`_disposeWorld()` 里 `dispose()` 并置 `null`。
- `Game.update(dt)` 在 `_updateRuins()` 之后调 `this.phenomena.update(dt)`（暂停/死亡时主循环不进入 update，所以不会累计）。
- `JournalScreen.renderSidebar()` 的「潮候观测」小节读 `game.phenomena.hintText()`：静默给下一次预兆倒计时、预兆给开始倒计时、涌现给剩余秒数——**预兆在游记里也看得见**。
- 文案全部走 `t()`；19+2 条新键已进 10 个语言包（`tests/i18n-parity.mjs` 会拦漏项）。

## 十、已知限制 / 偏差

- **没有「第几天」计数**：现象按当日时间窗口每天重现一次，所以同一时刻在不同天的表现一致；想要「隔几天才来一次」需要新增日计数（本次刻意不做，避免动存档与联机时间面）。
- 观测条件绑定景观（水/岩浆/虚空边缘/云层），不是「只要现象出现就计数」——这是「局部」的语义，也意味着主世界里离海很远时看不到荧光。
- 联机下 `sky.time` 由服务器按 `MSG.TIME` 下发，两端阶段同步；但服务器只在 host 改时间或换天时广播，客户端本地也会推进 `sky.time`，因此两端倒计时可能出现**一两帧以内**的细微差异（不影响判定，记录仍按各自本地时间累计）。
- 现象视觉只是粒子，没有改变天色/雾/水体；「天色」侧的表现靠既有时段光照，未做专属调色。

## 十点五、本轮踩到的两个坑（同类问题还会再来）

1. **`PHENOMENES` ≠ `PHENOMENA`**：`JournalScreen` 侧栏里把导入名写错成多一个 S，`node --check` 只查语法不查标识符，
   `tests/phenomena-unit.mjs` 也没覆盖 `JournalScreen`（它要真 DOM），于是直到 `tests/game-behavior.mjs` 的 boot 断言
   （`start()` 内部 try/catch 把异常吞成 `running=false`）才暴露。**新增浏览器侧代码必须跑 `game-behavior` 或浏览器手测**，
   只跑本批新套件不够。
2. **`performance.now()` 从进程启动计时**：纪念冷却写成 `now() - this._souvenirAt < 5000` 时，开局 5 秒内永远判冷却中
   （node 里 `performance.now()` 只有几十毫秒）。冷却语义一律写成「到期时刻 `_xxxRetryAt`」而不是「上次时间戳」。

## 十一、回归

- `tests/phenomena-unit.mjs`（95 条断言，已进 `server/run-all-tests.sh` 的 `PURE_NODE_SUITES`）：
  定义表与窗口不重叠、预兆 60 秒随 dayLength 折算、阶段边界/进度/强度/倒计时（含跨午夜回绕）、
  观测累计语义（累加/两倍速回退/门槛/`dt=0`）、锚键清洗、游记桶（去重/集齐/一次性纪念/序列化/旧档回落/脏数据）、
  铭牌方块 ID 与纹理、既有方块 ID 零漂移、开关默认值、红线源码守卫，以及 `PhenomenaView` 的真实累计、
  预兆期不计数、关闭开关零粒子、背包满退回纪念等集成路径。