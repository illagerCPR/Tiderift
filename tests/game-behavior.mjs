// tests/game-behavior.mjs -- src/player/Game.js 的 node 级行为回归（轮 8 路标 B：F3 拆分回归网）
//
// 意义：F3 要拆 Game.js 上帝类，但此前 67 个套件里**没有任何一个真正跑过 Game 的运行时行为**
//   （只有 ray-sphere.mjs 借原型调过两个方法，其余全是读源码做字符串断言）。
//   本套件把"拆分前必须保持不变"的现状行为钉成可执行断言。
//
// 覆盖面：
//   A boot（start 完成 / 无意外 console.error，PostFX 回退噪声显式窄化）
//   B 定步长帧循环（零异常 + 区块数/场景对象数落在实测带宽）
//   C 射线链（真实相机方向 → updateRaycast → selectedBlock → 创造瞬破）
//   D 生存挖掘（走真实挖掘路径逐帧累积到挖穿，不借 world.setBlock 抄近路）
//   E 重开生命周期（反复 start：投射物状态复位 + _disposeWorld 收口 + 场景对象无单调增长）
//   F 地形确定性（同 seed 两轮，固定坐标方块 id 逐点相等）
//   G 无人守契约（NetworkManager/BeaconScreen/SkinScreen 依赖但无测试守的接口）
//   H 帧耗时宽松上界（只抓灾难性回归）
//   I 首刀域行为（轮 8 步 1 迁移面：召唤 T 型结构 / 鞘翅滑翔气动 / 上升气流与风阵柱）
//
// 环境实现见 tests/lib/game-env.mjs（放 lib/ 子目录以避开 framework-guard 的单层套件扫描）。

import { assert, ok, finish } from './harness.mjs';
import { boot, createGame, step, quiesce, shutdown, gameClass } from './lib/game-env.mjs';

const SEED = 12345;

// PostFX 在 node 假 GL 下建不出 EffectComposer，PostFX._ensure 自带 try/catch 回退直渲并打一行
// console.error。这是**已知良性噪声**：窄化到这一条精确模式，其余任何 console.error 都算失败。
const BENIGN_BOOT_ERROR = /^\[PostFX\] 创建失败，回退直渲: /;

const games = [];
const track = (x) => { games.push(x); return x; };

// ── A. boot ──────────────────────────────────────────────────────────────
const b1 = await boot({ mode: 'creative', seed: SEED });
const g = track(b1.g);
ok(b1.running === true,
  'A1 boot：start() 跑完且 running=true（start 内部吞异常，必须用 running 判定而非"没抛错"）');

assert('A2 boot：worker 桩全部加载成功',
  b1.workerStats.failed === 0 && b1.workerStats.created >= 2,
  'created=' + b1.workerStats.created + ' failed=' + b1.workerStats.failed + ' ' + JSON.stringify(b1.workerStats.errors.slice(0, 1)));

const bootUnexpected = b1.errs.filter((e) => !BENIGN_BOOT_ERROR.test(e));
assert('A3 boot：除已知 PostFX 回退噪声外无 console.error', bootUnexpected.length === 0,
  JSON.stringify(bootUnexpected.slice(0, 2)));
assert('A4 boot：console.error 条数不超过已知噪声 1 条', b1.errs.length <= 1,
  'errs=' + JSON.stringify(b1.errs.slice(0, 3)));

// ── B. 定步长帧循环 ──────────────────────────────────────────────────────
const framesBad = await step(g, 60);
const bDurations = step.lastDurations.slice();   // H 段用这一批，别被后续 step 覆写
assert('B1 帧循环：连续 60 帧 update(1/60) 零异常', framesBad.length === 0, framesBad.slice(0, 2).join(' | '));

const chunks = g.world.chunks.size;
const children = g.renderer.scene.children.length;
assert('B2 帧循环：已加载区块数落在实测带宽内（宽松带，非钉值）',
  chunks >= 20 && chunks <= 500, 'chunks=' + chunks);
assert('B3 帧循环：scene children 落在实测带宽内（宽松带，非钉值）',
  children >= 20 && children <= 2500, 'children=' + children);
assert('B4 帧循环：children/区块数 比值合理（网格泄漏会让它爬升）',
  children / chunks >= 1.0 && children / chunks <= 3.0, 'ratio=' + (children / chunks).toFixed(2));

