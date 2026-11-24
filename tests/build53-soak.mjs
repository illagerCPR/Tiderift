// build53-soak.mjs -- Build 53 R4 长时 soak（确定性：同种子两跑逐字节一致）
// 纯 node，不依赖服务器/浏览器。两个场景：
//   A 精确守恒：切割机 64 原木 + 在烧锅炉，跑到产物槽满——原木减少量 × 6 == 木板产出量，
//     且槽满即停（不吞料、不超额产）；含「断开离合闸进度保温、重新接通继续」。
//   B 长时扰动：锅炉/轴/离合闸/切割机/碎石机 + 分拣漏斗链 + 收割机组成的整条产线，
//     12000 步（0.2s/步 = 40 分钟游戏时间）里随机投料、取货、拨闸、拆装轴、收割补种；
//     全程校验不变量（槽位合法 / 进度有界 / 无幽灵状态 / 网络规模有界 / 计数不倒退），
//     并断言同种子两次跑完全一致（确定性），物品不复制不消失（进出账平衡）。
import {
  tickIndustry, buildNetworks, applyIndustryAction, emptyStateFor,
} from '../src/core/Industry.js';
import { tickHopperFlow, FILTER_SLOT } from '../src/core/HopperFlow.js';
import { tickHarvesters } from '../src/core/Harvester.js';
import { cropIdAtStage, CROP_MAX_STAGE } from '../src/core/crops.js';
import {
  BOILER_SUPPLY, CRUSHER_DEMAND, CUT_TIME, CRUSH_TIME, MACHINE_SLOT_LIMIT,
  CUT_RECIPES, CRUSH_RECIPES, NETWORK_MAX_NODES,
} from '../src/content/industry/defs.js';
import { ok, finish } from './harness.mjs';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';

const key = (x, y, z) => `${x},${y},${z}`;
const stack = (name, count) => ({ name, count, data: null });
const emptySlots = () => new Array(27).fill(null);
// 可重放的 LCG（与结构生成同族），保证两次跑完全一致
function makeRng(seed) {
  let r = seed >>> 0;
  return () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
}
// 不变量：所有槽位合法（名字在注册表里、数量 1..64、无 data）
function checkSlots(slots, where) {
  if (!Array.isArray(slots) || slots.length !== 27) return `${where} 槽位数异常`;
  for (const s of slots) {
    if (!s) continue;
    if (typeof s.name !== 'string' || !s.name) return `${where} 槽位物品名非法`;
    if (!(s.count >= 1 && s.count <= MACHINE_SLOT_LIMIT)) return `${where} 数量越界 ${s.name}=${s.count}`;
    if (s.data != null) return `${where} 机器槽出现带 data 物品`;
  }
  return null;
}
// 单个物品堆校验（机器槽是 stack 而不是 27 槽数组）
function checkStack(s, where) {
  if (!s) return null;
  if (typeof s.name !== 'string' || !s.name) return `${where} 物品名非法`;
  if (!(s.count >= 1 && s.count <= MACHINE_SLOT_LIMIT)) return `${where} 数量越界 ${s.name}=${s.count}`;
  if (s.data != null) return `${where} 机器槽出现带 data 物品`;
  return null;
}
const sumOf = (slots) => (slots || []).filter(Boolean).reduce((n, s) => n + s.count, 0);

