// VoxelLight.js -- 体素光着色注入：把天光/方块光顶点属性接入 MeshBasicMaterial
// 顶点属性 voxelLight = (skyL, blockL)，均归一化 0..1
// 最终亮度 = max(uSunTint * skyL * uDayLight, uTorchTint * blockL)，再抬底 uMinLight
// uniform 对象全局共享：每帧只改这里，所有区块材质同步生效，无需重建网格
//
// 光照视觉增强（视频设置「光照增强」档位，L1 批次）：
// - 云影（基础/完整档）：solid/water 采样 Sky.cloudTex，云格下的天空光乘衰减
//   （只衰减天空光分量，火把光不受影响）；映射与 Sky 云层 offset 同源：
//   cuv = ((W.x + wind)/1536 + 0.5, W.z/1536 + 0.5)
// - 水面反射（基础/完整档）：菲涅尔天空色混合 + 太阳/月亮镜面高光 +
//   方块光暖色倒影（夜晚岸边火把/岩浆光斑）+ 两轴正弦波纹扰动
// - 平面真反射（完整档子开关，L4-A）：PlanarReflection 渲镜像场景到 RT 后，
//   顶面反射项升级为真场景倒影采样（uReflOn=0 时自动回退上述天空色路径）
// 全部效果由 uniform 开关（uCloudShadow/uWaterFx/uReflOn），着色器编译一次，切换设置零重建；
// 关闭档 uniform 归零，画面与旧管线逐字节一致。
import * as THREE from 'three';

// 光照增强档位状态（供材质构造期读取；切档由 applySettings/Game.update 同步既有材质）
export const GfxState = {
  lightBoost: 1.0,        // 光源块提亮系数：仅"完整"档 1.9（泛光取源增益，需提过 0.72 阈），其余档 1.0 保持现状
  shadowReceive: false    // solid mesh receiveShadow 初值（完整档+太阳阴影子开关开时 true，SunShadow 批量切换）
};

// L4-B 太阳阴影（完整档子开关 gfxShadows）：three 0.160 的 materialNeedsLights()
// 不认 MeshBasicMaterial，lights shadow uniforms 不会被挂载（探针实证 directionalShadowMatrix
// 恒 0 矩阵）——三件套在 onBeforeCompile 手工挂载（共享引用），SunShadow.update 每帧从
// sunLight.shadow 同步值。uShadowMap 数组元素在 shadow pass 首帧后才就绪（ready 门控）。
export const ShadowUniforms = {
  uShadowOn: { value: 0 },        // 影子总开关 0/1（enabled ∧ ready，Game 每帧写）
  uShadowStrength: { value: 0.5 },// 影子最大压暗比例（批次②调校）
  uShadowMap: { value: [] },      // sampler2D[]（sunLight.shadow.map.texture）
  uShadowMatrix: { value: [ new THREE.Matrix4() ] },                       // shadow 光源投影矩阵
  uShadowPar: { value: [ { shadowBias: 0, shadowNormalBias: 0, shadowRadius: 1, shadowMapSize: new THREE.Vector2(2048, 2048) } ] }
};

export const VoxelLightUniforms = {  uDayLight: { value: 1.0 },                        // 天光昼夜系数（含夜晚月光底值）
  uSunTint: { value: new THREE.Color(1, 1, 1) },    // 天光染色（晨昏偏暖/夜晚偏冷）
  uMinLight: { value: 0.035 },                      // 最低环境亮度（纯黑洞穴留一点轮廓）
  uTorchTint: { value: new THREE.Color(1.0, 0.82, 0.58) }, // 方块光暖色
  // ---- 光照视觉增强（关闭档全部无效，保持现状画面） ----
  uTime: { value: 0 },                                     // 秒（暂停即冻结，波纹静止）
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },    // 指向太阳（归一化，Sky.sunLight.position）
  uSunColor: { value: new THREE.Color(1, 1, 1) },          // 太阳光色（晨昏暖/正午白，日落金光带）
  uSkyColor: { value: new THREE.Color(0.45, 0.7, 1.0) },   // 菲涅尔天空反射色（雾色，Sky.update 同步）
  uWind: { value: 0 },                                     // 云风偏移（Sky.wind，与云层纹理 offset 同源）
  uCloudTex: { value: null },                              // 云纹理（Sky 构造时注入）
  uCloudsY: { value: 140 },                                // 云层高度（高于此不吃云影，山巅/天域岛顶）
  uAtlasSpan: { value: new THREE.Vector2(1, 1) },           // B39：图集单 tile 跨度（片元 UV 平铺用，ChunkMeshBuilder 构造期写入）
  uCloudShadow: { value: 0 },                              // 云影开关 0/1（设置 ∧ 维度云显隐，Game 每帧写）
  uWaterFx: { value: 0 },                                  // 水面反射开关 0/1
  // ---- L4-A 平面真反射（完整档子开关，PlanarReflection 每帧写） ----
  uReflOn: { value: 0 },                                   // 反射 RT 就绪开关 0/1（0 = 走 L1 天空色回退）
  uReflMap: { value: null },                               // 反射场景 RT（半分辨率）
  uTexMatrix: { value: new THREE.Matrix4() }               // 世界坐标 → 反射 RT UV 投影
};

