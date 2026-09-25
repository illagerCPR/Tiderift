// endgame-tide.mjs -- 终局篇 F2「四界同潮」演出管线回归（node 直跑，无需服务器）
// 断言：
//   ① 段配置完整性：四维度键齐 / 颜色 0-1 / rate 正 / fogPull 0-1 / label 非空
//   ② 包络确定性：finaleEnvelope 两端为 0、中段为 1、淡入淡出单调、越界为 0
//   ③ 脉冲确定性：finalePulse 0-1、同 t 同值、周期性
//   ④ 纯函数纪律：finale-tide.js 不依赖 Math.random（全部确定性）
//   ⑤ 还原纯度绊线：演出窗口零持久化（SaveSystem 无 finaleTide 字段）；
//      Sky 覆盖为逐帧写入模式（finaleOverride 字段 + 每帧重算回落）；
//      停写点只在 returnToMenu（换维 start 重入保留窗口 = 追潮）
//   ⑥ 接线绊线：update 雾段之后调用（最后写入者）/ 命令面板调试口 / BUILD 不 bump
import { FINALE_TIDE_SEGMENTS, FINALE_TIDE_DURATION, finaleEnvelope, finalePulse } from '../src/world/finale-tide.js';
import { readFileSync } from 'fs';
import { BUILD } from '../src/version.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}

// ── ① 段配置完整性 ──
const DIMS = ['aether', 'nether', 'overworld', 'end'];
for (const dim of DIMS) {
  const seg = FINALE_TIDE_SEGMENTS[dim];
  ok(!!seg, `段配置在场: ${dim}`);
  ok(seg.id === dim, `段 id 与维度一致: ${dim}`);
  ok(typeof seg.label === 'string' && seg.label.length > 0, `段 label 非空: ${dim}`);
  ok(Array.isArray(seg.skyTint) && seg.skyTint.length === 3 && seg.skyTint.every((c) => c >= 0 && c <= 1), `段 skyTint 0-1: ${dim}`);
  ok(seg.fogPull >= 0 && seg.fogPull <= 1, `段 fogPull 0-1: ${dim} (${seg.fogPull})`);
  const pt = seg.particle;
  ok(pt && pt.rate > 0, `段粒子 rate 正: ${dim} (${pt.rate})`);
  ok(Array.isArray(pt.color) && pt.color.length === 3 && pt.color.every((c) => c >= 0 && c <= 1), `段粒子色 0-1: ${dim}`);
  ok(pt.life > 0 && typeof pt.grav === 'number' && pt.rise !== 0 && pt.spread > 0, `段粒子动力学参数齐: ${dim}`);
}

// ── ② 包络确定性 ──
ok(finaleEnvelope(0) === 0, '包络 t=0 为 0（温柔到场）');
ok(finaleEnvelope(FINALE_TIDE_DURATION) === 0, '包络 t=dur 为 0（温柔退场）');
ok(finaleEnvelope(FINALE_TIDE_DURATION / 2) === 1, '包络中段为 1（盛放）');
ok(finaleEnvelope(-1) === 0 && finaleEnvelope(FINALE_TIDE_DURATION + 1) === 0, '包络越界为 0');
const mid1 = finaleEnvelope(2), mid2 = finaleEnvelope(4), mid3 = finaleEnvelope(6);
ok(mid1 < mid2 && mid2 < mid3, '包络淡入段单调递增');
const out1 = finaleEnvelope(FINALE_TIDE_DURATION - 2), out2 = finaleEnvelope(FINALE_TIDE_DURATION - 6);
ok(out1 < out2, '包络淡出段单调递减');
ok(finaleEnvelope(30) === 1 && finaleEnvelope(45) === 1, '盛放段恒 1');
ok(FINALE_TIDE_DURATION === 60, `窗口时长 60s（评审结论 1，${FINALE_TIDE_DURATION}）`);

// ── ③ 脉冲确定性 ──
for (const t of [0, 3.7, 11.2, 59.5]) {
  const p = finalePulse(t);
  ok(p >= 0 && p <= 1, `脉冲 0-1: t=${t} (${p.toFixed(3)})`);
}
ok(finalePulse(5.3) === finalePulse(5.3), '脉冲同 t 同值（确定性）');
ok(Math.abs(finalePulse(2) - finalePulse(2 + 6)) < 1e-9, '脉冲周期性（period=6）');
ok(Math.abs(finalePulse(1.5) - 1) < 1e-6, '脉冲 t=1.5 为峰值 1');

// ── ④ 纯函数纪律 ──
const ftSrc = readFileSync('./src/world/finale-tide.js', 'utf8');
ok(!ftSrc.includes('Math.random'), 'finale-tide.js 零 Math.random（全确定性，粒子随机在 Game 侧）');
ok(!ftSrc.includes('SaveSystem') && !ftSrc.includes('localStorage'), 'finale-tide.js 不触碰持久化');

// ── ⑤ 还原纯度绊线 ──
const saveSrc = readFileSync('./src/core/SaveSystem.js', 'utf8');
ok(!saveSrc.includes('_finaleTide') && !saveSrc.includes('finaleTide'), '演出窗口零持久化（SaveSystem 无 finaleTide 字段）');
const skySrc = readFileSync('./src/render/Sky.js', 'utf8');
ok(skySrc.includes('this.finaleOverride = null;'), 'Sky 演出覆盖字段（逐帧写入模式）');
ok(skySrc.includes('c.lerp(') && skySrc.includes('finaleOverride'), 'Sky 天色每帧包络混入（停写自动回落）');
const gameSrc = readFileSync('./src/player/Game.js', 'utf8');
ok(gameSrc.includes('this.sky.finaleOverride = null; // 天色每帧重算，停写自动回落'), '停写清 finaleOverride（零还原动作）');
ok(gameSrc.includes('returnToMenu') && gameSrc.split('returnToMenu(save = true) {').length === 2, 'returnToMenu 唯一定义（停写点归属核对前置）');
const rtIdx = gameSrc.indexOf('returnToMenu(save = true) {');
const stopIdx = gameSrc.indexOf('this._stopFinaleTide()', rtIdx);
ok(stopIdx > rtIdx && stopIdx < rtIdx + 900, '停写点在 returnToMenu 内（换维 start 重入保留窗口 = 追潮）');
ok(!gameSrc.includes('this._stopFinaleTide(); // 终局演出窗口不跨'), 'start 重入不停演出（旧停写点已移除）');

// ── ⑥ 接线绊线 ──
const fogIdx = gameSrc.indexOf('applyFogRange(fog, this.settings.renderDistance');
const updIdx = gameSrc.indexOf('this._updateFinaleTide(dt);');
ok(fogIdx > 0 && updIdx > fogIdx && updIdx - fogIdx < 600, '_updateFinaleTide 在雾段之后调用（每帧最后写入者）');
ok(gameSrc.includes('_startFinaleTide(opts = {}) {'), '演出启动方法在场（F3 起 ritual/startTs 参数化）');
ok(gameSrc.includes('_finaleParticleTick(seg, p, t, dt)'), '四段粒子发射钩子在场');
ok(gameSrc.includes("BlockRegistry.getId('water')"), '逆雨段水下采样在场（雨只在海上）');
const cpSrc = readFileSync('./src/ui/CommandPanel.js', 'utf8');
ok(cpSrc.includes('_startFinaleTide()') && cpSrc.includes('_stopFinaleTide()'), '命令面板调试口在场（F3 正式触发链前置）');
ok(BUILD === 29, 'BUILD 24（Build 23 主菜单与皮肤面板批次统一 bump）');

console.log(`endgame-tide: ${passed} assertions passed`);
