// Ruins.js -- 可动手解开的遗迹：机关定义推导 + 判定 + 状态机（纯模块，node 可直接 import）
// 三种机关房各有独立判定口径：潮闸房（水位到达标线格）/ 烬火回路房（四灯全亮）/ 构件架房（三凹槽填满）。
// 只 import core 纯模块（BlockRegistry / posKey / Chunk 常量），不 import Three/DOM/Game，也不 import 世界模块。
// 位置口径：ay 是结构 groundY（地板层，与世界方块 y 同系），机关格 = 锚点 + 固定局部偏移（见 *_LAYOUT）。
// 判定读方块一律走注入的 sample（见 makeWorldSample）：未加载区块必须回 -1（未知），不得当成空气。
import { BlockRegistry } from './BlockRegistry.js';
import { posKey } from './posKey.js';
import { CHUNK_SIZE } from './Chunk.js';
import { encodeBlueprintRLE, validateBlueprint } from './Blueprints.js';

export const RUIN_KINDS = ['tide_sluice', 'ember_circuit', 'frame_rack'];
// 维度作用域：三种机关房各占一维（末地首版不加机关房）
export const RUIN_KIND_DIM = { tide_sluice: 'overworld', ember_circuit: 'nether', frame_rack: 'aether' };
// 判定规则名（evaluateRuin 的分支键；单测可直接构造同形对象）
export const RUIN_RULE = { tide_sluice: 'water_line', ember_circuit: 'lamps', frame_rack: 'slots' };
export const RUIN_LIMIT = 96;        // 每存档/每房间最多记录的机关条数
export const RUIN_POLL_MS = 250;     // 轮询节拍（不每帧读世界）
export const RUIN_NAME_MAX = 24;     // 解开着/领取者昵称上限
export const RUIN_STATE_LOCKED = 'locked';
export const RUIN_STATE_SOLVED = 'solved';

const KEY_RE = /^(overworld|nether|end|aether)\|(tide_sluice|ember_circuit|frame_rack)\|-?\d{1,9}\|-?\d{1,9}$/;
// 推导用盐（与结构选址 salt 无关，另一套流）
const DERIVE_SALT = { tide_sluice: 4301, ember_circuit: 4302, frame_rack: 4303 };

// ── 机关布局常量（相对锚点的局部坐标；结构几何与判定共用同一份，杜绝几何/判定漂移）──
// 潮闸房：地板 y0；水面层 waterY；水口在 x=-3，水道 x=-2..0（两处泥塞），沉沙池 x=1..2 / z=-1..1，
// 标线格 = 池最东一列（x=2），门体 = 池东墙 x=3（3 宽 3 高，解封格）。
export const SLUICE_LAYOUT = Object.freeze({
  waterY: 1,
  srcX: -3, srcZ: 0,
  chanX0: -2, chanX1: 0,
  plugXs: Object.freeze([-2, 0]),
  basinX0: 1, basinX1: 2,
  basinZ0: -1, basinZ1: 1,
  markX: 2,
  doorX: 3, doorZ0: -1, doorZ1: 1, doorY0: 1, doorY1: 3,
  innerX: 5,                       // 内室纪念台所在 x（y=waterY，z=0）
});
// 烬火回路房：中央石墩上的红石火把，四向各一条支路（导线 2 格 + 第 3 格灯位），
// 每条支路第 2 格的导线出厂缺失（玩家补线），四灯全亮才算解开。
export const EMBER_LAYOUT = Object.freeze({
  wireY: 1,
  dirs: Object.freeze([Object.freeze([1, 0]), Object.freeze([0, 1]), Object.freeze([-1, 0]), Object.freeze([0, -1])]),
  wireSteps: Object.freeze([1, 2]),
  gapStep: 2,
  lampStep: 3,
  doorZ: -5, doorX0: -1, doorX1: 1, doorY0: 1, doorY1: 3,
  innerZ: -7,                      // 内室纪念台所在 z（x=0，y=wireY）
});
// 构件架房：北墙三处凹槽（槽心 slotY），凹槽镶边 = 所需材料（看得出的提示），
// 东墙内表面三列料架各备 2 块同材料（玩家可挖下来补槽），西墙 x=-5 为门体（解封格）。
export const RACK_LAYOUT = Object.freeze({
  slotY: 2,
  slotXs: Object.freeze([-3, 0, 3]),   // 槽距 3 格：相邻槽的镶边（±1）不重叠
  wallZ: -4,
  rackX: 4, rackZ: Object.freeze([-2, 0, 2]),
  doorX: -5, doorZ0: -1, doorZ1: 1, doorY0: 1, doorY1: 3,
  innerX: -7,                      // 内室纪念台所在 x（y=slotY-1，z=0）
});
export const RACK_MATERIALS = Object.freeze(['quartz_block', 'glowstone', 'sea_lantern', 'star_marrow_block', 'cloud_wool', 'blue_ice']);

