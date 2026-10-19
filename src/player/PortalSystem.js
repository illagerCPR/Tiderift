// PortalSystem.js -- 传送门域：点火 / 末影之眼逐框嵌眼 / 站门计时 / 到达落点与返程门 / 立地面下探（自 Game.js 迁出）
//
// Game 侧保留同名薄门面（_tryLightPortal / _tryPlaceEndEye / updatePortals / updatePortalParticles /
// _usePortal / _useGatewayPortal / _afterPortalArrival / _resolveArrivalY），签名与返回语义不变；
// Game 内其它调用点零 diff，外部依赖面（NetworkManager / window.game / tests 源码绊线）原样可用。
// 触发链刻意仍走门面：updatePortals 内部调 this.game._usePortal / _useGatewayPortal，与迁前
// 「Game.updatePortals → Game._usePortal」的调用面逐字一致（外部 stub/覆盖这两个入口仍然生效）。
//
// 生命周期：**构造器共享型**——无 Three 资源 / 无 DOM / 无监听器，_disposeWorld 无收口义务。
// 穿越三件套 _portalTimer/_portalArmed/_portalCooldown **刻意留在 Game**：start() 里复位（本轮禁改区），
// 控制器一律 this.game._portalTimer 这样的调用点现取；粒子节流计时器 partT 是纯域内状态
//（start() 不复位、全仓无外部读取面），随控制器持有。
// world / player / chatBox / portalOverlay / fireParticles 一律在调用点经 this.game 现取，不留构造期快照：
// updatePortals 可同步触发 switchDimension → start() → _disposeWorld() 同帧换世界，快照会指向已销毁对象。
//
// 与 src/core/Portals.js 的分工不变：那个文件是纯 World 操作库（框校验 / 填充 / 搜门 / 建门 / 拆门），本文件是游戏时序与游戏态。
import { BlockRegistry } from '../core/BlockRegistry.js';
import { CHUNK_SIZE, Chunk, CHUNK_HEIGHT } from '../core/Chunk.js';
import { getDimension } from '../core/dimensions.js';
import { t } from '../i18n/index.js';
import { BLOCK_CENTER } from './constants.js';
import {
  PORTAL_KINDS, DIM_PORTAL_KINDS, ARRIVAL_PLATFORM,
  portalBlockId, portalTargetPos, detectPortalInterior, fillPortal,
  findPortalNear, buildReturnPortal,
  detectEndRing, fillEndPortalCenter, gatewayTarget,
} from '../core/Portals.js';

export class PortalSystem {
  constructor(game) {
    this.game = game;
    this.partT = 0; // 环境粒子节流：满 0.04s 发一撮
  }

  // 打火石点火传送门：点击框体 → 内部候选格 = 点击面外邻格 → 框校验 → 填充门方块。
  // 返回 true 表示本次右键已被处理（无论点火成败——打火石无"生火"语义可回退）。
  tryLightPortal(hit, targetDef) {
    const g = this.game;
    const kind = { obsidian: 'nether', glowstone: 'aether' }[targetDef.name];
    if (!kind) return false;
    const cx = hit.block.x + hit.normal.x;
    const cy = hit.block.y + hit.normal.y;
    const cz = hit.block.z + hit.normal.z;
    if (g.world.getBlock(cx, cy, cz) !== 0) return false;
    const det = detectPortalInterior(g.world, cx, cy, cz, targetDef.id);
    if (!det) {
      if (g.chatBox) g.chatBox.add(t('传送门框架不完整（内部至少 2×3，框边须封闭）'), '#fa8');
      return true;
    }
    g.hand.swing();
    fillPortal(g.world, det, portalBlockId(kind));
    if (g.chatBox) g.chatBox.add(kind === 'nether' ? t('下界传送门被点亮了…') : t('天域传送门被点亮了…'), '#a7f');
    return true;
  }

