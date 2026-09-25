// ChunkMesh.js -- 区块网格构建（局部方块缓存 + 逐顶点 AO + 平滑体素光照 + 水面贪心合并）
import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { fluidInfo } from '../core/FluidSim.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from '../core/Chunk.js';
import { SVGTextures } from './SVGTextures.js';
import { applyVoxelLight, applyVoxelLightWater, GfxState } from './VoxelLight.js';

// 6 个面的方向定义：[dx, dy, dz]
const FACES = [
  { dir: [1, 0, 0], uvFace: 'side', key: 'e' },   // +X
  { dir: [-1, 0, 0], uvFace: 'side', key: 'w' },  // -X
  { dir: [0, 1, 0], uvFace: 'top', key: null },   // +Y
  { dir: [0, -1, 0], uvFace: 'bottom', key: null },// -Y
  { dir: [0, 0, 1], uvFace: 'side', key: 's' },   // +Z
  { dir: [0, 0, -1], uvFace: 'side', key: 'n' }   // -Z
];

// B28 逐面纹理键：定向面方块（箱子/熔炉/头颅…）按面方向取 faceTex，其余方块走 top/side/bottom。
function faceTexName(def, face) {
  if (def.faceTex && face.key && def.faceTex[face.key]) return def.faceTex[face.key];
  return def[face.uvFace] || def.side;
}

const faceCorners = [
  // +X
  [[1,0,0],[1,1,0],[1,0,1],[1,1,1]],
  // -X
  [[0,0,1],[0,1,1],[0,0,0],[0,1,0]],
  // +Y
  [[0,1,1],[1,1,1],[0,1,0],[1,1,0]],
  // -Y
  [[0,0,0],[1,0,0],[0,0,1],[1,0,1]],
  // +Z
  [[1,0,1],[1,1,1],[0,0,1],[0,1,1]],
  // -Z
  [[0,0,0],[0,1,0],[1,0,0],[1,1,0]]
];

// 光照系数（简单 AO：顶面最亮，底面最暗）
const FACE_LIGHT = [0.7, 0.7, 1.0, 0.5, 0.85, 0.85];

// AO 档位 → 顶点色乘子（0=无遮蔽，3=两侧+对角全遮蔽）
const AO_CURVE = [1.0, 0.8, 0.62, 0.45];

// 渲染质量开关（视频设置面板写入；改动后需 markAllDirty 重建区块网格生效）
export const RenderQuality = {
  smoothLighting: true,  // 平滑光照（四角取邻格均值）
  aoEnabled: true,       // 环境光遮蔽
};

// 逐面逐顶点的 AO 采样偏移（相对方块坐标）：[side1, side2, corner]
// 由 FACES + faceCorners 在模块加载时静态推导，热循环零分配
const AO_SAMPLES = FACES.map((face, f) => {
  const ax = face.dir[0] !== 0 ? 0 : (face.dir[1] !== 0 ? 1 : 2);
  const t1 = ax === 0 ? 1 : 0;
  const t2 = ax === 2 ? 1 : 2;
  return faceCorners[f].map((c) => {
    const o1 = c[t1] === 1 ? 1 : -1;
    const o2 = c[t2] === 1 ? 1 : -1;
    const mk = (u1, u2) => {
      const p = [face.dir[0], face.dir[1], face.dir[2]];
      p[t1] += u1;
      p[t2] += u2;
      return p;
    };
    return [mk(o1, 0), mk(0, o2), mk(o1, o2)];
  });
});

// 缓存尺寸：区块四周各垫 1 格（18×256×18），AO/剔除查表全走本地数组
const PAD = CHUNK_SIZE + 2; // 18

