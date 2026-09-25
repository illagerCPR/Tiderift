// build20-fixes.mjs -- Build 20 修复与改进批次回归（node 直跑，无需服务器）
// 断言：
//   ① 石碑四格形制：steleStack 纯函数（四维度映射/坐标序列/回落）+ 全部 14 处碑位
//      （9 个结构 solve 行为级 + aether/end 维度生成器源码绊线）
//   ② 末地折跃门末地传送门式效果：去 cross、非固体发光、SVG 纹理键、粒子绿色星尘
//   ③ 创造中键取物：Controls 中键回调 / BlockRegistry.getNameById / Game 接线绊线
//   ④ 创造不激怒生物：Mob 索敌排除绊线 + MobManager.attackMob provoke 行为级
//   ⑤ F5 视角循环 + F6 保存：Player.updateCamera 三态行为级 + Raycast t 字段 +
//      Game/MenuScreen/语言包接线绊线 + LocalPlayerModel/RemotePlayer PARTS 共源
//   ⑥ 命令面板终局演出全维度可用：finaleWrap 独立行绊线
//   ⑦ 天域永昼解除仅本存档生效：单机存档严格恢复/联机保留/returnToMenu 复位绊线
import { readFileSync } from 'fs';
import * as THREE from 'three';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { steleStack, STELE_BASE_BY_DIM, STELE_STELE_BY_DIM } from '../src/world/steles.js';
import { solveTemple, solveSeaGate } from '../src/world/structures/aetherStructures.js';
import { solveWhale } from '../src/world/structures/whale_barrow.js';
import { solveFortress } from '../src/world/structures/fortress.js';
import { solveHearth } from '../src/world/structures/tidefire_hearth.js';
import { solveBarrow } from '../src/world/structures/tide_barrow.js';
import { solveRing } from '../src/world/structures/gleaner_ring.js';
import { solveVillage } from '../src/world/structures/village.js';
import { solveStronghold } from '../src/world/structures/stronghold.js';
import { MobManager } from '../src/entity/MobManager.js';
import { Player } from '../src/player/Player.js';
import { Raycast } from '../src/player/Raycast.js';
import { PARTS } from '../src/entity/RemotePlayer.js';
import { BUILD } from '../src/version.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }

// blocks 追加列表取格：后写覆盖先写（与 applyBlocks 语义一致），返回最终方块 id
function blockAt(blocks, x, y, z) {
  let id = 0;
  for (const b of blocks) {
    if (b[0] === x && b[1] === y && b[2] === z) id = b[3];
  }
  return id;
}
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}
const mockGen = { getBaseHeight: () => 64, getBiome: () => 0 };

// ── ① steleStack 纯函数 ──
{
  for (const dim of ['overworld', 'nether', 'end', 'aether']) {
    const st = steleStack(10, 40, 20, dim);
    ok(st.length === 4, `${dim} 石碑应为 4 格`);
    ok(st[0][1] === 39 && st[1][1] === 40 && st[2][1] === 41 && st[3][1] === 42,
      `${dim} 坐标序列应为 y0-1/y0/y0+1/y0+2`);
    ok(st[1][3] === BlockRegistry.getId(STELE_STELE_BY_DIM[dim]), `${dim} 第 2 格=该维度石碑`);
    ok(st[2][3] === BlockRegistry.getId('glowstone'), `${dim} 第 3 格=荧石`);
    ok(st[0][3] === st[3][3] && st[0][3] === BlockRegistry.getId(STELE_BASE_BY_DIM[dim]),
      `${dim} 第 1/4 格=维度特色方块（同块）`);
    for (const b of st) ok(b[0] === 10 && b[2] === 20, `${dim} 四格同列`);
  }
  const fb = steleStack(0, 0, 0, 'unknown_dim');
  ok(fb[1][3] === BlockRegistry.getId('moss_stele') && fb[0][3] === BlockRegistry.getId('mossy_cobblestone'),
    '未知维度回落主世界形制');
}

