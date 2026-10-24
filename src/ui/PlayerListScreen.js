// PlayerListScreen.js -- B38 L1：Tab 玩家列表面板（按住显示、松开隐藏，原版语义）
// 数据源 = NetworkManager.playerRoster()：异维度玩家没有远端实体，故不能走 RemotePlayer 列表。
// 生命周期与其它阻断界面同款：show 置 controls.enabled=false（不释放指针锁——按住查看、松手即恢复），
// hide 恢复；新建型子系统（Game.start 创建 / _disposeWorld 摘 DOM 与监听器）。面板不吃鼠标事件。
import { t } from '../i18n/index.js';
import { getDimension } from '../core/dimensions.js';
import { playerColorCss } from '../net/playerColor.js';

const REFRESH_MS = 250; // 可见期间的重绘节流（延迟每秒才变几次，250ms 足够）

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class PlayerListScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.el = null;                 // 首次 show 才建 DOM：单人/未联机全程零节点
    this.panel = null;
    this._controlsDisabled = false; // 是否由本屏关掉了 controls.enabled（恢复时只还我们自己关的）
    this._nextAt = 0;
    this._onBlur = () => this.hide(); // 失焦时 keyup 收不到，Tab 会卡在显示态
    window.addEventListener('blur', this._onBlur);
  }

  show() {
    const net = this.game.net;
    if (!net || typeof net.playerRoster !== 'function') return false;
    this._ensureDom();
    this.visible = true;
    this.el.style.display = 'flex';
    this._nextAt = 0;
    this.render();
    // 世界输入关闭（与背包/箱子一致；_anyInputBlockingUI 另有一道闸门管鼠标链）
    const c = this.game.controls;
    if (c && c.enabled) {
      c.enabled = false;
      c.mouseLeft = false;
      c.mouseRight = false;
      this._controlsDisabled = true;
    }
    return true;
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    if (this.el) this.el.style.display = 'none';
    if (this._controlsDisabled) {
      this._controlsDisabled = false;
      // 列表按住期间可能又开了别的界面（E 打开背包等）：那种情况保持输入关闭
      if (this.game.controls && !this.game._anyInputBlockingUI()) this.game.controls.enabled = true;
    }
  }

  // Game.update 每帧调用；内部按 REFRESH_MS 节流
  tick(now) {
    if (!this.visible || now < this._nextAt) return;
    this._nextAt = now + REFRESH_MS;
    this.render();
  }

  dispose() {
    window.removeEventListener('blur', this._onBlur);
    this.visible = false;
    this._controlsDisabled = false;
    if (this.el) { this.el.remove(); this.el = null; this.panel = null; }
  }

  _ensureDom() {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; inset: 0; z-index: 40; display: none;
      align-items: center; justify-content: center; pointer-events: none;
      font-family: 'Segoe UI', sans-serif; user-select: none;
    `;
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      width: min(520px, 90vw); max-height: 70vh; overflow: hidden;
      background: rgba(12,14,18,0.82); border: 2px solid #5d6470;
      box-shadow: 0 0 0 2px rgba(0,0,0,0.75); color: #fff;
      padding: 14px 16px; text-shadow: 1px 1px 0 #000;
    `;
    this.el.appendChild(this.panel);
    document.body.appendChild(this.el);
  }

  render() {
    const net = this.game.net;
    if (!net || typeof net.playerRoster !== 'function' || !this.panel) return;
    const roster = net.playerRoster();
    const own = this.game.world ? this.game.world.dimension : 'overworld';
    const same = [];
    const other = [];
    for (const p of roster) (p.dim === own ? same : other).push(p);
    // 本端永远排最前，其余按昵称稳定排序（节流重绘下顺序不会来回跳）
    const order = (a, b) => (Number(b.self) - Number(a.self)) || String(a.name).localeCompare(String(b.name));
    same.sort(order);
    other.sort(order);
    this.panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;
                  border-bottom:1px solid #3d4350;padding-bottom:8px;margin-bottom:6px;">
        <span style="font-size:16px;font-weight:bold;">${t('玩家列表')}</span>
        <span style="font-size:12px;color:#9aa3b2;">${t('在线 {n} 人', { n: roster.length })}</span>
      </div>
    ` + (same.length ? this._section(t('同维度'), same) : '')
      + (other.length ? this._section(t('其他维度'), other) : '');
  }

  _section(title, rows) {
    return `<div style="margin:6px 0 2px;font-size:12px;color:#9aa3b2;">${esc(title)}</div>`
      + rows.map((p) => this._row(p)).join('');
  }

  _row(p) {
    const def = getDimension(p.dim);
    const dimName = def ? t(def.name) : String(p.dim || '?');
    const ping = p.rtt == null ? t('未测得') : `${p.rtt}ms`;
    const color = playerColorCss(p.id);
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:13px;">
        <span style="width:9px;height:9px;flex:0 0 auto;background:${color};display:inline-block;"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${color};">
          ${esc(p.name || t('玩家'))}${p.self ? ` <span style="color:#9aa3b2;">${esc(t('(你)'))}</span>` : ''}
        </span>
        <span style="width:104px;flex:0 0 auto;color:#ffd88f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.team ? `${p.teamLeader ? '\u2605' : '\u25c6'} ${esc(p.team)}` : ''}</span>
        <span style="width:96px;flex:0 0 auto;color:#c8b8ff;">${esc(dimName)}</span>
        <span style="width:64px;flex:0 0 auto;text-align:right;color:#a8e0a8;">${esc(ping)}</span>
      </div>
    `;
  }
}