// ── C. 射线链：真实相机方向 → updateRaycast → 创造瞬破 ────────────────────
// 垂直朝下瞄准，保证射线命中脚下方块；selectedBlock 由 updateRaycast 每帧覆写，不能手工赋值。
g.player.pitch = -Math.PI / 2 + 0.05;
g.player.yaw = 0;
const aimBad = await step(g, 2);

const hitC = g.selectedBlock;
assert('C1 射线链：真实瞄准路径命中方块（updateRaycast 写入 selectedBlock）',
  !!hitC && !!hitC.block, 'selectedBlock=' + JSON.stringify(hitC && hitC.block) + ' ' + aimBad.slice(0, 1).join(''));

if (hitC && hitC.block) {
  const b = hitC.block;
  const before = g.world.getBlock(b.x, b.y, b.z);
  g.controls.mouseLeft = true;
  await step(g, 4);
  const after = g.world.getBlock(b.x, b.y, b.z);
  assert('C2 创造瞬破：左键后目标方块变空气', before !== 0 && after === 0,
    '(' + b.x + ',' + b.y + ',' + b.z + ') id ' + before + ' -> ' + after);
  assert('C3 创造瞬破：点击已被消费（mouseLeft 归位）', g.controls.mouseLeft === false,
    'mouseLeft=' + g.controls.mouseLeft);
} else {
  assert('C2 创造瞬破：左键后目标方块变空气', false, 'C1 未命中，无法判定');
  assert('C3 创造瞬破：点击已被消费（mouseLeft 归位）', false, 'C1 未命中，无法判定');
}

// ── D. 生存挖掘：走真实挖掘路径（不调 world.setBlock 抄近路）──────────────
g.controls.mouseLeft = false;
g.controls.mouseRight = false;
g.player.setMode('survival');
g.player.pitch = -Math.PI / 2 + 0.05;
g.player.yaw = 0;
g.inventory.slots[g.inventory.hotbarSelected] = { name: 'diamond_pickaxe', count: 1, data: null };
await step(g, 2);

const hitD = g.selectedBlock;
assert('D1 生存挖掘：瞄准到可挖方块', !!hitD && !!hitD.block,
  'selectedBlock=' + JSON.stringify(hitD && hitD.block));

if (hitD && hitD.block) {
  const t = hitD.block;
  const idBefore = g.world.getBlock(t.x, t.y, t.z);
  g.controls.mouseLeft = true;
  let mined = false;
  let used = 0;
  for (; used < 150; used++) {
    g.frame++;
    g.update(1 / 60);
    if (g.world.getBlock(t.x, t.y, t.z) === 0) { mined = true; break; }
    if (used % 20 === 19) await new Promise((r) => setTimeout(r, 0));
  }
  assert('D2 生存挖掘：逐帧累积挖掘进度后挖穿', mined && idBefore !== 0,
    '(' + t.x + ',' + t.y + ',' + t.z + ') id ' + idBefore + ' -> ' + g.world.getBlock(t.x, t.y, t.z) + ' frames=' + used);
  assert('D3 生存挖掘：挖掘标志在挖掘期被置起（NetworkManager:656 读取该字段）',
    used > 0 && g._miningActive === true, 'frames=' + used + ' _miningActive=' + g._miningActive);
} else {
  assert('D2 生存挖掘：逐帧累积挖掘进度后挖穿', false, 'D1 未命中，无法判定');
  assert('D3 生存挖掘：挖掘标志在挖掘期被置起（NetworkManager:656 读取该字段）', false, 'D1 未命中，无法判定');
}
g.controls.mouseLeft = false;
g.controls.mouseRight = false;

// ── E. 重开生命周期 ──────────────────────────────────────────────────────
const scene = g.renderer.scene;
const Mesh = g.breakMesh.constructor;
const BoxGeo = g.breakMesh.geometry.constructor;
const BasicMat = g.breakMesh.material.constructor;
const mkMesh = () => new Mesh(new BoxGeo(1, 1, 1), new BasicMat({}));

