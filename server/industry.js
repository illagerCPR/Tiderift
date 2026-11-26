// server/industry.js -- Build 51 R3 潮工账本的服务端定义：方块 id 表 + 房间级常量
// 数字 ID 由客户端 src/blocks/BlockDefs.js 的注册顺序决定（服务器只把它们当不透明数字存账本）。
// 本表由 tests/industry-unit.mjs 的钉值断言守住：任何在 BlockDefs 中部插入的方块都会让这里失配。
import {
  tickIndustry, buildNetworks, applyIndustryAction, emptyStateFor,
  sanitizeMachineState, spillStacks, machineSig, netInfoFor, evaluateNetworks,
  clutchEngaged, toggleClutch, setClutchPowered, pendingClutchSignals, isMachineSlot, slotInsertable,
  projectedNetworkSize, addOverload, tickOverloads, attachOverloads, overloadOfKey,
} from '../src/core/Industry.js';
import {
  INDUSTRY_BLOCK_LIMIT, INDUSTRY_SYNC_MS, NETWORK_MAX_NODES,
  INDUSTRY_REQUIRES, SYNERGY_REQUIRES,
} from '../src/content/industry/defs.js';
import { requiresSatisfied } from '../src/content/ExtraContent.js';

export {
  tickIndustry, buildNetworks, applyIndustryAction, emptyStateFor,
  sanitizeMachineState, spillStacks, machineSig, netInfoFor, evaluateNetworks,
  clutchEngaged, toggleClutch, setClutchPowered, pendingClutchSignals, isMachineSlot, slotInsertable,
  projectedNetworkSize, addOverload, tickOverloads, attachOverloads, overloadOfKey,
  INDUSTRY_BLOCK_LIMIT, INDUSTRY_SYNC_MS, NETWORK_MAX_NODES,
  INDUSTRY_REQUIRES, SYNERGY_REQUIRES,
};

// 工业方块家族：id -> kind（'boiler' | 'shaft' | 'crusher' | 'cutter' | 'clutch' | 'gauge' | 'press'）
export const INDUSTRY_ID_INFO = new Map([
  [224, 'boiler'],   // tide_boiler
  [225, 'shaft'],    // drive_shaft
  [226, 'crusher'],  // crusher
  [228, 'cutter'],   // tide_cutter（B52 R1）
  [229, 'clutch'],   // drive_clutch（B52 R1；227 是回响仪台，不属工业）
  [238, 'gauge'],    // pressure_gauge（B53 R3：只读仪表）
  [239, 'press'],    // rune_press（B56 R1：双开联动方块，要求 industry + magic 同时开）
]);

export function industryKindOf(id) { return INDUSTRY_ID_INFO.get(id) || null; }
export function isIndustryId(id) { return INDUSTRY_ID_INFO.has(id); }

// 联动方块（B56 R1）：写入账本前要求两个模块同时开。
// 普通潮工方块只要工业；这里按 kind 查同一张归属表（不在服务器再抄一份字符串）。
export const SYNERGY_ID_SET = new Set([239]);

export function industryRequiresOf(id) {
  return SYNERGY_ID_SET.has(id) ? SYNERGY_REQUIRES : INDUSTRY_REQUIRES;
}

// 这个 id 在当前世界清单下能否进账本（非工业 id 恒真，由调用方自己判魔法装置）
export function industryAllowedIn(id, manifest) {
  if (!isIndustryId(id)) return true;
  return requiresSatisfied(industryRequiresOf(id), manifest);
}
