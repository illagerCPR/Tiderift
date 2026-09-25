// RedstoneSystem.js -- 红石信号传播与方块交互
// 最小实现：lever/button 激活 -> 红石粉传播 -> piston/lamp/TNT/door 响应
import { doorId, trapdoorId } from './blockShape.js';
import { BlockRegistry } from '../core/BlockRegistry.js';

const REDSTONE_WIRE = 'redstone_wire';
const REDSTONE_TORCH = 'redstone_torch';
const REDSTONE_BLOCK = 'redstone_block';
const REDSTONE_LAMP = 'redstone_lamp';
const LEVER = 'lever';
const STONE_BUTTON = 'stone_button';
const OAK_BUTTON = 'oak_button';
const PISTON = 'piston';
const STICKY_PISTON = 'sticky_piston';
const PISTON_HEAD = 'piston_head';
const TNT = 'tnt';
const OAK_DOOR = 'oak_door';
const IRON_DOOR = 'iron_door';
const OAK_TRAPDOOR = 'oak_trapdoor';

const POWER_SOURCES = new Set([LEVER, STONE_BUTTON, OAK_BUTTON, REDSTONE_TORCH, REDSTONE_BLOCK]);
const POWER_CONSUMERS = new Set([REDSTONE_LAMP, PISTON, STICKY_PISTON, TNT, OAK_DOOR, IRON_DOOR, OAK_TRAPDOOR]);

export class RedstoneSystem {
  constructor(world) {
    this.world = world;
    this.poweredBlocks = new Map(); // "x,y,z" -> boolean
    this.pendingUpdates = new Set(); // 待处理的坐标
    this.buttonTimers = new Map(); // "x,y,z" -> 剩余激活时间
    this.onStateChange = null;    // 红石源状态回调 (x,y,z,on) => void，由 Game 注入（联机广播）
    this.onBlockDestroyed = null; // TNT 爆炸销毁方块回调 (x,y,z,def)，由 Game 注入（碎屑粒子）
  }

  key(x, y, z) { return `${x},${y},${z}`; }

  // 玩家右键交互：切换拉杆/按钮状态
  onBlockInteract(x, y, z, blockId) {
    const def = BlockRegistry.getById(blockId);
    if (!def) return false;
    
    if (def.name === LEVER) {
      const k = this.key(x, y, z);
      const current = this.poweredBlocks.get(k) || false;
      const next = !current;
      this.poweredBlocks.set(k, next);
      this.scheduleUpdate(x, y, z);
      if (this.onStateChange) this.onStateChange(x, y, z, next);
      return true;
    }
    
    if (def.name === STONE_BUTTON || def.name === OAK_BUTTON) {
      const k = this.key(x, y, z);
      this.poweredBlocks.set(k, true);
      this.buttonTimers.set(k, 1.0); // 1秒后自动关闭
      this.scheduleUpdate(x, y, z);
      if (this.onStateChange) this.onStateChange(x, y, z, true);
      return true;
    }
    
    return false;
  }

  // 联机远端红石源状态落地（lever/button 对齐，红石网络随之收敛）
  applyRemoteState(x, y, z, on) {
    const k = this.key(x, y, z);
    const bid = this.world.getBlock(x, y, z);
    const def = BlockRegistry.getById(bid);
    if (on) {
      this.poweredBlocks.set(k, true);
      if (def && (def.name === STONE_BUTTON || def.name === OAK_BUTTON)) {
        this.buttonTimers.set(k, 1.0);
      }
    } else {
      this.poweredBlocks.set(k, false);
      this.buttonTimers.delete(k);
    }
    this.scheduleUpdate(x, y, z);
  }

