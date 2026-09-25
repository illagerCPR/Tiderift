// ItemCategories.js -- 创造模式物品栏分类映射（Build 10）
// 键 = 注册名；未登记的物品自动落 misc（杂项）。集中维护一张表，不动注册侧签名。
// 分类顺序即创造页签顺序（CREATIVE_CATEGORIES）。
export const CREATIVE_CATEGORIES = ['building', 'nature', 'functional', 'redstone', 'tools', 'food', 'materials', 'misc'];

// 页签 label 的 i18n 键（简体中文原文，走 t()）
export const CATEGORY_LABEL_KEYS = {
  building: '建筑方块',
  nature: '自然',
  functional: '功能方块',
  redstone: '红石',
  tools: '工具与战斗',
  food: '食物',
  materials: '材料',
  misc: '杂项',
};

const MAP = {
  // ---------- 建筑方块 ----------
  stone: 'building', cobblestone: 'building', stone_bricks: 'building', mossy_stone_bricks: 'building',
  cracked_stone_bricks: 'building', mossy_cobblestone: 'building', brick_block: 'building',
  nether_bricks: 'building', sandstone: 'building', red_sandstone: 'building', quartz_block: 'building',
  oak_planks: 'building', spruce_planks: 'building', birch_planks: 'building', dark_oak_planks: 'building',
  acacia_planks: 'building', glass: 'building', white_concrete: 'building', white_terracotta: 'building',
  white_wool: 'building', purpur_block: 'building', purpur_pillar: 'building', end_stone_bricks: 'building',
  deepslate: 'building', obsidian: 'building', bedrock: 'building',
  // ---------- 自然 ----------
  grass_block: 'nature', dirt: 'nature', coarse_dirt: 'nature', sand: 'nature', red_sand: 'nature',
  gravel: 'nature', clay: 'nature', snow_block: 'nature', snow_layer: 'nature', ice: 'nature',
  packed_ice: 'nature', blue_ice: 'nature', oak_log: 'nature', spruce_log: 'nature', birch_log: 'nature',
  dark_oak_log: 'nature', acacia_log: 'nature', oak_leaves: 'nature', spruce_leaves: 'nature',
  birch_leaves: 'nature', acacia_leaves: 'nature', cactus: 'nature', pumpkin: 'nature', melon: 'nature',
  hay_block: 'nature', mycelium: 'nature', lily_pad: 'nature', sunflower: 'nature', red_mushroom: 'nature',
  brown_mushroom: 'nature', mushroom_stem: 'nature', mushroom_cap_red: 'nature', mushroom_cap_brown: 'nature',
  farmland: 'nature', tall_grass: 'nature', netherrack: 'nature', end_stone: 'nature', soul_sand: 'nature',
  magma_block: 'nature',
  // ---------- 功能方块 ----------
  crafting_table: 'functional', furnace: 'functional', chest: 'functional', white_bed: 'functional',
  oak_door: 'functional', iron_door: 'functional', oak_trapdoor: 'functional', note_block: 'functional',
  bookshelf: 'functional', beacon: 'functional', shulker_box: 'functional', torch: 'functional',
  glowstone: 'functional', sea_lantern: 'functional', end_portal_frame: 'functional',
  end_portal_frame_eye: 'functional', end_portal: 'functional', nether_portal: 'functional',
  aether_portal: 'functional', end_gateway: 'functional',
  // ---------- 红石 ----------
  redstone_wire: 'redstone', redstone_torch: 'redstone', redstone_torch_item: 'redstone',
  redstone_lamp: 'redstone', redstone_block: 'redstone', lever: 'redstone', stone_button: 'redstone',
  oak_button: 'redstone', piston: 'redstone', sticky_piston: 'redstone', piston_head: 'redstone',
  repeater: 'redstone', comparator: 'redstone', tnt: 'redstone',
  // ---------- 工具与战斗 ----------
  wood_pickaxe: 'tools', wood_axe: 'tools', wood_shovel: 'tools', wood_hoe: 'tools', wood_sword: 'tools',
  stone_pickaxe: 'tools', stone_axe: 'tools', stone_shovel: 'tools', stone_hoe: 'tools', stone_sword: 'tools',
  iron_pickaxe: 'tools', iron_axe: 'tools', iron_shovel: 'tools', iron_hoe: 'tools', iron_sword: 'tools',
  gold_pickaxe: 'tools', gold_axe: 'tools', gold_shovel: 'tools', gold_hoe: 'tools', gold_sword: 'tools',
  diamond_pickaxe: 'tools', diamond_axe: 'tools', diamond_shovel: 'tools', diamond_hoe: 'tools',
  diamond_sword: 'tools', bow: 'tools', arrow: 'tools', shield: 'tools', flint_and_steel: 'tools',
  fishing_rod: 'tools', shears: 'tools', leather_helmet: 'tools', iron_helmet: 'tools', gold_helmet: 'tools',
  diamond_helmet: 'tools', leather_chestplate: 'tools', iron_chestplate: 'tools', gold_chestplate: 'tools',
  diamond_chestplate: 'tools', leather_leggings: 'tools', iron_leggings: 'tools', gold_leggings: 'tools',
  diamond_leggings: 'tools', leather_boots: 'tools', iron_boots: 'tools', gold_boots: 'tools',
  diamond_boots: 'tools',
  // ---------- 食物 ----------
  apple: 'food', golden_apple: 'food', bread: 'food', cooked_beef: 'food', beef: 'food',
  cooked_chicken: 'food', raw_chicken: 'food', cooked_cod: 'food', carrot: 'food', potato: 'food',
  baked_potato: 'food', melon_slice: 'food', cookie: 'food',
  // ---------- 材料 ----------
  coal: 'materials', charcoal: 'materials', iron_ingot: 'materials', gold_ingot: 'materials',
  diamond: 'materials', emerald: 'materials', lapis_lazuli: 'materials', copper_ingot: 'materials',
  redstone: 'materials', quartz: 'materials', iron_nugget: 'materials', gold_nugget: 'materials',
  diamond_nugget: 'materials', clay_ball: 'materials', brick: 'materials', nether_brick: 'materials',
  string: 'materials', feather: 'materials', leather: 'materials', bone: 'materials', bone_meal: 'materials',
  bone_meal_item: 'materials', wither_skeleton_skull: 'materials', gunpowder: 'materials',
  slime_ball: 'materials', iron_ingot_raw: 'materials', gold_ingot_raw: 'materials',
  copper_ingot_raw: 'materials', dye: 'materials', stick: 'materials', flint: 'materials',
  wheat: 'materials', wheat_seeds: 'materials', sugar: 'materials', egg: 'materials',
  blaze_rod: 'materials', ghast_tear: 'materials', blaze_powder: 'materials', ender_eye: 'materials',
  shulker_shell: 'materials', chorus_fruit: 'materials', chorus_plant: 'materials', chorus_flower: 'materials',
  nether_star: 'materials', wheat_crop_0: 'materials',
  // ---------- 杂项（含未登记物品的兜底分类） ----------
  bucket: 'misc', water_bucket: 'misc', lava_bucket: 'misc', milk_bucket: 'misc', saddle: 'misc',
  name_tag: 'misc', minecart: 'misc', boat: 'misc', map: 'misc', compass: 'misc', clock: 'misc',
  book: 'misc', enchanted_book: 'misc', ender_pearl: 'misc', elytra: 'misc', oak_sapling: 'misc',
  spruce_sapling: 'misc', experience_bottle: 'misc', end_crystal: 'misc', dragon_egg: 'misc',
  // ---------- 天域叙事基石（批次 A） ----------
  star_marrow_ore: 'nature', star_marrow_block: 'building', cloud_wool: 'building',
  wind_stele: 'functional', aether_altar: 'functional', wind_current: 'functional', gale_block: 'functional',
  tide_altar: 'functional',
  primordial_altar: 'functional', // 终局篇 F1：候潮仪式受体
  primordial_emblem: 'misc', // 终局篇 F1：候潮信物（仪式发放，非材料）
  whale_bone_block: 'building', // 鲸骨冢篇 K1：骨骼建材
  cloud_fluff: 'materials', star_marrow: 'materials', storm_core: 'materials',
  page_rising: 'misc', page_marrow: 'misc', page_sunder: 'misc',
  storm_totem: 'misc', heart_shard: 'misc',
  wind_brand: 'tools', gale_cloak: 'tools',
  // ---------- 下界·烬火纪（世界观批次 N1） ----------
  ember_stele: 'functional', mourn_tear: 'materials',
  moss_stele: 'functional', page_rain: 'materials', // 世界观批次 W1
  end_stele: 'functional', // 世界观批次 E1：末地石碑（石碑家族第四员）
};

