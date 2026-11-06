// build47-grass-path-tex.mjs -- Build 47 草径改形（"发黄的草方块"）回归（纯 node，不依赖服务器）
// 断言：
//   ① 顶面读起来是"黄化的草"而不是土：r≈g、b 明显低、亮度与草方块同级；
//   ② 与草方块顶面同构但更黄（草方块 g-r ≈ 54，草径 g-r < 20），与 dirt 的褐色能区分；
//   ③ 侧面是"泥土 + 2~4px 黄草唇"的草方块形制：每一列顶部至少 2px 草唇、泥土从第 3~5 行才开始；
//   ④ 草唇与顶面同色系（同一常量源），不是"土路残草"那种零星绿点；
//   ⑤ 注册面零漂移：ID / 图标 / transparent / 贴图三键不变。
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { ok, finish } from './harness.mjs';

const px = (svg) => {
  const out = [];
  const re = /<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="rgb\((\d+),(\d+),(\d+)\)"\/>/g;
  let m;
  while ((m = re.exec(svg))) out.push({ x: +m[1], y: +m[2], r: +m[3], g: +m[4], b: +m[5] });
  return out;
};
const mean = (list) => {
  const n = list.length || 1;
  const s = list.reduce((a, p) => ({ r: a.r + p.r, g: a.g + p.g, b: a.b + p.b }), { r: 0, g: 0, b: 0 });
  return { r: s.r / n, g: s.g / n, b: s.b / n };
};
const rows = (list, y0, y1) => list.filter((p) => p.y >= y0 && p.y <= y1);
const id = (n) => BlockRegistry.getId(n);
const def = (n) => BlockRegistry.getById(id(n));

// ── ① 顶面：黄化的草 ───────────────────────────────────────────────────
const top = px(BlockSVGDefinitions.grass_path_top);
const side = px(BlockSVGDefinitions.grass_path_side);
{
  ok(top.length === 256, `顶面 16×16 满像素（${top.length}）`);
  ok(side.length === 256, `侧面 16×16 满像素（${side.length}）`);

  const m = mean(top);
  ok(Math.abs(m.r - m.g) < 14, `顶面 r≈g（${m.r.toFixed(1)} / ${m.g.toFixed(1)}）→ 黄绿而非纯绿/褐`);
  ok(m.b < m.g * 0.62, `顶面蓝通道明显低（b=${m.b.toFixed(1)}，g×0.62=${(m.g * 0.62).toFixed(1)}）→ 暖黄`);
  ok(m.g > 120, `顶面亮度在草灰阶（g=${m.g.toFixed(1)} > 120）`);

  // 与草方块顶面比对：同构但更黄
  const grass = mean(px(BlockSVGDefinitions.grass_top));
  ok(grass.g - grass.r > 40, `对照：草方块顶面是绿的（g-r=${(grass.g - grass.r).toFixed(1)}）`);
  ok(m.g - m.r < 20, `草径顶面明显更黄（g-r=${(m.g - m.r).toFixed(1)} < 20）`);
  ok(Math.abs(m.g - grass.g) < 30, '亮度与草方块同级（不是把草压暗成土）');

  // 与 dirt 比对：褐 vs 黄
  const dirt = mean(px(BlockSVGDefinitions.dirt));
  ok(dirt.r - dirt.g > 30, `对照：dirt 是褐的（r-g=${(dirt.r - dirt.g).toFixed(1)}）`);
  ok(Math.abs(m.r - m.g) < Math.abs(dirt.r - dirt.g) / 2, '草径顶面与土路配色分得开（不再是压实土）');

  ok(BlockSVGDefinitions.grass_path_top !== BlockSVGDefinitions.grass_top, '顶面不复用草方块贴图（独立黄化版）');
  ok(BlockSVGDefinitions.grass_path_top !== BlockSVGDefinitions.dirt, '顶面不是土（B46 断言延续）');
  ok(BlockSVGDefinitions.grass_path_side !== BlockSVGDefinitions.grass_side, '侧面不复用草方块侧面');
}

// ── ② 侧面：泥土 + 2~4px 草唇（草方块形制）─────────────────────────────
{
  const isGrass = (p) => Math.abs(p.r - p.g) < 25 && p.b < p.g * 0.75;

  // 顶部两行：所有列都必须是草唇（草唇至少 2px）
  let lipOk = true;
  for (let x = 0; x < 16; x++) {
    for (const y of [0, 1]) {
      const p = side.find((q) => q.x === x && q.y === y);
      if (!p || !isGrass(p)) lipOk = false;
    }
  }
  ok(lipOk, '每一列的顶部 2px 都是黄草唇（草方块形制，不是 B46 的 1~2px 残草）');

  // 每列"泥土起点" = 草唇 + 过渡行，应在 3~5 行（= 2~4px 草唇 + 1 行过渡）
  const starts = [];
  for (let x = 0; x < 16; x++) {
    let s = -1;
    for (let y = 0; y < 16; y++) {
      const p = side.find((q) => q.x === x && q.y === y);
      if (p && p.r - p.g > 25) { s = y; break; } // 泥土：r 明显高于 g
    }
    starts.push(s);
  }
  ok(starts.every((s) => s >= 3 && s <= 5), `每列泥土起点在 3~5 行（实际 ${starts.join(',')}）`);
  ok(Math.min(...starts) === 3 && Math.max(...starts) === 5,
    `草唇深浅有参差（min=${Math.min(...starts)} / max=${Math.max(...starts)}）`);

  // 底部两行一定是泥土（r>g>b）
  const bottom = rows(side, 14, 15);
  ok(bottom.every((p) => p.r > p.g && p.g > p.b && p.r - p.g > 25), '底部是泥土（r>g>b）');
  const lip = rows(side, 0, 1);
  // 黄 vs 褐看"蓝通道占比"（黄的 b/g ≈ 0.49，褐 ≈ 0.67；绝对值因亮度不可比）
  ok(mean(lip).b / mean(lip).g < mean(bottom).b / mean(bottom).g,
    `草唇的蓝占比低于泥土（${(mean(lip).b / mean(lip).g).toFixed(2)} < ${(mean(bottom).b / mean(bottom).g).toFixed(2)}）`);
  ok(Math.abs(mean(lip).r - mean(top).r) < 30 && Math.abs(mean(lip).g - mean(top).g) < 30,
    '草唇与顶面同色系（r/g 相差 < 30）');
}

// ── ③ 注册面零漂移 ─────────────────────────────────────────────────────
{
  const gp = def('grass_path');
  ok(gp.id === 222, `grass_path 仍是 ID 222（当前 ${gp.id}）—— 只换贴图不重排方块表`);
  ok(gp.icon === 'grass_path_top', `图标仍取顶面（${gp.icon}）`);
  ok(gp.transparent === true, 'transparent 未被动到（形制方块必需）');
  ok(gp.top === 'grass_path_top' && gp.side === 'grass_path_side' && gp.bottom === 'dirt',
    '贴图三键保持不变');
}

finish('build47-grass-path-tex');
