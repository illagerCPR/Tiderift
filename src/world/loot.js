// loot.js -- 确定性战利品与村民交易表（T5）
// 纯函数：内容只由 (seed, 表名, 坐标) / (seed, tradeSeed) 决定——与结构布局同一不变量，
// 任意端/任意时刻生成结果逐字节一致（联机两端箱子内容一致、村民交易一致）。
// 结构 solve 只负责放 chest 方块并在 meta.chests 记录表名；内容在首次打开时惰性生成。
import { hash32, makeRng } from './structures/StructureManager.js';

// 加权条目 [物品名, 最小数量, 最大数量, 权重]
const TABLES = {
  // 村庄民居：食物/种子/日用为主
  village_house: [
    ['bread', 1, 3, 18], ['apple', 1, 3, 14], ['wheat', 2, 6, 14],
    ['wheat_seeds', 2, 6, 12], ['carrot', 2, 5, 10], ['potato', 2, 5, 10],
    ['coal', 2, 5, 12], ['torch', 4, 10, 10], ['iron_ingot', 1, 2, 5],
    ['emerald', 1, 2, 4],
  ],
  // 村庄大厅（big）：更丰富，含稀有品
  village_big: [
    ['bread', 2, 5, 16], ['apple', 2, 4, 12], ['cooked_beef', 2, 4, 12],
    ['iron_ingot', 1, 4, 10], ['coal', 3, 8, 10], ['emerald', 1, 3, 8],
    ['compass', 1, 1, 4], ['saddle', 1, 1, 3], ['golden_apple', 1, 1, 2],
    ['bucket', 1, 1, 4], ['oak_sapling', 2, 4, 6], ['wheat_seeds', 2, 5, 8],
    ['ender_pearl', 1, 1, 2], ['blaze_powder', 1, 2, 2], ['leather', 1, 3, 5],
  ],
  // 要塞枢纽：基础补给
  stronghold_hub: [
    ['bread', 1, 4, 14], ['coal', 3, 8, 14], ['iron_ingot', 1, 3, 10],
    ['torch', 6, 12, 12], ['arrow', 4, 10, 8], ['emerald', 1, 2, 6],
    ['stick', 4, 10, 8], ['ender_pearl', 1, 1, 3], ['blaze_rod', 1, 1, 3],
    ['feather', 2, 5, 6], ['page_rain', 1, 1, 3], // W3：雨潮残页低权（跨维度收集线，§6.2 要塞箱低权）
  ],
  // 要塞图书馆：书类与经验
  stronghold_library: [
    ['book', 1, 3, 20], ['enchanted_book', 1, 1, 4], ['compass', 1, 1, 6], ['book', 1, 2, 12], ['experience_bottle', 1, 3, 8],
    ['emerald', 1, 3, 8], ['apple', 1, 3, 8], ['map', 1, 1, 3],
    ['ender_pearl', 1, 2, 5], ['blaze_rod', 1, 1, 4], ['page_rain', 1, 1, 3], // W3：雨潮残页低权
  ],
  // 要塞储藏室：矿物/弹药
  stronghold_storage: [
    ['iron_ingot', 1, 5, 16], ['gold_ingot', 1, 3, 10], ['coal', 3, 10, 14],
    ['bread', 1, 3, 10], ['arrow', 6, 14, 12], ['string', 1, 4, 8],
    ['emerald', 1, 3, 8], ['bucket', 1, 1, 4], ['redstone', 2, 6, 8],
    ['golden_apple', 1, 1, 2], ['ender_pearl', 1, 2, 5], ['blaze_rod', 1, 2, 4],
    ['leather', 1, 3, 5],
  ],
  // 下界要塞：金饰/烈焰系/稀有矿物（箱子在主堡×2、桥头堡、南桥尽头脑）
  fortress: [
    ['gold_nugget', 2, 6, 14], ['gold_ingot', 1, 3, 10], ['iron_ingot', 1, 3, 8],
    ['coal', 3, 8, 12], ['bone', 1, 4, 10], ['obsidian', 2, 4, 8],
    ['flint', 1, 2, 6], ['blaze_rod', 1, 2, 4], ['golden_apple', 1, 1, 2],
    ['diamond', 1, 1, 2], ['saddle', 1, 1, 2], ['feather', 1, 3, 4],
  ],
  // 末地城：紫珀/矿物/紫颂（箱子在顶层战利品房×2）
  end_city: [
    ['iron_ingot', 1, 4, 12], ['gold_ingot', 1, 3, 10], ['emerald', 1, 3, 10],
    ['diamond', 1, 2, 6], ['chorus_fruit', 2, 6, 14], ['purpur_block', 2, 6, 6],
    ['golden_apple', 1, 1, 3], ['ender_pearl', 1, 2, 6], ['experience_bottle', 1, 3, 6],
    ['saddle', 1, 1, 2],
  ],
  // 末地船（货舱）：矿物为主
  end_ship: [
    ['iron_ingot', 2, 6, 12], ['gold_ingot', 1, 4, 10], ['diamond', 1, 3, 8],
    ['emerald', 2, 5, 10], ['chorus_fruit', 3, 8, 12], ['ender_pearl', 1, 3, 8],
    ['experience_bottle', 2, 4, 8], ['obsidian', 2, 4, 6],
  ],
  // 末地船船长箱：鞘翅必出（FORCED 表驱动，杂项仍走加权抽取）
  end_ship_captain: [
    ['diamond', 1, 3, 10], ['emerald', 2, 6, 10], ['golden_apple', 1, 2, 8],
    ['experience_bottle', 2, 5, 8], ['ender_pearl', 1, 3, 8], ['iron_ingot', 3, 8, 10],
  ],
  // 拾遗者石环：拾遗者的收藏（世界观批次 E2，箱在中央圆台旁×1）——界壁拾得物
  gleaner_ring: [
    ['chorus_fruit', 2, 6, 14], ['ender_pearl', 1, 3, 10], ['iron_ingot', 1, 4, 10],
    ['gold_ingot', 1, 3, 8], ['emerald', 1, 3, 8], ['experience_bottle', 1, 3, 8],
    ['obsidian', 2, 5, 6], ['purpur_block', 2, 5, 6], ['end_stone_bricks', 2, 6, 6],
    ['diamond', 1, 1, 3], ['ender_eye', 1, 1, 2],
  ],
  // 鲸骨冢（鲸骨冢篇 K1）：考古收获——星髓/云絮/常规贵重，零 FORCED 依赖线
  whale_barrow: [
    ['star_marrow', 2, 4, 12], ['cloud_fluff', 2, 5, 10], ['iron_ingot', 2, 5, 10],
    ['gold_ingot', 1, 4, 8], ['emerald', 1, 3, 8], ['experience_bottle', 2, 4, 8],
    ['glowstone', 2, 4, 6], ['quartz_block', 2, 5, 6], ['bread', 1, 3, 6],
    ['diamond', 1, 2, 3], ['golden_apple', 1, 1, 2],
  ],
  // 天空神殿：金饰/钻石/发光系（箱子在殿内对角×2）——批次 B 增补裂潮残页/星髓
  aether_temple: [
    ['golden_apple', 1, 2, 6], ['diamond', 1, 3, 8], ['gold_ingot', 2, 5, 12],
    ['iron_ingot', 2, 6, 12], ['emerald', 1, 3, 10], ['glowstone', 2, 6, 10],
    ['sea_lantern', 1, 3, 8], ['experience_bottle', 2, 5, 10], ['bread', 1, 3, 10],
    ['quartz_block', 2, 6, 8], ['page_sunder', 1, 1, 4], ['star_marrow', 1, 2, 5],
  ],
  // 浮空瞭望塔：巡逻补给（顶部瞭望台单箱）——批次 B 增补云絮/涨潮残页
  aether_tower: [
    ['bread', 1, 3, 16], ['arrow', 4, 12, 12], ['coal', 3, 8, 12],
    ['iron_ingot', 1, 3, 10], ['emerald', 1, 2, 8], ['torch', 4, 8, 10],
    ['apple', 1, 3, 10], ['experience_bottle', 1, 2, 6], ['feather', 2, 4, 6],
    ['cloud_fluff', 1, 3, 10], ['page_rising', 1, 1, 5],
  ],
  // 天域沉船：远航货物（甲板/舱室两箱）——批次 B 增补星髓残页/星髓
  aether_ship: [
    ['iron_ingot', 2, 6, 12], ['gold_ingot', 1, 4, 10], ['diamond', 1, 2, 6],
    ['emerald', 1, 4, 10], ['bread', 2, 5, 12], ['experience_bottle', 1, 3, 8],
    ['glowstone', 1, 4, 8], ['ender_pearl', 1, 1, 4],
    ['page_marrow', 1, 1, 6], ['star_marrow', 1, 2, 6],
  ],
  // 天域瞭望塔/神殿批次 B 增补：云絮与残页（叙事收集线）——已并入上方对应表
  // 潮工断坊（B53 R4）：工业起步包——铁/铜/煤/红石 + 石料，桶由 FORCED 保底
  tide_workshop: [
    ['iron_ingot', 2, 4, 16], ['copper_ingot', 2, 5, 14], ['coal', 4, 9, 14],
    ['redstone', 2, 6, 12], ['cobblestone', 6, 14, 10], ['flint', 1, 3, 8],
    ['stick', 3, 8, 8], ['torch', 3, 6, 6], ['iron_ingot_raw', 1, 3, 5],
  ],
  // 天空神殿·内殿圣所（批次 B）：星髓 FORCED 保底 + 裂潮残页 + 神殿档次杂项
  aether_sanctum: [
    ['golden_apple', 1, 2, 8], ['diamond', 1, 3, 10], ['emerald', 2, 4, 10],
    ['gold_ingot', 2, 6, 12], ['glowstone', 2, 5, 10], ['quartz_block', 2, 6, 10],
    ['experience_bottle', 2, 5, 10], ['cloud_fluff', 2, 5, 12], ['page_sunder', 1, 1, 10],
  ],
  // 下界·烬火纪（世界观批次 N2）：潮火之炉炉侧房——坠潮遗物 + 下界常规
  tidefire_hearth: [
    ['gold_nugget', 2, 6, 12], ['gold_ingot', 1, 4, 10], ['coal', 3, 8, 12],
    ['soul_sand', 2, 5, 10], ['glowstone', 1, 4, 10], ['obsidian', 1, 3, 8],
    ['bone', 1, 4, 10], ['blaze_rod', 1, 2, 6], ['golden_apple', 1, 1, 3],
    ['diamond', 1, 2, 4],
  ],
  // 潮冢（世界观批次 W2）：雨土纪河床遗骸坑——旧潮遗物 + 跨维度收集线低权
  tide_barrow: [
    ['bone', 2, 5, 12], ['clay_ball', 2, 6, 10], ['coal', 2, 6, 10],
    ['iron_ingot', 1, 3, 10], ['gold_nugget', 2, 6, 10], ['star_marrow', 1, 2, 8],
    ['emerald', 1, 2, 6], ['book', 1, 1, 5], ['ender_pearl', 1, 1, 4],
    ['golden_apple', 1, 1, 2], ['diamond', 1, 1, 3],
  ],
};

