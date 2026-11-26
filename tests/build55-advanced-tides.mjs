// build55-advanced-tides.mjs -- Build 55 R2 四潮进阶（数据 / 配方 / 存档与协议 / 安全边界）
// 纯 node，不依赖服务器。断言：
//   ① 数据表：四支进阶法术各挂一个 handler（复用基础施法函数）、专属进阶焦点、
//      费用与冷却都高于基础版（基础版不被取代）、都有蓄力上限
//   ② 配方：一枚回响残片 + 一支基础焦点 → 该潮进阶焦点；只认魔法内容，关闭魔法合不出
//   ③ 物品：ID 147~150 钉值、stack 1、lore 1 行、十一语名字、十语 lore 与潮护提示
//   ④ 协议与存档：sanitizeCast 接受进阶法术与 18 格落点（仍拒 >22）、冷却清洗认进阶 ID、
//      冷却计算按进阶法术自己的秒数
//   ⑤ 安全边界：烬环溅射只挑怪物（纯函数真值表 + 源码只调 damageMobsNear，不碰玩家伤害）、
//      PvP 封顶仍以基础烬矢满蓄为准、进阶表里没有任何地形/水位/时间/传送门字段
//   ⑥ 源码绊线：handler 分派、缓降上限由法术给、音色族映射、溅射方法接线
import { readFileSync } from 'fs';
import {
  SPELLS, SPELL_IDS, ADVANCED_SPELLS, ADVANCED_SPELL_IDS, ALL_SPELLS, FOCUS_SPELL,
  spellDef,
  GALE_FOCUS_ITEM, EMBER_FOCUS_ITEM, RAIN_FOCUS_ITEM, TIDELESS_FOCUS_ITEM,
  GALE_CROSS_FOCUS_ITEM, EMBER_RING_FOCUS_ITEM, TIDE_WARD_FOCUS_ITEM, VOID_DASH_FOCUS_ITEM,
  INSCRIBE_RECIPES,
} from '../src/content/magic/defs.js';
import { selectSplashTargets, sanitizeCast, sanitizeCooldowns, cooldownLeft, spellAtCharge } from '../src/core/Magic.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { matchRecipe, getAllRecipes } from '../src/core/Crafting.js';
import { NAME_I18N } from '../src/i18n/names.js';
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
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const MAGIC = { schema: 1, industry: false, magic: true };
const NONE = { schema: 1, industry: false, magic: false };

// 基础法术 ← 进阶法术的对应关系（单一事实来源：进阶表里的 handler）
const PAIRS = [
  { base: 'gale_step', adv: 'gale_cross', baseFocus: GALE_FOCUS_ITEM, focus: GALE_CROSS_FOCUS_ITEM, name: '风渡' },
  { base: 'ember_bolt', adv: 'ember_ring', baseFocus: EMBER_FOCUS_ITEM, focus: EMBER_RING_FOCUS_ITEM, name: '烬环' },
  { base: 'tide_mend', adv: 'tide_ward', baseFocus: RAIN_FOCUS_ITEM, focus: TIDE_WARD_FOCUS_ITEM, name: '潮护' },
  { base: 'void_step', adv: 'void_dash', baseFocus: TIDELESS_FOCUS_ITEM, focus: VOID_DASH_FOCUS_ITEM, name: '长折' },
];

