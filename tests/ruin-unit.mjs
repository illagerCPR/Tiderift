// tests/ruin-unit.mjs -- D 可动手解开的遗迹（阶段 1）：机关推导 / 判定 / 状态机 / 结构接缝回归（纯 node）
// 覆盖：注册与盐唯一 / 键与清洗 / 推导确定性 / 几何与判定对齐 / 完整解法 / 半解 / 乱序干扰 /
//       关键件挖毁 / 轮询节流 / 序列化回落 / 解封写入与采样器 / 真实生成器接入与维度过滤
import fs from 'node:fs';
import '../src/blocks/BlockDefs.js';
import '../src/world/structures/catalog.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import {
  RUIN_KINDS, RUIN_KIND_DIM, RUIN_RULE, RUIN_LIMIT, RUIN_POLL_MS, RUIN_NAME_MAX,
  RUIN_STATE_LOCKED, RUIN_STATE_SOLVED, RACK_MATERIALS,
  ruinKey, isValidRuinKey, parseRuinKey, cleanRuinName, cleanRuinState, ruinKindForDim,
  ruinPuzzle, evaluateRuin, applyUnlock, makeWorldSample, Ruins,
  SLUICE_LAYOUT, EMBER_LAYOUT, RACK_LAYOUT,
} from '../src/core/Ruins.js';
import { TIDE_SLUICE_DEF, solveSluice } from '../src/world/structures/tide_sluice.js';
import { EMBER_CIRCUIT_DEF, solveCircuit } from '../src/world/structures/ember_circuit.js';
import { FRAME_RACK_DEF, solveRack } from '../src/world/structures/frame_rack.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { AetherGenerator } from '../src/world/dimensions/aether.js';
import { ok, finish, configure } from './harness.mjs';

configure({ verbose: true });

const SEED = 20250903;
const id = (name) => BlockRegistry.getId(name);
const AX = 1008, AY = 70, AZ = -2032;   // 任意锚点（纯函数不依赖世界）

function makeRng(seed) {
  let r = seed >>> 0;
  return () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
}

// 布局数组 → 可读写"假世界"（后写覆盖先写 = 结构最终状态；未写过的格 = 空气 0）
function makeWorld(blocks) {
  const map = new Map();
  for (const b of blocks) map.set(b[0] + ',' + b[1] + ',' + b[2], b[3]);
  const get = (x, y, z) => {
    const v = map.get(x + ',' + y + ',' + z);
    return v === undefined ? 0 : v;
  };
  const set = (x, y, z, v) => { map.set(x + ',' + y + ',' + z, v); };
  return { map, get, set, sample: () => (x, y, z) => get(x, y, z) };
}

const KINDS = [
  {
    kind: 'tide_sluice', dim: 'overworld', def: TIDE_SLUICE_DEF, solve: solveSluice,
    solveCell: (P, world) => {
      // 挖开两处泥塞 → 水沿暗渠流进沉沙池：泥塞位变成流动水，标线列漫水（判据只看"是水"）
      for (const p of P.plugs) world.set(p.x, p.y, p.z, id('water_flow_1'));
      P.cells.forEach((c, i) => world.set(c.x, c.y, c.z, id('water_flow_' + (5 + (i % 2)))));
    },
    halfCell: (P, world) => {
      for (const p of P.plugs) world.set(p.x, p.y, p.z, id('water_flow_1'));
      world.set(P.cells[0].x, P.cells[0].y, P.cells[0].z, id('water'));
    },
  },
  {
    kind: 'ember_circuit', dim: 'nether', def: EMBER_CIRCUIT_DEF, solve: solveCircuit,
    solveCell: (P, world) => {
      for (const g of P.gaps) world.set(g.x, g.y, g.z, id('redstone_wire'));
      for (const c of P.cells) world.set(c.x, c.y, c.z, id('redstone_lamp_lit'));
    },
    halfCell: (P, world) => {
      for (let i = 0; i < 2; i++) world.set(P.cells[i].x, P.cells[i].y, P.cells[i].z, id('redstone_lamp_lit'));
    },
  },
  {
    kind: 'frame_rack', dim: 'aether', def: FRAME_RACK_DEF, solve: solveRack,
    solveCell: (P, world) => {
      for (const s of P.slots) world.set(s.x, s.y, s.z, s.id);
    },
    halfCell: (P, world) => {
      world.set(P.slots[0].x, P.slots[0].y, P.slots[0].z, P.slots[0].id);
    },
  },
];

