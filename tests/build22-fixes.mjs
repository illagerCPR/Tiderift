// build22-fixes.mjs -- Build 22 修复批次回归（node 直跑，无需服务器）
// 断言：
//   ① overlay 双层对齐：applySkinToRig 后 ovMesh 复制 base 部件局部变换
//     （功能级——真 rig + 假 img 跑完整管线，head/臂/腿/body 逐部件位置一致 + 同父节点）
//   ② 第一人称手臂缩小：0.16×0.16×0.42（构造兜底与 applySkin 贴肤两处一致）
//   ③ 实体体素光染色：sampleEntityLight 三态数值锚点 + applyEntityLight 基色保持/不叠加
//     + 怪物/本地玩家/远端玩家/第一人称手臂四处接线绊线
//   ④ 服务器皮肤拉取管理日志：handleSkinLookup 返回 {code,note} + 路由 logAdmin('skin-fetch') 绊线
//   ⑤ i18n「Minecraft®: Java Edition档案用户名」10 包在场（旧键清除）
//   ⑥ BUILD = 23
import { readFileSync } from 'fs';
import * as THREE from 'three';
import { applySkinToRig, partRects } from '../src/entity/PlayerSkin.js';
import { buildParts } from '../src/entity/RemotePlayer.js';
import { sampleEntityLight, applyEntityLight } from '../src/render/entityLight.js';
import { BUILD } from '../src/version.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// 与 LocalPlayerModel._buildRig 同构的最小 rig（pivot 偏移/无 pivot 直挂 group 全一致）
function buildRig(model) {
  const group = new THREE.Group();
  const joints = {};
  const partsByName = {};
  for (const def of buildParts(model)) {
    const [minX, minY, minZ, maxX, maxY, maxZ] = def.box;
    const geo = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    if (def.pivot) {
      const pivot = new THREE.Group();
      pivot.position.set(def.pivot[0], def.pivot[1], def.pivot[2]);
      mesh.position.set((minX + maxX) / 2 - def.pivot[0], (minY + maxY) / 2 - def.pivot[1], (minZ + maxZ) / 2 - def.pivot[2]);
      pivot.add(mesh);
      group.add(pivot);
      joints[def.role] = { pivot, mesh };
    } else {
      mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      group.add(mesh);
    }
    partsByName[def.role] = mesh;
  }
  return { group, joints, partsByName };
}

