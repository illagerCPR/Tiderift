// build41-skin-uv.mjs -- B41 皮肤六面 UV 回归（纯 node，不依赖服务器/网络）
// 背景：B41 前 FACE_MAP 的 back/top/bottom 三面朝向错（back 多翻 u、top 少翻 v、bottom 多翻 v），
// 正面与左右两侧本来就对——默认皮肤这几处多为对称纯色，故长期未被肉眼发现。
//
// 本套件用**独立 oracle**：把「原版 1.8 皮肤布局」（skinview3d 的 setUVs，业界通用渲染器）与
// 本项目的 FACE_MAP/setFaceUV 都折算成「角色空间角点（右/左·上/下·前/后）+ 面法线 → 图集像素」，
// 逐点比对 6 部件 × 6 面 × 4 角 = 144 点。
//   ① 本项目模型面朝 -Z、角色右手 = +X；参考实现面朝 +Z、角色右手 = -X，故参考坐标按 (x,z)→(-x,-z) 折算
//   ② 参考实现只用 (u,v,w,h,d) 常量推导区域与角序，不复用 partRects（防同源错误互相掩护）
// 断言：
//   A 144 点全部一致（零差异）
//   B 三个被测面确实参与比对（防"全部方形/恒定真"）
//   C 负控：把三面退回 B41 前的旧翻转 → 至少 24 点不一致，且不一致全部落在 T/B/Bk
import * as THREE from 'three';
import { partRects, FACE_MAP, setFaceUV } from '../src/entity/PlayerSkin.js';
import { assert, finish } from './harness.mjs';

// ── 部件常量（原版布局：u,v,w,h,d）────────────────────────────────────
const PARTS = {
  head: { u: 0, v: 0, w: 8, h: 8, d: 8 },
  body: { u: 16, v: 16, w: 8, h: 12, d: 4 },
  armR: { u: 40, v: 16, w: 4, h: 12, d: 4 },
  armL: { u: 32, v: 48, w: 4, h: 12, d: 4 },
  legR: { u: 0, v: 16, w: 4, h: 12, d: 4 },
  legL: { u: 16, v: 48, w: 4, h: 12, d: 4 },
};
const FACE_ORDER = ['right', 'left', 'top', 'bottom', 'front', 'back']; // BoxGeometry 面序

// ── 参考实现：skinview3d setUVs（区域 + 角序）──────────────────────────
// 返回 { [faceIndex]: [ [px,py] × 4 ] }，像素坐标为图集坐标（y 向下）
function refFaceCorners({ u, v, w, h, d }) {
  const F = (x1, y1, x2, y2) => [
    [x1, y2], [x2, y2], [x2, y1], [x1, y1], // BL, BR, TR, TL（skinview3d 的 toFaceVertices）
  ];
  const rects = {
    top: F(u + d, v, u + w + d, v + d),
    bottom: F(u + w + d, v, u + 2 * w + d, v + d),
    left: F(u, v + d, u + d, v + h + d),
    front: F(u + d, v + d, u + w + d, v + h + d),
    right: F(u + w + d, v + d, u + 2 * d + w, v + h + d),
    back: F(u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + h + d),
  };
  // 角序（作用在 BL/BR/TR/TL 上）：除 bottom 外均 [TL,TR,BL,BR]
  const pick = { right: [3, 2, 0, 1], left: [3, 2, 0, 1], top: [3, 2, 0, 1], bottom: [0, 1, 3, 2], front: [3, 2, 0, 1], back: [3, 2, 0, 1] };
  const out = {};
  FACE_ORDER.forEach((nm, f) => { out[f] = pick[nm].map((k) => rects[nm][k]); });
  return out;
}

// 角色空间角点键：模型自身右=+X、上=+Y、面朝=-Z
function cornerKey([x, y, z]) {
  const sx = x > 1e-6 ? 'R' : x < -1e-6 ? 'L' : '0';
  const sy = y > 1e-6 ? 'T' : y < -1e-6 ? 'B' : '0';
  const sz = z > 1e-6 ? 'Bk' : z < -1e-6 ? 'F' : '0';
  return sx + sy + sz;
}
// 面法线 → 角色空间方位（本项目）
const OUR_NORMAL = ['R', 'L', 'T', 'B', 'Bk', 'F'];
// 参考实现面法线 → 角色空间方位（模型整体绕 Y 转 180°，+X 是角色左侧）
const REF_NORMAL = ['L', 'R', 'T', 'B', 'F', 'Bk'];

