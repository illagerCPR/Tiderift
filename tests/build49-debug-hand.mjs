// build49-debug-hand.mjs -- Build 49 回归：① F3 调试信息屏（纯逻辑 + 接线绊线）；② 手持物品隐藏手臂
// 断言分五组：
//   ① 纯推导：朝向 / 区块列与区块内坐标 / 方块坐标 / 游戏内时钟 / 大数字紧凑化 / 定点小数
//   ② FpsMeter：稳定 30fps 收敛、后台节流（>1s 间隔）丢弃、reset 复位
//   ③ buildDebugLines：行内容与可选行（无准星/无内存/无联机/无状态效果）、NaN 安全降级、soul 标记
//   ④ FirstPersonHand：真类 + 假 game —— 手持物品藏手臂、空手恢复、换存档复位（含在途构建作废）
//   ⑤ 绊线：调试屏无背景框/不吃鼠标/渲染统计帧首清零/Game 的 F3 接线与刷新时序
import * as THREE from 'three';
import { readFileSync } from 'fs';
import {
  facingFromYaw, facingLabel, chunkOf, localOf, blockOf,
  formatClock, formatK, fixed, FpsMeter, buildDebugLines,
} from '../src/core/DebugInfo.js';
import { FirstPersonHand } from '../src/render/FirstPersonHand.js';
import { VERSION_LABEL } from '../src/version.js';
import { ok, finish } from './harness.mjs';

const srcOf = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── ① 纯推导 ───────────────────────────────────────────────────────────
{
  // yaw 语义：yaw=0 朝 -Z（北）；yaw 增大向 -X（西）转
  ok(facingFromYaw(0) === 'n', 'yaw=0 → north');
  ok(facingFromYaw(Math.PI) === 's', 'yaw=π → south');
  ok(facingFromYaw(Math.PI / 2) === 'w', 'yaw=π/2 → west（yaw 增大向西）');
  ok(facingFromYaw(-Math.PI / 2) === 'e', 'yaw=-π/2 → east');
  ok(facingFromYaw(3 * Math.PI / 2) === 'e', 'yaw=3π/2 与 -π/2 等价（同一朝向）');
  ok(facingFromYaw(2 * Math.PI) === 'n', 'yaw=2π 回绕到 north');
  ok(facingFromYaw(-2 * Math.PI) === 'n', 'yaw=-2π 回绕到 north');
  ok(facingFromYaw(Math.PI / 4) === 'n', '45° 对角线归 z 轴（北）——口径钉死');
  ok(facingFromYaw(-3 * Math.PI / 4) === 's', '-135° 对角线归 z 轴（南）');
  ok(facingFromYaw(NaN) === 'n', 'yaw=NaN 安全降级为 north');
  ok(facingLabel(0) === 'north (-Z)' && facingLabel(Math.PI) === 'south (+Z)'
    && facingLabel(Math.PI / 2) === 'west (-X)' && facingLabel(-Math.PI / 2) === 'east (+X)',
    '四个朝向标签带轴向标注（与原版 F3 的方向口径一致）');
}

{
  // 区块列：floor(v/16)；负数同样下取整（与 World.getBlock 的 Math.floor 同口径）
  ok(chunkOf(0) === 0 && chunkOf(15.99) === 0 && chunkOf(16) === 1, '区块列 0..15 → 0，16 → 1');
  ok(chunkOf(-1) === -1 && chunkOf(-16) === -1 && chunkOf(-16.01) === -2, '负坐标区块列按格下取整（-1 → -1，-16.01 → -2）');
  ok(chunkOf(-344.219) === -22, '-344.219 落在区块列 -22');
  ok(near(localOf(128.53) - 0.53, 0, 1e-9), '区块内 x = 128.53 → 0.53');
  ok(near(localOf(-344.219), 7.781, 1e-9), '区块内 z = -344.219 → 7.781（负坐标不错位）');
  ok(near(localOf(-1), 15, 1e-9), '区块内 -1 → 15（不是 -1）');
  ok(blockOf(71) === 71 && blockOf(71.999) === 71 && blockOf(-0.2) === -1, '方块坐标按格下取整（-0.2 → -1）');
}

