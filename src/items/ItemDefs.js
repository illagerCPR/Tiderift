// ItemDefs.js -- 物品定义（非方块物品）+ SVG 生成（原版风格像素画重绘）
// 全部 16x16 手工像素画：亮面/基色/暗面三色纪律 + 对角工具造型，注册名与 def 字段与旧版一致。
import { ItemRegistry } from '../core/ItemRegistry.js';
import { SVGTextures } from '../render/SVGTextures.js';

const { pixelSvg, rng } = SVGTextures;

// === 调色板（每套 [亮, 基, 暗]）===
const P = {
  handle: ['rgb(158,122,73)', 'rgb(117,85,45)', 'rgb(80,56,28)'],
  wood:   ['rgb(176,144,90)', 'rgb(140,108,62)', 'rgb(96,70,36)'],
  stone:  ['rgb(163,163,163)', 'rgb(125,125,125)', 'rgb(88,88,88)'],
  iron:   ['rgb(255,255,255)', 'rgb(216,216,216)', 'rgb(150,150,150)'],
  gold:   ['rgb(255,240,138)', 'rgb(245,201,60)', 'rgb(184,134,11)'],
  diamond:['rgb(179,245,238)', 'rgb(74,237,217)', 'rgb(35,170,181)'],
  copper: ['rgb(243,177,143)', 'rgb(200,126,90)', 'rgb(143,82,55)'],
  emerald:['rgb(120,240,140)', 'rgb(60,200,90)', 'rgb(24,130,52)'],
  lapis:  ['rgb(90,110,230)', 'rgb(38,60,190)', 'rgb(20,34,120)'],
  red:    ['rgb(255,90,80)', 'rgb(205,40,35)', 'rgb(130,18,15)'],
  white:  ['rgb(255,255,255)', 'rgb(236,236,230)', 'rgb(180,180,172)'],
  bone:   ['rgb(252,252,244)', 'rgb(230,228,214)', 'rgb(180,178,162)'],
  witherSkull: ['rgb(64,64,70)', 'rgb(44,44,50)', 'rgb(22,22,26)'],
  clay:   ['rgb(178,183,198)', 'rgb(158,164,182)', 'rgb(118,124,142)'],
  charcoalP: ['rgb(84,64,46)', 'rgb(56,42,28)', 'rgb(34,25,16)'],
  coalP:  ['rgb(72,72,76)', 'rgb(44,44,48)', 'rgb(20,20,22)'],
};

// === 画布助手 ===
// g.s 置点 / g.r 矩形 / g.hl 横线 / g.vl 竖线 / g.d 椭圆 / g.h 对角木柄 / g.spi 撒点
function art(fn) {
  const px = new Array(256).fill(null);
  const g = {
    s(x, y, c) { if (x >= 0 && x < 16 && y >= 0 && y < 16) px[y * 16 + x] = c; },
    r(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g.s(i, j, c); },
    hl(y, x0, x1, c) { for (let i = x0; i <= x1; i++) g.s(i, y, c); },
    vl(x, y0, y1, c) { for (let j = y0; j <= y1; j++) g.s(x, j, c); },
    d(cx, cy, rx, ry, c) {
      for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) g.s(x, y, c);
      }
    },
    // 对角木柄：主色 + 右下暗缘（2px 宽，从 (x0,y0) 向右上 len 格）
    h(x0, y0, len) {
      for (let i = 0; i < len; i++) {
        g.s(x0 + i, y0 - i, P.handle[1]);
        g.s(x0 + i + 1, y0 - i, P.handle[2]);
      }
    },
    // 亮/暗描边：给已画区域内做顶部提亮、底部压暗
    topLight(x0, x1, y, c) { g.hl(y, x0, x1, c); },
    spi(x0, y0, w, h, c, seed, density = 0.4) {
      const r = rng(seed);
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        if (r() < density) g.s(x, y, c);
      }
    },
  };
  fn(g);
  return pixelSvg(px);
}

// === 通用形 ===

// 锭：顶面受光的长条
function ingotArt(pal) {
  return art(g => {
    g.hl(4, 6, 10, pal[0]);
    g.hl(5, 4, 12, pal[0]);
    g.hl(6, 3, 13, pal[1]);
    g.hl(7, 2, 14, pal[1]);
    g.hl(8, 3, 13, pal[1]);
    g.hl(9, 4, 12, pal[1]);
    g.hl(10, 5, 11, pal[2]);
    g.hl(11, 6, 10, pal[2]);
  });
}

// 宝石：菱形 + 左上亮面/右下暗面 + 星光点
function gemArt(pal) {
  return art(g => {
    const rows = [[7, 8], [6, 9], [5, 10], [4, 11], [4, 11], [5, 10], [6, 9], [7, 8]];
    rows.forEach(([x0, x1], i) => g.hl(4 + i, x0, x1, pal[1]));
    g.s(7, 4, pal[0]); g.s(8, 4, pal[0]); g.s(6, 5, pal[0]); g.s(7, 5, pal[0]); g.s(6, 6, pal[0]);
    g.s(9, 9, pal[2]); g.s(8, 10, pal[2]); g.s(9, 10, pal[2]); g.s(8, 11, pal[2]);
    g.s(6, 5, 'rgb(255,255,255)'); g.s(10, 7, pal[0]);
  });
}

// 粒/ nugget：小团 + 顶部高光
function nuggetArt(pal) {
  return art(g => {
    g.hl(6, 6, 9, pal[0]);
    g.hl(7, 5, 10, pal[1]);
    g.hl(8, 5, 10, pal[1]);
    g.hl(9, 6, 9, pal[2]);
    g.s(6, 6, 'rgb(255,255,255)');
  });
}

// 粗矿块：不规则岩块感
function rawChunkArt(pal, seed) {
  return art(g => {
    g.hl(5, 5, 10, pal[0]);
    g.hl(6, 4, 11, pal[1]);
    g.hl(7, 3, 12, pal[1]);
    g.hl(8, 3, 12, pal[1]);
    g.hl(9, 4, 11, pal[1]);
    g.hl(10, 5, 10, pal[2]);
    g.spi(4, 6, 8, 4, pal[2], seed, 0.25);
    g.s(5, 6, pal[0]);
  });
}

// 粉末堆
function dustPileArt(base, dark, seed) {
  return art(g => {
    g.hl(8, 6, 10, base);
    g.hl(9, 5, 11, base);
    g.hl(10, 4, 12, base);
    g.hl(11, 3, 13, dark);
    g.s(7, 7, base); g.s(9, 7, base); g.s(8, 6, base);
    g.spi(4, 9, 9, 2, dark, seed, 0.3);
    g.s(8, 8, 'rgb(255,255,255)');
  });
}

// 工具头（柄从左下到右上，头在右上角）
function toolArt(tool, pal) {
  return art(g => {
    if (tool === 'sword') {
      // 剑：3px 刃 + 横挡 + 短柄
      for (let i = 0; i < 9; i++) {
        const x = 13 - i, y = 2 + i;
        g.s(x, y, pal[1]); g.s(x - 1, y, pal[0]); g.s(x, y + 1, pal[2]);
      }
      g.s(14, 1, pal[0]); g.s(13, 1, pal[0]);
      g.s(4, 9, P.handle[2]); g.s(5, 10, P.handle[2]); g.s(6, 11, P.handle[2]);
      g.s(4, 11, P.handle[1]); g.s(3, 12, P.handle[1]); g.s(2, 13, P.handle[2]);
    } else {
      g.h(2, 13, 8); // 柄：到 (9,6)
    }
    if (tool === 'pickaxe') {
      g.hl(1, 5, 10, pal[0]);
      g.hl(2, 3, 12, pal[1]);
      g.hl(3, 2, 4, pal[1]); g.hl(3, 11, 13, pal[1]);
      g.hl(4, 1, 3, pal[1]); g.hl(4, 12, 14, pal[1]);
      g.s(1, 5, pal[1]); g.s(14, 5, pal[1]);
      g.hl(3, 3, 4, pal[2]); g.hl(4, 2, 3, pal[2]); g.hl(3, 11, 12, pal[2]); g.hl(4, 12, 13, pal[2]);
      g.s(9, 5, pal[1]); g.s(9, 4, pal[1]); g.s(9, 3, pal[1]); // 颈部连接
    } else if (tool === 'axe') {
      g.hl(1, 9, 12, pal[0]);
      g.hl(2, 8, 13, pal[1]);
      g.hl(3, 8, 13, pal[1]);
      g.hl(4, 8, 12, pal[1]);
      g.hl(5, 8, 11, pal[1]);
      g.hl(6, 9, 10, pal[2]);
      g.vl(12, 2, 3, pal[0]); g.vl(13, 2, 3, pal[0]); // 开刃口高光
      g.vl(8, 2, 5, pal[2]);
      g.s(9, 6, pal[1]);
    } else if (tool === 'shovel') {
      g.hl(1, 10, 12, pal[0]);
      g.hl(2, 9, 13, pal[0]);
      g.hl(3, 9, 13, pal[1]);
      g.hl(4, 9, 13, pal[1]);
      g.hl(5, 10, 12, pal[1]);
      g.s(11, 6, pal[2]);
      g.vl(9, 2, 4, pal[2]); g.vl(13, 2, 4, pal[0]);
      g.s(9, 7, P.handle[1]); g.s(10, 6, pal[1]);
    } else if (tool === 'hoe') {
      g.hl(1, 8, 13, pal[0]);
      g.hl(2, 7, 13, pal[1]);
      g.s(13, 3, pal[1]); g.s(13, 4, pal[2]);
      g.s(12, 2, pal[2]);
      g.s(8, 3, pal[1]); g.s(8, 4, pal[1]); g.s(8, 5, P.handle[1]); // 颈部
    }
  });
}

