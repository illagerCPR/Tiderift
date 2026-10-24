# Tiderift Beta Build 39 · U-1 实体方块贪心合并 实施计划

> 状态：**在办**。规划日期 2026-10-24；来源 `docs/TODO.md` 的 U-1（原 Idea-3 B-③）。
> 上游依据：`docs/archives/lan-stage12-plan-b38.md` §九 假设 1（U-1 独立成批 Build 39）。

## 一、用户已定决策（本次规划前确认）

| 编号 | 决策 | 结论 |
|---|---|---|
| D1 | 前置条件「真机帧时间基线（渲染距离 12）」无法在本机取得（WSL2 无 /dev/dri，headless 走软件渲染；`docs/TODO.md` 已写明软渲染数据无参考价值） | **用硬件无关指标替代基线**：面数/顶点数削减率 + 同环境 CPU 构建耗时前后对比 + 截图目视一致 |
| D2 | 图集 UV 无 mipmap（`src/render/SVGTextures.js:127-130`，NearestFilter / generateMipmaps=false），跨格四边形必须在片元里平铺 | **全量合并 + 着色器 UV 平铺**（不设跨度上限） |

## 二、现状核查（逐条实测，行号为准）

- **实体方块逐面独立成四边形**：`ChunkMeshBuilder._collectData`（`src/render/ChunkMesh.js:270`）在方块三重循环内逐面推顶点，只有水面顶面走贪心（`_mergeWaterTops`，`ChunkMesh.js:570`）。
- **图集是等距网格**：`buildAtlas`（`src/render/SVGTextures.js:103-137`）用 `cols × rows` 个等大 `cell` 拼成，故每张 tile 在图集里的跨度恒为 `(1/cols, 1/rows)`，可作全局 uniform。
- **UV 语义**：实体面写的是图集子区域四角 `(u0,v0)(u0,v1)(u1,v0)(u1,v1)`（`ChunkMesh.js:462`）；水面另用 RepeatWrapping 独立纹理 + 世界坐标 UV（`ChunkMesh.js:497`）。
- **着色注入点**：`applyVoxelLight`（`src/render/VoxelLight.js`）通过 `onBeforeCompile` 替换 `#include <color_fragment>`；`map_fragment` 未被替换，标准采样走 `vMapUv`。
- **同步与 Worker 共用同一实现**：`_collectData` 是唯一收集路径（`src/workers/MeshWorker.js:36` 直接调 `builder._collectData`），故两条路径天然字节一致，前提是新增顶点属性随 `Object.values(g)` 一并转移（`MeshWorker.js:38-42` 已按此遍历）。
- **合并的视觉正确性约束**：一张合并四边形只有 4 个顶点，无法复现逐格光照/AO 的梯度，故**只合并四角光照与 AO 完全一致（均匀）的面**；这条规则保证合并前后逐像素等价。

## 三、方案

### 3.1 数据层（`src/render/ChunkMesh.js`）

1. 新增面记录暂存：普通立方体面在"四角 (sky, blk, ao) 完全一致 且 非流体 且 非自发光"时先入记录桶，其余面（cross / flat / shape 盒 / 流体 / 门面 / 自发光）保持逐面直推。
2. 六方向各自的切片规则：±X 取 slice=x / u=y / v=z；±Y 取 slice=y / u=x / v=z；±Z 取 slice=z / u=x / v=y（平面最大 256×16 = 4096 格，scratch 复用）。
3. 逐切片贪心：按 (v,u) 序遍历，先沿 u 扩展、再整行沿 v 扩展；同组判据 = 图集 UV 对象同一 + sky/blk 浮点全等 + ao 全等。
4. 合并四边形顶点：以合并区角点位移（u/v 轴高位角投影到区边界）生成，属性取种子格（同值）。
5. 新增顶点属性 `aUvTile`（vec4 = u0, v0, repU, repV）：未合并面填 `(u0,v0,1,1)`，合并面填 `(u0,v0,w,d)`；`pack()` 与 `assembleMeshes()` 同步接线。

### 3.2 着色器（`src/render/VoxelLight.js`）

- `applyVoxelLight` 顶点侧新增 `attribute vec4 aUvTile; varying vec4 vUvTile;`（赋值在 `<begin_vertex>` 之后）。
- 片元侧替换 `#include <map_fragment>`：

```glsl
vec2 tileLocal = ( vMapUv - vUvTile.xy ) / uAtlasSpan;
tileLocal = fract( tileLocal * vUvTile.zw * 0.999999 );
vec2 sampledUv = vUvTile.xy + tileLocal * uAtlasSpan;
vec4 sampledDiffuseColor = texture2D( map, sampledUv );
diffuseColor *= sampledDiffuseColor;
```

- 新增共享 uniform `uAtlasSpan`（vec2 = 单 tile 在图集中的跨度），由 `ChunkMeshBuilder` 构造期从 atlasUV 首项推导。
- 未合并面 `rep=(1,1)` 时上式退化为原采样（仅多一次除法与 1e-6 压缩，远小于一个纹素）。
- 浮点安全：`0.999999` 压缩避免 `fract(1.0)=0` 在四边形远边采到对侧纹素。

