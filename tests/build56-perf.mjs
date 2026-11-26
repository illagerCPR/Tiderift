// build56-perf.mjs -- Build 56 R4 性能与资源收尾（纯 node，不依赖服务器）
// 口径（计划 §9.3）：硬件无关指标 + 同环境对照，不把 WSL 软渲染 FPS 当真机结论。
//   ① 双关（全关）零常驻成本：工业域与魔法域的每帧调用在关闭世界里的开销可忽略、
//      不分配、不建定时器；过载账本恒空
//   ② 工业满预算：512 方块 / 单网 128 节点下的 tick 与拓扑重建耗时预算，过载只加线性扫描
//   ③ 魔法上限：弹体池封顶（丢最旧）、粒子池满丢弃（读源码常量）、dispose 清账
//   ④ UI / 资源释放：两个域 dispose 后不留状态；Game._disposeWorld 调它们
import { readFileSync } from 'fs';
import { performance } from 'node:perf_hooks';
import { World } from '../src/core/World.js';
import { IndustrySystem } from '../src/player/IndustrySystem.js';
import { MagicSystem, MAX_MAGIC_BOLTS } from '../src/player/MagicSystem.js';
import {
  tickIndustry, buildNetworks, emptyBoilerState, emptyCrusherState, addOverload, attachOverloads,
} from '../src/core/Industry.js';
import { NETWORK_MAX_NODES, INDUSTRY_BLOCK_LIMIT, INDUSTRY_TICK_MS } from '../src/content/industry/defs.js';
import { normalizeExtraContent } from '../src/content/ExtraContent.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const NONE = normalizeExtraContent(null);
const BOTH = normalizeExtraContent({ schema: 1, industry: true, magic: true });

