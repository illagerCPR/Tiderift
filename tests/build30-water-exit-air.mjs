// build30-water-exit-air.mjs -- Build 30 批次回归（node 直跑，无需服务器）
// 断言：
//   ① 水中上岸助推（类原版）：贴岸碰撞给上浮助推（WATER_EXIT_BOOST）而非瞬抬台阶；单帧位移平滑
//     （无 +1 瞬跳）；助推后松开 Space 仍能持续爬岸、翻沿、被水平移速带上岸（全程仿真）；
//     两格高墙（stepH>1.0）不助推；潜游下潜（sneak vy=-4）与坠水掠墙（快速下沉）不打断
//   ② bodyInWater 身体浸水判定：脚部/躯干任一浸水即真；纯陆地为假
//   ③ 陆上 auto-step 保持：1 格台阶仍瞬抬走上（既有手感不变）；门板禁踏绊线仍在位
//   ④ 氧气原版口径（AirSupply）：满氧 300 tick = 15 秒、按 dt 折算帧率无关（60/30fps 一致）；
//     耗尽后每秒扣 2 血（原版口径）；airTicks 不为负；出水约 0.5 秒回满并复位溺水计时
//   ⑤ 接线绊线：Game 走 updateAirSupply（旧逐帧 -1 逻辑已删）；Physics 助推常量/门限/身体浸水在位；
//     Player.drownTimer 字段；Hud 气泡公式仍以 300 为满；SaveSystem 仍持久化 airTicks
import { readFileSync } from 'fs';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import '../src/blocks/BlockDefs.js'; // 副作用导入：方块注册表填充
import { Physics } from '../src/player/Physics.js';
import { updateAirSupply, AIR_MAX_TICKS, DROWN_INTERVAL, DROWN_DAMAGE } from '../src/core/AirSupply.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
const approx = (a, b, eps) => Math.abs(a - b) <= eps;

// ── 场景脚手架：稀疏体素世界 + 最小实体 ──
const WATER = BlockRegistry.getId('water');
const STONE = BlockRegistry.getId('stone');
function makeWorld(cells) {
  const get = (x, y, z) => cells.get(`${x},${y},${z}`) ?? 0;
  return { getBlock: (x, y, z) => get(x, y, z) };
}
function makeEntity(x, y, z, vx = 0, vy = 0, vz = 0) {
  return {
    position: { x, y, z }, velocity: { x: vx, y: vy, z: vz },
    inWater: false, onGround: false, flying: false, spectator: false, gliding: false,
  };
}

