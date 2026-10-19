// PanoramaBake.js -- 全景图烘焙工具（dev，URL ?bake-panorama=1 触发）
// 在固定种子世界的单一机位，用 6 个 90° 方向各渲染一张 512²，导出 JPEG dataURL。
// 产物保存为 res/panorama/{px,nx,py,ny,pz,nz}.jpg，由 Panorama 播放器加载（贴 cubemap 球面旋转播放）。
// 烘焙时云层隐藏（播放器单独叠加动态云），体素光定格上午。
// Build 25 返工：机位回归"同一地点"（六面共享一个 center → cubemap 连续无分界），
// 选点改为多群系交界（蘑菇岛边缘优先入镜）；烘焙世界禁用结构生成 → 画面零建筑。
// 完整光照增强档（ACES+PostFX+真反射+太阳阴影，4 子项全开）沿用 Build 24 接线。
import * as THREE from 'three';
import { World } from '../core/World.js';
import { CHUNK_SIZE } from '../core/Chunk.js';
import { ChunkMeshBuilder } from './ChunkMesh.js';
import { Sky } from './Sky.js';
import { SVGTextures } from './SVGTextures.js';
import { BlockSVGDefinitions } from '../blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';
import { VoxelLightUniforms, GfxState, ShadowUniforms } from './VoxelLight.js';
import { PostFX } from './PostFX.js';
import { SunShadow } from './SunShadow.js';
import { Biomes } from '../world/biomes.js';

export const PANO_SIZE = 512;
const SEED = 20250903;
const RADIUS = 5;

// 六面拍摄方向（普通 2D 语义：up 正常，天在图上方；py/ny 特殊 up 由播放端 BoxGeometry UV 校准）
const FACES = [
  ['px', [1, 0, 0], [0, 1, 0]],
  ['nx', [-1, 0, 0], [0, 1, 0]],
  ['py', [0, 1, 0], [0, 0, -1]],
  ['ny', [0, -1, 0], [0, 0, 1]],
  ['pz', [0, 0, 1], [0, 1, 0]],
  ['nz', [0, 0, -1], [0, 1, 0]],
];

// 自上而下找第一格非空气（实际地表，含树/植被/雪层）
function surfaceTop(world, x, z) {
  for (let y = 110; y > 30; y--) {
    const id = world.getBlock(x, y, z);
    if (id !== 0) return { y, name: (BlockRegistry.getById(id) || {}).name || '' };
  }
  return { y: 40, name: '' };
}

// 群系机位纯函数扫描：从原点向外环形步进（步长 24），返回首个满足
// "本体+八向探针同群系、陆地、平整"的代表点（用于求蘑菇岛斑块锚点）。
function pickBiomeSpot(gen, biomeId, maxR = 6000, maxSlope = 10) {
  const probe = [[12, 0], [-12, 0], [0, 12], [0, -12], [8, 8], [-8, 8], [8, -8], [-8, -8]];
  for (let r = 0; r <= maxR; r += 24) {
    const steps = Math.max(1, Math.round((r * Math.PI * 2) / 24));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      if (gen.getBiome(x, z) !== biomeId) continue;
      const h = gen.getBaseHeight(x, z);
      if (h < 62 || h > 90) continue;
      let ok = true, minH = h, maxH = h;
      for (const [dx, dz] of probe) {
        if (gen.getBiome(x + dx, z + dz) !== biomeId) { ok = false; break; }
        const hh = gen.getBaseHeight(x + dx, z + dz);
        if (hh < 60) { ok = false; break; }
        minH = Math.min(minH, hh); maxH = Math.max(maxH, hh);
      }
      if (ok && maxH - minH <= maxSlope) return { x, z, h };
    }
  }
  return null;
}

// 单机位选点：找"多群系交界"——同一地点六面连续拍摄（cubemap 无分界）的前提下
// 让画面尽量覆盖多个群系。打分 = 群系多样性（24 探针 distinct）+ 蘑菇岛入镜优先
// + 陆地机位 + 距离近优先。纯函数，不生成区块。
const SPOT_PROBES = [];
for (const ring of [24, 48, 72]) {
  for (const [dx, dz] of [[ring, 0], [-ring, 0], [0, ring], [0, -ring],
    [ring * 0.71, ring * 0.71], [-ring * 0.71, ring * 0.71],
    [ring * 0.71, -ring * 0.71], [-ring * 0.71, -ring * 0.71]]) {
    SPOT_PROBES.push([Math.round(dx), Math.round(dz)]);
  }
}

