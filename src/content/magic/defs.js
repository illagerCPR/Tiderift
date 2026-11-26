// content/magic/defs.js -- 魔法（四潮回响）内容定义与平衡表（Build 51 R4 / B54 R1 四系齐备）
// 纯数据：方块/物品名、回响资源、法术表与预算。算法与运行态在 src/core/Magic.js 与 src/player/MagicSystem.js。
// 纪律：
//   ① 代码 ID 一经落地不随显示名变动；显示名走 NAME_I18N（11 语）。
//   ② 数值集中在本文件，单机与服务器共用同一张表（服务器只做范围/频率校验）。
//   ③ 归属 = requiresExtras: ['magic']；关闭魔法的世界没有配方、HUD 与施法能力。
export const MAGIC_EXTRA = 'magic';

export const TABLE_BLOCK = 'resonance_table'; // 回响仪台：经验调谐 + 焦点制作
export const ECHO_DUST_ITEM = 'echo_dust';    // 回响尘：焦点与仪台的材料
export const GALE_FOCUS_ITEM = 'gale_focus';  // 风潮焦点：风步
export const EMBER_FOCUS_ITEM = 'ember_focus'; // 坠潮焦点：烬矢
export const RAIN_FOCUS_ITEM = 'rain_focus';  // 雨潮焦点：回潮（B54）
export const TIDELESS_FOCUS_ITEM = 'tideless_focus'; // 无潮焦点：折步（B54）

// 进阶焦点（B55 R2）：把回响残片刻进基础焦点得到，一枚残片只够刻一支（选择留给玩家）
export const GALE_CROSS_FOCUS_ITEM = 'gale_cross_focus';   // 风渡
export const EMBER_RING_FOCUS_ITEM = 'ember_ring_focus';   // 烬环
export const TIDE_WARD_FOCUS_ITEM = 'tide_ward_focus';     // 潮护
export const VOID_DASH_FOCUS_ITEM = 'void_dash_focus';     // 长折

// 回响残片：只从四维回响遗迹来（B55 R1）；一枚残片刻一支进阶焦点
export const ECHO_SHARD_ITEM = 'echo_shard';

// 纹样加工表（B56 R1）：基础焦点 + 回响残片 → 进阶焦点。
// **单一真相**：手工（工作台的 shapeless 配方）与刻纹压印机都读这张表——
// 机器只是同一件事的自动化，配方与扣料不得各写一份（计划 §6.5 末条）。
export const INSCRIBE_RECIPES = Object.freeze({
  [GALE_FOCUS_ITEM]: GALE_CROSS_FOCUS_ITEM,
  [EMBER_FOCUS_ITEM]: EMBER_RING_FOCUS_ITEM,
  [RAIN_FOCUS_ITEM]: TIDE_WARD_FOCUS_ITEM,
  [TIDELESS_FOCUS_ITEM]: VOID_DASH_FOCUS_ITEM,
});

// 基础焦点 → 进阶焦点（不在表里返回 null）
export function inscribeOutput(focusName) {
  return (focusName && INSCRIBE_RECIPES[focusName]) || null;
}

// ── 回响资源 ────────────────────────────────────────────────────────────
export const ECHO_MAX = 100;
export const ECHO_PER_LEVEL = 25;      // 仪台调谐：1 级经验 → 25 回响
export const ECHO_REGEN_SECONDS = 6;   // 脱战自然恢复：每 6 秒 +1（防卡死兜底，不替代主动调谐）
export const ECHO_REGEN_DELAY = 4;     // 施法后 4 秒内不自然恢复（脱战判定）

// ── 蓄力（B54 R2）──────────────────────────────────────────────────────
// 按住右键蓄力、松手施放；charge 0 = 基础值，1 = 该法术 charged 表里的上限值。
// 费用与冷却不随蓄力变化（蓄力买到的是效果，代价是时间与站桩）。
export const CHARGE_FULL_SECONDS = 1.0;

// ── 施法失败码 → 提示文案键（B54 R2 统一出口；UI 只认这张表）──────────────
export const CAST_FAIL_TEXT = Object.freeze({
  disabled: '这个世界没有回响',
  'no-focus': '需要手持回响焦点',
  'wrong-focus': '手中的焦点不对应这个法术',
  mode: '创造/旁观模式不能施法',
  echo: '回响不足',
  cooldown: '法术还在冷却',
  target: '那里没有可落的空隙',
  wounded: '身上没有需要回潮的伤',
  unknown: '未知的法术',
});
export const CAST_FAIL_CODES = Object.freeze(Object.keys(CAST_FAIL_TEXT));

