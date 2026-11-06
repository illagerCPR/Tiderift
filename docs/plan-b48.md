# Build 48 计划：村庄双格床 / 门可通行 / TNT 激活·行为·特效

> 三项合成一个 Build（48），不分 Build 只分轮：轮 1 床+门、轮 2 TNT 机制、轮 3 TNT 表现+收尾发布。
> 轮 1/轮 2 各自独立提交（保持 BUILD 47），轮 3 统一升 `src/version.js` 到 48 并只发一个 Release。

## 一、现状诊断（全部实测，不是猜测）

### 1. 村庄床只有一格
`src/world/structures/village.js:167` 只写了一个方块：

```js
if (kind === 'bed' || kind === 'big') setAt(x1 - 1, groundY + 1, bz, ID.bed);
```

`ID.bed = blockId('white_bed')`，而 `white_bed` 是「床尾·朝北」本名（`bedId('foot','n')`），
所以生成出来的永远是 **1 格床尾**，没有床头条。实测某 seed 村庄 4 张床，全部 `bed_foot facing=n`，
`z-1` 格是空气。

### 2. 开了门的通道过不去（实测数据）
`Village` 房屋的 1 格门洞里，开门态门板是 3/16 贴边薄板（`doorOpenShape('n') = box(0,0,0,3/16,1,1)`），
玩家 AABB 0.6 宽 → **可用横向窗口只剩 0.2125 m**，且窗口中心偏到 11.594（门格中心 11.5）。
用 `Physics.collide` 实测（平原房门的真实村庄方块，门开）：

| 玩家 x | 结果 |
|---|---|
| 11.15 / 11.30 | 卡在 z=3.700（门外） |
| 11.50 | 过（余量仅 0.0125 m） |
| 11.70 | 过（边界） |
| 11.85 | 卡在 z=3.700 |

对照：同样的 1 格宽 **没有门板** 的洞，窗口是 `[11.30, 11.70]`（0.4 m）——即门板吃掉了 47% 的容差。
另外门外是草径（顶面 15/16=64.9375）、门内是木地板（顶面 65），进门要抬 1/16，这一步走
`auto-jump` 分支；玩家正好卡在门板上时 `_yClearAt` 也被门板判成"顶上有阻挡"，于是连那 1/16 都上不去。
这就是「必须挖 3 高 2 宽才进得去」的真实成因（高度其实是够的：1 宽 2 高的洞居中即可通过，实测 PASS）。

### 3. TNT 目前几乎是空壳
| 面 | 现状 |
|---|---|
| 激活方式 | 只有红石（拉杆/按钮/红石粉/火把/红石块）。打火石右键只点火传送门，对 TNT 无效 |
| 激活行为 | `RedstoneSystem.detonateTNT()` **通电当帧立即爆炸**，没有引信；方块当帧被删 |
| 破坏 | 半径 4 球体，`hardness >= 0` 全清——**黑曜石照样被炸掉**（原版免疫） |
| 伤害 | 只有玩家（`onExplosion`），`(radius*1.5-dist)*8` 近距离 48 点，过强且无衰减建模 |
| 击退 | 无（玩家水平速度每帧被输入覆写，没有外部冲量通道） |
| 怪物 | 完全不受伤 |
| 连锁 | 半径内其它 TNT 立即再炸（同步递归），没有引信错峰 |
| 特效 | 只有逐块碎屑粒子；无烟、无火光、无音效、无闪光、无震屏 |

## 二、设计

### A. 村庄床改双格（轮 1）
- 床尾 `bedId('foot','s')` @ `(x1-1, groundY+1, z1-2)`、床头 `bedId('head','s')` @ `(x1-1, groundY+1, z1-1)`
  —— 床头贴后墙，朝门方向躺，与原版村庄观感一致；旧坐标那一格（z1-1）保留为床头。
- **零 rng 消耗**：坐标写死，房间种类/朝向/其它陈设的抽取顺序一律不动 → 村庄布局对旧 seed 的
  确定性不变（只是多出 1 格床头条）。
- 不改方块 ID、不改形制表：`white_bed_*` 家族早就注册齐了（头/尾 × 4 朝向 = 8 态）。

### B. 门可通行（轮 1）
1. 开门态门板 **不再参与碰撞**（渲染/光照/选取完全不变）。
   - 新增方块字段 `passable`（进 `BlockRegistry` 白名单），只给 16 个 `*_open` 门态置 true；
     `solid` 保持 true —— 所以区块剔除、AO、体素光、准星选取、破坏掉落全部零影响。
   - `Physics.moveAxis` / `_yClearAt` / `EntityPhysics.moveAxis` 遇到 `def.passable` 直接跳过。
