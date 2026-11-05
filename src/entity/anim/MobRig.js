// MobRig.js -- 怪物骨架：部件几何数据 + pivot 推导 + 体型判定（B44 第二轮）
// 纯逻辑模块（不 import three、不碰 DOM；只依赖 MobTextures 的纯函数 mobSkinUV），
// node 可直接单测（tests/build44-mob-rig.mjs）。
//
// 背景：B43 之前每种怪只有"所有 cuboid 烘焙成一个 BufferGeometry + 一个 Mesh"，走路整体平移，
// 结构上不可能有动作。本模块把 MobTextures 的命名 parts 拆成"每部件一份几何 + 一个 pivot"，
// 由 MobManager 组装成 group → bodyRoot → 关节 pivot → mesh，按体型模板做程序化动作。
//
// 防回退：
//   1) 几何数据生成保持与旧合并实现**逐顶点等价**（同一 FACE_DEFS/UV 选取，只是按 part 分组）；
//   2) pivot 不要按"部件中心"糊——四肢在根部、头在颈根、翼在翼根、尾在尾根，规则见 derivePartPivot；
//   3) 体型由 parts 名字推导（不新增 type 字段），新增怪物只要沿用命名约定就自动有动作。

import { mobSkinUV } from '../MobTextures.js';

// face 列号（与 MobTextures 的 atlas 列约定一致）
const FACE_COL = { front: 0, back: 1, left: 2, right: 3, top: 4, bot: 5 };

// 侧面 UV 选位：u1 落在"观察者右侧"（从外看不镜像），v1 朝上
const SIDE_UVS = [[1, 0], [1, 1], [0, 0], [0, 1]];
// 顶/底：u 随 x 走、v1 落 -Z（俯视不镜像）
const CAP_UVS = [[0, 0], [1, 0], [0, 1], [1, 1]];

const FACE_DEFS = [
  { name: 'right', corners: [[1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 1]], uvs: SIDE_UVS }, // +X
  { name: 'left', corners: [[0, 0, 1], [0, 1, 1], [0, 0, 0], [0, 1, 0]], uvs: SIDE_UVS },  // -X
  { name: 'top', corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], uvs: CAP_UVS },    // +Y
  { name: 'bot', corners: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]], uvs: CAP_UVS },    // -Y
  { name: 'front', corners: [[1, 0, 1], [1, 1, 1], [0, 0, 1], [0, 1, 1]], uvs: SIDE_UVS }, // +Z（脸朝向）
  { name: 'back', corners: [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0]], uvs: SIDE_UVS },  // -Z
];

export function partCenter(box) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = box;
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

// 单部件几何数据（顶点/UV/索引，模型局部坐标）。
// 输出与旧版"所有部件合并"的对应片段逐顶点一致（同一 FACE_DEFS 与 UV 选位）。
export function buildPartGeometryData(part) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = part.box;
  const dimX = maxX - minX;
  const dimY = maxY - minY;
  const dimZ = maxZ - minZ;
  const positions = [];
  const uvs = [];
  const indices = [];
  let idx = 0;
  for (const fdef of FACE_DEFS) {
    const uv = mobSkinUV(part.row, FACE_COL[fdef.name]);
    for (let c = 0; c < 4; c++) {
      const cx = fdef.corners[c][0];
      const cy = fdef.corners[c][1];
      const cz = fdef.corners[c][2];
      positions.push(minX + cx * dimX, minY + cy * dimY, minZ + cz * dimZ);
      const [us, vs] = fdef.uvs[c];
      uvs.push(us ? uv.u1 : uv.u0, vs ? uv.v1 : uv.v0);
    }
    // 统一绕序：每面两个三角形外法线一致
    indices.push(idx, idx + 1, idx + 2, idx + 1, idx + 3, idx + 2);
    idx += 4;
  }
  return { positions, uvs, indices };
}

