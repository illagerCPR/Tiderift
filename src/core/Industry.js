// core/Industry.js -- 潮工（工业）最小闭环的纯算法（Build 51 R3）
// 单机本地 tick 与服务器权威 tick **共用这一份**：拓扑求值、供需效率、锅炉燃烧、碎石机推进、
// 槽位投料/取出。无 DOM / 无 Three / 无世界对象依赖，node 可测。
//
// 模型（docs/extra-content-master-plan.md §5.4）：
//   · 网络 = 锅炉 / 传动轴 / 碎石机按 6 邻接形成的连通分量；拓扑由方块账本派生，**不持久化**。
//   · 供给 = 所有在烧锅炉之和；需求 = 所有有活可干的碎石机之和；效率 = min(1, 供给/需求)。
//   · 不储存能量、不积累欠账：熄火即停；dt 一律钳到 ≤1s，重载/卡顿不追赶离线生产。
//   · 只有机器槽位与加工进度持久化（状态对象），拓扑每次方块变化后重建（调用方缓存）。
import {
  BOILER_SUPPLY, CRUSHER_DEMAND, CRUSH_TIME, IDLE_DECAY_PER_SEC,
  NETWORK_MAX_NODES, MACHINE_SLOT_LIMIT, crushRecipeFor,
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

export function emptyCrusherState() {
  return { kind: 'crusher', input: null, output: null, progress: 0 };
}

export function emptyStateFor(kind) {
  if (kind === 'boiler') return emptyBoilerState();
  if (kind === 'crusher') return emptyCrusherState();
  return null; // shaft 无状态
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
  return `${slotSig(st.input)}/${slotSig(st.output)}`;
}

// ── 拓扑 ────────────────────────────────────────────────────────────────
// blocks: Map("x,y,z" -> 'boiler'|'shaft'|'crusher')
// 返回 { compOf: Map(key -> 分量下标), comps: [{nodes, boilers, crushers, overLimit, supply, demand, efficiency}] }
export function buildNetworks(blocks) {
  const compOf = new Map();
  const comps = [];
  if (!blocks || blocks.size === 0) return { compOf, comps };
  for (const key of blocks.keys()) {
    if (compOf.has(key)) continue;
    const idx = comps.length;
    const comp = { nodes: [], boilers: [], crushers: [], overLimit: false, supply: 0, demand: 0, efficiency: 0 };
    const stack = [key];
    compOf.set(key, idx);
    while (stack.length) {
      const k = stack.pop();
      comp.nodes.push(k);
      const kind = blocks.get(k);
      if (kind === 'boiler') comp.boilers.push(k);
      else if (kind === 'crusher') comp.crushers.push(k);
      for (const nk of neighborKeys(k)) {
        if (compOf.has(nk) || !blocks.has(nk)) continue;
        compOf.set(nk, idx);
        stack.push(nk);
      }
    }
    // 节点顺序稳定（BFS 起点 + 栈序依赖插入顺序）→ 结果与遍历顺序无关的部分只用于统计
    comp.overLimit = comp.nodes.length > NETWORK_MAX_NODES;
    comps.push(comp);
  }
  return { compOf, comps };
}

// ── 单机推进 ────────────────────────────────────────────────────────────
// states: Map(key -> state)（惰性建条目）；networks: buildNetworks 的缓存（可选）
// 返回 { networks, changed:Set<key>, ticked:boolean }
export function tickIndustry(blocks, states, dtSec, networks = null) {
  const nets = networks || buildNetworks(blocks);
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
  for (const comp of nets.comps) {
    let supply = 0;
    let demand = 0;
    if (!comp.overLimit) {
      for (const key of comp.boilers) {
        const st = states.get(key);
        if (st && st.burnTime > 0) supply += BOILER_SUPPLY;
      }
      for (const key of comp.crushers) {
        const st = ensureState(states, key, 'crusher');
        if (crusherCanWork(st)) demand += CRUSHER_DEMAND;
      }
    }
    comp.supply = supply;
    comp.demand = demand;
    comp.efficiency = demand > 0 ? Math.max(0, Math.min(1, supply / demand)) : 0;
  }

  // 3) 碎石机推进（按所在网络的效率降速）
  for (const comp of nets.comps) {
    for (const key of comp.crushers) {
      const st = states.get(key);
      if (!st) continue;
      const before = stateSig(st);
      const beforeProgress = st.progress;
      const eff = comp.overLimit ? 0 : comp.efficiency;
      tickCrusher(st, dt, eff);
      if (stateSig(st) !== before || st.progress !== beforeProgress) changed.add(key);
    }
  }
  return { networks: nets, changed, ticked: true };
}

function ensureState(states, key, kind) {
  let st = states.get(key);
  if (!st || st.kind !== kind) {
    st = emptyStateFor(kind);
    states.set(key, st);
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

function crusherCanWork(st) {
  if (!st.input) return false;
  const r = crushRecipeFor(st.input.name);
  if (!r) return false;
  return spaceIn(st.output, r.output) >= r.count;
}

function tickCrusher(st, dt, eff) {
  // 无料：进度缓慢回退（不瞬间清零，同熔炉口径）
  if (!st.input || !crushRecipeFor(st.input.name)) {
    st.progress = Math.max(0, st.progress - dt * IDLE_DECAY_PER_SEC);
    return;
  }
  if (!crusherCanWork(st)) return; // 产物已满：保温（不推进也不回退）
  if (eff <= 0) return;            // 无供给：停转保温，等压恢复后继续
  st.progress += dt * eff;
  let guard = 0;
  while (st.progress >= CRUSH_TIME && guard++ < 16) {
    const r = st.input ? crushRecipeFor(st.input.name) : null;
    if (!r || spaceIn(st.output, r.output) < r.count) break;
    st.progress -= CRUSH_TIME;
    st.output = addToSlot(st.output, r.output, r.count);
    st.input.count--;
    if (st.input.count <= 0) st.input = null;
    if (!st.input) { st.progress = 0; break; } // 断料清进度（同熔炉口径）
  }
}

// ── 交互：投料 / 取产物 ──────────────────────────────────────────────────
// 返回 { ok, code, applied, items }
//   code: inserted | extracted | full | invalid | empty
// 服务器与单机共用；调用方按 applied/items 结算玩家背包（项目轻信任模型，与熔炉一致）。
export function applyIndustryAction(kind, st, op, name, count) {
  if (!st) return { ok: false, code: 'invalid' };
  const n = Math.max(1, Math.min(MACHINE_SLOT_LIMIT, Number(count) || 1));
  if (op === 'insert') {
    const target = insertTarget(kind, st, name);
    if (!target) return { ok: false, code: 'invalid' };
    const space = spaceIn(st[target], name);
    if (space <= 0) return { ok: false, code: 'full' };
    const applied = Math.min(n, space);
    st[target] = addToSlot(st[target], name, applied);
    return { ok: true, code: 'inserted', applied, items: [] };
  }
  if (op === 'extract') {
    const src = 'output'; // 锅炉与碎石机的可取产物都在 output 槽
    const slot = st[src];
    if (!slot) return { ok: false, code: 'empty' };
    const { slot: rest, taken } = takeFromSlot(slot, n);
    if (taken <= 0) return { ok: false, code: 'empty' };
    const items = [{ name: slot.name, count: taken }];
    st[src] = rest;
    return { ok: true, code: 'extracted', applied: taken, items };
  }
  return { ok: false, code: 'invalid' };
}

// 投料目标槽：锅炉分水桶/燃料，碎石机只有输入槽
function insertTarget(kind, st, name) {
  if (kind === 'boiler') {
    if (name === 'water_bucket') return 'water';
    if (getFuelTime(name) > 0) return 'fuel';
    return null;
  }
  if (kind === 'crusher') {
    if (!crushRecipeFor(name)) return null;
    if (st.input && st.input.name !== name) return 'input'; // 异类进=满（由 spaceIn 判 0 → full）
    return 'input';
  }
  return null;
}

// 破坏机器时要散落的内容物列表
export function spillStacks(st) {
  const out = [];
  if (!st) return out;
  for (const k of ['input', 'fuel', 'water', 'output']) {
    const s = st[k];
    if (s && s.name && s.count > 0) out.push({ name: s.name, count: s.count });
  }
  return out;
}

// 槽位签名（服务器节流广播用：签名变了即时广播，只有进度变按 SYNc 节拍）
export function machineSig(st) {
  return stateSig(st);
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
  if (kind === 'crusher') {
    return {
      kind: 'crusher',
      input: sanitizeSlot(raw.input),
      output: sanitizeSlot(raw.output),
      progress: Math.max(0, Math.min(CRUSH_TIME * 64, Number(raw.progress) || 0)),
    };
  }
  return null;
}

// 方块消失后：状态条目该不该保留（kind 与当前位置方块不一致即作废）
export function stateMatchesKind(state, kind) {
  return !!state && state.kind === kind;
}
