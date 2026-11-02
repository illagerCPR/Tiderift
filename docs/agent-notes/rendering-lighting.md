# Agent 备忘 · 渲染与光照

> 本文件内容为 AGENTS.md 批次备忘**原文搬移（未改写）**，用于控制 AGENTS.md 体积（会话注入预算 65536 字节，超限会被静默截断）。
> 导航见 AGENTS.md「批次备忘索引」；新批次备忘按主题追加到对应小节，并同步更新 AGENTS.md 索引表。

### 光照视觉增强批次备忘（防回退）—— 水面反射/云影/后处理泛光/体积光/平面真反射（L1-L3 + L4-A 全部交付）

- **两层架构与档位**：L-A 着色器注入层（水面反射+云影，"基础"档起）+ L-B 后处理层（泛光/色调映射/体积光，"完整"档）。视频设置三档一键 `gfx: off|basic|full`（**默认 off**，老玩家画面零变化）+ 完整档子开关 `gfxBloom/gfxGodRays/gfxWaterReflection`。设置 key `cubeworld-settings` 全局不按存档。关闭档必须逐字节现状：`uWaterFx/uCloudShadow=0`、`GfxState.lightBoost=1`、云色不调制、`toneMapping=NoToneMapping`、postfx 关闭。
- **L4-A 平面真反射（PlanarReflection.js，勿回退）**：
  - **唯一反射平面假设**：全游戏水顶面同高 y=65（SEA_LEVEL=64 方块顶面），`WATER_Y=65` 常量——未来若引入非海平面水体（自流水平面）此假设失效需重构；oblique near-plane 裁剪只需一套参数（近裁剪面斜贴水面，河床/岸壁不入反射）；
  - **水 mesh 双挂 layer 0+2**（ChunkMesh build 输出处 `layers.enable(2)` + Renderer 主相机 `enable(2)`）：反射相机 `mask = 主相机.mask & ~(1<<2)` 排除水面 → 无自反射递归；layer 1 天体保留（水面有太阳/月亮倒影）；
  - **采样注入**（applyVoxelLightWater 内）：顶点 `vReflUv = uTexMatrix * vec4(vWorldPos,1)`（worldPos 已含 chunk position，texMatrix 不乘 mesh 矩阵），片元 `ruv=vReflUv.xy/w` + 波纹扰动采样 + 越界 smoothstep 回退 uSkyColor——**有 RT 用 RT、无 RT 回退 L1 天空色**，同一 shader 编译一次（uReflOn 开关）；反射混合权重沿用菲涅尔 `fresnel*0.55`（俯视 ndv 大 → 反射近似天空色，与回退路径天然连续）；
  - **门控双层**：Game.update 每帧写 `postfx.reflectionEnabled = full ∧ gfxWaterReflection ∧ dimDef.id==='overworld' ∧ !player.inWater`（inWater 主门，入水即时关断走回退不闪帧）；render 内 `camera.position.y<=65` 是第二道保险（贴水面浮顶时 inWater 主门兜底，双阈值缝隙无害）；
  - 反射 RT 半分辨率每帧自查尺寸（窗口/像素比自动同步）；RT 为线性原始值（渲 RT 无 sRGB 编码），与注入域一致，composer/直渲两路径语义相同；反射不走 bloom/色调映射（位置决定），反射里太阳无光晕（廉价反射通病，接受）；镜像相机不含 camera 子树 → 第一人称手持物天然不入反射；**RT 必须开 mipmap**（generateMipmaps + LinearMipmapLinearFilter，`renderer.render` 到 RT 后自动生成）：半分辨率 RT 无 mip 时水面掠射区逐像素高频噪点闪烁（用户实测『倒影频繁闪动』的反射侧来源）；
  - **验证锚点（seed '42'）**：出生点旁水域 (11,1)；站 (0.5,67.5,0.5) pitch=-0.12 yaw=-π/2 贴水平视 → 全屏 A/B 差分 ~9%（俯视机位 fresnel 小差分仅 0.4% 属预期——反射与天空色连续）；水面可见石块/对岸建筑镜像。
