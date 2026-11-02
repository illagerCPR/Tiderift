// build41-legacy-skin.mjs -- B41 legacy 64×32 皮肤归一化回归（纯 node，不依赖服务器/canvas）
// 背景：B41 前 normalizeSkin 只把 y16..31 下移 16px，左臂(32,48)/左腿(16,48) 的 base 与
// overlay 整面仍是透明 → transparent:false 材质渲染成纯黑肢体（实测 8 个区域 alpha=0）。
// B41 改为按原版 1.8 语义补位：左肢 ← 右肢的几何镜像（±X 两面互换 + 全部水平翻转），
// overlay ← 自身 base 直拷（head 的 hat 区保持透明）。
//
// 本套件只测**纯数据算子** legacySkinOps()（不碰 canvas）：
//   ① 覆盖：6 部件 base 全覆盖，overlay 除 head 外全覆盖，head overlay 完全不被写
//   ② 顺序：'image' 源算子必须排在 'canvas' 源算子之前（overlay 依赖已补位的左肢）
//   ③ 源边界：所有 'image' 源矩形落在 64×32 内（旧皮肤只有上半区）
//   ④ 镜像语义：用「每像素唯一值」的合成图按算子执行一遍，断言左肢是右肢的逐面水平镜像
//     （±X 面互换），且左右肢并非简单相同拷贝
import { partRects, legacySkinOps, isLegacySkin } from '../src/entity/PlayerSkin.js';
import { assert, finish } from './harness.mjs';

const rects = partRects('classic');
const ops = legacySkinOps();
const FACE_KEYS = ['front', 'back', 'top', 'bottom', 'right', 'left'];

// ── ① 覆盖 ────────────────────────────────────────────────────────────
{
  const grid = Array.from({ length: 64 }, () => new Array(64).fill(0));
  // 执行器先整块拷贝上半区（y<32），头/身体/右肢 base 由此而来；算子只补下半区
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) grid[y][x] = 1;
  for (const op of ops) {
    for (let y = 0; y < op.h; y++) for (let x = 0; x < op.w; x++) grid[op.dy + y][op.dx + x]++;
  }
  let baseBad = [], overBad = [], headOver = 0;
  for (const part of ['head', 'body', 'armR', 'armL', 'legR', 'legL']) {
    for (const face of FACE_KEYS) {
      const b = rects[part].base[face];
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (grid[b.y + y][b.x + x] !== 1) baseBad.push(`${part}/${face}`);
      const o = rects[part].overlay[face];
      let covered = 0;
      for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) covered += grid[o.y + y][o.x + x];
      if (part === 'head') { headOver += covered - o.w * o.h; continue; } // 减去上半区原样拷贝的那一份
      if (covered !== o.w * o.h) overBad.push(`${part}/${face}(${covered}/${o.w * o.h})`);
    }
  }
  assert('① 六个部件 base 每一面都被算子覆盖且只覆盖一次', baseBad.length === 0, [...new Set(baseBad)].join(','));
  assert('① overlay 除 head 外每面全覆盖', overBad.length === 0, overBad.join(','));
  assert('① head 的 hat 区不被算子顶替（保留旧皮肤自带的帽层）', headOver === 0, `额外写入 ${headOver} 像素`);
}

// ── ② 顺序：image 源算子先于 canvas 源算子 ──────────────────────────────
{
  const lastImage = ops.map((o) => o.from === 'image').lastIndexOf(true);
  const firstCanvas = ops.findIndex((o) => o.from === 'canvas');
  assert('② 左肢镜像算子全部排在 overlay 直拷之前', lastImage >= 0 && (firstCanvas === -1 || lastImage < firstCanvas), `lastImage=${lastImage} firstCanvas=${firstCanvas}`);
  assert('② overlay 直拷以画布为源（左肢 base 是补出来的）', ops.filter((o) => o.from === 'canvas').length === 5 * 6, `canvas 源算子 ${ops.filter((o) => o.from === 'canvas').length} 个`);
}

