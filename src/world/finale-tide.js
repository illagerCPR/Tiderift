// finale-tide.js -- 终局篇 F2「四界同潮」演出配置与包络纯函数
// 原初之潮归位的 60 秒窗口：四界分段并行，玩家换维即见彼界段落（单机可追潮跑四界，
// 窗口跨换维延续——演出窗口由 AetherFinale 控制器持有（Game 侧只读访问器 get _finaleTide()），start 重入不清）。
// 演出纪律（不变量 5）：纯客户端零持久化——不进存档、不进联机账本；天色/雾走
// 「逐帧写入」模式（Sky.finaleOverride 每帧由 Game 喂、雾写在 applyFogRange 之后），
// 停写即回落 = 还原纯度天然成立，无任何显式还原动作、无状态残留。LAN：F2 阶段各端本地触发（调试口）；startTs 权威分发随 F3 room flag。
//
// 本模块只放纯数据与纯函数（node 直测）：段配置的取值范围、包络形状、脉冲相位
// 全部确定性——不触碰世界、方块、流体、掉落、龙战（不变量 3/4）。

export const FINALE_TIDE_DURATION = 60;

// 段配置：dim → 演出参数。颜色一律 [r,g,b] 0-1；fogPull 为雾距拉近比例（0=不动）；
// particle.rate 为峰值粒子/秒（实际按包络与 densityScale 缩放）。
export const FINALE_TIDE_SEGMENTS = {
  // 天域·风涨：潮平纪元的呼吸——天空漫上青蓝月白，原初祭坛涌起上升的潮雾
  aether: {
    id: 'aether',
    label: '风涨',
    skyTint: [0.62, 0.86, 0.82],
    fogPull: 0.25,
    particle: { rate: 90, color: [0.72, 0.94, 0.90], life: 2.8, grav: -1.6, rise: 2.2, spread: 7 },
  },
  // 下界·熔岩潮涌：坠潮之地的海记起了自己——雾色向熔岩橙红脉冲，岩浆海面火花上喷
  nether: {
    id: 'nether',
    label: '熔岩潮涌',
    skyTint: [0.90, 0.42, 0.18],
    fogPull: 0.45,
    particle: { rate: 80, color: [1.0, 0.55, 0.20], life: 2.2, grav: 2.5, rise: 5.5, spread: 14 },
  },
  // 主世界·逆雨：落了千百年的咸雨倒着回到天上去——海面升起细密的青蓝雨线
  overworld: {
    id: 'overworld',
    label: '逆雨',
    skyTint: [0.55, 0.75, 0.85],
    fogPull: 0.15,
    particle: { rate: 120, color: [0.55, 0.78, 0.90], life: 2.6, grav: -2.0, rise: 4.5, spread: 18 },
  },
  // 末地·潮声过岸：无潮的彼岸听见了一次潮——潮雾带贴着滩涂掠过，不沾一岸
  end: {
    id: 'end',
    label: '潮声过岸',
    skyTint: [0.55, 0.68, 0.70],
    fogPull: 0.20,
    particle: { rate: 70, color: [0.75, 0.92, 0.92], life: 3.5, grav: 0.4, rise: 0.4, spread: 24 },
  },
};

// 窗口包络：淡入 8s → 盛放 → 淡出 10s，两端为 0（演出温柔到场、温柔退场）
export function finaleEnvelope(t, dur = FINALE_TIDE_DURATION) {
  if (!(t > 0) || t >= dur) return 0;
  const fadeIn = 8, fadeOut = 10;
  if (t < fadeIn) return t / fadeIn;
  if (t > dur - fadeOut) return (dur - t) / fadeOut;
  return 1;
}

// 段内微相位：涌潮呼吸感的循环脉冲 0-1（确定性，同 t 同值）
export function finalePulse(t, period = 6) {
  return 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / period);
}

// 听潮门控（终局篇 F3）：守望界碑右键的三态判定（纯函数，node 可测真值表）。
// 'read'    → 照旧读碑文（非守望碑 / 已听完 / 未候潮——不变量 6：既有行为不回退）
// 'trigger' → 触发听潮仪式（守望碑 ∧ 已候潮 ∧ 未听过 ∧ 演出未在进行）
// 'swallow' → 演出窗口进行中：吞掉右键（不重复触发，也不打断读章节奏）
export function finaleListenGate(state) {
  if (!state || state.chapterId !== 'end_watch') return 'read';
  if (state.done) return 'read';
  if (!state.offered) return 'read';
  return state.windowActive ? 'swallow' : 'trigger';
}
