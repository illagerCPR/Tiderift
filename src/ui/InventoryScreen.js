// InventoryScreen.js -- 背包界面（E 键打开）
// 支持创造模式物品列表 + 生存模式拖放物品 + 2x2/3x3 合成
import { SVGTextures } from '../render/SVGTextures.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';
import { matchRecipe } from '../core/Crafting.js';
import { CREATIVE_CATEGORIES, CATEGORY_LABEL_KEYS, getItemCategory } from '../core/ItemCategories.js';
import { t } from '../i18n/index.js';
import { getDisplayName } from './itemName.js';

// 盔甲槽空槽底纹（Build 19 K2：原版式四件套轮廓，灰线风）——svgToDataUri 32×32
function armorSlotIcon(kind) {
  const P = {
    helmet: `<path d="M8 14 V10 Q8 6 16 6 Q24 6 24 10 V14 M8 14 H13 V18 H8 M24 14 H19 V18 H24" />`,
    chestplate: `<path d="M10 8 L14 6 H18 L22 8 L24 12 V26 H8 V12 Z M14 6 V10 H18 V6" />`,
    leggings: `<path d="M10 6 H22 L23 14 L22 26 H17 L16 16 L15 26 H10 L9 14 Z" />`,
    boots: `<path d="M10 6 H15 V18 Q15 22 11 22 H15 M17 6 H22 V20 Q22 24 18 24 H14 M10 22 H15 M14 24 H22" />`,
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g fill="none" stroke="#5a5a5a" stroke-width="1.6" stroke-linejoin="round" opacity="0.85">${P[kind]}</g></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// 纹章槽底纹（Build 19 K3：方环+波纹环+三点，与原初纹章同源符号）
function emblemSlotIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#8a7434" stroke-width="1.5" stroke-linejoin="round" opacity="0.9">
      <rect x="8" y="8" width="16" height="16"/>
      <circle cx="16" cy="16" r="4"/>
      <path d="M16 4 V7 M6 16 H3 M26 16 H23"/>
    </g>
    <g fill="#8a7434" opacity="0.9">
      <circle cx="16" cy="16" r="1.6"/>
    </g>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}


export class InventoryScreen {
  constructor(inventory, player, game) {
    this.inventory = inventory;
    this.player = player;
    this.game = game;
    this.visible = false;
    this.creativeScroll = 0;
    this.craftSize = 2; // 2x2 背包合成，3x3 工作台合成
    this.craftGrid = []; // 合成网格物品 {name,count,data} | null
    // Build 10 页签仅用于创造模式（分类 + 生存物品栏）；生存模式保持单页（Build 11：JEI 内嵌已回退）
    this.activeTab = 'inv';
    this.creativeTab = 'building';
    this.creativeSearch = '';
    
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
    
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide();
    });
    
    // 拖拽中的物品（鼠标跟随）
    this.cursorItem = null; // {name, count, data}
    this.cursorEl = document.createElement('div');
    this.cursorEl.style.cssText = `
      position: fixed; width: 44px; height: 44px; pointer-events: none;
      z-index: 100; display: none; image-rendering: pixelated;
    `;
    document.body.appendChild(this.cursorEl);

    // 物品悬浮提示框
    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = `
      position: fixed; padding: 4px 8px; background: rgba(10,10,10,0.92);
      color: #fff; font-family: monospace; font-size: 13px; z-index: 200;
      pointer-events: none; display: none; border: 1px solid rgba(255,255,255,0.3);
      text-shadow: 1px 1px 0 #000; max-width: 220px;
    `;
    document.body.appendChild(this.tooltip);
    
    document.addEventListener('mousemove', (e) => {
      if (this.cursorItem) {
        this.cursorEl.style.left = (e.clientX - 22) + 'px';
        this.cursorEl.style.top = (e.clientY - 22) + 'px';
      }
    });
    
    // 右键拖拽时放置单个
    document.addEventListener('contextmenu', (e) => {
      if (this.visible) e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.visible) { this.tooltip.style.display = 'none'; return; }
      if (this._hoverEl && this._hoverEl.contains(e.target)) {
        this.tooltip.style.left = (e.clientX + 14) + 'px';
        this.tooltip.style.top = (e.clientY + 14) + 'px';
      }
    });
  }

  _bindHover(slot, name) {
    slot.onmouseenter = () => {
      if (!name) { this.tooltip.style.display = 'none'; this._hoverName = null; return; }
      const itemDef = ItemRegistry.getByName(name);
      // 物品 lore 优先；方块（BlockDefs 注册，不在 ItemRegistry）回落方块 lore（世界观批次 N1）
      const def = itemDef || BlockRegistry.getByName(name);
      const lore = def && def.lore;
      if (lore && lore.length) {
        // 物品/方块 lore（天域批次 A / 世界观批次 N1）：名称 + 灰蓝斜体残文行（语言包键，缺项回落简体）
        const rows = lore.map((l) => `<div style="color:#9fb3c8; font-style:italic; margin-top:2px;">${t(l)}</div>`).join('');
        this.tooltip.innerHTML = `<div>${getDisplayName(name)}</div>${rows}`;
      } else {
        this.tooltip.textContent = getDisplayName(name);
      }
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

  show(craftSize = 2) {
    this.visible = true;
    this.craftSize = craftSize;
    this.craftGrid = new Array(craftSize * craftSize).fill(null);
    this.activeTab = 'inv';
    this.el.style.display = 'flex';
    this.render();
    if (this.game && this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide() {
    this.returnCraftGrid();
    this.returnCursorItem();
    this.visible = false;
    this.el.style.display = 'none';
    this._hoverName = null;
    if (this.game && this.game.controls) {
      this.game.controls.enabled = true;
    }
  }

  toggle(craftSize = 2) {
    if (this.visible) this.hide();
    else this.show(craftSize);
  }

  returnCraftGrid() {
    if (!this.craftGrid) return;
    for (let i = 0; i < this.craftGrid.length; i++) {
      if (this.craftGrid[i]) {
        this.inventory.add(this.craftGrid[i].name, this.craftGrid[i].count, this.craftGrid[i].data);
        this.craftGrid[i] = null;
      }
    }
    this.game.hotbar.update();
  }

  returnCursorItem() {
    if (this.cursorItem) {
      this.inventory.add(this.cursorItem.name, this.cursorItem.count, this.cursorItem.data);
      this.cursorItem = null;
      this.cursorEl.style.display = 'none';
      this.cursorEl.innerHTML = '';
      this.game.hotbar.update();
    }
    this.tooltip.style.display = 'none';
    this._hoverEl = null;
  }

  render() {
    if (this.player.creative) {
      this.renderCreative();
    } else {
      this.renderSurvival();
    }
  }

  renderSurvival() {
    this.panel.innerHTML = '';
    this.panel.style.width = 'max-content';
    this._renderSurvivalContent(true);
  }

  // 生存布局内容（生存模式单页 + 创造「生存物品栏」页签共用）；withTitle 控制标题行
  _renderSurvivalContent(withTitle) {
    if (withTitle) {
      const title = document.createElement('div');
      title.textContent = this.craftSize === 3 ? t('工作台') : t('背包');
      title.style.cssText = 'font-size: 14px; margin-bottom: 8px; color: #333;';
      this.panel.appendChild(title);
    }
    
    // 合成区
    const craftArea = document.createElement('div');
    craftArea.style.cssText = 'display: flex; gap: 16px; margin-bottom: 12px; align-items: center;';
    
    const gridCols = this.craftSize;
    const gridRows = this.craftSize;
    const grid = this.makeGrid(gridCols, gridRows, 'craft');
    craftArea.appendChild(grid);
    
    const arrow = document.createElement('div');
    arrow.textContent = '->';
    arrow.style.cssText = 'font-size: 20px; color: #555;';
    craftArea.appendChild(arrow);
    
    const out = document.createElement('div');
    out.dataset.slot = 'craft-output';
    out.style.cssText = `
      width: 44px; height: 44px; background: #8b8b8b; border: 2px solid #555;
      position: relative; display: flex; align-items: center; justify-content: center;
      cursor: pointer; image-rendering: pixelated;
    `;
    craftArea.appendChild(out);

    // 顶部行：合成区 + 盔甲槽（2×2：头/胸/腿/靴——Build 19 K2 补原版式空槽底纹）
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display: flex; gap: 20px; align-items: flex-start;';
    topRow.appendChild(craftArea);
    const armorArea = document.createElement('div');
    const armorLabel = document.createElement('div');
    armorLabel.textContent = t('盔甲');
    armorLabel.style.cssText = 'font-size: 12px; margin-bottom: 4px; color: #555;';
    armorArea.appendChild(armorLabel);
    const armorGrid = this.makeGrid(2, 2, 'armor');
    const ARMOR_ICONS = [armorSlotIcon('helmet'), armorSlotIcon('chestplate'), armorSlotIcon('leggings'), armorSlotIcon('boots')];
    armorGrid.querySelectorAll('[data-slot^="armor-"]').forEach((el, i) => {
      el.style.background = `#8b8b8b url(${ARMOR_ICONS[i]}) center / 32px 32px no-repeat`;
    });
    armorArea.appendChild(armorGrid);
    topRow.appendChild(armorArea);

    // 终局成就纹章槽（Build 19 K3）：仅通关存档显示，点击佩戴/取下——
    // 佩戴效果：无敌 + 创造式飞行（双击空格）+ 基岩心形（Hud 按 emblemWorn 渲染）
    if (this.game && this.game.world && this.game.world.finaleDone) {
      const emblemArea = document.createElement('div');
      const emblemLabel = document.createElement('div');
      emblemLabel.textContent = t('纹章');
      emblemLabel.style.cssText = 'font-size: 12px; margin-bottom: 4px; color:#c8a848;';
      emblemArea.appendChild(emblemLabel);
      const worn = !!this.player.emblemWorn;
      const emblemSlot = document.createElement('div');
      emblemSlot.style.cssText = `
        width: 44px; height: 44px; background: #8b8b8b; position: relative;
        border: 2px solid ${worn ? '#ffd98a' : '#555'}; box-shadow: ${worn ? '0 0 8px rgba(255,217,138,0.5)' : 'none'};
        display: flex; align-items: center; justify-content: center; cursor: pointer; image-rendering: pixelated;
      `;
      if (!worn) emblemSlot.style.background += `, url(${emblemSlotIcon()}) center / 32px 32px no-repeat`;
      if (worn && ItemSVGDefinitions.primordial_emblem) {
        const cv = document.createElement('canvas');
        cv.width = 32; cv.height = 32;
        cv.style.cssText = 'width: 32px; height: 32px;';
        SVGTextures.svgToImage(ItemSVGDefinitions.primordial_emblem).then((img) => {
          cv.getContext('2d').drawImage(img, 0, 0, 32, 32);
        });
        emblemSlot.appendChild(cv);
      }
      emblemSlot.title = worn ? t('点击取下纹章') : t('点击佩戴纹章（无敌 · 飞行 · 基岩之心）');
      emblemSlot.addEventListener('click', () => {
        if (!this.player.emblemWorn) {
          const has = this.inventory.slots.some((s) => s && s.name === 'primordial_emblem');
          if (!has) return; // 背包里没有纹章不能凭空佩戴
          this.player.emblemWorn = true;
        } else {
          this.player.emblemWorn = false;
          this.player.flying = false; // 取下即落地（防悬空）
        }
        this.render();
      });
      emblemArea.appendChild(emblemSlot);
      topRow.appendChild(emblemArea);
    }
    this.panel.appendChild(topRow);
    
    // 主背包 27 格（索引 9~35）
    const main = this.makeGrid(9, 3, 'main');
    this.panel.appendChild(main);
    
    // 快捷栏（索引 0~8）
    const hb = this.makeGrid(9, 1, 'hotbar');
    hb.style.marginTop = '8px';
    this.panel.appendChild(hb);
    
    this.bindSlots();
    this.updateCraftOutput();
  }

  // 页签行构建（Build 10/11）：onClickExtra 在切换后回调
  makeTabBar(tabs, onClickExtra) {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex; gap:4px; margin-bottom:8px; align-items:center;';
    for (const [id, label] of tabs) {
      const b = document.createElement('button');
      b.textContent = label;
      const active = this.activeTab === id;
      b.style.cssText = `padding:6px 14px; font-size:12px; cursor:pointer; border:2px solid #555; font-family:inherit;` +
        (active
          ? 'background:#e8e8e8; color:#222; font-weight:bold;'
          : 'background:#9a9a9a; color:#333;');
      b.addEventListener('click', () => {
        this.activeTab = id;
        if (onClickExtra) onClickExtra();
        this.render();
      });
      bar.appendChild(b);
    }
    return bar;
  }

  renderCreative() {
    this.panel.innerHTML = '';
    this.panel.style.width = 'max-content';

    // 页签行（Build 11）：8 分类 + 「生存物品栏」（原版式末位页签）
    const tabs = [...CREATIVE_CATEGORIES.map(id => [id, t(CATEGORY_LABEL_KEYS[id])]), ['survival', t('生存物品栏')]];
    this.activeTab = this.creativeTab;
    const tabBar = this.makeTabBar(tabs, () => { this.creativeTab = this.activeTab; });
    this.panel.appendChild(tabBar);

    if (this.creativeTab === 'survival') {
      // 生存物品栏页签：与生存模式背包同布局（盔甲 + 合成 2×2 + 背包 + 快捷栏），可正常穿戴/合成
      this.craftSize = 2;
      this._renderSurvivalContent(false);
      return;
    }

    // 搜索行：搜索框 + 摧毁槽（原版式右端）
    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'display:flex; gap:8px; margin-bottom:8px; align-items:center;';
    const search = document.createElement('input');
    search.type = 'text';
    search.value = this.creativeSearch;
    search.placeholder = t('搜索物品…');
    search.style.cssText = 'flex:1; padding:6px 10px; background:#8b8b8b; border:2px solid #555; color:#fff; font-size:13px; font-family:inherit;';
    search.addEventListener('input', () => {
      this.creativeSearch = search.value;
      this._renderCreativeGrid(); // 只重绘网格，保持输入框焦点
    });
    searchRow.appendChild(search);
    const destroy = this.makeSlotEl();
    destroy.style.cssText += ' background:#a05050; justify-content:center; font-size:20px; color:#fff;';
    destroy.textContent = '✗';
    destroy.title = t('摧毁物品');
    destroy.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (this.cursorItem) {
        this.cursorItem = null; // 拖入光标物品直接销毁
        this.cursorEl.style.display = 'none';
        this.cursorEl.innerHTML = '';
      }
    });
    searchRow.appendChild(destroy);
    this.panel.appendChild(searchRow);

    // 物品格网（按当前分类或搜索结果）
    this._creativeGridEl = document.createElement('div');
    this._creativeGridEl.style.cssText = 'display: grid; grid-template-columns: repeat(9, 44px); gap: 2px; max-height: 320px; overflow-y: auto; background: #8b8b8b; padding: 4px;';
    this.panel.appendChild(this._creativeGridEl);
    this._renderCreativeGrid();

    // 快捷栏
    const hb = this.makeGrid(9, 1, 'hotbar');
    hb.style.marginTop = '8px';
    this.panel.appendChild(hb);
    this.bindSlots();
    setTimeout(() => search.focus(), 0); // 打开即聚焦搜索（不影响游戏快捷键：界面内 controls 已禁用）
  }

  // 创造网格内容（搜索优先：非空时跨全部分类过滤）
  _renderCreativeGrid() {
    const grid = this._creativeGridEl;
    if (!grid) return;
    grid.innerHTML = '';
    // 方块优先；同名物品（lever/stone_button 在 Block/Item 双侧都注册）跳过避免重复
    const blocks = BlockRegistry.all().filter(b => b.name !== 'air');
    const seen = new Set(blocks.map(b => b.name));
    const items = ItemRegistry.all().filter(b => b.name !== 'air' && !seen.has(b.name));
    const allItems = [...blocks, ...items];
    const q = this.creativeSearch.trim().toLowerCase();
    const list = q
      ? allItems.filter(it => getDisplayName(it.name).toLowerCase().includes(q) || it.name.includes(q))
      : allItems.filter(it => getItemCategory(it.name) === this.creativeTab);
    for (const item of list) {
      const slot = this.makeSlotEl();
      this.fillSlotEl(slot, item.name, 64);
      slot.addEventListener('click', () => {
        // 原版式取物：左键 = 光标拿取一整组（光标已有同类则补满到一组，异类直接替换）；放置仍点击普通槽位
        this.setCursorItem(item.name, 64);
      });
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // 右键拿一个到光标
        this.setCursorItem(item.name, 1);
      });
      this._bindHover(slot, item.name);
      grid.appendChild(slot);
    }
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '…';
      empty.style.cssText = 'grid-column: 1 / -1; text-align: center; color: #ddd; padding: 16px 0;';
      grid.appendChild(empty);
    }
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

  // 填充 slot 元素的内容（图标+数量）
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

  // 绑定所有 slot 的事件和显示
  bindSlots() {
    // 合成网格
    const craftSlots = this.panel.querySelectorAll('[data-slot^="craft-"]');
    craftSlots.forEach((el, i) => {
      const idx = parseInt(el.dataset.slot.split('-')[1]);
      this.renderSlotContent(el, this.craftGrid[idx]);
      this.bindSlotEvents(el, 'craft', idx);
      this._bindHover(el, this.craftGrid[idx] ? this.craftGrid[idx].name : null);
    });

    // 合成输出槽
    const outEl = this.panel.querySelector('[data-slot="craft-output"]');
    if (outEl) {
      this.bindOutputSlot(outEl);
      const result = this.getCurrentRecipeMatch();
      this._bindHover(outEl, result ? result.name : null);
    }

    // 主背包 slots 9~35
    const mainSlots = this.panel.querySelectorAll('[data-slot^="main-"]');
    mainSlots.forEach((el, i) => {
      const slotIdx = 9 + i;
      this.renderSlotContent(el, this.inventory.slots[slotIdx]);
      this.bindSlotEvents(el, 'inv', slotIdx);
      this._bindHover(el, this.inventory.slots[slotIdx] ? this.inventory.slots[slotIdx].name : null);
    });

    // 快捷栏 slots 0~8
    const hbSlots = this.panel.querySelectorAll('[data-slot^="hotbar-"]');
    hbSlots.forEach((el, i) => {
      this.renderSlotContent(el, this.inventory.slots[i]);
      this.bindSlotEvents(el, 'inv', i);
      this._bindHover(el, this.inventory.slots[i] ? this.inventory.slots[i].name : null);
    });

    // 盔甲槽 armor 0~3（头/胸/腿/靴）
    const armorSlots = this.panel.querySelectorAll('[data-slot^="armor-"]');
    armorSlots.forEach((el) => {
      const idx = parseInt(el.dataset.slot.split('-')[1], 10);
      this.renderSlotContent(el, this.inventory.armor[idx]);
      this.bindArmorSlotEvents(el, idx);
      this._bindHover(el, this.inventory.armor[idx] ? this.inventory.armor[idx].name : null);
    });
  }

  // 盔甲槽：左键=光标对应部位盔甲穿上（旧甲回光标）/ 光标空时脱下；
  // 不匹配部位或普通物品放入被拒绝（原版式）
  bindArmorSlotEvents(el, idx) {
    const SLOT_ORDER = ['head', 'chest', 'legs', 'feet'];
    el.onmousedown = (e) => {
      e.preventDefault();
      if (e.button !== 0) return;
      const cur = this.cursorItem;
      const curDef = cur ? ItemRegistry.getByName(cur.name) : null;
      const worn = this.inventory.armor[idx];
      if (cur && curDef && curDef.armorSlot === SLOT_ORDER[idx]) {
        this.inventory.armor[idx] = { name: cur.name, count: 1, data: cur.data || null };
        this.cursorItem = worn || null;
      } else if (!cur && worn) {
        this.cursorItem = worn;
        this.inventory.armor[idx] = null;
      } else {
        return; // 不匹配/光标非盔甲：静默拒绝
      }
      this.updateCursorEl();
      this.bindSlots();
    };
  }

  renderSlotContent(el, stack) {
    // 内容签名：未变化的槽位跳过重建（移动物品时 bindSlots 会全量刷新，
    // 重建 canvas + 异步图标绘制的空窗期就是"物品栏内拖动物品闪烁"的来源）
    const sig = stack ? `${stack.name}|${stack.count}` : '';
    if (el._sig === sig) return;
    el._sig = sig;
    if (stack) {
      this.fillSlotEl(el, stack.name, stack.count);
    } else {
      el.innerHTML = '';
    }
  }

  // 绑定普通槽位事件（背包或合成网格）
  bindSlotEvents(el, type, idx) {
    el.onmousedown = (e) => {
      e.preventDefault();
      if (e.button === 0) {
        // 左键：交换光标物品和槽位物品
        this.swapCursorWithSlot(type, idx);
      } else if (e.button === 2) {
        // 右键：放置/取出单个
        this.rightClickSlot(type, idx);
      }
    };
  }

  swapCursorWithSlot(type, idx) {
    let currentStack;
    if (type === 'craft') {
      currentStack = this.craftGrid[idx];
    } else {
      currentStack = this.inventory.slots[idx];
    }
    
    if (this.cursorItem && currentStack && this.cursorItem.name === currentStack.name) {
      // 同类物品：合并
      const total = this.cursorItem.count + currentStack.count;
      if (total <= 64) {
        currentStack.count = total;
        this.cursorItem = null;
      } else {
        currentStack.count = 64;
        this.cursorItem.count = total - 64;
      }
    } else {
      // 交换
      if (type === 'craft') {
        this.craftGrid[idx] = this.cursorItem;
      } else {
        this.inventory.slots[idx] = this.cursorItem;
      }
      this.cursorItem = currentStack;
    }
    
    this.updateCursorEl();
    this.bindSlots();
    if (type === 'inv') this.game.hotbar.update();
    this.updateCraftOutput();
  }

  rightClickSlot(type, idx) {
    let currentStack;
    if (type === 'craft') {
      currentStack = this.craftGrid[idx];
    } else {
      currentStack = this.inventory.slots[idx];
    }
    
    if (this.cursorItem) {
      // 光标有物品：放置一个
      if (!currentStack || (currentStack.name === this.cursorItem.name && currentStack.count < 64)) {
        if (!currentStack) {
          if (type === 'craft') {
            this.craftGrid[idx] = { name: this.cursorItem.name, count: 1, data: this.cursorItem.data };
          } else {
            this.inventory.slots[idx] = { name: this.cursorItem.name, count: 1, data: this.cursorItem.data };
          }
        } else {
          currentStack.count++;
        }
        this.cursorItem.count--;
        if (this.cursorItem.count <= 0) this.cursorItem = null;
      }
    } else if (currentStack) {
      // 光标空：拿起一半
      const half = Math.ceil(currentStack.count / 2);
      this.cursorItem = { name: currentStack.name, count: half, data: currentStack.data };
      currentStack.count -= half;
      if (currentStack.count <= 0) {
        if (type === 'craft') {
          this.craftGrid[idx] = null;
        } else {
          this.inventory.slots[idx] = null;
        }
      }
    }
    
    this.updateCursorEl();
    this.bindSlots();
    if (type === 'inv') this.game.hotbar.update();
    this.updateCraftOutput();
  }

  // 绑定合成输出槽
  bindOutputSlot(el) {
    el.onmousedown = (e) => {
      e.preventDefault();
      if (e.button !== 0) return;
      
      const result = this.getCurrentRecipeMatch();
      if (!result) return;
      
      // 如果光标有物品，必须与输出同类且能堆叠
      if (this.cursorItem) {
        if (this.cursorItem.name !== result.name) return;
        if (this.cursorItem.count + result.count > 64) return;
        this.cursorItem.count += result.count;
      } else {
        this.setCursorItem(result.name, result.count);
      }
      
      // 消耗合成网格中每个槽位一个物品
      for (let i = 0; i < this.craftGrid.length; i++) {
        if (this.craftGrid[i]) {
          this.craftGrid[i].count--;
          if (this.craftGrid[i].count <= 0) this.craftGrid[i] = null;
        }
      }
      
      this.updateCursorEl();
      this.bindSlots();
      this.updateCraftOutput();
    };
  }

  // 获取当前合成网格匹配的配方
  getCurrentRecipeMatch() {
    // 构建二维网格
    const size = this.craftSize;
    const grid2d = [];
    for (let r = 0; r < size; r++) {
      const row = [];
      for (let c = 0; c < size; c++) {
        const stack = this.craftGrid[r * size + c];
        row.push(stack ? stack.name : null);
      }
      grid2d.push(row);
    }
    return matchRecipe(grid2d);
  }

  // 更新合成输出槽显示
  updateCraftOutput() {
    const outEl = this.panel.querySelector('[data-slot="craft-output"]');
    if (!outEl) return;
    this.renderSlotContent(outEl, this.getCurrentRecipeMatch());
  }

  // 设置光标物品
  setCursorItem(name, count, data = null) {
    this.cursorItem = { name, count, data };
    this.updateCursorEl();
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
