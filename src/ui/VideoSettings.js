// VideoSettings.js -- 视频设置面板（ESC 暂停菜单与主菜单共用）
// Build 4 全新布局：原版 MC 选项页风格——分组两列网格（画面 / 光影增强 / 音频与操作），
// 按钮统一 .cw-stone-btn 石质材质；点击循环取值，改动即存 localStorage 并实时生效。
// 平滑光照开关切换时对所有区块 markAllDirty，网格在后续帧内分批重建。
import { loadSettings, saveSettings, applySettings, brightnessToMinLight, GFX_ORDER, GFX_LABELS } from '../core/Settings.js';
import { ensureStoneStyles } from './StoneStyle.js';
import { t, setLocale, LOCALES, localeLabel, onLocaleChange } from '../i18n/index.js';

const PARTICLE_LABELS = { all: '全部', decreased: '减少', minimal: '最少' };
const PARTICLE_ORDER = ['all', 'decreased', 'minimal'];

export class VideoSettings {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.onHide = null; // 主界面注入：ESC/完成后回调（暂停菜单返回子视图用）

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; flex-direction: column;
      align-items: center; justify-content: center; z-index: 60;
      background: rgba(0,0,0,0.65); color: #fff;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
      overflow-y: auto; padding: 16px 0;
    `;
    document.body.appendChild(this.el);

    // ESC 关闭并交还父界面（capture 阶段拦截，避免同时触发暂停菜单切换）
    this._onKey = (e) => {
      if (e.key === 'Escape' && this.visible) {
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this._onKey, true);

    this._build();
  }

  _build() {
    ensureStoneStyles();
    this.el.innerHTML = '';

    const panel = document.createElement('div');
    panel.style.cssText = 'display:flex; flex-direction:column; align-items:center;';
    this.el.appendChild(panel);

    const title = document.createElement('div');
    title.textContent = t('视频设置');
    this._titleEl = title;
    title.style.cssText = 'font-size: 24px; font-weight: bold; margin-bottom: 16px; letter-spacing: 2px; text-shadow: 2px 2px 0 rgba(0,0,0,0.6);';
    panel.appendChild(title);

    this.rows = {};
    this._groupHeads = []; // 组名标题（切语言刷新用）

    // 分组容器：标题 + 两列网格（Build 4 重排，替代原单列长条）
    const mkGroup = (label) => {
      const group = document.createElement('div');
      group.style.cssText = 'margin-bottom: 16px;';
      const gt = document.createElement('div');
      gt.textContent = label;
      this._groupHeads.push({ el: gt, key: label });
      gt.style.cssText = 'font-size: 13px; color: #ffd97a; letter-spacing: 3px; margin-bottom: 8px; text-shadow: 1px 1px 0 #000;';
      group.appendChild(gt);
      const grid = document.createElement('div');
      grid.style.cssText = 'display: grid; grid-template-columns: repeat(2, 262px); gap: 8px;';
      group.appendChild(grid);
      panel.appendChild(group);
      return grid;
    };
    const gDisplay = mkGroup(t('画　面'));
    const gGfx = mkGroup(t('光影增强'));
    const gAudio = mkGroup(t('音频与操作'));

    const mkRow = (label, groupEl) => {
      const b = document.createElement('button');
      b.className = 'cw-stone-btn';
      b.style.cssText = 'padding: 10px 12px; font-size: 13px;';
      groupEl.appendChild(b);
      this.rows[label] = b;
      return b;
    };

    // 渲染距离
    mkRow('renderDistance', gDisplay).addEventListener('click', () => {
      const s = this.game.settings;
      s.renderDistance = s.renderDistance >= 12 ? 2 : s.renderDistance + 1;
      this._apply();
    });
    // 视野
    mkRow('fov', gDisplay).addEventListener('click', () => {
      const s = this.game.settings;
      s.fov = s.fov >= 110 ? 60 : s.fov + 5;
      this._apply();
    });
    // 亮度
    mkRow('brightness', gDisplay).addEventListener('click', () => {
      const s = this.game.settings;
      s.brightness = s.brightness >= 100 ? 0 : s.brightness + 10;
      this._apply();
    });
    // 云
    mkRow('clouds', gDisplay).addEventListener('click', () => {
      this.game.settings.clouds = !this.game.settings.clouds;
      this._apply();
    });
    // 粒子
    mkRow('particles', gDisplay).addEventListener('click', () => {
      const s = this.game.settings;
      s.particles = PARTICLE_ORDER[(PARTICLE_ORDER.indexOf(s.particles) + 1) % PARTICLE_ORDER.length];
      this._apply();
    });
    // 潮候现象（Build 37 G）：关掉后不再生成现象粒子与预兆提示（观测记录照常按时间生效）
    mkRow('phenomena', gDisplay).addEventListener('click', () => {
      this.game.settings.phenomena = this.game.settings.phenomena === false;
      this._apply();
    });
    // 平滑光照（切换需重建全部区块网格）
    mkRow('smoothLighting', gDisplay).addEventListener('click', () => {
      this.game.settings.smoothLighting = !this.game.settings.smoothLighting;
      this._apply();
      if (this.game.world) this.game.world.markAllDirty();
    });
    // 视角摇晃
    mkRow('viewBobbing', gDisplay).addEventListener('click', () => {
      this.game.settings.viewBobbing = !this.game.settings.viewBobbing;
      this._apply();
    });
    // 鼠标灵敏度
    mkRow('sensitivity', gAudio).addEventListener('click', () => {
      const s = this.game.settings;
      s.sensitivity = s.sensitivity >= 200 ? 30 : s.sensitivity + 10;
      this._apply();
    });
    // 音量（主音量，步进 10）
    mkRow('volume', gAudio).addEventListener('click', () => {
      const s = this.game.settings;
      s.volume = s.volume >= 100 ? 0 : s.volume + 10;
      this._apply();
    });
    // 音效总开关
    mkRow('sound', gAudio).addEventListener('click', () => {
      this.game.settings.sound = !this.game.settings.sound;
      this._apply();
    });
    // 音乐（BGM/环境风声）开关
    mkRow('music', gAudio).addEventListener('click', () => {
      this.game.settings.music = !this.game.settings.music;
      this._apply();
    });
    // 语言（Build 5 i18n）：循环简体中文/繁體中文/English，即选即存，setLocale 通知常驻 UI 重绘
    mkRow('language', gAudio).addEventListener('click', () => {
      const s = this.game.settings;
      const idx = LOCALES.findIndex(l => l.id === s.language);
      const next = LOCALES[(Math.max(0, idx) + 1) % LOCALES.length];
      s.language = next.id;
      setLocale(next.id);
      this._apply();
    });
    // 光照增强（三档一键：关闭 / 基础=水面反射+云影 / 完整=再加后处理）
    mkRow('gfx', gGfx).addEventListener('click', () => {
      const s = this.game.settings;
      s.gfx = GFX_ORDER[(GFX_ORDER.indexOf(s.gfx) + 1) % GFX_ORDER.length];
      this._apply();
    });
    // 泛光（完整档生效）
    mkRow('gfxBloom', gGfx).addEventListener('click', () => {
      this.game.settings.gfxBloom = !this.game.settings.gfxBloom;
      this._apply();
    });
    // 体积光（完整档生效）
    mkRow('gfxGodRays', gGfx).addEventListener('click', () => {
      this.game.settings.gfxGodRays = !this.game.settings.gfxGodRays;
      this._apply();
    });
    // 平面真反射（完整档生效；镜像相机二次渲染，低端机可关）
    mkRow('gfxWaterReflection', gGfx).addEventListener('click', () => {
      this.game.settings.gfxWaterReflection = !this.game.settings.gfxWaterReflection;
      this._apply();
    });
    // 太阳阴影（完整档生效；节流 shadow pass，低端机可关）
    mkRow('gfxShadows', gGfx).addEventListener('click', () => {
      this.game.settings.gfxShadows = !this.game.settings.gfxShadows;
      this._apply();
    });
    // 全屏（不持久化，按浏览器当前状态显示；归入"画面"组）
    this.fullscreenBtn = document.createElement('button');
    this.fullscreenBtn.className = 'cw-stone-btn';
    this.fullscreenBtn.style.cssText = 'padding: 10px 12px; font-size: 13px;';
    this.fullscreenBtn.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch { /* 用户拒绝等忽略 */ }
      this._refresh();
    });
    gDisplay.appendChild(this.fullscreenBtn);

    // 完成按钮（跨两列居中）
    const done = document.createElement('button');
    done.className = 'cw-stone-btn';
    done.textContent = t('完成');
    this._doneBtn = done;
    done.style.cssText = 'width: 532px; padding: 12px 14px; font-size: 15px; margin-top: 4px;';
    done.addEventListener('click', () => this.hide());
    panel.appendChild(done);

    this._refresh();
    // 语言切换（Build 5 i18n）：面板常在切语言现场打开，标题/组名/完成按钮需即时重绘
    this._unbindLocale = onLocaleChange(() => this._applyLang());
  }

  _applyLang() {
    this._titleEl.textContent = t('视频设置');
    for (const g of this._groupHeads) g.el.textContent = t(g.key);
    this._doneBtn.textContent = t('完成');
    this._refresh();
  }

  _apply() {
    saveSettings(this.game.settings);
    applySettings(this.game);
    this._refresh();
  }

  _refresh() {
    const s = this.game.settings;
    const onOff = (v) => t(v ? '开' : '关');
    this.rows.renderDistance.textContent = t('渲染距离: {n} 区块', { n: s.renderDistance });
    this.rows.fov.textContent = t('视野: {n}', { n: s.fov });
    this.rows.brightness.textContent = t('亮度: {p}%（最低亮度 {v}）', { p: s.brightness, v: brightnessToMinLight(s.brightness).toFixed(2) });
    this.rows.clouds.textContent = t('云: {v}', { v: onOff(s.clouds) });
    this.rows.particles.textContent = t('粒子: {v}', { v: t(PARTICLE_LABELS[s.particles] || '全部') });
    this.rows.phenomena.textContent = t('潮候现象: {v}', { v: onOff(s.phenomena !== false) });
    this.rows.smoothLighting.textContent = t('平滑光照: {v}', { v: onOff(s.smoothLighting) });
    this.rows.viewBobbing.textContent = t('视角摇晃: {v}', { v: onOff(s.viewBobbing) });
    this.rows.sensitivity.textContent = t('鼠标灵敏度: {p}%', { p: s.sensitivity });
    this.rows.volume.textContent = t('音量: {p}%', { p: s.volume });
    this.rows.sound.textContent = t('音效: {v}', { v: onOff(s.sound) });
    this.rows.music.textContent = t('音乐: {v}', { v: onOff(s.music) });
    this.rows.language.textContent = t('语言: {v}', { v: localeLabel(s.language) });
    this.rows.gfx.textContent = t('光照增强: {v}', { v: t(GFX_LABELS[s.gfx] || '关闭') });
    const subHint = s.gfx === 'full' ? '' : t('（完整档生效）');
    this.rows.gfxBloom.textContent = t('泛光: {v}{h}', { v: onOff(s.gfxBloom), h: subHint });
    this.rows.gfxGodRays.textContent = t('体积光: {v}{h}', { v: onOff(s.gfxGodRays), h: subHint });
    this.rows.gfxWaterReflection.textContent = t('水面真反射: {v}{h}', { v: onOff(s.gfxWaterReflection !== false), h: subHint });
    this.rows.gfxShadows.textContent = t('太阳阴影: {v}{h}', { v: onOff(s.gfxShadows !== false), h: subHint });
    this.fullscreenBtn.textContent = t('全屏: {v}', { v: document.fullscreenElement ? t('开（点击退出）') : t('关（点击进入）') });
  }

  show() {
    this._refresh(); // 全屏状态等实时量刷新
    this.visible = true;
    this.el.style.display = 'flex';
    if (this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    // 游戏内（暂停菜单）打开时把控制权交还给暂停菜单（保持暂停态），主界面则无需处理
    if (this.onHide) this.onHide();
  }

  dispose() {
    if (this._unbindLocale) this._unbindLocale();
    document.removeEventListener('keydown', this._onKey, true);
    this.el.remove();
  }
}