- **L4-B 太阳阴影（SunShadow.js，批次①已交付，勿回退）**：
  - **探针实证的死结与绕法（最重要）**：three 0.160 `materialNeedsLights()` 只认 Lambert/Toon/Phong/Standard/ShaderMaterial，**MeshBasicMaterial 即使 `lights=true` 也不会挂载 lights shadow uniforms**（directionalShadowMatrix 恒 0 矩阵，画面无影子且无编译错——静默失效）；`getShadowMask` 在独立 chunk `shadowmask_pars_fragment`（不在 shadowmap_pars_fragment），`receiveShadow` uniform 声明在 `lights_pars_begin`。绕法 = onBeforeCompile 手工挂载 `ShadowUniforms` 三件套（uShadowMap/uShadowMatrix/uShadowPar，共享引用勿换对象）+ fragment 手工声明 `uniform bool receiveShadow;`（renderer 2013 行 per-object 上传，与 needsLights 无关）+ 每帧从 `sunLight.shadow` 同步值（matrix/map.texture/bias/normalBias/radius/mapSize）；
  - **ready 门控（防 GPU 崩溃）**：shadow pass 首帧前 `sh.map` 为 null，uShadowMap 绑空数组（null 纹理）在 SwiftShader 下会 tab 崩溃循环（l4a 会话曾真出，表现为 vite "connected/connecting" 无限重连）——`ready=false 时 uShadowOn=0` 短路采样，勿删；
  - **shadow 相机挂在 sunLight 上**：position 被改写为 `target+dir*200`（Sky.update 每帧重写 normalize，体素光 uSunDir 喂块在其前读单位向量不受影响）；target 须 add 进 scene 且每帧 snap-to-texel（批次①世界 XZ 量化，批次②改 light-space）；
  - **接缝**：vertex 注入 `objectNormal/transformedNormal`（Basic 无 beginnormal chunk，shadowmap_vertex 需 transformedNormal）；`shadowmap_vertex` 必须在 `worldpos_vertex` 后（依赖 worldPosition）；`#include <packing>` 需提前（unpackRGBAToDepth）；影子融合块整体包 `#ifdef USE_SHADOWMAP`（基础/关闭档 define 不存在时代码整体裁掉 = 逐字节现状）；
  - **影子=太阳直射差**：`lv *= 1-(1-sraw)*vVoxelLight.x*uShadowStrength`（权重随天光衰减，树冠下 skyL 低影子弱、洞穴自动无影，防双重变暗）；夜晚/维度无天体 → shadowOn=false → `setReceive(false)` 批量关 chunk receiveShadow（不进 program cacheKey 零重编译）+ uShadowOn=0；
  - shadow pass **每帧更新（勿回退成节流）**：8 帧节流导致影子『冻结 7 帧+更新帧跳格』的阶梯闪动（用户实测『频繁闪动』，已否决）——map 内容与 shadow 相机/matrix 必须同帧一致；真机 GPU 上 depth-only pass 便宜，`autoUpdate=false` 保持显式逐帧 `needsUpdate=true`；mapSize 2048；castShadow 恒定 true（关闭档 shadowMap.enabled=false 时 pass 不跑零成本）；
  - **验证锚点（seed '42'）**：树 logId=32 @(2,70,-5)；站 (12,71,-5) yaw=π/2 俯视 → A/B 差分 67.5%（雪山背光坡面进影子=物理正确）、树冠自阴影区 0.93、maxDelta 648；夜晚 shadowOn=false、off 档 shadowMap.enabled=false；
  - 批次②已交付：light-space snap（target 在垂直太阳方向的平面内按 texel 量化 + 保留沿光分量贴 depth 窗口；太阳近天顶 up×dir 退化时跳过量化）+ ready 门控改为"ready 前每帧请求 shadow pass"（start 时序里 needsUpdate 可能落在 shadowMap.enabled 置位前被跳过）；调参锚点 uShadowStrength=0.5 / normalBias=0.15 / mapSize 2048 / 每帧 pass。已知边界：玩家站坡上物理微动会带动 target（属真实跟随非缺陷）；跨 texel 格瞬间影子边缘整体跳 0.1 格（瞬态）；水面顶面影子未做（水材质无 shadow 注入）。
  - **太阳方向面着色（L4-B 收尾，用户报"石山立面无立体感"后加）**：solid fragment 里天光乘 `1 - 0.40*sunVis*(1-ndl)`（ndl=N·L，vNrmW varying 来自 vertex 注入的面法线）——背光立面白天变暗且随太阳方向实时变化，正午立面 ndl→0 只剩环境分量属物理正确；sunVis=smoothstep(0,0.08,sunDir.y)×uShadowOn（日出渐显/夜晚归零/下界末地关），洞穴（skyL 低）自动无效果；**基础/关闭档 uShadowOn 恒 0 = 逐字节现状**；调参：0.40 为背光压暗强度，过暗/过亮改这一处。
  - **边缘抖动修复三件套（用户两次实测反馈后固化，勿回退）**：① uniform **引用式同步**——`uShadowMatrix.value = [sh.matrix]`（LightShadow 持久实例）而非每帧 copy：shadow pass 在渲染阶段才 updateMatrices，copy 模式下 map 与 matrix 错位 1 帧，玩家/太阳移动时影子边缘每帧错位抖动（实测边缘带抖动 77→32，残留为太阳连续移动的物理爬行，非缺陷）；② `renderer.shadowMap.type = PCFSoftShadowMap`（默认 PCF 是 1px 硬边缘，lit/shadow 边界逐像素振荡）；③ `normalBias 0.15`（≈1.5 texel，0.03 防不住斜面自阴影振荡）+ 沿光分量 qd 量化 0.25 格（玩家物理微动不进 shadow 相机深度）。
