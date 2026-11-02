# Build 41 · 灵魂出窍 / 第一人称手臂 / 皮肤链路（计划）

- 状态：**待评审**（2026-11-02 侦察完成）
- 范围：1 个新功能 + 3 个修复，同一批交付，`BUILD` 升到 41
- 本文件为在办计划，交付后 `git mv` 进 `docs/archives/`

## 0. 批次概览

| 里程碑 | 类型 | 侦察结论（一句话） | 主要触及文件 |
|---|---|---|---|
| M1 灵魂出窍 | 功能 | 相机与玩家位姿强耦合在 `Player.updateCamera`，需引入「相机位姿 override」+ 输入改道 | `src/player/SoulView.js`（新）、`Game.js`、`Controls.js`、`Player.js`、`CommandPanel.js` |
| M2 第一人称手臂 | 修复 | 手臂盒长轴是 Z，皮肤 armR 区域却按长轴 Y 绘制，且六面共用 front 区、不辨方向 | `FirstPersonHand.js`、`PlayerSkin.js` |
| M3 Pages 取皮肤 | 修复 | ① 跨域图片未设 `crossOrigin` → 画布污染 → `toDataURL` 抛 SecurityError；② 静态托管上仍请求 `http://<pages-host>:3001` | `SkinScreen.js`、`PlayerSkin.js` |
| M4 皮肤映射复查 | 修复 | back / top / bottom 三面朝向错（对照 skinview3d 官方 UV），legacy 64×32 左臂左腿整片透明 | `PlayerSkin.js` + 两个新套件 |

实施顺序：**M4 → M2 → M3 → M1**。M4 先把 UV 基础正过来，M2 才能直接复用同一套面表；M3 与 M1 独立，放在后面避免调试干扰。

用户原话（保留措辞）：

> 1. 新功能：命令面板-灵魂出窍：在不移动人物、人物视角的情况下，摄像机离体查看（可穿墙）
> 2. 人物手臂朝向有问题：看起来像"肩膀"在前，用"肩膀"交互似的
> 3. 在Pages上运行时，无法通过本地node服务器获取MojangAPI皮肤
> 4. 复查皮肤组件，修复可能出现的贴图错位、倒置等问题

---

## 1. M1 灵魂出窍

### 1.1 需求拆成三条硬约束

- **身体不动**：位置、速度、朝向、生存状态（饥饿/氧气/着火/摔落）全部冻结；
- **人物视角不变**：鼠标只驱动相机，`player.yaw/pitch` 不得被写（归体后回到原视角）；
- **相机自由**：无碰撞（穿墙是特性）、可飞离身体、可升降。

### 1.2 设计

| 面 | 做法 |
|---|---|
| 相机 | `Player.updateCamera(world, view)` 增加可选 `view`（`{position, yaw, pitch}`）；有值时直接写相机并提前 return。位姿语义集中在一处，不再散落 |
| 输入 | `Controls` 增 `lookTarget = null`（null→player）：`onMouseMove` 写 `lookTarget ?? player`，`getMoveVector()` 的 yaw 同源；`look` 非空时**抑制**空格双击切换飞行（那是身体的动作） |
| 身体 | 进入时保存 `pos/yaw/pitch/viewMode/flying/velocity`，置 `velocity=0`；激活期间跳过移动/物理/生存/着火/传送门/滑翔/竞速分支 |
| 渲染 | `hand.setVisible(false)`；`playerModel` 强制可见（看得见自己的躯壳，静止 idle）；准星保留但 `selectedBlock=null`、`highlight.visible=false`、`crosshairInfo=null`；`InteractionController` 整段跳过（与 `spectating` 并入同一分支） |
| 区块 | 新增 `_viewAnchor()`：soul 激活时返回相机位置，否则玩家位置。`updateChunks` / `sky.update` / 水下判定改用它；**卸载循环跳过玩家所在区块**（否则相机飞远后归体会踩进未加载区块掉下去） |
| 世界 | 怪物/红石/流体/作物/漏斗/粒子/昼夜照常推进（离体不等于暂停世界） |
| 联机 | 位置与朝向仍按身体上报，不广播相机。命令面板本就是「启用作弊的存档专享」，而联机 `Game.start` 传 `cheatsEnabled=false`（`src/main.js:79/88`），故本功能天然只在单机可用 |

