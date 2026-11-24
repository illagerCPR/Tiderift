// build54-lifecycle-split.mjs -- Build 54 R3 死亡/换维规则与四类结算分流（纯 node 回归）
// 断言：
//   ① 生命周期表：死亡与换维都「留回响+留冷却、清蓄力+清弹道+清缓降+清防护」
//   ② 冷却清洗：合法保留、未知法术/脏值/未来时间戳/过期记录丢弃、空入参安全
//   ③ 自我效果：防护与治疗只作用本机玩家，远端回潮只播粒子
//   ④ 怪物伤害：只有本端弹道结算，且每发只调一次（命中即死）
//   ⑤ PvP：只在本端 + 联机 + 房间开 PvP 时把玩家当目标，伤害交既有 ATTACK_PLAYER 闸门
//   ⑥ 远端视觉：local:false 的弹道不结算伤害/不扣回响
//   ⑦ 接线：换维透传冷却、死亡清运行态、服务器对 magic 来源伤害封顶
import { readFileSync } from 'fs';
import { SPELLS, SPELL_IDS } from '../src/content/magic/defs.js';
import { MAGIC_LIFECYCLE, sanitizeCooldowns } from '../src/core/Magic.js';
import { MAGIC_PVP_DAMAGE_CAP } from '../server/magic.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
// 取一段代码块：从 header 后的第一个 { 开始按括号配对（函数体、对象字面量通用；
// 字符串里的 {n} / ${x} 成对出现，净计数为 0，不会提前收口）
const body = (text, header) => {
  const at = text.indexOf(header);
  if (at < 0) return '';
  const start = text.indexOf('{', at);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(at, i + 1);
    }
  }
  return text.slice(at);
};

// ── ① 生命周期规则 ──────────────────────────────────────────────────────
{
  for (const phase of ['death', 'dimension']) {
    const rule = MAGIC_LIFECYCLE[phase];
    ok(!!rule, `${phase} 有明确规则`);
    ok(rule.keepEcho === true, `${phase}：回响保留（资源不因死亡/换维蒸发）`);
    ok(rule.keepCooldowns === true, `${phase}：冷却保留（不能靠死亡/换维刷新）`);
    ok(rule.clearCharge === true, `${phase}：清蓄力`);
    ok(rule.clearBolts === true, `${phase}：清弹道`);
    ok(rule.clearSlowFall === true, `${phase}：清缓降`);
    ok(rule.clearGuard === true, `${phase}：清防护`);
  }
  ok(Object.isFrozen(MAGIC_LIFECYCLE) && Object.isFrozen(MAGIC_LIFECYCLE.death),
    '规则表不可变（防止运行时被就地改写）');
}

// ── ② 冷却清洗 ──────────────────────────────────────────────────────────
{
  const now = 1_700_000_000_000;
  const clean = sanitizeCooldowns({
    gale_step: now - 500, ember_bolt: now - 9000,
    nope: now - 10, tide_mend: 'x', void_step: -1,
  }, SPELLS, now);
  ok(clean.gale_step === now - 500 && clean.ember_bolt === now - 9000, '合法冷却原样保留');
  ok(!('nope' in clean), '未知法术的冷却被丢弃');
  ok(!('tide_mend' in clean) && !('void_step' in clean), '脏值/负数冷却被丢弃');
  ok(Object.keys(sanitizeCooldowns(null, SPELLS, now)).length === 0, 'null 安全');
  ok(Object.keys(sanitizeCooldowns('x', SPELLS, now)).length === 0, '非对象安全');
  ok(!('gale_step' in sanitizeCooldowns({ gale_step: now + 60_000 }, SPELLS, now)), '未来时间戳被丢弃');
  ok(!('gale_step' in sanitizeCooldowns({ gale_step: now - 2 * 86400_000 }, SPELLS, now)), '过旧记录被丢弃');
  // 换维透传后冷却仍生效：`now - 500` 对 gale（3s）意味着还剩 2.5s
  ok(SPELLS.gale_step.cooldown * 1000 - 500 > 0, '透传的时间戳仍能算出剩余冷却');
}

