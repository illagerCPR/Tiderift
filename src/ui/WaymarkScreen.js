// WaymarkScreen.js -- 旧航标（天域瞭望塔三阶段修复）界面
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { WAYMARK_STAGES, waymarkStageDef } from '../core/Waymarks.js';
import { onLocaleChange, t } from '../i18n/index.js';

// 材料显示名：方块与物品共用命名空间，两个注册表都查一遍，查不到回落原名
function materialName(name) {
  try {
    const block = BlockRegistry.getByName(name);
    if (block && block.displayName) return block.displayName;
  } catch (e) { /* 注册表缺项时回落 */ }
  try {
    const item = ItemRegistry.getByName(name);
    if (item && item.displayName) return item.displayName;
  } catch (e) { /* 同上 */ }
  return name;
}

// 中文方位词序为「东西在前、南北在后」：东北 / 西北 / 东南 / 西南
function compassLabel(dx, dz) {
  const ew = dx > 0 ? t('东') : (dx < 0 ? t('西') : '');
  const ns = dz < 0 ? t('北') : (dz > 0 ? t('南') : '');
  return (ew + ns) || t('原地');
}

export class WaymarkScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.tower = null;
    this._pending = false; // 已发提交、等服务器回执（仅联机）
    this._wasPaused = false;
    this.onHide = null;

    this.el = document.createElement('div');
    this.el.style.cssText = `position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:56;
      background:rgba(0,0,0,.72);color:#eee;font-family:'Segoe UI','Microsoft YaHei',sans-serif;`;
    this.panel = document.createElement('div');
    this.panel.style.cssText = `width:min(560px,94vw);max-height:min(620px,92vh);overflow:auto;background:#222a2c;border:3px solid #6f8f8a;
      box-shadow:0 0 0 2px #0d1413;display:flex;flex-direction:column;padding:16px;gap:12px;`;
    this.el.appendChild(this.panel);
    this._onKey = (e) => {
      if (e.key === 'Escape' && this.visible) { e.stopPropagation(); e.preventDefault(); this.hide(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });
    this._unbindLocale = onLocaleChange(() => { if (this.visible) this.render(); });
    document.body.appendChild(this.el);
  }

  _button(label, onClick, disabled = false) {
    const button = document.createElement('button');
    button.textContent = t(label);
    button.disabled = !!disabled;
    button.style.cssText = `padding:7px 12px;background:${disabled ? '#2b3234' : '#39443e'};color:${disabled ? '#7c8884' : '#eee'};
      border:1px solid #89958b;cursor:${disabled ? 'default' : 'pointer'};`;
    if (!disabled) button.addEventListener('click', onClick);
    return button;
  }

  _line(text, style = '') {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.cssText = `font-size:13px;color:#c9d6d0;${style}`;
    return div;
  }

  show(tower) {
    if (!tower) return;
    this.tower = tower;
    this._pending = false;
    this._wasPaused = !!this.game.paused;
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
    if (!this.visible) return;
    this.visible = false;
    this.el.style.display = 'none';
    if (this.game.controls) this.game.controls.enabled = this._wasPaused ? false : true;
    if (this.onHide) { const fn = this.onHide; this.onHide = null; fn(); }
  }

  dispose() {
    if (this.visible) this.hide();
    document.removeEventListener('keydown', this._onKey, true);
    if (this._unbindLocale) { this._unbindLocale(); this._unbindLocale = null; }
    this.el.remove();
    this.onHide = null;
    this.tower = null;
  }

  // 当前塔已完成的阶段数（0..3）
  _stage() {
    if (!this.tower) return 0;
    return this.game.waymarks ? this.game.waymarks.stageAt(this.tower.ax, this.tower.az) : 0;
  }

  // 航标芯是否在位（修复完成后由修复方放置；被玩家拆掉则为 false）
  _waymarkBlockPresent() {
    if (!this.tower || !this.game.world) return false;
    const id = BlockRegistry.getId('aether_waymark');
    if (id === undefined || id === null) return false;
    return this.game.world.getBlock(this.tower.ax, this.tower.groundY + 10, this.tower.az) === id;
  }

  render() {
    this.panel.replaceChildren();
    const stage = this._stage();

    const title = document.createElement('div');
    title.textContent = t('旧航标');
    title.style.cssText = 'font-size:17px;font-weight:bold;color:#eadfae;';
    this.panel.appendChild(title);

    this.panel.appendChild(this._line(t('天域瞭望塔 · 航标位 ({x}, {z})', { x: this.tower.ax, z: this.tower.az })));
    this.panel.appendChild(this._line(t('航路状态：{s}', { s: stage >= 3 ? t('已点亮') : t('{n}/3 阶段', { n: stage }) }), 'color:#8fd0c4;'));

    // ── 三阶段 ──
    for (const def of WAYMARK_STAGES) {
      const row = document.createElement('section');
      row.style.cssText = 'border:1px solid #3d4a48;background:#1b2224;padding:9px 10px;display:flex;flex-direction:column;gap:5px;';
      const head = document.createElement('div');
      head.textContent = `${def.stage}. ${t(def.title)}`;
      head.style.cssText = `font-size:14px;font-weight:bold;color:${stage >= def.stage ? '#8fd0c4' : '#e4e8e2'};`;
      row.appendChild(head);
      row.appendChild(this._line(t(def.hint), 'color:#9fb0ab;'));

      const need = def.needs.map((n) => t('{name} x{count}', { name: t(materialName(n.name)), count: n.count })).join(' · ');
      row.appendChild(this._line(t('所需：{list}', { list: need }), 'color:#d6c69a;'));

      if (stage >= def.stage) {
        row.appendChild(this._line(t('已完成'), 'color:#7fd6a2;'));
      } else if (stage === def.stage - 1) {
        const missing = this.game.waymarks ? this.game.waymarks.missingFor(def.stage, this.game.inventory) : [];
        if (missing.length) {
          const list = missing.map((m) => t('{name} 缺 {n}', { name: t(materialName(m.name)), n: m.count - m.have })).join(' · ');
          row.appendChild(this._line(t('材料不足：{list}', { list }), 'color:#e08f7c;'));
          row.appendChild(this._button('提交', () => this._submit(def.stage), true));
        } else {
          row.appendChild(this._button(this._pending ? '提交中…' : '提交', () => this._submit(def.stage), this._pending));
        }
      } else {
        row.appendChild(this._line(t('需先完成前一阶段'), 'color:#7c8b86;'));
      }
      this.panel.appendChild(row);
    }

    // ── 缺件与重建 ──
    if (stage >= 3 && !this._waymarkBlockPresent()) {
      const platformOk = this.game.world && this.game.world.getBlock(this.tower.ax, this.tower.groundY + 9, this.tower.az) !== 0;
      this.panel.appendChild(this._line(platformOk ? t('航标芯已缺失。') : t('塔顶已损毁，无法重建航标芯。'), 'color:#e08f7c;'));
      this.panel.appendChild(this._button('重建航标芯', () => this._rebuild(), !platformOk));
    }

    // ── 导航 ──
    const nav = document.createElement('section');
    nav.style.cssText = 'border-top:1px solid #3d4a48;padding-top:9px;display:flex;flex-direction:column;gap:5px;';
    if (stage < 3) {
      nav.appendChild(this._line(t('修复完成后可获知下一座航路。'), 'color:#8b9a95;'));
    } else {
      const target = this.game._waymarkNextTower ? this.game._waymarkNextTower(this.tower.ax, this.tower.az) : null;
      if (!target) {
        nav.appendChild(this._line(t('附近找不到下一座瞭望塔。'), 'color:#e08f7c;'));
      } else {
        const pos = this.game.player && this.game.player.position;
        const dx = target.ax - (pos ? pos.x : this.tower.ax);
        const dz = target.az - (pos ? pos.z : this.tower.az);
        const dist = Math.round(Math.hypot(dx, dz));
        nav.appendChild(this._line(t('下一座航路：{dir} 约 {n} 格', { dir: compassLabel(dx, dz), n: dist }), 'color:#8fd0c4;'));
        nav.appendChild(this._line(t('仅给出方向与距离，抵达后才会出现在游记中。'), 'color:#8b9a95;'));
      }
    }
    this.panel.appendChild(nav);

    this.panel.appendChild(this._button('关闭 (ESC)', () => this.hide()));
  }

  _submit(stage) {
    const tower = this.tower;
    if (!tower || this._pending) return;
    const def = waymarkStageDef(stage);
    if (!def) return;
    if (this.game.waymarks && this.game.waymarks.stageAt(tower.ax, tower.az) !== stage - 1) return;
    const missing = this.game.waymarks ? this.game.waymarks.missingFor(stage, this.game.inventory) : [];
    if (missing.length) return;

    const net = this.game.networkMode ? this.game.net : null;
    if (net && typeof net.sendWaymarkSubmit === 'function') {
      // 联机：服务器权威。材料在收到 "由自己触发" 的更新回执后才扣，避免双重扣料。
      if (net.sendWaymarkSubmit(tower.ax, tower.az, stage)) {
        this._pending = true;
        this.render();
      } else if (this.game.chatBox) {
        this.game.chatBox.add(t('未连接房间，无法提交航标。'), '#fbb');
      }
      return;
    }
    this.game._completeWaymarkStage(tower, stage, '');
    this.render();
  }

  _rebuild() {
    if (!this.tower) return;
    this.game._placeWaymarkBlock(this.tower);
    this.render();
  }
}
