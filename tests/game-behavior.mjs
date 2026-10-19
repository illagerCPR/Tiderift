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

// ── J. 终局域行为：末地回程垫 / 龙蛋 / 末影龙生成守卫 / 击败链路 / 折跃门 / 水晶 ──
// 轮 8 步 2 的迁移面（Endgame）。迁到控制器后，下列门面必须原样可用、语义逐值不变。
// 末地维经 loadData.dimension 走**真实启动路径**抵达（start 的维度装配 + 真实生成器 + 真实
// mobManager），不伪造世界；龙生成/回程垫/折跃门都按真实账本与真实怪物表判定。
{
  const e = await boot({
    mode: 'creative', seed: SEED,
    loadData: { dimension: 'end', gamemode: 'creative', seed: SEED },   // 有 loadData 时 start 取 loadData.seed/gamemode
  });
  track(e.g);
  const eg = e.g;
  const eW = eg.world;
  const eP = eg.player;
  const EndReg = (await import('../src/core/BlockRegistry.js')).BlockRegistry;
  const EID = {
    portal: EndReg.getId('end_portal'), egg: EndReg.getId('dragon_egg'),
    gateway: EndReg.getId('end_gateway'), crystal: EndReg.getId('end_crystal'),
  };
  const countLedger = (id) => { let n = 0; for (const [, v] of eW.modifiedBlocks) if (v === id) n++; return n; };
  const eggColumn = () => {
    const a = [];
    for (let y = 41; y <= 80; y++) if (eW.getBlock(0, y, 0) === EID.egg) a.push(y);
    return a;
  };
  const dragons = (gm) => gm.mobManager.mobs.filter((m) => m.typeName === 'dragon' && !m.dead).length;

  const padBefore = eg._endPadExists();
  const eggsBefore = eggColumn();

  // ── 末影龙生成守卫：末地内 start() 已生成一条，重复调用不得再生成 ──
  eg._ensureDragon();
  const dragonsOnce = dragons(eg);
  eg._ensureDragon();
  const dragonsTwice = dragons(eg);
  assert('J1 龙生成守卫：末地内 start() 已生成 1 条龙，重复调用 _ensureDragon() 不重复生成',
    e.running === true && dragonsOnce === 1 && dragonsTwice === 1,
    'running=' + e.running + ' 首调后=' + dragonsOnce + ' 再调后=' + dragonsTwice);

  // ── 联机生成守约：非 host 等广播（不生成不广播）；host 走 sendMobSpawn 且本地不生成 ──
  {
    const netCalls = [];
    eg.mobManager.mobs = eg.mobManager.mobs.filter((m) => m.typeName !== 'dragon'); // 腾空位，否则"已有龙"守卫先早退
    eg.networkMode = true;
    eg.net = { isHost: false, sendMobSpawn: (...a) => netCalls.push(a) };
    eg._ensureDragon();
    const nonHost = { 本地龙: dragons(eg), 广播: netCalls.length };
    eg.net = { isHost: true, sendMobSpawn: (...a) => netCalls.push(a) };
    eg._ensureDragon();
    const host = { 本地龙: dragons(eg), 广播: netCalls.length };
    eg.networkMode = false;
    eg.net = null;
    assert('J2 联机生成守约：非 host 不生成不广播；host 广播 sendMobSpawn 且本地不生成',
      nonHost.本地龙 === 0 && nonHost.广播 === 0 && host.本地龙 === 0 && host.广播 === 1,
      '非host=' + JSON.stringify(nonHost) + ' host=' + JSON.stringify(host));
  }

  // ── 折跃门：生成器无 outerAnchors 能力时静默 no-op（不抛错、不写账本）──
  const realGenerator = eW.generator;
  let gatewaysNoAnchor = -1;
  let gatewaysThrew = null;
  try {
    eW.generator = {};
    eg._ensureGateways();
    gatewaysNoAnchor = countLedger(EID.gateway);
  } catch (err) { gatewaysThrew = String(err && err.message); }
  eW.generator = realGenerator;
  assert('J3 折跃门：无锚点（生成器无 outerAnchors）时 no-op——不抛错且不写 end_gateway',
    gatewaysThrew === null && gatewaysNoAnchor === 0,
    'threw=' + gatewaysThrew + ' gateways=' + gatewaysNoAnchor);

  // ── 击败链路①：末地内 → 置标记 + 激活奖励（回程垫 + 折跃门 + 龙蛋）──
  eg._onDragonDefeated({ typeName: 'dragon' });
  const eggsAfterDefeat = eggColumn();
  assert('J4 击败链路：末地内 _onDragonDefeated 置 world.dragonDefeated 并激活末地奖励（回程垫 + 龙蛋）',
    eW.dragonDefeated === true && padBefore === false && eg._endPadExists() === true &&
    eggsBefore.length === 0 && eggsAfterDefeat.length === 1,
    'flag=' + eW.dragonDefeated + ' 垫前=' + padBefore + ' 垫后=' + eg._endPadExists() +
    ' 蛋=' + JSON.stringify(eggsAfterDefeat));

  // ── 回程垫幂等：账本已有 end_portal 时重复调用不再写入 ──
  const portalsBefore = countLedger(EID.portal);
  eg._ensureEndReturnPad();
  const portalsAfter = countLedger(EID.portal);
  assert('J5 回程垫：末地内建垫后 _endPadExists() 为真，重复调用不再写入 end_portal（幂等）',
    portalsBefore > 0 && portalsAfter === portalsBefore,
    'end_portal=' + portalsBefore + '->' + portalsAfter);

  // ── 龙蛋放置语义：主岛 (0,·,0) 从 y=80 下扫首个实心格的顶面 ──
  const eggY = eggsAfterDefeat[0];
  let airAbove = true;
  for (let y = eggY + 1; y <= 80; y++) if (eW.getBlock(0, y, 0) !== 0) airAbove = false;
  const eggBelow = eW.getBlock(0, eggY - 1, 0);
  assert('J6 龙蛋：按 (0,·,0) 从 y=80 下扫首个实心格的**顶面**放置（下方实心、其上到 y=80 全空气）',
    airAbove === true && eggBelow !== 0, 'eggY=' + eggY + ' 下方=' + eggBelow + ' 上方全空气=' + airAbove);

  eg._placeDragonEgg();
  const eggsTwice = eggColumn();
  assert('J7 龙蛋二次调用：现状为在正上方再叠一枚（**非幂等**——源码注释声称幂等但与实测不符，按现状钉住；若有意修为幂等，请同步更新本条）',
    eggsTwice.length === 2 && eggsTwice[0] === eggY && eggsTwice[1] === eggY + 1,
    'eggs=' + JSON.stringify(eggsTwice) + ' 首枚y=' + eggY);

  // ── 折跃门：有锚点则建成阵列，二次调用幂等 ──
  const gwBefore = countLedger(EID.gateway);
  eg._ensureGateways();
  const gwAfter = countLedger(EID.gateway);
  assert('J8 折跃门：有锚点时建成阵列（end_gateway 进账本），二次调用幂等',
    gwBefore > 0 && gwAfter === gwBefore, 'end_gateway=' + gwBefore + '->' + gwAfter);

  // ── 末影水晶：走真实瞄准 + 真实左键路径（创造瞬破）→ 真方块被移除 + 爆炸销毁邻域 ──
  eg.mobManager.mobs = [];   // 清场：怪物在射线上会先抢占左键分支（攻击怪物优先于破方块）
  eP.pitch = -Math.PI / 2 + 0.05;
  eP.yaw = 0;
  await step(eg, 2);
  let crystalResult = null;
  const crystalHit = eg.selectedBlock && eg.selectedBlock.block;
  if (crystalHit) {
    const H = crystalHit;
    const neighbors = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -3; dz <= 3; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (eW.getBlock(H.x + dx, H.y + dy, H.z + dz) !== 0) neighbors.push([dx, dy, dz]);
        }
      }
    }
    eW.setBlock(H.x, H.y, H.z, EID.crystal);   // 真方块：末影水晶（创造瞬破按 def.name 分流到 _breakCrystal）
    await step(eg, 2);
    const aimed = eg.selectedBlock;
    const crystalAimed = !!aimed && !!aimed.block && aimed.block.x === H.x &&
      aimed.block.y === H.y && aimed.block.z === H.z && aimed.id === EID.crystal;
    eg.controls.mouseLeft = true;
    eg.frame++;
    eg.update(1 / 60);
    const removed = eW.getBlock(H.x, H.y, H.z) === 0;
    await step(eg, 2);
    let destroyed = 0;
    for (const [dx, dy, dz] of neighbors) if (eW.getBlock(H.x + dx, H.y + dy, H.z + dz) === 0) destroyed++;
    crystalResult = { 瞄准水晶: crystalAimed, 方块移除: removed, 邻域实心: neighbors.length, 被炸毁: destroyed };
  }
  assert('J9 水晶击碎：真实点击路径移除末影水晶方块，且半径 3 的爆炸销毁邻域方块（爆炸确实入队执行）',
    !!crystalResult && crystalResult.瞄准水晶 === true && crystalResult.方块移除 === true &&
    crystalResult.被炸毁 >= 2,
    JSON.stringify(crystalResult));

  // ── 非末地维守卫：不生成龙、也不在当前维度激活末地奖励 ──
  const overDragonsBefore = dragons(g);
  g._ensureDragon();
  g._onDragonDefeated({ typeName: 'dragon' });
  let overPortals = 0;
  for (const [, v] of g.world.modifiedBlocks) if (v === EID.portal) overPortals++;
  assert('J10 非末地维守卫：主世界调用 _ensureDragon() 不生成末影龙；_onDragonDefeated 只置标记、不在本维度激活末地奖励',
    overDragonsBefore === 0 && dragons(g) === 0 && g.world.dragonDefeated === true && overPortals === 0,
    '龙=' + overDragonsBefore + '->' + dragons(g) + ' flag=' + g.world.dragonDefeated + ' end_portal=' + overPortals);

  shutdown(eg);
}

