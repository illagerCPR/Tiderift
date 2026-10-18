// nether-structures.mjs -- 潮火之炉回归（世界观批次 N2，node 直跑，无需服务器）
// 断言：
//   ① 结构类型注册 + 维度作用域（主世界/末地生成器不求解）
//   ② 选址漏斗：±2 cell 扫描（双 seed）至少一例
//   ③ 结构落地：下界砖招牌方块 / 炉膛岩浆块 / 长明灯石在位
//   ④ 箱子三向一致：meta.chests ↔ chest 方块 ↔ sm.chests
//   ⑤ 石碑三向一致：meta.steles ↔ ember_stele 方块 ↔ sm.steles（炉火/熏黑/哀鸣）
//   ⑥ 要塞碑位（N2 追加）：ember_sinking 就位且不破坏既有箱子声明（4 处）
//   ⑦ loot：tidefire_hearth 表确定性 + mourn_tear FORCED 必出
//   ⑧ 双次求解确定性：blocks 逐字节一致
import { Chunk, CHUNK_SIZE } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { EndGenerator } from '../src/world/dimensions/end.js';
import { chestLoot } from '../src/world/loot.js';
import { STELE_CHAPTERS as steleChapters } from '../src/world/steles.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

const SEEDS = [42, 20250903];

// ① 维度作用域
{
  const owGen = new TerrainGenerator(42);
  const eGen = new EndGenerator(42);
  ok(!owGen.structureManager.ensureRecord('tidefire_hearth', 0, 0), '主世界不应求解 tidefire_hearth');
  ok(!eGen.structureManager.ensureRecord('tidefire_hearth', 0, 0), '末地不应求解 tidefire_hearth');
}

const sig = (r) => r.blocks.map(b => b.join(',')).join('|') + '#' + JSON.stringify(r.meta.chests) + '#' + JSON.stringify(r.meta.steles || []);

