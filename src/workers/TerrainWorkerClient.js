// TerrainWorkerClient.js -- TerrainWorker 主线程客户端（Idea-3B-①）
// 请求-回执队列 + 轮询分发；Worker 失败（模块加载失败等）时 reject 全部在途请求，
// 调用方（World）据此回退主线程同步生成路径。
export class TerrainWorkerClient {
  constructor(workerCount = 2) {
    this._nextId = 1;
    this._pending = new Map(); // id -> { resolve, reject }
    this.workers = [];
    this._rr = 0;
    this.broken = false; // onerror 触发后置位，调用方回退同步路径
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker(new URL('./TerrainWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this._onMessage(e.data);
      w.onerror = (e) => this._failAll(String((e && e.message) || e));
      this.workers.push(w);
    }
  }

  // 生成一个区块，返回 { cx, cz, blocks: Uint8Array }（blocks buffer 已移交主线程）
  // extraContent：B51 世界清单（随请求下发，Worker 侧进缓存键——不读任何全局状态）
  generate(cx, cz, seed, biomeScale, extraContent) {
    const id = this._nextId++;
    const w = this.workers[this._rr++ % this.workers.length];
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      w.postMessage({ id, cx, cz, seed, biomeScale, extraContent });
    });
  }

  _onMessage(msg) {
    const p = this._pending.get(msg.id);
    if (!p) return;
    this._pending.delete(msg.id);
    if (msg.ok) p.resolve({ cx: msg.cx, cz: msg.cz, blocks: new Uint8Array(msg.blocks) });
    else p.reject(new Error(msg.error || 'TerrainWorker 生成失败'));
  }

  _failAll(err) {
    this.broken = true;
    for (const p of this._pending.values()) p.reject(new Error(err));
    this._pending.clear();
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this._pending.clear();
    this.broken = true;
  }
}