// 必出项（表名 → [物品, min, max] 列表）：占用最低序槽位，消耗同一 rng 流。
// 旧表无条目 → rng 流与行为完全不变（联机箱子内容一致性不受影响）。
const FORCED = {
  end_ship_captain: [['elytra', 1, 1]],
  aether_sanctum: [['star_marrow', 2, 4]], // 批次 B：内殿圣所星髓保底（新表，不影响旧表流）
  tidefire_hearth: [['mourn_tear', 1, 2]], // 世界观批次 N2：哀潮之泪保底（跨维度收集线材料）
  tide_barrow: [['page_rain', 1, 1]], // 世界观批次 W2：雨潮残页保底（跨维度收集线材料）
  tide_workshop: [['bucket', 1, 1]], // B53 R4：锅炉要桶装水——断坊保底给一只桶
};

// 生成箱子内容：27 槽数组（索引 0-26），空槽为 null
export function chestLoot(seed, tableName, x, y, z) {
  const slots = new Array(27).fill(null);
  const table = TABLES[tableName];
  if (!table) return slots;
  const live = table.filter(e => e[3] > 0);
  if (!live.length) return slots;
  const rng = makeRng(hash32(seed | 0, x * 31 + y, z * 17 + y, 4242));
  const totalW = live.reduce((s, e) => s + e[3], 0);
  const used = new Set();
  // 必出项：先占用最低序槽（消耗同一 rng 流；无必出项的表流不变）
  const forced = FORCED[tableName] || [];
  for (const f of forced) {
    const n = f[1] + Math.floor(rng() * (f[2] - f[1] + 1));
    slots[used.size] = { name: f[0], count: n, data: null };
    used.add(used.size);
  }
  const groups = 4 + Math.floor(rng() * 4); // 4-7 组
  for (let k = 0; k < groups; k++) {
    let roll = rng() * totalW;
    let pick = live[live.length - 1];
    for (const e of live) { roll -= e[3]; if (roll <= 0) { pick = e; break; } }
    const n = pick[1] + Math.floor(rng() * (pick[2] - pick[1] + 1));
    // 槽位重摇 24 次必终止（确定性：重摇也走同一 rng 流）
    let slot = -1;
    for (let t = 0; t < 24; t++) {
      const cand = Math.floor(rng() * 27);
      if (!used.has(cand)) { slot = cand; break; }
    }
    if (slot < 0) continue;
    used.add(slot);
    slots[slot] = { name: pick[0], count: n, data: null };
  }
  return slots;
}