  // 安排红石更新（标记周围方块需要重新计算信号）
  scheduleUpdate(x, y, z) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          this.pendingUpdates.add(this.key(x + dx, y + dy, z + dz));
        }
      }
    }
    this.pendingUpdates.add(this.key(x, y, z));
  }

  // 获取方块的信号强度（0-15）
  getPower(x, y, z, excludeDir = null) {
    let maxPower = 0;
    
    // 检查6个相邻方块
    const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for (const [dx, dy, dz] of dirs) {
      if (excludeDir && dx === excludeDir[0] && dy === excludeDir[1] && dz === excludeDir[2]) continue;
      const bid = this.world.getBlock(x + dx, y + dy, z + dz);
      if (bid === 0) continue;
      const def = BlockRegistry.getById(bid);
      if (!def) continue;
      
      const k = this.key(x + dx, y + dy, z + dz);
      
      if (def.name === LEVER || def.name === STONE_BUTTON || def.name === OAK_BUTTON) {
        if (this.poweredBlocks.get(k)) maxPower = Math.max(maxPower, 15);
      } else if (def.name === REDSTONE_TORCH) {
        maxPower = Math.max(maxPower, 15);
      } else if (def.name === REDSTONE_BLOCK) {
        maxPower = Math.max(maxPower, 15);
      } else if (def.name === REDSTONE_WIRE) {
        const wirePower = this.poweredBlocks.get(k) ? 15 : 0;
        if (wirePower > 0) maxPower = Math.max(maxPower, wirePower - 1);
      }
    }
    
    return maxPower;
  }

  // 更新红石网络（每帧调用，处理 pendingUpdates）
  update(dt) {
    // 按钮计时器
    for (const [k, time] of this.buttonTimers) {
      const newTime = time - dt;
      if (newTime <= 0) {
        this.buttonTimers.delete(k);
        this.poweredBlocks.set(k, false);
        const [x, y, z] = k.split(',').map(Number);
        this.scheduleUpdate(x, y, z);
        if (this.onStateChange) this.onStateChange(x, y, z, false); // 按钮自动关闭也要广播
      } else {
        this.buttonTimers.set(k, newTime);
      }
    }
    
    if (this.pendingUpdates.size === 0) return;
    
    // BFS 传播红石信号
    const toProcess = [...this.pendingUpdates];
    this.pendingUpdates.clear();
    
    for (const k of toProcess) {
      const [x, y, z] = k.split(',').map(Number);
      const bid = this.world.getBlock(x, y, z);
      if (bid === 0) continue;
      const def = BlockRegistry.getById(bid);
      if (!def) continue;
      
      const k2 = this.key(x, y, z);
      
      if (def.name === REDSTONE_WIRE) {
        const power = this.getPower(x, y, z);
        const wasPowered = this.poweredBlocks.get(k2) || false;
        const isPowered = power > 0;
        if (wasPowered !== isPowered) {
          this.poweredBlocks.set(k2, isPowered);
          this.scheduleUpdate(x, y, z);
        }
      } else if (def.baseBlock === REDSTONE_LAMP) {
        // B28：红石灯 = 未充能本名 + `_lit` 两态方块（此前恒亮 light:15、充能与否无外观差别）
        const power = this.getPower(x, y, z);
        const wasPowered = this.poweredBlocks.get(k2) || false;
        const isPowered = power > 0;
        if (wasPowered !== isPowered) {
          this.poweredBlocks.set(k2, isPowered);
          this.setLampLit(x, y, z, isPowered);
          this.scheduleUpdate(x, y, z);
        }
      } else if (def.name === PISTON || def.name === STICKY_PISTON) {
        const power = this.getPower(x, y, z);
        const wasPowered = this.poweredBlocks.get(k2) || false;
        const isPowered = power > 0;
        if (wasPowered !== isPowered) {
          this.poweredBlocks.set(k2, isPowered);
          if (isPowered) {
            this.activatePiston(x, y, z, def.name === STICKY_PISTON);
          } else {
            this.retractPiston(x, y, z, def.name === STICKY_PISTON);
          }
        }
      } else if (def.name === TNT) {
        const power = this.getPower(x, y, z);
        if (power > 0) {
          this.detonateTNT(x, y, z);
        }
      } else if (def.part === 'door_lower' || def.part === 'door_upper' || def.part === 'trapdoor') {
        // B27：门/活板门状态家族（状态 = ID 家族，任意半格/朝向/开合态都响应）
        const power = this.getPower(x, y, z);
        const wasPowered = this.poweredBlocks.get(k2) || false;
        const isPowered = power > 0;
        if (isPowered && !wasPowered) {
          this.poweredBlocks.set(k2, true);
          this.toggleDoor(x, y, z);
        } else if (!isPowered && wasPowered) {
          this.poweredBlocks.set(k2, false);
        }
      }
    }
  }

  // 激活活塞（推出活塞头）
  activatePiston(x, y, z, sticky) {
    // 简化：不实际推动方块，只放置 piston_head
    const headId = BlockRegistry.getId('piston_head');
    // 检查上方是否为空
    const above = this.world.getBlock(x, y + 1, z);
    if (above === 0) {
      this.world.setBlock(x, y + 1, z, headId);
    }
  }

  // 收回活塞
  retractPiston(x, y, z, sticky) {
    const headId = BlockRegistry.getId('piston_head');
    const above = this.world.getBlock(x, y + 1, z);
    if (above === headId) {
      this.world.setBlock(x, y + 1, z, 0);
    }
    if (sticky) {
      // 粘性活塞拉回上方方块（简化：只拉一格）
      const aboveAbove = this.world.getBlock(x, y + 2, z);
      if (aboveAbove !== 0 && aboveAbove !== headId) {
        const def = BlockRegistry.getById(aboveAbove);
        if (def && !def.solid) return;
        this.world.setBlock(x, y + 2, z, 0);
        this.world.setBlock(x, y + 1, z, aboveAbove);
      }
    }
  }

  // B28：红石灯充能态切换（未充能本名 ⇄ `redstone_lamp_lit`）。方块 ID 即状态，
  // 落 World.setBlock（存档/联机账本/光照增量全路径收口）；light 15 只在充能态生效。
  setLampLit(x, y, z, lit) {
    const def = BlockRegistry.getById(this.world.getBlock(x, y, z));
    if (!def || def.baseBlock !== REDSTONE_LAMP) return false;
    if (def.lit === lit) return false;
    const nid = BlockRegistry.getId(lit ? `${REDSTONE_LAMP}_lit` : REDSTONE_LAMP);
    if (!nid) return false;
    this.world.setBlock(x, y, z, nid);
    return true;
  }

  // 切换门/活板门开合（B27：状态 = 方块 ID 家族；废除旧"删除方块表示打开"）
  toggleDoor(x, y, z) {
    const bid = this.world.getBlock(x, y, z);
    if (bid === 0) return false;
    const def = BlockRegistry.getById(bid);
    if (!def || !def.part) return false;
    if (def.part === 'trapdoor') {
      const nid = trapdoorId(def.facing, !def.open);
      if (!nid) return false;
      this.world.setBlock(x, y, z, nid);
      return true;
    }
    return this.setDoorOpen(x, y, z, !def.open);
  }

  // 把整扇门（上下半同步）切到目标开合态；从任一半的坐标调用均可。
  // 返回 true = 已切换（setBlock 落账本/联机自动同步）。
  setDoorOpen(x, y, z, open) {
    const def = BlockRegistry.getById(this.world.getBlock(x, y, z));
    if (!def || (def.part !== 'door_lower' && def.part !== 'door_upper')) return false;
    const yLower = def.part === 'door_upper' ? y - 1 : y;
    const lid = doorId(def.baseBlock, 'lower', def.facing, open);
    const uid = doorId(def.baseBlock, 'upper', def.facing, open);
    if (!lid || !uid) return false;
    this.world.setBlock(x, yLower, z, lid);
    this.world.setBlock(x, yLower + 1, z, uid);
    return true;
  }

  // TNT 爆炸
  detonateTNT(x, y, z) {
    // 移除 TNT 方块
    this.world.setBlock(x, y, z, 0);
    // 爆炸半径 4，破坏周围方块
    const radius = 4;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > radius) continue;
          const bx = x + dx, by = y + dy, bz = z + dz;
          const bid = this.world.getBlock(bx, by, bz);
          if (bid === 0) continue;
          const def = BlockRegistry.getById(bid);
          if (!def || def.hardness < 0) continue;
          // 连锁引爆其他 TNT
          if (def.name === TNT) {
            this.scheduleUpdate(bx, by, bz);
            this.poweredBlocks.set(this.key(bx, by, bz), true);
          } else {
            this.world.setBlock(bx, by, bz, 0);
            if (this.onBlockDestroyed) this.onBlockDestroyed(bx, by, bz, def); // 碎屑粒子出口（Game 注入）
          }
        }
      }
    }
    // 通知 Game 执行爆炸特效和伤害
    if (this.onExplosion) {
      this.onExplosion(x + 0.5, y + 0.5, z + 0.5, radius);
    }
  }

  // 检查方块是否被充能
  isPowered(x, y, z) {
    return this.poweredBlocks.get(this.key(x, y, z)) || false;
  }

  // 方块被放置或破坏时调用
  onBlockChange(x, y, z) {
    this.scheduleUpdate(x, y, z);
  }

  // 序列化状态（用于存档）
  serialize() {
    return {
      powered: Object.fromEntries(this.poweredBlocks),
      timers: Object.fromEntries(this.buttonTimers)
    };
  }

  deserialize(data) {
    if (!data) return;
    if (data.powered) {
      this.poweredBlocks = new Map(Object.entries(data.powered));
    }
    if (data.timers) {
      this.buttonTimers = new Map(Object.entries(data.timers));
    }
  }
}
