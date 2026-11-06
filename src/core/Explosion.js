// Explosion.js -- B48 爆炸纯数学：衰减/伤害/击退/方块抗性（无 THREE、无 DOM，node 可直接测）
// 方块破坏半径与伤害作用半径分开：破坏是 R 的球体，伤害/击退到 2R 才归零（原版手感：
// 站在坑边会被掀一跤，但 8 格外毫发无损）。
export const TNT_RADIUS = 4;          // 方块破坏半径（格）
export const TNT_POWER = 26;          // 点爆最大伤害（≈ 能秒掉无甲满血玩家，原版 TNT 量级）
export const KNOCKBACK_H = 14;        // 点爆水平击退（m/s）
export const KNOCKBACK_V = 7;         // 点爆上抛（m/s）
export const BLAST_PROOF_RESIST = 1200; // 爆炸抗性 ≥ 此值免疫（原版黑曜石 1200）

// 爆炸衰减：0 → 1，≥ 2R → 0（非有限值/负数一律 0，供联机脏数据兜底）
export function blastFalloff(dist, radius = TNT_RADIUS) {
  if (!Number.isFinite(dist) || dist < 0) return 0;
  const reach = radius * 2;
  if (!(reach > 0)) return 0;
  const f = 1 - dist / reach;
  return f > 0 ? (f < 1 ? f : 1) : 0;
}

export function blastDamage(dist, radius = TNT_RADIUS) {
  return TNT_POWER * blastFalloff(dist, radius);
}

export function blastKnockback(dist, radius = TNT_RADIUS) {
  const f = blastFalloff(dist, radius);
  return { h: KNOCKBACK_H * f, v: KNOCKBACK_V * f };
}

// 方块是否免疫爆炸：未破坏方块（hardness<0，如基岩）与高抗性方块（黑曜石）
export function isBlastProof(def) {
  if (!def) return true;
  if (!(def.hardness >= 0)) return true;
  return (def.blastResist || 0) >= BLAST_PROOF_RESIST;
}

// 球形判定（方块偏移量入参，供遍历用；边界含等号，与半径 4 的球体一致）
export function inBlastSphere(dx, dy, dz, radius = TNT_RADIUS) {
  if (!(radius > 0)) return false;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

// 从爆炸中心指向某点的单位向量（零距离返回 null，调用方据此跳过击退）
export function blastDir(dx, dy, dz) {
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(d > 1e-6)) return null;
  return { x: dx / d, y: dy / d, z: dz / d, dist: d };
}