- **uniform 开关零重建（勿回退成切换设置时 markAllDirty）**：所有新效果挂在共享 uniform（uWaterFx/uCloudShadow/uTime/uSunDir/uSunColor/uSkyColor/uWind/uCloudTex/uCloudsY/uReflOn/uReflMap/uTexMatrix），着色器编译一次、切档只写 uniform。VoxelLight.js 双注入器：`applyVoxelLight`（solid+云影）与 `applyVoxelLightWater`（water+云影+菲涅尔+太阳月亮高光+方块光倒影+波纹+RT 反射）；水面注入点在 `#include <opaque_fragment>` 之后（雾/色调映射之前，反射高光同样受雾衰减）。**注意 replace 链不能对同一锚点 `#include <common>` 两次调用**（第二次会插在第一次结果之前导致声明顺序错误，曾真出 shader 编译错——合并为单次拼接）。
- **云影映射必须与 Sky 云层 offset 同源**：`cuv = ((W.x + wind)/1536 + 0.5, W.z/1536 + 0.5)`，`wind` 是 `Sky.wind`（原 `_wind` 已改名公开，每帧喂 uWind）；Sky 构造时 `VoxelLightUniforms.uCloudTex.value = cloudTex`。云影只衰减天空光分量（火把光不受影响）；`uCloudShadow = 设置档 ∧ sky.clouds.visible`（下界/末地云隐藏自动关）。
- **水面反射要点**：菲涅尔混 `uSkyColor`（= skyMesh 颜色，勿用雾色——水下雾会污染）；波纹扰动只作用顶面（`N0.y>0.5`），振幅 0.05 保持块状风格；方块光倒影用顶点 `voxelLight.y` 调制 glint（夜晚岸边火把光斑）。`uTime` 在 Game.update 累加——暂停冻结属预期。
- **后处理链（PostFX.js）**：RenderPass→UnrealBloomPass(半分辨率)→GodRays(ShaderPass)→ColorGrade(饱和1.12+暗角0.16)→OutputPass(ACESFilmic+曝光1.0)。composer 惰性构建（首次"完整"档）+ try/catch 失败回退直渲；WebGL2 才开 `samples:4` MSAA；resize/pixelRatio 同步。**直渲路径必须保持 NoToneMapping**（setGraphicsMode 切换），否则双重色调映射。主菜单全景自持渲染循环不经此链零影响。
- **泛光定标（实测，勿凭直觉调参）**：RT 是 HalfFloat **线性亮度**（无 sRGB 编码）；实测图集最亮纹素（荧石/火把/岩浆）亮度仅 ~0.48-0.6，正午天空 color raw 值 0.66。三坑：①阈值 0.8 高到只有太阳过阈（泛光形同未开）；②强度 <0.8 时增量低于视觉差分阈（~6/255）也形同未开——**现行定标 `threshold 1.05（HDR 线性域）/ strength 0.9 / radius 0.5`（第三次修正）：自然材质最亮的是雪面 ~0.98（纹理 246,250,252 × 体素光满亮），旧阈 0.72 时代雪原白天整个被 bloom 当光源发光（用户实测"雪块反光刺眼"）；现光源块 HDR 提亮 2.2、太阳盘 1.25（Game.update 档位门控）后输出 >1.05 稳定泛光，雪/云(~0.85)/晨昏天空(~0.66) 全部出阈**；历史教训存档：阈 0.8 高到只有太阳过阈（泛光形同未开）；强度 <0.8 时增量低于视觉差分阈（~6/255）形同未开；0.72 时代晨昏天空亮度扫描区间 0.62-0.66 过阈即整片天白化（t 0.27/0.71-0.76 曾真出）；③**天空 mesh color 是 raw 值直进 RT（材质 color 无 sRGB 解码）**，正午 0.66 整片过阈把天洗白——解法 = 自定义蓝天掩除高亮提取（替换 `bloomPass.materialHighPassFilter.fragmentShader`——**属性名是 materialHighPassFilter 不是 material**），`step(c.b, max(c.r,c.g)*1.05+0.02)` 掩除 b 通道显著高于 r/g 的天空色；黄昏天空 0.62<0.65 本就不泛光。光源块 `lightMaterial.color` 完整档提亮 **2.2**、太阳盘材质 1.25（`GfxState.lightBoost` 门控，**关闭/基础档必须回 1.0 保持现状**，Game.update 每帧同步 chunkBuilder 与 sun.material）。云色昼夜调制 `0.35+0.5*day` 同样完整档门控（云是无光照材质，夜里白亮+泛光=夜空发光云）。
- **体积光 God Rays**：太阳/月亮/日晕 `layers.set(1)`（主相机 enable(1)；星空留 layer 0 防噪点）。掩码预渲染两段式：256² RT 先 `overrideMaterial=纯黑(fog:false)` 渲 layer 0 全部几何写深度，再 autoClear=false 只渲 layer 1——**深度保留遮挡关系，光柱天然穿不透山**。合成 pass 24 采样径向模糊衰减 0.93，置于泛光后/分级前。`updateGodRays(sky,camera)` 每帧（Game.update 内）：白天太阳/夜晚月亮按 `sunLight.position.y` 判源，NDC 投影 |x|,|y|>1.3 出屏早退，维度 `sun.visible=false`（下界/末地）自动关；强度 `0.35*(1.15-elev*0.75)`（低角度更强）/月亮 0.12。
- **验证方法论（本批沉淀）**：①视觉断言用 **readPixels 数值差分**（开/关各 grab 一帧比 >6/255 像素占比）——肉眼 JPEG 对比太粗；②**headless 软渲染 FPS 绝对值无意义**（877ms/帧）但 A/B 相对值可信（本机 full≈3.8×off 是 CPU 光栅化悲观上界，真实 GPU 后处理链 2-4ms）；③**agent-browser eval 与 RAF 循环竞速**：设 `sky.time`/切档后必须 sleep≥1s 等下一帧 updateGodRays/喂 uniform 再断言，否则读到滞后状态（曾三次误判"效果为零"实为竞速+源出屏合法关闭）；④vite dev 期改文件会产生 `?t=` 时间戳——**eval 直连 `/src/xx.js` 与游戏图谱内的 `?t=` URL 是不同模块实例**（VoxelLightUniforms 双实例），测 uniform 必须从 Settings.js 源码正则提取真实 import URL 再 import；生产构建无此问题。
- **调参锚点**：泛光 0.65/0.9/0.5（阈值/强度/半径）；god rays 基础 0.35/月亮 0.12/衰减 0.93/24 采样；曝光 1.0（曾 1.12+强度1.0 组合致白天全屏泛白）；云影衰减 0.28；云色调制 0.35+0.5×day。
- **日落/日出白化修复（勿回退）**：完整档**直接隐藏 sunGlow 日晕 sprite**（`sky.sunGlow.visible = !full && sky.sun.visible`，基础/关闭档保持可见=现状）。根因两层：①sunGlow 是 scale 160(≈43°屏)加法混合 sprite，晨昏 opacity 爬到 0.9；②**晨昏天空亮度扫描区间(0.62-0.66)骑在泛光阈值上**且晨昏天空 r/g 占优不被蓝天掩除——任何加法叠加都推整片天过阈白化（t 0.27/0.71-0.76 两端对称曾真出；首版 ×0.3 衰减只治日落段，日出段仍白化）。太阳圆盘自身的泛光 halo 就是更好的日晕，体积光掩码也更干净（只从圆盘取源）。泛光/体积光放大"本来无害的加法 sprite"是通用模式，新增加法混合天体/粒子时同查一遍。

