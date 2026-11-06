// build46-grass-path.mjs -- Build 46 草径（村庄路面）批次回归（纯 node，不依赖服务器）
// 断言：
//   ① 注册与追加纪律：grass_path 在文件末尾追加（ID 222，既有 ID 零漂移）、显示名/硬度/工具/
//      transparent/icon/textures 三键正确，两个 SVG 键入表且顶面与 dirt 不同
//   ② 形制：PATH_SHAPE 满格 footprint + 顶面 15/16，cellBox 世界坐标一致（碰撞/渲染同源）
//   ③ 归位：创造栏分类 nature、非技术方块（玩家可见可放置）、等轴图标判定走单面平铺
//   ④ i18n：name 表 11 列、简体列与注册侧 displayName 一致
//   ⑤ 村庄路面：平原/沙漠两种变体的四条道路臂 3 宽全部是 grass_path（旧 coarse_dirt/sandstone 已退场）
//   ⑥ 铲子铺径：Game._tryFarmInteract 的铲子分支存在且带「上方空气」守卫（源码绊线）
import { readFileSync } from 'fs';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { PATH_HEIGHT, PATH_SHAPE, cellBox } from '../src/core/blockShape.js';
import { getItemCategory, isTechnicalBlock, isIsoBlock } from '../src/core/ItemCategories.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
const id = (n) => BlockRegistry.getId(n);
const def = (n) => BlockRegistry.getById(id(n));

// ── ① 注册 / 追加纪律 / 材质键 ──────────────────────────────────────────
{
  const gp = def('grass_path');
  ok(!!gp, 'grass_path 已注册');
  // 尾部追加：既有方块 ID 不得漂移（旧存档/联机账本按数字 ID 落盘），新方块取下一个空位
  ok(gp.id === 222, `grass_path ID = 222（当前 ${gp.id}）`);
  ok(id('stone') === 1 && id('farmland') === 172 && id('tide_plaque') === 221,
    '既有方块 ID 零漂移（stone=1 / farmland=172 / tide_plaque=221）');
  ok(gp.id > id('tide_plaque'), '草径排在上一批方块之后（尾部追加）');

  ok(gp.displayName === '草径', `显示名 草径（当前 ${gp.displayName}）`);
  ok(gp.tool === 'shovel' && Math.abs(gp.hardness - 0.55) < 1e-9, '铲子可挖 / 硬度 0.55');
  ok(gp.transparent === true, 'transparent（形制方块，邻居面不剔除、天光不阻断）');
  ok(gp.solid === true, 'solid（可站立、可碰撞）');
  ok(gp.top === 'grass_path_top' && gp.side === 'grass_path_side' && gp.bottom === 'dirt',
    `贴图三键 top/side/bottom = ${gp.top}/${gp.side}/${gp.bottom}`);
  ok(gp.icon === 'grass_path_top', `图标取顶面（非 side 泥土）：${gp.icon}`);
  ok(gp.renderType === 'cube' && !gp.fluid && !gp.baseBlock && !gp.light, '普通方块（非流体/非状态家族/不发光）');

  const topSvg = BlockSVGDefinitions.grass_path_top;
  const sideSvg = BlockSVGDefinitions.grass_path_side;
  ok(typeof topSvg === 'string' && topSvg.includes('<svg') && topSvg.length > 500, '顶面 SVG 已生成');
  ok(typeof sideSvg === 'string' && sideSvg.includes('<svg') && sideSvg.length > 500, '侧面 SVG 已生成');
  ok(topSvg !== BlockSVGDefinitions.dirt, '顶面不复用 dirt（踩实土 + 残草，看得出是路）');
  ok(typeof BlockSVGDefinitions.dirt === 'string', '底面复用已注册的 dirt 贴图键');
}

// ── ② 形制：满格 footprint + 顶面 15/16 ─────────────────────────────────
{
  ok(Math.abs(PATH_HEIGHT - 15 / 16) < 1e-12, `PATH_HEIGHT = 15/16（当前 ${PATH_HEIGHT}）`);
  ok(Array.isArray(PATH_SHAPE.from) && Array.isArray(PATH_SHAPE.to), 'PATH_SHAPE 为 AABB');
  ok(PATH_SHAPE.from.join(',') === '0,0,0', 'PATH_SHAPE 从格底起');
  ok(Math.abs(PATH_SHAPE.to[1] - 15 / 16) < 1e-12, 'PATH_SHAPE 顶面比整格低 1 像素');
  ok(PATH_SHAPE.to[0] === 1 && PATH_SHAPE.to[2] === 1, 'PATH_SHAPE 水平满格（3 宽道路无缝）');
  ok(def('grass_path').shape === PATH_SHAPE, '方块 shape 与 PATH_SHAPE 同源');

  const box = cellBox(def('grass_path'), 10, 64, -3);
  ok(!!box, 'cellBox 为形制方块返回 AABB');
  ok(box.join(',') === '10,64,-3,11,64.9375,-2', `cellBox 世界坐标正确（${box.join(',')}）`);
  ok(cellBox(def('stone'), 0, 0, 0) === null, '满格方块不分配 shape 盒（热路径零分配不变）');
}

