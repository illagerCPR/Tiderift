// build48-bed-door.mjs -- B48 轮 1 回归：村庄双格床 + 开门可通行（纯 node，不依赖服务器）
// 断言：
//   ① 村庄床成对：每个 bed_foot 都有同朝向、同 baseBlock 的相邻 bed_head（3 个 seed），
//     头尾数量相等，且床格没有被后续陈设覆盖（blocks 数组同格最后一次写入必须是床）
//   ② 注册面：16 个开门态 passable=true / 16 个关门态 false，活板门不受影响，solid 全部保持 true
//   ③ 碰撞面：村庄真实门洞里关门挡人、开门可过；可用横向窗口 ≥ 0.38（旧实现 0.2125，被门板吃掉）
//   ④ 小台阶：autoJump=false 时 1/16 门槛仍可踏越、整格台阶仍被挡（B42 语义不回退）
//   ⑤ 实体物理同口径（村民/僵尸走 EntityPhysics 也能过开门）
//   ⑥ 源码绊线：passable 白名单 / 两套物理跳过 / SMALL_STEP 常量 / 村庄双写床
import { readFileSync } from 'fs';
import { World } from '../src/core/World.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import '../src/blocks/BlockDefs.js';
import { solveVillage } from '../src/world/structures/village.js';
import { Physics } from '../src/player/Physics.js';
import { EntityPhysics } from '../src/entity/EntityPhysics.js';
import { RedstoneSystem } from '../src/core/RedstoneSystem.js';
import { doorId } from '../src/core/blockShape.js';
import { ok, finish } from './harness.mjs';

function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
const DIRS = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
const makeRng = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; };
const mockGen = { getBaseHeight: () => 64, getBiome: () => 0 };

// ── ① 村庄床成对 ──
{
  let totalPairs = 0;
  for (const seed of [20200303, 777, 424242]) {
    const v = solveVillage(makeRng(seed), 0, 64, 0, mockGen);
    const feet = v.blocks.filter(([, , , id]) => BlockRegistry.getById(id)?.part === 'bed_foot');
    const heads = v.blocks.filter(([, , , id]) => BlockRegistry.getById(id)?.part === 'bed_head');
    ok(feet.length > 0, `seed ${seed} 有床（${feet.length} 张）`);
    ok(feet.length === heads.length, `seed ${seed} 床头床尾数量相等（${feet.length}/${heads.length}）`);
    let pairs = 0;
    for (const [x, y, z, id] of feet) {
      const def = BlockRegistry.getById(id);
      const [dx, dz] = DIRS[def.facing] || [0, 0];
      const head = heads.find(([hx, hy, hz]) => hx === x + dx && hy === y && hz === z + dz);
      ok(!!head, `seed ${seed} 床尾 (${x},${y},${z}) facing=${def.facing} 有相邻床头`);
      const hdef = BlockRegistry.getById(head[3]);
      ok(hdef.facing === def.facing && hdef.baseBlock === def.baseBlock, '床头与床尾同朝向同家族');
      pairs++;
    }
    totalPairs += pairs;

    // 同格最后写入者必须是床：防止床格被箱子/工作台/火把覆盖成"半张床"
    const lastAt = new Map();
    for (const [x, y, z, id] of v.blocks) lastAt.set(`${x},${y},${z}`, id);
    for (const [x, y, z, id] of [...feet, ...heads]) {
      const last = lastAt.get(`${x},${y},${z}`);
      const d = BlockRegistry.getById(last);
      ok(last === id && (d.part === 'bed_foot' || d.part === 'bed_head'),
        `床格 (${x},${y},${z}) 未被其它陈设覆盖（最后写入 ${d?.name}）`);
    }
  }
  ok(totalPairs >= 6, `三个 seed 合计床对数 ${totalPairs}（≥6）`);
}

// ── ② 注册面：passable 只在开门态 ──
{
  const doors = BlockRegistry.all().filter((b) => b.part === 'door_lower' || b.part === 'door_upper');
  const openDoors = doors.filter((b) => b.open);
  const closedDoors = doors.filter((b) => !b.open);
  ok(doors.length === 32, `门状态 32 个（当前 ${doors.length}）`);
  ok(openDoors.length === 16 && openDoors.every((b) => b.passable === true),
    '16 个开门态全部 passable=true');
  ok(closedDoors.length === 16 && closedDoors.every((b) => b.passable === false),
    '16 个关门态全部 passable=false（关门照旧挡人）');
  ok(doors.every((b) => b.solid === true), '门家族 solid 保持 true（渲染/剔除/光照/选取不受影响）');
  const traps = BlockRegistry.all().filter((b) => b.part === 'trapdoor');
  ok(traps.length === 8 && traps.every((b) => b.passable === false), '活板门 8 态都不受 passable 影响');
  ok(doors.every((b) => !!b.shape), '门仍带格内 shape（渲染 addBox 与关门碰撞同源）');
}