const lifecycle = [];
const ratios = [];
for (let round = 1; round <= 3; round++) {
  // 注入"上一存档残留"：三个新建型 Three 对象 + 投射物数组条目
  const m1 = mkMesh(), m2 = mkMesh(), m3 = mkMesh();
  scene.add(m1); scene.add(m2); scene.add(m3);
  g.arrows.push({ mesh: m1 });
  g.witherSkulls.push({ mesh: m2 });
  g.eyeFlight = { mesh: m3 };

  await g.start('creative', SEED, null, 1, true);   // 首句即 _disposeWorld()
  g.stop();
  g.controls.mouseLeft = false;
  g.controls.mouseRight = false;

  const cleared = g.arrows.length === 0 && g.witherSkulls.length === 0 && g.eyeFlight === null;
  const removed = !scene.children.includes(m1) && !scene.children.includes(m2) && !scene.children.includes(m3);
  assert('E' + round + ' 重开生命周期：_disposeWorld 收口投射物/末影之眼状态', cleared && removed,
    'arrows=' + g.arrows.length + ' skulls=' + g.witherSkulls.length + ' eyeFlight=' + (g.eyeFlight === null ? 'null' : 'set') +
    ' removed=' + removed);

  // 每轮暖机量必须一致，children/区块数 比值才可比——否则"网格建完没建完"会污染泄漏判定
  await step(g, 20);
  await quiesce(g);
  lifecycle.push({ children: scene.children.length, chunks: g.world.chunks.size });
  ratios.push(scene.children.length / g.world.chunks.size);
}

// 下界放到 1.0：慢机上 20 帧内水/光 mesh 可能还没建完，比值会更低；真正的泄漏检测靠 E5/E6
assert('E4 重开生命周期：children/区块数 比值稳定（泄漏会让比值逐轮爬升）',
  ratios.every((r) => r >= 1.0 && r <= 2.8), 'ratios=' + ratios.map((r) => r.toFixed(2)).join(','));
assert('E5 重开生命周期：比值无单调增长（实测 3 轮约 1.15-1.30；有泄漏会逐轮爬升）',
  ratios[ratios.length - 1] - ratios[0] < 0.35,
  'first=' + ratios[0].toFixed(3) + ' last=' + ratios[ratios.length - 1].toFixed(3));
assert('E6 重开生命周期：场景对象数未随重启次数累积',
  lifecycle[lifecycle.length - 1].children <= lifecycle[0].children * 1.5,
  lifecycle.map((x) => x.children + '/' + x.chunks).join(' '));

shutdown(g);

// ── F. 地形确定性：同 seed 两轮逐点相等 ──────────────────────────────────
const PTS = [];
for (let i = 0; i < 12; i++) {
  PTS.push([((i * 7) % 25) - 12, 58 + ((i * 5) % 14), ((i * 11) % 25) - 12]);
}

async function sampleWorld(seed) {
  const b = await boot({ mode: 'creative', seed });
  track(b.g);
  await step(b.g, 5);
  const ids = PTS.map(([x, y, z]) => b.g.world.getBlock(x, y, z));
  shutdown(b.g);
  return ids;
}

const sampleA = await sampleWorld(SEED);
const sampleB = await sampleWorld(SEED);
const solidCount = sampleA.filter((id) => id !== 0).length;

assert('F1 确定性：采样点非全空（防"全 0 == 全 0"式的空断言）',
  solidCount >= 4, 'solid=' + solidCount + '/' + PTS.length + ' ids=' + JSON.stringify(sampleA));
assert('F2 确定性：同 seed 两轮固定坐标方块 id 逐点相等',
  sampleA.length === sampleB.length && sampleA.every((v, i) => v === sampleB[i]),
  'A=' + JSON.stringify(sampleA) + ' B=' + JSON.stringify(sampleB));

// ── G. 无人守契约 ────────────────────────────────────────────────────────
// 这些接口被别的模块静默依赖（typeof 守卫 / 直接读字段），但此前无任何测试守着。
// 拆分 Game.js 时最容易无声打断的正是这一类。
const Game = await gameClass();

const menu = await createGame();
const mg = track(menu.g);
assert('G1 主菜单期：game.renderer 已存在（main.js:32 bakePanorama 在 start 之前用它）',
  !!mg.renderer, 'renderer=' + typeof mg.renderer);
assert('G2 主菜单期：game.controls 已存在（SkinScreen.js:298 在 start 之前进行为门控）',
  !!mg.controls, 'controls=' + typeof mg.controls);
