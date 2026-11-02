// PlayerSkin.js -- 玩家模型原版 skin 纹理（Build 21 M1）
// 职责：
//   ① 原版 64×64 皮肤 UV 映射：部件区域表（classic/slim 双模型）+ BoxGeometry 六面 UV 写入
//      （镜像标志按 BoxGeometry buildPlane 顶点走向推导，截图校准）
//   ② 双层渲染：base 层不透明 + overlay 第二层（帽/外套/袖/裤，alphaTest 透明壳，外扩 0.5px）
//   ③ legacy 64×32 皮肤归一化（左肢镜像补位 + overlay 直拷，B41 重写）
//   ④ 皮肤来源与持久化：默认内置 PNG（res/default_skin/） / 本地上传 / M3 用户名拉取
//      （B41：跨域镜像需 crossOrigin 才能读回画布；静态托管走镜像候选链）；
//      localStorage 键 project-mc-skin-v1（单机本地，联机同步走 M2 协议）
// 纯数据函数（partRects/faceRects/isLegacySkin 归一化坐标）node 可测；canvas/Image 操作仅浏览器路径。
import * as THREE from 'three';

// 默认皮肤（Build 21 M1，res/default_skin/）：用 new URL(..., import.meta.url) 引入——
// Vite dev 直接 serve、build 时打包进 dist；node 测试环境 import 仅得 file:// href（无副作用）。
export const SKIN_STORAGE_KEY = 'project-mc-skin-v1';
export const DEFAULT_SKIN_URLS = {
  classic: new URL('../../res/default_skin/default_skin_classic.png', import.meta.url).href,
  slim: new URL('../../res/default_skin/default_skin_slim.png', import.meta.url).href,
};

// ── 部件区域表 ─────────────────────────────────────────────────────────
// 每部件：{ u, v, w, h, d }（区域左上角 PNG 像素 + 部件三维像素规格）。
// 六面区域由 Minecraft 标准排布公式推导（区域内：上排 top/bottom 并排，
// 下排 right/front/left/back 一字排开），slim 仅改臂宽 w=3。
// overlay 区域（第二层）与 base 同公式，仅区域原点不同（hat=+32x，其余右列=+16y，左列独立块）。
const PART_DEFS = [
  { key: 'head', u: 0, v: 0, w: 8, h: 8, d: 8, ov: [32, 0] },
  { key: 'body', u: 16, v: 16, w: 8, h: 12, d: 4, ov: [16, 32] },
  { key: 'armR', u: 40, v: 16, w: 4, h: 12, d: 4, ov: [40, 32] },
  { key: 'armL', u: 32, v: 48, w: 4, h: 12, d: 4, ov: [48, 48] },
  { key: 'legR', u: 0, v: 16, w: 4, h: 12, d: 4, ov: [0, 32] },
  { key: 'legL', u: 16, v: 48, w: 4, h: 12, d: 4, ov: [0, 48] },
];

// 六面选择器 → BoxGeometry 面序映射（模型面朝 -Z）：
//   BoxGeometry 面序 [px(+x), nx(-x), py(+y), ny(-y), pz(+z), nz(-z)]
//   模型自身右=+X、面朝-Z → px=右面(right) / nx=左面(left) / py=top / ny=bottom /
//   pz=背面(back) / nz=脸面(front)
// 镜像标志推导方式（B41 修正）：以 skinview3d 的 setUVs 为参考实现，把两边都折算成
//   「角色空间角点（右/左·上/下·前/后）→ 图集像素」逐点比对，6 部件×6 面×4 角=144 点全等。
//   B41 前 back/top/bottom 三面全错（back 多翻 u、top 少翻 v、bottom 多翻 v），
//   正面与左右两侧本来就对——默认皮肤这几处多为对称纯色，故长期未被肉眼发现。
// 纪律：改这里必须跑 tests/build41-skin-uv.mjs（144 点钉值 + 负控）。
export const FACE_MAP = [
  { face: 0, sel: 'right', flipU: false, flipV: false },
  { face: 1, sel: 'left', flipU: false, flipV: false },
  { face: 2, sel: 'top', flipU: true, flipV: true },
  { face: 3, sel: 'bottom', flipU: true, flipV: false },
  { face: 4, sel: 'back', flipU: false, flipV: false },
  { face: 5, sel: 'front', flipU: false, flipV: false },
];