// 头盔（圆顶 + 护颊缝）
function helmetArt(pal) {
  return art(g => {
    g.hl(4, 4, 11, pal[0]);
    g.hl(5, 3, 12, pal[0]);
    for (let y = 6; y <= 8; y++) g.hl(y, 3, 12, pal[1]);
    for (let y = 9; y <= 10; y++) { g.hl(y, 3, 5, pal[1]); g.hl(y, 10, 12, pal[1]); }
    for (let y = 11; y <= 12; y++) { g.hl(y, 3, 4, pal[2]); g.hl(y, 11, 12, pal[2]); }
    g.vl(4, 6, 8, pal[0]);
  });
}

// 护腿（腰带 + 双腿筒）
function leggingsArt(pal) {
  return art(g => {
    g.hl(3, 3, 12, pal[0]);
    g.hl(4, 3, 12, pal[1]);
    for (let y = 5; y <= 12; y++) { g.hl(y, 3, 6, pal[1]); g.hl(y, 9, 12, pal[1]); }
    for (let y = 10; y <= 12; y++) { g.hl(y, 3, 6, pal[2]); g.hl(y, 9, 12, pal[2]); }
    g.vl(3, 5, 12, pal[0]); g.vl(9, 5, 12, pal[0]);
  });
}

// 靴子（双靴筒 + 靴头压暗）
function bootsArt(pal) {
  return art(g => {
    for (let y = 7; y <= 10; y++) { g.hl(y, 2, 6, pal[1]); g.hl(y, 9, 13, pal[1]); }
    for (let y = 11; y <= 13; y++) { g.hl(y, 2, 6, pal[2]); g.hl(y, 9, 13, pal[2]); }
    g.hl(7, 2, 6, pal[0]); g.hl(7, 9, 13, pal[0]);
  });
}

// 胸甲（躯干剪影 + 领口）
function chestplateArt(pal) {
  return art(g => {
    g.hl(2, 3, 5, pal[0]); g.hl(2, 10, 12, pal[0]);
    g.hl(3, 2, 5, pal[0]); g.hl(3, 10, 13, pal[0]);
    g.hl(4, 2, 5, pal[1]); g.hl(4, 10, 13, pal[1]);
    g.hl(5, 2, 5, pal[1]); g.hl(5, 10, 13, pal[1]);
    g.hl(6, 3, 12, pal[1]);
    g.hl(7, 3, 12, pal[1]);
    g.hl(8, 3, 12, pal[1]);
    g.hl(9, 3, 12, pal[1]);
    g.hl(10, 3, 12, pal[1]);
    g.hl(11, 4, 11, pal[1]);
    g.hl(12, 5, 10, pal[2]);
    g.hl(13, 6, 9, pal[2]);
    g.vl(3, 6, 10, pal[0]); // 中缝受光
    g.vl(12, 6, 11, pal[2]);
  });
}

// 桶（可带内容物）
function bucketArt(fill = null) {
  return art(g => {
    if (fill) { g.hl(4, 5, 10, fill[0]); g.hl(5, 5, 10, fill[1]); }
    g.vl(4, 5, 12, 'rgb(140,140,140)');
    g.vl(5, 6, 12, 'rgb(180,180,180)');
    g.vl(6, 6, 12, 'rgb(150,150,150)');
    g.vl(9, 6, 12, 'rgb(150,150,150)');
    g.vl(10, 6, 12, 'rgb(180,180,180)');
    g.vl(11, 5, 12, 'rgb(140,140,140)');
    g.hl(5, 5, 10, 'rgb(200,200,200)');
    g.hl(12, 4, 11, 'rgb(110,110,110)');
    g.hl(3, 6, 9, 'rgb(120,120,120)'); // 提手
    g.s(5, 4, 'rgb(120,120,120)'); g.s(10, 4, 'rgb(120,120,120)');
  });
}

const svgMap = {};

const ItemCN = {
  stick: '木棍', coal: '煤炭', charcoal: '木炭',
  iron_ingot: '铁锭', gold_ingot: '金锭', diamond: '钻石', emerald: '绿宝石',
  lapis_lazuli: '青金石', copper_ingot: '铜锭', redstone: '红石', quartz: '下界石英',
  iron_nugget: '铁粒', gold_nugget: '金粒', diamond_nugget: '钻石粒',
  clay_ball: '粘土球', brick: '红砖', nether_brick: '下界砖',
  string: '线', feather: '羽毛', leather: '皮革', bone: '骨头', bone_meal: '骨粉',
  wither_skeleton_skull: '凋零骷髅头颅',
  gunpowder: '火药', slime_ball: '粘液球',
  iron_ingot_raw: '粗铁', gold_ingot_raw: '粗金', copper_ingot_raw: '粗铜', dye: '染料',
  apple: '苹果', golden_apple: '金苹果', bread: '面包',
  cooked_beef: '牛排', beef: '生牛肉',
  cooked_chicken: '熟鸡肉', raw_chicken: '生鸡肉',
  cooked_cod: '熟鳕鱼', carrot: '胡萝卜', potato: '马铃薯', baked_potato: '烤马铃薯',
  melon_slice: '西瓜片', cookie: '饼干', sugar: '糖', wheat: '小麦',
  egg: '鸡蛋', rotten_flesh: '腐肉', spider_eye: '蜘蛛眼', milk_bucket: '牛奶桶',
  // 工具（5 材质 × 5 类型）
  wood_pickaxe: '木镐', wood_axe: '木斧', wood_shovel: '木铲', wood_hoe: '木锄', wood_sword: '木剑',
  stone_pickaxe: '石镐', stone_axe: '石斧', stone_shovel: '石铲', stone_hoe: '石锄', stone_sword: '石剑',
  iron_pickaxe: '铁镐', iron_axe: '铁斧', iron_shovel: '铁铲', iron_hoe: '铁锄', iron_sword: '铁剑',
  gold_pickaxe: '金镐', gold_axe: '金斧', gold_shovel: '金铲', gold_hoe: '金锄', gold_sword: '金剑',
  diamond_pickaxe: '钻石镐', diamond_axe: '钻石斧', diamond_shovel: '钻石铲', diamond_hoe: '钻石锄', diamond_sword: '钻石剑',
  // 武器/防具
  bow: '弓', arrow: '箭', shield: '盾牌',
  leather_helmet: '皮革头盔', iron_helmet: '铁头盔', gold_helmet: '金头盔', diamond_helmet: '钻石头盔',
  leather_chestplate: '皮革胸甲', iron_chestplate: '铁胸甲', gold_chestplate: '金胸甲', diamond_chestplate: '钻石胸甲',
  leather_leggings: '皮革护腿', iron_leggings: '铁护腿', gold_leggings: '金护腿', diamond_leggings: '钻石护腿',
  leather_boots: '皮革靴子', iron_boots: '铁靴子', gold_boots: '金靴子', diamond_boots: '钻石靴子',
  ender_pearl: '末影珍珠', blaze_rod: '烈焰棒', ghast_tear: '恶魂之泪',
  blaze_powder: '烈焰粉', ender_eye: '末影之眼',
  book: '书', enchanted_book: '附魔书', map: '地图', compass: '指南针', clock: '钟',
  bucket: '桶', water_bucket: '水桶', lava_bucket: '岩浆桶',
  saddle: '鞍', name_tag: '命名牌', minecart: '矿车', boat: '船',
  flint: '燧石', flint_and_steel: '打火石', fishing_rod: '钓鱼竿', shears: '剪刀',
  experience_bottle: '附魔之瓶',
  redstone_torch_item: '红石火把', repeater: '红石中继器', comparator: '红石比较器',
  lever: '拉杆', stone_button: '石按钮',
  oak_sapling: '橡树树苗', spruce_sapling: '云杉树苗', wheat_seeds: '小麦种子',
  bone_meal_item: '骨粉',
  cloud_fluff: '云絮', star_marrow: '星髓',
  page_rising: '潮汐残页·涨潮', page_marrow: '潮汐残页·星髓', page_sunder: '潮汐残页·裂潮',
  storm_totem: '风暴图腾', storm_core: '风暴之核', heart_shard: '心核碎片',
  wind_brand: '缚风之剑', gale_cloak: '御风斗篷',
  mourn_tear: '哀潮之泪', // 世界观批次 N1
  page_rain: '雨潮残页', // 世界观批次 W1
  primordial_emblem: '原初纹章', // 终局篇 F1：候潮仪式信物
};

function reg(name, def, svg) {
  ItemRegistry.register({ name, displayName: ItemCN[name] || def.displayName || name, ...def });
  if (svg) svgMap[name] = svg;
}

