// furnace.js -- Build 36 F-2 熔炉账本的服务端定义：方块 id 表 + 房间级常量
// 数字 ID 由客户端 src/blocks/BlockDefs.js 的注册顺序决定（服务器只把它们当不透明数字存账本）。
// 本表由 tests/furnace-unit.mjs 的钉值断言守住：任何在 BlockDefs 中部插入的方块都会让这里失配。
import { emptyFurnaceState, tickFurnaceState } from '../src/core/FurnaceTick.js';

export { emptyFurnaceState, tickFurnaceState };

// 熔炉家族：方块 id -> {facing, lit}（BlockDefs 里 furnace / furnace_lit 各四朝向）
export const FURNACE_ID_INFO = new Map([
  [71, { facing: 'n', lit: false }],
  [200, { facing: 's', lit: false }],
  [201, { facing: 'e', lit: false }],
  [202, { facing: 'w', lit: false }],
  [203, { facing: 'n', lit: true }],
  [204, { facing: 's', lit: true }],
  [205, { facing: 'e', lit: true }],
  [206, { facing: 'w', lit: true }],
]);

const FURNACE_ID_BY_KEY = new Map();
for (const [id, info] of FURNACE_ID_INFO) FURNACE_ID_BY_KEY.set(`${info.facing}|${info.lit ? 1 : 0}`, id);

// 每房间熔炉账本上限（超出不再新建条目，避免刷放置把服务器撑爆）
export const FURNACE_LIMIT = 256;
// 烧炼进度向全房同步的节拍（内容物变化另走即时广播）
export const FURNACE_SYNC_MS = 500;

export function furnaceInfoOf(id) { return FURNACE_ID_INFO.get(id) || null; }
export function isFurnaceId(id) { return FURNACE_ID_INFO.has(id); }
export function furnaceBlockId(facing, lit) { return FURNACE_ID_BY_KEY.get(`${facing}|${lit ? 1 : 0}`) || 0; }