// 部件在指定模型下的区域表：{ [key]: { base: {sel:{x,y,w,h}}, overlay: {...}, dims:{w,h,d} } }
// 纯函数（node 测试锚点）。
export function partRects(model = 'classic') {
  const armW = model === 'slim' ? 3 : 4;
  const out = {};
  for (const def of PART_DEFS) {
    const w = (def.key === 'armR' || def.key === 'armL') ? armW : def.w;
    const dims = { w, h: def.h, d: def.d };
    const faces = (u, v) => ({
      top: { x: u + dims.d, y: v, w: dims.w, h: dims.d },
      bottom: { x: u + dims.d + dims.w, y: v, w: dims.w, h: dims.d },
      right: { x: u, y: v + dims.d, w: dims.d, h: dims.h },
      front: { x: u + dims.d, y: v + dims.d, w: dims.w, h: dims.h },
      left: { x: u + dims.d + dims.w, y: v + dims.d, w: dims.d, h: dims.h },
      back: { x: u + dims.d + dims.w + dims.d, y: v + dims.d, w: dims.w, h: dims.h },
    });
    out[def.key] = { base: faces(def.u, def.v), overlay: faces(def.ov[0], def.ov[1]), dims };
  }
  return out;
}

// 单面 UV 写入：BoxGeometry 每面 4 顶点 uv 序 [左上, 右上, 左下, 右下]（uv 空间）。
// flipU/flipV 按区域角点交换（PNG y 向下 → uv v=1-y/64 已在角点坐标内处理）。
// 导出供 FirstPersonHand 复用（B41：第一人称手臂与第三人称同一套面表，禁止各写一套）。
export function setFaceUV(geo, faceIndex, rect, flipU, flipV) {
  const u0 = rect.x / 64, u1 = (rect.x + rect.w) / 64;
  const vT = 1 - rect.y / 64, vB = 1 - (rect.y + rect.h) / 64;
  const LT = [u0, vT], RT = [u1, vT], LB = [u0, vB], RB = [u1, vB];
  let order = [LT, RT, LB, RB];
  if (flipU && !flipV) order = [RT, LT, RB, LB];
  if (!flipU && flipV) order = [LB, RB, LT, RT];
  if (flipU && flipV) order = [RB, LB, RT, LT];
  const uv = geo.attributes.uv;
  for (let k = 0; k < 4; k++) uv.setXY(faceIndex * 4 + k, order[k][0], order[k][1]);
}

// 构建"已按皮肤 UV 写好的部件长方体"（B41：第一人称手臂与第三人称共用同一套 FACE_MAP）。
// partKey: partRects 的键（head/body/armR/armL/legR/legL）；model: 'classic'|'slim'
// size: 世界尺寸 { w, h, d }（缺省按原版 16px = 1 格换算）；返回 BoxGeometry（长轴仍按原版：手臂沿 Y）。
export function buildPartBox(partKey, model = 'classic', size = null) {
  const r = partRects(model)[partKey];
  if (!r) throw new Error(`未知部件：${partKey}`);
  const s = size || { w: r.dims.w / 16, h: r.dims.h / 16, d: r.dims.d / 16 };
  const geo = new THREE.BoxGeometry(s.w, s.h, s.d);
  for (const fm of FACE_MAP) setFaceUV(geo, fm.face, r.base[fm.sel], fm.flipU, fm.flipV);
  geo.attributes.uv.needsUpdate = true;
  return geo;
}