assert('G3 主菜单期：game.networkMode 已存在且为 false（main.js:104 在 start 之前读它）',
  mg.networkMode === false, 'networkMode=' + String(mg.networkMode));
assert('G4 主菜单期：game.net 已声明（main.js:54 在 start 之前赋值，SkinScreen 读用它）',
  mg.net !== undefined, 'net=' + String(mg.net));
assert('G5 主菜单期：game.playerModel 已存在（皮肤保存路径 window.game.playerModel.refreshSkin）',
  !!mg.playerModel, 'playerModel=' + typeof mg.playerModel);
assert('G6 主菜单期：game.hand 已存在（皮肤保存路径 window.game.hand.loadSkin）',
  !!mg.hand, 'hand=' + typeof mg.hand);
shutdown(mg);

assert('G7 applyAetherDusk 存在（NetworkManager.js:264 / :388 的 typeof 静默守卫）',
  typeof g.applyAetherDusk === 'function', 'typeof=' + typeof g.applyAetherDusk);
assert('G8 _miningActive 存在且为布尔（NetworkManager.js:656 直接读它）',
  '_miningActive' in g && typeof g._miningActive === 'boolean',
  '_miningActive=' + String(g._miningActive) + ' typeof=' + typeof g._miningActive);
assert('G9 _getBeaconPower 存在（BeaconScreen.js:60 直接调用）',
  typeof g._getBeaconPower === 'function', 'typeof=' + typeof g._getBeaconPower);

assert('G10 Game.prototype._frameRay 仍在原型上（ray-sphere.mjs:145 用 Object.create 借原型实调）',
  typeof Game.prototype._frameRay === 'function', 'typeof=' + typeof Game.prototype._frameRay);
assert('G11 _frameRay 不是实例字段（改成类字段箭头函数会让借原型调用失效）',
  !Object.prototype.hasOwnProperty.call(g, '_frameRay'));
assert('G12 Game.prototype._anyInputBlockingUI 仍在原型上',
  typeof Game.prototype._anyInputBlockingUI === 'function', 'typeof=' + typeof Game.prototype._anyInputBlockingUI);
assert('G13 _anyInputBlockingUI 不是实例字段（同上）',
  !Object.prototype.hasOwnProperty.call(g, '_anyInputBlockingUI'));

// 与 ray-sphere.mjs:145 同款：借原型实调，验证契约真的可用而不只是"存在"
const fake = Object.create(Game.prototype);
fake.frame = 7;
fake.player = { position: { x: 1, y: 64, z: -3 } };
fake.renderer = { camera: { getWorldDirection: (v) => v.set(0, 0, -1) } };
const ray = fake._frameRay();
assert('G14 Object.create(Game.prototype) 可实调 _frameRay 且同帧缓存命中',
  !!ray && !!ray.origin && !!ray.dir && !!(ray.dir.z === -1) && fake._frameRay() === ray,
  'origin=' + JSON.stringify(ray && ray.origin) + ' dir.z=' + (ray && ray.dir.z));

// ── H. 帧耗时宽松上界（只抓灾难性回归，CI 机器差异大，不写紧阈值）──────────
const durs = bDurations;
const avgMs = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0;
const maxMs = durs.length ? Math.max(...durs) : 0;
assert('H1 帧耗时：平均 < 100ms/帧（宽松上界，只抓灾难性回归）', durs.length > 0 && avgMs < 100,
  'avg=' + avgMs.toFixed(1) + 'ms max=' + maxMs.toFixed(1) + 'ms n=' + durs.length);
assert('H2 帧耗时：单帧峰值 < 400ms（含区块网格构建突发）', maxMs < 400,
  'max=' + maxMs.toFixed(1) + 'ms avg=' + avgMs.toFixed(1) + 'ms');

