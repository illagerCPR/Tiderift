// build54-charge-feedback.mjs -- Build 54 R2 焦点蓄力与反馈统一（纯 node 回归）
// 断言：
//   ① 蓄力插值：charge 0 = 基础值、1 = charged 上限值、中点取整、越界/脏值钳制、
//      未列字段（费用/冷却/速度）不随蓄力变化、不改动冻结的定义表
//   ② 四支法术都配了蓄力上限，且都比基础值更强（没有一支是摆设）
//   ③ 反馈统一：失败码表覆盖全部码、每个码都有文案与 HUD 脉冲种类、未知码兜底、
//      文案键在 10 个语言包里都存在（动态键不在 i18n-parity 的 master 里，必须自证）
//   ④ 接线绊线：焦点蓄力通道（按住累计/松手施放/换物与 UI 作废）、早退守卫放行对空蓄力、
//      右键链改为起手蓄力、暂停与观战清蓄力、HUD 蓄力条与脉冲、施法/拒绝音、
//      弹道蓄力只缩放视觉不改判定、费用与冷却取基础值
import { readFileSync } from 'fs';
import {
  SPELLS, SPELL_IDS, CHARGE_FULL_SECONDS, CAST_FAIL_CODES, CAST_FAIL_TEXT,
} from '../src/content/magic/defs.js';
import { spellAtCharge, castFeedback, boltDamage } from '../src/core/Magic.js';
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
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const PACKS = { 'zh-TW': zhTW, en, fr, de, ja, ko, ar, ru, es, pt };
const HUD_KINDS = ['none', 'echo-low', 'cooldown', 'target'];

// ── ① 蓄力插值 ──────────────────────────────────────────────────────────
{
  ok(CHARGE_FULL_SECONDS > 0 && CHARGE_FULL_SECONDS <= 2, `蓄力满档是有限的人体节拍（${CHARGE_FULL_SECONDS}s）`);
  const gale = SPELLS.gale_step;
  const base0 = spellAtCharge(gale, 0);
  ok(base0.distance === 6 && base0.slowFall === 2.5, 'charge=0 → 风步基础值（6 格 / 2.5 秒缓降）');
  const full = spellAtCharge(gale, 1);
  ok(full.distance === 8 && full.slowFall === 5, 'charge=1 → 风步满蓄上限值（8 格 / 5 秒缓降）');
  const mid = spellAtCharge(gale, 0.5);
  ok(mid.distance === 7, '风步距离半程取整（7）');
  ok(Math.abs(mid.slowFall - 3.75) < 1e-9, '非整数字段保留小数（缓降 3.75）');
  // 费用/冷却/速度不被蓄力影响
  ok(full.cost === gale.cost && full.cooldown === gale.cooldown, '蓄力不改费用与冷却');
  ok(spellAtCharge(SPELLS.ember_bolt, 1).speed === SPELLS.ember_bolt.speed, '蓄力不改弹速');
  // 取整：整数基值 + 整数上限 → 整数结果
  const dmgMid = spellAtCharge(SPELLS.ember_bolt, 0.5).damage;
  ok(Number.isInteger(dmgMid) && dmgMid === 8, `伤害半程取整（${dmgMid}）`);
  const healFull = spellAtCharge(SPELLS.tide_mend, 1);
  ok(healFull.heal === 10 && healFull.guardSeconds === 10, '回潮满蓄补 10、防护 10 秒');
  // 越界与脏值
  ok(spellAtCharge(gale, -3).distance === 6, 'charge < 0 → 按基础值');
  ok(spellAtCharge(gale, 9).distance === 8, 'charge > 1 → 按满蓄值');
  ok(spellAtCharge(gale, NaN).distance === 6, 'NaN → 按基础值');
  ok(spellAtCharge(gale, 'x').distance === 6, '非数字 → 按基础值');
  ok(spellAtCharge(gale, '0.5').distance === 7, '数字字符串可解析（仍走钳制）');
  // 不改动定义表
  const frozen = SPELLS.gale_step;
  spellAtCharge(frozen, 1);
  ok(frozen.distance === 6 && frozen.slowFall === 2.5, '插值返回新对象，不污染冻结的定义表');
  ok(spellAtCharge(null, 1) === null, '空定义 → null（调用方兜底）');
  // 没有 charged 字段的定义原样返回
  ok(spellAtCharge({ id: 'x', cost: 1 }, 1).cost === 1, '无 charged 的法术原样返回');
}

