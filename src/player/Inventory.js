// Inventory.js -- 背包系统
// 盔甲槽：armor[0..3] = 头/胸/腿/靴（armorSlot: head/chest/legs/feet），armorPoints 由物品 def 提供
export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'];

export class Inventory {
  constructor(size = 36) {
    this.size = size;
    this.slots = new Array(size).fill(null); // {name, count, data?}
    this.armor = new Array(4).fill(null);
    this.hotbarSelected = 0;
  }

  getSelected() {
    return this.slots[this.hotbarSelected];
  }

  setSelected(index) {
    this.hotbarSelected = Math.max(0, Math.min(8, index));
  }

  // 添加物品，返回剩余未放入数量
  add(name, count = 1, data = null) {
    let remaining = count;
    // 先堆叠到已有（带 data 的物品不堆叠——潜影盒等内容跟随物品，混叠会串内容）
    for (let i = 0; i < this.size && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.name === name && s.count < 64 && !s.data && !data) {
        const add = Math.min(64 - s.count, remaining);
        s.count += add;
        remaining -= add;
      }
    }
    // 再放入空槽
    for (let i = 0; i < this.size && remaining > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(64, remaining);
        this.slots[i] = { name, count: add, data };
        remaining -= add;
      }
    }
    return remaining;
  }

  // 从选中槽移除
  removeSelected(count = 1) {
    const s = this.slots[this.hotbarSelected];
    if (!s) return null;
    const removed = { ...s, count: Math.min(count, s.count) };
    s.count -= removed.count;
    if (s.count <= 0) this.slots[this.hotbarSelected] = null;
    return removed;
  }

  removeSlot(index, count = 1) {
    const s = this.slots[index];
    if (!s) return null;
    const removed = { ...s, count: Math.min(count, s.count) };
    s.count -= removed.count;
    if (s.count <= 0) this.slots[index] = null;
    return removed;
  }

  // 阶段10：按名称从背包扣除（deny 回滚用），从末尾槽向前扣；返回实际扣除数量
  removeItems(name, count = 1, data = undefined) {
    let left = count;
    const dataKey = data === undefined ? null : JSON.stringify(data ?? null);
    for (let i = this.size - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.name === name && (data === undefined || JSON.stringify(s.data ?? null) === dataKey)) {
        const take = Math.min(s.count, left);
        s.count -= take;
        left -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return count - left;
  }

  swap(i, j) {
    const t = this.slots[i];
    this.slots[i] = this.slots[j];
    this.slots[j] = t;
  }

  serialize() {
    const enc = (s) => s ? { n: s.name, c: s.count, d: s.data } : null;
    // V2：对象形 {slots, armor}；旧版数组形仅 slots（deserialize 双形兼容）
    return { slots: this.slots.map(enc), armor: this.armor.map(enc) };
  }

  deserialize(data) {
    if (!data) return;
    const legacy = Array.isArray(data);
    const slots = legacy ? data : data.slots;
    if (Array.isArray(slots)) {
      for (let i = 0; i < this.size; i++) {
        const s = slots[i];
        this.slots[i] = s ? { name: s.n, count: s.c, data: s.d } : null;
      }
    }
    const armor = legacy ? null : data.armor;
    if (Array.isArray(armor)) {
      for (let i = 0; i < 4; i++) {
        const s = armor[i];
        this.armor[i] = s ? { name: s.n, count: s.c, data: s.d } : null;
      }
    }
  }
}
