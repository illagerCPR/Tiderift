// build28-block-textures.mjs -- Build 28 方块材质（定向面/多面纠偏）批次回归（node 直跑，无需服务器）
// 断言：
//   ① 注册与 ID 稳定：家族规模（箱子 4/熔炉 8/头颅 4/红石灯 2）、本名语义不变、
//     新增变体一律尾部追加（既有方块 ID 零漂移）、Uint8 上限、front/faceTex/icon/facingBase/lit 白名单透传
//   ② 定向面解析：front 纹理只出现在 facing 面，其余三面为 side；图标取定向面（UI 可见正面）
//   ③ 几何级：ChunkMesh 逐面取纹理（四朝向箱子六面 UV 实测）
//   ④ 多面纠偏：耕地/仙人掌/西瓜/音符盒/信标/潜影盒/活塞头/砂岩/石英 顶≠侧；
//     全局 SVG 引用完整性（防 fallback 到整图集）
//   ⑤ 行为级：红石灯充能切换（真 World + RedstoneSystem）、熔炉点燃态 id 互转、
//     掉落/取物/召唤/联机的家族判定与工具门控（源码绊线）
import { readFileSync } from 'fs';
import { World } from '../src/core/World.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { RedstoneSystem } from '../src/core/RedstoneSystem.js';
import { facingId, furnaceLitId } from '../src/core/blockShape.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
const id = (n) => BlockRegistry.getId(n);
const def = (n) => BlockRegistry.getById(id(n));

// ── ① 注册家族 / ID 稳定 / 白名单透传 ──
{
  const all = BlockRegistry.all();
  ok(all.length >= 211, `方块总数 ≥ 211（当前 ${all.length}）`);
  ok(Math.max(...all.map((b) => b.id)) <= 255, '最大方块 ID 不超 Uint8 上限 255');

  // 新增状态变体只能追加在尾部：既有方块 ID 必须逐字节不动（旧存档/联机账本按数字 ID 存）
  const PINNED = {
    stone: 1, grass_block: 2, furnace: 71, cactus: 91, melon: 93, redstone_lamp: 107,
    piston_head: 115, oak_door: 118, chest: 170, shulker_box: 171, farmland: 172,
    note_block: 158, wither_skeleton_skull: 182, beacon: 183, whale_bone_block: 196,
  };
  for (const [name, want] of Object.entries(PINNED)) {
    ok(id(name) === want, `ID 零漂移：${name} = ${want}（当前 ${id(name)}）`);
  }

  const fam = (base) => all.filter((b) => b.name === base || b.baseBlock === base);
  ok(fam('chest').length === 4, `箱子家族 4 状态（当前 ${fam('chest').length}）`);
  ok(fam('furnace').length === 8, `熔炉家族 8 状态（4 朝向 × 未点燃/点燃，当前 ${fam('furnace').length}）`);
  ok(fam('wither_skeleton_skull').length === 4, `凋灵头颅家族 4 状态（当前 ${fam('wither_skeleton_skull').length}）`);
  ok(fam('redstone_lamp').length === 2, `红石灯家族 2 状态（当前 ${fam('redstone_lamp').length}）`);

  // 本名语义（旧存档/结构/账本零迁移）
  const chest0 = def('chest');
  ok(chest0.facing === 'n' && chest0.facingBase === 'chest' && chest0.baseBlock === 'chest',
    'chest 本名 = 朝北 + 放置朝向家族基名');
  const fur0 = def('furnace');
  ok(fur0.facing === 'n' && fur0.lit === false && fur0.light === 0, 'furnace 本名 = 朝北/未点燃/不发光');
  const lamp0 = def('redstone_lamp');
  ok(lamp0.lit === false && lamp0.light === 0, 'redstone_lamp 本名 = 未充能（light 0，此前恒亮 15）');
  const lamp1 = def('redstone_lamp_lit');
  ok(lamp1.lit === true && lamp1.light === 15 && lamp1.baseBlock === 'redstone_lamp',
    'redstone_lamp_lit = 充能态（light 15）且回指基础名');
  const skull0 = def('wither_skeleton_skull');
  ok(skull0.facing === 'n' && skull0.baseBlock === 'wither_skeleton_skull', '头颅本名 = 朝北');

  // 白名单透传（B26 fluidType / B27 shape 同款陷阱：新增字段漏加白名单会被静默丢弃）
  const chestE = BlockRegistry.getById(facingId('chest', 'e'));
  ok(chestE && chestE.facing === 'e', 'facing 白名单透传（chest_e）');
  ok(chestE.front === 'chest_front' && !!chestE.faceTex, 'front / faceTex 白名单透传');
  ok(chestE.icon === 'chest_front', 'icon 白名单透传（取定向面）');
  ok(chestE.facingBase === null && chestE.baseBlock === 'chest', '变体不再带 facingBase（只有本名带）');
  const furLit = BlockRegistry.getById(facingId('furnace_lit', 'w'));
  ok(furLit && furLit.lit === true && furLit.facing === 'w' && furLit.light === 13,
    'lit / light / facing 三字段透传（furnace_lit_w）');
  const farm = def('farmland');
  ok(farm.icon === 'farmland', 'icon 显式覆盖透传（耕地图标不被 side=dirt 顶掉）');
}