// ── ② 四支法术都有蓄力收益 ──────────────────────────────────────────────
{
  for (const id of SPELL_IDS) {
    const def = SPELLS[id];
    ok(def.charged && Object.keys(def.charged).length > 0, `${id} 配了蓄力上限（不是摆设）`);
    for (const [key, to] of Object.entries(def.charged)) {
      ok(typeof def[key] === 'number', `${id}.${key} 有基础值可以插值`);
      ok(to > def[key], `${id}.${key} 满蓄更强（${def[key]} → ${to}）`);
    }
  }
  // 边界仍守住：蓄满也不能突破计划区间的硬上限
  ok(spellAtCharge(SPELLS.gale_step, 1).distance <= 8, '风步满蓄仍 ≤ 8 格');
  ok(spellAtCharge(SPELLS.void_step, 1).distance <= 10, '折步满蓄仍 ≤ 10 格（短距）');
  ok(spellAtCharge(SPELLS.tide_mend, 1).heal < 20, '回潮满蓄也不一次补满 20 血');
}

// ── ③ 反馈统一 ──────────────────────────────────────────────────────────
{
  ok(CAST_FAIL_CODES.length === 9, `失败码共 9 个（${CAST_FAIL_CODES.join(', ')}）`);
  for (const code of CAST_FAIL_CODES) {
    const fb = castFeedback(code);
    ok(fb.code === code, `${code} 反馈回显原码`);
    ok(typeof fb.text === 'string' && fb.text.length > 0, `${code} 有文案键`);
    ok(HUD_KINDS.includes(fb.hud), `${code} 的 HUD 脉冲种类合法（${fb.hud}）`);
    ok(CAST_FAIL_TEXT[code] === fb.text, `${code} 文案来自同一张表`);
    for (const [loc, pack] of Object.entries(PACKS)) {
      ok(Object.prototype.hasOwnProperty.call(pack, fb.text), `[${loc}] 有反馈文案：${code}`);
    }
  }
  ok(castFeedback('echo').hud === 'echo-low', '回响不足 → 回响条红脉冲');
  ok(castFeedback('cooldown').hud === 'cooldown', '冷却中 → 回响条白脉冲');
  ok(castFeedback('target').hud === 'target' && castFeedback('wounded').hud === 'target',
    '目标无效 / 无伤可回 → 琥珀脉冲');
  ok(castFeedback('disabled').hud === 'none' && castFeedback('mode').hud === 'none',
    '开关与模式类失败不脉冲（世界没回响就不该闪条）');
  ok(castFeedback('nope').code === 'unknown' && castFeedback(undefined).code === 'unknown',
    '未知码兜底到 unknown');
}

// ── ④ 弹道伤害：发射时定值，推进阶段不回表（R4 实玩抓到的真 bug）─────────
{
  const charged = spellAtCharge(SPELLS.ember_bolt, 1);
  ok(charged.damage === 10 && SPELLS.ember_bolt.damage === 6, '满蓄伤害 10 / 基础 6');
  ok(boltDamage({ damage: charged.damage }, SPELLS.ember_bolt) === 10,
    '发光弹体自带蓄力伤害 → 取 10（不被基础值覆盖）');
  ok(boltDamage({ damage: 6 }, SPELLS.ember_bolt) === 6, '单击弹体自带基础伤害 → 取 6');
  ok(boltDamage({}, SPELLS.ember_bolt) === 6, '老弹体没有字段 → 回落基础伤害');
  ok(boltDamage({ damage: 0 }, SPELLS.ember_bolt) === 6, '0/脏值伤害 → 回落基础值');
  ok(boltDamage({ damage: 'x' }, SPELLS.ember_bolt) === 6, '非数字伤害 → 回落基础值');
  ok(boltDamage({}, null) === 0, '空定义 → 0（不产生 NaN 伤害）');
  const magic = src('../src/player/MagicSystem.js');
  ok(/damage: def\.damage, \/\/ B54 R4/.test(magic), '发射时把伤害钉在弹体上');
  ok(/const dmg = boltDamage\(bolt, def\)/.test(magic), '推进阶段统一读弹体伤害');
  ok((magic.match(/boltDamage\(/g) || []).length === 1, '只有一处取伤害（单一入口）');
  ok(/sendAttackPlayer\(rp\.id, dmg, 'magic'\)/.test(magic) && /reach, dmg\)/.test(magic),
    'PvP 与怪物伤害都用同一个弹体伤害值（不双口径）');
}

