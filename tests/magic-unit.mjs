// magic-unit.mjs -- Build 51 R4 四潮回响最小闭环回归（纯 node，不依赖服务器）
// 断言：
//   ① 内容归属：仪台 id 227 + 三个物品 id、11 语名字、创造分类、配方只在启用魔法的世界可见
//   ② 回响资源：上限钳制、调谐（1 级经验 → 25 回响）、满值/无经验拒绝
//   ③ 施法校验：五关真值表（世界开关/手持焦点/模式/回响/冷却）
//   ④ 边界：风步落点逐格裁剪（撞墙即停、不穿墙）、冷却计时、烬矢形状校验
//   ⑤ 存档/档案：回响进单机存档与 LAN 玩家档案（服务器清洗范围）
//   ⑥ 源码绊线：关闭魔法的世界整段早退、联机只在 networkMode 广播、服务器闸口与频率硬约束
import { readFileSync } from 'fs';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { matchRecipe, recipeEnabled, getAllRecipes } from '../src/core/Crafting.js';
import { getItemCategory } from '../src/core/ItemCategories.js';
import { NAME_I18N } from '../src/i18n/names.js';
import { normalizeExtraContent } from '../src/content/ExtraContent.js';
import {
  ECHO_MAX, ECHO_PER_LEVEL, SPELLS, SPELL_IDS, FOCUS_SPELL,
  TABLE_BLOCK, ECHO_DUST_ITEM, GALE_FOCUS_ITEM, EMBER_FOCUS_ITEM,
} from '../src/content/magic/defs.js';
import {
  clampEcho, checkCast, tuneEcho, resolveDashTarget, cooldownLeft, sanitizeCast,
} from '../src/core/Magic.js';
import { normalizeSaveData } from '../src/core/SaveSystem.js';
import { sanitizeSaveData, summarize } from '../src/core/SaveTransfer.js';
import { sanitizePlayerProfile } from '../server/room.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const MAGIC = normalizeExtraContent({ schema: 1, magic: true });
const NONE = normalizeExtraContent(null);

// ── ① 内容归属 ──────────────────────────────────────────────────────────
{
  const table = BlockRegistry.getByName(TABLE_BLOCK);
  ok(table && table.id === 227, `回响仪台 id 钉值 227（${table && table.id}）`);
  ok(table.magicKind === 'table', '仪台带 magicKind');
  ok(table.requiresExtras && table.requiresExtras.join() === 'magic', '仪台归属魔法内容');
  const dust = ItemRegistry.getByName(ECHO_DUST_ITEM);
  const gale = ItemRegistry.getByName(GALE_FOCUS_ITEM);
  const ember = ItemRegistry.getByName(EMBER_FOCUS_ITEM);
  ok(dust && dust.id === 141, `回响尘 id 钉值 141（${dust && dust.id}）`);
  ok(gale && gale.id === 142, `风潮焦点 id 钉值 142（${gale && gale.id}）`);
  ok(ember && ember.id === 143, `坠潮焦点 id 钉值 143（${ember && ember.id}）`);
  for (const it of [dust, gale, ember]) {
    ok(it && it.requiresExtras && it.requiresExtras.join() === 'magic', `${it && it.name} 归属魔法内容`);
  }
  for (const name of [TABLE_BLOCK, ECHO_DUST_ITEM, GALE_FOCUS_ITEM, EMBER_FOCUS_ITEM]) {
    const row = NAME_I18N[name];
    ok(Array.isArray(row) && row.length === 11, `${name} 名字表 11 语`);
  }
  ok(getItemCategory(TABLE_BLOCK) === 'functional', '仪台创造分类 = 功能方块');
  ok(getItemCategory(ECHO_DUST_ITEM) === 'materials', '回响尘创造分类 = 材料');
  ok(getItemCategory(GALE_FOCUS_ITEM) === 'tools' && getItemCategory(EMBER_FOCUS_ITEM) === 'tools',
    '两个焦点创造分类 = 工具');
  // 配方归属
  const focusRecipe = getAllRecipes().find((r) => r.output === GALE_FOCUS_ITEM);
  ok(!!focusRecipe && recipeEnabled(focusRecipe, MAGIC) && !recipeEnabled(focusRecipe, NONE),
    '风潮焦点配方只在启用魔法的世界可用');
  ok(matchRecipe([['star_marrow']], NONE) === null, '关闭魔法：合不出回响尘');
  ok(matchRecipe([['star_marrow']], MAGIC)?.name === ECHO_DUST_ITEM, '启用魔法：可合出回响尘');
  ok(matchRecipe([
    [null, 'feather', null],
    ['feather', 'echo_dust', 'feather'],
    [null, 'feather', null],
  ], MAGIC)?.name === GALE_FOCUS_ITEM, '风潮焦点配方形状正确');
  // 法术表（B54 R1 起四系齐备）
  ok(SPELL_IDS.length === 4 && ['gale_step', 'ember_bolt', 'tide_mend', 'void_step'].every((id) => SPELL_IDS.includes(id)),
    '四潮回响四个基础方向各一支');
  ok(FOCUS_SPELL[GALE_FOCUS_ITEM] === 'gale_step' && FOCUS_SPELL[EMBER_FOCUS_ITEM] === 'ember_bolt',
    '焦点 → 法术映射正确');
  ok(SPELLS.gale_step.cost > 0 && SPELLS.gale_step.cooldown > 0 && SPELLS.gale_step.distance <= 8,
    '风步是短距冲刺（≤8 格），有费用与冷却');
  ok(SPELLS.ember_bolt.damage > 0 && SPELLS.ember_bolt.life > 0, '烬矢有伤害与寿命（无地形破坏字段）');
}

