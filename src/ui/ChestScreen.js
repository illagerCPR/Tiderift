// ChestScreen.js -- 箱子界面（T5：右键箱子打开）
// 27 格容器 + 玩家背包/快捷栏；拖放/合并逻辑与 InventoryScreen 同款。
// 容器内容来自 World.containers（惰性生成），任何修改经 Game.onContainerChanged 上报（联机同步）。
import { SVGTextures } from '../render/SVGTextures.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { t } from '../i18n/index.js';
import { getDisplayName } from './itemName.js';

export class ChestScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.pos = null;      // 容器方块坐标 {x,y,z}
    this.items = null;    // 27 槽数组（World.containers 内的引用，直接改）
    this._changed = false;

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; z-index: 30;
      background: rgba(0,0,0,0.5); align-items: center; justify-content: center;
    `;
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      background: #c6c6c6; border: 4px solid #555; padding: 12px;
      box-shadow: 0 0 0 2px #000; font-family: 'Segoe UI', sans-serif;
      user-select: none; display: inline-block; width: max-content;
    `;
    this.el.appendChild(this.panel);
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });

    this.cursorItem = null;
    this.cursorEl = document.createElement('div');
    this.cursorEl.style.cssText = `
      position: fixed; width: 44px; height: 44px; pointer-events: none;
      z-index: 100; display: none; image-rendering: pixelated;
    `;
    document.body.appendChild(this.cursorEl);

    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = `
      position: fixed; padding: 4px 8px; background: rgba(10,10,10,0.92);
      color: #fff; font-family: monospace; font-size: 13px; z-index: 200;
      pointer-events: none; display: none; border: 1px solid rgba(255,255,255,0.3);
      text-shadow: 1px 1px 0 #000; max-width: 220px;
    `;
    document.body.appendChild(this.tooltip);

    // document 级监听器保存引用，dispose 时移除（避免换世界累积）
    this._onMouseMove = (e) => {
      if (this.cursorItem) {
        this.cursorEl.style.left = (e.clientX - 22) + 'px';
        this.cursorEl.style.top = (e.clientY - 22) + 'px';
      }
      if (!this.visible) { this.tooltip.style.display = 'none'; return; }
      if (this._hoverEl && this._hoverEl.contains(e.target)) {
        this.tooltip.style.left = (e.clientX + 14) + 'px';
        this.tooltip.style.top = (e.clientY + 14) + 'px';
      }
    };
    this._onContextMenu = (e) => { if (this.visible) e.preventDefault(); };
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('contextmenu', this._onContextMenu);
  }

  dispose() {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('contextmenu', this._onContextMenu);
    this.el.remove();
    this.cursorEl.remove();
    this.tooltip.remove();
  }

  _bindHover(slot, name) {
    slot.onmouseenter = () => {
      if (!name) { this.tooltip.style.display = 'none'; this._hoverName = null; return; }
      this.tooltip.textContent = getDisplayName(name);
      this.tooltip.style.display = 'block';
      this._hoverEl = slot;
      this._hoverName = name; // R/U 配方查询目标
    };
    slot.onmouseleave = () => {
      this.tooltip.style.display = 'none';
      this._hoverEl = null;
      this._hoverName = null;
    };
  }

  // 打开：从 World 惰性取容器内容（结构箱子按 (seed,表名,坐标) 确定性生成）
  show(x, y, z) {
    if (!this.game.world) return;
    this.pos = { x, y, z };
    this.items = this.game.world.getOrOpenContainer(x, y, z);
    this._changed = false;
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
    this.returnCursorItem();
    this.visible = false;
    this.el.style.display = 'none';
    this.tooltip.style.display = 'none';
    this._hoverEl = null;
    this._hoverName = null;
    if (this.game.controls) this.game.controls.enabled = true;
    if (this._changed && this.pos) {
      this.game.onContainerChanged(this.pos, this.items); // 联机上报（单机 noop）
    }
    this._changed = false;
    this.pos = null;
    this.items = null;
  }

  // 远端 container_set 覆盖了正开着的容器：刷新显示（保留光标物品）
  refresh(items) {
    if (!this.visible) return;
    this.items = items;
    this.render();
  }

  returnCursorItem() {
    if (this.cursorItem) {
      this.game.inventory.add(this.cursorItem.name, this.cursorItem.count, this.cursorItem.data);
      this.cursorItem = null;
      this.cursorEl.style.display = 'none';
      this.cursorEl.innerHTML = '';
      this.game.hotbar.update();
    }
  }

  render() {
    if (!this.items) return;
    this.panel.innerHTML = '';
    this.panel.style.width = 'max-content';

    const title = document.createElement('div');
    title.textContent = t('箱子');
    title.style.cssText = 'font-size: 14px; margin-bottom: 8px; color: #333;';
    this.panel.appendChild(title);

    this.panel.appendChild(this.makeGrid(9, 3, 'chest'));
    const main = this.makeGrid(9, 3, 'main');
    main.style.marginTop = '10px';
    this.panel.appendChild(main);
    const hb = this.makeGrid(9, 1, 'hotbar');
    hb.style.marginTop = '8px';
    this.panel.appendChild(hb);

    this.bindSlots();
  }

  makeGrid(cols, rows, prefix) {
    const g = document.createElement('div');
    g.style.cssText = `display: grid; grid-template-columns: repeat(${cols}, 44px); gap: 2px; background: #8b8b8b; padding: 4px;`;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const slot = this.makeSlotEl();
        slot.dataset.slot = `${prefix}-${idx}`;
        g.appendChild(slot);
      }
    }
    return g;
  }

  makeSlotEl() {
    const slot = document.createElement('div');
    slot.style.cssText = `
      width: 44px; height: 44px; background: #8b8b8b; border: 2px solid #555;
      position: relative; display: flex; align-items: center; justify-content: center;
      cursor: pointer; image-rendering: pixelated;
    `;
    return slot;
  }

  fillSlotEl(slot, name, count) {
    slot.innerHTML = '';
    if (!name) return;
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    canvas.style.cssText = 'width: 32px; height: 32px;';
    slot.appendChild(canvas);
    this.drawIcon(canvas, name);
    if (count > 1) {
      const c = document.createElement('div');
      c.textContent = count;
      c.style.cssText = 'position: absolute; right: 2px; bottom: 0; color: #fff; font-size: 14px; font-weight: bold; text-shadow: 1px 1px 0 #000;';
      slot.appendChild(c);
    }
  }

  async drawIcon(canvas, name) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 32, 32);
    let svgText = null;
    const item = ItemRegistry.getByName(name);
    if (item && this.game.itemSvgMap[name]) svgText = this.game.itemSvgMap[name];
    if (!svgText) {
      const block = BlockRegistry.getByName(name);
      if (block) {
        const texName = block.icon || block.side || block.top; // B28 优先定向面（箱子/熔炉图标看得出正面）
        if (this.game.blockSvgMap[texName]) svgText = this.game.blockSvgMap[texName];
      }
    }
    if (svgText) {
      const img = await SVGTextures.svgToImage(svgText);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 32, 32);
    }
  }

  bindSlots() {
    const chestSlots = this.panel.querySelectorAll('[data-slot^="chest-"]');
    chestSlots.forEach((el) => {
      const idx = parseInt(el.dataset.slot.split('-')[1]);
      const stack = this.items[idx];
      this.renderSlotContent(el, stack);
      this.bindSlotEvents(el, 'chest', idx);
      this._bindHover(el, stack ? stack.name : null);
    });
    const mainSlots = this.panel.querySelectorAll('[data-slot^="main-"]');
    mainSlots.forEach((el, i) => {
      const slotIdx = 9 + i;
      const stack = this.game.inventory.slots[slotIdx];
      this.renderSlotContent(el, stack);
      this.bindSlotEvents(el, 'inv', slotIdx);
      this._bindHover(el, stack ? stack.name : null);
    });
    const hbSlots = this.panel.querySelectorAll('[data-slot^="hotbar-"]');
    hbSlots.forEach((el, i) => {
      const stack = this.game.inventory.slots[i];
      this.renderSlotContent(el, stack);
      this.bindSlotEvents(el, 'inv', i);
      this._bindHover(el, stack ? stack.name : null);
    });
  }

  renderSlotContent(el, stack) {
    if (stack) this.fillSlotEl(el, stack.name, stack.count);
    else el.innerHTML = '';
  }

  _stackAt(type, idx) {
    return type === 'chest' ? this.items[idx] : this.game.inventory.slots[idx];
  }
  _setStackAt(type, idx, v) {
    if (type === 'chest') this.items[idx] = v;
    else this.game.inventory.slots[idx] = v;
  }

  _touch() {
    this._changed = true;
    if (this.pos) this.game.onContainerChanged(this.pos, this.items);
  }

  bindSlotEvents(el, type, idx) {
    el.onmousedown = (e) => {
      e.preventDefault();
      if (e.button === 0) this.swapCursorWithSlot(type, idx);
      else if (e.button === 2) this.rightClickSlot(type, idx);
    };
  }

  swapCursorWithSlot(type, idx) {
    const current = this._stackAt(type, idx);
    if (this.cursorItem && current && this.cursorItem.name === current.name) {
      const total = this.cursorItem.count + current.count;
      if (total <= 64) {
        current.count = total;
        this.cursorItem = null;
      } else {
        current.count = 64;
        this.cursorItem.count = total - 64;
      }
    } else {
      this._setStackAt(type, idx, this.cursorItem);
      this.cursorItem = current;
    }
    this.updateCursorEl();
    this.bindSlots();
    if (type === 'inv') this.game.hotbar.update();
    if (type === 'chest') this._touch();
  }

  rightClickSlot(type, idx) {
    const current = this._stackAt(type, idx);
    if (this.cursorItem) {
      if (!current || (current.name === this.cursorItem.name && current.count < 64)) {
        if (!current) {
          this._setStackAt(type, idx, { name: this.cursorItem.name, count: 1, data: this.cursorItem.data });
        } else {
          current.count++;
        }
        this.cursorItem.count--;
        if (this.cursorItem.count <= 0) this.cursorItem = null;
      }
    } else if (current) {
      const half = Math.ceil(current.count / 2);
      this.cursorItem = { name: current.name, count: half, data: current.data };
      current.count -= half;
      if (current.count <= 0) this._setStackAt(type, idx, null);
    }
    this.updateCursorEl();
    this.bindSlots();
    if (type === 'inv') this.game.hotbar.update();
    if (type === 'chest') this._touch();
  }

  updateCursorEl() {
    if (this.cursorItem) {
      this.cursorEl.style.display = 'block';
      this.cursorEl.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      canvas.style.cssText = 'width: 32px; height: 32px;';
      this.cursorEl.appendChild(canvas);
      this.drawIcon(canvas, this.cursorItem.name);
      if (this.cursorItem.count > 1) {
        const c = document.createElement('div');
        c.textContent = this.cursorItem.count;
        c.style.cssText = 'position: absolute; right: 2px; bottom: 0; color: #fff; font-size: 14px; font-weight: bold; text-shadow: 1px 1px 0 #000;';
        this.cursorEl.appendChild(c);
      }
    } else {
      this.cursorEl.style.display = 'none';
      this.cursorEl.innerHTML = '';
    }
  }
}
