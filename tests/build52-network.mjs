// build52-network.mjs -- Build 52 R3 潮工生产网络不变量回归（纯 node，不依赖服务器）
// 断言：
//   ① 离合闸红石观察：pendingClutchSignals 只在本地观测与已知状态不一致时产出条目
//   ② 断开语义：断开期间进度保温（不跳变、不丢料、不产出），重新接通后继续
//   ③ 同一锅炉继续燃烧（断网不熄火），下游拿不到潮压
//   ④ 两条产线并行：供需比例降速，两条线都在推进
//   ⑤ 拆轴只影响正确子网：另一条产线继续生产
//   ⑥ 源码绊线：红石轮询在联机早退之前、联机只上报、单机写状态并重建拓扑
import { readFileSync } from 'fs';
import {
  buildNetworks, tickIndustry, pendingClutchSignals, setClutchPowered, clutchEngaged,
  emptyBoilerState, emptyCrusherState, emptyCutterState, emptyClutchState,
} from '../src/core/Industry.js';
import { BOILER_SUPPLY, CRUSHER_DEMAND, CUTTER_DEMAND } from '../src/content/industry/defs.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const idx = (entries) => new Map(entries);
const key = (x, y, z) => `${x},${y},${z}`;
const burner = () => ({
  ...emptyBoilerState(),
  fuel: { name: 'coal', count: 8, data: null },
  water: { name: 'water_bucket', count: 8, data: null },
});

// ── ① 红石观察（纯函数）────────────────────────────────────────────────
{
  const blocks = idx([
    [key(0, 0, 0), 'clutch'],
    [key(1, 0, 0), 'shaft'],
    [key(2, 0, 0), 'clutch'],
  ]);
  // 没有状态：已知视为未通电 → 通电才上报
  const p1 = pendingClutchSignals(blocks, new Map(), (x) => x === 0);
  ok(p1.length === 1 && p1[0].key === key(0, 0, 0) && p1[0].powered === true,
    '缺状态时，通电的离合闸上报一次');
  ok(p1[0].x === 0 && p1[0].y === 0 && p1[0].z === 0, '上报条目带整数坐标');
  // 状态一致：不再上报（不刷包）
  const states = new Map([[key(0, 0, 0), { kind: 'clutch', manual: true, powered: true }]]);
  ok(pendingClutchSignals(blocks, states, (x) => x === 0).length === 0, '已知状态与观测一致时不产出');
  // 断电：已知通电 → 上报 false
  const p2 = pendingClutchSignals(blocks, states, () => false);
  ok(p2.length === 1 && p2[0].powered === false, '断电也上报（恢复手动状态）');
  // 两个离合闸一开一关
  const two = pendingClutchSignals(blocks, new Map(), (x) => x === 2);
  ok(two.length === 1 && two[0].key === key(2, 0, 0), '只上报变化的那个离合闸');
  // 非离合闸方块不参与
  const shaftOnly = pendingClutchSignals(idx([[key(0, 0, 0), 'shaft']]), new Map(), () => true);
  ok(shaftOnly.length === 0, '传动轴不参与红石信号（红石只控制通断）');
  // 坏键安全
  const badKey = pendingClutchSignals(idx([['bad-key', 'clutch']]), new Map(), () => true);
  ok(badKey.length === 0, '非法坐标键被跳过');
  ok(pendingClutchSignals(null, new Map(), () => true).length === 0, '空方块表安全');
  // 写入后导流状态真的变了
  const st = emptyClutchState();
  ok(setClutchPowered(st, true) === true && clutchEngaged(st) === false, '通电即断开（红石优先）');
  ok(setClutchPowered(st, false) === true && clutchEngaged(st) === true, '断电恢复手动状态');
}

// ── ② 断开期间进度保温 / 重连继续 ──────────────────────────────────────
{
  const blocks = idx([
    [key(0, 0, 0), 'boiler'],
    [key(1, 0, 0), 'shaft'],
    [key(2, 0, 0), 'clutch'],
    [key(3, 0, 0), 'crusher'],
  ]);
  const states = new Map([
    [key(0, 0, 0), burner()],
    [key(2, 0, 0), { kind: 'clutch', manual: true, powered: false }],
    [key(3, 0, 0), { ...emptyCrusherState(), input: { name: 'cobblestone', count: 4, data: null }, progress: 1.5 }],
  ]);
  const crusher = states.get(key(3, 0, 0));
  // 先跑一段：满效率推进
  tickIndustry(blocks, states, 0.5);
  ok(crusher.progress > 1.5, '接通时正常推进');
  const before = crusher.progress;
  // 断开：进度保温，不推进也不回退、不消耗原料、不产出
  setClutchPowered(states.get(key(2, 0, 0)), true);
  const netsOff = buildNetworks(blocks, states);
  tickIndustry(blocks, states, 0.5, netsOff);
  ok(crusher.progress === before, '断开期间进度不动（不跳变）');
  ok(crusher.input.count === 4 && crusher.output === null, '断开期间不消耗原料、不产出');
  ok(states.get(key(0, 0, 0)).burnTime > 0, '上游锅炉照常燃烧（断网不熄火）');
  // 重新接通：继续推进
  setClutchPowered(states.get(key(2, 0, 0)), false);
  const netsOn = buildNetworks(blocks, states);
  tickIndustry(blocks, states, 0.5, netsOn);
  ok(crusher.progress > before, '重新接通后继续推进');
  // 一直跑到出产物，确认没有重复结算
  for (let i = 0; i < 20; i++) tickIndustry(blocks, states, 1);
  ok(crusher.output && crusher.output.count >= 1, '接通后正常产出');
  ok(crusher.output.count <= 4, `产出量不超过投入（${crusher.output.count}）`);
}