// ── ③ 源边界：image 源必须落在旧皮肤 64×32 内 ───────────────────────────
{
  const bad = ops.filter((o) => o.from === 'image' && (o.sx < 0 || o.sy < 0 || o.sx + o.w > 64 || o.sy + o.h > 32));
  assert('③ 全部 image 源矩形落在 64×32 旧皮肤范围内', bad.length === 0, `${bad.length} 个越界`);
}

// ── ④ 镜像语义：逐像素唯一值执行一遍，验证左肢 = 右肢的镜像 ─────────────
{
  // 合成图：每像素值唯一（src[y][x] = y*64 + x + 1，0 保留给「未写入」）
  const src = Array.from({ length: 32 }, (_, y) => Array.from({ length: 64 }, (_, x) => y * 64 + x + 1));
  const dst = Array.from({ length: 64 }, () => new Array(64).fill(0));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) dst[y][x] = src[y][x];
  const sample = (buf, r, x, y) => buf[r.y + y][r.x + x];
  for (const op of ops) {
    for (let y = 0; y < op.h; y++) {
      for (let x = 0; x < op.w; x++) {
        const sx = op.flipH ? op.sx + op.w - 1 - x : op.sx + x;
        const v = op.from === 'canvas' ? dst[op.sy + y][sx] : src[op.sy + y][sx];
        dst[op.dy + y][op.dx + x] = v;
      }
    }
  }

  // 左肢 front 面 = 右肢 front 面的水平镜像
  let mirrorBad = 0, sameBad = 0;
  for (const [r, l] of [['armR', 'armL'], ['legR', 'legL']]) {
    const rf = rects[r].base.front, lf = rects[l].base.front;
    for (let y = 0; y < rf.h; y++) {
      for (let x = 0; x < rf.w; x++) {
        if (sample(dst, lf, x, y) !== sample(dst, rf, rf.w - 1 - x, y)) mirrorBad++;
        if (sample(dst, lf, x, y) === sample(dst, rf, x, y)) sameBad++;
      }
    }
  }
  assert('④ 左臂/左腿正面 = 右臂/右腿正面的水平镜像', mirrorBad === 0, `${mirrorBad} 像素不匹配`);
  // 合成图每像素唯一、w=4 无固定列：镜像后左右不应有任何「同位相等」的像素；
  // 若误写成原位直拷，则全部像素同位相等（sameBad = w*h）
  assert('④ 左右肢确实做了镜像（不是原位直拷）', sameBad === 0, `${sameBad} 像素同位相等`);

  // ±X 两面互换：左肢 +X 面 ← 右肢 -X 面的镜像
  let swapBad = 0;
  for (const [r, l] of [['armR', 'armL'], ['legR', 'legL']]) {
    const srcRight = rects[r].base.left, dstRight = rects[l].base.right;
    for (let y = 0; y < dstRight.h; y++) {
      for (let x = 0; x < dstRight.w; x++) {
        if (sample(dst, dstRight, x, y) !== sample(dst, srcRight, srcRight.w - 1 - x, y)) swapBad++;
      }
    }
  }
  assert('④ 左肢 +X 面取右肢 -X 面的镜像（±X 互换）', swapBad === 0, `${swapBad} 像素不匹配`);

  // 归一化后没有任何「未写入」区域残留在可见部件上
  let holes = 0;
  for (const part of ['head', 'body', 'armR', 'armL', 'legR', 'legL']) {
    for (const face of FACE_KEYS) {
      const b = rects[part].base[face];
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (dst[b.y + y][b.x + x] === 0) holes++;
    }
  }
  assert('④ 归一化后 6 部件 base 无空洞', holes === 0, `残留 ${holes} 像素`);
}

// ── ⑤ 尺寸判定 ─────────────────────────────────────────────────────────
assert('⑤ 只有 64×32 判定为 legacy（64×64 现代皮肤不走转换）',
  isLegacySkin({ width: 64, height: 32 }) && !isLegacySkin({ width: 64, height: 64 }) && !isLegacySkin({ width: 128, height: 128 }));

finish();
