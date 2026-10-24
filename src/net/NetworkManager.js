// NetworkManager.js -- 局域网联机网络层：连接/重连、消息路由、方块/玩家/掉落物/聊天同步
import { MSG, PROTOCOL_VERSION } from '../../server/protocol.js';
import { t } from '../i18n/index.js';
import { RemotePlayer } from '../entity/RemotePlayer.js';
import { loadActiveSkin } from '../entity/PlayerSkin.js';
import { playerColorCss } from './playerColor.js';
import { createNetStats, pushRttSample } from './netStats.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { getDimension } from '../core/dimensions.js';
import { isValidRuinKey } from '../core/Ruins.js';
import { parseServerMessage } from './netMessage.js';

const RECONNECT_MAX = 8; // 断线自动重连最大尝试次数

// B34-C：服务器拒绝原因 → 界面可见文案（键必须存在于语言包）
const RACE_DENY_TEXT = {
  id: '赛道编号非法',
  dim: '赛道维度不匹配',
  owner: '只有创建者或房间管理员可以修改',
  limit: '赛道数量已达上限',
  rate: '操作过于频繁',
  track: '赛道定义不合法',
  revision: '赛道已被编辑，成绩作废',
  time: '成绩不合法',
};

function raceDenyText(reason) {
  return t(RACE_DENY_TEXT[reason] || '未知原因');
}

// B35 D：遗迹上报/领取被拒的原因文案（键必须存在于语言包）
const RUIN_DENY_TEXT = {
  key: '机关位置无法识别',
  dim: '你不在该机关所在的维度',
  rate: '操作过于频繁',
  limit: '本房间的遗迹记录已满',
  locked: '这处机关还没有被解开',
  claimed: '这处机关的纪念奖励已被其他玩家领取',
};

function ruinDenyText(reason) {
  return t(RUIN_DENY_TEXT[reason] || '未知原因');
}

