// MobManager.js -- 怪物管理：生成/更新/渲染/掉落物
import * as THREE from 'three';
import { Mob } from './Mob.js';
import { MobTypes, generateMobSkinSVGs, mobSkinUV, MOB_ATLAS } from './MobTextures.js';
import { SVGTextures } from '../render/SVGTextures.js';
import { EntityPhysics } from './EntityPhysics.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from '../core/Chunk.js';
import { villagerTradeSeed } from '../world/loot.js';
import { audio } from '../audio/AudioEngine.js';
import { DROP_HALF, makeShadowMesh, makeCountSprite, updateCountSprite, attachDropModel } from '../render/DropMesh.js';
import { applyEntityLight } from '../render/entityLight.js';
import { raySphereHit } from '../player/Raycast.js';
import { BLOCK_CENTER } from '../player/constants.js';

const MAX_MOBS = 20;
const MAX_PASSIVE = 12; // 被动动物上限（不含村民——村庄系统单独管理）
const SPAWN_INTERVAL = 2.5;
const DESPAWN_DISTANCE = 80;

const HIT_FLASH_DURATION = 0.25;   // 怪物受击红光持续时长（秒）
const HEALTH_BAR_FADE = 3.0;       // 怪物头顶血条淡出时长（秒）
const DEATH_ANIM_DURATION = 0.4;   // 死亡缩放动画时长（秒）
const HEALTH_BAR_WIDTH = 1.0;      // 血条世界坐标宽

// 下界自然生成表（纯函数便于单测）：要塞平台层烈焰人主导（仅此处生成）；
// 灵魂沙峡谷凋零骷髅加成 + 哭嚎者低空哀鸣（世界观批次 N3）；
// 其余下界荒地低频哭嚎者，以僵尸猪灵为主。主世界表见 trySpawn。
export function pickNetherSpawn(biome, inFortress, rand) {
  if (inFortress) {
    const r = rand();
    if (r < 0.70) return 'blaze';
    if (r < 0.90) return 'zombified_piglin';
    return 'wither_skeleton';
  }
  if (biome === 'soul_sand_valley') {
    const r = rand();
    if (r < 0.25) return 'mourn_howler'; // 峡谷 = 坠潮旧河道，哀鸣者聚居
    return rand() < 0.55 ? 'wither_skeleton' : 'zombified_piglin';
  }
  const r = rand();
  if (r < 0.12) return 'mourn_howler';  // 荒地低空低频
  return rand() < 0.15 ? 'wither_skeleton' : 'zombified_piglin';
}

// 天域自然生成表 V2（批次 B/D，纯函数便于单测）：永昼白天表——风灵全群系氛围底色；
// 水晶秘境 = 守卫 + 潮鸣（星髓看守）；银霜/翡翠/秋色 = 低频岚隼；神殿周边守卫主导（守箱巡逻）。
// 批次 D：复潮（dusk）后夜晚表——守卫/岚隼加成（长夜归还，威胁随黑暗回归）。
// 云绒兽走被动群生成分支（trySpawn aether 草地组，白天限定=天然夜间缩群），不进敌对表。
export function pickAetherSpawnV2(biome, nearTemple, isNight, rand) {
  if (nearTemple) return rand() < (isNight ? 0.70 : 0.55) ? 'aether_guard' : 'wisp';
  if (biome === 'crystal') {
    const r = rand();
    if (isNight) {
      if (r < 0.50) return 'aether_guard';
      if (r < 0.72) return 'tide_echo';
      return 'wisp';
    }
    if (r < 0.40) return 'aether_guard';
    if (r < 0.70) return 'tide_echo';
    return 'wisp';
  }
  if (biome === 'frost') {
    const r = rand();
    if (isNight) {
      if (r < 0.20) return 'aether_guard';
      if (r < 0.45) return 'gale_hawk';
      return 'wisp';
    }
    if (r < 0.10) return 'aether_guard';
    if (r < 0.22) return 'gale_hawk';
    return 'wisp';
  }
  const r = rand();
  if (isNight) return r < 0.18 ? 'gale_hawk' : 'wisp';
  return r < 0.08 ? 'gale_hawk' : 'wisp';
}

// 皮肤 atlas 各 face 的 col 索引映射（96×64 atlas：col 4=top，col 5=bottom 独立 cell，
// 不再复用 front/back——此前 top 复用 front cell 导致"脸贴在头顶"）
const FACE_COL = { front: 0, back: 1, left: 2, right: 3, top: 4, bot: 5 };

// 6 个 face 定义：
//   - corners：4 个顶点用 unit-cube [0/1, 0/1, 0/1] 描述，顺序为 [底,顶,底,顶]
//   - uvs：每个 corner 的 [u 选位, v 选位]（0=u0/v0，1=u1/v1）。
//     侧面统一 [[1,0],[1,1],[0,0],[0,1]]：u1 落在"观察者右侧"→ 从外看贴图不镜像；
//     top/bot 用 [[0,0],[1,0],[0,1],[1,1]]：u 随 x、v1 落在 -Z（背面朝上），俯视不镜像。
//     旧写法 `c<2?u0:u1` 把 u0 固定给前两个 corner，4 个侧面全部水平镜像，勿回退。
const SIDE_UVS = [[1, 0], [1, 1], [0, 0], [0, 1]];
const CAP_UVS = [[0, 0], [1, 0], [0, 1], [1, 1]];
const FACE_DEFS = [
  { name: 'right',  corners: [[1,0,0],[1,1,0],[1,0,1],[1,1,1]], uvs: SIDE_UVS }, // +X
  { name: 'left',   corners: [[0,0,1],[0,1,1],[0,0,0],[0,1,0]], uvs: SIDE_UVS }, // -X
  { name: 'top',    corners: [[0,1,1],[1,1,1],[0,1,0],[1,1,0]], uvs: CAP_UVS },  // +Y
  { name: 'bot',    corners: [[0,0,0],[1,0,0],[0,0,1],[1,0,1]], uvs: CAP_UVS },  // -Y
  { name: 'front',  corners: [[1,0,1],[1,1,1],[0,0,1],[0,1,1]], uvs: SIDE_UVS }, // +Z（脸朝向）
  { name: 'back',   corners: [[0,0,0],[0,1,0],[1,0,0],[1,1,0]], uvs: SIDE_UVS }, // -Z
];

export class MobManager {
  constructor(world, scene, atlasUV, atlasTexture) {
    this.world = world;
    this.scene = scene;
    this.atlasUV = atlasUV;
    this.atlasTexture = atlasTexture;
    this.mobs = [];
    this._bosses = []; // F10：type.boss 实体登记表（与 this.mobs 同步增删，getBosses() 零分配返回）
    this.physics = new EntityPhysics(world);
    this.spawnTimer = 0;
    this.mobSkins = generateMobSkinSVGs();
    this.mobMaterials = new Map();   // typeName -> master Material（含 master SkinTexture）
    this.mobGeometries = new Map();   // typeName -> master BufferGeometry（cuboid 合并）
    this.mobTextures = new Map();     // typeName -> master CanvasTexture（type 私有，dispose 时一并释放）
    this.droppedItems = [];
    this.pendingExplosions = [];
    this.frame = 0;
    this.spawnEnabled = true; // 联机阶段 0 关闭本地怪物生成
    this.onDropTaken = null;  // 联机拾取回调 (dropId) => void，由 Game 注入（通知服务器移除）
    this.getSelfId = null;    // 阶段10：返回本地玩家联机 id（归属锁判定），由 Game 注入；null=单机
    this.mobNet = null;       // 联机怪物事件接口（sendMobSpawn/sendMobAttack/sendMobDied），由 Game 注入
    this.onBlockDestroyed = null; // 爆炸销毁方块回调 (x,y,z,def)，由 Game 注入（碎屑粒子）
    this.isMultiplayer = false; // Build 10：联机时不做本地合并（掉落物是服务器账本实体，本地合并会两端分裂）
    this.mergeTimer = 0;        // 同类合并扫描节流（0.25s 一次，避免逐帧 O(n²)）
    this.spawnedVillages = new Set(); // 已生成村民的村庄锚点 key "ax,az"（本会话去重，死亡不重生）
    this.spawnedEndCities = new Set(); // 已生成潜影贝的末地城锚点 key（同上惯例）
    this.villageGolemSeen = new Map(); // Idea-2E：村庄铁傀儡最后存活时刻 key "ax,az"（死亡 60s 后补员）
  }

