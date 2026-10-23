// RaceRun.js -- 御风竞速的计时与顺序检查点判定（纯模块：时钟由调用方注入单调毫秒，可 node 直测）
//
// 状态机：armed（已报名待出发）→ running（已过起点）→ finished / cancelled。
// 判定用「上一帧位置 → 本帧位置」的线段到点位距离，而不是单帧点距：
// 高速滑翔与掉帧时单帧位移可达数格，逐帧点距会漏判；线段判定保证穿过即触发。

export const RACE_TRIGGER_RADIUS = 7;      // 触发半径（格）：穿门判定用的球半径
export const RACE_ARM_TIMEOUT_MS = 300000; // 待出发超时 5 分钟：避免报名后忘记而残留计时态

// 点到线段距离（线段 ab，点 p）
export function pointSegmentDistance(px, py, pz, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (len2 > 1e-9) {
    t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  const cz = az + dz * t;
  const ex = px - cx;
  const ey = py - cy;
  const ez = pz - cz;
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}

export class RaceRun {
  // track：sanitizeTrack 之后的赛道；opts：{ now, pos, assisted }
  constructor(track, opts = {}) {
    this.track = track;
    this.revision = track.revision | 0;
    this.assisted = !!opts.assisted; // 创造/旁观等非御风方式：照常计时但不入最佳成绩
    this.state = 'armed';
    this.reason = '';
    this.nextIndex = 1;      // 起点通过后指向第一个检查点
    this.startedAt = 0;
    this.elapsedMs = 0;
    this.armedAt = Number.isFinite(opts.now) ? opts.now : 0;
    this.prev = opts.pos ? { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z } : null;
    this.checkpointTotal = Math.max(1, track.points.length - 2);
    this.lastIndex = track.points.length - 1;
  }

  get checkpointsPassed() {
    return Math.min(this.checkpointTotal, Math.max(0, this.nextIndex - 1));
  }

  get finished() { return this.state === 'finished'; }
  get cancelled() { return this.state === 'cancelled'; }
  get active() { return this.state === 'armed' || this.state === 'running'; }

  nextPoint() {
    if (this.state !== 'running') return this.track.points[0];
    return this.track.points[Math.min(this.nextIndex, this.lastIndex)];
  }

  isNextFinish() {
    return this.state === 'running' && this.nextIndex === this.lastIndex;
  }

  cancel(reason = '') {
    if (!this.active) return false;
    this.state = 'cancelled';
    this.reason = reason;
    return true;
  }

  _within(index, a, b) {
    const p = this.track.points[index];
    return pointSegmentDistance(p.x, p.y, p.z, a.x, a.y, a.z, b.x, b.y, b.z) <= RACE_TRIGGER_RADIUS;
  }

  // 每帧推进：返回事件数组（start / checkpoint / finish / timeout），不产生副作用
  update(now, pos) {
    const events = [];
    if (!this.active || !pos) return events;
    const cur = { x: pos.x, y: pos.y, z: pos.z };
    const prev = this.prev || cur;
    if (this.state === 'armed') {
      if (Number.isFinite(this.armedAt) && now - this.armedAt > RACE_ARM_TIMEOUT_MS) {
        this.cancel('timeout');
        events.push({ type: 'timeout' });
        return events;
      }
      if (this._within(0, prev, cur)) {
        this.state = 'running';
        this.startedAt = now;
        this.elapsedMs = 0;
        this.nextIndex = 1;
        events.push({ type: 'start' });
      }
      this.prev = cur;
      return events;
    }
    // running：只认「当前该过的这一个点」，已过点与未来点穿过一律无效（乱序/折返/重复触碰天然被忽略）
    this.elapsedMs = Math.max(0, now - this.startedAt);
    const index = this.nextIndex;
    if (this._within(index, prev, cur)) {
      if (index >= this.lastIndex) {
        this.state = 'finished';
        events.push({ type: 'finish', elapsed: this.elapsedMs });
      } else {
        this.nextIndex = index + 1;
        events.push({ type: 'checkpoint', index, elapsed: this.elapsedMs });
      }
    }
    this.prev = cur;
    return events;
  }
}

// 毫秒 → "M:SS.mmm"（超过一小时由 cleanRaceMillis 挡在上游，此处只负责显示）
export function formatRaceTime(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
