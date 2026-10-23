// RaceHud.js -- 御风竞速计时条（纯表现层：只画状态，不参与判定）
import { t } from '../i18n/index.js';
import { formatRaceTime } from '../core/RaceRun.js';

export class RaceHud {
  constructor(game) {
    this.game = game;
    this.kind = 'idle';
    this.data = null;
    this.el = document.createElement('div');
    // 顶部居中、BossBar 之下（BossBar 占 top:12px），不与任何既有元素抢位
    this.el.style.cssText = `
      position: fixed; top: 88px; left: 50%; transform: translateX(-50%);
      display: none; flex-direction: column; align-items: center; gap: 3px;
      z-index: 18; pointer-events: none; color: #e8f4ef;
      font-family: 'Segoe UI','Microsoft YaHei',sans-serif;
      text-shadow: 1px 1px 0 #000, -1px 1px 0 #000;
    `;
    document.body.appendChild(this.el);
  }

  _row(text, css) {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.cssText = css;
    this.el.appendChild(div);
    return div;
  }

  // kind: idle | armed | running | finished | cancelled；data 随 kind 变化
  setState(kind, data = null) {
    this.kind = kind;
    this.data = data;
    this.el.style.display = kind === 'idle' ? 'none' : 'flex';
    if (kind === 'idle') return;
    this.el.replaceChildren();
    if (kind === 'armed') {
      this._row(t('赛道：{name}', { name: data.name }), 'font-size:15px;font-weight:bold;color:#9fe8dc;');
      this._row(data.dist <= 0 ? t('已在起点上') : t('前往起点：{dir} 约 {n} 格', { dir: data.dir, n: data.dist }),
        'font-size:13px;color:#cfe6df;');
      this._row(t('穿过起点即开始计时'), 'font-size:12px;color:#8ea7a2;');
      return;
    }
    if (kind === 'running') {
      this._row(formatRaceTime(data.elapsed), 'font-size:26px;font-weight:bold;color:#eaf6f2;letter-spacing:1px;');
      this._row(t('赛道：{name}', { name: data.name }), 'font-size:13px;color:#9fe8dc;');
      this._row(t('检查点 {i}/{n}', { i: data.passed, n: data.total }), 'font-size:13px;color:#cfe6df;');
      this._row(data.dist <= 0 ? t('目标就在脚下') : t('下一目标：{dir} {n} 格', { dir: data.dir, n: data.dist }),
        'font-size:12px;color:#8ea7a2;');
      return;
    }
    if (kind === 'finished') {
      this._row(t('本次用时 {t}', { t: formatRaceTime(data.elapsed) }), 'font-size:26px;font-weight:bold;color:#ffe9a8;');
      if (data.assisted) {
        this._row(t('创造/旁观不计入最佳成绩'), 'font-size:13px;color:#e0a97c;');
      } else if (data.isBest) {
        this._row(t('刷新纪录！'), 'font-size:15px;font-weight:bold;color:#8fe6a8;');
      }
      if (data.best !== null && data.best !== undefined) {
        this._row(t('个人最佳 {t}', { t: formatRaceTime(data.best) }), 'font-size:13px;color:#cfe6df;');
      }
      return;
    }
    if (kind === 'cancelled') {
      this._row(t('计时取消：{reason}', { reason: t(data.reason) }), 'font-size:14px;color:#e89a8a;');
    }
  }

  hide() { this.setState('idle'); }

  dispose() {
    this.el.remove();
    this.data = null;
  }
}