// 通用：按 meta.steles 验证四格（底座=维度特色块/碑/荧石/顶帽=维度特色块）
function verifyStacks(blocks, meta, dim, label) {
  const baseId = BlockRegistry.getId(STELE_BASE_BY_DIM[dim]);
  const steleId = BlockRegistry.getId(STELE_STELE_BY_DIM[dim]);
  const glowId = BlockRegistry.getId('glowstone');
  ok(meta.steles.length >= 1, `${label} 至少 1 处碑位`);
  for (const [x, y, z] of meta.steles) {
    ok(blockAt(blocks, x, y - 1, z) === baseId, `${label} 碑(${x},${y},${z}) 底座=维度特色块`);
    ok(blockAt(blocks, x, y, z) === steleId, `${label} 碑(${x},${y},${z}) 碑体=该维度石碑`);
    ok(blockAt(blocks, x, y + 1, z) === glowId, `${label} 碑(${x},${y},${z}) 荧石`);
    ok(blockAt(blocks, x, y + 2, z) === baseId, `${label} 碑(${x},${y},${z}) 顶帽=维度特色块`);
  }
}

// 天域三结构
{
  const rng = makeRng(20200101);
  const t = solveTemple(rng, 100, 70, 100);
  verifyStacks(t.blocks, t.meta, 'aether', '天空神殿');
  const g = solveSeaGate(rng, 200, 70, 200);
  verifyStacks(g.blocks, g.meta, 'aether', '天海之门');
  const w = solveWhale(rng, 300, 70, 300);
  verifyStacks(w.blocks, w.meta, 'aether', '鲸骨冢');
}
// 下界两结构（hearth 3 碑）
{
  const rng = makeRng(20200202);
  const f = solveFortress(rng, 0, 64, 0);
  verifyStacks(f.blocks, f.meta, 'nether', '下界要塞');
  const h = solveHearth(rng, 400, 64, 400);
  ok(h.meta.steles.length === 3, '潮火之炉应有 3 处碑位');
  verifyStacks(h.blocks, h.meta, 'nether', '潮火之炉');
}
// 主世界三结构 + 末地两结构
{
  const rng = makeRng(20200303);
  const b = solveBarrow(rng, 0, 64, 0, null);
  verifyStacks(b.blocks, b.meta, 'overworld', '潮冢');
  const v = solveVillage(rng, 0, 64, 0, mockGen);
  verifyStacks(v.blocks, v.meta, 'overworld', '村庄');
  const s = solveStronghold(rng, 0, 64, 0, mockGen);
  verifyStacks(s.blocks, s.meta, 'overworld', '要塞门厅');
  const r = solveRing(rng, 500, 64, 500);
  verifyStacks(r.blocks, r.meta, 'end', '拾遗者石环');
}
// 维度生成器（出生岛引路碑/主岛守望界碑）接线绊线
ok(srcOf('../src/world/dimensions/aether.js').includes("steleStack(sx, top + 1, sz, 'aether')"),
  'aether.js 出生岛引路碑走 steleStack 四格');
ok(srcOf('../src/world/dimensions/end.js').includes("steleStack(26, wSpan.top + 1, 26, 'end')"),
  'end.js 主岛守望界碑走 steleStack 四格');
// 碑格注册键不变（steleChapterAt 兼容）：meta.steles 坐标即碑体所在格
{
  const w = solveWhale(makeRng(7), 300, 70, 300);
  const [sx, sy, sz] = w.meta.steles[0];
  ok(blockAt(w.blocks, sx, sy, sz) === BlockRegistry.getId('wind_stele'),
    'meta.steles 注册坐标=碑体格（章节解析兼容）');
}

// ── ② 末地折跃门：末地传送门式效果 ──
{
  const def = BlockRegistry.getById(BlockRegistry.getId('end_gateway'));
  ok(def.renderType !== 'cross', 'end_gateway 已去 cross（正常立方面渲染）');
  ok(def.solid === false && def.transparent === true, 'end_gateway 保持非固体透明（陷入触发语义不变）');
  ok(def.light === 15, 'end_gateway 保持 light 15（进 light mesh 全亮）');
  ok(BlockSVGDefinitions.end_gateway !== undefined, 'end_gateway SVG 纹理键在场');
  ok(srcOf('../src/render/ParticleSystem.js').includes("end_gateway: [[0.55, 0.95, 0.65]"),
    '折跃门粒子已改绿色星尘（与星空纹理同调）');
}

