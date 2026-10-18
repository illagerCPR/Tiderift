// ray-sphere.mjs -- F6 射线-球体纯函数回归（node 直跑，无需服务器）
// 断言：
//   ① 正面命中：返回近交点参数 t 且与手算一致（起点 (0,0,0) 沿 +X，球心 (5,0,0) 半径 1 → t=4）；斜向单位方向同样成立
//   ② 未命中（判别式 < 0）→ -1；球心在射线后方 → -1；起点在球内 → -1（旧口径只取近根，不取远根）
//   ③ 球心恰在射线上（含球心与起点重合）；相切（disc 恰为 0）
//   ④ 半径为 0（退化为球心点）
//   ⑤ 方向非单位向量的口径：判别式按单位方向推导，t 不随 |d| 归一，不是几何距离（与旧内联实现逐式一致）
//   ⑥ 不夹取射程：函数返回原始 t，> maxDist 的过滤留给调用方
//   ⑦ 构造式模糊测试（400 组 = 命中/未命中/球心在后/起点在球内各 100）：命中点必在球面上、t 必为近根、
//     共线球心（距起点 want + r）必返回 want
//   ⑧ 接线：冻结签名 / 零分配（函数体无 new）/ Game._findRemoteByRay 调它且保留 1.8 身高区间与最近者语义
//   ⑨ 帧射线缓存（F10）：同一帧只构建一次、跨帧令牌变化必重建、缓存对象复用不分配；
//     UI 阻断清单（F11）唯一入口只有一处定义
import { readFileSync } from 'fs';
import { raySphereHit } from '../src/player/Raycast.js';
import { Game } from '../src/player/Game.js';
import { PLAYER_EYE_HEIGHT } from '../src/player/constants.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }

// ── ① 正面命中（含斜向单位方向） ──
{
  const t = raySphereHit(0, 0, 0, 1, 0, 0, 5, 0, 0, 1);
  ok(near(t, 4, 1e-12), '正面命中近交点 t = 5 - sqrt(25 - 24) = 4，实得 ' + t);
  ok(near(Math.hypot(t - 5, 0, 0), 1, 1e-12), '命中点落在球面上（|p - center| = r）');

  const ty = raySphereHit(0, 3, 0, 1, 0, 0, 5, 3, 0, 1);
  ok(near(ty, 4, 1e-12), '竖直偏移命中：球心抬到 y=3 后 t 仍为 4，实得 ' + ty);

  const dx = 0.6, dy = 0.8; // 单位方向 (0.6, 0.8, 0)，球心在射线上距起点 10 格
  const td = raySphereHit(0, 0, 0, dx, dy, 0, dx * 10, dy * 10, 0, 1);
  ok(near(td, 9, 1e-12), '斜向单位方向：t = 10 - 1 = 9，实得 ' + td);
  ok(near(Math.hypot(dx * td - dx * 10, dy * td - dy * 10, 0), 1, 1e-12), '斜向命中点落在球面上');
}

// ── ② 未命中 / 球心在后方 / 起点在球内 ──
{
  ok(raySphereHit(0, 0, 0, 1, 0, 0, 5, 3, 0, 1) === -1, '未命中（判别式 < 0）返回 -1');
  ok(raySphereHit(0, 0, 0, 1, 0, 0, 5, 1.0001, 0, 1) === -1, '擦过球外（判别式恰好为负）返回 -1');
  ok(raySphereHit(0, 0, 0, 1, 0, 0, -5, 0, 0, 1) === -1, '球心在射线后方（两负根）返回 -1');
  ok(raySphereHit(0, 0, 0, 1, 0, 0, -0.5, 0, 0, 1) === -1, '起点在球内：近根为负 → -1（旧口径只取近根）');
}

// ── ③ 球心恰在射线上 / 相切 / 球心与起点重合 ──
{
  ok(near(raySphereHit(0, 0, 0, 1, 0, 0, 5, 0, 0, 1), 4, 1e-12), '球心恰在射线正轴上：t = 4');
  ok(raySphereHit(0, 0, 0, 1, 0, 0, 0, 0, 0, 1) === -1, '球心与起点重合：近根 -1 < 0 → -1（旧口径）');
  const tg = raySphereHit(0, 0, 0, 1, 0, 0, 5, 1, 0, 1); // oc=(-5,-1,0) → disc = 25 - 25 = 0
  ok(near(tg, 5, 1e-12), '相切（disc = 0）：t = -b - 0 = 5，实得 ' + tg);
  ok(near(Math.hypot(tg - 5, 0 - 1, 0), 1, 1e-12), '切点 (5,0,0)（球心 (5,1,0) 正下方 1 格）落在球面上');
}

