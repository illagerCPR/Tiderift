// build46-fp-arm-overlay.mjs -- Build 46 第一人称手臂二层皮肤（袖子）回归（纯 node，不依赖服务器）
// 背景：第三人称模型早就有第二层（hat/jacket/sleeve/pant）overlay 壳，第一人称手臂只有 base 层，
//   用户皮肤上的袖子/外套在第一人称下"消失"。B46 把 overlay 区域补到第一人称手臂：
//   同一部件几何、换 overlay UV 区域，外扩比例 (px+0.5)/px 与原版一致。
// 断言：
//   ① 纯数据：partRects 的 armR overlay 区域（classic/slim）+ overlayScaleFactor 数值与边界
//   ② 几何：buildPartBox(layer='overlay') 写入的是 overlay 区域（六面全不同于 base，
//      正面/顶面/左面钉值到像素坐标），负控：base 层不能顶替
//   ③ 行为：真 FirstPersonHand 应用皮肤后生成 overlay 壳（子节点/缩放/材质 alphaTest/
//      同贴图/体素光染色入参），重复应用不泄漏且释放旧几何·材质·贴图
//   ④ 一致性：第三人称 applySkinToRig 的外扩比例与第一人称共用同一函数（源码绊线 + 数值）
import * as THREE from 'three';
import { readFileSync } from 'fs';
import { FirstPersonHand } from '../src/render/FirstPersonHand.js';
import {
  partRects, buildPartBox, overlayScaleFactor, applySkinToRig, FACE_MAP,
} from '../src/entity/PlayerSkin.js';
import { ok, finish } from './harness.mjs';

function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── ① 纯数据：区域与缩放 ───────────────────────────────────────────────
{
  const classic = partRects('classic').armR;
  ok(classic.dims.w === 4 && classic.dims.h === 12 && classic.dims.d === 4, 'classic 臂 4×12×4 px');
  const ov = classic.overlay;
  ok(ov.front.x === 44 && ov.front.y === 36 && ov.front.w === 4 && ov.front.h === 12,
    `classic 袖子正面区域 = (44,36,4,12)（当前 ${ov.front.x},${ov.front.y},${ov.front.w},${ov.front.h}）`);
  ok(ov.top.x === 44 && ov.top.y === 32 && ov.top.w === 4 && ov.top.h === 4, '经典袖顶区域 (44,32,4,4)');
  ok(ov.left.x === 48 && ov.left.y === 36, '经典袖左面区域 (48,36)');
  ok(classic.base.front.y === 20 && classic.base.front.y !== ov.front.y, 'base 与 overlay 是不同区域（y 20 vs 36）');

  const slim = partRects('slim').armR;
  ok(slim.dims.w === 3, 'slim 臂宽 3 px');
  ok(slim.overlay.front.x === 44 && slim.overlay.front.w === 3, 'slim 袖子正面 3 宽');
  ok(slim.overlay.left.x === 47, 'slim 袖子左面 x=47（区域按 3 宽推导，不写死 4）');

  ok(close(overlayScaleFactor(4), 1.125), `4px 外扩 → 1.125（当前 ${overlayScaleFactor(4)}）`);
  ok(close(overlayScaleFactor(12), 12.5 / 12), '12px 外扩 → 12.5/12');
  ok(close(overlayScaleFactor(3), 3.5 / 3), '3px 外扩 → 3.5/3（slim）');
  ok(overlayScaleFactor(0) === 1 && overlayScaleFactor(-2) === 1 && overlayScaleFactor(NaN) === 1,
    '非法像素尺寸回落 1（不产生 NaN 缩放炸掉整只手）');
}

