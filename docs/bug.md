# Tiderift 已知问题

> 条目前缀 `CW-` 为历史编号延续（CubeWorld 时期）：B29 更名 Tiderift 后**不重置、继续递增**。现有 CW-1（水体分界）、CW-2（地表贴图拉伸）、CW-3（皮肤三面朝向 + 旧版皮肤左肢透明）、CW-4（Pages 上取不到皮肤），均已解决；新问题按 CW-5 … 依序追加（文末注释同款约定）。

## CW-1 — 水体在距玩家固定距离处出现直线分界(✅ 已解决,Build 24)

**现象**:大片水域中,距玩家一定距离处出现笔直(呈区块对齐的阶梯直线)的水体分界;
分界一侧可透见水下地形,另一侧为均匀纯色。分界距玩家的距离固定,随玩家移动跟随;
世界生成/远距传送(全量重载)时高发——10~100 格偶发、100+ 格频发且近似网格状;
贴着异常边界放置方块,附近十几格内的分界会消失。自初始 commit 之前就存在。

**颜色差异**:关闭光照增强时分界为蓝色(水材质本色);基础/完整档呈白色
(水面反射注入 + 菲涅尔掠射天空色 + 泛光)。

### 根因(三层叠加,与雾无关)

1. **边界邻居缺失 → 多画边界面**。区块网格构建时(`ChunkMeshBuilder._fillCache`),
   四周邻居区块尚未生成的方向经 `World.getBlock` 拿到 0(空气),本应被邻居剔除的
   边界面被画了出来。水最显著:边界水柱从水面到海底的**整列侧面**全部绘制,
   半透明层层叠加即"均匀纯色"竖带,直线严格对齐区块边界。
2. **邻居就绪后无光照价差 → 永不重建**。新邻居生成时 `LightEngine.initChunkLight`
   的邻居边界导入是**价差过滤**的(≥2 才入队泛洪)——悬崖/洞口等有价差边界会经
   `_setSky/_setBlockL` 标脏邻居从而自愈;**海面、平原等全 15 无价差边界不触发**,
   第 1 层的多余面永久残留。这解释了"偶发":有价差的边界自愈了,无价差的留下来。
3. **worker 在途窗口吞掉重建**。`Game._applyMeshOut` 回执落地时无条件
   `chunk.dirty = false`——网格异步构建期间被标脏的重建请求(邻居加载/光照泛洪/
   setBlock)被吞,即使触发过重建也可能消失。

**症状闭环**:放方块强制 `setBlock` 标脏重建(此时邻居已在,剔除正确)→ 分界消失,
正是第 2/3 层"重建缺失"的反证;颜色差异来自水材质档位注入,与分界本身无关。

### 修复方式(Build 24)

| 文件 | 改动 |
|---|---|
| `src/core/Chunk.js` | 新增 `_meshEdgeMask`:最近一次网格构建时缺失的边界邻居方向位(1=-x 2=+x 4=-z 8=+z) |
| `src/render/ChunkMesh.js` | `_fillCache`(仅主线程,worker 只跑 `_collectData`)构建时记录 4 邻居缺失方向掩码 |
| `src/core/World.js` | `_finalizeChunk` 新区块就绪后,反向标脏"曾把本区块当空气构建过网格"的邻居(掩码命中位) |
| `src/player/Game.js` | `_dispatchMeshBuild` 派发时清 dirty(快照吸收);`_applyMeshOut` 落地**不再清** dirty(在途期间的新标脏保留、下帧重建) |

渲染圈最外缘(96 格)的外侧邻界面**保留**:外圈区块永不加载,该面是防看穿地形的
必要面,靠雾遮盖;若加载边缘仍有淡直线属预期,进一步改善走雾色/天空色一致性。

### 验证

- 行为级差分:初载 169 区块稳定态 mesh 顶点数 === 强制全量重建(solid/water/light
  三通道逐顶点相等;修复前必为"稳定态 > 重建后",差值即多余边界面);远距传送
  (+1800) 同样三通道相等;`_meshEdgeMask` 闭环检查(指向已加载邻居的残留位)为 0。
- 用户实测确认通过(2026-09-16)。

### 历史排查记录(均已合入,非根治但缓解了次要因素)

| 尝试 | 提交 | 结论 |
|---|---|---|
| 水材质 opacity 0.7→0.48 | `fbf83c5` | 缓解了"两片分离水体 α 叠加"(近滩+远海)这一次要因素,分界变淡未消失 |
| 雾距随渲染距离收口 near=0.5d/far=0.95d | `b24d3ca` | 修复了 fog.far(160) > 加载圈(96) 的硬截断问题;但现象仍在(根因不在雾) |

---

## CW-2 — 大片地表方块顶面材质被异常拉伸(✅ 已解决,Build 40)

**现象**: 大平原/缓坡的草方块顶面出现长条涂抹状纹理，靠近镜头的方块看起来"糊成一片色块"；
方形合并区域（如整块 16×16 平地）却正常。用户截图 `材质被异常拉伸` 定位到 B39 之后。

**根因**: B39 的贪心合并把一张四边形铺满合并区，贴图靠 `aUvTile` 的 `repU/repV` 在片元里
`fract` 平铺。`ChunkMeshBuilder` 的 `FACE_UV_AXIS` 把纹理 u/v 的物理轴**写反**——顶点 UV 顺序
`(u0,v0)(u0,v1)(u1,v0)(u1,v1)` 决定「角0→角1 = 纹理 v 方向、角0→角2 = 纹理 u 方向」，写反后
合并面的两个重复次数互换。贪心先沿 u 轴铺满再向 v 扩展，平坦地表极易产出 16×1 长条合并区
→ 贴图被压成 16 倍细条、另一向拉长 16 倍，即画面上的长条纹。方形合并区 `w=d` 两值相等，
交换无影响，所以 B39 的方形平板自检与目视检查都通过了。