// ── 村民交易 ─────────────────────────────────────────────────────────────
// 每个村民固定 3 收购（玩家给物品换绿宝石）+ 3 出售（绿宝石换物品）。
// tradeSeed 由 (村庄锚点, 生成序号) 派生，随 mob_spawn 广播（客户端无需反查村庄）。

// 交易种子派生：单机与 host 广播共用同一函数（联机一致性关键——勿在调用处各自造哈希）
export function villagerTradeSeed(ax, az, index) {
  return hash32(ax | 0, az | 0, index | 0, 555) >>> 0;
}

const BUY_POOL = [   // [给村民的物品, min, max]
  ['wheat', 16, 24], ['coal', 12, 20], ['carrot', 14, 22],
  ['potato', 14, 22], ['beef', 6, 10], ['white_wool', 10, 16],
  ['apple', 8, 14],
];
const SELL_POOL = [  // [村民给的物品, emerald 价, min, max]
  ['bread', 1, 4, 6], ['arrow', 1, 8, 16], ['torch', 2, 16, 24],
  ['iron_ingot', 3, 2, 4], ['apple', 1, 3, 5], ['compass', 4, 1, 1],
  ['golden_apple', 5, 1, 1], ['cooked_beef', 2, 4, 8], ['experience_bottle', 2, 2, 4],
];

function pickUnique(rng, pool, used, count) {
  const out = [];
  for (let t = 0; t < 40 && out.length < count; t++) {
    const e = pool[Math.floor(rng() * pool.length)];
    if (used.has(e[0])) continue;
    used.add(e[0]);
    out.push(e);
  }
  return out;
}

export function villagerTrades(seed, tradeSeed) {
  const rng = makeRng(hash32(seed | 0, tradeSeed | 0, (tradeSeed | 0) ^ 0x9e37, 4747));
  const buys = pickUnique(rng, BUY_POOL, new Set(), 3).map(([name, lo, hi]) => {
    const n = lo + Math.floor(rng() * (hi - lo + 1));
    return { give: { name, count: n }, get: { name: 'emerald', count: 1 } };
  });
  const sells = pickUnique(rng, SELL_POOL, new Set(), 3).map(([name, price, lo, hi]) => {
    const n = lo + Math.floor(rng() * (hi - lo + 1));
    return { give: { name: 'emerald', count: price }, get: { name, count: n } };
  });
  return [...buys, ...sells];
}
