// flow.js -- Build 36 F-1 漏斗搬运的服务端定义：方块 id 表 + 房间级常量
// 数字 ID 由客户端 src/blocks/BlockDefs.js 的注册顺序决定（服务器只把它们当不透明数字存账本）。
// 本表由 tests/hopper-unit.mjs 的钉值断言守住：任何在 BlockDefs 中部插入的方块都会让这里失配。
import { tickHopperFlow } from '../src/core/HopperFlow.js';

export { tickHopperFlow };

// 漏斗家族：方块 id -> 出料口朝向（对应 BlockDefs 末尾的 hopper / hopper_s / hopper_e / hopper_w）
export const HOPPER_FACING_BY_ID = new Map([[217, 'n'], [218, 's'], [219, 'e'], [220, 'w']]);

// 可被漏斗搬运的容器方块 id：箱子家族 + 潜影盒 + 漏斗家族（熔炉内容在 F-2 才上账本，此处不接）
export const CONTAINER_BLOCK_IDS = new Set([170, 197, 198, 199, 171, 217, 218, 219, 220]);

// 每房间漏斗上限（超出拒绝放置并提示）
export const FLOW_HOPPER_LIMIT = 64;

// 客户端改写拒绝窗口：容器被服务器搬运写过之后的毫秒数（期间客户端改写一律拒绝并回滚）
export const FLOW_HOT_MS = 1000;

export function hopperFacingOf(id) { return HOPPER_FACING_BY_ID.get(id) || null; }
export function isHopperId(id) { return HOPPER_FACING_BY_ID.has(id); }
export function isContainerId(id) { return CONTAINER_BLOCK_IDS.has(id); }