function diversityScore(gen, x, z) {
  const set = new Set();
  for (const [dx, dz] of SPOT_PROBES) set.add(gen.getBiome(x + dx, z + dz));
  if (set.has(Biomes.MUSHROOM_FIELDS)) set.add('mushroom-bonus');
  return set.size;
}

function vantageOk(gen, x, z) {
  const h = gen.getBaseHeight(x, z);
  if (h < 62 || h > 84) return false; // 排除高山顶：雾中俯瞰只见远景轮廓，群系交界不可辨
  let minH = h, maxH = h;
  for (const [dx, dz] of [[12, 0], [-12, 0], [0, 12], [0, -12]]) {
    const hh = gen.getBaseHeight(x + dx, z + dz);
    if (hh < 60) return false;
    minH = Math.min(minH, hh); maxH = Math.max(maxH, hh);
  }
  return maxH - minH <= 10;
}

function pickPanoramaSpot(gen) {
  let best = null;
  const consider = (x, z, dist) => {
    if (!vantageOk(gen, x, z)) return;
    const h = gen.getBaseHeight(x, z);
    const score = diversityScore(gen, x, z) * 100 - dist - Math.max(0, h - 76) * 20; // 低地优先
    if (!best || score > best.score) best = { x, z, score };
  };
  // 阶段A：蘑菇岛斑块锚点（至多 4 个，互距 >256）
  const anchors = [];
  const mushroomMaxR = 6000;
  for (let r = 0; r <= mushroomMaxR && anchors.length < 4; r += 24) {
    const steps = Math.max(1, Math.round((r * Math.PI * 2) / 24));
    for (let i = 0; i < steps && anchors.length < 4; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      if (gen.getBiome(x, z) !== Biomes.MUSHROOM_FIELDS) continue;
      if (anchors.some(p => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < 256 * 256)) continue;
      anchors.push({ x, z });
    }
  }
  // 阶段B：各锚点周边 0~96 格找交界带（机位可站在斑块外的相邻群系上）
  for (const p of anchors) {
    for (let r = 0; r <= 96; r += 8) {
      const steps = Math.max(1, Math.round((r * Math.PI * 2) / 8));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        consider(Math.round(p.x + Math.cos(a) * r), Math.round(p.z + Math.sin(a) * r), r);
      }
    }
    if (best && best.score >= 500) break; // 已是高多样性交界（≥5 类），不再外扫
  }
  // 阶段C：无蘑菇交界时全局扫"普通多群系交界"（含水/河岸与群系边缘）
  if (!best || best.score < 300) {
    for (let r = 0; r <= 3000 && (!best || best.score < 300); r += 24) {
      const steps = Math.max(1, Math.round((r * Math.PI * 2) / 24));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        consider(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r), r);
      }
    }
  }
  // 阶段D：兜底普通平原机位
  if (!best) best = { x: 8, z: 8 };
  return best;
}

// 避水偏航：8 方向 × 3 距离采样实测地表，选水面占比最低的方向（水平面取景用）
function avoidWaterYaw(world, x0, z0) {
  let bestYaw = 0, bestW = Infinity;
  for (let k = 0; k < 8; k++) {
    const yaw = (k / 8) * Math.PI * 2;
    let w = 0;
    for (const r of [24, 40, 56]) {
      const sx = Math.round(x0 + Math.cos(yaw) * r), sz = Math.round(z0 + Math.sin(yaw) * r);
      if (surfaceTop(world, sx, sz).fluidType === 'water') w++;
    }
    if (w < bestW) { bestW = w; bestYaw = yaw; }
    if (w === 0) break;
  }
  return bestYaw;
}

