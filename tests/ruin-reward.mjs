// tests/ruin-reward.mjs -- B35 D 阶段 2：遗迹奖励（纪念方块/铭牌/蓝图）与领取去重回归（纯 node）
// 覆盖：纪念方块注册与三面纹理 / 蓝图体素表合法性与上限 / 奖励副本不可污染缓存 /
//       Blueprints.addPersonalUnique 去重 / Ruins 领取账本单向与往返 / 奖励链路的"只发一次"语义 /
//       动态 i18n 键（机关名与蓝图名）在 10 个语言包里齐全 / 奖励蓝图可进 E 的材料统计 /
//       解封写入的联机链路（applyUnlock 逐格走 World.setBlock → onLocalBlockChange 上报钩子）
import { readFileSync } from 'node:fs';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import {
  RUIN_KINDS, RUIN_KIND_LABEL, RUIN_REWARD_BLOCK, RUIN_REWARD_PLAQUE,
  RUIN_REWARD_BLUEPRINT_ID, RUIN_REWARD_BLUEPRINT_NAME, RUIN_LIMIT,
  ruinKey, ruinReward, ruinPuzzle, applyUnlock,
} from '../src/core/Ruins.js';
import { World } from '../src/core/World.js';
import { posKey } from '../src/core/posKey.js';
import { Blueprints, validateBlueprint, decodeBlueprintRLE, calculateBlueprintMaterials } from '../src/core/Blueprints.js';
import { BlockSVGDefinitions } from '../src/blocks/BlockDefs.js';
import { zhTW } from '../src/i18n/locales/zh-TW.js';
import { en } from '../src/i18n/locales/en.js';
import { fr } from '../src/i18n/locales/fr.js';
import { de } from '../src/i18n/locales/de.js';
import { ja } from '../src/i18n/locales/ja.js';
import { ko } from '../src/i18n/locales/ko.js';
import { ar } from '../src/i18n/locales/ar.js';
import { ru } from '../src/i18n/locales/ru.js';
import { es } from '../src/i18n/locales/es.js';
import { pt } from '../src/i18n/locales/pt.js';
import { ok, finish, configure } from './harness.mjs';

configure({ verbose: true });

const PACKS = { 'zh-TW': zhTW, en, fr, de, ja, ko, ar, ru, es, pt };

// ── 一、纪念方块与铭牌注册（末尾追加、三面纹理齐全）──────────────────────
{
  const names = [...RUIN_KINDS.map((k) => RUIN_REWARD_BLOCK[k]), RUIN_REWARD_PLAQUE];
  for (const name of names) {
    const def = BlockRegistry.getByName(name);
    ok(!!def, name + ' 已注册');
    if (!def) continue;
    ok(def.id > 0, name + ' 方块 id 非 0');
    ok(!!def.displayName && def.displayName !== name, name + ' 有中文 displayName');
    // BlockRegistry 把显式 textures 规整成 top/side/bottom 三个纹理键；三者互不相同 = 真的传了多面 textures
    ok(def.top !== def.side && def.side !== def.bottom, name + ' 三面纹理互不相同（显式 textures，非单名回落）');
    for (const face of ['top', 'side', 'bottom']) {
      ok(!!def[face] && !!BlockSVGDefinitions[def[face]], name + ' ' + face + ' 纹理有对应 SVG');
    }
  }
  // ID 追加纪律：纪念方块只能排在既存末尾（race_post 之后），不得插进中部
  const racePost = BlockRegistry.getId('race_post');
  ok(names.every((n) => BlockRegistry.getId(n) > racePost), '纪念方块全部追加在 race_post 之后（ID 零漂移）');
  const all = BlockRegistry.all();
  ok(all[all.length - 1].name === RUIN_REWARD_PLAQUE, '铭牌是当前最后一个注册的方块', all[all.length - 1].name);
}

