# 世界账本与热路径备忘（World.modifiedBlocks / 红石 / 流体）

## B30 审查轮 6（F7 账本分桶索引、F12 热路径键化）

### F7 World.modifiedBlocks 分桶索引

- 背景：`World.applyModifications()` 原先每次生成区块都全量遍历整个 `modifiedBlocks` 账本并逐条 `split(',')` 解析坐标——40k 条账本下 169 区块重放实测 2.36 s。
- 现状：`src/core/ModifiedBlocks.js` 的 `ModifiedBlocks extends Map` 自带区块索引 `_chunkIndex: "cx,cz" -> Set(账本键)`，写入/删除/clear 同步维护（桶空即删，无泄漏）；`keysInChunk(cx, cz)` 返回该区块键集，无该区块时返回 null。
- `World.applyModifications` 走 `ledger.keysInChunk` 快路径；**只有** `typeof ledger.keysInChunk === 'function'` 时才用索引，否则回落全量遍历。`_applyLedgerEntry(chunk, key, id)` 是唯一的单条重放入口。`World.dimBucket(store, indexed = false)` 决定桶类型：`indexed=true` 产出 ModifiedBlocks（`modifiedBlocks`），其余产出普通 Map——旧存档 / 联机 `dimensionBlocks` 反序列化出的普通 Map 仍能正确重放。
- 防回退：① 任何新增「写 modifiedBlocks」的路径必须走 Map API（`set`/`delete`/`clear`），不得直接改内部结构，否则索引与账本失配（轮 6 独立复核：全仓 4 条写路径均走 Map API）；② 键格式 `"x,y,z"` 由 `src/core/posKey.js` 唯一编解码，勿在别处手写 split 解析；③ `parsePosKey` 只认 3 段，4 段以上畸形键会得到 z=NaN（全仓无生产者，当前不可达）。
- 性能锚点（轮 6 独立复核）：40k 条账本下 169 区块应用 10 ms（旧 2356 ms，约 236×）；等价性复核：真实 World + Chunk 169 区块 × 65536 格逐字节 0 差异。

### F12 红石 / 流体待处理队列键化

- `RedstoneSystem.pendingUpdates`：由 `Set("x,y,z")` 改为 `Map<posKey, [x,y,z]>`——BFS 入队时同存坐标，步进时直接取数组，免每键 `split` + `Number`。
- `FluidSim.pendingWater / pendingLava`：同样由 `Set` 改为 `Map<posKey, [x,y,z]>`，`_step` 批量取数组。
- 键的唯一来源是 `src/core/posKey.js`（`posKey` / `parsePosKey`）；`FluidSim.posKey()` 静态方法与 `RedstoneSystem.key()` 保留但委托给它。
- 防回退：换容器只允许「同格式键」。**键格式与外部消费者（服务器/存档下发的账本键、`FluidSim.rehydrate`、`NetworkManager._fluidBatch`）必须保持不变**——改键格式等于旧存档与联机账本不兼容。
