// core/Magic.js -- 四潮回响的纯逻辑（Build 51 R4 / B54 R1 四系齐备）
// 回响资源的存取与调谐、施法校验（费用/冷却/模式/世界开关）、风步落点求解（碰撞安全）、
// 回潮治疗裁剪（不溢出生命上限）、折步落点求解（必须已加载 + 有立足面 + 不在实心格里）、
// 烬矢弹道推进与球体命中。无 DOM / 无 Three：落点与命中都用标量/回调，node 可测。
//
// 边界（计划 §6.4 红线）：
//   · 风步：沿视线短距冲刺，**不穿墙、不变成飞行**；落点必须已加载且有站立空间。
//   · 烬矢：直线灼热弹，**不点燃地形、不炸方块**；每发只结算一次伤害。
//   · 回潮：只恢复自己，**不超过生命上限**、不生成水；满血时拒绝且不扣回响。
//   · 折步：向可见落点短距折跃，**不跨维、不穿墙、不落未加载区块/实心格**；找不到落点时不扣回响。
//   · 所有施法都要先过「世界启用魔法 + 手持对应焦点 + 回响足够 + 冷却已过 + 非创造/旁观」五关。
import {
  ECHO_MAX, ECHO_PER_LEVEL, spellDef, SPELLS, CAST_FAIL_TEXT,
} from '../content/magic/defs.js';

// 回响资源（纯函数式存取；上限内钳制，绝不透支）
export function clampEcho(v, max = ECHO_MAX) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

// 蓄力插值（B54 R2）：charge 0 → 基础值，1 → def.charged 里的上限值。
//   · 基值与上限值都是整数时结果取整（生命/伤害不留小数）；
//   · 未列入 charged 的字段（费用/冷却/速度等）原样保留，蓄力只买效果不买费用；
//   · 非有限 charge 按 0 处理，越界钳到 [0,1]。
export function spellAtCharge(def, charge) {
  if (!def) return null;
  const c = Number.isFinite(Number(charge)) ? Math.max(0, Math.min(1, Number(charge))) : 0;
  if (!def.charged) return def;
  const out = { ...def };
  for (const [key, target] of Object.entries(def.charged)) {
    const base = Number(def[key]);
    const to = Number(target);
    if (!Number.isFinite(base) || !Number.isFinite(to)) continue;
    const mixed = base + (to - base) * c;
    out[key] = Number.isInteger(base) && Number.isInteger(to) ? Math.round(mixed) : mixed;
  }
  return out;
}

// 施法失败反馈的统一出口（B54 R2）：码 → { code, text(文案键), hud(回响条脉冲种类) }
//   hud: none | echo-low（回响不足）| cooldown（冷却中）| target（目标无效）
const FEEDBACK_HUD = Object.freeze({
  echo: 'echo-low',
  cooldown: 'cooldown',
  target: 'target',
  wounded: 'target',
});
export function castFeedback(code) {
  const text = CAST_FAIL_TEXT[code] || CAST_FAIL_TEXT.unknown;
  return { code: CAST_FAIL_TEXT[code] ? code : 'unknown', text, hud: FEEDBACK_HUD[code] || 'none' };
}

// 施法前校验：返回 { ok, code }
//   code: disabled（世界未启用魔法）| no-focus | wrong-focus | mode（创造/旁观）| echo | cooldown | unknown
export function checkCast({ spellId, held, echo, cooldownLeft, magicEnabled, spectator, creative }) {
  const def = spellDef(spellId);
  if (!def) return { ok: false, code: 'unknown' };
  if (!magicEnabled) return { ok: false, code: 'disabled' };
  if (spectator || creative) return { ok: false, code: 'mode' };
  if (held !== def.focus) return { ok: false, code: held ? 'wrong-focus' : 'no-focus' };
  if (cooldownLeft > 0) return { ok: false, code: 'cooldown' };
  if (clampEcho(echo) < def.cost) return { ok: false, code: 'echo' };
  return { ok: true, code: 'ok' };
}