// 把整张皮肤贴到部件几何集合上（双层）。
// rig: { joints: { [key]: { pivot, mesh } }, partsByName?: { [key]: mesh } }——
// joints 只含关节部件（head/双臂/双腿），body 无 pivot 仅在 partsByName；
// pivot 取 mesh.parent（body 的 parent=group，overlay 随整体运动）。
// img: HTMLImageElement（64×64，legacy 已归一化）；model: 'classic'|'slim'
export function applySkinToRig(rig, img, model = 'classic') {
  const rects = partRects(model);
  const texture = new THREE.CanvasTexture(img);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  const baseMat = new THREE.MeshLambertMaterial({ map: texture });
  const ovMat = new THREE.MeshLambertMaterial({
    map: texture, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide,
  });
  const disposables = [];
  for (const [key, rect] of Object.entries(rects)) {
    const joint = rig.joints && rig.joints[key];
    const mesh = (joint && joint.mesh) || (rig.partsByName && rig.partsByName[key]);
    if (!mesh) continue;
    const pivot = (joint && joint.pivot) || mesh.parent;
    // base 层：直接覆写 mesh 几何 UV + 换材质
    for (const fm of FACE_MAP) setFaceUV(mesh.geometry, fm.face, rect.base[fm.sel], fm.flipU, fm.flipV);
    mesh.geometry.attributes.uv.needsUpdate = true;
    mesh.material = baseMat;
    // overlay 层：克隆几何（UV 写 overlay 区域）+ 外扩 0.5px 的壳 mesh 挂同一 pivot
    const ovGeo = mesh.geometry.clone();
    for (const fm of FACE_MAP) setFaceUV(ovGeo, fm.face, rect.overlay[fm.sel], fm.flipU, fm.flipV);
    ovGeo.attributes.uv.needsUpdate = true;
    const ovMesh = new THREE.Mesh(ovGeo, ovMat);
    // 关节部件的 mesh 相对 pivot 有偏移（head +0.25 / 臂 -0.25 / 腿 -0.375；body 相对 group (0,1.125,0)），
    // overlay 壳必须复制同款局部变换，否则整体错位（曾表现为 hat 层下移 4px、猫耳盖到眼睛）
    ovMesh.position.copy(mesh.position);
    ovMesh.rotation.copy(mesh.rotation);
    const s = rect.dims;
    ovMesh.scale.set((s.w + 0.5) / s.w, (s.h + 0.5) / s.h, (s.d + 0.5) / s.d);
    pivot.add(ovMesh);
    rig.overlayMeshes = rig.overlayMeshes || [];
    rig.overlayMeshes.push(ovMesh);
    disposables.push(ovGeo);
  }
  return {
    texture,
    materials: { baseMat, ovMat },
    dispose() {
      for (const ov of rig.overlayMeshes || []) {
        if (ov.parent) ov.parent.remove(ov);
      }
      rig.overlayMeshes = [];
      for (const g of disposables) g.dispose();
      baseMat.dispose();
      ovMat.dispose();
      texture.dispose();
    },
  };
}

// ── legacy 64×32 归一化（B41 重写）────────────────────────────────────
// 64×32（旧版）布局 = 64×64 的上半区；下半区（左臂/左腿 base 与全部 overlay）整段缺失。
// B41 前只把 y16..31 下移 16px，左臂(32,48)/左腿(16,48) 的 base 与 overlay 仍整面透明，
// transparent:false 材质下渲染成纯黑肢体（实测 8 个区域 alpha=0）。
// 现按原版 1.8 语义补位：
//   ① 左肢 base ← 右肢 base 的**几何镜像**（x → -x）：±X 两面互换区域，六个面均水平翻转；
//   ② overlay ← 自身 base 直拷（旧皮肤没有身体/四肢的第二层数据，复制层让双层渲染与单层一致）；
//      head 的 hat 区保持**原样**——1.7 皮肤本来就自带帽层数据（(32,0) 8×8），
//      无帽的皮肤那块是透明的，绝不能拿 base 顶替（否则头顶凭空多一层放大的头）。
// 纯数据拆分：legacySkinOps() 只产拷贝算子（node 可测），normalizeSkin() 负责执行。
export function isLegacySkin(img) { return img.height === 32 && img.width === 64; }

