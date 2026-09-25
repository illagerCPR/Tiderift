// RecipeViewer.js -- JEI 风格配方查询伴随面板（容器界面打开时围绕"物品栏"显示）
// 收藏夹面板（加宽）贴物品栏左侧 + 全物品列表（加宽，含搜索）贴物品栏右侧
// + 配方详情弹窗覆盖物品栏之上：合成（shaped/shapeless）与熔炼（Smelting）配方。
// R 查配方 / U 查用途 / A 收藏 / J 开关面板（无容器界面时按 J 打开背包）。
// 纯查询界面：不改背包、不产生物品；配方内材料图标可点击继续导航；
// 不接管 controls（随容器界面显隐，容器界面自身已处理指针与按键）。
import { getAllRecipes } from '../core/Crafting.js';
import { getAllSmeltingRecipes, getFuelTime, SMELT_TIME } from '../core/Smelting.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { SVGTextures } from '../render/SVGTextures.js';
import { t, onLocaleChange } from '../i18n/index.js';
import { getDisplayName } from './itemName.js';

const FAV_KEY = 'cubeworld-jei-favorites';
const PANEL_KEY = 'cubeworld-jei-panel-enabled';

const CELL = 40;         // 物品格边长（px）
const STEP = 42;         // 格步进（含 2px 间距）
const FAV_MAX_COLS = 3;  // 收藏夹最大列数（空间充足时加宽）
const FAV_MIN_COLS = 1;
const LIST_MAX_COLS = 9; // 全物品最大列数
const LIST_MIN_COLS = 3;
const PANEL_GAP = 10;    // 面板与物品栏 / 屏幕边缘的间距
const FAV_DEFAULT_COLS = 2;
const LIST_DEFAULT_COLS = 9;

export class RecipeViewer {
  constructor(game) {
    this.game = game;
    this.visible = false;          // 面板当前是否显示（容器界面打开 且 用户未用 J 关闭）
    this.containerVisible = false; // 是否有容器界面打开（每帧从各 screen 同步）
    this.userEnabled = this._loadEnabled(); // J 键开关的面板偏好（全局持久）
    this.mode = 'recipes';    // recipes=查看该物品配方 | usages=查看该物品作为材料的配方
    this.current = null;      // 当前查看的物品名（非空时显示配方弹窗）
    this._hoverName = null;   // 面板内悬浮的物品名（R/U/A 作用目标）
    this._shown = false;      // DOM 显示状态（防每帧重渲染）
    this._searchText = '';
    this.favorites = this._loadFavorites();
    this._layoutKey = null;   // 布局 dirty-check（panel rect + 视口 + 弹窗开关）
    this._favCols = FAV_DEFAULT_COLS;
    this._listCols = LIST_DEFAULT_COLS;

    // 收藏夹面板：贴物品栏左侧（加宽为多列格子）
    this.favEl = this._makePanel(35);
    // 全物品列表：贴物品栏右侧（加宽为多列格子，顶部搜索框）
    this.listEl = this._makePanel(35);
    // 配方详情弹窗：覆盖物品栏之上（z-index 高于容器 UI 的 30）
    this.popEl = this._makePanel(36);
    this._buildShell();
    // 语言切换（Build 5 i18n）：骨架文本是构造期一次性写入，切语言需刷新固定文本 +
    // 重绘动态区（列表格/弹窗内容本身每次操作重绘会跟随语言，无需单独处理）
    this._unbindLocale = onLocaleChange(() => this._applyLang());
  }

  // 骨架固定文本刷新（构造后切语言）
  _applyLang() {
    this.favHead.textContent = t('★ 收藏');
    this.favHead.title = t('收藏夹（对物品按 A 收藏/取消）');
    this.searchInput.placeholder = t('搜索物品…');
    this.listHead.textContent = t('全部物品');
    this.listHead.title = t('点击看配方 / 右键看用途 / A 收藏');
    this.popClose.title = t('关闭配方详情');
    if (this._shown) {
      this.renderList();
      this.renderRecipe();
    }
  }