// ── 一、注册、密度参数与盐唯一 ─────────────────────────────────────────
const catalogSrc = fs.readFileSync(new URL('../src/world/structures/catalog.js', import.meta.url), 'utf8');
for (const k of KINDS) {
  ok(catalogSrc.includes("registerStructureType('" + k.kind + "', "), 'catalog 末尾注册 ' + k.kind);
  ok(k.def.dims.length === 1 && k.def.dims[0] === k.dim, k.kind + ' 只在自己维度参与 (' + k.def.dims.join(',') + ')');
  ok(RUIN_KIND_DIM[k.kind] === k.dim, k.kind + ' 的 RUIN_KIND_DIM 与 def.dims 一致');
  ok(RUIN_RULE[k.kind] === ({ tide_sluice: 'water_line', ember_circuit: 'lamps', frame_rack: 'slots' })[k.kind], k.kind + ' 判定规则名登记');
  ok(Number.isInteger(k.def.cell) && k.def.cell >= 12, k.kind + ' cell 合理');
  ok(Number.isInteger(k.def.attempts) && k.def.attempts >= 1, k.kind + ' attempts 合理');
  ok(k.def.chance > 0 && k.def.chance <= 1, k.kind + ' chance 在 (0,1]');
  ok(k.def.radius >= 12 && k.def.radius <= 32, k.kind + ' radius 覆盖占地');
  ok(typeof k.def.place === 'function' && typeof k.def.solve === 'function', k.kind + ' place/solve 齐备');
}
ok(RUIN_KINDS.length === 3 && new Set(RUIN_KINDS).size === 3, '三种机关类型登记且互不重复');
ok(ruinKindForDim('overworld') === 'tide_sluice' && ruinKindForDim('nether') === 'ember_circuit'
  && ruinKindForDim('aether') === 'frame_rack', '维度 → 机关类型映射');
ok(ruinKindForDim('end') === null && ruinKindForDim('nope') === null, '末地/未知维度没有机关房');