// ── ④ 半径为 0 ──
{
  ok(near(raySphereHit(0, 0, 0, 1, 0, 0, 5, 0, 0, 0), 5, 1e-12), '半径 0 退化为球心点：t = 5');
  ok(raySphereHit(0, 0, 0, 1, 0, 0, -5, 0, 0, 0) === -1, '半径 0 且球心在后方 → -1');
  ok(raySphereHit(0, 0, 0, 1, 0, 0, 5, 0.5, 0, 0) === -1, '半径 0 且球心不在射线上 → -1');
}

// ── ⑤ 方向非单位向量的口径（与旧内联实现一致：不归一，t 随 |d| 变化） ──
{
  // oc=(-10,0,0)、b=-20、c=99 → disc = 400 - 99 = 301 → t = 20 - sqrt(301)
  const t = raySphereHit(0, 0, 0, 2, 0, 0, 10, 0, 0, 1);
  ok(near(t, 20 - Math.sqrt(301), 1e-12), '非单位方向 (2,0,0)：t = 20 - sqrt(301)，实得 ' + t);
  ok(!near(t, 4.5, 1e-9), '口径说明：非单位方向下 t 不是几何交点参数（同一几何的正确解应为 4.5）');
  ok(!near(Math.hypot(2 * t - 10, 0, 0), 1, 1e-9), '口径说明：非单位方向下命中的 t 不落在球面上——调用方必须传单位向量');
  ok(near(raySphereHit(0, 0, 0, 1, 0, 0, 10, 0, 0, 1), 9, 1e-12), '同一几何：方向归一后 t = 9（几何解）');
}

// ── ⑥ 不夹取射程（过滤留给调用方） ──
{
  ok(near(raySphereHit(0, 0, 0, 1, 0, 0, 100, 0, 0, 1), 99, 1e-12), '超出攻击射程的球体仍返回原始 t = 99（函数不夹取）');
  ok(near(raySphereHit(0, 0, 0, 1, 0, 0, 4, 0, 0, 1), 3, 1e-12), '射程内球体返回 t = 3');
}

// ── ⑦ 构造式模糊测试（400 组） ──
{
  let seed = 20261017;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const unit = () => { const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z); return [s * Math.cos(a), z, s * Math.sin(a)]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
  let hits = 0, misses = 0, behind = 0, inside = 0;
  for (let i = 0; i < 400; i++) {
    const o = [rnd() * 20 - 10, rnd() * 20 - 10, rnd() * 20 - 10];
    const d = unit();
    const r = 0.2 + rnd() * 3;
    const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; // 与 d 不平行的参照轴（|d.y| 大时改用 X 轴）
    const u = norm(cross(d, ref)), v = cross(d, u);
    const ang = rnd() * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
    // dist = 球心沿射线的投影距离，h = 球心到射线的垂直距离
    const at = (dist, h) => [o[0] + d[0] * dist + u[0] * h * ca + v[0] * h * sa,
                             o[1] + d[1] * dist + u[1] * h * ca + v[1] * h * sa,
                             o[2] + d[2] * dist + u[2] * h * ca + v[2] * h * sa];
    const call = (c) => raySphereHit(o[0], o[1], o[2], d[0], d[1], d[2], c[0], c[1], c[2], r);
    if (i % 4 === 0) {                                   // 必有交（h < r）
      const want = 0.5 + rnd() * 30, h = rnd() * r * 0.98;
      const c = at(want + Math.sqrt(r * r - h * h), h);
      const t = call(c);
      ok(near(t, want, 1e-9), '构造命中：近交点 t = 期望值（组 ' + i + '）');
      const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      ok(near(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]), r, 1e-9), '命中点落在球面上（组 ' + i + '）');
      const pm = [o[0] + d[0] * t * 0.5, o[1] + d[1] * t * 0.5, o[2] + d[2] * t * 0.5];
      ok(Math.hypot(pm[0] - c[0], pm[1] - c[1], pm[2] - c[2]) > r - 1e-9, '取近根：t/2 处仍在球外（组 ' + i + '）');
      const want2 = 0.5 + rnd() * 30;                    // 共线球心：距起点 want2 + r
      ok(near(call(at(want2 + r, 0)), want2, 1e-9), '共线球心 ⇒ t 恰为 want2（组 ' + i + '）');
      hits++;
    } else if (i % 4 === 1) {                            // 直线无交（h > r）
      ok(call(at(2 + rnd() * 10, r + 0.05 + rnd() * 5)) === -1, '直线离球心距离 > r ⇒ -1（组 ' + i + '）');
      misses++;
    } else if (i % 4 === 2) {                            // 直线有交但球心在起点后方
      const h = rnd() * r * 0.9;
      ok(call(at(-(0.5 + rnd() * 10) - Math.sqrt(r * r - h * h), h)) === -1, '球心在射线后方 ⇒ -1（组 ' + i + '）');
      behind++;
    } else {                                             // 起点在球内：距起点 < r
      ok(call(at((rnd() - 0.5) * r * 0.5, rnd() * r * 0.5)) === -1, '起点在球内 ⇒ -1（旧口径只取近根）（组 ' + i + '）');
      inside++;
    }
  }
  ok(hits === 100 && misses === 100 && behind === 100 && inside === 100,
    '四类构造各覆盖 100 组（' + hits + '/' + misses + '/' + behind + '/' + inside + '）');
}

