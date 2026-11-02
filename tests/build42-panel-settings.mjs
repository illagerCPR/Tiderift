// build42-panel-settings.mjs -- Build 42 批次回归（node 直跑，无需服务器）
// 断言：
//   ① 自动跳跃开关（Settings.autoJump → Physics.autoJump）：默认开且原行为不变（1 格台阶瞬抬）；
//     关掉后玩家撞台阶不再抬升（走碰撞回退，须手动跳）；怪物（isMob）不受开关影响；
//     水中上岸助推不受开关影响（生存必需，不是自动跳跃）；开关只作用玩家不误伤 AI。
//   ② 接线绊线：DEFAULT_SETTINGS.autoJump / loadSettings 回读 / applySettings 写 physics.autoJump /
//     VideoSettings 有 autoJump 行且写 settings.autoJump。
//   ③ 命令面板布局（B42 空白区修复）：面板三段式 flex（主体 flex:1 0 auto 吃剩余高度但不压缩）、
//     两列 stretch 等高且可独立滚动、探索卡与列表 flex 撑满 + 列表自身滚动、不可压缩卡固定尺寸、
//     灵魂出窍移入左列、生成实体固定底部不收缩、空状态有文案（矮视口改为整块面板滚动，不叠卡）。
//   ④ 设置面板更名与溢出修复：标题键「设置」（不再有「视频设置」）、justify-content:flex-start +
//     面板 margin:auto 0（居中且超高不裁顶）。
import { readFileSync } from 'fs';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import '../src/blocks/BlockDefs.js'; // 副作用导入：方块注册表填充
import { Physics } from '../src/player/Physics.js';

// localStorage 桩：必须在 import Settings 之前装好（Node 26 有实验性内建 localStorage，直接访问会打
// ExperimentalWarning，污染 CI 输出）
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(String(k), String(v)); },
  removeItem: (k) => { memStore.delete(k); },
};
const { DEFAULT_SETTINGS, loadSettings, saveSettings, applySettings } =
  await import('../src/core/Settings.js');
const { ok, finish } = await import('./harness.mjs');

function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }

const STONE = BlockRegistry.getId('stone');
const WATER = BlockRegistry.getId('water');
function makeWorld(cells) {
  const get = (x, y, z) => cells.get(`${x},${y},${z}`) ?? 0;
  return { getBlock: (x, y, z) => get(x, y, z) };
}
function makeEntity(x, y, z, vx = 0, vy = 0, vz = 0) {
  return {
    position: { x, y, z }, velocity: { x: vx, y: vy, z: vz },
    inWater: false, onGround: false, flying: false, spectator: false, gliding: false,
  };
}

// 1 格台阶场景：地平面 y=63（顶面 64），x=1 处台阶块 y=64（顶面 65）；实体站在 x=0 撞向 +x
function stepScene() {
  const cells = new Map();
  for (let x = -2; x <= 3; x++) {
    for (let z = -2; z <= 2; z++) cells.set(`${x},63,${z}`, STONE);
  }
  for (let z = -2; z <= 2; z++) cells.set(`1,64,${z}`, STONE);
  return makeWorld(cells);
}