// ── ② 定向面解析 + 图标 ──
{
  const DIRS = ['n', 's', 'e', 'w'];
  const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
  for (const base of ['chest', 'furnace', 'furnace_lit', 'wither_skeleton_skull']) {
    for (const facing of DIRS) {
      const b = BlockRegistry.getById(facingId(base, facing));
      ok(!!b, `${base} 朝向 ${facing} 已注册`);
      ok(b.faceTex && b.faceTex[facing] === b.front, `${base}_${facing}：front 纹理落在 facing 面`);
      for (const d of DIRS) {
        if (d === facing) continue;
        ok(b.faceTex[d] === b.side, `${base}_${facing}：${d} 面用 side（非正面）`);
      }
      ok(OPP[facing] !== facing && b.faceTex[OPP[facing]] === b.side,
        `${base}_${facing}：背面不是正面纹理（旧版前后左右同一张图）`);
    }
  }
  // 无定向面的方块不应生成 faceTex（避免影响既有 UV 路径）
  ok(def('stone').faceTex === null && def('oak_log').faceTex === null, '非定向面方块 faceTex 为 null');
  // 四面朝向下 front 纹理互不相同地落在不同面
  const seen = new Set();
  for (const facing of DIRS) {
    const b = BlockRegistry.getById(facingId('chest', facing));
    const key = DIRS.findIndex((d) => b.faceTex[d] === b.front);
    seen.add(key);
  }
  ok(seen.size === 4, '箱子四朝向的正面落在四个不同面');
}

// ── ③ 几何级：ChunkMesh 逐面取纹理（四朝向箱子） ──
{
  const { ChunkMeshBuilder } = await import('../src/render/ChunkMesh.js');
  const THREE = await import('three');
  const world = new World(20250903);
  world.ensureChunk(0, 0);
  // 四朝向箱子悬空摆放（六面均无邻居遮挡，保证 6 面全部生成）
  const spots = [['n', 2, 2], ['s', 6, 2], ['e', 2, 6], ['w', 6, 6]];
  for (const [facing, x, z] of spots) world.setBlock(x, 120, z, facingId('chest', facing), false);
  // 多面纠偏样块：耕地在顶面用 farmland、侧面用 dirt
  world.setBlock(10, 120, 10, id('farmland'), false);

  const uvRects = new Map();
  for (const n of ['chest_front', 'chest_side', 'chest_top', 'chest_bottom', 'farmland', 'dirt']) {
    uvRects.set(n, { u0: 0.01 * (uvRects.size + 1), v0: 0.5, u1: 0.01 * (uvRects.size + 1) + 0.005, v1: 0.55 });
  }
  const builder = new ChunkMeshBuilder(world, new THREE.Texture(), uvRects, new THREE.Texture());
  const c = world.ensureChunk(0, 0);
  builder._fillCache(c); builder._fillLightCaches(c); builder._refreshOpaqueLUT();
  const out = builder._collectData(c);
  ok(!!out.solid, 'solid 几何存在');

  const pos = out.solid.position, nor = out.solid.normal, uv = out.solid.uv;
  const texAt = (u0, u1, v0, v1) => {
    for (const [name, r] of uvRects) {
      if (Math.abs(u0 - r.u0) < 1e-6 && Math.abs(u1 - r.u1) < 1e-6 &&
          Math.abs(v0 - r.v0) < 1e-6 && Math.abs(v1 - r.v1) < 1e-6) return name;
    }
    return '?';
  };
  const FACE_KEY = { '1,0,0': 'e', '-1,0,0': 'w', '0,1,0': 'top', '0,-1,0': 'bottom', '0,0,1': 's', '0,0,-1': 'n' };
  // 逐面（4 顶点一组）反查：该面属于哪个方块格、法线方向、所用纹理矩形
  const facesOf = (bx, by, bz) => {
    const got = {};
    for (let i = 0; i < pos.length; i += 4) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let k = 0; k < 4; k++) {
        const px = pos[(i + k) * 3], py = pos[(i + k) * 3 + 1], pz = pos[(i + k) * 3 + 2];
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
        u0 = Math.min(u0, uv[(i + k) * 2]); u1 = Math.max(u1, uv[(i + k) * 2]);
        v0 = Math.min(v0, uv[(i + k) * 2 + 1]); v1 = Math.max(v1, uv[(i + k) * 2 + 1]);
      }
      const E = 1e-6;
      if (minX < bx - E || maxX > bx + 1 + E || minY < by - E || maxY > by + 1 + E ||
          minZ < bz - E || maxZ > bz + 1 + E) continue;
      const key = FACE_KEY[`${nor[i * 3]},${nor[i * 3 + 1]},${nor[i * 3 + 2]}`];
      if (key) got[key] = texAt(u0, u1, v0, v1);
    }
    return got;
  };
  for (const [facing, x, z] of spots) {
    const got = facesOf(x, 120, z);
    ok(got[facing] === 'chest_front', `箱子(朝${facing}) 的 ${facing} 面用 chest_front（实测 ${got[facing]}；${JSON.stringify(got)}）`);
    for (const d of ['n', 's', 'e', 'w']) {
      if (d === facing) continue;
      ok(got[d] === 'chest_side', `箱子(朝${facing}) 的 ${d} 面用 chest_side（实测 ${got[d]}）`);
    }
    ok(got.top === 'chest_top' && got.bottom === 'chest_bottom',
      `箱子(朝${facing}) 顶/底面分别为盖板/底板（实测 ${got.top}/${got.bottom}）`);
  }
  {
    const got = facesOf(10, 120, 10);
    ok(got.top === 'farmland' && got.e === 'dirt', `耕地顶面 farmland / 侧面 dirt（实测 ${got.top}/${got.e}）`);
  }
}