// ── ⑤ 接线绊线 ─────────────────────────────────────────────────────────
{
  const magic = src('../src/player/MagicSystem.js');
  const ic = src('../src/player/InteractionController.js');
  const game = src('../src/player/Game.js');
  const hud = src('../src/ui/Hud.js');
  const audio = src('../src/audio/AudioEngine.js');
  const core = src('../src/core/Magic.js');

  // 客户端域：不再自带第二份码表，统一走 castFeedback
  ok(!/const FAIL_TEXT = \{/.test(magic), '客户端不再自带失败码表（单一真相）');
  ok(/const fb = castFeedback\(code\)/.test(magic), '失败反馈统一走 castFeedback');
  ok(/g\.hud\.showToast\(t\(fb\.text\)\)/.test(magic), '提示文案来自统一表');
  ok(/g\.hud\.pulseEcho\(fb\.hud\)/.test(magic), '失败时回响条脉冲');
  ok(/audio\.spellDeny\(\)/.test(magic), '失败时给拒绝音');
  ok(/audio\.spellCast\(spellId, charge\)/.test(magic), '成功施法给施法音');
  // 蓄力状态机
  ok(/this\._charge = \{ active: false, t: 0 \}/.test(magic), '蓄力状态独立于冷却');
  ok(/beginCharge\(\)/.test(magic) && /releaseCharge\(\)/.test(magic) && /cancelCharge\(\)/.test(magic),
    '蓄力有起手/松手/作废三态');
  ok(/this\._charge\.t = Math\.min\(CHARGE_FULL_SECONDS/.test(magic), '蓄力有上限（不会无限攒）');
  // 费用与冷却取基础值：蓄力不涨价
  ok(/const def = spellAtCharge\(base, charge\)/.test(magic), '效果走过蓄力插值');
  ok(/p\.echo = clampEcho\(p\.echo - base\.cost/.test(magic), '费用按基础值扣（蓄力不涨价）');
  // 弹道蓄力只缩放视觉，不改判定
  ok(/mesh\.scale\.setScalar\(1 \+ 0\.5 \* c\)/.test(magic), '满蓄弹体更大（纯视觉）');
  // B55 R2 起 MagicSystem 出现 splash.radius（烬环溅射，与蓄力无关）——改成按数据表断言：
  // 蓄力只插值 charged 列出的字段，radius 永远不在其中，命中判定不受蓄力影响。
  ok(SPELL_IDS.every((id) => !('radius' in (SPELLS[id].charged || {}))),
    '蓄力不碰命中半径（charged 表里没有 radius）');
  // 通道接线
  ok(/_handleFocusChannel\(dt\)/.test(ic), '焦点蓄力通道存在');
  ok(ic.indexOf('_handleBowChannel(dt)') < ic.indexOf('_handleFocusChannel(dt)'),
    '焦点通道排在弓通道之后（两者互斥，不改弓语义）');
  ok(/g\.magic\.advanceCharge\(dt\)/.test(ic), '按住期间累计蓄力');
  ok(/g\.magic\.releaseCharge\(\);/.test(ic), '松手才施放');
  ok(/g\.magic\.beginCharge\(\);/.test(ic), '右键链改为起手蓄力');
  ok(!/g\.magic\.castHeld\(\);/.test(ic), '右键链不再直接施法（否则会连发）');
  const beginAt = ic.indexOf('g.magic.beginCharge();');
  const abortAt = ic.indexOf('return CLICK_ABORT;', beginAt);
  ok(beginAt > 0 && abortAt > beginAt && abortAt - beginAt < 200, '起手蓄力不置位 mouseRight（交给通道）');
  ok(/focusLikeHeld/.test(ic) && /mouseRight && focusLikeHeld/.test(ic), '早退守卫放行对空蓄力');
  // 暂停 / 观战作废
  ok(/if \(this\.magic\) this\.magic\.cancelCharge\(\);/.test(game), '暂停时清蓄力');
  ok((game.match(/this\.magic\.cancelCharge\(\)/g) || []).length >= 2, '暂停与观战都清蓄力');
  // HUD
  ok(/setEcho\(echo, max, cooldownFrac = 0, visible = true, charge = -1\)/.test(hud), 'setEcho 带蓄力进度');
  ok(/this\.chargeBar/.test(hud) && /this\.chargeFill/.test(hud), 'HUD 有蓄力条');
  ok(/t\('蓄力 \{p\}%', \{ p: Math\.round/.test(hud), '蓄力时条顶显示百分比');
  ok(/pulseEcho\(kind\)/.test(hud) && /echo-low/.test(hud), '回响条脉冲接口在');
  ok(/if \(this\.chargeBar\) this\.chargeBar\.style\.display = 'none'/.test(hud), '回菜单不残留蓄力条');
  // 音频
  ok(/spellCast\(spellId, charge = 0\)/.test(audio) && /spellDeny\(\)/.test(audio), '施法音与拒绝音落地');
  ok(/'gale_step':/.test(audio) && /'ember_bolt':/.test(audio) && /'tide_mend':/.test(audio)
    && /'void_step':/.test(audio), '四系各有音色分路');
  ok(/_gate\('spellDeny', 0\.12\)/.test(audio), '拒绝音限频（连点不炸耳朵）');
  // 纯逻辑导出
  ok(/export function spellAtCharge/.test(core) && /export function castFeedback/.test(core),
    '蓄力插值与反馈表都是可测纯函数');
}

finish('build54-charge-feedback');