// 方块名 → id（未知名 getId 返回 0；单测钉住全部期望 id 非 0，防止名字打错静默成空气）
function bid(name) { return BlockRegistry.getId(name); }

// 32 位确定性散列（与 StructureManager.hash32 同族算法，本地实现以免 core → world 依赖）
function ruinHash(seed, a, b, salt) {
  let h = ((seed | 0) ^ Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(salt, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// 从调色板里确定性取 count 个互不相同的材料名
function pickDistinct(palette, seed, a, b, salt, count) {
  const pool = palette.slice();
  const out = [];
  let h = ruinHash(seed, a, b, salt);
  while (out.length < count && pool.length > 0) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
}

// ── 键与清洗 ────────────────────────────────────────────────────────────
// 键 = 维度|机关类型|锚点x|锚点z（与 B 的塔键同构：维度 + 类型 + 确定性锚点）
export function ruinKey(dim, kind, ax, az) {
  return dim + '|' + kind + '|' + Math.floor(ax) + '|' + Math.floor(az);
}

export function isValidRuinKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

export function parseRuinKey(key) {
  if (!isValidRuinKey(key)) return null;
  const parts = key.split('|');
  return { dim: parts[0], kind: parts[1], ax: Number(parts[2]), az: Number(parts[3]) };
}

export function cleanRuinName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, RUIN_NAME_MAX);
}

export function cleanRuinState(value) {
  return value === RUIN_STATE_SOLVED ? RUIN_STATE_SOLVED : RUIN_STATE_LOCKED;
}

// 维度 → 该维的机关类型（末地/未知维度返回 null）
export function ruinKindForDim(dim) {
  for (const kind of RUIN_KINDS) if (RUIN_KIND_DIM[kind] === dim) return kind;
  return null;
}

// ── 机关定义推导（纯函数：同 seed + 同锚点 + 同 ay 必得同一份定义）────────
// 返回 { key, dim, kind, rule, ax, ay, az, cells, keys, unlock, inner }
//   cells  : 判定参与格 [{ x, y, z, accept:[id...], label, need, needName }]（accept 命中即满足）
//   keys   : 关键件    [{ x, y, z, accept:[id...], label, role }]（任一不匹配 → badIndex）
//   unlock : 解封写入  [{ x, y, z, id }]（阶段 2 用 applyUnlock 一次性开门）
export function ruinPuzzle(seed, dim, kind, ax, ay, az) {
  if (RUIN_KINDS.indexOf(kind) < 0) return null;
  const x0 = Math.floor(ax), y0 = Math.floor(ay), z0 = Math.floor(az);
  const base = {
    key: ruinKey(dim, kind, x0, z0),
    dim, kind, rule: RUIN_RULE[kind],
    ax: x0, ay: y0, az: z0,
  };
  if (kind === 'tide_sluice') return Object.assign(base, sluiceCells(x0, y0, z0));
  if (kind === 'ember_circuit') return Object.assign(base, emberCells(x0, y0, z0));
  return Object.assign(base, rackCells(seed, x0, y0, z0));
}

// 判定口径里"算作有水"的 id 集合（源 + 7 级流动）
function waterIds() {
  const out = [bid('water')];
  for (let l = 1; l <= 7; l++) out.push(bid('water_flow_' + l));
  return out.filter((id) => id > 0);
}

// 潮闸房：标线格必须都是水；关键件 = 水口水源格（水源被挖走或换成流动水即"缺件"）
function sluiceCells(x0, y0, z0) {
  const L = SLUICE_LAYOUT;
  const water = bid('water');
  const wy = y0 + L.waterY;
  const cells = [];
  for (let z = L.basinZ0; z <= L.basinZ1; z++) {
    cells.push({
      x: x0 + L.markX, y: wy, z: z0 + z,
      accept: waterIds(), label: '标线格', need: 'water', needName: 'water',
    });
  }
  const keys = [{
    x: x0 + L.srcX, y: wy, z: z0 + L.srcZ,
    accept: [water], label: '水口水源', role: 'source',
  }];
  const unlock = [];
  for (let z = L.doorZ0; z <= L.doorZ1; z++) {
    for (let y = L.doorY0; y <= L.doorY1; y++) unlock.push({ x: x0 + L.doorX, y: y0 + y, z: z0 + z, id: 0 });
  }
  return {
    cells, keys, unlock,
    inner: { x: x0 + L.innerX, y: y0 + L.waterY, z: z0 },
    plugs: L.plugXs.map((dx) => ({ x: x0 + dx, y: wy, z: z0 + L.srcZ })),
  };
}

// 烬火回路房：四盏灯必须都是"点亮态"；关键件 = 红石火把 + 四盏灯（灯本体被挖 = 缺件）
function emberCells(x0, y0, z0) {
  const L = EMBER_LAYOUT;
  const lit = bid('redstone_lamp_lit');
  const lamp = bid('redstone_lamp');
  const torch = bid('redstone_torch');
  const wire = bid('redstone_wire');
  const wy = y0 + L.wireY;
  const cells = [];
  const keys = [{ x: x0, y: wy, z: z0, accept: [torch], label: '回路火种', role: 'torch' }];
  const wires = [];
  const gaps = [];
  L.dirs.forEach(([dx, dz], i) => {
    const lx = x0 + dx * L.lampStep, lz = z0 + dz * L.lampStep;
    cells.push({
      x: lx, y: wy, z: lz,
      accept: [lit], label: '第' + (i + 1) + '盏灯', need: 'redstone_lamp_lit', needName: 'redstone_lamp_lit',
    });
    keys.push({ x: lx, y: wy, z: lz, accept: [lamp, lit], label: '第' + (i + 1) + '盏灯', role: 'lamp' });
    for (const step of L.wireSteps) {
      const cell = { x: x0 + dx * step, y: wy, z: z0 + dz * step };
      if (step === L.gapStep) gaps.push(Object.assign({ id: 0, need: wire }, cell));
      else wires.push(Object.assign({ id: wire }, cell));
    }
  });
  const unlock = [];
  for (let x = L.doorX0; x <= L.doorX1; x++) {
    for (let y = L.doorY0; y <= L.doorY1; y++) unlock.push({ x: x0 + x, y: y0 + y, z: z0 + L.doorZ, id: 0 });
  }
  return {
    cells, keys, unlock, wires, gaps,
    inner: { x: x0, y: y0 + L.wireY, z: z0 + L.innerZ },
  };
}

// 构件架房：三个凹槽必须各放对材料（材料由 seed + 锚点确定性挑选）；
// 关键件 = 每槽下方托架（镶边缺失即"缺件"，材料仍可从料架补齐）
function rackCells(seed, x0, y0, z0) {
  const L = RACK_LAYOUT;
  const mats = pickDistinct(RACK_MATERIALS, seed, x0, z0, DERIVE_SALT.frame_rack, L.slotXs.length);
  const sy = y0 + L.slotY;
  const cells = [];
  const keys = [];
  L.slotXs.forEach((dx, i) => {
    const name = mats[i];
    const id = bid(name);
    cells.push({
      x: x0 + dx, y: sy, z: z0 + L.wallZ,
      accept: [id], label: '第' + (i + 1) + '槽', need: name, needName: name,
    });
    keys.push({
      x: x0 + dx, y: sy - 1, z: z0 + L.wallZ,
      accept: [id], label: '第' + (i + 1) + '槽托架', role: 'rim',
    });
  });
  const unlock = [];
  for (let z = L.doorZ0; z <= L.doorZ1; z++) {
    for (let y = L.doorY0; y <= L.doorY1; y++) unlock.push({ x: x0 + L.doorX, y: y0 + y, z: z0 + z, id: 0 });
  }
  return {
    cells, keys, unlock,
    slots: L.slotXs.map((dx, i) => ({ x: x0 + dx, y: sy, z: z0 + L.wallZ, name: mats[i], id: bid(mats[i]) })),
    rack: L.rackZ.map((dz, i) => ({ x: x0 + L.rackX, z: z0 + dz, name: mats[i], id: bid(mats[i]) })),
    inner: { x: x0 + L.innerX, y: sy - 1, z: z0 },
  };
}

// ── 判定（注入 sample，不碰世界）────────────────────────────────────────
// sample(x,y,z) → 方块 id；未加载区块应返回 -1（未知），未知格一律判为未满足。
// 返回 { state: 'locked'|'solved', missing: [...], badIndex: 关键件下标（-1 = 无缺件） }
export function evaluateRuin(puzzle, sample) {
  const out = { state: RUIN_STATE_LOCKED, missing: [], badIndex: -1 };
  if (!puzzle || typeof sample !== 'function') return out;
  const keys = Array.isArray(puzzle.keys) ? puzzle.keys : [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const have = sample(k.x, k.y, k.z);
    const accept = Array.isArray(k.accept) ? k.accept : [k.id];
    if (accept.indexOf(have) < 0 && out.badIndex < 0) out.badIndex = i;
  }
  const cells = Array.isArray(puzzle.cells) ? puzzle.cells : [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const have = sample(c.x, c.y, c.z);
    const accept = Array.isArray(c.accept) ? c.accept : [c.id];
    if (accept.indexOf(have) >= 0) continue;
    out.missing.push({
      index: i, x: c.x, y: c.y, z: c.z,
      label: c.label || '', need: c.need || '', needName: c.needName || '', have,
    });
  }
  out.state = out.missing.length === 0 && out.badIndex < 0 ? RUIN_STATE_SOLVED : RUIN_STATE_LOCKED;
  return out;
}

// ── 世界写入（唯一入口：一律走 world.setBlock，网格与光照才会更新）────────
export function applyUnlock(world, puzzle) {
  if (!world || typeof world.setBlock !== 'function') return 0;
  if (!puzzle || !Array.isArray(puzzle.unlock)) return 0;
  let n = 0;
  for (const u of puzzle.unlock) {
    world.setBlock(u.x, u.y, u.z, typeof u.id === 'number' ? u.id : 0);
    n++;
  }
  return n;
}

// 世界采样器：账本（modifiedBlocks）优先 → 未加载区块返回 -1（未知，不得读成空气）
// 与 _raceTrackValidity 同口径：挖毁/改动以账本为准，避免未加载区块的 0 被误判成"缺失"。
export function makeWorldSample(world) {
  if (!world || typeof world.getBlock !== 'function') return null;
  const ledger = world.modifiedBlocks && typeof world.modifiedBlocks.get === 'function' ? world.modifiedBlocks : null;
  const getChunk = typeof world.getChunk === 'function' ? (cx, cz) => world.getChunk(cx, cz) : null;
  return (x, y, z) => {
    if (ledger) {
      const id = ledger.get(posKey(x, y, z));
      if (id !== undefined && id !== null) return id;
    }
    if (getChunk && !getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))) return -1;
    return world.getBlock(x, y, z);
  };
}

