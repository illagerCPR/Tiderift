// DeathScreen.js -- 玩家死亡屏幕
import { ensureStoneStyles } from './StoneStyle.js';
import { t, onLocaleChange } from '../i18n/index.js';

export class DeathScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    ensureStoneStyles();

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; flex-direction: column;
      align-items: center; justify-content: center; z-index: 45;
      background: rgba(80,0,0,0.55); color: #fff;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1a0a0a; border: 3px solid #5a0000; padding: 32px 48px;
      display:flex; flex-direction:column; gap:14px; align-items:center;
    `;
    this.el.appendChild(panel);

    const title = document.createElement('div');
    title.textContent = t('你死了！');
    title.style.cssText = 'font-size:30px; font-weight:bold; color:#ff6666; text-shadow:2px 2px 0 #000; letter-spacing:4px; margin-bottom:12px;';
    panel.appendChild(title);

    this.respawnBtn = this._mkBtn('重生');
    this.spectateBtn = this._mkBtn('观战其他玩家');
    this.exitBtn = this._mkBtn('返回标题画面', 'danger');
    panel.appendChild(this.respawnBtn);
    panel.appendChild(this.spectateBtn);
    panel.appendChild(this.exitBtn);

    this.respawnBtn.addEventListener('click', () => this.hide());
    // 观战：进入旁观模式（第一人称跟随其他存活玩家），不重生
    this.spectateBtn.addEventListener('click', () => {
      if (this.game.enterSpectate) this.game.enterSpectate();
    });
    this.exitBtn.addEventListener('click', () => {
      this.game.returnToMenu(false);
    });

    // 语言切换（Build 5 i18n）：常驻文本即时重绘
    this._unbindLocale = onLocaleChange(() => this._applyLang());

    document.body.appendChild(this.el);
  }

  _applyLang() {
    this.title.textContent = t('你死了！');
    this.respawnBtn.textContent = t('重生');
    this.spectateBtn.textContent = t('观战其他玩家');
    this.exitBtn.textContent = t('返回标题画面');
  }

  _mkBtn(label, extraClass = '') {
    ensureStoneStyles();
    const b = document.createElement('button');
    b.className = `cw-stone-btn${extraClass ? ' ' + extraClass : ''}`;
    b.textContent = t(label); // 约定：label 传简体中文原文，此处统一翻译
    b.style.cssText = 'padding:10px 20px; font-size:15px; min-width:180px;';
    return b;
  }

  show() {
    this.visible = true;
    this.el.style.display = 'flex';
    if (this.game.inventoryScreen && this.game.inventoryScreen.visible) this.game.inventoryScreen.hide();
    if (this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.game.paused !== undefined) this.game.paused = true;
    // Build 34 C：死亡即取消进行中的竞速尝试。与本文件一样在 show 内收口——死亡屏会置 paused，
    // 之后 Game.update 不再被调用，Game._updateRace 里的死亡判断等不到下一帧
    if (typeof this.game._cancelRace === 'function') this.game._cancelRace('死亡');
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    if (this.game.respawn) this.game.respawn();
    if (this.game.paused !== undefined) this.game.paused = false;
    if (this.game.controls) this.game.controls.enabled = true;
  }

  // 进入观战：隐藏死亡屏但不重生（Game.enterSpectate 负责切换旁观模式）
  hideForSpectate() {
    this.visible = false;
    this.el.style.display = 'none';
  }

  dispose() {
    if (this._unbindLocale) this._unbindLocale();
  }
}