// 构建烘焙场景（单机位一次成型）：禁结构 → 选点 → 加载 ±RADIUS → 建全部 mesh
async function buildWorldScene() {
  const scene = new THREE.Scene();
  const sky = new Sky(scene);
  // 雾在边缘前收掉：地形远端融进天色，遮住 ±80 格的世界边缘
  if (scene.fog) { scene.fog.near = 38; scene.fog.far = 90; }
  sky.time = 0.42; // 上午光线

  const world = new World(SEED);
  world.generator.structureManager.disabled = true; // 全景要求画面零建筑
  const allSvgs = { ...BlockSVGDefinitions, ...ItemSVGDefinitions };
  const { atlasTexture, atlasUV } = await SVGTextures.buildAtlas(allSvgs);
  let builder = null;
  try {
    const waterTexture = await SVGTextures.buildRepeatTexture(allSvgs['water'] || '', 'water');
    builder = new ChunkMeshBuilder(world, atlasTexture, atlasUV, waterTexture);

    console.log('[Bake] 阶段1: 图集完成(结构生成已禁用)');
    const spot = pickPanoramaSpot(world.generator);
    const cx0 = Math.floor(spot.x / CHUNK_SIZE), cz0 = Math.floor(spot.z / CHUNK_SIZE);
    let i = 0;
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      for (let dz = -RADIUS; dz <= RADIUS; dz++) {
        world.ensureChunk(cx0 + dx, cz0 + dz);
        if (++i % 4 === 0) await new Promise(r => setTimeout(r, 0));
      }
    }
    console.log('[Bake] 阶段2: 数据区块完成', world.chunks.size);
    // 相机架在脚下实测最高点上（±3 小范围；12 格探针已保证周边平整，大范围 max 会
    // 把远处的山体高度算进机位，导致"山顶俯瞰雾中远景"）
    let top = 0;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        top = Math.max(top, surfaceTop(world, spot.x + dx, spot.z + dz).y);
      }
    }
    const center = new THREE.Vector3(spot.x + 0.5, top + 6, spot.z + 0.5);
    const yaw = avoidWaterYaw(world, spot.x, spot.z);
    console.log('[Bake] 阶段3: 机位选定', spot.x, spot.z, '多样性分', spot.score, '避水yaw', yaw.toFixed(2));
    sky.clouds.visible = false;
    i = 0;
    for (const [, chunk] of world.chunks) {
      for (const key of ['mesh', 'waterMesh', 'lightMesh']) {
        if (chunk[key]) { scene.remove(chunk[key]); chunk[key].geometry.dispose(); chunk[key] = null; }
      }
      const meshes = builder.build(chunk);
      if (meshes.solid) { chunk.mesh = meshes.solid; scene.add(meshes.solid); }
      if (meshes.water) { chunk.waterMesh = meshes.water; scene.add(meshes.water); }
      if (meshes.light) { chunk.lightMesh = meshes.light; scene.add(meshes.light); }
      chunk.dirty = false;
      if (++i % 6 === 0) await new Promise(r => setTimeout(r, 0));
    }
    console.log('[Bake] 阶段4: mesh 完成');
    // 天空状态落地一次：skyMesh 颜色 / 雾色 / 太阳月亮位置 / sunTint 都在 update 里初始化
    sky.update(0.016, center);
    // 体素光定格上午
    VoxelLightUniforms.uDayLight.value = 0.10 + 0.90 * sky.getLightLevel();
    VoxelLightUniforms.uSunTint.value.copy(sky.sunTint);
    return { scene, sky, world, builder, atlasTexture, center, yaw };
  } catch (error) {
    for (const chunk of world.chunks.values()) {
      for (const key of ['mesh', 'waterMesh', 'lightMesh']) {
        if (!chunk[key]) continue;
        scene.remove(chunk[key]);
        chunk[key].geometry.dispose();
        chunk[key] = null;
      }
    }
    builder?.dispose();
    atlasTexture.dispose();
    throw error;
  }
}

