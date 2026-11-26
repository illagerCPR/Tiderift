// player/IndustrySystem.js -- 潮工（工业）客户端域：本地推进 / 交互 / 网络回执（Build 51 R3；B52 R2 扩机器界面）
// 单机：本地按固定节拍调用纯算法（core/Industry.js），槽位与进度随存档持久化。
// 联机：**不本地推进**（服务器是唯一权威），只提交动作并显示权威回执；机器界面靠 INDUSTRY_OPEN 拉状态。
// 生命周期：新建型——每次 Game.start 重建，_disposeWorld 释放（无 Three 资源、无 DOM、无监听器）。
import {
  tickIndustry, buildNetworks, applyIndustryAction, spillStacks, sanitizeMachineState,
  netInfoFor, toggleClutch, setClutchPowered, pendingClutchSignals, projectedNetworkSize,
} from '../core/Industry.js';
import { INDUSTRY_TICK_MS, INDUSTRY_BLOCK_LIMIT, NETWORK_MAX_NODES } from '../content/industry/defs.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { t } from '../i18n/index.js';
import * as THREE from 'three';
import { BLOCK_CENTER } from './constants.js';

// 交互回执码 → 提示文案（静态 t() 字面量：i18n 静态扫描能查到，语言包不会漏键）
function codeText(code) {
  switch (code) {
    case 'inserted': return t('已投入');
    case 'extracted': return t('已取出');
    case 'full': return t('槽位已满');
    case 'invalid': return t('这台机器不收这个');
    case 'empty': return t('没有可取的东西');
    case 'switched': return t('离合闸已切换');
    default: return null;
  }
}

export class IndustrySystem {
  constructor(game) {
    this.game = game;
    this._acc = 0;                 // 单机节拍累加（秒）
    this._networks = null;         // 拓扑缓存 {compOf, comps}
    this._dirty = true;            // 方块/离合闸变化后置位，下一 tick 重建拓扑
    this._warnedLimit = false;     // 超限提示只播一次
    this._net = new Map();         // B52 R2：联机权威网络摘要（"x,y,z" -> net）
    this._signalAcc = 0;           // B52 R3：离合闸红石轮询节拍累加（秒）
    this._signalSent = new Map();  // B52 R3：最近上报的红石信号（防重复发包）
  }

  // 方块变化（放置/破坏/远端同步/离合闸切换）→ 拓扑标脏
  markDirty() { this._dirty = true; }

  _networksFor(world) {
    if (this._dirty || !this._networks) {
      // B52 R1：离合闸断开会锯断网络——拓扑必须读状态里的通断
      // B56 R2：把风压过载账本一起交给建图（界面摘要即时有 overload，不用等下一拍）
      this._networks = buildNetworks(world.dumpIndustryBlocks(), world.industry, world.overloads);
      this._dirty = false;
    }
    return this._networks;
  }

  // 单机推进：固定 200ms 节拍；dt 内部钳到 ≤1s（不追赶离线生产）
  update(dt) {
    const g = this.game;
    const world = g.world;
    if (!world || !world.industryBlocks) return;
    this._pollClutchSignals(dt); // B52 R3：两种模式都要做（联机只上报，不改本地权威）
    if (g.networkMode) return; // 联机：服务器权威推进，客户端只显示
    // 关闭工业的世界不运行模块机制（已存在的机器保留数据，但不生产、不消耗）
    if (!world.extraContent || world.extraContent.industry !== true) { this._acc = 0; return; }
    if (!world.industryBlocks.size) { this._acc = 0; return; }
    const step = INDUSTRY_TICK_MS / 1000;
    this._acc = Math.min(this._acc + Math.max(0, dt || 0), 1); // 累积也钳制，防切后台后暴冲
    let guard = 0;
    while (this._acc >= step && guard++ < 8) {
      this._acc -= step;
      const nets = this._networksFor(world);
      // B56 R1：清单一并交给纯算法——联动机器（压印机）要求工业 + 魔法同时开
      const r = tickIndustry(world.industryBlocks, world.industry, step, nets, world.extraContent, world.overloads);
      if (r.changed.size && this._warnedLimit) this._warnedLimit = false;
      this._noteOverLimit(r.networks);
    }
  }

  // 超限网络提示（每网络只播一次；预算见 content/industry/defs.js）
  _noteOverLimit(nets) {
    if (this._warnedLimit) return;
    for (const comp of nets.comps) {
      if (!comp.overLimit) continue;
      this._warnedLimit = true;
      this.game.hud && this.game.hud.showToast(t('机械网络过大（上限 128 节点），整网停转'));
      return;
    }
  }

