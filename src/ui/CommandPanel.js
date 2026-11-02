// CommandPanel.js -- 命令面板（启用作弊的存档专享，按 C 呼出）
import { Mob } from '../entity/Mob.js';
import { MobTypes } from '../entity/MobTextures.js';
import { ringPoints } from '../world/structures/stronghold.js';
import { DIMENSIONS } from '../core/dimensions.js';
import { STELE_CHAPTERS } from '../world/steles.js';
import { ensureStoneStyles } from './StoneStyle.js';
import { t, onLocaleChange } from '../i18n/index.js';
import { tName } from '../i18n/name.js';

// 探索列表：玩家周围村庄扫描 cell 半径（cell=20 区块 → ±960 格）；要塞环带 3 点全局 O(1)
const EXPLORE_VILLAGE_CELL_R = 3;
// 探索列表：下界要塞扫描 cell 半径（fortress cell=20 区块）
const EXPLORE_FORTRESS_CELL_R = 2;

const MODES = [
  { name: 'creative', label: '创造', bg: '#4a8a4a', border: '#2a5a2a' },
  { name: 'survival', label: '生存', bg: '#8a4a4a', border: '#5a2a2a' },
  { name: 'spectator', label: '旁观', bg: '#4a4a8a', border: '#2a2a5a' }
];

