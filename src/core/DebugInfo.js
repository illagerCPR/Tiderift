// DebugInfo.js -- F3 调试信息屏的纯逻辑（无 DOM、无 three，node 可测）
// 只做三件事：① 朝向/区块/时钟/倍率这类纯推导；② 帧率计量（FpsMeter）；③ 把一份运行期快照
// 组装成若干行文本（buildDebugLines）。DOM 与状态采集在 src/ui/DebugScreen.js。
//
// 口径约定：
// - 标签恒英文（技术面板，不进 i18n；每加一个字段不必翻 10 个语言包），与原版 F3 一致；
//   生物群系/维度/方块名等"数值"仍由调用方传入已本地化文本，面板不参与翻译。
// - yaw 语义与 Controls/Player 一致：yaw=0 朝 -Z（北），forward = (-sin yaw, 0, -cos yaw)。
// - 坐标：XYZ 三位小数（技术口径），区块内坐标两位小数；区块列号用 floor（负数同样按格下取整）。

export const CHUNK_SIZE = 16;

// 朝向：|forward.x| 明显大于 |forward.z| 判东西，否则判南北
const FACING_LABELS = {
  n: 'north (-Z)',
  e: 'east (+X)',
  s: 'south (+Z)',
  w: 'west (-X)',
};

export function facingFromYaw(yaw) {
  const f = Number.isFinite(yaw) ? yaw : 0;
  const fx = -Math.sin(f);
  const fz = -Math.cos(f);
  // 45° 对角线（|fx|≈|fz|）恒归 z 轴：sin/cos 在斜角上的差值只有 1e-16 量级，
  // 不留容差会让"斜着站"的朝向在两个轴之间抖。
  if (Math.abs(fx) - Math.abs(fz) > 1e-6) return fx > 0 ? 'e' : 'w';
  return fz > 0 ? 's' : 'n';
}

export function facingLabel(yaw) {
  return FACING_LABELS[facingFromYaw(yaw)];
}

export function chunkOf(gx) {
  return Math.floor((Number.isFinite(gx) ? gx : 0) / CHUNK_SIZE);
}

// 区块内坐标（0..15）：与 World 的 gx - cx*CHUNK_SIZE 同一口径
export function localOf(gx) {
  return (Number.isFinite(gx) ? gx : 0) - chunkOf(gx) * CHUNK_SIZE;
}

// 方块坐标（所在格）：负坐标同样 floor（-0.2 → -1）
export function blockOf(g) {
  return Math.floor(Number.isFinite(g) ? g : 0);
}