{
  // 游戏内时钟：sky.time 0=半夜 0.25=日出 0.5=正午 0.75=日落
  ok(formatClock(0) === '00:00', 'time=0 → 00:00');
  ok(formatClock(0.25) === '06:00', 'time=0.25 → 06:00');
  ok(formatClock(0.5) === '12:00', 'time=0.5 → 12:00');
  ok(formatClock(0.75) === '18:00', 'time=0.75 → 18:00');
  ok(formatClock(1) === '00:00', 'time=1 回绕到 00:00');
  ok(formatClock(0.999) === '23:58', 'time=0.999 → 23:58');
  ok(formatClock(-0.25) === '18:00', '负 time 回绕（-0.25 → 18:00）');
  ok(formatClock(NaN) === '00:00', 'time=NaN 安全降级为 00:00');
}

{
  ok(formatK(0) === '0' && formatK(9999) === '9999', '万以下原样整数');
  ok(formatK(10000) === '10.0k' && formatK(128400) === '128.4k', '万以上 k 缩写（一位小数）');
  ok(formatK(1500000) === '1.5M', '百万以上 M 缩写');
  ok(formatK(NaN) === '0', 'NaN 安全降级');
  ok(fixed(1.2345, 2) === '1.23' && fixed(71, 3) === '71.000', '定点小数位数正确');
  ok(fixed(NaN) === '-' && fixed(Infinity) === '-', '非有限值显示 -（不把 NaN/Infinity 糊到屏幕上）');
}

// ── ② FpsMeter ─────────────────────────────────────────────────────────
{
  const m = new FpsMeter();
  m.reset();
  // 2 秒 30fps：EMA 从 60 收敛到 30
  let tNow = 1000;
  for (let i = 0; i < 61; i++) { tNow += 1000 / 30; m.push(tNow); } // 首个样本只建基线 → 60 帧间隔
  ok(near(m.fps, 30, 0.5), `30fps 序列收敛到 30（当前 ${m.fps.toFixed(2)}）`);
  ok(near(m.frameMs, 1000 / 30, 10), `帧间隔 ≈33.3ms（当前 ${m.frameMs.toFixed(2)}）`);
  ok(m.frames === 60, '逐帧计数正确（60 帧）');

  // 后台节流/断点恢复：>1s 的间隔必须丢弃，不能把读数拖垮
  const before = m.fps;
  tNow += 5000;
  m.push(tNow);
  ok(m.fps === before, '>1s 的异常间隔被丢弃（后台节流不影响读数）');
  const beforeFrames = m.frames;
  ok(m.frames === beforeFrames, '异常间隔不计入帧数');

  // 首个样本只建立基线
  const m2 = new FpsMeter();
  m2.push(500);
  ok(m2.frames === 0, '首个时间戳只建基线（不产生帧）');
  m2.push(500 + 1000 / 60);
  ok(near(m2.fps, 60, 0.01), '第二个样本起开始计量（60fps 基线）');

  m2.reset();
  ok(near(m2.frameMs, 1000 / 60, 1e-9) && m2.frames === 0, 'reset 回到 60fps 基线与 0 帧');
}

// ── ③ buildDebugLines ──────────────────────────────────────────────────
const BASE_CTX = {
  versionLabel: VERSION_LABEL,
  fps: 60.4, frameMs: 16.7,
  x: 128.53, y: 71, z: -344.219,
  soul: false,
  yaw: 0, pitch: -0.2,
  vx: 1.5, vy: -0.25, vz: 0,
  flags: ['air', 'sprinting'],
  biome: '平原', dimension: '主世界',
  time: 0.523, skyLight: 15, blockLight: 0,
  target: { displayName: '草方块', name: 'grass_block', x: 128, y: 70, z: -345, id: 2, hardness: 0.6, dist: 1.42 },
  chunksLoaded: 361, chunksDirty: 2, mobs: 12, drops: 3, remote: 0,
  render: { calls: 42, triangles: 128400, geometries: 210, textures: 3, width: 1280, height: 720, pixelRatio: 1 },
  heapUsedMB: 128.4, heapLimitMB: 4096,
  mode: 'creative', health: 20, maxHealth: 20, food: 18, maxFood: 20,
  air: 300, armor: 5, xpLevel: 3, invulnerable: 0,
  effects: ['speed 2 8s'],
  net: null,
};