// ── 村庄平铺：把布局铺进抹平的世界（真实村庄方块，不掺地形）──
const STONE = BlockRegistry.getId('stone');
function flatVillageWorld() {
  const v = solveVillage(makeRng(20200303), 0, 64, 0, mockGen);
  const world = new World(20250903);
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) world.ensureChunk(cx, cz);
  for (let x = -48; x <= 48; x++) for (let z = -48; z <= 48; z++) {
    for (let y = 60; y <= 75; y++) world.setBlock(x, y, z, y <= 63 ? STONE : 0, false);
  }
  for (const [x, y, z, id] of v.blocks) world.setBlock(x, y, z, id, false);
  return { world, v };
}

// ── ③ 碰撞面：村庄门洞 ──
{
  const { world, v } = flatVillageWorld();
  const house = v.meta.houses[0];
  const [dx, dz] = house.door;
  const gy = house.groundY;
  const rs = new RedstoneSystem(world);
  const isOpenState = (x, y, z) => !!BlockRegistry.getById(world.getBlock(x, y, z))?.open;

  const phys = new Physics(world);
  const mk = (x, y, z, vz) => ({
    position: { x, y, z }, velocity: { x: 0, y: 0, z: vz },
    onGround: true, flying: false, gliding: false, spectator: false, inWater: false,
  });
  // 门外 → 门内（门朝 z-，门外在 z-1；脚踩草径顶面 15/16）
  const walk = (startX, frames = 120) => {
    const e = mk(startX, gy + 1 - 1 / 16, dz - 1.5, 4.3);
    for (let i = 0; i < frames; i++) { phys.collide(e, 1 / 60); e.velocity.z = 4.3; }
    return e;
  };

  // 关门：挡在门外
  const closed = walk(dx + 0.5);
  ok(!isOpenState(dx, gy + 1, dz), '门初始为关态');
  ok(closed.position.z < dz - 0.2, `关门挡人（停在 z=${closed.position.z.toFixed(3)}）`);

  // 开门：整段门洞里可用窗口 ≥ 0.38（旧实现只有 0.2125，且 11.5 只剩 1.25cm 余量）
  rs.toggleDoor(dx, gy + 1, dz);
  ok(isOpenState(dx, gy + 1, dz) && isOpenState(dx, gy + 2, dz), '整扇门切到开态（上下半同步）');
  let lo = Infinity, hi = -Infinity;
  for (let x = dx + 0.02; x <= dx + 0.98; x += 0.01) {
    const e = walk(x, 150);
    if (e.position.z > dz + 1.5) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  }
  const window = hi - lo;
  ok(window >= 0.38, `开门通行窗口 ${window.toFixed(3)}m（≥0.38；旧实现 0.2125）`);
  ok(lo < dx + 0.45 && hi > dx + 0.55, `窗口覆盖门格中线（${lo.toFixed(2)}~${hi.toFixed(2)}）`);

  // 门内 → 门外（回程同样可过）
  const e2 = mk(dx + 0.5, gy + 1, dz + 2.5, -4.3);
  for (let i = 0; i < 150; i++) { phys.collide(e2, 1 / 60); e2.velocity.z = -4.3; }
  ok(e2.position.z < dz - 0.5, `开门可从屋内出来（z=${e2.position.z.toFixed(3)}）`);

  // ⑤ 实体物理同口径：等高的走廊里，开门可过 / 关门挡人（EntityPhysics 无 auto-step，
  //    所以用平地面走廊而不是起伏的村庄内部）
  const corridor = () => {
    const w = new World(4321);
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.ensureChunk(cx, cz);
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
      for (let y = 60; y <= 70; y++) w.setBlock(x, y, z, y <= 63 ? STONE : 0, false);
    }
    for (let x = -4; x <= 4; x++) for (let y = 64; y <= 65; y++) w.setBlock(x, y, 0, STONE, false);
    w.setBlock(0, 64, 0, doorId('oak_door', 'lower', 'n', false), false);
    w.setBlock(0, 65, 0, doorId('oak_door', 'upper', 'n', false), false);
    return w;
  };
  const runMob = (w) => {
    const ep = new EntityPhysics(w);
    const mob = {
      position: { x: 0.5, y: 64.001, z: -1.5 }, velocity: { x: 0, y: 0, z: 4.3 },
      half: 0.3, height: 1.9, onGround: true, flying: false, noClip: false, dead: false,
    };
    for (let i = 0; i < 120; i++) { mob.velocity.z = 4.3; ep.collide(mob, 1 / 60); }
    return mob;
  };
  const wc = corridor();
  const mobClosed = runMob(wc);
  ok(mobClosed.position.z < -0.2, `实体物理：关门挡人（z=${mobClosed.position.z.toFixed(3)}）`);
  wc.setBlock(0, 64, 0, doorId('oak_door', 'lower', 'n', true), false);
  wc.setBlock(0, 65, 0, doorId('oak_door', 'upper', 'n', true), false);
  const mobOpen = runMob(wc);
  ok(mobOpen.position.z > 0.6, `实体物理：开门可过（z=${mobOpen.position.z.toFixed(3)}）`);
}

