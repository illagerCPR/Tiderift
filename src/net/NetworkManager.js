// NetworkManager.js -- 局域网联机网络层：连接/重连、消息路由、方块/玩家/掉落物/聊天同步
import { MSG } from '../../server/protocol.js';
import { RemotePlayer } from '../entity/RemotePlayer.js';
import { loadActiveSkin } from '../entity/PlayerSkin.js';
import { playerColorCss } from './playerColor.js';
import { createNetStats, pushRttSample } from './netStats.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { getDimension } from '../core/dimensions.js';

const RECONNECT_MAX = 8; // 断线自动重连最大尝试次数

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
    this._pendingPlayers = [];    // 世界就绪前的玩家加入缓存
    this._pendingSkins = new Map(); // Build 21 M2：世界就绪前的远端皮肤缓存（id → msg）
    this._pendingBlocks = [];     // 世界就绪前的 block_change 缓存（修复首次加入丢包）
    this._pendingDrops = [];      // 世界就绪前的 drop_* 缓存
    this._pendingMobs = [];       // 世界就绪前的 mob_spawn 缓存
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
    this.name = name || '玩家';
    this._url = url;
    this._reconnectAttempt = 0;
    this._ready = false;
    this._pendingPlayers = [];
    this._pendingSkins = new Map(); // Build 21 M2：新连接重置皮肤缓存
    this._pendingBlocks = [];
    this._pendingDrops = [];
    this._pendingMobs = [];
    this._pendingOpen = [];
    this.dim = 'overworld';      // 新连接 = 服务器侧新玩家，恒从主世界开始
    this._remoteDims = new Map();
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
      this._reconnectAttempt = 0; // 连接成功，重连计数清零
      this._send(MSG.HELLO, { name: this.name, version: '0.1' });
      if (isReconnect) {
        // 重连：世界已在运行，不重启，直接重新加入房间（服务器回放方块/掉落物账本）
        // 必须携带 room 名——曾发空 payload 落到 default 房（房间静默漂移，村民/方块全对不上）
        this._pendingPlayers = [];
        this._send(MSG.JOIN_ROOM, { room: this.room });
        if (this.onStatusChange) this.onStatusChange('connected', '已重新连接服务器');
      } else {
        for (const q of this._pendingOpen) this._send(q.type, q.data);
        this._pendingOpen = [];
        if (this.onStatusChange) this.onStatusChange('connected', '已连接服务器');
      }
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      this._handle(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // 旧 socket 的关闭事件忽略（已被替换/主动关闭）
      this.connected = false;
      if (this._ready && !this._explicitClose) this._scheduleReconnect();
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

  _send(type, data) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: type, ...data }));
  }

  // 连接未打开时排队，打开后立即发送（用于 create_room/join_room）
  _sendQueued(type, data) {
    if (this.connected) this._send(type, data);
    else this._pendingOpen.push({ type, data });
  }

  // 世界就绪后调用（Game.start 完成后）：落地缓存的远端玩家/方块/掉落物/怪物
  onWorldStarted() {
    this._ready = true;
    for (const info of this._pendingPlayers) this._addRemote(info);
    this._pendingPlayers = [];
    // Build 21 M2：世界就绪后冲掉缓存的远端皮肤
    for (const msg of this._pendingSkins.values()) this._applySkin(msg);
    this._pendingSkins.clear();
    for (const b of this._pendingBlocks) this.applyRemoteBlock(b.x, b.y, b.z, b.id);
    this._pendingBlocks = [];
    for (const d of this._pendingDrops) {
      if (d.type === 'spawn') this._spawnDrop(d.msg);
      else this._takeDrop(d.msg);
    }
    this._pendingDrops = [];
    for (const m of this._pendingMobs) this._spawnMob(m);
    this._pendingMobs = [];
    // Idea-3C：世界就绪后应用进房下发的档案（换机/重连恢复）
    if (this._pendingProfile) {
      const prof = this._pendingProfile;
      this._pendingProfile = null;
      this.applyPlayerProfile(prof);
    }
  }

  // Idea-3C：把服务器档案应用到本地（inventory 走 SaveSystem 同款 serialize 格式）。
  // 位置仅在同维度时应用（异维档案的坐标无意义）；死亡掉落等后续流程按 last-write-wins 覆盖。
  applyPlayerProfile(prof) {
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
      if (prof.position && g.world && prof.dim === g.world.dimension) {
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
    if (info.dim) {
      this._remoteDims.set(info.id, info.dim);
      const own = this.game.world ? this.game.world.dimension : 'overworld';
      if (info.dim !== own) return;
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

  _spawnMob(msg) {
    if (!this.game.mobManager) return;
    this.game.mobManager.createMobFromNet(msg.id, msg.type, msg.x, msg.y, msg.z, msg.tradeSeed);
  }

  _handle(msg) {
    switch (msg.t) {
      case MSG.WELCOME:
        this.selfId = msg.selfId;
        for (const p of (msg.players || [])) this._queueOrAdd(p);
        this.sendSkin(); // Build 21 M2：进房即上报本地皮肤（异步读 prefs，含默认回退）
        break;
      case MSG.WORLD_INFO:
        this.room = msg.room || this.room;
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
        if (this.game && msg.finale) {
          this.game.finaleInfo = {
            offered: !!msg.finale.offered,
            x: msg.finale.x | 0, y: msg.finale.y | 0, z: msg.finale.z | 0,
            done: !!msg.finale.done,
          };
        }
        if (this._ready && this.game && this.game.world && this.game.running) {
          if (msg.restart) {
            // 阶段5：世界内换房 / 重建世界 —— 重启本地世界（保持连接），期间缓存远端数据
            // M4：换房/重建 = 新世界，维度状态复位（恒回主世界）
            this.dim = 'overworld';
            this._remoteDims = new Map();
            this._ready = false;
            this.isHost = (msg.hostId === this.selfId);
            this._emit('restart_world', msg);
          } else {
            // 断线重连成功：世界已在运行，不重启，仅同步时间/模式并刷新远端玩家
            this.isHost = (msg.hostId === this.selfId);
            if (this.game.sky) this.game.sky.time = msg.time;
            if (msg.mode && this.game.player) this.game.player.setMode(msg.mode);
            this.onWorldStarted();
            this._emit('system', `已重新连接服务器（房间 ${this.room}）`);
            this.sendPlayerFull();
          }
        } else {
          this.isHost = (msg.hostId === this.selfId);
          this._emit('world_info', msg);   // 首次进入：由 main.js 用该 seed 启动世界
        }
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
      case MSG.PLAYER_LEAVE:
        this._remoteDims.delete(msg.id);
        this._removeRemote(msg.id);
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
        // T5：他人修改箱子 → 覆盖本地容器缓存，开着的同箱界面刷新（M4：异维度忽略）
        if (!this.game.world || !Array.isArray(msg.items) || msg.items.length !== 27) break;
        if (msg.d && msg.d !== this.game.world.dimension) break;
        this.game.world.setContainer(msg.x, msg.y, msg.z, msg.items);
        const cs = this.game.chestScreen;
        if (cs && cs.visible && cs.pos && cs.pos.x === msg.x && cs.pos.y === msg.y && cs.pos.z === msg.z) {
          cs._changed = false; // 已收敛到远端状态，hide 不回发
          cs.refresh(msg.items);
        }
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
    world.setBlock(x, y, z, id, false); // 远端落地：不写入本地 modifiedBlocks
    if (this.game.redstone) this.game.redstone.onBlockChange(x, y, z);
    this._applyingRemote = false;
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
    if (!this.connected || !this.game.world) return;
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
  createRoom(seed, mode, room, biomeScale) { this._sendQueued(MSG.CREATE_ROOM, { seed, mode, room, biomeScale }); }
  joinRoom(room) { this._sendQueued(MSG.JOIN_ROOM, { room }); }

  // 阶段5：世界内换房 / 重建世界（保持连接，服务器回 WORLD_INFO(restart) 后重启本地世界）
  sendSwitchRoom(room) { this._send(MSG.SWITCH_ROOM, { room }); }
  sendWorldReset() { this._send(MSG.WORLD_RESET, {}); }

  // M4：维度切换请求（服务器回 player_dimension 广播 + dimension_world 账本，客户端据此重建本地世界）
  // 迭代 M2：pos 为传送门落点 {x,z,portal}（服务器原样回传给本人，applyDimensionWorld 用它吸附/建返程门）
  sendSwitchDimension(dim, pos = null) { this._send(MSG.SWITCH_DIMENSION, { dim, pos: pos || null }); }

  close() {
    this._explicitClose = true; // 主动关闭：不触发自动重连
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this.clearFluidBatch(); // B26：断开时丢弃未发流体批量（连接已失效，重连后由 host 全量收敛）
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.connected = false;
  }
}