{
  const L = buildDebugLines(BASE_CTX);
  ok(L.length === 14, `完整快照 = 14 行（当前 ${L.length}）`);
  ok(L[0] === `${VERSION_LABEL} | 60 fps | 16.7 ms`, `首行 = 版本 + 帧率 + 帧耗时（${L[0]}）`);
  ok(L[1] === 'XYZ: 128.530 / 71.000 / -344.219', `XYZ 三位小数（${L[1]}）`);
  ok(L[2] === 'Block: 128 / 71 / -345 | Chunk: 8 / -22 | Local: 0.53 / 7.78', `方块/区块列/区块内坐标（${L[2]}）`);
  ok(L[3] === 'Facing: north (-Z) | yaw 0.0° | pitch -11.5°', `朝向 + yaw/pitch 角度（${L[3]}）`);
  ok(L[4] === 'Speed: 1.50 / -0.25 / 0.00 m/s | air, sprinting', `速度与状态词（${L[4]}）`);
  ok(L[5] === 'Biome: 平原 | Dimension: 主世界', `群系与维度（${L[5]}）`);
  ok(L[6] === 'Time: 12:33 (0.523) | Light: sky 15 / block 0', `时钟与光照（${L[6]}）`);
  ok(L[7] === 'Target: 草方块 [grass_block] @ 128 / 70 / -345 | id 2 | hardness 0.60 | 1.42 m',
    `准星方块整行（${L[7]}）`);
  ok(L[8] === 'Chunks: 361 loaded, 2 dirty | Mobs: 12 | Drops: 3 | Remote: 0', `区块/实体计数（${L[8]}）`);
  ok(L[9] === 'Render: 42 calls | 128.4k tris | 210 geometries | 3 textures | 1280x720@1.00x',
    `渲染统计（${L[9]}）`);
  ok(L[10] === 'Heap: 128.4 / 4096.0 MB', `内存（${L[10]}）`);
  ok(L[11] === 'Player: creative | HP 20/20 | Food 18/20 | Air 300 | Armor 5 | XP 3 | invuln 0.0s',
    `玩家状态（${L[11]}）`);
  ok(L[12] === 'Effects: speed 2 8s', `状态效果行（${L[12]}）`);
  ok(L[13] === 'Net: single-player', `单机末行（${L[13]}）`);
}

{
  // 最小上下文：只给位置也能出面板（F3 在极早期按下 / world 未就绪）
  const L = buildDebugLines({});
  ok(L.length === 10, `最小快照 = 10 行（当前 ${L.length}）`);
  ok(L[1] === 'XYZ: - / - / -', '缺坐标显示 -（不抛异常、不显示 NaN）');
  ok(L[7] === 'Target: none', '无准星目标 → Target: none');
  ok(L[9] === 'Net: single-player', '无联机 → single-player');
  ok(!L.some((l) => l.startsWith('Heap:') || l.startsWith('Render:') || l.startsWith('Player:') || l.startsWith('Effects:')),
    '缺项的可选行整体省略（不输出空壳行）');
}

