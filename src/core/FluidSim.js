// FluidSim.js -- 流体模拟（B26）：计划更新队列 + 扰动触发扩散
// 设计要点：
// - 流动体 = 独立方块 id（water_flow_1..7 / lava_flow_1..3），等级 1 最强（紧邻源）→ N 最弱；
//   源方块 water/lava 等级恒 0，永不衰减；存档/联机/光照因此全部复用方块 id 通道自动兼容。
// - 扰动触发：只在流体方块或其邻居被 setBlock 改动时入队（World.setBlock 钩子收口），
//   地形生成的海洋/岩浆海静态存续，永不自发流动（原版同款策略）。
// - 联机：host/单机权威模拟（客户端不跑 step，靠 host 的方块广播收敛，与作物生长同款门控）。
// - 供给重算：流动体期望等级 = min(水平邻居等级)+1，上方有同型流体 → 下落满强（等级 1）；
//   无供给逐级消退（每步 +1），超上限变空气；供给变强直接升级。
// - 相遇规则（原版三条）：水接触岩浆源 → 黑曜石；水接触流动岩浆 → 圆石；流动岩浆流向水 → 石头。

import { BlockRegistry } from './BlockRegistry.js';
import { posKey as blockKey, parsePosKey } from './posKey.js';

export const WATER_MAX_FLOW = 7;
export const LAVA_MAX_FLOW = 3;
export const WATER_STEP_MS = 250; // 水步进节奏
export const LAVA_STEP_MS = 500;  // 岩浆更粘滞
const MAX_TICKS_PER_STEP = 256;   // 每步处理预算（防流动风暴）
const HORIZ = [[1, 0], [-1, 0], [0, 1], [0, -1]];

let levelIds = null; // { water: [源id, flow1..7], lava: [源id, flow1..3] }
let fluidLUT = null; // Uint8Array(256)：高 4 位类型（1=water 2=lava）低 4 位等级；0=非流体
const infoCache = { water: [], lava: [] }; // 共享只读 info 对象（高频调用零分配）

function ensureLevelIds() {
  if (levelIds) return levelIds;
  levelIds = { water: [], lava: [] };
  const push = (type, name) => {
    const def = BlockRegistry.getByName(name);
    levelIds[type].push(def ? def.id : -1);
  };
  push('water', 'water');
  push('lava', 'lava');
  for (let l = 1; l <= WATER_MAX_FLOW; l++) push('water', `water_flow_${l}`);
  for (let l = 1; l <= LAVA_MAX_FLOW; l++) push('lava', `lava_flow_${l}`);
  fluidLUT = new Uint8Array(256);
  infoCache.water = [];
  infoCache.lava = [];
  for (let lv = 0; lv < levelIds.water.length; lv++) {
    const id = levelIds.water[lv];
    if (id >= 0) fluidLUT[id] = 0x10 | lv;
    infoCache.water[lv] = Object.freeze({ type: 'water', level: lv });
  }
  for (let lv = 0; lv < levelIds.lava.length; lv++) {
    const id = levelIds.lava[lv];
    if (id >= 0) fluidLUT[id] = 0x20 | lv;
    infoCache.lava[lv] = Object.freeze({ type: 'lava', level: lv });
  }
  return levelIds;
}

// id → { type, level }；level 0 = 源，1..MAX = 流动等级；非流体返回 null（查 LUT，零分配）
export function fluidInfo(id) {
  ensureLevelIds();
  const code = fluidLUT[id & 0xff];
  if (!code) return null;
  return (code & 0x10) ? infoCache.water[code & 0x0f] : infoCache.lava[code & 0x0f];
}

// 等级 → 方块 id；level 0 = 源
export function fluidIdAt(type, level) {
  const ids = ensureLevelIds();
  const arr = ids[type];
  return (level >= 0 && level < arr.length) ? arr[level] : -1;
}

export class FluidSim {
  constructor(world) {
    this.world = world;
    this.pendingWater = new Map(); // posKey -> [x,y,z]：下步待处理水格（入队即存坐标，步进免反解析）
    this.pendingLava = new Map();
    this._waterAcc = 0;
    this._lavaAcc = 0;
    this.writing = false; // 模拟内部 setBlock 标志：NetworkManager 据此分流批量通道
    this.muted = false;   // 客户端（非 host）置 true：不积累队列（靠 host 广播收敛）
  }

  reset() {
    this.pendingWater.clear();
    this.pendingLava.clear();
    this._waterAcc = 0;
    this._lavaAcc = 0;
    this.writing = false;
  }

  // 模拟内唯一写入口：置 writing 标志走 World.setBlock（光照/网格/联机全路径自动收口）
  _apply(x, y, z, id) {
    this.writing = true;
    try { this.world.setBlock(x, y, z, id); } finally { this.writing = false; }
  }

  static posKey(x, y, z) { return blockKey(x, y, z); }
  static parseKey(k) { return parsePosKey(k); }

  // 扰动入队（World.setBlock 钩子调用）：改动格与 6 邻居中的流体进入计划队列
  onBlockChanged(x, y, z) {
    if (this.muted) return; // 客户端不模拟也不积累队列
    this.scheduleAt(x, y, z);
    this.scheduleAt(x + 1, y, z);
    this.scheduleAt(x - 1, y, z);
    this.scheduleAt(x, y + 1, z);
    this.scheduleAt(x, y - 1, z);
    this.scheduleAt(x, y, z + 1);
    this.scheduleAt(x, y, z - 1);
  }

  scheduleAt(x, y, z) {
    const info = fluidInfo(this.world.getBlock(x, y, z));
    if (!info) return;
    (info.type === 'water' ? this.pendingWater : this.pendingLava).set(FluidSim.posKey(x, y, z), [x, y, z]);
  }

