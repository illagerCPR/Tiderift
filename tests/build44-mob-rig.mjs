// build44-mob-rig.mjs -- Build 44 第二轮（怪物骨架）回归（纯 node，不依赖服务器）
// 断言：
//   ① 每部件几何数据与旧合并实现逐顶点等价（独立 oracle 在测试内重算六面角点，不复用实现表）；
//   ② UV 选位/索引/法线数据健康；全部 23 种怪物都有几何；
//   ③ pivot 规则：头在颈根、四肢在根部、翼在翼根、尾在尾根、光球在中心；
//   ④ 体型判定：biped / quadruped / spider / flying / floating / static 全表钉值；
//   ⑤ 动作器：两足摆腿摆臂、四足对角步态、蜘蛛三脚架、扇翅、悬浮自转、攻击前倾/受击后仰；
//   ⑥ 确定性 + 随机状态无 NaN + 追视角度钳制；
//   ⑦ 接线绊线：MobManager 按部件组装（不再单 Mesh）、光照传部件数组、销毁走 mobRigs。
import { readFileSync } from 'fs';
import { MobTypes } from '../src/entity/MobTextures.js';
import { buildPartGeometryData, derivePartPivot, inferPlan, applyMobPose } from '../src/entity/anim/MobRig.js';
import { MobAnimator } from '../src/entity/anim/MobAnimator.js';
import { ok, finish } from './harness.mjs';

const DT = 1 / 60;

// 独立 oracle：测试内重算六个面的 unit 角点（与实现里的 FACEDEFS 同口径，但来源独立、便于抓顺序漂移）
const FACE_SPEC = [
  { face: 'right', corners: [[1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 1]] },
  { face: 'left', corners: [[0, 0, 1], [0, 1, 1], [0, 0, 0], [0, 1, 0]] },
  { face: 'top', corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { face: 'bot', corners: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]] },
  { face: 'front', corners: [[1, 0, 1], [1, 1, 1], [0, 0, 1], [0, 1, 1]] },
  { face: 'back', corners: [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0]] },
];

function expectGeometry(part) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = part.box;
  const data = buildPartGeometryData(part);
  let bad = null;
  let vi = 0;
  for (const f of FACE_SPEC) {
    for (const c of f.corners) {
      const ex = minX + c[0] * (maxX - minX);
      const ey = minY + c[1] * (maxY - minY);
      const ez = minZ + c[2] * (maxZ - minZ);
      if (Math.abs(data.positions[vi * 3] - ex) > 1e-9
        || Math.abs(data.positions[vi * 3 + 1] - ey) > 1e-9
        || Math.abs(data.positions[vi * 3 + 2] - ez) > 1e-9) {
        if (!bad) bad = { part: part.name, vertex: vi };
      }
      vi++;
    }
  }
  return { data, bad, vertexCount: vi };
}

// ── ① 几何数据与独立 oracle 对拍 ───────────────────────────────────────
{
  let partCount = 0;
  let mismatch = null;
  let uvBad = null;
  for (const [typeName, type] of Object.entries(MobTypes)) {
    for (const part of type.model.parts) {
      const { data, bad } = expectGeometry(part);
      partCount++;
      if (bad && !mismatch) mismatch = { typeName, ...bad };
      if (data.positions.length !== 72 || data.uvs.length !== 48 || data.indices.length !== 36) {
        if (!uvBad) uvBad = { typeName, part: part.name, sizes: [data.positions.length, data.uvs.length, data.indices.length] };
      }
      for (const v of data.uvs) if (!Number.isFinite(v) || v < 0 || v > 1) { if (!uvBad) uvBad = { typeName, part: part.name, uv: v }; }
      for (const i of data.indices) if (!Number.isInteger(i) || i < 0 || i > 23) { if (!uvBad) uvBad = { typeName, part: part.name, index: i }; }
    }
  }
  ok(partCount >= 140, '全部怪物部件都有几何数据（实测 ' + partCount + ' 个）');
  ok(!mismatch, '几何逐顶点等价：' + (mismatch ? JSON.stringify(mismatch) : '六面角点全部命中独立 oracle'));
  ok(!uvBad, '几何健康：顶点/UV/索引长度与取值范围正确' + (uvBad ? '（' + JSON.stringify(uvBad) + '）' : ''));

  // 部件合并后的顶点总数 = 旧单 Mesh 的总数（结构等价性的量化锚点）
  const zombie = MobTypes.zombie;
  const total = zombie.model.parts.reduce((n, p) => n + buildPartGeometryData(p).positions.length / 3, 0);
  ok(total === zombie.model.parts.length * 24, '顶点总数 = 部件数 × 24（合并几何等价）');
}