  // 异步初始化：mob 用私有 skin atlas，不再注入全局 atlas
  async init(svgMap) {
    // no-op：mob 皮肤 atlas 由本类的 buildMaterials 单独构建
  }

  // 构建怪物的 geometry + master material（每 type 的 skin texture 私有）
  async buildMaterials() {
    for (const typeName of Object.keys(MobTypes)) {
      const type = MobTypes[typeName];
      // 1. svg → image → canvas → texture（96×64，每 face 16×16 方形 cell × 6 列）
      const svg = this.mobSkins[typeName];
      const img = await SVGTextures.svgToImage(svg);
      const canvas = document.createElement('canvas');
      canvas.width = MOB_ATLAS.w;
      canvas.height = MOB_ATLAS.h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, MOB_ATLAS.w, MOB_ATLAS.h);
      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      this.mobTextures.set(typeName, tex);

      // 2. 用 parts 拼出 cuboid 的合并 BufferGeometry
      const positions = [];
      const uvs = [];
      const indices = [];
      let idx = 0;
      for (const part of type.model.parts) {
        const [minX, minY, minZ, maxX, maxY, maxZ] = part.box;
        const dimX = maxX - minX;
        const dimY = maxY - minY;
        const dimZ = maxZ - minZ;
        for (const fdef of FACE_DEFS) {
          const col = FACE_COL[fdef.name];
          const uv = mobSkinUV(part.row, col);
          // corners 用 unit [0/1] 缩放到 box 实际尺寸并偏移到 part 位置
          for (let c = 0; c < 4; c++) {
            const cx = fdef.corners[c][0];
            const cy = fdef.corners[c][1];
            const cz = fdef.corners[c][2];
            positions.push(minX + cx * dimX, minY + cy * dimY, minZ + cz * dimZ);
            // UV 按每面显式 uvs 表选位（保证从外看不镜像、v1=图像顶部朝上）
            const [us, vs] = fdef.uvs[c];
            uvs.push(us ? uv.u1 : uv.u0, vs ? uv.v1 : uv.v0);
          }
          // 两个三角形使用统一绕序 (0,1,2)(1,3,2)，保证每面两个三角形外法线一致，
          // 否则 computeVertexNormals 会平均出 ~0 法线 → Lambert 方向光失效（"同色纸片"）
          indices.push(idx, idx + 1, idx + 2, idx + 1, idx + 3, idx + 2);
          idx += 4;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      // 每面顶点不共享 → 生成平坦面法线（每面一个朝向），方向光据此做明暗（立体感关键）
      geo.computeVertexNormals();

      const mat = new THREE.MeshLambertMaterial({
        map: tex,
        side: THREE.DoubleSide,
        alphaTest: 0.5,
        transparent: false,
      });

      this.mobGeometries.set(typeName, geo);
      this.mobMaterials.set(typeName, mat);
    }
  }

  // 尝试生成怪物
  trySpawn(playerPos, isNight) {
    if (!this.spawnEnabled) return;
    // 敌对上限不含被动生物（村民/风灵数量由各自生成逻辑决定，不挤占敌对生成名额）
    let hostileCount = 0;
    for (const m of this.mobs) if (!m.type.passive) hostileCount++;
    if (hostileCount >= MAX_MOBS) return;

    // 在玩家周围 16~48 格内尝试
    const angle = Math.random() * Math.PI * 2;
    const dist = 16 + Math.random() * 32;
    const x = Math.floor(playerPos.x + Math.cos(angle) * dist);
    const z = Math.floor(playerPos.z + Math.sin(angle) * dist);

    // 找地表高度（下界等有基岩天花的维度从 spawnScanTop 之下扫描，避免落在天花上）。
    // 天花维度必须"下探穿悬挂体"：直接首个实心即停会命中天花顶面（y≈201 头部空间
    // 被实心拒绝）→ 实测 ~93% 列被拒、下界自然生成近乎不可能发生
    const scanTop = (this.world.dimDef && this.world.dimDef.spawnScanTop) || CHUNK_HEIGHT - 1;
    let y = -1;
    if (this.world.dimension === 'overworld') {
      for (let yy = scanTop; yy >= 1; yy--) {
        const id = this.world.getBlock(x, yy, z);
        if (id !== 0) {
          const def = BlockRegistry.getById(id);
          if (def && def.solid) {
            y = yy + 1;
            break;
          }
        }
      }
    } else {
      let yy = scanTop;
      const solidAt = (v) => {
        const id = this.world.getBlock(x, v, z);
        if (id === 0) return false;
        const def = BlockRegistry.getById(id);
        return !!(def && def.solid);
      };
      while (yy >= 1) {
        if (solidAt(yy)) { yy--; continue; }        // 实心体内：继续下探
        while (yy >= 1 && !solidAt(yy)) yy--;       // 空气段：下行到首个实心
        if (yy >= 1) y = yy + 1;                    // 立足面（上方是刚走过的空气）
        break;
      }
    }
    if (y < 1 || y >= CHUNK_HEIGHT) return;

    // 上方必须有空间
    const headId = this.world.getBlock(x, y + 1, z);
    if (headId !== 0) return;

    // 被动动物（牛/羊/鸡）：白天草地成群生成，不挤敌对名额（独立上限）
    // 天域（批次 B）：云绒兽群——翡翠/秋色草地（云絮来源），同款被动名额
    if ((this.world.dimension === 'overworld' || this.world.dimension === 'aether') && !isNight &&
        this.world.getBlock(x, y - 1, z) === BlockRegistry.getId('grass_block') &&
        this._passiveCount() < MAX_PASSIVE && Math.random() < 0.5) {
      const group = this.world.dimension === 'aether'
        ? 'cloud_lamb'
        : ['cow', 'sheep', 'chicken'][Math.floor(Math.random() * 3)];
      this._spawnAt(group, x + BLOCK_CENTER, y, z + BLOCK_CENTER);
      const n = 2 + Math.floor(Math.random() * 2); // 2-3 只小群
      for (let i = 1; i < n; i++) {
        this._spawnAt(group, x + BLOCK_CENTER + (Math.random() * 6 - 3), y, z + BLOCK_CENTER + (Math.random() * 6 - 3));
      }
      return;
    }

    // 亮度检查（简化：夜晚生成）；天域永昼不受白天海拔门限制（岛面 y 恒高于海平面）
    if (!isNight && y > SEA_LEVEL + 5 && this.world.dimension !== 'aether') return;

    // 末地：末影人盘踞（主岛/外岛立地面均可）
    if (this.world.dimension === 'end') {
      if (Math.random() < 0.5) this._spawnAt('enderman', x + BLOCK_CENTER, y, z + BLOCK_CENTER);
      return;
    }

    // 选择怪物类型：下界走下界表（烈焰人仅要塞平台层），天域走永昼表，主世界走昼夜表
    let typeName;
    if (this.world.dimension === 'nether') {
      const gen = this.world.generator;
      const biome = typeof gen.getBiome === 'function' ? gen.getBiome(x, z) : null;
      const rec = this._fortressAt(x, z);
      const atLevel = rec && y >= rec.groundY - 1 && y <= rec.groundY + 8;
      typeName = pickNetherSpawn(biome, !!(rec && atLevel), Math.random);
    } else if (this.world.dimension === 'aether') {
      const gen = this.world.generator;
      const biome = typeof gen.getBiome === 'function' ? gen.getBiome(x, z) : null;
      // 批次 D：复潮后夜晚表（isNight 由调用方传入——永昼期恒 false）
      typeName = pickAetherSpawnV2(biome, !!this._aetherTempleAt(x, z), !!isNight, Math.random);
    } else {
      const choices = isNight
        ? (Math.random() < 0.1 ? ['enderman'] : ['zombie', 'zombie', 'skeleton', 'creeper', 'spider'])
        : ['spider', 'zombie'];
      typeName = choices[Math.floor(Math.random() * choices.length)];
    }

    this._spawnAt(typeName, x + BLOCK_CENTER, y, z + BLOCK_CENTER);
  }

  // 在指定坐标生成（trySpawn 尾部 + 被动动物群生成共用；联机走 mobNet 广播惯例）
  _spawnAt(typeName, wx, wy, wz) {
    const mob = new Mob(typeName, this.world);
    mob.position.set(wx, wy, wz);
    if (this.mobNet) {
      // 联机：host 端生成 → 广播 mob_spawn，实体由广播回执创建（各端同 id 一致）
      this.mobNet.sendMobSpawn(typeName, mob.position.x, mob.position.y, mob.position.z);
    } else {
      this.spawnMob(mob);
    }
  }

  // 被动动物计数（不含村民——村民由村庄生成系统单独管理；不含铁傀儡——村庄护卫单独补员）
  _passiveCount() {
    let n = 0;
    for (const m of this.mobs) {
      if (m.type && m.type.passive && m.typeName !== 'villager' && m.typeName !== 'iron_golem' && !m.dead) n++;
    }
    return n;
  }

  // 末影人受击瞬移：±16 格随机落点，向下扫首个"实心+2 格净空"；8 次尝试失败原地不动
  _teleportMob(mob) {
    for (let t = 0; t < 8; t++) {
      const x = Math.floor(mob.position.x) + Math.floor(Math.random() * 33 - 16);
      const z = Math.floor(mob.position.z) + Math.floor(Math.random() * 33 - 16);
      for (let y = Math.min(CHUNK_HEIGHT - 3, Math.floor(mob.position.y) + 12); y >= 1; y--) {
        const id = this.world.getBlock(x, y, z);
        const def = id ? BlockRegistry.getById(id) : null;
        if (def && def.solid &&
            this.world.getBlock(x, y + 1, z) === 0 && this.world.getBlock(x, y + 2, z) === 0) {
          mob.position.set(x + BLOCK_CENTER, y + 1, z + BLOCK_CENTER);
          mob.velocity.set(0, 0, 0);
          return true;
        }
      }
    }
    return false;
  }

  // 位置所在下界要塞记录（bbox 判定；烈焰人生成门控/单测共用）。
  // recordsAround 按需重求解抗 LRU 驱逐（与村民生成同惯例）。
  _fortressAt(x, z) {
    if (this.world.dimension !== 'nether') return null;
    const sm = this.world.generator && this.world.generator.structureManager;
    if (!sm) return null;
    for (const rec of sm.recordsAround('fortress', x, z, 1)) {
      if (x >= rec.minX && x <= rec.maxX && z >= rec.minZ && z <= rec.maxZ) return rec;
    }
    return null;
  }

  // 位置所在天域神殿记录（bbox 判定；守卫守箱巡逻门控/单测共用）——recordsAround 抗 LRU
  _aetherTempleAt(x, z) {
    if (this.world.dimension !== 'aether') return null;
    const sm = this.world.generator && this.world.generator.structureManager;
    if (!sm) return null;
    for (const rec of sm.recordsAround('aether_temple', x, z, 1)) {
      if (x >= rec.minX && x <= rec.maxX && z >= rec.minZ && z <= rec.maxZ) return rec;
    }
    return null;
  }

  // 由服务器 mob_spawn 广播创建怪物实体（host 权威生成，各端据此创建；去重防重连重复）
  // tradeSeed：T5 村民交易表种子（广播透传；缺省时 spawnMob 内按出生点哈希兜底）
  createMobFromNet(netId, typeName, x, y, z, tradeSeed) {
    if (this.mobs.some(m => m.netId === netId)) return;
    if (!MobTypes[typeName]) return;
    const mob = new Mob(typeName, this.world);
    mob.netId = netId;
    mob.position.set(x, y, z);
    if (typeof tradeSeed === 'number') mob.tradeSeed = tradeSeed >>> 0;
    this.spawnMob(mob);
  }

  findMobByNetId(netId) {
    for (const m of this.mobs) if (m.netId === netId) return m;
    return null;
  }

  // 最近怪物查询（同类型）：敌对索敌村民 / 村民逃敌共用
  findNearestMob(pos, range, typeName) {
    let best = null;
    let bestDist = range;
    for (const m of this.mobs) {
      if (m.dead || m.typeName !== typeName) continue;
      const d = m.position.distanceTo(pos);
      if (d < bestDist) { best = m; bestDist = d; }
    }
    return best;
  }

  // 怪物攻击怪物（僵尸/骷髅咬村民）：伤害+受击反馈+击退；死亡走 update 通用链
  //（mob.dead → diedHandled → sendMobDied 广播 / dropLoot——村民 drops 为空不掉落）
  mobAttackMob(attacker, victim) {
    if (victim.dead) return;
    victim.health -= attacker.attackDamage;
    victim.hitFlash = HIT_FLASH_DURATION;
    if (victim.healthBarSprite) {
      victim.healthBarFadeTimer = HEALTH_BAR_FADE;
      victim.healthBarSprite.visible = true;
      if (victim.healthBarSprite.material) victim.healthBarSprite.material.opacity = 1;
      this._updateHealthBar(victim);
    }
    const dx = victim.position.x - attacker.position.x;
    const dz = victim.position.z - attacker.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.001) {
      // Idea-2E：铁傀儡大击退（原版把怪打上天）——水平/垂直都加倍
      const golem = attacker.typeName === 'iron_golem';
      victim.knockback.x += (dx / d) * (golem ? 12 : 6);
      victim.knockback.z += (dz / d) * (golem ? 12 : 6);
      victim.knockback.y += golem ? 7 : 3;
    }
    if (victim.health <= 0) victim.dead = true;
  }

