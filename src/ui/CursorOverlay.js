// CursorOverlay.js -- 物品界面光标层组合件：手持物品图标 + 悬浮提示 + document 级监听
// ChestScreen / FurnaceScreen / InventoryScreen / TradeScreen 共用；dispose() 幂等。
import { getDisplayName } from './itemName.js';
import { t } from '../i18n/index.js';

export const CURSOR_SIZE = 44;    // 手持物品图标框边长（与下方 CSS 一致）
export const TOOLTIP_OFFSET = 14; // tooltip 相对鼠标的偏移

// 纯逻辑：鼠标坐标 → 图标左上角（图标居中跟随）
export function cursorPos(clientX, clientY) {
  return { left: clientX - CURSOR_SIZE / 2, top: clientY - CURSOR_SIZE / 2 };
}

// 纯逻辑：鼠标坐标 → tooltip 左上角
export function tooltipPos(clientX, clientY) {
  return { left: clientX + TOOLTIP_OFFSET, top: clientY + TOOLTIP_OFFSET };
}

// 纯逻辑：悬浮提示内容 —— 有 lore 时「名称 + 残文行」富文本，否则纯文本名称
export function tooltipContent(name, lore = null) {
  const title = getDisplayName(name);
  if (!lore || !lore.length) return { text: title };
  const rows = lore.map((l) => `<div style="color:#9fb3c8; font-style:italic; margin-top:2px;">${t(l)}</div>`).join('');
  return { html: `<div>${title}</div>${rows}` };
}

const CURSOR_CSS = `
      position: fixed; width: ${CURSOR_SIZE}px; height: ${CURSOR_SIZE}px; pointer-events: none;
      z-index: 100; display: none; image-rendering: pixelated;
    `;
const TOOLTIP_CSS = `
      position: fixed; padding: 4px 8px; background: rgba(10,10,10,0.92);
      color: #fff; font-family: monospace; font-size: 13px; z-index: 200;
      pointer-events: none; display: none; border: 1px solid rgba(255,255,255,0.3);
      text-shadow: 1px 1px 0 #000; max-width: 220px;
    `;

// 选项：host 挂载父节点 / isVisible 界面可见性（隐藏时 tooltip 立即归零）/
// getCursorItem 读手持物品（null 表示无，图标不跟随）/ drawIcon 图标绘制回调 /
// formatTooltip 名称 → { text } | { html } / blockContextMenu 是否屏蔽右键菜单 /
// onHover 悬浮物品名变化回调（null 表示离开）
export class CursorOverlay {
  constructor(options = {}) {
    const o = Object.assign({
      host: document.body,
      isVisible: () => true,
      getCursorItem: () => null,
      drawIcon: null,
      formatTooltip: (name) => tooltipContent(name),
      blockContextMenu: false,
      onHover: null,
    }, options);
    this.opts = o;

    this._disposed = false;
    this._hoverEl = null;
    this._hoverName = null;

    this.cursorEl = document.createElement('div');
    this.cursorEl.style.cssText = CURSOR_CSS;
    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = TOOLTIP_CSS;
    o.host.appendChild(this.cursorEl);
    o.host.appendChild(this.tooltip);

    this._onMouseMove = (e) => {
      if (o.getCursorItem()) {
        const p = cursorPos(e.clientX, e.clientY);
        this.cursorEl.style.left = p.left + 'px';
        this.cursorEl.style.top = p.top + 'px';
      }
      if (!o.isVisible()) { this.tooltip.style.display = 'none'; return; }
      if (this._hoverEl && this._hoverEl.contains(e.target)) {
        const p = tooltipPos(e.clientX, e.clientY);
        this.tooltip.style.left = p.left + 'px';
        this.tooltip.style.top = p.top + 'px';
      }
    };
    document.addEventListener('mousemove', this._onMouseMove);

    if (o.blockContextMenu) {
      this._onContextMenu = (e) => { if (o.isVisible()) e.preventDefault(); };
      document.addEventListener('contextmenu', this._onContextMenu);
    }
  }

  // 槽位悬浮：name 为空槽时只清提示；离开槽位清空悬浮态（onHover 收到 null）
  bindHover(slot, name) {
    slot.onmouseenter = () => {
      if (!name) { this.clearHover(); return; }
      const content = this.opts.formatTooltip(name);
      if (content.html != null) this.tooltip.innerHTML = content.html;
      else this.tooltip.textContent = content.text;
      this.tooltip.style.display = 'block';
      this._hoverEl = slot;
      this._hoverName = name;
      if (this.opts.onHover) this.opts.onHover(name);
    };
    slot.onmouseleave = () => this.clearHover();
  }

  // 清空悬浮态：隐藏 tooltip、复位命中元素与悬浮名
  clearHover() {
    this.tooltip.style.display = 'none';
    this._hoverEl = null;
    this._hoverName = null;
    if (this.opts.onHover) this.opts.onHover(null);
  }

  // 渲染手持物品图标（含数量角标）；stack 为 null 时隐藏
  setItem(stack) {
    if (stack) {
      this.cursorEl.style.display = 'block';
      this.cursorEl.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      canvas.style.cssText = 'width: 32px; height: 32px;';
      this.cursorEl.appendChild(canvas);
      if (this.opts.drawIcon) this.opts.drawIcon(canvas, stack.name);
      if (stack.count > 1) {
        const c = document.createElement('div');
        c.textContent = stack.count;
        c.style.cssText = 'position: absolute; right: 2px; bottom: 0; color: #fff; font-size: 14px; font-weight: bold; text-shadow: 1px 1px 0 #000;';
        this.cursorEl.appendChild(c);
      }
    } else {
      this.cursorEl.style.display = 'none';
      this.cursorEl.innerHTML = '';
    }
  }

  // 释放：解绑 document 监听器并移除两个节点（幂等，重复调用不再动 DOM）
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    document.removeEventListener('mousemove', this._onMouseMove);
    if (this._onContextMenu) document.removeEventListener('contextmenu', this._onContextMenu);
    this.cursorEl.remove();
    this.tooltip.remove();
  }
}