// ── ① 数据表 ──────────────────────────────────────────────────────────
{
  ok(SPELL_IDS.length === 4, '基础四支保持不变（进阶另表，不混进基础 ID）');
  ok(ADVANCED_SPELL_IDS.length === 4, `进阶四支（${ADVANCED_SPELL_IDS.join(', ')}）`);
  ok(Object.keys(ALL_SPELLS).length === 8, '总表 8 支 = 4 基础 + 4 进阶');
  for (const p of PAIRS) {
    const adv = ADVANCED_SPELLS[p.adv];
    const base = SPELLS[p.base];
    ok(!!adv && !!base, `${p.name}：进阶与基础都在表里`);
    ok(adv.handler === p.base, `${p.name}：handler 指向基础施法函数 ${p.base}`);
    ok(spellDef(p.adv) === adv, `${p.name}：spellDef 能解析进阶 ID`);
    ok(adv.focus === p.focus && FOCUS_SPELL[p.focus] === p.adv, `${p.name}：进阶焦点 → 进阶法术映射正确`);
    ok(adv.name === p.name, `${p.name}：显示名一致`);
    ok(adv.cost > base.cost, `${p.name}：费用高于基础版（${adv.cost} > ${base.cost}）`);
    ok(adv.cooldown > base.cooldown, `${p.name}：冷却长于基础版（${adv.cooldown} > ${base.cooldown}）`);
    ok(!!adv.charged && Object.keys(adv.charged).length >= 1, `${p.name}：有蓄力上限`);
    // 蓄力必须真的更强（每支进阶的 charged 至少一个数值字段严格大于基础值）
    const stronger = Object.entries(adv.charged).some(([k, v]) => Number(v) > Number(adv[k]));
    ok(stronger, `${p.name}：蓄力上限严格强于基础值`);
  }
  // 安全边界：数据表里不得出现地形/水位/时间/传送门字段
  const FORBIDDEN = ['blocks', 'setBlock', 'place', 'terrain', 'waterLevel', 'fluid', 'time', 'portal', 'dimension', 'teleportDim'];
  for (const id of ADVANCED_SPELL_IDS) {
    const keys = Object.keys(ADVANCED_SPELLS[id]);
    for (const f of FORBIDDEN) ok(!keys.includes(f), `${id}：数据表没有 ${f} 字段（不做地形魔法）`);
  }
  ok(ADVANCED_SPELLS.gale_cross.distance > SPELLS.gale_step.distance, '风渡比风步远');
  ok(ADVANCED_SPELLS.gale_cross.slowFallVy > SPELLS.gale_step.slowFallVy,
    '风渡下落更慢（slowFallVy -1.5 高于基础 -3）');
  ok(ADVANCED_SPELLS.ember_ring.damage > SPELLS.ember_bolt.damage, '烬环直击伤害高于烬矢');
  ok(!!ADVANCED_SPELLS.ember_ring.splash && ADVANCED_SPELLS.ember_ring.splash.maxTargets <= 2,
    '烬环溅射最多 2 个目标（不变成范围核弹）');
  ok(ADVANCED_SPELLS.tide_ward.guardLevel > SPELLS.tide_mend.guardLevel, '潮护防护等级高于回潮');
  ok(Array.isArray(ADVANCED_SPELLS.tide_ward.cleanse) && ADVANCED_SPELLS.tide_ward.cleanse.includes('wither'),
    '潮护只解凋零（负面清单显式声明）');
  ok(ADVANCED_SPELLS.void_dash.distance > SPELLS.void_step.distance, '长折比折步远');
  ok(ADVANCED_SPELLS.void_dash.softLanding > 0, '长折有落地缓冲（折步没有）');
  ok(!SPELLS.void_step.softLanding, '基础折步不因进阶而产生缓冲');
  // 蓄力插值在进阶表上同样只动 charged 列出的字段
  ok(spellAtCharge(ADVANCED_SPELLS.void_dash, 1).distance === 18, '长折满蓄 18 格');
  ok(spellAtCharge(ADVANCED_SPELLS.void_dash, 0).distance === 14, '长折不蓄力仍是 14 格');
  ok(spellAtCharge(ADVANCED_SPELLS.gale_cross, 0.5).distance === 12, '风渡半蓄取整到 12 格');
  const mid = spellAtCharge(ADVANCED_SPELLS.ember_ring, 0.5);
  ok(mid.damage === 14, '烬环半蓄取整到 14 点');
  ok(mid.cost === ADVANCED_SPELLS.ember_ring.cost && mid.cooldown === ADVANCED_SPELLS.ember_ring.cooldown,
    '蓄力不改费用与冷却（进阶也一样）');
}

// ── ② 配方 ────────────────────────────────────────────────────────────
{
  const advRecipes = getAllRecipes().filter((r) => (r.requiresExtras || []).includes('magic')
    && PAIRS.some((p) => r.output === p.focus));
  ok(advRecipes.length === 4, '四条进阶配方都在表里');
  for (const p of PAIRS) {
    const r = advRecipes.find((x) => x.output === p.focus);
    ok(!!r, `${p.name}：配方存在`);
    ok(r.type === 'shapeless' && r.count === 1, `${p.name}：无序合成、产出 1`);
    ok(r.ingredients.slice().sort().join() === ['echo_shard', p.baseFocus].sort().join(),
      `${p.name}：材料 = 回响残片 + ${p.baseFocus}`);
    ok(matchRecipe([[p.baseFocus], ['echo_shard']], MAGIC)?.name === p.focus, `${p.name}：魔法世界可合成`);
    ok(matchRecipe([[p.baseFocus], ['echo_shard']], NONE) === null, `${p.name}：关闭魔法合不出`);
  }
  // 一枚残片只刻一支：没有任何配方能"散装"造出残片本身（残片只从遗迹来）
  const shardRecipes = getAllRecipes().filter((r) => (r.requiresExtras || []).includes('magic')
    && (r.output === 'echo_shard' || (r.ingredients || []).some((i) => i === 'echo_shard' && r.output === 'echo_shard')));
  ok(shardRecipes.length === 0, '回响残片没有合成配方（只能从遗迹获得）');
}

