// Portals 逻辑单测（node 直跑，无需服务器）：假 World 内存方块表验证框校验/填充/拆门/建门/搜门
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import '../src/blocks/BlockDefs.js';
import {
  detectPortalInterior, fillPortal, findPortalNear, buildReturnPortal, removeConnectedPortals,
  detectEndRing, fillEndPortalCenter, buildEndReturnPad, findOpenFloorY,
} from '../src/core/Portals.js';
import { matchRecipe } from '../src/core/Crafting.js';
import '../src/items/ItemDefs.js';
import { assert, finish } from './harness.mjs';

function fakeWorld() {
  const blocks = new Map();
  const ledger = new Map();
  const k = (x, y, z) => `${x},${y},${z}`;
  return {
    blocks, modifiedBlocks: ledger,
    getBlock(x, y, z) { return blocks.get(k(x, y, z)) || 0; },
    setBlock(x, y, z, id) {
      blocks.set(k(x, y, z), id);
      if (id === 0) blocks.delete(k(x, y, z));
      ledger.set(k(x, y, z), id);
    },
    findGroundY(x, z, top = 254) {
      for (let y = Math.min(top, 254); y >= 1; y--) {
        const def = BlockRegistry.getById(this.getBlock(x, y, z));
        if (def && def.solid) return y + 1;
      }
      return -1;
    },
  };
}

const OBS = BlockRegistry.getId('obsidian');
const GLOW = BlockRegistry.getId('glowstone');
const NP = BlockRegistry.getId('nether_portal');
const AP = BlockRegistry.getId('aether_portal');

// ── ① x/y 平面 4×5 框（内 2×3）──
{
  const w = fakeWorld();
  // 底/顶行
  for (let x = 0; x < 4; x++) { w.setBlock(x, 0, 0, OBS); w.setBlock(x, 4, 0, OBS); }
  // 左右柱
  for (let y = 1; y <= 3; y++) { w.setBlock(0, y, 0, OBS); w.setBlock(3, y, 0, OBS); }
  const det = detectPortalInterior(w, 1, 1, 0, OBS);
  assert('① x 平面框校验通过', !!det && det.axis === 'x' && det.cells.length === 6);
  fillPortal(w, det, NP);
  assert('① 填充后 6 内格全为 nether_portal',
    [[1, 1], [2, 1], [1, 2], [2, 2], [1, 3], [2, 3]].every(([x, y]) => w.getBlock(x, y, 0) === NP));
}

// ── ② z/y 平面框 ──
{
  const w = fakeWorld();
  for (let z = 0; z < 4; z++) { w.setBlock(0, 10, z, OBS); w.setBlock(0, 14, z, OBS); }
  for (let y = 11; y <= 13; y++) { w.setBlock(0, y, 0, OBS); w.setBlock(0, y, 3, OBS); }
  const det = detectPortalInterior(w, 0, 11, 1, OBS);
  assert('② z 平面框校验通过', !!det && det.axis === 'z' && det.cells.length === 6);
}

// ── ③ 缺口框拒绝 ──
{
  const w = fakeWorld();
  for (let x = 0; x < 4; x++) { w.setBlock(x, 0, 0, OBS); w.setBlock(x, 4, 0, OBS); }
  for (let y = 1; y <= 3; y++) { w.setBlock(0, y, 0, OBS); } // 右柱缺失
  const det = detectPortalInterior(w, 1, 1, 0, OBS);
  assert('③ 右柱缺失 → 校验拒绝', det === null);
}

// ── ④ 荧石框（天域门）──
{
  const w = fakeWorld();
  for (let x = 5; x < 9; x++) { w.setBlock(x, 0, 0, GLOW); w.setBlock(x, 4, 0, GLOW); }
  for (let y = 1; y <= 3; y++) { w.setBlock(5, y, 0, GLOW); w.setBlock(8, y, 0, GLOW); }
  const det = detectPortalInterior(w, 6, 2, 0, GLOW);
  assert('④ 荧石框校验通过（从中间行探测）', !!det && det.cells.length === 6);
  fillPortal(w, det, AP);
  assert('④ 天域门方块填充正确', w.getBlock(6, 2, 0) === AP);
}