  // 存档重载/换维后补登记：modifiedBlocks 中的流动等级方块重新入队（防瀑布断流）
  rehydrate(modifiedBlocks) {
    if (!modifiedBlocks) return 0;
    let n = 0;
    for (const [k, id] of modifiedBlocks) {
      const info = fluidInfo(id);
      if (!info || info.level === 0) continue; // 源静态，不调度
      const p = FluidSim.parseKey(k);
      (info.type === 'water' ? this.pendingWater : this.pendingLava).set(k, [p.x, p.y, p.z]);
      n++;
    }
    return n;
  }

  update(dt) {
    this._waterAcc += dt * 1000;
    this._lavaAcc += dt * 1000;
    while (this._waterAcc >= WATER_STEP_MS) {
      this._waterAcc -= WATER_STEP_MS;
      this._step('water');
    }
    while (this._lavaAcc >= LAVA_STEP_MS) {
      this._lavaAcc -= LAVA_STEP_MS;
      this._step('lava');
    }
  }

  _step(type) {
    const q = type === 'water' ? this.pendingWater : this.pendingLava;
    if (!q.size) return;
    const batch = [];
    for (const entry of q) {
      batch.push(entry);
      if (batch.length >= MAX_TICKS_PER_STEP) break;
    }
    for (const [k] of batch) q.delete(k);
    for (const [, p] of batch) this._simulate(type, p[0], p[1], p[2]);
  }

  _isFluidOf(type, x, y, z) {
    const info = fluidInfo(this.world.getBlock(x, y, z));
    return !!info && info.type === type;
  }

  // 目标格可被流体写入：chunk 已加载，且为空气或更弱同型流动体（严格更弱，防同强度重写死循环）
  _canFlowInto(type, x, y, z, nextLevel) {
    if (y < 0 || y >= 256) return false;
    const c = this.world.getChunk(Math.floor(x / 16), Math.floor(z / 16));
    if (!c) return false; // 未加载区不模拟（不向虚无倒水）
    const id = this.world.getBlock(x, y, z);
    if (id === 0) return true;
    const info = fluidInfo(id);
    return !!info && info.type === type && info.level > nextLevel;
  }

  // 水平 4 邻中最小等级（无同型流体 → Infinity；源算 0）
  _minHorizLevel(type, x, y, z) {
    let m = Infinity;
    for (const [dx, dz] of HORIZ) {
      const info = fluidInfo(this.world.getBlock(x + dx, y, z + dz));
      if (info && info.type === type && info.level < m) m = info.level;
    }
    return m;
  }

  _simulate(type, x, y, z) {
    const w = this.world;
    const info = fluidInfo(w.getBlock(x, y, z));
    if (!info || info.type !== type) return; // 已被改走
    const maxFlow = type === 'water' ? WATER_MAX_FLOW : LAVA_MAX_FLOW;

    if (info.level === 0) { // 源：只扩散不重算
      this._spread(type, x, y, z, 0, maxFlow);
      return;
    }

    // 供给重算（流动体）：下落补给 = max(1, 上方等级)（垂直零衰减，柱内恒强）；
    // 水平补给 = min(水平邻居等级) + 1
    let e;
    if (this._isFluidOf(type, x, y + 1, z)) {
      const up = fluidInfo(w.getBlock(x, y + 1, z));
      e = Math.max(1, up.level);
    } else {
      const m = this._minHorizLevel(type, x, y, z);
      e = m === Infinity ? maxFlow + 1 : m + 1;
    }
    if (e < info.level) {
      this._apply(x, y, z, fluidIdAt(type, e)); // 补给变强 → 直接升级
      return;
    }
    if (e > info.level) {
      // 补给变弱（源头切断）→ 逐级消退（每步 +1，超上限变空气；原版同款波状回退）
      if (info.level + 1 > maxFlow) this._apply(x, y, z, 0);
      else this._apply(x, y, z, fluidIdAt(type, info.level + 1));
      return;
    }
    this._spread(type, x, y, z, info.level, maxFlow);
  }

  // 扩散：优先向下流（下落满强 = 等级 1），无下落出口才水平扩散 +1 级/格。
  // 相遇判定在扩散目标位（原版语义：流体流向异型流体时按规则固化）——
  // 水流向岩浆源 → 黑曜石；水流向流动岩浆 → 圆石；岩浆流向水 → 石头
  _spread(type, x, y, z, level, maxFlow) {
    const w = this.world;
    const next = level + 1;
    const tryFlow = (tx, ty, tz, flowLevel) => {
      const info = fluidInfo(w.getBlock(tx, ty, tz));
      if (info) {
        if (info.type === type) return false; // 同型：交由 _canFlowInto 判强弱
        // 异型相遇：固化生成（不写入流体）
        if (type === 'water') {
          this._apply(tx, ty, tz, info.level === 0 ? BlockRegistry.getId('obsidian') : BlockRegistry.getId('cobblestone'));
        } else {
          this._apply(tx, ty, tz, BlockRegistry.getId('stone'));
        }
        return true;
      }
      if (!this._canFlowInto(type, tx, ty, tz, flowLevel)) return false;
      this._apply(tx, ty, tz, fluidIdAt(type, flowLevel));
      return true;
    };
    // 下方已是同型流体：通道延续/落底收敛由下方格自身重算完成，本格不写入也不横向散
    const below = fluidInfo(w.getBlock(x, y - 1, z));
    if (below && below.type === type) return;
    if (tryFlow(x, y - 1, z, 1) || next > maxFlow) return; // 有下落出口 → 不水平扩散（防瀑布柱沿途横向散开）
    for (const [dx, dz] of HORIZ) {
      if (tryFlow(x + dx, y, z + dz, next)) continue;
    }
  }
}