// 计时：跑 3 轮取中位数，规避 GC/调度抖动
function bench(fn, rounds = 3) {
  const times = [];
  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

// ── ① 双关世界的常驻开销 ────────────────────────────────────────────────
{
  const world = new World(1234, 'overworld', { extraContent: null });
  ok(world.industryBlocks.size === 0 && world.industry.size === 0, '全关世界：没有任何工业账本条目');
  ok(world.overloads instanceof Map && world.overloads.size === 0, '全关世界：过载账本为空');

  const fakeGame = {
    world, networkMode: false, hud: null, redstone: null,
    player: { slowFall: 0, echo: 0, echoMax: 100, position: { x: 0, y: 64, z: 0 } },
    inventory: null, particles: null, renderer: null,
  };
  const industry = new IndustrySystem(fakeGame);
  const magic = new MagicSystem(fakeGame);

  // 600 帧（10 秒 @60fps）
  const indMs = bench(() => { for (let i = 0; i < 600; i++) industry.update(1 / 60); });
  const magMs = bench(() => { for (let i = 0; i < 600; i++) magic.update(1 / 60); });
  ok(indMs < 20, `全关世界：工业域 600 帧共 ${indMs.toFixed(2)}ms（每帧 < 0.04ms）`);
  ok(magMs < 20, `全关世界：魔法域 600 帧共 ${magMs.toFixed(2)}ms（每帧 < 0.04ms）`);
  ok(world.industryBlocks.size === 0 && world.industry.size === 0 && world.overloads.size === 0,
    '全关世界：跑 1200 帧后依然零条目（不偷偷建状态）');
  ok(industry._networks === null, '全关世界：连拓扑缓存都不建立');
  ok(magic._bolts.length === 0, '全关世界：没有弹体');
  // 不建定时器 / 不挂监听：两个域只用 update 驱动
  for (const [name, file] of [['工业域', '../src/player/IndustrySystem.js'], ['魔法域', '../src/player/MagicSystem.js']]) {
    const code = src(file);
    ok(!/setInterval|requestAnimationFrame/.test(code), `${name}：不自己起定时器/动画帧`);
    ok(!/addEventListener/.test(code), `${name}：不挂全局事件监听`);
  }
  ok(!/setInterval/.test(src('../src/core/Industry.js')), '工业纯算法：无定时器（只由调用方推进）');
  industry.dispose(); magic.dispose();
}

// ── ② 工业满预算：512 方块 / 128 节点 ────────────────────────────────────
{
  // 四条满载网络：每条 1 锅炉 + 120 轴 + 7 碎石机 = 128 节点，四条共 512 方块
  const blocks = new Map();
  const states = new Map();
  const netsPer = NETWORK_MAX_NODES; // 128
  const perNet = { boiler: 1, shaft: 120, crusher: 7 };
  let baseX = 0;
  for (let n = 0; n < 4; n++) {
    let i = 0;
    const bx = baseX + n * 400;
    blocks.set(`${bx},64,0`, 'boiler');
    const b = emptyBoilerState();
    b.fuel = { name: 'coal', count: 64, data: null };
    b.water = { name: 'water_bucket', count: 64, data: null };
    states.set(`${bx},64,0`, b);
    i = 1;
    for (let s = 0; s < perNet.shaft; s++, i++) blocks.set(`${bx + i},64,0`, 'shaft');
    for (let c = 0; c < perNet.crusher; c++, i++) {
      const key = `${bx + i},64,0`;
      blocks.set(key, 'crusher');
      const st = emptyCrusherState();
      st.input = { name: 'cobblestone', count: 64, data: null };
      states.set(key, st);
    }
  }
  ok(blocks.size === INDUSTRY_BLOCK_LIMIT, `满预算方块数 = ${INDUSTRY_BLOCK_LIMIT}（${blocks.size}）`);

  const tBuild = bench(() => buildNetworks(blocks, states), 3);
  const nets = buildNetworks(blocks, states);
  ok(nets.comps.length === 4, `四条网络（${nets.comps.length}）`);
  ok(nets.comps.every((c) => c.nodes.length === netsPer), '每条网络恰好 128 节点');
  ok(tBuild < 60, `拓扑重建 512 方块：${tBuild.toFixed(2)}ms（< 60ms；只在方块变化后发生）`);

  // 满预算 tick：每条网络 1 锅炉供 4 压、7 台碎石机要 14 压 → 效率 4/14
  const tTick = bench(() => {
    for (let i = 0; i < 50; i++) tickIndustry(blocks, states, INDUSTRY_TICK_MS / 1000, nets, BOTH, null);
  }, 3);
  const perTick = tTick / 50;
  ok(perTick < 8, `满预算 tick：每拍 ${perTick.toFixed(3)}ms（< 8ms，节拍 200ms）`);

  // 过载只加一次线性扫描（不改复杂度）：同环境对照
  const ledger = new Map();
  for (let n = 0; n < 4; n++) addOverload(ledger, `${baseX + n * 400 + 1},64,0`, { duration: 20, rate: 1.5 });
  const tOver = bench(() => {
    for (let i = 0; i < 50; i++) tickIndustry(blocks, states, INDUSTRY_TICK_MS / 1000, nets, BOTH, ledger);
  }, 3);
  const perTickOver = tOver / 50;
  ok(perTickOver < perTick * 2.5 + 1,
    `过载下的 tick：每拍 ${perTickOver.toFixed(3)}ms（不高于基线的 2.5 倍 + 1ms）`);
  // 账本条目在 20 秒内仍然有界
  ok(ledger.size <= 4, `过载条目有界（${ledger.size}）`);
  const tAttach = bench(() => attachOverloads(nets, ledger), 3);
  ok(tAttach < 5, `把账本贴到四条网络：${tAttach.toFixed(3)}ms（< 5ms，只在界面读时发生）`);

  // 跑满 60 秒（300 拍）后仍守恒：没有负数、没有凭空多出的产物
  for (let i = 0; i < 300; i++) tickIndustry(blocks, states, INDUSTRY_TICK_MS / 1000, nets, BOTH, null);
  let bad = 0;
  let produced = 0;
  for (const [, st] of states) {
    for (const slot of [st.input, st.fuel, st.water, st.output, st.bonus, st.shard]) {
      if (slot && (!(slot.count > 0) || slot.count > 64)) bad++;
    }
    if (st.output && st.output.name === 'gravel') produced += st.output.count;
  }
  ok(bad === 0, '满预算跑 60 秒：所有槽位计数都在 1..64');
  ok(produced > 0, `满预算跑 60 秒确实产出（砾石 ${produced}）`);
}

// ── ③ 魔法上限：弹体池封顶 + 粒子池满丢弃 ───────────────────────────────
{
  const magic = new MagicSystem({ renderer: null });
  for (let i = 0; i < 100; i++) magic._pushBolt({ id: i, life: 1, dead: false, local: true });
  ok(magic._bolts.length === MAX_MAGIC_BOLTS, `弹体池封顶 ${MAX_MAGIC_BOLTS}（${magic._bolts.length}）`);
  ok(magic._bolts[magic._bolts.length - 1].id === 99, '保留的是最新一条');
  ok(magic._bolts[0].id === 100 - MAX_MAGIC_BOLTS, '淘汰的是最旧的一条');
  magic.dispose();
  ok(magic._bolts.length === 0 && magic._lastCast.size === 0 && magic.isCharging === false,
    'dispose 清空弹体/冷却/蓄力');

  const ps = src('../src/render/ParticleSystem.js');
  ok(/maxParticles = 1600/.test(ps), '粒子池有硬上限（默认 1600）');
  ok(/this\.count >= this\.max\) return/.test(ps), '粒子池满即丢弃（视觉可接受，不无限增长）');
  ok(/MAX_MAGIC_BOLTS/.test(src('../src/player/MagicSystem.js')), '弹体上限来自同一常量');
}