// ── ④ 多面纠偏清单 + SVG 引用完整性 ──
{
  const MULTI = {
    farmland: { top: 'farmland', side: 'dirt' },
    cactus: { top: 'cactus_top', side: 'cactus' },
    melon: { top: 'melon_top', side: 'melon' },
    note_block: { top: 'note_block_top', side: 'note_block_side' },
    sandstone: { top: 'sandstone_top', side: 'sandstone' },
    red_sandstone: { top: 'red_sandstone_top', side: 'red_sandstone' },
    quartz_block: { top: 'quartz_block_top', side: 'quartz_block' },
  };
  for (const [name, want] of Object.entries(MULTI)) {
    const b = def(name);
    ok(b.top === want.top && b.side === want.side, `${name} 顶/侧分离（${b.top}/${b.side}）`);
    ok(b.top !== b.side, `${name} 顶面不再与侧面同图`);
  }
  for (const name of ['beacon', 'shulker_box', 'piston_head']) {
    const b = def(name);
    ok(b.top !== b.side && b.side !== b.bottom && b.top !== b.bottom,
      `${name} 三面互异（${b.top}/${b.side}/${b.bottom}）`);
  }
  // 全局：所有方块引用的纹理键必须在 SVG 表内（缺键 → ChunkMesh fallback 整图集，方块糊成拼图）
  const svgKeys = new Set(Object.keys(BlockSVGDefinitions));
  const missing = [];
  for (const b of BlockRegistry.all()) {
    if (b.id === 0) continue; // 空气不渲染、无贴图（注册表按名兜底为 'air'）
    for (const t of [b.top, b.side, b.bottom, b.front]) {
      if (t && !svgKeys.has(t)) missing.push(`${b.name}:${t}`);
    }
  }
  ok(missing.length === 0, `全部方块纹理键都在 SVG 表内（缺 ${missing.length}：${missing.slice(0, 4).join(',')}）`);
  ok(BlockRegistry.all().filter((b) => b.id > 0 && b.front).every((b) => svgKeys.has(b.front)),
    '定向面纹理键全部存在');
  // SVG 值必须是可渲染的 <svg> 字符串：纹理函数漏 pixelSvg（返回像素数组）时
  // svgToImage 的 img.onerror 会让图集构建 reject → Game.start 整体失败（本批真踩到）
  const badSvg = [];
  for (const [k, v] of Object.entries(BlockSVGDefinitions)) {
    if (typeof v !== 'string' || !v.startsWith('<svg')) { badSvg.push(`${k}:非svg(${Array.isArray(v) ? 'array' : typeof v})`); continue; }
    if (/NaN|undefined/.test(v)) badSvg.push(`${k}:NaN`);
    if (!v.includes('<rect ')) badSvg.push(`${k}:空图`);
  }
  ok(badSvg.length === 0, `全部 SVG 可渲染（异常 ${badSvg.length}：${badSvg.slice(0, 4).join(',')}）`);
  // 新批纹理逐个点名（漏 pixelSvg 的高危面）
  for (const k of ['chest_front', 'chest_top', 'chest_bottom', 'chest_side', 'furnace_front',
    'furnace_front_lit', 'furnace_side', 'furnace_top', 'wither_skull_front', 'wither_skull_side',
    'wither_skull_top', 'redstone_lamp', 'redstone_lamp_lit', 'cactus_top', 'melon_top',
    'note_block_top', 'note_block_side', 'beacon_top', 'beacon_side', 'beacon_bottom',
    'shulker_box_top', 'shulker_box_side', 'shulker_box_bottom', 'piston_head_top',
    'piston_head_side', 'piston_head_bottom', 'sandstone_top', 'red_sandstone_top', 'quartz_block_top']) {
    ok(typeof BlockSVGDefinitions[k] === 'string' && BlockSVGDefinitions[k].startsWith('<svg'),
      `${k} 为可渲染 SVG 字符串`);
  }
}

