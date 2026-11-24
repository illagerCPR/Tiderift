// build52-machine-ui.mjs -- Build 52 R2 潮工机器界面回归（纯 node，不依赖服务器）
// 断言：
//   ① 文案表：机器状态原因 / 槽位标签全覆盖（没有回落到代码名的裸文本）
//   ② 界面数据：machineStatus 的配方/进度/供需/原因与槽位布局同源
//   ③ 接线：右键机器 → 界面、潜行右键 → 快捷动作、离合闸 → 拨杆
//   ④ 联机：INDUSTRY_OPEN 协议 / 服务器定向回包 / 指定槽位校验 / 回执回显背包槽位
//   ⑤ 生命周期：新建型界面（构造 / 释放 / E 与 ESC 关闭 / 每帧 tick / 输入阻断清单 / 悬浮名）
import { readFileSync } from 'fs';
import { machineStatus, MACHINE_REASONS, emptyBoilerState, emptyCrusherState, emptyCutterState } from '../src/core/Industry.js';
import { MACHINE_SLOTS, recipesFor } from '../src/content/industry/defs.js';
import { reasonText, slotLabel } from '../src/ui/MachineScreen.js';
import { t } from '../src/i18n/index.js';
import { en } from '../src/i18n/locales/en.js';
import { ok, finish } from './harness.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');

// ── ① 文案表 ────────────────────────────────────────────────────────────
{
  const seen = new Set();
  for (const code of MACHINE_REASONS) {
    const text = reasonText(code);
    ok(typeof text === 'string' && text.length > 0, `原因 ${code} 有文案`);
    ok(text !== code, `原因 ${code} 不是裸代码名（${text}）`);
    ok(!seen.has(text), `原因文案不重复（${code} → ${text}）`);
    seen.add(text);
    ok(Object.prototype.hasOwnProperty.call(en, text), `原因 ${code} 的文案在英文包（${text}）`);
  }
  ok(reasonText('unknown-code') === t('待机'), '未知原因回落到待机文案');
  // 槽位标签
  const slots = new Set();
  for (const list of Object.values(MACHINE_SLOTS)) for (const s of list) slots.add(s);
  for (const slot of slots) {
    const label = slotLabel(slot);
    ok(typeof label === 'string' && label.length > 0 && label !== slot, `槽位 ${slot} 有标签（${label}）`);
    ok(Object.prototype.hasOwnProperty.call(en, label), `槽位 ${slot} 的标签在英文包（${label}）`);
  }
  ok(slotLabel('nope') === 'nope', '未知槽位安全回落');
}

// ── ② 界面数据与状态派生同源 ────────────────────────────────────────────
{
  const net = { supply: 4, demand: 3, efficiency: 1, nodes: 4, overLimit: false };
  const cutter = { ...emptyCutterState(), input: { name: 'oak_log', count: 2, data: null }, progress: 1.5 };
  const st = machineStatus('cutter', cutter, net);
  ok(st.recipe && st.recipe.output === 'oak_planks', '界面配方 = 切割表结果');
  ok(Math.abs(st.progressFrac - 0.5) < 1e-9, '进度按 CUT_TIME 归一（3 秒的一半）');
  ok(st.supply === 4 && st.demand === 3 && st.efficiency === 1, '供需来自网络摘要');
  ok(st.reason === 'running', '推进中显示 running');
  const rows = recipesFor('cutter');
  ok(rows.length >= 7 && rows.every((r) => r.time === 3), '配方表带统一加工时长（界面行数据）');
  const boiler = { ...emptyBoilerState(), fuel: { name: 'coal', count: 1, data: null } };
  ok(machineStatus('boiler', boiler, null).reason === 'no-water', '锅炉缺水的界面原因');
  ok(machineStatus('crusher', emptyCrusherState(), null).reason === 'no-input', '空碎石机界面原因');
  // 界面种类只允许三种可交互机器（轴/离合闸没有界面）
  ok(!MACHINE_SLOTS.shaft && !MACHINE_SLOTS.clutch, '传动轴与离合闸没有机器界面槽位');
  ok(MACHINE_SLOTS.crusher.length === 3 && MACHINE_SLOTS.cutter.length === 3, '加工机三槽（原料/主产物/副产物）');
}