// --- 材料 ---
reg('stick', { stack: 64 }, art(g => {
  for (let i = 0; i < 10; i++) {
    g.s(3 + i, 13 - i, P.handle[1]);
    g.s(4 + i, 13 - i, P.handle[0]);
    g.s(5 + i, 13 - i, P.handle[2]);
  }
}));
reg('coal', { stack: 64 }, art(g => {
  g.d(8, 8, 4, 4, P.coalP[1]);
  g.d(8, 8, 3, 3, P.coalP[0]);
  g.s(6, 6, 'rgb(110,110,116)'); g.s(9, 7, 'rgb(110,110,116)'); g.s(7, 9, P.coalP[2]);
  g.spi(4, 4, 8, 8, P.coalP[2], 11, 0.2);
}));
reg('charcoal', { stack: 64 }, art(g => {
  g.d(8, 8, 4, 4, P.charcoalP[1]);
  g.d(8, 8, 3, 3, P.charcoalP[0]);
  g.s(6, 6, 'rgb(120,92,66)'); g.s(9, 9, P.charcoalP[2]);
}));
reg('iron_ingot', { stack: 64 }, ingotArt(P.iron));
reg('gold_ingot', { stack: 64 }, ingotArt(P.gold));
reg('diamond', { stack: 64 }, gemArt(P.diamond));
reg('emerald', { stack: 64 }, gemArt(P.emerald));
reg('lapis_lazuli', { stack: 64 }, art(g => {
  g.d(8, 8, 4, 3, P.lapis[1]);
  g.s(6, 7, P.lapis[0]); g.s(9, 8, P.lapis[0]);
  g.s(7, 10, P.lapis[2]); g.s(10, 9, P.lapis[2]); g.s(5, 9, P.lapis[2]);
  g.s(7, 6, 'rgb(140,160,255)');
}));
reg('copper_ingot', { stack: 64 }, ingotArt(P.copper));
reg('redstone', { stack: 64 }, dustPileArt(P.red[1], P.red[2], 21));
reg('quartz', { stack: 64 }, art(g => {
  const rows = [[8, 8], [7, 9], [7, 9], [6, 10], [6, 10], [7, 9], [7, 9], [8, 8]];
  rows.forEach(([x0, x1], i) => g.hl(4 + i, x0, x1, P.white[1]));
  g.hl(4, 8, 8, P.white[0]);
  g.vl(7, 5, 9, P.white[0]);
  g.vl(10, 7, 10, P.white[2]);
  g.s(8, 11, P.white[2]);
}));
reg('iron_nugget', { stack: 64 }, nuggetArt(P.iron));
reg('gold_nugget', { stack: 64 }, nuggetArt(P.gold));
reg('diamond_nugget', { stack: 64 }, nuggetArt(P.diamond));
reg('clay_ball', { stack: 64 }, art(g => {
  g.d(8, 8, 4, 4, P.clay[1]);
  g.d(7, 7, 2, 2, P.clay[0]);
  g.s(10, 10, P.clay[2]); g.s(6, 11, P.clay[2]);
}));
reg('brick', { stack: 64 }, art(g => {
  g.r(3, 5, 10, 6, 'rgb(150,74,52)');
  g.hl(5, 3, 12, 'rgb(186,104,74)');
  g.hl(6, 3, 12, 'rgb(168,88,62)');
  g.hl(10, 3, 12, 'rgb(112,50,34)');
  g.hl(11, 4, 11, 'rgb(96,42,28)');
  g.vl(3, 6, 9, 'rgb(120,56,40)'); g.vl(12, 6, 9, 'rgb(120,56,40)');
}));
reg('nether_brick', { stack: 64 }, art(g => {
  g.r(3, 5, 10, 6, 'rgb(56,26,38)');
  g.hl(5, 3, 12, 'rgb(86,44,60)');
  g.hl(10, 3, 12, 'rgb(36,16,26)');
  g.vl(3, 6, 9, 'rgb(40,18,28)'); g.vl(12, 6, 9, 'rgb(40,18,28)');
}));
reg('string', { stack: 64 }, art(g => {
  const wavy = [4, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 11];
  for (let i = 0; i < 12; i++) {
    g.s(3 + i, wavy[i], P.white[1]);
    g.s(3 + i, wavy[i] + 1, P.white[2]);
  }
  g.s(4, 3, P.white[0]); g.s(13, 12, P.white[0]);
}));
reg('feather', { stack: 64 }, art(g => {
  for (let i = 0; i < 9; i++) {
    g.s(4 + i, 12 - i, P.white[1]);
    g.s(3 + i, 11 - i, P.white[0]);
    g.s(5 + i, 12 - i, P.white[2]);
  }
  g.hl(3, 2, 4, P.white[0]); g.hl(4, 2, 6, P.white[0]);
  g.hl(5, 3, 7, P.white[1]); g.hl(6, 4, 7, P.white[1]);
  g.hl(12, 11, 12, P.handle[1]); g.s(13, 13, P.handle[2]);
}));
reg('leather', { stack: 64 }, art(g => {
  g.r(3, 4, 10, 8, 'rgb(198,116,52)');
  g.hl(4, 3, 12, 'rgb(226,152,84)');
  g.hl(11, 3, 12, 'rgb(150,82,32)');
  g.vl(3, 4, 11, 'rgb(170,94,40)'); g.vl(12, 4, 11, 'rgb(170,94,40)');
  g.s(6, 7, 'rgb(170,94,40)'); g.s(9, 6, 'rgb(226,152,84)');
}));
reg('bone', { stack: 64 }, art(g => {
  for (let i = 0; i < 8; i++) {
    g.s(5 + i, 11 - i, P.bone[1]);
    g.s(6 + i, 11 - i, P.bone[0]);
  }
  // 两端骨节
  g.r(2, 10, 3, 3, P.bone[0]); g.s(2, 12, P.bone[2]); g.s(4, 10, P.bone[2]);
  g.r(11, 2, 3, 3, P.bone[0]); g.s(11, 2, P.bone[2]); g.s(13, 4, P.bone[2]);
}));
reg('bone_meal', { stack: 64 }, dustPileArt(P.bone[0], P.bone[2], 31));
// 凋零骷髅头颅（Idea-2D-①）：凋零骷髅稀有掉落，未来凋灵召唤材料（3 头 + 灵魂沙 T 型）
// 世界观批次 W1：补凋灵禁忌拼合 lore（与灵魂沙 lore 呼应；物品 lore 优先于方块 lore）
reg('wither_skeleton_skull', { stack: 64, lore: ['熏黑卫的头骨，眼窝里还留着炉火的余温。', '三枚颅骨按进骨泥，缝起来的不是人——是一句没能咽下的怨。'] }, art(g => {
  g.d(8, 7, 5, 5, P.witherSkull[1]);   // 焦黑颅骨
  g.d(8, 6, 4, 4, P.witherSkull[0]);
  g.r(4, 8, 8, 4, P.witherSkull[0]);   // 面部
  g.r(5, 8, 2, 2, P.witherSkull[2]);   // 左眼窝
  g.r(9, 8, 2, 2, P.witherSkull[2]);   // 右眼窝
  g.s(8, 11, P.witherSkull[2]);        // 鼻腔
  g.s(6, 12, P.witherSkull[1]);        // 牙缝
  g.s(8, 12, P.witherSkull[1]);
  g.s(10, 12, P.witherSkull[1]);
  g.s(4, 3, P.witherSkull[2]);         // 颅角暗点
  g.s(12, 3, P.witherSkull[2]);
}));
reg('gunpowder', { stack: 64 }, dustPileArt('rgb(88,88,88)', 'rgb(48,48,48)', 41));
reg('slime_ball', { displayName: '粘液球', stack: 64 }, art(g => {
  g.d(8, 8, 4, 4, 'rgb(110,190,70)');
  g.d(7, 7, 2, 2, 'rgb(160,220,120)');
  g.s(10, 10, 'rgb(70,140,44)'); g.s(5, 9, 'rgb(70,140,44)');
  g.s(7, 6, 'rgb(210,245,180)');
}));
reg('iron_ingot_raw', { displayName: '粗铁', stack: 64 }, rawChunkArt(['rgb(200,200,200)', 'rgb(150,124,96)', 'rgb(104,84,62)'], 51));
reg('gold_ingot_raw', { displayName: '粗金', stack: 64 }, rawChunkArt(['rgb(226,196,90)', 'rgb(180,148,52)', 'rgb(126,102,34)'], 52));
reg('copper_ingot_raw', { displayName: '粗铜', stack: 64 }, rawChunkArt(['rgb(226,150,110)', 'rgb(172,108,72)', 'rgb(118,72,46)'], 53));

// --- 染料（所有颜色合并算 1 种：红色染料代表）---
reg('dye', { displayName: '染料', stack: 64 }, art(g => {
  g.d(8, 9, 4, 3, 'rgb(180,40,180)');
  g.d(7, 8, 2, 1, 'rgb(230,120,230)');
  g.hl(12, 4, 12, 'rgb(120,20,120)');
  g.s(6, 5, 'rgb(230,120,230)'); g.s(9, 6, 'rgb(230,120,230)');
}));

