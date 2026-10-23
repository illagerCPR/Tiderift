# 建筑蓝图约定（Build 35 E）

本文记录蓝图实现与复核时应保持的稳定数据和行为约定。

## 数据与材料

单张蓝图采用以下数据形状：

```js
{ id, name, dim, rev, byId, size: { x, y, z }, palette: [blockId], data: <RLE 字符串> }
```

蓝图修订通过 `id#rev#byId` 区分；个人记录的 `byId` 为空字符串。RLE 数据必须保留区域中的空气格，以保持完整形状；空气不渲染，也不计入材料需求。材料清单只统计背包中的方块与物品。

## 捕获与预览

捕获仅读取已经加载的区块；选区包含未加载区块时必须拒绝捕获，且不得为此生成区块。捕获不能改写世界。

两次点选各自距玩家不超过 32 格，且按**每次点选当场**的玩家位置判定（`isWithinCaptureReach`），不按包围盒对角判定——否则在长边的一头点第一角、走到另一头点第二角会被误拒。

`GhostPreview` 仅用于视觉预览，不得放置方块或改动世界。预览方块数超过 4096 时降级为包围盒预览。

预览的共享 `geometry`/`material` 是模块级单例，关闭时不得释放；每次重建的轮廓 `LineSegments` 的 geometry/material 与 `InstancedMesh` 的 `instanceMatrix` 缓冲必须释放（`InstancedMesh.dispose()`，three 的 `WebGLObjects` 监听该事件）。轮廓材质在建造时不要提前 `dispose`，否则关闭时会二次释放同一材质。

## 材料清单

材料行整行可点击，点击走既有 `RecipeViewer.showFor(name)` 查配方，不自造配方逻辑。注意 `RecipeViewer` 只在背包/箱子/熔炉/交易界面打开时才渲染面板，故无容器界面时先按 J 键同款路径打开背包（`inventoryScreen.show(2)`）再查询；理想做法是给 `RecipeViewer` 增加脱离容器界面的独立弹窗模式，目前未做。

## 保存、房间共享与清理

个人蓝图按存档槽隔离保存。房间蓝图共享由服务器权威维护，并以所有者与修订号标识共享归属和版本；客户端不能把旧修订伪装成当前版本。

关闭预览、关闭界面、切换维度或离开/重开世界时，清理预览对象并释放其渲染资源；重新进入世界时重置旧界面与预览状态，避免残留对象或资源泄漏。

## 已知限制

- 房间蓝图的归属 `byId` 存的是**连接期** `player.id` 字符串。服务器重启或玩家重连后 id 会变，原创建者无法再编辑/删除自己分享的蓝图（只能由 op 清理）。当前没有登录体系，不做跨会话身份绑定。
- 同一原因导致 `byId`（字符串）与 `game.remotePlayers` 的键（服务器数字 id）类型不同：**任何**要用 `byId` 查远端玩家的地方（界面里的「由 X 分享」与分享广播的聊天提示）都必须两种键都试（先字符串再 `Number`，非有限值不查），否则恒 miss、永远落到兜底名。凡是拿服务器 id 做比较的地方统一用 `String(a) === String(b)`。

## 验证路径

- 单机纯 Node 蓝图数据测试：`tests/blueprint-unit.mjs`（已接入 `server/run-all-tests.sh` 的 `PURE_NODE_SUITES`）。
- 房间共享服务端测试：`server/test-blueprint.mjs`（已接入 `run-all-tests.sh` 的 server 循环；直接 `node server/test-blueprint.mjs` 即可跑，不需要起服）。
