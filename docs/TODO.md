# TODO.md — 项目创意/提案暂存

> 本文件仅暂存「已评审但未排期」的提案；已交付 / 已废弃条目一律归入文末「已归档」节，进度事实以 `AGENTS.md` 与代码为准。
> 已评审但暂缓排期的提案记录在此；恢复排期时从对应条目的“前置条件”开始。
> 最后对账：2026-10-18（对照 Build 31、`AGENTS.md` Roadmap 与 `src` / `server` 实际代码）。

---

## 未排期提案

### U-1 · 实体方块贪心合并（源自 Idea-3 B-③）— 未排期

- **状态**：未排期。Idea-3 的 A / B-① / B-② / C 均已交付，仅 B-③ 保留为可选后续。
- **原文摘要**：主线程只做光照增量与 mesh 上屏，“实体方块贪心合并作第二期”；收益在渲染距离 12 时最大，需真机帧时间对比基线。
- **现状**：主线程区块构建收集已够快，软渲染环境的时间数据无参考价值。
- **前置条件**：真机帧时间对比基线（渲染距离 12）。
- **交付物**：`ChunkMeshBuilder` 实体方块贪心合并（同步与 Worker 两条路径字节级一致）。

---

## 已归档（已交付 / 已废弃，仅存档追溯）

> 归档条目只保留原文摘要与状态标记，不再维护细节；完整原文见本文档 Build 31 之前的 git 历史（`git log -p -- docs/TODO.md`）。各子系统防回退细则见 `AGENTS.md` 与 `docs/agent-notes/`。

### Idea-1 · 光照视觉增强 L4（平面真反射 / 真实阴影贴图）— ✅ 已交付（A、B），C 已废弃

- **原文摘要**：A 平面真反射（半分辨率 Reflector：镜像相机二次渲染 + 菲涅尔混入，独立子开关）；B 真实阴影贴图（`MeshBasicMaterial` 不接收阴影是死结级问题，靠 `material.lights` + `onBeforeCompile` 手工补 shadow chunk 链，**与 three 0.160 的 shader chunk 结构强耦合，升级 three 前先做耦合面清单**）；C SSAO/GTAO 按评审结论不做。
- **状态**：A、B 均已交付（B 含批次①打通与批次② snap-to-texel 调校），本条目已完结；后续微调走正常迭代。
- **代码**：`src/render/PlanarReflection.js`、`src/render/SunShadow.js`。

### Idea-2 · P3 后选做机制池（弓蓄力 / 箭矢联机 / 潜影盒 / 凋灵链 / 铁傀儡）— ✅ 全部已交付

- **原文摘要**：A 弓蓄力、B 箭矢联机、C 潜影盒、D 凋灵链（D-① 凋零骷髅头颅掉落、D-② 凋灵 Boss、D-③ 信标 + buff 系统）、E 铁傀儡；原计划为“D 剩余凋灵 Boss + 信标维持独立立项”。
- **状态**：2026-09-12 起逐项交付，D-② / D-③ 之后亦已落地（`server/test-idea2.mjs` 覆盖箭矢 / 凋灵 / 潜影盒），原“剩余…独立立项”的计划表述已失效。
- **代码**：`_bowCharging`（`src/player/Game.js`）、`arrow_shot`（`server/protocol.js`）、`shulker_box`（`src/blocks/BlockDefs.js`）、`src/entity/WitherAI.js`、`src/ui/BeaconScreen.js`、`guardian`（`src/entity/Mob.js`）。

### Idea-3 · 体验与性能补强池（音频 / Worker 化 / 玩家档案）— ✅ 已交付（B-③ 拆出见 U-1）

- **原文摘要**：A 音频系统（WebAudio 程序化合成、材质分路、怪物语音 + 环境音 + BGM）；B 主线程 Worker 化（B-① 地形生成、B-② 网格构建，同步 / worker 字节级一致）；C 服务器玩家档案（`profile_save` / `player_profile` 协议、10s 节流落盘、op 清理 API）。
- **状态**：A、B-①、B-②、C 已交付；B-③ 未排期（见 U-1）。
- **代码**：`src/audio/AudioEngine.js`、`src/workers/TerrainWorker.js`、`src/workers/MeshWorker.js`、`profile_save`（`server/protocol.js`）。

### Idea-4 · 服务器运维池（房间开关 / 世界备份 / 速率限制）— ✅ 已交付

- **原文摘要**：A 房间配置开关（PvP / 怪物生成）；B 世界备份导出（op 专属下载 + 自动备份保留 N 份）；C 消息速率限制（令牌桶、超限丢包计数 + 面板可见 + 聚合日志）。
- **代码**：`roomSettings`（`server/room.js`）、`roomSnapshot`（`server/store.js`）、`server/ratelimit.js`、`server/test-idea4.mjs`。

### Idea-5 · 世界观完善文档（一潮三分）— ✅ 已交付（v1 + P1 / P2 / P3 全部实装）

- **原文摘要**：产出 `docs/worldview.md` 总纲（命名三层策略、世界观支柱、各维度故事线、术语登记表、与原版刻意差异清单），并编制 P1 下界篇 → P2 主世界篇 → P3 末地篇的下阶段计划。
- **状态**：v1 于 2026-09-15 交付；P1 / P2 / P3 已随 Alpha Build 15 / 16 / 17 实装（其后 Build 18 终局篇、Build 19 鲸骨冢篇亦已交付）。
- **文档**：`docs/worldview.md` §3.2–§3.4 / §6 / §10。