// ── ③ 创造栏归位 / 图标形制 ─────────────────────────────────────────────
{
  const gp = def('grass_path');
  ok(isTechnicalBlock(gp) === false, '非技术方块（创造物品栏可见）');
  ok(getItemCategory('grass_path') === 'nature', `创造分类 nature（当前 ${getItemCategory('grass_path')}）`);
  ok(isIsoBlock(gp) === false, '非满格立方 → 图标走单面平铺（与门/床/耕地同款）');
  ok(gp.solid && !gp.fluid, '放置后是实心地面（村庄道路可走）');
}

// ── ④ i18n 十一语 ───────────────────────────────────────────────────────
{
  const row = NAME_I18N.grass_path;
  ok(Array.isArray(row) && row.length === 11, `names.js 11 列（当前 ${row ? row.length : 'missing'}）`);
  ok(row && row[0] === def('grass_path').displayName, `简体列与 displayName 一致（${row && row[0]}）`);
  ok(row && row[1] === '草徑' && row[2] === 'Grass Path' && row[4] === 'Grasweg', '繁中/英/德 三列填好');
}

// ── ⑤ 村庄路面：两种变体的四条道路臂全部是草径 ──────────────────────────
{
  const gen = new TerrainGenerator(20250903);
  const sm = gen.structureManager;
  let plains = null, desert = null;
  for (let cx = -14; cx <= 14 && !(plains && desert); cx++) {
    for (let cz = -14; cz <= 14 && !(plains && desert); cz++) {
      const rec = sm.ensureRecord('village', cx, cz);
      if (!rec) continue;
      if (rec.meta.variant === 'plains' && !plains) plains = rec;
      if (rec.meta.variant === 'desert' && !desert) desert = rec;
    }
  }
  ok(!!plains, '扫描区找到平原村庄');
  ok(!!desert, '扫描区找到沙漠村庄（两种变体都要换路面）');

  const pathId = id('grass_path');
  const oldIds = { coarse_dirt: id('coarse_dirt'), sandstone: id('sandstone') };
  for (const [label, rec] of [['plains', plains], ['desert', desert]]) {
    if (!rec) continue;
    const cells = new Map();
    for (const b of rec.blocks) cells.set(`${b[0]},${b[1]},${b[2]}`, b[3]);
    const { ax, az, groundY } = rec;
    let road = 0, bad = 0, old = 0;
    // 四臂：t=3..12（井口之外、道路中段），3 格宽
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let t = 3; t <= 12; t++) {
        for (let w = -1; w <= 1; w++) {
          const px = dx ? ax + dx * t : ax + w;
          const pz = dz ? az + dz * t : az + w;
          const got = cells.get(`${px},${groundY},${pz}`) || 0;
          road++;
          if (got !== pathId) bad++;
          if (got === oldIds.coarse_dirt || got === oldIds.sandstone) old++;
        }
      }
    }
    ok(road === 120, `[${label}] 道路采样点 120（当前 ${road}）`);
    ok(bad === 0, `[${label}] 道路面全部为 grass_path（不符 ${bad}/${road}）`);
    ok(old === 0, `[${label}] 旧路面材质（coarse_dirt/sandstone）已从道路退场（残留 ${old}）`);
    const pathCount = rec.blocks.filter((b) => b[3] === pathId).length;
    ok(pathCount > 100, `[${label}] 村庄草径方块数 > 100（当前 ${pathCount}）`);
    // 地基/房屋材质不受影响：平原仍是圆石+橡木，沙漠仍是砂岩
    const baseId = id(rec.meta.variant === 'plains' ? 'cobblestone' : 'sandstone');
    ok(rec.blocks.some((b) => b[3] === baseId), `[${label}] 地基材质未被路面替换波及`);
  }

  const villageSrc = srcOf('../src/world/structures/village.js');
  ok((villageSrc.match(/path: blockId\('grass_path'\)/g) || []).length === 2,
    'village.js 两种变体的 path 都是 grass_path');
  ok(!villageSrc.includes("path: blockId('coarse_dirt')") && !villageSrc.includes("path: blockId('sandstone')"),
    '旧路面材质（coarse_dirt / sandstone）已移除');
}

// ── ⑥ 铲子铺径（源码绊线：右终端行为在 InteractionController→_tryFarmInteract）──
{
  const gameSrc = srcOf('../src/player/Game.js');
  const start = gameSrc.indexOf('_tryFarmInteract(hit, groundDef, sel) {');
  const end = gameSrc.indexOf('\n  // 末影水晶被击碎', start);
  ok(start > 0 && end > start, '定位 _tryFarmInteract 方法体');
  const body = start > 0 && end > start ? gameSrc.slice(start, end) : '';
  ok(body.includes("item.tool === 'shovel'"), '铲子工具判定在右键耕作链内');
  ok(body.includes("groundDef.name === 'coarse_dirt'"), '砂土也可拍成草径');
  ok(body.includes("BlockRegistry.getId('grass_path')"), '拍径写入 grass_path');
  ok(body.includes("this.world.getBlock(x, y + 1, z) === 0"), '上方须空气（不覆盖头顶方块）');
  ok((body.match(/this\.hand\.swing\(\)/g) || []).length >= 2, '铺径与锄地同样触发挥臂');
  // 锄地分支的语义未被改写（草/土 → 耕地）
  ok(body.includes("item.tool === 'hoe'") && body.includes("BlockRegistry.getId('farmland')"), '锄地分支保持原样');
}

finish('build46-grass-path');
