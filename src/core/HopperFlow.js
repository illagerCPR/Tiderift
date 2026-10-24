// HopperFlow.js -- Build 36 漏斗搬运的纯算法（服务器权威 tick 与单机本地 tick 共用）
// 无浏览器/Three 依赖，node 可测。语义：
//   每 tick 每漏斗最多搬一堆（先出后进）——漏斗自身 27 槽就是缓冲；
//   进料口 = 正上方容器/熔炉，出料口 = facing 方向相邻容器/熔炉；两者都由调用方注入。
// 调用方只负责容器读写与广播，搬运决策全部收口于此。
// B36 F-2：出料口是熔炉 → 按「燃料槽优先」进料；进料口是熔炉 → 只取输出槽（产物才可外运）。
import { getFuelTime, getSmeltingResult } from './Smelting.js';

// 单槽上限（含带 data 的不可堆叠物品）
export const HOPPER_MAX_STACK = 64;
// 单机本地 tick 间隔（联机时由服务器 config.flowIntervalMs 决定，客户端不搬运）
export const HOPPER_INTERVAL_MS = 200;

// facing = 出料口方向（漏斗家族 facing 字段语义）；'down' 供后续向下变体复用
const DIRS = {
  n: [0, 0, -1], s: [0, 0, 1], e: [1, 0, 0], w: [-1, 0, 0], down: [0, -1, 0],
};

export function flowTarget(x, y, z, facing) {
  const d = DIRS[facing] || DIRS.down;
  return { x: x + d[0], y: y + d[1], z: z + d[2] };
}

// ── 槽位存取抽象：容器是 27 槽数组，熔炉是三槽视图（input/fuel/output）──
const FURNACE_SLOT_KEYS = ['input', 'fuel', 'output'];
const FURNACE_FUEL = 1;
const FURNACE_INPUT = 0;
const FURNACE_OUTPUT = 2;

function furnaceView(st) {
  return {
    length: 3,
    get(i) { return st[FURNACE_SLOT_KEYS[i]] || null; },
    set(i, v) { st[FURNACE_SLOT_KEYS[i]] = v || null; },
  };
}

const isView = (h) => !!h && typeof h.get === 'function' && typeof h.set === 'function';
function slotGet(h, i) { return isView(h) ? h.get(i) : h[i]; }
function slotSet(h, i, v) { if (isView(h)) h.set(i, v); else h[i] = v; }

// 同类可堆叠：同名 + 双方都不带 data（潜影盒内容跟随物品，永不堆叠）
function canMerge(src, dst) {
  if (!src || !dst) return false;
  if (src.name !== dst.name) return false;
  return src.data == null && dst.data == null;
}

// 目标槽：同类未满优先，其次空槽；都没有返回 -1（目标满/不兼容）
function targetSlot(dst, stack) {
  for (let i = 0; i < dst.length; i++) {
    const s = slotGet(dst, i);
    if (s && canMerge(stack, s) && s.count < HOPPER_MAX_STACK) return i;
  }
  for (let i = 0; i < dst.length; i++) if (!slotGet(dst, i)) return i;
  return -1;
}

// 从 from 搬「一堆」到 to（上限 = 目标剩余空间，下限 1）。搬动成功返回 true。
function moveOneStack(from, to) {
  if (!from || !to || from === to) return false;
  let si = -1;
  for (let i = 0; i < from.length; i++) {
    const s = slotGet(from, i);
    if (s && s.count > 0) { si = i; break; }
  }
  if (si < 0) return false;
  const stack = slotGet(from, si);
  const di = targetSlot(to, stack);
  if (di < 0) return false;
  const dst = slotGet(to, di);
  const space = dst ? HOPPER_MAX_STACK - dst.count : HOPPER_MAX_STACK;
  const n = Math.min(space, stack.count);
  if (n <= 0) return false;
  if (dst) dst.count += n;
  else slotSet(to, di, { name: stack.name, count: n, data: stack.data ?? null });
  stack.count -= n;
  if (stack.count <= 0) slotSet(from, si, null);
  return true;
}

// 熔炉进料路由（计划口径：燃料槽优先）——返回按优先级排列的目标槽下标
function furnaceSlotOrder(stack) {
  const asFuel = getFuelTime(stack.name) > 0;
  const smeltable = !!getSmeltingResult(stack.name);
  if (asFuel && smeltable) return [FURNACE_FUEL, FURNACE_INPUT];
  if (asFuel) return [FURNACE_FUEL];
  return [FURNACE_INPUT];
}

