// ratelimit.js -- Idea-4C 消息速率限制：lazy-refill 令牌桶（按连接实例化，阈值活读 config）
// 限额单位 = 次数/分钟；limit<=0 视为不限制。桶参数每次 allow() 时现取（getLimit 闭包），
// 管理面板改配置即时生效（tokens 超过新容量自动收敛），无需重建限速器。

export class RateLimiter {
  // getLimit: () => 每分钟次数（>0 启用）
  constructor(getLimit) {
    this.getLimit = getLimit;
    this.tokens = null;   // 惰性初始化：首次 allow() 时按当前限额灌满
    this.last = 0;        // 上次结算时间戳 ms
  }

  // 尝试消耗 1 个令牌；true=放行，false=超限（调用方丢包并计数）
  allow(now = Date.now()) {
    const limit = this.getLimit();
    if (!(limit > 0)) return true; // 0=不限制（含配置缺失兜底）
    if (this.tokens === null) {
      this.tokens = limit;
      this.last = now;
      this.tokens -= 1;
      return true;
    }
    // 按流逝时间补充令牌（limit/60 每秒），封顶为新容量
    const elapsed = Math.max(0, now - this.last);
    if (elapsed > 0) {
      this.tokens = Math.min(limit, this.tokens + (elapsed / 60000) * limit);
      this.last = now;
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

// 消息类型 -> 限速档位（未列出的消息不限速；PING/PONG/HELLO/房间握手天然豁免）
export function tierOf(msgType, MSG) {
  if (msgType === MSG.CHAT) return 'chat';           // 含 '/' 命令（同走 chat 档）
  // B38 L3：组队操作每次都会向全房广播 TEAMS，与聊天共用同一档位
  if (msgType === MSG.TEAM_JOIN || msgType === MSG.TEAM_LEAVE || msgType === MSG.TEAM_LIST) return 'chat';
  if (msgType === MSG.BLOCK_SET) return 'block';
  if (msgType === MSG.BLOCK_SET_BATCH) return 'block'; // B26：批量按 1 条计（不按格数，防流动模拟误伤限速）
  if (msgType === MSG.PLAYER_STATE) return 'state';
  // S6：重操作档位——每条 create/join/switch 都触发一次整账本回放
  if (msgType === MSG.CREATE_ROOM || msgType === MSG.JOIN_ROOM || msgType === MSG.SWITCH_ROOM) return 'join';
  if (msgType === MSG.SKIN_SET) return 'skin';         // 16KB 皮肤数据向全房广播
  if (msgType === MSG.PROFILE_SAVE) return 'profile';  // 整档字段校验（+ 节流落盘）
  // B35 D：遗迹上报/领取（每次解开或领取才发一条，低频；房间内另有 20+10/min 令牌桶把二次关）
  if (msgType === MSG.RUIN_STATE || msgType === MSG.RUIN_CLAIM) return 'ruin';
  return null;
}

// 未进 server/config.js 白名单的档位在这里给代码级兜底值（config 一旦收录同名键即以 config 为准）
const TIER_FALLBACK = { ruin: 120 };

// 按连接创建限速器组（闭包活读 config.rateLimits，热生效）
export function createConnectionLimiters(config) {
  const limits = () => (config && config.rateLimits) || {};
  const tier = (name) => {
    const value = limits()[name];
    return value === undefined ? TIER_FALLBACK[name] : value;
  };
  return {
    chat: new RateLimiter(() => limits().chat),
    block: new RateLimiter(() => limits().block),
    state: new RateLimiter(() => limits().state),
    join: new RateLimiter(() => limits().join),
    skin: new RateLimiter(() => limits().skin),
    profile: new RateLimiter(() => limits().profile),
    ruin: new RateLimiter(() => tier('ruin')),
  };
}
