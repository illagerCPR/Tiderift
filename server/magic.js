// server/magic.js -- Build 51 R4 四潮回响的服务端定义：方块 id 表 + 校验出口
// 数字 ID 由客户端 src/blocks/BlockDefs.js 的注册顺序决定（服务器只把它们当不透明数字存账本）。
// 本表由 tests/magic-unit.mjs 的钉值断言守住：任何在 BlockDefs 中部插入的方块都会让这里失配。
import { sanitizeCast } from '../src/core/Magic.js';
import { SPELLS, SPELL_IDS, spellDef, TABLE_BLOCK, ECHO_MAX } from '../src/content/magic/defs.js';

export { sanitizeCast, spellDef, SPELLS, SPELL_IDS, TABLE_BLOCK, ECHO_MAX };

// 魔法装置：id -> kind（'table' = 回响仪台）
export const MAGIC_ID_INFO = new Map([
  [227, 'table'], // resonance_table
]);

export function magicKindOf(id) { return MAGIC_ID_INFO.get(id) || null; }
export function isMagicId(id) { return MAGIC_ID_INFO.has(id); }
