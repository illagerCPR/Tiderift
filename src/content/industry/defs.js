// content/industry/defs.js -- 工业（潮工）内容定义与平衡表（Build 51 R3）
// 纯数据模块：方块名 / 潮压平衡 / 碎石配方 / 预算。
// 纪律：
//   ① 所有方块/物品名是**代码 ID**，一经落地不随显示名变动；显示名走 NAME_I18N（11 语）。
//   ② 数值集中在本文件，单机与服务器共用同一张表（server/industry.js 只再加方块 id 表）。
//   ③ 内容归属 = requiresExtras: ['industry']（只决定启用，不影响注册顺序）。
export const INDUSTRY_EXTRA = 'industry';

export const BOILER_BLOCK = 'tide_boiler';   // 潮压锅炉：燃料 + 桶装水 → 潮压
export const SHAFT_BLOCK = 'drive_shaft';   // 传动轴：六邻接组成有界机械网络
export const CRUSHER_BLOCK = 'crusher';     // 碎石机：圆石→砾石、砾石→沙

// 方块名 → 机器种类（kind 是运行期身份，方块变体/朝向不改变它）
export const INDUSTRY_BLOCK_KIND = Object.freeze({
  [BOILER_BLOCK]: 'boiler',
  [SHAFT_BLOCK]: 'shaft',
  [CRUSHER_BLOCK]: 'crusher',
});

// ── 潮压平衡（首版，实施后用基准测试复评）──────────────────────────────────
// 供给 = 所有在烧锅炉的 BOILER_SUPPLY 之和；需求 = 所有有活可干的碎石机 CRUSHER_DEMAND 之和。
// 供给不足时全网按同一效率降速（efficiency = min(1, supply / demand)）；无供给不推进。
// 不储存能量、不积累欠账：熄火即停，重载不追赶离线生产。
export const BOILER_SUPPLY = 4;        // 每台在烧锅炉每秒提供的潮压
export const CRUSHER_DEMAND = 2;       // 每台工作中的碎石机每秒消耗的潮压
export const CRUSH_TIME = 4;           // 碎石机处理一个物品所需秒数（满效率）
export const IDLE_DECAY_PER_SEC = 2;   // 停机时进度回退速率（秒/秒）

// ── 预算 ────────────────────────────────────────────────────────────────
export const NETWORK_MAX_NODES = 128;     // 单个机械网络节点上限（超限整网不工作）
export const INDUSTRY_BLOCK_LIMIT = 512;  // 每房间（联机）/ 每维度（单机）工业方块上限

// ── 节拍 ────────────────────────────────────────────────────────────────
export const INDUSTRY_TICK_MS = 200;   // 权威推进节拍（单机本地 / 服务器 sweep）
export const INDUSTRY_SYNC_MS = 500;   // 活动机器进度向全房同步的节拍（槽位变化即时广播）

// ── 碎石配方（首版按计划 §8.2：圆石→砾石、砾石→沙）──────────────────────
// name -> { output, count }
export const CRUSH_RECIPES = Object.freeze({
  cobblestone: Object.freeze({ output: 'gravel', count: 1 }),
  gravel: Object.freeze({ output: 'sand', count: 1 }),
});

// 槽位上限（工业机器只用无 data 的 64 堆叠槽，不承接潜影盒等带数据物品）
export const MACHINE_SLOT_LIMIT = 64;

export function crushRecipeFor(name) {
  return (name && CRUSH_RECIPES[name]) || null;
}