  // 村庄村民生成：就近村庄记录 → 确定性点位（meta.villagerSpawns）生成村民。
  // 单机直接 spawnMob；联机走 mobNet（host 权威广播，实体由回执创建，与 trySpawn 同惯例）。
  // 注意用 recordsAround（按需重求解）而非 recordsNear——后者只读缓存，记录可能被 LRU 挤出。
  updateVillageSpawns(player) {
    if (!this.world || !player) return;
    const sm = this.world.generator && this.world.generator.structureManager;
    if (!sm) return;

    if (this.spawnEnabled) {
      // 生成仅 host/单机：客户端 spawnEnabled=false 跳过（防与 host 广播双生成），
      // 其村民经 mob_spawn 回执创建，home 由下方补挂逻辑本地确定性还原
      const records = sm.recordsAround('village', player.position.x, player.position.z)
        .filter(rec => {
          const dx = Math.max(rec.minX - player.position.x, 0, player.position.x - rec.maxX);
          const dz = Math.max(rec.minZ - player.position.z, 0, player.position.z - rec.maxZ);
          return dx * dx + dz * dz <= 80 * 80;
        });
      for (const rec of records) {
        const key = rec.ax + ',' + rec.az;
        if (this.spawnedVillages.has(key)) continue;
        this.spawnedVillages.add(key);

        const spawns = rec.meta.villagerSpawns || [];
        const houseCount = (rec.meta.houses && rec.meta.houses.length) || 2;
        const count = Math.min(spawns.length, Math.max(2, houseCount));
        for (let i = 0; i < count; i++) {
          const [x, y, z] = spawns[i];
          if (this.mobNet) {
            this.mobNet.sendMobSpawn('villager', x, y + 0.1, z, villagerTradeSeed(rec.ax, rec.az, i));
          } else {
            const mob = new Mob('villager', this.world);
            mob.position.set(x, y + 0.1, z);
            mob.home = { x: rec.ax, z: rec.az, radius: 24 };
            mob.tradeSeed = villagerTradeSeed(rec.ax, rec.az, i); // T5：与广播一致，两端同表
            this.spawnMob(mob);
          }
        }

        // Idea-2E：村庄护卫（铁傀儡）——存活村民≥5 且该村庄无存活护卫时补员；
        // 死亡后 60s 补员（villageGolemSeen 记录最后存活时刻），村庄卸载清记录立即补员
        const golemAlive = this.mobs.some(m =>
          m.typeName === 'iron_golem' && !m.dead && !m.dyingAnim &&
          m.home && m.home.x === rec.ax && m.home.z === rec.az);
        if (golemAlive) {
          this.villageGolemSeen.set(rec.ax + ',' + rec.az, performance.now() / 1000);
        } else {
          const villagersHere = this.mobs.filter(m =>
            m.typeName === 'villager' && !m.dead && m.home &&
            m.home.x === rec.ax && m.home.z === rec.az).length;
          const seen = this.villageGolemSeen.get(rec.ax + ',' + rec.az) || 0;
          if (villagersHere >= 5 && performance.now() / 1000 - seen >= 60) {
            const gs = rec.meta.villagerSpawns || [];
            if (gs.length) {
              const [gx, gy, gz] = gs[0];
              if (this.mobNet) {
                this.mobNet.sendMobSpawn('iron_golem', gx + 2, gy + 0.1, gz);
              } else {
                const golem = new Mob('iron_golem', this.world);
                golem.position.set(gx + 2, gy + 0.1, gz);
                golem.home = { x: rec.ax, z: rec.az, radius: 24 };
                this.spawnMob(golem);
              }
            }
          }
        }
      }
    }

    // 随村清扫：村庄卸载（玩家离开 ~120 格）→ 其村民一并移除并解除生成标记，
    // 回村时随区块重载重新生成（村庄生命周期 = 区块生命周期）；村庄铁傀儡同款
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if ((m.typeName !== 'villager' && m.typeName !== 'iron_golem') || !m.home) continue;
      const hd = Math.hypot(m.home.x - player.position.x, m.home.z - player.position.z);
      if (hd > 120) {
        this._removeMobResources(m);
        this._untrackBoss(m);
        this.mobs.splice(i, 1);
        this.spawnedVillages.delete(m.home.x + ',' + m.home.z);
        if (m.typeName === 'iron_golem') this.villageGolemSeen.delete(m.home.x + ',' + m.home.z);
      }
    }

