// ModifiedBlocks.js -- 修改方块账本：Map 子类，写入时维护按区块分桶的键索引
// 对外形态与迭代语义与原生 Map 完全一致（set/get/delete/clear/size/for..of/entries 均可）；
// 索引只随账本写入路径同步，供 World.applyModifications 只遍历本区块桶（免全账本扫描）
import { CHUNK_SIZE } from './Chunk.js';
import { parsePosKey } from './posKey.js';

function chunkKey(cx, cz) { return `${cx},${cz}`; }

export class ModifiedBlocks extends Map {
  constructor(entries) {
    super();
    this._chunkIndex = new Map(); // "cx,cz" -> Set(本区块账本键)
    if (entries) for (const [key, id] of entries) this.set(key, id);
  }

  set(key, id) {
    const p = parsePosKey(key);
    const ck = chunkKey(Math.floor(p.x / CHUNK_SIZE), Math.floor(p.z / CHUNK_SIZE));
    let bucket = this._chunkIndex.get(ck);
    if (!bucket) this._chunkIndex.set(ck, bucket = new Set());
    bucket.add(key);
    return super.set(key, id);
  }

  delete(key) {
    const p = parsePosKey(key);
    const ck = chunkKey(Math.floor(p.x / CHUNK_SIZE), Math.floor(p.z / CHUNK_SIZE));
    const bucket = this._chunkIndex.get(ck);
    if (bucket) {
      bucket.delete(key);
      if (bucket.size === 0) this._chunkIndex.delete(ck);
    }
    return super.delete(key);
  }

  clear() {
    this._chunkIndex.clear();
    super.clear();
  }

  // 本区块的账本键集合；该区块无修改返回 null
  keysInChunk(cx, cz) {
    return this._chunkIndex.get(chunkKey(cx, cz)) || null;
  }
}