  // 统一风格的 fixed 面板骨架（默认隐藏，位置由 _layout() 动态维护）
  _makePanel(z) {
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed; display: none; flex-direction: column;
      background: #c6c6c6; border: 3px solid #555; box-shadow: 0 0 0 2px #000;
      padding: 6px; box-sizing: border-box; z-index: ${z};
      font-family: 'Segoe UI', sans-serif; user-select: none;
    `;
    document.body.appendChild(el);
    return el;
  }

  // 面板内容骨架：常驻构建一次，搜索词天然保留
  _buildShell() {
    // ── 收藏夹 ──
    const favHead = document.createElement('div');
    this.favHead = favHead; // _applyLang 切语言刷新用
    favHead.textContent = t('★ 收藏');
    favHead.title = t('收藏夹（对物品按 A 收藏/取消）');
    favHead.style.cssText = 'font-size: 12px; font-weight: bold; color: #333; margin-bottom: 4px; flex: none; text-align: center;';
    this.favEl.appendChild(favHead);
    this.favGrid = document.createElement('div');
    this.favGrid.style.cssText = 'display: grid; gap: 2px; align-content: start; overflow-y: auto; flex: 1; min-height: 0; justify-content: center;';
    this.favEl.appendChild(this.favGrid);

    // ── 全物品 ──
    this.searchInput = document.createElement('input');
    this.searchInput.placeholder = t('搜索物品…');
    this.searchInput.value = this._searchText;
    this.searchInput.style.cssText = `
      padding: 4px 8px; border: 2px solid #555; background: #8b8b8b;
      color: #fff; font-size: 13px; outline: none; box-sizing: border-box; flex: none;
    `;
    this.searchInput.addEventListener('input', () => {
      this._searchText = this.searchInput.value;
      this.renderList();
    });
    // 阻止按键冒泡到 Game 快捷键（E/J/R/U/A/数字键）
    this.searchInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.listEl.appendChild(this.searchInput);
    const listHead = document.createElement('div');
    this.listHead = listHead; // _applyLang 切语言刷新用
    listHead.textContent = t('全部物品');
    listHead.title = t('点击看配方 / 右键看用途 / A 收藏');
    listHead.style.cssText = 'font-size: 11px; font-weight: bold; color: #333; margin: 4px 0; flex: none;';
    this.listEl.appendChild(listHead);
    this.listGrid = document.createElement('div');
    this.listGrid.style.cssText = 'display: grid; gap: 2px; align-content: start; overflow-y: auto; flex: 1; min-height: 0;';
    this.listEl.appendChild(this.listGrid);

    // ── 配方弹窗 ──
    this.popTitle = document.createElement('div');
    this.popTitle.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex: none;';
    this.popName = document.createElement('div');
    this.popName.style.cssText = 'flex: 1; font-size: 14px; font-weight: bold; color: #333; min-width: 0;';
    this.popTitle.appendChild(this.popName);
    this.popClose = document.createElement('button');
    this.popClose.textContent = '✕';
    this.popClose.title = t('关闭配方详情');
    this.popClose.style.cssText = 'padding: 2px 8px; cursor: pointer;';
    this.popClose.addEventListener('click', () => { this.current = null; this.renderRecipe(); });
    this.popTitle.appendChild(this.popClose);
    this.popEl.appendChild(this.popTitle);
    this.popScroll = document.createElement('div');
    this.popScroll.style.cssText = 'overflow-y: auto; flex: 1; min-height: 0;';
    this.popEl.appendChild(this.popScroll);
  }

  dispose() {
    if (this._unbindLocale) this._unbindLocale();
    this.favEl.remove();
    this.listEl.remove();
    this.popEl.remove();
  }

  _loadFavorites() {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(n => typeof n === 'string') : [];
    } catch { return []; }
  }

  _saveFavorites() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(this.favorites)); } catch { /* ignore */ }
  }

  _loadEnabled() {
    try {
      const v = localStorage.getItem(PANEL_KEY);
      return v === null ? true : v === '1';
    } catch { return true; }
  }

  _saveEnabled() {
    try { localStorage.setItem(PANEL_KEY, this.userEnabled ? '1' : '0'); } catch { /* ignore */ }
  }

  // J 键：容器界面打开时切换面板显隐（偏好持久化）
  togglePanel() {
    this.setUserEnabled(!this.userEnabled);
  }

  setUserEnabled(v) {
    this.userEnabled = !!v;
    this._saveEnabled();
    this._syncDisplay();
  }

  // 当前打开的容器界面 panel 元素（"物品栏"定位锚点）
  _visiblePanel() {
    const g = this.game;
    if (g.inventoryScreen && g.inventoryScreen.visible) return g.inventoryScreen.panel;
    if (g.chestScreen && g.chestScreen.visible) return g.chestScreen.panel;
    if (g.furnaceScreen && g.furnaceScreen.visible) return g.furnaceScreen.panel;
    if (g.tradeScreen && g.tradeScreen.visible) return g.tradeScreen.panel;
    return null;
  }

  // 每帧同步：跟随容器界面（背包/箱子/合成台/熔炉/交易）显隐 + 维护布局
  updateFrame() {
    const g = this.game;
    this.containerVisible = !!(
      (g.inventoryScreen && g.inventoryScreen.visible) ||
      (g.chestScreen && g.chestScreen.visible) ||
      (g.furnaceScreen && g.furnaceScreen.visible) ||
      (g.tradeScreen && g.tradeScreen.visible)
    );
    this._syncDisplay();
    if (this._shown) this._layout();
  }

  _syncDisplay() {
    const want = this.containerVisible && this.userEnabled;
    if (want === this._shown) return;
    this._shown = want;
    this.visible = want;
    const d = want ? 'flex' : 'none';
    this.favEl.style.display = d;
    this.listEl.style.display = d;
    if (want) {
      this._layout(); // 显示当帧立即定位，避免闪到默认位置
    } else {
      this._hoverName = null;
      this._layoutKey = null;
    }
    this.renderRecipe(); // 弹窗跟随面板显隐
  }

  // 布局：收藏夹贴物品栏左侧 / 全物品贴物品栏右侧 / 弹窗覆盖物品栏之上
  // 列数按物品栏两侧剩余空间自适应；rect 无变化时跳过（防每帧 reflow）
  _layout() {
    const panel = this._visiblePanel();
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const popOn = !!this.current && this._shown;
    const key = `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}|${vw}x${vh}|${popOn ? 1 : 0}`;
    if (key !== this._layoutKey) {
      this._layoutKey = key;
      const availL = r.left - PANEL_GAP * 2;
      const availR = vw - r.right - PANEL_GAP * 2;
      const favCols = Math.max(FAV_MIN_COLS, Math.min(FAV_MAX_COLS, Math.floor((availL - 14) / STEP)));
      const listCols = Math.max(LIST_MIN_COLS, Math.min(LIST_MAX_COLS, Math.floor((availR - 14) / STEP)));
      const colsChanged = favCols !== this._favCols || listCols !== this._listCols;
      this._favCols = favCols;
      this._listCols = listCols;
      if (colsChanged) { this.renderFavorites(); this.renderList(); }

      const favW = favCols * STEP + 14;
      const listW = listCols * STEP + 14;
      // 高度跟随物品栏（略上下溢出），但不超屏幕
      let h = Math.max(r.height + 16, 340);
      let top = r.top + r.height / 2 - h / 2;
      if (h > vh - 16) { h = vh - 16; top = 8; }
      else { top = Math.max(8, Math.min(top, vh - 8 - h)); }

      this.favEl.style.width = favW + 'px';
      this.favEl.style.height = h + 'px';
      this.favEl.style.left = Math.max(4, r.left - PANEL_GAP - favW) + 'px';
      this.favEl.style.top = top + 'px';

      this.listEl.style.width = listW + 'px';
      this.listEl.style.height = h + 'px';
      this.listEl.style.left = Math.min(vw - listW - 4, r.right + PANEL_GAP) + 'px';
      this.listEl.style.top = top + 'px';
    }
    // 弹窗：覆盖物品栏正上方（居中于物品栏）
    if (popOn) {
      const popW = Math.min(420, vw - 16);
      const popH = Math.min(Math.round(vh * 0.78), 620);
      const left = Math.max(4, Math.min(r.left + r.width / 2 - popW / 2, vw - popW - 4));
      const top = Math.max(4, Math.min(r.top + r.height / 2 - popH / 2, vh - popH - 4));
      this.popEl.style.width = popW + 'px';
      this.popEl.style.height = popH + 'px';
      this.popEl.style.left = left + 'px';
      this.popEl.style.top = top + 'px';
    }
  }

  // 从物品打开配方视图（容器界面内 hover 按 R）
  showFor(name) {
    if (!name) return;
    this._ensureShown();
    this.mode = 'recipes';
    this.current = name;
    this.renderRecipe();
  }

  // 从物品打开用途视图（按 U）
  showUsages(name) {
    if (!name) return;
    this._ensureShown();
    this.mode = 'usages';
    this.current = name;
    this.renderRecipe();
  }

  // 面板被 J 关闭时，主动查询配方应重新启用（用户意图明确）
  _ensureShown() {
    if (!this.userEnabled && this.containerVisible) this.setUserEnabled(true);
  }

  // R/U/A 的作用目标：面板内悬浮 > 容器界面内悬浮 > 当前查看物品
  _actionTarget() {
    if (this._hoverName) return this._hoverName;
    const g = this.game;
    if (g && typeof g._uiHoverName === 'function') {
      const h = g._uiHoverName();
      if (h) return h;
    }
    return this.current;
  }

  onKeyR() {
    const t = this._actionTarget();
    if (t) { this.mode = 'recipes'; this.current = t; this.renderRecipe(); }
  }

  onKeyU() {
    const t = this._actionTarget();
    if (t) { this.mode = 'usages'; this.current = t; this.renderRecipe(); }
  }

  onKeyA() {
    const t = this._actionTarget();
    if (!t) return;
    const i = this.favorites.indexOf(t);
    if (i >= 0) this.favorites.splice(i, 1);
    else this.favorites.push(t);
    this._saveFavorites();
    this.renderFavorites();
    this.renderList(); // 列表内收藏角标刷新
  }

  // ── 数据 ──
  _allItems() {
    // 方块优先；同名物品跳过（与创造物品栏去重规则一致）
    const blocks = BlockRegistry.all().filter(b => b.name !== 'air');
    const seen = new Set(blocks.map(b => b.name));
    const items = ItemRegistry.all().filter(b => b.name !== 'air' && !seen.has(b.name));
    return [...blocks, ...items];
  }

  // 物品的全部获取配方（合成 + 熔炼）
  _recipesFor(name) {
    const crafting = getAllRecipes().filter(r => r.output === name);
    const smelting = getAllSmeltingRecipes().filter(r => r.output === name);
    return { crafting, smelting };
  }

  // 物品作为材料出现的全部配方
  _usagesFor(name) {
    const crafting = getAllRecipes().filter(r => {
      if (r.type === 'shaped') return r.pattern.some(row => row.includes(name));
      return r.ingredients.includes(name);
    });
    const smelting = getAllSmeltingRecipes().filter(r => r.input === name);
    return { crafting, smelting };
  }

  // ── 渲染 ──
  renderFavorites() {
    if (!this.favGrid) return;
    this.favGrid.innerHTML = '';
    this.favGrid.style.gridTemplateColumns = `repeat(${this._favCols}, ${CELL}px)`;
    if (this.favorites.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = t('对物品按 A 键收藏');
      empty.title = t('对物品按 A 键加入收藏夹');
      empty.style.cssText = `grid-column: 1 / -1; color: #555; font-size: 11px; text-align: center; padding: 8px 2px; line-height: 1.5;`;
      this.favGrid.appendChild(empty);
    } else {
      const favSet = new Set(this.favorites);
      for (const name of this.favorites) this.favGrid.appendChild(this._itemCell(name, CELL, { fav: favSet.has(name) }));
    }
  }

  renderList() {
    if (!this.listGrid) return;
    this.listGrid.innerHTML = '';
    this.listGrid.style.gridTemplateColumns = `repeat(${this._listCols}, ${CELL}px)`;
    const filter = this._searchText.trim().toLowerCase();
    const favSet = new Set(this.favorites);
    let shown = 0;
    for (const def of this._allItems()) {
      if (filter && !def.name.includes(filter) &&
          !(def.displayName && def.displayName.toLowerCase().includes(filter))) continue;
      this.listGrid.appendChild(this._itemCell(def.name, CELL, { fav: favSet.has(def.name) }));
      shown++;
      if (shown >= 400) break; // 搜索未过滤时不至于一次画几千格
    }
    if (shown === 0) {
      const empty = document.createElement('div');
      empty.textContent = t('无匹配物品');
      empty.style.cssText = 'grid-column: 1 / -1; color: #444; font-size: 12px; padding: 6px;';
      this.listGrid.appendChild(empty);
    } else if (shown >= 400 && !filter) {
      const tip = document.createElement('div');
      tip.textContent = t('仅显示前 {n} 个，搜索可缩小范围', { n: 400 });
      tip.style.cssText = 'grid-column: 1 / -1; color: #444; font-size: 10px; padding: 4px;';
      this.listGrid.appendChild(tip);
    }
  }

  renderRecipe() {
    if (!this.popEl) return;
    const show = !!this.current && this._shown;
    this.popEl.style.display = show ? 'flex' : 'none';
    if (!show) return;
    this.popScroll.innerHTML = '';
    const modeLabel = this.mode === 'usages' ? t('用途（作为材料）') : t('获取配方');
    this.popName.innerHTML = `<b>${getDisplayName(this.current)}</b> · ${modeLabel}`;

    const { crafting, smelting } = this.mode === 'usages'
      ? this._usagesFor(this.current)
      : this._recipesFor(this.current);

    if (crafting.length === 0 && smelting.length === 0) {
      const none = document.createElement('div');
      none.textContent = this.mode === 'usages' ? t('没有以该物品为材料的配方') : t('没有已注册的配方（可能只能从世界获取）');
      none.style.cssText = 'font-size: 12px; color: #444; padding: 6px;';
      this.popScroll.appendChild(none);
    }

    if (crafting.length > 0) {
      const sec = document.createElement('div');
      sec.textContent = t('合成');
      sec.style.cssText = 'font-size: 12px; font-weight: bold; color: #333; margin: 4px 0;';
      this.popScroll.appendChild(sec);
      for (const r of crafting) this.popScroll.appendChild(this._craftingRow(r));
    }

    if (smelting.length > 0) {
      const sec = document.createElement('div');
      sec.textContent = t('熔炼（熔炉）');
      sec.style.cssText = 'font-size: 12px; font-weight: bold; color: #333; margin: 8px 0 4px 0;';
      this.popScroll.appendChild(sec);
      for (const r of smelting) this.popScroll.appendChild(this._smeltingRow(r));
    }

    // 操作提示行
    const ops = document.createElement('div');
    ops.style.cssText = 'font-size: 11px; color: #444; margin-top: 6px; flex: none;';
    ops.innerHTML = t('R 配方 · U 用途 · A 收藏当前/悬浮物品');
    this.popScroll.appendChild(ops);

    this._layout(); // 弹窗当帧立即定位（覆盖物品栏之上）
  }

  // 一条合成配方：材料格 → 箭头 → 产出
  _craftingRow(r) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px; background: #8b8b8b; padding: 6px; border: 1px solid #666;';
    const matWrap = document.createElement('div');
    if (r.type === 'shaped') {
      const cols = Math.max(...r.pattern.map(row => row.length));
      const grid = document.createElement('div');
      grid.style.cssText = `display: grid; grid-template-columns: repeat(${cols}, 32px); gap: 2px;`;
      for (const cells of r.pattern) {
        for (let c = 0; c < cols; c++) {
          const name = cells[c] || null;
          grid.appendChild(name ? this._itemCell(name, 32) : this._emptyCell(32));
        }
      }
      matWrap.appendChild(grid);
    } else {
      // shapeless：材料排一行
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display: flex; flex-wrap: wrap; gap: 2px; max-width: 180px;';
      for (const name of r.ingredients) wrap.appendChild(this._itemCell(name, 32));
      matWrap.appendChild(wrap);
    }
    row.appendChild(matWrap);
    row.appendChild(this._arrow());
    row.appendChild(this._itemCell(r.output, 36, { count: r.count }));
    return row;
  }

  // 一条熔炼配方：input → 火焰箭头 → output
  _smeltingRow(r) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px; background: #8b8b8b; padding: 6px; border: 1px solid #666;';
    row.appendChild(this._itemCell(r.input, 36));
    const fuel = document.createElement('div');
    fuel.textContent = '🔥';
    fuel.title = t('熔炉 {t}s · 燃料如煤炭（煤可烧 {n} 个）', { t: SMELT_TIME, n: Math.floor(getFuelTime('coal') / SMELT_TIME) });
    fuel.style.cssText = 'font-size: 14px;';
    row.appendChild(fuel);
    row.appendChild(this._itemCell(r.output, 36, { count: r.count }));
    return row;
  }

  _arrow() {
    const a = document.createElement('div');
    a.textContent = '→';
    a.style.cssText = 'font-size: 18px; color: #333;';
    return a;
  }

  _emptyCell(size) {
    const d = document.createElement('div');
    d.style.cssText = `width: ${size}px; height: ${size}px; background: #777; border: 2px solid #555; box-sizing: content-box; flex: none;`;
    return d;
  }

  _itemCell(name, size = CELL, opts = {}) {
    const cell = document.createElement('div');
    cell.style.cssText = `
      width: ${size}px; height: ${size}px; background: #8b8b8b; border: 2px solid #555;
      position: relative; display: flex; align-items: center; justify-content: center;
      cursor: pointer; image-rendering: pixelated; box-sizing: content-box; flex: none;
    `;
    cell.title = getDisplayName(name);
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    canvas.style.cssText = `width: ${size - 8}px; height: ${size - 8}px; image-rendering: pixelated;`;
    cell.appendChild(canvas);
    this._drawIcon(canvas, name);
    if (opts.count > 1) {
      const c = document.createElement('div');
      c.textContent = opts.count;
      c.style.cssText = 'position: absolute; right: 1px; bottom: 0; color: #fff; font-size: 12px; font-weight: bold; text-shadow: 1px 1px 0 #000;';
      cell.appendChild(c);
    }
    if (opts.fav) {
      const star = document.createElement('div');
      star.textContent = '★';
      star.style.cssText = 'position: absolute; left: 0; top: -2px; color: #ffd700; font-size: 12px; text-shadow: 1px 1px 0 #000; pointer-events: none;';
      cell.appendChild(star);
    }
    // 悬浮记录（R/U/A 目标）+ 点击导航
    cell.addEventListener('mouseenter', () => { this._hoverName = name; });
    cell.addEventListener('mouseleave', () => { if (this._hoverName === name) this._hoverName = null; });
    cell.addEventListener('click', () => {
      this.current = name;
      if (this.mode === 'usages') this.renderRecipe();
      else { this.mode = 'recipes'; this.renderRecipe(); }
    });
    if (!opts.noNav) cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.mode = 'usages';
      this.current = name;
      this.renderRecipe();
    });
    return cell;
  }

  async _drawIcon(canvas, name) {
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
}