### 阶段 9 关键实现备忘（防回退）—— 方块材质重绘 + 发光区块重建崩溃修复

- **`ChunkMesh.js` 的 `yOff` 未定义曾致画面永久冻结（高危，勿删）**：light 面（发光方块 light≥13，如火把/荧石/岩浆/红石灯）顶点微抬引用的 `yOff` 曾从未定义——**含发光方块的 chunk 一旦重建即 `ReferenceError` → `Game.update` 抛错 → `Game.loop` 的 rAF 链断裂（`requestAnimationFrame` 不再排下一帧）→ 画面冻结且时间不走**。现已在 `build()` 作用域定义 `const yOff = 0.001`（顶面微抬防 z-fighting）。浏览器侧没有覆盖"放置发光方块后区块重建"的回归，排查"画面冻住"类问题先手动 `game.update(0.016)` 抓异常（`agent-browser console` 只显示 console.*，不捕获 pageerror）。
- **材质重绘结构**：`BlockDefs.js` 用 `makeTex/setPx/fillRect/rgb([r,g,b],f)/hash2` 像素画工具 + 三色噪声 `noiseTex`（基色为主 + 暗/亮碎点 + 轻微抖动）+ 2×2 斑驳 `blotchTex`，结构化图案（圆石砌块错位、石砖大砖受光边、红砖交错缝、木板拼条端缝、原木年轮、矿石晶簇高光/阴影点、TNT 白带字样、工作台网格、熔炉炉口、砂岩分层）按原版配色校准。注册名 / textures key / SVG 管线未变；`redstone_block` 双注册已清理（保留 light 0）。
- **水体纹理平铺**：`waterTex` 的波纹用 `sin(x*π/8 + y*π/4)`（16 的整数分频周期）保证世界坐标 RepeatWrapping 平铺无缝，勿改回非周期函数。
- **验证**：`node --check` + `npm run build`（45 模块）+ agent-browser 冒烟（创造物品栏一屏全图标核对 + 16 种方块阵列特写 + 摆放荧石后 `sky.time` 持续推进无冻结）。

### Idea-3B-② 网格构建 Worker 化批次备忘（防回退）

- **收集/装配分离（ChunkMesh.js）**：`_collectData(chunk)` 纯数据收集（只依赖 blocks/sky/blockL 三份本地缓存 + atlasUV + BlockRegistry + RenderQuality + chunk.cx/cz，与 world/Three 零耦合，worker 直接复用同一实现——同步与 worker 字节级一致由构造保证）；`assembleMeshes(out, chunk)` 主线程专用 THREE 装配；`build(chunk)` = 填缓存 → collect → assemble。**收集产出 typed arrays + portalCells 数组**（环境粒子发射点改由 build/apply 赋回 chunk）。
- **⚠️ 最高危坑：`geo.setIndex(原始 TypedArray)` 会被 three 0.160 原样存为 `geo.index`（不是 BufferAttribute）**，渲染期 WebGLAttributes 读 `attribute.array` → undefined → `byteLength` 崩溃 → **rAF 链断裂画面冻结且 loop 静默死亡**（`if (!this.running) return` 不重排，无 uncaught 日志表象）。原代码传 JS 数组走 `Array.isArray` 包装分支故无恙；改 typed arrays 后必须 `geo.setIndex(new THREE.BufferAttribute(g.index, 1))` 显式包装。三组（solid/water/light）都要。
- **体素光缓存（_skyCache/_blockLCache）**：`_fillLightCaches` 内部从 chunk.light 拆包、边界走 world.getSkyLight/getBlockLightAt（回退语义与旧 _skyAt/_blockLAt 逐值一致）；_skyAt/_blockLAt 改为纯缓存读——这是收集与 world 解耦的关键，勿改回直读 chunk/world。
- **派发协议（Game.js）**：`_dispatchMeshBuild` 填缓存 → `slice()` 三份副本（勿转移 builder scratch 本体）→ worker `build()`（transfer）→ 回执校验 `world.getChunk===chunk && _meshVersion===version` 后 `_applyMeshOut` 装配替换。**版本号 `_meshBuildSeq` 是 Game 全局单调序号**（跨 chunk 共享，比较只对同 chunk 自身旧值有意义）。`chunk._meshInFlight` 防重复派发；catch 置 `meshWorker.broken=true` 熔断 + 立即同步 build 兜底。rebuildDirtyChunks 预算 12ms 内可多次派发（每派发仅 ~1-2ms 缓存填充+拷贝，~20ms 收集已卸给 worker）。
- **MeshWorker init**：atlasUV 以 `[...map.entries()]` 传（worker `new Map()`），quality 随每次 build 传（视频设置改档 markAllDirty 后新派发自然带新值）。worker 端 ChunkMeshBuilder 以 `(null, null, atlasUV, null)` 构造（材质仅占位不渲染）。
- **验证锚点**：同区块 sync `_collectData` vs worker 回执**逐字节 identical**（solid/water/light + portalCells）；重进世界 169/169 meshed、errors 0、broken false；真实挖掘 → `_meshVersion` 前进 + `position.count` 变化 + dirty false。headless 帧率低时派发节奏慢是预算制正常表现（每帧多块按 12ms 预算推进）。