// ── ③ 物品与 i18n ─────────────────────────────────────────────────────
{
  const EXPECT_ID = { [GALE_CROSS_FOCUS_ITEM]: 147, [EMBER_RING_FOCUS_ITEM]: 148, [TIDE_WARD_FOCUS_ITEM]: 149, [VOID_DASH_FOCUS_ITEM]: 150 };
  for (const p of PAIRS) {
    const item = ItemRegistry.getByName(p.focus);
    ok(!!item, `${p.name} 焦点已注册`);
    ok(item.id === EXPECT_ID[p.focus], `${p.name}：ID 钉值 ${EXPECT_ID[p.focus]}（实际 ${item.id}）`);
    ok(item.stack === 1, `${p.name}：stack 1（不可堆叠的刻纹物）`);
    ok(item.requiresExtras.join() === 'magic', `${p.name}：归属魔法内容`);
    ok(Array.isArray(item.lore) && item.lore.length === 1, `${p.name}：lore 1 行`);
    ok(Array.isArray(NAME_I18N[p.focus]) && NAME_I18N[p.focus].length === 11, `${p.name}：十一语名字齐备`);
  }
  const packs = { 'zh-TW': zhTW, en, fr, de, ja, ko, ar, ru, es, pt };
  for (const [loc, pack] of Object.entries(packs)) {
    for (const p of PAIRS) ok(!!pack[ItemRegistry.getByName(p.focus).lore[0]], `${loc}：${p.name} lore 有译文`);
    ok(!!pack['潮护：生命 +{n}，涤除负面'], `${loc}：潮护提示有译文`);
  }
  ok(en['潮护：生命 +{n}，涤除负面'].includes('{n}'), '潮护提示保留 {n} 占位符');
}

// ── ④ 协议与存档 ──────────────────────────────────────────────────────
{
  for (const p of PAIRS) {
    const cast = sanitizeCast({ spell: p.adv, x: 0, y: 70, z: 0, dx: 0, dy: 0, dz: 1, echo: 50 });
    ok(!!cast && cast.spell === p.adv, `${p.name}：服务器形状校验接受进阶法术`);
  }
  const far = sanitizeCast({ spell: 'void_dash', x: 0, y: 70, z: 0, dx: 0, dy: 0, dz: 1, echo: 50, x2: 18, y2: 70, z2: 0 });
  ok(far && far.x2 === 18, '长折满蓄 18 格落点被透传（上限放到 22）');
  const tooFar = sanitizeCast({ spell: 'void_dash', x: 0, y: 70, z: 0, dx: 0, dy: 0, dz: 1, echo: 50, x2: 40, y2: 70, z2: 0 });
  ok(tooFar && tooFar.x2 === undefined, '伪造 40 格落点仍被清洗掉');

  const now = 1_000_000;
  const cd = sanitizeCooldowns({ gale_cross: now - 5000, void_dash: now - 1000, nope: now - 1000, gale_step: -5 }, ALL_SPELLS, now);
  ok(cd.gale_cross === now - 5000 && cd.void_dash === now - 1000, '冷却清洗认得进阶法术 ID');
  ok(cd.nope === undefined && cd.gale_step === undefined, '未知 ID / 脏值仍被丢弃');
  ok(cooldownLeft(now - 5000, now, 'gale_cross') > 0, '进阶冷却按自己的秒数（风渡 8s 未过）');
  ok(cooldownLeft(now - 9000, now, 'gale_cross') === 0, '风渡 9 秒后冷却结束');
  ok(cooldownLeft(now - 5000, now, 'void_dash') > 0, '长折 9s 冷却未过');
}