// 需要镜像补位的左右肢对（右 → 左）
const LEGACY_LIMB_PAIRS = [['armR', 'armL'], ['legR', 'legL']];
// 不生成 overlay 的部件（hat 用旧皮肤自带的 (32,0) 区域，不被 base 顶替）
const LEGACY_NO_OVERLAY = ['head'];
const FACE_KEYS = ['front', 'back', 'top', 'bottom', 'right', 'left'];

// legacy 64×32 → 64×64 的拷贝算子表：[{ sx, sy, w, h, dx, dy, flipH, from }]
//   from='image'（源=原始 64×32 图）| 'canvas'（源=已写入上半区与左肢的画布，用于 overlay）
// 纯函数（只依赖 partRects），node 直接可测；坐标系为 PNG 像素（y 向下）。
export function legacySkinOps(model = 'classic') {
  const rects = partRects(model);
  const ops = [];
  const copy = (src, dst, flipH, from) => ops.push({ sx: src.x, sy: src.y, w: src.w, h: src.h, dx: dst.x, dy: dst.y, flipH, from });
  // ① 左肢 base ← 右肢 base 镜像：±X 两面互换，其余四面同区域
  for (const [r, l] of LEGACY_LIMB_PAIRS) {
    for (const face of ['front', 'back', 'top', 'bottom']) copy(rects[r].base[face], rects[l].base[face], true, 'image');
    copy(rects[r].base.left, rects[l].base.right, true, 'image');   // 左肢 +X 面 ← 右肢 -X 面
    copy(rects[r].base.right, rects[l].base.left, true, 'image');
  }
  // ② overlay ← base 直拷（源取画布：左肢 base 是上一步补出来的）
  for (const key of Object.keys(rects)) {
    if (LEGACY_NO_OVERLAY.includes(key)) continue;
    for (const face of FACE_KEYS) copy(rects[key].base[face], rects[key].overlay[face], false, 'canvas');
  }
  return ops;
}

// 在浏览器执行：返回归一化后的 canvas（legacy 输入）或原 img（现代皮肤）
export function normalizeSkin(img) {
  if (!isLegacySkin(img)) return img;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0); // 上半区原样（头/身体/右肢 base 与头顶 base 都在这里）
  for (const op of legacySkinOps()) {
    const src = op.from === 'canvas' ? cv : img;
    if (!op.flipH) {
      ctx.drawImage(src, op.sx, op.sy, op.w, op.h, op.dx, op.dy, op.w, op.h);
      continue;
    }
    // 水平镜像落位：平移到目标右边界后 x 取反
    ctx.save();
    ctx.translate(op.dx + op.w, op.dy);
    ctx.scale(-1, 1);
    ctx.drawImage(src, op.sx, op.sy, op.w, op.h, 0, 0, op.w, op.h);
    ctx.restore();
  }
  return cv;
}

// ── 皮肤来源与持久化 ───────────────────────────────────────────────────
// prefs: { data: dataURL|null（null=用内置默认）, model: 'classic'|'slim', source: 'upload'|'username'|'default' }
export function getSkinPrefs() {
  try {
    const raw = localStorage.getItem(SKIN_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && (p.model === 'classic' || p.model === 'slim')) {
        return { data: typeof p.data === 'string' ? p.data : null, model: p.model, source: p.source || 'default' };
      }
    }
  } catch (e) { /* 损坏的存储按默认处理 */ }
  return { data: null, model: 'classic', source: 'default' };
}

export function saveSkinPrefs(prefs) {
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch (e) { return false; }
}

export function clearSkinPrefs() {
  try { localStorage.removeItem(SKIN_STORAGE_KEY); } catch (e) { /* 忽略 */ }
}

