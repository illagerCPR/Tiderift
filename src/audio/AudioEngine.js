// AudioEngine.js -- WebAudio 程序化音频引擎（零资产合成，延续"SVG 程序化纹理"思路）
// 惰性初始化：AudioContext 必须在首次用户手势后创建（浏览器自动播放策略），
// main.js 调 installUnlock() 在 pointerdown/keydown 上挂一次性解锁。
// 总线：sfx/music 分轨 -> master（音量/静音统一控制）。所有发声入口在 ctx 未就绪时静默早退。
const CATEGORY_PARAMS = {
  stone:  { filter: 'lowpass',  freq: 900,  q: 1,   dur: 0.16, gain: 1.0 },
  wood:   { filter: 'lowpass',  freq: 650,  q: 1.2, dur: 0.14, gain: 0.9, thump: 95 },
  gravel: { filter: 'highpass', freq: 500,  q: 0.8, dur: 0.12, gain: 0.8 },
  grass:  { filter: 'bandpass', freq: 2600, q: 2,   dur: 0.09, gain: 0.7 },
  glass:  { filter: 'highpass', freq: 3200, q: 3,   dur: 0.12, gain: 0.8, ping: 1900 },
  metal:  { filter: 'bandpass', freq: 1400, q: 4,   dur: 0.14, gain: 0.85, ping: 900 },
  cloth:  { filter: 'lowpass',  freq: 480,  q: 1,   dur: 0.12, gain: 0.6 },
  snow:   { filter: 'lowpass',  freq: 700,  q: 1,   dur: 0.10, gain: 0.55 },
  liquid: { filter: 'lowpass',  freq: 600,  q: 1,   dur: 0.14, gain: 0.7, plop: 260 },
};

// 方块定义 -> 音效材质类别（名称启发式，未命中回退 stone）
export function blockCategory(def) {
  const n = def && def.name ? def.name : '';
  if (/glass|ice|shulker|sea_lantern/.test(n)) return 'glass';
  if (/wool|carpet|bed|banner/.test(n)) return 'cloth';
  if (/plank|wood|log|door|fence|chest|crafting|bookshelf|trapdoor|barrel|bamboo/.test(n)) return 'wood';
  if (/sand|gravel|soul|powder|dirt|farmland|clay|mud|concrete_powder/.test(n)) return 'gravel';
  if (/grass|leaves|flower|crop|wheat|hay|moss|vine|tall_|sculk_|nylium|fungus|shroomlight/.test(n)) return 'grass';
  if (/iron|gold|anvil|cauldron|rail|hopper|piston|lantern|chain|netherite|bell/.test(n)) return 'metal';
  if (/snow/.test(n)) return 'snow';
  if (def && def.fluid) return 'liquid';
  return 'stone';
}

class AudioEngine {
  constructor() {
    this.ctx = null;       // AudioContext（首次手势后创建）
    this.master = null;    // 总增益（音量）
    this.sfx = null;       // 音效分轨
    this.music = null;     // BGM 分轨（A-② 使用，预留）
    this.enabled = true;
    this.volume = 0.6;
    this.musicEnabled = true;
    this.noiseBuf = null;  // 1s 白噪声缓存
    this._unlockWired = false;
  }

  // 首次用户手势后创建/恢复 AudioContext（幂等，可反复调用）
  unlock() {
    try {
      if (!this.ctx) {
        const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return;
        this.ctx = new AC();
        this._buildGraph();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* 无音频设备等忽略 */ }
  }

  // 挂一次性手势监听（main.js 启动时调用一次）
  installUnlock() {
    if (this._unlockWired || typeof document === 'undefined') return;
    this._unlockWired = true;
    const handler = () => this.unlock();
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('keydown', handler, true);
  }

  _buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.5;
    this.music.connect(this.master);
    // 白噪声缓存（1s，单声道）
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  }

