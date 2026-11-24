// server/industry.js -- Build 51 R3 潮工账本的服务端定义：方块 id 表 + 房间级常量
// 数字 ID 由客户端 src/blocks/BlockDefs.js 的注册顺序决定（服务器只把它们当不透明数字存账本）。
// 本表由 tests/industry-unit.mjs 的钉值断言守住：任何在 BlockDefs 中部插入的方块都会让这里失配。
import {
  tickIndustry, buildNetworks, applyIndustryAction, emptyStateFor,
  sanitizeMachineState, spillStacks, machineSig, netInfoFor, evaluateNetworks,
  clutchEngaged, toggleClutch, setClutchPowered, pendingClutchSignals, isMachineSlot, slotInsertable,
} from '../src/core/Industry.js';
import { INDUSTRY_BLOCK_LIMIT, INDUSTRY_SYNC_MS } from '../src/content/industry/defs.js';

export {
  tickIndustry, buildNetworks, applyIndustryAction, emptyStateFor,
  sanitizeMachineState, spillStacks, machineSig, netInfoFor, evaluateNetworks,
  clutchEngaged, toggleClutch, setClutchPowered, pendingClutchSignals, isMachineSlot, slotInsertable,
  INDUSTRY_BLOCK_LIMIT, INDUSTRY_SYNC_MS,
};

// 工业方块家族：id -> kind（'boiler' | 'shaft' | 'crusher' | 'cutter' | 'clutch'）
export const INDUSTRY_ID_INFO = new Map([
  [224, 'boiler'],   // tide_boiler
  [225, 'shaft'],    // drive_shaft
  [226, 'crusher'],  // crusher
  [228, 'cutter'],   // tide_cutter（B52 R1）
  [229, 'clutch'],   // drive_clutch（B52 R1；227 是回响仪台，不属工业）
]);

export function industryKindOf(id) { return INDUSTRY_ID_INFO.get(id) || null; }
export function isIndustryId(id) { return INDUSTRY_ID_INFO.has(id); }
