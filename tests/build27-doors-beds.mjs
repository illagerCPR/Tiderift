// build27-doors-beds.mjs -- Build 27 床/门形制批次回归（node 直跑，无需服务器）
// 断言：
//   ① 注册家族：门 32 状态/活板门 8/床 8，base 名保留旧语义（旧存档零迁移），
//     shape/part/facing/open/baseBlock 六字段白名单透传（B26 fluidType 同款陷阱防线）
//   ② 行为级：id 往返、红石整扇切换（废除删除式）、旧存档单格门加载迁移、村庄门全部配对带朝向
//   ③ 几何级：门板 3/16 贴边、开门旋转贴邻边、床顶 9/16（addBox 顶点）
//   ④ 碰撞级：关门挡人/开门可过/床 9/16 auto-jump 直接走上
//   ⑤ 睡眠：源码绊线（怪物检查/黑屏过渡/维度爆炸/respawn 校验）+ en 翻译键
import { readFileSync } from 'fs';
import { World } from '../src/core/World.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import '../src/blocks/BlockDefs.js';
import { RedstoneSystem } from '../src/core/RedstoneSystem.js';
import { doorId, trapdoorId, bedId, cellBox, DOOR_THICK, BED_HEIGHT } from '../src/core/blockShape.js';
import { solveVillage } from '../src/world/structures/village.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
function near(a, b, eps = 1e-4) { return Math.abs(a - b) < eps; }

// ── ① 注册家族与白名单透传 ──
{
  const all = BlockRegistry.all();
  const doors = all.filter((b) => b.part === 'door_lower' || b.part === 'door_upper');
  const trapdoors = all.filter((b) => b.part === 'trapdoor');
  const beds = all.filter((b) => b.part === 'bed_foot' || b.part === 'bed_head');
  ok(doors.length === 32, `门状态 32 个（两材质 ×2 半 ×4 朝向 ×开合，当前 ${doors.length}）`);
  ok(trapdoors.length === 8, `活板门状态 8 个（当前 ${trapdoors.length}）`);
  ok(beds.length === 8, `床状态 8 个（头尾 ×4 朝向，当前 ${beds.length}）`);

  // base 名保留旧语义（旧存档/旧账本零迁移）
  const baseDoor = BlockRegistry.getById(BlockRegistry.getId('oak_door'));
  ok(baseDoor.part === 'door_lower' && baseDoor.facing === 'n' && baseDoor.open === false,
    'oak_door 本名 = 下半/朝北/关态');
  ok(baseDoor.solid === true && baseDoor.shape, 'oak_door 有碰撞且带 shape（旧版 solid:false 废除）');
  const baseBed = BlockRegistry.getById(BlockRegistry.getId('white_bed'));
  ok(baseBed.part === 'bed_foot' && baseBed.facing === 'n', 'white_bed 本名 = 床尾/朝北');
  const baseTrap = BlockRegistry.getById(BlockRegistry.getId('oak_trapdoor'));
  ok(baseTrap.part === 'trapdoor' && baseTrap.open === false, 'oak_trapdoor 本名 = 关态');

  // 白名单透传（B26 fluidType 陷阱同款防线：六个新字段逐一体检）
  const ironOpen = BlockRegistry.getById(doorId('iron_door', 'upper', 'w', true));
  ok(ironOpen.shape && near(ironOpen.shape.from[0], 0) && near(ironOpen.shape.to[2], DOOR_THICK),
    '铁门开态 shape 透传且几何正确（w 朝向开贴北缘）');
  ok(ironOpen.baseBlock === 'iron_door' && ironOpen.tool === 'pickaxe', 'baseBlock/tool 白名单透传');
  const bedHead = BlockRegistry.getById(bedId('head', 'e'));
  ok(bedHead.shape && near(bedHead.shape.to[1], BED_HEIGHT) && bedHead.top === 'white_bed_head_top',
    '床头 shape（9/16 高）与顶面纹理键透传');
  const trapOpen = BlockRegistry.getById(trapdoorId('e', true));
  ok(trapOpen.shape && near(trapOpen.shape.from[0], 1 - DOOR_THICK) && near(trapOpen.shape.to[1], 1),
    '活板门开态 shape 透传（竖板贴东缘）');
  ok(BlockSVGDefinitions && BlockSVGDefinitions.white_bed !== undefined, '床物品栏 SVG 键保留');

  // id 往返
  ok(doorId('oak_door', 'lower', 'n', false) === BlockRegistry.getId('oak_door'), 'doorId 关态朝北下半 = 本名');
  ok(bedId('foot', 'n') === BlockRegistry.getId('white_bed'), 'bedId 床尾朝北 = 本名');
  ok(doorId('oak_door', 'lower', 's', false) === BlockRegistry.getId('oak_door_lower_s'), 'doorId 关态朝南 = 后缀名');
}

