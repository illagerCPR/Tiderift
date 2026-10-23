// protocol.js -- 局域网联机消息类型常量（纯常量，客户端浏览器与服务器共用）
// 消息统一为 { t: '<type>', ...fields }，JSON over WebSocket

// S11：协议版本号——客户端在 HELLO 里上报，服务端不匹配即 KICKED（提示刷新页面）。
// 任何改变两端消息语义的改动都要递增此常量（纯新增消息类型不必）。
export const PROTOCOL_VERSION = 2;

export const MSG = {
  // 握手与房间
  HELLO: 'hello',
  WELCOME: 'welcome',
  SKIN_SET: 'skin_set',         // Build 21 M2：玩家皮肤上报/下发（C2S 带 data；S2C 带 id）
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  SWITCH_ROOM: 'switch_room',   // 阶段5：世界内直接换房（无需回主菜单）
  WORLD_RESET: 'world_reset',   // 阶段5：重建当前房间世界（仅 host）

  // 维度（M4：联机维度同步；迭代 M2：switch_dimension/dimension_world 携带可选 pos={x,z,portal} 传送门落点）
  SWITCH_DIMENSION: 'switch_dimension',   // C2S {dim, pos?}：请求切换维度（pos=传送门落点，原样回传本人）
  PLAYER_DIMENSION: 'player_dimension',   // S2C {id, dim, name, pos}：玩家维度变更广播
  DIMENSION_WORLD: 'dimension_world',     // S2C {dim, blocks, containers, pos?}：目标维度账本下发（换维者本地世界收敛用）
  WORLD_READY: 'world_ready',             // C2S {recoveryId, dim}：客户端已应用重连世界快照
  WORLD_RESUMED: 'world_resumed',         // S2C {recoveryId, dim}：服务端确认恢复，重新开放联机状态
  ROOM_CREATED: 'room_created',
  WORLD_INFO: 'world_info',
  PLAYER_JOIN: 'player_join',
  PLAYER_LEAVE: 'player_leave',

  // 方块
  BLOCK_SET: 'block_set',
  BLOCK_CHANGE: 'block_change',
  // B26 流体批量：host 权威模拟的连续方块改动 250ms 窗口合并（限速按消息计不按格数）
  BLOCK_SET_BATCH: 'block_set_batch',       // C2S
  BLOCK_CHANGE_BATCH: 'block_change_batch', // S2C

  // 容器（T5：箱子内容整箱同步；服务器账本持久化 + 新加入者回放）
  CONTAINER_SET: 'container_set',

  // 掉落物（阶段 1）；阶段 10：DROP_DENY = 拾取被归属锁拒绝（死亡掉落物归属期内他人拾取）
  DROP_SPAWN: 'drop_spawn',
  DROP_TAKEN: 'drop_taken',
  DROP_DENY: 'drop_deny',

  // 怪物（阶段 2，事件同步：生成/受击/死亡广播）
  MOB_SPAWN: 'mob_spawn',
  MOB_ATTACK: 'mob_attack',
  MOB_DIED: 'mob_died',

  // 红石源状态（阶段 2，低频缓解：lever/button 状态广播）
  REDSTONE_STATE: 'redstone_state',

  // 箭矢（Idea-2B，事件式：只广播初速，各端本地确定性积分；伤害由射端走 mob_attack 权威结算）
  ARROW_SHOT: 'arrow_shot',

  // 凋灵之首（Idea-2D-②，事件式同箭矢：只广播初速；命中本地玩家由各端本地结算）
  WITHER_SKULL: 'wither_skull',

  // 守誓巨像震地（天域批次 C，事件式：只广播震心坐标；伤害/击退由各端本地结算）
  COLOSSUS_SLAM: 'colossus_slam',

  // 天域复潮状态（天域批次 D，服务器权威：随 welcome/WORLD_INFO 下发 + store 落盘）
  AETHER_STATE: 'aether_state',

  // 终局篇 F3 候潮/听潮状态（服务器权威只进不退：随 WORLD_INFO 下发 + store 落盘）
  // offered=true 献证候潮（带祭坛坐标）；done=true 听潮完成（带 startTs 启动四界同潮窗口）
  FINALE_STATE: 'finale_state',

  // 玩家
  PLAYER_STATE: 'player_state',
  PLAYER_FULL: 'player_full',
  ATTACK_PLAYER: 'attack_player',
  PLAYER_DIED: 'player_died',
  RESPAWN: 'respawn',
  GAMEMODE: 'gamemode',

  // 玩家档案（Idea-3C：服务器侧持久化，按 房间+昵称 键；last-write-wins）
  PROFILE_SAVE: 'profile_save',       // C2S {profile}：客户端定期上报（背包/位置/状态）
  PLAYER_PROFILE: 'player_profile',   // S2C {profile}：进房后下发该昵称已有档案（仅发给本人）

  // 房间设置（Idea-4A：{<房间名>: {pvp,mobs}}，缺省全开）
  ROOM_SETTINGS: 'room_settings',     // S2C {room, pvp, mobs}：管理面板改动后向该房间在线玩家热广播

  // 四界游记共享标记（B34-A：房间权威账本；个人标记仅本人可见，分享后才入账并向同房间广播）
  JOURNAL_MARKER: 'journal_marker',               // C2S {dim, x, y, z, label, color}：分享个人标记（服务端清洗+生成本端权威字段）
  JOURNAL_MARKER_ADD: 'journal_marker_add',       // S2C {marker}：入账后广播（含分享者本人，多端一致）
  JOURNAL_MARKER_DELETE: 'journal_marker_delete', // C2S {id}：删除共享标记（仅 owner 或房间 operator）
  JOURNAL_MARKER_REMOVED: 'journal_marker_removed', // S2C {id, by}：删除广播
  JOURNAL_MARKERS: 'journal_markers',             // S2C {markers}：进房/重连全量下发房间共享标记

  // 天域旧航路航标进度（B34-B：房间权威账本，三阶段严格顺序 + 一次性语义）
  WAYMARK_SUBMIT: 'waymark_submit', // C2S {key:'ax,az', stage:1..3}：提交一个阶段
  WAYMARK_UPDATE: 'waymark_update', // S2C {key, stage, byId, byName}：入账后广播（含提交者本人）
  WAYMARK_DENY: 'waymark_deny',     // S2C {key, stage, current, reason}：拒绝并回权威当前阶段（客户端据此不扣材料）
  WAYMARKS: 'waymarks',             // S2C {list:[[key, stage, byName], ...]}：进房/重连全量下发

  // 御风赛道与成绩（B34-C：房间权威账本；赛道定义 + 逐人最佳成绩）
  RACE_SAVE: 'race_save',                   // C2S {id, name, dim, mode, points:[{x,y,z}]}：新建/编辑（服务端分配修订号）
  RACE_DELETE: 'race_delete',               // C2S {id}：删除（创建者或房间 operator）
  RACE_RECORD: 'race_record',               // C2S {id, revision, ms}：上报完赛用时（服务端只留更快的一条）
  RACES: 'races',                           // S2C {tracks:[...], records:[[key, ms, byName], ...]}：进房/重连全量下发
  RACE_UPDATE: 'race_update',               // S2C {track}：赛道新增/编辑后广播（含保存者本人）
  RACE_REMOVED: 'race_removed',             // S2C {id}：赛道删除广播
  RACE_RECORD_UPDATE: 'race_record_update', // S2C {id, revision, byId, byName, ms}：成绩入账广播
  RACE_DENY: 'race_deny',                   // S2C {id, reason}：保存/删除/上报被拒

  // Build 35 E：房间共享蓝图账本（服务器权威校验与修订）
  BLUEPRINT_SAVE: 'blueprint_save',         // C2S {blueprint:{id,name,size,palette,data}}
  BLUEPRINT_DELETE: 'blueprint_delete',     // C2S {id}
  BLUEPRINTS: 'blueprints',                 // S2C {blueprints:[...]}：进房/重连全量下发
  BLUEPRINT_UPDATE: 'blueprint_update',     // S2C {blueprint}：保存/编辑广播（含提交者）
  BLUEPRINT_REMOVED: 'blueprint_removed',   // S2C {id}：删除广播
  BLUEPRINT_DENY: 'blueprint_deny',         // S2C {id, reason}：保存/删除被拒

  // 世界
  SET_TIME: 'set_time',
  TIME: 'time',

  // 聊天与心跳
  CHAT: 'chat',
  PING: 'ping',
  PONG: 'pong',

  // 服务器管理（阶段 4）：踢出玩家（客户端停止自动重连）
  KICKED: 'kicked',
};
