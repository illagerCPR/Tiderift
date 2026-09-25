// build29-rename-icons.mjs -- Build 29 批次回归（node 直跑，无需服务器）
// 断言：
//   ① 更名落地：BUILD=29、VERSION_LABEL="Tiderift Beta Build 29"、src/ 全目录无 CubeWorld 残留、
//     index.html 标题/favicon、MenuScreen logo、package.json、README 徽章与仓库 URL、admin.html 面板标题
//   ② 创造模式技术性方块过滤：流体/流动等级/状态家族变体（baseBlock）/传送门/作物阶段/活塞头/气流
//     全部被 isTechnicalBlock 拦截；内容方块（含 farmland/红石件/石碑/祭坛）保留；类JEI 面板不受影响
//   ③ 图标形制判定 isIsoBlock：满格立方 → 等轴三面；cross/portal/flat/shape/流体 → 单面平铺
//   ④ 等轴可渲染性：全部 iso 方块的 top/front/side 贴图在 BlockSVGDefinitions 内齐备（永不走平铺兜底）
//   ⑤ 统一绘制入口绊线：7 个调用站委托 BlockIcon；旧 `block.icon || block.side || block.top` 全局仅剩
//     BlockIcon 兜底一处；Hotbar 过期守卫在位；等轴矩阵/压暗/缓存关键行在位
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BUILD, VERSION_LABEL } from '../src/version.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import '../src/items/ItemDefs.js'; // 副作用导入：物品注册表填充（漏了 getByName 全空）
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { isTechnicalBlock, isIsoBlock } from '../src/core/ItemCategories.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
const def = (n) => BlockRegistry.getById(BlockRegistry.getId(n));

// ── ① 更名落地 ──
ok(BUILD === 29, `BUILD = 29（当前 ${BUILD}）`);
ok(VERSION_LABEL === 'Tiderift Beta Build 29', `VERSION_LABEL = Tiderift Beta Build 29（当前 "${VERSION_LABEL}"）`);
ok(srcOf('../src/version.js').includes('`Tiderift Beta Build ${BUILD}`'), 'version.js 模板为 Tiderift Beta Build');

// src/ 全目录无 CubeWorld 残留（改名完整性；历史名称只允许留在 docs/AGENTS/README 的叙述里）
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const jsFiles = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) jsFiles.push(p);
  }
})(root);
for (const p of jsFiles) {
  const text = readFileSync(p, 'utf-8');
  ok(!text.includes('CubeWorld'), `src/${p.split('/src/')[1]} 无 CubeWorld 残留`);
}

const indexHtml = srcOf('../index.html');
ok(indexHtml.includes('<title>Tiderift</title>'), 'index.html 标题为 Tiderift');
ok(indexHtml.includes('res/logo-tiderift-js-edition.png'), 'index.html favicon 指向新 logo');
const menuSrc = srcOf('../src/ui/MenuScreen.js');
ok(menuSrc.includes("logo-tiderift-js-edition.png"), 'MenuScreen 引用新 logo');
ok(menuSrc.includes('alt="Tiderift"'), 'MenuScreen logo alt 为 Tiderift');
ok(JSON.parse(srcOf('../package.json')).name === 'tiderift', 'package.json name = tiderift');
const readme = srcOf('../README.md');
ok(readme.includes('logo-tiderift-js-edition.png'), 'README 使用新 logo');
ok(!readme.includes('illagerCPR/CubeWorld'), 'README 无旧仓库 URL');
ok(readme.includes('illagerCPR/Tiderift'), 'README 徽章/仓库指向 Tiderift');
const adminHtml = srcOf('../server/admin.html');
ok(adminHtml.includes('Tiderift 服务器管理面板') && !adminHtml.includes('CubeWorld'), 'admin.html 面板标题已更名');