**附带缺陷**: `RenderQuality.greedyMesh` 调试开关没随 `_dispatchMeshBuild` 的 quality 下发，
Worker 是独立模块实例、恒为默认 true，开关在游戏里实际无效（对拍时会误以为是渲染没变化）。

**修复**: ① `FACE_UV_AXIS` 改为 `u: axisOf(c0,c2)` / `v: axisOf(c0,c1)`；② `greedyMesh` 随派发
下发到 `MeshWorker`。回归网 `tests/build40-greedy-uv-axis.mjs` 用**独立 oracle**（从顶点
`position` 反推纹理 u/v 跨度，不复用 `FACE_UV_AXIS`）守 8×16 平板 / 浮空薄板六面 / 天光切分三组
场景，回退到 B39 写法时 3 条断言必红。

**验证**: 受控条纹场景同机位 A/B（贪心 vs 逐面）：修复前像素差 19.09%（可见拉伸），修复后
0.16%（残差为云影/天光时间差）；40×40 高墙（竖直面大跨度合并）同批对拍 0.12%。

---

## CW-3 — 皮肤贴图三个面朝向错误 / 旧版 64×32 皮肤左肢渲染成黑块(✅ 已解决,Build 41)

**现象**: ① 带图案的皮肤在顶/底/背面出现镜像或前后颠倒（帽檐、后背印花、发型分缝最明显），
正面与左右两侧正常；② 上传旧版 64×32 皮肤后，左臂与左腿整条呈纯黑。

**根因**: ① `src/entity/PlayerSkin.js` 的 `FACE_MAP` 三个面翻错——`back` 多翻 u、`top` 少翻 v、
`bottom` 多翻 v。以 skinview3d 3.4.2 的 `setUVs` 为参考实现，把两边都折算成「角色空间角点 →
图集像素」逐点比对 144 点（6 部件 × 6 面 × 4 角），B41 前 **72 点不一致且全部落在 back/top/bottom**。
默认皮肤这几处多为对称纯色，故自 B21 引入皮肤以来一直没被肉眼发现。
② `normalizeSkin` 只把 y16..31 下移 16px，左臂(32,48)/左腿(16,48) 的 base 与 overlay 仍是透明，
`transparent:false` 的材质下渲染成纯黑（实测 8 个区域整面 alpha=0）。

**修复**: ① `FACE_MAP` 改为 `top[flipU,flipV] / bottom[flipU] / back[无]`（穷举 64 组合后唯一零
差异方案）；② `normalizeSkin` 改为按原版 1.8 语义补位——左肢 base ← 右肢 base 的几何镜像
（±X 两面互换 + 全部水平翻转），overlay ← 自身 base 直拷，head 的 hat 区保留旧皮肤自带内容
（不拿 base 顶替）。纯数据算子 `legacySkinOps()` 与执行器分离，node 可测。

**回归**: `tests/build41-skin-uv.mjs`（144 点钉值 + 旧表负控：回退即 72 点红且只在 T/B/Bk）、
`tests/build41-legacy-skin.mjs`（覆盖/顺序/源边界/逐像素镜像语义/无空洞）。

---

## CW-4 — GitHub Pages 上按用户名获取皮肤必定失败(✅ 已解决,Build 41)

**现象**: 本地跑着 node 服务器时能按用户名拉到皮肤；部署到 GitHub Pages 后同一功能始终提示
「获取失败」，只能改用上传 PNG。

**根因(两条叠加)**:
1. **画布污染**：`loadImageFromURL` 用 `new Image()` 且不设 `crossOrigin`，跨域镜像（哪怕响应带
   `Access-Control-Allow-Origin: *`）仍以 no-cors 载入；`drawImage` 之后 `toDataURL()` 抛
   `SecurityError`，异常被外层 catch 吞掉 → 逐候选失败。浏览器实测：
   `minotar 无 crossOrigin → READ FAILED SecurityError`；加 `crossOrigin='anonymous'` →
   `load OK 64x32, read OK`。
2. **候选链在静态托管上必然失败**：Pages 上 `location.hostname = illagercpr.github.io`，代码生成的
   候选是 `http://illagercpr.github.io:3001/api/skin/...`——HTTPS 页面的混合内容被浏览器直接拦，
   且该主机根本没有 3001 端口。

**修复**: `loadImageFromURL` 对 http(s) 设 `crossOrigin='anonymous'`（并加 8s 超时）；候选链收敛为
纯函数 `buildSkinCandidates()`：联机代理 → 本机 3001（仅 localhost/127.0.0.1 或 http 页面）→
minotar（浏览器实测 ACAO:*）→ mc-heads（备用，其 ACAO 只对非浏览器客户端出现）→ 提示上传；
成功时在面板显示「来源：<源>」，失败文案改为「网络不可用或用户名不存在」。

**回归**: `tests/build41-skin-candidates.mjs`（Pages 不再出现 :3001 / 镜像顺序 / URL 去重 /
用户名编码 / 混合内容约束）；真机在 `http://127.0.0.1:5175` 上跑通，hint 显示「来源：minotar」。

---

<!-- 新问题按 CW-5、CW-6 … 追加 -->
