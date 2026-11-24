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

// ── 回响资源 ────────────────────────────────────────────────────────────
export const ECHO_MAX = 100;
export const ECHO_PER_LEVEL = 25;      // 仪台调谐：1 级经验 → 25 回响
export const ECHO_REGEN_SECONDS = 6;   // 脱战自然恢复：每 6 秒 +1（防卡死兜底，不替代主动调谐）
export const ECHO_REGEN_DELAY = 4;     // 施法后 4 秒内不自然恢复（脱战判定）

// ── 法术表 ──────────────────────────────────────────────────────────────
// id -> { focus, cost, cooldown, ... }；四个基础方向各一支（B54 R1 起四系齐备）：
//   风潮 gale_step / 坠潮 ember_bolt / 雨潮 tide_mend / 无潮 void_step。
export const SPELLS = Object.freeze({
  gale_step: Object.freeze({
    id: 'gale_step',
    focus: GALE_FOCUS_ITEM,
    name: '风步',
    cost: 15,
    cooldown: 3,
    distance: 6,        // 冲刺距离（格）；沿视线，碰撞裁剪，不穿墙
    slowFall: 4,        // 落地前缓降时长（秒）
    slowFallVy: -3,     // 缓降时下落速度上限（m/s）
  }),
  ember_bolt: Object.freeze({
    id: 'ember_bolt',
    focus: EMBER_FOCUS_ITEM,
    name: '烬矢',
    cost: 10,
    cooldown: 1.2,
    damage: 6,          // 单发伤害（只结算一次，不点燃地形、不炸方块）
    speed: 28,          // m/s
    life: 1.4,          // 秒
    radius: 0.35,       // 命中半径（球体检测，与箭同口径）
  }),
  // 雨潮·回潮：自我恢复 + 短暂防护。边界：不超过生命上限、不生成水、不在创造/旁观生效。
  tide_mend: Object.freeze({
    id: 'tide_mend',
    focus: RAIN_FOCUS_ITEM,
    name: '回潮',
    cost: 20,
    cooldown: 8,
    heal: 6,            // 恢复量（按缺失量裁剪，满血施放直接拒绝且不扣回响）
    guardEffect: 'resistance', // 复用既有状态效果（每级 -20% 伤害），不新造第四套 buff
    guardLevel: 1,
    guardSeconds: 6,
  }),
  // 无潮·折步：向可见落点短距折跃。边界：不跨维、不穿墙、不落未加载区块、不落在实心格里。
  void_step: Object.freeze({
    id: 'void_step',
    focus: TIDELESS_FOCUS_ITEM,
    name: '折步',
    cost: 25,
    cooldown: 6,
    distance: 8,        // 最大折跃距离（格）
    standDepth: 3,      // 落点脚下多少格内有可站立面
    step: 0.25,         // 探针步长（格）
  }),
});

export const SPELL_IDS = Object.freeze(Object.keys(SPELLS));

export function spellDef(id) { return (id && SPELLS[id]) || null; }

// 焦点物品 → 法术（右键施放）
export const FOCUS_SPELL = Object.freeze({
  [GALE_FOCUS_ITEM]: 'gale_step',
  [EMBER_FOCUS_ITEM]: 'ember_bolt',
  [RAIN_FOCUS_ITEM]: 'tide_mend',
  [TIDELESS_FOCUS_ITEM]: 'void_step',
});