// ── ② 创造模式技术性方块过滤 ──
const TECHNICAL_EXPECT = [
  'water', 'lava', 'water_flow_1', 'water_flow_7', 'lava_flow_1', 'lava_flow_3', // 流体与流动等级
  'piston_head',                                                                  // 活塞头载体
  'end_portal', 'nether_portal', 'aether_portal', 'end_gateway', 'end_portal_frame_eye', // 传送门与嵌眼框架
  'wind_current',                                                                 // 气流载体
  'wheat_crop_0', 'wheat_crop_7',                                                 // 作物生长阶段
  'chest_s', 'chest_e', 'chest_w',                                                // B28 朝向家族
  'furnace_s', 'furnace_e', 'furnace_w', 'furnace_lit', 'furnace_lit_s', 'furnace_lit_e', 'furnace_lit_w',
  'wither_skeleton_skull_s', 'wither_skeleton_skull_e', 'wither_skeleton_skull_w',
  'redstone_lamp_lit',
  'oak_door_lower_s', 'oak_door_upper', 'oak_door_upper_n_open', 'oak_door_upper_w_open', // B27 门家族
  'iron_door_lower_w', 'iron_door_upper_e_open',
  'oak_trapdoor_s', 'oak_trapdoor_e_open', 'oak_trapdoor_w',
  'white_bed_foot_s', 'white_bed_head_e',
];
const CONTENT_EXPECT = [
  'stone', 'grass_block', 'glass', 'bedrock', 'snow_layer',
  'chest', 'furnace', 'white_bed', 'oak_door', 'iron_door', 'oak_trapdoor', 'shulker_box',
  'farmland', 'redstone_wire', 'redstone_torch', 'lever', 'piston', 'sticky_piston', 'tnt',
  'end_portal_frame', 'dragon_egg', 'end_crystal',
  'wind_stele', 'ember_stele', 'moss_stele', 'end_stele',          // 石碑家族
  'aether_altar', 'tide_altar', 'primordial_altar',                // 祭坛家族
  'star_marrow_block', 'cloud_wool', 'gale_block', 'whale_bone_block',
  'redstone_lamp', 'wither_skeleton_skull', 'note_block', 'beacon',
];
for (const n of TECHNICAL_EXPECT) {
  ok(def(n) && isTechnicalBlock(def(n)), `技术方块被过滤：${n}`);
}
for (const n of CONTENT_EXPECT) {
  ok(def(n) && !isTechnicalBlock(def(n)), `内容方块保留：${n}`);
}

// 创造列表模拟（InventoryScreen._renderCreativeGrid 同口径）
const creativeBlocks = BlockRegistry.all().filter((b) => b.name !== 'air' && !isTechnicalBlock(b));
const creativeNames = new Set(creativeBlocks.map((b) => b.name));
ok(creativeBlocks.length >= 100 && creativeBlocks.length <= 150, `创造方块数量合理（当前 ${creativeBlocks.length}）`);
ok(!creativeNames.has('water') && !creativeNames.has('piston_head') && !creativeNames.has('furnace_lit'),
  '创造列表不含技术方块样本');
ok(creativeNames.has('farmland') && creativeNames.has('chest') && creativeNames.has('redstone_wire'),
  '创造列表含内容方块样本');
// 桶类物品是物品不是方块——水/岩浆仍可经桶取用（物品路径不过滤）
ok(!!ItemRegistry.getByName('water_bucket') && !!ItemRegistry.getByName('lava_bucket'), '水桶/岩浆桶物品仍在');
// 类JEI 不受影响：RecipeViewer 不做技术过滤（全量方块列表原样）
ok(!srcOf('../src/ui/RecipeViewer.js').includes('isTechnicalBlock'), '类JEI 不做技术方块过滤');
ok(srcOf('../src/ui/InventoryScreen.js').includes('!isTechnicalBlock(b)'), '创造列表过滤在位');

// ── ③ 图标形制判定 ──
const ISO_EXPECT = ['stone', 'glass', 'oak_leaves', 'ice', 'cactus', 'chest', 'furnace',
  'wither_skeleton_skull', 'beacon', 'melon', 'pumpkin', 'note_block', 'piston', 'sticky_piston',
  'piston_head', 'crafting_table', 'sandstone', 'quartz_block', 'shulker_box', 'star_marrow_block',
  'whale_bone_block', 'mushroom_cap_red', 'end_crystal', 'snow_layer'];
