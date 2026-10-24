// Placement.js -- 放置 / 容器域：门床活板门形制放置与连动破坏 / 箱子与潜影盒内容散落 / 熔炉推进与点燃态同步（自 Game.js 迁出）
//
// Game 侧保留同名薄门面（_facingTowardPlayer / _facingAwayFromPlayer / _tryPlaceShaped /
// _removeShapedPartner / _clearIfFamily / _breakChest / _breakShulkerBox / onContainerChanged /
// updateFurnaces / _syncFurnaceLit / _breakFurnace），签名与返回语义不变；Game 内其它调用点零 diff，
// 外部依赖面原样可用（ChestScreen.js:76/209 的 onContainerChanged、FurnaceScreen 直改 World.furnaces、
// Game.update() 的 this.updateFurnaces(dt) 调用行、tests 源码绊线）。
// 域内跨方法调用刻意仍走门面（g._facingTowardPlayer / g._facingAwayFromPlayer / g._clearIfFamily /
// g._syncFurnaceLit），与迁前「Game 内部互调」的调用面逐字一致，外部 stub/覆盖仍然生效；仍留在 Game 的
// _cellOverlapsPlayer 同样经 g 现取。
//
// 生命周期：**构造器共享型**——域状态全部来自 World（world.furnaces / world.containers 按维度分桶，
// 随世界生命周期），控制器零自带状态 / 零 Three 资源 / 零 DOM / 零监听器，_disposeWorld 无收口义务。
// world / player / net / mobManager / inventory / chestScreen / furnaceScreen 一律在调用点经 this.game
// 现取，不留构造期快照（start() 会换 World 实例，快照会指向已销毁对象）。
import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { SMELT_TIME, getSmeltingResult, getFuelTime } from '../core/Smelting.js';
import { doorId, trapdoorId, bedId, furnaceLitId } from '../core/blockShape.js';
import { audio } from '../audio/AudioEngine.js';
import { tickHopperFlow, HOPPER_INTERVAL_MS } from '../core/HopperFlow.js';
import { parsePosKey } from '../core/posKey.js';
import { BLOCK_CENTER } from './constants.js';

// 形制多格方向表（n/s/w/e → [dx, dz]）：原 Game.SHAPED_DIRS，全仓仅本域两个方法读取，随迁出
const SHAPED_DIRS = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };

export class Placement {
  constructor(game) {
    this.game = game;
  }

  // 玩家相对目标格的水平朝向键：门/活板门面板贴"玩家近边"
  facingTowardPlayer(bx, bz) {
    const g = this.game;
    const dx = g.player.position.x - (bx + BLOCK_CENTER);
    const dz = g.player.position.z - (bz + BLOCK_CENTER);
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : (dz > 0 ? 's' : 'n');
  }

  facingAwayFromPlayer(bx, bz) {
    const g = this.game;
    const f = g._facingTowardPlayer(bx, bz);
    return { n: 's', s: 'n', e: 'w', w: 'e' }[f];
  }