// 仪台调谐：1 级经验 → ECHO_PER_LEVEL 回响。返回 { ok, code, gain, levels }
//   code: disabled | no-magic-level（经验等级不足）| full（回响已满）
export function tuneEcho({ echo, xpLevel, magicEnabled }) {
  if (!magicEnabled) return { ok: false, code: 'disabled', gain: 0, levels: 0 };
  if (xpLevel < 1) return { ok: false, code: 'no-level', gain: 0, levels: 0 };
  const cur = clampEcho(echo);
  if (cur >= ECHO_MAX) return { ok: false, code: 'full', gain: 0, levels: 0 };
  const gain = Math.min(ECHO_PER_LEVEL, ECHO_MAX - cur);
  return { ok: true, code: 'ok', gain, levels: 1 };
}

// 风步落点：沿视线方向走 distance，逐格步进直到撞墙/无立足，返回可落脚点。
//   probe(distanceAlongRay) -> { blocked:boolean, standable:boolean }
//   调用方提供世界查询（不在此模块读世界）；blocked 即立刻停在上一步。
export function resolveDashTarget(distance, probe) {
  const step = 0.25;
  let last = 0;
  for (let d = step; d <= distance + 1e-9; d += step) {
    const r = probe(d);
    if (!r) continue;
    if (r.blocked) break;
    last = d;
    if (r.standable === false) continue; // 该点没有立足面：允许继续（可能翻过矮沟）
  }
  return Math.min(distance, last);
}

// 折步落点（B54）：沿视线找**最远的可站立点**。与风步的区别：
//   · 任何一处被挡（实心格 / 未加载区块）就整段停下 —— 不越过障碍取巧；
//   · 终点必须有立足面，悬空点不作数（不把人折进半空或虚空）。
//   probe(distanceAlongRay) -> { blocked:boolean, free:boolean, standable:boolean }
export function resolveBlinkTarget(distance, probe, step = 0.25) {
  let best = 0;
  for (let d = step; d <= distance + 1e-9; d += step) {
    const r = probe(d);
    if (!r) break;
    if (r.blocked || r.free === false) break;
    if (r.standable) best = d;
  }
  return best;
}

// 回潮（B54）：把治疗量裁剪到「不超过生命上限」，满血时明确拒绝（调用方据此不扣回响）。
//   返回 { ok, code, heal, health }；code: ok | full | unknown
export function planMend(health, maxHealth, heal) {
  const hp = Number(health);
  const max = Number(maxHealth);
  const amount = Number(heal);
  if (!Number.isFinite(hp) || !Number.isFinite(max) || max <= 0 || !Number.isFinite(amount)) {
    return { ok: false, code: 'unknown', heal: 0, health: 0 };
  }
  if (hp >= max) return { ok: false, code: 'full', heal: 0, health: max };
  const gain = Math.min(Math.max(0, amount), max - hp);
  if (!(gain > 0)) return { ok: false, code: 'full', heal: 0, health: hp };
  return { ok: true, code: 'ok', heal: gain, health: hp + gain };
}

// 烬矢推进一段：pos/vel 原地推进，返回 { hit: 'none'|'block'|'mob', mobIndex, dist }
//   trace(a, b) -> { block:boolean, mobIndex:number|-1 } 由调用方提供（世界与怪物查询）
export function advanceBolt(bolt, dt, trace) {
  const speed = Math.hypot(bolt.vx, bolt.vy, bolt.vz);
  if (!(speed > 0) || !(dt > 0)) return { hit: 'none', mobIndex: -1 };
  const px = bolt.x, py = bolt.y, pz = bolt.z;
  const nx = px + bolt.vx * dt, ny = py + bolt.vy * dt, nz = pz + bolt.vz * dt;
  const r = trace(px, py, pz, nx, ny, nz);
  if (r && r.mobIndex >= 0) {
    bolt.x = nx; bolt.y = ny; bolt.z = nz;
    return { hit: 'mob', mobIndex: r.mobIndex };
  }
  if (r && r.block) {
    bolt.x = nx; bolt.y = ny; bolt.z = nz;
    return { hit: 'block', mobIndex: -1 };
  }
  bolt.x = nx; bolt.y = ny; bolt.z = nz;
  return { hit: 'none', mobIndex: -1 };
}

