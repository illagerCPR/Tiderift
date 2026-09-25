// Hotbar.js -- 快捷栏 UI
import { SVGTextures } from '../render/SVGTextures.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { getDisplayName } from './itemName.js';

export class Hotbar {
  constructor(inventory) {
    this.inventory = inventory;
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 2px; padding: 4px; background: rgba(0,0,0,0.5);
      border: 2px solid rgba(255,255,255,0.3); border-radius: 2px; z-index: 10;
    `;
    this.slots = [];
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.style.cssText = `
        width: 44px; height: 44px; background: rgba(0,0,0,0.4);
        border: 2px solid rgba(255,255,255,0.2); position: relative;
        display: flex; align-items: center; justify-content: center;
        image-rendering: pixelated;
      `;
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      canvas.style.cssText = 'width: 32px; height: 32px; image-rendering: pixelated;';
      slot.appendChild(canvas);
      const count = document.createElement('div');
      count.style.cssText = 'position: absolute; right: 2px; bottom: 0; color: #fff; font-size: 14px; font-weight: bold; text-shadow: 1px 1px 0 #000;';
      slot.appendChild(count);
      this.el.appendChild(slot);
      this.slots.push({ el: slot, canvas, count });
    }
    document.body.appendChild(this.el);
    this.iconCache = new Map();
    this._sig = new Array(9).fill(null); // 槽位内容签名（name|count），未变化不重绘
    this._sel = new Array(9).fill(null); // 选中态缓存

    // 切换物品时的名称提示
    this.namePopup = document.createElement('div');
    this.namePopup.style.cssText = `
      position: absolute; bottom: 96px; left: 50%; transform: translateX(-50%);
      padding: 4px 10px; background: rgba(0,0,0,0.6); color: #fff;
      font-family: monospace; font-size: 14px; z-index: 11;
      pointer-events: none; display: none; text-shadow: 1px 1px 0 #000;
      border-radius: 2px;
    `;
    document.body.appendChild(this.namePopup);
    this._popupTimer = 0;
  }

  flashName() {
    const slot = this.inventory.slots[this.inventory.hotbarSelected];
    if (!slot) return;
    this.namePopup.textContent = getDisplayName(slot.name);
    this.namePopup.style.display = 'block';
    clearTimeout(this._popupTimer);
    this._popupTimer = setTimeout(() => { this.namePopup.style.display = 'none'; }, 2000);
  }

  async update() {
    for (let i = 0; i < 9; i++) {
      const s = this.inventory.slots[i];
      const slot = this.slots[i];
      const selected = i === this.inventory.hotbarSelected;
      // 槽位内容签名：未变化的槽位完全不重绘（滚轮切换/拾取频繁触发 update，
      // 全量清空重画 + 异步图标解码的空窗期就是"物品闪烁"的来源）
      const sig = s ? `${s.name}|${s.count}` : '';
      if (this._sig[i] !== sig) {
        this._sig[i] = sig;
        const ctx = slot.canvas.getContext('2d');
        if (s) {
          // 渲染物品图标
          let svgText = this.iconCache.get(s.name);
          if (!svgText) {
            svgText = this.getIconSvg(s.name);
            if (svgText) this.iconCache.set(s.name, svgText);
          }
          if (svgText) {
            const img = await SVGTextures.svgToImage(svgText);
            // await 期间槽位状态又变化——过期绘制直接放弃，由最新一次 update 负责
            //（并发 update 下旧图标曾回写覆盖已清空的槽：献证消耗后快捷栏图标残留的来源）
            if (this._sig[i] !== sig) continue;
            ctx.clearRect(0, 0, 32, 32);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, 32, 32);
            slot.count.textContent = s.count > 1 ? s.count : '';
          } else {
            ctx.clearRect(0, 0, 32, 32);
            slot.count.textContent = s.count > 1 ? s.count : '';
          }
        } else {
          ctx.clearRect(0, 0, 32, 32);
          slot.count.textContent = '';
        }
      }
      if (this._sel[i] !== selected) {
        this._sel[i] = selected;
        slot.el.style.borderColor = selected ? '#fff' : 'rgba(255,255,255,0.2)';
        slot.el.style.borderWidth = selected ? '3px' : '2px';
      }
    }
  }

  getIconSvg(name) {
    // 优先物品 SVG，再方块 SVG
    const item = ItemRegistry.getByName(name);
    if (item && ItemSVGMap[name]) return ItemSVGMap[name];
    const block = BlockRegistry.getByName(name);
    if (block) {
      // 用方块侧面贴图
      const texName = block.icon || block.side || block.top; // B28 优先定向面（箱子/熔炉图标看得出正面）
      if (BlockSVGMap[texName]) return BlockSVGMap[texName];
    }
    return null;
  }
}

// 引用：由 main.js 注入
let ItemSVGMap = {};
let BlockSVGMap = {};
export function setSvgMaps(itemMap, blockMap) {
  ItemSVGMap = itemMap;
  BlockSVGMap = blockMap;
}