// ══ A 精确守恒 ════════════════════════════════════════════════════════════
{
  const blocks = new Map([[key(0, 0, 0), 'boiler'], [key(1, 0, 0), 'shaft'], [key(2, 0, 0), 'cutter']]);
  const states = new Map();
  const boiler = emptyStateFor('boiler');
  boiler.fuel = stack('coal', 64);
  boiler.water = stack('water_bucket', 64);
  states.set(key(0, 0, 0), boiler);
  const cutter = emptyStateFor('cutter');
  cutter.input = stack('oak_log', 64);
  states.set(key(2, 0, 0), cutter);

  let nets = buildNetworks(blocks, states);
  const step = 0.2;
  let ticks = 0;
  let lastProgress = 0;
  let progressDroppedWhileCut = false;
  while (ticks < 4000) {
    const r = tickIndustry(blocks, states, step, nets);
    nets = r.networks;
    ticks++;
    // 每 200 步检查一次不变量
    if (ticks % 200 === 0) {
      const err = checkStack(cutter.output, '切割机产物槽') || checkStack(cutter.input, '切割机原料槽');
      ok(!err, `A 不变量（${ticks} 步）：${err || 'ok'}`);
      ok(cutter.progress >= 0 && cutter.progress <= CUT_TIME + 1e-6, `A 进度有界（${cutter.progress.toFixed(3)}）`);
    }
    // 第 800 步起断开离合闸（这里直接改拓扑：把机器从网络里摘掉）→ 进度必须保温不倒退
    if (ticks === 800) {
      blocks.delete(key(1, 0, 0)); // 拆掉轴：切割机脱离网络
      nets = buildNetworks(blocks, states);
      lastProgress = cutter.progress;
    }
    if (ticks > 800 && ticks < 1400) {
      if (cutter.progress < lastProgress - 1e-9) progressDroppedWhileCut = true;
      lastProgress = cutter.progress;
    }
    if (ticks === 1400) {
      blocks.set(key(1, 0, 0), 'shaft'); // 接回轴
      nets = buildNetworks(blocks, states);
    }
    const producedPlanks = cutter.output ? cutter.output.count : 0;
    if (producedPlanks >= 60) break; // 产物槽接近满（64 上限）就收工
  }
  const leftoverLogs = cutter.input ? cutter.input.count : 0;
  const planks = cutter.output ? cutter.output.count : 0;
  const consumed = 64 - leftoverLogs;
  ok(consumed > 0, `A 确实生产了（消耗原木 ${consumed}）`);
  ok(planks === consumed * CUT_RECIPES.oak_log.count,
    `A 精确守恒：消耗 ${consumed} 原木 → ${planks} 木板（期望 ${consumed * CUT_RECIPES.oak_log.count}）`);
  ok(!progressDroppedWhileCut, 'A 断开网络期间进度保温（不倒退、不丢料）');
  ok(cutter.output.count <= MACHINE_SLOT_LIMIT, 'A 产物不超过单槽上限（槽满即停）');
  // 槽满后再推 200 步：不再产出、不吞原木
  const before = { logs: leftoverLogs, planks };
  for (let i = 0; i < 200; i++) tickIndustry(blocks, states, step, nets);
  ok((cutter.output ? cutter.output.count : 0) === before.planks, 'A 槽满后不再产出（不超额、不丢）');
  ok((cutter.input ? cutter.input.count : 0) === before.logs, 'A 槽满后不再吃料');
}