// --- 食物 ---
reg('apple', { stack: 64, food: 4 }, art(g => {
  g.d(8, 9, 4, 4, 'rgb(200,40,30)');
  g.d(7, 8, 2, 2, 'rgb(240,90,70)');
  g.s(10, 11, 'rgb(140,20,14)'); g.s(6, 12, 'rgb(140,20,14)');
  g.vl(8, 3, 5, 'rgb(96,64,30)');
  g.r(9, 3, 3, 2, 'rgb(70,150,40)');
  g.s(8, 4, 'rgb(96,64,30)');
}));
reg('golden_apple', { stack: 64, food: 4 }, art(g => {
  g.d(8, 9, 4, 4, P.gold[1]);
  g.d(7, 8, 2, 2, P.gold[0]);
  g.s(10, 11, P.gold[2]); g.s(6, 12, P.gold[2]);
  g.vl(8, 3, 5, 'rgb(96,64,30)');
  g.r(9, 3, 3, 2, 'rgb(120,200,80)');
  g.s(6, 7, 'rgb(255,255,210)');
}));
reg('bread', { stack: 64, food: 5 }, art(g => {
  g.hl(4, 5, 11, 'rgb(186,130,58)');
  g.hl(5, 3, 13, 'rgb(206,150,70)');
  g.hl(6, 2, 14, 'rgb(222,168,84)');
  g.hl(7, 2, 14, 'rgb(206,150,70)');
  g.hl(8, 2, 14, 'rgb(186,130,58)');
  g.hl(9, 3, 13, 'rgb(160,108,44)');
  g.hl(10, 4, 12, 'rgb(130,86,32)');
  g.s(5, 6, 'rgb(238,196,120)'); g.s(9, 6, 'rgb(238,196,120)'); g.s(12, 7, 'rgb(238,196,120)');
}));
reg('cooked_beef', { stack: 64, food: 8 }, art(g => {
  g.r(3, 5, 10, 6, 'rgb(142,84,48)');
  g.hl(5, 3, 12, 'rgb(172,108,62)');
  g.hl(10, 3, 12, 'rgb(104,58,30)');
  g.spi(4, 6, 8, 4, 'rgb(196,140,88)', 61, 0.25);
  g.s(5, 7, 'rgb(210,160,110)'); g.s(9, 8, 'rgb(210,160,110)');
}));
reg('beef', { stack: 64, food: 3 }, art(g => {
  g.r(3, 5, 10, 6, 'rgb(198,60,50)');
  g.hl(5, 3, 12, 'rgb(226,96,80)');
  g.hl(10, 3, 12, 'rgb(150,36,28)');
  g.hl(7, 4, 11, 'rgb(240,190,180)');
  g.s(6, 9, 'rgb(240,190,180)'); g.s(10, 6, 'rgb(240,190,180)');
}));
reg('cooked_chicken', { stack: 64, food: 6 }, art(g => {
  g.d(8, 8, 4, 4, 'rgb(198,124,52)');
  g.d(7, 7, 2, 2, 'rgb(232,168,92)');
  g.hl(11, 6, 8, 'rgb(240,236,220)'); g.s(5, 10, 'rgb(240,236,220)'); g.s(6, 11, 'rgb(240,236,220)');
  g.s(10, 11, 'rgb(140,80,30)');
}));
reg('raw_chicken', { stack: 64, food: 2 }, art(g => {
  g.d(8, 8, 4, 4, 'rgb(226,150,140)');
  g.d(7, 7, 2, 2, 'rgb(244,190,180)');
  g.hl(11, 6, 8, 'rgb(240,236,220)'); g.s(5, 10, 'rgb(240,236,220)'); g.s(6, 11, 'rgb(240,236,220)');
}));
reg('cooked_cod', { stack: 64, food: 5 }, art(g => {
  g.d(7, 8, 4, 3, 'rgb(172,116,60)');
  g.hl(7, 3, 10, 'rgb(202,146,84)');
  g.hl(10, 4, 10, 'rgb(130,82,38)');
  g.r(11, 6, 3, 3, 'rgb(150,98,46)');
  g.s(12, 5, 'rgb(150,98,46)'); g.s(12, 9, 'rgb(150,98,46)');
  g.s(4, 7, 'rgb(255,255,255)'); g.s(4, 7, 'rgb(20,20,20)');
}));
reg('carrot', { stack: 64, food: 3 }, art(g => {
  for (let i = 0; i < 8; i++) {
    g.s(10 - i, 6 + i, 'rgb(230,126,34)');
    g.s(11 - i, 6 + i, 'rgb(200,98,20)');
  }
  g.s(10, 6, 'rgb(250,168,70)');
  g.vl(10, 2, 5, 'rgb(70,150,40)'); g.vl(12, 3, 5, 'rgb(90,170,50)'); g.vl(8, 3, 5, 'rgb(50,120,30)');
}));
reg('potato', { stack: 64, food: 1 }, art(g => {
  g.d(8, 8, 5, 4, 'rgb(198,158,94)');
  g.d(7, 7, 3, 2, 'rgb(222,186,120)');
  g.s(6, 9, 'rgb(150,114,58)'); g.s(10, 8, 'rgb(150,114,58)'); g.s(9, 11, 'rgb(150,114,58)');
}));
reg('baked_potato', { stack: 64, food: 5 }, art(g => {
  g.d(8, 8, 5, 4, 'rgb(180,120,52)');
  g.d(7, 7, 3, 2, 'rgb(214,158,76)');
  g.r(7, 7, 3, 2, 'rgb(246,222,140)'); // 黄油
  g.s(6, 10, 'rgb(130,84,34)'); g.s(11, 8, 'rgb(130,84,34)');
}));
reg('melon_slice', { stack: 64, food: 2 }, art(g => {
  for (let y = 0; y < 9; y++) {
    const half = 8 - y;
    for (let x = 8 - half; x <= 8 + half; x++) {
      if (y <= 1) g.s(x, 3 + y, 'rgb(70,150,40)');
      else if (y <= 2) g.s(x, 3 + y, 'rgb(140,200,90)');
      else g.s(x, 3 + y, 'rgb(220,50,50)');
    }
  }
  g.s(6, 7, 'rgb(20,20,20)'); g.s(9, 8, 'rgb(20,20,20)'); g.s(8, 5, 'rgb(20,20,20)'); g.s(11, 6, 'rgb(20,20,20)');
}));
reg('cookie', { stack: 64, food: 2 }, art(g => {
  g.d(8, 8, 5, 4, 'rgb(198,144,74)');
  g.d(8, 8, 5, 4, 'rgb(198,144,74)');
  g.hl(5, 4, 11, 'rgb(222,170,96)');
  g.s(6, 7, 'rgb(70,40,16)'); g.s(10, 8, 'rgb(70,40,16)'); g.s(8, 10, 'rgb(70,40,16)'); g.s(11, 6, 'rgb(70,40,16)');
}));
reg('sugar', { stack: 64 }, dustPileArt('rgb(250,250,244)', 'rgb(200,200,194)', 71));
reg('wheat', { stack: 64 }, art(g => {
  for (const cx of [5, 8, 11]) {
    g.vl(cx, 6, 13, 'rgb(160,132,52)');
    for (let y = 3; y < 9; y += 2) {
      g.s(cx - 1, y, 'rgb(220,190,90)');
      g.s(cx + 1, y + 1, 'rgb(198,166,72)');
    }
    g.s(cx, 3, 'rgb(236,210,120)');
  }
}));
reg('egg', { stack: 16 }, art(g => {
  for (let y = 4; y < 13; y++) {
    const ry = y < 8 ? (y - 4) * 0.9 + 1 : 12.6 - y;
    const rx = Math.max(1, Math.round(ry * 0.8));
    for (let x = 8 - rx; x <= 8 + rx; x++) g.s(x, y, P.white[1]);
  }
  g.s(7, 5, 'rgb(255,255,255)'); g.s(6, 6, 'rgb(255,255,255)');
  g.s(9, 11, P.white[2]); g.s(8, 12, P.white[2]);
}));

// --- 怪物掉落物 ---
reg('rotten_flesh', { stack: 64, food: 4 }, art(g => {
  g.r(3, 5, 10, 6, 'rgb(148,84,52)');
  g.hl(5, 3, 12, 'rgb(176,108,66)');
  g.hl(10, 3, 12, 'rgb(108,58,34)');
  g.spi(4, 6, 8, 4, 'rgb(94,142,60)', 81, 0.15);
  g.s(6, 7, 'rgb(80,40,24)'); g.s(10, 9, 'rgb(80,40,24)');
}));
reg('spider_eye', { stack: 64, food: 2 }, art(g => {
  g.d(8, 8, 4, 4, 'rgb(146,38,38)');
  g.d(8, 8, 3, 3, 'rgb(180,60,56)');
  g.vl(8, 5, 11, 'rgb(30,10,10)');
  g.s(8, 7, 'rgb(255,90,80)'); g.s(8, 10, 'rgb(255,90,80)');
  g.s(5, 6, 'rgb(230,220,210)'); g.s(11, 10, 'rgb(230,220,210)');
}));
reg('milk_bucket', { stack: 1 }, bucketArt(['rgb(250,250,246)', 'rgb(230,230,226)']));

// --- 工具（木/石/铁/金/钻石 各 5 级）---
const toolMaterials = {
  wood: { color: 'rgb(160,120,70)', art: P.wood, tier: 1 },
  stone: { color: 'rgb(128,128,128)', art: P.stone, tier: 2 },
  iron: { color: 'rgb(220,220,220)', art: P.iron, tier: 3 },
  gold: { color: 'rgb(240,220,80)', art: P.gold, tier: 1 },
  diamond: { color: 'rgb(100,230,230)', art: P.diamond, tier: 4 }
};
const toolTypes = ['pickaxe', 'axe', 'shovel', 'hoe'];
for (const [matName, mat] of Object.entries(toolMaterials)) {
  for (const tt of toolTypes) {
    reg(`${matName}_${tt}`, { stack: 1, tool: tt, tier: mat.tier, durability: mat.tier * 100 },
      toolArt(tt, mat.art));
  }
  reg(`${matName}_sword`, { stack: 1, tool: 'sword', tier: mat.tier, durability: mat.tier * 100, damage: 2 + mat.tier },
    toolArt('sword', mat.art));
}