// ── K. 弹射物域行为：末影之眼 / 箭矢 / 凋灵之首与风弹 ──────────────────────
// 轮 8 步 3 的迁移面（Projectiles）。迁移前先把现状行为逐值钉住：断言全部经 Game 上的同名
// 真实入口驱动（_throwEnderEye / _updateEyeFlight / _shootArrow / spawnRemoteArrow /
// _cancelBowCharge / _releaseBow / _updateArrows / _ensureWitherSkullAssets 经弹射路径 /
// _spawnWitherSkullVolley / _spawnGaleVolley / _spawnWitherSkull / spawnRemoteWitherSkull /
// _updateWitherSkulls / _despawnArrow），迁到控制器后这些门面必须原样可用、语义逐值不变。
//
// 两处刻意的设计：
//   1) 用独立 boot（creative 一只 + survival 一只）：建箭/建弹会往 scene 挂 mesh、往
//      arrows/witherSkulls 里加条目，借 A-H 段的共享 g 会污染其 children/区块数 比值。
//   2) 箭命中怪的那一帧用**直接调域入口** _updateArrows(DT)（真实怪 + 真实 findMobByRay +
//      真实 attackMob），避免 mobManager.update 的 AI 位移引入不确定性；
//      「帧循环是否真的消费 arrows/witherSkulls/eyeFlight」由 K1/K7 的整帧驱动守着。
{
  const THREE = await import('three');
  const Reg = (await import('../src/core/BlockRegistry.js')).BlockRegistry;
  const { Mob } = await import('../src/entity/Mob.js');
  const DT = 1 / 60;

  const pj = await boot({ mode: 'creative', seed: SEED });
  track(pj.g);
  const pg = pj.g;
  const pScene = pg.renderer.scene;
  const pW = pg.world;
  pg.mobManager.mobs = [];                      // 箭矢飞行段不得被野怪截胡（K3 单独放一只）

  // ── K1 射箭生命周期：_shootArrow 建 mesh 入 scene + push 进 this.arrows；life 耗尽自动 despawn ──
  const a1 = pg._shootArrow(1, 6);
  const shot = { n: pg.arrows.length, inScene: pScene.children.includes(a1.mesh), dmg: a1.dmg, life: a1.life, stuck: a1.stuck };
  a1.life = 0.005;                              // < dt：紧接着的那一帧必然到期
  await step(pg, 1);
  const gone = { n: pg.arrows.length, inScene: pScene.children.includes(a1.mesh) };
  assert('K1 箭矢生命周期：_shootArrow 建 mesh 入 scene 并 push 进 arrows（dmg 随参数、life=8）；life 耗尽后该帧自动 despawn（mesh 移出 scene）',
    shot.n === 1 && shot.inScene === true && shot.dmg === 6 && shot.life === 8 && shot.stuck === false &&
    gone.n === 0 && gone.inScene === false,
    'shot=' + JSON.stringify(shot) + ' gone=' + JSON.stringify(gone));

  // ── K2 钉墙回退：位移落入实心格 → 位置回退到旧点、速度清零、stuck=true ──
  {
    const solid = (id) => { const d = Reg.getById(id); return !!d && !!d.solid && !d.fluid; };
    const px = Math.floor(pg.player.position.x), pz = Math.floor(pg.player.position.z), py = Math.floor(pg.player.position.y);
    let bx = -1, bz = -1, topY = -1;
    for (let r = 0; r < 8 && topY < 0; r++) {
      for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        for (let y = py + 8; y > py - 12; y--) {
          if (solid(pW.getBlock(px + dx, y, pz + dz))) { bx = px + dx; bz = pz + dz; topY = y; break; }
        }
        if (topY >= 0) break;
      }
    }
    pg.arrows.length = 0;
    const startY = topY + 1.5;                  // 实心顶面上方：单帧下落 1.0 → 落脚格 = 实心格 topY
    const pos = new THREE.Vector3(bx + 0.5, startY, bz + 0.5);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({}));
    mesh.position.copy(pos);
    pScene.add(mesh);
    pg.arrows.push({ mesh, pos: pos.clone(), vel: new THREE.Vector3(0, -60, 0), life: 9, stuck: false, dmg: 6 });
    await step(pg, 1);
    const sa = pg.arrows[0];
    const st = sa ? { stuck: sa.stuck, vx: sa.vel.x, vy: sa.vel.y, vz: sa.vel.z, y: sa.pos.y, meshY: sa.mesh.position.y } : null;
    assert('K2 钉墙回退：位移落入实心格的箭被判钉住——位置回退到旧点、速度清零、stuck=true（mesh 位置同步回退点）',
      !!st && st.stuck === true && st.vx === 0 && st.vy === 0 && st.vz === 0 &&
      Math.abs(st.y - startY) < 1e-9 && Math.abs(st.meshY - startY) < 1e-9 && topY >= 0 && !!st,
      'grid=' + bx + ',' + topY + ',' + bz + ' startY=' + startY + ' stuck=' + JSON.stringify(st));
    pg.arrows.length = 0;
    pScene.remove(mesh);
  }

  // ── K3 remote 不结算：本地箭命中怪走 attackMob；远端视觉箭命中同一只怪只消失不结算 ──
  {
    const mm = pg.mobManager;
    const calls = [];
    const origAttack = mm.attackMob.bind(mm);
    mm.attackMob = (...args) => { calls.push(args); return origAttack(...args); };
    const mob = new Mob('zombie', pW);          // 真实 Mob 对象 → 真实 findMobByRay / 真实 attackMob
    const R = Math.max(mob.width, mob.height) * 0.5;
    const probe = pg._shootArrow(1, 6);         // 借真实建箭拿到 起点 + 方向口径，随即清空
    const start = probe.pos.clone();
    const dirN = probe.vel.clone().normalize();
    pg.arrows.length = 0;
    mm.mobs = [mob];
    const place = () => {
      const center = start.clone().addScaledVector(dirN, R + 0.3);   // 球心 = position.y + height/2
      mob.position.set(center.x, center.y - mob.height * 0.5, center.z);
    };
    const hp0 = mob.health;
    place();
    pg._shootArrow(1, 6);
    pg._updateArrows(DT);
    const local = { calls: calls.length, arrows: pg.arrows.length, hp: mob.health };
    place();
    pg.spawnRemoteArrow(start.x, start.y, start.z, dirN.x * 60, dirN.y * 60, dirN.z * 60);
    pg._updateArrows(DT);
    const remote = { calls: calls.length, arrows: pg.arrows.length, hp: mob.health };
    mm.attackMob = origAttack;
    mm.mobs = [];
    pg.arrows.length = 0;
    assert('K3 remote 不结算：本地箭命中怪调 attackMob 恰 1 次（伤害随 a.dmg）并自毁；spawnRemoteArrow 的远端箭命中同一只怪只自毁——attackMob 仍 1 次、怪血不变',
      local.calls === 1 && local.arrows === 0 && local.hp === hp0 - 6 &&
      remote.calls === 1 && remote.arrows === 0 && remote.hp === local.hp,
      '本地=' + JSON.stringify(local) + ' 远端=' + JSON.stringify(remote) + ' hp0=' + hp0);
  }

  // ── K4/K5 凋灵之首 / 风弹命中本地玩家：结算分流（须 survival——创造/旁观被 hurt 早退）──
  {
    const sv = await boot({ mode: 'creative', seed: SEED });
    track(sv.g);
    const s2 = sv.g;
    s2.mobManager.mobs = [];
    const vp = s2.player;
    vp.setMode('survival');
    const hurts = [];
    const origHurt = vp.hurt.bind(vp);
    vp.hurt = (amount, source, vignette) => { hurts.push([amount, source, vignette]); return origHurt(amount, source, vignette); };
    const reset = () => { hurts.length = 0; vp.health = 20; vp.invulnerable = 0; vp.velocity.set(0, 0, 0); vp.clearEffects(); };
    const zero = () => new THREE.Vector3(0, 0, 0);

    // ① 凋灵之首：命中 → 8 伤 + 凋零 II（10s）
    reset();
    s2.witherSkulls.length = 0;
    const q0 = vp.position.clone();
    s2._spawnWitherSkull(new THREE.Vector3(q0.x, q0.y + 0.9, q0.z), zero(), 'wither');
    await step(s2, 1);
    const witherHit = {
      amounts: hurts.map((h) => h[0]), mobHits: hurts.filter((h) => h[1] === 'mob').length,
      level: vp.getEffectLevel('wither'), skulls: s2.witherSkulls.length,
    };

    // ② 风弹（gale）：命中 → 6 伤 + 击退（+x 7 / 上抛 3.5）且**不加凋零**
    reset();
    s2.witherSkulls.length = 0;
    const q1 = vp.position.clone();
    s2._spawnWitherSkull(new THREE.Vector3(q1.x - 0.3, q1.y + 0.9, q1.z), zero(), 'gale');
    await step(s2, 1);
    const galeHit = {
      amounts: hurts.map((h) => h[0]), mobHits: hurts.filter((h) => h[1] === 'mob').length,
      level: vp.getEffectLevel('wither'), vx: vp.velocity.x, vy: vp.velocity.y, skulls: s2.witherSkulls.length,
    };
    assert('K4 凋灵之首结算：命中本地玩家恰 1 次 hurt(8, mob)，并附加凋零 II（getEffectLevel=2）；命中后弹自毁',
      witherHit.mobHits === 1 && witherHit.amounts.indexOf(8) >= 0 && witherHit.level === 2 && witherHit.skulls === 0,
      JSON.stringify(witherHit));
    assert('K5 风弹结算：命中本地玩家恰 1 次 hurt(6, mob) + 击退（vx≈+7、vy>2）且**不加凋零**；命中后弹自毁',
      galeHit.mobHits === 1 && galeHit.amounts.indexOf(6) >= 0 && galeHit.level === 0 &&
      Math.abs(galeHit.vx - 7) < 0.5 && galeHit.vy > 2 && galeHit.skulls === 0,
      JSON.stringify(galeHit));
  }

  // ── K6 广播点唯一：_spawnWitherSkull 是发射端唯一广播点（每发恰 1 次）；远端回执不广播 ──
  {
    const net = [];
    pg.arrows.length = 0;
    pg.witherSkulls.length = 0;
    pg.networkMode = true;
    pg.net = { sendWitherSkull: (...a) => net.push(a), sendArrowShot: () => net.push(['arrow']) };
    const origin = pg.player.position.clone().add(new THREE.Vector3(0, 2, 0));
    const dir = new THREE.Vector3(0, 0, 1);
    const shooter = (dy) => ({ position: new THREE.Vector3(origin.x, origin.y + dy, origin.z), height: 3 });
    const target = { position: pg.player.position.clone() };
    pg._spawnWitherSkull(origin.clone(), dir.clone(), 'wither');
    const one = net.length;                                         // 恰 1（发射端唯一广播点）
    pg.spawnRemoteWitherSkull(origin.x + 2, origin.y, origin.z, 0, 0, 1, 'wither');
    const afterRemote = net.length;                                 // 仍 1（远端回执防回声环）
    pg._spawnWitherSkullVolley(shooter(1), target);
    const afterVolley = net.length;                                 // 1 + 3（三发扇，每发 1 次）
    pg._spawnGaleVolley(shooter(1), target, true);
    const afterGale = net.length;                                   // 1 + 3 + 5（裂心五发宽扇）
    pg.networkMode = false;
    pg._spawnWitherSkull(origin.clone(), dir.clone(), 'wither');
    const offline = net.length;                                     // 单机不广播
    pg.net = null;
    assert('K6 广播点唯一：_spawnWitherSkull 单发恰广播 1 次；spawnRemoteWitherSkull 回执不广播（防回声）；凋灵三发扇 = +3、裂心五发宽扇 = +5（每发恰 1 次，无重复广播）；单机不广播',
      one === 1 && afterRemote === 1 && afterVolley === 4 && afterGale === 9 && offline === 9,
      '网络调用序列 1/远端/' + afterRemote + '/扇射' + afterVolley + '/宽扇' + afterGale + '/单机' + offline);
    pg.witherSkulls.length = 0;
  }

  // ── K7 末影之眼：掷出消耗 1 颗并建 eyeFlight；到期 scene.remove + dispose geo/mat；80% 落回背包 ──
  {
    const inv = pg.inventory;
    inv.slots.fill(null);
    inv.hotbarSelected = 0;
    inv.slots[0] = { name: 'ender_eye', count: 2 };
    pg.eyeFlight = null;
    pg._throwEnderEye();
    const f1 = pg.eyeFlight;
    const thrown = { eyes: inv.slots[0] && inv.slots[0].count, inScene: !!f1 && pScene.children.includes(f1.mesh), total: f1 && f1.total };
    let geoDisposed = 0, matDisposed = 0;
    const og = f1.mesh.geometry.dispose.bind(f1.mesh.geometry);
    f1.mesh.geometry.dispose = () => { geoDisposed++; og(); };
    const om = f1.mesh.material.dispose.bind(f1.mesh.material);
    f1.mesh.material.dispose = () => { matDisposed++; om(); };
    f1.t = f1.total - 0.001;                    // 下一帧必然到点
    const rand = Math.random;
    Math.random = () => 0.5;                    // < 0.8 → 落回背包
    await step(pg, 1);
    Math.random = rand;
    const landed = { flight: pg.eyeFlight, inScene: pScene.children.includes(f1.mesh), geoDisposed, matDisposed, eyes: inv.slots[0] ? inv.slots[0].count : 0 };
    inv.slots.fill(null);
    inv.slots[0] = { name: 'ender_eye', count: 1 };
    pg._throwEnderEye();
    const f2 = pg.eyeFlight;
    f2.t = f2.total - 0.001;
    const rand2 = Math.random;
    Math.random = () => 0.9;                    // ≥ 0.8 → 碎裂（不回背包）
    await step(pg, 1);
    Math.random = rand2;
    const broken = { flight: pg.eyeFlight, eyes: inv.slots[0] ? inv.slots[0].count : 0 };
    assert('K7 末影之眼：掷出消耗 1 颗并建 eyeFlight（total=2.5，mesh 入 scene）；到期从 scene 移除并 dispose geo/mat 各 1 次；rand<0.8 落回背包（1→2）、rand≥0.8 碎裂（1→0）',
      thrown.eyes === 1 && thrown.inScene === true && thrown.total === 2.5 &&
      landed.flight === null && landed.inScene === false && landed.geoDisposed === 1 && landed.matDisposed === 1 && landed.eyes === 2 &&
      broken.flight === null && broken.eyes === 0,
      '掷出=' + JSON.stringify(thrown) + ' 落地=' + JSON.stringify(landed) + ' 碎裂=' + JSON.stringify(broken));
  }

  // ── K8 弓：松手按 charge 插值初速/伤害、消耗 1 箭、广播初速；取消路径清标志并复位拉弓姿态 ──
  {
    pg.player.setMode('survival');              // 消耗箭只在非创造分支（创造不扣箭）
    const inv = pg.inventory;
    inv.slots.fill(null);
    inv.hotbarSelected = 0;
    inv.slots[0] = { name: 'bow', count: 1 };
    inv.add('arrow', 3);
    const countArrows = () => inv.slots.filter((x) => x && x.name === 'arrow').reduce((n, x) => n + x.count, 0);
    const arrowsBefore = countArrows();
    const draws = [];
    const origDraw = pg.hand.setBowDraw.bind(pg.hand);
    pg.hand.setBowDraw = (v) => { draws.push(v); return origDraw(v); };
    const sent = [];
    pg.networkMode = true;
    pg.net = { sendArrowShot: (...a) => sent.push(a), sendWitherSkull: () => {} };
    pg.arrows.length = 0;
    pg._bowCharging = true;
    pg._bowCharge = 0.5;
    pg._releaseBow();
    const arrow = pg.arrows[0];
    const released = {
      charging: pg._bowCharging, charge: pg._bowCharge, n: pg.arrows.length,
      dmg: arrow && arrow.dmg, speed: arrow ? Math.hypot(arrow.vel.x, arrow.vel.y, arrow.vel.z) : -1,
      arrows: countArrows(), sent: sent.length, draws: draws.slice(),
    };
    pg._bowCharging = true;
    pg._bowCharge = 1;
    draws.length = 0;
    pg._cancelBowCharge();
    const cancelled = { charging: pg._bowCharging, charge: pg._bowCharge, draws: draws.slice() };
    pg.networkMode = false;
    pg.net = null;
    pg.arrows.length = 0;
    assert('K8 弓：松手按 charge=0.5 插值（初速 28×(0.3+0.7c)=18.2、伤害 2+round(6c)=5）、消耗 1 箭并广播 sendArrowShot 1 次；_cancelBowCharge 清零 _bowCharging/_bowCharge 并 setBowDraw(null)',
      released.n === 1 && released.dmg === 5 && Math.abs(released.speed - 18.2) < 1e-6 &&
      released.arrows === arrowsBefore - 1 && released.charging === false && released.charge === 0 &&
      released.sent === 1 && released.draws.length === 1 && released.draws[0] === null &&
      cancelled.charging === false && cancelled.charge === 0 && cancelled.draws.length === 1 && cancelled.draws[0] === null,
      '释放=' + JSON.stringify(released) + ' 取消=' + JSON.stringify(cancelled));
  }

  // ── K9 静态共享资源：箭/弹几何与材质跨弹共享（懒建一次）、gale 独立材质、despawn 不 dispose ──
  {
    pg.arrows.length = 0;
    const b1 = pg._shootArrow(1, 6);
    const b2 = pg._shootArrow(1, 6);
    const shotShared = b1.mesh.geometry === b2.mesh.geometry && b1.mesh.material === b2.mesh.material;
    let geoDisposed = 0;
    const og = b1.mesh.geometry.dispose.bind(b1.mesh.geometry);
    b1.mesh.geometry.dispose = () => { geoDisposed++; og(); };
    const nBefore = pg.arrows.length;
    pg._despawnArrow(0);
    const despawn = { n: pg.arrows.length, inScene: pScene.children.includes(b1.mesh), geoDisposed };
    pg.witherSkulls.length = 0;
    pg._spawnWitherSkull(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, 0, 1), 'wither');
    pg.spawnRemoteWitherSkull(0, 100, 0, 0, 0, 1, 'wither');
    pg._spawnWitherSkull(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, 0, 1), 'gale');
    const [s1, s2, s3] = pg.witherSkulls;
    const skullShared = s1.mesh.geometry === s2.mesh.geometry && s2.mesh.geometry === s3.mesh.geometry &&
      s1.mesh.material === s2.mesh.material && s3.mesh.material !== s1.mesh.material;
    assert('K9 静态共享资源：箭几何/材质跨弹共享（懒建一次）；凋灵之首与远端弹共享几何+材质、gale 复用几何但用独立材质；_despawnArrow 只摘 scene 不 dispose 共享资源',
      shotShared === true && despawn.n === nBefore - 1 && despawn.inScene === false && despawn.geoDisposed === 0 &&
      skullShared === true,
      '箭共享=' + shotShared + ' despawn=' + JSON.stringify(despawn) + ' 弹共享=' + skullShared);
    pg.arrows.length = 0;
    pg.witherSkulls.length = 0;
  }
}

