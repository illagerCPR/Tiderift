// SteleScreen.js -- 风纹石碑浮层（天域批次 A：右键石碑读碑文）
// 生命周期与 BeaconScreen 同款：show 设 controls.enabled=false + 退指针锁，hide 恢复；
// 新建型子系统（Game.start 创建 / _disposeWorld 移除）。章节解析：
// 结构 meta.steles（StructureManager.steleChapterAt）→ 未注册回落 STELE_BLANK。
import { t } from '../i18n/index.js';
import { STELE_CHAPTERS, STELE_BLANK } from '../world/steles.js';

export class SteleScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.pos = null;      // 石碑方块坐标 {x,y,z}
    this.chapter = null;  // 当前章节 {title, lines}

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; z-index: 30;
      background: rgba(0,0,0,0.5); align-items: center; justify-content: center;
    `;
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      background: #23262f; border: 4px solid #5d6470; padding: 18px 22px;
      box-shadow: 0 0 0 2px #000; font-family: 'Segoe UI', sans-serif;
      user-select: none; width: min(560px, 92vw); max-height: 80vh; overflow-y: auto;
      color: #fff;
    `;
    this.el.appendChild(this.panel);
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });
    this.panel.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (btn && btn.id === 'stele-close') this.hide();
    });
  }

  open(x, y, z, chapterIdOverride = null) {
    if (!this.game.world) return;
    this.pos = { x, y, z };
    let id = chapterIdOverride;
    if (!id) {
      const sm = this.game.world.generator && this.game.world.generator.structureManager;
      id = sm && sm.steleChapterAt ? sm.steleChapterAt(x, y, z) : null;
    }
    if (!chapterIdOverride && id && this.game.journal) this.game.journal.recordStele(id);
    this.chapter = (id && STELE_CHAPTERS[id]) || STELE_BLANK;
    this.visible = true;
    this.el.style.display = 'flex';
    this.render();
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
    if (this.game.controls) this.game.controls.enabled = true;
    this.pos = null;
    this.chapter = null;
  }

  dispose() { this.el.remove(); }

  render() {
    const ch = this.chapter || STELE_BLANK;
    const lines = ch.lines.map((l) => `
      <div style="margin: 9px 0; font-size: 14px; line-height: 1.75; color: #cfd4de;">${t(l)}</div>
    `).join('');
    this.panel.innerHTML = `
      <div style="font-size: 19px; font-weight: bold; color: #e8d9a0; margin-bottom: 6px;
                  border-bottom: 1px solid #3d4350; padding-bottom: 8px;">${t(ch.title)}</div>
      ${lines}
      <div style="display:flex; margin-top: 12px; justify-content: flex-end;">
        <button id="stele-close" style="padding: 7px 20px; background:#3a3f4c; border:2px solid #778;
                color:#fff; cursor:pointer; font-size: 13px;">${t('← 返回')}</button>
      </div>
    `;
  }
}