// ── ① overlay 对齐（Build 22 修复①：猫耳眼镜 bug） ──
{
  // 源码绊线：ovMesh 必须复制 base 部件的局部变换
  const ps = srcOf('../src/entity/PlayerSkin.js');
  ok(ps.includes('ovMesh.position.copy(mesh.position)'), 'applySkinToRig：ovMesh 复制 mesh.position');
  ok(ps.includes('ovMesh.rotation.copy(mesh.rotation)'), 'applySkinToRig：ovMesh 复制 mesh.rotation（防御）');

  // 功能级：经典模型完整管线
  for (const model of ['classic', 'slim']) {
    const rig = buildRig(model);
    const fakeImg = { width: 64, height: 64 }; // node 下 CanvasTexture 仅存引用，不上传 GPU
    const handle = applySkinToRig(rig, fakeImg, model);
    ok(handle && handle.dispose, `${model}：applySkinToRig 返回句柄`);
    ok(Array.isArray(rig.overlayMeshes) && rig.overlayMeshes.length === 6,
      `${model}：6 个部件全部生成 overlay`);
    // 逐部件：overlay 与 base 同父节点 + 局部位置一致（错位 bug 的直接断言）
    const expected = {
      head: [0, 0.25, 0],     // pivot 颈部 y=1.5，头中心 1.75
      body: [0, 1.125, 0],    // 无 pivot，相对 group 的中心偏移
      armR: [0, -0.25, 0],    // pivot 肩 y=1.375，臂中心 1.125
      armL: [0, -0.25, 0],
      legR: [0, -0.375, 0],   // pivot 髋 y=0.75，腿中心 0.375
      legL: [0, -0.375, 0],
    };
    for (const [key, exp] of Object.entries(expected)) {
      const base = rig.partsByName[key];
      // overlay 的定位方式：与 base 同父节点、在 overlayMeshes 内且不是 base 本身
      //（head/臂/腿的 pivot 子节点恰为 [base, overlay]；body 的 overlay 是 group 根下唯一 overlay）
      const ovMesh = rig.overlayMeshes.find((m) => m !== base && m.parent === base.parent);
      ok(!!ovMesh, `${model}/${key}：overlay 在场且与 base 同父节点`);
      ok(near(ovMesh.position.x, exp[0]) && near(ovMesh.position.y, exp[1]) && near(ovMesh.position.z, exp[2]),
        `${model}/${key}：overlay 局部位置 (${ovMesh.position.x},${ovMesh.position.y},${ovMesh.position.z}) = (${exp})`);
      ok(near(ovMesh.scale.y, (partRects(model)[key].dims.h + 0.5) / partRects(model)[key].dims.h),
        `${model}/${key}：overlay 外扩 0.5px 壳比例不变`);
    }
    // head overlay 壳必须挂在颈部 pivot（而不是 group 根），随头部俯仰运动
    ok(rig.overlayMeshes.some((m) => m.parent === rig.joints.head.pivot), `${model}：head overlay 挂 head pivot`);
    handle.dispose();
    ok(rig.overlayMeshes.length === 0, `${model}：dispose 清空 overlay`);
  }
}

// ── ② 第一人称手臂尺寸（Build 22 修复②） ──
{
  const src = srcOf('../src/render/FirstPersonHand.js');
  const geoCount = src.split('new THREE.BoxGeometry(0.16, 0.16, 0.42)').length - 1;
  ok(geoCount === 2, `第一人称手臂几何 0.16×0.16×0.42 恰好两处（兜底+贴肤），当前 ${geoCount}`);
  ok(!src.includes('0.25, 0.25, 0.5'), '旧尺寸 0.25×0.25×0.5 已移除');
  const posCount = src.split('this.armMesh.position.set(0, -0.07, 0.30)').length - 1;
  ok(posCount === 2, `手臂挂位 (0,-0.07,0.30) 恰好两处，当前 ${posCount}`);
  ok(!src.includes('0.13, 0.13, 0.48'), 'Build 21 前旧兜底几何已同步，不再残留双尺寸');
}