export class ChunkMeshBuilder {
  constructor(world, atlasTexture, atlasUV, waterTexture) {
    this.world = world;
    this.atlasTexture = atlasTexture;
    this.atlasUV = atlasUV;
    this.waterTexture = waterTexture;  // 独立水纹理（RepeatWrapping，世界坐标 UV）

    // 共享材质：跨区块复用（此前每次 build 新建材质且从不释放，存在泄漏）；
    // geometry 仍按区块创建/释放，材质生命周期与 builder 一致。
    // 体素光照接管方块明暗（天光×昼夜 + 方块光暖色），材质用 Basic 避开场景光二次照明
    this.solidMaterial = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      vertexColors: true,
      alphaTest: 0.1,
      transparent: false,
      side: THREE.FrontSide
    });
    applyVoxelLight(this.solidMaterial);
    this.waterMaterial = new THREE.MeshBasicMaterial({
      map: this.waterTexture,
      vertexColors: true,
      transparent: true,
      // 0.7 时"视线先后穿过两片分离水体"(近滩+远海)会叠出 ~91% 遮盖，远处水下被闷成
      // 纯蓝并呈现直线分界(实为浅滩等高线)。0.48 下双层 73%/单层 48%，全域可见水下。
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    // 水面用增强注入器：体素光基础上叠加菲涅尔/太阳月亮高光/方块光倒影/云影（uniform 开关）
    applyVoxelLightWater(this.waterMaterial);
    this.lightMaterial = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      side: THREE.FrontSide,
      alphaTest: 0.1,
    });
    // 光源块按档位提亮（GfxState.lightBoost：完整档 1.9 供泛光取源，其余档 1.0 现状）
    this.lightMaterial.color.setScalar(GfxState.lightBoost);

    // 局部方块缓存 scratch（跨构建复用，避免每帧分配 83KB）
    this._cache = new Uint8Array(PAD * CHUNK_HEIGHT * PAD);
    // B-②：体素光缓存（sky/block 各一份同尺寸）——光照采样收口本地查表，
    // 使数据收集与 world 解耦（worker 上下文可复用同一收集代码）
    this._skyCache = new Uint8Array(PAD * CHUNK_HEIGHT * PAD);
    this._blockLCache = new Uint8Array(PAD * CHUNK_HEIGHT * PAD);
    this._curChunk = null;
    this._opaqueLUT = new Uint8Array(256);
  }

  // 判断方块面是否可见
  isFaceVisible(cx, cy, cz, neighborGetter) {
    const b = neighborGetter(cx, cy, cz);
    if (b === 0) return true;
    const def = BlockRegistry.getById(b);
    if (!def) return false;
    // 流体且不透明（理论情况）遮挡视线，否则按 transparent 决定
    if (def.fluid) return def.transparent ? true : false;
    return def.transparent;
  }

  // 缓存索引：x,z ∈ -1..16，y ∈ 0..255（越界 y 由调用方处理）
  _cidx(x, y, z) {
    return (y * PAD + z + 1) * PAD + x + 1;
  }

  // 采样缓存方块（y 越界视为空气）
  _solidAt(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this._cache[(y * PAD + z + 1) * PAD + x + 1];
  }

  // 天光采样：B-② 起读本地光缓存（_fillLightCaches 已含边界 world 回退值，语义不变）
  _skyAt(x, y, z) {
    if (y >= CHUNK_HEIGHT) return 15;
    if (y < 0) return 0;
    return this._skyCache[(y * PAD + z + 1) * PAD + x + 1];
  }

  // 方块光采样（同上）
  _blockLAt(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this._blockLCache[(y * PAD + z + 1) * PAD + x + 1];
  }

  // 填充局部缓存：内部直接拷贝，边界查 world
  _fillCache(chunk) {
    const cache = this._cache;
    const blocks = chunk.blocks;
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    // 记录本次构建时缺失的边界邻居：缺失方向经 world.getBlock 拿到 0（空气），
    // 边界面会被多画（水柱整列侧面最明显，远看呈区块对齐的直线分界 CW-1）。
    // 仅主线程调用（worker 只跑 _collectData，不进此函数）；邻居就绪后由
    // World._finalizeChunk 读回此掩码反向触发重建
    if (this.world) {
      let edgeMask = 0;
      if (!this.world.getChunk(chunk.cx - 1, chunk.cz)) edgeMask |= 1;
      if (!this.world.getChunk(chunk.cx + 1, chunk.cz)) edgeMask |= 2;
      if (!this.world.getChunk(chunk.cx, chunk.cz - 1)) edgeMask |= 4;
      if (!this.world.getChunk(chunk.cx, chunk.cz + 1)) edgeMask |= 8;
      chunk._meshEdgeMask = edgeMask;
    }
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = -1; z <= CHUNK_SIZE; z++) {
        const rowBase = (y * PAD + z + 1) * PAD;
        if (z >= 0 && z < CHUNK_SIZE) {
          // 内部整行快速拷贝
          const src = (y * CHUNK_SIZE + z) * CHUNK_SIZE;
          cache.set(blocks.subarray(src, src + CHUNK_SIZE), rowBase + 1);
          // x 方向边界
          cache[rowBase] = this.world.getBlock(ox - 1, y, oz + z);
          cache[rowBase + PAD - 1] = this.world.getBlock(ox + CHUNK_SIZE, y, oz + z);
        } else {
          // z 方向边界整行（含四角）
          for (let x = -1; x <= CHUNK_SIZE; x++) {
            cache[rowBase + x + 1] = this.world.getBlock(ox + x, y, oz + z);
          }
        }
      }
    }
  }

  // 刷新不透明 LUT（与面剔除一致的遮挡定义：非 transparent 且非 fluid）
  _refreshOpaqueLUT() {
    const lut = this._opaqueLUT;
    for (let id = 1; id < 256; id++) {
      const def = BlockRegistry.getById(id);
      lut[id] = def && !def.transparent && !def.fluid ? 1 : 0;
    }
  }

  // B-②：填充体素光缓存——内部整片从 chunk.light 拆包，边界格走 world
  //（未加载区块的回退语义与旧 _skyAt/_blockLAt 逐值一致：露天 15 / 方块光 0）
  _fillLightCaches(chunk) {
    const skyC = this._skyCache;
    const blkC = this._blockLCache;
    const light = chunk.light;
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = -1; z <= CHUNK_SIZE; z++) {
        const rowBase = (y * PAD + z + 1) * PAD;
        if (z >= 0 && z < CHUNK_SIZE) {
          const src = (y * CHUNK_SIZE + z) * CHUNK_SIZE;
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const li = light[src + x];
            skyC[rowBase + 1 + x] = li >> 4;
            blkC[rowBase + 1 + x] = li & 15;
          }
          // x 方向边界
          skyC[rowBase] = this.world.getSkyLight(ox - 1, y, oz + z);
          skyC[rowBase + PAD - 1] = this.world.getSkyLight(ox + CHUNK_SIZE, y, oz + z);
          blkC[rowBase] = this.world.getBlockLightAt(ox - 1, y, oz + z);
          blkC[rowBase + PAD - 1] = this.world.getBlockLightAt(ox + CHUNK_SIZE, y, oz + z);
        } else {
          // z 方向边界整行（含四角）
          for (let x = -1; x <= CHUNK_SIZE; x++) {
            skyC[rowBase + x + 1] = this.world.getSkyLight(ox + x, y, oz + z);
            blkC[rowBase + x + 1] = this.world.getBlockLightAt(ox + x, y, oz + z);
          }
        }
      }
    }
  }

  build(chunk) {
    this._curChunk = chunk;
    this._fillCache(chunk);
    this._fillLightCaches(chunk);
    this._refreshOpaqueLUT();
    return this.assembleMeshes(this._collectData(chunk), chunk);
  }

  // B-②：纯数据收集——只依赖本地缓存（blocks/sky/blockL）、atlasUV、BlockRegistry、
  // RenderQuality 与 chunk.cx/cz，与 world/Three 完全解耦（worker 上下文直接复用）。
  // 返回 typed arrays（solid/water/light 三组，空组为 null）+ 环境粒子发射点。
  _collectData(chunk) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const colors = [];
    const voxLight = []; // solid 顶点体素光 (skyL, blockL) 归一化
    let idx = 0;
    const portalCells = []; // 环境粒子发射点（M3）：与方块数据天然同步

    const waterPositions = [];
    const waterNormals = [];
    const waterUvs = [];
    const waterIndices = [];
    const waterColors = [];
    const waterVoxLight = [];
    let wIdx = 0;

    const lightPos = [];
    const lightNorm = [];
    const lightUv = [];
    const lightIdx = [];
    const lightCol = [];
    let lIdx = 0;

    // 收集水面方块（顶面暴露空气的水方块），用于贪心合并
    const waterTops = [];

    // 发光面（light mesh）顶点微抬量：避免与 solid 面共面深度冲突（z-fighting）。
    // 此前主循环内联的 light 面直接引用 yOff 但从未定义——含发光方块（火把/荧石等）
    // 的 chunk 一旦重建就 ReferenceError，rAF 链断裂画面冻结（阶段 9 修复）。
    const yOff = 0.001;

    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = this._solidAt(x, y, z);
          if (id === 0) continue;
          const def = BlockRegistry.getById(id);
          if (!def) continue;
          if (def.ambientParticles) {
            portalCells.push(x, y, z);
          }
          if (def.renderType === 'portal') {
            // 传送门薄片：门面方向按水平邻格推断，相邻门格薄片共面连成整幕（无 cross 对角锯齿）。
            // 只画 light mesh 一份（portal light:13 自发光幕，昼夜恒亮、原版语义）——
            // 若 solid+light 双份共面，斜视角深度精度不足会 z-fighting 出三角干涉纹。
            if (def.light >= 13) {
              lIdx = this.addPortalPane(lightPos, lightNorm, lightUv, lightCol, lightIdx, x, y, z, def, lIdx, null);
            }
            continue;
          }
          if (def.renderType === 'cross') {
            // addCross 画 2 交叉面共 8 顶点并返回推进后索引——调用处必须接收返回值，
            // 否则 cross 之后所有方块的顶点索引整体错位 4（曾真出，见 AGENTS.md 渲染批次备忘）。
            idx = this.addCross(positions, normals, uvs, colors, indices, x, y, z, def, idx, voxLight);
            if (def.light >= 13) {
              lIdx = this.addCross(lightPos, lightNorm, lightUv, lightCol, lightIdx, x, y, z, def, lIdx, null);
            }
            continue;
          }
          if (def.renderType === 'flat') {
            // 水平薄板（睡莲）：单顶面微抬于格顶，正反双面索引（水下仰视可见）
            idx = this.addFlat(positions, normals, uvs, colors, indices, x, y, z, def, idx, voxLight);
            if (def.light >= 13) {
              lIdx = this.addFlat(lightPos, lightNorm, lightUv, lightCol, lightIdx, x, y, z, def, lIdx, null);
            }
            continue;
          }
          if (def.shape) {
            // B27 形制方块（门/床/活板门）：格内 AABB 盒渲染（无 AO，四角取自身格光）
            idx = this.addBox(positions, normals, uvs, colors, indices, x, y, z, def, idx, voxLight);
            continue;
          }

          const isWater = def.fluid && def.fluidType === 'water';
          const hasLight = def.light >= 13 && !isWater;
          // B26 M2 部分水位：上方同型流体（下落柱）→ 满高；否则按等级 (8-level)/9（源 8/9）
          const fluidH = def.fluid ? this._fluidHeightAt(x, y, z, def) : 1;
          const targetPos = isWater ? waterPositions : positions;
          const targetNorm = isWater ? waterNormals : normals;
          const targetUv = isWater ? waterUvs : uvs;
          const targetCol = isWater ? waterColors : colors;
          const targetIdx = isWater ? waterIndices : indices;
          let curIdx = isWater ? wIdx : idx;

          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];
            const neighborId = this._solidAt(nx, ny, nz);
            const neighborDef = BlockRegistry.getById(neighborId);

            // 面剔除
            if (neighborDef && !neighborDef.transparent && !neighborDef.fluid) continue;
            // 同型流体相邻：顶/底面剔除（垂直重叠）；侧面仅同高剔除（不同高画台阶侧壁）
            if (def.fluid && neighborDef && neighborDef.fluid && neighborDef.fluidType === def.fluidType) {
              if (f === 2 || f === 3) continue;
              if (this._fluidHeightAt(nx, ny, nz, neighborDef) === fluidH) continue;
            }
            // 非水方块相邻流体：流体透明（水/岩浆）时绘制其面，否则剔除
            if (!isWater && neighborDef && neighborDef.fluid && !neighborDef.transparent) continue;

            // 水面（顶面）单独收集，贪心合并绘制（带水位高度供分层合并）
            if (isWater && f === 2) {
              waterTops.push(x, y, z, fluidH);
              continue;
            }

            const texName = faceTexName(def, face);
            const uv = this.atlasUV.get(texName) || { u0: 0, v0: 0, u1: 1, v1: 1 };
            const corners = faceCorners[f];
            const faceLight = FACE_LIGHT[f];

            // 逐顶点 AO + 平滑体素光照：面外相邻层的 侧1/侧2/对角 三格
            const a = [0, 0, 0, 0];
            const skyV = [0, 0, 0, 0];
            const blkV = [0, 0, 0, 0];
            if (!isWater) {
              const lut = this._opaqueLUT;
              const samples = AO_SAMPLES[f];
              // 面邻格（N）光值为平滑基准
              const nSky = this._skyAt(nx, ny, nz);
              const nBlk = this._blockLAt(nx, ny, nz);
              if (RenderQuality.smoothLighting || RenderQuality.aoEnabled) {
                for (let c = 0; c < 4; c++) {
                  const s = samples[c];
                  const s1 = lut[this._solidAt(x + s[0][0], y + s[0][1], z + s[0][2])];
                  const s2 = lut[this._solidAt(x + s[1][0], y + s[1][1], z + s[1][2])];
                  const cc = lut[this._solidAt(x + s[2][0], y + s[2][1], z + s[2][2])];
                  a[c] = RenderQuality.aoEnabled ? ((s1 && s2) ? 3 : s1 + s2 + cc) : 0;
                  if (RenderQuality.smoothLighting) {
                    // 平滑光照均值：N 必算，不透明格不参与，两侧全挡时对角也不参与
                    let skySum = nSky, blkSum = nBlk, cnt = 1;
                    if (!s1) { skySum += this._skyAt(x + s[0][0], y + s[0][1], z + s[0][2]); blkSum += this._blockLAt(x + s[0][0], y + s[0][1], z + s[0][2]); cnt++; }
                    if (!s2) { skySum += this._skyAt(x + s[1][0], y + s[1][1], z + s[1][2]); blkSum += this._blockLAt(x + s[1][0], y + s[1][1], z + s[1][2]); cnt++; }
                    if (!cc && !(s1 && s2)) { skySum += this._skyAt(x + s[2][0], y + s[2][1], z + s[2][2]); blkSum += this._blockLAt(x + s[2][0], y + s[2][1], z + s[2][2]); cnt++; }
                    skyV[c] = skySum / cnt / 15;
                    blkV[c] = blkSum / cnt / 15;
                  } else {
                    skyV[c] = nSky / 15;
                    blkV[c] = nBlk / 15;
                  }
                }
              } else {
                // 平滑光照与 AO 全关：四角统一取面邻格光
                for (let c = 0; c < 4; c++) { skyV[c] = nSky / 15; blkV[c] = nBlk / 15; }
              }
            } else {
              // 水侧面：取面邻格光
              const nSky = this._skyAt(nx, ny, nz) / 15;
              const nBlk = this._blockLAt(nx, ny, nz) / 15;
              skyV[0] = skyV[1] = skyV[2] = skyV[3] = nSky;
              blkV[0] = blkV[1] = blkV[2] = blkV[3] = nBlk;
            }
            const targetLight = isWater ? waterVoxLight : voxLight;

            // 顶点色 = 面向系数 × AO；AO 各向异性时翻转对角线避免暗色斜纹
            for (let c = 0; c < 4; c++) {
              const [cx, cy, cz] = corners[c];
              const vy = (def.fluid && cy === 1) ? fluidH : cy; // 流体顶边降到部分水位
              targetPos.push(x + cx, y + vy, z + cz);
              targetNorm.push(face.dir[0], face.dir[1], face.dir[2]);
              const l = faceLight * AO_CURVE[a[c]];
              targetCol.push(l, l, l);
              targetLight.push(skyV[c], blkV[c]);
            }
            // UV：水面/侧面/底面使用世界坐标平铺（1 unit per tile，RepeatWrapping）
            // 非水方块用图集子区域
            if (isWater) {
              const offX = chunk.cx * CHUNK_SIZE;
              const offZ = chunk.cz * CHUNK_SIZE;
              for (let c = 0; c < 4; c++) {
                const [cx, cy, cz] = corners[c];
                let u, v;
                const vy = (cy === 1) ? fluidH : cy; // 流体顶边 UV 随水位
                if (f === 0 || f === 1) {
                  // +X/-X 面：沿 z 走 u，沿 y 走 v
                  u = z + cz + offZ;
                  v = y + vy;
                } else if (f === 4 || f === 5) {
                  // +Z/-Z 面：沿 x 走 u，沿 y 走 v
                  u = x + cx + offX;
                  v = y + vy;
                } else {
                  // -Y 底面：沿 x 走 u，沿 z 走 v
                  u = x + cx + offX;
                  v = z + cz + offZ;
                }
                waterUvs.push(u, v);
              }
            } else {
              // 图集 UV：顶点顺序为 [底,顶,底,顶]，让方块顶部对应纹理 v=v1（SVG 顶部）
              targetUv.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v0, uv.u1, uv.v1);
            }
            // 索引（AO 各向异性时换对角线：v1-v2 ↔ v0-v3，绕向不变）
            if (!isWater && a[1] + a[2] > a[0] + a[3]) {
              targetIdx.push(curIdx, curIdx + 1, curIdx + 3, curIdx, curIdx + 3, curIdx + 2);
            } else {
              targetIdx.push(curIdx, curIdx + 1, curIdx + 2, curIdx + 2, curIdx + 1, curIdx + 3);
            }
            curIdx += 4;

            if (hasLight) {
              for (let c = 0; c < 4; c++) {
                const [cx, cy, cz] = corners[c];
                lightPos.push(x + cx, y + (cy === 1 ? fluidH + yOff : 0), z + cz);
                lightNorm.push(face.dir[0], face.dir[1], face.dir[2]);
              }
              lightUv.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v0, uv.u1, uv.v1);
              lightIdx.push(lIdx, lIdx + 1, lIdx + 2, lIdx + 2, lIdx + 1, lIdx + 3);
              lIdx += 4;
            }
          }
          if (isWater) wIdx = curIdx; else idx = curIdx;
        }
      }
    }

    // 贪心合并水面（顶面），消除网格分界
    wIdx = this._mergeWaterTops(waterTops, waterPositions, waterNormals, waterUvs, waterColors, waterVoxLight, waterIndices, wIdx, chunk);

    // 转 typed arrays（transferable；索引按需选 16/32 位省内存）
    const pack = (pos, norm, uv, col, vl, ind, maxIdx) => ({
      position: new Float32Array(pos),
      normal: new Float32Array(norm),
      uv: new Float32Array(uv),
      color: new Float32Array(col),
      voxelLight: new Float32Array(vl),
      index: maxIdx > 65535 ? new Uint32Array(ind) : new Uint16Array(ind),
    });
    return {
      portalCells,
      solid: positions.length ? pack(positions, normals, uvs, colors, voxLight, indices, idx) : null,
      water: waterPositions.length ? pack(waterPositions, waterNormals, waterUvs, waterColors, waterVoxLight, waterIndices, wIdx) : null,
      light: lightPos.length ? {
        position: new Float32Array(lightPos),
        normal: new Float32Array(lightNorm),
        uv: new Float32Array(lightUv),
        index: lIdx > 65535 ? new Uint32Array(lightIdx) : new Uint16Array(lightIdx),
      } : null,
    };
  }

  // B-②：typed arrays → THREE 网格装配（仅主线程；worker 回执与同步 build 共用）
  assembleMeshes(out, chunk) {
    const meshes = {};
    if (out.solid) {
      const g = out.solid;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.color, 3));
      geo.setAttribute('voxelLight', new THREE.Float32BufferAttribute(g.voxelLight, 2));
      // setIndex(原始 TypedArray) 会被 three 原样存为 geo.index（非 BufferAttribute），
      // 渲染期读 attribute.array 崩溃——必须显式包一层 BufferAttribute
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      meshes.solid = new THREE.Mesh(geo, this.solidMaterial);
      meshes.solid.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
      // L4-B 太阳阴影：cast 恒定（关闭档 shadowMap.enabled=false 时 shadow pass 不跑，零成本）；
      // receive 按档位初值（GfxState.shadowReceive，开关切换由 SunShadow.setReceive 批量同步）
      meshes.solid.castShadow = true;
      meshes.solid.receiveShadow = GfxState.shadowReceive;
    }
    if (out.water) {
      const g = out.water;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.color, 3));
      geo.setAttribute('voxelLight', new THREE.Float32BufferAttribute(g.voxelLight, 2));
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      meshes.water = new THREE.Mesh(geo, this.waterMaterial);
      meshes.water.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
      // 双挂 layer 0+2：主相机可见；L4-A 反射相机 mask 排除 2 → 水面不入反射（防自反射递归）
      meshes.water.layers.enable(2);
    }
    if (out.light) {
      const g = out.light;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      meshes.light = new THREE.Mesh(geo, this.lightMaterial);
      meshes.light.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    }
    return meshes;
  }

  // B26 M2：流体格水面高度——上方同型流体（下落柱）满高，否则 (8-等级)/9（源 8/9，最弱 1/9）
  _fluidHeightAt(x, y, z, def) {
    const aboveDef = BlockRegistry.getById(this._solidAt(x, y + 1, z));
    if (aboveDef && aboveDef.fluid && aboveDef.fluidType === def.fluidType) return 1;
    const info = fluidInfo(this._solidAt(x, y, z));
    return (8 - (info ? info.level : 0)) / 9;
  }

  // 贪心合并水面顶面，消除方块边界网格（B26 M2：按 y + 水位高度分层，仅同高合并）
  _mergeWaterTops(waterTops, wPos, wNorm, wUv, wCol, wVLight, wIdx, startIdx, chunk) {
    if (waterTops.length === 0) return startIdx;
    const offX = chunk.cx * CHUNK_SIZE;
    const offZ = chunk.cz * CHUNK_SIZE;

    // 按 (y, 高度) 分层：不同水位不合并（高度值离散来自同一确定性函数，取整作 key 安全）
    const layers = new Map();
    for (let i = 0; i < waterTops.length; i += 4) {
      const x = waterTops[i], y = waterTops[i + 1], z = waterTops[i + 2], h = waterTops[i + 3];
      const key = y * 16 + Math.round(h * 16);
      if (!layers.has(key)) layers.set(key, { y, h, coords: [] });
      layers.get(key).coords.push(x, z);
    }

    let idx = startIdx;
    for (const { y, h, coords } of layers.values()) {
      // 构建该层的 boolean grid
      const grid = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
      for (let i = 0; i < coords.length; i += 2) {
        grid[coords[i] + coords[i + 1] * CHUNK_SIZE] = 1;
      }
      const merged = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          if (!grid[x + z * CHUNK_SIZE] || merged[x + z * CHUNK_SIZE]) continue;
          // 向右扩展
          let w = 1;
          while (x + w < CHUNK_SIZE && grid[(x + w) + z * CHUNK_SIZE] && !merged[(x + w) + z * CHUNK_SIZE]) w++;
          // 向下扩展
          let d = 1;
          outer: for (let zz = z + 1; zz < CHUNK_SIZE; zz++) {
            for (let xx = x; xx < x + w; xx++) {
              if (!grid[xx + zz * CHUNK_SIZE] || merged[xx + zz * CHUNK_SIZE]) break outer;
            }
            d++;
          }
          // 标记已合并
          for (let zz = z; zz < z + d; zz++) {
            for (let xx = x; xx < x + w; xx++) {
              merged[xx + zz * CHUNK_SIZE] = 1;
            }
          }
          // 生成 quad（4 顶点，水面在 y + h）
          const sy = y + h;
          const x0 = x, x1 = x + w, z0 = z, z1 = z + d;
          wPos.push(x0, sy, z0, x0, sy, z1, x1, sy, z0, x1, sy, z1);
          wNorm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
          wCol.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
          // 顶点体素光：取每角上方格（空气）的光
          const cornerL = (cxr, czr) => {
            wVLight.push(this._skyAt(cxr, y + 1, czr) / 15, this._blockLAt(cxr, y + 1, czr) / 15);
          };
          cornerL(x0, z0); cornerL(x0, z1); cornerL(x1, z0); cornerL(x1, z1);
          // UV：world-space 平铺，每世界单位 1 tile（水纹理 RepeatWrapping）
          // 顶点顺序 (x0,z0)(x0,z1)(x1,z0)(x1,z1) 对应 UV (u0,v0)(u0,v1)(u1,v0)(u1,v1)
          wUv.push(x0 + offX, z0 + offZ, x0 + offX, z1 + offZ, x1 + offX, z0 + offZ, x1 + offX, z1 + offZ);
          wIdx.push(idx, idx + 1, idx + 2, idx + 2, idx + 1, idx + 3);
          idx += 4;
        }
      }
    }
    return idx;
  }

  // 传送门薄片渲染（renderType 'portal'）：竖直满格薄片，门面法线取"宽度方向"的正交轴——
  // 水平邻格存在同类型门方块 → 门沿该方向延展 → 薄片位于正交轴的 0.5 平面，
  // 相邻门格薄片共面无缝拼合（替代旧 cross 对角双面：斜视角半透明锯齿 + FrontSide 背面整面消失）。
  // 薄片画正反两组索引（材质 FrontSide，双向可见）。孤立格（四周无门格）退化画正交双片。
  // 返回推进后的顶点索引。voxLight 非空时写入自身格光照（light mesh 传 null 跳过）。
  addPortalPane(positions, normals, uvs, colors, indices, x, y, z, def, idx, voxLight) {
    const isPortal = (lx, ly, lz) => {
      const d = BlockRegistry.getById(this._solidAt(lx, ly, lz));
      return !!(d && d.renderType === 'portal');
    };
    const alongX = isPortal(x + 1, y, z) || isPortal(x - 1, y, z);
    const alongZ = isPortal(x, y, z + 1) || isPortal(x, y, z - 1);
    // 门沿 x 延展 → 法线 z（薄片 z=0.5）；沿 z 延展 → 法线 x（薄片 x=0.5）；孤立 → 双片
    const panes = alongX ? ['z'] : alongZ ? ['x'] : ['z', 'x'];
    const texName = def.side;
    const uv = this.atlasUV.get(texName) || { u0: 0, v0: 0, u1: 1, v1: 1 };
    const skyL = voxLight ? this._skyAt(x, y, z) / 15 : 0;
    const blkL = voxLight ? this._blockLAt(x, y, z) / 15 : 0;
    for (const axis of panes) {
      const corners = axis === 'z'
        ? [[0, 0, 0.5], [0, 1, 0.5], [1, 0, 0.5], [1, 1, 0.5]]
        : [[0.5, 0, 0], [0.5, 1, 0], [0.5, 0, 1], [0.5, 1, 1]];
      for (const [cx, cy, cz] of corners) {
        positions.push(x + cx, y + cy, z + cz);
        normals.push(0, 1, 0);
        colors.push(1, 1, 1);
        if (voxLight) voxLight.push(skyL, blkL);
      }
      uvs.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v0, uv.u1, uv.v1);
      indices.push(idx, idx + 1, idx + 2, idx + 2, idx + 1, idx + 3); // 正面组（-z 侧可见）
      indices.push(idx, idx + 2, idx + 1, idx + 2, idx + 3, idx + 1); // 反面组（+z 侧可见，两三角均 CCW）
      idx += 4;
    }
    return idx;
  }

  // 十字形渲染（火把/花）；voxLight 非空时写入自身格光照（发光体 light mesh 传 null 跳过）。
  // 返回推进后的顶点索引（2 交叉面共 8 顶点）。
  addCross(positions, normals, uvs, colors, indices, x, y, z, def, idx, voxLight) {
    const texName = def.side;
    const uv = this.atlasUV.get(texName) || { u0: 0, v0: 0, u1: 1, v1: 1 };
    const corners = [
      [[0,0,0],[0,1,0],[1,0,1],[1,1,1]],
      [[1,0,0],[1,1,0],[0,0,1],[0,1,1]]
    ];
    const skyL = voxLight ? this._skyAt(x, y, z) / 15 : 0;
    const blkL = voxLight ? this._blockLAt(x, y, z) / 15 : 0;
    for (const cross of corners) {
      for (const [cx, cy, cz] of cross) {
        positions.push(x + cx, y + cy, z + cz);
        normals.push(0, 1, 0);
        colors.push(1, 1, 1);
        if (voxLight) voxLight.push(skyL, blkL);
      }
      uvs.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v0, uv.u1, uv.v1);
      indices.push(idx, idx + 1, idx + 2, idx + 2, idx + 1, idx + 3);
      idx += 4;
    }
    return idx;
  }

  // 水平薄板渲染（睡莲）：顶面抬升 0.002 防与水面 z-fighting，正反双面索引；返回推进后索引（4 顶点）。
  addFlat(positions, normals, uvs, colors, indices, x, y, z, def, idx, voxLight) {
    const texName = def.side;
    const uv = this.atlasUV.get(texName) || { u0: 0, v0: 0, u1: 1, v1: 1 };
    const skyL = voxLight ? this._skyAt(x, y, z) / 15 : 0;
    const blkL = voxLight ? this._blockLAt(x, y, z) / 15 : 0;
    const yTop = y + 1.002;
    const corners = [
      [x + 0, yTop, z + 0], [x + 0, yTop, z + 1], [x + 1, yTop, z + 0], [x + 1, yTop, z + 1]
    ];
    for (const [cx, cy, cz] of corners) {
      positions.push(cx, cy, cz);
      normals.push(0, 1, 0);
      colors.push(1, 1, 1);
      if (voxLight) voxLight.push(skyL, blkL);
    }
    uvs.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v0, uv.u1, uv.v1);
    indices.push(idx, idx + 1, idx + 2, idx + 2, idx + 1, idx + 3); // 正面（上方可见）
    indices.push(idx, idx + 2, idx + 1, idx + 2, idx + 3, idx + 1); // 反面（下方仰视可见）
    return idx + 4;
  }

  // B27 形制方块（门/床/活板门）：格内 AABB 盒渲染。6 面按 faceCorners 绕向（外法线），
  // 无 AO（shape 方块 transparent，不参与遮蔽），四角取自身格光。
  // UV：盒空间坐标即贴图比例（满幅面取整图、窄条面取对应切条，原版观感）；侧向 v 轴随 y 上升。
  // 贴边整体内缩 E：门板贴墙面/床贴地面时避免与邻格同平面 z-fighting。
  // 返回推进后的顶点索引（6 面 24 顶点）。voxLight 非空时写入自身格光照。
  addBox(positions, normals, uvs, colors, indices, x, y, z, def, idx, voxLight) {
    const { from, to } = def.shape;
    const E = 0.0008;
    const lo = [x + from[0] + E, y + from[1] + E, z + from[2] + E];
    const hi = [x + to[0] - E, y + to[1] - E, z + to[2] - E];
    const skyL = voxLight ? this._skyAt(x, y, z) / 15 : 0;
    const blkL = voxLight ? this._blockLAt(x, y, z) / 15 : 0;
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const texName = faceTexName(def, face);
      const uv = this.atlasUV.get(texName) || { u0: 0, v0: 0, u1: 1, v1: 1 };
      for (const c of faceCorners[f]) {
        const cc = [c[0] === 0 ? from[0] : to[0], c[1] === 0 ? from[1] : to[1], c[2] === 0 ? from[2] : to[2]];
        positions.push(c[0] === 0 ? lo[0] : hi[0], c[1] === 0 ? lo[1] : hi[1], c[2] === 0 ? lo[2] : hi[2]);
        normals.push(face.dir[0], face.dir[1], face.dir[2]);
        colors.push(1, 1, 1);
        if (voxLight) voxLight.push(skyL, blkL);
        // 盒空间 → UV 比例：与实体方块六面标准图案逐面对齐（u 表已含镜像补偿）
        // f: 0(+X)u=z 1(-X)u=1-z 2(+Y)u=1-z,v=x 3(-Y)u=z,v=x 4(+Z)u=1-x 5(-Z)u=x；侧向 v 随 y
        let fu, fv;
        if (f === 0) { fu = cc[2]; fv = cc[1]; }
        else if (f === 1) { fu = 1 - cc[2]; fv = cc[1]; }
        else if (f === 2) { fu = 1 - cc[2]; fv = cc[0]; }
        else if (f === 3) { fu = cc[2]; fv = cc[0]; }
        else if (f === 4) { fu = 1 - cc[0]; fv = cc[1]; }
        else { fu = cc[0]; fv = cc[1]; }
        uvs.push(uv.u0 + fu * (uv.u1 - uv.u0), uv.v0 + fv * (uv.v1 - uv.v0));
      }
      indices.push(idx, idx + 1, idx + 2, idx + 2, idx + 1, idx + 3);
      idx += 4;
    }
    return idx;
  }
}