// --- 武器/防具 ---
reg('bow', { stack: 1 }, art(g => {
  // 弓臂（右上弧）+ 弓弦（左下直线）
  const arc = [[4, 2], [6, 2], [7, 3], [8, 4], [9, 5], [10, 6], [11, 7], [11, 8], [12, 9], [12, 11], [11, 13]];
  for (const [x, y] of arc) { g.s(x, y, P.handle[1]); g.s(x + 1, y, P.handle[0]); }
  g.s(4, 2, P.handle[0]);
  g.vl(3, 3, 12, P.white[1]);
  g.s(3, 2, P.handle[2]); g.s(3, 13, P.handle[2]);
  g.hl(7, 8, 9, P.handle[2]); g.hl(8, 8, 9, P.handle[1]); // 握把缠绳
}));
reg('arrow', { stack: 64 }, art(g => {
  for (let i = 0; i < 8; i++) {
    g.s(5 + i, 11 - i, P.handle[1]);
    g.s(6 + i, 11 - i, P.handle[0]);
  }
  g.s(13, 3, P.iron[0]); g.s(13, 4, P.iron[1]); g.s(12, 3, P.iron[1]); g.s(14, 3, P.iron[2]);
  g.s(12, 4, P.iron[1]);
  g.s(4, 12, P.white[0]); g.s(3, 13, P.white[0]); g.s(5, 13, P.white[1]); g.s(3, 11, P.white[1]);
  g.s(2, 12, P.white[2]);
}));
reg('shield', { stack: 1 }, art(g => {
  g.hl(2, 5, 10, 'rgb(120,80,40)');
  g.hl(3, 4, 11, 'rgb(150,104,52)');
  for (let y = 4; y <= 9; y++) { g.s(3, y, 'rgb(150,104,52)'); g.s(12, y, 'rgb(150,104,52)'); }
  for (let y = 10; y <= 12; y++) { const w = 13 - y; g.hl(y, 6 - (y - 10), 9 + (y - 10), 'rgb(150,104,52)'); }
  g.r(5, 4, 6, 6, 'rgb(170,120,60)');
  g.r(7, 5, 2, 4, 'rgb(200,160,90)');
  g.r(7, 6, 2, 2, 'rgb(216,216,216)'); // 铁质盾徽
  g.s(7, 13, 'rgb(100,66,30)'); g.s(8, 13, 'rgb(100,66,30)');
}));
// --- 盔甲（4 材质 × 头/胸/腿/靴；armorPoints 按原版；armorSlot 决定装备槽）---
const armorMaterials = {
  leather: { pal: ['rgb(226,152,84)', 'rgb(198,116,52)', 'rgb(150,82,32)'], pts: [1, 3, 2, 1] },
  iron: { pal: P.iron, pts: [2, 6, 5, 2] },
  gold: { pal: P.gold, pts: [2, 5, 3, 1] },
  diamond: { pal: P.diamond, pts: [3, 8, 6, 3] },
};
const armorPieces = [
  ['helmet', 'head', helmetArt],
  ['chestplate', 'chest', chestplateArt],
  ['leggings', 'legs', leggingsArt],
  ['boots', 'feet', bootsArt],
];
for (const [matName, m] of Object.entries(armorMaterials)) {
  armorPieces.forEach(([piece, slot, artFn], i) => {
    reg(`${matName}_${piece}`, { stack: 1, armorSlot: slot, armorPoints: m.pts[i] }, artFn(m.pal));
  });
}

// --- 特殊物品 ---
reg('ender_pearl', { stack: 16 }, art(g => {
  g.d(8, 8, 4, 4, 'rgb(24,110,84)');
  g.d(8, 8, 3, 3, 'rgb(36,150,110)');
  g.s(6, 6, 'rgb(140,240,200)'); g.s(7, 6, 'rgb(140,240,200)');
  g.s(9, 10, 'rgb(10,60,44)'); g.s(6, 10, 'rgb(10,60,44)');
  g.s(10, 7, 'rgb(12,80,60)');
}));
reg('blaze_rod', { stack: 64 }, art(g => {
  for (let i = 0; i < 10; i++) {
    g.s(3 + i, 13 - i, 'rgb(226,140,32)');
    g.s(4 + i, 13 - i, 'rgb(248,196,72)');
  }
  g.s(5, 11, 'rgb(255,240,160)'); g.s(9, 7, 'rgb(255,240,160)'); g.s(12, 4, 'rgb(255,240,160)');
}));
reg('blaze_powder', { stack: 64 }, art(g => {
  // 确定性撒点（rng(seed)——物品重绘纪律：禁 Math.random）
  g.spi(4, 5, 8, 7, 'rgb(226,140,32)', 71, 0.55);
  g.spi(4, 5, 8, 7, 'rgb(248,196,72)', 72, 0.35);
  g.spi(5, 4, 6, 9, 'rgb(184,90,20)', 73, 0.2);
  g.s(8, 8, 'rgb(255,240,160)'); g.s(6, 6, 'rgb(255,240,160)');
}));
reg('ender_eye', { stack: 16 }, art(g => {
  // 末影之眼：绿珠壳 + 黑绿竖瞳 + 高光
  g.d(8, 8, 5, 5, 'rgb(24,110,84)');
  g.d(8, 8, 4, 4, 'rgb(36,150,110)');
  g.d(8, 8, 3, 3, 'rgb(56,190,140)');
  g.vl(8, 5, 10, 'rgb(10,40,30)');
  g.vl(7, 6, 9, 'rgb(6,24,18)');
  g.s(6, 5, 'rgb(160,240,200)'); g.s(5, 6, 'rgb(160,240,200)');
  g.s(10, 10, 'rgb(12,80,60)'); g.s(11, 9, 'rgb(12,80,60)');
}));
reg('ghast_tear', { stack: 64 }, art(g => {
  for (let y = 3; y < 13; y++) {
    const w = y < 6 ? (y - 2) : Math.min(4, 12 - y);
    for (let x = 8 - w; x <= 8 + w; x++) g.s(x, y, P.white[1]);
  }
  g.hl(4, 7, 9, 'rgb(255,255,255)');
  g.s(7, 4, 'rgb(200,230,255)'); g.s(6, 5, 'rgb(200,230,255)');
  g.hl(12, 6, 10, 'rgb(180,200,220)');
}));
reg('elytra', { stack: 1, armorSlot: 'chest', armorPoints: 0, displayName: '鞘翅', lore: ['从仓库顶棚取下的膜翼，薄得能望见界壁另一侧的光。', '拾遗者靠它滑过无潮的虚空。落在肩上轻得像没有——也许它本来就不是给「人」长的。'] }, art(g => {
  // 末地船船长箱战利品；穿在胸甲槽（不减伤），空中下落自动展开滑翔
  for (let i = 0; i < 5; i++) {
    g.hl(4 + i, 3 + i * 2, 5 + i * 2, 'rgb(96,84,116)');
    g.hl(4 + i, 11 - i * 2, 12 - i * 2, 'rgb(96,84,116)');
  }
  g.hl(3, 6, 10, 'rgb(130,116,152)');
  g.s(5, 4, 'rgb(160,146,186)'); g.s(8, 5, 'rgb(160,146,186)');
  g.s(7, 7, 'rgb(64,54,82)'); g.s(10, 6, 'rgb(64,54,82)');
}));
reg('shulker_shell', { stack: 64, displayName: '潜影壳' }, art(g => {
  g.d(8, 8, 6, 6, 'rgb(168,142,190)');
  g.d(8, 8, 5, 5, 'rgb(196,170,216)');
  g.hl(5, 6, 10, 'rgb(224,206,238)');
  g.s(5, 5, 'rgb(120,94,146)'); g.s(10, 5, 'rgb(120,94,146)');
  g.s(5, 10, 'rgb(120,94,146)'); g.s(10, 10, 'rgb(120,94,146)');
  g.s(7, 7, 'rgb(90,64,118)'); g.s(8, 8, 'rgb(90,64,118)');
}));
reg('chorus_fruit', { stack: 64, food: 4, displayName: '紫颂果', lore: ['别界带回的种子。咬开是空的，吃下去却会把人挪个地方。', '拾遗者只在新浮起的碎岛上种它——滩涂上，长不出别的东西了。'] }, art(g => {
  // 食用随机短距传送（原版机制，Game._chorusTeleport）
  g.d(8, 8, 5, 5, 'rgb(120,84,150)');
  g.d(7, 7, 4, 4, 'rgb(152,112,184)');
  g.s(6, 6, 'rgb(186,150,214)'); g.s(9, 6, 'rgb(186,150,214)');
  g.s(6, 9, 'rgb(186,150,214)'); g.s(9, 9, 'rgb(186,150,214)');
  g.s(8, 3, 'rgb(96,64,128)'); g.s(8, 4, 'rgb(96,64,128)');
}));
reg('book', { stack: 64 }, art(g => {
  g.r(3, 4, 10, 8, 'rgb(146,50,40)');
  g.hl(4, 3, 12, 'rgb(180,70,56)');
  g.vl(12, 4, 11, 'rgb(220,220,200)'); // 书页
  g.vl(11, 4, 11, 'rgb(230,230,214)');
  g.vl(3, 4, 11, 'rgb(100,32,26)');
  g.r(6, 7, 2, 2, 'rgb(210,180,120)'); // 扣环
}));
reg('enchanted_book', { stack: 64 }, art(g => {
  g.r(3, 4, 10, 8, 'rgb(90,50,150)');
  g.hl(4, 3, 12, 'rgb(126,80,190)');
  g.vl(12, 4, 11, 'rgb(220,220,200)');
  g.vl(11, 4, 11, 'rgb(230,230,214)');
  g.s(5, 6, 'rgb(255,230,120)'); g.s(8, 5, 'rgb(180,240,255)'); g.s(7, 9, 'rgb(255,230,120)'); g.s(10, 10, 'rgb(180,240,255)');
}));
reg('map', { stack: 64 }, art(g => {
  g.r(2, 3, 12, 10, 'rgb(226,216,176)');
  g.hl(3, 2, 13, 'rgb(240,232,196)');
  g.hl(12, 2, 13, 'rgb(196,184,142)');
  g.vl(2, 3, 12, 'rgb(196,184,142)'); g.vl(13, 3, 12, 'rgb(196,184,142)');
  g.spi(3, 4, 10, 8, 'rgb(180,200,150)', 91, 0.2);
  g.hl(9, 4, 8, 'rgb(120,160,210)'); // 小河
  g.s(11, 5, 'rgb(180,80,60)'); // 标记
}));
reg('compass', { stack: 64 }, art(g => {
  g.d(8, 8, 5, 5, 'rgb(120,120,120)');
  g.d(8, 8, 4, 4, 'rgb(160,160,160)');
  g.d(8, 8, 3, 3, 'rgb(230,230,230)');
  g.vl(8, 5, 7, P.red[1]); g.s(8, 6, P.red[0]); // 指北针
  g.s(8, 9, 'rgb(60,60,60)'); g.s(8, 10, 'rgb(60,60,60)');
  g.s(5, 5, 'rgb(255,255,255)'); g.s(11, 11, 'rgb(80,80,80)');
}));
reg('clock', { stack: 64 }, art(g => {
  g.d(8, 8, 5, 5, P.gold[2]);
  g.d(8, 8, 4, 4, P.gold[0]);
  g.d(8, 8, 3, 3, 'rgb(30,60,140)');
  g.vl(8, 6, 8, 'rgb(255,255,255)');
  g.hl(8, 8, 10, 'rgb(255,255,255)');
  g.s(8, 8, P.gold[0]);
}));
reg('bucket', { stack: 1 }, bucketArt());
reg('water_bucket', { stack: 1 }, bucketArt(['rgb(60,130,220)', 'rgb(40,100,180)']));
reg('lava_bucket', { stack: 1 }, bucketArt(['rgb(250,170,40)', 'rgb(220,90,10)']));
reg('saddle', { stack: 1 }, art(g => {
  g.hl(4, 4, 11, 'rgb(140,80,36)');
  g.hl(5, 3, 12, 'rgb(170,104,46)');
  g.hl(6, 3, 12, 'rgb(170,104,46)');
  g.hl(7, 4, 11, 'rgb(140,80,36)');
  g.hl(8, 5, 10, 'rgb(112,62,26)');
  g.hl(9, 6, 9, 'rgb(112,62,26)');
  g.vl(3, 5, 7, 'rgb(90,50,20)'); g.vl(12, 5, 7, 'rgb(90,50,20)');
  g.hl(10, 7, 8, 'rgb(216,216,216)'); // 金属扣
}));
reg('name_tag', { stack: 64 }, art(g => {
  g.r(3, 6, 10, 5, 'rgb(222,204,160)');
  g.hl(6, 3, 12, 'rgb(238,224,184)');
  g.hl(10, 3, 12, 'rgb(190,172,128)');
  g.s(4, 6, 'rgb(120,104,72)'); g.s(4, 7, 'rgb(120,104,72)'); // 挂孔
  g.hl(4, 2, 3, 'rgb(150,150,150)'); // 细绳
  g.hl(8, 5, 10, 'rgb(120,104,72)'); g.s(7, 6, 'rgb(120,104,72)'); g.s(9, 6, 'rgb(120,104,72)');
}));
reg('minecart', { stack: 1 }, art(g => {
  g.hl(4, 3, 12, 'rgb(150,150,150)');
  g.vl(3, 4, 9, 'rgb(120,120,120)'); g.vl(12, 4, 9, 'rgb(120,120,120)');
  g.hl(9, 3, 12, 'rgb(100,100,100)');
  g.hl(10, 4, 11, 'rgb(150,150,150)');
  g.hl(11, 3, 12, 'rgb(90,90,90)');
  g.d(5, 12, 1, 1, 'rgb(60,60,60)'); g.d(10, 12, 1, 1, 'rgb(60,60,60)');
  g.hl(5, 2, 3, 'rgb(80,80,80)'); g.hl(5, 12, 13, 'rgb(80,80,80)'); // 轴
}));
reg('boat', { stack: 1 }, art(g => {
  g.hl(6, 2, 13, 'rgb(150,104,52)');
  g.hl(7, 3, 12, 'rgb(176,128,64)');
  g.hl(8, 3, 12, 'rgb(150,104,52)');
  g.hl(9, 4, 11, 'rgb(120,80,36)');
  g.hl(10, 5, 10, 'rgb(96,62,26)');
  g.s(2, 5, 'rgb(150,104,52)'); g.s(13, 5, 'rgb(150,104,52)');
  g.vl(2, 5, 6, 'rgb(176,128,64)'); g.vl(13, 5, 6, 'rgb(176,128,64)');
}));
reg('flint', { stack: 64 }, art(g => {
  g.d(8, 9, 3, 2, 'rgb(84,78,74)');
  g.d(9, 8, 2, 2, 'rgb(110,102,96)');
  g.s(7, 7, 'rgb(60,55,52)'); g.s(8, 8, 'rgb(60,55,52)');
  g.s(11, 8, 'rgb(60,55,52)'); g.s(6, 10, 'rgb(46,42,40)');
  g.s(10, 10, 'rgb(46,42,40)'); g.s(8, 11, 'rgb(60,55,52)');
  g.spi(5, 6, 6, 6, 'rgb(38,35,33)', 33, 0.18);
}));
reg('flint_and_steel', { stack: 1 }, art(g => {
  g.hl(3, 8, 12, 'rgb(200,200,200)');
  g.vl(12, 3, 6, 'rgb(200,200,200)');
  g.hl(6, 10, 12, 'rgb(200,200,200)');
  g.s(11, 5, 'rgb(160,160,160)');
  g.r(4, 8, 3, 4, 'rgb(60,60,64)'); // 火石
  g.s(4, 8, 'rgb(90,90,94)'); g.s(5, 11, 'rgb(30,30,34)');
}));
reg('fishing_rod', { stack: 64 }, art(g => {
  for (let i = 0; i < 11; i++) {
    g.s(2 + i, 13 - i, P.handle[1]);
    g.s(3 + i, 13 - i, P.handle[0]);
  }
  g.vl(13, 2, 6, P.white[1]); // 鱼线
  g.hl(7, 12, 14, P.white[1]);
  g.s(14, 8, P.white[2]); g.s(14, 7, P.white[0]); // 鱼钩
}));
reg('shears', { stack: 1 }, art(g => {
  for (let i = 0; i < 7; i++) {
    g.s(3 + i, 3 + i, P.iron[1]);
    g.s(12 - i, 3 + i, P.iron[1]);
  }
  g.s(4, 4, P.iron[0]); g.s(11, 4, P.iron[0]);
  g.s(9, 9, P.iron[2]); g.s(6, 9, P.iron[2]);
  g.r(4, 10, 2, 3, P.red[1]); g.r(10, 10, 2, 3, P.red[1]); // 手柄
  g.s(5, 10, P.red[2]); g.s(11, 10, P.red[2]);
}));
reg('experience_bottle', { stack: 64 }, art(g => {
  g.hl(3, 7, 8, 'rgb(160,120,60)'); // 软木塞
  g.hl(4, 6, 9, 'rgb(150,150,150)');
  g.r(5, 5, 6, 7, 'rgb(190,220,190)');
  g.r(5, 8, 6, 4, 'rgb(90,200,90)');
  g.hl(8, 5, 10, 'rgb(60,170,60)');
  g.hl(11, 5, 10, 'rgb(50,140,50)');
  g.s(6, 9, 'rgb(180,255,150)'); g.s(9, 10, 'rgb(180,255,150)');
}));