- **Build 7 手持物像素挤出**：`HeldItemMesh.extrudeSpriteGeometry` 替代物品/cross 的双面薄片——像素级小立方（alpha≥128 实体、只生成暴露面、depth 0.125 归一单位）。侧面 UV 用像素窄条（边缘色），前后全 UV。DoubleSide 保绕向容错；热点：`Y=(y)=>0.5-y/h` 行号翻转方向勿反（反了物品上下颠倒）。RemotePlayer 手持物（HeldItemMesh 共享缓存）自动受益。

### B28 方块材质批次备忘（定向面 + 多面纠偏，防回退）

- **问题面**：`textures: {top, side, bottom}` 只能表达"上下 vs 四周"，四个侧面天然同图——箱子锁扣、熔炉炉口、凋零头颅五官被画在**四个**侧面上（前后左右一模一样），另有一批方块把顶面图案铺满六面（耕地犁沟出现在侧面、信标四芒星出现在四面、音符盒圆盘出现在四面、活塞头六面同一张灰铁）。
- **定向面基础设施（三层，改动任一层都要同步另两层）**：
  1. `BlockRegistry.register`：解析 `textures.front` → `front`；`facing`（缺省 'n'）→ **`faceTex = {n,s,e,w}`**（facing 面 = front，其余 = side）；`icon = def.icon || front || side`（UI 图标要看得出正面）。
  2. `ChunkMesh`：`FACES[]` 增加 `key`（`'e'|'w'|'s'|'n'|null`），`faceTexName(def, face)` 统一取纹理键（cube 主路径 + `addBox` 形制路径共用）；无 `faceTex` 的方块走原 top/side/bottom 路径（零行为变化）。
  3. UI 图标链 7 处（Hotbar/InventoryScreen/ChestScreen/FurnaceScreen/TradeScreen/RecipeViewer/RemoteHotbarSprite）从 `block.side || block.top` 改为 `block.icon || block.side || block.top`。
- **状态 = ID 家族（沿用 B27/B26 模式）**：箱子 4 朝向、熔炉 4 朝向 × 未点燃/点燃、凋零头颅 4 朝向、红石灯 未充能/充能。命名 `<family>` = 朝北态本名（`chest`/`furnace`/`wither_skeleton_skull`/`redstone_lamp`，**旧存档·结构箱子·联机账本零迁移**），其余 `${family}_${facing}`；派生家族 `furnace_lit`（点燃朝北）/`furnace_lit_e`…。查询统一走 `blockShape.facingId(family, facing)` / `furnaceLitId(facing, lit)`。
- **⚠️ 新变体一律追加到 `BlockDefs.js` 文件末尾**：方块数字 ID = 注册顺序，存档与联机账本按数字落盘。B27 的门家族曾在文件中部展开，把其后所有方块 ID 整体推后（`note_block` 121→158 等），旧存档里的方块会变成别的东西；B28 起改为"本名原位、变体尾部追加"，`build28-block-textures.mjs` ①段有 ID 零漂移钉值断言（改注册顺序必炸）。
- **家族化判定（把 `def.name === X` 全部换成 `def.baseBlock === X`）**：`Game` 破坏（`_breakChest`/`_breakFurnace`）、右键开界面（箱子/熔炉）、`NetworkManager.applyRemoteBlock` 的 `wasChest` 清容器缓存、`RedstoneSystem` 的红石灯分支、凋灵召唤的 `isSkull()`（B30 轮 8 步 6 起 `_breakChest`/`_breakFurnace` 实现在 `src/player/Placement.js`，Game 侧仅同名门面）。**漏一处 = 该分支对非朝北态静默失效**（例如朝南的箱子被远端挖掉后容器缓存不清理）。
- **家族基名自身也要带 `baseBlock`**：B27 门/床家族的本名就带（`baseBlock: 'oak_door'`），B28 三家族照做——否则"朝北态"（最常见）会漏出家族判定。同时基名带 `facingBase`（仅基名带），放置路径据此换态。
- **掉落与工具门控的顺序陷阱**：`_blockDrops` 里 `if (def.baseBlock) return [{name: baseBlock}]` 曾排在 `minTier` 判定之前——熔炉 `minTier:1` 被短路后空手也能整块抱走。现顺序 = 潜影盒特判 → `minTier` 工具门控 → baseBlock 基础物品。中键取物（`_pickBlock`）同样要 `def.baseBlock || name` 映射，否则快捷栏会拿到 `chest_e` 这类不存在的物品。
- **熔炉点燃态（功能性视觉）**：`updateFurnaces` 按 `st.burnTime > 0` 边沿调 `_syncFurnaceLit(key, st)`（key = `World.furnaceKey` 的 `"x,y,z"`），只在与当前 `def.lit` 不同时 `setBlock` 换家族态（保留朝向），点燃态 `light:13` 走亮块管线 + 光照增量更新；**host/单机权威**（`const isClient = !!(this.networkMode && this.net && !this.net.isHost)`，与 `fluidSim.muted` 同款门控），客户端靠 `block_set` 广播收敛。**（B30 轮 8 步 6 起 `updateFurnaces`/`_syncFurnaceLit` 实现在 `src/player/Placement.js`，Game 侧仅同名门面；`World.furnaces` 状态表仍归 World，控制器零快照。）**
- **红石灯两态**：本名 = 未充能（`light: 0`，**此前恒亮 light:15、充能与否外观无差别**），`redstone_lamp_lit` = 充能（light 15）。`RedstoneSystem` 在充能边沿调 `setLampLit()`。已知边界：`poweredBlocks` 不持久化，重载存档后灯保持落盘时的态，直到附近红石有更新（与活塞/门的既有语义一致）。
- **多面纠偏清单（六面不再同图）**：耕地（顶犁沟/侧=泥土，**必须显式 `icon: 'farmland'`**——默认图标取 side 会变成一块土）、仙人掌（顶=放射棱/侧=竖棱刺）、西瓜（顶=瓜蒂同心纹/侧=条纹）、音符盒（顶=圆盘/侧=木框）、信标（顶=下界之星/侧=黑曜石+玻璃带/底=金角基座）、潜影盒（顶=同心壳板/侧=壳壁+扣饰/底=素壳）、活塞头（顶=木芯推板/侧=活塞臂/底=接缝）、砂岩/红砂岩/石英（顶=平滑面/侧=沉积层）。
- **纹理函数拆分纪律**：`pixelSvg(px)` 返回的是 **SVG 字符串**，同一族里"变体 = 基础图 + 叠加"必须拆成 `xxxPx(seed) → 像素数组` + `xxxTex(seed) = pixelSvg(xxxPx(seed))` 两层；直接对 `xxxTex()` 的返回值调 `setPx/fillRect` 会抛 `Cannot assign to read only property`（本批踩到 3 次）。
- **验证**：`tests/build28-block-textures.mjs`（210 断言：ID 零漂移 / 家族规模 / 白名单逐字段透传 / faceTex 四向解析 / ChunkMesh 六面 UV 实测 / 多面清单 / 全局 SVG 引用完整性 / 红石灯真机行为 / 源码绊线）；实机用 agent-browser 看箱锁扣朝向、熔炉炉口与点燃发光、头颅五官、灯亮灭、耕地侧面回到泥土。