// ── ③ 实体体素光染色（Build 22 修复③） ──
{
  // 采样数值锚点（与 MobManager 旧公式逐字一致）
  const torchWorld = { getSkyLight: () => 0, getBlockLightAt: () => 15 }; // 黑暗洞穴火把旁
  const darkWorld = { getSkyLight: () => 0, getBlockLightAt: () => 0 };   // 全黑
  const dayWorld = { getSkyLight: () => 15, getBlockLightAt: () => 0 };   // 正午地表
  const nightSky = { getLightLevel: () => 0 };
  const daySky = { getLightLevel: () => 1 };

  const tTorch = sampleEntityLight(torchWorld, nightSky, new THREE.Vector3(0, 64, 0));
  ok(near(tTorch.r, 1.18) && near(tTorch.g, 1.0) && near(tTorch.b, 0.9),
    '火把旁（夜）: v=1.0，暖色 (1.18, 1.0, 0.9)');
  ok(tTorch.r > tTorch.g && tTorch.g > tTorch.b, '方块光暖色偏移：r > g > b');
  const tDark = sampleEntityLight(darkWorld, nightSky, new THREE.Vector3(0, 64, 0));
  ok(near(tDark.r, 0.55) && near(tDark.g, 0.55) && near(tDark.b, 0.55), '全黑: v=0.55 下限，中性色');
  const tDay = sampleEntityLight(dayWorld, daySky, new THREE.Vector3(0, 64, 0));
  ok(near(tDay.r, 1.0) && near(tDay.g, 1.0) && near(tDay.b, 1.0), '正午地表: 全亮中性色');
  // 混合态：天光 10/15 × 昼 0.5 = 0.333 < 方块光 6/15 = 0.4 → 取方块光
  const mixWorld = { getSkyLight: () => 10, getBlockLightAt: () => 6 };
  const tMix = sampleEntityLight(mixWorld, { getLightLevel: () => 0.5 }, new THREE.Vector3(0, 64, 0));
  const vmix = 0.55 + 0.45 * 0.4;
  ok(near(tMix.g, vmix), '混合光照取 max(天光×昼夜, 方块光)');
  const noWorld = sampleEntityLight(null, daySky, new THREE.Vector3(0, 64, 0));
  ok(near(noWorld.r, 1) && near(noWorld.g, 1) && near(noWorld.b, 1), 'world 缺失时原样返回（安全跳过）');

  // applyEntityLight：基色保持 + 不叠加（每帧从基色重乘，不累积）
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xff0000 }));
  const base = mesh.material.color.clone();
  applyEntityLight(torchWorld, nightSky, new THREE.Vector3(0, 64, 0), mesh);
  ok(near(mesh.material.color.r, base.r * 1.18) && near(mesh.material.color.g, base.g) && near(mesh.material.color.b, base.b * 0.9),
    '染色 = 基色 × 光色（红件在火把旁仍为红，只调明暗暖冷）');
  // 方块光直发光（emissive）：夜晚 Lambert 场景光≈0，靠火光通道让实体被火把"照亮"。
  // emissive = 火光色 × 基色（albedo 调制，保纹理）× 强度
  ok(near(mesh.material.emissiveIntensity, 0.85), '火把旁（夜）emissiveIntensity = 0.85×glow(1)');
  ok(near(mesh.material.emissive.r, 1.0) && near(mesh.material.emissive.g, 0) && near(mesh.material.emissive.b, 0),
    '红件 emissive = (1.0,0.82,0.58)×基色红 → 只剩红通道（albedo 调制）');
  const whiteMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  applyEntityLight(torchWorld, nightSky, new THREE.Vector3(0, 64, 0), whiteMesh);
  ok(near(whiteMesh.material.emissive.r, 1.0) && near(whiteMesh.material.emissive.g, 0.82) && near(whiteMesh.material.emissive.b, 0.58),
    '白基色 emissive = 火光色 (1.0, 0.82, 0.58)，与地形 uTorchTint 同色');
  applyEntityLight(darkWorld, nightSky, new THREE.Vector3(0, 64, 0), mesh);
  ok(near(mesh.material.color.r, base.r * 0.55), '连续染色不叠加：暗处回到基色×0.55（而非 0.55²）');
  ok(near(mesh.material.emissiveIntensity, 0), '无方块光时火光辉光归零');
  ok(!!mesh.material.userData.entityLightBase, '基色快照存入 userData（换肤换材质自动重建）');
  applyEntityLight(null, null, new THREE.Vector3(0, 64, 0), mesh);
  ok(near(mesh.material.color.r, base.r * 0.55), 'world 缺失时染色跳过、颜色保持');
  // 数组项与 undefined 混合、单 mesh 直传两种入参形态
  const mesh2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  applyEntityLight(dayWorld, daySky, new THREE.Vector3(0, 64, 0), [mesh2, null], mesh, undefined);
  ok(near(mesh2.material.color.r, 1) && near(mesh2.material.color.g, 1), '数组/单 mesh/undefined 混合入参安全');

  // glow 系数：白天地表火光被日光淹没 → 0；洞穴/夜晚 → 全额
  ok(sampleEntityLight(dayWorld, daySky, new THREE.Vector3()).glow === 0, '白天地表 glow=0（火光不可见）');
  ok(near(sampleEntityLight(torchWorld, nightSky, new THREE.Vector3()).glow, 1), '黑暗火把旁 glow=1');
  const glowWorld = { getSkyLight: () => 8, getBlockLightAt: () => 8 };
  ok(near(sampleEntityLight(glowWorld, { getLightLevel: () => 0.5 }, new THREE.Vector3()).glow, 0.3768889, 1e-4),
    '半明半暗 glow = blkL × (1 - 天光×(0.10+0.90×L))');

  // 接线绊线：四处模型/怪物每帧调用
  ok(srcOf('../src/entity/LocalPlayerModel.js').includes('applyEntityLight(this.game.world'),
    'LocalPlayerModel 第三人称接入体素光染色');
  ok(srcOf('../src/entity/RemotePlayer.js').includes('applyEntityLight(this.game.world'),
    'RemotePlayer 联机远端玩家接入体素光染色');
  ok(srcOf('../src/entity/RemotePlayer.js').includes('this.hitFlash <= 0 && this.game && this.game.world'),
    'RemotePlayer 受击红光帧让位 emissive（红光/辉光通道互斥）');
  ok(srcOf('../src/render/FirstPersonHand.js').includes('applyEntityLight(this.game.world'),
    'FirstPersonHand 第一人称手臂接入体素光染色');
  const mm = srcOf('../src/entity/MobManager.js');
  ok(mm.includes('applyEntityLight(this.world, sky, mob.mesh.position, mob.mesh)'),
    'MobManager 改走共享公式（单一来源）');
  ok(!mm.includes('const v = 0.55 + 0.45 * l'), 'MobManager 内联旧公式已移除（防漂移）');
  ok(!mm.includes('mm.emissive.setRGB(0, 0, 0)'), 'MobManager 常态清零 emissive 已移除（辉光每帧重写）');
  ok(!srcOf('../src/render/HeldItemMesh.js').includes('entityLight'), 'HeldItemMesh 不参与实体染色（共享材质防串色）');
}