// ── ② 几何：overlay UV 区域写入 ────────────────────────────────────────
{
  const geo = buildPartBox('armR', 'classic', { w: 0.16, h: 0.42, d: 0.16 }, 'overlay');
  const uv = geo.attributes.uv;
  const rect = partRects('classic').armR.overlay.front; // 正面（face 5，无翻转）
  const u0 = rect.x / 64, u1 = (rect.x + rect.w) / 64;
  const vT = 1 - rect.y / 64, vB = 1 - (rect.y + rect.h) / 64;
  const i = 5 * 4;
  ok(close(uv.getX(i), u0) && close(uv.getY(i), vT), '正面角 0 = overlay 左上');
  ok(close(uv.getX(i + 1), u1) && close(uv.getY(i + 1), vT), '正面角 1 = overlay 右上');
  ok(close(uv.getX(i + 2), u0) && close(uv.getY(i + 2), vB), '正面角 2 = overlay 左下');
  ok(close(uv.getX(i + 3), u1) && close(uv.getY(i + 3), vB), '正面角 3 = overlay 右下');
  ok(geo.attributes.position.count === 24, '仍是标准 6 面盒（24 顶点）');

  const base = buildPartBox('armR', 'classic', { w: 0.16, h: 0.42, d: 0.16 });
  let diff = 0;
  for (let k = 0; k < 24; k++) {
    if (base.attributes.uv.getX(k) !== uv.getX(k) || base.attributes.uv.getY(k) !== uv.getY(k)) diff++;
  }
  ok(diff === 24, `overlay 六面 24 个 UV 全部不同于 base（当前 ${diff}/24）`);
  ok(FACE_MAP.length === 6, '六面表仍是 6 项（未为袖子另写一套面表）');
}

// ── ③ 行为：FirstPersonHand 的袖子壳 ───────────────────────────────────
{
  const game = {
    renderer: { camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() },
    settings: {}, controls: {}, player: null, inventoryScreen: null, world: null, sky: null,
  };
  const hand = new FirstPersonHand(game);
  ok(hand.armOverlay === null, '构造时无袖子（皮肤未加载，保持肤色兜底）');

  const img = { width: 64, height: 64 };
  hand.applySkin(img, 'classic');
  ok(!!hand.armOverlay, '应用皮肤后生成袖子壳');
  ok(hand.armOverlay.parent === hand.armMesh, '袖子是手臂子节点（随抬手/挥动/换手一起动）');
  ok(hand.armMesh.children.length === 1, `手臂只有一个 overlay 子节点（当前 ${hand.armMesh.children.length}）`);
  ok(close(hand.armOverlay.scale.x, 1.125) && close(hand.armOverlay.scale.y, 12.5 / 12) && close(hand.armOverlay.scale.z, 1.125),
    `袖子外扩 4→1.125 / 12→1.0417（当前 ${hand.armOverlay.scale.toArray().map((n) => n.toFixed(4)).join('/')}）`);
  ok(close(hand.armOverlay.position.x, 0) && close(hand.armOverlay.position.y, 0) && close(hand.armOverlay.position.z, 0),
    '袖子与手臂同中心（缩放外扩，不偏移）');
  const mat = hand.armOverlay.material;
  ok(mat.transparent === true && mat.alphaTest === 0.01, '袖子材质 transparent + alphaTest 丢弃透明像素');
  ok(mat.side === THREE.DoubleSide, '袖子双面（与原版第二层壳一致）');
  ok(mat.map === hand.armMesh.material.map, '袖子与手臂共用同一张贴图（一次上传）');
  ok(hand.armOverlay.geometry !== hand.armMesh.geometry, '几何独立（UV 区域不同）');

  // 六面取 overlay 区域：正面左上角 u=44/64
  const uv = hand.armOverlay.geometry.attributes.uv;
  ok(close(uv.getX(5 * 4), 44 / 64) && close(uv.getY(5 * 4), 1 - 36 / 64), '袖子正面 UV 指向 (44,36) 区域');

  // 重复应用（SkinScreen 保存皮肤）→ 旧资源释放、无叠壳
  const firstGeo = hand.armOverlay.geometry;
  const firstMat = hand.armOverlay.material;
  const firstTex = hand.armMesh.material.map;
  let geoDisposed = 0, matDisposed = 0, texDisposed = 0;
  firstGeo.addEventListener('dispose', () => { geoDisposed++; });
  firstMat.addEventListener('dispose', () => { matDisposed++; });
  firstTex.addEventListener('dispose', () => { texDisposed++; });

  hand.applySkin(img, 'slim');
  ok(geoDisposed === 1 && matDisposed === 1, `旧袖子几何/材质已释放（geo=${geoDisposed} mat=${matDisposed}）`);
  ok(texDisposed === 1, `旧皮肤贴图已释放（tex=${texDisposed}）`);
  ok(hand.armMesh.children.length === 1 && hand.armOverlay.geometry !== firstGeo, '换肤后仍只有一层袖子（无残留）');
  ok(close(hand.armOverlay.scale.x, 3.5 / 3), `slim 袖子外扩 3.5/3（当前 ${hand.armOverlay.scale.x.toFixed(4)}）`);
  ok(close(hand.armOverlay.geometry.attributes.uv.getX(5 * 4), 44 / 64) &&
    close(hand.armOverlay.geometry.attributes.uv.getX(5 * 4 + 1), 47 / 64),
    'slim 袖子正面 UV 宽 3px（44→47）');

  // 第三人称同源：外扩比例来自同一函数
  const rig = {
    joints: { armR: { pivot: new THREE.Group(), mesh: new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25)) } },
    partsByName: {},
  };
  const handle = applySkinToRig(rig, img, 'classic');
  ok(rig.overlayMeshes.length === 1, '第三人称仍生成 1 个 overlay 壳');
  ok(close(rig.overlayMeshes[0].scale.x, 1.125) && close(rig.overlayMeshes[0].scale.y, 12.5 / 12),
    '第三人称与第一人称共用同一外扩比例');
  ok(rig.overlayMeshes[0].material.alphaTest === 0.01 && rig.overlayMeshes[0].material.transparent,
    '两层材质参数一致（透明+alphaTest）');
  handle.dispose();
  ok(rig.overlayMeshes.length === 0, '第三人称 dispose 摘掉 overlay（原有行为不变）');
}

