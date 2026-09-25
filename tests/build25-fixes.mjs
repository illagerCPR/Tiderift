// build25-fixes.mjs -- Build 25（村庄耕地麦田 + 树让位结构 + 多群系无建筑全景）回归（node 直跑，无需服务器）
// 断言：
//   ① 树让位结构：footprintsNear/disabled 源码绊线 + 行为级（seed 20250903 村庄足迹本体
//     与外扩1内树冠方块数=0，周边环带仍有树——修复前树冠伸进建筑）
//   ② 村庄农田改原版式：行为级（耕地+每格 wheat_crop_0..7+水渠贴耕地）+ 源码绊线（melon 移除）
//   ③ 全景烘焙：结构禁用 + 单机位多群系交界选点（同点六面连续拍摄）+ 光照增强默认完整档绊线
//   ④ BUILD = 26（B26 流体模拟批次 bump）
import { readFileSync } from 'fs';
import { TerrainGenerator } from '../src/world/terrain.js';
import { Chunk } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import '../src/blocks/BlockDefs.js';
import { BUILD } from '../src/version.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }

// ── ① 树让位结构 ──
{
  const sm = srcOf('../src/world/structures/StructureManager.js');
  ok(sm.includes('this.disabled = false'), 'StructureManager 持有 disabled 开关');
  ok(sm.includes('if (this.disabled) return;'), 'decorateChunk 对 disabled 短路（烘焙零建筑）');
  ok(sm.includes('footprintsNear(cx, cz, margin = 3)'), 'footprintsNear 树让位查询存在');
  ok(sm.includes('rec.minX - margin, maxX: rec.maxX + margin'), '足迹盒外扩 margin（盖树冠半径）');

  const tr = srcOf('../src/world/terrain.js');
  ok(tr.includes('const TREE_CLEAR_MARGIN = 3'), '树让位外扩常量 = 3（树冠半径 ≤2 + 余量）');
  ok(tr.includes('footprintsNear(cx, cz, TREE_CLEAR_MARGIN)'), '树 pass 前查询本区块相关足迹盒');
  ok(tr.includes('generateStructures(chunk, footprints = [])'), 'generateStructures 接收足迹盒');
  const treeIdx = tr.indexOf('if (cfg.treeChance && rand() < cfg.treeChance');
  const treeBody = tr.slice(treeIdx, treeIdx + 220);
  ok(treeBody.includes('!inFootprint(wx, wz)'), '树判定含足迹让位守卫');
  const mushIdx = tr.indexOf('if (cfg.hugeMushroomChance && rand() < cfg.hugeMushroomChance');
  const mushBody = tr.slice(mushIdx, mushIdx + 260);
  ok(mushBody.includes('!inFootprint(wx, wz)'), '巨型蘑菇判定含足迹让位守卫');
}

// ── ①b 树让位行为级（seed 20250903 村庄 cell(-1,-2)）──
{
  const gen = new TerrainGenerator(20250903);
  const rec = gen.structureManager.ensureRecord('village', -1, -2);
  ok(!!rec, 'seed 20250903 cell(-1,-2) 存在村庄记录');
  const LEAF = new Set(['oak_leaves', 'spruce_leaves', 'birch_leaves']);
  const load = (m) => {
    const x0 = rec.minX - m, x1 = rec.maxX + m, z0 = rec.minZ - m, z1 = rec.maxZ + m;
    const chunks = new Map();
    for (let cx = Math.floor(x0 / 16); cx <= Math.floor(x1 / 16); cx++) {
      for (let cz = Math.floor(z0 / 16); cz <= Math.floor(z1 / 16); cz++) {
        const c = new Chunk(cx, cz);
        gen.generateChunk(c);
        chunks.set(cx + ',' + cz, c);
      }
    }
    const at = (wx, wy, wz) => {
      const c = chunks.get(Math.floor(wx / 16) + ',' + Math.floor(wz / 16));
      return c ? c.get(((wx % 16) + 16) % 16, wy, ((wz % 16) + 16) % 16) : -1;
    };
    const nameOf = (id) => (BlockRegistry.getById(id) || {}).name || '';
    return { x0, x1, z0, z1, at, nameOf };
  };
  const leafCount = (r, at, nameOf) => {
    let n = 0;
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++)
      for (let y = 40; y < 110; y++) if (LEAF.has(nameOf(at(x, y, z)))) n++;
    return n;
  };
  const inner = load(0);
  ok(leafCount(inner, inner.at, inner.nameOf) === 0, '建筑足迹本体内树冠方块数=0（修复前树冠穿屋顶）');
  const near1 = load(1);
  ok(leafCount(near1, near1.at, near1.nameOf) === 0, '足迹外扩1内树冠方块数=0（树冠不接触建筑）');
  const ring = load(14);
  ok(leafCount(ring, ring.at, ring.nameOf) > 0, '足迹外环带仍有树（让位≠无树）');
}