// ═══ ① 自动跳跃开关 ═══
{
  const dt = 1 / 60;

  // ①-a 默认开启：1 格台阶自动抬升，水平位移保留（既有手感不变）
  const physOn = new Physics(stepScene());
  ok(physOn.autoJump === true, 'Physics.autoJump 默认 true（未套设置前保持原行为）');
  const a = makeEntity(0.7, 64, 0.5, 3, 0, 0);
  physOn.collide(a, dt);
  ok(a.position.y > 64.9, `自动跳跃开启：撞台阶抬升到顶面（y=${a.position.y.toFixed(3)} > 64.9）`);
  ok(a.position.x > 0.7, `自动跳跃开启：水平位移保留（x=${a.position.x.toFixed(3)} > 0.7）`);

  // ①-b 关闭：玩家不抬升，走碰撞回退（x 被推回到台阶侧面外），竖直仍贴地
  const physOff = new Physics(stepScene());
  physOff.autoJump = false;
  const b = makeEntity(0.7, 64, 0.5, 3, 0, 0);
  physOff.collide(b, dt);
  ok(b.position.y < 64.05, `自动跳跃关闭：不抬升（y=${b.position.y.toFixed(3)} < 64.05）`);
  ok(b.position.x <= 0.7, `自动跳跃关闭：水平被台阶挡住回退（x=${b.position.x.toFixed(3)} ≤ 0.7）`);
  ok(b.velocity.x === 0, '自动跳跃关闭：撞墙水平速度清零');
  ok(b.onGround === true, '自动跳跃关闭：仍站在地面上');

  // ①-c 怪物不受开关影响（AI 台阶跨越恒开，否则村民/僵尸卡坡坎）
  const mob = makeEntity(0.7, 64, 0.5, 3, 0, 0);
  mob.isMob = true;
  physOff.collide(mob, dt);
  ok(mob.position.y > 64.9, `怪物实体 autoJump=false 仍踏越台阶（y=${mob.position.y.toFixed(3)} > 64.9）`);
  ok(mob.position.x > 0.7, '怪物实体水平位移保留');

  // ①-d 水中上岸助推不受开关影响（生存必需：关自动跳跃也必须能爬上岸）
  const cells = new Map();
  for (let y = 62; y <= 65; y++) cells.set(`0,${y},0`, WATER);
  for (let y = 62; y <= 64; y++) cells.set(`1,${y},0`, STONE);
  cells.set('0,61,0', STONE); cells.set('1,61,0', STONE);
  const physWater = new Physics(makeWorld(cells));
  physWater.autoJump = false;
  const w = makeEntity(0.68, 64.2, 0.5, 2.15, 0, 0);
  w.inWater = true;
  physWater.collide(w, dt);
  ok(w.bodyInWater === true, '水域实体 bodyInWater = true');
  ok(w.velocity.y >= 3.9, `autoJump=false 仍给水中上岸助推（vy=${w.velocity.y.toFixed(2)} ≥ 3.9）`);
  ok(w.position.y < 64.5, 'autoJump=false 水中不瞬抬台阶');
}

// ═══ ② 设置接线 ═══
{
  ok(DEFAULT_SETTINGS.autoJump === true, 'DEFAULT_SETTINGS.autoJump 默认 true');

  const s = loadSettings();
  ok(s.autoJump === true, 'loadSettings 无存档时 autoJump = true');
  saveSettings({ ...s, autoJump: false });
  ok(loadSettings().autoJump === false, 'autoJump=false 可持久化并回读');
  ok(loadSettings().smoothLighting === true, '同一份存档其它字段不受影响');

  const game = { settings: { ...DEFAULT_SETTINGS, autoJump: false }, physics: { autoJump: true } };
  applySettings(game);
  ok(game.physics.autoJump === false, 'applySettings 把 autoJump 写进 physics');
  applySettings({ settings: { ...DEFAULT_SETTINGS, autoJump: true }, physics: { autoJump: false } });
  const g2 = { settings: { ...DEFAULT_SETTINGS, autoJump: true }, physics: { autoJump: false } };
  applySettings(g2);
  ok(g2.physics.autoJump === true, '再开回 true 同样生效（热切换）');
  applySettings({ settings: { ...DEFAULT_SETTINGS, autoJump: false } }); // 无 physics 不抛
  ok(true, 'applySettings 对缺 physics 的调用方容错（主菜单期）');

  const vs = srcOf('../src/ui/VideoSettings.js');
  ok(/mkRow\('autoJump', gAudio\)/.test(vs), '设置面板有自动跳跃行');
  ok(/s\.autoJump = this\.game\.settings\.autoJump === false/.test(vs), '自动跳跃行点击写 settings.autoJump');
  ok(/自动跳跃: \{v\}/.test(vs), '自动跳跃行文案走 i18n 键');
  ok(/rows\.autoJump\.textContent/.test(vs), '_refresh 刷新自动跳跃行文本');
}