  // 形制放置（门=下半贴近边+上半；床=脚+头朝远离玩家方向；活板门=关态贴近边）。
  // 目标格必须为空气，任一格不满足即整体失败（返回 false，不消耗物品）。
  tryPlaceShaped(x, y, z, blockDef) {
    const g = this.game;
    const DIRS = SHAPED_DIRS;
    if (g.world.getBlock(x, y, z) !== 0) return false;
    if (blockDef.part === 'door_lower') {
      const uy = y + 1;
      if (g.world.getBlock(x, uy, z) !== 0 || g._cellOverlapsPlayer(x, uy, z)) return false;
      const facing = g._facingTowardPlayer(x, z);
      const lid = doorId(blockDef.baseBlock, 'lower', facing, false);
      const uid = doorId(blockDef.baseBlock, 'upper', facing, false);
      if (!lid || !uid) return false;
      g.world.setBlock(x, y, z, lid);
      g.world.setBlock(x, uy, z, uid);
      audio.blockPlace(blockDef);
      if (g.redstone) { g.redstone.onBlockChange(x, y, z); g.redstone.onBlockChange(x, uy, z); }
      return true;
    }
    if (blockDef.part === 'bed_foot') {
      const facing = g._facingAwayFromPlayer(x, z);
      const [dx, dz] = DIRS[facing];
      const hx = x + dx, hz = z + dz;
      if (g.world.getBlock(hx, y, hz) !== 0 || g._cellOverlapsPlayer(hx, y, hz)) return false;
      const fid = bedId('foot', facing), hid = bedId('head', facing);
      if (!fid || !hid) return false;
      g.world.setBlock(x, y, z, fid);
      g.world.setBlock(hx, y, hz, hid);
      audio.blockPlace(blockDef);
      return true;
    }
    if (blockDef.part === 'trapdoor') {
      const facing = g._facingTowardPlayer(x, z);
      const tid = trapdoorId(facing, false);
      if (!tid) return false;
      g.world.setBlock(x, y, z, tid);
      audio.blockPlace(blockDef);
      if (g.redstone) g.redstone.onBlockChange(x, y, z);
      return true;
    }
    return false;
  }

  // 破坏门/床任一半时连动清除另一半（另一半经家族掉落规则不重复产出）
  removeShapedPartner(def, x, y, z) {
    const g = this.game;
    const DIRS = SHAPED_DIRS;
    if (def.part === 'door_lower') g._clearIfFamily(x, y + 1, z, def.baseBlock);
    else if (def.part === 'door_upper') g._clearIfFamily(x, y - 1, z, def.baseBlock);
    else if (def.part === 'bed_foot') {
      const [dx, dz] = DIRS[def.facing];
      g._clearIfFamily(x + dx, y, z + dz, def.baseBlock);
    } else if (def.part === 'bed_head') {
      const [dx, dz] = DIRS[def.facing];
      g._clearIfFamily(x - dx, y, z - dz, def.baseBlock);
    }
  }

  clearIfFamily(x, y, z, baseBlock) {
    const g = this.game;
    const d = BlockRegistry.getById(g.world.getBlock(x, y, z));
    if (d && d.baseBlock === baseBlock) g.world.setBlock(x, y, z, 0);
  }

  // T5：箱子被本地破坏 → 容器内容散落 + 清容器数据；开着的箱子界面一并关闭
  breakChest(block, dropContents) {
    const g = this.game;
    const items = g.world.getContainer(block.x, block.y, block.z);
    g.world.removeContainer(block.x, block.y, block.z);
    if (g.chestScreen && g.chestScreen.visible && g.chestScreen.pos &&
        g.chestScreen.pos.x === block.x && g.chestScreen.pos.y === block.y &&
        g.chestScreen.pos.z === block.z) {
      g.chestScreen._changed = false; // 容器已销毁，hide 不再上报
      g.chestScreen.hide();
    }
    if (!items || !dropContents) return;
    for (const s of items) {
      if (!s) continue;
      if (g.networkMode && g.net) {
        g.net.sendDropSpawn(block.x + BLOCK_CENTER, block.y + BLOCK_CENTER, block.z + BLOCK_CENTER, s.name, s.count);
      } else if (g.mobManager) {
        g.mobManager.spawnDrop(
          new THREE.Vector3(block.x + BLOCK_CENTER, block.y + BLOCK_CENTER, block.z + BLOCK_CENTER), s.name, s.count, null, { pickupDelay: 0.5 });
      }
    }
  }