// ── ⑤ 大框（3×4 内）也能识别 ──
{
  const w = fakeWorld();
  for (let x = 0; x < 5; x++) { w.setBlock(x, 0, 0, OBS); w.setBlock(x, 5, 0, OBS); }
  for (let y = 1; y <= 4; y++) { w.setBlock(0, y, 0, OBS); w.setBlock(4, y, 0, OBS); }
  const det = detectPortalInterior(w, 1, 1, 0, OBS);
  assert('⑤ 3×4 大内框校验通过', !!det && det.cells.length === 12);
}

// ── ⑥ 拆框洪水清门 ──
{
  const w = fakeWorld();
  for (let x = 0; x < 4; x++) { w.setBlock(x, 0, 0, OBS); w.setBlock(x, 4, 0, OBS); }
  for (let y = 1; y <= 3; y++) { w.setBlock(0, y, 0, OBS); w.setBlock(3, y, 0, OBS); }
  const det = detectPortalInterior(w, 1, 1, 0, OBS);
  fillPortal(w, det, NP);
  assert('⑥ 前置：门已填充', w.getBlock(1, 1, 0) === NP);
  removeConnectedPortals(w, 0, 1, 0); // 打掉左柱一格 → 连通门全清
  const portalLeft = [...w.blocks.values()].filter((id) => id === NP).length;
  assert('⑥ 打掉框柱 → 6 门方块全清', portalLeft === 0);
}

// ── ⑦ 自动返程门（有地面 / 无地面垫平台）──
{
  const w = fakeWorld();
  for (let x = -2; x <= 20; x++) for (let z = -2; z <= 2; z++) w.setBlock(x, 30, z, OBS); // 地板 y30
  const pos = buildReturnPortal(w, 'nether', 10, 0, {});
  assert('⑦ 有地面：门底落在地板上', pos.y === 32 && w.getBlock(10, 31, 0) === OBS && w.getBlock(11, 32, 0) === NP);
  const w2 = fakeWorld(); // 全虚空
  const pos2 = buildReturnPortal(w2, 'aether', 0, 0, { platform: { y: 90, block: 'glowstone' } });
  assert('⑦ 无地面：垫 y90 荧石平台 + 门', pos2.y === 91 && w2.getBlock(-1, 89, 0) === GLOW && w2.getBlock(1, 91, 0) === AP);
}

// ── ⑧ 搜门：账本半径最近 ──
{
  const w = fakeWorld();
  w.setBlock(100, 40, 0, NP);
  w.setBlock(105, 40, 0, NP);
  const near = findPortalNear(w, 101, 0, NP, 24);
  assert('⑧ 半径内最近门命中 (100,40)', !!near && near.x === 100.5 && near.y === 40);
  assert('⑧ 半径外门不命中', findPortalNear(w, 200, 0, NP, 24) === null);
}

// ── ⑨ 末地环检测：5×5 环 11 眼 + 1 框 → eyes=11；缺环位 → null ──
{
  const w = fakeWorld();
  const FRAME = BlockRegistry.getId('end_portal_frame');
  const EYE = BlockRegistry.getId('end_portal_frame_eye');
  const EP = BlockRegistry.getId('end_portal');
  const y = 50;
  for (let ix = 0; ix < 5; ix++) {
    for (let iz = 0; iz < 5; iz++) {
      const corner = (ix === 0 || ix === 4) && (iz === 0 || iz === 4);
      const edge = ix === 0 || ix === 4 || iz === 0 || iz === 4;
      if (!edge || corner) continue;
      w.setBlock(10 + ix, y, 10 + iz, (ix + iz) % 2 === 0 ? EYE : FRAME); // 混合 6/6
    }
  }
  const r1 = detectEndRing(w, 12, y, 10, FRAME, EYE); // 点顶边中格（环位）
  assert('⑨ 混合环检出：eyes+frames=12', !!r1 && r1.eyes + r1.frames === 12 && r1.y === y);
  const r1b = detectEndRing(w, 14, y, 12, FRAME, EYE); // 点远边格（窗口原点偏移 -4 场景）
  assert('⑨ 远边格点击同样检出', !!r1b && r1b.eyes + r1b.frames === 12);
  assert('⑨ 非环位点击 → null', detectEndRing(w, 12, y, 12, FRAME, EYE) === null); // 中心格
  // 补齐全部 12 眼 → eyes=12
  for (let ix = 0; ix < 5; ix++) {
    for (let iz = 0; iz < 5; iz++) {
      const corner = (ix === 0 || ix === 4) && (iz === 0 || iz === 4);
      const edge = ix === 0 || ix === 4 || iz === 0 || iz === 4;
      if (edge && !corner) w.setBlock(10 + ix, y, 10 + iz, EYE);
    }
  }
  const r2 = detectEndRing(w, 12, y, 10, FRAME, EYE);
  assert('⑨ 12 眼齐：eyes=12', !!r2 && r2.eyes === 12);
  // 激活：中心 3×3 填门体
  fillEndPortalCenter(w, r2, EP);
  const centerAll = [];
  for (let ix = 1; ix <= 3; ix++) for (let iz = 1; iz <= 3; iz++) centerAll.push(w.getBlock(10 + ix, y, 10 + iz));
  assert('⑨ 激活后中心 3×3 = end_portal', centerAll.every(c => c === EP));
  // 已激活环（中心非空气）不再被检出 → 不会重复激活
  assert('⑨ 已激活环不再检出', detectEndRing(w, 12, y, 10, FRAME, EYE) === null);
}