// 渲染 6 面并返回 { faces: { px: dataURL, ... }, spot }
export async function bakePanorama(rendererWrapper) {
  const renderer = rendererWrapper.renderer; // Game.renderer 是封装类，THREE 实例在 .renderer
  const { scene, sky, world, builder, atlasTexture, center, yaw } = await buildWorldScene();
  const oldSize = new THREE.Vector2();
  let oldPixelRatio;
  let oldToneMapping;
  let oldShadowEnabled;
  try {
    const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 1000);
    // 完整档：体积光天体在 layer 1、反射排除层水面在 layer 2（与 Game 相机分层一致）
    camera.layers.enable(1);
    camera.layers.enable(2);
    renderer.getSize(oldSize);
    oldPixelRatio = renderer.getPixelRatio();
    oldToneMapping = renderer.toneMapping;
    oldShadowEnabled = renderer.shadowMap.enabled;
    renderer.setPixelRatio(1);
    renderer.setSize(PANO_SIZE, PANO_SIZE);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    console.log('[Bake] 完整档接线: ACES + PostFX + 真反射 + 太阳阴影');
    // ---- 光照增强完整档（4 子项全开）----
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    const postfx = new PostFX(renderer);          // 泛光 + 体积光 + 色彩分级（512² RT 同步尺寸）
    postfx.setSceneCamera(scene, camera);
    postfx.setEnabled(true);
    postfx.reflectionEnabled = true;              // 水面真反射（planar RT）
    const sunShadow = new SunShadow(renderer);
    sunShadow.init(sky.sunLight, scene);
    sunShadow.enabled = true;
    sunShadow.setReceive(true, world);
    GfxState.shadowReceive = true;
    // HDR 提亮供泛光取源（与 Game.update 完整档同参）：光源块 2.2 / 太阳盘 1.25；日晕隐藏
    GfxState.lightBoost = 2.2;
    builder.lightMaterial.color.setScalar(2.2);
    if (sky.sun) sky.sun.material.color.setScalar(1.25);
    if (sky.sunGlow) sky.sunGlow.visible = false;
    VoxelLightUniforms.uCloudShadow.value = 0;    // 云已隐藏（播放器动态叠加），云影关闭
    // 预热一帧：首次 shadow pass 建 map，之后 uShadowOn 生效、正式面全带影子
    sunShadow.update(center, 5);
    postfx.render(scene, camera);
    sunShadow.update(center, 5);
    ShadowUniforms.uShadowOn.value = sunShadow.ready ? 1 : 0;
    console.log('[Bake] 阶段5: 六面渲染开始 (shadow ready=' + sunShadow.ready + ')');
    const out = {};
    for (const [name, dir, up] of FACES) {
      camera.position.copy(center);
      camera.rotation.set(0, 0, 0);
      camera.up.set(up[0], up[1], up[2]);
      // 水平面按避水 yaw 绕 y 轴旋转各自的基准方向（四向保持正交）；py/ny 保持天顶/天底
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const d = dir[1] !== 0 ? dir : [dir[0] * cs + dir[2] * sn, 0, -dir[0] * sn + dir[2] * cs];
      camera.lookAt(center.x + d[0], center.y + d[1], center.z + d[2]);
      // 逐面刷新体积光投影与 shadow 相机（map 与矩阵同帧），PostFX 链完成反射/泛光/分级
      postfx.updateGodRays(sky, camera);
      sunShadow.update(center, 5);
      postfx.render(scene, camera);
      const gl = renderer.getContext();
      const px = new Uint8Array(PANO_SIZE * PANO_SIZE * 4);
      gl.readPixels(0, 0, PANO_SIZE, PANO_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const cv = document.createElement('canvas');
      cv.width = PANO_SIZE; cv.height = PANO_SIZE;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(PANO_SIZE, PANO_SIZE);
      for (let y = 0; y < PANO_SIZE; y++) {
        img.data.set(px.subarray(y * PANO_SIZE * 4, (y + 1) * PANO_SIZE * 4), (PANO_SIZE - 1 - y) * PANO_SIZE * 4);
      }
      ctx.putImageData(img, 0, 0);
      out[name] = cv.toDataURL('image/jpeg', 0.88);
      await new Promise(r => setTimeout(r, 0));
    }
    return { faces: out, spot: [center.x, center.y, center.z], yaw };
  } finally {
    if (oldPixelRatio !== undefined) {
      renderer.setPixelRatio(oldPixelRatio);
      renderer.setSize(oldSize.x, oldSize.y);
    }
    if (oldToneMapping !== undefined) renderer.toneMapping = oldToneMapping;
    if (oldShadowEnabled !== undefined) renderer.shadowMap.enabled = oldShadowEnabled;
    for (const chunk of world.chunks.values()) {
      for (const key of ['mesh', 'waterMesh', 'lightMesh']) {
        if (!chunk[key]) continue;
        scene.remove(chunk[key]);
        chunk[key].geometry.dispose();
        chunk[key] = null;
      }
    }
    builder.dispose();
    atlasTexture.dispose();
  }
}
