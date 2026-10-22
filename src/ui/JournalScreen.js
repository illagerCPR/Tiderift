// JournalScreen.js -- 四界游记地图与标记面板
import { DIMENSIONS } from '../core/dimensions.js';
import { Biomes } from '../world/biomes.js';
import { STELE_CHAPTERS } from '../world/steles.js';
import { onLocaleChange, t } from '../i18n/index.js';

const BIOME_COLORS = {
  [Biomes.PLAINS]: '#648c4a', [Biomes.DESERT]: '#c9a85c', [Biomes.SNOWY_TAIGA]: '#9cb8b0',
  [Biomes.RIVER]: '#3e7893', [Biomes.MOUNTAINS]: '#777e73', [Biomes.BIRCH_FOREST]: '#8d9b52',
  [Biomes.TAIGA]: '#426b53', [Biomes.SWAMP]: '#506b4c', [Biomes.SUNFLOWER_PLAINS]: '#91a348',
  [Biomes.MUSHROOM_FIELDS]: '#9a6982',
};
const NAMED_BIOME_COLORS = {
  lava_sea: '#8c3029', soul_sand_valley: '#83634a', soul_sand: '#a18460', gravel: '#77716a', wastes: '#a84e35',
  crystal: '#6ba4c6', frost: '#b9d8e7', autumn: '#b57942', verdant: '#5e9c74',
  main_island: '#8e8a73', end_highlands: '#82729b', small_end_islands: '#665c7b', void: '#171725',
};

function colorForBiome(value) {
  return NAMED_BIOME_COLORS[value] || BIOME_COLORS[value] || '#526a59';
}

