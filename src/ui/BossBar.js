// BossBar.js -- Boss 血条（屏幕顶部，每 Boss 一条紫/红条，实时刷新）
// Idea-2D-②：由末影龙单条参数化为多 Boss 支持（末影龙 + 凋灵可并存各占一条）。
// 新建型 UI 子系统：Game.start 创建、_disposeWorld 移除（与 MobManager 生命周期一致）
import { tName } from '../i18n/name.js';
export class BossBar {
  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      width: min(460px, 60vw); z-index: 20; pointer-events: none; display: none;
    `;
    document.body.appendChild(this.el);
    this.rows = new Map(); // typeName -> { row, label, fill }
  }

  // 取/建某 Boss 类型的血条行（label 颜色按类型：龙紫 / 凋灵灰红）
  _row(mob) {
    let r = this.rows.get(mob.typeName);
    if (!r) {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom: 8px;';
      const label = document.createElement('div');
      label.style.cssText = `
        text-align: center; font-size: 13px; font-weight: bold;
        text-shadow: 1px 1px 0 #000; margin-bottom: 3px; letter-spacing: 2px;
      `;
      label.textContent = tName(mob.type.name, mob.type.displayName);
      const track = document.createElement('div');
      track.style.cssText = `
        width: 100%; height: 10px; background: rgba(10, 6, 18, 0.72);
        border: 1px solid #4a2a6a; border-radius: 2px; overflow: hidden;
      `;
      const fill = document.createElement('div');
      fill.style.cssText = 'width: 100%; height: 100%;';
      if (mob.typeName === 'wither') {
        label.style.color = '#d8b8b8';
        track.style.borderColor = '#5a3a3a';
        fill.style.background = 'linear-gradient(to bottom, #e07070 0%, #b04040 55%, #7a2020 100%)';
      } else {
        label.style.color = '#d9a8ff';
        fill.style.background = 'linear-gradient(to bottom, #c86af5 0%, #9a3ad4 55%, #6f1fa8 100%)';
      }
      track.appendChild(fill);
      row.appendChild(label);
      row.appendChild(track);
      this.el.appendChild(row);
      r = { row, label, fill };
      this.rows.set(mob.typeName, r);
    }
    return r;
  }

  // 每帧调用：mobs 为当前存活的 Boss 数组（dragon/wither 等 type.boss 实体）
  update(mobs) {
    const list = mobs || [];
    // F10：只读单循环遍历（不新建数组）——先计数决定显隐，再逐只建行
    let count = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m && !m.dead && !m.dyingAnim) count++;
    }
    this.el.style.display = count > 0 ? 'block' : 'none';
    if (count === 0) return;
    for (let i = 0; i < list.length; i++) {
      const mob = list[i];
      if (!mob || mob.dead || mob.dyingAnim) continue;
      const r = this._row(mob);
      r.label.textContent = tName(mob.type.name, mob.type.displayName);
      const ratio = Math.max(0, Math.min(1, mob.health / mob.maxHealth));
      r.fill.style.width = (ratio * 100).toFixed(1) + '%';
    }
  }

  dispose() {
    this.el.remove();
  }
}