for (const seed of SEEDS) {
  const gen = new NetherGenerator(seed);

  // ② 选址漏斗：cell24 → ±2 cell 扫描
  let found = null;
  const R = 2;
  outer:
  for (let cx = -R; cx <= R; cx++) {
    for (let cz = -R; cz <= R; cz++) {
      const rec = gen.structureManager.ensureRecord('tidefire_hearth', cx, cz);
      if (rec) { found = rec; break outer; }
    }
  }
  ok(!!found, `seed=${seed} 扫描区未找到 tidefire_hearth（选址门过严或密度参数改动）`);

  // ③④⑤ 落地与三向一致
  const NB = BlockRegistry.getId('nether_bricks');
  const MG = BlockRegistry.getId('magma_block');
  const GS = BlockRegistry.getId('glowstone');
  const CH = BlockRegistry.getId('chest');
  const ES = BlockRegistry.getId('ember_stele');
  {
    const rec = found;
    const touched = new Map();
    const chunkAt = (x, z) => {
      const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
      const k = cx + ',' + cz;
      if (!touched.has(k)) { const c = new Chunk(cx, cz); gen.generateChunk(c); touched.set(k, c); }
      return touched.get(k);
    };
    const blockAt = (x, y, z) => {
      const c = chunkAt(x, z);
      return c.get(((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, y, ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE);
    };
    // 招牌方块落地：下界砖 / 岩浆块 / 荧石
    const count = (id) => rec.blocks.filter(b => b[3] === id && blockAt(b[0], b[1], b[2]) === id).length;
    ok(count(NB) >= 60, `seed=${seed} 下界砖落地不足: ${count(NB)}`);
    ok(count(MG) >= 9, `seed=${seed} 炉膛岩浆块不足: ${count(MG)}`);
    ok(count(GS) >= 4, `seed=${seed} 长明灯石不足: ${count(GS)}`);
    // 箱子三向
    for (const c of rec.meta.chests) {
      ok(c[3] === 'tidefire_hearth', `未知 loot 表: ${c[3]}`);
      ok(blockAt(c[0], c[1], c[2]) === CH, `chest 方块缺失 @(${c[0]},${c[1]},${c[2]})`);
      ok(gen.structureManager.chests.get(c[0] + ',' + c[1] + ',' + c[2]) === c[3],
        `sm.chests 注册缺失 @(${c[0]},${c[1]},${c[2]})`);
    }
    ok(rec.meta.chests.length === 2, `炉侧房箱数应为 2 (${rec.meta.chests.length})`);
    // 石碑三向（烬火纪 3 章）
    ok(rec.meta.steles.length === 3, `烬纹石碑应为 3 块 (${rec.meta.steles.length})`);
    for (const s of rec.meta.steles) {
      ok(!!steleChapters[s[3]] && steleChapters[s[3]].dim === 'nether', `未知/非下界章节: ${s[3]}`);
      ok(blockAt(s[0], s[1], s[2]) === ES, `ember_stele 方块缺失 @(${s[0]},${s[1]},${s[2]})`);
      ok(gen.structureManager.steles.get(s[0] + ',' + s[1] + ',' + s[2]) === s[3],
        `sm.steles 注册缺失 @(${s[0]},${s[1]},${s[2]})`);
    }
    const chapterSet = rec.meta.steles.map(s => s[3]).sort().join(',');
    ok(chapterSet === 'ember_hearth,ember_mourning,ember_sooted', `碑文章节组合 (${chapterSet})`);
  }

  // ⑧ 双次求解确定性：第二个生成器 ensureRecord 同 cell 后 sig 对拍
  {
    const gen2 = new NetherGenerator(seed);
    const R2 = 2;
    let again = null;
    outer2:
    for (let cx = -R2; cx <= R2; cx++) {
      for (let cz = -R2; cz <= R2; cz++) {
        const rec2 = gen2.structureManager.ensureRecord('tidefire_hearth', cx, cz);
        if (rec2) { again = rec2; break outer2; }
      }
    }
    ok(!!again, `seed=${seed} 第二次求解未命中`);
    if (again) ok(sig(again) === sig(found), `seed=${seed} 双次求解不一致`);
  }

  // ⑥ 要塞碑位（N2 追加，同 seed 同生成器内扫描）
  let fort = null;
  const FR = 2;
  outerFort:
  for (let cx = -FR; cx <= FR; cx++) {
    for (let cz = -FR; cz <= FR; cz++) {
      const rec = gen.structureManager.ensureRecord('fortress', cx, cz);
      if (rec) { fort = rec; break outerFort; }
    }
  }
  ok(!!fort, `seed=${seed} 扫描区未找到 fortress（回归基线破坏）`);
  ok(fort.meta.chests.length === 4, `seed=${seed} fortress 箱子仍为 4 处 (${fort.meta.chests.length})`);
  ok(fort.meta.steles.length === 1 && fort.meta.steles[0][3] === 'ember_sinking',
    `seed=${seed} fortress 碑位 ember_sinking 缺失`);
  {
    const ES = BlockRegistry.getId('ember_stele');
    const s = fort.meta.steles[0];
    const touched = new Map();
    const chunkAt = (x, z) => {
      const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
      const k = cx + ',' + cz;
      if (!touched.has(k)) { const c = new Chunk(cx, cz); gen.generateChunk(c); touched.set(k, c); }
      return touched.get(k);
    };
    const blockAt = (x, y, z) => chunkAt(x, z).get(((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, y, ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE);
    ok(blockAt(s[0], s[1], s[2]) === ES, `fortress ember_stele 方块缺失 @(${s[0]},${s[1]},${s[2]})`);
    ok(gen.structureManager.steles.get(s[0] + ',' + s[1] + ',' + s[2]) === 'ember_sinking', 'fortress sm.steles 注册缺失');
  }

  // ⑦ loot：确定性 + FORCED 必出
  const t = found.meta.chests[0];
  const a = chestLoot(seed, 'tidefire_hearth', t[0], t[1], t[2]);
  const b = chestLoot(seed, 'tidefire_hearth', t[0], t[1], t[2]);
  ok(JSON.stringify(a) === JSON.stringify(b), 'tidefire_hearth 表两次生成逐字节一致');
  const names = a.filter(Boolean).map(i => i.name);
  ok(names.includes('mourn_tear'), `mourn_tear FORCED 未必出 (${names.join(',')})`);
  ok(a.filter(Boolean).filter(i => i.name === 'mourn_tear').every(i => i.count >= 1 && i.count <= 2), 'mourn_tear 数量 1-2');
}
finish('nether-structures');