// ── 状态机：locked → solved 单向；轮询节流 0.25s ─────────────────────────
export class Ruins {
  constructor(game = null) {
    this.game = game;
    this.ruins = new Map();    // key -> { state, byName, at }
    this.claims = new Map();   // key -> { byName, at }（纪念奖励领取记录；单机本地去重，联机以房间账本为准）
    this.targets = new Map();  // key -> puzzle（调用方登记当前附近待判定机关）
    this._lastPollMs = -Infinity;
    this._lastResults = [];
  }

  // 旧档/旧联机档案缺字段传 null → 空；兼容 { ruins: {key: {...}} } 与扁平 {key:'solved'} 两种形态。
  // claims（领取记录）是阶段 2 追加的兄弟字段：旧档缺 → 空表，不崩。
  reset(raw) {
    this.ruins.clear();
    this.claims.clear();
    this._lastResults = [];
    this._lastPollMs = -Infinity;
    if (!raw || typeof raw !== 'object') return this;
    const src = raw.ruins && typeof raw.ruins === 'object' ? raw.ruins : raw;
    for (const [key, value] of Object.entries(src)) {
      if (!isValidRuinKey(key)) continue;
      const state = cleanRuinState(value && typeof value === 'object' ? value.state : value);
      if (state !== RUIN_STATE_SOLVED) continue;
      const byName = value && typeof value === 'object' ? cleanRuinName(value.byName) : '';
      const at = value && typeof value === 'object' && Number.isFinite(value.at) ? Math.max(0, Math.floor(value.at)) : 0;
      this.ruins.set(key, { state, byName, at });
      if (this.ruins.size >= RUIN_LIMIT) break;
    }
    const claims = raw.claims && typeof raw.claims === 'object' ? raw.claims : null;
    if (claims) {
      for (const [key, value] of Object.entries(claims)) {
        if (!isValidRuinKey(key)) continue;
        if (!value || typeof value !== 'object') continue;
        this.claims.set(key, {
          byName: cleanRuinName(value.byName),
          at: Number.isFinite(value.at) ? Math.max(0, Math.floor(value.at)) : 0,
        });
        if (this.claims.size >= RUIN_LIMIT) break;
      }
    }
    return this;
  }

