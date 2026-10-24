// Phenomena.js -- 局部潮候与稀有景象（Build 37 G）
// 纯推导：只由「维度 + 当日时间 + 一天时长」算出阶段（静默/预兆/涌现），
// 不读世界、不写方块、不用 Math.random——联机两端拿同一份服务器权威 time，
// 因此预兆与涌现天然同步，且不需要新增账本与协议。

// 预兆时长（秒）：现象开始前 60 秒必须有明确预兆，不允许突然出现。
export const OMEN_SECONDS = 60;
// 观测门槛（秒）：站在可见范围内持续这么久才计数一次。
export const OBSERVE_SECONDS = 8;
// 涌现首尾的淡入淡出占比（避免强度跳变，也是观测门槛要等强度上来才计数的原因）。
const FADE = 0.12;

// 每维一种现象：window 是「当日时间」区间（0=半夜 0.5=正午 1=半夜），一律不跨 1.0。
// 窗口取在各自维度的光照气质最合适的时段；周期 = 一整天（随潮汐周期重现）。
export const PHENOMENA = {
  overworld: {
    kind: 'shore_glow', label: '岸线荧光', window: [0.78, 0.86],
    color: [0.42, 0.96, 0.86],
    omen: '海岸方向浮起一层青白色的薄雾。',
  },
  nether: {
    kind: 'ash_tide', label: '灰烬潮', window: [0.30, 0.38],
    color: [1.0, 0.58, 0.26],
    omen: '空气里开始飘落温热的灰。',
  },
  end: {
    kind: 'silent_tide', label: '无声之潮', window: [0.55, 0.63],
    color: [0.72, 0.74, 1.0],
    omen: '四周的声音被压得很低，虚空边缘发白。',
  },
  aether: {
    kind: 'aurora_flow', label: '风光带', window: [0.18, 0.26],
    color: [0.55, 1.0, 0.66],
    omen: '云海尽头透出一线绿光。',
  },
};

// 集齐顺序（游记列表、纪念判定都按这个顺序，避免依赖 Object.keys 的偶然稳定）
export const PHENOMENON_ORDER = ['overworld', 'nether', 'end', 'aether'];

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

function normalizeTime(t) {
  const v = Number.isFinite(t) ? t : 0;
  const w = v - Math.floor(v);
  return w === 1 ? 0 : w;
}

function safeDay(dayLength) {
  return Number.isFinite(dayLength) && dayLength > 0 ? dayLength : 1200;
}

export function phenomenonFor(dim) {
  return Object.prototype.hasOwnProperty.call(PHENOMENA, dim) ? PHENOMENA[dim] : null;
}

// 预兆占当日时间的比例：按秒折算，所以改 dayLength 时预兆仍是 60 秒。
// 上限 0.25 防止极短的一天把预兆窗口套到前一个现象的尾段上。
export function omenFraction(dayLength) {
  const day = safeDay(dayLength);
  return Math.min(0.25, Math.max(0.001, OMEN_SECONDS / day));
}

// 阶段推导。返回结构固定（idle 也有 kind/label），调用方不需要判空：
// { dim, kind, label, phase: 'idle'|'omen'|'active', progress, intensity,
//   secondsToOmen, secondsToStart, secondsLeft, windowSeconds }
export function phaseAt(dim, timeOfDay, dayLength) {
  const def = phenomenonFor(dim);
  const day = safeDay(dayLength);
  const t = normalizeTime(timeOfDay);
  if (!def) {
    return { dim, kind: null, label: '', phase: 'idle', progress: 0, intensity: 0,
      secondsToOmen: 0, secondsToStart: 0, secondsLeft: 0, windowSeconds: 0 };
  }
  const [start, end] = def.window;
  const omenFrac = omenFraction(day);
  const omenStart = Math.max(0, start - omenFrac);
  const windowSeconds = (end - start) * day;
  const base = { dim, kind: def.kind, label: def.label, progress: 0, intensity: 0,
    secondsToOmen: 0, secondsToStart: 0, secondsLeft: 0, windowSeconds };
  if (t >= start && t < end) {
    const progress = (t - start) / (end - start);
    const fade = Math.min(1, progress / FADE, (1 - progress) / FADE);
    return { ...base, phase: 'active', progress, intensity: clamp01(fade),
      secondsLeft: (end - t) * day };
  }
  if (t >= omenStart && t < start) {
    return { ...base, phase: 'omen', progress: (t - omenStart) / omenFrac,
      secondsToOmen: (start - t) * day, secondsToStart: (start - t) * day };
  }
  // 静默：给出到下一次预兆开始 / 现象开始的秒数（跨午夜按 +1 天回绕）
  const toOmen = t < omenStart ? (omenStart - t) * day : (omenStart + 1 - t) * day;
  return { ...base, phase: 'idle', secondsToOmen: toOmen, secondsToStart: toOmen + OMEN_SECONDS };
}

// 观测累计：ok 时累加、否则按两倍速回退（走开一会不至于立刻清零，但也不会隔空攒满）。
export function advanceDwell(dwell, ok, dt, need = OBSERVE_SECONDS) {
  const prev = Number.isFinite(dwell) && dwell > 0 ? dwell : 0;
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const target = Math.max(1e-6, Number.isFinite(need) && need > 0 ? need : OBSERVE_SECONDS);
  const next = ok ? Math.min(target, prev + step) : Math.max(0, prev - step * 2);
  return { dwell: next, ready: next >= target - 1e-9 };
}

// 观测点锚键：64 格一格的区域，只用来在游记里记「在哪片区域看到的」。
export function anchorKeyOf(x, z, size = 64) {
  const step = Number.isFinite(size) && size > 0 ? size : 64;
  const gx = Number.isFinite(x) ? Math.floor(x / step) : 0;
  const gz = Number.isFinite(z) ? Math.floor(z / step) : 0;
  return `${gx},${gz}`;
}

// 观测门槛用的可见强度：淡入淡出期间不计数（避免刚到就开始攒）。
export function observable(state) {
  return !!state && state.phase === 'active' && state.intensity >= 0.45;
}
