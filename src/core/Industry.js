// core/Industry.js -- 潮工（工业）的纯算法（Build 51 R3 起 / Build 52 扩展）
// 单机本地 tick 与服务器权威 tick **共用这一份**：拓扑求值、供需效率、锅炉燃烧、加工机推进、
// 离合闸通断、槽位投料/取出、机器状态派生。无 DOM / 无 Three / 无世界对象依赖，node 可测。
//
// 模型（docs/extra-content-master-plan.md §5.4）：
//   · 网络 = 锅炉 / 传动轴 / 加工机 / 离合闸按 6 邻接形成的连通分量；拓扑由方块账本派生，**不持久化**。
//   · 离合闸断开的格子不导流（等于把轴锯断），断开的闸自身成为不导流的孤立节点。
//   · 供给 = 所有在烧锅炉之和；需求 = 所有有活可干的加工机之和；效率 = min(1, 供给/需求)。
//   · 不储存能量、不积累欠账：熄火即停；dt 一律钳到 ≤1s，重载/卡顿不追赶离线生产。
//   · 只有机器槽位与加工进度持久化（状态对象），拓扑每次方块变化后重建（调用方缓存）。
import {
  BOILER_SUPPLY, IDLE_DECAY_PER_SEC, MACHINE_DEMAND, MACHINE_SLOTS, MACHINE_SLOT_LIMIT,
  NETWORK_MAX_NODES, processorRecipeFor, processorTime, crushByproductFor,
} from '../content/industry/defs.js';
import { getFuelTime } from './Smelting.js';