// ── ② pivot 规则 ───────────────────────────────────────────────────────
{
  const headPivot = derivePartPivot('head', [-0.25, 1.5, -0.25, 0.25, 2.0, 0.25]);
  ok(headPivot[0] === 0 && headPivot[1] === 1.5 && headPivot[2] === 0, 'pivot：头在颈根（底面中心）');
  const armPivot = derivePartPivot('armR', [-0.52, 1.28, 0.14, -0.30, 1.5, 0.89]);
  ok(Math.abs(armPivot[0] - (-0.41)) < 1e-9 && armPivot[1] === 1.5, 'pivot：手臂在肩根（顶面中心）');
  const legPivot = derivePartPivot('legFR', [-0.24, 0, 0.02, -0.02, 0.4, 0.24]);
  ok(legPivot[1] === 0.4, 'pivot：四足腿在胯根（顶面中心）');
  const wingL = derivePartPivot('wingL', [-3.6, 2.65, -1.55, -0.6, 2.85, 1.3]);
  ok(Math.abs(wingL[0] + 0.6) < 1e-9, 'pivot：左翼在翼根（靠身体一侧）');
  const wingR = derivePartPivot('wingR', [0.6, 2.65, -1.55, 3.6, 2.85, 1.3]);
  ok(Math.abs(wingR[0] - 0.6) < 1e-9, 'pivot：右翼在翼根（靠身体一侧）');
  const tail = derivePartPivot('tail2', [-0.22, 1.95, -4.5, 0.22, 2.4, -3.0]);
  ok(Math.abs(tail[2] + 3.0) < 1e-9, 'pivot：尾巴在尾根（靠躯干一侧）');
  const orb = derivePartPivot('orbFR', [0.2, 1, 0.2, 0.4, 1.2, 0.4]);
  ok(Math.abs(orb[0] - 0.3) < 1e-9 && Math.abs(orb[1] - 1.1) < 1e-9 && Math.abs(orb[2] - 0.3) < 1e-9, 'pivot：光球绕自身中心自转');
  ok(derivePartPivot('body', [-0.25, 0.4, -0.14, 0.25, 1.2, 0.14]) === null, 'pivot：躯干不单独旋转');

  // 所有应当有 pivot 的命名部件都必须有
  const shouldPivot = /^(head|neck|shell|bell|arm|leg|rod|tent|wing|tail|orb)/;
  let missing = null;
  for (const [typeName, type] of Object.entries(MobTypes)) {
    for (const part of type.model.parts) {
      if (shouldPivot.test(part.name) && !derivePartPivot(part.name, part.box)) {
        if (!missing) missing = typeName + '/' + part.name;
      }
    }
  }
  ok(!missing, 'pivot 覆盖：命名关节部件全部有支点' + (missing ? '（缺 ' + missing + '）' : ''));
}

// ── ③ 体型判定全表 ─────────────────────────────────────────────────────
{
  const EXPECT = {
    zombie: 'biped', skeleton: 'biped', villager: 'biped', zombified_piglin: 'biped',
    wither_skeleton: 'biped', enderman: 'biped', iron_golem: 'biped', storm_colossus: 'biped',
    creeper: 'quadruped', cow: 'quadruped', sheep: 'quadruped', cloud_lamb: 'quadruped',
    spider: 'spider',
    dragon: 'flying', aether_guard: 'flying', gale_hawk: 'flying', mourn_howler: 'flying', chicken: 'flying',
    blaze: 'floating', wither: 'floating', wisp: 'floating', tide_echo: 'floating',
    shulker: 'static',
  };
  let wrong = null;
  for (const [typeName, type] of Object.entries(MobTypes)) {
    const plan = inferPlan(type.model.parts, !!type.flying);
    if (plan !== EXPECT[typeName] && !wrong) wrong = typeName + ' -> ' + plan + ' (期望 ' + EXPECT[typeName] + ')';
  }
  ok(!wrong, '体型判定全表命中' + (wrong ? '：' + wrong : ''));
  ok(Object.keys(MobTypes).length >= 23, '怪物类型数不少于 23（判定表覆盖完整）');
  ok(inferPlan([{ name: 'head' }, { name: 'body' }], false) === 'static', '体型判定：无肢体 → static');
}