// 游戏内时钟：sky.time 0=半夜 0.5=正午，映射到 24 小时制 HH:MM
export function formatClock(skyTime) {
  const t = Number.isFinite(skyTime) ? skyTime : 0;
  const totalMinutes = Math.floor(((t % 1) + 1) % 1 * 24 * 60);
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// 大数字紧凑化：1284 → '1284'，128400 → '128.4k'，1284000 → '1.3M'
export function formatK(n) {
  const v = Number.isFinite(n) ? n : 0;
  if (Math.abs(v) < 10000) return String(Math.round(v));
  if (Math.abs(v) < 1000000) return `${(v / 1000).toFixed(1)}k`;
  return `${(v / 1000000).toFixed(1)}M`;
}

// 定点小数（非有限值一律 '-'，调试屏不能因为 NaN 显示 NaN 干扰判断）
export function fixed(v, digits = 2) {
  return Number.isFinite(v) ? v.toFixed(digits) : '-';
}

// 帧率计量：按帧间隔做指数滑动平均（EMA），与 FPS 显示同源；丢弃 >1s 的间隔
// （后台标签页节流 / 断点 / 暂停恢复），否则一次卡顿会把读数拖到个位数很久。
export class FpsMeter {
  constructor(alpha = 0.1) {
    this.alpha = alpha;
    this.reset();
  }

  reset() {
    this._last = 0;
    this._emaMs = 1000 / 60;
    this.frames = 0;
  }

  // nowMs: performance.now() 时间戳（同一时钟即可）
  push(nowMs) {
    if (!Number.isFinite(nowMs)) return;
    if (!this._last) { this._last = nowMs; return; }
    const ms = nowMs - this._last;
    this._last = nowMs;
    if (ms <= 0 || ms > 1000) return;
    this._emaMs += (ms - this._emaMs) * this.alpha;
    this.frames++;
  }

  get frameMs() { return this._emaMs; }
  get fps() { return 1000 / this._emaMs; }
}

// 运行期快照 → 文本行。ctx 字段（缺省一律按"无此项"处理，安全降级）：
//   versionLabel, fps, frameMs, x/y/z, soul(bool), facing, yaw(弧度), pitch(弧度),
//   vx/vy/vz, flags(string[]), biome, dimension, time, skyLight, blockLight,
//   target: null | { displayName, name, x, y, z, id, hardness, dist },
//   chunksLoaded, chunksDirty, mobs, drops, remote, players,
//   render: null | { calls, triangles, geometries, textures, width, height, pixelRatio },
//   heapUsedMB, heapLimitMB, mode, health, maxHealth, food, maxFood, air, armor, xpLevel,
//   invulnerable, effects(string[]), net: null | { role, rtt, jitter, players }
export function buildDebugLines(c) {
  const ctx = c || {};
  const lines = [];

  lines.push(`${ctx.versionLabel || 'Tiderift'} | ${Math.round(ctx.fps || 0)} fps | ${fixed(ctx.frameMs, 1)} ms`);

  const soul = ctx.soul ? ' [soul]' : '';
  lines.push(`XYZ: ${fixed(ctx.x, 3)} / ${fixed(ctx.y, 3)} / ${fixed(ctx.z, 3)}${soul}`);
  lines.push(`Block: ${blockOf(ctx.x)} / ${blockOf(ctx.y)} / ${blockOf(ctx.z)} | Chunk: ${chunkOf(ctx.x)} / ${chunkOf(ctx.z)} | Local: ${fixed(localOf(ctx.x))} / ${fixed(localOf(ctx.z))}`);
  lines.push(`Facing: ${ctx.facing || facingLabel(ctx.yaw)} | yaw ${fixed(ctx.yaw * 180 / Math.PI, 1)}° | pitch ${fixed(ctx.pitch * 180 / Math.PI, 1)}°`);
  lines.push(`Speed: ${fixed(ctx.vx)} / ${fixed(ctx.vy)} / ${fixed(ctx.vz)} m/s${ctx.flags && ctx.flags.length ? ' | ' + ctx.flags.join(', ') : ''}`);

  const dim = ctx.dimension ? ` | Dimension: ${ctx.dimension}` : '';
  lines.push(`Biome: ${ctx.biome || '?'}${dim}`);
  lines.push(`Time: ${formatClock(ctx.time)} (${fixed(ctx.time, 3)}) | Light: sky ${ctx.skyLight ?? '-'} / block ${ctx.blockLight ?? '-'}`);

  const tg = ctx.target;
  if (tg) {
    const hard = tg.hardness < 0 ? 'unbreakable' : fixed(tg.hardness, 2);
    const dist = Number.isFinite(tg.dist) ? ` | ${fixed(tg.dist, 2)} m` : '';
    lines.push(`Target: ${tg.displayName || tg.name} [${tg.name}] @ ${tg.x} / ${tg.y} / ${tg.z} | id ${tg.id} | hardness ${hard}${dist}`);
  } else {
    lines.push('Target: none');
  }

  lines.push(`Chunks: ${ctx.chunksLoaded ?? 0} loaded, ${ctx.chunksDirty ?? 0} dirty | Mobs: ${ctx.mobs ?? 0} | Drops: ${ctx.drops ?? 0} | Remote: ${ctx.remote ?? 0}`);

  const r = ctx.render;
  if (r) {
    const size = (r.width && r.height) ? ` | ${r.width}x${r.height}@${fixed(r.pixelRatio, 2)}x` : '';
    lines.push(`Render: ${r.calls} calls | ${formatK(r.triangles)} tris | ${r.geometries} geometries | ${r.textures} textures${size}`);
  }

  if (Number.isFinite(ctx.heapUsedMB)) {
    const limit = Number.isFinite(ctx.heapLimitMB) ? ` / ${fixed(ctx.heapLimitMB, 1)} MB` : ' MB';
    lines.push(`Heap: ${fixed(ctx.heapUsedMB, 1)}${limit}`);
  }

  if (ctx.mode) {
    lines.push(`Player: ${ctx.mode} | HP ${ctx.health ?? '-'}/${ctx.maxHealth ?? '-'} | Food ${ctx.food ?? '-'}/${ctx.maxFood ?? '-'} | Air ${ctx.air ?? '-'} | Armor ${ctx.armor ?? 0} | XP ${ctx.xpLevel ?? 0} | invuln ${fixed(ctx.invulnerable, 1)}s`);
  }

  if (ctx.effects && ctx.effects.length) lines.push(`Effects: ${ctx.effects.join(', ')}`);

  if (ctx.net) {
    const jitter = Number.isFinite(ctx.net.jitter) ? ` ±${Math.ceil(ctx.net.jitter)} ms` : '';
    const players = Number.isFinite(ctx.net.players) ? ` | players ${ctx.net.players}` : '';
    lines.push(`Net: ${ctx.net.role} | RTT ${Math.round(ctx.net.rtt || 0)} ms${jitter}${players}`);
  } else {
    lines.push('Net: single-player');
  }

  return lines;
}