新增 `src/player/SoulView.js`（纯逻辑，node 可测）：`enter()/exit()/get active`、`step(dt, input)` 推进位姿（忽略碰撞）、`applyTo(camera)`、`anchor`。速度建议基础 10 m/s、按住 Ctrl ×2，不改视频设置。

### 1.3 退出收口（幂等，7 个入口）

`V` 键 / 面板按钮 / 暂停菜单弹出 / 玩家死亡 / 死亡屏 / `returnToMenu()` / `start()`（换存档与换维都重建世界）。全部走 `soul.exit()`，内部判 `active` 后早退。

### 1.4 UI

- 命令面板新增卡片「灵魂出窍」：状态文案 + 按钮「出窍（离开身体）」/「归体」+ 操作说明（WASD / Space / Shift / Ctrl / V）。
- 进入与退出各一条 `chatBox.add` 提示（含归体提示与坐标）；`InfoBar` 增可选第 8 参 `viewPos`，灵魂态显示相机坐标（侦察时才有意义）。
- 水下覆盖改按**相机所在格**判定（`hud.setUnderwater(camInWater)`），否则灵魂钻进水里却没有水下滤镜。

### 1.5 验收

新增 `tests/build41-soul-camera.mjs`（复用 `tests/lib/game-env.mjs` 假环境）：

1. 进入后模拟 120 帧 + 输入，`player.position/yaw/pitch/velocity` 逐帧不变；
2. `camera.position/rotation` 跟随 soul 位姿；
3. 灵魂路径上放实心方块，相机不被拦（穿墙成立）；
4. 归体后相机回到眼点，`player.yaw/pitch` 与进入前逐位相等；
5. 暂停 / 死亡 / 回菜单后 `soul.active === false`（收口幂等，调两次 exit 不炸）；
6. 相机飞离 8 个区块后，身体所在区块仍在 `world.chunks` 里。

手测清单：面板与 V 键两个入口、穿墙、升降、天空/水下覆盖、远飞后归体不卡顿不掉血、死一次确认自动归体。

### 1.6 已知限制（写进文档）

- 灵魂态不落盘：存档 / 换维 / 回菜单即归体；
- 出窍期间身体无敌、不饿不淹（见待确认 2）——若选择不无敌，则相机远飞时可能被怪物打死，需在死亡时归体并取消视角；
- 联机不可用（命令面板的门控所致，非额外限制）。

---

## 2. M2 第一人称手臂

### 2.1 根因（探针实证，见附录 A）

手臂是 `BoxGeometry(0.16, 0.16, 0.42)`（**长轴 = Z**），但 `applySkin` 把 `armR.base.front`（图片 4×12：上行=肩、下行=手）以固定角序 `[LT,RT,LB,RB]` 贴到**六个面**。实测每个面的纹理走向：

| 面 | 纹理 u 沿 | 纹理 v 沿 | 观感 |
|---|---|---|---|
| py 顶面（最显眼） | X：4px / 0.16 ✔ | Z：12px / 0.42 ✔ 但**方向反** | 肩在**远端**、手在近端 → 用户所说「肩膀在前」 |
| px / nx 侧面 | Z：4px 铺满 0.42 ✘ | Y：12px 压进 0.16 ✘ | 横截面被沿长度拉长 2.6× |
| pz / nz 端盖 | X：4px / 0.16 | Y：12px / 0.16 ✘ | 整条手臂压进小方端盖 |