// ── ④ 动作器：各体型的关节会动 ─────────────────────────────────────────
{
  const biped = new MobAnimator('biped');
  let legMax = 0;
  let mirror = true;
  for (let i = 0; i < 60; i++) {
    const p = biped.update(DT, { speed: 2.5, onGround: true });
    legMax = Math.max(legMax, Math.abs(p.legL), Math.abs(p.legR));
    if (Math.abs(p.legL + p.legR) > 1e-9) mirror = false;
  }
  ok(mirror, '两足：双腿始终反相');
  ok(legMax > 0.3, '两足：行走时腿摆动（幅度 ' + legMax.toFixed(2) + '）');

  const quad = new MobAnimator('quadruped');
  let samePair = true;
  for (let i = 0; i < 40; i++) {
    const p = quad.update(DT, { speed: 2, onGround: true });
    if (Math.abs(p.legFL - p.legBR) > 1e-9 || Math.abs(p.legFR + p.legFL) > 1e-9) samePair = false;
  }
  ok(samePair, '四足：对角腿同相、相邻腿反相（对角步态）');

  const spider = new MobAnimator('spider');
  let tripod = true;
  for (let i = 0; i < 40; i++) {
    const p = spider.update(DT, { speed: 1.5, onGround: true });
    if (Math.abs(p.legFL - p.legMR) > 1e-9 || Math.abs(p.legFL - p.legBL) > 1e-9) tripod = false;
    if (Math.abs(p.legFR + p.legFL) > 1e-9) tripod = false;
  }
  ok(tripod, '蜘蛛：三脚架步态（FL/MR/BL 同相、FR/ML/BR 反相）');

  const fly = new MobAnimator('flying');
  let flapMin = 1, flapMax = -1;
  for (let i = 0; i < 60; i++) {
    const p = fly.update(DT, { flying: true });
    flapMin = Math.min(flapMin, p.wingL);
    flapMax = Math.max(flapMax, p.wingL);
  }
  ok(flapMin < -0.1 && flapMax > 0.1, '飞行：双翼扇动');
  ok(fly.pose.wingR === -fly.pose.wingL || Math.abs(fly.pose.wingR + fly.pose.wingL) < 1e-9, '飞行：左右翼反向对称');

  const float = new MobAnimator('floating');
  float.update(DT, { flying: true });
  const spinA = float.pose.rodSpin;
  for (let i = 0; i < 30; i++) float.update(DT, { flying: true });
  ok(float.pose.rodSpin > spinA, '悬浮：杆体/光球持续自转');
  ok(Math.abs(float.pose.bodyY) < 0.1, '悬浮：起伏幅度克制（不飘走）');

  const idle = new MobAnimator('static');
  const p0 = idle.update(DT, {});
  ok(Number.isFinite(p0.headX) && Number.isFinite(p0.headY), '静态：追视角度为有限值');
}

// ── ⑤ 攻击前倾 / 受击后仰 / 追视钳制 ───────────────────────────────────
{
  const a = new MobAnimator('biped');
  for (let i = 0; i < 10; i++) a.update(DT, { speed: 0, onGround: true });
  const base = a.pose.bodyPitch;
  a.noteAttack();
  a.update(DT, { speed: 0, onGround: true });
  ok(a.pose.bodyPitch > base + 0.05, '攻击：前冲时身体前倾');
  for (let i = 0; i < 60; i++) a.update(DT, { speed: 0, onGround: true });
  ok(a.pose.bodyPitch < 0.15, '攻击：前倾在 1 秒内衰减');

  const h = new MobAnimator('biped');
  h.noteHurt();
  h.update(DT, { speed: 0, onGround: true });
  ok(h.pose.bodyPitch < -0.02, '受击：身体后仰（负前倾）');

  const look = new MobAnimator('biped');
  for (let i = 0; i < 90; i++) look.update(DT, { speed: 0, onGround: true, lookYaw: 99, lookPitch: 99 });
  ok(look.pose.headY <= 1.1 + 1e-9 && look.pose.headY >= -1.1 - 1e-9, '追视：偏航角被钳制在人形范围内');
  ok(look.pose.headX >= -0.8 - 1e-9 && look.pose.headX <= 0.8 + 1e-9, '追视：俯仰角被钳制');
  ok(look.pose.headX < 0, '追视：目标在上方时头部抬起（怪物朝 +Z，正 rotation.x 是低头）');
}

