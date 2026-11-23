// ExtraContentScreen.js -- 「额外内容」创建前选择界面（Build 51 R2）
// 只在**创建新世界前**出现：单人页点击空槽前、LAN 页创建/加入（可能新建房间）前。
// 世界规则创建后不可更改——读旧存档/加入已有房间时本界面只是说明，不参与决策。
// 界面本身不拥有草稿：草稿由 MenuScreen 持有（本次菜单会话内有效），本界面读写该引用。
import { ensureStoneStyles } from './StoneStyle.js';
import { normalizeExtraContent, EXTRA_IDS, EXTRA_LABEL_KEYS } from '../content/ExtraContent.js';
import { t } from '../i18n/index.js';

// 卡片文案在 render() 里以 t(简体原文) 字面量书写（静态扫描可覆盖，不走动态键表）。
// 双关草稿（规范化失败时的兜底；正常路径永远拿到规范化对象）
function noneDraft() {
  return normalizeExtraContent(null);
}

export class ExtraContentScreen {
  constructor() {
    ensureStoneStyles();
    this.visible = false;
    this.draft = null;     // 当前草稿（由 MenuScreen 注入的同一对象引用）
    this.onChange = null;  // 草稿变更回调（MenuScreen 重绘摘要）
    this.onClose = null;   // 关闭回调

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; flex-direction: column;
      align-items: center; justify-content: center; z-index: 62;
      background: rgba(0,0,0,0.66); color: #fff;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      width: 720px; max-width: 94vw; max-height: 90vh; overflow-y: auto;
      background: #262a30; border: 3px solid #555; padding: 18px 22px;
      display: flex; flex-direction: column; gap: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.6);
    `;
    this.el.appendChild(this.panel);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });
    this._onKey = (e) => {
      if (!this.visible) return;
      if (e.key === 'Escape') { e.stopPropagation(); this.hide(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(this.el);
  }

  // 打开：draft 由调用方持有（本界面只读写同一个引用）
  show(draft, { onChange = null, onClose = null } = {}) {
    this.draft = draft || noneDraft();
    this.onChange = onChange;
    this.onClose = onClose;
    this.visible = true;
    this.el.style.display = 'flex';
    this.render();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.el.style.display = 'none';
    const cb = this.onClose;
    this.onClose = null;
    if (cb) cb();
  }

  dispose() {
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    document.removeEventListener('keydown', this._onKey, true);
    this.visible = false;
  }

  _set(id, on) {
    const next = { schema: 1, industry: this.draft.industry === true, magic: this.draft.magic === true };
    if (EXTRA_IDS.indexOf(id) >= 0) next[id] = !!on;
    this.draft = normalizeExtraContent(next) || noneDraft();
    if (this.onChange) this.onChange(this.draft);
    this.render();
  }

  // 全部关闭：两张卡片都置 false（不是"恢复草稿"）
  _clearAll() {
    this.draft = noneDraft();
    if (this.onChange) this.onChange(this.draft);
    this.render();
  }

  // 一张卡片（标题/简介/要点全部由调用方以 t() 字面量传入——语言切换时整块重绘）
  _card(id, on, title, brief, lines) {
    const border = on ? '#6f9d6f' : 'rgba(255,255,255,0.18)';
    const bg = on ? 'rgba(70,120,70,0.28)' : 'rgba(0,0,0,0.28)';
    return `
      <div data-card="${id}" style="
        flex: 1 1 0; min-width: 300px; border: 2px solid ${border}; background: ${bg};
        padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="font-size:17px; font-weight:bold;">${title}</div>
          <button class="cw-stone-btn" data-toggle="${id}" style="
            padding: 5px 14px; font-size: 13px; min-width: 92px;
            ${on ? 'border-color:#8fd08f;' : ''}">${on ? t('已启用') : t('未启用')}</button>
        </div>
        <div style="font-size:12px; color:#a9c6a9;">${brief}</div>
        <div style="font-size:12px; color:#c8c8c8; line-height:1.8;">${lines}</div>
      </div>`;
  }

  render() {
    if (!this.visible) return;
    ensureStoneStyles();
    const draft = normalizeExtraContent(this.draft) || noneDraft();
    this.draft = draft;
    const both = draft.industry && draft.magic;
    const any = draft.industry || draft.magic;

    const industryCard = this._card('industry', draft.industry === true,
      t('工业'), t('潮压锅炉、传动轴与加工机械'),
      ['· ' + t('燃料与桶装水推动机器做功'),
        '· ' + t('碎石机与切割机把原料变成材料'),
        '· ' + t('红石仍负责信号与控制')].join('<br/>'));
    const magicCard = this._card('magic', draft.magic === true,
      t('魔法'), t('四潮回响、焦点与经验调谐'),
      ['· ' + t('收集四界材料制作回响焦点'),
        '· ' + t('用经验调谐回响后施放能力'),
        '· ' + t('施法消耗回响，不改地形、不跨维')].join('<br/>'));
    const cards = industryCard + magicCard;

    this.panel.innerHTML = `
      <div style="font-size:20px; font-weight:bold; letter-spacing:1px;">${t('额外内容')}</div>
      <div style="font-size:12px; color:#bbb; line-height:1.7;">
        ${t('仅在创建新世界时确定；已有世界不受影响，创建后不可更改。')}<br/>
        ${t('两个模块可以分别启用，也可以同时启用；全部关闭即原始体验。')}
      </div>
      <div style="display:flex; gap:12px; align-items:stretch; flex-wrap:wrap;">${cards}</div>
      <div style="font-size:12px; color:${both ? '#9fd89f' : '#8a8a8a'}; line-height:1.7; min-height:18px;">
        ${both
          ? t('联动：两个模块同时启用时会出现少量联动内容（不是第三个模块，也不是通关必需）。')
          : t('联动内容只在两个模块同时启用时出现，任一单开都不需要另一边的物品或机器。')}
      </div>
      <div style="display:flex; gap:10px; align-items:center; justify-content:flex-end; margin-top:4px;">
        <button id="extra-none" class="cw-stone-btn" style="padding:8px 16px; font-size:13px; ${any ? '' : 'opacity:0.6;'}">${t('全部关闭')}</button>
        <button id="extra-done" class="cw-stone-btn" style="padding:8px 20px; font-size:13px;">${t('完成')}</button>
      </div>
    `;

    this.panel.querySelectorAll('button[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.toggle;
        this._set(id, !(draft[id] === true));
      });
    });
    const noneBtn = this.panel.querySelector('#extra-none');
    if (noneBtn) noneBtn.addEventListener('click', () => this._clearAll());
    const doneBtn = this.panel.querySelector('#extra-done');
    if (doneBtn) doneBtn.addEventListener('click', () => this.hide());
  }
}

// 徽标文本（存档槽 / 导入摘要 / 房间信息共用）：'工业 · 魔法'，双关返回空串
export function extrasBadgeText(manifest) {
  const m = normalizeExtraContent(manifest);
  if (!m) return '';
  const names = [];
  for (const id of EXTRA_IDS) if (m[id] === true) names.push(t(EXTRA_LABEL_KEYS[id]));
  return names.join(' · ');
}
