# Tiderift Beta Build 40 · B39 贪心合并贴图拉伸修复 交付记录

> 状态：**已交付**（2026-11-02）。来源：用户截图反馈「材质被异常拉伸，疑似 Build 39 引入」。
> 相关：`docs/archives/render-greedy-plan-b39.md`（B39 U-1 交付）、`docs/bug.md` 的 CW-2、`docs/agent-notes/rendering-lighting.md` 的 B40 节。

## 一、结论

B39 的贪心合并**几何与光照判据都正确**，出问题的只有一处：`ChunkMeshBuilder` 顶端那张静态表 `FACE_UV_AXIS` 把纹理 u/v 的物理轴写反，导致合并四边形的 `repU/repV` 互换。方形合并区（w=d）两值相等不受影响，非方形区被各向异性拉伸——平坦地表最容易产出的 16×1 长条合并区，正好是最严重的 16 倍压缩。

## 二、根因

1. 合并四边形只有 4 个顶点，UV 仍是图集子区域四角 `(u0,v0)(u0,v1)(u1,v0)(u1,v1)`；贴图靠 `aUvTile = (u0, v0, repU, repV)` + 片元 `fract` 平铺。
2. 由此顶点 UV 顺序决定：`角0→角1` 只变 **纹理 v**、`角0→角2` 只变 **纹理 u**。
3. B39 写成 `u = axisOf(c0,c1)` / `v = axisOf(c0,c2)` —— 与上一条**互为颠倒**。
4. 结果：`repU` 拿到的是纹理 v 方向的格数、`repV` 拿到的是 u 方向。贪心先沿平面内第一轴铺满（通常 16 格）再向第二轴扩展，所以草地/石地顶面大量出现 `w=16, d=1..3` 的长条合并区 → 纹理被压成细条并拉长，视觉上就是用户截图里的长条纹。
5. 为什么 B39 没抓到：套件只用 16×16 方形平板（`maxRep === 16` 两支都成立），目视检查也选在能整块合并的平地上；方形区前后逐像素相同。

## 三、改动

| 文件 | 改动 |
|---|---|
| `src/render/ChunkMesh.js` | `FACE_UV_AXIS` 改为 `u: axisOf(corners[0], corners[2])` / `v: axisOf(corners[0], corners[1])`，并写明 UV 顺序依据 |
| `src/player/Game.js` | `_dispatchMeshBuild` 的 quality 增传 `greedyMesh` |
| `src/workers/MeshWorker.js` | 收到 `d.quality.greedyMesh` 后落 `RenderQuality.greedyMesh = d.quality.greedyMesh !== false` |
| `tests/build40-greedy-uv-axis.mjs` | 新增回归网（6 断言） |
| `server/run-all-tests.sh` | 登记 `build40-greedy-uv-axis` |
| `src/version.js` | `BUILD` 39 → 40 |

第二处（Worker 质量开关下发）是排查过程中发现的附带缺陷：Worker 是独立模块实例，此前只下发 `smoothLighting/aoEnabled`，`greedyMesh` 在游戏里恒为 `true`，调试开关形同不存在——做 A/B 对拍时会得到「开关前后画面完全一样」的假象。**今后新增 `RenderQuality` 开关必须同步这条链路**。

## 四、回归网设计（不复用出错的推导）

`tests/build40-greedy-uv-axis.mjs` 的 oracle 用**已输出的几何本身**反推：合并四边形顶点 0→顶点 2 的世界距离（格）必须等于 `aUvTile.repU`，顶点 0→顶点 1 的距离必须等于 `repV`。这样即使 `FACE_UV_AXIS` 再被改错，套件也会红。

覆盖场景：① 8×16 非方形平板；② 「确实存在 w≠d 合并面」的非恒真守卫；③ 1 格厚浮空薄板（六面方向）；④ 自发光面走逐面直推时 rep 恒 (1,1)；⑤ 天光切分后的变小合并区。负控已实测：把 `FACE_UV_AXIS` 回退成 B39 写法，①③⑤ 三条断言立即失败。

## 五、验证（硬件无关口径，延续 B39 的验收原则）

在 headless Chrome（SwiftShader）+ 固定机位下做**同会话**贪心 / 逐面 A/B 对拍（对拍前先把 mesh worker 熔断成同步构建，否则改主线程 `RenderQuality` 不生效）：

| 场景 | 修复前 贪心 vs 逐面 | 修复后 贪心 vs 逐面 |
|---|---|---|
| 16×1 条纹平台（顶面长条合并） | 差异像素 **19.09%**，肉眼可见涂抹 | **0.16%**（残差为云影/天光时间差） |
| 40 格高墙 + 条纹平台（竖直面大跨度合并） | —— | **0.12%** |

跨会话对拍不可用：两次启动的机位有极小漂移，会被当成差异放大（实测同一份代码跨会话 18%）。

## 六、未做与已知限制

- 未改动 `fract` 平铺方案本身与图集（`NearestFilter`、无 mipmap）。远处合并面在掠射角仍有闪烁/摩尔纹，这是 B39 既有特性，不是本次回归；若要改善需另立批次（图集改 mipmap 会让 `fract` 出现接缝，见 B39 备注）。
- 未新增视频设置面板开关：`greedyMesh` 仍是调试开关（默认 true），只是现在 Worker 侧也能被正确关闭。
- `uAtlasSpan` 仍依赖「图集是等距网格」这一前提（B39 既有约束），图集若改不等距格需重做平铺。