  // Idea-2C：潜影盒破坏——内容不散落，跟随盒体成单一掉落（data 通道）
  // toInventory：单机生存直接入背包（与普通方块掉落同惯例）；联机/创造走实体掉落
  breakShulkerBox(block, toInventory) {
    const g = this.game;
    const items = g.world.getContainer(block.x, block.y, block.z);
    g.world.removeContainer(block.x, block.y, block.z);
    if (g.chestScreen && g.chestScreen.visible && g.chestScreen.pos &&
        g.chestScreen.pos.x === block.x && g.chestScreen.pos.y === block.y &&
        g.chestScreen.pos.z === block.z) {
      g.chestScreen._changed = false; // 容器已销毁，hide 不再上报
      g.chestScreen.hide();
    }
    const data = (items && items.some(s => s)) ? items : null; // 空盒不带 data
    if (g.networkMode && g.net) {
      g.net.sendDropSpawn(block.x + BLOCK_CENTER, block.y + BLOCK_CENTER, block.z + BLOCK_CENTER, 'shulker_box', 1, data);
    } else if (toInventory && g.player.survival) {
      g.inventory.add('shulker_box', 1, data);
    } else if (g.mobManager) {
      g.mobManager.spawnDrop(
        new THREE.Vector3(block.x + BLOCK_CENTER, block.y + BLOCK_CENTER, block.z + BLOCK_CENTER), 'shulker_box', 1, data, { pickupDelay: 0.5 });
    }
    if (g.hotbar) g.hotbar.update();
  }

  // T5：容器修改上报出口（ChestScreen 每次改动调用）；联机整箱广播，单机 noop
  onContainerChanged(pos, items) {
    const g = this.game;
    if (g.networkMode && g.net) g.net.sendContainerSet(pos.x, pos.y, pos.z, items);
  }

  // B36 F-1：单机本地漏斗搬运。联机时搬运权威在服务器 tick（server/flow.js），
  // 客户端一律早退——否则本地转移与服务器 CONTAINER_SET 回放互相覆盖（两条同步路径必须共存）。
  updateHopperFlow(dt) {
    const g = this.game;
    if (!g.world || g.networkMode) return;
    this._flowTimer = Math.max(0, (this._flowTimer || 0) - dt);
    if (this._flowTimer > 0) return;
    this._flowTimer = HOPPER_INTERVAL_MS / 1000;
    const world = g.world;
    if (!world.hoppers || !world.hoppers.size) return;
    const hoppers = [];
    for (const [key, facing] of world.hoppers) {
      const p = parsePosKey(key);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
      hoppers.push({ x: p.x, y: p.y, z: p.z, facing });
    }
    if (!hoppers.length) return;
    // 固定顺序 → 同 tick 内搬运结果确定（两条漏斗共用一个目标时也不抖）
    hoppers.sort((a, b) => (a.x - b.x) || (a.y - b.y) || (a.z - b.z));
    // 只对真正的容器方块建账：未加载区块 getBlock 返回 0 → 不创建（不会在虚空里生容器）
    const isContainerAt = (x, y, z) => {
      const def = BlockRegistry.getById(world.getBlock(x, y, z));
      return !!(def && (def.baseBlock === 'chest' || def.baseBlock === 'hopper' || def.name === 'shulker_box'));
    };
    tickHopperFlow(hoppers, {
      getContainer: (x, y, z) => world.getContainer(x, y, z),
      ensureContainer: (x, y, z) => (isContainerAt(x, y, z) ? world.getOrOpenContainer(x, y, z) : null),
    });
  }