// --- 红石物品 ---
reg('redstone_torch_item', { displayName: '红石火把', stack: 64 }, art(g => {
  g.r(7, 6, 2, 8, P.handle[1]);
  g.s(7, 6, P.handle[0]);
  g.r(6, 2, 4, 4, 'rgb(220,40,40)');
  g.r(7, 3, 2, 2, 'rgb(255,110,90)');
  g.s(6, 5, 'rgb(150,20,20)'); g.s(9, 5, 'rgb(150,20,20)');
}));
reg('repeater', { stack: 64 }, art(g => {
  g.r(2, 5, 12, 7, P.stone[1]);
  g.hl(5, 2, 13, P.stone[0]);
  g.hl(11, 2, 13, P.stone[2]);
  g.spi(3, 6, 10, 5, P.stone[2], 101, 0.2);
  g.r(4, 3, 1, 3, P.handle[1]); g.r(5, 2, 1, 3, 'rgb(220,40,40)'); // 两个火把
  g.r(10, 3, 1, 3, P.handle[1]); g.r(11, 2, 1, 3, 'rgb(220,40,40)');
}));
reg('comparator', { stack: 64 }, art(g => {
  g.r(2, 5, 12, 7, P.stone[1]);
  g.hl(5, 2, 13, P.stone[0]);
  g.hl(11, 2, 13, P.stone[2]);
  g.spi(3, 6, 10, 5, P.stone[2], 102, 0.2);
  g.r(4, 3, 1, 3, P.handle[1]); g.r(5, 2, 1, 3, 'rgb(220,40,40)');
  g.r(8, 3, 1, 3, P.handle[1]); g.r(9, 2, 1, 3, 'rgb(220,40,40)');
  g.hl(7, 3, 13, P.iron[1]); // 比较线
}));
reg('lever', { stack: 64 }, art(g => {
  g.r(5, 10, 6, 4, P.stone[1]);
  g.hl(10, 5, 10, P.stone[0]);
  g.hl(13, 5, 10, P.stone[2]);
  g.spi(6, 11, 4, 2, P.stone[2], 103, 0.3);
  for (let i = 0; i < 6; i++) {
    g.s(7 + i, 9 - i, P.handle[1]);
    g.s(8 + i, 9 - i, P.handle[0]);
  }
  g.s(13, 4, 'rgb(200,200,200)'); // 柄头
}));
reg('stone_button', { stack: 64 }, art(g => {
  g.r(4, 6, 8, 4, P.stone[1]);
  g.hl(6, 4, 11, P.stone[0]);
  g.hl(9, 4, 11, P.stone[2]);
  g.vl(4, 6, 9, P.stone[0]); g.vl(11, 6, 9, P.stone[2]);
}));