// ── ⑤ 红石灯充能切换（真 World + RedstoneSystem 行为级） ──
{
  const world = new World(20250903);
  world.ensureChunk(0, 0);
  const S = id('stone');
  for (let x = 0; x <= 15; x++) for (let z = 0; z <= 15; z++) world.setBlock(x, 100, z, S, false);
  world.setBlock(4, 101, 4, id('lever'), false);
  world.setBlock(5, 101, 4, id('redstone_wire'), false);
  world.setBlock(6, 101, 4, id('redstone_lamp'), false);
  const rs = new RedstoneSystem(world);
  ok(rs.onBlockInteract(4, 101, 4, id('lever')), '拉杆可交互');
  for (let i = 0; i < 8; i++) rs.update(0.05);
  ok(world.getBlock(6, 101, 4) === id('redstone_lamp_lit'), '充能 → 红石灯变充能态方块');
  ok(rs.onBlockInteract(4, 101, 4, id('lever')), '拉杆再次切换');
  for (let i = 0; i < 8; i++) rs.update(0.05);
  ok(world.getBlock(6, 101, 4) === id('redstone_lamp'), '断能 → 红石灯回未充能态');
  ok(rs.setLampLit(6, 101, 4, true) === true && rs.setLampLit(6, 101, 4, true) === false,
    'setLampLit：首次切换成功、同态重复调用不写方块');
  ok(rs.setLampLit(6, 100, 4, true) === false, 'setLampLit：非红石灯方块拒绝');
}

// ── ⑥ 熔炉点燃态 id 互转 + 家族 id 查询 ──
{
  ok(facingId('chest', 'n') === id('chest'), 'facingId：朝北 = 家族本名');
  for (const f of ['s', 'e', 'w']) ok(facingId('chest', f) === id(`chest_${f}`), `facingId：chest_${f}`);
  ok(facingId('furnace_lit', 'n') === id('furnace_lit'), 'facingId：furnace_lit 本名');
  ok(furnaceLitId('e', true) === id('furnace_lit_e') && furnaceLitId('e', false) === id('furnace_e'),
    'furnaceLitId：同朝向两态互转');
  ok(facingId('no_such_family', 'e') === 0, 'facingId：未注册家族返回 0');
}

