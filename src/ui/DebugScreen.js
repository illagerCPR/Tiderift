// DebugScreen.js -- B49 F3 调试信息屏：屏幕左上角的技术读数（无背景框，纯文本 + 文字描边保证可读）
// 职责边界：本文件只负责"采集运行期状态 + 写 DOM"，格式化与推导全在 src/core/DebugInfo.js（纯逻辑，node 可测）。
// 标签恒英文（技术面板不进 i18n），数值里的生物群系/维度/方块名仍用既有本地化文本。
// 刷新节流 10Hz：数字不疯狂跳动、DOM 每秒只写 10 次；帧率计量仍按帧推进（FpsMeter 在 update 首行）。
import { VERSION_LABEL } from '../version.js';
import { t } from '../i18n/index.js';
import { BiomeNames } from '../world/biomes.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { getDisplayName } from './itemName.js';
import { FpsMeter, buildDebugLines, facingLabel } from '../core/DebugInfo.js';

const REFRESH_MS = 100;          // 文本刷新间隔（毫秒）

export class DebugScreen {
  constructor() {
    this.el = document.createElement('div');
    // 无背景框（用户口径）：只有文字 + 描边阴影；position:fixed 左上游离，不吃鼠标事件
    this.el.style.cssText = `
      position: fixed; top: 8px; left: 8px; z-index: 20;
      display: none; pointer-events: none; white-space: pre;
      color: #ffffff; font-family: monospace; font-size: 12px; line-height: 1.45;
      text-shadow: 1px 1px 0 rgba(0,0,0,0.95), -1px -1px 0 rgba(0,0,0,0.6), 0 0 4px rgba(0,0,0,0.85);
    `;
    document.body.appendChild(this.el);
    this.visible = false;
    this.onToggle = null;        // (visible) => void：Game 用它让常规信息栏让位
    this._fps = new FpsMeter();
    this._lastTextAt = 0;
  }

  toggle() { this.setVisible(!this.visible); }

  // 开关（幂等）；visible=false 时立即撤下文本，下次打开重新计量帧率
  setVisible(v) {
    const on = !!v;
    if (on === this.visible) return;
    this.visible = on;
    this.el.style.display = on ? 'block' : 'none';
    if (on) {
      this._fps.reset();
      this._lastTextAt = 0;
    } else {
      this.el.textContent = '';
    }
    if (this.onToggle) this.onToggle(on);
  }

  hide() { this.setVisible(false); }

  // 每帧调用（Game.loop 在 render 之后——此时渲染统计是本帧累计值）
  update(game, now = performance.now()) {
    if (!this.visible) return;
    this._fps.push(now);
    if (now - this._lastTextAt < REFRESH_MS) return;
    this._lastTextAt = now;
    const lines = buildDebugLines(this._snapshot(game));
    const text = lines.join('\n');
    if (text !== this.el.textContent) this.el.textContent = text;
  }