// ═══ ① 水中上岸助推（类原版） ═══
{
  // 水柱 x=0（y 62..65，水面顶=66），岸 x=1：stone(1,62..64) → 岸沿顶=65；水底 stone y=61
  const cells = new Map();
  for (let y = 62; y <= 65; y++) cells.set(`0,${y},0`, WATER);
  for (let y = 62; y <= 64; y++) cells.set(`1,${y},0`, STONE);
  cells.set('0,61,0', STONE); cells.set('1,61,0', STONE);
  const world = makeWorld(cells);
  const phys = new Physics(world);
  const dt = 1 / 60;
  const WATER_TOP = 66;

  // ①-a 贴岸助推：已贴住岸壁（x=0.68 一帧即触碰）、浮在岸沿 1 格内（y=64.2，stepH=0.8）→ 助推而非瞬抬
  const e = makeEntity(0.68, 64.2, 0.5, 2.15, 0, 0);
  e.inWater = true;
  phys.collide(e, dt);
  ok(e.bodyInWater === true, '贴岸实体 bodyInWater = true（身体浸水判定生效）');
  ok(e.velocity.y >= 3.9, `贴岸碰撞触发上浮助推（vy=${e.velocity.y.toFixed(2)} ≥ 3.9）`);
  ok(e.position.y < 64.5, `水中不瞬抬台阶（y=${e.position.y.toFixed(3)} < 64.5，旧实现会瞬跳到 65.0001）`);

  // ①-b 全程仿真：Space 按住 30 帧后松开，仅按住前进 → 助推接力爬岸、翻沿、被带上岸
  const sim = makeEntity(0.5, 63.0, 0.5, 0, 0, 0);
  sim.inWater = true;
  let maxStepY = 0, prevY = sim.position.y, crest = -1, landed = -1, boostFrames = 0;
  for (let f = 0; f < 600 && landed < 0; f++) {
    sim.inWater = (sim.position.y + 1.62) < WATER_TOP; // 模拟 Game._updateWaterState（眼位）
    if (sim.inWater) {
      sim.velocity.x = 2.15;               // 游泳水平速度
      if (f < 30) sim.velocity.y = 4.0;    // Space 上浮（30 帧后松开）
    } else {
      sim.velocity.x = 4.3;                // 出水后陆上移速接管
    }
    phys.collide(sim, dt);
    maxStepY = Math.max(maxStepY, Math.abs(sim.position.y - prevY));
    if (sim.bodyInWater && sim.velocity.y >= 3.9) boostFrames++;
    if (crest < 0 && sim.position.y > 65) crest = f;
    if (sim.onGround && sim.position.x > 1.3) landed = f;
    prevY = sim.position.y;
  }
  ok(landed >= 0 && landed < 180, `松开 Space 后助推接力完成上岸（第 ${landed} 帧落地，<3 秒）`);
  ok(approx(sim.position.y, 65, 0.01), `最终站上岸沿顶（y=${sim.position.y.toFixed(3)} ≈ 65）`);
  ok(sim.position.x > 1.3, `完整越过岸沿（x=${sim.position.x.toFixed(3)} > 1.3）`);
  ok(maxStepY < 0.2, `全程平滑无瞬抬（单帧最大 Δy=${maxStepY.toFixed(3)} < 0.2，旧实现为 1.0 瞬跳）`);
  ok(boostFrames > 10, `助推多帧接力生效（boost 帧数 ${boostFrames} > 10）`);
  ok(crest >= 0 && crest <= landed, '翻沿发生在落地之前（爬升→翻越→上岸时序正确）');

  // ①-c 两格高墙（stepH=2.0）不助推、不瞬抬
  const cellsWall = new Map();
  for (let y = 62; y <= 65; y++) cellsWall.set(`0,${y},0`, WATER);
  for (let y = 62; y <= 65; y++) cellsWall.set(`1,${y},0`, STONE);
  cellsWall.set('0,61,0', STONE);
  const physWall = new Physics(makeWorld(cellsWall));
  const w = makeEntity(0.68, 63.0, 0.5, 2.15, 0, 0);
  w.inWater = true;
  physWall.collide(w, dt);
  ok(w.velocity.y < 0, `两格高墙不助推（vy=${w.velocity.y.toFixed(2)} < 0）`);
  ok(w.position.y < 63.01, `两格高墙不瞬抬（y=${w.position.y.toFixed(3)}）`);
  ok(w.bodyInWater === true, '高墙场景 bodyInWater 判定仍为 true（门限而非判定缺陷）');

  // ①-d 潜游下潜（sneak vy=-4）不被助推打断
  const sneak = makeEntity(0.68, 64.2, 0.5, 2.15, -4, 0);
  sneak.inWater = true;
  phys.collide(sneak, dt);
  ok(sneak.velocity.y < 0, `下潜意图不被助推打断（vy=${sneak.velocity.y.toFixed(2)} < 0）`);

  // ①-e 坠水掠墙（快速下沉）不触发助推
  const fall = makeEntity(0.68, 64.2, 0.5, 2.15, -4, 0);
  fall.inWater = true;
  phys.collide(fall, dt);
  ok(fall.velocity.y < 0, `下沉趋势（vy ≤ 门限）不助推（vy=${fall.velocity.y.toFixed(2)}）`);
}

// ═══ ② bodyInWater 判定边界 ═══
{
  const cells = new Map();
  cells.set('0,64,0', WATER); // 仅脚部格有水
  const phys = new Physics(makeWorld(cells));
  const e = makeEntity(0.5, 64.0, 0.5);
  phys.collide(e, 1 / 60);
  ok(e.bodyInWater === true, '仅脚部浸水 → bodyInWater = true');

  const dry = makeEntity(0.5, 70.0, 0.5);
  phys.collide(dry, 1 / 60);
  ok(dry.bodyInWater === false, '纯陆地 → bodyInWater = false');
}

// ═══ ③ 陆上 auto-step 保持 ═══
{
  const cells = new Map();
  cells.set('0,63,0', STONE); cells.set('1,63,0', STONE); cells.set('1,64,0', STONE);
  const phys = new Physics(makeWorld(cells));
  const e = makeEntity(0.5, 64.0, 0.5, 2.15, 0, 0);
  for (let f = 0; f < 30; f++) {
    e.velocity.x = 2.15; // 模拟地面操控逐帧覆写
    phys.collide(e, 1 / 60);
  }
  ok(approx(e.position.y, 65.0001, 0.001), `陆上 1 格台阶仍瞬抬（y=${e.position.y.toFixed(4)}）`);
  ok(e.position.x > 0.7, `台阶后水平移动保留（x=${e.position.x.toFixed(3)} > 0.7）`);
  ok(e.bodyInWater === false, '陆上场景 bodyInWater = false（走 auto-step 分支）');

  const physSrc = srcOf('../src/player/Physics.js');
  ok(physSrc.includes('!maxBlockTopIsDoor'), '门板禁踏绊线仍在位（B27 语义两分支共用）');
  ok(physSrc.includes('WATER_EXIT_BOOST') && physSrc.includes('WATER_EXIT_VY_GATE'),
    '水中助推常量与下沉门限在位');
  ok(physSrc.includes('_bodyInWater') && physSrc.includes('_yClearAt'),
    '身体浸水判定与顶部空间检查辅助方法在位');
}