// ── ⑦ 源码绊线：放置朝向 / 家族判定 / 工具门控 / 熔炉点燃同步 ──
{
  const gm = srcOf('../src/player/Game.js');
  ok(gm.includes('blockDef.facingBase'), '放置：定向面方块按玩家方位换态');
  ok(gm.includes('this._facingTowardPlayer(placeX, placeZ)'), '放置：正面朝玩家');
  ok(gm.includes("if (def.baseBlock === 'chest') this._breakChest"), '破坏：箱子家族判定（四朝向）');
  ok(gm.includes("if (def.baseBlock === 'furnace') this._breakFurnace"), '破坏：熔炉家族判定');
  ok(!gm.includes("if (def.name === 'chest') this._breakChest"), '破坏：旧 name === chest 判定已废除');
  ok(gm.includes("furnaceDef.baseBlock === 'furnace'"), '右键：熔炉家族判定');
  ok(gm.includes("targetDef.baseBlock === 'chest'"), '右键：箱子家族判定');
  ok(gm.includes('const isSkull = (id) =>'), '凋灵召唤：头颅家族判定（四朝向可召唤）');
  ok(gm.includes('const hit = isSkull(placed)'), '凋灵召唤：判层也走家族判定（非基名 === SKULL）');
  ok(!gm.includes('const hit = placed === SKULL'), '凋灵召唤：旧 placed === SKULL 判层已废除');
  ok(gm.includes("d.baseBlock === 'wither_skeleton_skull'"), '凋灵召唤：按 baseBlock 认头颅');
  ok(gm.includes('this._syncFurnaceLit(key, st)'), '熔炉：燃烧边沿同步点燃态方块');
  ok(gm.includes('if (!isClient) this._syncFurnaceLit'), '熔炉：点燃态切换 host/单机权威');
  ok(gm.includes('furnaceLitId(def.facing'), '熔炉：点燃态 id 保留朝向');
  ok(gm.includes('(def && def.baseBlock) || BlockRegistry.getNameById'), '中键取物：家族态映射回基础物品');
  ok(/if \(def\.minTier > 0\) \{\s*\n\s*const held = this\._heldToolItem\(\);\s*\n\s*if \(!held \|\| held\.tool !== def\.tool \|\| \(held\.tier \|\| 0\) < def\.minTier\) return \[\];/.test(gm),
    '掉落：家族态方块同样受工具门控（熔炉需镐）');

  const rs = srcOf('../src/core/RedstoneSystem.js');
  ok(rs.includes('def.baseBlock === REDSTONE_LAMP'), '红石：红石灯按家族判定');
  ok(rs.includes('this.setLampLit(x, y, z, isPowered)'), '红石：充能边沿切换灯态');
  ok(rs.includes("BlockRegistry.getId(lit ? `${REDSTONE_LAMP}_lit` : REDSTONE_LAMP)"), '红石：灯态 id 双向');

  const nm = srcOf('../src/net/NetworkManager.js');
  ok(nm.includes("oldDef.baseBlock === 'chest'"), '联机：远端挖箱按家族清容器缓存');

  const reg = srcOf('../src/core/BlockRegistry.js');
  for (const field of ['front', 'icon', 'facingBase']) {
    ok(reg.includes(`${field}: def.${field}`) || reg.includes(`${field} = def.${field}`) || reg.includes(`${field} ||`),
      `BlockRegistry 白名单透传 ${field}`);
  }
  ok(reg.includes('lit: def.lit ?? false'), 'BlockRegistry 白名单透传 lit');

  const cm = srcOf('../src/render/ChunkMesh.js');
  ok(cm.includes("key: 'e'") && cm.includes("key: 'n'"), 'ChunkMesh：FACES 带方向键');
  ok(cm.includes('def.faceTex[face.key]'), 'ChunkMesh：逐面取 faceTex');

  // UI 图标链：B29 起收敛到 BlockIcon 统一入口——7 个渲染点必须委托 BlockIcon，
  // 且 BlockIcon 兜底链保留定向面优先（否则箱子图标变成没有锁扣的木板）
  const ICON_SITES = ['../src/ui/TradeScreen.js', '../src/ui/FurnaceScreen.js', '../src/ui/Hotbar.js',
    '../src/ui/ChestScreen.js', '../src/ui/InventoryScreen.js', '../src/ui/RecipeViewer.js',
    '../src/render/RemoteHotbarSprite.js'];
  for (const f of ICON_SITES) {
    const src = srcOf(f);
    ok(src.includes("from '../render/BlockIcon.js'") || src.includes("from './BlockIcon.js'"),
      `${f} 图标链已委托 BlockIcon`);
  }
  const bi = srcOf('../src/render/BlockIcon.js');
  ok(bi.includes('block.icon || block.side || block.top'), 'BlockIcon 兜底链仍优先定向面');
  ok(bi.includes('def.front || def.side'), 'BlockIcon 等轴取面走 front 优先');
  let legacySites = 0;
  for (const f of ICON_SITES) {
    if (srcOf(f).includes('block.icon || block.side || block.top')) legacySites++;
  }
  ok(legacySites === 0, `7 个渲染点均不再自带旧取纹链（残留 ${legacySites}）`);
  ok(!srcOf('../src/ui/Hotbar.js').includes('const texName = block.side || block.top'), 'Hotbar 旧图标链已废除');
}

console.log(`build28-block-textures: ${passed} assertions passed`);