// ── ④ 接线绊线 ─────────────────────────────────────────────────────────
{
  const fp = srcOf('../src/render/FirstPersonHand.js');
  ok(fp.includes("buildPartBox('armR', model, { w, h: ARM_LEN, d: ARM_DEPTH }, 'overlay')"),
    '袖子几何走 buildPartBox 的 overlay 层（不另拼面表）');
  ok(fp.includes('this._disposeArmOverlay()') && fp.indexOf('this._disposeArmOverlay()') < fp.indexOf('new THREE.CanvasTexture(img)'),
    '换肤先摘旧袖子再建新贴图（不叠壳）');
  ok(fp.includes('alphaTest: 0.01'), '袖子材质保留 alphaTest');
  ok(fp.includes('applyEntityLight(this.game.world, this.game.sky, this.game.player.position, this.armMesh, this.armOverlay)'),
    '体素光染色覆盖手臂 + 袖子（火把下袖子同样受光）');
  ok(fp.includes('partRects(model).armR.dims'), '外扩尺寸取部件像素规格（classic/slim 自适应）');

  const skin = srcOf('../src/entity/PlayerSkin.js');
  ok(skin.includes('export function overlayScaleFactor'), '外扩比例是导出纯函数（单一来源）');
  ok(skin.includes('overlayScaleFactor(s.w), overlayScaleFactor(s.h), overlayScaleFactor(s.d)'),
    '第三人称 overlay 壳改用共享函数（不再各写一套公式）');
  ok(skin.includes("layer === 'overlay' ? r.overlay : r.base"), 'buildPartBox 的 layer 参数落到区域选择');
}

finish('build46-fp-arm-overlay');
