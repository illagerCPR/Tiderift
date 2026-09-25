// BlockIcon.js -- 类原版等轴方块图标（B29）
// 方块图标从"单面贴图平铺"升级为原版物品栏效果：top/front/side 三面等轴（2:1 dimetric）合成，
// 面亮度沿用原版规则 top 1.0 / 左面 0.8 / 右面 0.6；cross/portal/flat 渲染形制、带 shape 的
// 部分方块（门/床/活板门）与流体仍走单面平铺（原版对非立方方块同样用平铺 sprite）。
// 图标 canvas 按 `${name}@${size}` 缓存（Promise 记账防并发重建），二次绘制零成本。
import { SVGTextures } from './SVGTextures.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../blocks/BlockDefs.js';
import { isIsoBlock } from '../core/ItemCategories.js';

// 32px 设计基准下的等轴几何：菱形上顶点(16,2)/左(2,10)/右(30,10)/前(16,18)，侧棱高 14。
// 矩阵按源图 16×16 归一（0.875 = 14/16）：u 轴映射菱形半边，v 轴映射竖直落差。
//   top  ：原点=左顶点，u→上顶点、v→前顶点（纹理底边贴前缘）
//   左面 ：原点=左顶点，u→前顶点、v→竖直向下——放 front 贴图（箱子锁扣/熔炉炉口朝前可见）
//   右面 ：原点=前顶点，u→右顶点、v→竖直向下——放 side 贴图
const FACE_XFORMS = [
  { m: [0.875, -0.5, 0.875, 0.5], o: [2, 10], level: 1.0 },
  { m: [0.875, 0.5, 0, 0.875], o: [2, 10], level: 0.8 },
  { m: [0.875, -0.5, 0, 0.875], o: [16, 18], level: 0.6 },
];

// 变暗贴图缓存：multiply 压暗后用 destination-in 恢复 alpha
//（multiply 会把透明像素填成填充色，必须再用原图抠回透明区）
const shadeCache = new WeakMap();
function shadeFace(img, level) {
  let byImg = shadeCache.get(img);
  if (!byImg) { byImg = new Map(); shadeCache.set(img, byImg); }
  let c = byImg.get(level);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = SVGTextures.TEX_SIZE; c.height = SVGTextures.TEX_SIZE;
  const cc = c.getContext('2d');
  cc.drawImage(img, 0, 0, SVGTextures.TEX_SIZE, SVGTextures.TEX_SIZE);
  if (level < 1) {
    const v = Math.round(255 * level); // 0.8→204 / 0.6→153
    cc.globalCompositeOperation = 'multiply';
    cc.fillStyle = `rgb(${v},${v},${v})`;
    cc.fillRect(0, 0, SVGTextures.TEX_SIZE, SVGTextures.TEX_SIZE);
    cc.globalCompositeOperation = 'destination-in';
    cc.drawImage(img, 0, 0, SVGTextures.TEX_SIZE, SVGTextures.TEX_SIZE);
    cc.globalCompositeOperation = 'source-over';
  }
  byImg.set(level, c);
  return c;
}

const iconCache = new Map(); // key: `${name}@${size}` -> Promise<canvas|null>

// 取方块等轴图标 canvas（null = 非立方形制或缺贴图，调用方走单面平铺兜底）
export function getBlockIcon(name, size = 32) {
  const key = `${name}@${size}`;
  let p = iconCache.get(key);
  if (!p) {
    p = buildBlockIcon(name, size);
    iconCache.set(key, p);
  }
  return p;
}

async function buildBlockIcon(name, size) {
  const def = BlockRegistry.getByName(name);
  if (!def || !isIsoBlock(def)) return null;
  const topSvg = BlockSVGDefinitions[def.top];
  const frontSvg = BlockSVGDefinitions[def.front || def.side]; // B28 定向面（箱子/熔炉看得出正面）
  const sideSvg = BlockSVGDefinitions[def.side];
  if (!topSvg || !frontSvg || !sideSvg) return null;
  const [topImg, frontImg, sideImg] = await Promise.all([
    SVGTextures.svgToImage(topSvg),
    SVGTextures.svgToImage(frontSvg),
    SVGTextures.svgToImage(sideSvg),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const u = size / 32;
  const faces = [
    [shadeFace(topImg, FACE_XFORMS[0].level), FACE_XFORMS[0]],
    [shadeFace(frontImg, FACE_XFORMS[1].level), FACE_XFORMS[1]],
    [shadeFace(sideImg, FACE_XFORMS[2].level), FACE_XFORMS[2]],
  ];
  for (const [img, fx] of faces) {
    const [a, b, c, d] = fx.m;
    ctx.setTransform(a * u, b * u, c * u, d * u, fx.o[0] * u, fx.o[1] * u);
    ctx.drawImage(img, 0, 0);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

// B28 定向面单面取纹链（全项目唯一）：icon 优先（箱子/熔炉图标看得出正面）→ side → top
export function getFlatBlockSvg(name) {
  const block = BlockRegistry.getByName(name);
  const texName = block ? (block.icon || block.side || block.top) : null;
  return texName ? (BlockSVGDefinitions[texName] || null) : null;
}

// 统一图标绘制入口：物品 SVG 平铺 → 立方方块等轴三面 → 其余方块单面平铺。
// resolveItemSvg(name)：调用方各自的物品 SVG 解析链（game.itemSvgMap 或模块级 ItemSVGDefinitions）。
// isStale：可选过期守卫（Hotbar 并发 update 下旧绘制不得覆盖新绘制），每次 await 返回后与落笔前各查一次。
export async function drawIconInto(ctx, size, name, resolveItemSvg, isStale) {
  const stale = () => !!(isStale && isStale());
  if (stale()) return;
  const itemSvg = resolveItemSvg ? resolveItemSvg(name) : null;
  if (itemSvg) {
    const img = await SVGTextures.svgToImage(itemSvg);
    if (stale()) return;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, size, size);
    return;
  }
  const iso = await getBlockIcon(name, size);
  if (stale()) return;
  ctx.clearRect(0, 0, size, size);
  if (iso) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(iso, 0, 0, size, size);
    return;
  }
  const svg = getFlatBlockSvg(name);
  if (!svg) return;
  const img = await SVGTextures.svgToImage(svg);
  if (stale()) return;
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, size, size);
}