// ── ④ 服务器皮肤拉取管理日志（Build 22 ④） ──
{
  const srv = srcOf('../server/index.mjs');
  ok(srv.includes("logAdmin('skin-fetch'"), '皮肤代理路由写管理日志 op=skin-fetch');
  ok(srv.includes('return { code: 200, note: `mojang/${model}` }'), 'handleSkinLookup 成功出口返回 {code,note}');
  ok(srv.includes("return { code: 404, note: '用户名不存在' }"), 'handleSkinLookup 404 出口返回 {code,note}');
  ok(srv.includes('return { code: 200, note: \'缓存\' }'), '缓存命中出口返回 {code,note}');
  ok(/const r = await handleSkinLookup\(res, username\);\s*\n\s*logAdmin\('skin-fetch'/.test(srv.replace(/\r/g, '')),
    '路由先代理后写日志（带结果码）');
  ok(srv.includes(".replace(/^::ffff:/, '')"), '日志 IP 清洗 IPv6 映射前缀');
}

// ── ⑤ i18n 标签改版（Build 22 ⑤） ──
{
  const langs = ['zh-TW', 'en', 'fr', 'de', 'ja', 'ko', 'ar', 'ru', 'es', 'pt'];
  for (const lang of langs) {
    const src = srcOf(`../src/i18n/locales/${lang}.js`);
    ok(src.includes('"Minecraft®: Java Edition档案用户名"'), `语言包 ${lang} 新键在场`);
    ok(!src.includes('"正版用户名"'), `语言包 ${lang} 旧键已清除`);
  }
  ok(srcOf('../src/ui/SkinScreen.js').includes("t('Minecraft®: Java Edition档案用户名')"),
    'SkinScreen 占位符引用新键');
}

// ── ⑥ BUILD ──
ok(BUILD === 29, `BUILD 递增到 24（当前 ${BUILD}）`);

console.log(`build22-fixes: ${passed} assertions ALL PASS`);
