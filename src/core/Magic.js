// core/Magic.js -- 四潮回响的纯逻辑（Build 51 R4）
// 回响资源的存取与调谐、施法校验（费用/冷却/模式/世界开关）、风步落点求解（碰撞安全）、
// 烬矢弹道推进与球体命中。无 DOM / 无 Three：落点与命中都用标量/回调，node 可测。
//
// 边界（计划 §6.4 红线）：
//   · 风步：沿视线短距冲刺，**不穿墙、不变成飞行**；落点必须已加载且有站立空间。
//   · 烬矢：直线灼热弹，**不点燃地形、不炸方块**；每发只结算一次伤害。
//   · 所有施法都要先过「世界启用魔法 + 手持对应焦点 + 回响足够 + 冷却已过 + 非创造/旁观」五关。
import {
  ECHO_MAX, ECHO_PER_LEVEL, spellDef, SPELLS,
} from '../content/magic/defs.js';

// 回响资源（纯函数式存取；上限内钳制，绝不透支）
export function clampEcho(v, max = ECHO_MAX) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.floor(n)));
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

// 服务器侧形状校验：法术 ID 合法 + 数值在允许区间（轻信任模型的硬约束，不宣称反作弊）
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
  return {
    spell: def.id,
    x: msg.x, y: msg.y, z: msg.z,
    dx: msg.dx / len, dy: msg.dy / len, dz: msg.dz / len,
    echo,
  };
}

export const MAGIC_SPELL_COUNT = Object.keys(SPELLS).length;
