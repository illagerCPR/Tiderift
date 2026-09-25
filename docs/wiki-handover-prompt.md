# Tiderift GitHub Wiki 增量更新 —— 交接提示词（批次 7；Wiki 站原名 CubeWorld Wiki，随仓库更名自动重定向）

> 交接日期：2026-09-16 ｜ 移交方：上一会话（已完成 docs/worldview.md 的 Build 23 核对）
> 任务：把 GitHub Wiki（`illagerCPR/Tiderift.wiki`）从 **Alpha Build 7 基准**增量更新到 **Alpha Build 23**。
> 本文件自包含：不依赖任何历史会话上下文，按本文即可开工。

## 0. 任务一句话

CubeWorld Wiki（gollum/GitHub Wiki 文档站，44 页）最后一次全量更新收口于 **Alpha Build 5–7**（Wiki 批次 6，2026-09-13，commit `e54469d`）。此后项目已交付 **Build 8 → Build 23** 共 15 个版本（含 Build 14–19 五个叙事篇章——这是 Wiki 目前最大的内容缺口）。请做一次批次 7 增量更新，收口到 Build 23。

## 1. 仓库与工具

| 项 | 位置 |
|---|---|
| 项目工作副本 | `~/projects/project-mc/`（远程 `illagerCPR/Tiderift`，master） |
| Wiki 仓库 | `git clone https://github.com/illagerCPR/Tiderift.wiki.git`（gollum 格式，`.md` 即页面） |
| 版本权威 | `gh release list --repo illagerCPR/Tiderift`（当前最新 `alpha-build-23`）+ `src/version.js`（`BUILD = 23`） |
| 本地预览 | Wiki 仓库内自带 `preview.sh`（批次 1–6 沿用） |
| 版本常量 | `src/version.js` —— 文档基准版本号以它为准，勿信页面旧文 |

## 2. 权威素材源（按优先级）

1. **GitHub Releases 发布说明**：`gh release view alpha-build-<N> --repo illagerCPR/Tiderift` —— 每版玩家可感知变化的权威清单（Changelog 页的主要素材）。
2. **git 提交标题**：`git log --oneline` —— 本项目提交标题即极详尽交付说明（含实现要点、测试断言数、冒烟结果），比 Release 说明更细，开发者页素材主要来源。
3. **批次踩坑备忘**：`docs/agent-notes/`（7 篇：worldgen-structures / dimensions-portals / survival-items / mobs-entities / rendering-lighting / multiplayer / ui-misc）—— 按"现象→原因→正确做法"吸收进 Known-Pitfalls 与各页实现要点。
4. **世界观文档（本次已核对到 Build 23）**：`docs/worldview.md`（一潮三分总纲 + 四界篇章 + 术语表）与 `docs/aether-storyline.md`（天域篇全文）—— 新增叙事页的素材。
5. **源码核对**：`src/`、`server/`、`tests/` —— 所有数量型断言一律运行时对账（见 §6），README 与旧页数字常滞后，**禁止臆造参数**。

## 3. Build 8 → 23 净增量速览（15 版）

> ⚠️ LAN 联机阶段 0–11 与 Idea-2/3/4 系列（音频/Worker/玩家档案/房间开关/白名单/限速/备份）**全部在 Build 8 之前交付**，Wiki 批次 1–6 已覆盖（Multiplayer-Guide / Admin-Panel / Audio-Engine 等页已存在）——本次不需要重写它们，但更新相邻页面时顺手核对该页数字是否漂移。