// ── ③ 两条产线并行（供需比例）──────────────────────────────────────────
{
  const blocks = idx([
    [key(0, 0, 0), 'boiler'],
    [key(1, 0, 0), 'shaft'],
    [key(2, 0, 0), 'shaft'],
    [key(2, 1, 0), 'shaft'],
    [key(3, 1, 0), 'crusher'],
    [key(2, 0, 1), 'shaft'],
    [key(3, 0, 1), 'cutter'],
  ]);
  const states = new Map([
    [key(0, 0, 0), burner()],
    [key(3, 1, 0), { ...emptyCrusherState(), input: { name: 'cobblestone', count: 8, data: null } }],
    [key(3, 0, 1), { ...emptyCutterState(), input: { name: 'oak_log', count: 8, data: null } }],
  ]);
  const r = tickIndustry(blocks, states, 0.2);
  const comp = r.networks.comps[0];
  ok(comp.demand === CUTTER_DEMAND + CRUSHER_DEMAND, `两条产线合计需求 ${comp.demand}`);
  ok(Math.abs(comp.efficiency - BOILER_SUPPLY / comp.demand) < 1e-9,
    `供给不足按比例降速（${comp.efficiency.toFixed(3)}）`);
  const crusher = states.get(key(3, 1, 0));
  const cutter = states.get(key(3, 0, 1));
  ok(crusher.progress > 0 && cutter.progress > 0, '两条产线同时推进');
  ok(Math.abs(crusher.progress - cutter.progress) < 1e-9, '同一网络内机器共享同一效率');
}

// ── ④ 拆轴只影响正确子网 ───────────────────────────────────────────────
{
  // 两条支线从同一个锅炉分叉
  const blocks = idx([
    [key(0, 0, 0), 'boiler'],
    [key(1, 0, 0), 'shaft'],
    [key(2, 0, 0), 'shaft'],
    [key(2, 1, 0), 'shaft'],
    [key(3, 1, 0), 'crusher'],
    [key(2, 0, 1), 'shaft'],
    [key(3, 0, 1), 'cutter'],
  ]);
  const states = new Map([
    [key(0, 0, 0), burner()],
    [key(3, 1, 0), { ...emptyCrusherState(), input: { name: 'cobblestone', count: 8, data: null } }],
    [key(3, 0, 1), { ...emptyCutterState(), input: { name: 'oak_log', count: 8, data: null } }],
  ]);
  for (let i = 0; i < 5; i++) tickIndustry(blocks, states, 0.2);
  const crusher = states.get(key(3, 1, 0));
  const cutter = states.get(key(3, 0, 1));
  const cBefore = crusher.progress;
  const tBefore = cutter.progress;
  // 拆掉喂碎石机的那一节轴（2,1,0）
  blocks.delete(key(2, 1, 0));
  const nets = buildNetworks(blocks, states);
  ok(nets.comps.length === 2, '拆轴后分成两个子网');
  tickIndustry(blocks, states, 0.5, nets);
  ok(crusher.progress === cBefore, '被拆断的碎石机停转（进度保温）');
  ok(cutter.progress > tBefore, '另一条产线不受影响（继续推进）');
  ok(states.get(key(0, 0, 0)).burnTime > 0, '锅炉仍在燃烧');
  // 把轴装回去：两条线恢复
  blocks.set(key(2, 1, 0), 'shaft');
  const nets2 = buildNetworks(blocks, states);
  ok(nets2.comps.length === 1, '装回轴后网络重新合并');
  tickIndustry(blocks, states, 0.5, nets2);
  ok(crusher.progress > cBefore, '重新合并后碎石机恢复推进');
}

// ── ⑤ 源码绊线 ─────────────────────────────────────────────────────────
{
  const sys = src('../src/player/IndustrySystem.js');
  const ind = src('../src/core/Industry.js');
  const room = src('../server/room.js');
  ok(/this\._pollClutchSignals\(dt\);[\s\S]{0,120}if \(g\.networkMode\) return;/.test(sys),
    '红石轮询在联机早退之前（两种模式都做）');
  ok(/pendingClutchSignals\(world\.industryBlocks, world\.industry, powerAt\)/.test(sys),
    '红石判定走纯函数（单机/联机同一份）');
  ok(/sendIndustryAction\(p\.x, p\.y, p\.z, 'signal', null, 0, null, -1, p\.powered\)/.test(sys),
    '联机只上报信号，不本地改权威');
  ok(/setClutchPowered\(st, p\.powered\)/.test(sys) && /if \(dirty\) this\.markDirty\(\)/.test(sys),
    '单机写状态并重建拓扑');
  ok(/_signalSent[\s\S]{0,200}1500/.test(sys), '上报有防重复节流（等回执）');
  ok(/export function pendingClutchSignals/.test(ind), '纯函数导出（可测）');
  ok(/if \(kind === 'clutch'\)[\s\S]{0,600}setClutchPowered\(st, msg\.on === true \|\| msg\.on === 1\)/.test(room),
    '服务器处理信号（只认 true/1）');
}

finish('build52-network');