// ── ④ UI / 资源释放 ─────────────────────────────────────────────────────
{
  const world = new World(7, 'overworld', { extraContent: BOTH });
  const fakeGame = { world, networkMode: false, hud: null, redstone: null, player: { slowFall: 0, echo: 0, echoMax: 100 } };
  const industry = new IndustrySystem(fakeGame);
  industry._net = new Map([['1,2,3', { nodes: 3 }]]);
  industry._signalSent = new Map([['1,2,3', { powered: true, at: 1 }]]);
  industry._networks = { compOf: new Map(), comps: [] };
  industry.markDirty();
  industry.dispose();
  ok(industry._net.size === 0 && industry._signalSent.size === 0 && industry._networks === null,
    '工业域 dispose：拓扑/摘要/信号缓存全部清空');
  ok(industry._acc === 0 && industry._signalAcc === 0 && industry._dirty === true,
    '工业域 dispose：节拍状态复位（下次 start 从干净状态开始）');

  const game = src('../src/player/Game.js');
  ok(/if \(this\.industry\) \{ this\.industry\.dispose\(\); this\.industry = null; \}/.test(game),
    'Game._disposeWorld 释放工业域');
  ok(/if \(this\.magic\) \{ this\.magic\.dispose\(\); this\.magic = null; \}/.test(game),
    'Game._disposeWorld 释放魔法域');
  // 界面：渲染重建即清槽位引用，hide 复位坐标/种类（不留跨世界状态）
  const ms = src('../src/ui/MachineScreen.js');
  ok(/this\._slotEls\.clear\(\)/.test(ms), '机器界面每次 render 先清槽位引用');
  ok(/hide\(\)[\s\S]{0,600}this\.pos = null;[\s\S]{0,200}this\.kind = null;/.test(ms),
    '机器界面 hide 复位坐标与种类');
  // 新建型子系统：start 创建、_disposeWorld 释放（清单见 AGENTS.md 口径）
  ok(/this\.industry = new IndustrySystem\(this\)/.test(src('../src/player/Game.js')), '工业域随 start 新建');
  ok(/this\.magic = new MagicSystem\(this\)/.test(src('../src/player/Game.js')), '魔法域随 start 新建');
}

// ── ⑤ 双开 vs 全关：世界清单不改变注册表规模 ────────────────────────────
{
  const a = new World(11, 'overworld', { extraContent: null });
  const b = new World(11, 'overworld', { extraContent: BOTH });
  ok(a.generator.extraContent !== b.generator.extraContent, '两个世界的清单互不相同');
  ok(a.industryBlocks.size === b.industryBlocks.size, '全关与双开初始账本同样为空（开关不预建条目）');
}

finish('build56-perf');