| 版本 | 一句话 | 主要 Wiki 落点 |
|---|---|---|
| **Build 8** | 凋灵召唤支持原版 T 型三层竖直结构（兼容摆法保留，原版优先匹配） | Mobs |
| **Build 9** | 新增俄/西/葡三语言：UI 8→10 语言包 + names.js 8→11 列，键集/占位符程序化双校验 | Interface-Language、Multiplayer-Limitations（无需改则跳过） |
| **Build 10** | 掉落物原版化（真实贴图渲染/自旋浮动/磁吸拾取/Q 丢弃）+ 物品栏页签（创造 8 分类+搜索+摧毁槽，JEI 弹窗化） | Inventory-Crafting |
| **Build 11** | 回退 JEI 内嵌伴随模式（贴容器两侧/J 键），新增生存物品栏页签（原版式末位页签）——**Build 10 的 JEI 弹窗描述已作废** | Inventory-Crafting（注意写最终形态） |
| **Build 12** | 文本焦点处快捷键/输入法隔离（搜索框/聊天/命令面板打字不再触发游戏键；输入法合成中不处理） | FAQ、Controls |
| **Build 13** | 创造模式原版化（开局空背包、网格容器式光标拿取）+ i18n 补漏批（JEI 漏接 + 14 维度群系名 ×10） | Game-Modes、Interface-Language |
| **Build 14** | **天域篇「天海纪元」**（批次 A–D 合一发版）：6 新方块（星髓矿石/星髓块/云绒块/风纹石碑/恒昼祭坛/气流）+ 10 新物品（三残页/风暴图腾/风暴之核/心核碎片/缚风之剑/御风斗篷/云絮）+ 石碑系统（九章碑文 + 石碑浮层 + 世界内右键阅读）+ 天域生物 5 种（wisp 风灵 / aether_guard 星铸卫 / cloud_lamb 云绒兽 / gale_hawk 岚隼 / tide_echo 潮鸣）+ 守誓巨像 Boss + 复潮仪式 + 物品 lore tooltip | **新增叙事页**、Blocks、Items、Mobs、Structures、Dimensions-Portals |
| **Build 15** | **下界篇「烬火之炉」**：烬纹石碑 + 烬火纪碑文 4 章（坠潮/炉火/熏黑/哀鸣）+ 潮火之炉结构（箱表 FORCED 哀潮之泪保底）+ 哭嚎者 `mourn_howler`（熔岩海上空 flying 中立，掉落哀潮之泪）+ 灵魂沙/荧石 lore | Nether、Structures、Mobs、Items |
| **Build 16** | **主世界篇「雨土遗事」**：苔纹石碑 + 雨土纪碑文 3 章（咸雨/纹样/门厅）+ 潮冢 `tide_barrow`（河心选址，要塞同稀有档）+ 雨潮残页 + 村庄井旁/要塞门厅碑位 + 要塞箱低权残页 | World-Generation、Structures、Villages-Villagers |
| **Build 17** | **末地篇「无潮滩涂」**：界纹石碑 + 彼岸碑文 2 章（拾遗/守望——龙刻意留白）+ 拾遗者石环 `gleaner_ring` + 主岛守望界碑 + 潜影盒/鞘翅/紫颂 lore | The-End、Structures |
| **Build 18** | **终局篇「潮归其位」**：原初祭坛 + 原初纹章（append-only 双 id）+ 候潮章 + 60s 四界同潮演出（换维追潮、纯客户端）+ 听潮仪式（守望界碑门控 + 龙影低头粒子 + `finaleDone` 持久化）+ LAN `FINALE_STATE` 服务器权威只进不退 | Dimensions-Portals、Multiplayer-Guide、Save-Formats |
| **Build 19** | **鲸骨冢篇**：鲸骨块 `whale_bone_block` + 鲸骨冢结构（巨型肋骨拱 + 归云章 3 行 + 考古箱表）+ 命令面板生物名 11 语补全 + 原初祭坛右键候潮章 + 盔甲栏原版底纹 + 飞行翅膀图标 + 终局成就（10s 金色横幅 / 存档栏 ✦已通关·潮归其位✦ / 纹章佩戴槽：无敌+创造式飞行+基岩心形，严格门控 finaleDone） | Structures、Blocks、Inventory-Crafting、Commands-Panel、Save-Formats |
| **Build 20** | 七连修复：石碑四格形制（底座=维度特色方块 苔石/岩浆块/紫珀/星髓，`steleStack` 单一来源）· 末地折跃门黑洞星空纹理 · 创造中键取物 · **创造/旁观对所有生物不可激怒** · F5 三视角循环+F6 手动保存（第三人称本地玩家模型）· 命令面板终局演出全维度 · 天域永昼跨存档泄漏修复（`aetherDusk` 单机只信存档字段） | Controls、Game-Modes、Structures、Mobs、Entity-AI、Dimensions-Portals |
| **Build 21** | 玩家皮肤系统：`PlayerSkin` 双层贴图（classic/slim 双模型、overlay 外扩壳、legacy 64×32 归一）+ SkinScreen（上传 PNG/2D 预览/恢复默认）+ 第一/第三人称全应用 + 修复抬头反向低头 + 手持物挂点掌前 + 联机 `skin_set` 同步（房间账本+重连回放）+ Mojang 正版皮肤代理 `GET /api/skin/:username`（三跳拉取+5min 缓存） | Multiplayer-Guide、Network-Protocol、Server-Internals、FAQ |
| **Build 22** | 修复批次：皮肤双层 overlay 对齐（4px 偏移）· 第一人称手臂缩小 · **实体体素光染色**（夜晚火把旁怪物/玩家走 emissive 暖光通道，emissiveMap=map 保持纹理）· 皮肤拉取管理日志（进 `/api/logs` 的 `skin-fetch` 条目）· i18n 键改名「Minecraft®: Java Edition档案用户名」 | Rendering-Pipeline、Lighting-Engine、Admin-Panel |
| **Build 23** | 皮肤面板用户名输入框自适应加宽（canvas measureText 实测占位宽）· `run-all-tests.sh` 收尾自动清除测试世界与鉴权账号（stage11 API 清空 + 文件级 `rm server/config.json` + `rm -rf server/world/`）· 主界面 LAN 状态组件（右下角：IP 输入 + 在线/离线探测 + SVG 刷新按钮，跨端口 `no-cors` 探测，localStorage 持久化 `project-mc-lan-host`） | Multiplayer-Guide、Server-Hosting、Testing-Guide、Quick-Start |