// ── 法术表 ──────────────────────────────────────────────────────────────
// id -> { focus, cost, cooldown, ... }；四个基础方向各一支（B54 R1 起四系齐备）：
//   风潮 gale_step / 坠潮 ember_bolt / 雨潮 tide_mend / 无潮 void_step。
// `charged` = 满蓄力时的上限值（B54 R2）；未列出的字段不随蓄力变化。
export const SPELLS = Object.freeze({
  gale_step: Object.freeze({
    id: 'gale_step',
    focus: GALE_FOCUS_ITEM,
    name: '风步',
    cost: 15,
    cooldown: 3,
    distance: 6,        // 冲刺距离（格）；沿视线，碰撞裁剪，不穿墙
    slowFall: 2.5,      // 落地前缓降时长（秒）；蓄力后更长（满蓄 5s）
    slowFallVy: -3,     // 缓降时下落速度上限（m/s）
    charged: Object.freeze({ distance: 8, slowFall: 5 }),
  }),
  ember_bolt: Object.freeze({
    id: 'ember_bolt',
    focus: EMBER_FOCUS_ITEM,
    name: '烬矢',
    cost: 10,
    cooldown: 1.2,
    damage: 6,          // 单发伤害（只结算一次，不点燃地形、不炸方块）；满蓄 10
    speed: 28,          // m/s
    life: 1.4,          // 秒
    radius: 0.35,       // 命中半径（球体检测，与箭同口径）
    charged: Object.freeze({ damage: 10 }),
  }),
  // 雨潮·回潮：自我恢复 + 短暂防护。边界：不超过生命上限、不生成水、不在创造/旁观生效。
  tide_mend: Object.freeze({
    id: 'tide_mend',
    focus: RAIN_FOCUS_ITEM,
    name: '回潮',
    cost: 20,
    cooldown: 8,
    heal: 6,            // 恢复量（按缺失量裁剪，满血施放直接拒绝且不扣回响）；满蓄 10
    guardEffect: 'resistance', // 复用既有状态效果（每级 -20% 伤害），不新造第四套 buff
    guardLevel: 1,
    guardSeconds: 6,    // 满蓄 10 秒
    charged: Object.freeze({ heal: 10, guardSeconds: 10 }),
  }),
  // 无潮·折步：向可见落点短距折跃。边界：不跨维、不穿墙、不落未加载区块、不落在实心格里。
  void_step: Object.freeze({
    id: 'void_step',
    focus: TIDELESS_FOCUS_ITEM,
    name: '折步',
    cost: 25,
    cooldown: 6,
    distance: 8,        // 最大折跃距离（格）；满蓄 10
    standDepth: 3,      // 落点脚下多少格内有可站立面
    step: 0.25,         // 探针步长（格）
    charged: Object.freeze({ distance: 10 }),
  }),
});

export const SPELL_IDS = Object.freeze(Object.keys(SPELLS));

// ── 进阶法术表（B55 R2）：四潮各一支，用同一套 handler 分派 ──────────────────
// 纪律：进阶不是新方向，是把本潮的基础能力推到安全上限——不碰地形/水位/时间/传送门/跨维；
// `handler` 指向基础法术的施法函数（MagicSystem._execute 按 handler 分派），
// 费用与冷却都高于基础版，基础版因此不会被彻底取代。
export const ADVANCED_SPELLS = Object.freeze({
  // 风潮·风渡：更远的冲刺 + 更长的漂浮（下落更慢，慢到能看清脚下的地形）
  gale_cross: Object.freeze({
    id: 'gale_cross',
    focus: GALE_CROSS_FOCUS_ITEM,
    handler: 'gale_step',
    name: '风渡',
    cost: 22,
    cooldown: 8,
    distance: 10,
    slowFall: 8,
    slowFallVy: -1.5,
    charged: Object.freeze({ distance: 13, slowFall: 12 }),
  }),
  // 坠潮·烬环：更重的一发，命中时溅开一圈余烬（只伤怪物，不打玩家、不炸方块）
  ember_ring: Object.freeze({
    id: 'ember_ring',
    focus: EMBER_RING_FOCUS_ITEM,
    handler: 'ember_bolt',
    name: '烬环',
    cost: 20,
    cooldown: 3,
    damage: 12,
    speed: 26,
    life: 1.4,
    radius: 0.5,
    splash: Object.freeze({ radius: 3.2, damage: 5, maxTargets: 2 }),
    charged: Object.freeze({ damage: 15 }),
  }),
  // 雨潮·潮护：更强的防护与治疗，并解除凋零（只清除负面，不动既有 buff）
  tide_ward: Object.freeze({
    id: 'tide_ward',
    focus: TIDE_WARD_FOCUS_ITEM,
    handler: 'tide_mend',
    name: '潮护',
    cost: 30,
    cooldown: 12,
    heal: 10,
    guardEffect: 'resistance',
    guardLevel: 2,
    guardSeconds: 10,
    cleanse: Object.freeze(['wither']),
    charged: Object.freeze({ heal: 14, guardSeconds: 14 }),
  }),
  // 无潮·长折：近两倍距离的折跃 + 落地缓冲（折步原本落地不留惯性，长折会托一下）
  void_dash: Object.freeze({
    id: 'void_dash',
    focus: VOID_DASH_FOCUS_ITEM,
    handler: 'void_step',
    name: '长折',
    cost: 35,
    cooldown: 9,
    distance: 14,
    standDepth: 5,
    step: 0.25,
    softLanding: 1.5,
    charged: Object.freeze({ distance: 18 }),
  }),
});

export const ADVANCED_SPELL_IDS = Object.freeze(Object.keys(ADVANCED_SPELLS));

// 全部法术（基础 + 进阶）：spellDef / 冷却清洗 / 服务器形状校验共用这一张总表
export const ALL_SPELLS = Object.freeze({ ...SPELLS, ...ADVANCED_SPELLS });

export function spellDef(id) { return (id && ALL_SPELLS[id]) || null; }

// 焦点物品 → 法术（右键施放）
export const FOCUS_SPELL = Object.freeze({
  [GALE_FOCUS_ITEM]: 'gale_step',
  [EMBER_FOCUS_ITEM]: 'ember_bolt',
  [RAIN_FOCUS_ITEM]: 'tide_mend',
  [TIDELESS_FOCUS_ITEM]: 'void_step',
  [GALE_CROSS_FOCUS_ITEM]: 'gale_cross',
  [EMBER_RING_FOCUS_ITEM]: 'ember_ring',
  [TIDE_WARD_FOCUS_ITEM]: 'tide_ward',
  [VOID_DASH_FOCUS_ITEM]: 'void_dash',
});
