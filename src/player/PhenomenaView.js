// PhenomenaView.js -- 局部潮候与稀有景象的表现层（Build 37 G）
// 分工：阶段推导在 core/Phenomena.js（纯函数，两端一致）；这里只做「预兆提示 / 粒子表现 /
// 观测累计 / 一次性纪念发放」。红线：不写方块、不动水位、不碰光照数组，只往粒子池里 spawn。
import { anchorKeyOf, advanceDwell, observable, OBSERVE_SECONDS, phaseAt, phenomenonFor } from '../core/Phenomena.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { audio } from '../audio/AudioEngine.js';
import { t } from '../i18n/index.js';

const SCAN_MS = 400;      // 近邻采样节流（找水/岩浆/虚空边缘）
const EMIT_MS = 120;      // 粒子发射节流
const SOUVENIR_ITEM = 'tide_plaque';
const SOUVENIR_RETRY_MS = 5000;

function rand(range) { return (Math.random() - 0.5) * range; }

export class PhenomenaView {
  constructor(game) {
    this.game = game;
    this.state = null;         // 最近一帧的 phaseAt 结果（游记侧栏与调试直接读）
    this.dwell = 0;            // 当前现象的观测累计秒数
    this._dim = '';
    this._lastPhase = 'idle';
    this._scanAt = 0;
    this._scanDim = '';
    this._sightOk = false;
    this._spots = [];          // 近邻采样命中的表现锚点（水面/岩浆面坐标）
    this._emitAt = 0;
    this._souvenirRetryAt = 0;    // 纪念重试冷却的到期时刻（performance.now 轴）
  }

  dispose() {
    this.state = null;
    this.dwell = 0;
    this._spots = [];
    this._dim = '';
    this._sightOk = false;
  }

  update(dt) {
    const g = this.game;
    if (!g || !g.world || !g.sky) return;
    const dim = g.world.dimension;
    if (dim !== this._dim) this._resetDim(dim);
    const state = phaseAt(dim, g.sky.time, g.sky.dayLength);
    this.state = state;
    const enabled = !g.settings || g.settings.phenomena !== false;
    this._cue(enabled, state, dim);
    if (!enabled) { this.dwell = 0; return; }
    if (state.phase === 'active') this._emit(state, dim);
    this._observe(dt, state, dim);
  }

  // 游记侧栏文案：静默给下一次预兆倒计时，预兆给开始倒计时，涌现给剩余时间
  hintText() {
    const st = this.state;
    if (!st || !st.kind) return '';
    const secs = (v) => `${Math.max(0, Math.ceil(v))}`;
    if (st.phase === 'active') return t('{name} · 涌现中（剩 {s} 秒）', { name: t(st.label), s: secs(st.secondsLeft) });
    if (st.phase === 'omen') return t('{name} · 预兆中（{s} 秒后开始）', { name: t(st.label), s: secs(st.secondsToStart) });
    return t('下一次预兆：{name}（{s} 秒后）', { name: t(st.label), s: secs(st.secondsToOmen) });
  }

  _resetDim(dim) {
    this._dim = dim;
    this.dwell = 0;
    this._lastPhase = 'idle';
    this._scanAt = 0;
    this._scanDim = '';
    this._sightOk = false;
    this._spots = [];
  }

  // 预兆与涌现的边界提示：只在阶段切换的那一帧触发（不会每帧刷屏）
  _cue(enabled, state, dim) {
    if (state.phase === this._lastPhase) return;
    const prev = this._lastPhase;
    this._lastPhase = state.phase;
    if (!enabled || !state.kind) return;
    if (state.phase === 'omen') {
      this.game.hud?.showToast(t('潮候预兆 · {name}：{hint}', { name: t(state.label), hint: t(phenomenonFor(dim).omen) }));
      audio.phenomenonOmen(dim);
    } else if (state.phase === 'active' && prev === 'omen') {
      audio.phenomenonSurge(dim);
    }
  }

  // 观测：必须「现象正盛 + 站得住」才累计；走开按两倍速回退，不隔空攒满
  _observe(dt, state, dim) {
    const g = this.game;
    const journal = g.journal;
    if (!journal) return;
    if (journal.hasPhenomenon(dim)) { this.dwell = 0; return; }
    const p = g.player;
    const canWatch = !g.spectating && !!p && !p.dead && !p.spectator;
    const ok = observable(state) && canWatch && this._sighting(dim);
    const res = advanceDwell(this.dwell, ok, dt, OBSERVE_SECONDS);
    this.dwell = res.dwell;
    if (!res.ready) return;
    this.dwell = 0;
    if (!journal.recordPhenomenon(dim, state.kind, anchorKeyOf(p.position.x, p.position.z))) return;
    g.hud?.showToast(t('已记入四界游记：{name}', { name: t(state.label) }));
    audio.phenomenonRecord(dim);
    this._grantSouvenir();
  }