即：手臂长度方向只有顶面比例正确，而顶面恰好前后颠倒；其余面是横截面被当成长条涂抹。

### 2.2 修复

1. 几何改 `BoxGeometry(0.16, 0.42, 0.16)`——长轴 = Y，与第三人称手臂同构；
2. 从 `PlayerSkin` 导出 `setFaceUV` / `FACE_MAP`，按 `armR` 的 right/left/front/back/top/bottom 逐面写入（slim 时臂宽 3px → 0.12）；
3. 整块绕 X 轴旋转 `π/2 + 抬角`：长轴 +Y → -Z，**bottom（手）落远端、top（肩）落近端、front（臂正面）朝上**，与第三人称语义一致；
4. 位置按截图微调（目标：右下角伸向屏幕中心、不遮准星、走路 bob 与挥动幅度保持现有手感）；
5. 顺带修：第一人称手臂此前忽略 slim 的 3px 臂宽，改为按当前模型的 `partRects` 取宽。

### 2.3 验收

`tests/build41-fp-arm-uv.mjs`（独立 oracle，从顶点 `position`+`uv` 反推，不复用实现）：

- 远端端盖（最 -Z 的 4 个顶点）落在 `armR.bottom` 区域，近端端盖落在 `armR.top`；
- 四个长面：u 沿臂宽（4px ↔ 0.16）、v 沿臂长（12px ↔ 0.42），且 v 增大方向指向 -Z；
- 六面区域两两不同（不再是同一块 front）；
- 负控：把实现退回「六面同一 front」至少 3 条断言红。

视觉：headless 截图（内置默认皮肤 + 方向标记测试皮肤），与第三人称手臂同面比对。

---

## 3. M3 Pages 上按用户名取皮肤

### 3.1 根因（两条，均已实证）

**① 画布污染（主因）**：`loadImageFromURL` 用 `new Image()` 且不设 `crossOrigin`；`_onFetchByName` 的镜像分支把图片画进 canvas 后调 `toDataURL()`。跨域图片在无 CORS 模式下加载会把画布标记为 tainted，`toDataURL` 抛 `SecurityError`，被外层 `catch` 吞掉 → 逐候选失败 → 最终「获取失败」。

浏览器实测（Chromium，见附录 B）：

```
minotar none : load OK, READ FAILED SecurityError      ← 现状
minotar cors : load OK 64x32, read OK, 1554B           ← 加 crossOrigin='anonymous'
```

**② 候选链在静态托管上必然失败**：Pages 上 `location.hostname = illagercpr.github.io`，代码生成的候选是 `http://illagercpr.github.io:3001/api/skin/<name>`——HTTPS 页面里的混合内容被浏览器直接拦，且该主机根本没有 3001 端口。

因此「本地 node 服务器」这条路在 Pages 上永远不通，而唯一可用的镜像回退又因①静默失败。

### 3.2 修复

- `loadImageFromURL(url, { crossOrigin = true } = {})`：对 http(s) 设 `img.crossOrigin = 'anonymous'`，`data:`/`blob:` 不设；加 8s 超时。
- 抽出纯函数 `buildSkinCandidates(name, { netUrl, hostname, protocol })`（node 可测）并重排：

| # | 候选 | 生效条件 |
|---|---|---|
| 1 | 联机服务器代理 `<http(s)://服务器>/api/skin/<name>` | `netUrl` 存在（联机） |
| 2 | `http://<hostname>:3001/api/skin/<name>` | 仅 `localhost/127.0.0.1/::1` 或 `protocol==='http:'`——**静态托管下不再尝试** |
| 3 | `https://mc-heads.net/skin/<name>` | 恒可用（响应带 `Access-Control-Allow-Origin: *`、`image/png`） |
| 4 | `https://minotar.net/skin/<name>` | 恒可用（CORS 已实证） |
| 5 | — | 全失败 → 文案引导上传 PNG |

