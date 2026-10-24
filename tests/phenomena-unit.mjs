// phenomena-unit.mjs -- Build 37 G 局部潮候与稀有景象的纯逻辑回归（纯 node，不依赖服务器/浏览器）
// 覆盖：四维现象定义与窗口、预兆 60 秒（随 dayLength 折算）、阶段/强度/倒计时边界、观测累计语义、
//       游记 phenomena 桶（去重/集齐/一次性纪念/序列化/旧档回落）、潮候铭牌方块 ID 与纹理、
//       红线守卫（表现层不得写方块）、开关默认值，以及 PhenomenaView 的真实累计与发放路径。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, assert, finish } from './harness.mjs';
import '../src/blocks/BlockDefs.js'; // 副作用注册（必须先于读 BlockRegistry）
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { DEFAULT_SETTINGS } from '../src/core/Settings.js';
import { Journal } from '../src/core/Journal.js';
import { PhenomenaView } from '../src/player/PhenomenaView.js';
import {
  PHENOMENA, PHENOMENON_ORDER, OBSERVE_SECONDS, OMEN_SECONDS,
  advanceDwell, anchorKeyOf, observable, omenFraction, phaseAt, phenomenonFor,
} from '../src/core/Phenomena.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, '..', rel), 'utf8');

// ── 1. 定义表 ────────────────────────────────────────────────────────────────
assert('四维各一种现象', PHENOMENON_ORDER.length === 4 && PHENOMENON_ORDER.every((d) => !!phenomenonFor(d)));
const kinds = PHENOMENON_ORDER.map((d) => PHENOMENA[d].kind);
assert('四种现象种类互不相同', new Set(kinds).size === 4, kinds.join(','));
assert('未实现的维度没有现象定义', phenomenonFor('nowhere') === null);
for (const dim of PHENOMENON_ORDER) {
  const [start, end] = PHENOMENA[dim].window;
  ok(start > 0 && end <= 1 && start < end, `${dim} 窗口在 (0,1] 内且不跨午夜：${start}~${end}`);
  ok(Array.isArray(PHENOMENA[dim].color) && PHENOMENAS_COLOR_OK(PHENOMENA[dim].color), `${dim} 有合法配色`);
}
function PHENOMENAS_COLOR_OK(c) {
  return c.length === 3 && c.every((v) => typeof v === 'number' && v >= 0 && v <= 1);
}

// ── 2. 预兆 60 秒：按 dayLength 折算成当日时间比例 ───────────────────────────
ok(Math.abs(omenFraction(1200) - 60 / 1200) < 1e-9, '一天 1200 秒时预兆占 0.05 日');
ok(Math.abs(omenFraction(1200) * 1200 - OMEN_SECONDS) < 1e-6, '预兆秒数恒为 60 秒（1200 秒一天）');
ok(Math.abs(omenFraction(2400) * 2400 - OMEN_SECONDS) < 1e-6, '一天 2400 秒时预兆仍是 60 秒');
ok(omenFraction(0) > 0 && omenFraction(NaN) > 0, '非法 dayLength 回落到默认 1200 秒');

// ── 3. 阶段边界 ──────────────────────────────────────────────────────────────
{
  const [start, end] = PHENOMENA.overworld.window;
  const day = 1200, om = omenFraction(day);
  const idle = phaseAt('overworld', start - om - 0.01, day);
  ok(idle.phase === 'idle' && idle.kind === 'shore_glow', '预兆窗口之前 = idle');
  const omen = phaseAt('overworld', start - om / 2, day);
  ok(omen.phase === 'omen' && omen.kind === 'shore_glow', '预兆窗口内 = omen');
  ok(Math.abs(omen.secondsToStart - (om / 2) * day) < 1e-6, `预兆剩余秒数按比例折算（${omen.secondsToStart}）`);
  const justStarted = phaseAt('overworld', start, day);
  ok(justStarted.phase === 'active' && justStarted.progress === 0, '窗口起点 = active 且进度 0');
  ok(justStarted.intensity === 0, '起点强度 0（淡入）');
  const mid = phaseAt('overworld', (start + end) / 2, day);
  ok(mid.phase === 'active' && Math.abs(mid.progress - 0.5) < 1e-9 && mid.intensity === 1, '中点强度拉满');
  ok(Math.abs(mid.secondsLeft - ((end - start) / 2) * day) < 1e-6, '剩余秒数按窗口折算');
  const after = phaseAt('overworld', end, day);
  ok(after.phase === 'idle', '窗口结束回到 idle');
  ok(Math.abs(after.secondsToOmen - ((start - om) + 1 - end) * day) < 1e-6, '跨午夜的下一次预兆倒计时正确');
  const wrapped = phaseAt('overworld', 0.01, day);
  ok(wrapped.phase === 'idle' && wrapped.secondsToOmen > 0 && wrapped.secondsToOmen < 0.75 * day, '午夜后倒计时不越界');
  ok(phaseAt('overworld', 1.25, day).phase === phaseAt('overworld', 0.25, day).phase, '当日时间按小数回绕');
  ok(phaseAt('nowhere', 0.5, day).phase === 'idle' && phaseAt('nowhere', 0.5, day).kind === null, '未知维度恒为 idle');
  ok(phaseAt('overworld', 0.5, day).phase === 'idle', '正午不在任何潮候窗口内');
  assert('四维窗口互不重叠（不会同时两种现象）', nonOverlap(), PHENOMENON_ORDER.join(','));
}
function nonOverlap() {
  const spans = PHENOMENON_ORDER.map((d) => PHENOMENA[d].window).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1]) return false;
  return true;
}

