// build53-harvester.mjs -- Build 53 R2 收割机（只收成熟作物 / 产物进背面容器 / 安全停止）
// 纯 node，不依赖服务器。断言：
//   ① 注册：方块 ID 钉值（234~237）、朝向家族、归属、纹理键、十一语名字、功能分类、配方闸口
//   ② 几何：前方 = facing 方向、背面 = 反方向（四个朝向都验）
//   ③ 只收成熟作物：未熟作物/草丛/石头/水一律不动；产物与手割同表同值
//   ④ 安全停止：前方未加载 / 背面无容器 / 容器放不下（原子，不写半批）都不收割，作物留在田里
//   ⑤ 正常收割：作物被破坏、产物进容器、onDeposit 回调（联机上报）被触发
//   ⑥ 节拍与顺序：一拍一机收一格；多机同拍按坐标序确定；重复运行结果一致
//   ⑦ World 收割机索引：写入维护 + 读档派生 + 换成别的方块摘掉
//   ⑧ 源码绊线：主机权威门控 / Game 接线 / 服务器入箱校验 / 协议键与限速档
import { readFileSync } from 'fs';
import { tickHarvesters, harvesterTarget, harvesterOutput, insertAllIntoSlots, HARVEST_INTERVAL_MS } from '../src/core/Harvester.js';
import { cropHarvestDrops, isMatureCropId, CROP_MAX_STAGE } from '../src/core/crops.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { World } from '../src/core/World.js';
import { getAllRecipes, recipeEnabled } from '../src/core/Crafting.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { normalizeExtraContent } from '../src/content/ExtraContent.js';
import { en } from '../src/i18n/locales/en.js';
import { HARVESTER_FACING_BY_ID, harvesterFacingOf, isHarvesterId } from '../server/flow.js';
import { MSG } from '../server/protocol.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const INDUSTRY = normalizeExtraContent({ schema: 1, industry: true });
const NONE = normalizeExtraContent(null);

const key = (x, y, z) => `${x},${y},${z}`;
const stack = (name, count) => ({ name, count, data: null });
const emptySlots = () => new Array(27).fill(null);
const contentsOf = (items) => (items || []).filter(Boolean).map((s) => `${s.name}x${s.count}`).join(',');
const MATURE = `wheat_crop_${CROP_MAX_STAGE}`;
const MATURE_ID = BlockRegistry.getId(MATURE);
const IMMATURE_ID = BlockRegistry.getId(`wheat_crop_${CROP_MAX_STAGE - 1}`);

// 世界账本（Map key -> blockId）与容器账本（Map key -> 27 槽）
function makeIo(blocks, containers, opts = {}) {
  return {
    getBlock: (x, y, z) => blocks.get(key(x, y, z)) || 0,
    isLoaded: opts.isLoaded || (() => true),
    ensureContainer: (x, y, z) => containers.get(key(x, y, z)) || null,
    harvest: (x, y, z) => { blocks.delete(key(x, y, z)); if (opts.onHarvest) opts.onHarvest(x, y, z); },
    onDeposit: opts.onDeposit,
    rng: opts.rng || (() => 0),
  };
}
// 摆一台朝 s（前方 z+1）的收割机于 (0,0,0)，背面 (0,0,-1)
const rig = (extra = {}) => {
  const blocks = new Map([[key(0, 0, 0), BlockRegistry.getId('harvester_s')]]);
  const containers = new Map();
  for (const [k, v] of Object.entries(extra.blocks || {})) blocks.set(k, v);
  for (const [k, v] of Object.entries(extra.containers || {})) containers.set(k, v);
  return { blocks, containers };
};