- 成功时提示「来源：<源>」，并注明镜像不区分 slim（镜像只给 PNG，无模型元数据），沿用用户当前的模型设置。
- 失败时逐候选 `console.debug`，便于线上复现。

### 3.3 验收

- `tests/build41-skin-candidates.mjs`（不联网）：Pages 场景不含 3001；联机/本机分支顺序；`crossOrigin` 决策（http(s)=true、data:=false）。
- 真机：在 `https://illagercpr.github.io/Tiderift/` 的真实 origin 下跑附录 B 探针，记录两个镜像的可用性（data: 页面的 null origin 会被 mc-heads 拒绝，故必须用真实 origin 判定）；Pages 线上实际走一遍「按用户名获取」。

---

## 4. M4 皮肤映射复查

### 4.1 方法

以 **skinview3d 3.4.2**（业界通用渲染器）的 `setUVs` 为参考实现，把本项目与它都折算成「角色空间角点（右/左 · 上/下 · 前/后）→ 图集像素」，逐点比对 **6 部件 × 6 面 × 4 角 = 144 点**。部件的区域原点/尺寸两边完全一致，差异只在角序。

### 4.2 结论：72/144 不一致，全部集中在 back / top / bottom

right / left / front 三面**完全一致**（所以平时看正面/侧面没问题）。三处偏差：

| 面 | 现状 | 应为 | 症状 |
|---|---|---|---|
| back | `flipU=true` | `flipU=false` | 后脑/后背贴图**左右镜像** |
| top | `flipU=true, flipV=false` | `flipU=true, flipV=true` | 头顶贴图**前后颠倒** |
| bottom | `flipU=true, flipV=true` | `flipU=true, flipV=false` | 底面贴图**前后颠倒** |

穷举 64 种组合后**唯一零差异方案**即上表。第二层（overlay）共用同一张表，同错同修。

> 注：默认皮肤头顶/后背多是对称纯色，所以这四处长期没被肉眼发现；一旦用带图案的皮肤（帽檐、后背印花、发型分缝）就会看出来。

### 4.3 legacy 64×32 皮肤（实测缺陷）

`normalizeSkin` 只把 y16..31 下移 16px。实测 64×32 输入归一化后：**armL / legL 的 base 与 overlay 共 8 个区域整面 alpha=0** → 以 `transparent:false` 的材质渲染成**纯黑**左臂左腿。

修复：按 1.8 官方转换表做镜像补位（右臂/右腿 → 左臂/左腿，含 top/bottom 与全部 overlay），一次性产出 64×64；表外区域保持透明。老的「下移 16px」保留为中间步骤即可，但必须补左臂左腿。

### 4.4 顺带复查（结论：不改，仅记录）

- overlay 外扩用 `+0.5px`（每边 0.25px），原版 hat 用 1.125 倍（每边 0.5px）——观感差异极小，保持现状；
- slim 的 3px 手臂在第三人称走 `rebuildArmsForModel`，与 `partRects` 一致；第一人称的宽度问题在 M2 一并修；
- 三条渲染路径（第三人称本地模型、远程玩家、第一人称手臂）统一走同一份 `partRects`/`FACE_MAP`，本次导出后不再各写一套。

### 4.5 回归网

- `tests/build41-skin-uv.mjs`：把 144 点「角色空间角点 → 图集像素」映射钉死（参考表内联，不依赖网络/引擎）；负控：任一 flip 退回旧值必红。
- `tests/build41-legacy-skin.mjs`：纯像素表模拟 64×32 → 64×64，断言 6 部件 12 个区域 alpha 覆盖 100%。
- 视觉：默认皮肤 + 方向标记皮肤，前/后/左/右/上/下六面截图比对。

---

## 5. 交付

- 提交序列（每步 `node --check` + `npm test`，`tests/i18n-parity.mjs` 会拦新增文案缺语言）：