// ── ⑥ 确定性 + 数值健康 ───────────────────────────────────────────────
{
  const a = new MobAnimator('quadruped');
  const b = new MobAnimator('quadruped');
  const ctx = { speed: 2.2, onGround: true, lookYaw: 0.4, lookPitch: 0.2 };
  let same = true;
  for (let i = 0; i < 40; i++) {
    a.update(DT, ctx);
    b.update(DT, ctx);
    for (const k of Object.keys(a.pose)) if (a.pose[k] !== b.pose[k]) same = false;
  }
  ok(same, '确定性：相同输入序列姿态一致');

  const rand = (() => { let s = 424242; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); })();
  let bad = null;
  for (const plan of ['biped', 'quadruped', 'spider', 'flying', 'floating', 'static']) {
    const m = new MobAnimator(plan);
    for (let i = 0; i < 120; i++) {
      m.update(rand() * 0.2, {
        speed: rand() * 5, onGround: rand() < 0.7, flying: rand() < 0.3,
        lookYaw: (rand() - 0.5) * 10, lookPitch: (rand() - 0.5) * 10,
      });
      for (const k of Object.keys(m.pose)) if (!Number.isFinite(m.pose[k])) bad = plan + '/' + k;
    }
  }
  ok(!bad, '数值健康：六种体型随机序列无 NaN/Infinity' + (bad ? '（' + bad + '）' : ''));
}

// ── ⑦ 姿态落到关节（applyMobPose）──────────────────────────────────────
{
  const mk = () => ({ pivot: { rotation: { x: 0, y: 0, z: 0 } } });
  const joints = {
    head: mk(), headL: mk(), legFL: mk(), legFR: mk(), tail1: mk(), wingL: mk(), wingR: mk(), orbFR: mk(), tentFL: mk(),
  };
  applyMobPose(joints, {
    headX: 0.3, headY: 0.2, legFL: 0.4, legFR: -0.4, tailY: 0.1,
    wingL: -0.2, wingR: 0.2, rodSpin: 1.5, tentSway: 0.25,
  });
  ok(joints.head.pivot.rotation.x === 0.3 && joints.head.pivot.rotation.y === 0.2, '落点：头部俯仰/偏航');
  ok(joints.headL.pivot.rotation.x === 0.3, '落点：多头（凋灵）共用追视');
  ok(joints.legFL.pivot.rotation.x === 0.4 && joints.legFR.pivot.rotation.x === -0.4, '落点：四足腿分相位');
  ok(Math.abs(joints.tail1.pivot.rotation.y - 0.1) < 1e-9, '落点：尾巴摆动');
  ok(joints.wingL.pivot.rotation.z === -0.2 && joints.wingR.pivot.rotation.z === 0.2, '落点：双翼对称扇动');
  ok(joints.orbFR.pivot.rotation.y === 1.5, '落点：光球自转（无方位后缀 → 相位 0）');
  ok(Math.abs(joints.tentFL.pivot.rotation.x - 0.25) < 1e-9, '落点：触手摆动');
}

// ── ⑧ 接线绊线 ─────────────────────────────────────────────────────────
{
  const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
  const mm = src('../src/entity/MobManager.js');
  ok(mm.includes('buildPartGeometryData(part)') && mm.includes('derivePartPivot(part.name, part.box)'), '接线：MobManager 按部件建几何与 pivot');
  ok(mm.includes('inferPlan(type.model.parts, !!type.flying)') && mm.includes('new MobAnimator(rig.plan)'), '接线：体型模板随类型初始化');
  ok(mm.includes('applyMobPose(mob.joints, pose)') && mm.includes('applyEntityLight(this.world, sky, mob.mesh.position, mob.meshes)'), '接线：动作落点 + 多部件光照');
  ok(mm.includes('for (const rig of this.mobRigs.values())'), '接线：type 级几何销毁走 mobRigs');
  ok(src('../src/entity/Mob.js').includes('this.animator.noteAttack()'), '接线：怪物攻击触发前冲动作（纯表现）');
  ok(mm.includes('if (mob.hitFlash > 0) mob.animator.noteHurt()'), '接线：受击触发后仰动作');
  ok(!mm.includes('this.mobGeometries'), '绊线：旧的单 Mesh 几何表已删除（不得回退）');
  ok(!mm.includes('mob.mesh.material'), '绊线：材质不再从 Group 上取（走 mob.material）');
  ok(mm.includes('mesh.position.set(-part.pivot[0], -part.pivot[1], -part.pivot[2])'),
    '绊线：几何已是模型坐标 → 网格相对 pivot 只平移 -pivot（曾因再减部件中心导致部件散架）');
  ok(!mm.includes('partCenter('), '绊线：装配不再混用部件中心（防再次双偏移）');
}

finish('build44-mob-rig');