// ── ② 行为级：红石整扇切换 / 旧存档迁移 / 村庄门 ──
{
  const world = new World(20250903);
  world.ensureChunk(0, 0);
  const rs = new RedstoneSystem(world);
  world.setBlock(3, 101, 3, doorId('oak_door', 'lower', 'n', false), false);
  world.setBlock(3, 102, 3, doorId('oak_door', 'upper', 'n', false), false);
  ok(rs.toggleDoor(3, 101, 3), 'toggleDoor 从下半触发成功');
  ok(world.getBlock(3, 101, 3) === doorId('oak_door', 'lower', 'n', true) &&
     world.getBlock(3, 102, 3) === doorId('oak_door', 'upper', 'n', true),
    '整扇切换：上下半同步到开态（不再删除方块）');
  ok(rs.toggleDoor(3, 102, 3), 'toggleDoor 从上半触发成功');
  ok(world.getBlock(3, 101, 3) === BlockRegistry.getId('oak_door'), '回切到关态（上半调用同样整扇）');

  world.setBlock(4, 101, 3, trapdoorId('s', false), false);
  rs.toggleDoor(4, 101, 3);
  ok(world.getBlock(4, 101, 3) === trapdoorId('s', true), '活板门切换到开态');
  rs.toggleDoor(4, 101, 3);
  ok(world.getBlock(4, 101, 3) === trapdoorId('s', false), '活板门切回关态');

  // 旧存档迁移：旧式单格门 → finalize 补上半（幂等）
  world.setBlock(6, 101, 6, BlockRegistry.getId('oak_door'), false);
  const c = world.chunks.get('0,0');
  world._finalizeChunk(c);
  ok(world.getBlock(6, 102, 6) === BlockRegistry.getId('oak_door_upper'), '旧存档单格门加载时补齐上半');
  world._finalizeChunk(c);
  ok(BlockRegistry.getById(world.getBlock(6, 102, 6)).part === 'door_upper', '迁移幂等（重复 finalize 不产生异常态）');
}

// 村庄：所有门配对 + 朝向合法（face → 面板贴外墙面）
{
  const mockGen = { getBaseHeight: () => 64, getBiome: () => 0 };
  const makeRng = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; };
  for (const seed of [20200303, 777, 424242]) {
    const v = solveVillage(makeRng(seed), 0, 64, 0, mockGen);
    const cells = new Map();
    for (const [x, y, z, id] of v.blocks) {
      const d = BlockRegistry.getById(id);
      if (d && (d.part === 'door_lower' || d.part === 'door_upper')) cells.set(`${x},${y},${z}`, d);
    }
    ok(cells.size > 0, `村庄 seed${seed} 有门`);
    let lower = 0;
    for (const [k, d] of cells) {
      if (d.part !== 'door_lower') continue;
      lower++;
      const [x, y, z] = k.split(',').map(Number);
      const up = cells.get(`${x},${y + 1},${z}`);
      ok(!!up && up.part === 'door_upper' && up.facing === d.facing && up.baseBlock === d.baseBlock,
        `村庄门配对（${k} facing=${d.facing}）`);
      ok(['n', 's', 'e', 'w'].includes(d.facing), '村庄门朝向为四向合法值');
    }
    ok(lower > 0, `村庄 seed${seed} 下半门 ${lower} 扇`);
  }
}