{
  // 不可破坏方块 + soul 标记 + 联机行 + 抖动向上取整
  const ctx = {
    ...BASE_CTX,
    soul: true,
    target: { displayName: '基岩', name: 'bedrock', x: 0, y: 0, z: 0, id: 33, hardness: -1, dist: 2.5 },
    render: null, heapUsedMB: undefined, effects: [],
    net: { role: 'host', rtt: 32.4, jitter: 3.2, players: 3 },
  };
  const L = buildDebugLines(ctx);
  ok(L[1].endsWith(' [soul]'), '灵魂出窍时 XYZ 行标注 [soul]');
  ok(L.includes('Target: 基岩 [bedrock] @ 0 / 0 / 0 | id 33 | hardness unbreakable | 2.50 m'),
    'hardness<0 显示 unbreakable（不是负数）');
  ok(L[L.length - 1] === 'Net: host | RTT 32 ms ±4 ms | players 3', `联机行（${L[L.length - 1]}）`);
  ok(!L.some((l) => l.startsWith('Heap:') || l.startsWith('Render:') || l.startsWith('Effects:')), '可选行按上下文省略');
}

// ── ④ FirstPersonHand：手持物品隐藏手臂 ────────────────────────────────
{
  const game = {
    renderer: { camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() },
    settings: {}, controls: { mouseLeft: false }, player: null, inventoryScreen: null, world: null, sky: null,
  };
  const hand = new FirstPersonHand(game);
  hand.setVisible(true);

  ok(hand.armMesh.visible === true, '构造时空手 → 手臂可见（肤色/皮肤兜底）');
  ok(hand.currentName === undefined, '构造时 currentName = undefined（未初始化）');

  // 空手：显式 null / undefined 都显示手臂
  hand.currentName = null;
  hand.update(1 / 60, {});
  ok(hand.armMesh.visible === true, '空手（null）→ 手臂可见');
  hand.currentName = undefined;
  hand.update(1 / 60, {});
  ok(hand.armMesh.visible === true, '未初始化（undefined）→ 手臂可见');

  // 手持物品：藏手臂（物品模型自己占位）
  hand.currentName = 'stone';
  hand.update(1 / 60, {});
  ok(hand.armMesh.visible === false, '手持物品 → 手臂隐藏');
  ok(hand.group.visible === true, '手持物挂点整体仍可见（藏的是手臂不是整只手）');
  ok(hand.itemGroup.visible === true, '物品挂点不受影响（物品照常显示/挥动）');

  // 换回空手：恢复
  hand.currentName = null;
  hand.update(1 / 60, {});
  ok(hand.armMesh.visible === true, '换回空手 → 手臂恢复');

  // 二层皮肤（B46 袖子）是 armMesh 的子节点 → 随手臂一起隐藏
  hand.applySkin({ width: 64, height: 64 }, 'classic');
  ok(!!hand.armOverlay && hand.armOverlay.parent === hand.armMesh, '袖子仍是手臂子节点');
  hand.currentName = 'stone';
  hand.update(1 / 60, {});
  ok(hand.armMesh.visible === false && hand.armOverlay.parent === hand.armMesh,
    '藏手臂时袖子一起隐藏（子节点语义，不单独去动 armOverlay.visible）');

  // 换存档复位：currentName 归位、手臂回可见、在途构建作废、物品挂点清空
  const seqBefore = hand._buildSeq;
  hand.itemGroup.add(new THREE.Object3D());
  hand.resetForWorld();
  ok(hand.currentName === undefined, 'resetForWorld：currentName 回到未初始化（下一帧按快捷栏重建）');
  ok(hand.armMesh.visible === true, 'resetForWorld：手臂立即可见（不留上一存档的隐藏态）');
  ok(hand.itemGroup.children.length === 0, 'resetForWorld：物品挂点清空');
  ok(hand._buildSeq === seqBefore + 1, 'resetForWorld：构建序号自增（上一存档在途结果被丢弃）');
}