// 解析图片 URL / dataURL → HTMLImageElement（浏览器异步）
// B41：跨域图片必须设 crossOrigin='anonymous'，否则画布被标记为 tainted，
//   随后的 drawImage→toDataURL 会抛 SecurityError（Pages 上按用户名取皮肤的静默失败主因）。
// 同源与 data: 不受影响；超时兜底防止镜像站挂起把面板卡在"正在获取…"。
export function loadImageFromURL(url, opts = {}) {
  const { crossOrigin = true, timeoutMs = 8000 } = opts;
  return new Promise((resolve, reject) => {
    const img = new Image();
    let done = false;
    const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); fn(arg); };
    const timer = setTimeout(() => finish(reject, new Error('皮肤图片加载超时')), timeoutMs);
    if (crossOrigin && /^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (img.width === 64 && (img.height === 64 || img.height === 32)) finish(resolve, img);
      else finish(reject, new Error(`皮肤尺寸须为 64×64（或旧版 64×32），当前 ${img.width}×${img.height}`));
    };
    img.onerror = () => finish(reject, new Error('皮肤图片加载失败'));
    img.src = url;
  });
}

// 第三方皮肤镜像（B41：静态托管上没有 node 服务器时的回退链），按**用户名**直取 PNG。
// 顺序按实测排：minotar 对浏览器请求带 Access-Control-Allow-Origin: *（可读回画布）；
// mc-heads 的 ACAO 只对非浏览器客户端出现（curl 有、浏览器 Origin 下被拒），故降为备用。
// 代价：镜像不提供 slim 判定，只能按 classic 臂宽渲染。
export const SKIN_MIRRORS = [
  { name: 'minotar', url: (n) => `https://minotar.net/skin/${n}` },
  { name: 'mc-heads', url: (n) => `https://mc-heads.net/skin/${n}` },
];

// 本机 LAN 服务器的候选是否值得尝试：只有本地开发地址或 http 页面（内网直连）才可能命中；
// 静态托管（https 的 Pages）上 `http://<pages-host>:3001` 必被混合内容拦截，不再白白试一次。
function localServerWorthTrying(protocol, hostname) {
  if (protocol === 'http:') return true;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

// 按用户名取皮肤的候选链（纯函数，node 可测）：[{ kind:'proxy'|'local'|'mirror', url, name }]
//   ctx = { netUrl?: 'ws://host:3001/ws', protocol: 'https:', hostname: 'example.org' }
// 顺序：联机代理 → 本机 3001（仅本地/http）→ 第三方镜像 → 由调用方兜底提示上传。
export function buildSkinCandidates(username, ctx = {}) {
  const enc = encodeURIComponent(username);
  const out = [];
  const { netUrl, protocol = 'https:', hostname = '' } = ctx;
  if (netUrl) {
    const base = String(netUrl).replace(/^ws/, 'http').replace(/\/ws$/, '');
    out.push({ kind: 'proxy', name: 'Mojang API', url: `${base}/api/skin/${enc}` });
  }
  if (localServerWorthTrying(protocol, hostname)) {
    out.push({ kind: 'local', name: 'Mojang API', url: `http://${hostname}:3001/api/skin/${enc}` });
  }
  for (const m of SKIN_MIRRORS) out.push({ kind: 'mirror', name: m.name, url: m.url(enc) });
  // 联机时代理地址与本机 3001 可能同 URL：去重（保留先出现的那条）
  const seen = new Set();
  return out.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

// 当前 prefs → 已归一化的皮肤图（浏览器异步）。顺序：用户 data（有则用，含 model）→ 内置默认。
export async function loadActiveSkin() {
  const prefs = getSkinPrefs();
  const model = prefs.model;
  try {
    if (prefs.data) {
      const img = await loadImageFromURL(prefs.data);
      return { img: normalizeSkin(img), model, source: prefs.source };
    }
  } catch (e) { /* 上传数据失效回落默认 */ }
  const img = await loadImageFromURL(DEFAULT_SKIN_URLS[model]);
  return { img: normalizeSkin(img), model, source: 'default' };
}