  // 四象集齐：一次性纪念物品（背包满时退回未领取，5 秒后再试）
  _grantSouvenir() {
    const g = this.game;
    const journal = g.journal;
    if (!journal || !g.inventory) return;
    if (now() < this._souvenirRetryAt) return; // 只在背包满过一次后才进入重试冷却
    if (!journal.claimPhenomenaSouvenir()) return;
    const left = g.inventory.add(SOUVENIR_ITEM, 1);
    if (left > 0) {
      journal.phenomenaSouvenir = false; // 背包满：纪念留到有位置再发
      this._souvenirRetryAt = now() + SOUVENIR_RETRY_MS;
      g.hud?.showToast(t('背包已满：潮候铭牌暂存，腾出空位后自动发放'));
      return;
    }
    if (g.hotbar) g.hotbar.update();
    g.hud?.showToast(t('四界潮候已集齐 · 获得「潮候铭牌」'));
    audio.phenomenonRecord('overworld');
  }

  // 可见范围判定（节流 400ms）：现象是「局部」的，只有站在对应景观旁边才算看见
  _sighting(dim) {
    const nowMs = now();
    if (dim === this._scanDim && nowMs - this._scanAt < SCAN_MS) return this._sightOk;
    this._scanDim = dim;
    this._scanAt = nowMs;
    this._spots = [];
    this._sightOk = false;
    const g = this.game;
    const world = g.world;
    if (!world) return false;
    const p = g.player.position;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    const probe = (x, y, z, type) => {
      const def = BlockRegistry.getById(world.getBlock(x, y, z));
      if (def && def.fluid && def.fluidType === type) { this._spots.push([x + 0.5, y + 0.9, z + 0.5]); return true; }
      return false;
    };
    if (dim === 'overworld' || dim === 'nether') {
      const type = dim === 'nether' ? 'lava' : 'water';
      for (let r = 4; r <= 12; r += 4) {
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const x = px + Math.round(Math.cos(ang) * r);
          const z = pz + Math.round(Math.sin(ang) * r);
          for (const dy of [-2, 0, 2]) {
            if (probe(x, py + dy, z, type)) this._sightOk = true;
          }
        }
      }
      return this._sightOk;
    }
    if (dim === 'end') {
      // 虚空边缘：脚下 8 格全空 = 正站在岛的断崖上
      let solid = false;
      for (let dy = 1; dy <= 8; dy++) {
        const id = world.getBlock(px, py - dy, pz);
        if (id !== 0 && id !== undefined) { solid = true; break; }
      }
      this._sightOk = !solid;
      return this._sightOk;
    }
    // 天域：云层高度或正处在气流柱内
    this._sightOk = p.y >= 70 || !!g._inUpdraft;
    return this._sightOk;
  }

  // 粒子表现：每维一种配色与走向；只 spawn，离开即自然消散，无常驻资源
  _emit(state, dim) {
    const nowMs = now();
    if (nowMs - this._emitAt < EMIT_MS) return;
    this._emitAt = nowMs;
    const g = this.game;
    const particles = g.particles;
    if (!particles || typeof particles.spawn !== 'function') return;
    const p = g.player.position;
    const density = particles.densityScale ?? 1;
    const n = Math.max(1, Math.round(2 * density * state.intensity));
    const def = phenomenonFor(dim);
    if (!def) return;
    for (let i = 0; i < n; i++) this._spawnOne(dim, def, p, particles);
  }

  _spawnOne(dim, def, p, particles) {
    const [r, gg, b] = def.color;
    if (dim === 'overworld') {
      // 岸线荧光：优先贴在采样到的水面，没有水面时就近在空中起一层薄光
      const spot = this._spots.length && Math.random() < 0.75 ? this._spots[(Math.random() * this._spots.length) | 0] : null;
      const x = spot ? spot[0] + rand(1.6) : p.x + rand(14);
      const y = spot ? spot[1] : p.y + rand(3) - 1;
      const z = spot ? spot[2] + rand(1.6) : p.z + rand(14);
      particles.spawn(x, y, z, rand(0.2), 0.35 + Math.random() * 0.5, rand(0.2), r, gg, b, 1.4 + Math.random() * 0.8, -0.15, 0.99);
      return;
    }
    if (dim === 'nether') {
      const x = p.x + rand(16), z = p.z + rand(16), y = p.y + 5 + Math.random() * 7;
      particles.spawn(x, y, z, rand(0.5), -0.6 - Math.random() * 0.5, rand(0.5), r, gg, b, 2.2 + Math.random(), -0.4, 0.99);
      return;
    }
    if (dim === 'end') {
      const x = p.x + rand(18), z = p.z + rand(18), y = p.y - 2 - Math.random() * 8;
      particles.spawn(x, y, z, rand(0.25), 0.05, rand(0.25), r, gg, b, 2.0 + Math.random(), 0, 0.995);
      return;
    }
    // 风光带：沿气流走向横掠
    const ang = Math.sin(now() / 4000) * 0.9;
    const x = p.x + rand(18), z = p.z + rand(18), y = p.y + 3 + Math.random() * 6;
    particles.spawn(x, y, z, Math.cos(ang) * (1.2 + Math.random()), -0.1, Math.sin(ang) * (1.2 + Math.random()), r, gg, b, 2.2 + Math.random(), 0, 0.995);
  }
}

function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