// ── ② 村庄农田改原版式耕地+小麦 ──
{
  const gen = new TerrainGenerator(20250903);
  const rec = gen.structureManager.ensureRecord('village', -1, -2);
  const chunks = new Map();
  for (let cx = Math.floor((rec.minX - 4) / 16); cx <= Math.floor((rec.maxX + 4) / 16); cx++) {
    for (let cz = Math.floor((rec.minZ - 4) / 16); cz <= Math.floor((rec.maxZ + 4) / 16); cz++) {
      const c = new Chunk(cx, cz);
      gen.generateChunk(c);
      chunks.set(cx + ',' + cz, c);
    }
  }
  const at = (wx, wy, wz) => {
    const c = chunks.get(Math.floor(wx / 16) + ',' + Math.floor(wz / 16));
    return c ? c.get(((wx % 16) + 16) % 16, wy, ((wz % 16) + 16) % 16) : -1;
  };
  const nameOf = (id) => (BlockRegistry.getById(id) || {}).name || '';
  let farmland = 0, wheat = 0, wheatBad = 0, farmWater = 0, pumpkins = 0;
  const isWheat = (n) => /^wheat_crop_[0-7]$/.test(n);
  for (let x = rec.minX; x <= rec.maxX; x++) {
    for (let z = rec.minZ; z <= rec.maxZ; z++) {
      for (let y = 55; y < 80; y++) {
        const n = nameOf(at(x, y, z));
        if (n === 'farmland') {
          farmland++;
          const up = nameOf(at(x, y + 1, z));
          if (isWheat(up)) wheat++; else wheatBad++;
        } else if (isWheat(n)) {
          wheat++; // 麦子计入总数（不计坏格）
          if (nameOf(at(x, y - 1, z)) !== 'farmland') wheatBad++;
        }
        if (n === 'pumpkin') pumpkins++;
      }
    }
  }
  ok(farmland > 0, '村庄耕地方块数>0（实际 ' + farmland + '）');
  ok(wheatBad === 0, '每块耕地上方都是 wheat_crop_0..7 且无悬空麦子（bad=' + wheatBad + '）');
  ok(wheat >= farmland, '耕地全覆麦（wheat=' + wheat + ' farmland=' + farmland + '）');
  ok(farmWaterAt(at, nameOf, rec) > 0, '农田含水渠（水贴耕地）');
  ok(pumpkins < 5, '农田不再成垄南瓜/西瓜（残留干草料堆点缀 ≤4，实际 ' + pumpkins + '）');

  const vil = srcOf('../src/world/structures/village.js');
  ok(vil.includes('ID.farmland'), '农田材料含 farmland');
  ok(vil.includes("blockId('wheat_crop_' + stage)"), '小麦按确定性阶段放置');
  ok(vil.includes('Math.floor(rng() * 8)'), '生长阶段由布局 rng 抛签（确定性不变量）');
  ok(vil.includes('ID.melon') === false, '西瓜已从农田移除');
}

// 水渠检测：水与其四向邻格之一为耕地（同层相邻，农田水渠）
function farmWaterAt(at, nameOf, rec) {
  let n = 0;
  for (let x = rec.minX; x <= rec.maxX; x++) {
    for (let z = rec.minZ; z <= rec.maxZ; z++) {
      for (let y = 55; y < 80; y++) {
        if (nameOf(at(x, y, z)) !== 'water') continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (nameOf(at(x + dx, y, z + dz)) === 'farmland') { n++; break; }
        }
      }
    }
  }
  return n;
}

// ── ③ 全景烘焙：禁结构 + 单机位多群系交界 + 同点六面连续拍摄 ──
{
  const bake = srcOf('../src/render/PanoramaBake.js');
  ok(bake.includes('structureManager.disabled = true'), '烘焙世界禁用结构生成（画面零建筑）');
  ok(bake.includes('function pickPanoramaSpot'), '单机位多群系交界选点存在');
  ok(bake.includes('const SPOT_PROBES'), '群系多样性探针集存在');
  ok(bake.includes('Biomes.MUSHROOM_FIELDS'), '蘑菇岛入镜优先（斑块锚点）');
  ok(bake.includes('avoidWaterYaw'), '水平面避水偏航存在');
  ok(bake.includes('const FACES = ['), '固定 FACES 六面共享同一 center（cubemap 连续无分界）');
  ok(bake.includes('FACE_PLANS') === false, '六面独立机位计划已移除（分界返工）');
  ok(bake.includes('releaseFace') === false, 'per-face 生命周期已移除（分界返工）');

  const settings = srcOf('../src/core/Settings.js');
  ok(settings.includes("gfx: 'full'"), '光照增强默认完整档（大满）');
  for (const k of ['gfxBloom: true', 'gfxGodRays: true', 'gfxWaterReflection: true', 'gfxShadows: true']) {
    ok(settings.includes(k), `完整档子项默认全开: ${k.split(':')[0]}`);
  }
}

// ── ④ BUILD 钉值 ──
ok(BUILD === 28, 'BUILD 27（B26 流体模拟批次 bump）');

console.log(`PASS build25-fixes: ${passed} 断言`);