// ═══ ④ 氧气原版口径（AirSupply） ═══
{
  ok(AIR_MAX_TICKS === 300, '满氧 300 tick（原版口径）');
  ok(DROWN_INTERVAL === 1.0 && DROWN_DAMAGE === 2, '溺水每 1 秒扣 2 血（原版口径）');

  // ④-a 60fps：恰好 ~900 帧（15 秒）耗尽
  const p1 = { airTicks: 300, drownTimer: 1, health: 20 };
  let frames = 0;
  while (p1.airTicks > 0 && frames < 5000) { updateAirSupply(p1, true, 1 / 60); frames++; }
  ok(frames >= 895 && frames <= 905, `60fps 满氧耗尽 ≈ 900 帧/15 秒（实际 ${frames} 帧）`);
  ok(p1.airTicks === 0, 'airTicks 钳位不为负');

  // ④-b 耗尽后每秒 2 血：再潜 3.4 秒 → 3 次伤害 → 20-6=14
  for (let f = 0; f < Math.round(3.4 * 60); f++) updateAirSupply(p1, true, 1 / 60);
  ok(p1.health === 14, `溺水伤害节奏（health=${p1.health}，期望 14 = 20 - 3×2）`);

  // ④-c 帧率无关：30fps 同样 15 秒耗尽
  const p2 = { airTicks: 300, drownTimer: 1, health: 20 };
  let f2 = 0;
  while (p2.airTicks > 0 && f2 < 5000) { updateAirSupply(p2, true, 1 / 30); f2++; }
  const seconds = f2 / 30;
  ok(seconds >= 14.5 && seconds <= 15.5, `30fps 耗尽同为 15 秒（实际 ${seconds.toFixed(2)} 秒）`);

  // ④-d 出水回氧：约 0.5 秒回满，溺水计时复位
  const p3 = { airTicks: 100, drownTimer: 0.2, health: 8 };
  for (let f = 0; f < 30; f++) updateAirSupply(p3, false, 1 / 60); // 0.5 秒
  ok(p3.airTicks === 300, `出水 0.5 秒回满（airTicks=${p3.airTicks}）`);
  ok(p3.drownTimer === 1, '出水复位溺水计时器');
  ok(p3.health === 8, '回血不受氧气结算影响');

  // ④-e 血量下限钳位
  const p4 = { airTicks: 0, drownTimer: 0.01, health: 1 };
  updateAirSupply(p4, true, 1 / 60);
  ok(p4.health === 0, `血量钳位到 0（health=${p4.health}）`);
}

// ═══ ⑤ 接线绊线 ═══
{
  const gameSrc = srcOf('../src/player/Game.js');
  ok(gameSrc.includes('updateAirSupply(p, p.inWater, dt)'), 'Game._updateWaterState 走 updateAirSupply 纯函数');
  ok(gameSrc.includes('_updateWaterState(dt)'), '氧气结算按 dt 折算（帧率无关）');
  ok(!gameSrc.includes('p.airTicks -= 1'), '旧逐帧 -1 耗氧逻辑已删除（60fps 下仅 5 秒的旧口径）');
  ok(gameSrc.includes('this.player.drownTimer = 1'), '存档加载复位溺水计时器');

  const playerSrc = srcOf('../src/player/Player.js');
  ok(playerSrc.includes('this.drownTimer = 1'), 'Player.drownTimer 字段在位');
  ok(playerSrc.includes('this.airTicks = 300'), 'Player 满氧 300 tick 在位');

  const hudSrc = srcOf('../src/ui/Hud.js');
  ok(hudSrc.includes('(player.airTicks / 300) * 10'), 'Hud 氧气泡公式仍以 300 为满（10 泡）');

  const saveSrc = srcOf('../src/core/SaveSystem.js');
  ok(saveSrc.includes('airTicks: game.player.airTicks'), 'SaveSystem 仍持久化 airTicks');

  const airSrc = srcOf('../src/core/AirSupply.js');
  ok(airSrc.includes("entity.airTicks -= dt * 20"), '耗氧按 20 tick/s 折算');
  ok(airSrc.includes('AIR_REGEN_PER_SEC'), '回氧速度常量在位');
}

console.log(`build30-water-exit-air: ${passed} assertions passed`);