// 片元头：体素光 + 增强效果共用 uniform/varying 声明（未用到的会被编译器裁掉）
const FRAG_HEADER = [
  'varying vec2 vVoxelLight;',
  'varying vec3 vWorldPos;',
  'uniform float uDayLight;',
  'uniform vec3 uSunTint;',
  'uniform float uMinLight;',
  'uniform vec3 uTorchTint;',
  'uniform float uTime;',
  'uniform vec3 uSunDir;',
  'uniform vec3 uSunColor;',
  'uniform vec3 uSkyColor;',
  'uniform float uWind;',
  'uniform sampler2D uCloudTex;',
  'uniform float uCloudsY;',
  'uniform float uCloudShadow;',
  'uniform float uWaterFx;'
].join('\n');

// 云影：云格下天空光乘 0.72（与云纹理 alpha 阈值 0.60 对应，块状边界与可见云对齐）
const CLOUD_SHADOW_GLSL = [
  'float cloudShadowFactor() {',
  '  if (uCloudShadow < 0.5 || vWorldPos.y >= uCloudsY) return 1.0;',
  '  vec2 cuv = vec2((vWorldPos.x + uWind) / 1536.0 + 0.5, vWorldPos.z / 1536.0 + 0.5);',
  '  float ca = texture2D(uCloudTex, cuv).a;',
  '  return 1.0 - step(0.5, ca) * 0.28;',
  '}'
].join('\n');

// 体素光调制（solid/water 共用基础路径）
const VOXEL_LIGHT_GLSL = [
  '#include <color_fragment>',
  '{',
  '  vec3 skyC = uSunTint * (vVoxelLight.x * uDayLight);',
  '  skyC *= cloudShadowFactor();',
  '  vec3 torchC = uTorchTint * vVoxelLight.y;',
  '  vec3 lv = max(skyC, torchC);',
  '  lv = uMinLight + (1.0 - uMinLight) * lv;',
  '  diffuseColor.rgb *= lv;',
  '}'
].join('\n');

// 公共 uniform 挂载
function injectCommonUniforms(shader) {  shader.uniforms.uDayLight = VoxelLightUniforms.uDayLight;
  shader.uniforms.uSunTint = VoxelLightUniforms.uSunTint;
  shader.uniforms.uMinLight = VoxelLightUniforms.uMinLight;
  shader.uniforms.uTorchTint = VoxelLightUniforms.uTorchTint;
  shader.uniforms.uAtlasSpan = VoxelLightUniforms.uAtlasSpan;
  shader.uniforms.uTime = VoxelLightUniforms.uTime;
  shader.uniforms.uSunDir = VoxelLightUniforms.uSunDir;
  shader.uniforms.uSunColor = VoxelLightUniforms.uSunColor;
  shader.uniforms.uSkyColor = VoxelLightUniforms.uSkyColor;
  shader.uniforms.uWind = VoxelLightUniforms.uWind;
  shader.uniforms.uCloudTex = VoxelLightUniforms.uCloudTex;
  shader.uniforms.uCloudsY = VoxelLightUniforms.uCloudsY;
  shader.uniforms.uCloudShadow = VoxelLightUniforms.uCloudShadow;
  shader.uniforms.uWaterFx = VoxelLightUniforms.uWaterFx;
  shader.uniforms.uReflOn = VoxelLightUniforms.uReflOn;
  shader.uniforms.uReflMap = VoxelLightUniforms.uReflMap;
  shader.uniforms.uTexMatrix = VoxelLightUniforms.uTexMatrix;
  // L4-B 阴影三件套（uShadowMap/uShadowMatrix/uShadowPar）+ 开关（未用到的被编译器裁掉）
  shader.uniforms.uShadowOn = ShadowUniforms.uShadowOn;
  shader.uniforms.uShadowStrength = ShadowUniforms.uShadowStrength;
  shader.uniforms.directionalShadowMap = ShadowUniforms.uShadowMap;
  shader.uniforms.directionalShadowMatrix = ShadowUniforms.uShadowMatrix;
  shader.uniforms.directionalLightShadows = ShadowUniforms.uShadowPar;
}