export class JournalScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.dim = 'overworld';
    this.zoom = 12;
    this.panX = 0;
    this.panZ = 0;
    this.drag = null;
    this.onHide = null;

    this.el = document.createElement('div');
    this.el.style.cssText = `position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:55;
      background:rgba(0,0,0,.72);color:#eee;font-family:'Segoe UI','Microsoft YaHei',sans-serif;`;
    this.panel = document.createElement('div');
    this.panel.style.cssText = `width:min(1040px,96vw);height:min(680px,92vh);background:#242a2d;border:3px solid #74817a;
      box-shadow:0 0 0 2px #101312;display:flex;flex-direction:column;padding:14px;gap:10px;`;
    this.el.appendChild(this.panel);
    this._onKey = (e) => {
      if (e.key === 'Escape' && this.visible) { e.stopPropagation(); e.preventDefault(); this.hide(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });
    this._unbindLocale = onLocaleChange(() => { if (this.visible) this.render(); });
    document.body.appendChild(this.el);
    this.render();
  }

  _button(label, onClick) {
    const button = document.createElement('button');
    button.textContent = t(label);
    button.style.cssText = 'padding:7px 11px;background:#39433e;color:#eee;border:1px solid #89958b;cursor:pointer;';
    button.addEventListener('click', onClick);
    return button;
  }

  render() {
    this.panel.replaceChildren();
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:10px;flex:0 0 auto;';
    const title = document.createElement('div');
    title.textContent = t('四界游记');
    title.style.cssText = 'font-size:22px;font-weight:bold;letter-spacing:2px;margin-right:auto;color:#e4d39b;';
    header.appendChild(title);
    const select = document.createElement('select');
    select.style.cssText = 'padding:7px;background:#1d2224;color:#eee;border:1px solid #74817a;';
    for (const dim of Object.keys(DIMENSIONS)) {
      if (!DIMENSIONS[dim].implemented) continue;
      const option = document.createElement('option');
      option.value = dim; option.textContent = t(DIMENSIONS[dim].name); option.selected = dim === this.dim;
      select.appendChild(option);
    }
    select.addEventListener('change', () => { this.dim = select.value; this.panX = 0; this.panZ = 0; this.drawMap(); });
    header.appendChild(select);
    header.appendChild(this._button('−', () => { this.zoom = Math.max(5, this.zoom - 2); this.drawMap(); }));
    header.appendChild(this._button('+', () => { this.zoom = Math.min(28, this.zoom + 2); this.drawMap(); }));
    header.appendChild(this._button('关闭', () => this.hide()));
    this.panel.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'display:flex;gap:12px;min-height:0;flex:1;';
    const mapWrap = document.createElement('div');
    mapWrap.style.cssText = 'position:relative;flex:1;min-width:0;background:#111719;border:1px solid #64716b;overflow:hidden;';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 720; this.canvas.height = 520;
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;image-rendering:pixelated;cursor:grab;';
    mapWrap.appendChild(this.canvas);
    this.canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, panX: this.panX, panZ: this.panZ };
      this.canvas.setPointerCapture(e.pointerId); this.canvas.style.cursor = 'grabbing';
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.panX -= (e.clientX - this.drag.x) / this.zoom;
      this.panZ -= (e.clientY - this.drag.y) / this.zoom;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.drawMap();
    });
    this.canvas.addEventListener('pointerup', () => { this.drag = null; this.canvas.style.cursor = 'grab'; });
    mapWrap.addEventListener('wheel', (e) => {
      e.preventDefault(); this.zoom = Math.max(5, Math.min(28, this.zoom + (e.deltaY < 0 ? 2 : -2))); this.drawMap();
    }, { passive: false });
    body.appendChild(mapWrap);

    this.sidebar = document.createElement('div');
    this.sidebar.style.cssText = 'width:280px;flex:0 0 280px;overflow:auto;background:#1d2224;padding:10px;display:flex;flex-direction:column;gap:10px;';
    body.appendChild(this.sidebar);
    this.panel.appendChild(body);
    this.renderSidebar();
    this.drawMap();
  }

  renderSidebar() {
    this.sidebar.replaceChildren();
    const journal = this.game.journal;
    const count = journal.explored[this.dim]?.size || 0;
    const stats = document.createElement('div');
    stats.textContent = t('已揭开 {n} 格 · 发现 {d} 处', { n: count, d: journal.discoveries.filter((d) => d.dim === this.dim).length });
    stats.style.cssText = 'font-size:13px;color:#c4d2c8;border-bottom:1px solid #3d4742;padding-bottom:8px;';
    this.sidebar.appendChild(stats);
    this.sidebar.appendChild(this._section('已发现遗迹', journal.discoveries.filter((d) => d.dim === this.dim).map((d) => ({ label: t(d.label), x: d.x, z: d.z }))));
    this.sidebar.appendChild(this._section('已读碑文', [...journal.readSteles].map((id) => ({ label: t(STELE_CHAPTERS[id]?.title || id) }))));

    const personal = document.createElement('section');
    const personalTitle = document.createElement('div'); personalTitle.textContent = t('个人标记'); personalTitle.style.cssText = 'font-weight:bold;color:#e4d39b;margin:2px 0 6px;';
    personal.appendChild(personalTitle);
    const add = this._button('在当前位置添加标记', () => {
      const label = window.prompt(t('标记名称'), t('新标记'));
      if (!label) return;
      const p = this.game.player.position;
      const marker = journal.addMarker(this.dim, p.x, p.y, p.z, label);
      if (marker) { this.renderSidebar(); this.drawMap(); }
    });
    add.style.width = '100%'; personal.appendChild(add);
    for (const marker of journal.markers.filter((m) => m.dim === this.dim)) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:5px;font-size:12px;';
      const name = document.createElement('span'); name.textContent = `${marker.label} (${Math.floor(marker.x)}, ${Math.floor(marker.z)})`; name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;';
      row.appendChild(name);
      // 共享标记同步由 NetworkManager 提供；单机或该方法尚未实现时只隐藏入口，不得抛错
      if (this.game.networkMode && this.game.net && typeof this.game.net.sendJournalMarker === 'function') {
        const share = this._button('分享', () => {
          const net = this.game.net;
          if (net && typeof net.sendJournalMarker === 'function' && net.sendJournalMarker(marker)) {
            share.disabled = true; share.textContent = t('已分享');
          }
        }); share.style.cssText += 'padding:4px 6px;font-size:11px;'; row.appendChild(share);
      }
      const remove = this._button('删除', () => { journal.removeMarker(marker.id); this.renderSidebar(); this.drawMap(); });
      remove.style.cssText += 'padding:4px 6px;font-size:11px;'; row.appendChild(remove);
      personal.appendChild(row);
    }
    this.sidebar.appendChild(personal);

    const shared = document.createElement('section');
    const sharedTitle = document.createElement('div'); sharedTitle.textContent = t('房间共享标记'); sharedTitle.style.cssText = 'font-weight:bold;color:#e4d39b;margin:2px 0 6px;';
    shared.appendChild(sharedTitle);
    for (const marker of journal.sharedMarkers.filter((m) => m.dim === this.dim)) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:5px;margin-top:5px;font-size:12px;';
      const name = document.createElement('span'); name.textContent = `${marker.label} · ${marker.owner || t('玩家')}`; name.style.flex = '1'; row.appendChild(name);
      if (this.game.net && marker.ownerId === this.game.net.selfId
          && typeof this.game.net.sendJournalMarkerDelete === 'function') {
        const remove = this._button('删除', () => this.game.net.sendJournalMarkerDelete(marker.id));
        remove.style.cssText += 'padding:4px 6px;font-size:11px;'; row.appendChild(remove);
      }
      shared.appendChild(row);
    }
    this.sidebar.appendChild(shared);
  }

  _section(label, rows) {
    const section = document.createElement('section');
    const title = document.createElement('div'); title.textContent = t(label); title.style.cssText = 'font-weight:bold;color:#e4d39b;margin:2px 0 6px;';
    section.appendChild(title);
    if (!rows.length) {
      const empty = document.createElement('div'); empty.textContent = t('暂无记录'); empty.style.cssText = 'font-size:12px;color:#89938d;'; section.appendChild(empty);
    }
    for (const item of rows) {
      const row = document.createElement('div'); row.textContent = item.x === undefined ? item.label : `${item.label} (${Math.floor(item.x)}, ${Math.floor(item.z)})`;
      row.style.cssText = 'font-size:12px;color:#c5cec8;margin:4px 0;'; section.appendChild(row);
    }
    return section;
  }

  drawMap() {
    if (!this.canvas || !this.game.journal) return;
    const ctx = this.canvas.getContext('2d');
    const w = this.canvas.width, h = this.canvas.height;
    ctx.fillStyle = '#151b1d'; ctx.fillRect(0, 0, w, h);
    const saved = this.game.journal.lastPosition[this.dim];
    const current = this.game.world?.dimension === this.dim ? this.game.player.position : null;
    const centerX = (current ? current.x : saved ? saved.x : 0) / 16 + this.panX;
    const centerZ = (current ? current.z : saved ? saved.z : 0) / 16 + this.panZ;
    const left = centerX - w / (2 * this.zoom), top = centerZ - h / (2 * this.zoom);
    for (const [key, biome] of this.game.journal.explored[this.dim] || []) {
      const [cx, cz] = key.split(',').map(Number);
      const px = Math.floor((cx - left) * this.zoom), py = Math.floor((cz - top) * this.zoom);
      if (px > w || py > h || px + this.zoom < 0 || py + this.zoom < 0) continue;
      ctx.fillStyle = colorForBiome(Number.isInteger(Number(biome)) ? Number(biome) : biome);
      ctx.fillRect(px, py, Math.ceil(this.zoom), Math.ceil(this.zoom));
      ctx.fillStyle = 'rgba(255,255,255,.055)'; ctx.fillRect(px, py, this.zoom, Math.max(1, this.zoom * 0.18));
    }
    const drawPoint = (x, z, color, radius, shape = 'circle') => {
      const px = (x / 16 - left + 0.5) * this.zoom, py = (z / 16 - top + 0.5) * this.zoom;
      if (px < -radius || py < -radius || px > w + radius || py > h + radius) return;
      ctx.fillStyle = color;
      if (shape === 'diamond') { ctx.beginPath(); ctx.moveTo(px, py - radius); ctx.lineTo(px + radius, py); ctx.lineTo(px, py + radius); ctx.lineTo(px - radius, py); ctx.closePath(); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill(); }
    };
    for (const d of this.game.journal.discoveries) {
      if (d.dim === this.dim && this.game.journal.isExplored(this.dim, Math.floor(d.x / 16), Math.floor(d.z / 16))) drawPoint(d.x, d.z, '#f4dc8b', Math.max(3, this.zoom * 0.27), 'diamond');
    }
    for (const m of [...this.game.journal.markers, ...this.game.journal.sharedMarkers]) {
      if (m.dim === this.dim && this.game.journal.isExplored(this.dim, Math.floor(m.x / 16), Math.floor(m.z / 16))) drawPoint(m.x, m.z, m.color || '#f4ca64', Math.max(3, this.zoom * 0.24));
    }
    if (current) drawPoint(current.x, current.z, '#fff', Math.max(4, this.zoom * 0.32));
    ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(w / 2 - 8, h / 2); ctx.lineTo(w / 2 + 8, h / 2); ctx.moveTo(w / 2, h / 2 - 8); ctx.lineTo(w / 2, h / 2 + 8); ctx.stroke();
  }

  show() {
    this.dim = this.game.world?.dimension || this.dim;
    this._wasPaused = !!this.game.paused;
    this.visible = true; this.el.style.display = 'flex'; this.render();
    if (this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false; this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false; this.el.style.display = 'none';
    if (this.game.controls) this.game.controls.enabled = this._wasPaused ? false : true;
    if (this.onHide) { const fn = this.onHide; this.onHide = null; fn(); }
  }

  dispose() {
    if (this.visible) this.hide(); // 断电前走统一出口：恢复 controls.enabled、触发 onHide
    document.removeEventListener('keydown', this._onKey, true);
    if (this._unbindLocale) { this._unbindLocale(); this._unbindLocale = null; }
    this.el.remove();
    this.onHide = null;
    this.drag = null;
    this.canvas = null;
    this.sidebar = null;
  }
}