// ── ⑤ 绊线 ─────────────────────────────────────────────────────────────
{
  const debugSrc = srcOf('../src/ui/DebugScreen.js');
  // 用户口径：不能有背景框 —— 面板样式里不得出现 background/border
  ok(!/\bbackground\b/.test(debugSrc), '调试屏源码不含 background（无背景框）');
  ok(!/\bborder\b/.test(debugSrc), '调试屏源码不含 border（无边框）');
  ok(debugSrc.includes('pointer-events: none'), '调试屏不吃鼠标事件（不挡准星/交互）');
  ok(debugSrc.includes('text-shadow'), '靠文字描边保证可读（不用背景块）');
  ok(debugSrc.includes("display = on ? 'block' : 'none'") || /display\s*=\s*on \?/.test(debugSrc),
    '开关只切 display（幂等）');
  ok(/REFRESH_MS\s*=\s*\d+/.test(debugSrc) && debugSrc.includes('buildDebugLines'), '文本刷新走节流 + 纯逻辑模块');
  ok(debugSrc.includes('onToggle') && debugSrc.includes('this._fps.push(now)'), '帧率按帧推进 + 开关回调');

  const rendererSrc = srcOf('../src/render/Renderer.js');
  ok(rendererSrc.includes('info.autoReset = false'), '渲染统计改为手动清零（多 pass 才能累计）');
  ok(rendererSrc.includes('resetStats()') && rendererSrc.includes('get stats()'), 'Renderer 暴露 resetStats/stats');

  const gameSrc = srcOf('../src/player/Game.js');
  ok(/e\.code === 'F3'/.test(gameSrc) && gameSrc.includes('this.debugScreen.toggle()'), "F3 绑定调试屏开关");
  ok(/if \(this\.running\) e\.preventDefault\(\);/.test(gameSrc), '游戏内吞掉浏览器 F3 默认行为');
  ok(gameSrc.includes('this.renderer.resetStats()'), '帧首清零渲染统计');
  const loopBlock = gameSrc.slice(gameSrc.indexOf('  loop = (token = this._loopToken) => {'),
    gameSrc.indexOf('  // 检测眼睛位置是否在水里'));
  ok(loopBlock.includes('this.renderer.render()') &&
    loopBlock.indexOf('this.renderer.render()') < loopBlock.indexOf('this.debugScreen.update(this, now)'),
    '调试屏在 render 之后刷新（读到的是本帧渲染统计）');
  ok(loopBlock.indexOf('this.renderer.resetStats()') < loopBlock.indexOf('if (!this.paused) this.update(dt)'),
    '渲染统计在 update 之前清零（含 update 里的 shadow pass）');
  ok(gameSrc.includes('this.debugScreen.onToggle') && gameSrc.includes('this.infoBar.hide()'),
    '调试屏打开时常规信息栏让位（同角落不重叠）');
  ok(/stop\(\) \{[\s\S]{0,200}this\.debugScreen\.hide\(\)/.test(gameSrc), '停止游戏即撤下调试屏');
  ok(gameSrc.includes('this.hand.resetForWorld()'), '换存档走 FirstPersonHand.resetForWorld（手臂可见性一并复位）');
  ok(!gameSrc.includes('this.hand.currentName = undefined'), '旧的裸字段复位已收敛到 resetForWorld');

  const handSrc = srcOf('../src/render/FirstPersonHand.js');
  ok(handSrc.includes('_syncArmVisible()'), '手臂显隐有单一入口');
  ok(/_syncArmVisible\(\) \{\s*if \(this\.armMesh\) this\.armMesh\.visible = !this\.currentName;/.test(handSrc),
    '手臂显隐判据 = currentName（唯一真相）');
  const setIdx = handSrc.indexOf('async setItem(name)');
  const awaitIdx = handSrc.indexOf('await buildHeldItemTemplate(name)');
  const syncIdx = handSrc.indexOf('this._syncArmVisible();', setIdx);
  ok(setIdx > 0 && syncIdx > setIdx && syncIdx < awaitIdx, 'setItem 在异步建模之前就切手臂（切手当帧生效）');
  ok(handSrc.includes('this.armMesh.visible = true; // 模板构建失败'), '模板构建失败回退显示手臂（不空成一片）');
  const updIdx = handSrc.indexOf('update(dt, ctx = {})');
  ok(handSrc.indexOf('this._syncArmVisible();', updIdx) > updIdx, 'update 每帧自愈手臂显隐');
}

finish();
