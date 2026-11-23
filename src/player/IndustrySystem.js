// player/IndustrySystem.js -- 潮工（工业）客户端域：本地推进 / 交互 / 网络回执（Build 51 R3）
// 单机：本地按固定节拍调用纯算法（core/Industry.js），槽位与进度随存档持久化。
// 联机：**不本地推进**（服务器是唯一权威），只提交投料/取物动作并显示权威回执。
// 生命周期：新建型——每次 Game.start 重建，_disposeWorld 释放（无 Three 资源、无 DOM、无监听器）。
import {
  tickIndustry, buildNetworks, applyIndustryAction, spillStacks, sanitizeMachineState,
} from '../core/Industry.js';
import { INDUSTRY_TICK_MS } from '../content/industry/defs.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { t } from '../i18n/index.js';
import * as THREE from 'three';
import { BLOCK_CENTER } from './constants.js';

// 交互回执码 → 提示文案（服务器与本地共用同一套码）
const CODE_TEXT = {
  inserted: '已投入',
  extracted: '已取出',
  full: '槽位已满',
  invalid: '这台机器不收这个',
  empty: '没有可取的东西',
};

export class IndustrySystem {
  constructor(game) {
    this.game = game;
    this._acc = 0;                 // 单机节拍累加（秒）
    this._networks = null;         // 拓扑缓存 {compOf, comps}
    this._dirty = true;            // 方块变化后置位，下一 tick 重建拓扑
    this._warnedLimit = false;     // 超限提示只播一次
  }

  // 方块变化（放置/破坏/远端同步）→ 拓扑标脏
  markDirty() { this._dirty = true; }

  _networksFor(world) {
    if (this._dirty || !this._networks) {
      this._networks = buildNetworks(world.dumpIndustryBlocks());
      this._dirty = false;
    }
    return this._networks;
  }

  // 单机推进：固定 200ms 节拍；dt 内部钳到 ≤1s（不追赶离线生产）
  update(dt) {
    const g = this.game;
    const world = g.world;
    if (!world || !world.industryBlocks) return;
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
      const r = tickIndustry(world.industryBlocks, world.industry, step, nets);
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

  // 玩家手持物品投料 / 空手取产物。返回 true = 本次右键已被机器消费
  interact(block) {
    const g = this.game;
    const world = g.world;
    if (!world || g.player.spectator) return false;
    const kind = world.industryKindAt(block.x, block.y, block.z);
    if (!kind || kind === 'shaft') return false; // 传动轴不可交互
    const sel = g.inventory.getSelected();
    const op = sel ? 'insert' : 'extract';
    const name = sel ? sel.name : null;
    const count = sel ? sel.count : 0;

    if (g.networkMode) {
      if (g.net) g.net.sendIndustryAction(block.x, block.y, block.z, op, name, count);
      return true; // 结果由服务器回执驱动（客户端不本地改状态）
    }
    const st = world.getOrOpenIndustry(block.x, block.y, block.z);
    if (!st) return false;
    const res = applyIndustryAction(kind, st, op, name, count);
    this._settle(res);
    return true;
  }

  // 回执结算（单机与服务器回执共用）：扣/加背包 + 提示
  _settle(res) {
    const g = this.game;
    if (!res) return;
    const text = CODE_TEXT[res.code] || null;
    if (res.ok) {
      if (res.code === 'inserted') {
        const n = Math.max(0, res.applied | 0);
        if (n > 0) g.inventory.removeSelected(n);
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

  // 联机：服务器权威状态（含仅发给本人的回执 res）
  applyRemoteState(msg) {
    const g = this.game;
    const world = g.world;
    if (!world || !world.industry) return;
    if (msg.d && msg.d !== world.dimension) return; // 异维状态不落到当前世界
    const key = `${msg.x | 0},${msg.y | 0},${msg.z | 0}`;
    const kind = world.industryBlocks.get(key);
    if (!kind || kind === 'shaft') { world.industry.delete(key); return; }
    const st = sanitizeMachineState(kind, msg.state);
    if (!st) world.industry.delete(key);
    else world.industry.set(key, st);
    if (msg.res) this._settle(msg.res);
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
    if (!st || g.networkMode) return;
    const pos = new THREE.Vector3(block.x + BLOCK_CENTER, block.y + BLOCK_CENTER, block.z + BLOCK_CENTER);
    for (const it of spillStacks(st)) {
      if (g.mobManager) g.mobManager.spawnDrop(pos, it.name, it.count, null, { pickupDelay: 0.5 });
    }
  }

  dispose() {
    this._networks = null;
    this._acc = 0;
    this._dirty = true;
  }
}

// 方块 id → 工业种类（供服务器/测试复用同一份判定）
export function industryKindOfId(id) {
  const def = BlockRegistry.getById(id);
  return (def && def.industryKind) || null;
}