// ── ② 回响资源 ──────────────────────────────────────────────────────────
{
  ok(ECHO_MAX === 100 && ECHO_PER_LEVEL === 25, '回响上限 100、每级经验 25 回响');
  ok(clampEcho(-5) === 0 && clampEcho(1e9) === ECHO_MAX && clampEcho('x') === 0, '回响钳制（负数/超大/脏值）');
  ok(clampEcho(42.9) === 42, '回响取整');
  const t1 = tuneEcho({ echo: 0, xpLevel: 2, magicEnabled: true });
  ok(t1.ok && t1.gain === ECHO_PER_LEVEL && t1.levels === 1, '调谐：1 级经验 → 25 回响');
  ok(tuneEcho({ echo: 0, xpLevel: 0, magicEnabled: true }).code === 'no-level', '无经验等级 → 拒绝调谐');
  ok(tuneEcho({ echo: ECHO_MAX, xpLevel: 5, magicEnabled: true }).code === 'full', '回响已满 → 拒绝调谐');
  ok(tuneEcho({ echo: 90, xpLevel: 5, magicEnabled: true }).gain === 10, '回响只补到上限（不溢出）');
  ok(tuneEcho({ echo: 0, xpLevel: 5, magicEnabled: false }).code === 'disabled', '关闭魔法的世界不能调谐');
}

// ── ③ 施法五关 ──────────────────────────────────────────────────────────
{
  const base = {
    spellId: 'ember_bolt', held: EMBER_FOCUS_ITEM, echo: 50, cooldownLeft: 0,
    magicEnabled: true, spectator: false, creative: false,
  };
  ok(checkCast(base).ok, '五关齐备 → 可施法');
  ok(checkCast({ ...base, magicEnabled: false }).code === 'disabled', '世界未启用魔法 → disabled');
  ok(checkCast({ ...base, held: null }).code === 'no-focus', '空手 → no-focus');
  ok(checkCast({ ...base, held: GALE_FOCUS_ITEM }).code === 'wrong-focus', '拿错焦点 → wrong-focus');
  ok(checkCast({ ...base, spectator: true }).code === 'mode', '旁观模式 → mode');
  ok(checkCast({ ...base, creative: true }).code === 'mode', '创造模式 → mode（不在创造里刷弹道）');
  ok(checkCast({ ...base, echo: 5 }).code === 'echo', '回响不足 → echo');
  ok(checkCast({ ...base, cooldownLeft: 0.4 }).code === 'cooldown', '冷却中 → cooldown');
  ok(checkCast({ ...base, spellId: 'nope' }).code === 'unknown', '未知法术 → unknown');
}

// ── ④ 边界：风步落点 / 冷却 / 烬矢形状 ──────────────────────────────────
{
  // 一路畅通 → 走满距离
  ok(resolveDashTarget(6, () => ({ blocked: false, standable: true })) === 6, '风步：畅通时走满 6 格');
  // 1.5 格处撞墙 → 停在墙前（≤1.5）
  {
    const d = resolveDashTarget(6, (t) => ({ blocked: t >= 1.5, standable: true }));
    ok(d < 1.5 + 1e-9 && d >= 1.25 - 1e-9, `风步：撞墙即停（${d.toFixed(2)}）`);
  }
  // 起点就堵 → 0（不穿墙）
  ok(resolveDashTarget(6, () => ({ blocked: true, standable: false })) === 0, '风步：起点被堵 → 不移动');
  // 冷却
  const now = 100000;
  ok(cooldownLeft(now - 500, now, 'ember_bolt') > 0, '烬矢冷却 1.2s 内仍为冷却中');
  ok(cooldownLeft(now - 2000, now, 'ember_bolt') === 0, '冷却结束 → 可再次施放');
  ok(cooldownLeft(0, now, 'ember_bolt') === 0, '从未施法 → 无冷却');
  // 形状校验
  ok(sanitizeCast({ spell: 'nope', x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, echo: 10 }) === null,
    '未知法术被服务器拒绝');
  ok(sanitizeCast({ spell: 'ember_bolt', x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, echo: 10 }) === null,
    '零方向被拒绝');
  ok(sanitizeCast({ spell: 'ember_bolt', x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 2, echo: 10 }).dz === 1,
    '方向被归一化');
  ok(sanitizeCast({ spell: 'ember_bolt', x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, echo: 999 }) === null,
    '回响越界被拒绝');
}