const FLAT_EXPECT = ['torch', 'redstone_torch', 'redstone_wire', 'lever', 'stone_button', 'oak_button',
  'tall_grass', 'sunflower', 'red_mushroom', 'brown_mushroom', 'chorus_plant', 'chorus_flower',
  'lily_pad', 'wheat_crop_0', 'wind_current', 'oak_door', 'white_bed', 'oak_trapdoor',
  'water', 'lava', 'nether_portal', 'air'];
for (const n of ISO_EXPECT) ok(isIsoBlock(def(n)), `等轴图标：${n}`);
for (const n of FLAT_EXPECT) ok(!isIsoBlock(def(n)), `平铺图标：${n}`);
const isoCount = BlockRegistry.all().filter(isIsoBlock).length;
ok(isoCount >= 100, `等轴方块覆盖面（当前 ${isoCount}）`);

// ── ④ 等轴贴图齐备（全部 iso 方块永不走平铺兜底） ──
for (const b of BlockRegistry.all().filter(isIsoBlock)) {
  const front = b.front || b.side;
  ok(!!(BlockSVGDefinitions[b.top] && BlockSVGDefinitions[b.side] && BlockSVGDefinitions[front]),
    `等轴三面贴图齐备：${b.name}（top=${b.top} side=${b.side} front=${front}）`);
}

// ── ⑤ 统一绘制入口绊线 ──
const blockIcon = srcOf('../src/render/BlockIcon.js');
ok(blockIcon.includes('0.875, -0.5, 0.875, 0.5') && blockIcon.includes('0.875, 0.5, 0, 0.875'),
  '等轴 FACE_XFORMS 矩阵在位（2:1 dimetric）');
ok(blockIcon.includes("level: 1.0") && blockIcon.includes("level: 0.8") && blockIcon.includes("level: 0.6"),
  '面亮度三级（top 1.0 / 左 0.8 / 右 0.6，原版规则）');
ok(blockIcon.includes("'multiply'") && blockIcon.includes("'destination-in'"),
  '压暗用 multiply + destination-in 恢复 alpha');
ok(blockIcon.includes('`${name}@${size}`'), '图标缓存按 name@size 记账');
ok(blockIcon.includes('def.front || def.side'), '等轴取面走 B28 定向面（箱子/熔炉正面可见）');
ok(blockIcon.includes('isStale'), 'drawIconInto 支持过期守卫');
for (const f of ['src/ui/InventoryScreen.js', 'src/ui/Hotbar.js', 'src/ui/ChestScreen.js',
  'src/ui/FurnaceScreen.js', 'src/ui/TradeScreen.js', 'src/ui/RecipeViewer.js', 'src/render/RemoteHotbarSprite.js']) {
  ok(srcOf('../' + f).includes("from '../render/BlockIcon.js'") || srcOf('../' + f).includes("from './BlockIcon.js'"),
    `${f} 已委托 BlockIcon`);
}
ok(srcOf('../src/ui/Hotbar.js').includes('() => this._sig[i] !== sig'), 'Hotbar 过期守卫延续');
ok(srcOf('../src/render/RemoteHotbarSprite.js').includes('getBlockIcon(name, 32)'), '远端头顶快捷栏走等轴图标');
// 旧单面取纹链全局只剩 BlockIcon 兜底一处
let legacyCount = 0;
for (const p of jsFiles) {
  if (readFileSync(p, 'utf-8').includes('block.icon || block.side || block.top')) legacyCount++;
}
ok(legacyCount === 1, `旧取纹链仅剩 BlockIcon 兜底一处（当前 ${legacyCount}）`);
ok(srcOf('../server/run-all-tests.sh').includes('build29-rename-icons'), 'run-all-tests.sh 已登记本套件');

console.log(`build29-rename-icons: ${passed} assertions passed`);