  // 末影之眼嵌入要塞传送门框架：无眼框→带眼框（消耗 1）；12 眼集齐→中心 3×3 填门体。
  // 返回 true 表示本次右键已被处理；非环位散框不消耗（原版语义）。
  tryPlaceEndEye(hit, targetDef) {
    if (targetDef.name !== 'end_portal_frame') return false;
    const g = this.game;
    const { x: bx, y: by, z: bz } = hit.block;
    const FRAME = BlockRegistry.getId('end_portal_frame');
    const EYE = BlockRegistry.getId('end_portal_frame_eye');
    const PORTAL = BlockRegistry.getId('end_portal');
    if (!detectEndRing(g.world, bx, by, bz, FRAME, EYE)) return false;
    g.hand.swing();
    g.world.setBlock(bx, by, bz, EYE);
    if (g.player.survival) {
      g.inventory.removeSelected(1);
      g.hotbar.update();
    }
    const after = detectEndRing(g.world, bx, by, bz, FRAME, EYE);
    if (after && after.eyes === 12) {
      fillEndPortalCenter(g.world, after, PORTAL);
      if (g.chatBox) g.chatBox.add(t('末地传送门被激活了——跳进去！'), '#a7f');
    } else if (after) {
      if (g.chatBox) g.chatBox.add(t('末影之眼嵌入框架（{n}/12）', { n: after.eyes }), '#a7f');
    }
    return true;
  }

  // 传送门穿越检测：站入门方块累积 2s 触发（末地门即触）；到达后须离开门体才重新武装（防立即回传）。
  // 三件套 _portalTimer / _portalArmed / _portalCooldown 属 Game（start() 复位），此处一律现取。
  updatePortals(dt) {
    const g = this.game;
    if (!g.world || g.spectating || !g.player || g.player.dead) return;
    if (g._portalCooldown > 0) {
      g._portalCooldown -= dt;
      if (g.portalOverlay) g.portalOverlay.update(null, 0);
      return;
    }
    const kinds = DIM_PORTAL_KINDS[g.world.dimension] || [];
    if (!kinds.length) { g._portalTimer = 0; if (g.portalOverlay) g.portalOverlay.update(null, 0); return; }
    const p = g.player.position;
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    const cellId = (dy) => g.world.getBlock(bx, Math.floor(p.y + dy), bz);
    let kindIn = null;
    for (const kind of kinds) {
      const pid = portalBlockId(kind);
      // gateway 是"踩入式"（嵌地面层，非固体）——额外探测脚下格
      const probes = kind === 'gateway' ? [-0.3, 0.1, 1.0] : [0.1, 1.0];
      if (probes.some(dy => cellId(dy) === pid)) { kindIn = kind; break; }
    }
    if (!kindIn) {
      g._portalTimer = 0;
      g._portalArmed = true;
      if (g.portalOverlay) g.portalOverlay.update(null, 0);
      return;
    }
    if (!g._portalArmed) {
      if (g.portalOverlay) g.portalOverlay.update(null, 0);
      return;
    }
    // 折跃门站入 1s 触发（同维传送）；下界/天域门 2s；末地门陷入即触
    const threshold = kindIn === 'gateway' ? 1.0 : 2.0;
    if (g.portalOverlay) g.portalOverlay.update(kindIn, Math.min(1, g._portalTimer / threshold));
    g._portalTimer += dt;
    if (g._portalTimer >= threshold) {
      g._portalTimer = 0;
      g._portalArmed = false;
      if (g.portalOverlay) g.portalOverlay.update(kindIn, 1);
      if (kindIn === 'gateway') g._useGatewayPortal();
      else g._usePortal(kindIn);
    }
  }

  // 传送门环境粒子（M3）：从已加载区块的 portalCells 随机抽样发射（mesh build 时收集，与方块数据同步）。
  // 纯视觉客户端本地效果，不进存档/协议；密度随视频设置 densityScale 缩放。
  updatePortalParticles(dt) {
    const g = this.game;
    if (!g.fireParticles || !g.world || g.paused) return;
    this.partT += dt;
    if (this.partT < 0.04) return;
    this.partT = 0;
    const cand = [];
    for (const [, chunk] of g.world.chunks) {
      if (chunk.portalCells && chunk.portalCells.length) cand.push(chunk);
    }
    if (!cand.length) return;
    const n = Math.max(1, Math.round(4 * g.fireParticles.densityScale));
    for (let k = 0; k < n; k++) {
      const chunk = cand[(Math.random() * cand.length) | 0];
      const cells = chunk.portalCells;
      const i = ((Math.random() * cells.length) / 3 | 0) * 3;
      const wx = chunk.cx * CHUNK_SIZE + cells[i], wy = cells[i + 1], wz = chunk.cz * CHUNK_SIZE + cells[i + 2];
      const def = BlockRegistry.getById(g.world.getBlock(wx, wy, wz));
      if (!def || !def.ambientParticles) continue; // 方块可能已被改动（mesh 尚未重建）
      g.fireParticles.portalAmbient(wx, wy, wz, def.name);
    }
  }