// ── L. 信标域行为：金字塔等级 / 效果选择与 4s 脉冲 / 光柱资源 ──────────────
// 轮 8 步 4 的迁移面（Beacon）。断言全部经 Game 上的同名真实入口驱动
// （_getBeaconPower / setBeaconEffect / _updateBeaconPulse / _ensureBeaconBeam /
// _removeBeaconBeam / _breakBeacon / _clearBeaconState），并单独钉住 BeaconScreen 的两处外部调用面
// （:60 show() 读 _getBeaconPower、:49 确认回调按 min(2,max(1,power)) 调 setBeaconEffect）。
//
// 两处刻意的设计：
//   1) 用独立 boot：本段往世界写方块、往 scene 挂光柱，借 A–H 段的共享 g 会污染其 children/区块数比值。
//   2) 信标塔建在 y=200 的纯空气层（避开地形与结构），玩家位置直接 set 到塔旁做距离判定——
//      本段不驱动帧循环，物理不会把玩家拉走。
{
  const Reg = (await import('../src/core/BlockRegistry.js')).BlockRegistry;
  const IRON = Reg.getId('iron_block');
  const STONE = Reg.getId('stone');
  const lj = await boot({ mode: 'creative', seed: SEED });
  track(lj.g);
  const lg = lj.g;
  const lScene = lg.renderer.scene;
  const bx = Math.floor(lg.player.position.x), bz = Math.floor(lg.player.position.z), by = 200;
  const isBeam = (o) => !!(o && o.isMesh && o.material && o.material.color && o.material.color.getHex() === 0xf2f0dc &&
    o.material.opacity === 0.22 && o.geometry && o.geometry.parameters && o.geometry.parameters.width === 0.4);
  const beams = () => lScene.children.filter(isBeam);
  const inScene = (m) => lScene.children.includes(m);
  const layer = (l, id) => { for (let dx = -l; dx <= l; dx++) for (let dz = -l; dz <= l; dz++) lg.world.setBlock(bx + dx, by - l, bz + dz, id); };

  // ── L1 金字塔真值表：空基座 0 → 逐层 3×3/5×5/7×7/9×9 = 1/2/3/4；断层即停；非白名单方块不算 ──
  const p0 = lg._getBeaconPower(bx, by, bz);
  layer(1, IRON); const p1 = lg._getBeaconPower(bx, by, bz);
  layer(2, IRON); const p2 = lg._getBeaconPower(bx, by, bz);
  layer(3, IRON); const p3 = lg._getBeaconPower(bx, by, bz);
  layer(4, IRON); const p4 = lg._getBeaconPower(bx, by, bz);
  lg.world.setBlock(bx + 1, by - 1, bz + 1, STONE); const cut1 = lg._getBeaconPower(bx, by, bz);
  lg.world.setBlock(bx + 1, by - 1, bz + 1, IRON);
  lg.world.setBlock(bx + 2, by - 2, bz + 2, STONE); const cut2 = lg._getBeaconPower(bx, by, bz);
  lg.world.setBlock(bx + 2, by - 2, bz + 2, IRON);
  const restored = lg._getBeaconPower(bx, by, bz);
  assert('L1 _getBeaconPower 真值表：空基座 0 → 3×3/5×5/7×7/9×9 = 1/2/3/4；首层缺角（换成不在白名单的石头）=0、二层缺角=1、补回=4',
    p0 === 0 && p1 === 1 && p2 === 2 && p3 === 3 && p4 === 4 && cut1 === 0 && cut2 === 1 && restored === 4,
    `p=${[p0, p1, p2, p3, p4].join('/')} 缺角1=${cut1} 缺角2=${cut2} 复原=${restored}`);
  layer(2, 0); layer(3, 0); layer(4, 0); // 收到 3×3（power=1），供后续激活/脉冲段使用

  // ── L2 主菜单期（world 尚未创建）：守卫返回 0 且不抛（构造期漏实例化控制器会在这里炸）──
  const lMenu = await createGame();
  let menuPower = -1;
  try { menuPower = lMenu.g._getBeaconPower(bx, by, bz); } catch (err) { menuPower = 'throw:' + (err && err.message); }
  shutdown(lMenu.g);
  assert('L2 主菜单期 game.world 为 null 时 _getBeaconPower 返回 0', menuPower === 0, 'menuPower=' + String(menuPower));

  // ── L3 BeaconScreen 外部调用面：show() 用 _getBeaconPower 填 power 并吞掉输入，hide() 恢复 ──
  const chat = [];
  const savedChat = lg.chatBox;
  lg.chatBox = { add: (text, color) => chat.push([text, color]) };
  const pulses = [];
  const origApply = lg.player.applyEffect.bind(lg.player);
  lg.player.applyEffect = (n, l, d) => { pulses.push([n, l, d]); return origApply(n, l, d); };
  const snap = () => { const e = lg.player.effects.get('speed'); return { pulses: pulses.length, time: e ? e.time : 0, level: e ? e.level : 0 }; };
  lg.player.effects.clear();
  lg.player.position.set(bx + 0.5, by, bz + 0.5); // 站到塔旁
  layer(1, 0);                                    // 拆掉唯一一层 → 无基座
  lg.beaconScreen.show(bx, by, bz);
  const noBase = { power: lg.beaconScreen.power, visible: lg.beaconScreen.visible, controls: lg.controls.enabled };
  lg.beaconScreen.hide();
  const restoredControls = lg.controls.enabled;
  layer(1, IRON);                                 // 3×3 → power=1
  lg.beaconScreen.show(bx, by, bz);
  const withBase = { power: lg.beaconScreen.power, controls: lg.controls.enabled };
  assert('L3 BeaconScreen 外部面：show() 用 _getBeaconPower 填 power（无基座 0 / 3×3 为 1）并置 controls.enabled=false，hide() 恢复；setBeaconEffect 仍可从外部直接调',
    noBase.power === 0 && noBase.visible === true && noBase.controls === false &&
    restoredControls === true && withBase.power === 1 && withBase.controls === false &&
    typeof lg.setBeaconEffect === 'function',
    '无基座=' + JSON.stringify(noBase) + ' 有基座=' + JSON.stringify(withBase) + ' 恢复=' + restoredControls);

  // ── L4 setBeaconEffect（按 BeaconScreen:49 的调用形态驱动）：写 player.effects + 建光柱 + 立即脉冲 + 播报 ──
  const sceneBefore = lScene.children.length;
  lg.setBeaconEffect(bx, by, bz, 'speed', Math.min(2, Math.max(1, lg.beaconScreen.power)));
  lg.beaconScreen.hide();
  lg.chatBox = savedChat;
  const eff0 = lg.player.effects.get('speed');
  const beam0 = beams();
  const m0 = beam0[0];
  assert('L4 setBeaconEffect：写 player.effects {level=1,time=12} 并立即脉冲一次；建光柱 1 条（高 max(16,250-y)=50、位于 y+h/2、opacity 0.22/transparent/depthWrite=false）；chatBox 存在时播报 1 条含「速度 ×1」的 #ffd 提示',
    !!eff0 && eff0.level === 1 && eff0.time === 12 &&
    pulses.length === 1 && pulses[0][0] === 'speed' && pulses[0][1] === 1 && pulses[0][2] === 12 &&
    beam0.length === 1 && inScene(m0) && lScene.children.length === sceneBefore + 1 &&
    m0.geometry.parameters.height === 50 && m0.position.x === bx + 0.5 && m0.position.y === by + 25 && m0.position.z === bz + 0.5 &&
    m0.material.transparent === true && m0.material.opacity === 0.22 && m0.material.depthWrite === false &&
    chat.length === 1 && chat[0][1] === '#ffd' && chat[0][0].includes('速度') && chat[0][0].includes('×1'),
    'eff=' + JSON.stringify(eff0) + ' pulses=' + JSON.stringify(pulses) + ' beams=' + beam0.length + ' chat=' + JSON.stringify(chat));

  // ── L5 4s 脉冲节奏 + 12s 无缝续期（12s > 4s：效果绝不掉线）──
  const advance = (n, dt) => { for (let i = 0; i < n; i++) { lg.player.tickEffects(dt); lg._updateBeaconPulse(dt); } };
  advance(16, 0.25);                              // t=4.00s：首帧（timer 由 0 起）补第 1 次脉冲
  const at4 = snap();
  advance(1, 0.25);                               // t=4.25s：timer 归零 → 补第 2 次，时长刷回 12s
  const at425 = snap();
  advance(15, 0.25);                              // t=8.00s：周期未到，一次都不补
  const at8 = snap();
  advance(1, 0.25);                               // t=8.25s：补第 3 次
  const at825 = snap();
  assert('L5 脉冲节奏：激活后 4.0s 内只补脉冲 1 次、再 3.75s 一次都不补、t=8.25s 补第 3 次；每次补脉冲把时长刷回 12s（12s > 4s = 无缝续期，等级恒 1）',
    at4.pulses === 2 && at4.time === 8.25 && at425.pulses === 3 && at425.time === 12 &&
    at8.pulses === 3 && at8.time === 8.25 && at825.pulses === 4 && at825.time === 12 &&
    at825.level === 1,
    `4.00s=${JSON.stringify(at4)} 4.25s=${JSON.stringify(at425)} 8.00s=${JSON.stringify(at8)} 8.25s=${JSON.stringify(at825)}`);

  // ── L6 范围 = 10×power 且边界含等号；基座 1→2 级后脉冲按 level=2 续期并重建光柱 ──
  lg.player.effects.clear();
  lg.player.position.set(bx + 0.5 + 10, by, bz + 0.5);   // 距离恰 10
  const nNear = pulses.length;
  lg._updateBeaconPulse(5);
  const ne = lg.player.effects.get('speed');
  const near = { pulses: pulses.length - nNear, level: ne ? ne.level : 0, time: ne ? ne.time : 0 };
  lg.player.effects.clear();
  lg.player.position.set(bx + 0.5 + 10.5, by, bz + 0.5); // 距离 10.5
  const nFar = pulses.length;
  lg._updateBeaconPulse(5);
  const far = { pulses: pulses.length - nFar, has: lg.player.effects.has('speed') };
  lg.player.position.set(bx + 0.5, by, bz + 0.5);
  const mBefore = beams()[0];
  layer(2, IRON);                                        // 基座 1 → 2 级
  lg.player.effects.clear();
  lg._updateBeaconPulse(5);
  const up = { args: pulses[pulses.length - 1], beams: beams().length, replaced: beams()[0] !== mBefore, oldInScene: inScene(mBefore) };
  assert('L6 范围=10×power 且边界含等号：距离 10 生效（level=1/time=12）、10.5 不生效（applyEffect 零调用）；基座 1→2 级后补脉冲按 level=2 续期（范围 20）并重建光柱（旧 mesh 摘除）',
    near.pulses === 1 && near.level === 1 && near.time === 12 && far.pulses === 0 && far.has === false &&
    up.args[0] === 'speed' && up.args[1] === 2 && up.args[2] === 12 &&
    up.beams === 1 && up.replaced === true && up.oldInScene === false,
    '近=' + JSON.stringify(near) + ' 远=' + JSON.stringify(far) + ' 升级=' + JSON.stringify(up));

  // ── L7 _breakBeacon：只清该 key 的激活态与光柱（别的 key 的光柱不动）──
  lg._ensureBeaconBeam('stray', bx + 8, by, bz + 8);
  const keyMesh = beams().find((m) => m.position.x === bx + 0.5);
  const strayMesh = beams().find((m) => m.position.x === bx + 8.5);
  let keyGeoDisposed = 0, keyMatDisposed = 0;
  const okGeo = keyMesh.geometry.dispose.bind(keyMesh.geometry);
  keyMesh.geometry.dispose = () => { keyGeoDisposed++; okGeo(); };
  const okMat = keyMesh.material.dispose.bind(keyMesh.material);
  keyMesh.material.dispose = () => { keyMatDisposed++; okMat(); };
  lg._breakBeacon(bx, by, bz);
  const broken = {
    beams: beams().length, keyGone: !inScene(keyMesh), strayStill: inScene(strayMesh),
    geoDisposed: keyGeoDisposed, matDisposed: keyMatDisposed,
  };
  lg.player.effects.clear();
  const nBroken = pulses.length;
  lg._updateBeaconPulse(5);
  const noMore = { pulses: pulses.length - nBroken, has: lg.player.effects.has('speed') };
  assert('L7 挖掉信标 _breakBeacon：该 key 的光柱摘出 scene 且 geometry/material 各 dispose 1 次、另一 key 的光柱不受影响；激活态被清 → 之后补脉冲不再给玩家上效果',
    broken.beams === 1 && broken.keyGone === true && broken.strayStill === true &&
    broken.geoDisposed === 1 && broken.matDisposed === 1 && noMore.pulses === 0 && noMore.has === false,
    '断后=' + JSON.stringify(broken) + ' 脉冲=' + JSON.stringify(noMore));

  // ── L8 _clearBeaconState：清光柱（含非激活 key 的 stray）+ 激活表，二次调用幂等 ──
  let strayGeoDisposed = 0;
  const osGeo = strayMesh.geometry.dispose.bind(strayMesh.geometry);
  strayMesh.geometry.dispose = () => { strayGeoDisposed++; osGeo(); };
  lg.setBeaconEffect(bx, by, bz, 'haste', 2);            // 重新激活：激活表 + 光柱各 1 条
  const beforeClear = { beams: beams().length, activated: lg.player.effects.has('haste') };
  lg._clearBeaconState();
  lg.player.effects.clear();
  const nClear = pulses.length;
  lg._updateBeaconPulse(5);
  const afterClear = {
    beams: beams().length, strayGone: !inScene(strayMesh), strayDisposed: strayGeoDisposed,
    pulses: pulses.length - nClear, has: lg.player.effects.has('haste'),
  };
  lg._clearBeaconState();                                // 幂等：不抛、不再重复 dispose
  const twice = { beams: beams().length, strayDisposed: strayGeoDisposed };
  lg.player.applyEffect = origApply;
  assert('L8 _clearBeaconState：场景里所有光柱（激活 key + stray）摘出并各 dispose、激活表清空后补脉冲不再触发效果；二次调用幂等（不抛、不重复 dispose）',
    beforeClear.beams === 2 && beforeClear.activated === true &&
    afterClear.beams === 0 && afterClear.strayGone === true && afterClear.strayDisposed === 1 &&
    afterClear.pulses === 0 && afterClear.has === false &&
    twice.beams === 0 && twice.strayDisposed === 1,
    '清前=' + JSON.stringify(beforeClear) + ' 清后=' + JSON.stringify(afterClear) + ' 二次=' + JSON.stringify(twice));
}