// ── 4. 观测累计语义 ──────────────────────────────────────────────────────────
{
  let s = advanceDwell(0, true, 0.5, 2);
  ok(Math.abs(s.dwell - 0.5) < 1e-9 && !s.ready, 'ok 时累加未到门槛不结算');
  s = advanceDwell(s.dwell, true, 2, 2);
  ok(s.ready && Math.abs(s.dwell - 2) < 1e-9, '满门槛即 ready 且不超过门槛');
  s = advanceDwell(2, true, 10, 2);
  ok(s.dwell === 2, '已满时继续累计不越界');
  s = advanceDwell(2, false, 0.5, 2);
  ok(Math.abs(s.dwell - 1) < 1e-9 && !s.ready, '离开视野按两倍速回退');
  s = advanceDwell(0.2, false, 5, 2);
  ok(s.dwell === 0, '回退到 0 不出现负数');
  ok(advanceDwell(0, true, 0, 2).dwell === 0, 'dt=0 不推进');
  ok(OBSERVE_SECONDS > 0 && OBSERVE_SECONDS <= 15, `观测门槛在合理区间（${OBSERVE_SECONDS}s）`);
}

// ── 5. 强度门槛与锚点 ───────────────────────────────────────────────────────
{
  const [start, end] = PHENOMENA.nether.window;
  const fading = phaseAt('nether', start + (end - start) * 0.02, 1200);
  ok(fading.phase === 'active' && fading.intensity < 0.45, '淡入期强度不足');
  ok(!observable(fading), '淡入期不计数');
  ok(observable(phaseAt('nether', (start + end) / 2, 1200)), '正盛期计数');
  ok(!observable(phaseAt('nether', 0.9, 1200)), 'idle 不计数');
  ok(anchorKeyOf(63, -1) === '0,-1' && anchorKeyOf(64, -65) === '1,-2', '锚键按 64 格取整（含负数）');
}