| # | 提交 | 内容 |
|---|---|---|
| 1 | `fix(skin): 皮肤 UV 三面纠偏 + legacy 64×32 镜像补位` | M4 + 两个套件 |
| 2 | `fix(render): 第一人称手臂朝向与贴图轴向` | M2 + 套件 |
| 3 | `fix(skin): 静态托管下按用户名获取皮肤` | M3 + 套件 |
| 4 | `feat(soul): 命令面板灵魂出窍` | M1 + 套件 + `BUILD=41` |

- CI 绿 → 签名 tag `beta-build-41` → 发布（见待确认 3）→ 确认 Pages 部署成功。
- 文档更新：`docs/agent-notes/rendering-lighting.md`（M2 手臂轴向）、`docs/agent-notes/ui-misc.md`（M1 灵魂出窍 / M3 取皮肤链路）、`docs/bug.md`（CW-3 皮肤映射、CW-4 Pages 取皮肤）、`AGENTS.md`（roadmap + 索引表）、本文件归档。

---

## 6. 待你确认

1. **快捷键**：`V` 键（推荐，当前未被占用）+ 命令面板按钮双入口？
2. **出窍期间身体**：无敌 + 不饿不淹（推荐），还是保留可被怪物伤害？
3. **发布**：本批 CI 绿后直接发 `beta-build-41`？
4. **相机速度**：基础 10 m/s、Ctrl ×2（推荐），还是需要滚轮调速？

---

## 附录 A · 第一人称手臂探针输出（现状）

`partRects('classic').armR.base.front = { x:44, y:20, w:4, h:12 }`（图片上行=肩、下行=手），复刻 `FirstPersonHand.applySkin` 的写入后逐面采样：

```
py(+Y 上)  近端(+Z) img(46,20) ← 肩     远端(-Z) img(46,32) ← 手
           顶点0 (-0.08,+0.08,-0.21) img(44,20)   顶点1 (+0.08,+0.08,-0.21) img(48,20)
           → v 沿 Z 正确、方向反：肩落在远端
px/nx(侧)  顶点0 (…,+0.21) img(44,20)   顶点1 (…,-0.21) img(48,20)
           → u 沿 Z（4px 铺满 0.42）；v 沿 Y（12px 压进 0.16）：横截面被拉长
pz/nz(端盖) u 沿 X、v 沿 Y，均 0.16：整条手臂压进小方端盖
```

## 附录 B · 跨域画布探针（Chromium 实测）

```js
function T(label, url, crossOrigin) {
  return new Promise((r) => {
    const i = new Image(); if (crossOrigin) i.crossOrigin = 'anonymous';
    i.onload = () => { try {
      const v = document.createElement('canvas'); v.width = v.height = 64;
      v.getContext('2d').drawImage(i, 0, 0); v.toDataURL('image/png');
      r(label + ': load OK, read OK');
    } catch (e) { r(label + ': load OK, READ FAILED ' + e.name); } };
    i.onerror = () => r(label + ': LOAD FAILED');
    i.src = url;
  });
}
```

结果：

```
minotar 无 crossOrigin : load OK, READ FAILED SecurityError
minotar crossOrigin    : load OK 64x32, read OK, 1554B
mc-heads crossOrigin   : LOAD FAILED（data: 页面为 null origin，被拒；需在真实 origin 复测）
```

## 附录 C · 皮肤角点比对（skinview3d 3.4.2 为参考）

```
【当前 FACE_MAP】不一致 72/144 个角点，全部落在 T/B/Bk 三面
  ✗ head 角LTF 法线T : 参考 img(16,8) → 本项目 img(16,0)     ← top v 反
  ✗ head 角LTBk 法线Bk: 参考 img(24,8) → 本项目 img(32,8)    ← back u 反
  ✗ head 角LBF 法线B : 参考 img(24,8) → 本项目 img(24,0)     ← bottom v 反
零差异方案：top[flipU,flipV] / bottom[flipU] / back[无翻转]
```