// solid 材质的体素光融合 + L4-B 太阳阴影 + 太阳方向面着色：
// - 影子=太阳直射差：权重随天光 skyL 衰减，树冠下 skyL 低影子弱、洞穴自动无影，防双重变暗；
// - 方向着色：背光立面白天变暗且随太阳方向实时变化（山体/地形获得真实立体感；正午太阳近
//   头顶时所有立面 ndl→0 只剩环境分量，属物理正确）；太阳低于地平线渐隐(sunVis)、
//   夜晚(uShadowOn=0)/洞穴(skyL 低)自动无效果。方向项不依赖 shadow chunk（uShadowOn
//   是无条件声明的 uniform，基础/关闭档恒 0 = 逐字节现状）。
const VOXEL_LIGHT_SOLID_GLSL = [
  '#include <color_fragment>',
  '{',
  '  vec3 skyC = uSunTint * (vVoxelLight.x * uDayLight);',
  '  skyC *= cloudShadowFactor();',
  '  float sunVis = smoothstep(0.0, 0.08, normalize(uSunDir).y) * uShadowOn;',
  '  float ndl = max(dot(normalize(vNrmW), normalize(uSunDir)), 0.0);',
  '  skyC *= 1.0 - 0.40 * sunVis * (1.0 - ndl);',
  '  vec3 torchC = uTorchTint * vVoxelLight.y;',
  '  vec3 lv = max(skyC, torchC);',
  '  lv = uMinLight + (1.0 - uMinLight) * lv;',
  '  #ifdef USE_SHADOWMAP',
  '  if (uShadowOn > 0.5 && receiveShadow && vVoxelLight.x > 0.01) {',
  '    float sraw = getShadow(directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ]);',
  '    lv *= 1.0 - (1.0 - sraw) * vVoxelLight.x * uShadowStrength;',
  '  }',
  '  #endif',
  '  diffuseColor.rgb *= lv;',
  '}'
].join('\n');

// B39 U-1：图集 UV 平铺采样——实体方块贪心合并后一张四边形跨多格，片元按 aUvTile.zw 平铺。
// vMapUv 仍是图集子区域坐标（未合并面 rep=(1,1)，此式退化为原采样）；
// aUvTile = (u0, v0, repU, repV)，uAtlasSpan = 单 tile 在图集中的跨度（图集为等距网格，所有 tile 等大）。
// 0.999999 压缩：避免 fract(1.0)=0 让四边形远边采到对侧纹素。
const ATLAS_TILED_MAP_GLSL = [
  '#ifdef USE_MAP',
  '  vec2 tileLocal = ( vMapUv - vUvTile.xy ) / uAtlasSpan;',
  '  tileLocal = fract( tileLocal * vUvTile.zw * 0.999999 );',
  '  vec4 sampledDiffuseColor = texture2D( map, vUvTile.xy + tileLocal * uAtlasSpan );',
  '  diffuseColor *= sampledDiffuseColor;',
  '#endif'
].join('\n');

// solid 材质：体素光 + 云影 + 太阳阴影（L4-B）
// 阴影 vertex 侧：shadowmap_pars_vertex/shadowmap_vertex 是 three 原生 chunk（自带
// USE_SHADOWMAP 防护）；Basic 无 beginnormal/defaultnormal，手工补 objectNormal/
// transformedNormal（shadowmap_vertex 用 transformedNormal 计算 shadowNormalBias 偏移）。
export function applyVoxelLight(material) {
  material.onBeforeCompile = (shader) => {
    injectCommonUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 voxelLight;\nattribute vec4 aUvTile;\nvarying vec2 vVoxelLight;\nvarying vec4 vUvTile;\nvarying vec3 vWorldPos;\nvarying vec3 vNrmW;\n#include <shadowmap_pars_vertex>')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'vVoxelLight = voxelLight;',
        'vUvTile = aUvTile;',
        'vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        'vNrmW = normalize(mat3(modelMatrix) * normal);',
        'vec3 objectNormal = vec3( normal );',
        'vec3 transformedNormal = normalMatrix * objectNormal;'
      ].join('\n'))
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#include <shadowmap_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEADER + '\nvarying vec4 vUvTile;\nuniform vec2 uAtlasSpan;\nvarying vec3 vNrmW;\n' + CLOUD_SHADOW_GLSL + '\nuniform float uShadowOn;\nuniform float uShadowStrength;\n#include <packing>\nuniform bool receiveShadow;\n#include <shadowmap_pars_fragment>')
      .replace('#include <map_fragment>', ATLAS_TILED_MAP_GLSL)
      .replace('#include <color_fragment>', VOXEL_LIGHT_SOLID_GLSL);
  };
}

