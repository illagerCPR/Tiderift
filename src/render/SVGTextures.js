// SVGTextures.js —— SVG 字符串 -> Canvas -> THREE.Texture 管线
// 满足"所有材质必须 SVG 绘制"的硬性要求
// 程序化生成 16x16 像素风 SVG，无外部图片资源
import * as THREE from 'three';

const TEX_SIZE = 16;

// 像素风 SVG 生成器：基于网格的随机噪声
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 生成 16x16 像素 SVG 的通用模板
function pixelSvg(pixels, opts = {}) {
  const size = opts.size || TEX_SIZE;
  const scale = opts.scale || 16;
  let rects = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = pixels[y * size + x];
      if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scale}" height="${scale}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${rects}</svg>`;
}

// 生成器集合（按方块名 -> {top, side, bottom} 或单张）
const generators = {
  // 工具：基于基底色 + 噪声生成像素
  noiseTexture(base, variation, seed, density = 0.5) {
    const r = rng(seed);
    const px = new Array(TEX_SIZE * TEX_SIZE);
    const [br, bg, bb] = base;
    const [vr, vg, vb] = variation;
    for (let i = 0; i < px.length; i++) {
      if (r() < density) {
        const t = r();
        const cr = Math.max(0, Math.min(255, Math.round(br + (vr - 128) * t)));
        const cg = Math.max(0, Math.min(255, Math.round(bg + (vg - 128) * t)));
        const cb = Math.max(0, Math.min(255, Math.round(bb + (vb - 128) * t)));
        px[i] = `rgb(${cr},${cg},${cb})`;
      } else {
        px[i] = `rgb(${br},${bg},${bb})`;
      }
    }
    return px;
  }
};

// SVG -> Image -> Canvas -> THREE.Texture
const svgCache = new Map();
const textureCache = new Map();
// svgText -> 已解码 Image 缓存：同一 SVG 只解码一次，重复绘制同步命中
//（UI 图标高频重绘必须零延迟，否则画布先清后画的空窗期表现为物品闪烁；
//  buildAtlas 启动时已对全部 SVG 调过 svgToImage，等于全量预热）
const svgImageCache = new Map();

function svgToImage(svgText) {
  const cached = svgImageCache.get(svgText);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      svgImageCache.set(svgText, img);
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function svgToTexture(svgText, key, transparent = false) {
  if (textureCache.has(key)) return textureCache.get(key);
  const img = await svgToImage(svgText);
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE; canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  if (transparent) tex.premultipliedAlpha = false;
  textureCache.set(key, tex);
  return tex;
}

// 构建纹理图集：所有方块贴图打包到一张 Canvas，UV 映射
let latestAtlasUV = new Map();

async function buildAtlas(svgMap) {
  const names = Object.keys(svgMap);
  const count = names.length;
  const cols = Math.ceil(Math.sqrt(count * 2)); // 宽一些
  const rows = Math.ceil(count / cols);
  const cell = TEX_SIZE;
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = cols * cell;
  atlasCanvas.height = rows * cell;
  const ctx = atlasCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const atlasUV = new Map();

  const imgs = await Promise.all(names.map(n => svgToImage(svgMap[n])));
  imgs.forEach((img, i) => {
    const cx = (i % cols) * cell;
    const cy = Math.floor(i / cols) * cell;
    ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE, cx, cy, cell, cell);
    const u0 = cx / atlasCanvas.width;
    const v1 = 1 - cy / atlasCanvas.height;
    const u1 = (cx + cell) / atlasCanvas.width;
    const v0 = 1 - (cy + cell) / atlasCanvas.height;
    atlasUV.set(names[i], { u0, v0, u1, v1 });
  });

  const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
  atlasTexture.magFilter = THREE.NearestFilter;
  atlasTexture.minFilter = THREE.NearestFilter;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  atlasTexture.generateMipmaps = false;
  latestAtlasUV = atlasUV;
  return { atlasTexture, atlasUV };
}

function getUV(name) {
  return latestAtlasUV.get(name) || { u0: 0, v0: 0, u1: 1, v1: 1 };
}

// 单独取一张纹理（用于物品图标等）
async function getTexture(name, svgText, transparent = false) {
  return svgToTexture(svgText, name, transparent);
}

// 构建可平铺纹理（RepeatWrapping），用于水面等需要 world-space 平铺的方块
// 每 1 个世界 UV 单位对应一次纹理 tile；与 mesh 几何 UV 配合
async function buildRepeatTexture(svgText, key) {
  const cacheKey = 'repeat:' + key;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  const img = await svgToImage(svgText);
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE; canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(cacheKey, tex);
  return tex;
}

export const SVGTextures = {
  pixelSvg,
  rng,
  generators,
  buildAtlas,
  getUV,
  getTexture,
  buildRepeatTexture,
  svgToImage,
  TEX_SIZE
};
