// build24-fixes.mjs -- Build 24（CW-1 区块边界伪影修复 + 全景重烘焙村庄机位/完整档）回归（node 直跑，无需服务器）
// 断言：
//   ① LAN 默认服务器设置：组件标题/设为默认按钮/编辑态探测（change 不落盘）/
//     LAN 页地址输入框移除且连接地址统一取自持久化默认值
//   ② 积雪针叶林树回归：行为级（同 seed 生成雪原区块，云杉必须在场——修复前为 0）
//     + surfaceY 扫描跳过 snow_layer 源码绊线
//   ③ i18n 新键 10 包在场 + BUILD = 24（CW-1 修复批次 bump）
import { readFileSync } from 'fs';
import { TerrainGenerator } from '../src/world/terrain.js';
import { Biomes } from '../src/world/biomes.js';
import { Chunk } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import '../src/blocks/BlockDefs.js';
import { BUILD } from '../src/version.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }

// ── ① LAN 默认服务器设置 ──
{
  const ms = srcOf('../src/ui/MenuScreen.js');
  ok(ms.includes("${t('LAN默认服务器设置')}"), '组件标题字样置于地址输入框左侧');
  ok(ms.includes('id="lan-default-btn"'), '「设置为默认」按钮存在（刷新按钮右侧）');
  ok(ms.includes("btn.id === 'lan-default-btn'"), '设为默认按钮走事件委托');
  ok(ms.includes("st.textContent = t('已设为默认')"), '保存成功反馈（后接探测刷新）');
  ok(ms.includes('setLanHost(input ? input.value : \'\')'), '保存入口唯一：设置为默认按钮');
  ok(ms.includes('setLanHost(e.target.value)') === false, 'IP 输入框 change 不落盘（只编辑+探测）');
  ok(ms.includes('normalizeLanHost(e.target.value)'), '编辑态经 normalizeLanHost 校验并回显清洗值');
  ok(ms.includes('_probeLan(host)'), '编辑态探测输入值（不动已保存默认值）');
  ok(ms.includes('id="mp-url"') === false, 'LAN 页地址输入框已移除');
  ok(ms.includes('const url = lanWsUrl(getLanHost())'), '创建/加入房间地址唯一来源 = 持久化默认值');
  ok(ms.includes("t('连接地址（主界面右下角可改）：')"), 'LAN 页只读地址提示（可用性补偿）');
  ok(ms.includes('stroke="#2e2a26"'), '刷新 SVG 深色描边（浅色石底对比可读）');
  ok(ms.includes('stroke="#e8e8e8"') === false, '旧浅色描边已清除');
  // 存储键不变：旧存档的默认 IP 沿用
  const ls = srcOf('../src/net/lanStatus.js');
  ok(ls.includes("'project-mc-lan-host'"), '默认服务器仍存 project-mc-lan-host（兼容 Build 23 已存值）');
}

// ── ② 积雪针叶林树回归（行为级） ──
{
  const spruce = BlockRegistry.getId('spruce_log');
  const snowLayerId = BlockRegistry.getId('snow_layer');
  const SEEDS = [42, 777]; // 修复前实测：两 seed 雪原区块 spruce_log = 0
  for (const seed of SEEDS) {
    const g = new TerrainGenerator(seed);
    let sampled = 0, chunksWithTrees = 0;
    for (let cx = 0; cx < 24 && sampled < 6; cx++) {
      for (let cz = 0; cz < 24 && sampled < 6; cz++) {
        let hit = false;
        for (let i = 0; i < 16 && !hit; i++) {
          if (g.getBiome(cx * 16 + (i * 3) % 16, cz * 16 + (i * 7) % 16) === Biomes.SNOWY_TAIGA) hit = true;
        }
        if (!hit) continue;
        const ch = new Chunk(cx, cz);
        g.generateChunk(ch);
        let logs = 0, snowLayers = 0;
        for (let k = 0; k < ch.blocks.length; k++) {
          if (ch.blocks[k] === spruce) logs++;
          if (ch.blocks[k] === snowLayerId) snowLayers++;
        }
        if (snowLayers > 50) { // 确认是真雪原区块（薄雪铺满）而非边缘误采样
          sampled++;
          if (logs > 0) chunksWithTrees++;
        }
      }
    }
    ok(sampled >= 4, `seed=${seed} 采样到足够雪原区块（${sampled} 个）`);
    ok(chunksWithTrees >= sampled - 1, `seed=${seed} 雪原区块出树（${chunksWithTrees}/${sampled}；修复前恒 0）`);
  }
  // 源码绊线：surfaceY 扫描必须跳过薄雪
  const tr = srcOf('../src/world/terrain.js');
  ok(tr.includes('b !== 0 && b !== WATER() && b !== SNOW_LAYER()'), 'surfaceY 扫描跳过 snow_layer');
  ok(tr.includes('surfaceName === cfg.surfaceBlock'), '树仍按 surfaceBlock 匹配（雪原=snow_block）');
}

// ── ③ i18n 新键 + BUILD 钉值 ──
{
  const langs = ['zh-TW', 'en', 'fr', 'de', 'ja', 'ko', 'ar', 'ru', 'es', 'pt'];
  for (const lang of langs) {
    const src = srcOf(`../src/i18n/locales/${lang}.js`);
    for (const key of ['LAN默认服务器设置', '设置为默认', '已设为默认', '连接地址（主界面右下角可改）：',
                       '设为默认服务器后加入']) {
      ok(src.includes(key), `语言包 ${lang} 缺键/未更新: ${key}`);
    }
  }
  ok(BUILD === 29, 'BUILD 24（CW-1 修复批次 bump 并 release）');
}

// ── ④ CW-1 区块边界伪影修复绊线（边缘缺失掩码 + 反向标脏 + 在途 dirty 语义）──
{
  const chunk = srcOf('../src/core/Chunk.js');
  ok(chunk.includes('this._meshEdgeMask = 0'), 'Chunk 持有 _meshEdgeMask（构建时缺失的边界邻居方向位）');

  const mesh = srcOf('../src/render/ChunkMesh.js');
  ok(mesh.includes('chunk._meshEdgeMask = edgeMask'), '_fillCache 记录缺失边界方向掩码');
  ok(mesh.includes('this.world.getChunk(chunk.cx - 1, chunk.cz)'), '掩码检查 4 邻居存在性');

  const world = srcOf('../src/core/World.js');
  ok(world.includes('const edgeFix'), '_finalizeChunk 反向标脏曾把本区块当空气的邻居');
  ok(world.includes('n._meshEdgeMask & bit'), '反向标脏按掩码命中位判断');

  const game = srcOf('../src/player/Game.js');
  const applyIdx = game.indexOf('_applyMeshOut(chunk, out) {');
  const applyBody = game.slice(applyIdx, game.indexOf('\n  }', applyIdx));
  ok(!applyBody.includes('chunk.dirty = false'), '_applyMeshOut 落地不再清 dirty（在途标脏被吞 = CW-1 第三层根因）');
  const dispIdx = game.indexOf('_dispatchMeshBuild(chunk) {');
  const dispBody = game.slice(dispIdx, dispIdx + 1500);
  ok(dispBody.includes('chunk.dirty = false'), '派发时清 dirty（快照吸收当前状态）');
}

console.log(`PASS build24-fixes: ${passed} 断言`);
