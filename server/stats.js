// stats.js -- B38 L2：服务器消息速率统计（会话级内存；不落盘、不进 roomSnapshot）
// 形态：1 秒一个点（入/出条数 + 入/出字节），每房间保留最近 STATS_POINTS 个（定长环形，防无限增长）。
// 入向在 index.mjs 的 ws.on('message') 记（先记再解析，畸形包也算流量）；
// 出向在 Room.sendTo 记——那是房间流量的唯一漏斗（sendTo / broadcast / broadcastDim 都经它）。
export const STATS_POINTS = 60;

const FIELDS = ['inMsgs', 'outMsgs', 'inBytes', 'outBytes'];

function emptyCounters() {
  return { inMsgs: 0, outMsgs: 0, inBytes: 0, outBytes: 0 };
}

export function createStatsStore({ points = STATS_POINTS } = {}) {
  const rooms = new Map(); // 房间名 -> { bucket, totals, players, points: [] }

  function ensure(name) {
    let st = rooms.get(name);
    if (!st) {
      st = { bucket: emptyCounters(), totals: emptyCounters(), points: [] };
      rooms.set(name, st);
    }
    return st;
  }

  return {
    // 累加一条流量的差值（负数/脏值按 0 丢弃，不让统计被畸形包拉回负值）
    add(name, delta) {
      if (!name || !delta) return;
      const st = ensure(String(name));
      for (const f of FIELDS) {
        const v = Number(delta[f]);
        if (!Number.isFinite(v) || v <= 0) continue;
        st.bucket[f] += v;
        st.totals[f] += v;
      }
    },

    // 关掉当前这一秒：压点、清桶、剪到定长。active(name) 返回 false 的房间（空房）整条回收。
    tick(atMs = Date.now(), active = null) {
      for (const [name, st] of rooms) {
        if (active && !active(name)) { rooms.delete(name); continue; }
        st.points.push({ t: atMs, ...st.bucket });
        if (st.points.length > points) st.points.shift();
        st.bucket = emptyCounters();
      }
    },

    snapshot(active = null) {
      const out = [];
      for (const [name, st] of rooms) {
        if (active && !active(name)) continue;
        out.push({
          name,
          totals: { ...st.totals },
          points: st.points.map((p) => ({ ...p })),
        });
      }
      return { at: Date.now(), pointLimit: points, rooms: out };
    },

    clear() { rooms.clear(); },
  };
}

// 进程级单例：index.mjs（入向 + 每秒采样 + API）与 room.js（出向）共用同一份
export const roomStats = createStatsStore();