  // 运行期快照（world 可能尚未就绪：F3 在极早期按下时安全降级为最小行集）
  _snapshot(game) {
    const p = game.player || {};
    const world = game.world;
    const soul = !!(game.soulView && game.soulView.active);
    const at = (soul && game.soulView.position) ? game.soulView.position : (p.position || { x: 0, y: 0, z: 0 });
    const x = at.x || 0, y = at.y || 0, z = at.z || 0;

    const ctx = {
      versionLabel: VERSION_LABEL,
      fps: this._fps.fps,
      frameMs: this._fps.frameMs,
      x, y, z,
      soul,
      facing: facingLabel(p.yaw || 0),
      yaw: p.yaw || 0,
      pitch: p.pitch || 0,
      vx: p.velocity ? p.velocity.x : 0,
      vy: p.velocity ? p.velocity.y : 0,
      vz: p.velocity ? p.velocity.z : 0,
      flags: this._flags(game, p),
      time: game.sky ? game.sky.time : 0,
      chunksLoaded: world && world.chunks ? world.chunks.size : 0,
      chunksDirty: 0,
      mobs: game.mobManager && game.mobManager.mobs ? game.mobManager.mobs.length : 0,
      drops: game.mobManager && game.mobManager.droppedItems ? game.mobManager.droppedItems.length : 0,
      remote: game.remotePlayers ? game.remotePlayers.size : 0,
      render: this._renderStats(game),
      heapUsedMB: undefined,
      heapLimitMB: undefined,
      mode: p.gamemode || '-',
      health: p.health,
      maxHealth: p.maxHealth,
      food: p.food,
      maxFood: p.maxFood,
      air: p.airTicks,
      armor: p.armor,
      xpLevel: p.xpLevel,
      invulnerable: p.invulnerable,
      effects: this._effects(p),
      net: this._net(game),
    };

    if (world) {
      const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
      ctx.skyLight = world.getSkyLight ? world.getSkyLight(bx, by, bz) : undefined;
      ctx.blockLight = world.getBlockLightAt ? world.getBlockLightAt(bx, by, bz) : undefined;
      if (world.chunks) {
        let dirty = 0;
        for (const c of world.chunks.values()) if (c.dirty) dirty++;
        ctx.chunksDirty = dirty;
      }
      const gen = world.generator;
      if (gen && gen.getBiome) {
        const biome = gen.getBiome(x, z);
        const label = gen.biomeNames ? gen.biomeNames[biome] : BiomeNames[biome];
        ctx.biome = label ? t(label) : t('未知');
      }
      if (world.dimDef && world.dimDef.name) ctx.dimension = t(world.dimDef.name);
      ctx.target = this._target(game);
    }

    const mem = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
    if (mem && Number.isFinite(mem.usedJSHeapSize)) {
      ctx.heapUsedMB = mem.usedJSHeapSize / 1048576;
      ctx.heapLimitMB = Number.isFinite(mem.jsHeapSizeLimit) ? mem.jsHeapSizeLimit / 1048576 : undefined;
    }
    return ctx;
  }

  // 速度行的状态词（地面/空中/水/飞行/滑翔/疾跑/潜行/死亡/观战）
  _flags(game, p) {
    const out = [];
    out.push(p.onGround ? 'ground' : 'air');
    if (p.bodyInWater) out.push('water');
    else if (p.inWater) out.push('eyes-in-water');
    if (p.flying) out.push('flying');
    if (p.gliding) out.push('gliding');
    if (p.dead) out.push('dead');
    if (game.spectating) out.push('spectating');
    if (game.controls) {
      if (game.controls.isSprinting()) out.push('sprinting');
      if (game.controls.isSneaking()) out.push('sneaking');
    }
    return out;
  }

  // 准星方块（选中信息来自 Game.updateRaycast；Mob 命中不在此行显示）
  _target(game) {
    const hit = game.selectedBlock;
    if (!hit || !hit.block) return null;
    const def = BlockRegistry.getById(hit.id);
    return {
      displayName: def ? getDisplayName(def.name) : '?',
      name: def ? def.name : '?',
      x: hit.block.x,
      y: hit.block.y,
      z: hit.block.z,
      id: hit.id,
      hardness: def ? (def.hardness ?? 0) : 0,
      dist: hit.t,
    };
  }

  // 渲染统计：Renderer 已把 info.autoReset 关掉并在帧首清零 → 这里是本帧所有 pass 的累计值
  _renderStats(game) {
    const wrap = game.renderer;
    const info = wrap && wrap.stats ? wrap.stats : null;
    if (!info || !info.render) return null;
    const dom = wrap.renderer && wrap.renderer.domElement;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory ? info.memory.geometries : 0,
      textures: info.memory ? info.memory.textures : 0,
      width: dom ? dom.width : 0,
      height: dom ? dom.height : 0,
      pixelRatio: wrap.renderer ? wrap.renderer.getPixelRatio() : 1,
    };
  }

  _effects(p) {
    if (!p.effects || typeof p.effects.entries !== 'function') return [];
    const out = [];
    for (const [name, e] of p.effects.entries()) {
      if (!e || !(e.time > 0)) continue;
      out.push(`${name} ${e.level} ${Math.ceil(e.time)}s`);
    }
    return out;
  }

  _net(game) {
    if (!game.networkMode || !game.net) return null;
    return {
      role: game.net.isHost ? 'host' : 'client',
      rtt: game.net.rttMs || 0,
      jitter: game.net.rttJitterMs,
      players: (game.remotePlayers ? game.remotePlayers.size : 0) + 1,
    };
  }
}