// ── ⑧ 接线与冻结接口 ──
{
  const raySrc = srcOf('../src/player/Raycast.js');
  ok(/export function raySphereHit\(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius\)/.test(raySrc),
    'Raycast.js 导出冻结签名 raySphereHit(ox,oy,oz,dx,dy,dz,cx,cy,cz,radius)');
  ok(!/\bnew\b/.test(raySphereHit.toString()), '纯函数零分配：函数体内无 new（标量入参，无 Vector3 scratch）');

  const gameSrc = srcOf('../src/player/Game.js');
  ok(gameSrc.includes('raySphereHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, c.x, c.y, c.z, 0.5)'),
    'Game._findRemoteByRay 改调共享纯函数（球心 rp.group.position、半径 0.5）');
  ok(gameSrc.includes('const t = raySphereHit(') && gameSrc.includes('if (t < 0 || t > bestDist) continue;'),
    'Game 侧保留「取最近者」语义（bestDist 过滤）');
  ok(gameSrc.includes('if (hy < c.y || hy > c.y + 1.8) continue;'), 'Game 侧保留 1.8 身高区间判定');
  ok(!gameSrc.includes('Math.sqrt(disc)'), 'Game.js 内已无第二份球体判别式');
  ok(!gameSrc.includes('0.5 * 0.5'), 'Game.js 内已无内联半径平方（0.5 * 0.5）');
}

// ── ⑨ 帧射线缓存（F10）与 UI 阻断清单（F11）接线 ──
{
  const fake = Object.create(Game.prototype); // 只借原型方法，不实例化（无需 DOM/WebGL）
  fake.frame = 7;
  fake.player = { position: { x: 1, y: 64, z: -3 } };
  fake.renderer = { camera: { getWorldDirection: (v) => v.set(0, 0, -1) } };
  const a = fake._frameRay();
  ok(near(a.origin.x, 1, 0) && near(a.origin.y, 64 + PLAYER_EYE_HEIGHT, 0) && near(a.origin.z, -3, 0),
    '_frameRay：起点 = 玩家坐标 + 眼高（' + a.origin.x + ',' + a.origin.y + ',' + a.origin.z + '）');
  ok(a.dir.z === -1 && a.dir.x === 0 && a.dir.y === 0, '_frameRay：方向取自相机 getWorldDirection');
  ok(fake._frameRay() === a, '同一帧内重复调用返回同一份缓存（只构建一次）');
  fake.player.position.x = 99;
  ok(fake._frameRay() === a && near(a.origin.x, 1, 0), '同一帧内不重建：本帧内多处读到的是同一份射线');
  fake.frame = 8; // 跨帧令牌变化
  const b = fake._frameRay();
  ok(b === a && near(b.origin.x, 99, 0), '跨帧必重建：令牌变化后刷新为新坐标（复用同一对象，首帧后零分配）');
  ok(fake._frameRay() === b && near(b.origin.x, 99, 0), '新帧内再次调用仍复用（不重复构建）');

  const gameSrc = srcOf('../src/player/Game.js');
  ok((gameSrc.match(/this\._frameRay\(\)/g) || []).length >= 4, '帧射线被 updateRaycast / 远端玩家 / 怪物攻击 / 村民交互四处消费');
  ok(gameSrc.includes('cache.origin.y += PLAYER_EYE_HEIGHT;'), '帧射线起点与眼高常量同源');
  ok(gameSrc.split('_anyInputBlockingUI() {').length === 2, 'F11 阻断 UI 清单只有一处定义');
  ok((gameSrc.match(/this\._anyInputBlockingUI\(\)/g) || []).length >= 4, 'F11 清单被四处调用点消费');
}

console.log('ray-sphere: ' + passed + ' assertions passed');
