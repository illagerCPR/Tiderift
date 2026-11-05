// SaveSystem.js -- localStorage 多槽位存档系统
// V2：维度化——dimension（当前所处维度）+ dimensionBlocks/dimensionContainers
//（全维度方块/容器账本分桶）；V1 旧档读取时自动迁移进主世界桶
const SAVE_PREFIX = 'project-mc-save-';
const LEGACY_KEY = 'project-mc-save';
export const SAVE_VERSION = 2;
export const MAX_SAVE_SLOTS = 6;

// 存档对象规范化：V1 → V2 迁移 + 缺字段回落；版本不受支持返回 null。
// 单点收口——localStorage 加载与「导入存档」共用同一条迁移路径。
export function normalizeSaveData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const out = { ...data };
  if (!Array.isArray(out.blueprints)) out.blueprints = [];
  if (!out.ruins || typeof out.ruins !== 'object' || Array.isArray(out.ruins)) out.ruins = null; // 旧档缺字段 → reset(null) 回落空账本
  if (out.version === 1) {
    // V1 → V2 迁移：旧平铺字段归入主世界桶（内存中升级，不回写）
    out.version = SAVE_VERSION;
    out.dimension = 'overworld';
    out.dimensionBlocks = { overworld: out.modifiedBlocks || {} };
    out.dimensionContainers = { overworld: out.containers || {} };
    out.dimensionFurnaces = {}; // V1 无熔炉状态
  } else if (out.version !== SAVE_VERSION) {
    return null;
  }
  return out;
}

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
        waymarks: game.waymarks ? game.waymarks.serialize() : null,
        ruins: game.ruins ? game.ruins.serialize() : null, // 遗迹账本 + 领取记录（Build 35 D）
        races: game.races ? game.races.serialize() : null, // 御风赛道与个人最佳（Build 34 C）
        blueprints: game.blueprints ? game.blueprints.serializePersonal() : [],
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
      const data = normalizeSaveData(JSON.parse(raw));
      if (!data) console.warn(`存档槽 ${slot} 版本不匹配`);
      return data;
    } catch (e) {
      console.error('加载失败:', e);
      return null;
    }
  }

  // Build 43：导出——读原文 → 解析 → 规范化（V1 升 V2）；不可读/版本不支持返回 null
  static exportSlotRaw(slot) {
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + slot);
      if (!raw) return null;
      return normalizeSaveData(JSON.parse(raw));
    } catch (e) {
      console.error('导出失败:', e);
      return null;
    }
  }

  // Build 43：导入——把已净化的存档写回槽位（slot 字段改写为目标槽）
  // 成功返回 true；容量不足返回 'quota'；其它失败返回 'write-failed'
  static importData(slot, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'write-failed';
    try {
      localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify({ ...data, slot }));
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) return 'quota';
      console.error('导入失败:', e);
      return 'write-failed';
    }
  }

  // Build 43：槽位原文长度（字符数），供容量预检与摘要
  static rawSize(slot) {
    const raw = localStorage.getItem(SAVE_PREFIX + slot);
    return raw ? raw.length : 0;
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