// 漏斗缓冲 -> 熔炉；成功返回 true
function pushIntoFurnace(self, st) {
  const view = furnaceView(st);
  let from = -1;
  for (let i = 0; i < self.length; i++) {
    const s = slotGet(self, i);
    if (s && s.count > 0) { from = i; break; }
  }
  if (from < 0) return false;
  const stack = slotGet(self, from);
  for (const di of furnaceSlotOrder(stack)) {
    const cur = slotGet(view, di);
    if (cur && (!canMerge(stack, cur) || cur.count >= HOPPER_MAX_STACK)) continue;
    const space = cur ? HOPPER_MAX_STACK - cur.count : HOPPER_MAX_STACK;
    const n = Math.min(space, stack.count);
    if (n <= 0) continue;
    if (cur) cur.count += n;
    else slotSet(view, di, { name: stack.name, count: n, data: stack.data ?? null });
    stack.count -= n;
    if (stack.count <= 0) slotSet(self, from, null);
    return true;
  }
  return false;
}

// 熔炉输出槽 -> 漏斗缓冲；成功返回 true（只取产物，输入/燃料槽不外流）
function pullFromFurnace(st, self) {
  const view = furnaceView(st);
  const out = slotGet(view, FURNACE_OUTPUT);
  if (!out || out.count <= 0) return false;
  const di = targetSlot(self, out);
  if (di < 0) return false;
  const dst = slotGet(self, di);
  const space = dst ? HOPPER_MAX_STACK - dst.count : HOPPER_MAX_STACK;
  const n = Math.min(space, out.count);
  if (n <= 0) return false;
  if (dst) dst.count += n;
  else slotSet(self, di, { name: out.name, count: n, data: out.data ?? null });
  out.count -= n;
  if (out.count <= 0) slotSet(view, FURNACE_OUTPUT, null);
  return true;
}

// 推进一个维度内的全部漏斗（hoppers = [{x,y,z,facing}]，顺序由调用方固定以保确定性）。
// io.getContainer(x,y,z)     -> 27 槽数组或 null（只读，不创建）
// io.ensureContainer(x,y,z)  -> 27 槽数组或 null（允许时创建空容器；不允许返回 null）
// io.getFurnace(x,y,z)       -> 熔炉状态或 null（只读，不创建；F-2）
// io.ensureFurnace(x,y,z)    -> 熔炉状态或 null（允许时创建；F-2）
// io.onFurnaceChanged(x,y,z) -> 熔炉被本 tick 改写时的回调（可选；调用方据此广播熔炉状态）
// 返回本 tick 被写入的容器键集合（"x,y,z"），每容器最多一条——调用方据此按容器合并广播。
export function tickHopperFlow(hoppers, io) {
  const touched = new Set();
  if (!Array.isArray(hoppers) || !hoppers.length || !io) return touched;
  const notifyFurnace = (x, y, z) => { if (io.onFurnaceChanged) io.onFurnaceChanged(x, y, z); };
  for (const h of hoppers) {
    if (!h || !Number.isFinite(h.x) || !Number.isFinite(h.y) || !Number.isFinite(h.z)) continue;
    const self = io.ensureContainer(h.x, h.y, h.z);
    if (!self) continue;
    const selfKey = `${h.x},${h.y},${h.z}`;
    // 先出：漏斗缓冲 -> 出料口相邻容器/熔炉
    const t = flowTarget(h.x, h.y, h.z, h.facing);
    const tKey = `${t.x},${t.y},${t.z}`;
    const dstFurnace = io.ensureFurnace ? io.ensureFurnace(t.x, t.y, t.z) : null;
    const dst = dstFurnace ? null : io.ensureContainer(t.x, t.y, t.z);
    let moved = false;
    if (dstFurnace && tKey !== selfKey) {
      if (pushIntoFurnace(self, dstFurnace)) {
        touched.add(selfKey);
        notifyFurnace(t.x, t.y, t.z);
        moved = true;
      }
    } else if (dst && dst !== self && moveOneStack(self, dst)) {
      touched.add(tKey);
      touched.add(selfKey);
      moved = true;
    }
    // 后进：正上方容器/熔炉 -> 漏斗缓冲
    if (!moved) {
      const upFurnace = io.getFurnace ? io.getFurnace(h.x, h.y + 1, h.z) : null;
      if (upFurnace) {
        if (pullFromFurnace(upFurnace, self)) {
          touched.add(selfKey);
          notifyFurnace(h.x, h.y + 1, h.z);
        }
      } else {
        const up = io.getContainer(h.x, h.y + 1, h.z);
        if (up && up !== self && moveOneStack(up, self)) {
          touched.add(`${h.x},${h.y + 1},${h.z}`);
          touched.add(selfKey);
        }
      }
    }
  }
  return touched;
}