// ── ① 注册与 id 钉值 ──────────────────────────────────────────────────
{
  const expected = { n: 'harvester', s: 'harvester_s', e: 'harvester_e', w: 'harvester_w' };
  ok(HARVESTER_FACING_BY_ID.size === 4, '收割机朝向表恰好四档');
  for (const [id, facing] of HARVESTER_FACING_BY_ID) {
    const def = BlockRegistry.getById(id);
    ok(!!def && def.name === expected[facing], `收割机 id ${id} = ${expected[facing]}（实际 ${def ? def.name : 'MISSING'}）`);
    ok(!!def && def.baseBlock === 'harvester' && def.facing === facing, `id ${id} 的 baseBlock/facing 一致`);
    ok(!!def && def.harvester === true, `id ${id} 带 harvester 标记`);
    ok(!!def && def.facingAway === true, `id ${id} 是 facingAway 家族（刀口朝玩家看的方向）`);
    ok(isHarvesterId(id) && harvesterFacingOf(id) === facing, `id ${id} 服务器朝向表一致`);
  }
  ok(BlockRegistry.getId('harvester') === 234 && BlockRegistry.getId('harvester_w') === 237, '收割机家族 ID 钉值 234~237');
  ok(BlockRegistry.getId('filter_hopper_w') === 233, 'B53 R1 家族 ID 未被插队');
  for (const facing of ['n', 's', 'e', 'w']) {
    const def = BlockRegistry.getByName(expected[facing]);
    const keys = new Set([def.top, def.side, def.bottom, def.front, def.icon].filter(Boolean));
    for (const k of keys) ok(!!BlockSVGDefinitions[k], `${def.name} 纹理 ${k} 已在 SVG 表`);
    ok(!!def.faceTex && def.faceTex[def.facing] === def.front, `${def.name} 定向面已派生 faceTex`);
    ok(def.icon === def.front, `${def.name} 图标取刀口面`);
  }
  ok(BlockRegistry.getByName('harvester').requiresExtras.join() === 'industry', '方块归属工业内容');
  const row = NAME_I18N.harvester;
  ok(Array.isArray(row) && row.length === 11 && row[0] === '收割机', '收割机名字表 11 语且首列对齐');
  ok(getItemCategory('harvester') === 'functional', '收割机创造分类 = 功能方块');
  const recipe = getAllRecipes().find((r) => r.output === 'harvester');
  ok(!!recipe && recipe.count === 1, '收割机有 1 出 1 的配方');
  ok(!!recipe && recipeEnabled(recipe, INDUSTRY) && !recipeEnabled(recipe, NONE), '配方只在启用工业的世界可用');
  const lore = (BlockRegistry.getByName('harvester').lore || []).join('');
  ok(lore.includes('收'), '方块 lore 落库');
  ok(!!en[lore], '方块 lore 有英文译文（i18n 动态键审计口径）');
}

// ── ② 几何：前方向 facing、背面反向 ────────────────────────────────────
{
  ok(JSON.stringify(harvesterTarget(5, 70, 5, 'n')) === JSON.stringify({ x: 5, y: 70, z: 4 }), '朝 n：前方 z-1');
  ok(JSON.stringify(harvesterOutput(5, 70, 5, 'n')) === JSON.stringify({ x: 5, y: 70, z: 6 }), '朝 n：背面 z+1');
  ok(JSON.stringify(harvesterTarget(5, 70, 5, 's')) === JSON.stringify({ x: 5, y: 70, z: 6 }), '朝 s：前方 z+1');
  ok(JSON.stringify(harvesterOutput(5, 70, 5, 's')) === JSON.stringify({ x: 5, y: 70, z: 4 }), '朝 s：背面 z-1');
  ok(JSON.stringify(harvesterTarget(5, 70, 5, 'e')) === JSON.stringify({ x: 6, y: 70, z: 5 }), '朝 e：前方 x+1');
  ok(JSON.stringify(harvesterOutput(5, 70, 5, 'e')) === JSON.stringify({ x: 4, y: 70, z: 5 }), '朝 e：背面 x-1');
  ok(JSON.stringify(harvesterTarget(5, 70, 5, 'w')) === JSON.stringify({ x: 4, y: 70, z: 5 }), '朝 w：前方 x-1');
  ok(JSON.stringify(harvesterOutput(5, 70, 5, 'w')) === JSON.stringify({ x: 6, y: 70, z: 5 }), '朝 w：背面 x+1');
  ok(HARVEST_INTERVAL_MS === 800, '收割节拍 800ms（作物长得比这慢得多）');
}

