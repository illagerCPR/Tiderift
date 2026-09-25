// TradeScreen.js -- 村民交易界面（T5）
// 交易表由 villagerTrades(seed, mob.tradeSeed) 确定性生成——两端同一村民看到同一表。
// 点击"交易"：背包预检 → 扣输入 → 给输出；不满足时按钮置灰。
import { ItemRegistry } from '../core/ItemRegistry.js';
import { drawIconInto } from '../render/BlockIcon.js';
import { ensureStoneStyles } from './StoneStyle.js';
import { villagerTrades } from '../world/loot.js';
import { t } from '../i18n/index.js';
import { getDisplayName } from './itemName.js';

export class TradeScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.mob = null;
    this.trades = [];

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; z-index: 30;
      background: rgba(0,0,0,0.5); align-items: center; justify-content: center;
    `;
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      background: #c6c6c6; border: 4px solid #555; padding: 14px;
      box-shadow: 0 0 0 2px #000; font-family: 'Segoe UI', sans-serif;
      user-select: none; width: max-content;
    `;
    this.el.appendChild(this.panel);
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });

    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = `
      position: fixed; padding: 4px 8px; background: rgba(10,10,10,0.92);
      color: #fff; font-family: monospace; font-size: 13px; z-index: 200;
      pointer-events: none; display: none; border: 1px solid rgba(255,255,255,0.3);
      text-shadow: 1px 1px 0 #000; max-width: 220px;
    `;
    document.body.appendChild(this.tooltip);
    this._onMouseMove = (e) => {
      if (!this.visible) { this.tooltip.style.display = 'none'; return; }
      if (this._hoverEl && this._hoverEl.contains(e.target)) {
        this.tooltip.style.left = (e.clientX + 14) + 'px';
        this.tooltip.style.top = (e.clientY + 14) + 'px';
      }
    };
    document.addEventListener('mousemove', this._onMouseMove);
  }

  dispose() {
    document.removeEventListener('mousemove', this._onMouseMove);
    this.el.remove();
    this.tooltip.remove();
  }

  show(mob) {
    if (!this.game.world || !mob || mob.dead) return;
    this.mob = mob;
    // tradeSeed 缺失兜底（旧广播/异常路径）：按当前位置派生并固化，会话内稳定
    if (mob.tradeSeed == null) {
      mob.tradeSeed = Math.floor(mob.position.x) * 3 + Math.floor(mob.position.z);
    }
    this.trades = villagerTrades(this.game.world.seed, mob.tradeSeed);
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
    this.tooltip.style.display = 'none';
    this._hoverEl = null;
    this.mob = null;
    if (this.game.controls) this.game.controls.enabled = true;
  }

  // 背包内某物品总数（预检用）
  _countOf(name) {
    let n = 0;
    for (const s of this.game.inventory.slots) {
      if (s && s.name === name) n += s.count;
    }
    return n;
  }

  render() {
    this.panel.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = t('村民交易');
    title.style.cssText = 'font-size: 14px; margin-bottom: 10px; color: #333;';
    this.panel.appendChild(title);

    for (let i = 0; i < this.trades.length; i++) {
      this.panel.appendChild(this._tradeRow(this.trades[i], i));
      if (i < this.trades.length - 1) {
        const hr = document.createElement('div');
        hr.style.cssText = 'height: 1px; background: #999; margin: 6px 0;';
        this.panel.appendChild(hr);
      }
    }

    const hint = document.createElement('div');
    hint.textContent = t('按 E / ESC 关闭 · 手持绿宝石可与村民换取货物');
    hint.style.cssText = 'font-size: 12px; color: #555; margin-top: 10px;';
    this.panel.appendChild(hint);
  }

  _slotEl(stack, tooltipText) {
    const slot = document.createElement('div');
    slot.style.cssText = `
      width: 44px; height: 44px; background: #8b8b8b; border: 2px solid #555;
      position: relative; display: flex; align-items: center; justify-content: center;
      image-rendering: pixelated;
    `;
    if (stack) {
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      canvas.style.cssText = 'width: 32px; height: 32px;';
      slot.appendChild(canvas);
      this.drawIcon(canvas, stack.name);
      const c = document.createElement('div');
      c.textContent = stack.count;
      c.style.cssText = 'position: absolute; right: 2px; bottom: 0; color: #fff; font-size: 14px; font-weight: bold; text-shadow: 1px 1px 0 #000;';
      slot.appendChild(c);
    }
    if (tooltipText) {
      slot.onmouseenter = () => {
        this.tooltip.textContent = tooltipText;
        this.tooltip.style.display = 'block';
        this._hoverEl = slot;
      };
      slot.onmouseleave = () => { this.tooltip.style.display = 'none'; this._hoverEl = null; };
    }
    return slot;
  }

  _tradeRow(trade, idx) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 6px; align-items: center;';
    row.appendChild(this._slotEl(trade.give, getDisplayName(trade.give.name)));
    const arrow = document.createElement('div');
    arrow.textContent = '→';
    arrow.style.cssText = 'font-size: 18px; color: #444;';
    row.appendChild(arrow);
    row.appendChild(this._slotEl(trade.get, getDisplayName(trade.get.name)));

    const btn = document.createElement('button');
    const ok = this._countOf(trade.give.name) >= trade.give.count;
    ensureStoneStyles();
    btn.className = 'cw-stone-btn';
    btn.textContent = t('交易');
    btn.disabled = !ok;
    btn.style.cssText = `
      margin-left: 8px; padding: 6px 14px; font-size: 13px; cursor: ${ok ? 'pointer' : 'not-allowed'};
    `;
    btn.onmousedown = (e) => {
      e.preventDefault();
      if (e.button !== 0 || !ok) return;
      this.doTrade(idx);
    };
    row.appendChild(btn);
    return row;
  }

  doTrade(idx) {
    const trade = this.trades[idx];
    if (!trade) return;
    if (this._countOf(trade.give.name) < trade.give.count) return;
    const removed = this.game.inventory.removeItems(trade.give.name, trade.give.count);
    if (removed !== trade.give.count) {
      // 防御回滚（removeItems 正常不会部分扣，此处保底）
      if (removed > 0) this.game.inventory.add(trade.give.name, removed);
      return;
    }
    const remain = this.game.inventory.add(trade.get.name, trade.get.count);
    if (remain > 0 && this.game.mobManager) {
      // 背包满：放不下的部分掉在地上（不凭空消失）
      this.game.mobManager.spawnDrop(this.mob.position.clone(), trade.get.name, remain);
    }
    this.game.hotbar.update();
    this.render(); // 重新评估各按钮可用性
  }

  async drawIcon(canvas, name) {
    const ctx = canvas.getContext('2d');
    // B29 统一走 BlockIcon：物品 SVG 平铺 / 立方方块等轴三面 / 其余方块单面平铺
    await drawIconInto(ctx, 32, name, (n) => {
      const item = ItemRegistry.getByName(n);
      return item && this.game.itemSvgMap[n] ? this.game.itemSvgMap[n] : null;
    });
  }
}