// ── ⑤ 烬环溅射（纯函数真值表）────────────────────────────────────────
{
  const mk = (id, x, y, z, dead = false) => ({ id, x, y, z, dead });
  ok(selectSplashTargets([], 0, 0, 0, 3, 2).length === 0, '空候选 → 0');
  const cands = [mk(1, 0.4, 0, 0), mk(2, 2.9, 0, 0), mk(3, 1.2, 0, 0), mk(4, 3.4, 0, 0)];
  const picked = selectSplashTargets(cands, 0, 0, 0, 3, 2);
  ok(picked.length === 2, '最多取 maxTargets 个（2）');
  ok(picked[0].id === 1 && picked[1].id === 3, '按距离最近优先（0.4 → 1.2）');
  ok(selectSplashTargets(cands, 0, 0, 0, 3, 9).every((c) => c.id !== 4), '半径外的目标被剔除（3.4 > 3）');
  ok(selectSplashTargets([mk(7, 0, 0, 0, true), mk(8, 0.5, 0, 0)], 0, 0, 0, 3, 2).map((c) => c.id).join() === '8',
    'dead 目标跳过（同一发弹道不重复算）');
  // 距离完全并列时必须确定性（按 id），否则两端/两帧结果会抖
  const tie = [mk(9, 1, 0, 0), mk(6, 1, 0, 0), mk(7, -1, 0, 0)];
  const p1 = selectSplashTargets(tie, 0, 0, 0, 3, 2).map((c) => c.id).join();
  const p2 = selectSplashTargets(tie.slice().reverse(), 0, 0, 0, 3, 2).map((c) => c.id).join();
  ok(p1 === p2 && p1 === '6,7', `距离并列按 id 定序且与输入顺序无关（${p1}）`);
  ok(selectSplashTargets([mk(1, 0, 0, 0)], 0, 0, 0, 0, 2).length === 0, '半径 0 → 不挑任何目标');
  ok(selectSplashTargets([mk(1, 0, 0, 0)], 0, 0, 0, 3, 0).length === 0, 'maxTargets 0 → 不挑任何目标');
}

// ── ⑥ 源码绊线 ────────────────────────────────────────────────────────
{
  const ms = src('../src/player/MagicSystem.js');
  ok(ms.includes('switch (def.handler || spellId)'), '进阶法术按 handler 复用基础施法函数');
  for (const p of PAIRS) ok(!!ADVANCED_SPELLS[p.adv].handler, `${p.name}：handler 已挂`);
  ok(ms.includes('typeof mm.damageMobsNear'), '溅射只调怪物的半径伤害方法');
  ok(ms.includes('def.splash'), '弹道命中路径读溅射配置');
  const sendPlayerHits = (ms.match(/sendAttackPlayer\(/g) || []).length;
  ok(sendPlayerHits === 1, `玩家伤害入口只有一处（实际 ${sendPlayerHits}）——溅射不会二次结算 PvP`);
  ok(ms.includes('def.cleanse'), '潮护按数据表清负面');
  ok(ms.includes('def.softLanding'), '长折落地缓冲由数据表给');
  ok(ms.includes('sendMagicCast(def.id'), '施法事件广播真实法术 ID（进阶不被当成基础）');

  const ph = src('../src/player/Physics.js');
  ok(ph.includes('entity.slowFallVy'), '缓降速度上限由实体字段决定（风渡更慢）');

  const mob = src('../src/entity/MobManager.js');
  ok(mob.includes('damageMobsNear(') && mob.includes('selectSplashTargets'),
    '怪物侧半径伤害复用唯一的目标选择函数');
  // 实玩抓到过：直击目标又被自己的溅射打了一次（20 → 3 而不是 8）。两处绊线钉住修复。
  ok(/this\.lastHitMob = closest;/.test(mob), 'attackMob 记下直击命中的怪物');
  ok(/this\.lastHitMob = null;/.test(mob), '没打中时清掉直击记录（不误排无关目标）');
  ok(/const exclude = mm\.lastHitMob \|\| null;/.test(ms) && /mm\.lastHitMob = null;/.test(ms),
    '溅射排除直击目标并即时清空记录');
  ok(/damageMobsNear\(x, y, z, splash\.radius, splash\.damage, splash\.maxTargets, exclude\)/.test(ms),
    '排除项真的传进溅射（同一发弹道只结算一次）');

  const audioSrc = src('../src/audio/AudioEngine.js');
  for (const p of PAIRS) ok(audioSrc.includes(`${p.adv}: '${p.base}'`), `${p.name} 沿用 ${p.base} 音色`);

  const cr = src('../src/core/Crafting.js');
  // B56 R1：配方表移进 content/magic/defs.js 的 INSCRIBE_RECIPES（与刻纹压印机共用一份）
  for (const p of PAIRS) {
    ok(INSCRIBE_RECIPES[p.baseFocus] === p.focus, `${p.name}：纹样加工表里是「残片 + 基础焦点 → 进阶焦点」`);
    ok(cr.includes('addShapeless(advanced, 1, [ECHO_SHARD_ITEM, focus]'), `${p.name}：工作台配方由同一张表生成`);
  }

  // 红线：进阶不得引入新的方块写入/传送入口
  for (const p of PAIRS) {
    const defSrc = src('../src/content/magic/defs.js');
    ok(!/setBlock|portal|dimensionId/.test(JSON.stringify(ADVANCED_SPELLS[p.adv])), `${p.name}：数据里没有方块/传送入口`);
    ok(defSrc.includes(`handler: '${p.base}'`), `${p.name}：handler 在 defs 表内声明`);
  }
}

finish('build55-advanced-tides');