// ── I. 首刀域行为：召唤（T 型结构）+ 滑翔/气流 ────────────────────────────
// 轮 8 步 1 的迁移面（Summoning / GlideWind）。迁移前先把现状行为**逐值**钉住：断言全部走
// Game 上的同名真实入口（_trySummonIronGolem / _trySummonWither / _updateGlideAero /
// _updateGlideFold / _hasGaleCloak / _updateUpdraftState / _writeGaleColumn / _clearGaleColumn），
// 迁到控制器后这些门面必须原样可用、数值逐位不变。
//
// 两处刻意的设计：
//   1) 用独立 boot：召唤会往世界里写方块、往 mobManager 里加实体，借共享的 g 会污染 A-H 段
//      （尤其 E 段的 children/区块数 比值）；本段放最后也保证 A-H 的执行顺序与状态零变化。
//   2) 气动断言的期望值由**源码公式 + 冻结常量**现算，不调被测方法自证——常量漂移即红。
{
  const d = await boot({ mode: 'creative', seed: SEED });
  track(d.g);
  const dg = d.g;
  const dW = dg.world;
  const dp = dg.player;
  const Reg = (await import('../src/core/BlockRegistry.js')).BlockRegistry;
  const ID = {
    iron: Reg.getId('iron_block'), pumpkin: Reg.getId('pumpkin'), sand: Reg.getId('soul_sand'),
    skullN: Reg.getId('wither_skeleton_skull'), skullE: Reg.getId('wither_skeleton_skull_e'),
    skullW: Reg.getId('wither_skeleton_skull_w'), wind: Reg.getId('wind_current'), stone: Reg.getId('stone'),
  };
  const DT = 1 / 60;
  const bx = Math.floor(dp.position.x) + 6;
  const bz = Math.floor(dp.position.z) + 6;
  const m0 = dg.mobManager.mobs.length;

  // ── 召唤：铁傀儡（南瓜头 + 2 格铁块身柱 + 双臂铁块）──
  {
    const y = 140;
    dW.setBlock(bx, y, bz, ID.pumpkin);
    dW.setBlock(bx, y - 1, bz, ID.iron);
    dW.setBlock(bx, y - 2, bz, ID.iron);
    dW.setBlock(bx - 1, y - 1, bz, ID.iron);
    dW.setBlock(bx + 1, y - 1, bz, ID.iron);
    const r = dg._trySummonIronGolem(bx, y, bz);
    const sp = dg.mobManager.mobs[m0];
    assert('I1 召唤：铁傀儡 T 型（南瓜头 + 2 格铁块身柱 + 双臂）就地召唤 iron_golem',
      r === true && dg.mobManager.mobs.length === m0 + 1 && !!sp && sp.typeName === 'iron_golem',
      'ret=' + r + ' mobs=' + m0 + '->' + dg.mobManager.mobs.length + ' type=' + (sp && sp.typeName));
    const cells = [[bx, y, bz], [bx, y - 1, bz], [bx, y - 2, bz], [bx - 1, y - 1, bz], [bx + 1, y - 1, bz]];
    const left = cells.filter((c) => dW.getBlock(c[0], c[1], c[2]) !== 0).length;
    assert('I2 召唤：铁傀儡消耗 5 块结构方块（走 setBlock，自动进账本/广播）', left === 0, 'leftover=' + left);
  }

  // ── 召唤反例：结构不满足一律不得召唤 ──
  {
    const y = 140, x1 = bx + 5, x2 = bx + 9;
    dW.setBlock(x1, y, bz, ID.pumpkin);
    dW.setBlock(x2, y, bz, ID.pumpkin);
    dW.setBlock(x2, y - 1, bz, ID.iron);
    dW.setBlock(x2, y - 2, bz, ID.iron);
    dW.setBlock(x2 - 1, y - 1, bz, ID.iron);   // 只放左臂，右臂缺失
    const before = dg.mobManager.mobs.length;
    const rPumpkin = dg._trySummonIronGolem(x1, y, bz);
    const rOneArm = dg._trySummonIronGolem(x2, y, bz);
    assert('I3 召唤反例：仅南瓜头 / 身柱齐但缺一侧手臂，均不得召唤',
      rPumpkin === false && rOneArm === false && dg.mobManager.mobs.length === before,
      'pumpkinOnly=' + rPumpkin + ' oneArm=' + rOneArm + ' mobs=' + before + '->' + dg.mobManager.mobs.length);
  }

  // ── 召唤：凋灵原版 T 型（3 头颅 + 3 灵魂沙 + 柱底 1）──
  const wz = bz + 6;
  {
    const ty = 140, wx = bx;
    for (let i = -1; i <= 1; i++) dW.setBlock(wx + i, ty, wz, ID.skullN);
    for (let i = -1; i <= 1; i++) dW.setBlock(wx + i, ty - 1, wz, ID.sand);
    dW.setBlock(wx, ty - 2, wz, ID.sand);
    const before = dg.mobManager.mobs.length;
    const r = dg._trySummonWither(wx, ty, wz);
    const sp = dg.mobManager.mobs[before];
    assert('I4 召唤：凋灵 T 型（3 头颅 + 3 灵魂沙 + 柱底 1）就地召唤 wither',
      r === true && dg.mobManager.mobs.length === before + 1 && !!sp && sp.typeName === 'wither',
      'ret=' + r + ' mobs=' + before + '->' + dg.mobManager.mobs.length + ' type=' + (sp && sp.typeName));
    let left = 0;
    for (let i = -1; i <= 1; i++) {
      if (dW.getBlock(wx + i, ty, wz) !== 0) left++;
      if (dW.getBlock(wx + i, ty - 1, wz) !== 0) left++;
    }
    if (dW.getBlock(wx, ty - 2, wz) !== 0) left++;
    assert('I5 召唤：凋灵消耗 7 块结构方块（走 setBlock，自动进账本/广播）', left === 0, 'leftover=' + left);
  }

  // ── 召唤：B28 头颅四朝向家族（曾用基名判层 → 朝东/西头颅的 T 型静默失效）──
  {
    const ty = 145, wx = bx;
    dW.setBlock(wx - 1, ty, wz, ID.skullN);
    dW.setBlock(wx, ty, wz, ID.skullE);        // 本次「放置」的是朝东的头颅变体
    dW.setBlock(wx + 1, ty, wz, ID.skullW);
    for (let i = -1; i <= 1; i++) dW.setBlock(wx + i, ty - 1, wz, ID.sand);
    dW.setBlock(wx, ty - 2, wz, ID.sand);
    const before = dg.mobManager.mobs.length;
    const r = dg._trySummonWither(wx, ty, wz);
    assert('I6 召唤：头颅朝向变体（朝东/朝西）同样触发召唤（B28 家族判定，非基名 === SKULL）',
      r === true && dg.mobManager.mobs.length === before + 1,
      'ret=' + r + ' mobs=' + before + '->' + dg.mobManager.mobs.length);
  }

  // ── 召唤反例：3 头颅 + 3 灵魂沙但缺柱底 ──
  {
    const ty = 150, wx = bx;
    for (let i = -1; i <= 1; i++) dW.setBlock(wx + i, ty, wz, ID.skullN);
    for (let i = -1; i <= 1; i++) dW.setBlock(wx + i, ty - 1, wz, ID.sand);
    const before = dg.mobManager.mobs.length;
    const r = dg._trySummonWither(wx, ty, wz);
    assert('I7 召唤反例：缺柱底灵魂沙的凋灵结构不得召唤',
      r === false && dg.mobManager.mobs.length === before,
      'ret=' + r + ' mobs=' + before + '->' + dg.mobManager.mobs.length);
  }

  // ── 滑翔：门控（装备 / 环境 / 展开门限）──
  const ELYTRA = { name: 'elytra', count: 1 };
  const setAero = (armor, pitch, vy, vz, gliding, extra) => {
    dg.inventory.armor = [null, armor, null, null];
    dp.flying = false; dp.spectator = false; dp.inWater = false; dp.onGround = false;
    dp.gliding = gliding; dp.pitch = pitch; dp.yaw = 0; dp.velocity.set(0, vy, vz);
    if (extra) Object.assign(dp, extra);
  };
  {
    setAero(null, 0, -1, 0, false);                        const rNoArmor = dg._updateGlideAero(DT);
    setAero(ELYTRA, 0, -1, 0, false, { flying: true });    const rFlying = dg._updateGlideAero(DT);
    setAero(ELYTRA, 0, -1, 0, false, { inWater: true });   const rWater = dg._updateGlideAero(DT);
    setAero(ELYTRA, 0, -1, 0, false, { spectator: true }); const rSpec = dg._updateGlideAero(DT);
    setAero(ELYTRA, 0, -1, 0, false, { onGround: true });  const rGround = dg._updateGlideAero(DT);
    assert('I8 滑翔门控：无鞘翅 / 飞行 / 水中 / 旁观 / 在地面 一律不展开',
      [rNoArmor, rFlying, rWater, rSpec, rGround].every((x) => x === false),
      [rNoArmor, rFlying, rWater, rSpec, rGround].join(','));
  }
  {
    setAero(ELYTRA, 0, -0.49, 0, false);   // 高于展开门限 GLIDE_DEPLOY_VY=-0.5
    const rHigh = dg._updateGlideAero(DT);
    const gHigh = dp.gliding;
    setAero(ELYTRA, 0, -0.6, 0, false);    // 低于门限
    const rLow = dg._updateGlideAero(DT);
    const gLow = dp.gliding;
    assert('I9 滑翔门控：vy>-0.5 不展开、vy<-0.5 当帧展开（展开阈值 GLIDE_DEPLOY_VY）',
      rHigh === false && gHigh === false && rLow === true && gLow === true,
      'vy=-0.49 ret=' + rHigh + ' gliding=' + gHigh + ' | vy=-0.6 ret=' + rLow + ' gliding=' + gLow);
  }

  // ── 滑翔：气动结算（期望值由源码公式 + 冻结常量现算）──
  const GLIDE_THRUST = 8, GLIDE_DRAG = 0.994, GLIDE_BRAKE = 0.5, GLIDE_LIFT = 6, GLIDE_GRAVITY = -9;
  const near1 = (a, b) => Math.abs(a - b) < 1e-12;
  {
    // 拉起（俯冲攒速后抬头）：升力被 -GLIDE_GRAVITY*1.35 封顶
    setAero(ELYTRA, 0.5, 0, -9.5, true);
    dg._updateGlideAero(DT);
    const expVy = Math.min(Math.sin(0.5) * 9.5 * GLIDE_LIFT, -GLIDE_GRAVITY * 1.35) * DT;
    const brake = Math.min(1, Math.sin(0.5) * GLIDE_BRAKE * DT);
    const expVz = -9.5 * (1 - brake) * Math.pow(GLIDE_DRAG, DT * 60);
    assert('I10 滑翔气动：抬头升力封顶在 -GLIDE_GRAVITY*1.35，且水平刹车 + 阻尼逐值吻合',
      near1(dp.velocity.y, expVy) && near1(dp.velocity.z, expVz),
      'vy=' + dp.velocity.y + ' exp=' + expVy + ' | vz=' + dp.velocity.z + ' exp=' + expVz);
  }
  {
    // 小迎角：升力未封顶（走 min 的另一支）。必须拿被测方法的**实际输出**去比，
    // 不能自己跟自己比（S1 反证实测：自比写法在 GLIDE_LIFT 6→7 时恒真、漏报）。
    setAero(ELYTRA, 0.1, 0, -2, true);
    dg._updateGlideAero(DT);
    const uncappedVy = dp.velocity.y;
    const expVy = Math.min(Math.sin(0.1) * 2 * GLIDE_LIFT, -GLIDE_GRAVITY * 1.35) * DT;
    // 前进速度不足（vAlong<=1）→ 失速，不加升力
    setAero(ELYTRA, 0.5, 0, -0.5, true);
    dg._updateGlideAero(DT);
    const stallVy = dp.velocity.y;
    assert('I11 滑翔气动：小迎角走未封顶支（实际值 == 常量现算）；前向速度≤1 时失速不加升力',
      near1(uncappedVy, expVy) && near1(stallVy, 0),
      'uncappedVy=' + uncappedVy + ' exp=' + expVy + ' stallVy=' + stallVy);
  }
  {
    // 俯冲推进：thrust = -sin(pitch)*GLIDE_THRUST，沿视线水平方向加速
    setAero(ELYTRA, -0.5, 0, 0, true);
    dg._updateGlideAero(DT);
    const expVz = (0 + (-1) * (-Math.sin(-0.5) * GLIDE_THRUST) * DT) * Math.pow(GLIDE_DRAG, DT * 60);
    assert('I12 滑翔气动：低头俯冲沿视线水平方向推进（yaw=0 时全落在 -z）',
      near1(dp.velocity.z, expVz) && near1(dp.velocity.x, 0) && near1(dp.velocity.y, 0),
      'vz=' + dp.velocity.z + ' exp=' + expVz + ' vx=' + dp.velocity.x + ' vy=' + dp.velocity.y);
  }
  {
    // 爬升上限保护：vy 被钳到 9
    setAero(ELYTRA, 0.5, 8.9, -9.5, true);
    dg._updateGlideAero(DT);
    assert('I13 滑翔气动：垂直速度上限钳到 +9 m/s', dp.velocity.y === 9, 'vy=' + dp.velocity.y);
  }

  // ── 滑翔：折叠判定（环境变化要在移动分支之前收口，gliding 不得跨分支残留）──
  {
    dg.inventory.armor = [null, ELYTRA, null, null];
    dp.gliding = true; dp.flying = false; dp.spectator = false; dp.inWater = false; dp.onGround = true;
    dg._updateGlideFold();
    const foldedGround = dp.gliding;
    dp.gliding = true; dp.onGround = false; dp.inWater = true;
    dg._updateGlideFold();
    const foldedWater = dp.gliding;
    dp.gliding = true; dp.inWater = false; dp.onGround = false;
    dg._updateGlideFold();
    const staysAirborne = dp.gliding;
    dg.inventory.armor = [null, null, null, null];
    dg._updateGlideFold();
    const foldedNoArmor = dp.gliding;
    assert('I14 滑翔折叠：落地/入水/脱下鞘翅折叠，纯空中不折叠',
      foldedGround === false && foldedWater === false && staysAirborne === true && foldedNoArmor === false,
      'ground=' + foldedGround + ' water=' + foldedWater + ' airborne=' + staysAirborne + ' noArmor=' + foldedNoArmor);
  }

  // ── 气流：御风斗篷 / 气流柱判定 / 风阵柱读写 ──
  {
    dg.inventory.armor = [null, { name: 'gale_cloak', count: 1 }, null, null];
    const cloakYes = dg._hasGaleCloak();
    dg.inventory.armor = [null, ELYTRA, null, null];
    const cloakElytra = dg._hasGaleCloak();
    dg.inventory.armor = [null, null, null, null];
    const cloakNone = dg._hasGaleCloak();
    assert('I15 气流：御风斗篷只认胸甲槽 gale_cloak（鞘翅/空槽均不算）',
      cloakYes === true && cloakElytra === false && cloakNone === false,
      'gale_cloak=' + cloakYes + ' elytra=' + cloakElytra + ' null=' + cloakNone);
  }
  {
    const px = Math.floor(dp.position.x), pz = Math.floor(dp.position.z);
    const py = Math.floor(dp.position.y + 0.1);
    dg._updateUpdraftState();
    const air = dg._inUpdraft;
    dW.setBlock(px, py, pz, ID.wind);
    dg._updateUpdraftState();
    const inWind = dg._inUpdraft;
    dW.setBlock(px, py, pz, 0);
    dg._updateUpdraftState();
    const backToAir = dg._inUpdraft;
    assert('I16 气流：足部格为 wind_current 时 _inUpdraft 置位，移走即复位',
      air === false && inWind === true && backToAir === false,
      'air=' + air + ' inWind=' + inWind + ' back=' + backToAir);
  }
  {
    const gx = bx + 4, gz = bz + 12, gy = 140;
    dg._writeGaleColumn(gx, gy, gz);
    let filled = 0;
    for (let h = 1; h <= 12; h++) if (dW.getBlock(gx, gy + h, gz) === ID.wind) filled++;
    const beyond = dW.getBlock(gx, gy + 13, gz);
    dW.setBlock(gx, gy + 5, gz, ID.stone);
    dg._writeGaleColumn(gx, gy, gz);          // 重填：跳过非空气格
    dg._clearGaleColumn(gx, gy, gz);          // 清除：遇非风流格即停
    let remaining = 0;
    for (let h = 1; h <= 12; h++) if (dW.getBlock(gx, gy + h, gz) === ID.wind) remaining++;
    const stoneKept = dW.getBlock(gx, gy + 5, gz) === ID.stone;
    assert('I17 气流：风阵柱向上 12 格只填空气；清除遇非风流格即停（不越界破坏玩家建筑）',
      filled === 12 && beyond === 0 && remaining === 7 && stoneKept,
      'filled=' + filled + ' beyond13=' + beyond + ' remaining=' + remaining + ' stone@5=' + stoneKept);
  }

  shutdown(dg);
}
for (const x of games) shutdown(x);
finish('game-behavior');