  serialize() {
    const ruins = {};
    for (const [key, value] of this.ruins) {
      ruins[key] = { state: value.state, byName: value.byName, at: value.at };
    }
    const claims = {};
    for (const [key, value] of this.claims) {
      claims[key] = { byName: value.byName, at: value.at };
    }
    return { ruins, claims };
  }

  clear() {
    this.ruins.clear();
    this.claims.clear();
    this.targets.clear();
    this._lastResults = [];
    this._lastPollMs = -Infinity;
  }

  get size() { return this.ruins.size; }

  stateAt(key) {
    const rec = this.ruins.get(key);
    return rec ? rec.state : RUIN_STATE_LOCKED;
  }

  isSolved(key) { return this.stateAt(key) === RUIN_STATE_SOLVED; }

  // 单向写入：已解开不再改写（服务器权威值与本地判定共用）；返回是否发生变化
  markSolved(key, byName = '', at = 0) {
    if (!isValidRuinKey(key)) return false;
    if (this.ruins.has(key)) return false;
    if (this.ruins.size >= RUIN_LIMIT) return false;
    this.ruins.set(key, {
      state: RUIN_STATE_SOLVED,
      byName: cleanRuinName(byName),
      at: Number.isFinite(at) ? Math.max(0, Math.floor(at)) : 0,
    });
    return true;
  }