2. **小台阶恒可踏越**：抬升高度 ≤ 0.6（原版 step height）不再受「自动跳跃」开关门控，只有 0.6~1.0 的
   整格台阶才看 `autoJump`。理由：门内外有 1/16 高差（草径 15/16 vs 木地板 1），关掉自动跳跃的玩家
   现在根本进不了村屋；床 9/16 也顺带恢复原版"直接走上去"。
   - 关门的门板仍是 `maxBlockTopIsDoor`，不可踏越（防"爬门"），这段逻辑不动。
3. 结果是 1 格 × 2 高的门洞横向容差从 0.2125 → 0.4（与同尺寸无门洞完全相同、且居中）。

### C. TNT 三面（轮 2 机制 / 轮 3 表现）

**新方块 `tnt_primed`（ID 223，尾部追加，既有 ID 零漂移）**
- `baseBlock: 'tnt'` → 挖掉掉 TNT 物品；`hardness: 0`；三面贴图未点燃版的提亮版（像素级测试可判"更白"）。
- 进存档时**不保留点燃态**：`World._finalizeChunk` 的旧档迁移扫里把 `tnt_primed` 归一化回 `tnt`（幂等）。

**激活方式**
- 打火石右键 TNT（新增，生存/创造都可用；本项目无耐久系统）→ 点燃 + 短促引信嘶声。
- 红石通电（保留，但改为点燃：`RedstoneSystem` 的 TNT 分支从"立即炸"改成回调 `onTntPowered`）。
- 爆炸波及半径内的 `tnt`（改点燃，延迟 0.3~0.8s 错峰，已点燃的不重置）。
- 点燃幂等：重复点燃不重置引信、不叠层。

**引信与爆炸行为**
- 引信 4.0 s（原版 80 tick），按 `dt` 推进 → 帧率无关；方块被挖掉/替换/区块未加载即冻结或取消。
- 爆炸：半径 4；方块破坏跳过 `hardness < 0`（基岩）与 `blastResist >= 1200`（黑曜石新加字段）；
  其余清空 + 碎屑（每块少量，总量上限控制）。
- 伤害：`f = 1 - d/(R*2)`，`damage = 26 * f`（点爆 26，8 格外 0）——玩家与怪物同式；玩家照旧走
  `player.hurt`（盔甲/抗性/无敌帧全在内部），怪物新增 `MobManager.damageMobsInRadius`。
- 击退：水平 `14 * f`、垂直 `7 * f`。玩家新增 `player.knockback` 冲量通道（输入速度每帧被覆写，
  必须单独加一层再衰减），怪物走既有 `mob.knockback`。

**特效**
- 引信：方块外套一层白色脉冲罩（`transparent` 立方，透明度 0.55±0.45，频率随剩余时间从 2Hz 涨到 6Hz，
  轻微膨胀），逐帧更新，不触发区块重建。
- 爆炸：火球（加法混合 sprite 扩张 0.3s）+ 火花 24 粒 + 烟 18 粒（按视频设置密度缩放）+ 方块碎屑 +
  HUD 白闪 0.18s + 相机震动 0.35s（幅度按距离衰减，`0.12 m` 级，只偏移相机位置、不改朝向）。
- 音效：`AudioEngine.explosion(dist)`（低频轰鸣 90→30Hz + 两段噪声，24 格距离衰减）、
  `fuseHiss(dist)`。

**联机（不升 `PROTOCOL_VERSION`、不加消息类型）**
- 点燃 = 把方块换成 `tnt_primed`，走既有 `block_set` 同步；`NetworkManager.applyRemoteBlock` 落地后
  通知 `TntSystem`（同一个位置各端各自跑同一条 4s 引信）。
- 爆炸的方块清理由各端本地结算，写入期间置 `world._batchBlockWrites`，让 `NetworkManager.bindWorld`
  把这几百条改动汇进既有的 `BLOCK_SET_BATCH` 通道（250ms 合批），避开 `rateLimits.block=900/min`。
- 玩家伤害本地结算（各自算各自的玩家）；怪物伤害各端本地结算（与既有苦力怕爆炸口径一致）。

## 三、改动文件清单

**轮 1**
- `src/world/structures/village.js`（床双格）
- `src/blocks/BlockDefs.js`（16 个开门态 `passable: true`）
- `src/core/BlockRegistry.js`（白名单 `passable`）
- `src/player/Physics.js`、`src/entity/EntityPhysics.js`（跳过 passable + 小台阶规则）
- `tests/build48-bed-door.mjs` + `server/run-all-tests.sh` 登记