// ── ③ 只收成熟作物 + 产物与手割同源 ────────────────────────────────────
{
  ok(isMatureCropId(MATURE_ID), '成熟小麦判定为成熟');
  ok(!isMatureCropId(IMMATURE_ID), '差一阶段不算成熟');
  ok(!isMatureCropId(BlockRegistry.getId('tall_grass')), '草丛不算作物');
  const d0 = cropHarvestDrops(MATURE, () => 0);
  ok(d0.length === 2 && d0[0].name === 'wheat' && d0[0].count === 1, '成熟产物：小麦×1');
  ok(d0[1].name === 'wheat_seeds' && d0[1].count === 1, '种子 1-3（rng=0 → 1）');
  ok(cropHarvestDrops(MATURE, () => 0.99)[1].count === 3, '种子 1-3（rng=0.99 → 3）');
  ok(cropHarvestDrops(`wheat_crop_${CROP_MAX_STAGE - 1}`, () => 0).length === 0, '未熟作物没有收割产物');
  // 手割与机器同源：Game 的掉落表不再自带一份数字
  const gameSrc = src('../src/player/Game.js');
  ok(gameSrc.includes('cropHarvestDrops(def.name)'), 'Game 手割走同一张产物表');
  ok(!/wheat_seeds', count: 1 \+ Math\.floor/.test(gameSrc), 'Game 里没有第二份种子数量公式');
  // 未熟作物：什么都不做
  {
    const { blocks, containers } = rig({ blocks: { [key(0, 0, 1)]: IMMATURE_ID }, containers: { [key(0, 0, -1)]: emptySlots() } });
    ok(tickHarvesters([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(blocks, containers)).length === 0, '未熟作物不收割');
    ok(blocks.has(key(0, 0, 1)), '未熟作物仍在田里');
  }
  // 非作物方块：什么都不做
  {
    const { blocks, containers } = rig({ blocks: { [key(0, 0, 1)]: BlockRegistry.getId('tall_grass') }, containers: { [key(0, 0, -1)]: emptySlots() } });
    ok(tickHarvesters([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(blocks, containers)).length === 0, '草丛不收割');
    ok(blocks.has(key(0, 0, 1)), '草丛仍在');
  }
}

// ── ④ 安全停止：未加载 / 无容器 / 放不下 ───────────────────────────────
{
  // 前方区块未加载
  const { blocks, containers } = rig({ blocks: { [key(0, 0, 1)]: MATURE_ID }, containers: { [key(0, 0, -1)]: emptySlots() } });
  ok(tickHarvesters([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(blocks, containers, { isLoaded: () => false })).length === 0,
    '前方区块没加载 → 不收割');
  ok(blocks.has(key(0, 0, 1)), '作物原样留在田里');

  // 背面没有容器
  const r2 = rig({ blocks: { [key(0, 0, 1)]: MATURE_ID } });
  ok(tickHarvesters([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(r2.blocks, r2.containers)).length === 0, '背面没容器 → 不收割');
  ok(r2.blocks.has(key(0, 0, 1)), '没容器时作物不消失（不丢产物）');

  // 容器放不下（27 格全石头）：原子拒绝
  const full = emptySlots().map(() => stack('stone', 64));
  const r3 = rig({ blocks: { [key(0, 0, 1)]: MATURE_ID }, containers: { [key(0, 0, -1)]: full } });
  ok(tickHarvesters([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(r3.blocks, r3.containers)).length === 0, '容器满 → 不收割');
  ok(r3.blocks.has(key(0, 0, 1)), '容器满时作物留在田里');
  ok(contentsOf(full) === new Array(27).fill('stonex64').join(','), '满箱一个字节没动');

  // 只剩 1 个空槽：小麦 + 种子要 2 格 → 整批不写（不许只塞一半）
  const oneSlot = emptySlots();
  for (let i = 0; i < 26; i++) oneSlot[i] = stack('stone', 64);
  const r4 = rig({ blocks: { [key(0, 0, 1)]: MATURE_ID }, containers: { [key(0, 0, -1)]: oneSlot } });
  ok(tickHarvesters([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(r4.blocks, r4.containers)).length === 0, '只够放一半 → 整批拒绝');
  ok(r4.blocks.has(key(0, 0, 1)), '原子拒绝后作物仍在');
  ok(!oneSlot[26], '拒绝时连空槽都没被占');

  // 同类堆还有空间 → 能合并就放得下
  const merge = emptySlots();
  merge[0] = stack('wheat', 63);
  merge[1] = stack('wheat_seeds', 63);
  const r5 = rig({ blocks: { [key(0, 0, 1)]: MATURE_ID }, containers: { [key(0, 0, -1)]: merge } });
  ok(tickHarvesters([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(r5.blocks, r5.containers)).length === 1, '同类未满 → 合并收下');
  ok(merge[0].count === 64 && merge[1].count === 64, '两堆各补到 64');
}

// ── ⑤ 正常收割 + onDeposit ────────────────────────────────────────────
{
  const bags = emptySlots();
  const { blocks, containers } = rig({
    blocks: { [key(0, 0, 1)]: MATURE_ID },
    containers: { [key(0, 0, -1)]: bags },
  });
  let deposited = null;
  const harvested = tickHarvesters([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(blocks, containers, {
    onDeposit: (x, y, z, drops) => { deposited = { x, y, z, drops }; },
  }));
  ok(harvested.length === 1 && harvested[0].x === 0 && harvested[0].z === 1, '收割位置 = 正前方一格');
  ok(!blocks.has(key(0, 0, 1)), '作物已被破坏');
  ok(contentsOf(bags) === 'wheatx1,wheat_seedsx1', '产物进了背面容器（小麦×1 + 种子×1）');
  ok(!!deposited && deposited.x === 0 && deposited.z === -1, 'onDeposit 指向背面容器（联机上报用）');
  ok(!!deposited && deposited.drops.length === 2, 'onDeposit 带完整掉落列表');
  // 第二拍：田里没作物了，什么都不做
  ok(tickHarvesters([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(blocks, containers)).length === 0, '收完就停（不空转）');
}

// ── ⑥ 一拍一机一格 / 多机顺序 / 确定性 ─────────────────────────────────
{
  const build = () => {
    const blocks = new Map();
    const containers = new Map();
    // 两台机器：A(0,0,0) 朝 s，B(3,0,0) 朝 s
    blocks.set(key(0, 0, 0), BlockRegistry.getId('harvester_s'));
    blocks.set(key(3, 0, 0), BlockRegistry.getId('harvester_s'));
    blocks.set(key(0, 0, 1), MATURE_ID);
    blocks.set(key(3, 0, 1), MATURE_ID);
    containers.set(key(0, 0, -1), emptySlots());
    containers.set(key(3, 0, -1), emptySlots());
    return { blocks, containers };
  };
  const a = build();
  const list = [{ x: 0, y: 0, z: 0, facing: 's' }, { x: 3, y: 0, z: 0, facing: 's' }];
  const outA = tickHarvesters(list, makeIo(a.blocks, a.containers));
  ok(outA.length === 2, '同拍两台机器各收一格');
  ok(contentsOf(a.containers.get(key(0, 0, -1))) === 'wheatx1,wheat_seedsx1', '机器 A 的箱子收到产物');
  ok(contentsOf(a.containers.get(key(3, 0, -1))) === 'wheatx1,wheat_seedsx1', '机器 B 的箱子收到产物');
  const b = build();
  const outB = tickHarvesters(list, makeIo(b.blocks, b.containers));
  ok(JSON.stringify(outA) === JSON.stringify(outB), '两次运行位置结果一致（确定性）');
  // 同一台机器前后两格作物：只收正前方那格
  const c = build();
  c.blocks.set(key(0, 0, 2), MATURE_ID);
  tickHarvesters([{ x: 0, y: 0, z: 0, facing: 's' }], makeIo(c.blocks, c.containers));
  ok(c.blocks.has(key(0, 0, 2)), '一格之外的作物不碰（不破坏任意方块）');
}

// ── ⑦ insertAllIntoSlots 契约（服务器溢出路径复用）─────────────────────
{
  const items = emptySlots();
  ok(insertAllIntoSlots(items, [stack('wheat', 3)]).length === 0, '放得下 → 无残余');
  ok(items[0].name === 'wheat' && items[0].count === 3, '写入第一格');
  const full = emptySlots().map(() => stack('stone', 64));
  const left = insertAllIntoSlots(full, [stack('wheat', 2), stack('wheat_seeds', 1)]);
  ok(left.length === 2 && left[0].count === 2, '放不下 → 全部计入残余（服务器据此掉在地上）');
  ok(!full.some((s) => s && s.name === 'wheat'), '满了就一格也不塞');
}

// ── ⑧ World 收割机索引 ────────────────────────────────────────────────
{
  const w = new World(20261124);
  const hid = BlockRegistry.getId('harvester_e');
  const stone = BlockRegistry.getId('stone');
  w.trackHarvester(2, 70, 6, hid);
  ok(w.harvesters.get(key(2, 70, 6)) === 'e', 'trackHarvester 收录收割机（朝向 e）');
  w.trackHarvester(2, 70, 6, stone);
  ok(!w.harvesters.has(key(2, 70, 6)), '换成石头后从索引里摘掉');
  const w2 = new World(20261124);
  w2.loadDimensionBuckets({ overworld: { '7,64,-3': BlockRegistry.getId('harvester_w') } }, {}, null, null);
  ok(w2.harvesters.get('7,64,-3') === 'w', '读档派生索引收录收割机并带出朝向');
}

// ── ⑨ 源码绊线 ────────────────────────────────────────────────────────
{
  const placement = src('../src/player/Placement.js');
  ok(placement.includes('updateHarvesters(dt)'), '单机/主机本地收割 tick 在 Placement');
  ok(placement.includes("g.net.isHost") && placement.includes('updateHarvesters'), '收割与作物生长同一条主机门控');
  ok(placement.includes('sendHarvestOutput'), '联机入库上报接线');
  ok(placement.includes("world.getChunk(x >> 4, z >> 4)"), '前方加载判定用真实区块表（不靠 getBlock=0 猜）');
  const game = src('../src/player/Game.js');
  ok(game.includes('this.updateHarvesters(dt)'), 'Game 帧循环调用收割 tick');
  ok(game.includes('updateHarvesters(dt) { return this.placement.updateHarvesters(dt); }'), 'Game 门面委托');
  const room = src('../server/room.js');
  ok(room.includes('onHarvestOutput'), '服务器有产物入箱处理');
  ok(room.includes('harvesterFacingOf(mid) === facing'), '服务器核对"旁边那台朝外开刀的收割机"');
  ok(room.includes('insertAllIntoSlots(items, drops)'), '服务器与纯算法共用同一份塞箱实现');
  ok(room.includes('leftover'), '溢出转掉落（不吞玩家收成）');
  const net = src('../src/net/NetworkManager.js');
  ok(net.includes('sendHarvestOutput'), '客户端有上报口');
  ok(MSG.HARVEST_OUTPUT === 'harvest_output', '协议键 harvest_output');
  const rl = src('../server/ratelimit.js');
  ok(rl.includes('MSG.HARVEST_OUTPUT'), '入箱走限速档（state）');
}

finish('build53-harvester');