// ── M. 传送门域行为：点火 / 逐框嵌眼 / 站门计时与防回弹 / 到达落点与返程门 / 立地面下探 ──
// 轮 8 步 5 的迁移面（PortalSystem）。断言全部经 Game 上的同名真实入口驱动
// （_tryLightPortal / _tryPlaceEndEye / updatePortals / _afterPortalArrival / _resolveArrivalY；
// 折跃门由 updatePortals 触发 _useGatewayPortal 做真实同维瞬移），只 stub 两处**域外**协作面：
// chatBox（单机为 null）与 switchDimension（真跑会整世界重建，属 L17 域，本步不动）。
// 穿越三件套 _portalTimer/_portalArmed/_portalCooldown 按红线留在 Game（start() 复位，禁改区），
// 本段直接读写 Game 字段——这正是要钉住的不变量。
{
  const Reg = (await import('../src/core/BlockRegistry.js')).BlockRegistry;
  const Chunky = await import('../src/core/Chunk.js');
  const Dims = await import('../src/core/dimensions.js');
  const OBS = Reg.getId('obsidian'), GLOW = Reg.getId('glowstone'), STONE = Reg.getId('stone');
  const NETHER_PORTAL = Reg.getId('nether_portal'), AETHER_PORTAL = Reg.getId('aether_portal');
  const FRAME = Reg.getId('end_portal_frame'), EYE = Reg.getId('end_portal_frame_eye');
  const END_PORTAL = Reg.getId('end_portal'), GATEWAY = Reg.getId('end_gateway');

  const m = await boot({ mode: 'creative', seed: SEED });
  track(m.g);
  const mg = m.g;
  const chat = [];
  mg.chatBox = { add: (text, color) => chat.push([text, color]) };
  mg.running = true; // boot() 收尾会 stop()（running=false），真实对局中恒 true——_afterPortalArrival 首行读它
  const lastChat = () => chat[chat.length - 1] || ['', ''];
  const countLedger = (id) => { let n = 0; for (const [, v] of mg.world.modifiedBlocks) if (v === id) n++; return n; };
  const px0 = Math.floor(mg.player.position.x), pz0 = Math.floor(mg.player.position.z);

  // ── M1 打火石点框：黑曜石框 → 下界门 / 萤石框 → 天域门 ──
  // 4×5 框（内 2×3）沿 x 轴：上下整行 + 左右立柱；点底框上表面 → 候选格 = 框内空气
  const buildFrame = (bx, by, bz, frameId) => {
    for (let ix = -1; ix <= 2; ix++) {
      mg.world.setBlock(bx + ix, by - 1, bz, frameId);
      mg.world.setBlock(bx + ix, by + 3, bz, frameId);
    }
    for (let iy = 0; iy <= 2; iy++) {
      mg.world.setBlock(bx - 1, by + iy, bz, frameId);
      mg.world.setBlock(bx + 2, by + iy, bz, frameId);
    }
  };
  const interior = (bx, by, bz) => {
    const a = [];
    for (let ix = 0; ix <= 1; ix++) for (let iy = 0; iy <= 2; iy++) a.push(mg.world.getBlock(bx + ix, by + iy, bz));
    return a;
  };
  const bx1 = px0 + 8, by1 = 200, bz1 = pz0, bz2 = pz0 + 8;
  buildFrame(bx1, by1, bz1, OBS);
  const litNether = mg._tryLightPortal({ block: { x: bx1, y: by1 - 1, z: bz1 }, normal: { x: 0, y: 1, z: 0 } }, Reg.getByName('obsidian'));
  const netherFill = interior(bx1, by1, bz1);
  const netherChat = lastChat();
  const frameKept = mg.world.getBlock(bx1 - 1, by1 + 1, bz1) === OBS && mg.world.getBlock(bx1, by1 - 1, bz1) === OBS;
  buildFrame(bx1, by1, bz2, GLOW);
  const litAether = mg._tryLightPortal({ block: { x: bx1, y: by1 - 1, z: bz2 }, normal: { x: 0, y: 1, z: 0 } }, Reg.getByName('glowstone'));
  const aetherFill = interior(bx1, by1, bz2);
  const aetherChat = lastChat();
  assert('M1 点火：黑曜石框填 6 格 nether_portal、萤石框填 6 格 aether_portal；框材原样保留、返回 true（点击已消费）、播报「…被点亮了…」（#a7f）',
    litNether === true && netherFill.length === 6 && netherFill.every((id) => id === NETHER_PORTAL) && frameKept &&
    litAether === true && aetherFill.length === 6 && aetherFill.every((id) => id === AETHER_PORTAL) &&
    netherChat[0].includes('下界传送门') && netherChat[1] === '#a7f' &&
    aetherChat[0].includes('天域传送门') && aetherChat[1] === '#a7f',
    '下界=' + JSON.stringify(netherFill) + ' 天域=' + JSON.stringify(aetherFill) + ' 播报=' + JSON.stringify([netherChat, aetherChat]));

  // 非法框：独块黑曜石（无框）→ 返回 true（打火石无"生火"语义可回退）但零填充 + 播报「框架不完整」
  const lx1 = bx1, ly1 = by1 + 10, lz1 = bz1;
  mg.world.setBlock(lx1, ly1, lz1, OBS);
  const ledgerBeforeBad = countLedger(NETHER_PORTAL) + countLedger(AETHER_PORTAL);
  const rBad = mg._tryLightPortal({ block: { x: lx1, y: ly1, z: lz1 }, normal: { x: 0, y: 1, z: 0 } }, Reg.getByName('obsidian'));
  const badChat = lastChat();
  const ledgerAfterBad = countLedger(NETHER_PORTAL) + countLedger(AETHER_PORTAL);
  const rNoAir = mg._tryLightPortal({ block: { x: bx1 - 1, y: by1 + 1, z: bz1 }, normal: { x: 1, y: 0, z: 0 } }, Reg.getByName('obsidian'));
  const rNotFrame = mg._tryLightPortal({ block: { x: lx1, y: ly1, z: lz1 }, normal: { x: 0, y: 1, z: 0 } }, Reg.getByName('stone'));
  assert('M1b 点火拒绝路径：非法框返回 true 但账本零新增 + 播报「框架不完整」（#fa8）；候选格非空气返回 false；非框材 targetDef 返回 false',
    rBad === true && ledgerAfterBad === ledgerBeforeBad && badChat[0].includes('框架不完整') && badChat[1] === '#fa8' &&
    rNoAir === false && rNotFrame === false,
    'rBad=' + rBad + ' 账本=' + ledgerBeforeBad + '->' + ledgerAfterBad + ' 播报=' + JSON.stringify(badChat) + ' rNoAir=' + rNoAir + ' rNotFrame=' + rNotFrame);

  // ── M2 末影之眼逐框嵌眼：第 11 眼不激活；第 12 眼取**远边**点击（窗口原点须枚举到 -4）才激活 ──
  const ring5 = (w0x, wy2, w0z) => {
    const pos = [];
    for (let ix = 0; ix < 5; ix++) for (let iz = 0; iz < 5; iz++) {
      const corner = (ix === 0 || ix === 4) && (iz === 0 || iz === 4);
      const edge = ix === 0 || ix === 4 || iz === 0 || iz === 4;
      if (!edge || corner) continue;
      pos.push([ix, iz]);
      mg.world.setBlock(w0x + ix, wy2, w0z + iz, FRAME);
    }
    for (let ix = 1; ix <= 3; ix++) for (let iz = 1; iz <= 3; iz++) mg.world.setBlock(w0x + ix, wy2, w0z + iz, 0);
    return pos;
  };
  const centerIds = (w0x, wy2, w0z) => {
    const a = [];
    for (let ix = 1; ix <= 3; ix++) for (let iz = 1; iz <= 3; iz++) a.push(mg.world.getBlock(w0x + ix, wy2, w0z + iz));
    return a;
  };
  const w0x = px0 + 24, wy2 = 210, w0z = pz0;
  const NEARX = [0, 2], FARX = [4, 2]; // 近边（窗口原点 ox=0）/ 远边（须枚举到 ox=-4）
  const ring = ring5(w0x, wy2, w0z);
  for (const [ix, iz] of ring) {
    if ((ix === NEARX[0] && iz === NEARX[1]) || (ix === FARX[0] && iz === FARX[1])) continue;
    mg.world.setBlock(w0x + ix, wy2, w0z + iz, EYE);
  }
  mg.player.setMode('survival');
  mg.inventory.slots[mg.inventory.hotbarSelected] = { name: 'ender_eye', count: 5, data: null };
  const eyesStart = mg.inventory.getSelected().count;
  chat.length = 0;
  const r11 = mg._tryPlaceEndEye({ block: { x: w0x + NEARX[0], y: wy2, z: w0z + NEARX[1] }, normal: { x: -1, y: 0, z: 0 } }, Reg.getByName('end_portal_frame'));
  const c11 = { center: centerIds(w0x, wy2, w0z), eye: mg.world.getBlock(w0x + NEARX[0], wy2, w0z + NEARX[1]) === EYE, chat: lastChat(), stock: mg.inventory.getSelected().count };
  const r12 = mg._tryPlaceEndEye({ block: { x: w0x + FARX[0], y: wy2, z: w0z + FARX[1] }, normal: { x: 1, y: 0, z: 0 } }, Reg.getByName('end_portal_frame'));
  const c12 = { center: centerIds(w0x, wy2, w0z), eye: mg.world.getBlock(w0x + FARX[0], wy2, w0z + FARX[1]) === EYE, chat: lastChat(), stock: mg.inventory.getSelected().count };
  assert('M2 逐框嵌眼：第 11 眼（近边点击）只嵌框 + 播报「11/12」、中心 3×3 仍全空气；第 12 眼取**远边**点击 → 嵌框 + 中心 3×3 填 end_portal + 播报激活；生存各消耗 1 眼',
    r11 === true && c11.eye === true && c11.center.every((id) => id === 0) && c11.chat[0].includes('11/12') && c11.stock === eyesStart - 1 &&
    r12 === true && c12.eye === true && c12.center.length === 9 && c12.center.every((id) => id === END_PORTAL) &&
    c12.chat[0].includes('末地传送门被激活了') && c12.stock === eyesStart - 2,
    '11眼=' + JSON.stringify(c11) + ' 12眼=' + JSON.stringify(c12));

  // 散框（非环位）不消耗；targetDef 非 end_portal_frame 直接 false
  const scat = px0 + 40;
  mg.world.setBlock(scat, wy2, pz0, FRAME);
  const stockBefore = mg.inventory.getSelected().count;
  const rScat = mg._tryPlaceEndEye({ block: { x: scat, y: wy2, z: pz0 }, normal: { x: 0, y: 1, z: 0 } }, Reg.getByName('end_portal_frame'));
  const scatAfter = { kept: mg.world.getBlock(scat, wy2, pz0) === FRAME, stock: mg.inventory.getSelected().count };
  const rOtherTarget = mg._tryPlaceEndEye({ block: { x: scat, y: wy2, z: pz0 }, normal: { x: 0, y: 1, z: 0 } }, Reg.getByName('stone'));
  assert('M2b 散框不消耗：非环位独框返回 false、方块与眼数量都不变；targetDef 非 end_portal_frame 直接 false',
    rScat === false && scatAfter.kept === true && scatAfter.stock === stockBefore && rOtherTarget === false,
    'rScat=' + rScat + ' 散框=' + JSON.stringify(scatAfter) + ' 原数=' + stockBefore + ' rOther=' + rOtherTarget);

  // ── M3 站门计时与防回弹：下界门 2s 阈值 / 离门才重新武装 / 到达 cooldown 4s 前置拦截 ──
  const switched = [];
  mg.switchDimension = (dim, arrival) => { switched.push([dim, arrival]); return Promise.resolve(true); };
  const sx3 = px0 + 6, sz3 = pz0 + 6, sy3 = 202;
  mg.world.setBlock(sx3, sy3 - 1, sz3, STONE);
  for (let dy = 0; dy <= 2; dy++) mg.world.setBlock(sx3, sy3 + dy, sz3, 0);
  mg.player.position.set(sx3 + 0.5, sy3, sz3 + 0.5);
  mg.player.velocity.set(0, 0, 0);
  mg._portalTimer = 0; mg._portalArmed = true; mg._portalCooldown = 0;
  const drive = (sec, dt = 0.1) => { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) mg.updatePortals(dt); };
  mg.world.setBlock(sx3, sy3, sz3, NETHER_PORTAL);
  chat.length = 0;
  drive(1.9);
  const at19 = { calls: switched.length, timer: mg._portalTimer, armed: mg._portalArmed };
  drive(0.2);
  const at21 = { calls: switched.length, timer: mg._portalTimer, armed: mg._portalArmed, dim: switched[0] && switched[0][0], arrival: switched[0] && switched[0][1], chat: lastChat() };
  assert('M3a 站门 2s 阈值：站入下界门 1.9s 不触发（计时器累积到 1.9+ 且仍武装），2.1s 触发一次 → 目标维度 nether、落点 = 玩家坐标 1/8 换算向下取整 + portal 标记、计时器归零 + 撤武装、播报「传送门轰鸣着将你送往…」（#a7f）',
    at19.calls === 0 && at19.timer > 1.8 && at19.timer < 2.0 && at19.armed === true &&
    at21.calls === 1 && at21.timer === 0 && at21.armed === false && at21.dim === 'nether' &&
    at21.arrival && at21.arrival.x === Math.floor((sx3 + 0.5) / 8) && at21.arrival.z === Math.floor((sz3 + 0.5) / 8) && at21.arrival.portal === 'nether' &&
    at21.chat[0].includes('传送门轰鸣着将你送往') && at21.chat[1] === '#a7f',
    '1.9s=' + JSON.stringify(at19) + ' 2.1s=' + JSON.stringify(at21));

  drive(3.0); // 仍站在门里：未武装 → 计时器零累积，绝不二次触发
  const stayed = { calls: switched.length, timer: mg._portalTimer, armed: mg._portalArmed };
  mg.world.setBlock(sx3, sy3, sz3, 0); // 离门
  drive(0.5);
  const leftDoor = { armed: mg._portalArmed, timer: mg._portalTimer };
  mg.world.setBlock(sx3, sy3, sz3, NETHER_PORTAL); // 再入门
  drive(1.9);
  const re19 = { calls: switched.length };
  drive(0.2);
  const re21 = { calls: switched.length };
  assert('M3b 防回弹：触发后仍站 3s 不二次触发（计时器恒 0）；离门一帧后 _portalArmed 复位为 true；再入门须满 2s 才二次触发（1.9s 时仍未触发）',
    stayed.calls === 1 && stayed.timer === 0 && stayed.armed === false &&
    leftDoor.armed === true && leftDoor.timer === 0 &&
    re19.calls === 1 && re21.calls === 2,
    '停留=' + JSON.stringify(stayed) + ' 离门=' + JSON.stringify(leftDoor) + ' 再入1.9s=' + JSON.stringify(re19) + ' 再入2.1s=' + JSON.stringify(re21));

  // 到达态（无坐标分支）：cooldown=4 且撤武装；冷却期内连"离门重新武装"都被前置拦截、计时器零累积
  mg._afterPortalArrival({ portal: 'nether' });
  const arrived = { cooldown: mg._portalCooldown, armed: mg._portalArmed };
  mg.world.setBlock(sx3, sy3, sz3, 0);
  drive(2.2);
  const inCooldown = { calls: switched.length, timer: mg._portalTimer, armed: mg._portalArmed, cooldown: mg._portalCooldown };
  drive(1.9);
  const cooled = { armed: mg._portalArmed, cooldown: mg._portalCooldown };
  mg.world.setBlock(sx3, sy3, sz3, NETHER_PORTAL);
  drive(2.1);
  const afterCooled = { calls: switched.length };
  assert('M3c 到达 cooldown：无坐标到达置 cooldown=4 + 撤武装；冷却期内（离门 2.2s）计时器零累积且**不**重新武装（2.2s 时冷却还剩 1.8）；冷却归零 + 离门后才武装；此后站门 2.1s 触发第 3 次',
    arrived.cooldown === 4 && arrived.armed === false &&
    inCooldown.calls === 2 && inCooldown.timer === 0 && inCooldown.armed === false && Math.abs(inCooldown.cooldown - 1.8) < 0.01 &&
    cooled.armed === true && cooled.cooldown <= 0 && afterCooled.calls === 3,
    '到达=' + JSON.stringify(arrived) + ' 冷却中=' + JSON.stringify(inCooldown) + ' 冷却尽=' + JSON.stringify(cooled) + ' 再触发=' + JSON.stringify(afterCooled));

  // ── M4 到达落点：24 格内吸附既有门 / 门外自动建 4×5 返程门 / 无坐标与未知种类只置到达态 ──
  mg._portalArmed = true; mg._portalTimer = 0; mg._portalCooldown = 0;
  chat.length = 0;
  const ax4 = px0 + 320, az4 = pz0 + 320;
  const ledgerBuiltBefore = countLedger(NETHER_PORTAL);
  mg._afterPortalArrival({ x: ax4, z: az4, portal: 'nether' });
  const pyA = mg.player.position.y;
  const built = {
    footPortal: mg.world.getBlock(ax4 + 1, pyA, az4) === NETHER_PORTAL,
    leftFrame: mg.world.getBlock(ax4, pyA, az4) === OBS,
    rightFrame: mg.world.getBlock(ax4 + 3, pyA, az4) === OBS,
    atStand: mg.player.position.x === ax4 + 1.5 && mg.player.position.z === az4 + 0.5,
    velZero: mg.player.velocity.length() === 0,
    cooldown: mg._portalCooldown, armed: mg._portalArmed, chat: lastChat(),
  };
  const ledgerBuiltAfter = countLedger(NETHER_PORTAL);
  assert('M4a 无门自动建返程门：落点 24 格内无同类门 → 就地建 4×5 门（账本新增 6 格 nether_portal、左右立柱为黑曜石），玩家被放到门内底格中心（落点 +1.5/+0.5）、速度清零、cooldown=4 + 撤武装，播报「你在落点建造了一座返程传送门」',
    built.footPortal === true && built.leftFrame === true && built.rightFrame === true && built.atStand === true &&
    ledgerBuiltAfter - ledgerBuiltBefore === 6 && built.velZero === true &&
    built.cooldown === 4 && built.armed === false && built.chat[0].includes('你在落点建造了一座返程传送门') && built.chat[1] === '#a7f',
    JSON.stringify(built) + ' 账本=' + ledgerBuiltBefore + '->' + ledgerBuiltAfter);

  const ledgerSnapBefore = countLedger(NETHER_PORTAL);
  mg._afterPortalArrival({ x: ax4 + 20, z: az4, portal: 'nether' }); // 距最近门格 18 格 → 吸附
  const snapPos = { x: mg.player.position.x, y: mg.player.position.y, z: mg.player.position.z };
  const snap = { ledger: countLedger(NETHER_PORTAL), footPortal: mg.world.getBlock(Math.floor(snapPos.x), snapPos.y, Math.floor(snapPos.z)) === NETHER_PORTAL, cooldown: mg._portalCooldown };
  mg._afterPortalArrival({ x: ax4 + 40, z: az4, portal: 'nether' });  // 距最近门格 37 格 → 门外，另建一座
  const farBuild = { ledger: countLedger(NETHER_PORTAL), footPortal: mg.world.getBlock(Math.floor(mg.player.position.x), mg.player.position.y, Math.floor(mg.player.position.z)) === NETHER_PORTAL };
  assert('M4b 24 格吸附半径：落点在既有门 18 格内 → 吸附到账本门格中心（脚格是门方块、位置在门体范围内）且不新建（账本零新增）；37 格外 → 不走吸附、另建一座（账本 +6）',
    snap.ledger === ledgerSnapBefore && snap.footPortal === true && snap.cooldown === 4 &&
    snapPos.x > ax4 && snapPos.x < ax4 + 4 && snapPos.z === az4 + 0.5 &&
    farBuild.ledger === ledgerSnapBefore + 6 && farBuild.footPortal === true,
    '吸附=' + JSON.stringify(snap) + ' 位置=' + JSON.stringify(snapPos) + ' 远建=' + JSON.stringify(farBuild));

  mg.player.position.set(px0 + 0.5, 220, pz0 + 0.5);
  const ledgerNoPos = countLedger(NETHER_PORTAL);
  mg._afterPortalArrival({ portal: 'end' }); // 仅 portal 标记（末地出生点链）
  const noPos = { pos: [mg.player.position.x, mg.player.position.y, mg.player.position.z], ledger: countLedger(NETHER_PORTAL), cooldown: mg._portalCooldown, armed: mg._portalArmed };
  mg._afterPortalArrival({ x: ax4 + 60, z: az4, portal: 'bogus' }); // 未知种类（服务器可回传任意串）
  const bogus = { pos: [mg.player.position.x, mg.player.position.y, mg.player.position.z], ledger: countLedger(NETHER_PORTAL) };
  assert('M4c 只置到达态：无坐标 arrival（末地出生点链）→ 位置不动、不建门、cooldown=4 + 撤武装；未知 portal 种类 → 同样不吸附不建门',
    noPos.pos[0] === px0 + 0.5 && noPos.pos[1] === 220 && noPos.pos[2] === pz0 + 0.5 && noPos.ledger === ledgerNoPos &&
    noPos.cooldown === 4 && noPos.armed === false &&
    bogus.ledger === ledgerNoPos && bogus.pos[0] === px0 + 0.5 && bogus.pos[1] === 220,
    '无坐标=' + JSON.stringify(noPos) + ' 未知种类=' + JSON.stringify(bogus));

  const mMenu = await createGame();
  let menuArrival = 'n/a';
  try { mMenu.g._afterPortalArrival({ x: 0, z: 0, portal: 'nether' }); menuArrival = 'ok'; } catch (err) { menuArrival = 'throw:' + (err && err.message); }
  shutdown(mMenu.g);
  assert('M4d 主菜单期（world/running 皆无）：_afterPortalArrival 早退不抛（构造期漏实例化传送门控制器会在这里炸）',
    menuArrival === 'ok', 'menuArrival=' + menuArrival);

  // ── M5 立地面下探 _resolveArrivalY：与真实生成器重算的"最高可站立空气层"逐值一致 ──
  // 独立样本：用该维度真实生成器现造临时区块重算（断言"最高且合法"，不是复述实现）
  const oracle = (dim, x, z) => {
    const def = Dims.getDimension(dim);
    const gen = def.createGenerator(mg.world.seed, { biomeScale: mg.biomeScale });
    const cx = Math.floor(x / Chunky.CHUNK_SIZE), cz = Math.floor(z / Chunky.CHUNK_SIZE);
    const c = new Chunky.Chunk(cx, cz);
    gen.generateChunk(c);
    const lx = x - cx * Chunky.CHUNK_SIZE, lz = z - cz * Chunky.CHUNK_SIZE;
    const top = Math.min(def.spawnScanTop || 140, Chunky.CHUNK_HEIGHT - 2);
    const valid = [];
    for (let y = top; y >= 1; y--) {
      if (c.get(lx, y, lz) === 0 && c.get(lx, y + 1, lz) === 0) {
        const d = Reg.getById(c.get(lx, y - 1, lz));
        if (d && d.solid) valid.push(y);
      }
    }
    return { max: valid.length ? valid[0] : -1, count: valid.length };
  };
  const qx = px0 + 137, qz = pz0 - 91;
  const owOracle = oracle('overworld', qx, qz);
  const neOracle = oracle('nether', qx, qz);
  const owY = mg._resolveArrivalY('overworld', qx, qz);
  const neY = mg._resolveArrivalY('nether', qx, qz);
  const owAgain = mg._resolveArrivalY('overworld', qx, qz);
  const bogusY = mg._resolveArrivalY('bogus', qx, qz);
  assert('M5 _resolveArrivalY：主世界/下界各一列 = 真实生成器重算的"从扫描顶下探的首个（本格空气 + 上格空气 + 下格实心）"且为最高者；同参二次调用逐值相同；未知维度 -1',
    owY === owOracle.max && owOracle.count >= 1 && neY === neOracle.max && owAgain === owY && bogusY === -1,
    '主世界=' + owY + '/' + JSON.stringify(owOracle) + ' 下界=' + neY + '/' + JSON.stringify(neOracle) + ' 二次=' + owAgain + ' 未知=' + bogusY);

  const ldArr = mg._composeSwitchLoadData('nether', null, null, { x: qx, z: qz, portal: 'nether' });
  const ldSpawn = mg._composeSwitchLoadData('nether', null, null, null);
  assert('M5b 落点装配接缝：带坐标 arrival → dimensionSpawn=false + player.x/z = 落点 +0.5 + player.y = _resolveArrivalY（无立足面回落 ARRIVAL_PLATFORM.nether=40）；无 arrival → dimensionSpawn=true 且不写落点坐标',
    ldArr.dimensionSpawn === false && ldArr.dimension === 'nether' && ldArr.player.x === qx + 0.5 && ldArr.player.z === qz + 0.5 &&
    ldArr.player.y === (neY > 0 ? neY : 40) &&
    ldSpawn.dimensionSpawn === true && ldSpawn.player.x === undefined && ldSpawn.player.z === undefined,
    '带坐标=' + JSON.stringify([ldArr.dimensionSpawn, ldArr.player.x, ldArr.player.y, ldArr.player.z]) + ' 无坐标=' + JSON.stringify([ldSpawn.dimensionSpawn, ldSpawn.player.x]));
}

