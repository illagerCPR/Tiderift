// PauseMenu.js -- 游戏暂停菜单
import { SaveSystem } from '../core/SaveSystem.js';
import { ensureStoneStyles } from './StoneStyle.js';
import { t, onLocaleChange } from '../i18n/index.js';
import { globeIconDataUri } from './LanguageScreen.js';

export class PauseMenu {
  constructor(game) {
    this.game = game;
    this.visible = false;
    ensureStoneStyles();

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; flex-direction: column;
      align-items: center; justify-content: center; z-index: 40;
      background: rgba(0,0,0,0.6); color: #fff;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #2a2a2a; border: 3px solid #555; padding: 28px 40px;
      display:flex; flex-direction:column; gap:12px; min-width: 240px;
    `;
    this.el.appendChild(panel);

    const title = document.createElement('div');
    title.textContent = t('游戏暂停');
    title.style.cssText = 'font-size:24px; font-weight:bold; text-align:center; margin-bottom:8px; letter-spacing:2px;';
    panel.appendChild(title);
    this.title = title;

    // 主视图按钮组（视频设置打开时整组隐藏，面板关闭后恢复）
    this.mainView = document.createElement('div');
    this.mainView.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
    panel.appendChild(this.mainView);

    this.resumeBtn = this._mkBtn('继续游戏');
    this.saveBtn = this._mkBtn('保存游戏');
    this.videoBtn = this._mkBtn('视频设置');
    this.exitBtn = this._mkBtn('保存并回到标题', 'danger');
    this.mainView.appendChild(this.resumeBtn);
    this.mainView.appendChild(this.saveBtn);
    this.mainView.appendChild(this.videoBtn);
    this.mainView.appendChild(this.exitBtn);
    // 语言切换小按钮（Build 7：地球图标，无文本；进入独立语言界面）
    this.langBtn = document.createElement('button');
    this.langBtn.className = 'cw-stone-btn';
    this.langBtn.title = t('语言');
    this.langBtn.setAttribute('aria-label', t('语言'));
    this.langBtn.style.cssText = `
      width: 40px; height: 40px; padding: 0; margin-top: 4px; align-self: center;
      background-size: 64%; background-repeat: no-repeat; background-position: center;
      background-image: url('${globeIconDataUri()}');
    `;
    this.mainView.appendChild(this.langBtn);

    this.resumeBtn.addEventListener('click', () => this.hide());
    // 保存反馈（Build 4）：按钮短暂变为"✓ 已保存"并禁用 1.2s，防连点 + 显式确认
    this.saveBtn.addEventListener('click', () => {
      if (this.saveBtn.disabled) return;
      if (this.game.world) SaveSystem.save(this.game);
      this.saveBtn.disabled = true;
      this.saveBtn.textContent = t('✓ 已保存');
      setTimeout(() => {
        if (!this.saveBtn) return;
        this.saveBtn.disabled = false;
        this.saveBtn.textContent = t('保存游戏');
      }, 1200);
    });
    // 视频设置：显示共用面板，关闭后回到暂停菜单（保持暂停态）
    this.videoBtn.addEventListener('click', () => {
      if (!this.game.videoSettings) return;
      this.mainView.style.display = 'none';
      this.title.textContent = t('视频设置');
      this.game.videoSettings.onHide = () => {
        this.game.videoSettings.onHide = null;
        if (this.visible) {
          this.mainView.style.display = 'flex';
          this.title.textContent = t('游戏暂停');
        }
      };
      this.game.videoSettings.show();
    });
    // 语言切换：显示共用语言界面，关闭后回到暂停菜单（保持暂停态）
    this.langBtn.addEventListener('click', () => {
      if (!this.game.languageScreen) return;
      this.mainView.style.display = 'none';
      this.title.textContent = t('语言');
      this.game.languageScreen.onHide = () => {
        this.game.languageScreen.onHide = null;
        if (this.visible) {
          this.mainView.style.display = 'flex';
          this.title.textContent = t('游戏暂停');
        }
      };
      this.game.languageScreen.show();
    });
    this.exitBtn.addEventListener('click', () => {
      this.game.returnToMenu(true);
    });

    // 语言切换（Build 5 i18n）：常驻文本即时重绘
    this._unbindLocale = onLocaleChange(() => this._applyLang());

    document.body.appendChild(this.el);
  }

  // 常驻文本统一刷新（构造 + 语言切换共用；label 传原文，_mkBtn/t 负责翻译）
  _applyLang() {
    this.title.textContent = t('游戏暂停');
    this.resumeBtn.textContent = t('继续游戏');
    this.saveBtn.textContent = this.saveBtn.disabled ? t('✓ 已保存') : t('保存游戏');
    this.videoBtn.textContent = t('视频设置');
    this.exitBtn.textContent = t('保存并回到标题');
  }

  _mkBtn(label, extraClass = '') {
    ensureStoneStyles();
    const b = document.createElement('button');
    b.className = `cw-stone-btn${extraClass ? ' ' + extraClass : ''}`;
    b.textContent = t(label); // 约定：label 传简体中文原文，此处统一翻译
    b.style.cssText = 'padding:10px 18px; font-size:15px;';
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
    // Build 34 C：暂停即取消进行中的竞速尝试。必须在这里收口——暂停后 Game.update 不再被调用，
    // 靠 _updateRace 的条件判断永远等不到这一帧（指针锁丢失/ESC 都汇集到 PauseMenu.show）
    if (typeof this.game._cancelRace === 'function') this.game._cancelRace('暂停');
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    if (this.game.paused !== undefined) this.game.paused = false;
    if (this.game.controls) this.game.controls.enabled = true;
    // 复位子视图（视频设置面板打开时被外部关闭等）
    if (this.mainView) this.mainView.style.display = 'flex';
    if (this.title) this.title.textContent = t('游戏暂停');
    if (this.game.videoSettings && this.game.videoSettings.visible) this.game.videoSettings.hide();
  }

  dispose() {
    if (this._unbindLocale) this._unbindLocale();
  }
}