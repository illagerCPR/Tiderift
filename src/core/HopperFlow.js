// HopperFlow.js -- Build 36 F-1 漏斗搬运的纯算法（服务器权威 tick 与单机本地 tick 共用）
// 无浏览器/Three 依赖，node 可测。语义：
//   每 tick 每漏斗最多搬一堆（先出后进）——漏斗自身 27 槽就是缓冲；
//   进料口 = 正上方容器，出料口 = facing 方向相邻容器；两者都由调用方注入（服务器=房间账本，单机=World.containers）。
// 调用方只负责容器读写与广播，搬运决策全部收口于此。

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

// 同类可堆叠：同名 + 双方都不带 data（潜影盒内容跟随物品，永不堆叠）
function canMerge(src, dst) {
  if (!src || !dst) return false;
  if (src.name !== dst.name) return false;
  return src.data == null && dst.data == null;
}

// 目标槽：同类未满优先，其次空槽；都没有返回 -1（目标满/不兼容）
function targetSlot(dst, stack) {
  for (let i = 0; i < dst.length; i++) {
    const s = dst[i];
    if (s && canMerge(stack, s) && s.count < HOPPER_MAX_STACK) return i;
  }
  for (let i = 0; i < dst.length; i++) if (!dst[i]) return i;
  return -1;
}

// 从 from 搬「一堆」到 to（上限 = 目标剩余空间，下限 1）。搬动成功返回 true。
function moveOneStack(from, to) {
  if (!Array.isArray(from) || !Array.isArray(to) || from === to) return false;
  let si = -1;
  for (let i = 0; i < from.length; i++) {
    const s = from[i];
    if (s && s.count > 0) { si = i; break; }
  }
  if (si < 0) return false;
  const stack = from[si];
  const di = targetSlot(to, stack);
  if (di < 0) return false;
  const space = to[di] ? HOPPER_MAX_STACK - to[di].count : HOPPER_MAX_STACK;
  const n = Math.min(space, stack.count);
  if (n <= 0) return false;
  if (to[di]) to[di].count += n;
  else to[di] = { name: stack.name, count: n, data: stack.data ?? null };
  stack.count -= n;
  if (stack.count <= 0) from[si] = null;
  return true;
}

// 推进一个维度内的全部漏斗（hoppers = [{x,y,z,facing}]，顺序由调用方固定以保确定性）。
// io.getContainer(x,y,z)     -> 27 槽数组或 null（只读，不创建）
// io.ensureContainer(x,y,z)  -> 27 槽数组或 null（允许时创建空容器；不允许返回 null）
// 返回本 tick 被写入的容器键集合（"x,y,z"），每容器最多一条——调用方据此按容器合并广播。
export function tickHopperFlow(hoppers, io) {
  const touched = new Set();
  if (!Array.isArray(hoppers) || !hoppers.length || !io) return touched;
  for (const h of hoppers) {
    if (!h || !Number.isFinite(h.x) || !Number.isFinite(h.y) || !Number.isFinite(h.z)) continue;
    const self = io.ensureContainer(h.x, h.y, h.z);
    if (!self) continue;
    const selfKey = `${h.x},${h.y},${h.z}`;
    // 先出：漏斗缓冲 -> 出料口相邻容器
    const t = flowTarget(h.x, h.y, h.z, h.facing);
    const dst = io.ensureContainer(t.x, t.y, t.z);
    let moved = false;
    if (dst && dst !== self && moveOneStack(self, dst)) {
      touched.add(`${t.x},${t.y},${t.z}`);
      touched.add(selfKey);
      moved = true;
    }
    // 后进：正上方容器 -> 漏斗缓冲
    if (!moved) {
      const up = io.getContainer(h.x, h.y + 1, h.z);
      if (up && up !== self && moveOneStack(up, self)) {
        touched.add(`${h.x},${h.y + 1},${h.z}`);
        touched.add(selfKey);
      }
    }
  }
  return touched;
}