// ── 6. 游记 phenomena 桶 ────────────────────────────────────────────────────
{
  const journal = new Journal({});
  ok(journal.phenomena.length === 0 && journal.phenomenaCount() === 0, '新游记无潮候记录');
  ok(journal.recordPhenomenon('overworld', 'shore_glow', '3,-2') === true, '合法记录写入成功');
  ok(journal.recordPhenomenon('overworld', 'shore_glow', '9,9') === false, '同维度同现象只记一次');
  ok(journal.recordPhenomenon('overworld', 'ash_tide', '0,0') === false, '维度与现象种类不匹配被拒');
  ok(journal.recordPhenomenon('nowhere', 'ash_tide', '0,0') === false, '未知维度被拒');
  ok(journal.recordPhenomenon('nether', 'ash_tide', 'not-a-key') === true, '非法锚键仍记录但锚点回落');
  ok(journal.phenomena[1].anchor === '0,0', '非法锚键回落 0,0');
  ok(journal.hasPhenomenon('overworld') && !journal.hasPhenomenon('end'), 'hasPhenomenon 判定正确');
  ok(journal.phenomenaCount() === 2 && !journal.phenomenaComplete(), '两条记录未集齐');
  ok(journal.claimPhenomenaSouvenir() === false, '未集齐不能领纪念');
  journal.recordPhenomenon('end', 'silent_tide', '5,5');
  journal.recordPhenomenon('aether', 'aurora_flow', '7,7');
  ok(journal.phenomenaComplete(), '四种集齐');
  ok(journal.claimPhenomenaSouvenir() === true, '集齐后第一次可领');
  ok(journal.claimPhenomenaSouvenir() === false, '纪念只发一次');

  const snap = journal.serialize();
  ok(Array.isArray(snap.phenomena) && snap.phenomena.length === 4, '序列化包含四条记录');
  ok(snap.phenomenaSouvenir === true, '序列化包含纪念发放标记');
  const restore = new Journal({});
  restore.reset(snap);
  ok(restore.phenomenaCount() === 4 && restore.phenomenaSouvenir === true, '反序列化完整还原');
  ok(restore.phenomena.every((p) => typeof p.dim === 'string' && typeof p.kind === 'string' && typeof p.anchor === 'string'), '记录字段齐全');

  const legacy = new Journal({});
  legacy.reset({ explored: {}, discoveries: [] });
  ok(legacy.phenomena.length === 0 && legacy.phenomenaSouvenir === false, '旧档缺 phenomena 字段回落空表');

  const dirty = new Journal({});
  dirty.reset({ phenomena: [
    { dim: 'nether', kind: 'shore_glow' },              // 种类不匹配
    { dim: 'nowhere', kind: 'ash_tide' },               // 维度非法
    { dim: 'nether', kind: 'ash_tide', anchor: 'bad' }, // 合法但锚键脏
    { dim: 'nether', kind: 'ash_tide', anchor: '1,1' }, // 重复
  ] });
  ok(dirty.phenomena.length === 1, `脏数据只保留合法项（${dirty.phenomena.length}）`);
  ok(dirty.phenomena[0].anchor === '0,0', '脏锚键回落 0,0');
  dirty.phenomenaSouvenir = false;
  ok(dirty.claimPhenomenaSouvenir() === false, '未集齐时即使标记被篡改也发不出纪念');
}