  // 登记待判定机关（同一 key 覆盖）；已解开的机关不再进待判定集
  track(puzzle) {
    if (!puzzle || !isValidRuinKey(puzzle.key)) return false;
    if (this.isSolved(puzzle.key)) return false;
    this.targets.set(puzzle.key, puzzle);
    return true;
  }

  untrack(key) { return this.targets.delete(key); }

  setTargets(puzzles) {
    this.targets.clear();
    for (const p of puzzles || []) this.track(p);
    return this.targets.size;
  }

  targetsSize() { return this.targets.size; }

  // 最近一轮判定结果（界面提示用）：[{ key, kind, state, missing, badIndex }]
  results() { return this._lastResults.slice(); }

  // 轮询：不足 RUIN_POLL_MS 直接早退（一次 sample 都不调）；返回
  // { sampled, results, solved: [key...] }，solved 是本次新解开的 key（阶段 2 据此发奖/广播）
  poll(nowMs, sample) {
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    const out = { sampled: false, results: [], solved: [] };
    if (now < this._lastPollMs) this._lastPollMs = -Infinity; // 时钟回退（换计时源/重开）：不强求等待
    if (now - this._lastPollMs < RUIN_POLL_MS) return out;
    this._lastPollMs = now;
    out.sampled = true;
    if (typeof sample !== 'function' || this.targets.size === 0) {
      this._lastResults = [];
      return out;
    }
    const results = [];
    for (const [key, puzzle] of this.targets) {
      if (this.isSolved(key)) continue;
      const res = evaluateRuin(puzzle, sample);
      results.push({ key, kind: puzzle.kind, state: res.state, missing: res.missing, badIndex: res.badIndex });
      if (res.state === RUIN_STATE_SOLVED) {
        this.markSolved(key, '', now);
        out.solved.push(key);
        this.targets.delete(key);
      }
    }
    this._lastResults = results;
    out.results = results;
    return out;
  }