export class NetworkManager {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.selfId = null;
    this.connected = false;
    this.name = '玩家';
    this._handlers = new Map();
    this._stateTimer = 0;
    this._stateInterval = 0.05; // 20Hz 状态上报
    this._applyingRemote = false;
    this._ready = false;          // 世界已就绪（可创建远端玩家/落地方块与掉落物）
    this.isRecovering = false;    // B32：确认维度账本前暂停世界模拟
    this._recoveryId = null;
    this._recoveryDim = null;
    this._recoveryPhase = 'idle';
    this._recoverySeq = 0;
    this._pendingPlayers = [];    // 世界就绪前的玩家加入缓存
    this._pendingSkins = new Map(); // Build 21 M2：世界就绪前的远端皮肤缓存（id → msg）
    this._pendingBlocks = [];     // 世界就绪前的 block_change 缓存（修复首次加入丢包）
    this._pendingContainers = []; // 世界快照应用期间的容器变更
    this._pendingDrops = [];      // 世界就绪前的 drop_* 缓存
    this._pendingMobs = [];       // 世界就绪前的 mob_spawn 缓存
    // B34-A：世界就绪前的房间共享标记缓存（WORLD_INFO 之后才下发，此时本地世界可能正在重建）
    this._pendingJournalMarkers = null; // 全量（null = 未收到）
    // B34-C：赛道与成绩缓存（世界未就绪时先存，onWorldStarted 统一冲掉）
    this._pendingRaces = null;
    this._pendingRaceUpdates = [];
    this._pendingRaceRecords = [];
    this._pendingRaceRemoves = [];
    this._pendingJournalAdds = [];      // 增量分享
    this._pendingJournalRemoves = [];   // 增量删除
    this._pendingBlueprints = null;
    this._pendingBlueprintUpdates = [];
    this._pendingBlueprintRemoves = [];
    // B35 D：遗迹账本缓存（世界未就绪时先存，onWorldStarted 统一冲掉）+ 本端已领取的键
    this._pendingRuins = null;
    this._pendingRuinUpdates = [];
    this._pendingRuinClaims = [];
    this._ruinClaimed = new Set();
    this._pendingOpen = [];       // 连接打开前的待发消息
    this.isHost = false;          // 是否房间 host（host 端负责怪物自然生成）
    this.room = 'default';        // 当前房间名（阶段 3：同名房间共享同一世界）
    // Idea-4A：房间开关（world_info 下发 / room_settings 热广播更新；缺省全开）
    this.roomSettings = { pvp: true, mobs: true };
    this._url = null;             // 服务器地址（重连用）
    this._reconnectAttempt = 0;   // 当前重连尝试次数
    this._reconnectTimer = null;  // 重连定时器
    this._explicitClose = false;  // 主动关闭（returnToMenu）则不自动重连
    // B26 流体批量发送：流体模拟改动 250ms 窗口覆盖式合并（同格只发最新），玩家操作保持单条即时
    this._fluidBatch = new Map();     // posKey -> [x,y,z,id]
    this._fluidBatchTimer = null;
    this.onStatusChange = null;   // (status: 'connected'|'reconnecting'|'closed', text) => void
    // 阶段10：RTT 直测（应用层 ping/pong 计时），供插值自适应与信息栏显示
    // 阶段11：rttMs + rttJitterMs（抖动 EMA）经 netStats 纯函数维护
    this.rttMs = null;            // 平滑后的往返延迟（毫秒，EMA 0.8/0.2）；null=尚未测得
    this.rttJitterMs = null;      // 阶段11：RTT 抖动（相邻样本差绝对值的 EMA）；null=尚未测得
    this._netStats = createNetStats();
    this._pingSeq = 0;
    this._pingTimer = 0;
    this._pingInterval = 2;       // 每 2 秒直测一次 RTT
    // M4 维度同步：本端在服务器侧的当前维度 + 远端玩家维度表（id -> dim）
    this.dim = 'overworld';
    this._remoteDims = new Map();
    // Idea-3C：玩家档案——15s 周期上报；进房下发的档案世界未就绪时先缓存
    this._profileTimer = 15;
    this._pendingProfile = null;
  }

  on(type, fn) { this._handlers.set(type, fn); }
  _emit(type, data) { const fn = this._handlers.get(type); if (fn) fn(data); }

  // 建立连接并发送 hello；name 为昵称（每次新连接重置状态，不触发自动重连）
  connect(url, name) {
    if (this.game) this.game.finaleInfo = null;
    this.name = name || '玩家';
    this._url = url;
    this._reconnectAttempt = 0;
    this._ready = false;
    this.isRecovering = false;
    this._recoveryId = null;
    this._recoveryDim = null;
    this._recoveryPhase = 'idle';
    this._pendingPlayers = [];
    this._pendingSkins = new Map(); // Build 21 M2：新连接重置皮肤缓存
    this._pendingBlocks = [];
    this._pendingContainers = [];
    this._pendingDrops = [];
    this._pendingMobs = [];
    this._pendingOpen = [];
    this.dim = 'overworld';      // 新连接 = 服务器侧新玩家，恒从主世界开始
    this._remoteDims = new Map();
    this._clearBlueprints();
    this._connectSocket(false);
  }

  // 打开 WebSocket 并注册事件；isReconnect=true 时重连成功会自动重新加入房间
  _connectSocket(isReconnect) {
    this._explicitClose = false;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch {} }
    const ws = new WebSocket(this._url);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      if (!isReconnect) this._reconnectAttempt = 0;
      this._send(MSG.HELLO, { name: this.name, version: PROTOCOL_VERSION });
      if (isReconnect) {
        // 重连固定当前维度和位置；账本落地并双向确认后才恢复游戏状态。
        this._recoveryId = `${Date.now().toString(36)}-${(++this._recoverySeq).toString(36)}`;
        this._recoveryDim = this.game.world?.dimension || this.dim || 'overworld';
        this._recoveryPhase = 'joining';
        this._clearPendingWorldMessages();
        const p = this.game.player;
        const resumePos = p && p.position ? {
          x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, pitch: p.pitch,
        } : null;
        this._send(MSG.JOIN_ROOM, { room: this.room, recoveryId: this._recoveryId,
          resumeDim: this._recoveryDim, resumePos });
        if (this.onStatusChange) this.onStatusChange('connected', '已重新连接服务器');
      } else {
        for (const q of this._pendingOpen) this._send(q.type, q.data);
        this._pendingOpen = [];
        if (this.onStatusChange) this.onStatusChange('connected', '已连接服务器');
      }
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      // S13：脏包/空值在 netMessage 单点收口（解析失败 / 非对象 / t 非字符串一律丢弃）
      const m = parseServerMessage(ev.data);
      if (m) this._handle(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // 旧 socket 的关闭事件忽略（已被替换/主动关闭）
      this.connected = false;
      if (this._ready && !this._explicitClose) this._beginRecovery();
      if ((this._ready || this.isRecovering) && !this._explicitClose) this._scheduleReconnect();
      else if (this.onStatusChange) this.onStatusChange('closed', '与服务器断开连接');
    };
    ws.onerror = () => {};
  }

  // 指数退避重连：1s,2s,4s,8s,... 封顶 15s；超过 RECONNECT_MAX 次放弃
  _scheduleReconnect() {
    this._reconnectAttempt++;
    if (this._reconnectAttempt > RECONNECT_MAX) {
      if (this.onStatusChange) this.onStatusChange('closed', '重连失败，请检查服务器');
      return;
    }
    const delay = Math.min(15000, 1000 * Math.pow(2, this._reconnectAttempt - 1));
    if (this.onStatusChange) this.onStatusChange('reconnecting', `连接断开，${delay / 1000}s 后自动重连(${this._reconnectAttempt}/${RECONNECT_MAX})`);
    this._reconnectTimer = setTimeout(() => this._connectSocket(true), delay);
  }

  _clearPendingWorldMessages() {
    this._pendingPlayers = [];
    this._pendingSkins = new Map();
    this._pendingBlocks = [];
    this._pendingContainers = [];
    this._pendingDrops = [];
    this._pendingMobs = [];
    this._pendingProfile = null;
    this._pendingJournalMarkers = null;
    this._pendingJournalAdds = [];
    this._pendingJournalRemoves = [];
    this._clearJournalMarkers(); // B34-A：重连/恢复时旧房间共享标记随缓存一并清空
    this._clearWaymarks(); // B34-B：航标进度缓存同样随连接重置
    this._clearRaces(); // B34-C：赛道/成绩缓存与进行中的计时尝试同样随连接重置
    this._clearBlueprints();
    this._clearRuins(); // B35 D：遗迹账本同样随连接重置
  }

  // B34-A：共享标记三态落到本地游记——世界未就绪时缓存，onWorldStarted 统一冲掉
  // （服务端在 WORLD_INFO 之后才下发，此时 Game.start 可能还在重建本地世界）
  _applyJournalMarkers(markers) {
    if (this._ready && this.game && this.game.journal) this.game.journal.setSharedMarkers(markers);
    else this._pendingJournalMarkers = Array.isArray(markers) ? markers : [];
  }
  _applyJournalAdd(marker) {
    if (this._ready && this.game && this.game.journal) this.game.journal.upsertSharedMarker(marker);
    else this._pendingJournalAdds.push(marker);
  }
  _applyJournalRemove(id) {
    if (this._ready && this.game && this.game.journal) this.game.journal.removeSharedMarker(id);
    else this._pendingJournalRemoves.push(id);
  }

  // B34-A：共享标记跟随房间生命周期——换房/断线/重连/关闭一律清空，防止旧房间标记串味
  _clearJournalMarkers() {
    const journal = this.game && this.game.journal;
    if (journal && typeof journal.setSharedMarkers === 'function') journal.setSharedMarkers([]);
  }

  // B34-B：航标进度两态落到本地账本——世界未就绪时缓存，onWorldStarted 统一冲掉
  // （服务端在 WORLD_INFO 之后才下发，此时 Game.start 可能还在重建本地世界）
  _applyWaymarks(list) {
    const towers = {};
    for (const entry of Array.isArray(list) ? list : []) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      towers[String(entry[0])] = { stage: entry[1], byName: entry[2] };
    }
    if (this._ready && this.game && this.game.waymarks) this.game.waymarks.reset({ towers });
    else this._pendingWaymarks = towers;
  }

  // 阶段入账回执：本人触发的更新才扣材料（服务器可能拒绝后被别人提交，重复扣料是硬伤）
  _applyWaymarkUpdate(msg) {
    const key = typeof msg.key === 'string' ? msg.key : '';
    const parts = key.split(',');
    const ax = Number(parts[0]);
    const az = Number(parts[1]);
    const stage = Number(msg.stage);
    if (!Number.isInteger(ax) || !Number.isInteger(az)) return;
    if (!Number.isInteger(stage) || stage < 1) return;
    const mine = msg.byId === this.selfId;
    if (this._ready && this.game && this.game.waymarks) {
      if (mine) this.game._consumeWaymarkMaterials(stage);
      this.game._applyWaymarkProgress(ax, az, stage, msg.byName || '', mine);
    } else {
      this._pendingWaymarkUpdates.push({ ax, az, stage, byName: msg.byName || '', mine });
    }
  }

  _applyWaymarkDeny(msg) {
    const game = this.game;
    if (!game) return;
    if (game.waymarkScreen) {
      game.waymarkScreen._pending = false;
      if (game.waymarkScreen.visible) game.waymarkScreen.render();
    }
    if (game.chatBox) {
      const current = msg && Number(msg.current) > 0 ? t('{n}/3 阶段', { n: Number(msg.current) }) : t('未开始');
      game.chatBox.add(t('航标提交未通过：当前进度 {s}。', { s: current }), '#fbb');
    }
  }

  // 航标缓存跟随房间生命周期——换房/断线/重连一律清空
  _clearWaymarks() {
    this._pendingWaymarks = null;
    this._pendingWaymarkUpdates = [];
  }

  // B35 D：遗迹账本——服务器权威全量覆盖本地（本地只读展示，不作判据）
  _applyRuins(ruins) {
    const src = (ruins && typeof ruins === 'object' && !Array.isArray(ruins)) ? ruins : {};
    const game = this.game;
    if (this._ready && game && game.ruins) {
      game.ruins.reset({ ruins: src });
      for (const key of this._ruinClaimed) game.ruins.markClaimed(key); // 领取记录是个人本地态，全量覆盖后重放
    } else {
      this._pendingRuins = src;
    }
  }

  // 他人（或本人）解开的入账广播：本地只记账并移出待判定集，不重复开门/发奖
  _applyRuinUpdate(msg) {
    const key = typeof msg.key === 'string' ? msg.key : '';
    if (!isValidRuinKey(key)) return;
    const byName = typeof msg.byName === 'string' ? msg.byName : '';
    const at = Number.isFinite(Number(msg.at)) ? Math.max(0, Math.floor(Number(msg.at))) : 0;
    const game = this.game;
    if (this._ready && game && game.ruins) {
      game.ruins.markSolved(key, byName, at);
      game.ruins.untrack(key);
      if (game._ruinPuzzles) game._ruinPuzzles.delete(key);
    } else {
      this._pendingRuinUpdates.push({ key, byName, at });
    }
  }

  // 领取成功回执（只发给领取者本人）：奖励在这里落地
  _applyRuinClaimed(msg) {
    const key = typeof msg.key === 'string' ? msg.key : '';
    if (!isValidRuinKey(key)) return;
    this._ruinClaimed.add(key);
    const game = this.game;
    if (this._ready && game && game.ruins && typeof game._grantRuinReward === 'function') game._grantRuinReward(key);
    else this._pendingRuinClaims.push(key);
  }

  _applyRuinDeny(msg) {
    const key = msg && typeof msg.key === 'string' ? msg.key : '';
    const reason = msg && msg.reason;
    const game = this.game;
    if (!game) return;
    // 已被别人领走：本地记账但不再发奖（避免每次走到机关都重发一次 claim）
    if (reason === 'claimed' && key && game.ruins) game.ruins.markClaimed(key);
    if (game.chatBox) game.chatBox.add(t('遗迹操作被拒绝：{reason}', { reason: ruinDenyText(reason) }), '#fbb');
  }

  // 遗迹状态跟随房间生命周期——换房/断线/重连一律清空（服务器会重新下发全量）
  _clearRuins() {
    this._pendingRuins = null;
    this._pendingRuinUpdates = [];
    this._pendingRuinClaims = [];
    this._ruinClaimed = new Set();
    if (this.game && this.game.ruins) this.game.ruins.clear();
  }

  // 世界就绪后应用遗迹账本（先全量覆盖，再按到达顺序冲掉增量与领取回执）
  flushPendingRuins() {
    const game = this.game;
    if (!game || !game.ruins) return false;
    const snapshot = this._pendingRuins;
    const updates = this._pendingRuinUpdates.slice();
    const claims = this._pendingRuinClaims.slice();
    this._pendingRuins = null;
    this._pendingRuinUpdates = [];
    this._pendingRuinClaims = [];
    if (snapshot !== null) {
      game.ruins.reset({ ruins: snapshot });
      for (const key of this._ruinClaimed) game.ruins.markClaimed(key);
    }
    for (const u of updates) {
      game.ruins.markSolved(u.key, u.byName, u.at);
      game.ruins.untrack(u.key);
    }
    for (const key of claims) {
      if (typeof game._grantRuinReward === 'function') game._grantRuinReward(key);
    }
    return true;
  }

  // B34-C：赛道定义与成绩两态落到本地账本——世界未就绪时缓存，onWorldStarted 统一冲掉
  _applyRaces(payload) {
    const tracks = Array.isArray(payload && payload.tracks) ? payload.tracks : [];
    const records = Array.isArray(payload && payload.records) ? payload.records : [];
    if (this._ready && this.game && this.game.races) {
      this.game.races.reset({ tracks, records });
    } else {
      this._pendingRaces = { tracks, records };
      this._pendingRaceUpdates = [];
      this._pendingRaceRecords = [];
      this._pendingRaceRemoves = [];
    }
  }

  // 赛道新增/编辑广播（含保存者本人）：本人收到回执才关草稿，避免被拒后界面假装已保存
  _applyRaceUpdate(msg) {
    const track = msg && msg.track;
    if (!track || !track.id) return;
    const mine = track.byId !== undefined && track.byId !== null && String(track.byId) === String(this.selfId);
    if (!(this._ready && this.game && this.game.races)) {
      this._pendingRaceUpdates.push(track);
      return;
    }
    const game = this.game;
    const saved = game.races.applyTrack(track);
    if (!saved) return;
    if (game.raceRun && game.raceRun.track.id === saved.id) game._cancelRace('赛道已编辑');
    if (game.raceScreen) {
      if (mine) game.raceScreen.onTrackSaved(saved, true);
      else if (game.raceScreen.visible) game.raceScreen.render();
    }
    if (!mine && game.chatBox) {
      game.chatBox.add(t('{who}保存了赛道「{name}」。', { who: saved.byName || t('其他玩家'), name: saved.name }), '#8fd0c4');
    }
  }

  _applyRaceRemoved(msg) {
    const id = msg && msg.id;
    if (typeof id !== 'string' || !id) return;
    if (this._ready && this.game && this.game.races) this.game._removeRaceTrack(id);
    else this._pendingRaceRemoves.push(id);
  }

  _applyRaceRecordUpdate(msg) {
    if (!msg || typeof msg.id !== 'string') return;
    const entry = {
      id: msg.id,
      revision: Number(msg.revision) | 0,
      byId: msg.byId === undefined || msg.byId === null ? '' : String(msg.byId),
      byName: typeof msg.byName === 'string' ? msg.byName : '',
      ms: Number(msg.ms) | 0,
    };
    if (this._ready && this.game && this.game.races) this.game._applyRaceRecord(entry);
    else this._pendingRaceRecords.push(entry);
  }

  _applyRaceDeny(msg) {
    const game = this.game;
    if (!game) return;
    if (game.raceScreen) game.raceScreen.onTrackDenied();
    if (game.chatBox) {
      game.chatBox.add(t('赛道操作未通过：{reason}。', { reason: raceDenyText(msg && msg.reason) }), '#fbb');
    }
  }

  // 赛道缓存落地：世界重建期间到达的消息只入缓存，靠这里落盘。
  // 除 onWorldStarted 外，Game.start 在创建完 races 后也会主动调一次——两级兜底，
  // 避免「消息先于世界就绪/世界就绪后才到」两种时序里漏掉任意一侧。
  flushPendingRaces() {
    if (!this._pendingRaces || !this.game || !this.game.races) return false;
    const snapshot = this._pendingRaces;
    this._pendingRaces = null;
    this.game.races.reset(snapshot);
    for (const track of this._pendingRaceUpdates) this.game.races.applyTrack(track);
    this._pendingRaceUpdates = [];
    for (const id of this._pendingRaceRemoves) this.game._removeRaceTrack(id);
    this._pendingRaceRemoves = [];
    for (const rec of this._pendingRaceRecords) this.game._applyRaceRecord(rec);
    this._pendingRaceRecords = [];
    return true;
  }

  // 赛道缓存跟随房间生命周期——换房/断线/重连一律清空；进行中的计时尝试按规则取消
  _clearRaces(reason = '断线') {
    this._pendingRaces = null;
    this._pendingRaceUpdates = [];
    this._pendingRaceRecords = [];
    this._pendingRaceRemoves = [];
    const game = this.game;
    if (game && game.raceRun && typeof game._cancelRace === 'function') game._cancelRace(reason);
  }

  _beginRecovery() {
    this.isRecovering = true;
    this._ready = false;
    this._recoveryId = null;
    this._recoveryDim = null;
    this._recoveryPhase = 'joining';
    this._clearPendingWorldMessages();
    this.clearFluidBatch();
    for (const id of this.game.remotePlayers ? [...this.game.remotePlayers.keys()] : []) this._removeRemote(id);
    this._remoteDims.clear();
  }

  completeWorldRecovery(recoveryId, applied) {
    if (!this.isRecovering || recoveryId !== this._recoveryId || this._recoveryPhase !== 'applying') return false;
    if (!applied || !this.connected || !this.ws || this.ws.readyState !== 1 || !this.game.world ||
        this.game.world.dimension !== this._recoveryDim) {
      this._recoveryPhase = 'failed';
      if (this.ws) { try { this.ws.close(); } catch {} }
      return false;
    }
    this._recoveryPhase = 'awaiting_ack';
    this._send(MSG.WORLD_READY, { recoveryId, dim: this._recoveryDim });
    return true;
  }

  _send(type, data) {
    if (this.isRecovering && ![MSG.HELLO, MSG.JOIN_ROOM, MSG.WORLD_READY, MSG.PONG, MSG.PING, MSG.SWITCH_ROOM, MSG.LEAVE_ROOM, MSG.CHAT].includes(type)) return;
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: type, ...data }));
  }

  // 连接未打开时排队，打开后立即发送（用于 create_room/join_room）
  _sendQueued(type, data) {
    if (this.connected) this._send(type, data);
    else this._pendingOpen.push({ type, data });
  }

  // 世界就绪后调用（Game.start 完成后）：落地缓存的远端玩家/方块/掉落物/怪物
  _applyBlueprints(blueprints) {
    if (this._ready && this.game && this.game.blueprints) {
      this.game.blueprints.resetShared(blueprints);
      this.game.blueprintScreen?.render();
    } else {
      this._pendingBlueprints = Array.isArray(blueprints) ? blueprints : [];
      this._pendingBlueprintUpdates = [];
      this._pendingBlueprintRemoves = [];
    }
  }

  _applyBlueprintUpdate(blueprint) {
    if (!blueprint || typeof blueprint.id !== 'string') return;
    if (this._ready && this.game && this.game.blueprints) {
      const mine = String(blueprint.byId) === String(this.selfId);
      if (mine) this.game.blueprints.removePersonal(blueprint.id);
      if (!this.game.blueprints.applyShared(blueprint)) return;
      if (this.game.blueprintScreen) this.game.blueprintScreen.onSharedSaved(blueprint, mine);
      if (!mine && this.game.chatBox) {
        // byId 是服务器下发的 String(player.id)，而 remotePlayers 以服务器数字 id 为键——两种键都查，
        // 否则 get 恒 miss、聊天提示永远显示兜底名。Number 结果非有限值时不查（NaN 键无意义）。
        const remoteId = Number(blueprint.byId);
        const remote = this.game.remotePlayers.get(blueprint.byId)
          || (Number.isFinite(remoteId) ? this.game.remotePlayers.get(remoteId) : undefined);
        this.game.chatBox.add(t('由 {name} 分享', { name: remote ? remote.name : t('玩家') }), '#8fd0c4');
      }
    } else {
      this._pendingBlueprintUpdates.push(blueprint);
    }
  }

  _applyBlueprintRemoved(id) {
    if (typeof id !== 'string' || !id) return;
    if (this._ready && this.game && this.game.blueprints) {
      this.game.blueprints.removeShared(id);
      if (this.game.blueprintScreen) {
        if (this.game.blueprintScreen.selectedId === id) {
          this.game.blueprintScreen.selectedId = null;
          this.game.ghostPreview?.hide();
        }
        this.game.blueprintScreen.render();
      }
    } else {
      this._pendingBlueprintRemoves.push(id);
    }
  }

  _applyBlueprintDeny(message) {
    const game = this.game;
    if (game && game.blueprintScreen) game.blueprintScreen.onDenied(message && message.reason || 'unknown');
  }

  flushPendingBlueprints() {
    if (!this.game || !this.game.blueprints) return false;
    const snapshot = this._pendingBlueprints;
    const updates = this._pendingBlueprintUpdates.slice();
    const removals = this._pendingBlueprintRemoves.slice();
    if (snapshot === null && !updates.length && !removals.length) return false;
    this._pendingBlueprints = null;
    this._pendingBlueprintUpdates = [];
    this._pendingBlueprintRemoves = [];
    if (snapshot !== null) this.game.blueprints.resetShared(snapshot);
    for (const blueprint of updates) {
      if (!blueprint || typeof blueprint.id !== 'string') continue;
      const mine = String(blueprint.byId) === String(this.selfId);
      if (!this.game.blueprints.applyShared(blueprint)) continue;
      if (this.game.blueprintScreen) this.game.blueprintScreen.onSharedSaved(blueprint, mine);
    }
    for (const id of removals) this._applyBlueprintRemoved(id);
    if (this.game.blueprintScreen && this.game.blueprintScreen.visible) this.game.blueprintScreen.render();
    return true;
  }

  _clearBlueprints() {
    this._pendingBlueprints = null;
    this._pendingBlueprintUpdates = [];
    this._pendingBlueprintRemoves = [];
    const model = this.game && this.game.blueprints;
    if (model) model.resetShared([]);
    if (this.game && this.game.blueprintScreen) {
      this.game.blueprintScreen.selectedId = null;
      this.game.blueprintScreen.pending = false;
      if (this.game.ghostPreview) this.game.ghostPreview.hide();
      if (this.game.blueprintScreen.visible) this.game.blueprintScreen.render();
    }
  }

  onWorldStarted({ preserveProfilePosition = false } = {}) {
    this._ready = true;
    for (const info of this._pendingPlayers) this._addRemote(info);
    this._pendingPlayers = [];
    // Build 21 M2：世界就绪后冲掉缓存的远端皮肤
    for (const msg of this._pendingSkins.values()) this._applySkin(msg);
    this._pendingSkins.clear();
    for (const b of this._pendingBlocks) this.applyRemoteBlock(b.x, b.y, b.z, b.id);
    this._pendingBlocks = [];
    for (const c of this._pendingContainers) this._applyContainer(c);
    this._pendingContainers = [];
    for (const d of this._pendingDrops) {
      if (d.type === 'spawn') this._spawnDrop(d.msg);
      else this._takeDrop(d.msg);
    }
    this._pendingDrops = [];
    for (const m of this._pendingMobs) this._spawnMob(m);
    this._pendingMobs = [];
    // B34-A：世界就绪后应用房间共享标记（先全量覆盖，再按到达顺序冲掉增量与删除）
    if (this._pendingJournalMarkers && this.game.journal) {
      const markers = this._pendingJournalMarkers;
      this._pendingJournalMarkers = null;
      this.game.journal.setSharedMarkers(markers);
      for (const m of this._pendingJournalAdds) this.game.journal.upsertSharedMarker(m);
      this._pendingJournalAdds = [];
      for (const id of this._pendingJournalRemoves) this.game.journal.removeSharedMarker(id);
      this._pendingJournalRemoves = [];
    }
    // B34-B：世界就绪后应用房间航标进度（先全量覆盖，再按到达顺序冲掉增量）
    if (this._pendingWaymarks && this.game.waymarks) {
      const towers = this._pendingWaymarks;
      this._pendingWaymarks = null;
      this.game.waymarks.reset({ towers });
      for (const u of this._pendingWaymarkUpdates) {
        if (u.mine) this.game._consumeWaymarkMaterials(u.stage);
        this.game._applyWaymarkProgress(u.ax, u.az, u.stage, u.byName, u.mine);
      }
      this._pendingWaymarkUpdates = [];
    }
    // B34-C：世界就绪后应用房间赛道与成绩（先全量覆盖，再按到达顺序冲掉增量/成绩/删除）
    this.flushPendingRaces();
    this.flushPendingBlueprints();
    this.flushPendingRuins(); // B35 D
    // Idea-3C：世界就绪后应用进房下发的档案（换机/重连恢复）
    if (this._pendingProfile) {
      const prof = this._pendingProfile;
      this._pendingProfile = null;
      this.applyPlayerProfile(prof, { preservePosition: preserveProfilePosition });
    }
  }

  // Idea-3C：把服务器档案应用到本地（inventory 走 SaveSystem 同款 serialize 格式）。
  // 位置仅在同维度时应用（异维档案的坐标无意义）；死亡掉落等后续流程按 last-write-wins 覆盖。
  applyPlayerProfile(prof, { preservePosition = false } = {}) {
    const g = this.game;
    if (!g.running || !g.player || !g.inventory) return;
    try {
      if (prof.inventory) g.inventory.deserialize(prof.inventory);
      const p = g.player;
      if (typeof prof.health === 'number') p.health = Math.min(20, Math.max(0, prof.health));
      if (typeof prof.food === 'number') p.food = Math.min(20, Math.max(0, prof.food));
      if (typeof prof.saturation === 'number') p.saturation = Math.min(20, Math.max(0, prof.saturation));
      if (typeof prof.xp === 'number') p.xp = Math.max(0, prof.xp);
      if (typeof prof.xpLevel === 'number') p.xpLevel = Math.max(0, prof.xpLevel);
      if (!preservePosition && prof.position && g.world && prof.dim === g.world.dimension) {
        p.position.set(prof.position.x, prof.position.y, prof.position.z);
        p.velocity.set(0, 0, 0);
      }
      if (g.hotbar) g.hotbar.update();
    } catch { /* 档案应用失败不阻断游戏 */ }
  }

  // Idea-3C：采集当前状态为档案（与 SaveSystem 的 inventory.serialize() 同格式）
  buildProfile() {
    const g = this.game;
    if (!g.running || !g.player || !g.inventory || !g.world) return null;
    const p = g.player;
    return {
      inventory: g.inventory.serialize(),
      position: { x: p.position.x, y: p.position.y, z: p.position.z },
      dim: g.world.dimension,
      health: p.health,
      food: p.food,
      saturation: p.saturation,
      xp: p.xp,
      xpLevel: p.xpLevel,
    };
  }

  _addRemote(info) {
    if (info.id === this.selfId) return;
    // M4：异维度玩家不创建实体（记录维度表，等 player_dimension 回同维时再建）
    const knownDim = this._remoteDims.get(info.id);
    if (info.dim || knownDim) {
      const dim = knownDim || info.dim;
      this._remoteDims.set(info.id, dim);
      const own = this.game.world ? this.game.world.dimension : 'overworld';
      if (dim !== own) return;
    }
    if (this.game.remotePlayers.has(info.id)) return;
    const rp = new RemotePlayer(this.game.renderer.scene, info.id, info.name, info.pos, this.game);
    this.game.remotePlayers.set(info.id, rp);
    // 阶段10：joinRoom 回放的 PLAYER_JOIN 携带 selected/heldItem/hotbar（新加入者立即看到在线玩家手持物）
    if (info.health !== undefined || info.hotbar !== undefined || info.heldItem !== undefined) rp.applyFull(info);
  }

  _removeRemote(id) {
    const rp = this.game.remotePlayers.get(id);
    if (rp) { rp.dispose(); this.game.remotePlayers.delete(id); }
  }

  _queueOrAdd(info) {
    if (this._ready) this._addRemote(info);
    else this._pendingPlayers.push(info);
  }

  _spawnDrop(msg) {
    if (!this.game.mobManager) return;
    // 阶段10：透传归属锁（死亡掉落物：ownerLock 毫秒内仅 owner 本人可拾取）
    // Idea-2C：透传 data（潜影盒等内容跟随物品）
    // Build 10：透传可选真实初速（Q 丢弃抛掷；缺省 null → 各端按 id 哈希派生）
    this.game.mobManager.spawnRemoteDrop(msg.id, msg.x, msg.y, msg.z, msg.name, msg.count, msg.owner, msg.ownerLock,
      msg.data ?? null, (msg.vx != null && msg.vy != null && msg.vz != null) ? { x: msg.vx, y: msg.vy, z: msg.vz } : null);
  }

  _takeDrop(msg) {
    if (!this.game.mobManager) return;
    this.game.mobManager.removeDropById(msg.id);
  }

  _applyContainer(msg) {
    if (!this.game.world || !Array.isArray(msg.items) || msg.items.length !== 27) return;
    this.game.world.setContainer(msg.x, msg.y, msg.z, msg.items);
    const cs = this.game.chestScreen;
    if (cs && cs.visible && cs.pos && cs.pos.x === msg.x && cs.pos.y === msg.y && cs.pos.z === msg.z) {
      cs._changed = false;
      cs.refresh(msg.items);
    }
  }

  _spawnMob(msg) {
    if (!this.game.mobManager) return;
    this.game.mobManager.createMobFromNet(msg.id, msg.type, msg.x, msg.y, msg.z, msg.tradeSeed);
  }

  _handle(msg) {
    // S13：入口二次防御——_handle(null / {} / []) 直接返回，不抛异常
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case MSG.WELCOME:
        this.selfId = msg.selfId;
        for (const p of (msg.players || [])) this._queueOrAdd(p);
        this.sendSkin(); // Build 21 M2：进房即上报本地皮肤（异步读 prefs，含默认回退）
        // S11：旧服务端未启用协议版本校验（WELCOME.legacy）时提示一句，不改动连接/重连流程
        if (msg.legacy === true && this.onStatusChange) this.onStatusChange('connected', '服务器未启用协议版本校验');
        break;
      case MSG.WORLD_INFO:
        if (this.isRecovering && !msg.restart &&
            (msg.recoveryId !== this._recoveryId || msg.dim !== this._recoveryDim)) break;
        const nextRoom = msg.room || this.room;
        if (this.room !== nextRoom) { this._clearBlueprints(); this._clearRuins(); }
        this.room = nextRoom;
        // Idea-4A：房间开关随 world_info 下发（首次进入/换房/重连三条路径统一在此更新）
        if (msg.settings && typeof msg.settings === 'object') {
          this.roomSettings = { pvp: msg.settings.pvp !== false, mobs: msg.settings.mobs !== false };
        }
        // 天域批次 D：复潮状态随 world_info 下发（首次进入/换房/重连统一应用）
        if (this.game && typeof this.game.applyAetherDusk === 'function') {
          this.game.applyAetherDusk(!!msg.aetherDusk);
        }
        // 终局篇 F3：候潮/听潮状态随 world_info 下发（WORLD_INFO 可能先于 start 到达——
        // 暂存 game.finaleInfo，Game.start 建 world 后落地，aetherDusk 同款时序）
        if (this.game) {
          this.game.finaleInfo = msg.finale && typeof msg.finale === 'object' ? {
            room: this.room,
            offered: !!msg.finale.offered,
            x: msg.finale.x | 0, y: msg.finale.y | 0, z: msg.finale.z | 0,
            done: !!msg.finale.done,
          } : null;
        }
        if (msg.restart && this.game && this.game.world && this.game.running) {
          // 换房/重建：取消旧恢复态，按新世界消息重启本地世界。
          this.isRecovering = false;
          this._recoveryId = null;
          this._recoveryDim = null;
          this._recoveryPhase = 'idle';
          this.dim = 'overworld';
          this._remoteDims = new Map();
          this._clearPendingWorldMessages();
          this._ready = false;
          this.isHost = (msg.hostId === this.selfId);
          this._emit('restart_world', msg);
        } else if (this.isRecovering) {
          if (msg.recoveryId !== this._recoveryId || msg.dim !== this._recoveryDim) break;
          this._ready = false;
          this._recoveryPhase = 'syncing';
          this.isHost = (msg.hostId === this.selfId);
          if (this.game.sky) this.game.sky.time = msg.time;
          if (msg.mode && this.game.player) this.game.player.setMode(msg.mode);
        } else if (this._ready && this.game && this.game.world && this.game.running) {
          // 兼容同一连接内的普通世界信息刷新；自动重连走带代次的恢复握手。
          this.isHost = (msg.hostId === this.selfId);
          if (this.game.sky) this.game.sky.time = msg.time;
          if (msg.mode && this.game.player) this.game.player.setMode(msg.mode);
          this.onWorldStarted();
          this._emit('system', `已重新连接服务器（房间 ${this.room}）`);
          this.sendPlayerFull();
        } else {
          this.isHost = (msg.hostId === this.selfId);
          this._emit('world_info', msg);   // 首次进入：由 main.js 用该 seed 启动世界
        }
        break;
      case MSG.WORLD_RESUMED:
        if (!this.isRecovering || this._recoveryPhase !== 'awaiting_ack' ||
            msg.recoveryId !== this._recoveryId || msg.dim !== this._recoveryDim ||
            !this.game.world || this.game.world.dimension !== msg.dim) break;
        this.dim = msg.dim;
        this._recoveryId = null;
        this._recoveryDim = null;
        this._recoveryPhase = 'idle';
        this.isRecovering = false;
        this._reconnectAttempt = 0;
        this.onWorldStarted({ preserveProfilePosition: true });
        this._emit('system', `已重新连接服务器（房间 ${this.room}）`);
        if (this.onStatusChange) this.onStatusChange('connected', `已重新连接服务器（房间 ${this.room}）`);
        this.sendPlayerFull();
        this.sendSkin();
        break;
      case MSG.PLAYER_JOIN:
        this._queueOrAdd(msg);
        this._emit('system', { parts: [{ text: msg.name, color: playerColorCss(msg.id) }, { text: ' 加入了游戏' }] });
        break;
      case MSG.SKIN_SET:
        // Build 21 M2：远端玩家皮肤（世界未就绪时缓存，onWorldStarted 冲掉）
        if (msg.id === this.selfId) break;
        if (this._ready) this._applySkin(msg);
        else this._pendingSkins.set(msg.id, msg);
        break;
      case MSG.PLAYER_PROFILE:
        // Idea-3C：进房下发档案——世界已就绪立即应用，否则缓存到 onWorldStarted
        if (msg.profile) {
          if (this._ready) this.applyPlayerProfile(msg.profile);
          else this._pendingProfile = msg.profile;
        }
        break;
      case MSG.ROOM_SETTINGS:
        // Idea-4A：管理面板改动房间开关后热广播（进房期间实时生效，无需重进）
        if (msg.room === this.room) {
          this.roomSettings = { pvp: msg.pvp !== false, mobs: msg.mobs !== false };
        }
        break;
      case MSG.JOURNAL_MARKERS:
        // B34-A：进房/重连全量下发房间共享标记（覆盖本地旧集合，避免多端不一致）
        this._applyJournalMarkers(msg.markers);
        break;
      case 'blueprints':
        this._applyBlueprints(msg.blueprints);
        break;
      case 'blueprint_update':
        this._applyBlueprintUpdate(msg.blueprint);
        break;
      case 'blueprint_removed':
        this._applyBlueprintRemoved(msg.id);
        break;
      case 'blueprint_deny':
        this._applyBlueprintDeny(msg);
        break;
      case MSG.JOURNAL_MARKER_ADD:
        // B34-A：他人（或本人）分享成功后入账广播——本人也收到，保证各端顺序一致
        this._applyJournalAdd(msg.marker);
        break;
      case MSG.JOURNAL_MARKER_REMOVED:
        this._applyJournalRemove(msg.id);
        break;
      case MSG.WAYMARKS:
        // B34-B：进房/重连全量下发航标进度（覆盖本地旧账本，避免多端不一致）
        this._applyWaymarks(msg.list);
        break;
      case MSG.WAYMARK_UPDATE:
        // B34-B：阶段入账广播（含提交者本人，保证各端顺序一致）
        this._applyWaymarkUpdate(msg);
        break;
      case MSG.WAYMARK_DENY:
        this._applyWaymarkDeny(msg);
        break;
      case MSG.RUIN_STATE:
        // B35 D：进房/重连/op 重置全量下发（覆盖本地账本，多端一致）
        this._applyRuins(msg.ruins);
        break;
      case MSG.RUIN_UPDATE:
        // B35 D：解开的入账广播（含提交者本人，各端顺序一致）
        this._applyRuinUpdate(msg);
        break;
      case MSG.RUIN_CLAIMED:
        this._applyRuinClaimed(msg);
        break;
      case MSG.RUIN_DENY:
        this._applyRuinDeny(msg);
        break;
      case MSG.RACES:
        // B34-C：进房/重连全量下发赛道与成绩（覆盖本地旧表，避免多端不一致）
        this._applyRaces(msg);
        break;
      case MSG.RACE_UPDATE:
        // B34-C：赛道新增/编辑广播（含保存者本人，保证各端顺序一致）
        this._applyRaceUpdate(msg);
        break;
      case MSG.RACE_REMOVED:
        this._applyRaceRemoved(msg);
        break;
      case MSG.RACE_RECORD_UPDATE:
        this._applyRaceRecordUpdate(msg);
        break;
      case MSG.RACE_DENY:
        this._applyRaceDeny(msg);
        break;
      case MSG.PLAYER_LEAVE:
        this._remoteDims.delete(msg.id);
        this._removeRemote(msg.id);
        this._pendingPlayers = this._pendingPlayers.filter((p) => p.id !== msg.id);
        this._emit('system', { parts: [{ text: msg.name || '玩家', color: playerColorCss(msg.id) }, { text: ' 离开了游戏' }] });
        break;
      case MSG.BLOCK_CHANGE:
        // M4：异维度的方块变更不落地（服务器已按维度过滤，d 字段是消息在途的二次防线）
        if (msg.d && this.game.world && msg.d !== this.game.world.dimension) break;
        if (this._ready) this.applyRemoteBlock(msg.x, msg.y, msg.z, msg.id);
        else this._pendingBlocks.push(msg);
        break;
      case MSG.BLOCK_CHANGE_BATCH:
        // B26：流体批量广播，逐格走与单条相同的落地/缓存路径
        if (msg.d && this.game.world && msg.d !== this.game.world.dimension) break;
        for (const it of (Array.isArray(msg.list) ? msg.list : [])) {
          if (!Array.isArray(it) || it.length !== 4) continue;
          if (this._ready) this.applyRemoteBlock(it[0], it[1], it[2], it[3]);
          else this._pendingBlocks.push({ x: it[0], y: it[1], z: it[2], id: it[3], d: msg.d });
        }
        break;
      case MSG.DROP_SPAWN:
        if (msg.d && this.game.world && msg.d !== this.game.world.dimension) break;
        if (this._ready) this._spawnDrop(msg);
        else this._pendingDrops.push({ type: 'spawn', msg });
        break;
      case MSG.DROP_TAKEN:
        if (this._ready) this._takeDrop(msg);
        else this._pendingDrops.push({ type: 'take', msg });
        break;
      case MSG.MOB_SPAWN:
        if (msg.d && this.game.world && msg.d !== this.game.world.dimension) break;
        if (this._ready) this._spawnMob(msg);
        else this._pendingMobs.push(msg);
        break;
      case MSG.MOB_ATTACK:
        if (!this.game.mobManager) break;
        this.game.mobManager.applyRemoteMobAttack(msg.id, msg.damage, msg.x, msg.y, msg.z);
        break;
      case MSG.MOB_DIED:
        if (!this.game.mobManager) break;
        this.game.mobManager.applyRemoteMobDeath(msg.id);
        break;
      case MSG.REDSTONE_STATE:
        if (this.game.redstone) this.game.redstone.applyRemoteState(msg.x, msg.y, msg.z, msg.on);
        break;
      case MSG.ARROW_SHOT:
        // Idea-2B：远端玩家射箭——本地生成纯视觉箭（伤害由射端权威走 mob_attack 链结算）
        if (msg.id !== this.selfId && this.game.world) {
          this.game.spawnRemoteArrow(msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz);
        }
        break;
      case MSG.WITHER_SKULL:
        // Idea-2D-②：凋灵之首初速广播——本地生成弹射物（命中本地玩家本地结算，同怪咬人语义）
        // 批次 C：k='gale' = 守誓巨像风弹（同通道透传）
        if (msg.id !== this.selfId && this.game.world) {
          this.game.spawnRemoteWitherSkull(msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz, msg.k);
        }
        break;
      case MSG.COLOSSUS_SLAM:
        // 天域批次 C：守誓巨像震地回执——本地结算（伤害/击退各端自算）
        if (msg.id !== this.selfId && this.game.world) {
          this.game.spawnRemoteColossusSlam(msg.x, msg.y, msg.z);
        }
        break;
      case MSG.AETHER_STATE:
        // 天域批次 D：复潮状态广播（服务器权威单向开关）——全端应用档案覆盖
        if (this.game && typeof this.game.applyAetherDusk === 'function') {
          this.game.applyAetherDusk(!!msg.dusk);
        }
        break;
      case MSG.FINALE_STATE:
        // 终局篇 F3：候潮/听潮状态广播（服务器权威只进不退）
        // offered → 各端置候潮祭坛坐标；done → 各端置完成标记并启动听潮窗口
        //（startTs 由服务器时钟重排——房间权威时钟，各端窗口相位同源）
        if (this.game && this.game.world) {
          if (msg.done) {
            this.game.world.finaleDone = true;
            this.game._startFinaleTide({ ritual: true, startTs: typeof msg.startTs === 'number' ? msg.startTs : Date.now() });
          } else if (msg.offered) {
            this.game.world.finalePrimordial = { x: msg.x | 0, y: msg.y | 0, z: msg.z | 0 };
          }
        }
        break;
      case MSG.CONTAINER_SET: {
        // T5：恢复快照在异步维度链落地前，先缓存后续容器改动，避免快照覆盖新值。
        if (!this.game.world || !Array.isArray(msg.items) || msg.items.length !== 27) break;
        if (msg.d && msg.d !== this.game.world.dimension) break;
        if (this._ready) this._applyContainer(msg);
        else this._pendingContainers.push(msg);
        break;
      }
      case MSG.CONTAINER_DENY: {
        // B36 F-1：漏斗管理中的容器拒绝客户端改写——用服务器权威内容回滚本地（照 drop_deny 的语义）
        if (!this.game.world || !Array.isArray(msg.items) || msg.items.length !== 27) break;
        if (msg.d && msg.d !== this.game.world.dimension) break;
        this._applyContainer(msg);
        break;
      }
      case MSG.PLAYER_DIMENSION: {
        // M4：远端玩家换维——异维移除其实体、同维重建（自己的换维走 dimension_world 路径）
        if (msg.id === this.selfId) break;
        this._remoteDims.set(msg.id, msg.dim);
        const own = this.game.world ? this.game.world.dimension : 'overworld';
        if (msg.dim !== own) {
          this._removeRemote(msg.id);
        } else if (this._ready && this.game.world && !this.game.remotePlayers.has(msg.id)) {
          this._addRemote(msg);
        }
        this._emit('system', { parts: [
          { text: msg.name || '玩家', color: playerColorCss(msg.id) },
          { text: ` 进入了${getDimension(msg.dim)?.name || msg.dim}` },
        ] });
        break;
      }
      case MSG.DIMENSION_WORLD:
        // M4：自己的换维回执（服务器权威账本）→ Game 用它重建本地世界
        if (msg.recoveryId) {
          if (!this.isRecovering || this._recoveryPhase !== 'syncing' ||
              msg.recoveryId !== this._recoveryId || msg.dim !== this._recoveryDim) break;
          this._recoveryPhase = 'applying';
        }
        this.dim = msg.dim;
        this._emit('dimension_world', msg);
        break;
      case MSG.PLAYER_STATE: {
        if (msg.id === this.selfId) break;
        const rp = this.game.remotePlayers.get(msg.id);
        if (rp) rp.applyState(msg);
        break;
      }
      case MSG.PLAYER_FULL: {
        if (msg.id === this.selfId) break;
        const rp = this.game.remotePlayers.get(msg.id);
        if (rp) rp.applyFull(msg);
        break;
      }
      case MSG.ATTACK_PLAYER:
        if (msg.targetId === this.selfId) this._emit('attacked', msg);
        else { const rp = this.game.remotePlayers.get(msg.targetId); if (rp) rp.playHit(); }
        break;
      case MSG.PLAYER_DIED:
        if (msg.id === this.selfId) break;
        { const rp = this.game.remotePlayers.get(msg.id); if (rp) rp.playDeath(); }
        break;
      case MSG.RESPAWN:
        if (msg.id === this.selfId) break;
        { const rp = this.game.remotePlayers.get(msg.id); if (rp) rp.respawn(msg); }
        break;
      case MSG.GAMEMODE:
        if (msg.id === this.selfId) break;
        { const rp = this.game.remotePlayers.get(msg.id); if (rp) rp.setMode(msg.mode); }
        break;
      case MSG.TIME:
        this._emit('time', msg.time);
        break;
      case MSG.CHAT:
        this._emit('chat', msg);
        break;
      case MSG.PING:
        this._send(MSG.PONG, { seq: msg.seq });   // 回应服务器心跳，防踢出（不带 ts，与 RTT 直测区分）
        break;
      case MSG.PONG:
        // 阶段10：自己发起的 RTT 直测回包（服务器回显 ts）——与心跳 PONG（无 ts）区分
        // 阶段11：RTT 与抖动统一经 netStats 更新（非法样本内部忽略）
        if (typeof msg.ts === 'number' && msg.ts > 0) {
          const rtt = performance.now() - msg.ts;
          pushRttSample(this._netStats, rtt);
          this.rttMs = this._netStats.rttMs;
          this.rttJitterMs = this._netStats.rttJitterMs;
        }
        break;
      case MSG.DROP_DENY:
        // 阶段10：拾取被归属锁拒绝（死亡掉落物锁定期内他人拾取）——交给 Game 回滚本地拾取
        this._emit('drop_deny', msg);
        break;
      case MSG.KICKED:
        // 服务器管理面板踢出：停止自动重连并断开
        this._explicitClose = true;
        if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
        if (this.ws) { try { this.ws.close(); } catch {} }
        this.connected = false;
        if (this.onStatusChange) this.onStatusChange('closed', msg.reason || '已被服务器移出');
        break;
      default: break;
    }
  }

  // 远端方块落地：重建网格/红石但不回环上报
  applyRemoteBlock(x, y, z, id) {
    const world = this.game.world;
    if (!world) return;
    // T5：远端挖掉箱子 → 清本地容器缓存，开着的界面一并关闭（内容散落由挖掘方上报）
    const oldDef = BlockRegistry.getById(world.getBlock(x, y, z));
    const wasChest = oldDef && oldDef.baseBlock === 'chest'; // B28：箱子四朝向家族（朝北本名也带 baseBlock）
    this._applyingRemote = true;
    try {
      world.setBlock(x, y, z, id); // 远端修改也写入本地账本，区块重载后仍可恢复
      if (this.game.redstone) this.game.redstone.onBlockChange(x, y, z);
    } finally {
      this._applyingRemote = false; // 即使方块/红石回调抛错也恢复防回环状态
    }
    if (wasChest) {
      world.removeContainer(x, y, z);
      const cs = this.game.chestScreen;
      if (cs && cs.visible && cs.pos && cs.pos.x === x && cs.pos.y === y && cs.pos.z === z) {
        cs._changed = false;
        cs.hide();
      }
    }
  }

  // 绑定世界：World.setBlock 钩子统一上报（挖掘/放置/爆炸/活塞都走这一入口，含防回环）
  bindWorld(world) {
    world.onLocalBlockChange = (x, y, z, id) => {
      if (this._applyingRemote) return; // 远端落地不回环
      // B26：流体模拟产生的改动走批量合并通道；玩家操作保持单条即时
      if (world.fluidSim && world.fluidSim.writing) { this.queueFluidBlock(x, y, z, id); return; }
      this.sendBlock(x, y, z, id);
    };
  }

  // B26：流体改动入合并队列（覆盖式：同格保留最新 id）
  queueFluidBlock(x, y, z, id) {
    this._fluidBatch.set(`${x},${y},${z}`, [x, y, z, id]);
    if (!this._fluidBatchTimer) {
      this._fluidBatchTimer = setTimeout(() => {
        this._fluidBatchTimer = null;
        this.flushFluidBatch();
      }, 250);
    }
  }

  flushFluidBatch() {
    if (!this._fluidBatch.size) return;
    const list = [...this._fluidBatch.values()];
    this._fluidBatch.clear();
    this._send(MSG.BLOCK_SET_BATCH, { list });
  }

  clearFluidBatch() {
    this._fluidBatch.clear();
    if (this._fluidBatchTimer) { clearTimeout(this._fluidBatchTimer); this._fluidBatchTimer = null; }
  }

  // 本地发起方块修改（挖掘/放置/爆炸后调用）
  sendBlock(x, y, z, id) { this._send(MSG.BLOCK_SET, { x, y, z, id }); }

  // 本地发起掉落物生成（联机挖矿等）；实体由服务器广播 drop_spawn 回执后创建
  // Idea-2C：data = 潜影盒等内容跟随物品（普通掉落 null）
  // Build 10：vel = THREE.Vector3 可选初速（Q 丢弃抛掷），缺省各端按 id 哈希派生
  sendDropSpawn(x, y, z, name, count, data = null, vel = null) {
    const payload = { x, y, z, name, count };
    if (data) payload.data = data;
    if (vel && Number.isFinite(vel.x) && Number.isFinite(vel.y) && Number.isFinite(vel.z)) {
      payload.vx = vel.x; payload.vy = vel.y; payload.vz = vel.z;
    }
    this._send(MSG.DROP_SPAWN, payload);
  }
  // 本地拾取掉落物，通知服务器移除并广播
  sendDropTaken(id) { this._send(MSG.DROP_TAKEN, { id }); }

  // 联机怪物事件（host 生成 / 玩家攻击 / 怪物死亡）；tradeSeed：T5 村民交易表种子（服务器原样透传）
  sendMobSpawn(type, x, y, z, tradeSeed) {
    // Idea-4A：怪物生成关闭时在发送口短路——host 实体由 mob_spawn 回执创建，
    // 闸在这里即本端与各端一致不生成（无漂移）；村民/铁傀儡/潜影贝等所有生成路径共用此出口
    if (this.roomSettings && this.roomSettings.mobs === false) return;
    const data = { type, x, y, z };
    if (typeof tradeSeed === 'number') data.tradeSeed = tradeSeed >>> 0;
    this._send(MSG.MOB_SPAWN, data);
  }
  sendMobAttack(id, damage, x, y, z) { this._send(MSG.MOB_ATTACK, { id, damage, x, y, z }); }
  sendMobDied(id) { this._send(MSG.MOB_DIED, { id }); }

  // Idea-2B：箭矢初速上报（事件式，服务器转发给同维度其他玩家）
  sendArrowShot(pos, vel) {
    this._send(MSG.ARROW_SHOT, { x: pos.x, y: pos.y, z: pos.z, dx: vel.x, dy: vel.y, dz: vel.z });
  }

  // Idea-2D-②：凋灵之首初速上报（同箭矢事件式——各端本地积分，命中本地玩家本地结算）
  // 批次 C：kind='gale' = 守誓巨像风弹（同通道，k 字段透传）
  sendWitherSkull(pos, dir, kind) {
    const payload = { x: pos.x, y: pos.y, z: pos.z, dx: dir.x, dy: dir.y, dz: dir.z };
    if (kind === 'gale') payload.k = 'gale';
    this._send(MSG.WITHER_SKULL, payload);
  }

  // 天域批次 C：守誓巨像震地上报（事件式——各端本地结算自己）
  sendColossusSlam(pos) {
    this._send(MSG.COLOSSUS_SLAM, { x: pos.x, y: pos.y, z: pos.z });
  }

  // 天域批次 D：复潮状态上报（服务器权威单向开关——广播全房间 + 落盘）
  sendAetherState(dusk) {
    this._send(MSG.AETHER_STATE, { dusk: !!dusk });
  }

  // 终局篇 F3：候潮/听潮状态上报（服务器权威只进不退——广播全房间 + 落盘）
  // offered=true 献证候潮（带祭坛坐标）；done=true 听潮完成（startTs 由服务器重排）
  sendFinaleState(payload) {
    this._send(MSG.FINALE_STATE, {
      offered: payload.offered === true,
      done: payload.done === true,
      x: payload.x | 0, y: payload.y | 0, z: payload.z | 0,
    });
  }

  // 红石源状态（lever/button），低频广播让各端 poweredBlocks 对齐
  sendRedstoneState(x, y, z, on) { this._send(MSG.REDSTONE_STATE, { x, y, z, on }); }

  // T5：容器整箱上报（箱子内容改动；服务器记账本 + 广播其他端）
  sendContainerSet(x, y, z, items) {
    // Idea-2C：容器物品带 data（潜影盒内容跟随）
    const packed = items.map((s) => (s ? { name: s.name, count: s.count, data: s.data ?? null } : null));
    this._send(MSG.CONTAINER_SET, { x, y, z, items: packed });
  }

  // 每帧调用：节流上报本地玩家状态 + RTT 直测
  update(dt) {
    if (!this.connected || !this.game.world || this.isRecovering) return;
    // Idea-3C：15s 周期档案上报（观战/死亡期间也发——死亡掉落流程随后覆盖，last-write-wins）
    this._profileTimer -= dt;
    if (this._profileTimer <= 0) {
      this._profileTimer = 15;
      const prof = this.buildProfile();
      if (prof) this._send(MSG.PROFILE_SAVE, { profile: prof });
    }
    if (this.game.spectating) return; // 观战中不上报位置（避免观战者被吸附到目标处广播出去）
    // 阶段10：RTT 直测——发 ping（带本地时间戳），服务器回显 ts，PONG 分支计算平滑 RTT
    this._pingTimer -= dt;
    if (this._pingTimer <= 0) {
      this._pingTimer = this._pingInterval;
      this._send(MSG.PING, { seq: ++this._pingSeq, ts: performance.now() });
    }
    this._stateTimer -= dt;
    if (this._stateTimer > 0) return;
    this._stateTimer = this._stateInterval;
    const p = this.game.player;
    // 阶段6：上报手持物品（当前快捷栏槽位 + 物品名），服务器随 player_state 广播，远端渲染手持物
    const sel = this.game.inventory.getSelected();
    this._send(MSG.PLAYER_STATE, {
      x: p.position.x, y: p.position.y, z: p.position.z,
      yaw: p.yaw, pitch: p.pitch,
      onGround: p.onGround, flying: p.flying, inWater: p.inWater,
      selected: this.game.inventory.hotbarSelected,
      held: sel ? sel.name : null,
      mine: this.game._miningActive ? 1 : 0, // 阶段11：挖掘中标志（远端播放挥臂）
    });
  }

  sendPlayerFull() {
    if (!this._ready || this.isRecovering) return;
    const p = this.game.player;
    const sel = this.game.inventory.getSelected();
    // 阶段10：上报完整快捷栏（9 槽快照），服务器记录并在 joinRoom 回放给新加入者
    const hotbar = this.game.inventory.slots.slice(0, 9).map((s) => (s ? { name: s.name, count: s.count } : null));
    this._send(MSG.PLAYER_FULL, {
      health: p.health, food: p.food, saturation: p.saturation,
      mode: p.gamemode, selected: this.game.inventory.hotbarSelected,
      held: sel ? sel.name : null,
      hotbar,
    });
  }

  // Build 21 M2：上报本地皮肤（异步读 prefs——上传/默认都归一为 64×64 dataURL 后发送）。
  // SkinScreen 保存设置后也会调用（联机时实时广播新皮肤）。
  async sendSkin() {
    if (!this._ready && !this.selfId) return;
    try {
      const { img, model } = await loadActiveSkin();
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 64;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      this._send(MSG.SKIN_SET, { data: cv.toDataURL('image/png'), model });
    } catch (e) { /* 皮肤不可用时不发送（远端显示纯色兜底） */ }
  }

  // Build 21 M2：应用远端玩家皮肤（dataURL 无 CORS 问题）
  _applySkin(msg) {
    const rp = this.game.remotePlayers && this.game.remotePlayers.get(msg.id);
    if (rp && rp.applySkinFromURL) rp.applySkinFromURL(msg.data, msg.model);
  }

  sendAttackPlayer(targetId, damage) { this._send(MSG.ATTACK_PLAYER, { targetId, damage }); }
  sendPlayerDied() {
    // 阶段6：死亡上报死亡位置 + 背包内容（服务器据此生成世界掉落物并广播）；P1 起含盔甲
    const p = this.game.player;
    const drops = [];
    for (const s of this.game.inventory.slots) {
      if (s) drops.push({ name: s.name, count: s.count, data: s.data ?? null });
    }
    for (const s of this.game.inventory.armor) {
      if (s) drops.push({ name: s.name, count: s.count, data: s.data ?? null });
    }
    this._send(MSG.PLAYER_DIED, { x: p.position.x, y: p.position.y, z: p.position.z, drops });
  }
  sendRespawn(x, y, z) { this._send(MSG.RESPAWN, { x, y, z }); }
  sendGamemode(mode) { this._send(MSG.GAMEMODE, { mode }); }
  sendSetTime(t) { this._send(MSG.SET_TIME, { time: t }); }
  sendChat(text) { this._send(MSG.CHAT, { text }); }

  // B34-A：四界游记共享标记——个人标记只在玩家明确点「分享」时才上报；
  // 服务端清洗、生成权威 id 与归属后再广播（本端不本地预置，等回执保持一致）。
  // 未连接/世界未就绪/参数非法一律返回 false，调用方据此不把按钮置为「已分享」。
  sendJournalMarker(marker) {
    if (!this.connected || !this._ready || !marker || typeof marker !== 'object') return false;
    const { dim, x, y, z, label, color } = marker;
    if (typeof dim !== 'string' || typeof label !== 'string' || !label) return false;
    if (![x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
    const payload = { dim, x, y, z, label };
    if (typeof color === 'string') payload.color = color;
    this._send(MSG.JOURNAL_MARKER, payload);
    return true;
  }
  // 只允许删除本人标记；能不能删由服务端按 owner/operator 判定，越权静默忽略
  sendJournalMarkerDelete(id) {
    if (!this.connected || typeof id !== 'string' || !id) return;
    this._send(MSG.JOURNAL_MARKER_DELETE, { id });
  }
  // B34-B：航标阶段提交。未连接/未就绪/参数非法一律返回 false，调用方据此不进入待回执态。
  // 材料不在这里扣——等服务器 WAYMARK_UPDATE 回执且 byId 是自己时才扣，避免被拒后白扣。
  sendWaymarkSubmit(ax, az, stage) {
    if (!this.connected || !this._ready) return false;
    if (!Number.isInteger(ax) || !Number.isInteger(az)) return false;
    if (!Number.isInteger(stage) || stage < 1) return false;
    this._send(MSG.WAYMARK_SUBMIT, { key: `${ax},${az}`, stage });
    return true;
  }
  // B34-C：赛道保存/删除/成绩上报。未连接或未就绪一律返回 false，调用方据此不进入待回执态。
  sendRaceSave(track) {
    if (!this.connected || !this._ready || !track || typeof track !== 'object') return false;
    if (typeof track.id !== 'string' || !track.id) return false;
    if (!Array.isArray(track.points) || track.points.length < 3) return false;
    this._send(MSG.RACE_SAVE, {
      id: track.id,
      name: track.name,
      dim: track.dim,
      mode: track.mode,
      points: track.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    });
    return true;
  }
  sendRaceDelete(id) {
    if (!this.connected || !this._ready || typeof id !== 'string' || !id) return false;
    this._send(MSG.RACE_DELETE, { id });
    return true;
  }
  // B35 D：遗迹上报解开 / 领取纪念奖励。未连接、未就绪或键非法一律返回 false。
  sendRuinState(key) {
    if (!this.connected || !this._ready || !isValidRuinKey(key)) return false;
    this._send(MSG.RUIN_STATE, { key });
    return true;
  }
  sendRuinClaim(key) {
    if (!this.connected || !this._ready || !isValidRuinKey(key)) return false;
    this._send(MSG.RUIN_CLAIM, { key });
    return true;
  }
  sendBlueprintSave(blueprint) {
    if (!this.connected || !this._ready || !blueprint || typeof blueprint !== 'object') return false;
    const { id, name, size, palette, data } = blueprint;
    this._send('blueprint_save', { blueprint: { id, name, size, palette, data } });
    return true;
  }
  sendBlueprintDelete(id) {
    if (!this.connected || !this._ready || typeof id !== 'string' || !id) return false;
    this._send('blueprint_delete', { id });
    return true;
  }
  sendRaceRecord(id, revision, ms) {
    if (!this.connected || !this._ready) return false;
    if (typeof id !== 'string' || !id) return false;
    if (!Number.isInteger(revision) || !Number.isInteger(ms)) return false;
    this._send(MSG.RACE_RECORD, { id, revision, ms });
    return true;
  }

  createRoom(seed, mode, room, biomeScale) { this._sendQueued(MSG.CREATE_ROOM, { seed, mode, room, biomeScale }); }
  joinRoom(room) { this._sendQueued(MSG.JOIN_ROOM, { room }); }

  // 阶段5：世界内换房 / 重建世界（保持连接，服务器回 WORLD_INFO(restart) 后重启本地世界）
  sendSwitchRoom(room) {
    this._clearJournalMarkers(); // B34-A：换房后旧房间的共享标记不再展示
    this._clearWaymarks(); // B34-B：换房后旧房间的航标进度不再展示
    this._clearRaces('换房'); // B34-C：换房后旧房间的赛道不再展示，进行中的计时作废
    this._clearBlueprints();
    this._clearRuins(); // B35 D：换房后旧房间的遗迹账本不再展示
    this._send(MSG.SWITCH_ROOM, { room });
  }
  sendWorldReset() { this._send(MSG.WORLD_RESET, {}); }

  // M4：维度切换请求（服务器回 player_dimension 广播 + dimension_world 账本，客户端据此重建本地世界）
  // 迭代 M2：pos 为传送门落点 {x,z,portal}（服务器原样回传给本人，applyDimensionWorld 用它吸附/建返程门）
  sendSwitchDimension(dim, pos = null) { this._send(MSG.SWITCH_DIMENSION, { dim, pos: pos || null }); }

  close() {
    if (this.game) this.game.finaleInfo = null;
    this._clearJournalMarkers(); // B34-A：断开后不保留任何房间标记
    this._clearWaymarks(); // B34-B：断开后不保留航标进度缓存
    this._clearRaces('断线'); // B34-C：断开后不保留赛道缓存，进行中的计时作废
    this._clearBlueprints();
    this._clearRuins(); // B35 D：断开后不保留遗迹账本缓存
    this._explicitClose = true; // 主动关闭：不触发自动重连
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this.clearFluidBatch(); // B26：断开时丢弃未发流体批量（连接已失效，重连后由 host 全量收敛）
    this.isRecovering = false;
    this._recoveryId = null;
    this._recoveryDim = null;
    this._recoveryPhase = 'idle';
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.connected = false;
  }
}