  // B52 R3：离合闸的红石观测（250ms 节拍）
  //   单机：直接写本地状态并重建拓扑；
  //   联机：只把与本地已知状态不一致的信号上报服务器（服务器权威、回执覆盖）。
  _pollClutchSignals(dt) {
    const g = this.game;
    const world = g.world;
    if (!world.extraContent || world.extraContent.industry !== true) return;
    if (!world.industryBlocks.size) return;
    this._signalAcc += Math.max(0, dt || 0);
    if (this._signalAcc < 0.25) return;
    this._signalAcc = 0;
    const redstone = g.redstone;
    if (!redstone) return;
    const powerAt = (x, y, z) => redstone.getPower(x, y, z) > 0;
    const pending = pendingClutchSignals(world.industryBlocks, world.industry, powerAt);
    if (!pending.length) return;
    if (g.networkMode) {
      if (!g.net) return;
      const now = Date.now();
      for (const p of pending) {
        const last = this._signalSent.get(p.key);
        if (last && last.powered === p.powered && now - last.at < 1500) continue; // 等回执，别刷包
        this._signalSent.set(p.key, { powered: p.powered, at: now });
        g.net.sendIndustryAction(p.x, p.y, p.z, 'signal', null, 0, null, -1, p.powered);
      }
      return;
    }
    let dirty = false;
    for (const p of pending) {
      const st = world.getOrOpenIndustry(p.x, p.y, p.z);
      if (st && setClutchPowered(st, p.powered)) dirty = true;
    }
    if (dirty) this.markDirty();
  }

  // 某台机器所在网络的供需摘要：单机从本地拓扑算，联机读服务器下发的权威摘要
  netInfoAt(x, y, z) {
    const g = this.game;
    const world = g.world;
    if (!world) return null;
    const key = `${x},${y},${z}`;
    if (g.networkMode) return this._net.get(key) || null;
    if (!world.industryBlocks || !world.industryBlocks.has(key)) return null;
    return netInfoFor(this._networksFor(world), key);
  }

  // B53 R3：放置前的两道上限预检（每维度方块总数 + 单网络节点数）。
  // 单机在这里直接拦住；联机只是少一次白放，服务器仍会权威回滚（两端同一份纯函数）。
  canPlaceAt(x, y, z) {
    const g = this.game;
    const world = g.world;
    if (!world || !world.industryBlocks) return { ok: true };
    if (!world.extraContent || world.extraContent.industry !== true) return { ok: true };
    if (world.industryBlocks.size >= INDUSTRY_BLOCK_LIMIT) return { ok: false, code: 'block-limit' };
    const size = projectedNetworkSize(this._networksFor(world), world.industryBlocks, x, y, z, world.industry);
    if (size > NETWORK_MAX_NODES) return { ok: false, code: 'net-limit', size };
    return { ok: true, size };
  }

  // 机器种类（界面标题/槽位布局用）
  kindAt(x, y, z) {
    const world = this.game.world;
    if (!world) return null;
    return world.industryKindAt(x, y, z);
  }

  // 界面打开/刷新：联机向服务器要一条权威状态（单机无需，状态本来就在本地）
  requestOpen(block) {
    const g = this.game;
    if (!g.networkMode || !g.net) return;
    g.net.sendIndustryOpen(block.x, block.y, block.z);
  }

  // 机器界面动作：op='insert'|'extract'，slot 指定槽位（null=自动路由/输出槽），inv 是背包槽位（联机回显）
  // 返回 true = 已提交（单机立即结算，联机等服务器回执）
  requestAction(block, op, slot, name, count, inv = -1) {
    const g = this.game;
    const world = g.world;
    if (!world || g.player.spectator) return false;
    const kind = world.industryKindAt(block.x, block.y, block.z);
    if (!kind || kind === 'shaft') return false;
    if (g.networkMode) {
      if (g.net) g.net.sendIndustryAction(block.x, block.y, block.z, op, name, count, slot, inv);
      return true;
    }
    const st = world.getOrOpenIndustry(block.x, block.y, block.z);
    if (!st) return false;
    const res = applyIndustryAction(kind, st, op, name, count, slot);
    this._settle(res, inv);
    return true;
  }