  setEnabled(v) {
    this.enabled = !!v;
    if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.enabled) this.master.gain.value = this.volume;
  }

  // 滤波噪声 burst：挖掘/放置/脚步类的基础粒子（bus 可选 music 轨供环境音）
  _noise({ when = 0, dur = 0.15, filter = 'lowpass', freq = 800, q = 1, gain = 0.5, rate = 1, attack = 0.006, bus = null } = {}) {
    if (!this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rate;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.value = freq;
    bq.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(bus || this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  // 振荡器音：包络 + 可选下滑（exponentialRamp 需正频率；bus 可选 music 轨）
  _tone({ when = 0, dur = 0.15, from = 220, to = 0, type = 'sine', gain = 0.3, attack = 0.008, bus = null } = {}) {
    if (!this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), t);
    if (to > 0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus || this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // —— 游戏事件音 ——

  // 挖掘命中（由 0.25s 挖掘节奏定时器驱动，天然限频）
  digHit(def) {
    if (!this.ctx) return;
    const p = CATEGORY_PARAMS[blockCategory(def)];
    this._noise({ dur: p.dur * 0.6, filter: p.filter, freq: p.freq * 1.15, q: p.q, gain: 0.18 * p.gain, rate: 1.2 });
  }

  blockBreak(def) {
    if (!this.ctx) return;
    const p = CATEGORY_PARAMS[blockCategory(def)];
    this._noise({ dur: p.dur * 1.6, filter: p.filter, freq: p.freq * 0.85, q: p.q, gain: 0.55 * p.gain, rate: 0.8 });
    if (p.ping) this._tone({ dur: 0.22, from: p.ping, to: p.ping * 0.6, type: 'sine', gain: 0.14 });
    if (p.thump) this._tone({ dur: 0.12, from: p.thump, to: p.thump * 0.7, type: 'sine', gain: 0.3 });
    if (p.plop) this._tone({ dur: 0.1, from: p.plop, to: p.plop * 0.55, type: 'sine', gain: 0.25 });
  }

  blockPlace(def) {
    if (!this.ctx) return;
    const p = CATEGORY_PARAMS[blockCategory(def)];
    this._noise({ dur: p.dur * 0.8, filter: p.filter, freq: p.freq, q: p.q, gain: 0.32 * p.gain, rate: 1.0 });
    if (p.thump) this._tone({ dur: 0.09, from: p.thump * 1.1, to: p.thump * 0.8, type: 'sine', gain: 0.2 });
  }

  // 玩家受击：低哑下滑音（音量随伤害微调）
  hurt(amount) {
    if (!this.ctx) return;
    const g = Math.min(0.45, 0.22 + amount * 0.02);
    this._tone({ dur: 0.16, from: 210, to: 140, type: 'sawtooth', gain: g });
    this._tone({ when: 0.05, dur: 0.1, from: 150, to: 110, type: 'triangle', gain: g * 0.6 });
    this._noise({ dur: 0.08, filter: 'lowpass', freq: 500, gain: g * 0.4 });
  }

  // 进食：三连咀嚼 + 收尾吞咽
  eat() {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i++) {
      this._noise({ when: i * 0.11, dur: 0.05, filter: 'lowpass', freq: 700 + i * 90, gain: 0.35, rate: 0.9 + i * 0.1 });
    }
    this._tone({ when: 0.36, dur: 0.14, from: 280, to: 180, type: 'sine', gain: 0.18 });
  }

  // 弓发射：弦震 + 破空（蓄力越满音越低沉）
  bowShoot(charge = 1) {
    if (!this.ctx) return;
    const c = Math.max(0, Math.min(1, charge));
    this._tone({ dur: 0.1 + c * 0.1, from: 150 + c * 70, to: 90, type: 'triangle', gain: 0.25 });
    this._noise({ dur: 0.16, filter: 'bandpass', freq: 1100 + c * 500, q: 1.5, gain: 0.16, rate: 1.1 });
  }

  // 箭命中（怪/方块钉住）
  arrowHit() {
    if (!this.ctx) return;
    this._noise({ dur: 0.05, filter: 'highpass', freq: 1800, gain: 0.3, rate: 1.6 });
  }

  // 掉落物拾取（Build 10）：原版"啵"声——短促上滑正弦
  pop() {
    if (!this.ctx) return;
    this._tone({ dur: 0.09, from: 520, to: 880, type: 'sine', gain: 0.22 });
  }

  // —— 怪物语音（A-②）：按类型预设合成，距离衰减，引擎全局限频 ——

  // 全局限频门（key + 最小间隔秒）：群怪同屏时叫声不至于糊成一团
  _gate(key, interval) {
    if (!this.ctx) return false;
    this._gates = this._gates || new Map();
    const now = this.ctx.currentTime;
    const last = this._gates.get(key) || -Infinity;
    if (now - last < interval) return false;
    this._gates.set(key, now);
    return true;
  }

  // 语音核心：mode 决定音高/时长/增益倍率（idle 常态叫 / hurt 受击尖 / death 死亡沉）
  _mobVoice(typeName, dist, mode) {
    if (!this.ctx) return;
    const preset = VOICE_PRESETS[typeName] || VOICE_DEFAULT;
    const pitchMul = mode === 'hurt' ? 1.35 : (mode === 'death' ? 0.75 : 1);
    const durMul = mode === 'hurt' ? 0.7 : (mode === 'death' ? 1.5 : 1);
    const gainMul = mode === 'hurt' ? 1.4 : (mode === 'death' ? 1.3 : 1);
    const att = dist == null ? 1 : Math.max(0, 1 - dist / 28);
    if (att <= 0) return;
    for (const t of preset.tones || []) {
      this._tone({
        when: (t.when || 0) * durMul, dur: t.dur * durMul,
        from: t.from * pitchMul, to: Math.max(20, (t.to || t.from * 0.8) * pitchMul),
        type: t.type, gain: t.gain * att * gainMul,
      });
    }
    const n = preset.noise;
    if (n) {
      this._noise({
        when: (n.when || 0) * durMul, dur: n.dur * durMul, filter: n.filter,
        freq: n.freq * pitchMul, q: n.q || 1, gain: n.gain * att * gainMul,
      });
    }
  }

  // 环境叫声（随机计时驱动，全局限频 0.3s）
  mobIdle(typeName, dist) {
    if (!this._gate('voice', 0.3)) return;
    this._mobVoice(typeName, dist, 'idle');
  }

  // 受击 / 死亡（反馈音不受限频门）
  mobHurt(typeName, dist) { this._mobVoice(typeName, dist, 'hurt'); }
  mobDeath(typeName, dist) { this._mobVoice(typeName, dist, 'death'); }

  // —— 脚步（A-②）：距离驱动步频，材质变调 ——

  step(def) {
    if (!this.ctx) return;
    const p = CATEGORY_PARAMS[blockCategory(def)];
    this._noise({ dur: p.dur * 0.45, filter: p.filter, freq: p.freq * 1.2, q: p.q, gain: 0.09 * p.gain, rate: 0.85 + Math.random() * 0.3 });
  }

  // 高处落地：闷响 + 低频冲击
  land(def) {
    if (!this.ctx) return;
    const p = CATEGORY_PARAMS[blockCategory(def)];
    this._noise({ dur: p.dur * 1.2, filter: p.filter, freq: p.freq * 0.9, q: p.q, gain: 0.2 * p.gain, rate: 0.8 });
    this._tone({ dur: 0.09, from: 68, to: 50, type: 'sine', gain: 0.14 });
  }

  // 涉水脚步：水花
  splash() {
    if (!this.ctx) return;
    this._noise({ dur: 0.16, filter: 'highpass', freq: 1100, gain: 0.1, rate: 1.2 });
  }

  // —— 局部潮候（Build 37 G）：预兆 / 涌现 / 记录三段提示音 ——
  // 只用短促的计划式节点：预兆是低频持续音起手，涌现是上扬双音，记录是一记清响。
  _phenomenonBase(dim) {
    return { overworld: 196, nether: 146.8, end: 174.6, aether: 261.6 }[dim] || 196;
  }

  phenomenonOmen(dim) {
    if (!this.ctx) return;
    const base = this._phenomenonBase(dim);
    this._tone({ dur: 2.4, from: base, to: base * 1.5, type: 'sine', gain: 0.09, attack: 0.45 });
    this._noise({ dur: 2.2, filter: 'lowpass', freq: 420, gain: 0.045, attack: 0.7 });
  }

  phenomenonSurge(dim) {
    if (!this.ctx) return;
    const base = this._phenomenonBase(dim);
    this._tone({ dur: 0.9, from: base * 1.5, to: base * 2.25, type: 'triangle', gain: 0.10, attack: 0.15 });
    this._tone({ when: 0.12, dur: 1.1, from: base * 2, to: base * 3, type: 'sine', gain: 0.07, attack: 0.2 });
  }

  phenomenonRecord(dim) {
    if (!this.ctx) return;
    const base = this._phenomenonBase(dim) * 4;
    this._tone({ dur: 0.35, from: base, to: base * 1.5, type: 'sine', gain: 0.12 });
    this._tone({ when: 0.14, dur: 0.5, from: base * 1.5, to: base * 2, type: 'sine', gain: 0.1 });
  }

  // —— 环境音 / BGM（A-②）：wind swells + 和弦垫，全部计划式调度（无常驻节点，
  //    暂停时 Game.update 停止调用即自然静默），走 music 分轨 ——

  setMusicEnabled(v) {
    this.musicEnabled = !!v;
    if (this.music) this.music.gain.value = this.musicEnabled ? 0.5 : 0;
  }

  // 世界启动时复位相位（避免新存档继承上一局的调度节拍）
  resetAmbient() {
    this._windT = 5 + Math.random() * 6;
    this._bgmT = 2.5;
    this._bgmIndex = 0;
  }

  // 每帧驱动（Game.update 调用；daylight 0..1 调风声强弱）
  tickAmbient(dt, daylight = 0.8) {
    if (!this.ctx || !this.musicEnabled) return;
    this._windT = (this._windT ?? 5) - dt;
    if (this._windT <= 0) {
      this._windT = 9 + Math.random() * 14;
      this._noise({
        dur: 4 + Math.random() * 2, filter: 'lowpass', freq: 300 + Math.random() * 250,
        q: 0.5, gain: 0.018 + 0.022 * daylight, rate: 0.5, attack: 1.4, bus: this.music,
      });
    }
    this._bgmT = (this._bgmT ?? 2.5) - dt;
    if (this._bgmT <= 0) {
      this._bgmT = 4.6;
      this._bgmChord();
    }
  }

  // 一组和弦垫：C-G-Am-F 低音区循环（正弦 + 微失谐，慢起音）
  _bgmChord() {
    const roots = [130.81, 98.0, 110.0, 87.31];
    const root = roots[this._bgmIndex % roots.length];
    this._bgmIndex = (this._bgmIndex + 1) % roots.length;
    const notes = [root, root * 1.5, root * 2.52];
    for (const f of notes) {
      this._tone({
        dur: 4.4, from: f * (1 + (Math.random() - 0.5) * 0.002), to: f,
        type: 'sine', gain: 0.026, attack: 1.2, bus: this.music,
      });
    }
  }
}

// 怪物语音预设：tones（振荡器组）+ noise（可选），音量克制（0.05~0.16）
const VOICE_PRESETS = {
  villager: { tones: [{ from: 150, to: 120, type: 'sine', dur: 0.28, gain: 0.1 }] },
  cow: { tones: [{ from: 95, to: 68, type: 'sawtooth', dur: 0.45, gain: 0.1 }] },
  sheep: { tones: [{ from: 330, to: 285, type: 'triangle', dur: 0.18, gain: 0.09 }, { when: 0.2, from: 320, to: 280, type: 'triangle', dur: 0.16, gain: 0.08 }] },
  chicken: { tones: [{ from: 620, to: 470, type: 'square', dur: 0.07, gain: 0.05 }, { when: 0.09, from: 580, to: 430, type: 'square', dur: 0.07, gain: 0.05 }] },
  zombie: { tones: [{ from: 98, to: 66, type: 'sawtooth', dur: 0.55, gain: 0.12 }] },
  zombified_piglin: { tones: [{ from: 140, to: 88, type: 'sawtooth', dur: 0.3, gain: 0.11 }] },
  skeleton: { noise: { filter: 'highpass', freq: 1400, dur: 0.16, gain: 0.1 } },
  wither_skeleton: { tones: [{ from: 80, to: 55, type: 'sawtooth', dur: 0.4, gain: 0.11 }], noise: { filter: 'bandpass', freq: 700, dur: 0.3, gain: 0.06 } },
  creeper: { noise: { filter: 'highpass', freq: 2800, dur: 0.35, gain: 0.07 } },
  spider: { noise: { filter: 'bandpass', freq: 1900, dur: 0.22, gain: 0.09 } },
  blaze: { tones: [{ from: 210, to: 160, type: 'triangle', dur: 0.35, gain: 0.07 }], noise: { filter: 'bandpass', freq: 900, dur: 0.3, gain: 0.05 } },
  enderman: { tones: [{ from: 170, to: 260, type: 'sine', dur: 0.35, gain: 0.08 }, { when: 0.36, from: 250, to: 150, type: 'sine', dur: 0.4, gain: 0.07 }] },
  iron_golem: { tones: [{ from: 62, to: 48, type: 'sine', dur: 0.6, gain: 0.14 }] },
  dragon: { tones: [{ from: 75, to: 42, type: 'sawtooth', dur: 0.9, gain: 0.16 }], noise: { filter: 'lowpass', freq: 400, dur: 0.8, gain: 0.1 } },
  wither: { tones: [{ from: 66, to: 40, type: 'sawtooth', dur: 0.8, gain: 0.16 }, { when: 0.3, from: 55, to: 36, type: 'sine', dur: 0.7, gain: 0.12 }], noise: { filter: 'lowpass', freq: 350, dur: 0.7, gain: 0.09 } },
  shulker: { tones: [{ from: 640, to: 520, type: 'square', dur: 0.12, gain: 0.06 }] },
  wisp: { tones: [{ from: 540, to: 680, type: 'sine', dur: 0.3, gain: 0.06 }] },
  aether_guard: { tones: [{ from: 480, to: 600, type: 'triangle', dur: 0.35, gain: 0.07 }] },
};
const VOICE_DEFAULT = { tones: [{ from: 220, to: 180, type: 'triangle', dur: 0.25, gain: 0.07 }] };

export const audio = new AudioEngine();