const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function neighborKeys(key) {
  const parts = key.split(',');
  const x = Number(parts[0]), y = Number(parts[1]), z = Number(parts[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return [];
  const out = [];
  for (const [dx, dy, dz] of NEIGHBORS) out.push(`${x + dx},${y + dy},${z + dz}`);
  return out;
}

// ── 状态 ────────────────────────────────────────────────────────────────
export function emptyBoilerState() {
  return { kind: 'boiler', fuel: null, water: null, output: null, burnTime: 0, burnMax: 0 };
}

// 加工机（碎石机 / 切割机）共用形状：input / output / bonus + 进度 + 已完成计数（副产物节拍）
export function emptyProcessorState(kind) {
  return { kind, input: null, output: null, bonus: null, progress: 0, cycles: 0 };
}

export function emptyCrusherState() { return emptyProcessorState('crusher'); }
export function emptyCutterState() { return emptyProcessorState('cutter'); }

// 离合闸：manual = 手动拨杆（默认接通）；powered = 是否有红石信号（信号优先 → 强制断开）
export function emptyClutchState() {
  return { kind: 'clutch', manual: true, powered: false };
}

export function emptyStateFor(kind) {
  if (kind === 'boiler') return emptyBoilerState();
  if (kind === 'crusher' || kind === 'cutter') return emptyProcessorState(kind);
  if (kind === 'clutch') return emptyClutchState();
  // B53 R3：潮压表是纯只读仪表——状态只为界面取标题/读数而存在，永不落盘、不产不耗
  if (kind === 'gauge') return { kind: 'gauge' };
  return null; // shaft 无状态
}

// 离合闸是否导流：红石信号优先（有信号即断开），无信号时按手动拨杆；状态缺失按接通（不静默断网）
export function clutchEngaged(st) {
  if (!st || st.kind !== 'clutch') return true;
  if (st.manual === false) return false;
  return st.powered !== true;
}

// 手动拨杆切换（返回新状态描述，不碰红石字段）
export function toggleClutch(st) {
  if (!st || st.kind !== 'clutch') return { ok: false, code: 'invalid' };
  st.manual = st.manual === false;
  return { ok: true, code: 'toggled', engaged: clutchEngaged(st) };
}

// 本地红石观测 → 需要写入的离合闸信号列表（纯函数：单机与联机共用同一判定）。
// powerAt(x,y,z) 返回该格是否有红石信号（>0）。只有和已知状态不一致时才产生条目。
export function pendingClutchSignals(blocks, states, powerAt) {
  const out = [];
  if (!blocks || typeof powerAt !== 'function') return out;
  for (const [key, kind] of blocks) {
    if (kind !== 'clutch') continue;
    const parts = key.split(',');
    const x = Number(parts[0]), y = Number(parts[1]), z = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const powered = !!powerAt(x, y, z);
    const st = states ? states.get(key) : null;
    const known = st && st.kind === 'clutch' ? st.powered === true : false;
    if (known === powered) continue;
    out.push({ key, x, y, z, powered });
  }
  return out;
}

// 红石信号写入；返回 true = 导流状态因此改变（调用方要重建拓扑 + 广播）
export function setClutchPowered(st, on) {
  if (!st || st.kind !== 'clutch') return false;
  const before = clutchEngaged(st);
  st.powered = !!on;
  return clutchEngaged(st) !== before;
}

// ── 槽位工具（两端共用；槽位形状 = {name,count,data} 或 null）─────────────
function stackLimitOf(name) {
  void name; // 工业机器槽恒 64（不承接带 data 物品）
  return MACHINE_SLOT_LIMIT;
}

export function spaceIn(slot, name) {
  if (!slot) return MACHINE_SLOT_LIMIT;
  if (slot.name !== name) return 0;
  return Math.max(0, stackLimitOf(name) - slot.count);
}

function addToSlot(slot, name, count) {
  if (count <= 0) return slot;
  if (!slot) return { name, count, data: null };
  return { ...slot, count: slot.count + count };
}

// 取走至多 count 个（返回新槽位），调用方负责把物品交给玩家/容器
function takeFromSlot(slot, count) {
  if (!slot || count <= 0) return { slot, taken: 0 };
  const taken = Math.min(slot.count, count);
  const left = slot.count - taken;
  return { slot: left > 0 ? { ...slot, count: left } : null, taken };
}

// 槽位指纹：判断一次 tick 是否改动了内容物（供调用方决定即时广播/落盘）
function slotSig(s) {
  return s ? `${s.name}|${s.count}` : '-';
}

function stateSig(st) {
  if (!st) return '';
  if (st.kind === 'boiler') return `${slotSig(st.fuel)}/${slotSig(st.water)}/${slotSig(st.output)}`;
  if (st.kind === 'clutch') return `m${st.manual === false ? 0 : 1}p${st.powered ? 1 : 0}`;
  return `${slotSig(st.input)}/${slotSig(st.output)}/${slotSig(st.bonus)}`;
}

// ── 拓扑 ────────────────────────────────────────────────────────────────
// blocks: Map("x,y,z" -> 'boiler'|'shaft'|'crusher'|'cutter'|'clutch')
// states: Map("x,y,z" -> state)（可选；只用于读离合闸通断，缺状态按接通）
// 返回 { compOf: Map(key -> 分量下标), comps: [{nodes, boilers, machines, crushers, cutters, overLimit, supply, demand, efficiency}] }
export function buildNetworks(blocks, states = null) {
  const compOf = new Map();
  const comps = [];
  if (!blocks || blocks.size === 0) return { compOf, comps };
  const conducts = (key) => {
    if (blocks.get(key) !== 'clutch') return true;
    return clutchEngaged(states ? states.get(key) : null);
  };
  for (const key of blocks.keys()) {
    if (compOf.has(key)) continue;
    const idx = comps.length;
    const comp = {
      nodes: [], boilers: [], machines: [], crushers: [], cutters: [],
      cuts: [], // B53 R3：本网络里断开的离合闸（"断路位置"，压力表读它）
      overLimit: false, supply: 0, demand: 0, efficiency: 0,
    };
    const stack = [key];
    compOf.set(key, idx);
    while (stack.length) {
      const k = stack.pop();
      comp.nodes.push(k);
      const kind = blocks.get(k);
      if (kind === 'boiler') comp.boilers.push(k);
      else if (kind === 'crusher' || kind === 'cutter') {
        comp.machines.push(k);
        if (kind === 'crusher') comp.crushers.push(k);
        else comp.cutters.push(k);
      }
      if (!conducts(k)) { comp.cuts.push(k); continue; } // 断开的离合闸：自身在网内但不导流（轴被锯断）
      for (const nk of neighborKeys(k)) {
        if (compOf.has(nk) || !blocks.has(nk)) continue;
        compOf.set(nk, idx);
        stack.push(nk);
      }
    }
    comp.overLimit = comp.nodes.length > NETWORK_MAX_NODES;
    comps.push(comp);
  }
  const nets = { compOf, comps };
  if (states) evaluateNetworks(nets, states); // 新图立即带上供需（机器界面/服务器摘要不会读到 0）
  return nets;
}

// 供需与效率：全网一致口径；超限网络整体停摆。
// 建图即调用一次（供界面/摘要读），tick 里再算一次（锅炉刚点火的那一帧要反映出来）。
export function evaluateNetworks(nets, states) {
  if (!nets || !states) return nets;
  for (const comp of nets.comps) {
    let supply = 0;
    let demand = 0;
    if (!comp.overLimit) {
      for (const key of comp.boilers) {
        const st = states.get(key);
        if (st && st.burnTime > 0) supply += BOILER_SUPPLY;
      }
      for (const key of comp.machines) {
        const st = states.get(key);
        if (st && processorCanWork(st)) demand += MACHINE_DEMAND[st.kind] || 0;
      }
    }
    comp.supply = supply;
    comp.demand = demand;
    comp.efficiency = demand > 0 ? Math.max(0, Math.min(1, supply / demand)) : 0;
  }
  return nets;
}

// 某台机器所在网络的供需摘要（机器界面读它；不返回节点列表，避免每帧拷贝）
export function netInfoFor(networks, key) {
  if (!networks || !networks.compOf) return null;
  const idx = networks.compOf.get(key);
  if (idx === undefined) return null;
  const comp = networks.comps[idx];
  if (!comp) return null;
  return {
    supply: comp.supply,
    demand: comp.demand,
    efficiency: comp.efficiency,
    nodes: comp.nodes.length,
    overLimit: comp.overLimit,
    // B53 R3：压力表要看的细节——在烧锅炉数 / 有活干的机器数 / 断路位置（最多 6 处，够指路）
    boilers: comp.boilers.length,
    machines: comp.machines.length,
    cuts: comp.cuts.slice(0, 6),
    cutsTotal: comp.cuts.length,
  };
}

// B53 R3：若在该格放一块工业方块，会形成的网络节点数（含自身）。
// 用于「超额放置回滚」：相邻网络并起来超过 NETWORK_MAX_NODES 就不许放。
// 断开的离合闸不导流（与 buildNetworks 同口径），所以并网规模按真实导流算，不虚高。
export function projectedNetworkSize(networks, blocks, x, y, z, states = null) {
  if (!networks || !networks.compOf || !blocks) return 1;
  const seen = new Set();
  let n = 1;
  for (const nk of neighborKeys(`${x},${y},${z}`)) {
    if (!blocks.has(nk)) continue;
    if (blocks.get(nk) === 'clutch' && !clutchEngaged(states ? states.get(nk) : null)) continue;
    const idx = networks.compOf.get(nk);
    if (idx === undefined || seen.has(idx)) continue;
    seen.add(idx);
    const comp = networks.comps[idx];
    if (comp) n += comp.nodes.length;
  }
  return n;
}

// ── 单机推进 ────────────────────────────────────────────────────────────
// states: Map(key -> state)（惰性建条目）；networks: buildNetworks 的缓存（可选，需含离合闸状态）
// 返回 { networks, changed:Set<key>, ticked:boolean }
export function tickIndustry(blocks, states, dtSec, networks = null) {
  const nets = networks || buildNetworks(blocks, states);
  const changed = new Set();
  const dt = Math.max(0, Math.min(1, Number(dtSec) || 0)); // 大步长钳制：不追赶离线生产
  if (!(dt > 0)) return { networks: nets, changed, ticked: false };

  // 1) 锅炉：点火（燃料 + 桶装水 → 空桶）与燃烧计时
  for (const comp of nets.comps) {
    for (const key of comp.boilers) {
      const st = ensureState(states, key, 'boiler');
      const before = stateSig(st);
      tickBoiler(st, dt);
      if (stateSig(st) !== before) changed.add(key);
    }
  }

  // 2) 供给 / 需求 / 效率（全网一致口径；超限网络整体停摆）
  evaluateNetworks(nets, states);

  // 3) 加工机推进（按所在网络的效率降速；超限网络效率强制 0）
  for (const comp of nets.comps) {
    const eff = comp.overLimit ? 0 : comp.efficiency;
    for (const key of comp.machines) {
      const st = states.get(key);
      if (!st) continue;
      const before = stateSig(st);
      const beforeProgress = st.progress;
      tickProcessor(st, dt, eff);
      if (stateSig(st) !== before || st.progress !== beforeProgress) changed.add(key);
    }
  }
  return { networks: nets, changed, ticked: true };
}

// 惰性建条目：种类不符就地替换（旧档/错位条目不留半截状态）
function ensureState(states, key, kind) {
  let st = states.get(key);
  if (!st || st.kind !== kind) {
    st = emptyStateFor(kind);
    states.set(key, st);
  } else if (kind === 'crusher' || kind === 'cutter') {
    // 兼容 B51 存档里没有 bonus / cycles 的加工机状态
    if (st.bonus === undefined) st.bonus = null;
    if (!Number.isFinite(st.cycles)) st.cycles = 0;
  } else if (kind === 'clutch') {
    if (st.manual === undefined) st.manual = true;
    if (st.powered === undefined) st.powered = false;
  }
  return st;
}

function tickBoiler(st, dt) {
  if (st.burnTime > 0) st.burnTime = Math.max(0, st.burnTime - dt);
  if (st.burnTime > 0) return;
  if (!st.fuel || !st.water) return;
  const ft = getFuelTime(st.fuel.name);
  if (!(ft > 0)) return; // 不认的燃料：留着不动（玩家可破坏机器取回）
  if (spaceIn(st.output, 'bucket') <= 0) return; // 空桶已满：停炉等取
  st.fuel.count--;
  if (st.fuel.count <= 0) st.fuel = null;
  st.water.count--;
  if (st.water.count <= 0) st.water = null;
  st.output = addToSlot(st.output, 'bucket', 1);
  st.burnMax = ft;
  st.burnTime = ft;
}

// 加工机当前可加工的配方（按机器种类选表；无料/不认的料为 null）
function processorRecipe(st) {
  if (!st) return null;
  return processorRecipeFor(st.kind, st.input ? st.input.name : null);
}

// 有活可干 = 有料、有配方、产物槽放得下这一份
function processorCanWork(st) {
  if (!st) return false;
  const r = processorRecipe(st);
  if (!r) return false;
  return spaceIn(st.output, r.output) >= r.count;
}

function tickProcessor(st, dt, eff) {
  const r = processorRecipe(st);
  // 无料 / 不认的料：进度缓慢回退（不瞬间清零，同熔炉口径）
  if (!r) {
    st.progress = Math.max(0, st.progress - dt * IDLE_DECAY_PER_SEC);
    return;
  }
  if (!processorCanWork(st)) return; // 产物已满：保温（不推进也不回退）
  if (eff <= 0) return;              // 无供给：停转保温，等压恢复后继续
  const total = processorTime(st.kind);
  st.progress += dt * eff;
  let guard = 0;
  while (st.progress >= total && guard++ < 16) {
    const cur = processorRecipe(st);
    if (!cur || spaceIn(st.output, cur.output) < cur.count) break;
    st.progress -= total;
    st.output = addToSlot(st.output, cur.output, cur.count);
    addByproduct(st);
    st.input.count--;
    if (st.input.count <= 0) st.input = null;
    if (!st.input) { st.progress = 0; break; } // 断料清进度（同熔炉口径）
  }
}

// 有限副产物：每 every 个成品追加 1 个；副产槽满就丢掉这一次（不积累欠账）
function addByproduct(st) {
  if (st.kind !== 'crusher') return;
  const bp = crushByproductFor(st.input ? st.input.name : null);
  if (!bp) return;
  st.cycles = (Number(st.cycles) || 0) + 1;
  if (st.cycles % bp.every !== 0) return;
  if (spaceIn(st.bonus, bp.name) <= 0) return;
  st.bonus = addToSlot(st.bonus, bp.name, 1);
}

// ── 交互：投料 / 取产物 ──────────────────────────────────────────────────
// 返回 { ok, code, applied, items }
//   code: inserted | extracted | full | invalid | empty
// slot（B52 新增，可选）：指定槽位（机器界面点格）；省略 = 老口径自动路由/默认输出槽。
// 服务器与单机共用；调用方按 applied/items 结算玩家背包（项目轻信任模型，与熔炉一致）。
export function applyIndustryAction(kind, st, op, name, count, slot = null) {
  if (!st || st.kind !== kind) return { ok: false, code: 'invalid' };
  if (kind === 'shaft') return { ok: false, code: 'invalid' };
  const n = Math.max(1, Math.min(MACHINE_SLOT_LIMIT, Number(count) || 1));
  if (op === 'insert') {
    const target = slot ? (slotInsertable(kind, slot, name) ? slot : null) : insertTarget(kind, st, name);
    if (!target) return { ok: false, code: 'invalid' };
    const space = spaceIn(st[target], name);
    if (space <= 0) return { ok: false, code: 'full' };
    const applied = Math.min(n, space);
    st[target] = addToSlot(st[target], name, applied);
    return { ok: true, code: 'inserted', applied, items: [] };
  }
  if (op === 'extract') {
    const src = slot || 'output';
    if (!isMachineSlot(kind, src)) return { ok: false, code: 'invalid' };
    const cur = st[src];
    if (!cur) return { ok: false, code: 'empty' };
    const { slot: rest, taken } = takeFromSlot(cur, n);
    if (taken <= 0) return { ok: false, code: 'empty' };
    const items = [{ name: cur.name, count: taken }];
    st[src] = rest;
    return { ok: true, code: 'extracted', applied: taken, items };
  }
  return { ok: false, code: 'invalid' };
}

// 槽位是否属于这类机器（UI 与网络包校验共用）
export function isMachineSlot(kind, slot) {
  const list = MACHINE_SLOTS[kind];
  return !!list && list.indexOf(slot) >= 0;
}

// 指定槽位能否收这种物品（输出/副产槽只出不进）
export function slotInsertable(kind, slot, name) {
  if (!isMachineSlot(kind, slot)) return false;
  if (kind === 'boiler') {
    if (slot === 'fuel') return getFuelTime(name) > 0;
    if (slot === 'water') return name === 'water_bucket';
    return false;
  }
  if (kind === 'crusher' || kind === 'cutter') {
    if (slot !== 'input') return false;
    return !!processorRecipeFor(kind, name);
  }
  return false;
}

// 投料目标槽：锅炉分水桶/燃料，加工机只有输入槽
function insertTarget(kind, st, name) {
  if (kind === 'boiler') {
    if (name === 'water_bucket') return 'water';
    if (getFuelTime(name) > 0) return 'fuel';
    return null;
  }
  if (kind === 'crusher' || kind === 'cutter') {
    if (!processorRecipeFor(kind, name)) return null;
    if (st.input && st.input.name !== name) return 'input'; // 异类进=满（由 spaceIn 判 0 → full）
    return 'input';
  }
  return null;
}

// 破坏机器时要散落的内容物列表
export function spillStacks(st) {
  const out = [];
  if (!st) return out;
  for (const k of ['input', 'fuel', 'water', 'output', 'bonus']) {
    const s = st[k];
    if (s && s.name && s.count > 0) out.push({ name: s.name, count: s.count });
  }
  return out;
}

// 槽位签名（服务器节流广播用：签名变了即时广播，只有进度变按 SYNC 节拍）
export function machineSig(st) {
  return stateSig(st);
}

// ── 机器状态派生（机器界面：进度 / 配方 / 停转原因）────────────────────────
// 纯读：不改状态。reason 是**稳定代码**（文案映射在 UI 侧，i18n 走动态键表）。
export const MACHINE_REASONS = Object.freeze([
  'running', 'ready', 'idle', 'no-input', 'no-recipe', 'output-full',
  'no-fuel', 'no-water', 'no-power', 'over-limit', 'disengaged', 'stalled',
  'cut', // B53 R3：本网络里有闸断开（压力表与机器共用同一句提示）
]);

export function machineStatus(kind, st, net = null) {
  const info = {
    kind,
    reason: 'idle',
    supply: net ? Math.max(0, net.supply | 0) : 0,
    demand: net ? Math.max(0, net.demand | 0) : 0,
    efficiency: net ? Math.max(0, Math.min(1, Number(net.efficiency) || 0)) : 0,
    nodes: net ? Math.max(0, net.nodes | 0) : 0,
    overLimit: !!(net && net.overLimit),
    boilers: net ? Math.max(0, net.boilers | 0) : 0,
    machines: net ? Math.max(0, net.machines | 0) : 0,
    cuts: (net && Array.isArray(net.cuts)) ? net.cuts : [],
    cutsTotal: net ? Math.max(0, net.cutsTotal | 0) : 0,
    recipe: null,
    progress: 0,
    progressFrac: 0,
    engaged: true,
  };
  if (!st) return info;
  // B53 R3：潮压表只看网络，不看自己的槽位（它没有槽位）
  if (kind === 'gauge') {
    if (info.overLimit) info.reason = 'over-limit';
    else if (info.cutsTotal > 0) info.reason = 'cut';
    else if (info.supply <= 0) info.reason = 'no-power';
    else if (info.demand <= 0) info.reason = 'stalled';
    else info.reason = 'running';
    return info;
  }
  if (kind === 'clutch') {
    info.engaged = clutchEngaged(st);
    info.reason = info.engaged ? 'running' : 'disengaged';
    return info;
  }
  if (kind === 'boiler') {
    const ft = st.fuel ? getFuelTime(st.fuel.name) : 0;
    info.progress = Math.max(0, st.burnTime || 0);
    info.progressFrac = st.burnMax > 0 ? Math.max(0, Math.min(1, st.burnTime / st.burnMax)) : 0;
    if (st.burnTime > 0) info.reason = 'running';
    else if (!st.fuel || !(ft > 0)) info.reason = 'no-fuel';
    else if (!st.water) info.reason = 'no-water';
    else if (spaceIn(st.output, 'bucket') <= 0) info.reason = 'output-full';
    else info.reason = 'ready';
    return info;
  }
  // 加工机
  const r = processorRecipe(st);
  if (r) info.recipe = { input: st.input.name, output: r.output, count: r.count };
  const total = processorTime(kind);
  info.time = total;
  info.progress = Math.max(0, st.progress || 0);
  info.progressFrac = Math.max(0, Math.min(1, info.progress / total));
  if (info.overLimit) info.reason = 'over-limit';
  else if (!st.input) info.reason = 'no-input';
  else if (!r) info.reason = 'no-recipe';
  else if (spaceIn(st.output, r.output) < r.count) info.reason = 'output-full';
  else if (!(info.efficiency > 0) && info.demand > 0) info.reason = 'no-power';
  else if (!(info.efficiency > 0) && info.demand <= 0) info.reason = 'stalled';
  else if (st.progress > 0) info.reason = 'running';
  else info.reason = 'ready';
  return info;
}

// ── 清洗（存档 / 房间快照 / 网络）───────────────────────────────────────
function safeName(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null;
}

function sanitizeSlot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = safeName(raw.name);
  if (!name) return null;
  const count = Math.floor(Number(raw.count));
  if (!Number.isFinite(count) || count <= 0) return null;
  return { name, count: Math.min(MACHINE_SLOT_LIMIT, count), data: null };
}

export function sanitizeMachineState(kind, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (kind === 'boiler') {
    return {
      kind: 'boiler',
      fuel: sanitizeSlot(raw.fuel),
      water: sanitizeSlot(raw.water),
      output: sanitizeSlot(raw.output),
      burnTime: Math.max(0, Math.min(1e9, Number(raw.burnTime) || 0)),
      burnMax: Math.max(0, Math.min(1e9, Number(raw.burnMax) || 0)),
    };
  }
  if (kind === 'crusher' || kind === 'cutter') {
    const total = processorTime(kind);
    return {
      kind,
      input: sanitizeSlot(raw.input),
      output: sanitizeSlot(raw.output),
      bonus: sanitizeSlot(raw.bonus),
      progress: Math.max(0, Math.min(total * 64, Number(raw.progress) || 0)),
      cycles: Math.max(0, Math.min(1e9, Math.floor(Number(raw.cycles) || 0))),
    };
  }
  if (kind === 'clutch') {
    // 只认显式布尔/0-1：手动默认接通（只有明确写 false/0 才断开），红石只认 true/1
    return {
      kind: 'clutch',
      manual: !(raw.manual === false || raw.manual === 0),
      powered: raw.powered === true || raw.powered === 1,
    };
  }
  return null;
}

// 方块消失后：状态条目该不该保留（kind 与当前位置方块不一致即作废）
export function stateMatchesKind(state, kind) {
  return !!state && state.kind === kind;
}
