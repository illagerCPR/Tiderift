// MeshWorker.js -- 区块网格构建 Worker（Idea-3B-②）
// 主线程填好 blocks/sky/blockL 三份缓存（含边界 world 回退值）后传入，
// worker 只跑纯数据收集（_collectData 与主线程同步路径共用同一实现），typed arrays 回传。
// 关键：必须导入 BlockDefs 完成方块 id 注册（同 TerrainWorker 的坑——缺它 Registry 全空）。
import '../blocks/BlockDefs.js';
import { ChunkMeshBuilder, RenderQuality } from '../render/ChunkMesh.js';

let builder = null;

self.onmessage = (e) => {
  const d = e.data || {};
  if (d.t === 'init') {
    try {
      builder = new ChunkMeshBuilder(null, null, new Map(d.atlasUV), null);
      self.postMessage({ t: 'init-ok' });
    } catch (err) {
      self.postMessage({ t: 'init-error', error: String((err && err.message) || err) });
    }
    return;
  }
  if (d.t === 'build') {
    if (!builder) {
      self.postMessage({ t: 'error', id: d.id, error: 'worker 未初始化' });
      return;
    }
    try {
      builder._cache = new Uint8Array(d.cache);
      builder._skyCache = new Uint8Array(d.skyCache);
      builder._blockLCache = new Uint8Array(d.blockLCache);
      builder._refreshOpaqueLUT();
      RenderQuality.smoothLighting = d.quality.smoothLighting;
      RenderQuality.aoEnabled = d.quality.aoEnabled;
      // B40：贪心合并开关随派发下发（worker 是独立模块实例，缺此项则恒为默认 true）
      RenderQuality.greedyMesh = d.quality.greedyMesh !== false;
      const out = builder._collectData({ cx: d.cx, cz: d.cz });
      const transfer = [];
      for (const key of ['solid', 'water', 'light']) {
        const g = out[key];
        if (g) for (const arr of Object.values(g)) transfer.push(arr.buffer);
      }
      self.postMessage({ t: 'built', id: d.id, cx: d.cx, cz: d.cz, version: d.version, out }, transfer);
    } catch (err) {
      self.postMessage({ t: 'error', id: d.id, error: String((err && err.message) || err) });
    }
  }
};