## Build 29 批次（2026-09-25 交付）—— 方块图标类原版等轴三面化（BlockIcon 统一入口）

- **统一入口 `src/render/BlockIcon.js`**：`drawIconInto(ctx, size, name, resolveItemSvg, isStale)` 三级解析——物品 SVG 平铺 → 立方方块等轴三面（`getBlockIcon`）→ 其余方块单面平铺兜底。**新 UI 一律调它，禁止自绘方块图标链**；B28 的 `block.icon || block.side || block.top` 链收口为该文件导出的 `getFlatBlockSvg(name)`（全项目唯一出现处，`build29` 有"仅剩一处"绊线、`build28` 有"7 站均委托"绊线）。
- **等轴几何（32px 设计基准）**：菱形上顶点 (16,2)/左 (2,10)/右 (30,10)/前 (16,18)、侧棱高 14；`FACE_XFORMS` 三组矩阵按 16px 源图归一（0.875 = 14/16），`setTransform` 后直接 `drawImage`；`ctx.setTransform(1,0,0,1,0,0)` 复位勿漏（否则污染后续绘制）。面亮度沿用原版：top 1.0 / 左面（front）0.8 / 右面（side）0.6——箱子锁扣、熔炉炉口出现在左面且亮度比 top 低一档。
- **压暗必须 multiply + destination-in 两步**：只 `multiply` 会把透明像素填成灰块（火把/玻璃类贴图会糊出一整块方片），`destination-in` 用原图抠回 alpha 后再落笔。
- **缓存两层**：图标 canvas 按 `` `${name}@${size}` `` 存 **Promise**（并发首绘只建一次）；变暗贴图 `WeakMap<Image, Map<level, canvas>>`。二次绘制全同步。
- **形制判定 `isIsoBlock(def)`（ItemCategories.js 纯函数，node 可测）**：`renderType === 'cube'` 且无 `shape` 且非流体才等轴；cross/portal/flat、门/床/活板门（带 shape）→ 平铺 sprite（原版对非立方同样平铺）。`piston_head` 无 shape 也无形制特判，世界内就是整格立方 → 等轴是正确行为（曾误判为平铺，回归预期修正而非代码）。
- **7 个调用站委托**：Hotbar（`isStale = () => this._sig[i] !== sig` 延续防闪烁守卫语义，`iconCache`/`getIconSvg` 已删）；RemoteHotbarSprite 的 `getIcon` 先 `getBlockIcon(name, 32)`（canvas）再 `getIconSvg`（物品/非立方）兜底——`drawImage` 接受 canvas 源，绘制站零改动；ChestScreen/FurnaceScreen/TradeScreen/InventoryScreen/RecipeViewer 的 `drawIcon` 全部一行转发。
- **测试侧高坑**：node 套件里 `import ItemRegistry` 后 **必须副作用导入 `ItemDefs.js`**，否则 `getByName` 全空（同 worker 图陷阱，本批再踩一次）。
- **验证**：`tests/build29-rename-icons.mjs` 405 断言（iso 判定正反清单 / 全部 iso 方块三面贴图齐备 / 矩阵·亮度·multiply·缓存·isStale 绊线 / 7 站委托 / 旧链仅剩一处）；实机 agent-browser 热栏混合排布截图确认"立方等轴 + 床/火把平铺"同框正确、创造栏与 JEI 图标同步等轴。