// ── 二、奖励蓝图：合法性、上限、可解码 ─────────────────────────────────
{
  for (const kind of RUIN_KINDS) {
    const reward = ruinReward(kind);
    ok(!!reward && !!reward.blueprint, kind + ' 奖励蓝图可生成');
    if (!reward) continue;
    const bp = reward.blueprint;
    const checked = validateBlueprint(bp);
    ok(checked.ok, kind + ' 奖励蓝图通过 validateBlueprint', checked.reason);
    if (!checked.ok) continue;
    ok(bp.id === RUIN_REWARD_BLUEPRINT_ID[kind], kind + ' 蓝图 id 由固定表决定');
    ok(bp.name === RUIN_REWARD_BLUEPRINT_NAME[kind], kind + ' 蓝图名由固定表决定');
    ok(bp.byId === '' && bp.rev === 1, kind + ' 蓝图是个人集合形态（byId 空、修订 1）');
    ok(bp.size.x <= 16 && bp.size.y <= 16 && bp.size.z <= 16, kind + ' 边长 ≤ 16', JSON.stringify(bp.size));
    const nonAir = checked.voxels.filter((id) => id !== 0).length;
    ok(nonAir <= 1024, kind + ' 实例数 ≤ 1024', String(nonAir));
    ok(bp.palette[0] === 0, kind + ' 调色板以空气 0 打头');
    ok(bp.data.length <= 16384, kind + ' RLE 串在 16KB 内', String(bp.data.length));
    const decoded = decodeBlueprintRLE(bp.data, bp.palette, checked.volume);
    ok(!!decoded && decoded.every((v, i) => v === checked.voxels[i]), kind + ' RLE 往返逐格一致');
    // 蓝图能被 E 的材料清单统计（玩家拿到就能照着建）
    const materials = calculateBlueprintMaterials(bp, { slots: [] });
    ok(materials.ok && materials.materials.length > 0, kind + ' 奖励蓝图可被材料清单统计');
    ok(materials.materials.every((m) => m.missing === m.needed), kind + ' 空背包时全部计入缺失');
    // 纪念物与铭牌是奖励的其余两项
    ok(reward.block === RUIN_REWARD_BLOCK[kind] && reward.plaque === RUIN_REWARD_PLAQUE, kind + ' 奖励三件套齐全');
  }
  ok(ruinReward('end_city') === null, '未知机关类型返回 null');
  ok(ruinReward('tide_sluice', '自定义名').blueprint.name === '自定义名', '可传入自定义蓝图名（i18n 走 t()）');
}

// ── 三、奖励对象是副本：改它不能污染缓存 ───────────────────────────────
{
  const a = ruinReward('tide_sluice');
  a.blueprint.size.x = 1;
  a.blueprint.palette.length = 0;
  const b = ruinReward('tide_sluice');
  ok(b.blueprint.size.x === 7 && b.blueprint.palette.length > 1, '奖励返回副本，缓存不被外部改写');
}

// ── 四、Blueprints.addPersonalUnique：同名/同 id 去重 ───────────────────
{
  const set = new Blueprints();
  const bp = ruinReward('ember_circuit').blueprint;
  ok(set.addPersonalUnique(bp) === true, '首次发放进个人集合');
  ok(set.personal.length === 1, '个人集合 1 张');
  ok(set.addPersonalUnique(bp) === false, '同 id 同名的重复发放被拒（重复解开不重复塞）');
  const renamed = { ...bp, name: '换个名字' };
  ok(set.addPersonalUnique(renamed) === false, '同 id 不同名仍被拒');
  const sameName = { ...bp, id: 'otherid001' };
  ok(set.addPersonalUnique(sameName) === false, '不同 id 同名也被拒（换语言后同名不同串不会重复塞）');
  ok(set.personal.length === 1, '去重后个人集合仍为 1 张');
  // 官方上限内可继续收别的机关奖励
  ok(set.addPersonalUnique(ruinReward('frame_rack').blueprint) === true, '其他机关的蓝图可继续入集');
  ok(set.personal.length === 2, '个人集合 2 张');
}

// ── 五、Ruins 领取账本：单向、上限、序列化往返与旧档回落 ─────────────────
{
  const key = ruinKey('overworld', 'tide_sluice', 1008, -2032);
  const { Ruins } = await import('../src/core/Ruins.js');
  const ruins = new Ruins(null);
  ok(ruins.isClaimed(key) === false, '未领取');
  ok(ruins.markClaimed(key, 'Alice', 1234) === true, '首次领取记账');
  ok(ruins.isClaimed(key) === true, '领取后记账成立');
  ok(ruins.markClaimed(key, 'Bob', 5678) === false, '同一处机关重复领取被拒（单向）');
  ok(ruins.claimEntry(key).byName === 'Alice' && ruins.claimEntry(key).at === 1234, '领取记录保留首个领取者与时间');
  ok(ruins.markClaimed('bad-key') === false, '非法键拒绝');
  const restored = new Ruins(null).reset(ruins.serialize());
  ok(restored.isClaimed(key), '序列化往返保留领取记录');
  ok(new Ruins(null).reset({ ruins: {} }).isClaimed(key) === false, '旧档缺 claims 字段回落为空（不崩）');
  ok(new Ruins(null).reset({ ruins: {}, claims: { 'bad-key': { byName: 'x' } } }).claims.size === 0, '非法领取键被丢弃');
  const capped = new Ruins(null);
  for (let i = 0; i < RUIN_LIMIT + 3; i++) capped.markClaimed(ruinKey('overworld', 'tide_sluice', i, 0), '', 0);
  ok(capped.claims.size === RUIN_LIMIT, '领取记录上限 ' + RUIN_LIMIT, String(capped.claims.size));
  capped.clear();
  ok(capped.claims.size === 0, 'clear 一并清空领取记录');
}