// water 材质：体素光 + 云影 + 水面反射（菲涅尔/太阳月亮高光/方块光倒影/波纹）
// 注入点在 #include <opaque_fragment> 之后、tonemapping/colorspace/fog 之前——
// 反射高光同样被雾衰减，深夜远景不会出现突兀亮点。
export function applyVoxelLightWater(material) {
  material.onBeforeCompile = (shader) => {
    injectCommonUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', [
        '#include <common>',
        'attribute vec2 voxelLight;',
        'varying vec2 vVoxelLight;',
        'varying vec3 vWorldPos;',
        'varying vec3 vNrmW;',
        'uniform mat4 uTexMatrix;',
        'varying vec4 vReflUv;'
      ].join('\n'))
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'vVoxelLight = voxelLight;',
        'vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        'vNrmW = normalize(mat3(modelMatrix) * normal);',
        'vReflUv = uTexMatrix * vec4(vWorldPos, 1.0);'
      ].join('\n'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEADER + '\nvarying vec3 vNrmW;\nuniform sampler2D uReflMap;\nuniform float uReflOn;\nvarying vec4 vReflUv;\n' + CLOUD_SHADOW_GLSL)
      .replace('#include <color_fragment>', VOXEL_LIGHT_GLSL)
      .replace('#include <opaque_fragment>', [
        '#include <opaque_fragment>',
        'if (uWaterFx > 0.5) {',
        '  vec3 V = normalize(cameraPosition - vWorldPos);',
        '  vec3 N0 = normalize(vNrmW);',
        '  float isTop = step(0.5, N0.y);',
        // 两轴正弦波纹扰动法线（uTime 暂停冻结；振幅 0.05 保持块状风格不碎）
        '  vec2 rip = vec2(',
        '    sin(vWorldPos.x * 1.9 + uTime * 1.7) + 0.6 * sin(vWorldPos.z * 3.1 - uTime * 2.3),',
        '    cos(vWorldPos.z * 2.3 + uTime * 1.3) + 0.6 * cos(vWorldPos.x * 2.7 + uTime * 1.9)',
        '  ) * 0.05;',
        '  vec3 N = mix(N0, normalize(vec3(rip.x, 1.0, rip.y)), isTop);',
        '  float ndv = max(dot(N0, V), 0.0);',
        '  float fresnel = pow(1.0 - ndv, 3.0);',
        // 反射色：L4-A 有反射 RT 时顶面用真场景倒影（波纹扰动采样 + 越界回退天空色），
        // 其余（关闭/基础档、水中、侧面）维持 L1 菲涅尔天空色
        '  vec3 reflC = uSkyColor;',
        '  if (uReflOn > 0.5 && isTop > 0.5) {',
        '    vec2 ruv = vReflUv.xy / max(vReflUv.w, 0.0001);',
        '    vec2 oob = max(abs(ruv) - vec2(1.0), vec2(0.0));',
        '    float fade = 1.0 - smoothstep(0.0, 0.06, oob.x + oob.y);',
        '    vec2 suv = clamp(ruv + rip * 0.02, vec2(0.0), vec2(1.0));',
        '    reflC = mix(uSkyColor, min(texture2D(uReflMap, suv).rgb, vec3(1.0)), fade);',
        '  }',
        // 菲涅尔混合：掠射角水面混入反射色（夜晚雾色即夜空色，自动变暗）
        '  gl_FragColor.rgb = mix(gl_FragColor.rgb, reflC, fresnel * 0.55);',
        // 太阳镜面高光（日照）+ 月亮镜面（夜，方向 = -uSunDir）
        '  vec3 sunD = normalize(uSunDir);',
        '  vec3 Hs = normalize(V + sunD);',
        '  float specS = pow(max(dot(N, Hs), 0.0), 160.0);',
        '  float sunVis = smoothstep(0.02, 0.10, sunD.y);',
        '  vec3 Hm = normalize(V - sunD);',
        '  float specM = pow(max(dot(N, Hm), 0.0), 220.0);',
        '  float moonVis = smoothstep(0.02, 0.10, -sunD.y);',
        // 方块光暖色倒影：vVoxelLight.y（顶点方块光）调制 glint，掠射角增强——
        // 夜晚岸边火把/岩浆在水面拉出暖色光斑
        '  vec3 Ht = normalize(V + vec3(0.15, 1.0, 0.1));',
        '  float glint = pow(max(dot(N, Ht), 0.0), 45.0);',
        '  float grazing = 0.35 + 0.65 * fresnel;',
        '  vec3 torchSpec = uTorchTint * vVoxelLight.y * glint * grazing * 1.4;',
        '  gl_FragColor.rgb += uSunColor * specS * sunVis * 1.1',
        '    + vec3(0.70, 0.76, 0.95) * specM * moonVis * 0.30',
        '    + torchSpec;',
        '}'
      ].join('\n'));
  };
}