## Build 39 批次（2026-10-24 交付）—— U-1 实体方块贪心合并（图集 UV 平铺）

- **合并位置**：`ChunkMeshBuilder._collectData` 内新增记录桶 + `_emitGreedyFaces`（`src/render/ChunkMesh.js`）。逐面直推的老路径**保持不变**，只把符合条件的普通立方体面改成「先记录、循环结束后合并输出」（合并四边形追加在直推顶点之后，顺序不影响渲染）。
- **合并判据（视觉等价的充分条件，勿放宽）**：四角 `(sky, blk, ao)` 必须**全等且四角互等**（即一张面上四角同值）。原因是合并四边形只有 4 个顶点：只要有一格带梯度，拉伸插值就与原逐格插值不同。**再排除流体与自发光面**（水面已有顶面贪心；自发光面与 light mesh 逐格共面）。放宽这条会直接产生光照/AO 错位。
- **切片与平面**：±X → slice=x/u=y/v=z，±Y → slice=y/u=x/v=z，±Z → slice=z/u=x/v=y（`GREEDY_AXIS`）。key = `u + v*uDim`，平面格数上界 256×16 = 4096（y 轴只会与 x 或 z 之一配对），scratch `_greedyPlane`/`_greedyUsed` 跨构建复用。
- **顶点属性 `aUvTile`（vec4 = u0, v0, repU, repV）**：未合并面填 `(u0, v0, 1, 1)`。**solid 几何里每个顶点都必须写满**——`uv` 属性语义未改（仍是图集子区域坐标），纹理平铺靠 `rep` + 片元 `fract`。漏写会让属性长度与顶点数错位（顶点属性整体移位，画面乱纹理），套件 ③ 段守这条。
- **片元采样（`ATLAS_TILED_MAP_GLSL`，替换 `#include <map_fragment>`）**：`tileLocal = fract((vMapUv - aUvTile.xy)/uAtlasSpan * rep * 0.999999)`，再 `texture2D(map, lo + tileLocal*uAtlasSpan)`。`0.999999` 压缩防 `fract(1.0)=0` 让四边形远边采到对侧纹素；`rep=(1,1)` 时退化为原采样。**勿改用 mipmap/线性过滤**——图集是 `NearestFilter` + `generateMipmaps=false`，开 mip 会让 `fract` 出现接缝。
- **`uAtlasSpan` 语义**：图集单 tile 跨度，由 `ChunkMeshBuilder` 构造期从 `atlasUV` 首项推导（`buildAtlas` 拼的是 `cols×rows` 等大格）。**若将来图集改成不等距格，这套平铺直接失效**。
- **Worker 路径零改动**：同步与 Worker 都只跑 `_collectData`，`MeshWorker` 按 `Object.values(g)` 枚举属性做 transfer，新增数组自动随转移——**勿把它改成写死列表**（套件 ⑤ 段绊线）。
- **调试开关 `RenderQuality.greedyMesh`**（默认 true）：`false` 时走逐面直推，用于同一场景前后对拍；不接视频设置面板。
- **实测收益**（seed 20260214，49 区块）：solid 顶点 −31.0%、四边形 −31.0%，`_collectData` 每区块 18.43 → 18.81 ms（+2.1%）。合并张数只占输出四边形 4% 左右，但每张平均覆盖约 26 张原四边形。

## Build 40 批次（2026-11-02 交付）—— B39 贪心合并贴图拉伸修复（u/v 轴写反）

- **症状**：大平原/斜地表的草方块顶面出现长条涂抹，纹理被各向异性拉伸（用户截图 `材质被异常拉伸`）。方形合并区（w=d）正常，所以 B39 的截图目视检查没抓到。
- **根因（`FACE_UV_AXIS`）**：顶点 UV 顺序是 `(u0,v0)(u0,v1)(u1,v0)(u1,v1)`，即**角0→角1 是纹理 v 方向、角0→角2 是纹理 u 方向**。B39 把两者写反（`u: axisOf(c0,c1)`、`v: axisOf(c0,c2)`），于是合并面的 `repU/repV` 互换。贪心先沿 u 轴（x 或 z）铺满再向 v 扩展，平坦地表极容易产出 **16×1 长条合并区** → 贴图被压成 16 倍细条、另一向拉成 16 倍长 → 就是画面里的长条纹。
- **修复**：`FACE_UV_AXIS` 改为 `u: axisOf(corners[0], corners[2])`、`v: axisOf(corners[0], corners[1])`。方形合并区前后逐像素相同（这是旧回归全绿的原因），非方形合并区恢复正常平铺。
- **判据（写测试时别复用 `FACE_UV_AXIS`）**：合并四边形的 `aUvTile.repU` 必须等于「顶点0→顶点2 的物理距离（格）」，`repV` 等于「顶点0→顶点1 的距离」。距离直接从已输出的 `position` 反推，是**独立 oracle**；`tests/build40-greedy-uv-axis.mjs` 用这条守 8×16 平板 / 浮空薄板六面 / 天光切分三组场景，回退到 B39 写法时 3 条断言必红。
- **顺带修 `RenderQuality.greedyMesh` 的 Worker 缺传**：`Game._dispatchMeshBuild` 的 quality 只下发 `smoothLighting/aoEnabled`，Worker 是**独立模块实例**、默认恒 true → 开关在游戏里其实无效（对拍时会出现"开了关看不出来"的假象）。现在 `greedyMesh` 随派发下发，`MeshWorker` 侧 `d.quality.greedyMesh !== false` 落地。**新增 RenderQuality 开关时必须同步这条链路**，否则主线程与 Worker 会各渲一套。
- **对拍方法（复现/验证用）**：worker 在跑时改主线程 `RenderQuality` 不生效——先 `game.world.meshWorker.broken = true` 熔断成同步构建，再 `world.markAllDirty()` 等重建，才能做同机位 A/B。实测：修复前 贪心 vs 逐面 同会话像素差 19.09%（可见拉伸），修复后 0.16%（残差为云影/天光时间差）。

