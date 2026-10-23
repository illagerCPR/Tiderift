// BlueprintScreen.js -- 建筑蓝图列表、捕获流程与材料面板
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';
import { drawIconInto } from '../render/BlockIcon.js';
import { calculateBlueprintMaterials, captureBlueprint, validateBlueprintName, isWithinCaptureReach, BLUEPRINT_LIMITS } from '../core/Blueprints.js';
import { SaveSystem } from '../core/SaveSystem.js';
import { onLocaleChange, t } from '../i18n/index.js';

function randomId() {
  const bytes = new Uint8Array(10);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((value) => value.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

function itemDisplayName(name) {
  const block = BlockRegistry.getByName(name);
  if (block) return block.displayName || name;
  const item = ItemRegistry.getByName(name);
  return item ? (item.displayName || name) : name;
}

export class BlueprintScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.captureMode = false;
    this.corners = [];
    this.draftCorners = null;
    this.selectedSource = 'personal';
    this.selectedId = null;
    this.pending = false;
    this._wasPaused = false;
    this._draftName = '';

    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:58;background:rgba(0,0,0,.76);color:#eee;font-family:Segoe UI,Microsoft YaHei,sans-serif;';
    this.panel = document.createElement('div');
    this.panel.style.cssText = 'width:min(860px,96vw);max-height:min(720px,94vh);overflow:auto;background:#242a2d;border:3px solid #74817a;box-shadow:0 0 0 2px #101312;padding:14px;display:flex;flex-direction:column;gap:9px;';
    this.el.appendChild(this.panel);
    this._onKey = (event) => {
      if (!this.visible) return;
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); this.hide(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    this.el.addEventListener('click', (event) => { if (event.target === this.el) this.hide(); });
    this._unbindLocale = onLocaleChange(() => { if (this.visible) this.render(); });
    document.body.appendChild(this.el);
  }

  _button(label, action, disabled = false) {
    const button = document.createElement('button');
    button.textContent = t(label);
    button.disabled = !!disabled;
    button.style.cssText = 'padding:7px 10px;background:#39443e;color:#eee;border:1px solid #89958b;cursor:pointer;';
    if (!disabled) button.addEventListener('click', action);
    return button;
  }

  _line(text, style = '') {
    const element = document.createElement('div');
    element.textContent = text;
    element.style.cssText = 'font-size:12px;color:#c9d6d0;' + style;
    return element;
  }

  show() {
    if (this.visible || !this.game.running) return;
    this._wasPaused = !!this.game.paused;
    this.visible = true;
    this.el.style.display = 'flex';
    this.render();
    if (this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
      for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']) this.game.controls.keys[code] = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide() {
    if (!this.visible) return;
    this.captureMode = false;
    this.corners = [];
    this.draftCorners = null;
    this._captureWarning = '';
    this.visible = false;
    this.el.style.display = 'none';
    if (this.game.controls) this.game.controls.enabled = !this._wasPaused;
    this.game.controls && (this.game.controls.mouseLeft = false, this.game.controls.mouseRight = false);
    this.game.ghostPreview?.hide();
  }

  startCapture() {
    if (!this.visible) return;
    this.captureMode = true;
    this.corners = [];
    this.draftCorners = null;
    this._captureWarning = '';
    this._draftName = '';
    this.visible = false;
    this.el.style.display = 'none';
    this.game.controls.enabled = true;
    this.game.controls.mouseLeft = false;
    this.game.controls.mouseRight = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  handleCaptureClick(point) {
    if (!this.captureMode || !point || ![point.x, point.y, point.z].every(Number.isInteger)) return false;
    // 规格：两次点选各自距玩家 ≤ 32 格——每次点选当场按玩家当前位置判定
    const player = this.game.player;
    if (player && !isWithinCaptureReach(point, player.position)) {
      this._captureWarning = t('所选位置距玩家超过 32 格，无法框选。');
      this.render();
      return false;
    }
    this._captureWarning = '';
    if (this.corners.length === 0) {
      this.corners.push({ x: point.x, y: point.y, z: point.z });
      this.game.controls.mouseLeft = false;
      this.render();
      return true;
    }
    this.corners.push({ x: point.x, y: point.y, z: point.z });
    this.captureMode = false;
    this.draftCorners = this.corners.map((corner) => ({ ...corner }));
    this.game.controls.mouseLeft = false;
    this.game.controls.mouseRight = false;
    this.game.controls.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.visible = true;
    this.el.style.display = 'flex';
    this.render();
    return true;
  }

  _tabList(title, entries, shared = false) {
    const section = document.createElement('section');
    section.style.cssText = 'flex:1;min-width:0;background:#1d2224;padding:8px;border:1px solid #53615a;';
    const heading = document.createElement('div');
    heading.textContent = t(title);
    heading.style.cssText = 'font-weight:bold;color:#e4d39b;margin-bottom:6px;';
    section.appendChild(heading);
    if (!entries.length) section.appendChild(this._line(t('当前没有蓝图。')));
    for (const blueprint of entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = 'display:flex;width:100%;text-align:left;gap:8px;align-items:center;background:' + (blueprint.id === this.selectedId ? '#43514a' : '#2a3031') + ';color:#eee;border:1px solid #56625b;margin:3px 0;padding:5px;cursor:pointer;';
      const icon = document.createElement('canvas');
      icon.width = 32; icon.height = 32;
      icon.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;flex:none;';
      row.appendChild(icon);
      const decoded = blueprint.palette.find((id) => id !== 0);
      const iconName = decoded === undefined ? 'air' : (BlockRegistry.getNameById(decoded) || 'air');
      drawIconInto(icon.getContext('2d'), 32, iconName, (name) => ItemSVGDefinitions[name] || null);
      const details = document.createElement('div');
      details.style.cssText = 'min-width:0;flex:1;';
      const name = document.createElement('div');
      name.textContent = blueprint.name;
      name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      const dimensions = document.createElement('div');
      dimensions.textContent = t('包围盒：{x}×{y}×{z} · 修订 {rev}', { ...blueprint.size, rev: blueprint.rev });
      dimensions.style.cssText = 'font-size:11px;color:#aebbb5;';
      details.append(name, dimensions);
      if (shared) {
        // byId 是字符串，remotePlayers 以服务器数字 id 为键——两种键都查
        const author = this.game.remotePlayers?.get(blueprint.byId) || this.game.remotePlayers?.get(Number(blueprint.byId));
        if (author && author.name) {
          const by = document.createElement('div');
          by.textContent = t('由 {name} 分享', { name: author.name });
          by.style.cssText = 'font-size:11px;color:#aebbb5;';
          details.appendChild(by);
        }
      }
      row.appendChild(details);
      row.addEventListener('click', () => { this.selectedId = blueprint.id; this.selectedSource = shared ? 'shared' : 'personal'; this.game.ghostPreview?.show(blueprint, this.game.world.dimension); this.render(); });
      section.appendChild(row);
    }
    return section;
  }

  render() {
    if (!this.panel) return;
    const model = this.game.blueprints;
    const selectedList = model ? (this.selectedSource === 'shared' ? model.shared : model.personal) : [];
    const selected = selectedList.find((entry) => entry.id === this.selectedId) || null;
    this.panel.replaceChildren();
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const title = document.createElement('div');
    title.textContent = t('建筑蓝图');
    title.style.cssText = 'font-size:21px;font-weight:bold;color:#e4d39b;margin-right:auto;';
    header.appendChild(title);
    header.appendChild(this._button('捕获建筑', () => this.startCapture()));
    header.appendChild(this._button('关闭 (ESC)', () => this.hide()));
    this.panel.appendChild(header);
    this.panel.appendChild(this._line(t('每种材料只统计背包中的方块与物品。')));

    if (this.captureMode) {
      const hint = this._captureWarning || (this.corners.length ? t('第一角已选，点击另一角。') : t('点击世界中的第一个方块。'));
      this.panel.appendChild(this._line(hint, this._captureWarning ? 'color:#ff9c87;' : ''));
    }
    if (this.corners.length) {
      const corner = this.corners[0];
      this.panel.appendChild(this._line(t('已选第一角：({x}, {y}, {z})', corner)));
    }
    if (this.draftCorners) this._renderCaptureDraft();
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:8px;';
    tabs.appendChild(this._tabList('个人蓝图', model ? model.personal : []));
    tabs.appendChild(this._tabList('房间蓝图', model ? model.shared : [], true));
    this.panel.appendChild(tabs);
    if (selected) this._renderDetails(selected);
    else this.panel.appendChild(this._line(t('先选择一张蓝图。')));
  }

  _savePersonal() {
    if (!this.game.networkMode) this.game.saveBlueprints?.();
  }

  _renderCaptureDraft() {
    const [first, second] = this.draftCorners || [];
    if (!first || !second) return;
    const result = captureBlueprint(this.game.world, first, second, { id: randomId(), name: this._draftName || 'blueprint', byId: '' });
    if (!result.ok) {
      let warning = '数据格式无效。';
      if (result.reason === 'size') warning = '区域边长不能超过 32，体积不能超过 32768 格。';
      if (result.reason === 'unloaded') warning = '所选区域包含未加载区块，无法捕获。';
      if (result.reason === 'data') warning = '蓝图数据超过 16 KB 上限。';
      if (result.reason === 'palette') warning = '蓝图数据超过 16 KB 上限。';
      this.panel.appendChild(this._line(t(warning), 'color:#ff9c87;'));
      return;
    }
    const section = document.createElement('section');
    section.style.cssText = 'background:#1d2224;border:1px solid #53615a;padding:9px;display:flex;flex-direction:column;gap:7px;';
    const heading = document.createElement('div');
    heading.textContent = t('捕获蓝图');
    heading.style.cssText = 'font-weight:bold;color:#e4d39b;';
    section.appendChild(heading);
    const name = document.createElement('input');
    name.value = this._draftName;
    name.maxLength = 24;
    name.setAttribute('aria-label', t('名称'));
    name.placeholder = t('名称');
    name.style.cssText = 'padding:6px;background:#151a1b;color:#eee;border:1px solid #74817a;';
    section.appendChild(name);
    section.appendChild(this._line(t('包围盒：{x}×{y}×{z} · 修订 {rev}', { ...result.blueprint.size, rev: 1 })));
    const error = this._line('');
    error.style.color = '#ff9c87';
    section.appendChild(error);
    section.appendChild(this._button('取消', () => { this.draftCorners = null; this.corners = []; this.render(); }));
    section.appendChild(this._button('捕获蓝图', () => {
      const normalized = name.value.trim();
      if (!validateBlueprintName(normalized)) { error.textContent = t('名称不能为空（最多 24 个字符）。'); return; }
      if (this.game.blueprints.personal.length >= BLUEPRINT_LIMITS.roomCount) { error.textContent = t('蓝图数量已达上限（24）。'); return; }
      const finalResult = captureBlueprint(this.game.world, first, second, { id: randomId(), name: normalized, byId: '' });
      if (!finalResult.ok) { error.textContent = t('捕获失败：{reason}', { reason: finalResult.reason }); return; }
      if (!this.game.blueprints.createPersonal(finalResult.blueprint)) { error.textContent = t('蓝图数量已达上限（24）。'); return; }
      this.selectedId = finalResult.blueprint.id;
      this.selectedSource = 'personal';
      this.draftCorners = null;
      this.corners = [];
      this._savePersonal();
      this.render();
      this.status && (this.status.textContent = t('蓝图已保存。'));
    }));
    this.panel.appendChild(section);
  }

  _renderDetails(blueprint) {
    const section = document.createElement('section');
    section.style.cssText = 'background:#1d2224;border:1px solid #53615a;padding:9px;display:flex;flex-direction:column;gap:6px;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:7px;';
    const name = document.createElement('input');
    name.value = blueprint.name;
    name.maxLength = 48;
    name.setAttribute('aria-label', t('名称'));
    name.style.cssText = 'flex:1;min-width:0;padding:6px;background:#151a1b;color:#eee;border:1px solid #74817a;';
    head.appendChild(name);
    const rename = this._button('命名蓝图', () => {
      const normalized = name.value.trim();
      if (!validateBlueprintName(normalized)) { this.status.textContent = t('名称不能为空（最多 24 个字符）。'); return; }
      if (this.game.blueprints.editPersonal(blueprint.id, { name: normalized })) { this.status.textContent = t('蓝图已保存。'); this._savePersonal(); this.render(); }
    }, blueprint.byId !== '');
    head.appendChild(rename);
    section.appendChild(head);
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    controls.appendChild(this._button('预览', () => { this.game.ghostPreview?.show(blueprint, this.game.world.dimension); this.status.textContent = blueprint.dim === this.game.world.dimension ? t('预览只显示非空气方块；空气格保留为空。') : t('当前维度不同，预览仍可查看。'); this.render(); }));
    controls.appendChild(this._button('关闭预览', () => { this.game.ghostPreview?.hide(); this.render(); }));
    controls.appendChild(this._button('旋转', () => { this.game.ghostPreview?.rotate(); }));
    controls.appendChild(this._button('上移', () => { this.game.ghostPreview?.raise(1); }));
    controls.appendChild(this._button('下移', () => { this.game.ghostPreview?.raise(-1); }));
    if (this.game.networkMode) controls.appendChild(this._button('分享至房间', () => this.share(blueprint), this.pending || blueprint.byId !== '' || !this.game.net || !this.game.net.connected));
    const personalIndex = this.game.blueprints.personal.indexOf(blueprint);
    if (personalIndex >= 0) {
      controls.appendChild(this._button('删除', () => {
        if (!window.confirm(t('确认删除'))) return;
        this.game.blueprints.removePersonal(blueprint.id);
        this.selectedId = null;
        this.game.ghostPreview?.hide();
        this._savePersonal();
        this.render();
      }));
    } else if (this.game.networkMode) {
      // 创建者本人或 host 可删（其余 op 由服务端 isOperator 放行，客户端无从得知 op 名单）
      const canDelete = String(blueprint.byId) === String(this.game.net && this.game.net.selfId) || !!(this.game.net && this.game.net.isHost);
      controls.appendChild(this._button('删除', () => {
        if (!window.confirm(t('确认删除'))) return;
        this.game.net.sendBlueprintDelete(blueprint.id);
      }, !this.game.net || !this.game.net.connected || !canDelete));
    }
    section.appendChild(controls);
    this.status = this._line(this.pending ? t('正在等待服务器确认。') : '');
    section.appendChild(this.status);
    if (this.game.ghostPreview?.boxOnly) section.appendChild(this._line(t('预览方块超过 4096，已切换为包围盒预览。')));
    if (this.game.ghostPreview?.blueprint && this.game.ghostPreview.dim !== this.game.world.dimension) section.appendChild(this._line(t('当前维度不同，预览仍可查看。')));

    const materialResult = calculateBlueprintMaterials(blueprint, this.game.inventory);
    const heading = document.createElement('div');
    heading.textContent = t('需求');
    heading.style.cssText = 'font-weight:bold;color:#e4d39b;';
    section.appendChild(heading);
    for (const entry of materialResult.materials) section.appendChild(this._materialRow(entry));
    this.panel.appendChild(section);
  }

  // 整行可点击：点击即按物品名走 RecipeViewer 查配方（不自造配方逻辑）
  _materialRow(entry) {
    const row = document.createElement('button');
    row.type = 'button';
    row.textContent = '';
    row.title = t('查看配方');
    row.style.cssText = 'display:flex;align-items:center;gap:7px;width:100%;text-align:left;background:#282e2e;color:#eee;border:1px solid transparent;padding:4px;cursor:pointer;';
    row.addEventListener('click', () => this._openRecipe(entry.name));
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    canvas.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;flex:none;';
    row.appendChild(canvas);
    drawIconInto(canvas.getContext('2d'), 32, entry.name, (name) => {
      const item = ItemRegistry.getByName(name);
      return item ? ItemSVGDefinitions[name] || null : null;
    });
    const label = document.createElement('div');
    label.textContent = itemDisplayName(entry.name);
    label.style.flex = '1';
    row.appendChild(label);
    // 三列：需求 / 持有 / 缺失
    const columns = document.createElement('div');
    columns.style.cssText = 'display:flex;gap:6px;font-size:12px;font-variant-numeric:tabular-nums;';
    for (const [title, value, color] of [[t('需求'), entry.needed, '#c9d6d0'], [t('持有'), entry.owned, '#9ee5af'], [t('缺失'), entry.missing, entry.missing ? '#ff9c87' : '#9ee5af']]) {
      const cell = document.createElement('span');
      cell.textContent = title + ' ' + value;
      cell.style.cssText = 'min-width:62px;text-align:right;color:' + color + ';';
      columns.appendChild(cell);
    }
    row.appendChild(columns);
    const hint = document.createElement('div');
    hint.textContent = t('查看配方');
    hint.style.cssText = 'font-size:11px;color:#aebbb5;flex:none;';
    row.appendChild(hint);
    return row;
  }

  // 配方查询落 RecipeViewer（它只在容器界面打开时渲染面板，故先开背包——与 J 键同款路径）
  _openRecipe(name) {
    const game = this.game;
    const viewer = game.recipeViewer;
    if (!viewer || !name) return;
    const containerOpen = !!((game.inventoryScreen && game.inventoryScreen.visible) ||
      (game.chestScreen && game.chestScreen.visible) ||
      (game.furnaceScreen && game.furnaceScreen.visible) ||
      (game.tradeScreen && game.tradeScreen.visible));
    if (this.visible) this.hide();
    viewer.setUserEnabled(true);
    if (!containerOpen && game.inventoryScreen) game.inventoryScreen.show(2);
    viewer.showFor(name);
  }

  share(blueprint) {
    if (this.pending || !this.game.net || !this.game.net.connected) return;
    if (!this.game.net.sendBlueprintSave(blueprint)) {
      if (this.status) this.status.textContent = t('分享失败：{reason}', { reason: t('正在等待服务器确认。') });
      return;
    }
    this.pending = true;
    if (this.status) this.status.textContent = t('正在等待服务器确认。');
    this.render();
  }

  onSharedSaved(blueprint, mine) {
    this.pending = false;
    if (mine) {
      this.game.blueprints.removePersonal(blueprint.id);
      this.game.blueprints.applyShared(blueprint);
      this.selectedId = blueprint.id;
      this.status && (this.status.textContent = t('蓝图已分享至房间。'));
    }
    if (this.visible) this.render();
  }

  onDenied(reason) {
    this.pending = false;
    if (this.visible) {
      this.render();
      if (this.status) this.status.textContent = t('分享失败：{reason}', { reason });
    }
  }

  dispose() {
    this.captureMode = false;
    this.visible = false;
    document.removeEventListener('keydown', this._onKey, true);
    if (this._unbindLocale) this._unbindLocale();
    this.el.remove();
    this.panel = null;
  }
}
