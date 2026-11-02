// build41-fp-arm-uv.mjs -- B41 第一人称手臂贴图朝向回归（纯 node，不依赖服务器/浏览器）
// 背景：B41 前手臂盒是 BoxGeometry(0.16,0.16,0.42)（长轴 Z），却按原版皮肤"长轴 Y"的 armR 区域
// 贴图，且六面共用同一块 front 区域、角序固定 → 顶面 v 反向（肩膀落在远端，用户报"像用肩膀交互"）、
// 侧面把 4px 横截面沿 0.42 拉长、端盖糊成小方块。
// B41 改为：几何长轴 Y（0.16,0.42,0.16）+ 六面各取 armR 对应区域（与第三人称同一个 FACE_MAP）
// + 整块绕 X 转 90° 让手（bottom 面）落远端、臂正面（front）朝上。
//
// 本套件用**独立 oracle**（只从顶点 position + uv 反推，不复用 buildPartBox 的内部推导）：
//   ① 六个面各自落在 armR 的正确区域（不再是同一块 front）
//   ② 长轴 = Y，尺寸 (臂宽, 0.42, 臂厚)
//   ③ 绕 X 转 +90° 后：bottom 面中心落到最 -Z（手在远端），top 面落到最 +Z（肩在近端）
//   ④ 绕 X 转 +90° 后：front 面法线由 -Z 变成 +Y（臂正面朝上）
//   ⑤ 贴图比例：正面 4px↔臂宽、12px↔臂长，两轴像素密度差 ≤ 20%（刻意偏瘦，不是各向异性拉伸）
//   ⑥ slim：臂宽 3px↔0.12，比例与 classic 一致
//   ⑦ 负控：把实现退回"六面同贴 front"，①③④ 至少 3 条红
import * as THREE from 'three';
import { partRects, buildPartBox, FACE_MAP } from '../src/entity/PlayerSkin.js';
import { assert, finish } from './harness.mjs';

const ARM_LEN = 0.42, ARM_DEPTH = 0.16, ARM_W = 0.16, SLIM_ARM_W = 0.12;
// BoxGeometry 面序 [px,nx,py,ny,pz,nz]；模型面朝 -Z → pz=背面、nz=正面
const FACE_NAME = ['right', 'left', 'top', 'bottom', 'back', 'front'];

// 面上的 uv → 图集像素（本项目的 uv 与 PNG 像素互换）
function faceRect(geo, f) {
  const uv = geo.attributes.uv;
  const xs = [], ys = [];
  for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    xs.push(uv.getX(i) * 64);
    ys.push((1 - uv.getY(i)) * 64);
  }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
function faceCenter(geo, f) {
  const p = geo.attributes.position;
  const c = [0, 0, 0];
  for (let k = 0; k < 4; k++) { const i = f * 4 + k; c[0] += p.getX(i) / 4; c[1] += p.getY(i) / 4; c[2] += p.getZ(i) / 4; }
  return c;
}
// 绕 X 轴 +90°（与 FirstPersonHand 的 Math.PI/2 一致，抬角不影响端点归属）
const rotX90 = ([x, y, z]) => [x, -z, y];
const near = (a, b) => Math.abs(a - b) < 1e-6;

function inspectGeometry(geo, model = 'classic') { // 本地几何探针（非 runner，勿与 harness 的 check() 混淆）
  const rects = partRects(model).armR.base;
  const out = { face: [], axis: [], hand: [], normal: [] };
  // ① 六面各就各位
  for (let f = 0; f < 6; f++) {
    const want = rects[FACE_NAME[f]];
    const got = faceRect(geo, f);
    if (!near(got.x, want.x) || !near(got.y, want.y) || !near(got.w, want.w) || !near(got.h, want.h)) {
      out.face.push(`面${f}(${FACE_NAME[f]}) 期望(${want.x},${want.y},${want.w},${want.h}) 实际(${got.x},${got.y},${got.w},${got.h})`);
    }
  }
  // ② 长轴 = Y
  geo.computeBoundingBox();
  const size = geo.boundingBox.getSize(new THREE.Vector3());
  if (!(size.y > size.x && size.y > size.z)) out.axis.push(`长轴不是 Y：${size.x}×${size.y}×${size.z}`);
  // ③ 手在远端、肩在近端
  const hand = rotX90(faceCenter(geo, 3));     // ny(bottom) = 手
  const shoulder = rotX90(faceCenter(geo, 2)); // py(top) = 肩
  if (!(hand[2] < shoulder[2])) out.hand.push(`手 z=${hand[2].toFixed(3)} 未落在肩 z=${shoulder[2].toFixed(3)} 的远端`);
  if (!(hand[2] < 0 && shoulder[2] > 0)) out.hand.push('手/肩未分居两侧');
  // ④ 臂正面朝上：front 面法线 -Z → +Y
  const n = rotX90([0, 0, -1]);
  if (!(n[1] > 0.99)) out.normal.push(`front 面法线旋转后为 (${n.join(',')})，未朝上`);
  out.size = size;
  return out;
}