// --- 花苗等 ---
function saplingArt(leafLight, leafBase, leafDark, seed) {
  return art(g => {
    g.vl(7, 9, 14, P.handle[1]); g.vl(8, 10, 14, P.handle[0]);
    const r = rng(seed);
    for (let y = 3; y < 10; y++) {
      const w = y < 5 ? 2 : (y < 7 ? 4 : 3);
      for (let x = 8 - w; x <= 8 + w; x++) {
        if (r() < 0.85) g.s(x, y, r() < 0.3 ? leafLight : leafBase);
      }
    }
    g.s(8, 2, leafDark); g.s(4, 9, leafDark); g.s(12, 9, leafDark);
  });
}
reg('oak_sapling', { stack: 64 }, saplingArt('rgb(100,190,70)', 'rgb(60,150,45)', 'rgb(34,110,30)', 111));
reg('spruce_sapling', { stack: 64 }, saplingArt('rgb(80,170,110)', 'rgb(44,130,90)', 'rgb(22,90,60)', 112));
reg('wheat_seeds', { stack: 64 }, art(g => {
  for (const [x, y] of [[5, 6], [8, 5], [11, 7], [6, 10], [9, 9], [12, 11], [4, 12]]) {
    g.s(x, y, 'rgb(120,190,80)');
    g.s(x + 1, y, 'rgb(90,160,58)');
  }
}));
reg('bone_meal_item', { displayName: '骨粉', stack: 64 }, dustPileArt('rgb(252,252,246)', 'rgb(206,204,190)', 121));

// 下界之星（Idea-2D-②）：凋灵掉落，信标合成核心材料。八芒星：十字长芒 + 对角短芒 + 亮核
reg('nether_star', { displayName: '下界之星', stack: 64 }, art(g => {
  const W = P.white, cD = 'rgb(190,190,165)';
  g.vl(8, 1, 15, W[1]); g.hl(8, 1, 15, W[1]);      // 十字主芒
  for (let i = 3; i <= 6; i++) {                    // 对角短芒
    g.s(i, i, W[1]); g.s(15 - i, i, W[1]); g.s(i, 15 - i, W[1]); g.s(15 - i, 15 - i, W[1]);
  }
  g.vl(8, 3, 13, W[0]); g.hl(3, 8, 13, W[0]);      // 内层提亮
  g.d(8, 8, 2, 2, W[0]);                            // 中心亮核
  g.s(8, 8, 'rgb(255,255,255)');
  g.s(8, 1, cD); g.s(8, 15, cD); g.s(1, 8, cD); g.s(15, 8, cD);  // 芒尖收细
}));

// ── 天域叙事基石（批次 A，**文件末尾追加**）────────────────────────────
// lore 行 = 语言包键（InventoryScreen tooltip 经 t() 渲染灰字，缺项回落简体）。
// 天青调色板（星髓系）：亮/基/暗
const marrowP = ['rgb(168,244,228)', 'rgb(96,232,210)', 'rgb(52,168,152)'];

// 云絮：三团叠置的白色绒球
reg('cloud_fluff', { stack: 64 }, art(g => {
  g.d(6, 10, 3, 2, 'rgb(214,226,238)');
  g.d(11, 10, 3, 2, 'rgb(206,220,234)');
  g.d(8, 7, 4, 3, 'rgb(243,247,251)');
  g.d(7, 6, 2, 2, 'rgb(255,255,255)');
  g.d(12, 8, 2, 1, 'rgb(236,242,248)');
  g.s(4, 12, 'rgb(186,200,216)'); g.s(13, 12, 'rgb(186,200,216)');
}));

// 星髓：斜置晶簇碎片
reg('star_marrow', { stack: 64 }, art(g => {
  for (let i = 0; i < 9; i++) {
    g.s(4 + i, 13 - i, marrowP[1]);
    g.s(5 + i, 13 - i, marrowP[0]);
    if (i > 1 && i < 7) g.s(6 + i, 13 - i, marrowP[2]);
  }
  g.s(6, 11, 'rgb(255,255,255)'); g.s(9, 8, 'rgb(255,255,255)');
  g.s(4, 13, marrowP[2]); g.s(12, 5, marrowP[2]);
}));

// 潮汐残页×3：羊皮纸 + 撕角 + 各自纹样（涨潮=波线 / 星髓=晶点 / 裂潮=断线）
function pageArt(accent, seed) {
  return art(g => {
    const r = rng(seed);
    const base = 'rgb(232,214,170)', dark = 'rgb(178,156,112)';
    for (let y = 3; y <= 13; y++) for (let x = 3; x <= 12; x++) {
      if ((x >= 11 && y <= 5) && (x - 11 + y - 3) <= 2) continue; // 右上撕角
      g.s(x, y, (x === 3 || x === 12 || y === 13) ? dark : base);
    }
    for (let i = 0; i < 14; i++) if (r() < 0.5) g.s(4 + Math.floor(r() * 8), 5 + Math.floor(r() * 8), dark);
    for (const [x, y] of accent) g.s(x, y, marrowP[1]);
  });
}
reg('page_rising', { stack: 16, lore: ['涨潮纪元的航海日志残页。', '「今夜风向正南，塔灯全明——宜远航。」'] },
  pageArt([[5, 9], [6, 9], [8, 9], [9, 9], [10, 8]], 201));
reg('page_marrow', { stack: 16, lore: ['星髓时代的矿脉勘单残页。', '「脉至最深处，凿之有音，如叩门。」'] },
  pageArt([[6, 8], [9, 6], [9, 10]], 202));
reg('page_sunder', { stack: 16, lore: ['裂潮之日的瞭望记录残页。', '「正午——海退。塔在。我们不再需要灯了。」'] },
  pageArt([[5, 10], [6, 9], [7, 8], [9, 6], [10, 5]], 203));

// 风暴图腾：木柱 + 星髓面纹
reg('storm_totem', { stack: 1, lore: ['云民的星铸图腾，握在手中微微震颤。', '它认得某座祭坛。'] }, art(g => {
  for (let y = 2; y <= 14; y++) for (let x = 6; x <= 9; x++) {
    g.s(x, y, y === 2 || y === 14 ? 'rgb(96,70,36)' : 'rgb(140,108,62)');
  }
  for (const [x, y] of [[7, 4], [8, 4], [7, 7], [8, 7]]) g.s(x, y, marrowP[1]);
  g.s(7, 5, marrowP[0]); g.s(8, 5, marrowP[0]);
  g.s(7, 10, marrowP[2]); g.s(8, 10, marrowP[2]);
  g.s(5, 3, 'rgb(116,85,45)'); g.s(10, 3, 'rgb(116,85,45)');
  g.s(5, 12, 'rgb(116,85,45)'); g.s(10, 12, 'rgb(116,85,45)');
}));

// 风暴之核：青色风环 + 亮核 + 环绕风点
reg('storm_core', { stack: 16, lore: ['守誓巨像碎裂后，仍盘旋不息的风暴之核。'] }, art(g => {
  g.d(8, 8, 5, 5, 'rgba(96,232,210,0.35)');
  g.d(8, 8, 4, 4, marrowP[2]);
  g.d(8, 8, 2, 2, marrowP[0]);
  g.s(8, 8, 'rgb(255,255,255)');
  for (const [x, y] of [[3, 3], [13, 4], [12, 12], [4, 12], [8, 2], [2, 8], [14, 8]]) {
    g.s(x, y, marrowP[1]);
  }
}));

// 心核碎片：暖白心形碎片 + 搏动纹
reg('heart_shard', { stack: 16, lore: ['天穹之心的碎片，仍在极缓慢地搏动。'] }, art(g => {
  const c = ['rgb(255,244,214)', 'rgb(240,214,150)', 'rgb(184,150,84)'];
  g.d(6, 7, 3, 3, c[1]); g.d(10, 7, 3, 3, c[1]);
  g.d(6, 7, 2, 2, c[0]); g.d(10, 7, 2, 2, c[0]);
  for (let i = 0; i < 6; i++) g.s(5 + i, 10 + Math.floor(i / 3), c[1]);
  for (let i = 0; i < 4; i++) g.s(6 + i, 12 - 0, c[0]);
  g.s(6, 5, c[0]); g.s(10, 5, c[0]);
  g.s(4, 4, c[2]); g.s(12, 4, c[2]); g.s(8, 14, c[2]);
}));

// 缚风之剑：青刃 + 木柄（伤害 7 = 钻石剑 + 1；合成闭环在批次 C）
reg('wind_brand', { stack: 1, tool: 'sword', tier: 4, durability: 400, damage: 7 }, art(g => {
  for (let i = 0; i < 8; i++) {
    g.s(5 + i, 10 - i, marrowP[1]);
    g.s(6 + i, 10 - i, marrowP[0]);
    if (i < 6) g.s(7 + i, 10 - i, marrowP[2]);
  }
  g.s(12, 3, 'rgb(255,255,255)'); g.s(11, 4, 'rgb(255,255,255)');
  g.h(4, 11, 5);
  g.s(3, 12, 'rgb(80,56,28)'); g.s(4, 12, 'rgb(80,56,28)');
  g.s(6, 12, 'rgb(117,85,45)'); g.s(7, 13, 'rgb(117,85,45)');
}));

// 御风斗篷：披风造型 + 星髓搭扣（缓降/跳加成效果在批次 C 接入）
reg('gale_cloak', { stack: 1, armorSlot: 'chest', armorPoints: 3 }, art(g => {
  for (let y = 3; y <= 13; y++) for (let x = 4; x <= 11; x++) {
    const edge = x === 4 || x === 11 || y === 13;
    g.s(x, y, edge ? 'rgb(96,110,138)' : 'rgb(138,152,180)');
  }
  for (let x = 5; x <= 10; x++) g.s(x, 3, 'rgb(70,82,106)');
  g.s(7, 5, marrowP[1]); g.s(8, 5, marrowP[1]);
  g.s(6, 6, marrowP[2]); g.s(9, 6, marrowP[2]);
  g.s(5, 9, 'rgb(170,184,208)'); g.s(10, 10, 'rgb(170,184,208)');
}));