// ── ④ 小台阶：autoJump=false 时的 1/16 门槛与整格台阶 ──
{
  const { world, v } = flatVillageWorld();
  const house = v.meta.houses[0];
  const [dx, dz] = house.door;
  const gy = house.groundY;
  const rs = new RedstoneSystem(world);
  rs.toggleDoor(dx, gy + 1, dz);
  const phys = new Physics(world);
  phys.autoJump = false;
  const e = {
    position: { x: dx + 0.5, y: gy + 1 - 1 / 16, z: dz - 1.5 }, velocity: { x: 0, y: 0, z: 4.3 },
    onGround: true, flying: false, gliding: false, spectator: false, inWater: false,
  };
  for (let i = 0; i < 150; i++) { phys.collide(e, 1 / 60); e.velocity.z = 4.3; }
  ok(e.position.z > dz + 1.0, `关掉自动跳跃也能迈过 1/16 门槛进门（z=${e.position.z.toFixed(3)}）`);
  ok(Math.abs(e.position.y - (gy + 1)) < 0.02, `站在木地板高度（y=${e.position.y.toFixed(3)}）`);

  // 整格台阶仍受开关门控（B42 语义不回退）
  const w2 = new World(999);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w2.ensureChunk(cx, cz);
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
    for (let y = 60; y <= 68; y++) w2.setBlock(x, y, z, y <= 63 ? STONE : 0, false);
  }
  for (let z = 0; z <= 3; z++) for (let x = -4; x <= 4; x++) w2.setBlock(x, 64, z, STONE, false);
  const step = (auto) => {
    const p = new Physics(w2); p.autoJump = auto;
    const ent = {
      position: { x: 0.5, y: 64, z: -2.5 }, velocity: { x: 0, y: 0, z: 4.3 },
      onGround: true, flying: false, gliding: false, spectator: false, inWater: false,
    };
    for (let i = 0; i < 60; i++) { p.collide(ent, 1 / 60); ent.velocity.z = 4.3; }
    return ent;
  };
  ok(step(true).position.y > 64.9, 'autoJump=true：整格台阶照旧踏越');
  const off = step(false);
  ok(off.position.y < 64.05 && off.position.z < -0.2, `autoJump=false：整格台阶仍被挡（y=${off.position.y.toFixed(3)}）`);
}

// ── ⑥ 源码绊线 ──
{
  const vil = srcOf('../src/world/structures/village.js');
  ok(vil.includes("bedId('head', 's')") && vil.includes("bedId('foot', 's')"), '村庄床头尾双写');
  ok(!/setAt\([^)]*ID\.bed\)/.test(vil), '旧的单格 ID.bed 写法已退场');

  const bd = srcOf('../src/blocks/BlockDefs.js');
  ok(bd.includes('passable: open'), '开门态由 open 派生 passable');

  const reg = srcOf('../src/core/BlockRegistry.js');
  ok(reg.includes('passable: def.passable ?? false'), 'passable 进 BlockRegistry 白名单');

  const phy = srcOf('../src/player/Physics.js');
  ok(phy.includes('if (def.passable) continue;'), 'Physics：碰撞循环跳过 passable');
  ok(phy.includes('const SMALL_STEP = 0.6;'), 'Physics：原版步高常量存在');
  ok(phy.includes('smallStep || entity.isMob || this.autoJump'), '小台阶不受自动跳跃开关门控');
  ok((phy.match(/if \(def\.passable\) continue;/g) || []).length >= 2,
    'Physics 的 moveAxis 与 _yClearAt 都跳过 passable（两处）');

  const ephy = srcOf('../src/entity/EntityPhysics.js');
  ok(ephy.includes('if (def.passable) continue;'), 'EntityPhysics 同口径跳过 passable');
}
finish('build48-bed-door');
