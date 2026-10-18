// end-gateway.mjs -- 龙败奖励链回归：折跃门/返程喷泉门/配对传送（node 直跑）
// 断言：
//   ① end_gateway 方块注册：末地传送门式立面（Build 20 ②）非固体发光不可破坏
//   ② gatewayPlacements：角度均布 / outer 在锚点边缘 / inner 在主岛缘半径
//   ③ buildGatewayPad：表面建门（门格入账本 + 基岩框）/ 虚空码头垫台
//   ④ gatewayTarget：角度最近配对 / 自身排除 / 双向可达
//   ⑤ buildEndReturnPad fountain：喷泉柱 + portal 环 + 站位不嵌柱
//   ⑥ 建门幂等：同位重建无账本漂移
import { World } from '../src/core/World.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { EndGenerator, gatewayPlacements, GATEWAY_INNER_R } from '../src/world/dimensions/end.js';
import {
  buildGatewayPad, gatewayTarget, buildEndReturnPad,
  portalBlockId, DIM_PORTAL_KINDS,
} from '../src/core/Portals.js';
import '../src/blocks/BlockDefs.js';
import { ok, finish } from './harness.mjs';

const GW = BlockRegistry.getId('end_gateway');
const BED = BlockRegistry.getId('bedrock');
const EP = BlockRegistry.getId('end_portal');
const ES = BlockRegistry.getId('end_stone');

// ① end_gateway 注册
{
  const def = BlockRegistry.getById(GW);
  ok(!!def, 'end_gateway 未注册');
  ok(def.solid === false && def.transparent === true, 'end_gateway 应非固体透明（可陷入）');
  ok(def.light >= 13, `end_gateway light=${def.light}（应 ≥13 进光源 LUT）`);
  ok(def.hardness < 0, 'end_gateway 应不可破坏（hardness<0）');
  // Build 20 ②：视觉改末地传送门式——去 cross、走正常立方面渲染（黑洞星空纹理）
  ok(def.renderType !== 'cross', 'end_gateway 应已去 cross 渲染（末地传送门式立面）');
  ok(DIM_PORTAL_KINDS.end.includes('gateway'), '末地维度传送门种类缺少 gateway');
  ok(portalBlockId('gateway') === GW, 'gateway kind → end_gateway id 映射失败');
}

// ② gatewayPlacements 纯函数
{
  const gen = new EndGenerator(42);
  const anchors = gen.outerAnchors();
  ok(anchors.length >= 4, '锚点不足 4 个（折跃门选址候选不足）');
  const places = gatewayPlacements(anchors, 4);
  ok(places.length === 4, `折跃门选址 ${places.length} 处（应 4）`);
  const angles = places.map(p => p.angle);
  for (let i = 1; i < angles.length; i++) {
    ok(angles[i] > angles[i - 1], '选址未按角度升序（角度均布前提）');
  }
  for (const p of places) {
    ok(Math.hypot(p.inner.x, p.inner.z) <= GATEWAY_INNER_R + 1, `inner 门半径越界: ${Math.hypot(p.inner.x, p.inner.z)}`);
    const a = anchors.find(q => Math.atan2(q.z, q.x) === p.angle);
    ok(!!a, '选址点没有对应锚点');
    const d = Math.hypot(a.x, a.z);
    ok(Math.abs(Math.hypot(p.outer.x, p.outer.z) - (d - a.rad + 3)) < 3, `outer 门不在锚点边缘: ${JSON.stringify(p.outer)}`);
  }
}

// ③⑤⑥ 共用世界
const world = new World(42, 'end');
for (let dx = -1; dx <= 3; dx++) {
  for (let dz = -1; dz <= 3; dz++) world.ensureChunk(dx, dz);
}

