// Harvester.js -- B53 R2 收割机的纯算法（节拍由调用方注入：单机本地 tick / 联机主机权威）
// 语义（与计划 §8.4 一致）：
//   · 只收「正前方那一格」的成熟作物——未熟、草丛、水、任何别的方块一律不动；
//   · 产物写进「背面相邻容器」（箱子/漏斗/潜影盒），与手割产物同源（crops.js 的一张表）；
//   · 前方区块没加载 / 背面没有容器 / 容器放不下 → 整台机器这一拍什么都不做（作物留在田里）；
//   · 先做「放得下」的干跑再动真容器，随后才破坏作物——任何一步失败都不会吞掉产物。
// 不消耗潮压、不提供界面：它是被动的自动化方块（与漏斗同类），不是加工机。
import { flowTarget, HOPPER_MAX_STACK } from './HopperFlow.js';
import { isMatureCropId, cropHarvestDrops } from './crops.js';
import { BlockRegistry } from './BlockRegistry.js';

// 单台机器的收割节拍（每拍最多收一格）：作物长得比这慢得多，慢一拍＝联机少一堆方块消息
export const HARVEST_INTERVAL_MS = 800;

// 前方（收割方向）= facing 指向的那一格；背面（出料）= 反方向那一格。
export function harvesterTarget(x, y, z, facing) {
  return flowTarget(x, y, z, facing);
}

export function harvesterOutput(x, y, z, facing) {
  const f = flowTarget(x, y, z, facing);
  return { x: 2 * x - f.x, y: 2 * y - f.y, z: 2 * z - f.z };
}

const cloneSlots = (items) => items.map((s) => (s ? { name: s.name, count: s.count, data: s.data ?? null } : null));

// 把一批物品塞进 27 槽容器：同类未满优先、其次空槽；返回**没塞进去的残余**（空数组 = 全放下）。
// 干跑与落地共用这一个实现——先喂副本，全放下才动真容器，判定与写入不会出现两套口径。
// 服务器侧也用它：溢出部分据此变成掉落物，宁可掉在地上也不吞掉玩家收成。
export function insertAllIntoSlots(items, drops) {
  const leftover = [];
  for (const d of drops) {
    let need = Math.max(0, Number(d && d.count) || 0);
    if (need <= 0) continue;
    const data = d.data ?? null;
    for (let i = 0; i < items.length && need > 0; i++) {
      const s = items[i];
      if (!s || s.name !== d.name || s.data != null || data != null) continue;
      if (s.count >= HOPPER_MAX_STACK) continue;
      const n = Math.min(need, HOPPER_MAX_STACK - s.count);
      s.count += n;
      need -= n;
    }
    for (let i = 0; i < items.length && need > 0; i++) {
      if (items[i]) continue;
      const n = Math.min(need, HOPPER_MAX_STACK);
      items[i] = { name: d.name, count: n, data };
      need -= n;
    }
    if (need > 0) leftover.push({ name: d.name, count: need, data });
  }
  return leftover;
}

// 整批放得下才写：干跑用副本，成功后再落真容器（原子性）
function insertAllOrNothing(items, drops) {
  if (insertAllIntoSlots(cloneSlots(items), drops).length) return false;
  insertAllIntoSlots(items, drops);
  return true;
}

// 推进一批收割机（list = [{x,y,z,facing}]，顺序由调用方固定以保确定性）。
// io.getBlock(x,y,z)         -> 方块 id（0 = 空气/未加载）
// io.isLoaded(x,z)           -> 该列区块是否已加载（可选；缺省视为已加载）
// io.ensureContainer(x,y,z)  -> 27 槽数组或 null（不是容器方块时返回 null）
// io.harvest(x,y,z,id)       -> 破坏那一格作物（调用方走 World.setBlock / 服务器账本）
// io.onDeposit(x,y,z,drops)  -> 本次入库回调（可选；联机据此把产物同步给服务器）
// io.rng()                   -> 随机源（可选；默认 Math.random，测试注入固定序列）
// 返回本拍真正收割掉的坐标数组。
export function tickHarvesters(list, io) {
  const done = [];
  if (!Array.isArray(list) || !list.length || !io) return done;
  if (typeof io.getBlock !== 'function' || typeof io.ensureContainer !== 'function' || typeof io.harvest !== 'function') return done;
  const rng = typeof io.rng === 'function' ? io.rng : Math.random;
  const isLoaded = typeof io.isLoaded === 'function' ? io.isLoaded : () => true;
  for (const h of list) {
    if (!h || !Number.isFinite(h.x) || !Number.isFinite(h.y) || !Number.isFinite(h.z)) continue;
    const f = harvesterTarget(h.x, h.y, h.z, h.facing);
    if (!isLoaded(f.x, f.z)) continue;                 // 前方没加载：安全停止（不读成空气也不算收成）
    const frontId = io.getBlock(f.x, f.y, f.z) | 0;
    if (!isMatureCropId(frontId)) continue;            // 只认成熟作物：未熟/草/水/石头全部不动
    const def = BlockRegistry.getById(frontId);
    if (!def) continue;
    const drops = cropHarvestDrops(def.name, rng);
    if (!drops.length) continue;
    const b = harvesterOutput(h.x, h.y, h.z, h.facing);
    const items = io.ensureContainer(b.x, b.y, b.z);
    if (!items) continue;                              // 背面没容器：安全停止
    if (!insertAllOrNothing(items, drops)) continue;   // 放不下：不收割，作物留在田里
    io.harvest(f.x, f.y, f.z, frontId);
    if (io.onDeposit) io.onDeposit(b.x, b.y, b.z, drops);
    done.push({ x: f.x, y: f.y, z: f.z });
  }
  return done;
}
