// Smelting.js -- 熔炉烧炼配方与燃料表
// 与 Crafting.js 同风格：注册期构建纯表，运行期只查表（确定性，无随机）
// SMELT_TIME：烧炼一个物品所需秒数（原版 10s）
// B51：配方可带归属白名单 requiresExtras（第 4 参）；查询侧按显式清单过滤。
import { normalizeRequires, requiresSatisfied } from '../content/ExtraContent.js';

export const SMELT_TIME = 10;

// 配方表：input 物品/方块名 -> { output, count }
const smeltingRecipes = new Map();

export function addSmelting(input, output, count = 1, requiresExtras = null) {
  smeltingRecipes.set(input, { output, count, requiresExtras: normalizeRequires(requiresExtras) });
}

export function smeltingEnabled(recipe, manifest) {
  return !!recipe && requiresSatisfied(recipe.requiresExtras, manifest);
}

export function getSmeltingResult(input) {
  if (!input) return null;
  return smeltingRecipes.get(input) || null;
}

// 全部烧炼配方（JEI 式查询用）：[{ input, output, count }]；给 manifest 时按归属过滤
export function getAllSmeltingRecipes(manifest) {
  const list = [];
  for (const [input, r] of smeltingRecipes) {
    if (!smeltingEnabled(r, manifest)) continue;
    list.push({ input, output: r.output, count: r.count });
  }
  return list;
}

// 燃料表：物品名 -> 燃烧秒数（可烧炼的物品数 = 秒数 / SMELT_TIME）
const fuelTable = new Map();

export function addFuel(name, seconds) {
  fuelTable.set(name, seconds);
}

export function getFuelTime(name) {
  if (!name) return 0;
  return fuelTable.get(name) || 0;
}

export function isFuel(name) {
  return getFuelTime(name) > 0;
}

// --- 烧炼配方注册 ---
// 矿石 → 锭/矿物（本作矿石挖落自身方块，熔炉是矿物加工的主路径）
addSmelting('iron_ore', 'iron_ingot');
addSmelting('deepslate_iron_ore', 'iron_ingot');
addSmelting('gold_ore', 'gold_ingot');
addSmelting('deepslate_gold_ore', 'gold_ingot');
addSmelting('copper_ore', 'copper_ingot');
addSmelting('coal_ore', 'coal');
addSmelting('deepslate_coal_ore', 'coal');
addSmelting('diamond_ore', 'diamond');
addSmelting('deepslate_diamond_ore', 'diamond');
addSmelting('emerald_ore', 'emerald');
addSmelting('lapis_ore', 'lapis_lazuli');
addSmelting('redstone_ore', 'redstone');
// 粗矿 → 锭
addSmelting('iron_ingot_raw', 'iron_ingot');
addSmelting('gold_ingot_raw', 'gold_ingot');
addSmelting('copper_ingot_raw', 'copper_ingot');
// 建材
addSmelting('sand', 'glass');
addSmelting('red_sand', 'glass');
addSmelting('cobblestone', 'stone');
addSmelting('stone_bricks', 'cracked_stone_bricks');
addSmelting('clay_ball', 'brick');
addSmelting('netherrack', 'nether_brick');
// 食物
addSmelting('beef', 'cooked_beef');
addSmelting('raw_chicken', 'cooked_chicken');
addSmelting('potato', 'baked_potato');
// 原木 → 木炭
addSmelting('oak_log', 'charcoal');
addSmelting('spruce_log', 'charcoal');
addSmelting('birch_log', 'charcoal');
addSmelting('dark_oak_log', 'charcoal');
addSmelting('acacia_log', 'charcoal');

// --- 燃料注册（秒）---
addFuel('coal', 80);          // 8 个物品
addFuel('charcoal', 80);
addFuel('coal_block', 800);   // 80 个物品
addFuel('blaze_rod', 120);    // 12 个物品
addFuel('oak_log', 15);
addFuel('spruce_log', 15);
addFuel('birch_log', 15);
addFuel('dark_oak_log', 15);
addFuel('acacia_log', 15);
addFuel('oak_planks', 15);
addFuel('spruce_planks', 15);
addFuel('birch_planks', 15);
addFuel('dark_oak_planks', 15);
addFuel('acacia_planks', 15);
addFuel('stick', 5);          // 半个物品