// ── ③ 几何级：addBox 顶点 ──
{
  const { ChunkMeshBuilder } = await import('../src/render/ChunkMesh.js');
  const THREE = await import('three');
  const world = new World(20250903);
  world.ensureChunk(0, 0);
  for (let dx = -1; dx <= 16; dx++) for (let dz = -1; dz <= 16; dz++) {
    world.setBlock(dx, 100, dz, BlockRegistry.getId('stone'), false);
  }
  // 关门朝北 @ (5,101,5) + 开门同向 @ (6,101,5) + 床（尾 s 头 n）@ (9,101,5)/(9,101,4)
  world.setBlock(5, 101, 5, doorId('oak_door', 'lower', 'n', false), false);
  world.setBlock(6, 101, 5, doorId('oak_door', 'lower', 'n', true), false);
  world.setBlock(9, 101, 5, bedId('foot', 'n'), false);
  world.setBlock(9, 101, 4, bedId('head', 'n'), false);
  const builder = new ChunkMeshBuilder(world, new THREE.Texture(), new Map(), new THREE.Texture());
  const c = world.ensureChunk(0, 0);
  builder._fillCache(c); builder._fillLightCaches(c); builder._refreshOpaqueLUT();
  const out = builder._collectData(c);
  ok(!!out.solid, 'solid 几何存在');
  const p = out.solid.position;
  let closedZmax = -1, openZmin = 99, openXmax = -1, bedTop = -1, doorTop = -1;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x >= 5 && x <= 6 && z >= 5 && z <= 5.2 && y >= 101 && y <= 102) {
      closedZmax = Math.max(closedZmax, z); doorTop = Math.max(doorTop, y);
    }
    if (x >= 6 && x <= 6.2 && z >= 5 && z <= 6 && y >= 101 && y <= 102) {
      openXmax = Math.max(openXmax, x); openZmin = Math.min(openZmin, z);
    }
    if (x >= 9 && x <= 10 && z >= 4 && z <= 6 && y >= 101 && y <= 101.9) bedTop = Math.max(bedTop, y);
  }
  ok(near(closedZmax - 5, DOOR_THICK, 2e-3), `关门面板厚 3/16（实测 ${closedZmax - 5}）`);
  ok(near(doorTop, 102, 2e-3), '门下半满格高（顶点触 y+1）');
  ok(near(openXmax - 6, DOOR_THICK, 2e-3) && openZmin >= 5 && openZmin < 5.01,
    `开门面板旋转贴西缘（xmax-6=${openXmax - 6}, zmin=${openZmin}）`);
  ok(near(bedTop - 101, BED_HEIGHT, 2e-3), `床顶 9/16（实测 ${bedTop - 101}）`);
}

// ── ④ 碰撞级 ──
{
  const { Physics } = await import('../src/player/Physics.js');
  const world = new World(20250903);
  world.ensureChunk(0, 0);
  const S = BlockRegistry.getId('stone');
  for (let x = 2; x <= 8; x++) for (let z = -6; z <= 8; z++) world.setBlock(x, 100, z, S, false);
  world.setBlock(5, 101, 5, doorId('oak_door', 'lower', 'n', false), false);
  world.setBlock(5, 102, 5, doorId('oak_door', 'upper', 'n', false), false);
  const phys = new Physics(world);
  const mk = () => ({ position: { x: 5.5, y: 101, z: 7.5 }, velocity: { x: 0, y: 0, z: 0 }, half: 0.3, height: 1.8, onGround: false, gliding: false });

  const p1 = mk();
  for (let i = 0; i < 120; i++) phys.moveAxis(p1, 'z', -4 / 60, 0.3, 1.8);
  ok(p1.position.z > 5.2 && p1.position.z < 6, `关门挡人（停在 ${p1.position.z.toFixed(3)}）`);

  world.setBlock(5, 101, 5, doorId('oak_door', 'lower', 'n', true), false);
  world.setBlock(5, 102, 5, doorId('oak_door', 'upper', 'n', true), false);
  const p2 = mk();
  for (let i = 0; i < 120; i++) phys.moveAxis(p2, 'z', -4 / 60, 0.3, 1.8);
  ok(p2.position.z < 4.9, `开门可过门格（穿到 ${p2.position.z.toFixed(3)}）`);

  world.setBlock(5, 101, 5, BlockRegistry.getId('oak_door'), false);
  world.setBlock(5, 102, 5, BlockRegistry.getId('oak_door_upper'), false);
  world.setBlock(7, 101, 5, bedId('foot', 'n'), false);
  world.setBlock(7, 101, 4, bedId('head', 'n'), false);
  const p3 = mk(); p3.position.x = 7.5; p3.position.z = 7.5;
  for (let i = 0; i < 120; i++) phys.moveAxis(p3, 'z', -4 / 60, 0.3, 1.8);
  ok(near(p3.position.y, 101 + BED_HEIGHT, 2e-3), `auto-jump 直接走上床（y=${p3.position.y.toFixed(4)}）`);

  // cellBox 换算
  const d = BlockRegistry.getById(BlockRegistry.getId('oak_door'));
  const box = cellBox(d, 10, 20, 30);
  ok(near(box[5] - 30, DOOR_THICK) && near(box[4] - 20, 1), 'cellBox → 世界坐标 AABB');
  ok(cellBox(BlockRegistry.getById(S), 0, 0, 0) === null, '无 shape 方块 cellBox = null（满格路径）');
}

