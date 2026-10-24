// FurnaceScreen.js -- 熔炉界面（右键熔炉打开）
// 输入槽 + 燃料槽 + 输出槽（只取不放）+ 火焰/箭头进度指示；下方玩家背包/快捷栏。
// 熔炉状态来自 World.furnaces（惰性创建，直接改引用，存档序列化持久化）。
// 烧炼推进由 Game.updateFurnaces 每帧驱动（界面开关都不影响）；本类 tick() 只负责刷新显示。
import { SMELT_TIME, getSmeltingResult, getFuelTime } from '../core/Smelting.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { drawIconInto } from '../render/BlockIcon.js';
import { t } from '../i18n/index.js';
import { getDisplayName } from './itemName.js';
import { CursorOverlay } from './CursorOverlay.js';

export class FurnaceScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.pos = null;    // 熔炉方块坐标 {x,y,z}
    this.st = null;     // World.furnaces 中的状态引用 {input,fuel,output,burnTime,burnMax,cookTime}

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
    // 光标层（手持物品图标 + 悬浮提示 + document 级监听）统一由组合件承担
    this._disposed = false;
    this.cursor = new CursorOverlay({
      isVisible: () => this.visible,
      getCursorItem: () => this.cursorItem,
      drawIcon: (canvas, name) => this.drawIcon(canvas, name),
      blockContextMenu: true,
      onHover: (name) => { this._hoverName = name; }, // R/U 配方查询目标
    });
  }

  // 释放：光标层（组合件内的监听器与节点）与面板节点一并摘除（幂等）
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.cursor.dispose();
    this.el.remove();
  }

  show(x, y, z) {
    if (!this.game.world) return;
    this.pos = { x, y, z };
    this.st = this.game.world.getOrOpenFurnace(x, y, z);
    this._changed = false;
    this._lastFlushAt = 0;
    this.visible = true;
    this.el.style.display = 'flex';
    this.render();
    // B36 F-2：联机时进度与内容归服务器——打开即拉一次权威状态（单机直接读 World）
    if (this.game.networkMode && this.game.net) this.game.net.sendFurnaceOpen(x, y, z);
    if (this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide() {
    this.returnCursorItem();
    this.flushChanges(true);
    this.visible = false;
    this.el.style.display = 'none';
    this.cursor.clearHover();
    if (this.game.controls) this.game.controls.enabled = true;
    this.pos = null;
    this.st = null;
  }

  returnCursorItem() {
    if (this.cursorItem) {
      this.game.inventory.add(this.cursorItem.name, this.cursorItem.count, this.cursorItem.data);
      this.cursorItem = null;
      this.cursor.setItem(null);
      this.game.hotbar.update();
    }
  }

  render() {
    if (!this.st) return;
    this.panel.innerHTML = '';
    this.panel.style.width = 'max-content';
    this._lastFlame = -1;
    this._lastArrow = -1;
    this._slotSigs = {};

    const title = document.createElement('div');
    title.textContent = t('熔炉');
    title.style.cssText = 'font-size: 14px; margin-bottom: 8px; color: #333;';
    this.panel.appendChild(title);

    // 熔炉工作区：左列（输入/火焰/燃料）→ 箭头 → 输出
    const work = document.createElement('div');
    work.style.cssText = 'display: flex; align-items: center; gap: 14px; margin-bottom: 12px;';

    const leftCol = document.createElement('div');
    leftCol.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 2px;';
    leftCol.appendChild(this.makeSlotEl('fin'));
    // 火焰指示（燃料燃烧进度，自下而上）
    this.flameWrap = document.createElement('div');
    this.flameWrap.style.cssText = 'width: 22px; height: 22px; position: relative; background: rgba(0,0,0,0.25); border-radius: 2px;';
    this.flameFill = document.createElement('div');
    this.flameFill.style.cssText = `
      position: absolute; left: 0; bottom: 0; width: 100%; height: 0%;
      background: linear-gradient(to top, #ff8000, #ffd040 70%, #fff0a0);
      border-radius: 2px;
    `;
    this.flameWrap.appendChild(this.flameFill);
    leftCol.appendChild(this.flameWrap);
    leftCol.appendChild(this.makeSlotEl('ffuel'));
    work.appendChild(leftCol);

    // 烧炼箭头（cookTime 进度）
    this.arrowWrap = document.createElement('div');
    this.arrowWrap.style.cssText = 'width: 60px; height: 12px; background: #8b8b8b; border: 1px solid #555; position: relative;';
    this.arrowFill = document.createElement('div');
    this.arrowFill.style.cssText = 'position: absolute; left: 0; top: 0; height: 100%; width: 0%; background: #fff;';
    this.arrowWrap.appendChild(this.arrowFill);
    work.appendChild(this.arrowWrap);

    work.appendChild(this.makeSlotEl('fout'));
    this.panel.appendChild(work);

    // 玩家背包 27 格（索引 9~35）+ 快捷栏（索引 0~8）
    const main = this.makeGrid(9, 3, 'main');
    this.panel.appendChild(main);
    const hb = this.makeGrid(9, 1, 'hotbar');
    hb.style.marginTop = '8px';
    this.panel.appendChild(hb);

    this.bindSlots();
  }

  setCursorItem(name, count, data = null) {
    this.cursorItem = { name, count, data };
    this.updateCursorEl();
  }

  makeSlotEl(key) {
    const slot = document.createElement('div');
    slot.dataset.slot = key;
    slot.style.cssText = `
      width: 44px; height: 44px; background: #8b8b8b; border: 2px solid #555;
      position: relative; display: flex; align-items: center; justify-content: center;
      cursor: pointer; image-rendering: pixelated;
    `;
    return slot;
  }

  makeGrid(cols, rows, prefix) {
    const g = document.createElement('div');
    g.style.cssText = `display: grid; grid-template-columns: repeat(${cols}, 44px); gap: 2px; background: #8b8b8b; padding: 4px;`;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const slot = this.makeSlotEl(`${prefix}-${idx}`);
        g.appendChild(slot);
      }
    }
    return g;
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
    // B29 统一走 BlockIcon：物品 SVG 平铺 / 立方方块等轴三面 / 其余方块单面平铺
    await drawIconInto(canvas.getContext('2d'), 32, name, (n) => {
      const item = ItemRegistry.getByName(n);
      return item && this.game.itemSvgMap[n] ? this.game.itemSvgMap[n] : null;
    });
  }

  bindSlots() {
    // 熔炉三槽
    const fin = this.panel.querySelector('[data-slot="fin"]');
    const ffuel = this.panel.querySelector('[data-slot="ffuel"]');
    const fout = this.panel.querySelector('[data-slot="fout"]');
    this._renderFurnaceSlot(fin, this.st.input);
    this._renderFurnaceSlot(ffuel, this.st.fuel);
    this._renderFurnaceSlot(fout, this.st.output);
    this.bindSlotEvents(fin, 'input');
    this.bindSlotEvents(ffuel, 'fuel');
    this._bindOutputSlot(fout);

    // 玩家背包 + 快捷栏
    this.panel.querySelectorAll('[data-slot^="main-"]').forEach((el, i) => {
      const slotIdx = 9 + i;
      this._renderInvSlot(el, this.game.inventory.slots[slotIdx]);
      this.bindSlotEvents(el, 'inv', slotIdx);
      this.cursor.bindHover(el, this.game.inventory.slots[slotIdx] ? this.game.inventory.slots[slotIdx].name : null);
    });
    this.panel.querySelectorAll('[data-slot^="hotbar-"]').forEach((el, i) => {
      this._renderInvSlot(el, this.game.inventory.slots[i]);
      this.bindSlotEvents(el, 'inv', i);
      this.cursor.bindHover(el, this.game.inventory.slots[i] ? this.game.inventory.slots[i].name : null);
    });
  }

  _renderFurnaceSlot(el, stack) {
    const sig = stack ? `${stack.name}|${stack.count}` : '';
    if (this._slotSigs && this._slotSigs[el.dataset.slot] === sig) return;
    this._slotSigs[el.dataset.slot] = sig;
    if (stack) this.fillSlotEl(el, stack.name, stack.count);
    else el.innerHTML = '';
    this.cursor.bindHover(el, stack ? stack.name : null);
  }

  _renderInvSlot(el, stack) {
    const sig = stack ? `${stack.name}|${stack.count}` : '';
    if (el._sig === sig) return;
    el._sig = sig;
    if (stack) this.fillSlotEl(el, stack.name, stack.count);
    else el.innerHTML = '';
  }

  bindSlotEvents(el, type, idx) {
    el.onmousedown = (e) => {
      e.preventDefault();
      if (e.button === 0) this.swapCursorWithSlot(type, idx);
      else if (e.button === 2) this.rightClickSlot(type, idx);
    };
  }

  _stackAt(type, idx) {
    if (type === 'inv') return this.game.inventory.slots[idx];
    return type === 'fuel' ? this.st.fuel : this.st.input;
  }

  _setStackAt(type, idx, v) {
    if (type === 'inv') this.game.inventory.slots[idx] = v;
    else if (type === 'fuel') this.st.fuel = v;
    else this.st.input = v;
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
    else this._changed = true;
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
    else this._changed = true;
  }

  // B36 F-2：把本地改动推给服务器（联机）；节流 150ms，避免拖拽时每帧一条。
  // 单机调用无害（onFurnaceChanged 内部 noop），状态本来就是同一份。
  flushChanges(force = false) {
    if (!this._changed || !this.pos || !this.st) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!force && now - this._lastFlushAt < 150) return;
    this._lastFlushAt = now;
    this._changed = false;
    this.game.onFurnaceChanged(this.pos, this.st);
  }

  // 输出槽：只取不放（左键取全部合并进光标，右键取一个）
  _bindOutputSlot(el) {
    el.onmousedown = (e) => {
      e.preventDefault();
      if (e.button !== 0 && e.button !== 2) return;
      const out = this.st.output;
      if (!out) return;
      const take = e.button === 0 ? out.count : 1;
      if (this.cursorItem) {
        if (this.cursorItem.name !== out.name || this.cursorItem.count + take > 64) return;
        this.cursorItem.count += take;
      } else {
        this.cursorItem = { name: out.name, count: take, data: null };
      }
      out.count -= take;
      if (out.count <= 0) this.st.output = null;
      this._changed = true;
      this.updateCursorEl();
      this.bindSlots();
    };
  }

  updateCursorEl() {
    this.cursor.setItem(this.cursorItem);
  }

  // 每帧刷新（Game.update 在界面可见时调用）：进度条 + 槽位内容
  tick() {
    if (!this.visible || !this.st) return;
    this.flushChanges();
    const flame = this.st.burnMax > 0 ? Math.max(0, Math.min(1, this.st.burnTime / this.st.burnMax)) : 0;
    const arrow = Math.max(0, Math.min(1, this.st.cookTime / SMELT_TIME));
    const fp = Math.round(flame * 100);
    const ap = Math.round(arrow * 100);
    if (fp !== this._lastFlame) {
      this._lastFlame = fp;
      this.flameFill.style.height = fp + '%';
    }
    if (ap !== this._lastArrow) {
      this._lastArrow = ap;
      this.arrowFill.style.width = ap + '%';
    }
    // 燃料提示（悬浮燃料槽显示剩余燃烧秒数）
    const fin = this.panel.querySelector('[data-slot="fin"]');
    const ffuel = this.panel.querySelector('[data-slot="ffuel"]');
    const fout = this.panel.querySelector('[data-slot="fout"]');
    this._renderFurnaceSlot(fin, this.st.input);
    this._renderFurnaceSlot(ffuel, this.st.fuel);
    this._renderFurnaceSlot(fout, this.st.output);
    if (ffuel) {
      const ft = getFuelTime(this.st.fuel ? this.st.fuel.name : null);
      ffuel.title = ft > 0 ? t('燃料：可烧 {n} 个物品', { n: Math.floor(ft / SMELT_TIME) }) : '';
    }
    if (fin) {
      const r = getSmeltingResult(this.st.input ? this.st.input.name : null);
      fin.title = r ? `烧炼：${getDisplayName(r.output)}` : '';
    }
  }
}