// 把一份「面 → 4 角像素」表与 BoxGeometry 顶点配对，产出 { 角点键+法线: 像素 }
function collect(dims, facePixels, transform, normalOf) {
  const geo = new THREE.BoxGeometry(dims.w, dims.h, dims.d);
  const pos = geo.attributes.position;
  const map = new Map();
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const p = transform([pos.getX(i), pos.getY(i), pos.getZ(i)]);
      const key = cornerKey(p) + '|' + normalOf[f];
      map.set(key, facePixels[f][k].map((n) => Math.round(n * 100) / 100));
    }
  }
  return map;
}

// 本项目实现：用 FACE_MAP + setFaceUV 写入 BoxGeometry，再把 uv 折回图集像素
function ourFacePixels(rects, dims, faceMap) {
  const geo = new THREE.BoxGeometry(dims.w, dims.h, dims.d);
  for (const fm of faceMap) setFaceUV(geo, fm.face, rects[fm.sel], fm.flipU, fm.flipV);
  const uv = geo.attributes.uv;
  // BoxGeometry 顶点序 = [TL,TR,BL,BR]（uv 空间），即我们写入的 order[k]
  const out = {};
  for (let f = 0; f < 6; f++) {
    out[f] = [];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      out[f].push([uv.getX(i) * 64, (1 - uv.getY(i)) * 64]);
    }
  }
  return out;
}

function compare(faceMap) {
  const bad = [];
  for (const [part, def] of Object.entries(PARTS)) {
    const rects = partRects('classic')[part];
    const ourMap = collect(def, ourFacePixels(rects.base, rects.dims, faceMap), (p) => p, OUR_NORMAL);
    const refMap = collect(def, refFaceCorners(def), (p) => [-p[0], p[1], -p[2]], REF_NORMAL);
    for (const [k, px] of refMap) {
      const [corner, normal] = k.split('|');
      const mine = ourMap.get(k);
      if (!mine) { bad.push({ part, corner, normal, ref: null, mine: null }); continue; }
      if (Math.abs(mine[0] - px[0]) > 0.01 || Math.abs(mine[1] - px[1]) > 0.01) {
        bad.push({ part, corner, normal, ref: px, mine });
      }
    }
  }
  return bad;
}
const fmt = (b) => `${b.part} ${b.corner}|${b.normal} 参考(${b.ref ? b.ref.join(',') : '缺'}) 本项目(${b.mine ? b.mine.join(',') : '缺'})`;

// ── A：144 点零差异 ──
const diffs = compare(FACE_MAP);
assert('A 皮肤六面 144 个角色空间角点与参考实现全等', diffs.length === 0, diffs.slice(0, 6).map(fmt).join(' ｜ '));

// ── B：三面确实参与比对（每个部件 6 面 × 4 角都在，共 144 点）──
{
  let points = 0;
  const faces = new Set();
  for (const [part, def] of Object.entries(PARTS)) {
    const refMap = collect(def, refFaceCorners(def), (p) => [-p[0], p[1], -p[2]], REF_NORMAL);
    points += refMap.size;
    for (const k of refMap.keys()) faces.add(k.split('|')[1]);
  }
  assert('B 参考表覆盖 6 部件 × 6 面 × 4 角 = 144 点', points === 144, `实际 ${points} 点`);
  assert('B 六个面（含顶/底/背）均在比对范围内', faces.size === 6 && ['T', 'B', 'Bk'].every((f) => faces.has(f)), [...faces].join('/'));
}

// ── C：负控——退回 B41 前的旧翻转必须变红，且只在 T/B/Bk 三面 ──
{
  const OLD_FACE_MAP = [
    { face: 0, sel: 'right', flipU: false, flipV: false },
    { face: 1, sel: 'left', flipU: false, flipV: false },
    { face: 2, sel: 'top', flipU: true, flipV: false },
    { face: 3, sel: 'bottom', flipU: true, flipV: true },
    { face: 4, sel: 'back', flipU: true, flipV: false },
    { face: 5, sel: 'front', flipU: false, flipV: false },
  ];
  const oldDiffs = compare(OLD_FACE_MAP);
  assert('C 负控：旧翻转表至少 24 点不一致', oldDiffs.length >= 24, `实际 ${oldDiffs.length} 点（示例 ${oldDiffs.slice(0, 2).map(fmt).join(' ｜ ')}）`);
  const badFaces = new Set(oldDiffs.map((d) => d.normal));
  assert('C 负控：不一致全部落在 T/B/Bk 三面', [...badFaces].every((f) => f === 'T' || f === 'B' || f === 'Bk'), [...badFaces].join('/'));
}

finish();