// ── ⑤ 睡眠与形制交互源码绊线 ──
{
  const gm = srcOf('../src/player/Game.js');
  ok(gm.includes("this.world.dimension !== 'overworld'") && gm.includes("pendingExplosions.push"), '床：非主世界引爆（爆炸粒子出口）');
  ok(gm.includes('this._hostileNearby(8)'), '床：8 格敌对怪拒绝入睡');
  ok(gm.includes('this.sleepOverlay.show('), '床：黑屏过渡跳时间（废除瞬跳）');
  ok(gm.includes("bedDef.part === 'bed_foot' || bedDef.part === 'bed_head'"), 'respawn：床失效校验');
  ok(gm.includes('this._removeShapedPartner(def,'), '破坏：门/床任一半连动另一半');
  ok(gm.includes('this._tryPlaceShaped(placeX, placeY, placeZ, blockDef)'), '放置：形制多格分支');
  ok(gm.includes("furnaceDef.part === 'door_lower' || furnaceDef.part === 'door_upper' || furnaceDef.part === 'trapdoor'"), '右键：门/活板门开关分支');
  ok(gm.includes('doorId(blockDef.baseBlock'), '放置：门用状态 id 家族');

  const rsSrc = srcOf('../src/core/RedstoneSystem.js');
  ok(rsSrc.includes('setDoorOpen(x, y, z, !def.open)'), '红石：整扇切换');
  ok(!rsSrc.includes('直接移除门方块'), '红石：删除式开门已废除');

  const reg = srcOf('../src/core/BlockRegistry.js');
  for (const field of ['shape', 'part', 'open', 'baseBlock']) {
    ok(reg.includes(`${field}: def.${field}`), `BlockRegistry 白名单透传 ${field}`);
  }
  // B28：facing 改为"显式 facing 优先，未给但给了 front 时按朝北"的推导（仍是白名单字段）
  ok(reg.includes('const facing = def.facing') && /\bfacing,\n/.test(reg), 'BlockRegistry 白名单透传 facing');
  const wsrc = srcOf('../src/core/World.js');
  ok(wsrc.includes("sDef.part === 'door_lower'"), 'finalize：旧存档单格门迁移扫描');
  const vil = srcOf('../src/world/structures/village.js');
  ok(vil.includes("doorId('oak_door', 'lower', facing, false)"), '村庄：双格门带朝向');

  const en = srcOf('../src/i18n/locales/en.js');
  ok(en.includes("'You may not rest now; there are monsters nearby'"), 'en：怪物邻近提示');
  ok(en.includes("'Beds refuse to rest in this dimension — BOOM!'"), 'en：维度爆炸提示');
  ok(en.includes("'Your bed is missing or was lost. Returning to world spawn'"), 'en：床失效提示');
}

console.log(`build27-doors-beds: ${passed} assertions passed`);