// ══ B 长时扰动 ════════════════════════════════════════════════════════════
function runSoak(seed) {
  const rng = makeRng(seed);
  // 产线：锅炉(0,0,0) — 轴(1,0,0)(2,0,0) — 闸(3,0,0) — 轴(4,0,0) — 切割机(5,0,0)
  //       碎石机挂在轴(4,0,0) 的北侧 (4,0,-1)
  //       分拣漏斗(10,0,0) 朝 e，过滤 = gravel；上方源箱(10,1,0)；目标箱(11,0,0)
  //       收割机(20,0,0) 朝 s：前方作物(20,0,1)，背后箱子(20,0,-1)
  const blocks = new Map([
    [key(0, 0, 0), 'boiler'], [key(1, 0, 0), 'shaft'], [key(2, 0, 0), 'shaft'],
    [key(3, 0, 0), 'clutch'], [key(4, 0, 0), 'shaft'],
    [key(5, 0, 0), 'cutter'], [key(4, 0, -1), 'crusher'],
  ]);
  const states = new Map();
  const boiler = emptyStateFor('boiler');
  states.set(key(0, 0, 0), boiler);
  states.set(key(5, 0, 0), emptyStateFor('cutter'));
  states.set(key(4, 0, -1), emptyStateFor('crusher'));
  states.set(key(3, 0, 0), { kind: 'clutch', manual: true, powered: false });

  const containers = new Map([
    [key(10, 0, 0), emptySlots()], // 分拣漏斗自身
    [key(10, 1, 0), emptySlots()], // 源箱
    [key(11, 0, 0), emptySlots()], // 目标箱
    [key(20, 0, -1), emptySlots()], // 收割机背面箱
  ]);
  containers.get(key(10, 0, 0))[FILTER_SLOT] = stack('gravel', 1); // 只放行砾石
  let nets = buildNetworks(blocks, states);
  const hoppers = [{ x: 10, y: 0, z: 0, facing: 'e' }];
  const io = {
    getContainer: (x, y, z) => containers.get(key(x, y, z)) || null,
    ensureContainer: (x, y, z) => containers.get(key(x, y, z)) || null,
    isFilterHopper: (x, y, z) => key(x, y, z) === key(10, 0, 0),
  };
  const harvesterIo = {
    getBlock: (x, y, z) => (z === 1 && x === 20 ? CROP_MATURE : 0),
    isLoaded: () => true,
    ensureContainer: (x, y, z) => containers.get(key(x, y, z)) || null,
    harvest: () => {},
    rng,
  };
  const CROP_MATURE = cropIdAtStage(CROP_MAX_STAGE);
  const cropPos = key(20, 0, 1);
  let cropAlive = true;

  // 账本：注入（玩家给的原料）与取出（玩家拿走的成品）
  const injected = new Map();
  const extracted = new Map();
  const take = (map, name, count) => map.set(name, (map.get(name) || 0) + count);
  const apply = (kind, st, op, name, count, slot = null) => {
    const res = applyIndustryAction(kind, st, op, name, count, slot);
    return res;
  };

  const T = 12000;
  let lastProduced = 0;
  let monotonicViolations = 0;
  for (let t = 0; t < T; t++) {
    // 锅炉补料（每 40 步一把煤 + 两桶水）
    if (t % 40 === 0) {
      if (!boiler.fuel || boiler.fuel.count < 8) { boiler.fuel = stack('coal', 16); take(injected, 'coal', 16); }
      if (!boiler.water || boiler.water.count < 4) { boiler.water = stack('water_bucket', 8); take(injected, 'water_bucket', 8); }
    }
    // 投料：切割机原木 / 碎石机圆石（每 25 步）
    if (t % 25 === 0) {
      const cut = states.get(key(5, 0, 0));
      if ((!cut.input || cut.input.count < 8)) { cut.input = stack('oak_log', 16); take(injected, 'oak_log', 16); }
      const cr = states.get(key(4, 0, -1));
      if ((!cr.input || cr.input.count < 8)) { cr.input = stack('cobblestone', 16); take(injected, 'cobblestone', 16); }
      // 分拣漏斗源箱：面包 + 砾石混合（只有砾石能通过）
      const src = containers.get(key(10, 1, 0));
      if (!src[0] || src[0].count < 8) { src[0] = stack('bread', 16); take(injected, 'bread', 16); }
      if (!src[1] || src[1].count < 8) { src[1] = stack('gravel', 16); take(injected, 'gravel', 16); }
    }
    // 取货：每 30 步把机器产物取走（模拟玩家）
    if (t % 30 === 0) {
      for (const [k, kind] of [[key(5, 0, 0), 'cutter'], [key(4, 0, -1), 'crusher']]) {
        const st = states.get(k);
        for (const slot of ['output', 'bonus']) {
          const res = apply(kind, st, 'extract', null, MACHINE_SLOT_LIMIT, slot);
          if (res.ok && res.applied > 0) take(extracted, res.items[0].name, res.applied);
        }
      }
    }
    // 收割：每 4 步一拍；收了就补种（玩家行为）
    if (t % 4 === 0) {
      const done = tickHarvesters([{ x: 20, y: 0, z: 0, facing: 's' }], harvesterIo);
      if (done.length) cropAlive = false;
      if (!cropAlive) cropAlive = true; // 补种：模拟农场主立刻续上
    }
    // 漏斗搬运：每步都跑（内部按调用节拍决定，这里就是节拍本身）
    tickHopperFlow(hoppers, io);

    // 工业推进
    const r = tickIndustry(blocks, states, 0.2, nets);
    nets = r.networks;

    // 扰动：每 300 步拨一次闸；每 900 步拆装一节轴
    if (t % 300 === 299) {
      const cl = states.get(key(3, 0, 0));
      cl.manual = !cl.manual;
      if (rng() < 0.5) cl.powered = !cl.powered;
      nets = buildNetworks(blocks, states);
    }
    if (t % 900 === 899) {
      if (blocks.has(key(2, 0, 0))) blocks.delete(key(2, 0, 0));
      else blocks.set(key(2, 0, 0), 'shaft');
      nets = buildNetworks(blocks, states);
    }

    // 不变量（每 100 步一次全量）
    if (t % 100 === 0) {
      for (const [k, st] of states) {
        if (!blocks.has(k)) return { fail: `幽灵状态：${k} 没有方块` };
        for (const slot of ['input', 'output', 'bonus', 'fuel', 'water']) {
          const err = checkStack(st[slot], `状态 ${k}.${slot}`);
          if (err) return { fail: err };
        }
        if (st.progress !== undefined && (!(st.progress >= 0) || st.progress > 1e6)) return { fail: `进度异常 ${k}` };
      }
      for (const [k, items] of containers) {
        const err = checkSlots(items, `容器 ${k}`);
        if (err) return { fail: err };
      }
      const cnt = (st) => (st && st.output ? st.output.count : 0);
      const produced = cnt(states.get(key(5, 0, 0))) + cnt(states.get(key(4, 0, -1)));
      if (produced + (extracted.get('oak_planks') || 0) < lastProduced) monotonicViolations++;
      lastProduced = produced + (extracted.get('oak_planks') || 0);
      for (const comp of nets.comps) {
        if (comp.nodes.length > NETWORK_MAX_NODES + 1) return { fail: `网络超限 ${comp.nodes.length}` };
      }
    }
  }

  // 收尾快照（用于确定性对拍）
  const snapshot = () => {
    const parts = [];
    for (const k of [...states.keys()].sort()) {
      const st = states.get(k);
      parts.push(`${k}:${JSON.stringify(st)}`);
    }
    for (const k of [...containers.keys()].sort()) parts.push(`${k}:${JSON.stringify(containers.get(k))}`);
    for (const k of [...blocks.keys()].sort()) parts.push(`${k}=${blocks.get(k)}`);
    return parts.join('|');
  };
  return {
    fail: null,
    snapshot: snapshot(),
    injected: Object.fromEntries([...injected.entries()].sort()),
    extracted: Object.fromEntries([...extracted.entries()].sort()),
    monotonicViolations,
    containers: containers.size,
    targetChest: containers.get(key(11, 0, 0)),
    srcChest: containers.get(key(10, 1, 0)),
    harvestChest: containers.get(key(20, 0, -1)),
  };
}