// 盐唯一：扫描全部结构文件（salt: N 与 tide_barrow 的 const SALT = N）
{
  const dir = new URL('../src/world/structures/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  const counts = new Map();
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/salt:\s*(\d+)/g)) {
      const v = Number(m[1]);
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    for (const m of src.matchAll(/const SALT = (\d+)/g)) {
      const v = Number(m[1]);
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  for (const k of KINDS) {
    ok(counts.get(k.def.salt) === 1, k.kind + ' 的 salt ' + k.def.salt + ' 全局唯一');
  }
  const salts = [...counts.keys()];
  ok(salts.length === counts.size, '全部结构 salt 无重复（' + salts.length + ' 个）');
}

// ── 二、键与清洗 ───────────────────────────────────────────────────────
ok(ruinKey('overworld', 'tide_sluice', 1008, -2032) === 'overworld|tide_sluice|1008|-2032', '键格式 维度|类型|ax|az');
ok(ruinKey('aether', 'frame_rack', 12.7, -0.2) === 'aether|frame_rack|12|-1', '键坐标向下取整');
ok(isValidRuinKey('nether|ember_circuit|-16|32') && isValidRuinKey('overworld|tide_sluice|0|0'), '合法键通过');
ok(!isValidRuinKey('overworld|tide_sluice|0') && !isValidRuinKey('overworld|village|0|0'), '缺段/未知类型键拒绝');
ok(!isValidRuinKey('overworld|tide_sluice|1.5|0') && !isValidRuinKey('a,b') && !isValidRuinKey(''), '非法字符键拒绝');
ok(!isValidRuinKey(1008) && !isValidRuinKey(null), '非字符串键拒绝');
const parsed = parseRuinKey('nether|ember_circuit|-16|32');
ok(parsed && parsed.dim === 'nether' && parsed.kind === 'ember_circuit' && parsed.ax === -16 && parsed.az === 32, 'parseRuinKey 还原四段');
ok(parseRuinKey('bad') === null, 'parseRuinKey 非法键返回 null');
ok(cleanRuinName('  Alice  ') === 'Alice', '归属名去空白');
ok(cleanRuinName('a\u0000b\u001fc').length === 3, '归属名去控制字符');
ok(cleanRuinName('x'.repeat(80)).length === RUIN_NAME_MAX, '归属名截断到上限');
ok(cleanRuinName(null) === '', '非字符串归属名回落空串');
ok(cleanRuinState('solved') === RUIN_STATE_SOLVED && cleanRuinState('locked') === RUIN_STATE_LOCKED, '状态清洗');
ok(cleanRuinState('SOLVED') === RUIN_STATE_LOCKED && cleanRuinState(null) === RUIN_STATE_LOCKED, '未知状态回落 locked');

// ── 三、推导确定性 ─────────────────────────────────────────────────────
for (const k of KINDS) {
  const a = ruinPuzzle(SEED, k.dim, k.kind, AX, AY, AZ);
  const b = ruinPuzzle(SEED, k.dim, k.kind, AX, AY, AZ);
  ok(a && a.key === b.key && JSON.stringify(a) === JSON.stringify(b), k.kind + ' 同 seed 同锚点两次推导逐字节一致');
  const far = ruinPuzzle(SEED, k.dim, k.kind, AX + 384, AY, AZ + 384);
  ok(far.key !== a.key, k.kind + ' 不同锚点 → 不同键');
  ok(JSON.stringify(far.cells) !== JSON.stringify(a.cells), k.kind + ' 不同锚点 → 参与格坐标不同');
  ok(ruinPuzzle(SEED, k.dim, 'unknown_kind', AX, AY, AZ) === null, '未知机关类型返回 null');
  ok(a.rule === RUIN_RULE[k.kind], k.kind + ' 推导结果带判定规则名');
  ok(a.cells.length > 0 && a.keys.length > 0 && a.unlock.length > 0, k.kind + ' 参与格/关键件/解封格齐备');
  for (const group of [a.cells, a.keys]) {
    ok(group.every((c) => Array.isArray(c.accept) && c.accept.length > 0 && c.accept.every((v) => Number.isInteger(v) && v > 0)),
      k.kind + ' 期望 id 全部解析成功（无名字打错静默成 0）');
  }
}
{
  // 不同 seed：同锚点下材料组合应当发散（构件架房是唯一由 seed 影响的机关）
  const sets = new Set();
  for (let s = 1; s <= 8; s++) {
    const p = ruinPuzzle(s, 'aether', 'frame_rack', AX, AY, AZ);
    sets.add(p.slots.map((x) => x.name).join('+'));
    ok(p.slots.every((x) => RACK_MATERIALS.indexOf(x.name) >= 0), '构件架材料取自调色板');
    ok(new Set(p.slots.map((x) => x.name)).size === p.slots.length, '三槽材料互不相同');
  }
  ok(sets.size >= 2, '不同 seed → 材料组合发散（' + sets.size + ' 种）');
}

// ── 四、几何与判定对齐（真实 solve 出的方块必须与推导定义吻合）───────────
const GEOM = {};
for (const k of KINDS) {
  const layout = k.solve(makeRng(SEED ^ 0x5f5f), AX, AY, AZ, { seed: SEED });
  const world = makeWorld(layout.blocks);
  const P = ruinPuzzle(SEED, k.dim, k.kind, AX, AY, AZ);
  GEOM[k.kind] = { world, P, layout };
  ok(layout.meta && layout.meta.kind === k.kind, k.kind + ' meta.kind 正确');
  ok(layout.meta.ruin && layout.meta.ruin.key === P.key, k.kind + ' meta.ruin.key 与推导键一致（阶段 2 定位接缝）');
  ok(layout.meta.ruin.ax === P.ax && layout.meta.ruin.ay === P.ay && layout.meta.ruin.az === P.az, k.kind + ' meta.ruin 锚点一致');
  ok(P.unlock.every((u) => world.get(u.x, u.y, u.z) !== 0), k.kind + ' 解封格出厂是实体方块（门体未开）');
  ok(P.unlock.every((u) => u.id === 0), k.kind + ' 解封写入目标是空气');
}
{
  const { world, P } = GEOM.tide_sluice;
  ok(world.get(P.keys[0].x, P.keys[0].y, P.keys[0].z) === id('water'), '潮闸房：水口是真空水源');
  ok(P.cells.every((c) => world.get(c.x, c.y, c.z) === 0), '潮闸房：标线格出厂是空的');
  ok(P.plugs.length === 2 && P.plugs.every((p) => world.get(p.x, p.y, p.z) === id('gravel')), '潮闸房：两处泥塞是砂砾（挖开即通水）');
  ok(world.get(AX + SLUICE_LAYOUT.markX, AY, AZ) === id('sea_lantern'), '潮闸房：标线列正下方是荧石标线');
}
{
  const { world, P } = GEOM.ember_circuit;
  ok(world.get(P.keys[0].x, P.keys[0].y, P.keys[0].z) === id('redstone_torch'), '烬火回路房：中央红石火把在场');
  ok(P.wires.length === 4 && P.wires.every((w) => world.get(w.x, w.y, w.z) === id('redstone_wire')), '烬火回路房：四条支路各保留一格导线');
  ok(P.gaps.length === 4 && P.gaps.every((g) => world.get(g.x, g.y, g.z) === 0), '烬火回路房：四条支路各留一处断线（空气）');
  ok(P.cells.every((c) => world.get(c.x, c.y, c.z) === id('redstone_lamp')), '烬火回路房：四盏灯出厂未点亮');
}
{
  const { world, P } = GEOM.frame_rack;
  ok(P.slots.every((s) => world.get(s.x, s.y, s.z) === 0), '构件架房：三槽出厂是空的');
  ok(P.keys.every((k) => world.get(k.x, k.y, k.z) === k.accept[0]), '构件架房：每槽托架镶边 = 该槽所需材料');
  ok(P.rack.every((r) => world.get(r.x, AY + 1, r.z) === r.id && world.get(r.x, AY + 2, r.z) === r.id), '构件架房：料架备 2 块同材料');
  ok(RACK_LAYOUT.slotXs.every((dx, i) => i === 0 || dx - RACK_LAYOUT.slotXs[i - 1] >= 3), '构件架槽距 ≥3（镶边不互相覆盖）');
}

// ── 五、完整解法 → solved ───────────────────────────────────────────────
for (const k of KINDS) {
  const { world, P } = GEOM[k.kind];
  k.solveCell(P, world);
  const res = evaluateRuin(P, world.sample());
  ok(res.state === RUIN_STATE_SOLVED, k.kind + ' 完整解法 → solved');
  ok(res.missing.length === 0 && res.badIndex === -1, k.kind + ' 完整解法无缺失无坏件');
}

// ── 六、半解 → locked 且 missing 非空 ──────────────────────────────────
for (const k of KINDS) {
  const { world, P } = GEOM[k.kind];
  const fresh = makeWorld(k.solve(makeRng(SEED ^ 0x5f5f), AX, AY, AZ, { seed: SEED }).blocks);
  k.halfCell(P, fresh);
  const res = evaluateRuin(P, fresh.sample());
  ok(res.state === RUIN_STATE_LOCKED, k.kind + ' 半解 → locked');
  ok(res.missing.length > 0 && res.missing.length < P.cells.length, k.kind + ' 半解 missing 非空且未满', String(res.missing.length));
  ok(res.badIndex === -1, k.kind + ' 半解不报缺件');
  ok(res.missing.every((m) => typeof m.label === 'string' && m.need), k.kind + ' missing 项带可读提示字段');
}

// ── 七、乱序/干扰不误判 ────────────────────────────────────────────────
{
  // 潮闸房：标线格换成岩浆（有水但不是水）→ 不判定解开
  const { P } = GEOM.tide_sluice;
  const w = makeWorld(GEOM.tide_sluice.layout.blocks);
  for (const c of P.cells) w.set(c.x, c.y, c.z, id('lava'));
  const res = evaluateRuin(P, w.sample());
  ok(res.state === RUIN_STATE_LOCKED, '潮闸房：标线格是岩浆 → 不算水位达标');
  // 干扰：房间里到处放水但标线格仍是空气 → 仍 locked
  const w2 = makeWorld(GEOM.tide_sluice.layout.blocks);
  for (const c of P.cells) w2.set(c.x, c.y, c.z, 0);
  w2.set(P.cells[0].x + 4, P.cells[0].y, P.cells[0].z + 4, id('water_flow_3'));
  ok(evaluateRuin(P, w2.sample()).state === RUIN_STATE_LOCKED, '潮闸房：旁处有水但不达标线 → locked');
}
{
  // 烬火回路房：只点亮三盏 → locked；把漏掉的第三盏灯挖成空气 → 仍 locked 且计入缺件
  const { P } = GEOM.ember_circuit;
  const w = makeWorld(GEOM.ember_circuit.layout.blocks);
  for (let i = 0; i < 3; i++) w.set(P.cells[i].x, P.cells[i].y, P.cells[i].z, id('redstone_lamp_lit'));
  const res = evaluateRuin(P, w.sample());
  ok(res.state === RUIN_STATE_LOCKED && res.missing.length === 1, '烬火回路房：三灯亮一灯暗 → locked（缺 1）');
  ok(res.missing[0].index === 3, '烬火回路房：missing 指向未亮的第 4 盏');
  const w2 = makeWorld(GEOM.ember_circuit.layout.blocks);
  for (let i = 0; i < 3; i++) w2.set(P.cells[i].x, P.cells[i].y, P.cells[i].z, id('redstone_lamp_lit'));
  w2.set(P.cells[3].x, P.cells[3].y, P.cells[3].z, 0);
  const res2 = evaluateRuin(P, w2.sample());
  ok(res2.state === RUIN_STATE_LOCKED && res2.badIndex === 4, '烬火回路房：灯被挖走 → badIndex 指向该灯');
}
{
  // 构件架房：把槽 1 的材料放进槽 2（乱序/错料）→ 两槽都算未满足
  const { P } = GEOM.frame_rack;
  const w = makeWorld(GEOM.frame_rack.layout.blocks);
  w.set(P.slots[1].x, P.slots[1].y, P.slots[1].z, P.slots[0].id);
  w.set(P.slots[2].x, P.slots[2].y, P.slots[2].z, P.slots[2].id);
  const res = evaluateRuin(P, w.sample());
  ok(res.state === RUIN_STATE_LOCKED, '构件架房：错料放进槽位 → locked');
  ok(res.missing.length === 2 && res.missing[0].index === 0 && res.missing[1].index === 1, '构件架房：错料使本槽与目标槽同时缺料');
  ok(res.missing[1].needName === P.slots[1].name, '构件架房：缺料提示带所需材料名');
}

// ── 八、关键件被挖毁 → badIndex ────────────────────────────────────────
for (const k of KINDS) {
  const { P } = GEOM[k.kind];
  const w = makeWorld(k.solve(makeRng(SEED ^ 0x5f5f), AX, AY, AZ, { seed: SEED }).blocks);
  k.solveCell(P, w);
  // 全解状态下挖掉关键件 0 → 只能报缺件（不能算解开）
  w.set(P.keys[0].x, P.keys[0].y, P.keys[0].z, 0);
  const res = evaluateRuin(P, w.sample());
  ok(res.state === RUIN_STATE_LOCKED && res.badIndex === 0, k.kind + ' 关键件被挖 → locked + badIndex=0');
  // 未加载区块（-1）同样视为缺件，绝不默认满足
  const unknown = evaluateRuin(P, () => -1);
  ok(unknown.state === RUIN_STATE_LOCKED && unknown.badIndex === 0 && unknown.missing.length === P.cells.length,
    k.kind + ' 未加载区块一律判未满足');
  const bad = evaluateRuin(P, null);
  ok(bad.state === RUIN_STATE_LOCKED && bad.missing.length === 0 && bad.badIndex === -1, k.kind + ' 无 sample 时安全回落');
}

// ── 九、轮询节流与状态机 ───────────────────────────────────────────────
{
  const { P } = GEOM.tide_sluice;
  const ruins = new Ruins(null);
  ruins.track(P);
  let calls = 0;
  const counting = (x, y, z) => { calls++; return 0; };
  const r1 = ruins.poll(0, counting);
  ok(r1.sampled === true && calls > 0, '首次 poll 采样');
  const after1 = calls;
  const r2 = ruins.poll(RUIN_POLL_MS - 1, counting);
  ok(r2.sampled === false && calls === after1, 'POLL_MS 内不重复采样（一次 sample 都不调）');
  const r3 = ruins.poll(RUIN_POLL_MS, counting);
  ok(r3.sampled === true && calls > after1, '满 POLL_MS 后恢复采样');
  ok(RUIN_POLL_MS === 250, '轮询节拍常量 = 0.25 秒');
  // 解开的机关：poll 报告一次 solved，随后移出待判定集，不再重复上报
  const solvedWorld = makeWorld(GEOM.tide_sluice.layout.blocks);
  KINDS[0].solveCell(P, solvedWorld);
  const r4 = ruins.poll(RUIN_POLL_MS * 2, solvedWorld.sample());
  ok(r4.solved.length === 1 && r4.solved[0] === P.key, 'poll 报告新解开的机关');
  ok(ruins.isSolved(P.key), 'poll 后状态机记为已解开');
  ok(ruins.targetsSize() === 0, '已解开的机关移出待判定集');
  const r5 = ruins.poll(RUIN_POLL_MS * 3, solvedWorld.sample());
  ok(r5.solved.length === 0, '已解开的机关不再重复上报（一次性）');
  ok(ruins.markSolved(P.key, 'Bob') === false, 'markSolved 单向：已解开不再改写');
  ok(ruins.stateAt(P.key) === RUIN_STATE_SOLVED, '状态 locked → solved 单向保持');
  ok(ruins.poll(0, counting).sampled === true, 'reset 前的时钟回退不影响采样（nowMs < last 也采样）');
}

// ── 十、序列化与回落 ───────────────────────────────────────────────────
{
  const ruins = new Ruins(null);
  ruins.markSolved('overworld|tide_sluice|1008|-2032', 'Alice', 1234);
  ruins.markSolved('nether|ember_circuit|-16|32', 'Bob');
  const restored = new Ruins(null).reset(ruins.serialize());
  ok(restored.isSolved('overworld|tide_sluice|1008|-2032') && restored.isSolved('nether|ember_circuit|-16|32'), '序列化往返保留状态');
  ok(restored.entries()[0].byName === 'Alice' && restored.entries()[0].at === 1234, '序列化往返保留归属与时间');
  ok(new Ruins(null).reset(null).size === 0, 'null 回落空账本（旧档兼容）');
  ok(new Ruins(null).reset('oops').size === 0, '非对象回落空账本');
  const dirty = new Ruins(null).reset({
    ruins: {
      'bad-key': { state: 'solved' },
      'overworld|village|0|0': { state: 'solved' },
      'overworld|tide_sluice|1|2': { state: 'locked' },
      'overworld|tide_sluice|3|4': { state: 'solved', byName: 'Ok', at: 7 },
      'aether|frame_rack|5|6': 'solved',
    },
  });
  ok(dirty.size === 2, '坏键/未知类型/未解状态被丢弃，扁平形态保留', String(dirty.size));
  ok(dirty.isSolved('overworld|tide_sluice|3|4') && dirty.isSolved('aether|frame_rack|5|6'), '合法项保留');
  ok(dirty.stateAt('overworld|tide_sluice|1|2') === RUIN_STATE_LOCKED, 'locked 项不入账本');
  ok(new Ruins(null).markSolved('bad-key', 'x') === false, 'markSolved 拒非法键');
  const capped = new Ruins(null);
  for (let i = 0; i < RUIN_LIMIT + 5; i++) capped.markSolved('overworld|tide_sluice|' + i + '|0', '');
  ok(capped.size === RUIN_LIMIT, '账本上限生效', String(capped.size));
  ok(capped.markSolved('overworld|tide_sluice|9999|9999', '') === false, '超限后拒绝新条目');
  capped.clear();
  ok(capped.size === 0 && capped.targetsSize() === 0, 'clear 清空账本与待判定集');
}

// ── 十一、解封写入与采样器 ─────────────────────────────────────────────
{
  const { P, layout } = GEOM.frame_rack;
  const cells = new Map();
  let writes = 0;
  const fakeWorld = {
    setBlock(x, y, z, v) { cells.set(x + ',' + y + ',' + z, v); writes++; },
    getBlock(x, y, z) {
      const v = cells.get(x + ',' + y + ',' + z);
      return v === undefined ? 0 : v;
    },
    getChunk() { return {}; },
    modifiedBlocks: new Map(),
  };
  const n = applyUnlock(fakeWorld, P);
  ok(n === P.unlock.length && writes === n, 'applyUnlock 逐格写入解封列表', String(n));
  ok(P.unlock.every((u) => cells.get(u.x + ',' + u.y + ',' + u.z) === 0), '解封写入后门体为空气');
  ok(applyUnlock(null, P) === 0 && applyUnlock(fakeWorld, null) === 0, 'applyUnlock 空参安全回落');
  // 采样器：账本优先；未加载区块返回 -1（不得读成空气）
  const sample = makeWorldSample(fakeWorld);
  ok(typeof sample === 'function', 'makeWorldSample 返回可调用采样器');
  ok(sample(P.inner.x, P.inner.y, P.inner.z) === 0, '已加载区块读世界方块');
  fakeWorld.modifiedBlocks.set(P.inner.x + ',' + P.inner.y + ',' + P.inner.z, id('stone_bricks'));
  ok(sample(P.inner.x, P.inner.y, P.inner.z) === id('stone_bricks'), '账本优先于已生成方块（挖毁/改动以账本为准）');
  const unloaded = { getBlock: () => 0, getChunk: () => null, modifiedBlocks: new Map() };
  ok(makeWorldSample(unloaded)(0, 0, 0) === -1, '未加载区块返回 -1 而非空气 0');
  ok(makeWorldSample(null) === null, '缺 world 时返回 null');
  ok(layout.blocks.length > 0, '结构布局非空');
}

// ── 十二、真实生成器接入：维度过滤 + 同 seed 双端一致 ──────────────────
function findRecord(gen, name, radius) {
  for (let cx = -radius; cx <= radius; cx++) {
    for (let cz = -radius; cz <= radius; cz++) {
      const rec = gen.structureManager.ensureRecord(name, cx, cz);
      if (rec) return rec;
    }
  }
  return null;
}
function recordPuzzleMatches(k, gen, rec) {
  const P = ruinPuzzle(SEED, k.dim, k.kind, rec.ax, rec.groundY, rec.az);
  if (!P || !rec.meta || !rec.meta.ruin) return false;
  if (rec.meta.ruin.key !== P.key) return false;
  const world = makeWorld(rec.blocks);
  for (const key of P.keys) {
    const accept = key.accept;
    if (accept.indexOf(world.get(key.x, key.y, key.z)) < 0) return false;
  }
  return true;
}
{
  const gens = {
    tide_sluice: [new TerrainGenerator(SEED), 12],
    ember_circuit: [new NetherGenerator(SEED), 10],
    frame_rack: [new AetherGenerator(SEED), 10],
  };
  for (const k of KINDS) {
    const [gen, radius] = gens[k.kind];
    const rec = findRecord(gen, k.kind, radius);
    ok(!!rec, k.kind + ' 在对应维度可被生成器放置（同 seed 定位）');
    if (rec) {
      ok(rec.name === k.kind && rec.blocks.length > 0, k.kind + ' 记录自洽（名称 + 布局非空）');
      ok(rec.minX <= rec.ax && rec.maxX >= rec.ax && rec.minZ <= rec.az && rec.maxZ >= rec.az, k.kind + ' 包围盒覆盖锚点');
      ok(rec.maxX - rec.minX <= k.def.radius * 2 && rec.maxZ - rec.minZ <= k.def.radius * 2, k.kind + ' 包围盒在声明的 radius 内');
      ok(recordPuzzleMatches(k, gen, rec), k.kind + ' 记录几何与 ruinPuzzle 推导一致（阶段 2 可直接接线）');
      const rec2 = new (gen.constructor)(SEED).structureManager.ensureRecord(k.kind, Math.floor(rec.ax / 16 / k.def.cell), Math.floor(rec.az / 16 / k.def.cell));
      ok(!!rec2 && rec2.ax === rec.ax && rec2.az === rec.az && rec2.groundY === rec.groundY, k.kind + ' 同 seed 双端解出同一锚点与地面高度');
      // 维度过滤：别的维度不参与
      if (k.kind !== 'tide_sluice') ok(new TerrainGenerator(SEED).structureManager.ensureRecord(k.kind, 0, 0) === null, k.kind + ' 主世界不参与（dims 过滤）');
      if (k.kind !== 'ember_circuit') ok(new NetherGenerator(SEED).structureManager.ensureRecord(k.kind, 0, 0) === null, k.kind + ' 下界不参与（dims 过滤）');
      if (k.kind !== 'frame_rack') ok(new AetherGenerator(SEED).structureManager.ensureRecord(k.kind, 0, 0) === null, k.kind + ' 天域不参与（dims 过滤）');
    }
  }
}

finish('ruin-unit');