### 3.3 不改的部分

- 水面（含顶面贪心）、light mesh（自发光面）、cross / flat / shape 盒几何完全不改。
- 水体与自发光方块不进合并桶（前者已有顶面合并，后者与 light mesh 共面）。
- 不改协议、不改存档、不升 `PROTOCOL_VERSION`。

## 四、里程碑

| 里程碑 | 内容 | 完成判据 |
|---|---|---|
| M1 | 数据层贪心合并 + `aUvTile` 接线（含 Worker 转移） | `node --check` 通过；纯 node 套件断言合并后顶点数按预期下降、非均匀光照处不合并 |
| M2 | 着色器 UV 平铺 | 浏览器截图与合并前目视一致（同机位同设置） |
| M3 | 收尾：`BUILD` 38 → 39、文档归档、发布 `beta-build-39` | `npm test` 全绿、CI 绿、Release 建立 |

## 五、验收（硬件无关指标，D1 决定）

1. **几何削减**：同一世界、同一批区块，记录 `solid` 顶点数/索引数与合并前对比，给出削减率。
2. **构建耗时**：同一环境（本机 headless）下 `_collectData` 前后耗时对比，说明是否回退。
3. **视觉一致**：浏览器同机位截图对比（合并前 / 合并后），逐块目视核对贴图朝向、AO、光照、水体与自发光面。
4. **两条路径一致**：sync 与 Worker 输出逐元素全等（新增属性一并比较）。
5. **回归**：`npm test` 全绿。

## 六、风险与假设

1. **假设**：只合并四角光照/AO 均匀的面已经能覆盖大面（地表平台、地下岩壁、建筑墙面）；若削减率过低，再评估放宽到"仅允许 AO 均匀 + 光照线性"的二次方案。
2. **风险**：three 0.160 的 `map_fragment` 是手写注入点，升级 three 前需复核（与 L4-B 阴影注入同属耦合面）。
3. **风险**：`fract` 平铺在极端跨度（256 格）下浮点精度下降；若出现接缝，回退为限制跨度的保守合并（D2 的备选项）。
4. **真机帧时间**：本批不产出，留给 Windows 侧抽测；合并的收益口径以几何量削减为准。

## 七、交付记录（2026-10-24）

### 7.1 实测数据（整节即 D1 决定的硬件无关验收口径）

| 指标 | 合并前 | 合并后 | 变化 |
|---|---|---|---|
| solid 顶点数（49 区块，seed 20260214） | 633,212 | 437,056 | **−31.0%** |
| solid 四边形数（同上） | 158,354 | 109,315 | **−31.0%** |
| `_collectData` 每区块耗时（同机 headless） | 18.43 ms | 18.81 ms | +2.1% |

- 合并密度（25 区块样本）：输出四边形 58,877 张，其中合并四边形 2,423 张（4.1%），平均每张合并四边形覆盖约 26 张原四边形——与 31% 顶点削减自洽（合并张数少但每张替换多格）。
- 浏览器实景（渲染距离 4、seed 20260214）：场景内 solid 四边形 173,658 张，其中合并四边形 6,481 张（3.7%），单张最大跨度 `rep = 64`；无着色器编译错误，无纹理拉伸/接缝，石砖墙近景逐格平铺正常（合并四边形与逐面直推的相位都对齐到方块网格）。
- 同步与 Worker：`_collectData` 是唯一收集路径，`MeshWorker` 按 `Object.values(g)` 枚举属性做 transfer，新增 `uvTile` 自动随转移（套件 ⑤ 段绊线守住）。

### 7.2 与计划的偏离

1. **合并判据多排除两类面**：流体（水面已有顶面贪心；岩浆沿用原路径）与自发光面（与 light mesh 共面，合并会让 light 面与 solid 面顶点不再一一对应）。
2. **新增 `RenderQuality.greedyMesh` 调试开关**（默认 `true`）：用于合并前后的同场景对拍，不接视频设置面板。
3. **真机 A/B 截图改为「同机位近景 + 片元采样公式等价断言」**：本机只能软件渲染，且两次完整会话的 CDP 驱动多次超时；视觉等价改为可复算的两条证据——(a) 合并判据保证四角光照/AO 全等（属性逐位相同），(b) 片元平铺采样公式与逐面采样逐点比对，最大偏差 3.1e-7（< 一个纹素的 1%），见 `tests/build39-greedy-mesh.mjs` ⑥ 段。
4. **图集跨度走 uniform**：`uAtlasSpan` 由 `ChunkMeshBuilder` 构造期从 atlasUV 推导（图集是等距网格），顶点属性只需 `(u0, v0, repU, repV)`。

### 7.3 回归与交付物

- 新增 `tests/build39-greedy-mesh.mjs`（11 断言：均一平板 6 面 / 天光切分不合并 / `aUvTile` 与顶点数对齐 / 平铺跨度 / Worker 绊线 / 采样公式等价），已登记进 `server/run-all-tests.sh` 的 `PURE_NODE_SUITES`。
- `npm test` 全绿；`src/version.js` 的 `BUILD` 38 → 39，发布 `beta-build-39`。