## Build 41 批次（2026-11-02 交付）—— 皮肤六面纠偏 + legacy 转换 + 第一人称手臂

### 皮肤 UV（`src/entity/PlayerSkin.js` 的 `FACE_MAP`）

- **判据别靠肉眼，靠参考实现**：以 **skinview3d 3.4.2** 的 `setUVs` 为 oracle，把两边都折算成「角色空间角点（右/左·上/下·前/后）+ 面法线 → 图集像素」，逐点比对 **6 部件 × 6 面 × 4 角 = 144 点**。本项目模型面朝 -Z（角色右手 = +X）、参考实现面朝 +Z（右手 = -X），比对时把参考坐标按 `(x,z)→(-x,-z)` 折算、面法线表按 `['L','R','T','B','F','Bk']` 换算。
- **B41 前 72/144 不一致，全部在 back/top/bottom**：`back` 多翻了 u（后脑/后背左右镜像）、`top` 少翻 v（头顶前后颠倒）、`bottom` 多翻 v（底面颠倒）；right/left/front 本来就对——默认皮肤这几处多为对称纯色，所以自 B21 起一直没被肉眼发现。穷举 64 种翻转组合后**唯一零差异方案** = `top[U,V] / bottom[U] / back[无]`。**改这张表必须跑 `tests/build41-skin-uv.mjs`**（144 点钉值 + 旧表负控：回退时 72 点变红且全部落在 T/B/Bk）。
- **区域表本身是对的**：`partRects` 的 `(u,v,w,h,d)` 与 skinview3d 完全一致（含 slim 的 3px 臂宽、各 overlay 原点），不要动它。

### legacy 64×32 皮肤（`legacySkinOps` + `normalizeSkin`）

- **旧实现只把 y16..31 下移 16px**：左臂(32,48)/左腿(16,48) 的 base 与 overlay 仍是透明 → `transparent:false` 的材质把四肢渲染成**纯黑**（实测 8 个区域整面 alpha=0）。
- **现在的补位规则（纯数据算子，node 可测）**：① 左肢 base ← 右肢 base 的**几何镜像**（x→-x：±X 两面互换区域，六面全部水平翻转）；② overlay ← 自身 base 直拷（旧皮肤没有身体/四肢第二层数据）；③ **head 的 hat 区保持原样**——1.7 皮肤自带帽层数据 (32,0) 8×8，绝不能拿 base 顶替（否则头顶凭空多一层放大的头）。
- **执行顺序有依赖**：`'image'` 源算子（镜像左肢）必须全部排在 `'canvas'` 源算子（overlay 直拷）之前，因为左肢 base 是补出来的、overlay 要读它的结果。
- 回归：`tests/build41-legacy-skin.mjs`（覆盖/顺序/源边界/逐像素镜像语义/无空洞/尺寸判定）。

### 第一人称手臂（`src/render/FirstPersonHand.js`）

- **症状**：用户报「像'肩膀'在前，用'肩膀'交互」。探针实测：手臂盒长轴是 **Z**（0.16×0.16×0.42），但皮肤 armR 区域是按**长轴 Y** 画的，且六面共用同一块 `front` 区域、角序固定：
  - 顶面 py：v 沿 Z（比例 ✔）但**方向反** → 肩落远端、手落近端；
  - 侧面 px/nx：u 沿 Z（4px 铺满 0.42）、v 沿 Y（12px 压进 0.16）→ 横截面被沿臂长拉伸 2.6×；
  - 端盖 pz/nz：整条 4×12 压进 0.16 方盖。
- **修法**：几何改 `BoxGeometry(0.16, 0.42, 0.16)`（长轴 Y，与原版模型同构）→ 用 `PlayerSkin.buildPartBox('armR', model, {w, h: 0.42, d: 0.16})` 按 `FACE_MAP` 逐面写入（与第三人称**完全同源**，slim 用 0.12/3px）→ 整块绕 X 转 `π/2 + 0.55`：手（bottom 面）落远端、肩（top）落近端、臂正面（front）朝上。**别再用"六面同贴 front"的写法**，回归 `tests/build41-fp-arm-uv.mjs` 直接从顶点 `position`+`uv` 反推（六面区域/长轴/旋转后手在远端/正面朝上/负控）。
- **顺带两条**：① 手臂原本 95% 落在 75° 视锥外（B22 把截面从 0.25 缩到 0.16 后位置没跟着调），`basePos` 抬到 `(0.42, -0.30, -0.60)` 才真正进入视野——用户看到的"肩膀"就是原先那条边；② 手持物挂点从 `z=-0.10`（手掌外 0.2 格）移到 `z=0.12` 掌前，缩放 0.30 → 0.20 与手臂比例对齐。