// ── 六、奖励链路「只发一次」语义（与 Game._grantRuinReward 同款门控）────
{
  const { Ruins } = await import('../src/core/Ruins.js');
  const ruins = new Ruins(null);
  const set = new Blueprints();
  let blocks = 0;
  const grant = (key) => {
    if (ruins.isClaimed(key)) return false;
    const parsed = { kind: key.split('|')[1] };
    const reward = ruinReward(parsed.kind);
    if (!reward) return false;
    ruins.markClaimed(key);
    blocks += 2; // 纪念方块 + 铭牌
    set.addPersonalUnique(reward.blueprint);
    return true;
  };
  const key = ruinKey('aether', 'frame_rack', 17, 19);
  ok(grant(key) === true, '首次领取发放纪念物与蓝图');
  ok(grant(key) === false, '重复领取不发第二次（服务器/本地账本同口径）');
  ok(grant(ruinKey('nether', 'ember_circuit', -3, 8)) === true, '不同机关可各领一次');
  ok(blocks === 4, '两次领取共 4 件纪念方块/铭牌', String(blocks));
  ok(set.personal.length === 2, '两张蓝图分别入集');
  ok(set.personal.every((bp) => validateBlueprint(bp).ok), '入集蓝图全部合法');
}

// ── 七、动态 i18n 键：机关名/蓝图名/方块 lore 在 10 包里齐全 ─────────────
{
  // 机关名、蓝图名与方块 lore 都走"动态键"路径（t(表[key]) / 方块 lore 审计），静态扫描看不见
  const dynamic = [...Object.values(RUIN_KIND_LABEL), ...Object.values(RUIN_REWARD_BLUEPRINT_NAME)];
  for (const name of [...RUIN_KINDS.map((k) => RUIN_REWARD_BLOCK[k]), RUIN_REWARD_PLAQUE]) {
    const def = BlockRegistry.getByName(name);
    if (def && Array.isArray(def.lore)) dynamic.push(...def.lore);
  }
  for (const [loc, pack] of Object.entries(PACKS)) {
    for (const key of dynamic) {
      ok(Object.prototype.hasOwnProperty.call(pack, key), '[' + loc + '] 动态键已本地化: ' + key);
    }
  }
}

// ── 八、解封写入的联机链路：applyUnlock 必须逐格走 World.setBlock ─────────
// 联机同步不靠协议字段，靠 World.setBlock 末尾的 onLocalBlockChange 钩子（NetworkManager.bindWorld
// 把它接到 sendBlock → 服务器方块账本 + 广播）。谁绕开 setBlock 直接写 chunk，门就只在本地开。
{
  const world = new World(20250903);
  const seen = [];
  world.onLocalBlockChange = (x, y, z, id) => seen.push([x, y, z, id]); // 替身：bindWorld 接的就是这个钩子
  const P = ruinPuzzle(20250903, 'overworld', 'tide_sluice', 1016, 70, -2032);
  ok(!!P && P.unlock.length === 9, '潮闸房门体 3×3 = 9 格解封', String(P && P.unlock.length));
  const writes = applyUnlock(world, P);
  ok(writes === P.unlock.length, 'applyUnlock 逐格写入', String(writes));
  ok(seen.length === writes, '每一次解封写入都触发 onLocalBlockChange（联机上报钩子）', seen.length + '/' + writes);
  ok(seen.every(([x, y, z, id]) => world.getBlock(x, y, z) === id), '写入后世界读回与写入值一致');
  ok(P.unlock.every((u) => world.modifiedBlocks.get(posKey(u.x, u.y, u.z)) === u.id), '解封格同步进入 modifiedBlocks 账本（重连回放两侧一致）');
  // 反向绊线：钩子接点与"唯一写入口"都要在源码里钉住
  const netSrc = readFileSync(new URL('../src/net/NetworkManager.js', import.meta.url), 'utf8');
  ok(/world\.onLocalBlockChange\s*=/.test(netSrc), 'NetworkManager.bindWorld 仍把 onLocalBlockChange 接到方块上报');
  const ruinSrc = readFileSync(new URL('../src/core/Ruins.js', import.meta.url), 'utf8');
  ok(!/\.chunk\.set\(|chunk\.set\(/.test(ruinSrc), 'Ruins 不直接写 chunk（唯一写入口是 world.setBlock）');
}

finish();