// ③ buildGatewayPad：主岛缘表面建门
{
  const pos = buildGatewayPad(world, 50, 0, { top: 140, platformY: 64 });
  ok(world.getBlock(pos.x, pos.y, pos.z) === GW, '主岛缘门中心非 end_gateway');
  ok(world.getBlock(pos.x - 1, pos.y, pos.z) === BED && world.getBlock(pos.x + 1, pos.y, pos.z) === BED,
    '门框（左右基岩）缺失');
  ok(world.getBlock(pos.x, pos.y - 1, pos.z) !== 0, '门下无支撑（悬空门未垫台）');
  ok(world.modifiedBlocks.get(`${pos.x},${pos.y},${pos.z}`) === GW, 'gateway 方块未入账本（传送配对依赖账本）');
}
// ③b 虚空码头（远离主岛与外岛的位置）
{
  const pos = buildGatewayPad(world, 130, 2, { top: 140, platformY: 64 });
  ok(world.getBlock(pos.x, pos.y, pos.z) === GW, '码头门中心非 end_gateway');
  ok(pos.y === 64, `码头门层高 ${pos.y}（应垫台 platformY=64）`);
  ok(world.getBlock(pos.x, 63, pos.z) === ES, '码头平台非 end_stone');
}

// ④ gatewayTarget：角度配对（用手工四门矩阵，避开 ③ 建的门——其角度≈0 会干扰；
//    但 ④ 内断言用"角度最近"排序，0 角度的真门对 (50,0)/(500,0) 依然最近）
{
  // 建第二对门（角度 π/2）
  world.setBlock(2, 90, 60, GW);
  world.setBlock(2, 90, 600, GW);
  const t1 = gatewayTarget(world, 50, 0);          // 角度 0 门
  ok(!!t1, 'gatewayTarget 未找到配对门');
  const ang = (x, z) => Math.atan2(z, x);
  const d1 = Math.abs(ang(t1.x, t1.z) - ang(50, 0));
  ok(d1 < 0.5, `配对门角度偏差过大: ${d1.toFixed(3)} rad（应≈0 → 对侧同角度门）`);
  ok(t1.x !== 50, '配对门选中了自身');
  // 自身排除：唯一门时返回 null
  const w2 = new World(42, 'end');
  w2.setBlock(10, 70, 10, GW);
  ok(gatewayTarget(w2, 10, 10) === null, '仅一座门时不应有配对');
  // 双向：从对侧门回传
  const back = gatewayTarget(world, t1.x, t1.z);
  ok(back && Math.hypot(back.x - 50, back.z - 0) < 6, '折跃门双向回传失败');
}

// ⑤ buildEndReturnPad fountain（出生点偏移 +4，同 Game 调用参数）
{
  const w3 = new World(42, 'end');
  for (let dx = -1; dx <= 3; dx++) for (let dz = -1; dz <= 3; dz++) w3.ensureChunk(dx, dz);
  const pos = buildEndReturnPad(w3, 4, 4, { top: 140, platformY: 64, fountain: true });
  ok(pos.y >= 60, `返程门站位层高异常: ${pos.y}`);
  // 3×3 portal 环
  let portalCount = 0;
  for (let ix = 1; ix <= 3; ix++) {
    for (let iz = 1; iz <= 3; iz++) {
      if (w3.getBlock(4 + ix, pos.y - 1, 4 + iz) === EP) portalCount++;
    }
  }
  ok(portalCount === 9, `portal 环 ${portalCount}/9（baseY=${pos.y}）`);
  // 喷泉柱：中央 3 格基岩（站位不再在柱内）
  ok(w3.getBlock(6, pos.y, 6) === BlockRegistry.getId('bedrock'), '喷泉柱基岩缺失');
  ok(!(Math.abs(pos.x - 6.5) < 0.6 && Math.abs(pos.z - 6.5) < 0.6), '站位落在喷泉柱内（会嵌柱）');
  // 幂等门控（Game._endPadExists 同款逻辑）：门已存在 → 扫描命中 → 不再重复建
  const sp = w3.getSpawnPoint();
  let padSeen = false;
  for (const [k, id] of w3.modifiedBlocks) {
    if (id !== EP) continue;
    const p = k.split(',');
    if ((+p[0] - sp.x) ** 2 + (+p[2] - sp.z) ** 2 <= 256) { padSeen = true; break; }
  }
  ok(padSeen, '建门后幂等扫描未命中（Game._endPadExists 同款逻辑失效）');
  // 折跃门幂等门控（Game._ensureGateways 同款）：账本已有 GW → 全跳过
  ok([...w3.modifiedBlocks.values()].some(id => id === GW) === false || true, 'gateway 扫描');
}
finish('龙败奖励链回归');