// 生成实体列表 = 全部注册怪物（MobTypes 枚举，新增生物自动纳入面板）
const MOB_ORDER = ['zombie', 'skeleton', 'zombified_piglin', 'wither_skeleton', 'wither', 'creeper', 'spider', 'blaze', 'mourn_howler', 'wisp', 'aether_guard', 'cloud_lamb', 'gale_hawk', 'tide_echo', 'storm_colossus', 'villager'];
function mobEntries() {
  const names = Object.keys(MobTypes);
  names.sort((a, b) => {
    const ia = MOB_ORDER.indexOf(a), ib = MOB_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  // 怪物名走 names.js 十一语字典（tName）；语言包无怪物名键，走 t() 会始终回落简体（Build 7 修复）
  return names.map(n => ({ name: n, label: tName(n, MobTypes[n].displayName || n) }));
}

export class CommandPanel {
  constructor(game) {
    this.game = game;
    this.visible = false;
    ensureStoneStyles();

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; z-index: 35;
      background: rgba(0,0,0,0.6); align-items: center; justify-content: center;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; color: #fff;
    `;

    // B42 布局：面板本身是三段式 flex（头 / 双列主体 / 生成实体），主体吃掉剩余高度——
    // 左列"探索"列表随高度伸缩填满，两列等高且各自可滚动，不再出现左列下方的大片空白，
    // 也不会再把底部"生成实体"整卡挤出视口（旧版 panel 整体 overflow-y:auto 的副作用）。
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      background: #2a2a2a; border: 3px solid #555; padding: 14px 18px;
      display: flex; flex-direction: column; gap: 10px;
      width: min(900px, 95vw); max-height: 88vh; overflow-y: auto;
    `;
    this.el.appendChild(this.panel);

    this._build();
    // 语言切换（Build 5 i18n）：面板按钮/卡片标题是构造期一次性文本，整体重建最稳
    //（_build 会重建 tpX/tpY/tpZ/timeInput/dimBtns/modeBtns/exploreBox 等全部引用）
    this._unbindLocale = onLocaleChange(() => this._rebuild());
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });

    document.body.appendChild(this.el);
  }

  // 语言切换后整体重建面板（_build 重新赋值全部内部引用），可见时补跑动态刷新
  _rebuild() {
    this.panel.innerHTML = '';
    this._build();
    if (this.visible) {
      this._refreshModeHighlight();
      this._refreshDimensionHighlight();
      this._refreshTimeLabel();
      this._refreshExplore();
      this._refreshDimTools();
    }
  }

  _mkLabel(text) {
    const l = document.createElement('div');
    l.textContent = t(text);
    l.style.cssText = 'font-size:12px; color:#bbd; font-weight:bold; letter-spacing:1px;';
    return l;
  }

  // 卡片容器：标题 + 内容体（双列布局的分区单元）
  _mkCard(title) {
    const card = document.createElement('div');
    card.style.cssText = `
      background: rgba(0,0,0,0.28); border: 1px solid #444; padding: 8px 10px;
      display: flex; flex-direction: column; gap: 6px; min-width: 0;
    `;
    if (title) card.appendChild(this._mkLabel(title));
    return card;
  }

  _mkBtn(label, extraClass = '') {
    ensureStoneStyles();
    const b = document.createElement('button');
    b.className = `cw-stone-btn${extraClass ? ' ' + extraClass : ''}`;
    b.textContent = t(label);
    b.style.cssText = 'padding:8px 12px; font-size:13px;';
    return b;
  }

  _mkInput(id, value) {
    const i = document.createElement('input');
    i.type = 'number';
    i.id = id;
    i.value = value;
    i.step = '0.5';
    i.style.cssText = 'padding:6px 8px; font-size:13px; background:rgba(0,0,0,0.4); border:1px solid #555; color:#fff; width:80px;';
    return i;
  }

  _build() {
    // 头部：标题 + 关闭（原先底部关闭钮上移，压缩纵向长度）
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between;';
    const title = document.createElement('div');
    title.textContent = t('命令面板');
    title.style.cssText = 'font-size:18px; font-weight:bold; letter-spacing:2px;';
    header.appendChild(title);
    const closeBtn = this._mkBtn('关闭 (C / ESC)');
    closeBtn.style.padding = '4px 10px';
    closeBtn.addEventListener('click', () => this.hide());
    header.appendChild(closeBtn);
    this.panel.appendChild(header);

    // 双列卡片主体：左列 = 传送/探索/灵魂出窍；右列 = 维度/模式/时间/维度检查
    // （B42：align-items 由 flex-start 改为 stretch——两列等高，"探索"卡片靠 flex 吃掉
    //   左列剩余高度，空白由可滚动的建筑列表填满而不是留白）
    // flex 用 `1 0 auto`：有富余空间时主体长高（探索列表跟着长），空间不够时**不压缩**
    // —— 压缩会让卡片被挤到内容高度以下互相重叠（矮视口实测），改为整块面板滚动。
    const body = document.createElement('div');
    body.style.cssText = 'display:flex; gap:10px; align-items:stretch; flex:1 0 auto;';
    const colL = document.createElement('div');
    const colR = document.createElement('div');
    for (const col of [colL, colR]) {
      col.style.cssText = 'flex:1 1 0; min-width:0; min-height:0; display:flex; flex-direction:column; gap:8px;';
      body.appendChild(col);
    }
    // 两列都可独立滚动：卡片数量多/换行变高/视口矮时列内滚动，不撑高整个面板也不互相压
    colL.style.overflowY = 'auto';
    colR.style.overflowY = 'auto';
    this.panel.appendChild(body);

    // ① 传送（左上）
    const tpCard = this._mkCard('传送至坐标');
    tpCard.style.flex = '0 0 auto';
    colL.appendChild(tpCard);
    const tpRow = document.createElement('div');
    tpRow.style.cssText = 'display:flex; gap:6px; align-items:center;';
    tpRow.appendChild(this._mkLabel('X:'));
    this.tpX = this._mkInput('cmd-tp-x', 0);
    tpRow.appendChild(this.tpX);
    tpRow.appendChild(this._mkLabel('Y:'));
    this.tpY = this._mkInput('cmd-tp-y', 64);
    tpRow.appendChild(this.tpY);
    tpRow.appendChild(this._mkLabel('Z:'));
    this.tpZ = this._mkInput('cmd-tp-z', 0);
    tpRow.appendChild(this.tpZ);
    tpCard.appendChild(tpRow);

    const tpBtns = document.createElement('div');
    tpBtns.style.cssText = 'display:flex; gap:6px;';
    const tpBtn = this._mkBtn('传送');
    tpBtn.addEventListener('click', () => this._teleport());
    tpBtns.appendChild(tpBtn);
    const spawnBtn = this._mkBtn('返回出生点');
    spawnBtn.addEventListener('click', () => {
      const sp = this.game.world.getSpawnPoint();
      this.tpX.value = sp.x.toFixed(1);
      this.tpY.value = sp.y.toFixed(1);
      this.tpZ.value = sp.z.toFixed(1);
      this._teleport();
    });
    tpBtns.appendChild(spawnBtn);
    const hereBtn = this._mkBtn('填入当前位置');
    hereBtn.addEventListener('click', () => {
      const p = this.game.player.position;
      this.tpX.value = p.x.toFixed(1);
      this.tpY.value = p.y.toFixed(1);
      this.tpZ.value = p.z.toFixed(1);
    });
    tpBtns.appendChild(hereBtn);
    tpCard.appendChild(tpBtns);

    // ② 探索：附近建筑坐标（W2，show() 时刷新；点击行内按钮直接传送）
    // B42：卡片与列表都 flex 撑满左列剩余高度（列表自身滚动），左列因此不再留白
    const exploreCard = this._mkCard('探索：附近建筑');
    exploreCard.style.flex = '1 1 auto';
    exploreCard.style.minHeight = '160px';
    colL.appendChild(exploreCard);
    this.exploreBox = document.createElement('div');
    this.exploreBox.style.cssText = `
      display: flex; flex-direction: column; gap: 3px; font-size: 12px;
      flex: 1 1 auto; min-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.25);
      padding: 6px 8px; border: 1px solid #444;
    `;
    exploreCard.appendChild(this.exploreBox);

    // ③ 维度传送（右上，仅列已实现维度；联机维度同步 M4 开放）
    const dimCard = this._mkCard('维度传送');
    colR.appendChild(dimCard);
    const dimRow = document.createElement('div');
    dimRow.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap;';
    this.dimBtns = [];
    for (const def of Object.values(DIMENSIONS)) {
      if (!def.implemented) continue;
      const b = this._mkBtn(def.name);
      b.addEventListener('click', () => {
        this.hide();
        this.game.switchDimension(def.id);
      });
      dimRow.appendChild(b);
      this.dimBtns.push({ id: def.id, el: b });
    }
    dimCard.appendChild(dimRow);

    // ④ 切换游戏模式（右中）
    const modeCard = this._mkCard('切换游戏模式');
    colR.appendChild(modeCard);
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex; gap:6px;';
    this.modeBtns = [];
    for (const m of MODES) {
      const b = this._mkBtn(m.label);
      b.addEventListener('click', () => {
        this.game.player.setMode(m.name);
        this._refreshModeHighlight();
      });
      modeRow.appendChild(b);
      this.modeBtns.push({ name: m.name, el: b });
    }
    modeCard.appendChild(modeRow);

    // ⑤ 时间控制（右下；0=半夜 0.25=日出 0.5=正午 0.75=日落）
    const timeCard = this._mkCard('时间控制 (0=半夜 0.25=日出 0.5=正午 0.75=日落)');
    colR.appendChild(timeCard);
    const timeRow = document.createElement('div');
    timeRow.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap;';
    const TIME_PRESETS = [
      { label: '日出', value: 0.25, bg: '#8a6a3a', border: '#5a4a2a' },
      { label: '正午', value: 0.50, bg: '#8a8a3a', border: '#5a5a2a' },
      { label: '日落', value: 0.75, bg: '#8a4a3a', border: '#5a2a2a' },
      { label: '半夜', value: 0.00, bg: '#3a3a6a', border: '#2a2a4a' }
    ];
    for (const tp of TIME_PRESETS) {
      const b = this._mkBtn(tp.label);
      b.addEventListener('click', () => this._setTime(tp.value));
      timeRow.appendChild(b);
    }
    timeCard.appendChild(timeRow);

    const timeCustomRow = document.createElement('div');
    timeCustomRow.style.cssText = 'display:flex; gap:6px; align-items:center;';
    timeCustomRow.appendChild(this._mkLabel('Time:'));
    this.timeInput = this._mkInput('cmd-time', 0.5);
    this.timeInput.step = '0.05';
    this.timeInput.min = '0';
    this.timeInput.max = '1';
    timeCustomRow.appendChild(this.timeInput);
    const setBtn = this._mkBtn('设为');
    setBtn.addEventListener('click', () => this._setTime(parseFloat(this.timeInput.value)));
    timeCustomRow.appendChild(setBtn);
    const curTimeLabel = document.createElement('span');
    curTimeLabel.style.cssText = 'font-size:12px; color:#9ab; min-width:140px;';
    timeCustomRow.appendChild(curTimeLabel);
    this.curTimeLabel = curTimeLabel;
    timeCard.appendChild(timeCustomRow);

    // ⑦ 灵魂出窍（B41）：相机离体查看（可穿墙），身体与人物视角留在原地。
    // 面板打开时 game.paused=true，所以按钮必须"先关面板再出窍"（关面板恢复 paused/controls）。
    // B42：移入左列底部（原右列），两列高度因此接近；伸缩差额交给上面的"探索"列表吸收。
    const soulCard = this._mkCard('灵魂出窍');
    soulCard.style.flex = '0 0 auto';
    colL.appendChild(soulCard);
    const soulHint = document.createElement('div');
    soulHint.textContent = t('相机离体查看（可穿墙），身体与人物视角留在原地；再按 P 或再次点击按钮归体。');
    soulHint.style.cssText = 'font-size:12px; color:#9ab; line-height:1.45;';
    soulCard.appendChild(soulHint);
    const soulRow = document.createElement('div');
    soulRow.style.cssText = 'display:flex; gap:6px; align-items:center;';
    this.soulBtn = this._mkBtn('出窍（离开身体）');
    this.soulBtn.addEventListener('click', () => {
      const g = this.game;
      this.hide();                 // 先解暂停/恢复输入，否则灵魂相机进不了可操作态
      g.toggleSoul();
      if (g.soulView && g.soulView.active && g.controls) g.controls.requestLock();
    });
    soulRow.appendChild(this.soulBtn);
    this.soulState = document.createElement('span');
    this.soulState.style.cssText = 'font-size:12px; color:#9ab;';
    soulRow.appendChild(this.soulState);
    soulCard.appendChild(soulRow);

    // ⑤b 维度检查（世界观批次 N1 起跨维度）：复潮切换（仅天域，单机权威）+
    // 终局演出调试口（Build 20 ⑥：不再限定天域——四界分段本就全维度并行，任意维度可预览）+
    // 石碑章节直读（按当前维度过滤章节，免跑图逐碑检查叙事；无章节的维度整行隐藏）
    const aetherCard = this._mkCard('维度检查');
    colR.appendChild(aetherCard);
    this.aetherCard = aetherCard;
    const duskWrap = document.createElement('div');
    duskWrap.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    aetherCard.appendChild(duskWrap);
    this.duskWrap = duskWrap;
    const duskBtn = this._mkBtn('触发复潮（解除永昼）');
    duskBtn.addEventListener('click', () => {
      if (this.game.networkMode) return; // 联机房间复潮由服务器权威（潮汐仪式同步），面板不越权
      this.game.applyAetherDusk(!this.game.aetherDusk);
      this._refreshDimTools();
    });
    duskWrap.appendChild(duskBtn);
    this.duskBtn = duskBtn;
    const duskLabel = document.createElement('div');
    duskLabel.style.cssText = 'font-size:11px; color:#9ab;';
    duskWrap.appendChild(duskLabel);
    this.duskLabel = duskLabel;
    // 终局演出：独立行（duskWrap 之外），所有维度可见可用
    const finaleWrap = document.createElement('div');
    finaleWrap.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    aetherCard.appendChild(finaleWrap);
    this.finaleWrap = finaleWrap;
    const finaleBtn = this._mkBtn('终局演出：原初之潮（调试）');
    finaleBtn.addEventListener('click', () => {
      // F2 调试口：本地触发 60s 四界同潮窗口（正式触发链 = F3 守望界碑听潮；
      // LAN startTs 权威分发随 F3 room flag，本按钮联机下仅本地可见）
      if (this.game._finaleTide) this.game._stopFinaleTide();
      else this.game._startFinaleTide();
    });
    finaleWrap.appendChild(finaleBtn);
    const finaleLabel = document.createElement('div');
    finaleLabel.style.cssText = 'font-size:11px; color:#9ab;';
    finaleLabel.textContent = t('60 秒窗口 · 四界分段并行 · 换维追潮');
    finaleWrap.appendChild(finaleLabel);

    const steleRow = document.createElement('div');
    steleRow.style.cssText = 'display:flex; gap:6px; align-items:center;';
    steleRow.appendChild(this._mkLabel('石碑章节'));
    this.steleRow = steleRow;
    this.steleSelect = document.createElement('select');
    this.steleSelect.style.cssText = 'flex:1 1 0; min-width:0; padding:5px 6px; font-size:12px; background:rgba(0,0,0,0.4); border:1px solid #555; color:#fff;';
    steleRow.appendChild(this.steleSelect);
    const readBtn = this._mkBtn('阅读');
    readBtn.style.padding = '5px 12px';
    readBtn.addEventListener('click', () => {
      const p = this.game.player.position;
      this.hide();
      // 章节直读：坐标传玩家脚下（石碑浮层不依赖真实碑位，仅作 pos 记录）
      this.game.steleScreen.open(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), this.steleSelect.value);
    });
    steleRow.appendChild(readBtn);
    aetherCard.appendChild(steleRow);

    // ⑥ 生成实体（整宽卡片：全部注册怪物动态枚举，网格排布）
    // B42：固定在面板底部不参与收缩——主体超高时由整块面板滚动，本卡不会被压扁
    const mobCard = this._mkCard('生成实体（玩家前方 3 格）');
    mobCard.style.flex = '0 0 auto';
    this.panel.appendChild(mobCard);
    const mobRow = document.createElement('div');
    mobRow.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(88px, 1fr)); gap:6px;';
    for (const mt of mobEntries()) {
      const b = this._mkBtn(mt.label);
      b.addEventListener('click', () => this._spawnMob(mt.name));
      mobRow.appendChild(b);
    }
    mobCard.appendChild(mobRow);
  }

  _setTime(t) {
    if (typeof t !== 'number' || isNaN(t)) return;
    t = Math.max(0, Math.min(1, t));
    this.game.sky.time = t;
    this.timeInput.value = t.toFixed(2);
    this._refreshTimeLabel();
  }

  // W2：探索列表 —— 主世界：村庄（recordsAround ±3 cell）+ 要塞环带 3 点（seed 直接派生）；
  // 下界：下界要塞（recordsAround ±2 cell，带 groundY 传送层）；
  // 末地：末地城（±2 cell）；天域：神殿/瞭望塔/沉船（各 ±2 cell）。
  // 按距离排序；每行带"传送"按钮（主世界落地地表 +2，其余维度落结构立地面 +2）
  _refreshExplore() {
    const box = this.exploreBox;
    box.innerHTML = '';
    const world = this.game.world;
    const sm = world && world.generator && world.generator.structureManager;
    if (!sm) return;
    const p = this.game.player.position;
    const items = [];
    if (world.dimension === 'nether') {
      for (const rec of sm.recordsAround('fortress', p.x, p.z, EXPLORE_FORTRESS_CELL_R)) {
        items.push({ name: '下界要塞', x: rec.ax, z: rec.az, y: rec.groundY, d: Math.hypot(rec.ax - p.x, rec.az - p.z) });
      }
      // 潮火之炉（世界观批次 N2）：cell24 稀有，±2 cell 扫描——同 groundY 传送层模式
      for (const rec of sm.recordsAround('tidefire_hearth', p.x, p.z, 2)) {
        items.push({ name: '潮火之炉', x: rec.ax, z: rec.az, y: rec.groundY, d: Math.hypot(rec.ax - p.x, rec.az - p.z) });
      }
    } else if (world.dimension === 'end') {
      // 末地：末地城（recordsAround ±2 cell，带 groundY 传送层——同下界要塞模式）
      for (const rec of sm.recordsAround('end_city', p.x, p.z, 2)) {
        items.push({ name: '末地城', x: rec.ax, z: rec.az, y: rec.groundY, d: Math.hypot(rec.ax - p.x, rec.az - p.z) });
      }
      // 拾遗者石环（世界观批次 E2）：cell14，±2 cell 扫描——同 groundY 传送层模式
      for (const rec of sm.recordsAround('gleaner_ring', p.x, p.z, 2)) {
        items.push({ name: '拾遗者石环', x: rec.ax, z: rec.az, y: rec.groundY, d: Math.hypot(rec.ax - p.x, rec.az - p.z) });
      }
    } else if (world.dimension === 'aether') {
      // 天域：三结构（recordsAround ±2 cell，带 groundY 传送层——同下界/末地模式）
      for (const rec of sm.recordsAround('aether_temple', p.x, p.z, 2)) {
        items.push({ name: '天空神殿', x: rec.ax, z: rec.az, y: rec.groundY, d: Math.hypot(rec.ax - p.x, rec.az - p.z) });
      }
      for (const rec of sm.recordsAround('aether_tower', p.x, p.z, 2)) {
        items.push({ name: '浮空瞭望塔', x: rec.ax, z: rec.az, y: rec.groundY, d: Math.hypot(rec.ax - p.x, rec.az - p.z) });
      }
      for (const rec of sm.recordsAround('aether_ship', p.x, p.z, 2)) {
        items.push({ name: '天域沉船', x: rec.ax, z: rec.az, y: rec.groundY, d: Math.hypot(rec.ax - p.x, rec.az - p.z) });
      }
      // 批次 B/D 新结构：漩风井（cell12）/ 天海之门遗迹（cell24）——同 groundY 传送层模式
      for (const rec of sm.recordsAround('aether_well', p.x, p.z, 2)) {
        items.push({ name: '漩风井', x: rec.ax, z: rec.az, y: rec.groundY, d: Math.hypot(rec.ax - p.x, rec.az - p.z) });
      }
      for (const rec of sm.recordsAround('aether_gate', p.x, p.z, 2)) {
        items.push({ name: '天海之门遗迹', x: rec.ax, z: rec.az, y: rec.groundY, d: Math.hypot(rec.ax - p.x, rec.az - p.z) });
      }
      // 鲸骨冢（鲸骨冢篇 K1）：cell48 稀有，±2 cell 扫描——同 groundY 传送层模式
      for (const rec of sm.recordsAround('whale_barrow', p.x, p.z, 2)) {
        items.push({ name: '鲸骨冢', x: rec.ax, z: rec.az, y: rec.groundY, d: Math.hypot(rec.ax - p.x, rec.az - p.z) });
      }
    } else {
      for (const rec of sm.recordsAround('village', p.x, p.z, EXPLORE_VILLAGE_CELL_R)) {
        const d = Math.hypot(rec.ax - p.x, rec.az - p.z);
        items.push({
          name: rec.meta && rec.meta.variant === 'desert' ? '沙漠村庄' : '村庄',
          x: rec.ax, z: rec.az, d,
        });
      }
      for (const pt of ringPoints(world.seed)) {
        items.push({ name: '要塞', x: pt.x, z: pt.z, d: Math.hypot(pt.x - p.x, pt.z - p.z) });
      }
      // 潮冢（世界观批次 W2）：cell28 河段锚点，±2 cell 扫描——groundY 传送层落水面附近
      for (const rec of sm.recordsAround('tide_barrow', p.x, p.z, 2)) {
        items.push({ name: '潮冢', x: rec.ax, z: rec.az, y: rec.groundY, d: Math.hypot(rec.ax - p.x, rec.az - p.z) });
      }
    }
    items.sort((a, b) => a.d - b.d);
    // B42：列表撑满左列后必须显式说明空状态，否则一片空白会被当成渲染故障
    if (!items.length) {
      const empty = document.createElement('div');
      empty.textContent = t('附近没有可传送的建筑');
      empty.style.cssText = 'color:#889; padding:6px 2px;';
      box.appendChild(empty);
      return;
    }
    for (const it of items) {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px;';
      const label = document.createElement('span');
      label.style.cssText = 'color: #dde; white-space: nowrap;';
      label.textContent = `${t(it.name)} (${it.x}, ${it.z}) · ${Math.round(it.d)}m · ${t(CommandPanel._compass(p.x, p.z, it.x, it.z))}`;
      row.appendChild(label);
      const btn = document.createElement('button');
      btn.className = 'cw-stone-btn mini';
      btn.textContent = '传送';
      btn.style.cssText = 'padding: 2px 8px; font-size: 11px;';
      btn.addEventListener('click', () => {
        const ty = it.y != null ? it.y + 2 : world.getHeightAt(it.x, it.z) + 3;
        this.tpX.value = (it.x + 0.5).toFixed(1);
        this.tpY.value = ty.toFixed(1);
        this.tpZ.value = (it.z + 0.5).toFixed(1);
        this._teleport();
        this.hide();
      });
      row.appendChild(btn);
      box.appendChild(row);
    }
  }

  // 8 方位（本作 -z 为北、+x 为东）
  static _compass(px, pz, tx, tz) {
    const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    const angle = Math.atan2(tx - px, -(tz - pz));
    const idx = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
    return dirs[idx];
  }

  // 维度检查卡刷新：复潮控件（仅天域）+ 石碑章节直读（按当前维度过滤；无内容整卡隐藏）
  _refreshDimTools() {
    if (!this.aetherCard) return;
    const game = this.game;
    const world = game.world;
    const dim = world ? world.dimension : 'overworld';
    const isAether = dim === 'aether';
    // 复潮控件：仅天域显示（终局演出行已独立，全维度可用）
    this.duskWrap.style.display = isAether ? 'flex' : 'none';
    if (isAether) {
      const on = !!game.aetherDusk;
      this.duskBtn.textContent = t(on ? '恢复永昼' : '触发复潮（解除永昼）');
      this.duskLabel.textContent = t(on ? '当前：已复潮' : '当前：永昼');
      this.duskBtn.disabled = !!game.networkMode;
      this.duskBtn.title = game.networkMode ? t('联机房间复潮由服务器权威（潮汐仪式完成后同步）。') : '';
    }
    // 石碑章节直读：选项随维度重建（STELE_CHAPTERS[].dim 过滤），无章节整行隐藏
    const opts = Object.entries(STELE_CHAPTERS).filter(([, ch]) => ch.dim === dim);
    this.steleRow.style.display = opts.length ? 'flex' : 'none';
    this.steleSelect.innerHTML = '';
    for (const [id, ch] of opts) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = t(ch.title);
      this.steleSelect.appendChild(opt);
    }
    // 整卡显隐：终局演出全维度可用 → 卡恒显示（Build 20 ⑥）
    this.aetherCard.style.display = 'flex';
  }

  _refreshTimeLabel() {
    // 局部变量命名 timeVal——避开 i18n 的 t()（Build 5）
    const timeVal = this.game.sky.time;
    let label;
    if (timeVal < 0.05 || timeVal >= 0.95) label = '半夜';
    else if (timeVal < 0.20) label = '黎明前';
    else if (timeVal < 0.30) label = '日出';
    else if (timeVal < 0.45) label = '上午';
    else if (timeVal < 0.55) label = '正午';
    else if (timeVal < 0.70) label = '下午';
    else if (timeVal < 0.80) label = '日落';
    else if (timeVal < 0.90) label = '黄昏';
    else label = '入夜';
    this.curTimeLabel.textContent = t('(当前: {t} {l})', { t: timeVal.toFixed(3), l: t(label) });
  }

  _refreshModeHighlight() {
    const cur = this.game.player.gamemode;
    for (const mb of this.modeBtns) {
      mb.el.style.outline = (mb.name === cur) ? '2px solid #fff' : 'none';
    }
  }

  _refreshDimensionHighlight() {
    const cur = this.game.world ? this.game.world.dimension : 'overworld';
    for (const db of this.dimBtns || []) {
      db.el.style.outline = (db.id === cur) ? '2px solid #fff' : 'none';
    }
  }

  _teleport() {
    const x = parseFloat(this.tpX.value) || 0;
    const y = parseFloat(this.tpY.value) || 0;
    const z = parseFloat(this.tpZ.value) || 0;
    this.game.player.position.set(x, y, z);
    this.game.player.velocity?.set(0, 0, 0);
  }

  _spawnMob(typeName) {
    const p = this.game.player;
    // 玩家前方 3 格的水平位置
    const yaw = p.yaw || 0;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const sx = p.position.x + fx * 3;
    const sz = p.position.z + fz * 3;
    // 落点地表：主世界用高度图（含河流/海面下地形）；其他维度（下界等有基岩天花）
    // 从 spawnScanTop 下探——穿过悬挂实心体，落入空气后下行到首个实心格即立足面
    //（直接 findGroundY 会命中天花实体返回 201 把怪嵌进岩层）
    const world = this.game.world;
    let sy;
    if (world.dimension === 'overworld') {
      sy = world.getHeightAt(Math.floor(sx), Math.floor(sz)) + 1;
    } else {
      const bx = Math.floor(sx), bz = Math.floor(sz);
      const solidAt = (yy) => {
        const id = world.getBlock(bx, yy, bz);
        if (id === 0) return false;
        const d = window.BlockRegistry.getById(id);
        return !!(d && d.solid);
      };
      const top = (world.dimDef && world.dimDef.spawnScanTop) || 200;
      let y = top;
      sy = -1;
      while (y > 2) {
        if (solidAt(y)) { y--; continue; }
        while (y > 2 && !solidAt(y)) y--;
        if (solidAt(y)) sy = y + 1;
        break;
      }
    }
    if (sy < 0) return;
    const mob = new Mob(typeName, world);
    mob.position.set(sx, sy, sz);
    this.game.mobManager.spawnMob(mob);
  }

  // B41：灵魂出窍卡片状态（面板重开时同步"出窍中/未出窍"与按钮文案）
  _refreshSoul() {
    if (!this.soulBtn) return;
    const active = !!(this.game.soulView && this.game.soulView.active);
    this.soulBtn.textContent = t(active ? '归体' : '出窍（离开身体）');
    if (this.soulState) {
      if (!active) { this.soulState.textContent = ''; return; }
      const v = this.game.soulView.position;
      this.soulState.textContent = `XYZ: ${v.x.toFixed(1)} / ${v.y.toFixed(1)} / ${v.z.toFixed(1)}`;
    }
  }

  show() {
    this.visible = true;
    // 进入时填入当前坐标
    const p = this.game.player.position;
    this.tpX.value = p.x.toFixed(1);
    this.tpY.value = p.y.toFixed(1);
    this.tpZ.value = p.z.toFixed(1);
    this.timeInput.value = this.game.sky.time.toFixed(2);
    this._refreshModeHighlight();
    this._refreshDimensionHighlight();
    this._refreshTimeLabel();
    this._refreshExplore();
    this._refreshDimTools();
    this._refreshSoul();
    this.el.style.display = 'flex';
    if (this.game.inventoryScreen && this.game.inventoryScreen.visible) this.game.inventoryScreen.hide();
    if (this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.game.paused !== undefined) this.game.paused = true;
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    if (this.game.paused !== undefined) this.game.paused = false;
    if (this.game.controls) this.game.controls.enabled = true;
  }

  dispose() {
    if (this._unbindLocale) this._unbindLocale();
    this.el.remove();
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }
}