// ── ⑩ 末地回程垫：立地面/垫平台 ──
{
  const w = fakeWorld();
  for (let x = -4; x <= 16; x++) for (let z = -4; z <= 16; z++) w.setBlock(x, 30, z, BlockRegistry.getId('end_stone'));
  const pos = buildEndReturnPad(w, 0, 0, { top: 140, platformY: 64 });
  const EP = BlockRegistry.getId('end_portal');
  const EYE = BlockRegistry.getId('end_portal_frame_eye');
  assert('⑩ 有地面：垫心站位在环心上方', pos.x === 2.5 && pos.y === 32 && pos.z === 2.5);
  assert('⑩ 垫中心 3×3 = end_portal', [1, 2, 3].every(ix => [1, 2, 3].every(iz => w.getBlock(ix, 31, iz) === EP)));
  assert('⑩ 环 12 格 = frame_eye（激活态）', w.getBlock(0, 31, 2) === EYE && w.getBlock(4, 31, 2) === EYE);
  const w2 = fakeWorld(); // 全虚空
  const pos2 = buildEndReturnPad(w2, 0, 0, { top: 140, platformY: 64 });
  assert('⑩ 无地面：垫 y64 黑曜石台 + 门垫', pos2.y === 65 && w2.getBlock(-1, 63, -1) === BlockRegistry.getId('obsidian'));
}

// ── ⑪ 末地合成链：烈焰棒→2 烈焰粉；烈焰粉+末影珍珠→末影之眼 ──
{
  const p1 = matchRecipe([['blaze_rod']]);
  assert('⑪ 烈焰棒合成 2 烈焰粉', !!p1 && p1.name === 'blaze_powder' && p1.count === 2);
  const p2 = matchRecipe([['blaze_powder'], ['ender_pearl']]);
  assert('⑪ 烈焰粉+末影珍珠合成末影之眼', !!p2 && p2.name === 'ender_eye' && p2.count === 1);
  const p3 = matchRecipe([['ender_pearl'], ['blaze_powder']]);
  assert('⑪ 顺序颠倒不匹配（shaped）', p3 === null);
}

// ── ⑫ 下界寻址：实心岩层内垫平台 + 门厅清空（修复"门嵌进 netherrack 玩家被埋"）──
{
  const w = fakeWorld();
  const NR = BlockRegistry.getId('netherrack');
  for (let y = 1; y <= 199; y++) for (let x = -3; x <= 8; x++) for (let z = -3; z <= 3; z++) w.setBlock(x, y, z, NR);
  const pos = buildReturnPortal(w, 'nether', 0, 0, { top: 200, platform: { y: 40, block: 'obsidian' } });
  assert('⑫ 岩层内垫 y40 平台', pos.y === 41 && w.getBlock(0, 39, 0) === BlockRegistry.getId('obsidian'));
  // 门厅全开（除门框/门体位）：站位格非实心、门厅圈无 netherrack 残留
  const solidAt = (x, y, z) => { const d = BlockRegistry.getById(w.getBlock(x, y, z)); return !!(d && d.solid); };
  assert('⑫ 站位格与头部格非实心', !solidAt(1, 41, 0) && !solidAt(1, 42, 0));
  let buried = 0;
  for (let x = -1; x <= 4; x++) for (let z = -1; z <= 1; z++) {
    for (let y = 40; y <= 45; y++) {
      const id = w.getBlock(x, y, z);
      if (id === NR) buried++;
    }
  }
  assert('⑫ 门厅 6×7×3 无岩层残留', buried === 0);
  assert('⑫ 门框立起（底行框+左柱）', w.getBlock(0, 40, 0) === OBS && w.getBlock(0, 41, 0) === OBS);
}