// ── N. 折跃门域行为：末地同维传送（1s 阈值 + 账本角度最近配对直达）─────────────────
{
  const Reg = (await import('../src/core/BlockRegistry.js')).BlockRegistry;
  const GATEWAY = Reg.getId('end_gateway');
  const e = await boot({ mode: 'creative', seed: SEED, loadData: { dimension: 'end', gamemode: 'creative', seed: SEED } });
  track(e.g);
  const eg = e.g;
  const gchat = [];
  eg.chatBox = { add: (text, color) => gchat.push([text, color]) };
  const gx = Math.floor(eg.player.position.x) + 20, gz = Math.floor(eg.player.position.z) + 20, gy = 200;
  eg.world.setBlock(gx, gy, gz, GATEWAY);          // 脚下这座
  eg.world.setBlock(gx + 40, gy, gz, GATEWAY);     // 配对门（账本内另一座，>6 格）
  eg.player.position.set(gx + 0.5, gy, gz + 0.5);
  eg.player.velocity.set(0, 0, 0);
  eg._portalTimer = 0; eg._portalArmed = true; eg._portalCooldown = 0;
  const gdrive = (sec, dt = 0.05) => { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) eg.updatePortals(dt); };
  gdrive(0.75);
  const gAt075 = { x: eg.player.position.x, y: eg.player.position.y, z: eg.player.position.z, timer: eg._portalTimer };
  gdrive(0.3);
  const gAt105 = {
    x: eg.player.position.x, y: eg.player.position.y, z: eg.player.position.z,
    timer: eg._portalTimer, armed: eg._portalArmed, vel: eg.player.velocity.length(), chat: gchat[gchat.length - 1] || ['', ''],
  };
  assert('N1 折跃门：站入 0.75s 不动（1s 阈值），1.05s 触发 → 直达账本角度最近配对门（门格 +1 高度、格心 +0.5）、速度清零、计时器归零 + 撤武装，播报「折跃门的光束把你送往远方的岛屿……」',
    gAt075.x === gx + 0.5 && gAt075.y === gy && gAt075.z === gz + 0.5 && gAt075.timer > 0.7 && gAt075.timer < 1.0 &&
    gAt105.x === gx + 40.5 && gAt105.y === gy + 1 && gAt105.z === gz + 0.5 &&
    gAt105.timer === 0 && gAt105.armed === false && gAt105.vel === 0 &&
    gAt105.chat[0].includes('折跃门的光束把你送往远方的岛屿') && gAt105.chat[1] === '#a7f',
    '0.75s=' + JSON.stringify(gAt075) + ' 1.05s=' + JSON.stringify(gAt105));
}

for (const x of games) shutdown(x);
for (const x of games) shutdown(x);
finish('game-behavior');