// 取物品分类（未登记 → 杂项）
export function getItemCategory(name) {
  return MAP[name] || 'misc';
}

// ---------- B29 创造模式技术性方块过滤 + 图标形制判定（纯函数，无 DOM） ----------

// 显式技术方块：机制载体而非内容方块，不进创造物品栏（类JEI 面板不受影响，仍全量展示）
const TECHNICAL_NAMES = new Set([
  'piston_head',                    // 活塞推出态载体（由活塞放置/收回自动管理）
  'end_portal', 'nether_portal', 'aether_portal', 'end_gateway', // 传送门幕（搭框点燃/折跃生成）
  'end_portal_frame_eye',           // 末地门框架已嵌眼态（框架本名可放，眼由掷眼填充）
  'wind_current',                   // 天域气流柱载体（结构生成）
]);
for (let i = 0; i <= 7; i++) TECHNICAL_NAMES.add(`wheat_crop_${i}`); // 小麦生长阶段

// 技术性方块判定：
//   ① 流体及流动等级（B26 water/lava + *_flow_N）
//   ② 状态家族变体（def.baseBlock 且非本名——B27 门/床/活板门、B28 箱/炉/头颅/红石灯全家族，
//      规则化覆盖现有与未来家族，无需逐名维护）
//   ③ 显式清单（上表）
// farmland 保留（原版创造栏同样提供）；redstone_wire/redstone_torch 等红石件是玩家可放置内容，保留。
export function isTechnicalBlock(def) {
  if (!def) return false;
  if (def.name === 'air') return true;
  if (def.fluidType) return true;
  if (def.baseBlock && def.name !== def.baseBlock) return true;
  return TECHNICAL_NAMES.has(def.name);
}

// 图标形制判定：仅"满格立方"用等轴三面合成；cross/portal/flat 渲染形制、带 shape 的
// 部分方块（门/床/活板门）与流体走单面平铺（原版对非立方方块同样用平铺 sprite）。
export function isIsoBlock(def) {
  if (!def || def.id === 0) return false;
  if (def.renderType && def.renderType !== 'cube') return false;
  if (def.shape || def.fluidType) return false;
  return true;
}