// ── ③ 创造中键取物 ──
ok(BlockRegistry.getNameById(BlockRegistry.getId('stone')) === 'stone', 'BlockRegistry.getNameById id 反查');
ok(BlockRegistry.getNameById(99999) === null, 'getNameById 未注册 id 返回 null');
{
  const ctrl = srcOf('../src/player/Controls.js');
  ok(ctrl.includes('e.button === 1'), 'Controls 监听中键');
  ok(ctrl.includes('onPickBlock'), 'Controls 暴露 onPickBlock 回调');
  ok(ctrl.includes('e.preventDefault()'), '中键 preventDefault（防浏览器自动滚动）');
  const game = srcOf('../src/player/Game.js');
  ok(game.includes('_pickBlock'), 'Game 定义 _pickBlock');
  ok(game.includes('this.controls.onPickBlock = () => this._pickBlock();'), 'Game 构造注入中键回调');
  ok(game.includes('if (!this.player.creative || !this.selectedBlock || !this.world) return;'),
    '_pickBlock 仅创造模式响应');
  ok(game.includes('for (let i = 0; i < 9; i++)'), '_pickBlock 热栏已有则选中');
  ok(game.includes('slots[sel] = { name, count: 1 };'), '_pickBlock 无则替换当前选中格');
}

// ── ④ 创造不激怒生物 ──
{
  const mob = srcOf('../src/entity/Mob.js');
  ok((mob.match(/playerTargetable/g) || []).length >= 3, 'Mob 索敌链 playerTargetable 排除（普通目标/激怒追击等）');
  ok(mob.includes('player.creative || player.spectator'), 'Mob 创造/旁观玩家排除');
  ok(mob.includes('player.dead || player.creative || player.spectator'), '潜影贝 AI 排除创造玩家');
  const mm = srcOf('../src/entity/MobManager.js');
  ok(mm.includes('opts.provoke !== false'), 'attackMob provoke 开关');
  ok(srcOf('../src/player/Game.js').includes("{ provoke: !this.player.creative }"),
    'Game 攻击调用按模式传 provoke');
}
// 行为级：provoke=false 不设置激怒，默认（生存）仍激怒
{
  const mkMob = () => ({
    position: new THREE.Vector3(5, 64, 0), width: 0.6, height: 1.8,
    health: 20, dead: false, dyingAnim: false, typeName: 'zombie_piglin',
    type: { neutral: true }, netId: null, hitFlash: 0,
    knockback: new THREE.Vector3(),
  });
  const attack = (provoke) => {
    const m = mkMob();
    const manager = Object.create(MobManager.prototype);
    manager.mobs = [m];
    const origin = new THREE.Vector3(0, 65, 0);
    const dir = new THREE.Vector3(1, 0, 0);
    const hit = provoke === undefined
      ? manager.attackMob(origin, dir, 6, 5)
      : manager.attackMob(origin, dir, 6, 5, { provoke });
    return { hit, m };
  };
  const a = attack(false);
  ok(a.hit === true && !a.m.aggro && a.m.health === 15, 'provoke=false：命中生效但不激怒');
  const b = attack(true);
  ok(b.hit === true && b.m.aggro === true && b.m.aggroTimer === 25, 'provoke=true：命中并激怒 25s');
  const c = attack(undefined);
  ok(c.m.aggro === true, '缺省 opts：保持既有激怒行为（生存路径）');
}