// ── ⑤ 存档 / 玩家档案 ───────────────────────────────────────────────────
{
  const save = { version: 2, seed: 3, gamemode: 'survival', player: { echo: 77 } };
  ok(normalizeSaveData(save).player.echo === 77, '存档保留回响');
  const { data } = sanitizeSaveData({ version: 2, seed: 3, player: { echo: 999 } });
  ok(data.player.echo === 100, '导入净化把回响钳到上限');
  const { data: old } = sanitizeSaveData({ version: 2, seed: 3, player: {} });
  ok(old.player.echo === 0, '旧档无回响字段 → 0');
  ok(summarize(data).seed === 3, '摘要仍可用（回响不参与摘要）');
  // LAN 玩家档案
  const prof = sanitizePlayerProfile({
    inventory: { slots: new Array(36).fill(null), armor: new Array(4).fill(null) },
    position: { x: 0, y: 64, z: 0 }, dim: 'overworld',
    health: 20, food: 20, saturation: 5, xp: 0, xpLevel: 0, echo: 60,
  });
  ok(prof && prof.echo === 60, '玩家档案保留并清洗回响');
  const prof2 = sanitizePlayerProfile({
    inventory: { slots: new Array(36).fill(null), armor: new Array(4).fill(null) },
    position: { x: 0, y: 64, z: 0 }, dim: 'overworld',
    health: 20, food: 20, saturation: 5, xp: 0, xpLevel: 0, echo: 1e9,
  });
  ok(prof2 === null, '回响越界的档案被拒绝');
}

// ── ⑥ 源码绊线 ─────────────────────────────────────────────────────────
{
  const magic = src('../src/player/MagicSystem.js');
  const game = src('../src/player/Game.js');
  const physics = src('../src/player/Physics.js');
  const net = src('../src/net/NetworkManager.js');
  const room = src('../server/room.js');
  const ic = src('../src/player/InteractionController.js');
  const hud = src('../src/ui/Hud.js');

  ok(/get enabled\(\)[\s\S]{0,120}extraContent\.magic === true/.test(magic), '魔法开关以世界清单为准');
  ok(/if \(!this\.enabled\) \{ g\.hud\.setEcho\(0, 0, 0, false\); return; \}/.test(magic),
    '关闭魔法的世界不显示回响 HUD');
  ok(/if \(g\.networkMode && g\.net\) g\.net\.sendMagicCast/.test(magic), '只有联机才广播施法事件');
  ok(/远端施法表现（不结算伤害、不扣回响、不替他回血\/位移）/.test(magic), '远端表现不参与结算');
  ok(/slowFall = 0/.test(game) && /slowFall/.test(physics), '风步缓降接进物理重力分支');
  ok(/case MSG\.MAGIC_CAST: this\.onMagicCast/.test(room), '服务器路由施法事件');
  ok(/if \(!this\.extraContent \|\| this\.extraContent\.magic !== true\) return;/.test(room),
    '关闭魔法的房间丢弃施法事件');
  ok(/now - last < def\.cooldown \* 1000/.test(room), '服务器独立执行施法间隔硬约束');
  ok(/if \(isMagicId\(id\) && !\(this\.extraContent && this\.extraContent\.magic === true\)\)/.test(room),
    '未启用魔法的世界拒绝魔法装置写入');
  ok(/tableDef\.magicKind === 'table'/.test(ic), '右键仪台 → 调谐');
  ok(/g\.magic\.isFocus\(sel\.name\)/.test(ic), '手持焦点右键 → 施法');
  ok(/setEcho/.test(hud), 'HUD 提供回响条接口');
  ok(/case MSG\.MAGIC_EFFECT:/.test(net), '客户端处理远端施法表现');
}

finish('magic-unit');