**轮 2**
- `src/core/Explosion.js`（新，纯数学：衰减/伤害/击退/抗性/空炸格集合）
- `src/player/TntSystem.js`（新，域模块：引信表 + 点燃/取消 + 爆炸执行 + 联机入口）
- `src/blocks/BlockDefs.js`（尾部追加 `tnt_primed` + 提亮贴图；黑曜石 `blastResist`）
- `src/core/BlockRegistry.js`（白名单 `blastResist`）
- `src/core/RedstoneSystem.js`（TNT 分支改 `onTntPowered` 回调，删旧的立即爆炸与 `onExplosion`）
- `src/core/World.js`（`_finalizeChunk` 归一化 `tnt_primed` → `tnt`）
- `src/player/InteractionController.js`（打火石右键 TNT）
- `src/player/Game.js`（新建/销毁/每帧推进 TntSystem；玩家击退冲量通道；移除旧爆炸回调接线）
- `src/net/NetworkManager.js`（远端落地通知 TntSystem；批量写路由）
- `src/entity/MobManager.js`（半径伤害 API）
- `tests/build48-tnt.mjs`

**轮 3**
- `src/player/TntSystem.js`（白罩/火球/震动）
- `src/render/ParticleSystem.js`（若有需要补一个爆炸 burst 便捷方法）
- `src/audio/AudioEngine.js`（`explosion` / `fuseHiss`）
- `src/ui/Hud.js`（`flashBlast` 白闪）
- `src/version.js`（48）、`docs/agent-notes/*`、`AGENTS.md`
- 浏览器视觉验收截图

## 四、回归网（新增两个套件，登记进 `server/run-all-tests.sh`）

`tests/build48-bed-door.mjs`
1. 3 个 seed 的村庄：每个 `bed_foot` 都有配对 `bed_head`（相邻、facing 一致、baseBlock 一致、
   foot→head 方向与 facing 相符）；床尾/床头数量相等；没有格子被写两次。
2. 门：`passable` 只在 16 个开门态上（关态/活板门不受影响）；`solid` 仍为 true。
3. 碰撞行为：村庄真实门洞里，关门挡人；开门在 x=11.15 / 11.3 / 11.85 全部通过（这三档旧实现全卡住），
   容差 ≥ 0.38；`EntityPhysics` 同样通过。
4. 小台阶：`autoJump=false` 时 1/16 台阶可踏越、整格台阶不可（两条都断，防"顺手放宽成 1 格"）。
5. 源码绊线：村庄床必须是 `bedId('head',` 双写。

`tests/build48-tnt.mjs`
1. 方块表：`tnt_primed` = 223（尾部追加）、`tnt`=117 / `grass_path`=222 等既有 ID 零漂移、
   `baseBlock/tool/hardness/transparent/textures` 正确、三张 SVG 入表、像素比 `tnt` 更白。
2. `Explosion` 纯数学：falloff 单调、d=0 → 1、d≥2R → 0；伤害/击退数值；基岩与黑曜石免疫、普通方块不免疫。
3. 引信：4.0s 到期；30fps 与 120fps 结果一致；`prime` 幂等；方块被清除/未加载时冻结或取消；不随帧率漂移。
4. 红石：通电只点燃（方块变 `tnt_primed` 且**当帧仍存在**）+ 旧"立即爆炸"实现被绊线拦下。
5. 连锁：半径内 `tnt` 进引信表、已点燃的不重置、延迟在 0.3~0.8s 区间。
6. 归一化：`_finalizeChunk` 扫到 `tnt_primed` 改回 `tnt`。
7. 联机绊线：`applyRemoteBlock` 通知 TntSystem；批量写开关存在；`protocol.js` 无新增消息。
8. 特效绊线：`AudioEngine.explosion/fuseHiss` 存在、TntSystem 有白罩 mesh 与火球、Hud 有白闪。

## 五、红线

- 新方块一律追加在 `BlockDefs.js` 末尾（存档/联机账本按数字 ID 落盘）。
- 村庄布局的 rng 消耗顺序零变化（床坐标写死，不 `rng()`）。
- 不加设置项开关、不改地形/水位/光照、不升联机 `PROTOCOL_VERSION`。
- `dev` 手测与 `npm test` 全绿后再收尾；发布前核对 `BUILD === 48`。

## 六、验收与交付

- 每轮先 `node --check` 改动文件 → `npm test` 全绿 → 浏览器手测（playwright + swiftshader）。
- 视觉验收点：① 村屋进门走一遍（门开/门关/眼高）；② 床整块近景（床头/床尾贴图方向）；③ TNT 点燃 4 秒
  闪白过程 3 帧 + 爆炸瞬间 + 爆炸后坑（含黑曜石留着）；④ 夜里爆炸有火光/粒子/白闪。
- 轮 3 收尾：`src/version.js` → 48，一个 commit（GPG 签名）→ push → `gh run watch` 绿 →
  `git tag -s beta-build-48` → `gh release create beta-build-48`（触发 Pages 部署）→ 线上 bundle 核验
  `const <var>=48`。
