// content/industry/defs.js -- 工业（潮工）内容定义与平衡表（Build 51 R3 起 / Build 52 扩展）
// 纯数据模块：方块名 / 潮压平衡 / 破碎与切割配方 / 副产物 / 预算。
// 纪律：
//   ① 所有方块/物品名是**代码 ID**，一经落地不随显示名变动；显示名走 NAME_I18N（11 语）。
//   ② 数值集中在本文件，单机与服务器共用同一张表（server/industry.js 只再加方块 id 表）。
//   ③ 内容归属 = requiresExtras: ['industry']（只决定启用，不影响注册顺序）。
export const INDUSTRY_EXTRA = 'industry';

export const BOILER_BLOCK = 'tide_boiler';   // 潮压锅炉：燃料 + 桶装水 → 潮压
export const SHAFT_BLOCK = 'drive_shaft';   // 传动轴：六邻接组成有界机械网络
export const CRUSHER_BLOCK = 'crusher';     // 碎石机：圆石→砾石、砾石→沙
export const CUTTER_BLOCK = 'tide_cutter';  // 潮压切割机（B52）：原木→木板、石料→石砖、骨→骨粉
export const CLUTCH_BLOCK = 'drive_clutch'; // 离合闸（B52）：红石信号优先切断，无信号时按手动拨杆
export const GAUGE_BLOCK = 'pressure_gauge'; // 潮压表（B53 R3）：只读仪表，显示供需/效率/断路位置

// 方块名 → 机器种类（kind 是运行期身份，方块变体/朝向不改变它）
export const INDUSTRY_BLOCK_KIND = Object.freeze({
  [BOILER_BLOCK]: 'boiler',
  [SHAFT_BLOCK]: 'shaft',
  [CRUSHER_BLOCK]: 'crusher',
  [CUTTER_BLOCK]: 'cutter',
  [CLUTCH_BLOCK]: 'clutch',
  [GAUGE_BLOCK]: 'gauge',
});

// ── 潮压平衡（首版，实施后用基准测试复评）──────────────────────────────────
// 供给 = 所有在烧锅炉的 BOILER_SUPPLY 之和；需求 = 所有有活可干的加工机 DEMAND 之和。
// 供给不足时全网按同一效率降速（efficiency = min(1, supply / demand)）；无供给不推进。
// 不储存能量、不积累欠账：熄火即停，重载不追赶离线生产。
export const BOILER_SUPPLY = 4;        // 每台在烧锅炉每秒提供的潮压
export const CRUSHER_DEMAND = 2;       // 每台工作中的碎石机每秒消耗的潮压
export const CUTTER_DEMAND = 3;        // 每台工作中的切割机每秒消耗的潮压（切口更细，更费压）
export const CRUSH_TIME = 4;           // 碎石机处理一个物品所需秒数（满效率）
export const CUT_TIME = 3;             // 切割机处理一个物品所需秒数（满效率）
export const IDLE_DECAY_PER_SEC = 2;   // 停机时进度回退速率（秒/秒）

// 每台机器满效率时的需求；发电机 / 传动 / 闸门不消耗潮压。
// 供需公式与机器界面读同一张表——不要在 UI 或服务器里再写第二份数字。
export const MACHINE_DEMAND = Object.freeze({
  boiler: 0,
  shaft: 0,
  clutch: 0,
  gauge: 0, // 只读仪表：不耗压、不产压，只把读数摆出来
  crusher: CRUSHER_DEMAND,
  cutter: CUTTER_DEMAND,
});

// ── 预算 ────────────────────────────────────────────────────────────────
export const NETWORK_MAX_NODES = 128;     // 单个机械网络节点上限（超限整网不工作）
export const INDUSTRY_BLOCK_LIMIT = 512;  // 每房间（联机）/ 每维度（单机）工业方块上限
export const MACHINE_SLOT_LIMIT = 64;     // 机器槽位堆叠上限（不承接带 data 物品）

// ── 节拍 ────────────────────────────────────────────────────────────────
export const INDUSTRY_TICK_MS = 200;   // 权威推进节拍（单机本地 / 服务器 sweep）
export const INDUSTRY_SYNC_MS = 500;   // 活动机器进度向全房同步的节拍（槽位变化即时广播）

// ── 碎石配方（B51：圆石→砾石、砾石→沙）──────────────────────────────────
// name -> { output, count }
export const CRUSH_RECIPES = Object.freeze({
  cobblestone: Object.freeze({ output: 'gravel', count: 1 }),
  gravel: Object.freeze({ output: 'sand', count: 1 }),
});

// ── 切割配方（B52：原木出板率高于手工、骨材出粉、石料整形）──────────────────
// 与碎石机是**两张独立的配方类型**：方块种类决定认哪张表，两张表不互相回退。
export const CUT_RECIPES = Object.freeze({
  oak_log: Object.freeze({ output: 'oak_planks', count: 6 }),
  spruce_log: Object.freeze({ output: 'spruce_planks', count: 6 }),
  birch_log: Object.freeze({ output: 'birch_planks', count: 6 }),
  dark_oak_log: Object.freeze({ output: 'dark_oak_planks', count: 6 }),
  acacia_log: Object.freeze({ output: 'acacia_planks', count: 6 }),
  stone: Object.freeze({ output: 'stone_bricks', count: 1 }),
  bone: Object.freeze({ output: 'bone_meal', count: 3 }),
});

// ── 有限副产物（B52）─────────────────────────────────────────────────────
// 每 F 个成品多出 1 个副产物，计数存在机器状态里（确定性，不用随机数）。
// 副产物进独立的 bonus 槽：不与主产物混栈，满了就丢掉这一次（不积累欠账）。
export const CRUSH_BYPRODUCTS = Object.freeze({
  cobblestone: Object.freeze({ name: 'flint', every: 8 }),
  gravel: Object.freeze({ name: 'clay_ball', every: 8 }),
});

// ── 机器槽位布局（UI 与服务器校验共用）───────────────────────────────────
export const MACHINE_SLOTS = Object.freeze({
  boiler: Object.freeze(['fuel', 'water', 'output']),
  crusher: Object.freeze(['input', 'output', 'bonus']),
  cutter: Object.freeze(['input', 'output', 'bonus']),
  gauge: Object.freeze([]), // B53 R3：仪表没有槽位，界面只显示读数
});

export function crushRecipeFor(name) {
  return (name && CRUSH_RECIPES[name]) || null;
}

export function cutRecipeFor(name) {
  return (name && CUT_RECIPES[name]) || null;
}

// 加工机按种类取配方（碎石机只认碎石表、切割机只认切割表）
export function processorRecipeFor(kind, name) {
  if (kind === 'cutter') return cutRecipeFor(name);
  if (kind === 'crusher') return crushRecipeFor(name);
  return null;
}

// 加工时间（秒）：满效率下处理一个物品
export function processorTime(kind) {
  return kind === 'cutter' ? CUT_TIME : CRUSH_TIME;
}

export function crushByproductFor(name) {
  return (name && CRUSH_BYPRODUCTS[name]) || null;
}

// 机器界面要展示的配方表（配方 + 时间 + 副产物），单机/服务器/UI 同源
export function recipesFor(kind) {
  const table = kind === 'cutter' ? CUT_RECIPES : (kind === 'crusher' ? CRUSH_RECIPES : null);
  if (!table) return [];
  const out = [];
  for (const [input, r] of Object.entries(table)) {
    const bp = kind === 'crusher' ? crushByproductFor(input) : null;
    out.push({ input, output: r.output, count: r.count, time: processorTime(kind), byproduct: bp });
  }
  return out;
}