  // 传送门触发：目标维度 = 门种类配对的另一端
  //（下界 overworld↔nether 1:8 / 天域 overworld↔aether 1:1 / 末地 overworld↔end 落出生点）
  usePortal(kind) {
    const g = this.game;
    if (g.portalOverlay) g.portalOverlay.flash();
    const dim = g.world.dimension;
    let target = null;
    let arrival = null;
    if (kind === 'nether') {
      target = { nether: 'overworld', overworld: 'nether' }[dim];
      if (target) {
        const pos = portalTargetPos('nether', dim, g.player.position.x, g.player.position.z);
        arrival = { x: pos.x, z: pos.z, portal: kind };
      }
    } else if (kind === 'aether') {
      target = { aether: 'overworld', overworld: 'aether' }[dim];
      if (target) {
        const pos = portalTargetPos('aether', dim, g.player.position.x, g.player.position.z);
        arrival = { x: pos.x, z: pos.z, portal: kind };
      }
    } else if (kind === 'end') {
      // 末地：原版语义——去程落末地出生点（到达后自动建回程垫），回程落主世界出生点
      target = dim === 'end' ? 'overworld' : 'end';
      arrival = { portal: kind };
    }
    if (!target) return;
    const def = getDimension(target);
    if (g.chatBox) g.chatBox.add(t('传送门轰鸣着将你送往「{d}」…', { d: t(def.name) }), '#a7f');
    g.switchDimension(target, arrival); // 维度切换属 L17，留在 Game
  }

  // 折跃门传送（末地同维）：不换维，账本扫描"角度最近"的配对门直达
  //（两端门角度一致由 gatewayPlacements 保证；armed/cooldown 防回弹由 updatePortals 统一处理）
  useGatewayPortal() {
    const g = this.game;
    if (g.portalOverlay) g.portalOverlay.flash();
    const p = g.player.position;
    const target = gatewayTarget(g.world, p.x, p.z);
    if (!target) return;
    p.set(target.x + BLOCK_CENTER, target.y + 1, target.z + BLOCK_CENTER);
    g.player.velocity.set(0, 0, 0);
    if (g.chatBox) g.chatBox.add(t('折跃门的光束把你送往远方的岛屿……'), '#a7f');
  }

  // 传送门到达落地：有坐标落点 → 半径 24 搜既有同类门吸附、无门自动建返程门（原版语义）；
  // 无坐标落点（末地链）→ 仅落维度出生点（M3 起回程门由击败末影龙激活，到达不再自动建垫）
  afterPortalArrival(arrival) {
    const g = this.game;
    if (!g.world || !g.running) return;
    const kind = arrival.portal && PORTAL_KINDS[arrival.portal] ? arrival.portal : null;
    if (!Number.isFinite(arrival.x) || !Number.isFinite(arrival.z)) {
      g._portalCooldown = 4;
      g._portalArmed = false;
      return;
    }
    const portalId = kind ? portalBlockId(kind) : 0;
    let pos = portalId ? findPortalNear(g.world, arrival.x, arrival.z, portalId, 24) : null;
    if (pos) {
      g.player.position.set(pos.x, pos.y, pos.z);
    } else if (kind) {
      pos = buildReturnPortal(g.world, kind, arrival.x, arrival.z, {
        top: g.world.dimDef.spawnScanTop || CHUNK_HEIGHT - 2,
        platform: ARRIVAL_PLATFORM[g.world.dimension] || null,
      });
      g.player.position.set(pos.x, pos.y, pos.z);
      if (g.chatBox) g.chatBox.add(t('你在落点建造了一座返程传送门'), '#a7f');
    }
    if (pos) g.player.velocity.set(0, 0, 0);
    g._portalCooldown = 4;
    g._portalArmed = false;
  }

  // 传送门落点立足面预解析：临时生成器 + 临时区块探测（纯函数，不碰当前世界）；
  // 无立足面返回 -1（到达后由 buildReturnPortal 按维度档案垫平台）
  resolveArrivalY(dim, x, z) {
    const g = this.game;
    const def = getDimension(dim);
    if (!def) return -1;
    const gen = def.createGenerator(g.world.seed, { biomeScale: g.biomeScale });
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const c = new Chunk(cx, cz);
    gen.generateChunk(c);
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    const top = Math.min(def.spawnScanTop || 140, CHUNK_HEIGHT - 2);
    for (let y = top; y >= 1; y--) {
      if (c.get(lx, y, lz) === 0 && c.get(lx, y + 1, lz) === 0) {
        const d = BlockRegistry.getById(c.get(lx, y - 1, lz));
        if (d && d.solid) return y;
      }
    }
    return -1;
  }
}
