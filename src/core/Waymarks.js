// Waymarks.js -- 天域旧航路航标进度（Build 34 B）
// 归属：房间共享状态（多人分头收集材料，进度以房间为准）。单机随存档，联机由服务器权威记录并广播。
// 键 = "锚点x,锚点z"：天域 + 结构类型（aether_tower）由调用方保证，维度不重复进键。
// 本模块保持纯净（不 import 注册表），node 测试可直接导入。
export const WAYMARK_STAGE_LIMIT = 3;
export const WAYMARK_LIMIT = 96;
export const WAYMARK_NAME_MAX = 24;

// 三阶段：提交顺序固定，每阶段只接受一次有效提交。
// needs[].name 是背包槽位名（方块与物品共用命名空间）。
export const WAYMARK_STAGES = [
  { stage: 1, title: '重燃航标灯', hint: '把荧石嵌回塔顶四角，让旧灯重新记住潮的路。', needs: [{ name: 'glowstone', count: 4 }] },
  { stage: 2, title: '校准航向', hint: '以罗盘与铁锭校平航标台，使它指向下一座岛。', needs: [{ name: 'compass', count: 1 }, { name: 'iron_ingot', count: 4 }] },
  { stage: 3, title: '点亮航标芯', hint: '把云绒与石英压进航标芯，让旧航路重新亮起。', needs: [{ name: 'cloud_fluff', count: 4 }, { name: 'quartz', count: 8 }] },
];

const KEY_RE = /^-?\d{1,9},-?\d{1,9}$/;

export function waymarkKey(ax, az) {
  return `${Math.floor(ax)},${Math.floor(az)}`;
}

export function isValidWaymarkKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

export function cleanWaymarkStage(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= WAYMARK_STAGE_LIMIT ? n : 0;
}

export function cleanWaymarkName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, WAYMARK_NAME_MAX);
}

// 阶段定义（stage 由 1 起）；越界返回 null
export function waymarkStageDef(stage) {
  return WAYMARK_STAGES[stage - 1] || null;
}

export class Waymarks {
  constructor(game = null) {
    this.game = game;
    this.towers = new Map(); // "ax,az" -> { stage, byName }
  }

  // 旧档/旧联机档案缺字段时传 null → 回落为空进度。
  // 同时接受 { towers: {key: {stage, byName}} } 与扁平 { key: stage } 两种形态（后者为早期实验格式）。
  reset(raw) {
    this.towers.clear();
    if (!raw || typeof raw !== 'object') return this;
    const src = raw.towers && typeof raw.towers === 'object' ? raw.towers : raw;
    for (const [key, value] of Object.entries(src)) {
      if (!isValidWaymarkKey(key)) continue;
      if (value && typeof value === 'object') {
        const stage = cleanWaymarkStage(value.stage);
        if (stage <= 0) continue;
        this.towers.set(key, { stage, byName: cleanWaymarkName(value.byName) });
      } else {
        const stage = cleanWaymarkStage(value);
        if (stage <= 0) continue;
        this.towers.set(key, { stage, byName: '' });
      }
      if (this.towers.size >= WAYMARK_LIMIT) break;
    }
    return this;
  }

  serialize() {
    const towers = {};
    for (const [key, value] of this.towers) {
      towers[key] = { stage: value.stage, byName: value.byName };
    }
    return { towers };
  }

  clear() {
    this.towers.clear();
  }

  get size() {
    return this.towers.size;
  }

  stageAt(ax, az) {
    const rec = this.towers.get(waymarkKey(ax, az));
    return rec ? rec.stage : 0;
  }

  isRepaired(ax, az) {
    return this.stageAt(ax, az) >= WAYMARK_STAGE_LIMIT;
  }

  // 只接受严格递增的阶段性写入（服务器权威值与本地推进共用）；返回是否发生变化
  setStage(ax, az, stage, byName = '') {
    const key = waymarkKey(ax, az);
    const next = cleanWaymarkStage(stage);
    const cur = this.towers.get(key);
    if (next <= 0) return false;
    if (cur && cur.stage >= next) return false;
    if (!cur && this.towers.size >= WAYMARK_LIMIT) return false;
    this.towers.set(key, { stage: next, byName: cleanWaymarkName(byName) });
    return true;
  }

  entries() {
    return [...this.towers.entries()].map(([key, value]) => ({ key, stage: value.stage, byName: value.byName }));
  }

  // 是否具备某阶段材料；返回缺口列表 [{ name, count, have }]（空数组 = 齐备）
  missingFor(stage, inventory) {
    const def = waymarkStageDef(stage);
    if (!def) return [];
    const slots = (inventory && inventory.slots) || [];
    const out = [];
    for (const need of def.needs) {
      let have = 0;
      for (const slot of slots) {
        if (slot && slot.name === need.name) have += slot.count || 0;
      }
      if (have < need.count) out.push({ name: need.name, count: need.count, have });
    }
    return out;
  }
}