// 部件 pivot（旋转支点）：返回 [x,y,z] 或 null（部件整体随 bodyRoot 动，不单独转）
export function derivePartPivot(name, box) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = box;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  // 头/颈：颈部在部件底面中心
  if (/^(head|neck|shell|bell)/.test(name)) return [cx, minY, cz];
  // 四肢/杆：根部在上表面中心（肩/髋/根）
  if (/^(arm|leg|rod|tent)/.test(name)) return [cx, maxY, cz];
  // 翅膀：根部在靠近身体的一侧（x 靠近 0 的那一端）
  if (/^wing/.test(name)) return [Math.abs(minX) < Math.abs(maxX) ? minX : maxX, cy, cz];
  // 尾巴：根部在靠近身体的一侧（z 靠近 0 的那一端）
  if (/^tail/.test(name)) return [cx, cy, Math.abs(minZ) < Math.abs(maxZ) ? minZ : maxZ];
  // 环绕光球：绕自身中心自转
  if (/^orb/.test(name)) return [cx, cy, cz];
  return null;
}

// 体型判定（纯名字推导；新增怪物沿用命名即可自动归类）
// flyingHint 来自 MobTypes[type].flying：没有翼也没有腿的悬浮怪（凋灵/潮鸣/风灵/烈焰人）走 floating，
// 有腿的（守誓巨像）仍按 biped 处理，避免把地面行走的 Boss 做成漂浮。
export function inferPlan(parts, flyingHint = false) {
  const names = parts.map((p) => p.name);
  const has = (re) => names.some((n) => re.test(n));
  const count = (re) => names.filter((n) => re.test(n)).length;
  const legs = count(/^leg/);
  if (has(/^wing/)) return 'flying';
  if (flyingHint && !has(/^(leg|arm)/)) return 'floating';
  if (count(/^rod/) >= 4 || count(/^orb/) >= 4 || count(/^tent/) >= 4) return 'floating';
  if (legs >= 6) return 'spider';
  if (legs >= 3) return 'quadruped';
  if (has(/^arm/)) return 'biped';
  return 'static';
}

// 把动作器的 pose 落到关节上（joints: name -> { pivot, mesh }）
export function applyMobPose(joints, pose) {
  if (!joints || !pose) return;
  for (const [name, joint] of Object.entries(joints)) {
    const rot = joint.pivot.rotation;
    if (/^(head|shell|bell)/.test(name)) {
      rot.x = pose.headX;
      rot.y = pose.headY;
    } else if (/^arm/.test(name)) {
      rot.x = name.endsWith('L') ? pose.armL : pose.armR;
      rot.z = 0;
    } else if (/^leg/.test(name)) {
      rot.x = legAngle(name, pose);
    } else if (/^wing/.test(name)) {
      rot.z = name.endsWith('L') ? pose.wingL : pose.wingR;
    } else if (/^tail/.test(name)) {
      rot.y = pose.tailY;
    } else if (/^(rod|orb)/.test(name)) {
      rot.y = pose.rodSpin + partPhase(name);
    } else if (/^tent/.test(name)) {
      rot.x = pose.tentSway;
    }
  }
}

// 四足/蜘蛛的腿相位：右前/左后同相、左前/右后反相（对角步态）
function legAngle(name, pose) {
  const p = pose;
  if (/^legF/.test(name)) return name.endsWith('R') ? p.legFR : p.legFL;
  if (/^legB/.test(name)) return name.endsWith('R') ? p.legBR : p.legBL;
  if (/^legM/.test(name)) return name.endsWith('R') ? p.legMR : p.legML;
  return name.endsWith('R') ? p.legR : p.legL;
}

// 同名族的错相位（blaze 四根杆 / 风灵四颗光球按名字方位角错开）
function partPhase(name) {
  const m = /(FR|FL|MR|ML|BR|BL)/.exec(name);
  const order = { FR: 0, FL: 1, MR: 2, ML: 3, BR: 2, BL: 3 };
  return m ? order[m[1]] * (Math.PI / 2) : 0;
}