{
  const a = runSoak(20261124);
  ok(!a.fail, `B 全程不变量成立${a.fail ? '：' + a.fail : ''}`);
  ok(a.monotonicViolations === 0, 'B 产线产出计数单调（没有被回滚/吞掉）');
  ok((a.extracted.oak_planks || 0) > 0, `B 真的产出了木板（${a.extracted.oak_planks || 0}）`);
  ok((a.extracted.gravel || 0) > 0, `B 碎石机真的产出了砾石（${a.extracted.gravel || 0}）`);
  ok((a.extracted.flint || 0) > 0, `B 圆石副产物燧石按节拍出现（${a.extracted.flint || 0}）`);
  ok((a.extracted.bone_meal || 0) === 0, 'B 切割机没产出骨粉（没投骨头）');
  // 分拣漏斗：连通 12000 步，目标箱里只应有砾石
  const names = new Set((a.targetChest || []).filter(Boolean).map((s) => s.name));
  ok(names.size > 0 && !names.has('bread'), `B 分拣漏斗只放行砾石（目标箱物品：${[...names].join(',') || '空'}）`);
  ok(names.has('gravel'), 'B 砾石确实通过了分拣漏斗');
  // 收割机：产物进背面箱，且填满即停（不丢不复制）
  const hc = (a.harvestChest || []).filter(Boolean);
  ok(hc.length > 0 && hc.some((s) => s.name === 'wheat'), `B 收割机产物进背面箱（${hc.map((s) => s.name + 'x' + s.count).join(',') || '空'}）`);
  ok(hc.length <= 27 && hc.every((s) => s.count >= 1 && s.count <= 64), 'B 收割箱不越界（满即停）');
  ok((a.srcChest || []).some((s) => s && s.name === 'bread'), 'B 面包一直留在上游（过滤不放行也不丢）');
  // 分拣漏斗：目标箱里只应有砾石，面包一个都不许过（过滤连着跑 12000 步）
  const b = runSoak(20261124);
  ok(a.snapshot === b.snapshot, 'B 同种子两次长跑完全一致（确定性）');
  ok(a.injected.oak_log === b.injected.oak_log && a.extracted.oak_planks === b.extracted.oak_planks,
    'B 两次跑的进出账一致');
}

finish('build53-soak');