// ── ③ 交互接线 ──────────────────────────────────────────────────────────
{
  const ic = src('../src/player/InteractionController.js');
  ok(/g\.controls\.isSneaking\(\)/.test(ic), '潜行右键走快捷动作');
  ok(/g\.machineScreen\.show\(furnaceHit\.block\.x, furnaceHit\.block\.y, furnaceHit\.block\.z\)/.test(ic),
    '普通右键打开机器界面');
  ok(/kind === 'clutch'[\s\S]{0,220}toggleClutchAt/.test(ic), '离合闸右键 = 拨杆（不开界面）');
  ok(/g\.industry\.interact\(furnaceHit\.block\)/.test(ic), '快捷动作仍走 IndustrySystem.interact');
  const sys = src('../src/player/IndustrySystem.js');
  ok(/requestAction\(block, op, slot, name, count, inv = -1\)/.test(sys), '界面动作入口带槽位与背包槽位');
  ok(/requestOpen\(block\)/.test(sys) && /sendIndustryOpen/.test(sys), '打开界面会向服务器拉状态');
  ok(/applyRemoteState\(msg\)[\s\S]{0,600}msg\.net/.test(sys), '联机状态缓存网络摘要');
  ok(/const text = codeText\(res\.code\);/.test(sys), '回执文案走静态 t() 分支（不再用动态表）');
  ok(!/CODE_TEXT\[/.test(sys), '旧的动态文案表已移除（i18n 不会再漏键）');
}

// ── ④ 联机协议与服务器侧 ────────────────────────────────────────────────
{
  const proto = src('../server/protocol.js');
  const room = src('../server/room.js');
  const net = src('../src/net/NetworkManager.js');
  const rl = src('../server/ratelimit.js');
  ok(/INDUSTRY_OPEN: 'industry_open'/.test(proto), '协议登记 INDUSTRY_OPEN');
  ok(/case MSG\.INDUSTRY_OPEN: this\.onIndustryOpen\(player, msg\); break;/.test(room), '服务器路由 INDUSTRY_OPEN');
  ok(/onIndustryOpen\(player, msg\)[\s\S]{0,700}industryMessage\(x, y, z, dim, st, 0, this\._industryNetInfo\(dim, key\)\)/.test(room),
    'INDUSTRY_OPEN 定向回状态 + 网络摘要');
  ok(/typeof msg\.slot === 'string' && msg\.slot && !isMachineSlot\(kind, msg\.slot\)/.test(room),
    '服务器校验槽位归属（不属于这台机器的槽位直接拒）');
  ok(/applyIndustryAction\(kind, st, op, name, safeInt\(msg\.count, 1\), slot\)/.test(room), '槽位透传到纯算法');
  ok(/res: \{ \.\.\.res, name, inv \}/.test(room), '回执回显背包槽位');
  ok(/if \(kind === 'clutch'\)[\s\S]{0,600}toggleClutch\(st\)/.test(room), '服务器处理离合闸拨杆');
  ok(/setClutchPowered\(st, msg\.on === true \|\| msg\.on === 1\)/.test(room), '服务器处理红石信号（只认 true/1）');
  ok(/this\._industryVersion\+\+;[\s\S]{0,200}导流可能变化/.test(room), '通断变化使拓扑缓存作废');
  ok(/sendIndustryOpen\(x, y, z\)/.test(net), '客户端发送 INDUSTRY_OPEN');
  ok(/slot = null, inv = -1, on = null/.test(net), '客户端动作消息带槽位/背包槽位/信号位');
  ok(/INDUSTRY_ACTION \|\| msgType === MSG\.INDUSTRY_OPEN\) return 'state'/.test(rl), '工业消息纳入限速档');
  ok(/REFRESH_SEC = 0\.9/.test(src('../src/ui/MachineScreen.js')), '联机界面约 1s 刷新一次（不刷屏）');
}

// ── ⑤ 界面生命周期接线 ─────────────────────────────────────────────────
{
  const game = src('../src/player/Game.js');
  ok(/this\.machineScreen = new MachineScreen\(this\)/.test(game), 'start 创建设备界面');
  ok(/this\.machineScreen\.dispose\(\)/.test(game), '_disposeWorld 释放（新建型）');
  ok(/this\.machineScreen && this\.machineScreen\.visible\) \{ this\.machineScreen\.hide\(\); return; \}/.test(game),
    'E 键关闭');
  ok(/this\.machineScreen\.visible\) \{\n\s+this\.machineScreen\.hide\(\);[\s\S]{0,80}\}/.test(game), 'ESC 关闭');
  ok(/this\.machineScreen\.tick\(dt\)/.test(game), '每帧刷新（进度/槽位/联机状态）');
  ok(/this\.machineScreen && this\.machineScreen\.visible\) \|\|/.test(game), '纳入唯一输入阻断清单');
  ok(/this\.furnaceScreen, this\.machineScreen, this\.tradeScreen/.test(game), '纳入 R/U 悬浮目标');
  const ms = src('../src/ui/MachineScreen.js');
  ok(/controls\.enabled = false/.test(ms) && /controls\.enabled = true/.test(ms), '打开/关闭维护 controls.enabled');
  ok(/exitPointerLock/.test(ms), '打开时释放指针锁');
  ok(/el\.remove\(\)/.test(ms), 'dispose 摘除 DOM');
  ok(/this\.el\.addEventListener\('click'/.test(ms), '点遮罩关闭界面');
}

finish('build52-machine-ui');