    // 远端创建的村民/铁傀儡补挂 home（mob_spawn 回执创建时村庄记录可能尚未缓存；记录确定性一致，
    // 各端最终收敛到同一锚点）
    if (this.mobs.length > 0) {
      const nearRecs = sm.recordsAround('village', player.position.x, player.position.z);
      for (const m of this.mobs) {
        if ((m.typeName !== 'villager' && m.typeName !== 'iron_golem') || m.home || m.dead) continue;
        const rec = nearRecs.find(r =>
          Math.hypot(r.ax - m.position.x, r.az - m.position.z) < 96);
        if (rec) m.home = { x: rec.ax, z: rec.az, radius: 24 };
      }
    }
  }

  // 末地城潜影贝生成：meta.shulkerSpawns 确定性点位，去重 spawnedEndCities；
  // 卸载清扫（>200 格）全端执行（防客户端残留漂移实体，与村民清扫同惯例）
  updateEndCitySpawns(player) {
    if (!this.world || !player || this.world.dimension !== 'end') return;
    const sm = this.world.generator && this.world.generator.structureManager;
    if (!sm) return;

    if (this.spawnEnabled) {
      const records = sm.recordsAround('end_city', player.position.x, player.position.z)
        .filter(rec => Math.hypot(rec.ax - player.position.x, rec.az - player.position.z) <= 160);
      for (const rec of records) {
        const key = rec.ax + ',' + rec.az;
        if (this.spawnedEndCities.has(key)) continue;
        this.spawnedEndCities.add(key);
        const spawns = rec.meta.shulkerSpawns || [];
        for (const [x, y, z] of spawns) {
          if (this.mobNet) {
            this.mobNet.sendMobSpawn('shulker', x, y + 0.1, z);
          } else {
            const mob = new Mob('shulker', this.world);
            mob.position.set(x, y + 0.1, z);
            mob.home = { x: rec.ax, z: rec.az, radius: 48 };
            this.spawnMob(mob);
          }
        }
      }
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (m.typeName !== 'shulker' || !m.home) continue;
      const hd = Math.hypot(m.home.x - player.position.x, m.home.z - player.position.z);
      if (hd > 200) {
        this._removeMobResources(m);
        this._untrackBoss(m);
        this.mobs.splice(i, 1);
        this.spawnedEndCities.delete(m.home.x + ',' + m.home.z);
      }
    }
  }

  // 其它端攻击：本端同步扣血 + 受击反馈 + 位置校正（减少各端 AI 漂移）
  applyRemoteMobAttack(netId, damage, x, y, z) {
    const mob = this.findMobByNetId(netId);
    if (!mob || mob.dead) return;
    mob.health = Math.max(0, mob.health - damage);
    mob.hitFlash = HIT_FLASH_DURATION;
    // 血条显示 + 立即刷新
    if (mob.healthBarSprite) {
      mob.healthBarFadeTimer = HEALTH_BAR_FADE;
      mob.healthBarSprite.visible = true;
      if (mob.healthBarSprite.material) mob.healthBarSprite.material.opacity = 1;
      this._updateHealthBar(mob);
    }
    // 位置校正：向攻击者端位置对齐
    mob.position.set(x, y, z);
    const dist = this._playerPos ? this._playerPos.distanceTo(mob.position) : 10;
    audio.mobHurt(mob.typeName, dist); // A-②：远端同步伤害也播受击音
    if (mob.health <= 0) {
      mob.dead = true;
      audio.mobDeath(mob.typeName, dist);
      // 远端攻击致死：死亡广播与掉落由攻击端负责，本端只播死亡动画
      mob.diedHandled = true;
      mob.remoteDeath = true;
      this._fireDragonDefeated(mob);
    }
  }

  // 击杀端广播 mob_died：本端同步死亡（不产掉落、不重复广播）
  applyRemoteMobDeath(netId) {
    const mob = this.findMobByNetId(netId);
    if (!mob || mob.dead) return;
    mob.dead = true;
    mob.diedHandled = true;
    mob.remoteDeath = true;
    this._fireDragonDefeated(mob);
  }

  // 末影龙击败事件（本地死亡链 + 两个远端入口共用，幂等防重）
  // 回调由 Game 注入：M2 默认置 world.dragonDefeated；M3 接管为激活返回门+生成折跃门
  _fireDragonDefeated(mob) {
    if (mob.typeName !== 'dragon' || mob.dragonDefeatedFired) return;
    mob.dragonDefeatedFired = true;
    if (this.onDragonDefeated) this.onDragonDefeated(mob);
  }

  spawnMob(mob) {
    const geo = this.mobGeometries.get(mob.typeName);
    const mat = this.mobMaterials.get(mob.typeName);
    if (!geo || !mat) return;

    // T5：村民交易种子兜底（正常路径已在生成处赋值；此为旧广播/命令面板生成村民的兜底）
    if (mob.typeName === 'villager' && mob.tradeSeed == null) {
      mob.tradeSeed = villagerTradeSeed(Math.floor(mob.position.x), Math.floor(mob.position.z), 0);
    }

    // 每只怪独享一份 material（emissive 是 per-mob 状态，clone 即可）
    const matInst = mat.clone();
    mob.mesh = new THREE.Mesh(geo, matInst);
    // L4-B：怪入 shadow pass 并接收影子（Lambert 原生支持 receiveShadow，零注入）
    mob.mesh.castShadow = true;
    mob.mesh.receiveShadow = true;
    this.scene.add(mob.mesh);

    // 头顶血条 sprite（默认隐藏）
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 8;
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    const spriteMat = new THREE.SpriteMaterial({
      map: tex,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(HEALTH_BAR_WIDTH, 0.12, 1);
    sprite.renderOrder = 1000;
    sprite.visible = false;
    this.scene.add(sprite);

    mob.healthBarCanvas = cv;
    mob.healthBarCtx = ctx;
    mob.healthBarTex = tex;
    mob.healthBarSprite = sprite;
    mob.healthBarFadeTimer = 0;

    this.mobs.push(mob);
    // F10：Boss 登记（spawnMob 是全仓唯一的 this.mobs.push 入列点）
    if (mob.type && mob.type.boss) this._bosses.push(mob);
  }

  // 重绘 mob 头顶血条 canvas（每受击一次调一次）
  _updateHealthBar(mob) {
    const ctx = mob.healthBarCtx;
    const cv = mob.healthBarCanvas;
    const w = cv.width;
    const h = cv.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(1, 1, w - 2, h - 2);
    const ratio = Math.max(0, mob.health / mob.maxHealth);
    const barW = Math.round((w - 2) * ratio);
    if (barW > 0) {
      // 颜色随血量从绿 → 黄 → 红
      let r, g, b;
      if (ratio > 0.5) {
        const t = (ratio - 0.5) * 2;
        r = Math.round(220 * (1 - t) + 60 * t);
        g = Math.round(220 * (1 - t) + 220 * t);
        b = 30;
      } else {
        const t = ratio * 2;
        r = 220;
        g = Math.round(60 * (1 - t) + 60 * t);
        b = 30;
      }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(1, 1, barW, h - 2);
    }
    mob.healthBarTex.needsUpdate = true;
  }

  // 更新所有怪物
  update(dt, player, sky) {
    this._playerPos = player ? player.position : null; // A-②：怪物音效距离衰减用
    this.frame++;
    this.spawnTimer -= dt;
    const isNight = sky ? sky.isNight() : false;

    // 村庄村民生成（host/单机权威；去重由 spawnedVillages 保证，村民死亡本会话不重生）
    this.updateVillageSpawns(player);

    // 末地城潜影贝生成（host/单机权威；随城清扫全端执行）
    this.updateEndCitySpawns(player);

    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      this.trySpawn(player.position, isNight);
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];

      // 死亡动画播放阶段：跳过 AI、原地累积动画进度后销毁
      if (mob.dyingAnim) {
        mob.dyingAnim.progress += dt;
        const t = Math.min(1, mob.dyingAnim.progress / mob.dyingAnim.total);
        if (mob.mesh) {
          const scale = Math.max(0.05, 1 - t);
          mob.mesh.scale.setScalar(scale);
          mob.mesh.rotation.y += dt * 8;
          // 渐隐 + 红光淡出
          const mm = mob.mesh.material;
          if (mm) {
            mm.transparent = true;
            mm.opacity = 1 - t;
            if (!mm.emissive) mm.emissive = new THREE.Color();
            mm.emissive.setRGB(0.9, 0.1, 0.1);
            mm.emissiveIntensity = (1 - t) * 0.6;
          }
        }
        if (mob.healthBarSprite) mob.healthBarSprite.visible = false;
        if (t >= 1) {
          this._removeMobResources(mob);
          this._untrackBoss(mob);
          this.mobs.splice(i, 1);
        }
        continue;
      }

      // 普通帧
      mob.update(dt, player, sky, this.physics, this);

      // 体素光染色：按怪物所在格光照（max(天光×昼夜, 方块光)）调制 material 颜色，
      // 洞穴里变暗、火把旁带暖色；受击/死亡的 emissive 反馈走独立通道不冲突。
      // Build 22：公式抽到 render/entityLight.js 单一来源（玩家模型共用同一套）
      if (mob.mesh && this.world) {
        applyEntityLight(this.world, sky, mob.mesh.position, mob.mesh);
      }

      // 处理爆炸请求
      if (mob.pendingExplosion) {
        this.pendingExplosions.push(mob.pendingExplosion);
        mob.pendingExplosion = null;
      }

      // 更新 mesh 位置 + 旋转
      const mesh = mob.mesh;
      if (mesh) {
        mesh.position.copy(mob.position);
        mesh.rotation.y = mob.yaw;

        const mm = mesh.material;
        if (mm) {
          // 受击红光/燃烧火光临时覆盖 emissive；常态 emissive 由 applyEntityLight 的
          // 方块光辉光每帧重写（Build 22），故不再无条件清零
          if (mob.hitFlash > 0) {
            mob.hitFlash -= dt;
            if (!mm.emissive) mm.emissive = new THREE.Color();
            mm.emissive.setRGB(0.85, 0.05, 0.05);
            mm.emissiveIntensity = Math.max(0, mob.hitFlash / HIT_FLASH_DURATION) * 0.9;
          } else if (mob.isBurning) {
            if (!mm.emissive) mm.emissive = new THREE.Color();
            mm.emissive.setRGB(1.0, 0.27, 0.0);
            mm.emissiveIntensity = 0.5;
          }
        }
      }

      // 头顶血条 fade 计时 + 位置跟随
      if (mob.healthBarSprite) {
        if (mob.healthBarFadeTimer > 0) {
          mob.healthBarFadeTimer -= dt;
          const remaining = mob.healthBarFadeTimer;
          const sprite = mob.healthBarSprite;
          sprite.visible = remaining > 0;
          if (sprite.visible) {
            sprite.position.set(
              mob.position.x,
              mob.position.y + mob.height + 0.35,
              mob.position.z
            );
            // 末 1 秒透明渐隐
            if (remaining < 1.0) {
              sprite.material.opacity = remaining;
              sprite.material.transparent = true;
            } else {
              sprite.material.opacity = 1;
              sprite.material.transparent = true;
            }
          }
        } else {
          mob.healthBarSprite.visible = false;
        }
      }

      // 死亡：击杀端产出掉落 + 广播；触发死亡动画（而非立刻移除）
      const dist = mob.position.distanceTo(player.position);
      if (mob.dead) {
        this._fireDragonDefeated(mob);
        if (!mob.diedHandled) {
          mob.diedHandled = true; // 只处理一次（防多端重复广播/重复掉落）
          if (mob.netId != null && this.mobNet) this.mobNet.sendMobDied(mob.netId);
          if (!mob.remoteDeath) {
            this.dropLoot(mob); // 击杀端（本地死亡）才产掉落；远端死亡由击杀端产出
            // XP：同掉落口径（击杀端 + 玩家 5 秒内命中过）；远端死亡由击杀端结算
            const xp = mob.type && mob.type.xp ? mob.type.xp : 0;
            if (xp && mob.playerHitAt && Date.now() - mob.playerHitAt < 5000 && this.onMobXpAward) {
              this.onMobXpAward(mob, xp);
            }
          }
        }
        mob.dyingAnim = { progress: 0, total: DEATH_ANIM_DURATION };
        if (mob.healthBarSprite) mob.healthBarSprite.visible = false;
      } else if (dist > DESPAWN_DISTANCE && mob.typeName !== 'villager' && !mob.type.boss) {
        // 被卸载而非死亡：直接清理（村民不在此清理——村庄绑定生物由 updateVillageSpawns
        // 的随村清扫管理，否则逃敌被拖远会掏空村庄；批次 C：Boss 免清除——80 格静态清除
        // 半径会把走远找玩家的守誓巨像/龙/凋灵直接抹掉，Boss 只经死亡链移除）
        this._removeMobResources(mob);
        this._untrackBoss(mob);
        this.mobs.splice(i, 1);
      }
    }

    // 处理爆炸
    this.processExplosions();

    // 更新掉落物
    this.updateDroppedItems(dt, player);
  }

  // 释放 mob 占用的所有 Three 资源（mesh + 血条 sprite）
  _removeMobResources(mob) {
    if (mob.mesh) {
      this.scene.remove(mob.mesh);
      // material 是 per-mob 实例，释放；geometry 是 type 共享，不动
      if (mob.mesh.material) mob.mesh.material.dispose();
    }
    if (mob.healthBarSprite) {
      this.scene.remove(mob.healthBarSprite);
      if (mob.healthBarSprite.material) mob.healthBarSprite.material.dispose();
      if (mob.healthBarTex) mob.healthBarTex.dispose();
      mob.healthBarSprite = null;
      mob.healthBarTex = null;
      mob.healthBarCanvas = null;
      mob.healthBarCtx = null;
    }
  }

  // F10：Boss 出列登记（死亡动画结束 / 随村清扫 / 末地城清扫 / dispose 全路径共用）
  _untrackBoss(mob) {
    if (!mob.type || !mob.type.boss) return;
    const i = this._bosses.indexOf(mob);
    if (i >= 0) this._bosses.splice(i, 1);
  }

  // F10：当前 Boss 列表（返回内部数组，零分配；调用方只读）
  getBosses() {
    return this._bosses;
  }

  processExplosions() {
    while (this.pendingExplosions.length > 0) {
      const exp = this.pendingExplosions.shift();
      const r = exp.radius;
      // 破坏方块
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dz = -r; dz <= r; dz++) {
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d > r) continue;
            const bx = Math.floor(exp.x + dx);
            const by = Math.floor(exp.y + dy);
            const bz = Math.floor(exp.z + dz);
            const id = this.world.getBlock(bx, by, bz);
            if (id !== 0) {
              const def = BlockRegistry.getById(id);
              if (def && def.hardness >= 0 && def.name !== 'bedrock') {
                this.world.setBlock(bx, by, bz, 0);
                if (this.onBlockDestroyed) this.onBlockDestroyed(bx, by, bz, def); // 碎屑粒子出口（Game 注入）
              }
            }
          }
        }
      }
    }
  }

  dropLoot(mob) {
    const type = mob.type;
    for (const drop of type.drops) {
      const chance = drop.chance ?? 1;
      if (Math.random() < chance) {
        const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
        if (count > 0) {
          this.spawnDrop(mob.position, drop.name, count);
        }
      }
    }
    if (type.rareDrop && Math.random() < type.rareDrop.chance) {
      this.spawnDrop(mob.position, type.rareDrop.name, 1);
    }
  }

  spawnDrop(pos, name, count, data = null, opts = {}) {
    const drop = {
      id: null, // 联机掉落物才有服务器分配的 id
      name,
      count,
      data, // Idea-2C：内容跟随物品（潜影盒 27 槽数组；普通物品 null）
      position: pos.clone().add(new THREE.Vector3(0, 0.5, 0)),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        3,
        (Math.random() - 0.5) * 2
      ),
      age: 0,
      // Build 10：拾取延迟分级（方块破坏 0.5s / 怪物掉落 1.0s 默认 / 玩家 Q 丢弃 2.0s）
      pickupDelay: opts.pickupDelay != null ? opts.pickupDelay : 1.0,
      mesh: null,
      spin: Math.floor(this._strHash(name) * 6.28), // 自旋初相（按名字散列，同种错开）
    };
    if (opts.velocity) drop.velocity.copy(opts.velocity); // Q 丢弃等指定初速（视线方向）
    this._createDropMesh(drop);
    this.droppedItems.push(drop);
    return drop;
  }

  // 由服务器广播 drop_spawn 创建掉落物：id 服务器唯一；速度缺省由 id 确定性派生，各端运动一致
  // 阶段10：owner/ownerLockMs = 死亡掉落归属锁（锁定期内仅 owner 本人可拾取）
  // Build 10：vel = {x,y,z} 可选真实初速（Q 丢弃透传），缺省仍走 id 哈希派生（向后兼容）
  spawnRemoteDrop(id, x, y, z, name, count, owner = null, ownerLockMs = 0, data = null, vel = null) {
    if (this.droppedItems.some(d => d.id === id)) return; // 去重（重连回放可能重复广播）
    const drop = {
      id,
      name,
      count,
      data, // Idea-2C：内容跟随物品
      position: new THREE.Vector3(x, y, z),
      velocity: vel && Number.isFinite(vel.x) && Number.isFinite(vel.y) && Number.isFinite(vel.z)
        ? new THREE.Vector3(vel.x, vel.y, vel.z)
        : new THREE.Vector3(
          (this._hashRand(id) - 0.5) * 2,
          3,
          (this._hashRand(id * 2 + 1) - 0.5) * 2
        ),
      age: 0,
      pickupDelay: 1.0,
      mesh: null,
      spin: Math.floor(this._hashRand(id * 3 + 2) * 6.28),
      owner: owner || null,
      lockedUntil: owner && ownerLockMs > 0 ? Date.now() + ownerLockMs : 0,
    };
    this._createDropMesh(drop);
    this.droppedItems.push(drop);
  }

  // 阶段10：记录本地已发起拾取的远程掉落物（全量拾取并已上报 drop_taken 的）
  // 服务器归属锁拒绝（drop_deny）时凭此记录从背包扣回，配合补发 drop_spawn 重建实体
  recordPendingPickup(id, name, count, data = null) {
    if (!this._pendingPickup) this._pendingPickup = new Map();
    this._pendingPickup.set(id, { name, count, data });
    if (this._pendingPickup.size > 64) {
      // 防御性清理：只保留最近 32 条
      const keys = [...this._pendingPickup.keys()].slice(0, this._pendingPickup.size - 32);
      for (const k of keys) this._pendingPickup.delete(k);
    }
  }

  // 阶段10：取回并删除拾取记录（deny 回滚用；无记录返回 null）
  takePendingPickup(id) {
    if (!this._pendingPickup) return null;
    const info = this._pendingPickup.get(id) || null;
    this._pendingPickup.delete(id);
    return info;
  }

  // 按 id 移除掉落物（drop_taken 广播落地），找不到则忽略
  removeDropById(id) {
    for (let i = this.droppedItems.length - 1; i >= 0; i--) {
      const d = this.droppedItems[i];
      if (d.id === id) {
        if (d.mesh) this.scene.remove(d.mesh);
        this.droppedItems.splice(i, 1);
        return;
      }
    }
  }

  // 确定性伪随机 [0,1)，由整数 id 派生（联机各端掉落物初速度一致）
  _hashRand(n) {
    let h = (n * 2654435761) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  // 字符串散列 [0,1)（掉落物自旋初相等视觉随机，无需联机一致）
  _strHash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return (h >>> 0) / 4294967296;
  }

  // Build 10：掉落物渲染组 = 模型（贴图小方块/像素挤出，自旋+浮动）+ 阴影贴片 + 数量角标
  // 模板异步就绪（缓存后即时），resolve 时自检 drop 仍存活（可能已被拾取/岩浆销毁）
  _createDropMesh(drop) {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(DROP_HALF * 2); // 模型尺寸归一 1 → 缩放 0.25
    group.add(inner);
    attachDropModel(inner, drop.name).then((ok) => {
      if (!ok && drop.mesh === group && inner.children.length === 0) {
        // 兜底：模板构建失败（未知物品）→ 半透明灰小方块，避免隐形
        const fb = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshLambertMaterial({ color: 0x999999, transparent: true, opacity: 0.75 })
        );
        inner.add(fb);
      }
    });
    drop.shadow = makeShadowMesh();
    group.add(drop.shadow);
    if (drop.count > 1) {
      drop.countSprite = makeCountSprite(drop.count);
      group.add(drop.countSprite);
    }
    group.position.copy(drop.position);
    drop.mesh = group;
    drop.inner = inner;
    this.scene.add(group);
  }

  updateDroppedItems(dt, player) {
    for (let i = this.droppedItems.length - 1; i >= 0; i--) {
      const drop = this.droppedItems[i];
      drop.age += dt;
      drop.pickupDelay = Math.max(0, drop.pickupDelay - dt);

      // 流体判定（身体所在格）
      const bodyDef = BlockRegistry.getById(this.world.getBlock(
        Math.floor(drop.position.x), Math.floor(drop.position.y + 0.05), Math.floor(drop.position.z)));
      // 岩浆销毁（原版：掉落物入岩浆即焚；联机销毁端上报 drop_taken 清账本，防幽灵拾取）
      if (bodyDef && bodyDef.fluidType === 'lava') {
        if (drop.mesh) this.scene.remove(drop.mesh);
        this.droppedItems.splice(i, 1);
        if (drop.id != null && this.onDropTaken) this.onDropTaken(drop.id);
        continue;
      }
      const inWater = !!(bodyDef && bodyDef.fluidType === 'water');

      // 重力/浮力：水中强阻尼向上趋近 2.2 m/s（终端沉降 -2.5，入水快速减速漂浮）；空气 -32
      if (inWater) {
        drop.velocity.y += (2.2 - drop.velocity.y) * 10 * dt;
        if (drop.velocity.y < -2.5) drop.velocity.y = -2.5;
        const wf = Math.max(0, 1 - 4 * dt);
        drop.velocity.x *= wf;
        drop.velocity.z *= wf;
      } else {
        drop.velocity.y += -32 * dt;
      }

      // 逐轴点级碰撞（半径=模型半边）；高速细分步防穿薄地板
      const r = DROP_HALF;
      const solidAt = (x, y, z) => {
        const d = BlockRegistry.getById(this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
        return !!(d && d.solid);
      };
      const maxV = Math.max(Math.abs(drop.velocity.x), Math.abs(drop.velocity.y), Math.abs(drop.velocity.z));
      const steps = Math.min(4, Math.max(1, Math.ceil((maxV * dt) / 0.2)));
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        // Y：下落触底（高速轻微弹跳 + 落地摩擦）/ 上升撞头
        const ny = drop.position.y + drop.velocity.y * sdt;
        if (drop.velocity.y < 0 && solidAt(drop.position.x, ny - r, drop.position.z)) {
          drop.position.y = Math.floor(ny - r) + 1 + r;
          drop.velocity.y = drop.velocity.y < -8 ? -drop.velocity.y * 0.18 : 0;
          const f = Math.max(0, 1 - 8 * sdt);
          drop.velocity.x *= f;
          drop.velocity.z *= f;
        } else if (drop.velocity.y > 0 && solidAt(drop.position.x, ny + r, drop.position.z)) {
          drop.velocity.y = 0;
        } else {
          drop.position.y = ny;
        }
        // X / Z：侧碰（前向偏移 + 两侧角采样）
        const half = r * 0.9, yLow = drop.position.y - r * 0.5;
        const nx = drop.position.x + drop.velocity.x * sdt;
        const sx = Math.sign(drop.velocity.x) * half;
        if (drop.velocity.x !== 0 &&
            (solidAt(nx + sx, yLow, drop.position.z - half) || solidAt(nx + sx, yLow, drop.position.z + half))) {
          drop.velocity.x = 0;
        } else {
          drop.position.x = nx;
        }
        const nz = drop.position.z + drop.velocity.z * sdt;
        const sz = Math.sign(drop.velocity.z) * half;
        if (drop.velocity.z !== 0 &&
            (solidAt(drop.position.x - half, yLow, nz + sz) || solidAt(drop.position.x + half, yLow, nz + sz))) {
          drop.velocity.z = 0;
        } else {
          drop.position.z = nz;
        }
      }

      // 渲染：自旋 + 触地正弦浮动 + 阴影贴片跟随地面
      if (drop.mesh) {
        drop.mesh.position.copy(drop.position);
        if (drop.inner) {
          drop.spin += dt * 2.2;
          drop.inner.rotation.y = drop.spin;
          drop.inner.position.y = Math.abs(drop.velocity.y) < 0.01 ? Math.sin(drop.age * 2.5) * 0.04 : 0;
        }
        if (drop.shadow) {
          const bx = Math.floor(drop.position.x), bz = Math.floor(drop.position.z);
          let gy = -1;
          for (let yy = Math.floor(drop.position.y - r - 0.01); yy >= Math.floor(drop.position.y) - 4 && yy >= 0; yy--) {
            if (solidAt(bx, yy, bz)) { gy = yy + 1; break; }
          }
          drop.shadow.visible = gy >= 0;
          if (gy >= 0) drop.shadow.position.y = gy - drop.position.y + 0.02;
        }
      }

      // 拾取/磁吸（原版：1.6 格内吸附飞向玩家，0.9 格入包）
      const dist = drop.position.distanceTo(player.position);
      if (drop.pickupDelay <= 0) {
        // 阶段10：死亡掉落归属锁——锁定期内仅 owner 本人可拾取（服务器侧同校验兜底）
        const selfId = this.getSelfId ? this.getSelfId() : null;
        const locked = drop.lockedUntil && Date.now() < drop.lockedUntil && drop.owner !== selfId;
        if (!locked) {
          if (dist < 0.9 && this.onPickup) {
            // onPickup 返回未放入的剩余数量（0 = 全部拾取）
            const remaining = this.onPickup(drop.name, drop.count, drop.data);
            const pickedCount = drop.count - remaining;
            drop.count = remaining;
            if (remaining <= 0) {
              // 全部拾取
              if (drop.mesh) this.scene.remove(drop.mesh);
              this.droppedItems.splice(i, 1);
              if (drop.id != null && this.onDropTaken) {
                this.recordPendingPickup(drop.id, drop.name, pickedCount, drop.data); // 阶段10：留档供 deny 回滚
                this.onDropTaken(drop.id); // 联机：通知服务器移除
              }
              audio.pop();
              continue;
            }
            updateCountSprite(drop.countSprite, drop.count); // 部分拾取：刷新角标（剩 1 时隐藏）
            audio.pop();
          } else if (dist < 1.6 && this.onPickup) {
            // 磁吸：向玩家匀速飞（覆盖物理速度，原版吸附观感）
            const dir = new THREE.Vector3().subVectors(player.position, drop.position).normalize();
            drop.velocity.copy(dir).multiplyScalar(6.5);
            drop.velocity.y += 1.0; // 玩家锚点在脚部，略上抬补偿
          }
        }
      }

      // 5 分钟后消失
      if (drop.age > 300) {
        if (drop.mesh) this.scene.remove(drop.mesh);
        this.droppedItems.splice(i, 1);
      }
    }

    // 同类合并（仅单机：联机掉落物是服务器账本实体，本地合并会两端分裂）——0.25s 节流防逐帧 O(n²)
    this.mergeTimer += dt;
    if (!this.isMultiplayer && this.mergeTimer >= 0.25) {
      this.mergeTimer = 0;
      const items = this.droppedItems;
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        if (a.pickupDelay > 0 || a.data || a.count >= 64) continue;
        for (let j = items.length - 1; j > i; j--) {
          const b = items[j];
          if (b.name !== a.name || b.data || b.pickupDelay > 0) continue;
          if (a.position.distanceToSquared(b.position) > 1.44) continue; // 1.2 格内
          const take = Math.min(b.count, 64 - a.count);
          a.count += take;
          b.count -= take;
          if (b.count <= 0) {
            if (b.mesh) this.scene.remove(b.mesh);
            items.splice(j, 1);
          } else {
            updateCountSprite(b.countSprite, b.count);
          }
          updateCountSprite(a.countSprite, a.count);
          if (a.count >= 64) break;
        }
      }
    }
  }

  // 玩家攻击怪物。opts.provoke=false（Build 20 ④：创造玩家）时命中仍生效（伤害/击退/
  // 受击反馈）但不设置激怒——怪物不会以创造玩家为敌，激怒态失去意义。
  attackMob(rayOrigin, rayDir, maxDist, damage, opts = {}) {
    let closest = null;
    let closestDist = maxDist;
    for (const mob of this.mobs) {
      if (mob.dead || mob.dyingAnim) continue;
      // 球体射线检测（F6：共享纯函数，标量入参零分配）
      // cy = position.y + height/2 = 身体中点，与旧式 "oc = origin - position; oc.y -= height/2" 等价
      const t = raySphereHit(rayOrigin.x, rayOrigin.y, rayOrigin.z,
        rayDir.x, rayDir.y, rayDir.z,
        mob.position.x, mob.position.y + mob.height * 0.5, mob.position.z,
        Math.max(mob.width, mob.height) * 0.5);
      if (t < 0 || t > closestDist) continue;
      closestDist = t;
      closest = mob;
    }
    if (closest) {
      // 直接改血量（不走 Entity.damage 的无敌帧检查，玩家攻击不卡无敌期）
      closest.health -= damage;
      closest.playerHitAt = Date.now(); // 玩家击杀判定（5 秒内死亡 → XP 归属玩家）
      if (closest.health <= 0) {
        closest.health = 0;
        closest.dead = true;
      }
      // 末影人受击瞬移（60% 概率，原版风味）
      if (closest.typeName === 'enderman' && Math.random() < 0.6) this._teleportMob(closest);
      // 中立生物被激怒：激怒 25s + 16 格内同族共同激怒（僵尸猪灵群怒，原版行为）
      const provoke = opts.provoke !== false;
      if (provoke && closest.type && closest.type.neutral) {
        closest.aggro = true;
        closest.aggroTimer = 25;
        for (const m of this.mobs) {
          if (m === closest || m.dead || m.typeName !== closest.typeName) continue;
          if (m.position.distanceTo(closest.position) < 16) {
            m.aggro = true;
            m.aggroTimer = 25;
          }
        }
      }
      // Idea-2E：铁傀儡被玩家攻击 → 激怒追击攻击者（20s，guardian AI 消费）
      if (provoke && closest.type && closest.type.guardian) {
        closest.aggro = true;
        closest.aggroTimer = 20;
      }
      // 受击红光
      closest.hitFlash = HIT_FLASH_DURATION;
      // A-②：受击/死亡音（死亡在扣血处判）
      const sndDist = this._playerPos ? this._playerPos.distanceTo(closest.position) : 10;
      audio.mobHurt(closest.typeName, sndDist);
      if (closest.dead) audio.mobDeath(closest.typeName, sndDist);
      // 显示头顶血条 + 立即刷新
      if (closest.healthBarSprite) {
        closest.healthBarFadeTimer = HEALTH_BAR_FADE;
        closest.healthBarSprite.visible = true;
        if (closest.healthBarSprite.material) closest.healthBarSprite.material.opacity = 1;
        this._updateHealthBar(closest);
      }
      // 击退（强化版：水平 6.5、上抛 5，更接近原版击退距离）；Boss（龙/凋灵）免疫击退
      if (!closest.type.boss) {
        closest.knockback.add(rayDir.clone().multiplyScalar(6.5));
        closest.knockback.y = 5;
      }
      // 联机：上报攻击事件（含位置校正），其它端同步扣血/受击/对齐位置
      if (closest.netId != null && this.mobNet) {
        this.mobNet.sendMobAttack(closest.netId, damage, closest.position.x, closest.position.y, closest.position.z);
      }
      return true;
    }
    return false;
  }

  // 天域批次 B：潮鸣——玩家挖掘星髓矿石时，16 格内潮鸣激怒 25s + 同族一层传播
  //（末影人 attackMob 群怒模式换触发器：盗掘者的第一课）
  angerTideEchoes(x, y, z) {
    const center = new THREE.Vector3(x, y, z);
    const angered = [];
    for (const mob of this.mobs) {
      if (mob.dead || mob.dyingAnim || mob.typeName !== 'tide_echo') continue;
      if (mob.position.distanceTo(center) < 16) {
        mob.aggro = true;
        mob.aggroTimer = 25;
        angered.push(mob);
      }
    }
    for (const src of angered) {
      for (const m of this.mobs) {
        if (m.dead || m.dyingAnim || m.typeName !== 'tide_echo' || m.aggro) continue;
        if (m.position.distanceTo(src.position) < 16) {
          m.aggro = true;
          m.aggroTimer = 25;
        }
      }
    }
  }

  // 仅查找屏幕中央射线命中的最近怪物（不伤害）。返回 { mob, distance } 或 null。
  findMobByRay(rayOrigin, rayDir, maxDist) {
    let closest = null;
    let closestDist = maxDist;
    for (const mob of this.mobs) {
      if (mob.dead || mob.dyingAnim) continue;
      // 球体射线检测（F6：与 attackMob 共用 raySphereHit；cy = 身体中点）
      const t = raySphereHit(rayOrigin.x, rayOrigin.y, rayOrigin.z,
        rayDir.x, rayDir.y, rayDir.z,
        mob.position.x, mob.position.y + mob.height * 0.5, mob.position.z,
        Math.max(mob.width, mob.height) * 0.5);
      if (t < 0 || t > closestDist) continue;
      closestDist = t;
      closest = mob;
    }
    return closest ? { mob: closest, distance: closestDist } : null;
  }

  dispose() {
    // 释放每只 mob 的 per-instance 资源（mesh + 血条）——单一实现 _removeMobResources（F8）
    for (const mob of this.mobs) this._removeMobResources(mob);
    // 释放 type 级共享资源（master geometry + master material + skin texture）
    for (const [name, geo] of this.mobGeometries) geo.dispose();
    this.mobGeometries.clear();
    for (const [name, mat] of this.mobMaterials) {
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
    this.mobMaterials.clear();
    this.mobTextures.clear();
    // 释放掉落物 mesh
    for (const drop of this.droppedItems) {
      if (drop.mesh) {
        this.scene.remove(drop.mesh);
        if (drop.mesh.geometry) drop.mesh.geometry.dispose();
        if (drop.mesh.material) drop.mesh.material.dispose();
      }
    }
    this.mobs = [];
    this._bosses = [];
    this.droppedItems = [];
    this._pendingPickup = new Map(); // 阶段10：拾取留档随世界销毁一并清空
  }
}