  // 熔炉烧炼推进：遍历当前维度全部已开炉状态（惰性创建，只有打开过/放料过的炉子在表里）
  // 语义对齐原版：燃料燃尽暂停（进度保温缓慢回退）、输出槽同类未满才续烧、燃料点燃即扣 1 个
  updateFurnaces(dt) {
    const g = this.game;
    if (!g.world || !g.world.furnaces) return;
    // B28 点燃态方块切换仅 host/单机权威（客户端不写方块，靠 block_set 广播收敛——同流体模拟门控）
    const isClient = !!(g.networkMode && g.net && !g.net.isHost);
    for (const [key, st] of g.world.furnaces) {
      const recipe = st.input ? getSmeltingResult(st.input.name) : null;
      const canSmelt = !!(recipe && (!st.output ||
        (st.output.name === recipe.output && st.output.count + recipe.count <= 64)));
      if (st.burnTime > 0) st.burnTime -= dt;
      // 点火：火焰熄了但还能烧且有燃料
      if (st.burnTime <= 0 && canSmelt && st.fuel) {
        const ft = getFuelTime(st.fuel.name);
        if (ft > 0) {
          st.burnMax = ft;
          st.burnTime = ft;
          st.fuel.count--;
          if (st.fuel.count <= 0) st.fuel = null;
        }
      }
      if (st.burnTime > 0 && canSmelt) {
        st.cookTime += dt;
        // 有界循环：大步长 dt（卡顿/追赶）也能连续产出，不积压 cookTime
        let guard = 0;
        while (st.cookTime >= SMELT_TIME && guard++ < 64) {
          const r = st.input ? getSmeltingResult(st.input.name) : null;
          if (!r || (st.output && (st.output.name !== r.output || st.output.count + r.count > 64))) break;
          st.cookTime -= SMELT_TIME;
          if (st.output) st.output.count += r.count;
          else st.output = { name: r.output, count: r.count, data: null };
          st.input.count--;
          if (st.input.count <= 0) st.input = null;
        }
        if (!st.input) st.cookTime = 0; // 断料清进度（原版语义）
      } else if (st.cookTime > 0) {
        // 熄火/断料：进度缓慢回退而不是瞬间清零
        st.cookTime = Math.max(0, st.cookTime - dt * 2);
      }
      // B28：燃烧起止边沿切换点燃态方块（保留朝向；light:13 由光照引擎增量更新）
      if (!isClient) g._syncFurnaceLit(key, st);
    }
  }

  // B28：熔炉点燃态方块同步（key = World.furnaceKey "x,y,z"）。
  // 只在「方块仍是熔炉家族 + 点燃与否发生变化」时写一次；写走 World.setBlock（账本/联机/光照全路径收口）。
  syncFurnaceLit(key, st) {
    const g = this.game;
    const parts = key.split(',').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return;
    const [x, y, z] = parts;
    const def = BlockRegistry.getById(g.world.getBlock(x, y, z));
    if (!def || def.baseBlock !== 'furnace') return; // 已被挖掉/替换：状态表由 _breakFurnace 清理
    const lit = st.burnTime > 0;
    if (def.lit === lit) return;
    const nid = furnaceLitId(def.facing || 'n', lit);
    if (nid) g.world.setBlock(x, y, z, nid);
  }

  // 挖毁熔炉：清理状态 + 内容物散落（箱子同款语义），关掉正开着的炉界面
  breakFurnace(block) {
    const g = this.game;
    const st = g.world.getFurnace(block.x, block.y, block.z);
    g.world.removeFurnace(block.x, block.y, block.z);
    if (g.furnaceScreen && g.furnaceScreen.visible && g.furnaceScreen.pos &&
        g.furnaceScreen.pos.x === block.x && g.furnaceScreen.pos.y === block.y &&
        g.furnaceScreen.pos.z === block.z) {
      g.furnaceScreen.hide();
    }
    if (!st) return;
    for (const s of [st.input, st.fuel, st.output]) {
      if (!s) continue;
      if (g.networkMode && g.net) {
        g.net.sendDropSpawn(block.x + BLOCK_CENTER, block.y + BLOCK_CENTER, block.z + BLOCK_CENTER, s.name, s.count);
      } else if (g.mobManager) {
        g.mobManager.spawnDrop(
          new THREE.Vector3(block.x + BLOCK_CENTER, block.y + BLOCK_CENTER, block.z + BLOCK_CENTER), s.name, s.count, null, { pickupDelay: 0.5 });
      }
    }
  }

}