// ═══ ③ 命令面板布局（空白区修复） ═══
{
  const cp = srcOf('../src/ui/CommandPanel.js');

  ok(/width: min\(900px, 95vw\)/.test(cp), '面板加宽到 min(900px, 95vw)（生成实体网格少一行）');
  ok(/max-height: 88vh/.test(cp), '面板仍受 88vh 高度上限约束');
  ok(/align-items:stretch/.test(cp), '双列主体 align-items:stretch（两列等高，左列不再留白）');
  ok(/flex:1 0 auto/.test(cp), '主体 flex:1 0 auto（有富余才长高；空间不够时不压缩，改整块面板滚动）');
  ok(!/min-height:\s*220px/.test(cp), '主体不再用固定 min-height 兜底（压缩会导致卡片重叠）');
  ok(/colL\.style\.overflowY = 'auto'/.test(cp), '左列可独立滚动（矮视口兜底）');
  ok(/colR\.style\.overflowY = 'auto'/.test(cp), '右列可独立滚动（矮视口兜底）');
  ok(/exploreCard\.style\.flex = '1 1 auto'/.test(cp), '探索卡 flex 撑满左列剩余高度');
  ok(/exploreCard\.style\.minHeight = '160px'/.test(cp), '探索卡保底 160px（标题+列表下限+内边距，防被挤扁重叠）');
  ok(/flex: 1 1 auto; min-height: 120px; overflow-y: auto/.test(cp), '探索列表自身滚动且有 120px 下限');
  ok(!/max-height: 150px/.test(cp), '旧的探索列表 150px 硬上限已移除（改由卡片高度决定）');
  ok(/tpCard\.style\.flex = '0 0 auto'/.test(cp), '传送卡不可压缩（矮视口下不被挤扁）');
  ok(/soulCard\.style\.flex = '0 0 auto'/.test(cp), '灵魂出窍卡不可压缩');
  ok(/colL\.appendChild\(soulCard\)/.test(cp), '灵魂出窍卡移入左列（两列高度接近）');
  ok(!/colR\.appendChild\(soulCard\)/.test(cp), '灵魂出窍卡不再挂在右列');
  ok(/mobCard\.style\.flex = '0 0 auto'/.test(cp), '生成实体卡固定底部不参与收缩（不再被挤出视口）');
  ok(/附近没有可传送的建筑/.test(cp), '探索空状态有文案（撑满后不留纯空白）');

  // 卡片挂载顺序：左列 = 传送 / 探索 / 灵魂出窍；右列 = 维度 / 模式 / 时间 / 维度检查
  const leftAppends = [...cp.matchAll(/colL\.appendChild\((\w+)\)/g)].map((m) => m[1]);
  ok(leftAppends.join(',') === 'tpCard,exploreCard,soulCard', `左列顺序 = ${leftAppends.join(',')}`);
  const rightAppends = [...cp.matchAll(/colR\.appendChild\((\w+)\)/g)].map((m) => m[1]);
  ok(rightAppends.join(',') === 'dimCard,modeCard,timeCard,aetherCard', `右列顺序 = ${rightAppends.join(',')}`);

  // 重建（语言切换）后仍保持结构：_rebuild 先清空再 _build，引用全部重建
  ok(/_rebuild\(\)[\s\S]{0,120}this\.panel\.innerHTML = '';/.test(cp), '_rebuild 清空后重建，布局指令单点');
}

// ═══ ④ 设置面板更名与溢出修复 ═══
{
  const vs = srcOf('../src/ui/VideoSettings.js');
  ok(/t\('设置'\)/.test(vs), '面板标题用「设置」键');
  ok(!/t\('视频设置'\)/.test(vs), '不再出现「视频设置」标题键');
  ok(/justify-content: flex-start/.test(vs), '容器 justify-content:flex-start（超高时不裁顶部）');
  ok(/margin:auto 0/.test(vs), '面板 margin:auto 0（有空间才居中，溢出时置顶可滚）');

  const menu = srcOf('../src/ui/MenuScreen.js');
  ok(/\$\{t\('⚙ 设置'\)\}/.test(menu), '主菜单入口改「⚙ 设置」');
  const pause = srcOf('../src/ui/PauseMenu.js');
  ok(/_mkBtn\('设置'\)/.test(pause), '暂停菜单按钮改「设置」');
  ok(!/t\('视频设置'\)/.test(pause), '暂停菜单不再出现「视频设置」');

  // 语言包：10 包都带新键（键集对齐由 i18n-parity 兜底，这里只钉住「视频设置」键已彻底退休）
  for (const loc of ['zh-TW', 'en', 'fr', 'de', 'ja', 'ko', 'ar', 'ru', 'es', 'pt']) {
    const pack = srcOf(`../src/i18n/locales/${loc}.js`);
    ok(!/^ {2}'(⚙ )?视频设置':/m.test(pack), `[${loc}] 旧「视频设置」键已移除`);
    ok(/^ {2}'设置': /m.test(pack), `[${loc}] 有「设置」键`);
    ok(/^ {2}'自动跳跃: \{v\}': /m.test(pack), `[${loc}] 有「自动跳跃: {v}」键`);
  }
}

finish('build42 panel+settings');