// 弹道推进入口（运行态字段时钟 + 寿命）
export function stepBolt(bolt, dt, trace) {
  if (!bolt || bolt.dead) return { hit: 'none', mobIndex: -1 };
  bolt.life -= dt;
  if (bolt.life <= 0) { bolt.dead = true; return { hit: 'expired', mobIndex: -1 }; }
  const r = advanceBolt(bolt, dt, trace);
  if (r.hit !== 'none') bolt.dead = true;
  return r;
}

// 冷却记账：返回剩余秒数（0 = 可施放）
export function cooldownLeft(lastCastAt, now, spellId) {
  const def = spellDef(spellId);
  if (!def || !lastCastAt) return 0;
  const left = def.cooldown - (now - lastCastAt) / 1000;
  return left > 0 ? left : 0;
}

// ── 死亡 / 换维的生命周期规则（B54 R3）──────────────────────────────────
// 明确口径，避免"顺手清一下"把规则改歪：
//   · 回响与冷却属于**施法者本人**：死亡与换维都保留（死亡不惩罚资源，也不给跳崖刷新冷却的取巧）；
//   · 蓄力、弹道、缓降、防护（resistance）是运行态/世界内状态：死亡与换维一律清空；
//   · 冷却不进存档、不进协议——它只活在本进程的施法者身上（换维用 loadData 透传）。
export const MAGIC_LIFECYCLE = Object.freeze({
  death: Object.freeze({
    keepEcho: true, keepCooldowns: true,
    clearCharge: true, clearBolts: true, clearSlowFall: true, clearGuard: true,
  }),
  dimension: Object.freeze({
    keepEcho: true, keepCooldowns: true,
    clearCharge: true, clearBolts: true, clearSlowFall: true, clearGuard: true,
  }),
});

// 冷却表清洗：只留合法的「法术 ID → 毫秒时间戳」；脏值丢弃（换维透传与测试共用）
export function sanitizeCooldowns(raw, spells = SPELLS, now = Date.now()) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, at] of Object.entries(raw)) {
    if (!spells[id]) continue;
    const t = Number(at);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (t > now + 1000) continue; // 未来时间戳（时钟跳变/伪造）不接受
    if (now - t > 24 * 3600 * 1000) continue; // 一天前的记录没有意义
    out[id] = t;
  }
  return out;
}

// 弹道伤害口径（B54 R4 修）：伤害在**发射时**就定在弹体上（蓄力插值的结果），
// 推进阶段一律读弹体自带值——别再按法术 ID 回表，否则蓄力伤害会被基础值悄悄覆盖。
export function boltDamage(bolt, def) {
  const stored = Number(bolt && bolt.damage);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const base = Number(def && def.damage);
  return Number.isFinite(base) && base > 0 ? base : 0;
}

// 服务器侧形状校验：法术 ID 合法 + 数值在允许区间（轻信任模型的硬约束，不宣称反作弊）
//   B54：折步可带落点 (x2,y2,z2) 供远端画两团尘；落在允许范围内才透传，否则丢弃该字段。
export function sanitizeCast(msg) {
  const def = spellDef(msg && msg.spell);
  if (!def) return null;
  const nums = [msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (Math.abs(msg.x) > 30000000 || Math.abs(msg.z) > 30000000) return null;
  if (msg.y < -300 || msg.y > 1000) return null;
  const len = Math.hypot(msg.dx, msg.dy, msg.dz);
  if (!(len > 1e-6)) return null;
  const echo = typeof msg.echo === 'number' && Number.isFinite(msg.echo) ? msg.echo : -1;
  if (echo < 0 || echo > ECHO_MAX) return null;
  const out = {
    spell: def.id,
    x: msg.x, y: msg.y, z: msg.z,
    dx: msg.dx / len, dy: msg.dy / len, dz: msg.dz / len,
    echo,
  };
  // 落点（可选）：必须三点齐全、在起点附近且在同一高度带内，否则不携带
  const to = [msg.x2, msg.y2, msg.z2];
  if (to.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    const span = Math.hypot(msg.x2 - msg.x, msg.y2 - msg.y, msg.z2 - msg.z);
    if (msg.y2 >= -300 && msg.y2 <= 1000 && span <= 16) {
      out.x2 = msg.x2; out.y2 = msg.y2; out.z2 = msg.z2;
    }
  }
  return out;
}

export const MAGIC_SPELL_COUNT = Object.keys(SPELLS).length;
