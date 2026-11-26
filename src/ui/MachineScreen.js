// MachineScreen.js -- 潮工机器界面（B52 R2；右键机器打开）
// 显示：槽位 / 配方 / 供需（潮压） / 加工进度 / 停转原因；点背包物品投入、点机器槽位取出。
// 数据来源：单机读 World.industry；联机读服务器下发的权威状态（打开与 ~1s 刷新靠 INDUSTRY_OPEN）。
// 本类只发动作、不本地改机器状态：单机走 IndustrySystem.requestAction（本地结算），联机等回执。
import { machineStatus, emptyStateFor } from '../core/Industry.js';
import { recipesFor, processorTime, MACHINE_SLOTS } from '../content/industry/defs.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { drawIconInto } from '../render/BlockIcon.js';
import { t } from '../i18n/index.js';
import { getDisplayName } from './itemName.js';

const REFRESH_SEC = 0.9; // 联机界面刷新节拍（第二，INDUSTRY_OPEN 定向回包）

// 方块名（界面标题）：kind → 注册名（getDisplayName 不是 i18n 动态键路径，可放在表里）
const KIND_BLOCK_NAME = {
  boiler: 'tide_boiler', crusher: 'crusher', cutter: 'tide_cutter', gauge: 'pressure_gauge',
  press: 'rune_press', // B56 R1：刻纹压印机（双开联动）
};

// B53 R3：潮压表的读数文案——它只说"网络怎么样"，不复用加工机的"没有可推进的活"那套说法
export function gaugeText(code) {
  switch (code) {
    case 'running': return t('运转中');
    case 'cut': return t('上游闸断开，下游拿不到潮压');
    case 'no-power': return t('表针到底：上游没有在烧的锅炉');
    case 'stalled': return t('压力空转：有压但没有机器在干活');
    case 'over-limit': return t('网络超过 128 节点，整网停转');
    default: return t('待机');
  }
}

// 停转原因 → 文案（静态 t() 字面量：i18n 静态扫描能查到，语言包不会漏键）
export function reasonText(code) {
  switch (code) {
    case 'running': return t('运转中');
    case 'ready': return t('就绪，等潮压');
    case 'idle': return t('待机');
    case 'no-input': return t('没有可加工的原料');
    case 'no-recipe': return t('这台机器不认这种材料');
    case 'output-full': return t('产物槽已满');
    case 'no-fuel': return t('缺少燃料');
    case 'no-water': return t('缺少桶装水');
    case 'no-power': return t('没有潮压（上游锅炉没在烧）');
    case 'over-limit': return t('网络超过 128 节点，整网停转');
    case 'disengaged': return t('离合闸已断开');
    case 'cut': return t('上游闸断开，下游拿不到潮压');
    case 'stalled': return t('停转（没有可推进的活）');
    case 'no-shard': return t('缺少回响残片');
    default: return t('待机');
  }
}

export function slotLabel(slot) {
  if (slot === 'fuel') return t('燃料');
  if (slot === 'water') return t('水');
  if (slot === 'input') return t('原料');
  if (slot === 'shard') return t('残片');
  if (slot === 'output') return t('主产物');
  if (slot === 'bonus') return t('副产物');
  return slot;
}

