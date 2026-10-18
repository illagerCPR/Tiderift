// end-islands.mjs -- 末地外岛锚点场地形回归（node 直跑，无需服务器）
// 断言：
//   ① 外岛群系在场：末地高原 + 末地碎岛（±640 扫描，双 seed）
//   ② 群系密度带宽（锚点场参数改动过严/过密的回归线）
//   ③ outerAnchors 锚点表：确定性 / 角度有序 / 全部在主岛外
//   ④ 群系→方块单一来源：getBiome 列的区块填充与 _outerSpan 轮廓一致
//   ⑤ 群系分界单调：end_highlands ⇔ 岛基准半径 ≥ HIGHLANDS_MIN_R
//   ⑥ biomeNames 四项完备（InfoBar 显示依赖）
//   ⑦ 主岛不动：原点列仍为 main_island（出生/柱环/龙战链依赖）
//   ⑧ 单区块生成耗时预算
import { Chunk } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { EndGenerator, HIGHLANDS_MIN_R } from '../src/world/dimensions/end.js';
import '../src/blocks/BlockDefs.js';
import { ok, finish } from './harness.mjs';

const SEEDS = [42, 20250903];

const ES = BlockRegistry.getId('end_stone');

for (const seed of SEEDS) {
  const gen = new EndGenerator(seed);

  // ① 群系在场 + ② 密度带宽（±640 列扫描，步 16）
  let highlands = 0, small = 0, total = 0;
  for (let x = -640; x <= 640; x += 16) {
    for (let z = -640; z <= 640; z += 16) {
      total++;
      const b = gen.getBiome(x, z);
      if (b === 'end_highlands') highlands++;
      else if (b === 'small_end_islands') small++;
    }
  }
  ok(highlands > 0, `[end] seed=${seed} ±640 未见末地高原（锚点场密度改动过严？）`);
  ok(small > 0, `[end] seed=${seed} ±640 未见末地碎岛`);
  const hp = highlands / total, sp = small / total;
  ok(hp > 0.04 && hp < 0.30, `[end] seed=${seed} 高原列占比 ${hp.toFixed(3)} 超出带宽 [0.04, 0.30]`);
  ok(sp > 0.005 && sp < 0.15, `[end] seed=${seed} 碎岛列占比 ${sp.toFixed(3)} 超出带宽 [0.005, 0.15]`);

  // ③ 锚点表：确定性（双生成器逐项深比较）/ 角度有序 / 全部在主岛外
  const a1 = gen.outerAnchors();
  const a2 = new EndGenerator(seed).outerAnchors();
  ok(a1.length >= 4, `[end] seed=${seed} 外圈锚点仅 ${a1.length} 个（折跃门映射候选不足）`);
  const sig = (a) => a.map((p) => `${p.x},${p.z},${p.rad},${p.top}`).join('|');
  ok(sig(a1) === sig(a2), `[end] seed=${seed} outerAnchors 不确定`);
  for (let i = 1; i < a1.length; i++) {
    ok(Math.atan2(a1[i - 1].z, a1[i - 1].x) <= Math.atan2(a1[i].z, a1[i].x),
      `[end] seed=${seed} outerAnchors 未按角度排序 @${i}`);
  }
  for (const a of a1) {
    ok(Math.hypot(a.x, a.z) > 100, `[end] seed=${seed} 锚点 (${a.x},${a.z}) 落在主岛范围 (r=${Math.hypot(a.x, a.z).toFixed(0)})`);
    ok(a.rad >= 24 && a.rad <= 40 && a.top >= 55 && a.top <= 74, `[end] seed=${seed} 锚点参数越界: ${JSON.stringify(a)}`);
  }

  // ④ 群系→方块单一来源 + ⑤ 分界单调：抽样外岛列，区块填充与 span 一致
  let checked = 0;
  for (let x = -640; x <= 640 && checked < 10; x += 16) {
    for (let z = -640; z <= 640 && checked < 10; z += 16) {
      const b = gen.getBiome(x, z);
      if (b !== 'end_highlands' && b !== 'small_end_islands') continue;
      const span = gen._outerSpan(x, z);
      ok(!!span, `[end] seed=${seed} getBiome=${b} 但 _outerSpan=null @(${x},${z})`);
      const wantHigh = span.rad >= HIGHLANDS_MIN_R;
      ok(wantHigh === (b === 'end_highlands'),
        `[end] seed=${seed} 群系分界与 rad=${span.rad} 不一致 @(${x},${z}): ${b}`);
      const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
      const c = new Chunk(cx, cz);
      gen.generateChunk(c);
      const lx = x - cx * 16, lz = z - cz * 16;
      let solid = 0;
      for (let y = Math.max(0, span.bottom); y <= span.top; y++) {
        if (c.get(lx, y, lz) === ES) solid++;
      }
      const thickness = span.top - Math.max(0, span.bottom) + 1;
      ok(solid === thickness,
        `[end] seed=${seed} 外岛列 @(${x},${z}) 填充 ${solid}/${thickness} 与轮廓不符（getBiome 与 generateChunk 非同源）`);
      checked++;
    }
  }
  ok(checked >= 6, `[end] seed=${seed} 外岛抽样列不足（${checked}）`);

  // ⑥ biomeNames 四项完备
  for (const k of ['main_island', 'end_highlands', 'small_end_islands', 'void']) {
    ok(typeof gen.biomeNames[k] === 'string' && gen.biomeNames[k].length > 0,
      `[end] seed=${seed} biomeNames 缺少 ${k}`);
  }

  // ⑦ 主岛不动：原点列主岛 + 主岛方块仍在
  ok(gen.getBiome(0, 0) === 'main_island', `[end] seed=${seed} 原点列不再是主岛`);
  const c0 = new Chunk(0, 0);
  gen.generateChunk(c0);
  let hasES = false;
  for (let i = 0; i < c0.blocks.length; i++) if (c0.blocks[i] === ES) { hasES = true; break; }
  ok(hasES, `[end] seed=${seed} 原点区块无 end_stone（主岛被误改？）`);
}

// ⑧ 耗时预算
{
  const gen = new EndGenerator(SEEDS[0]);
  const c = new Chunk(0, 0);
  const t0 = performance.now();
  gen.generateChunk(c);
  const ms = performance.now() - t0;
  ok(ms < 30, `[end] 单区块生成耗时异常: ${ms.toFixed(1)}ms`);
}
finish(`末地外岛锚点场回归（${SEEDS.length} seeds）`);
