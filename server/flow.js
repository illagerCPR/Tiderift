// flow.js -- Build 36 F-1 漏斗搬运的服务端定义：方块 id 表 + 房间级常量
// 数字 ID 由客户端 src/blocks/BlockDefs.js 的注册顺序决定（服务器只把它们当不透明数字存账本）。
// 本表由 tests/hopper-unit.mjs 的钉值断言守住：任何在 BlockDefs 中部插入的方块都会让这里失配。
// B53 R1：分拣漏斗（filter_hopper 家族 230~233）与普通漏斗共用同一张搬运索引与同一份节拍，
// 差别只在容器最后一格是过滤槽（见 src/core/HopperFlow.js）。
import { tickHopperFlow } from '../src/core/HopperFlow.js';

export { tickHopperFlow };

// 普通漏斗家族：方块 id -> 出料口朝向（对应 BlockDefs 末尾的 hopper / hopper_s / hopper_e / hopper_w）
export const HOPPER_FACING_BY_ID = new Map([[217, 'n'], [218, 's'], [219, 'e'], [220, 'w']]);

// 分拣漏斗家族（B53 R1）：同构朝向表，独立成表方便回归钉值（不动上面那张表的口径）
export const FILTER_HOPPER_FACING_BY_ID = new Map([[230, 'n'], [231, 's'], [232, 'e'], [233, 'w']]);

// 漏斗家族合计（搬运索引 / 每房上限都按"漏斗"一处口径，不区分普通与分拣）
const ALL_HOPPER_FACING = new Map([...HOPPER_FACING_BY_ID, ...FILTER_HOPPER_FACING_BY_ID]);

// 可被漏斗搬运的容器方块 id：箱子家族 + 潜影盒 + 漏斗家族（含分拣漏斗）
// （熔炉走独立账本 server/furnace.js，不在这张 27 槽容器表里——B36 F-2）
export const CONTAINER_BLOCK_IDS = new Set([
  170, 197, 198, 199, 171, 217, 218, 219, 220, 230, 231, 232, 233,
]);

// 每房间漏斗上限（超出拒绝放置并提示；普通漏斗与分拣漏斗合计）
export const FLOW_HOPPER_LIMIT = 64;

// 客户端改写拒绝窗口：容器被服务器搬运写过之后的毫秒数（期间客户端改写一律拒绝并回滚）
export const FLOW_HOT_MS = 1000;

export function hopperFacingOf(id) { return ALL_HOPPER_FACING.get(id) || null; }
export function isHopperId(id) { return ALL_HOPPER_FACING.has(id); }
export function isFilterHopperId(id) { return FILTER_HOPPER_FACING_BY_ID.has(id); }
export function isContainerId(id) { return CONTAINER_BLOCK_IDS.has(id); }