## 4. 建议新增页：`Worldview`（本次交接的核心缺口）

Build 14–19 的叙事内容在 Wiki 上**完全没有落点**（44 页里没有世界观/lore 页）。建议新增一页，采用既有「一页双段」结构：

- **前半（玩家视角）**：「一潮三分」故事线速览（原初之潮 → 裂潮之日 → 四界现状）→ 四界各有什么可看（碑文在哪些结构里、怎么读、收集线：三残页/三潮之证/终局演出触发条件）→ 留白纪律说明（龙在等什么，碑文不写满）。
- **末尾「实现要点（给开发者）」小节**：`src/world/steles.js` 章节表与 `steleChapterAt` 机制 / 石碑四格形制（Build 20）/ 术语登记表与 i18n ×10 纪律 / append-only 注册约束。
- 素材：`docs/worldview.md`（总纲，已核对到 Build 23）+ `docs/aether-storyline.md`（天域篇定稿）。**提炼改写，不搬运**——agent-notes 与 docs 是给开发者的中文备忘，Wiki 玩家段要重写为玩家可读的口吻。

## 5. 可复用流程（批次 1–6 实证沉淀，务必沿用）

1. **先侦察变更面再动笔**：逐版 `gh release view` 拿发布说明 → `git log` 提交标题定位改动子系统 → 实读 `src/version.js` 定基准。server/ 零改动的版本（如 Build 8/12/20 部分）可整块判定协议/服务器类页不用核对。
2. **数量型断言一律运行时对账**（README 与旧页数字常滞后，不抄旧口径）：
   ```bash
   cd ~/projects/project-mc
   node --input-type=module -e "
   const {en} = await import('./src/i18n/locales/en.js'); console.log('en keys:', Object.keys(en).length);
   const {NAME_I18N} = await import('./src/i18n/names.js'); console.log('names rows:', Object.keys(NAME_I18N).length);
   const {MobTypes} = await import('./src/entity/MobTextures.js'); console.log('mobs:', Object.keys(MobTypes).length);
   "
   ```
   2026-09-16 实跑锚点：**en 407 键 / names 301 行 / 生物 23 种**。方块/物品/结构数同理动态 import Registry 统计。
3. **收尾一致性扫描三件套**（交付前必做）：
   - 全站 grep 旧版本号字符串 `Build`（放行 Changelog 历史条目），Home 徽标与各页"当前版本"同步到 23；
   - grep 旧行为表述残留（重点：JEI"弹窗模式"已被 Build 11 回退、"创造开局预设物品"已被 Build 13 移除、F5 手动保存已改 F6）；
   - 红链检查：grep 所有 `[文本](PageName)` 相对链接，逐一核对 `<PageName>.md` 存在（排除反引号内的语法示例）。
4. **新增主题用「一页双段」**：前半玩家视角，末尾「实现要点（给开发者）」小节，避免为薄主题单开开发者页。
5. **新页同步三处导航**：`Home` 导航表、`_Sidebar` 目录树、`_Plan` 页面规划（总页数计数 + 批次表追加「批次 7 · 版本增量」记录行）。
6. **散页联动点**（批次 1–6 先例）：Controls 键位表、Structures/Blocks/Items 清单、Save-Formats 字段表、FAQ、Known-Pitfalls（按"现象→原因→正确做法"吸收 agent-notes 新增备忘）、Testing-Guide（测试套件表补 build20-fixes / build21-skins / build23-menu-lan 及 nether/overworld/end-structures、endgame-*、whale-barrow 等世界观套件）、每页素材来源行注明新批次出处。

## 6. 交付纪律

- Wiki 仓库内多次小批次 commit（沿用批次 1–6 粒度），最终 commit 标题：**「批次 7 · Alpha Build 8–23 增量更新」**；push 前跑 `preview.sh` 自查。
- `_Plan` 批次表记录行注明素材截止：`alpha-build-23`（commit `e2378c3`）。
- **红线**：禁止臆造参数；核对不了的细节先标 `> TODO(核对源码)`（批次 5 曾有 11 处 TODO 全部回源核对落实，沿用该纪律，勿带着 TODO 收尾）；版本号只信 `gh release` 列表与 `src/version.js`；不改动 `_Footer` 的仓库链接声明。

## 7. 验收口径

- [ ] Changelog 补齐 Build 8–23 十五条，每条玩家视角一句话 + 关键数字；
- [ ] Home 版本徽标 = Build 23，`_Sidebar`/`_Plan` 三处导航一致；
- [ ] 新增 `Worldview` 页上线并被三处导航收录；
- [ ] §5 三件套扫描零残留（旧版本号/旧行为表述/红链）；
- [ ] 所有数量型表述经 §5.2 运行时对账，或标注运行时统计命令；
- [ ] 抽查 5 页以上的参数与 `src/` 源码一致（碑文章节数 9/4/3/2、生物 23 种、语言包 10 包、测试套件清单）。