// ── ③ 自我效果（只作用本人）──────────────────────────────────────────────
{
  const magic = src('../src/player/MagicSystem.js');
  const mendBody = body(magic, '_castTideMend(def) {');
  ok(/p\.health = plan\.health/.test(mendBody), '回潮只写本机玩家的血量');
  ok(/p\.applyEffect\(def\.guardEffect/.test(mendBody), '防护只挂在本机玩家身上');
  ok((magic.match(/applyEffect\(/g) || []).length === 1, '整个魔法域只有一处 applyEffect（没有第二份 buff 通道）');
  ok(/t\('回潮：生命 \+{n}', \{ n: plan\.heal \}\)/.test(mendBody), '回潮给本人明确反馈');
  // 远端回潮只播粒子
  const remote = body(magic, 'applyRemoteEffect(msg) {');
  ok(/msg\.spell === 'tide_mend'/.test(remote) && /_mendFxAt\(msg\.x/.test(remote),
    '远端回潮只播水汽');
  ok(!/applyEffect|\.health =/.test(remote), '远端施法不改任何人的血量/效果');
}

// ── ④ 怪物伤害：单点、一次 ──────────────────────────────────────────────
{
  const magic = src('../src/player/MagicSystem.js');
  const update = body(magic, '_updateBolts(dt) {');
  ok((update.match(/attackMob\(/g) || []).length === 1, '弹道里只有一处 attackMob 调用');
  ok(/if \(bolt\.local && def && reach > 1e-6\)/.test(update), '只有本端弹道做结算');
  ok(/if \(!hit\) \{\s*hit = g\.mobManager/.test(update), '玩家命中后不再对怪物二次结算');
  ok(/hit \|\| blocked \|\| bolt\.life <= 0/.test(update) && /bolt\.dead = true/.test(update),
    '命中/被挡/寿命尽即销毁（一发只结算一次）');
  ok(!/world\.setBlock/.test(magic), '弹道不改地形（不点燃、不炸方块）');
}

// ── ⑤ PvP：走既有闸门 ───────────────────────────────────────────────────
{
  const magic = src('../src/player/MagicSystem.js');
  const net = src('../src/net/NetworkManager.js');
  const room = src('../server/room.js');
  const canPvP = body(magic, '_canPvP() {');
  ok(/g\.networkMode/.test(canPvP) && /g\.net\.roomSettings\.pvp !== false/.test(canPvP),
    'PvP 前提：联机 + 房间没关 PvP');
  ok(/_findRemoteByRay/.test(canPvP) && /remotePlayers/.test(canPvP), '有远端玩家才检测');
  const update = body(magic, '_updateBolts(dt) {');
  ok(/g\._findRemoteByRay\(new THREE\.Vector3\(px, py, pz\), dir, reach\)/.test(update),
    '玩家命中用同一段射线（墙后不算）');
  ok(/g\.net\.sendAttackPlayer\(rp\.id, dmg, 'magic'\)/.test(update),
    '伤害交给既有 ATTACK_PLAYER 闸门（本端不扣别人血）');
  ok(/const dmg = boltDamage\(bolt, def\)/.test(update), '伤害取自发光的弹体（蓄力结果）');
  ok(!/rp\.hurt|remotePlayers[\s\S]{0,40}\.health/.test(magic), '本端没有直接改远端血量的路径');
  // 网络层与服务器侧
  ok(/sendAttackPlayer\(targetId, damage, kind = null\)/.test(net), '攻击消息可带来源标记');
  ok(/if \(kind\) msg\.kind = String\(kind\)\.slice\(0, 12\)/.test(net), '来源标记透传');
  ok(/if \(msg\.kind === 'magic'\) damage = Math\.min\(damage, MAGIC_PVP_DAMAGE_CAP\)/.test(room),
    '服务器对 magic 来源伤害封顶');
  ok(/let damage = Math\.max\(0, safeNum\(msg\.damage, 1\)\)/.test(room), '近战路径口径未变');
  // 上限必须正好是烬矢满蓄伤害（改数值时两边一起动）
  ok(MAGIC_PVP_DAMAGE_CAP === SPELLS.ember_bolt.charged.damage,
    `魔法 PvP 封顶 = 烬矢满蓄伤害（${MAGIC_PVP_DAMAGE_CAP}）`);
}

// ── ⑥ 远端视觉：只表现 ─────────────────────────────────────────────────
{
  const magic = src('../src/player/MagicSystem.js');
  const remote = body(magic, 'applyRemoteEffect(msg) {');
  ok(/local: false/.test(remote), '远端弹道标记 local:false');
  ok(!/attackMob|sendAttackPlayer|applyEffect|p\.echo/.test(remote),
    '远端施法不结算伤害、不扣回响、不挂效果');
  ok(/if \(!this\.enabled\) return;/.test(remote), '关闭魔法的世界连远端表现都不播');
}

// ── ⑦ 接线：换维透传、死亡清理、档案仍只存回响 ───────────────────────────
{
  const game = src('../src/player/Game.js');
  const magic = src('../src/player/MagicSystem.js');
  const save = src('../src/core/SaveSystem.js');
  // 换维透传冷却
  ok(/magicCooldowns: this\.magic \? this\.magic\.exportCooldowns\(\) : null/.test(game),
    '换维 loadData 携带冷却表');
  // 关键：必须挂在 loadData 顶层——塞进 playerData 时 start() 读不到（曾踩过）
  const playerDataBlock = body(game, 'const playerData = {');
  ok(playerDataBlock.length > 0 && !/magicCooldowns/.test(playerDataBlock),
    '冷却表不塞进 playerData');
  ok(/player: playerData,[\s\S]{0,260}magicCooldowns:/.test(game), '冷却表挂在 loadData 顶层');
  ok(/if \(loadData && loadData\.magicCooldowns\) this\.magic\.importCooldowns\(loadData\.magicCooldowns\)/.test(game),
    '重建世界后恢复冷却');
  ok(/exportCooldowns\(\)/.test(magic) && /importCooldowns\(raw\)/.test(magic), '冷却导出/导入成对存在');
  // 死亡清理（不碰回响与冷却）
  const death = body(magic, 'onPlayerDeath() {');
  ok(/this\.cancelCharge\(\)/.test(death) && /this\._clearBolts\(\)/.test(death), '死亡清蓄力与弹道');
  ok(/slowFall = 0/.test(death), '死亡清缓降');
  ok(!/_lastCast/.test(death) && !/\.echo =/.test(death), '死亡不动冷却与回响');
  ok(/if \(this\.magic\) this\.magic\.onPlayerDeath\(\);/.test(game), '重生路径调用死亡清理');
  ok(/this\.player\.slowFall = 0;/.test(game), '重生也把缓降清零');
  // 存档：只有回响进存档（冷却/tamp 等运行态不进）
  ok(/echo: game\.player\.echo \| 0/.test(save), '存档保留回响');
  ok(!/magicCooldowns|cooldown/i.test(save), '存档不写冷却（换维才透传）');
  // 生命周期表与实现同源
  ok(/规则见 core\/Magic\.js 的 MAGIC_LIFECYCLE/.test(magic), '实现处显式引用规则表（口径同源）');
  for (const id of SPELL_IDS) ok(!!SPELLS[id], `${id} 仍在法术表里`);
}

finish('build54-lifecycle-split');