// ── 7. 开关默认值与红线守卫 ─────────────────────────────────────────────────
ok(DEFAULT_SETTINGS.phenomena === true, '潮候现象默认开启');
ok(!read('src/player/PhenomenaView.js').includes('setBlock('), '表现层不写方块（红线）');
ok(!/from '\.\.\/core\/(World|FluidSim)/.test(read('src/player/PhenomenaView.js')), '表现层不引入世界写入口');
const pure = read('src/core/Phenomena.js');
ok(!/import .*World|import .*FluidSim|import .*BlockRegistry/.test(pure), '阶段推导是纯函数（不依赖世界）');
ok(!/Math\.random\s*\(/.test(pure), '阶段推导不使用随机数（两端一致）');

// ── 8. 纪念方块 ─────────────────────────────────────────────────────────────
{
  const plaque = BlockRegistry.getByName('tide_plaque');
  ok(!!plaque, '潮候铭牌已注册');
  ok(plaque.id > 220, `铭牌 ID 追加在末尾（${plaque && plaque.id}）`);
  ok(plaque.displayName === '潮候铭牌', '铭牌有中文显示名');
  ok(!!BlockRegistry.getByName('hopper') && BlockRegistry.getByName('hopper').id === 217, '既有方块 ID 零漂移（hopper=217）');
  ok(!!BlockRegistry.getByName('furnace') && BlockRegistry.getByName('furnace').id === 71, '既有方块 ID 零漂移（furnace=71）');
  for (const tex of ['tide_plaque_top', 'tide_plaque_side', 'tide_plaque_bottom']) {
    ok(typeof BlockSVGDefinitions[tex] === 'string' && BlockSVGDefinitions[tex].startsWith('<svg'), `纹理 ${tex} 已生成`);
  }
}

// ── 9. 表现层集成：真实累计、预兆不计数、纪念发放 ────────────────────────────
{
  const waterId = BlockRegistry.getByName('water').id;
  const makeGame = (opts = {}) => {
    const spawns = [], toasts = [];
    const game = {
      settings: { phenomena: opts.enabled !== false },
      sky: { time: opts.time ?? 0.82, dayLength: 1200 },
      world: { dimension: opts.dim ?? 'overworld', getBlock: () => (opts.water === false ? 0 : waterId) },
      player: { position: { x: 3, y: 70, z: -5 }, dead: false, spectator: false },
      spectating: false,
      particles: { densityScale: 1, spawn: (...args) => spawns.push(args) },
      inventory: { add: () => (opts.invFull ? 1 : 0) },
      hotbar: { update: () => {} },
      hud: { showToast: (msg) => toasts.push(msg) },
      journal: new Journal({}),
      _inUpdraft: false,
    };
    return { game, spawns, toasts };
  };
  const run = (view, seconds, dt = 0.5) => { for (let t = 0; t < seconds; t += dt) view.update(dt); };

  const a = makeGame();
  const viewA = new PhenomenaView(a.game);
  ok(viewA._emitAt < 0, '首次发射不被节流初值吞掉（_emitAt 初值取负）');
  run(viewA, OBSERVE_SECONDS * 0.5);
  ok(a.game.journal.phenomenaCount() === 0, '未达门槛不记录');
  ok(viewA.dwell > 0, '观测累计在推进');
  ok(a.spawns.length > 0, '涌现期生成粒子');
  run(viewA, OBSERVE_SECONDS + 2);
  ok(a.game.journal.phenomenaCount() === 1, `持续观测后记录一条（${a.game.journal.phenomenaCount()}）`);
  ok(a.game.journal.phenomena[0].kind === 'shore_glow', '记录的现象种类正确');
  ok(a.toasts.some((m) => m.includes('游记')), '记录后给出提示');
  run(viewA, OBSERVE_SECONDS * 2);
  ok(a.game.journal.phenomenaCount() === 1, '已记录后不再重复计数');

  const b = makeGame({ water: false });
  const viewB = new PhenomenaView(b.game);
  run(viewB, OBSERVE_SECONDS * 2);
  ok(b.game.journal.phenomenaCount() === 0, '不在景观附近不计（无水面）');
  ok(viewB.dwell === 0, '看不见时累计回退到 0');

  const omenTime = PHENOMENA.overworld.window[0] - omenFraction(1200) / 2;
  const c = makeGame({ time: omenTime });
  const viewC = new PhenomenaView(c.game);
  run(viewC, OBSERVE_SECONDS * 2);
  ok(c.game.journal.phenomenaCount() === 0, '预兆期不计数');
  ok(viewC.state.phase === 'omen' && viewC.hintText().includes('预兆'), '预兆期文案正确');

  const d = makeGame({ enabled: false });
  const viewD = new PhenomenaView(d.game);
  run(viewD, OBSERVE_SECONDS * 2);
  ok(d.spawns.length === 0 && d.toasts.length === 0, '关闭开关后无粒子与提示');
  ok(d.game.journal.phenomenaCount() === 0, '关闭开关后不计数');

  const e = makeGame();
  for (const [dim, kind] of [['nether', 'ash_tide'], ['end', 'silent_tide'], ['aether', 'aurora_flow']]) {
    e.game.journal.recordPhenomenon(dim, kind, '0,0');
  }
  const viewE = new PhenomenaView(e.game);
  run(viewE, OBSERVE_SECONDS + 2);
  ok(e.game.journal.phenomenaCount() === 4, '集齐第四种');
  ok(e.game.journal.phenomenaSouvenir === true, '集齐后纪念已发放');
  ok(e.toasts.some((m) => m.includes('潮候铭牌')), '发放时提示铭牌');

  const f = makeGame({ invFull: true });
  for (const [dim, kind] of [['nether', 'ash_tide'], ['end', 'silent_tide'], ['aether', 'aurora_flow']]) {
    f.game.journal.recordPhenomenon(dim, kind, '0,0');
  }
  const viewF = new PhenomenaView(f.game);
  run(viewF, OBSERVE_SECONDS + 2);
  ok(f.game.journal.phenomenaCount() === 4 && f.game.journal.phenomenaSouvenir === false, '背包满时纪念退回未领取');
  ok(f.toasts.some((m) => m.includes('背包已满')), '背包满时给出提示');

  const g2 = makeGame({ dim: 'end' });
  const viewG = new PhenomenaView(g2.game);
  viewG.update(0.5);
  ok(viewG.state.kind === 'silent_tide', '末地取无声之潮');
  viewG.dispose();
  ok(viewG.state === null && viewG.dwell === 0, 'dispose 清空表现层状态');
}

finish();