export class MachineScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.pos = null;      // {x,y,z}
    this.kind = null;     // 'boiler' | 'crusher' | 'cutter'
    this._disposed = false;
    this._hoverName = null;
    this._slotSigs = {};
    this._slotEls = new Map();
    this._refreshAcc = 0;
    this._lastPct = -1;
    this._lastReason = '';

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
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.el.remove();
  }

  show(x, y, z) {
    const g = this.game;
    if (!g.world) return;
    this.pos = { x, y, z };
    this.kind = g.industry ? g.industry.kindAt(x, y, z) : null;
    if (!this.kind || this.kind === 'shaft' || this.kind === 'clutch') return;
    this.visible = true;
    this.el.style.display = 'flex';
    this._refreshAcc = 0;
    this.render();
    // 联机：打开即拉一条权威状态（单机状态本来就在本地）
    if (g.industry) g.industry.requestOpen(this.pos);
    if (g.controls) {
      g.controls.enabled = false;
      g.controls.mouseLeft = false;
      g.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.el.style.display = 'none';
    this._hoverName = null;
    if (this.game.controls) this.game.controls.enabled = true;
    this.pos = null;
    this.kind = null;
  }

  // 机器状态（单机 = 本地账本；联机 = 服务器下发的权威状态，落在同一张表里）
  // 账本里还没有条目（从没交互过）时给一个空状态，界面显示"没有原料"而不是"待机"。
  state() {
    const g = this.game;
    if (!this.pos || !g.world) return null;
    const st = g.world.getIndustry(this.pos.x, this.pos.y, this.pos.z);
    return st || (this.kind ? emptyStateFor(this.kind) : null);
  }

  render() {
    const g = this.game;
    if (!this.kind) return;
    this.panel.innerHTML = '';
    this._slotSigs = {};
    this._slotEls.clear();
    this._lastPct = -1;
    this._lastReason = '';

    const title = document.createElement('div');
    title.textContent = getDisplayName(KIND_BLOCK_NAME[this.kind] || this.kind);
    title.style.cssText = 'font-size: 14px; margin-bottom: 6px; color: #333; font-weight: bold;';
    this.panel.appendChild(title);

    // 供需行
    this.statsEl = document.createElement('div');
    this.statsEl.style.cssText = 'font-size: 12px; color: #333; margin-bottom: 4px;';
    this.panel.appendChild(this.statsEl);

    // 停转原因
    this.reasonEl = document.createElement('div');
    this.reasonEl.style.cssText = 'font-size: 12px; color: #7a2b20; margin-bottom: 2px;';
    this.panel.appendChild(this.reasonEl);

    // B53 R3：潮压表是只读仪表——没有槽位、没有进度条、也不摊玩家背包
    const isGauge = this.kind === 'gauge';
    this.barWrap = null;
    this.barFill = null;
    if (!isGauge) {
      // 进度条
      this.barWrap = document.createElement('div');
      this.barWrap.style.cssText = 'width: 100%; height: 10px; background: #8b8b8b; border: 1px solid #555; position: relative; margin-bottom: 8px;';
      this.barFill = document.createElement('div');
      this.barFill.style.cssText = 'position: absolute; left: 0; top: 0; height: 100%; width: 0%; background: #d9f0ef;';
      this.barWrap.appendChild(this.barFill);
      this.panel.appendChild(this.barWrap);

      // 槽位区
      const slotsRow = document.createElement('div');
      slotsRow.style.cssText = 'display: flex; align-items: flex-end; gap: 10px; margin-bottom: 10px;';
      // B56 R1：槽位布局**派生自 MACHINE_SLOTS**（不再手写 per-kind 表）——
      // 压印机是双料机器（input + shard → output），手写表会漏掉残片槽、还会多画一个不存在的副产槽。
      const slotsAll = MACHINE_SLOTS[this.kind] || [];
      const outSlots = new Set(['output', 'bonus']);
      const layout = [
        slotsAll.filter((s) => !outSlots.has(s)),
        slotsAll.filter((s) => outSlots.has(s)),
      ];
      const arrow = () => {
        const a = document.createElement('div');
        a.textContent = '→';
        a.style.cssText = 'font-size: 18px; color: #444; padding-bottom: 14px;';
        return a;
      };
      slotsRow.appendChild(this.makeSlotGroup(layout[0]));
      if (layout[1].length) {
        slotsRow.appendChild(arrow());
        slotsRow.appendChild(this.makeSlotGroup(layout[1]));
      }
      this.panel.appendChild(slotsRow);
    }

    // 配方表
    this.recipeEl = document.createElement('div');
    this.recipeEl.style.cssText = 'font-size: 12px; color: #333; margin-bottom: 8px; line-height: 1.5;';
    this.panel.appendChild(this.recipeEl);

    // 操作提示
    const hint = document.createElement('div');
    hint.textContent = isGauge ? t('只读仪表：不耗压、不产压，读数跟着网络实时变') : t('点击背包物品投入 · 点击机器槽位取出');
    hint.style.cssText = 'font-size: 11px; color: #555; margin-bottom: 8px;';
    this.panel.appendChild(hint);

    if (!isGauge) {
      // 玩家背包 27 格 + 快捷栏 9 格（仪表不摊背包：没有可投的槽）
      const main = this.makeGrid(9, 3, 'main');
      this.panel.appendChild(main);
      const hb = this.makeGrid(9, 1, 'hotbar');
      hb.style.marginTop = '8px';
      this.panel.appendChild(hb);
    }

    this.bindSlots();
    this.refreshStatic();
    // 仪表没有槽位：首帧就把读数画全（暂停时 tick 不跑，否则只剩基本信息行）
    if (this.kind === 'gauge') {
      const g2 = this.game;
      const st2 = this.state();
      const net2 = g2.industry ? g2.industry.netInfoAt(this.pos.x, this.pos.y, this.pos.z) : null;
      this._refreshGauge(machineStatus('gauge', st2, net2));
    }
  }

  makeSlotGroup(slotNames) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; gap: 8px;';
    for (const slot of slotNames) {
      const col = document.createElement('div');
      col.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 2px;';
      const el = document.createElement('div');
      el.dataset.mslot = slot;
      el.style.cssText = `
        width: 44px; height: 44px; background: #8b8b8b; border: 2px solid #555;
        position: relative; display: flex; align-items: center; justify-content: center;
        cursor: pointer; image-rendering: pixelated;
      `;
      el.onmousedown = (e) => {
        e.preventDefault();
        if (e.button !== 0 && e.button !== 2) return;
        this.clickMachineSlot(slot);
      };
      el.onmouseenter = () => { this._hoverName = this.state() && this.state()[slot] ? this.state()[slot].name : null; };
      el.onmouseleave = () => { this._hoverName = null; };
      const label = document.createElement('div');
      label.textContent = slotLabel(slot);
      label.style.cssText = 'font-size: 10px; color: #444;';
      col.appendChild(el);
      col.appendChild(label);
      wrap.appendChild(col);
      this._slotEls.set(slot, el);
    }
    return wrap;
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
        g.appendChild(this.makeSlotEl(`${prefix}-${idx}`));
      }
    }
    return g;
  }

  // 点机器槽位 = 取出该槽内容到背包（单机立即结算；联机等回执）
  clickMachineSlot(slot) {
    const g = this.game;
    if (!g.industry || !this.pos) return;
    g.industry.requestAction(this.pos, 'extract', slot, null, 64);
  }

  // 点背包物品 = 投入该物品（自动路由到能收它的槽）
  clickInventorySlot(index) {
    const g = this.game;
    if (!g.industry || !this.pos) return;
    const stack = g.inventory.slots[index];
    if (!stack || !stack.name) return;
    g.industry.requestAction(this.pos, 'insert', null, stack.name, stack.count, index);
  }

  bindSlots() {
    const st = this.state();
    // 机器槽位内容（首帧绘制；之后 tick 只增量更新）
    for (const slot of MACHINE_SLOTS[this.kind] || []) {
      const el = this._slotEls.get(slot);
      if (!el) continue;
      this._paintSlot(el, st ? st[slot] : null);
    }
    // 背包 + 快捷栏
    this.panel.querySelectorAll('[data-slot^="main-"]').forEach((el, i) => {
      const idx = 9 + i;
      this._paintSlot(el, this.game.inventory.slots[idx]);
      el.onmousedown = (e) => { e.preventDefault(); if (e.button === 0) this.clickInventorySlot(idx); };
      el.onmouseenter = () => { this._hoverName = this.game.inventory.slots[idx] ? this.game.inventory.slots[idx].name : null; };
      el.onmouseleave = () => { this._hoverName = null; };
    });
    this.panel.querySelectorAll('[data-slot^="hotbar-"]').forEach((el, i) => {
      this._paintSlot(el, this.game.inventory.slots[i]);
      el.onmousedown = (e) => { e.preventDefault(); if (e.button === 0) this.clickInventorySlot(i); };
      el.onmouseenter = () => { this._hoverName = this.game.inventory.slots[i] ? this.game.inventory.slots[i].name : null; };
      el.onmouseleave = () => { this._hoverName = null; };
    });
  }

  _paintSlot(el, stack) {
    const sig = stack ? `${stack.name}|${stack.count}` : '';
    if (el._sig === sig) return;
    el._sig = sig;
    el.innerHTML = '';
    if (!stack) return;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    canvas.style.cssText = 'width: 32px; height: 32px;';
    el.appendChild(canvas);
    this.drawIcon(canvas, stack.name);
    el.title = getDisplayName(stack.name);
    if (stack.count > 1) {
      const c = document.createElement('div');
      c.textContent = stack.count;
      c.style.cssText = 'position: absolute; right: 2px; bottom: 0; color: #fff; font-size: 14px; font-weight: bold; text-shadow: 1px 1px 0 #000;';
      el.appendChild(c);
    }
  }

  async drawIcon(canvas, name) {
    await drawIconInto(canvas.getContext('2d'), 32, name, (n) => {
      const item = ItemRegistry.getByName(n);
      return item && this.game.itemSvgMap[n] ? this.game.itemSvgMap[n] : null;
    });
  }

  // 静态部分：供需 + 配方表（每次打开/种类变化重建一次）
  refreshStatic() {
    const g = this.game;
    if (!this.visible || !this.kind) return;
    const st = this.state();
    const net = g.industry ? g.industry.netInfoAt(this.pos.x, this.pos.y, this.pos.z) : null;
    const status = machineStatus(this.kind, st, net);

    const parts = [];
    parts.push(t('潮压 {supply} / 需求 {demand}', { supply: status.supply, demand: status.demand }));
    parts.push(t('效率 {pct}%', { pct: Math.round(status.efficiency * 100) }));
    parts.push(t('网络 {n} 节点', { n: status.nodes }));
    this.statsEl.textContent = parts.join('   ');
    this.statsEl.style.color = status.overLimit ? '#8a1f1f' : '#333';

    // 网络明细（压力表）/ 配方表（加工机与锅炉）
    this.recipeEl.innerHTML = '';
    // 仪表的读数全在 tick 里刷 statsEl（三行实时更新），这里不重复画一遍
    if (this.kind === 'gauge') return;
    if (this.kind === 'boiler') {
      const row = document.createElement('div');
      row.textContent = t('燃料 + 桶装水 → 潮压 + 空桶');
      this.recipeEl.appendChild(row);
      const row2 = document.createElement('div');
      row2.textContent = t('燃料烧完一轮产出 1 个空桶，取走后再添水');
      row2.style.color = '#555';
      this.recipeEl.appendChild(row2);
    } else {
      const head = document.createElement('div');
      head.textContent = t('可加工：');
      head.style.color = '#555';
      this.recipeEl.appendChild(head);
      for (const r of recipesFor(this.kind)) {
        const row = document.createElement('div');
        if (this.kind === 'press') {
          // 压印机是双料机器：两种料各画一次，玩家一眼看出残片也要放
          let pline = t('纹样压印：{input} + {shard} → {output}', {
            input: getDisplayName(r.input),
            shard: getDisplayName(r.shard),
            output: getDisplayName(r.output),
          });
          pline += `  ${t('（{n} 秒）', { n: processorTime(this.kind) })}`;
          row.textContent = pline;
          this.recipeEl.appendChild(row);
          continue;
        }
        let line = t('{input} → {output} ×{count}', {
          input: getDisplayName(r.input), output: getDisplayName(r.output), count: r.count,
        });
        line += `  ${t('（{n} 秒）', { n: processorTime(this.kind) })}`;
        if (r.byproduct) {
          line += `  ${t('副产物：每 {every} 个 +1 {item}', {
            every: r.byproduct.every, item: getDisplayName(r.byproduct.name),
          })}`;
        }
        row.textContent = line;
        this.recipeEl.appendChild(row);
      }
    }
  }

  // B53 R3：潮压表读数（渲染首帧与每帧共用）——供需、锅炉/机器台数、断路位置都可能变
  _refreshGauge(status) {
    const parts = [
      t('潮压 {supply} / 需求 {demand}', { supply: status.supply, demand: status.demand }),
      t('效率 {pct}%', { pct: Math.round(status.efficiency * 100) }),
      t('网络 {n} 节点', { n: status.nodes }),
    ];
    const cuts = Array.isArray(status.cuts) ? status.cuts : [];
    const cutLine = cuts.length
      ? `\n${t('断路 {n} 处：{list}', { n: status.cutsTotal, list: cuts.map((k) => `(${k})`).join(' ') })}`
      : '';
    const text = `${parts.join('   ')}\n${t('在烧锅炉 {n} 台 · 在跑机器 {m} 台', { n: status.boilers, m: status.machines })}${cutLine}`;
    if (this.statsEl._gaugeText !== text) {
      this.statsEl._gaugeText = text;
      this.statsEl.textContent = text;
      this.statsEl.style.whiteSpace = 'pre-line';
      this.statsEl.style.color = (status.overLimit || cuts.length) ? '#8a1f1f' : '#333';
    }
    this.reasonEl.textContent = `${t('状态')}：${gaugeText(status.reason)}`;
  }

  // 每帧：进度条 + 原因 + 槽位内容 + 联机刷新
  tick(dt) {
    if (!this.visible || !this.kind) return;
    const g = this.game;
    if (g.networkMode) {
      this._refreshAcc += Math.max(0, dt || 0);
      if (this._refreshAcc >= REFRESH_SEC) {
        this._refreshAcc = 0;
        if (g.industry) g.industry.requestOpen(this.pos);
      }
    }
    const st = this.state();
    const net = g.industry ? g.industry.netInfoAt(this.pos.x, this.pos.y, this.pos.z) : null;
    const status = machineStatus(this.kind, st, net);
    const isGauge = this.kind === 'gauge';
    const pct = Math.round(status.progressFrac * 100);
    if (this.barFill && pct !== this._lastPct) {
      this._lastPct = pct;
      this.barFill.style.width = pct + '%';
    }
    if (status.reason !== this._lastReason) {
      this._lastReason = status.reason;
      this.reasonEl.textContent = `${t('状态')}：${isGauge ? gaugeText(status.reason) : reasonText(status.reason)}`;
    }
    if (isGauge) {
      this._refreshGauge(status);
      return;
    }
    for (const slot of MACHINE_SLOTS[this.kind] || []) {
      const el = this._slotEls.get(slot);
      if (!el) continue;
      this._paintSlot(el, st ? st[slot] : null);
    }
    // 背包变化（服务器回执扣除/放入）也要跟上
    this.panel.querySelectorAll('[data-slot^="main-"]').forEach((el, i) => {
      this._paintSlot(el, g.inventory.slots[9 + i]);
    });
    this.panel.querySelectorAll('[data-slot^="hotbar-"]').forEach((el, i) => {
      this._paintSlot(el, g.inventory.slots[i]);
    });
  }
}