  entries() {
    return [...this.ruins.entries()].map(([key, v]) => ({ key, state: v.state, byName: v.byName, at: v.at }));
  }

  // ── 领取（阶段 2）────────────────────────────────────────────────────
  // 单向：同一处机关只记一次领取。单机在本地判定，联机以服务器回执（RUIN_CLAIMED）为准。
  isClaimed(key) { return this.claims.has(key); }

  claimEntry(key) { return this.claims.get(key) || null; }

  markClaimed(key, byName = '', at = 0) {
    if (!isValidRuinKey(key)) return false;
    if (this.claims.has(key)) return false;
    if (this.claims.size >= RUIN_LIMIT) return false;
    this.claims.set(key, {
      byName: cleanRuinName(byName),
      at: Number.isFinite(at) ? Math.max(0, Math.floor(at)) : 0,
    });
    return true;
  }
}

// ── 奖励（阶段 2）：纪念方块 + 铭牌 + 一张 E 蓝图 ────────────────────────
// 每处机关一份固定奖励；蓝图由固定体素表确定性生成（同名/同 id 去重，重复解开不重复塞）。
export const RUIN_REWARD_BLOCK = Object.freeze({
  tide_sluice: 'tide_keepsake',
  ember_circuit: 'ember_keepsake',
  frame_rack: 'rack_keepsake',
});
export const RUIN_REWARD_PLAQUE = 'ruin_plaque';
// 蓝图 id 必须满足 /^[a-z0-9]{6,20}$/（与 Blueprints.validateBlueprint 同口径）
export const RUIN_REWARD_BLUEPRINT_ID = Object.freeze({
  tide_sluice: 'ruintide001',
  ember_circuit: 'ruinember01',
  frame_rack: 'ruinrack001',
});
// 蓝图名走 i18n（键即中文原文）；去重同时看 id 与名字，切语言也不会重复塞
export const RUIN_REWARD_BLUEPRINT_NAME = Object.freeze({
  tide_sluice: '潮闸房 · 引水样图',
  ember_circuit: '烬火回路 · 接线样图',
  frame_rack: '构件架 · 三格样图',
});
// 机关房显示名（游记/信息栏/提示共用）
export const RUIN_KIND_LABEL = Object.freeze({
  tide_sluice: '潮闸房',
  ember_circuit: '烬火回路房',
  frame_rack: '构件架房',
});

// 固定体素表：index = (y * size.z + z) * size.x + x（与 captureBlueprint 的遍历顺序一致）
function makeVoxelBuilder(size) {
  const voxels = new Array(size.x * size.y * size.z).fill(0);
  const set = (x, y, z, id) => {
    if (x < 0 || y < 0 || z < 0 || x >= size.x || y >= size.y || z >= size.z) return;
    voxels[(y * size.z + z) * size.x + x] = id;
  };
  const box = (x0, y0, z0, x1, y1, z1, id) => {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, y, z, id);
  };
  return { voxels, set, box };
}

