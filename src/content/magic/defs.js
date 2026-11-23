// content/magic/defs.js -- 魔法（四潮回响）内容定义与平衡表（Build 51 R4）
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

// ── 回响资源 ────────────────────────────────────────────────────────────
export const ECHO_MAX = 100;
export const ECHO_PER_LEVEL = 25;      // 仪台调谐：1 级经验 → 25 回响
export const ECHO_REGEN_SECONDS = 6;   // 脱战自然恢复：每 6 秒 +1（防卡死兜底，不替代主动调谐）
export const ECHO_REGEN_DELAY = 4;     // 施法后 4 秒内不自然恢复（脱战判定）

// ── 法术表 ──────────────────────────────────────────────────────────────
// id -> { focus, cost, cooldown, ... }；'gale_step' 与 'ember_bolt' 是 R4 的两个基础方向。
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
});

export const SPELL_IDS = Object.freeze(Object.keys(SPELLS));

export function spellDef(id) { return (id && SPELLS[id]) || null; }

// 焦点物品 → 法术（右键施放）
export const FOCUS_SPELL = Object.freeze({
  [GALE_FOCUS_ITEM]: 'gale_step',
  [EMBER_FOCUS_ITEM]: 'ember_bolt',
});