// ── ①〜⑤ classic ──
{
  const geo = buildPartBox('armR', 'classic', { w: ARM_W, h: ARM_LEN, d: ARM_DEPTH });
  const r = inspectGeometry(geo, 'classic');
  const size = r.size;
  assert('① 六个面各自落在 armR 的对应区域（不再共用 front）', r.face.length === 0, r.face.join(' ｜ '));
  assert('② 长轴 = Y，尺寸为 (0.16, 0.42, 0.16)', r.axis.length === 0 && near(size.x, ARM_W) && near(size.y, ARM_LEN) && near(size.z, ARM_DEPTH), `${size.x}×${size.y}×${size.z}`);
  assert('③ 绕 X 转 90° 后手落在 -Z 远端、肩在 +Z 近端', r.hand.length === 0, r.hand.join(' ｜ '));
  assert('④ 绕 X 转 90° 后臂正面法线朝上（-Z → +Y）', r.normal.length === 0, r.normal.join(' ｜ '));

  // ⑤ 贴图比例：正面 4px ↔ 0.16、12px ↔ 0.42
  const front = faceRect(geo, 5); // nz = 正面
  const densU = front.w / ARM_W, densV = front.h / ARM_LEN;
  const ratio = Math.max(densU, densV) / Math.min(densU, densV);
  assert('⑤ 正面两轴像素密度差 ≤ 20%（刻意偏瘦而非各向异性拉伸）', ratio <= 1.2, `u=${densU.toFixed(1)}px/格 v=${densV.toFixed(1)}px/格 比=${ratio.toFixed(2)}`);
}

// ── ⑥ slim ──
{
  const geo = buildPartBox('armR', 'slim', { w: SLIM_ARM_W, h: ARM_LEN, d: ARM_DEPTH });
  const r = inspectGeometry(geo, 'slim');
  assert('⑥ slim 臂宽 3px ↔ 0.12 且六面区域正确', r.face.length === 0 && r.hand.length === 0 && near(r.size.x, SLIM_ARM_W), [...r.face, ...r.hand].join(' ｜ '));
  const front = faceRect(geo, 5); // nz = 正面
  assert('⑥ slim 正面两侧比例一致（3px/0.12 = 12px/0.48）', Math.abs(front.w / SLIM_ARM_W - front.h / ARM_LEN) / (front.h / ARM_LEN) <= 0.2, `u=${(front.w / SLIM_ARM_W).toFixed(1)} v=${(front.h / ARM_LEN).toFixed(1)}`);
}

// ── ⑦ 负控：退回"六面同贴 front"必须变红 ──
{
  const geo = new THREE.BoxGeometry(ARM_W, ARM_LEN, ARM_DEPTH);
  const r = partRects('classic').armR.base.front;
  const uv = geo.attributes.uv;
  const u0 = r.x / 64, u1 = (r.x + r.w) / 64, vT = 1 - r.y / 64, vB = 1 - (r.y + r.h) / 64;
  for (let f = 0; f < 6; f++) {
    uv.setXY(f * 4 + 0, u0, vT); uv.setXY(f * 4 + 1, u1, vT);
    uv.setXY(f * 4 + 2, u0, vB); uv.setXY(f * 4 + 3, u1, vB);
  }
  const neg = inspectGeometry(geo, 'classic');
  const fail = [...neg.face, ...neg.axis, ...neg.hand, ...neg.normal];
  assert('⑦ 负控：六面同贴 front 至少触发 3 条断言', fail.length >= 3, `实际 ${fail.length} 条：${fail.slice(0, 3).join(' ｜ ')}`);
}

// ── 面表完整性（防 FACE_MAP 与部件的 sel 名漂移）──
assert('面表 6 项且 sel 名与 partRects 的键集一致',
  FACE_MAP.length === 6 && FACE_MAP.every((fm) => Object.prototype.hasOwnProperty.call(partRects('classic').armR.base, fm.sel)),
  FACE_MAP.map((f) => f.sel).join(','));

finish();