// 哀潮之泪（世界观批次 N1：下界·哭嚎者掉落，N3 实装掉落链）：青蓝泪滴 + 微光高光
reg('mourn_tear', { stack: 16, lore: ['哭嚎者坠落时凝下的泪。', '它是咸的——这片地底本没有盐，除了海来过的那部分。'] }, art(g => {
  const c = ['rgb(120,190,220)', 'rgb(74,142,190)', 'rgb(40,92,150)'];
  g.d(8, 9, 3, 4, c[2]);
  g.d(8, 9, 2, 3, c[1]);
  g.d(8, 10, 1, 2, c[0]);
  g.vl(8, 3, 5, c[1]);
  g.s(8, 2, c[0]); g.s(7, 3, c[1]); g.s(9, 3, c[1]);
  g.s(7, 8, 'rgb(220,242,252)'); g.s(8, 7, 'rgb(220,242,252)');
  for (const [x, y] of [[5, 12], [11, 12], [6, 13], [10, 13]]) g.s(x, y, c[2]);
}));

// 雨潮残页（世界观批次 W1：主世界·跨维度收集线材料，W2 起入潮冢/要塞箱）：湿皱残页 + 咸雨字痕
reg('page_rain', { stack: 16, lore: ['从海底的骨环里捞起的残页，字迹被咸水洇开了。', '还能认出的只有一句：「最早的年头，雨是咸的。」'] }, art(g => {
  g.r(3, 3, 10, 10, 'rgb(206,192,156)');   // 页身
  g.r(4, 4, 8, 8, 'rgb(218,206,172)');     // 页心
  for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12], [12, 4], [3, 11]]) {
    g.s(x, y, 'rgb(176,160,124)');         // 磨损卷角
  }
  // 咸水洇痕：右下湿渍团
  for (const [x, y] of [[9, 9], [10, 9], [10, 10], [11, 10], [9, 10], [10, 11]]) {
    g.s(x, y, 'rgb(150,168,176)');
  }
  // 字痕：三行墨线，最下一行被洇开
  g.hl(5, 5, 9, 'rgb(70,96,124)');
  g.hl(7, 5, 8, 'rgb(70,96,124)');
  g.hl(9, 5, 10, 'rgb(96,116,138)');
  // 雨纹小符：页角一竖两滴（与苔纹石碑符文同源）
  g.vl(6, 8, 10, 'rgb(70,96,124)');
  g.s(5, 11, 'rgb(70,96,124)'); g.s(7, 11, 'rgb(70,96,124)');
  // 盐霜亮点
  for (const [x, y] of [[5, 12], [11, 4], [4, 6]]) g.s(x, y, 'rgb(240,238,226)');
}));

// 原初纹章（终局篇 F1：仪式完成发放的唯一信物，不可合成——F3 听潮仪式发放）
// 图形：暗潮石章底 + 波纹环 + 三点（风、坠、雨），与原初祭坛同源符号；
// lore 3 行承载终章（评审结论 3：碑文留白纪律最干净，终章走纹章 lore）
reg('primordial_emblem', { stack: 1, lore: [
  '「风潮、坠潮、雨潮——三枚旧心跳在掌心合成了一声。」',
  '「无潮的岸边，你听见了它：海还没有名字的时候，原初之潮就是这样响的。」',
  '「潮不会回来。但世界记起了自己曾经是一整片海。」',
] }, art(g => {
  const rim = 'rgb(96,118,140)', wave = 'rgb(120,214,206)', pale = 'rgb(222,240,240)';
  g.r(4, 4, 8, 8, 'rgb(58,72,92)');                       // 章底：暗潮石
  for (let x = 4; x <= 11; x++) { g.s(x, 4, rim); g.s(x, 11, rim); } // 方环框
  for (let y = 4; y <= 11; y++) { g.s(4, y, rim); g.s(11, y, rim); }
  g.d(8, 8, 2, 2, 'rgb(86,118,140)');                     // 内芯：原初波纹环
  g.d(8, 8, 1, 1, pale);
  g.hl(7, 7, 9, pale); g.hl(9, 7, 9, 'rgb(120,190,200)'); // 环心一横潮线
  g.s(8, 2, wave); g.s(2, 8, wave); g.s(13, 8, wave);     // 三点：风、坠、雨
  g.s(8, 3, 'rgb(96,190,190)'); g.s(3, 8, 'rgb(96,190,190)'); g.s(12, 8, 'rgb(96,190,190)');
}));


// ── Build 51 R4 魔法三件（**文件末尾追加**，物品 ID 零漂移）────────────────────────
// 回响尘：四界留下的潮的记忆结成的细屑，焦点与仪台的基础材料。
reg('echo_dust', { stack: 64, requiresExtras: ['magic'], lore: ['潮退之后留下的回声，捏在手里微微发凉。'] }, art(g => {
  const pale = 'rgb(196, 232, 228)', mid = 'rgb(120, 190, 190)', deep = 'rgb(70, 130, 140)';
  g.hl(5, 5, 10, mid);
  g.hl(6, 4, 11, pale);
  g.hl(7, 4, 11, pale);
  g.hl(8, 5, 10, mid);
  g.s(5, 6, deep); g.s(10, 6, deep); g.s(8, 9, deep);
  g.spi(4, 4, 8, 7, pale, 301, 0.22);
  g.s(6, 5, 'rgb(255,255,255)'); g.s(9, 8, 'rgb(255,255,255)');
}));

// 风潮焦点：一片绕成环的旧羽 + 台心尘核，握在手里像有风穿过。
reg('gale_focus', { stack: 1, requiresExtras: ['magic'], lore: ['风潮的回响：一步踏出，风替你走完剩下的路。'] }, art(g => {
  const pale = 'rgb(226, 238, 246)', shade = 'rgb(150, 176, 200)', core = 'rgb(120, 208, 214)';
  g.hl(6, 4, 11, pale);
  g.hl(7, 3, 12, pale);
  g.hl(8, 3, 12, shade);
  g.hl(9, 4, 11, shade);
  g.vl(8, 3, 12, shade);
  g.d(8, 8, 2, 2, core);
  g.s(8, 8, 'rgb(240, 255, 255)');
  g.s(4, 12, pale); g.s(11, 4, pale);
}));

// 坠潮焦点：烬火纹章扣在铁环上，中心一点余温。
reg('ember_focus', { stack: 1, requiresExtras: ['magic'], lore: ['坠潮的回响：火不必落地，也能替你说完一句话。'] }, art(g => {
  const iron = 'rgb(148, 152, 160)', ember = 'rgb(226, 128, 72)', glow = 'rgb(255, 206, 132)';
  g.d(8, 8, 4, 4, iron);
  g.d(8, 8, 3, 3, 'rgb(0,0,0,0)');
  for (let y = 4; y <= 12; y++) for (let x = 4; x <= 12; x++) {
    const dx = x - 8, dy = y - 8;
    const d2 = dx * dx + dy * dy;
    if (d2 <= 16 && d2 >= 9) g.s(x, y, iron);
  }
  g.d(8, 8, 2, 2, ember);
  g.s(8, 7, glow); g.s(8, 8, glow); g.s(7, 8, ember);
  g.s(8, 3, ember); g.s(8, 13, 'rgb(160, 90, 60)');
}));

// ── Build 54 R1 魔法四系齐备（**文件末尾追加**，物品 ID 零漂移）────────────────────
// 雨潮焦点：一枚含着一滴未落之雨的陶环——水停在半空，替人把伤口收好。
reg('rain_focus', { stack: 1, requiresExtras: ['magic'], lore: ['雨潮的回响：雨没有落下，只是一直悬在那儿，等你伸手。'] }, art(g => {
  const clayP = 'rgb(178, 183, 198)', clayD = 'rgb(118, 124, 142)', water = 'rgb(120, 196, 220)';
  const paleW = 'rgb(196, 236, 244)';
  for (let y = 4; y <= 12; y++) for (let x = 4; x <= 12; x++) {
    const dx = x - 8, dy = y - 8;
    const d2 = dx * dx + dy * dy;
    if (d2 <= 17 && d2 >= 10) g.s(x, y, d2 >= 15 ? clayD : clayP);
  }
  g.d(8, 9, 2, 3, water);   // 悬着的雨滴
  g.s(8, 6, paleW); g.s(8, 7, paleW); g.s(9, 9, paleW);
  g.s(8, 3, 'rgb(150, 210, 226)'); g.s(13, 8, 'rgb(150, 210, 226)');
}));

// 无潮焦点：一圈没有内芯的环——它记得的是「少掉的那一块」。
reg('tideless_focus', { stack: 1, requiresExtras: ['magic'], lore: ['无潮的回响：末地没有潮，于是距离本身成了一条路。'] }, art(g => {
  const voidP = 'rgb(120, 112, 150)', voidD = 'rgb(70, 64, 96)', spark = 'rgb(196, 186, 236)';
  // 环上三处缺口：留白比实体更醒目（缺口靠不落笔实现，透明色覆盖在新画布上是空操作）
  const gap = (x, y) => (x >= 7 && x <= 9 && y <= 4) || (x <= 4 && y >= 7 && y <= 9) || (x >= 12 && y >= 8 && y <= 10);
  for (let y = 3; y <= 13; y++) for (let x = 3; x <= 13; x++) {
    if (gap(x, y)) continue;
    const dx = x - 8, dy = y - 8;
    const d2 = dx * dx + dy * dy;
    if (d2 <= 26 && d2 >= 13) g.s(x, y, d2 >= 21 ? voidD : voidP);
  }
  g.s(8, 5, spark); g.s(5, 8, spark); g.s(12, 11, spark);
}));

export const ItemSVGDefinitions = svgMap;

export function getItemCount() {
  return ItemRegistry.all().length;
}