// ── ⑤ F5 视角 + F6 保存 ──
{
  const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
  const p = new Player(cam);
  p.position.set(10, 64, 10);
  p.yaw = 0; p.pitch = 0; // 面朝 -Z
  p.updateCamera(null);
  ok(Math.abs(cam.position.x - 10) < 1e-6 && Math.abs(cam.position.y - 65.62) < 1e-6 &&
     Math.abs(cam.position.z - 10) < 1e-6, '第一人称：眼点=脚位+1.62');
  p.viewMode = 1;
  p.updateCamera(null);
  ok(Math.abs(cam.position.z - 14) < 1e-6 && cam.position.x === 10,
    '第三人称背后：视线反方向退 4 格（yaw=0 → +Z）');
  ok(cam.rotation.y === 0 && cam.rotation.x === 0, '第三人称背后：朝向不变');
  p.viewMode = 2;
  p.updateCamera(null);
  ok(Math.abs(cam.position.z - 6) < 1e-6, '第三人称正面：视线正方向退 4 格（-Z）');
  ok(Math.abs(cam.rotation.y - Math.PI) < 1e-6, '第三人称正面：回望玩家');
  p.viewMode = 0; p.pitch = 0.4;
  p.updateCamera(null);
  ok(cam.rotation.x === 0.4, '第一人称：俯仰直通');
}
// Raycast 命中带 t（第三人称遮挡裁剪依赖）
{
  const world = {
    getBlock(x, y, z) {
      return (y === 60 && x === 10 && z === 4) ? BlockRegistry.getId('stone') : 0;
    },
  };
  const rc = new Raycast(world);
  const hit = rc.cast(new THREE.Vector3(10, 60.5, 8), new THREE.Vector3(0, 0, -1), 8);
  ok(!!hit && hit.t != null && Math.abs(hit.t - 3) < 1e-6, 'Raycast 返回命中距离 t（遮挡裁剪用）');
}
{
  const game = srcOf('../src/player/Game.js');
  ok(game.includes("if (e.code === 'F5')") && game.includes("(this.player.viewMode + 1) % 3"),
    'F5 视角三态循环');
  ok(game.includes("if (this.spectating) {\n          this.cycleSpectateTarget();"),
    '观战模式 F5 仍为切换目标（键位不冲突）');
  ok(game.includes("if (e.code === 'F6')") && game.includes('!this.networkMode) SaveSystem.save(this)'),
    'F6 手动保存（原 F5 功能挪位）');
  ok((game.match(/e\.code === 'F6'/g) || []).length >= 2, 'F6 保存分支 + editable 放行 F6');
  ok(game.includes('this.player.viewMode = 0; // Build 20 ⑤'), 'start 复位视角（跨存档共享 Player）');
  ok(game.includes('this.playerModel.update(0, this.player, false, false)'), 'start/回菜单隐藏第三人称模型');
  ok(game.includes('new LocalPlayerModel(this.renderer.scene, this)'), '本地玩家模型挂场景');
  ok(game.includes('this.player.updateCamera(this.world)'), 'updateCamera 传入 world（遮挡裁剪）');
  ok(game.includes('this.player.viewMode === 0'), '第三人称隐藏第一人称手');
  ok(srcOf('../src/entity/LocalPlayerModel.js').includes("import { buildParts } from './RemotePlayer.js'"),
    'LocalPlayerModel 与 RemotePlayer 共用部件布局（单一来源）');
  ok(srcOf('../src/ui/MenuScreen.js').includes('F5 切换视角 / F6 手动保存'), '主菜单键位提示更新');
  for (const lang of ['en', 'ja', 'ar', 'ru', 'pt']) {
    ok(srcOf(`../src/i18n/locales/${lang}.js`).includes('F5 切换视角 / F6 手动保存'),
      `语言包 ${lang} 键位提示键已换新`);
  }
}

// ── ⑥ 终局演出全维度可用 ──
{
  const cp = srcOf('../src/ui/CommandPanel.js');
  ok(cp.includes('this.finaleWrap') && cp.includes('aetherCard.appendChild(finaleWrap)'),
    '终局演出独立行（duskWrap 之外）');
  ok(/_refreshDimTools\(\) \{[\s\S]*?this\.aetherCard\.style\.display = 'flex';/.test(cp),
    '维度检查卡恒显示（终局演出不再随天域隐藏）');
  ok(cp.includes("this.duskWrap.style.display = isAether ? 'flex' : 'none'"),
    '复潮控件仍仅天域显示');
}

// ── ⑦ 天域永昼仅本存档生效 ──
{
  const game = srcOf('../src/player/Game.js');
  ok(game.includes('this.aetherDusk = !!(loadData && loadData.aetherDusk);'),
    '单机：复潮状态只信存档字段（无字段=未复潮，杜绝跨存档泄漏）');
  ok(game.includes('if (this.networkMode) {\n      // 联机：保留现值'), '联机保留现值（房间权威）');
  ok(game.includes('this.aetherDusk = false; // Build 20 ⑦'), 'returnToMenu 复位复潮状态');
  ok(game.includes('aetherDusk: !!this.aetherDusk, // 天域复潮状态跨维透传（批次 D：换维重建不丢）'),
    '换维透传字段保留（单机换维 loadData 合成携带该字段）');
  ok(srcOf('../src/core/SaveSystem.js').includes('aetherDusk: !!game.aetherDusk'), '存档仍持久化复潮状态');
}

ok(BUILD === 28, `BUILD 24（Build 23 主菜单与皮肤面板批次统一 bump，当前 ${BUILD}）`);

console.log(`build20-fixes: ${passed} passed`);