// 三种机关房各一张 7~9 格见方的小样图（体积 ≤ 175，远低于 32768 上限）
function ruinVoxels(kind) {
  if (kind === 'tide_sluice') {
    const size = { x: 7, y: 5, z: 5 };
    const b = makeVoxelBuilder(size);
    b.box(0, 0, 0, 6, 0, 4, bid('stone_bricks'));          // 地基
    b.box(0, 1, 0, 0, 3, 4, bid('stone_bricks'));          // 西墙
    b.box(6, 1, 0, 6, 3, 4, bid('stone_bricks'));          // 东墙（水位线一侧）
    b.box(1, 1, 0, 5, 3, 0, bid('stone_bricks'));          // 北墙
    b.box(2, 1, 1, 4, 1, 3, bid('water'));                 // 沉沙池
    b.set(3, 1, 0, bid('sea_lantern'));                    // 水位标线灯
    b.set(3, 4, 2, bid('glowstone'));                      // 屋顶长明灯
    return { size, voxels: b.voxels };
  }
  if (kind === 'ember_circuit') {
    const size = { x: 7, y: 3, z: 7 };
    const b = makeVoxelBuilder(size);
    b.box(0, 0, 0, 6, 0, 6, bid('nether_bricks'));         // 厅面
    b.set(3, 1, 3, bid('redstone_torch'));                 // 中央火种
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      b.set(3 + dx, 1, 3 + dz, bid('redstone_wire'));      // 四条支路导线
      b.set(3 + dx * 3, 1, 3 + dz * 3, bid('redstone_lamp_lit')); // 四盏点亮的灯
    }
    return { size, voxels: b.voxels };
  }
  if (kind === 'frame_rack') {
    const size = { x: 9, y: 3, z: 3 };
    const b = makeVoxelBuilder(size);
    b.box(0, 0, 0, 8, 0, 2, bid('stone_bricks'));          // 地基
    b.box(0, 1, 0, 8, 2, 0, bid('quartz_block'));          // 北墙
    // 三处凹槽槽心（槽距 3 格，与 RACK_LAYOUT 同款间距）
    b.set(1, 1, 0, bid('quartz_block'));
    b.set(4, 1, 0, bid('glowstone'));
    b.set(7, 1, 0, bid('sea_lantern'));
    return { size, voxels: b.voxels };
  }
  return null;
}

const _rewardBlueprintCache = new Map();

// 取某类机关的奖励定义；蓝图按 (kind, name) 缓存，次数上限内一次性生成。
export function ruinReward(kind, name = '') {
  if (RUIN_KINDS.indexOf(kind) < 0) return null;
  const blueprintName = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 24) : RUIN_REWARD_BLUEPRINT_NAME[kind];
  const cacheKey = kind + '|' + blueprintName;
  let blueprint = _rewardBlueprintCache.get(cacheKey);
  if (!blueprint) {
    const table = ruinVoxels(kind);
    if (!table) return null;
    const palette = [0];
    const indexOf = new Map([[0, 0]]);
    for (const id of table.voxels) {
      if (indexOf.has(id)) continue;
      indexOf.set(id, palette.length);
      palette.push(id);
    }
    blueprint = {
      id: RUIN_REWARD_BLUEPRINT_ID[kind],
      name: blueprintName,
      dim: RUIN_KIND_DIM[kind],
      rev: 1,
      byId: '',
      size: table.size,
      palette,
      data: encodeBlueprintRLE(table.voxels, palette),
    };
    if (!validateBlueprint(blueprint).ok) return null;
    _rewardBlueprintCache.set(cacheKey, blueprint);
  }
  return {
    kind,
    block: RUIN_REWARD_BLOCK[kind],
    plaque: RUIN_REWARD_PLAQUE,
    blueprint: { ...blueprint, size: { ...blueprint.size }, palette: blueprint.palette.slice() },
  };
}