// ── ⑬ 下界寻址：空腔立地面（下探穿悬挂体，门贴空腔底）──
{
  const w = fakeWorld();
  const NR = BlockRegistry.getId('netherrack');
  for (let y = 50; y <= 199; y++) for (let x = -3; x <= 8; x++) for (let z = -3; z <= 3; z++) w.setBlock(x, y, z, NR); // 顶部悬挂岩（直达扫描顶）
  for (let y = 20; y <= 39; y++) for (let x = -3; x <= 8; x++) for (let z = -3; z <= 3; z++) w.setBlock(x, y, z, NR); // 底部岩
  for (let y = 40; y <= 49; y++) for (let x = -3; x <= 8; x++) for (let z = -3; z <= 3; z++) w.setBlock(x, y, z, 0);  // 空腔
  const floor = findOpenFloorY(w, 1, 0, 200);
  assert('⑬ findOpenFloorY 命中空腔底 y40', floor === 40);
  const pos = buildReturnPortal(w, 'nether', 0, 0, { top: 200, platform: { y: 40, block: 'obsidian' } });
  assert('⑬ 门贴空腔底', pos.y === 41 && w.getBlock(0, 40, 0) === OBS);
  assert('⑬ 门内 portal 填充', w.getBlock(1, 41, 0) === NP && w.getBlock(2, 42, 0) === NP);
}

// ── ⑭ 下界寻址：熔岩海打断空气段 → 垫平台（门不立熔岩上）──
{
  const w = fakeWorld();
  const LAVA = BlockRegistry.getId('lava');
  const NR = BlockRegistry.getId('netherrack');
  for (let y = 45; y <= 199; y++) for (let x = -3; x <= 8; x++) for (let z = -3; z <= 3; z++) w.setBlock(x, y, z, NR);
  for (let y = 35; y <= 44; y++) for (let x = -3; x <= 8; x++) for (let z = -3; z <= 3; z++) w.setBlock(x, y, z, LAVA);
  for (let y = 1; y <= 34; y++) for (let x = -3; x <= 8; x++) for (let z = -3; z <= 3; z++) w.setBlock(x, y, z, NR);
  assert('⑭ 熔岩列无可立地面', findOpenFloorY(w, 1, 0, 200) === -1);
  const pos = buildReturnPortal(w, 'nether', 0, 0, { top: 200, platform: { y: 40, block: 'obsidian' } });
  const solidAt = (x, y, z) => { const d = BlockRegistry.getById(w.getBlock(x, y, z)); return !!(d && d.solid); };
  assert('⑭ 熔岩海垫平台立门且门厅清空', pos.y === 41 && !solidAt(1, 41, 0) && w.getBlock(0, 40, 0) === OBS);
}

// ── ⑮ 真实下界生成器集成：首次到达建门不埋人（8 确定性落点，需 ensureChunk 后扫描）──
{
  const { World } = await import('../src/core/World.js');
  const spots = [[50, 50], [-80, 120], [200, -40], [-150, -150], [8, 8], [-8, 8], [300, 300], [-200, 60]];
  let ok = 0;
  for (const [bx, bz] of spots) {
    const world = new World(20250903, 'nether');
    world.ensureChunk(Math.floor((bx + 1) / 16), Math.floor(bz / 16));
    const pos = buildReturnPortal(world, 'nether', bx, bz, { top: 200, platform: { y: 40, block: 'obsidian' } });
    const sx = Math.floor(pos.x), sy = Math.floor(pos.y), sz = Math.floor(pos.z);
    const solidAt = (x, y, z) => { const d = BlockRegistry.getById(world.getBlock(x, y, z)); return !!(d && d.solid); };
    const fluidAt = (x, y, z) => { const d = BlockRegistry.getById(world.getBlock(x, y, z)); return !!(d && d.fluid); };
    const stand = !solidAt(sx, sy, sz) && !solidAt(sx, sy + 1, sz) && !fluidAt(sx, sy, sz);
    const portalOk = world.getBlock(bx + 1, sy, sz) === NP || world.getBlock(bx + 1, sy - 1, sz) === NP;
    let exits = 0;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (!solidAt(sx + dx, sy, sz + dz)) exits++;
    if (stand && portalOk && exits >= 1) ok++;
  }
  assert('⑮ 真实下界 8 落点：站位通行+portal 在场+门厅有开口', ok === spots.length);
}
finish('Portals 逻辑单测');
