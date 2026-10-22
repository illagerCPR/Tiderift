// SaveSystem.js -- localStorage 多槽位存档系统
// V2：维度化——dimension（当前所处维度）+ dimensionBlocks/dimensionContainers
//（全维度方块/容器账本分桶）；V1 旧档读取时自动迁移进主世界桶
const SAVE_PREFIX = 'project-mc-save-';
const LEGACY_KEY = 'project-mc-save';
const SAVE_VERSION = 2;
export const MAX_SAVE_SLOTS = 6;

// Map<dim, Map> -> { dim: { "x,y,z": value } }
function serializeDimBuckets(store) {
  const o = {};
  for (const [dim, m] of store) o[dim] = Object.fromEntries(m);
  return o;
}

export class SaveSystem {
  static save(game, slot) {
    slot = slot ?? game.currentSlot ?? 1;
    try {
      const data = {
        version: SAVE_VERSION,
        slot,
        timestamp: Date.now(),
        seed: game.world.seed,
        dimension: game.world.dimension,
        gamemode: game.player.gamemode,
        cheatsEnabled: game.cheatsEnabled || false,
        biomeScale: game.biomeScale || 'small', // 群系规模档位（旧存档无字段 → 读侧回落 small）
        aetherDusk: !!game.aetherDusk, // 天域批次 D：复潮状态（旧存档无字段 → 读侧回落 false）
        player: {
          x: game.player.position.x,
          y: game.player.position.y,
          z: game.player.position.z,
          yaw: game.player.yaw,
          pitch: game.player.pitch,
          health: game.player.health,
          food: game.player.food,
          saturation: game.player.saturation,
          exhaustion: game.player.exhaustion,
          xp: game.player.xp,
          xpLevel: game.player.xpLevel,
          onFire: game.player.onFire,
          airTicks: game.player.airTicks
        },
        inventory: game.inventory.serialize(),
        dimensionBlocks: serializeDimBuckets(game.world.dimensionBlocks),
        dimensionContainers: serializeDimBuckets(game.world.dimensionContainers),
        dimensionFurnaces: serializeDimBuckets(game.world.dimensionFurnaces),
        dragonDefeated: !!game.world.dragonDefeated, // 末影龙击败标记（进末地是否再生成龙）
        finalePrimordial: game.world.finalePrimordial || null, // 候潮状态（终局篇 F1：祭坛坐标）
        finaleDone: !!game.world.finaleDone, // 听潮完成（终局篇 F3：仪式一次性门控）
        emblemWorn: !!game.player.emblemWorn, // 纹章佩戴（Build 19 K3：无敌/飞行/基岩心）
        bedSpawn: game.bedSpawn || null, // 床重生点（单机；含维度校验字段）
        redstone: game.redstone ? game.redstone.serialize() : null,
        journal: game.journal ? game.journal.serialize() : null,
        sky: { time: game.sky.time || 0 }
      };
      localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('保存失败:', e);
      return false;
    }
  }

  static load(slot) {
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + slot);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.version === 1) {
        // V1 → V2 迁移：旧平铺字段归入主世界桶（内存中升级，不回写）
        data.version = SAVE_VERSION;
        data.dimension = 'overworld';
        data.dimensionBlocks = { overworld: data.modifiedBlocks || {} };
        data.dimensionContainers = { overworld: data.containers || {} };
        data.dimensionFurnaces = {}; // V1 无熔炉状态
      } else if (data.version !== SAVE_VERSION) {
        console.warn(`存档槽 ${slot} 版本不匹配`);
        return null;
      }
      return data;
    } catch (e) {
      console.error('加载失败:', e);
      return null;
    }
  }

  static hasSave(slot) {
    return localStorage.getItem(SAVE_PREFIX + slot) !== null;
  }

  static deleteSave(slot) {
    localStorage.removeItem(SAVE_PREFIX + slot);
  }

  static listSaves() {
    SaveSystem._migrateLegacy();
    const list = [];
    for (let slot = 1; slot <= MAX_SAVE_SLOTS; slot++) {
      const raw = localStorage.getItem(SAVE_PREFIX + slot);
      if (!raw) { list.push({ slot, empty: true }); continue; }
      try {
        const data = JSON.parse(raw);
        list.push({
          slot, empty: false,
          gamemode: data.gamemode || 'creative',
          cheatsEnabled: !!data.cheatsEnabled,
          biomeScale: data.biomeScale || 'small',
          timestamp: data.timestamp || 0,
          seed: data.seed || 0,
          dimension: data.dimension || 'overworld',
          finaleDone: !!data.finaleDone // 通关标记（Build 19 K3：存档栏祝贺字样）
        });
      } catch {
        list.push({ slot, empty: true });
      }
    }
    return list;
  }

  static findEmptySlot() {
    const list = SaveSystem.listSaves();
    const first = list.find(s => s.empty);
    return first ? first.slot : null;
  }

  static autoSave(game) {
    return SaveSystem.save(game);
  }

  // 旧版单存档迁移到槽位 1
  static _migrateLegacy() {
    if (SaveSystem._migrated) return;
    SaveSystem._migrated = true;
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      if (localStorage.getItem(SAVE_PREFIX + '1')) return;
      localStorage.setItem(SAVE_PREFIX + '1', raw);
      localStorage.removeItem(LEGACY_KEY);
      console.log('已迁移旧版存档到槽位 1');
    } catch { /* ignore */ }
  }
}