  // 快捷动作（B51 口径：手持物品投入 / 空手取出；离合闸为拨杆切换）
  interact(block) {
    const g = this.game;
    const world = g.world;
    if (!world || g.player.spectator) return false;
    const kind = world.industryKindAt(block.x, block.y, block.z);
    if (!kind || kind === 'shaft') return false;
    if (kind === 'clutch') { this.toggleClutchAt(block.x, block.y, block.z); return true; }
    const sel = g.inventory.getSelected();
    const op = sel ? 'insert' : 'extract';
    const name = sel ? sel.name : null;
    const count = sel ? sel.count : 0;
    if (g.networkMode) {
      if (g.net) g.net.sendIndustryAction(block.x, block.y, block.z, op, name, count, null, sel ? g.inventory.hotbarSelected : -1);
      return true; // 结果由服务器回执驱动（客户端不本地改状态）
    }
    const st = world.getOrOpenIndustry(block.x, block.y, block.z);
    if (!st) return false;
    const res = applyIndustryAction(kind, st, op, name, count);
    this._settle(res, sel ? g.inventory.hotbarSelected : -1);
    return true;
  }

  // 离合闸拨杆：手动拨动（红石信号优先，通电时拨杆不改变导流）
  toggleClutchAt(x, y, z) {
    const g = this.game;
    const world = g.world;
    if (!world) return false;
    if (g.networkMode) {
      if (g.net) g.net.sendIndustryAction(x, y, z, 'toggle');
      return true;
    }
    const st = world.getOrOpenIndustry(x, y, z);
    if (!st) return false;
    toggleClutch(st);
    this.markDirty(); // 通断变化 → 拓扑重建
    const engaged = st.powered !== true && st.manual !== false;
    if (g.hud) {
      const base = t(engaged ? '离合闸：接通' : '离合闸：断开');
      g.hud.showToast(st.powered ? `${base}${t('（红石信号优先）')}` : base);
    }
    return true;
  }

  // 回执结算（单机与服务器回执共用）：扣/加背包 + 提示
  // inv >= 0 = 背包槽位（机器界面点背包投入），否则扣当前选中槽
  _settle(res, inv = -1) {
    const g = this.game;
    if (!res) return;
    const text = codeText(res.code);
    if (res.ok) {
      if (res.code === 'inserted') {
        const n = Math.max(0, res.applied | 0);
        if (n > 0) {
          if (inv >= 0 && inv < g.inventory.size) g.inventory.removeSlot(inv, n);
          else g.inventory.removeSelected(n);
        }
      } else if (res.code === 'extracted') {
        for (const it of res.items || []) {
          if (it && it.count > 0) g.inventory.add(it.name, it.count);
        }
      }
      if (g.hotbar) g.hotbar.update();
    }
    if (g.hud && text) {
      // 回执文案：成功时带上数量（不新增占位符键，拼接在译文之后，语言无关）
      const base = t(text);
      g.hud.showToast(res.ok && res.applied > 0 ? `${base} ×${res.applied}` : base);
    }
  }

  // 联机：服务器权威状态（含仅发给本人的回执 res / 打开时下发的网络摘要 net）
  applyRemoteState(msg) {
    const g = this.game;
    const world = g.world;
    if (!world || !world.industry) return;
    if (msg.d && msg.d !== world.dimension) return; // 异维状态不落到当前世界
    const key = `${msg.x | 0},${msg.y | 0},${msg.z | 0}`;
    if (msg.net) this._net.set(key, msg.net);
    const kind = world.industryBlocks.get(key);
    if (!kind || kind === 'shaft') { world.industry.delete(key); this._net.delete(key); return; }
    const st = sanitizeMachineState(kind, msg.state);
    if (!st) world.industry.delete(key);
    else world.industry.set(key, st);
    if (msg.res) this._settle(msg.res, msg.res.inv ?? -1);
  }

  // 破坏机器：清账本 + 内容物散落（联机由服务器权威散落，客户端不再散第二次）
  onBreak(block) {
    const g = this.game;
    const world = g.world;
    if (!world) return;
    const key = `${block.x},${block.y},${block.z}`;
    const kind = world.industryBlocks.get(key);
    if (!kind) return;
    const st = world.getIndustry(block.x, block.y, block.z);
    world.removeIndustry(block.x, block.y, block.z);
    this._net.delete(key);
    this.markDirty();
    if (!st || g.networkMode) return;
    const pos = new THREE.Vector3(block.x + BLOCK_CENTER, block.y + BLOCK_CENTER, block.z + BLOCK_CENTER);
    for (const it of spillStacks(st)) {
      if (g.mobManager) g.mobManager.spawnDrop(pos, it.name, it.count, null, { pickupDelay: 0.5 });
    }
  }

  dispose() {
    this._networks = null;
    this._net.clear();
    this._signalSent.clear();
    this._acc = 0;
    this._signalAcc = 0;
    this._dirty = true;
  }
}

// 方块 id → 工业种类（供服务器/测试复用同一份判定）
export function industryKindOfId(id) {
  const def = BlockRegistry.getById(id);
  return (def && def.industryKind) || null;
}