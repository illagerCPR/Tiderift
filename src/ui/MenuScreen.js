// MenuScreen.js -- 主菜单（主页 / 单人游戏 / 局域网游戏 三页导航）+ 石质按钮
import { SaveSystem } from '../core/SaveSystem.js';
import { BIOME_SCALES, DEFAULT_BIOME_SCALE, safeBiomeScale } from '../world/biomes.js';
import { ensureStoneStyles } from './StoneStyle.js';
import { VERSION_LABEL } from '../version.js';
import { t, getLocale, onLocaleChange } from '../i18n/index.js';
import { globeIconDataUri } from './LanguageScreen.js';
import { personIconDataUri } from './SkinScreen.js';
import { getLanHost, setLanHost, normalizeLanHost, lanWsUrl, probeLanServer } from '../net/lanStatus.js';
import logoUrl from '../../res/logo-tiderift-js-edition.png';

// 刷新图标（Build 23：主界面 LAN 组件；石质浅底上用深色描边——原 #e8e8e8 与按钮浅灰底对比不足）
function refreshIconDataUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path d="M12 4.5a7.5 7.5 0 1 0 7.1 5.2" fill="none" stroke="#2e2a26" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M20.6 3.2 L21 9.6 L15.2 8.4 Z" fill="#2e2a26" stroke="#111" stroke-width="0.8"/>
  </svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const MODE_LABEL = { creative: '创造模式', survival: '生存模式', spectator: '旁观模式' };
const MODE_COLOR = {
  creative: { bg: '#4a8a4a', border: '#2a5a2a' },
  survival: { bg: '#8a4a4a', border: '#5a2a2a' },
  spectator: { bg: '#4a4a8a', border: '#2a2a5a' }
};
const DIM_LABEL = { overworld: '主世界', nether: '下界', end: '末地', aether: '天域' };

// ---------- 石质按钮 ----------
// Build 4：样式提取到共享模块 StoneStyle.js（全界面统一 .cw-stone-btn），此处仅注入

export class MenuScreen {
  constructor(onStart, net = null) {
    ensureStoneStyles();
    this.onStart = onStart;
    this.net = net;
    this.page = 'main'; // main | single | lan
    this.selectedMode = 'creative';
    this.selectedCheats = false;
    this.selectedBiomeScale = DEFAULT_BIOME_SCALE; // 群系规模（新建世界/建房共用；载入存档不受影响）
    this.mpStatus = null; // { text, color } 联机状态暂存：非 LAN 页先存，进 LAN 页回显
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: flex-start; padding-top: 6vh;
      z-index: 50; overflow-y: auto;
      background: linear-gradient(180deg, rgba(10,25,45,0.16) 0%, rgba(5,15,30,0.34) 100%);
      color: #fff; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;
    document.body.appendChild(this.el);
    // 页面导航 + 视频设置入口：事件委托挂构造期（render() 重建 innerHTML 无需重绑）
    // 语言切换（Build 5 i18n）：常驻主菜单重绘当前页
    onLocaleChange(() => this.render());
    this.el.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!btn) return;
      if (btn.id === 'video-settings-btn' && this.videoSettings) {
        this.videoSettings.show();
        return;
      }
      if (btn.id === 'language-btn' && this.languageScreen) {
        this.languageScreen.show();
        return;
      }
      // Build 21 M1：皮肤设置入口（多语言按钮右侧）
      if (btn.id === 'skin-btn' && this.skinScreen) {
        this.skinScreen.show();
        return;
      }
      // Build 23：LAN 状态组件刷新按钮
      if (btn.id === 'lan-refresh-btn') {
        this._probeLan();
        return;
      }
      // Build 24：LAN 默认服务器设置——显式保存（输入框 change 只探测不落盘）
      if (btn.id === 'lan-default-btn') {
        const input = this.el.querySelector('#lan-host-input');
        const saved = setLanHost(input ? input.value : '');
        if (saved != null) {
          if (input) input.value = saved;
          const st = this.el.querySelector('#lan-status-text');
          if (st) {
            st.textContent = t('已设为默认');
            st.style.color = '#7fe27f';
            clearTimeout(this._lanSavedTimer);
            this._lanSavedTimer = setTimeout(() => this._probeLan(), 1600);
          } else {
            this._probeLan();
          }
        } else if (input) {
          input.value = getLanHost(); // 非法输入回滚为当前默认值
        }
        return;
      }
      if (btn.id === 'menu-single' || btn.id === 'menu-lan' || btn.classList.contains('back-btn')) {
        this.page = btn.id === 'menu-single' ? 'single' : (btn.id === 'menu-lan' ? 'lan' : 'main');
        this.render();
      }
    });
    // Build 24：LAN 默认服务器设置——IP 输入框变更只即时探测（保存走「设置为默认」按钮；
    // change 冒泡 + 事件委托同样免重绑）
    this.el.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'lan-host-input') {
        const host = normalizeLanHost(e.target.value);
        if (host != null) {
          e.target.value = host;
          this._probeLan(host); // 编辑态探测输入值，不动已保存的默认值
        } else {
          e.target.value = getLanHost(); // 非法输入回退当前值
          this._probeLan();
        }
      }
    });
    this.render();
    // 版本号（左下角，规则见 AGENTS.md「版本号与发布规则」）；
    // 挂 body 而非 el —— render() 重建 innerHTML 会清除 el 的子元素
    this.versionEl = document.createElement('div');
    this.versionEl.textContent = VERSION_LABEL;
    this.versionEl.style.cssText = `
      position: fixed; left: 10px; bottom: 8px; z-index: 60; pointer-events: none;
      color: rgba(255,255,255,0.78); font-size: 12px; text-shadow: 1px 1px 0 #000;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;
    document.body.appendChild(this.versionEl);
  }

  render() {
    if (this.page === 'single') this._renderSingle();
    else if (this.page === 'lan') this._renderLan();
    else this._renderMain();
  }

  // ---------- 主页 ----------
  _renderMain() {
    this.el.innerHTML = `
      <img src="${logoUrl}" alt="Tiderift" style="
        width: 500px; max-width: 92vw; image-rendering: pixelated;
        filter: drop-shadow(5px 6px 0 rgba(0,0,0,0.45)); margin-bottom: 2px;" />
      <div style="font-size: 13px; color: #ccc; margin-bottom: 3vh;">${t('JavaScript 版 3D 沙盒游戏')}</div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:14px;">
        <button id="menu-single" class="cw-stone-btn" style="width:400px; height:52px; font-size:18px;">${t('单人游戏')}</button>
        <button id="menu-lan" class="cw-stone-btn" style="width:400px; height:52px; font-size:18px;">${t('局域网游戏')}</button>
        <div style="display:flex; gap:10px; align-items:center; margin-top:10px;">
          <button id="video-settings-btn" class="cw-stone-btn" style="width:196px; height:38px; font-size:14px;">${t('⚙ 视频设置')}</button>
          <button id="language-btn" class="cw-stone-btn" title="${t('语言')}" aria-label="${t('语言')}" style="
            width:38px; height:38px; padding:0; background-size:64%; background-repeat:no-repeat; background-position:center;
            background-image:url('${globeIconDataUri()}');"></button>
          <button id="skin-btn" class="cw-stone-btn" title="${t('皮肤')}" aria-label="${t('皮肤')}" style="
            width:38px; height:38px; padding:0; background-size:70%; background-repeat:no-repeat; background-position:center;
            background-image:url('${personIconDataUri()}');"></button>
        </div>
      </div>
      <div style="font-size: 11px; color: #aaa; text-align: center; line-height: 1.7; margin-top: 4vh;">
        ${t('WASD 移动 / 空格 跳跃 / 双击空格 飞行(创造) / Shift 下蹲')}<br/>
        ${t('鼠标左键 破坏 / 右键 放置 / E 打开背包 / ESC 暂停 / C 命令面板(需启用)')}<br/>
        ${t('滚轮 切换物品 / 1-9 快捷栏 / F5 切换视角 / F6 手动保存')}
      </div>
      <div id="lan-status-widget" style="
        position: absolute; right: 12px; bottom: 8px; z-index: 60;
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; color: rgba(255,255,255,0.78);
        font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;">
        <span style="text-shadow: 1px 1px 0 #000;">${t('LAN默认服务器设置')}</span>
        <input type="text" id="lan-host-input" value="${getLanHost()}" title="${t('LAN 服务器 IP')}"
          style="width: 110px; padding: 3px 6px; font-size: 12px; background: rgba(0,0,0,0.4);
                 border: 1px solid #555; color: #fff;" />
        <span id="lan-status-text" style="text-shadow: 1px 1px 0 #000;">${t('检测中…')}</span>
        <button id="lan-refresh-btn" class="cw-stone-btn" title="${t('刷新')}" aria-label="${t('刷新')}" style="
          width: 28px; height: 28px; padding: 0; background-size: 72%;
          background-repeat: no-repeat; background-position: center;
          background-image: url('${refreshIconDataUri()}');"></button>
        <button id="lan-default-btn" class="cw-stone-btn" title="${t('设置为默认')}" style="
          padding: 4px 10px; font-size: 11px;">${t('设置为默认')}</button>
      </div>
    `;
    this._probeLan(); // 异步探测（结果回写有元素存在性守卫，页面切换不串写）
  }

  // Build 23：探测 LAN 服务器可达性并回写状态文本（在线/离线）；host 缺省用已保存默认值
  _probeLan(host) {
    probeLanServer(host != null ? host : getLanHost()).then((r) => {
      const el = this.el.querySelector('#lan-status-text');
      if (!el) return; // 已切页，render() 重建后自然重新探测
      el.textContent = r.online ? t('在线') : t('离线');
      el.style.color = r.online ? '#7fe27f' : '#ff7f7f';
    });
  }

  // ---------- 单人游戏页 ----------
  _slotsHtml() {
    const saves = SaveSystem.listSaves();
    let html = '';
    for (let i = 0; i < saves.length; i++) {
      const s = saves[i];
      if (s.empty) {
        html += `
          <div class="slot" data-slot="${s.slot}" style="
            display:flex; align-items:center; gap:12px; width:460px; min-height:60px;
            margin-bottom:8px; padding:8px 16px;
            background: rgba(0,0,0,0.25); border: 2px dashed rgba(255,255,255,0.3);
            cursor: pointer; opacity: 0.7;">
            <div style="font-size:20px; color:#999;">○</div>
            <div style="flex:1; font-size:14px; color:#ddd;">${t('空存档槽 {n}', { n: s.slot })}</div>
            <div style="font-size:12px; color:#aaa;">${t('点击新建')}</div>
          </div>`;
      } else {
        const c = MODE_COLOR[s.gamemode] || MODE_COLOR.creative;
        const time = s.timestamp ? new Date(s.timestamp).toLocaleString(getLocale(), { hour12: false }) : t('未知');
        const dim = s.dimension && s.dimension !== 'overworld' ? ` · ${t(DIM_LABEL[s.dimension] || s.dimension)}` : '';
        const bs = s.biomeScale && s.biomeScale !== 'small' ? ` · ${t('群系:{label}', { label: t((BIOME_SCALES[s.biomeScale] || BIOME_SCALES.small).label) })}` : '';
        html += `
          <div class="slot" data-slot="${s.slot}" style="
            display:flex; align-items:center; gap:12px; width:460px; min-height:60px;
            margin-bottom:8px; padding:8px 16px;
            background: rgba(0,0,0,0.35); border: 2px solid ${c.border}; cursor: pointer;">
            <div style="font-size:20px; color:#5f5;">●</div>
            <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
              <div style="font-size:14px; font-weight:bold; color:#fff;">${t('槽 {n} · {m}', { n: s.slot, m: t(MODE_LABEL[s.gamemode] || s.gamemode) })}${dim}${bs}${s.cheatsEnabled ? ` · <span style="color:#fc5;">${t('作弊')}</span>` : ''}</div>
              <div style="font-size:11px; color:#bbb;">${time} · ${t('种子 {seed}', { seed: s.seed })}${s.cheatsEnabled ? ` · ${t('命令已启用')}` : ''}</div>
              ${s.finaleDone ? `<div style="font-size:12px; color:#ffd98a; letter-spacing:1px; text-shadow: 0 0 8px rgba(255,200,90,0.4);">✦ ${t('已通关 · 潮归其位')} ✦</div>` : ''}
            </div>
            <button class="del-btn cw-stone-btn danger" data-del="${s.slot}" style="
              color:#fff; cursor:pointer; padding:4px 10px; font-size:12px;">${t('删除')}</button>
          </div>`;
      }
    }
    return html;
  }

  // 生物群系规模四选一（单人页新建设置 / LAN 页建房共用 selectedBiomeScale 状态）
  _biomeScaleHtml() {
    const btns = Object.entries(BIOME_SCALES).map(([key, v]) =>
      `<button data-biome-scale="${key}" class="cw-stone-btn biome-scale-btn" style="padding:6px 14px; font-size:13px;">${t(v.label)}</button>`
    ).join('');
    return `
      <div id="mc-biome-scale" style="margin-bottom: 12px; display:flex; align-items:center; gap:8px;">
        <span style="font-size:13px;">${t('群系规模:')}</span>
        <span style="display:flex; gap:8px;">${btns}</span>
        <span style="font-size:11px; color:#999;">${t('（越大群系斑块越大，仅对新建世界生效）')}</span>
      </div>`;
  }

  _bindBiomeScale() {
    const btns = this.el.querySelectorAll('button[data-biome-scale]');
    const refresh = () => {
      btns.forEach(b => b.classList.toggle('selected', b.dataset.biomeScale === this.selectedBiomeScale));
    };
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedBiomeScale = safeBiomeScale(btn.dataset.biomeScale);
        refresh();
      });
    });
    refresh();
  }

  _renderSingle() {
    this.el.innerHTML = `
      <div style="font-size:22px; font-weight:bold; text-shadow: 2px 2px 0 rgba(0,0,0,0.55); margin-bottom:2px;">${t('单人游戏')}</div>
      <div style="font-size:12px; color:#aaa; margin-bottom:14px;">${t('选择存档继续，或点击空槽新建世界')}</div>
      <div style="display:flex; flex-direction:column; margin-bottom:16px;">
        ${this._slotsHtml()}
      </div>
      <div style="font-size:12px; color:#aaa; margin-bottom:6px;">${t('—— 新建游戏设置（点击空槽时使用）——')}</div>
      <div id="mc-seed" style="margin-bottom: 10px;">
        <label style="font-size:13px; margin-right: 8px;">${t('种子(可空):')}</label>
        <input type="text" id="seed-input" style="padding: 6px 10px; background: rgba(0,0,0,0.4); border: 1px solid #555; color: #fff; width: 180px; font-size: 13px;" placeholder="${t('随机')}" />
      </div>
      <div style="display: flex; gap: 10px; margin-bottom: 14px;">
        <button data-mode="creative" class="cw-stone-btn mode-btn" style="padding:10px 20px; font-size:14px;"><span style="display:inline-block; width:10px; height:10px; background:${MODE_COLOR.creative.bg}; border:1px solid #000; margin-right:6px; vertical-align:middle;"></span>${t('创造模式')}</button>
        <button data-mode="survival" class="cw-stone-btn mode-btn" style="padding:10px 20px; font-size:14px;"><span style="display:inline-block; width:10px; height:10px; background:${MODE_COLOR.survival.bg}; border:1px solid #000; margin-right:6px; vertical-align:middle;"></span>${t('生存模式')}</button>
        <button data-mode="spectator" class="cw-stone-btn mode-btn" style="padding:10px 20px; font-size:14px;"><span style="display:inline-block; width:10px; height:10px; background:${MODE_COLOR.spectator.bg}; border:1px solid #000; margin-right:6px; vertical-align:middle;"></span>${t('旁观模式')}</button>
      </div>
      ${this._biomeScaleHtml()}
      <div id="mc-cheats" style="margin-bottom: 16px; display:flex; align-items:center; gap:8px;">
        <label style="font-size:14px; cursor:pointer; display:flex; align-items:center; gap:6px;">
          <input type="checkbox" id="cheats-input" ${this.selectedCheats ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;" />
          <span style="color:#fc5; font-weight:bold;">${t('启用命令')}</span>
        </label>
        <span style="font-size:11px; color:#999;">${t('（游戏中按 C 打开命令面板：传送 / 切换模式 / 生成实体）')}</span>
      </div>
      <button class="cw-stone-btn back-btn" style="width:196px; height:36px; font-size:14px;">${t('← 返回')}</button>
    `;
    this._bindSingle();
  }

  _bindSingle() {
    // 模式选择高亮（.selected 白描边）
    const modeBtns = this.el.querySelectorAll('button[data-mode]');
    const refreshMode = () => {
      modeBtns.forEach(b => b.classList.toggle('selected', b.dataset.mode === this.selectedMode));
    };
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedMode = btn.dataset.mode;
        refreshMode();
      });
    });
    refreshMode();
    this._bindBiomeScale();

    // "启用命令"复选框
    const cheatsInput = this.el.querySelector('#cheats-input');
    if (cheatsInput) {
      cheatsInput.addEventListener('change', () => {
        this.selectedCheats = cheatsInput.checked;
      });
    }

    // 槽点击：继续或新建
    this.el.querySelectorAll('.slot').forEach(slotEl => {
      slotEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('del-btn')) return;
        const slot = parseInt(slotEl.dataset.slot);
        if (SaveSystem.hasSave(slot)) {
          const data = SaveSystem.load(slot);
          if (data) { this.hide(); this.onStart(null, 0, data, slot); }
        } else {
          const seed = this._readSeed();
          this.hide();
          this.onStart(this.selectedMode, seed, null, slot, this.selectedCheats, this.selectedBiomeScale);
        }
      });
    });

    // 删除按钮
    this.el.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slot = parseInt(btn.dataset.del);
        if (confirm(t('确定删除存档槽 {n} 吗？此操作不可撤销。', { n: slot }))) {
          SaveSystem.deleteSave(slot);
          this.render();
        }
      });
    });
  }

  // ---------- 局域网游戏页 ----------
  _renderLan() {
    const st = this.mpStatus;
    this.el.innerHTML = `
      <div style="font-size:22px; font-weight:bold; text-shadow: 2px 2px 0 rgba(0,0,0,0.55); margin-bottom:2px;">${t('🌐 局域网游戏')}</div>
      <div style="font-size:12px; color:#aaa; margin-bottom:16px;">${t('与同一局域网的其它电脑共建世界（联机模式不保存本地存档）')}</div>
      <div style="width:520px; border:2px solid rgba(0,0,0,0.5); background:rgba(0,0,0,0.3); padding:14px 18px; margin-bottom:12px;">
        <div style="display:flex; gap:8px; margin-bottom:8px; align-items:center; font-size:13px;">
          <label>${t('昵称')}</label>
          <input type="text" id="mp-name" maxlength="16" style="padding:5px 8px; background:rgba(0,0,0,0.4); border:1px solid #555; color:#fff; width:90px; font-size:13px;" placeholder="${t('玩家')}" />
          <span style="font-size:11px; color:#aaa;">${t('连接地址（主界面右下角可改）：')}${lanWsUrl(getLanHost())}</span>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:8px; align-items:center; font-size:13px;">
          <label>${t('房间名')}</label>
          <input type="text" id="mp-room" maxlength="24" style="padding:5px 8px; background:rgba(0,0,0,0.4); border:1px solid #555; color:#fff; width:120px; font-size:13px;" value="${t('默认世界')}" />
          <span style="font-size:11px; color:#aaa;">${t('同名房间共享世界（服务器落盘，重启不丢）；开新世界换个房间名')}</span>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:8px; align-items:center; font-size:13px;">
          <span>${t('群系规模:')}</span>
          <span style="display:flex; gap:6px;">
            ${Object.entries(BIOME_SCALES).map(([key, v]) =>
              `<button data-biome-scale="${key}" class="cw-stone-btn biome-scale-btn" style="padding:5px 12px; font-size:12px;">${t(v.label)}</button>`
            ).join('')}
          </span>
          <span style="font-size:11px; color:#aaa;">${t('（建房时决定，随房间固定；加入者自动跟随）')}</span>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <button id="mp-host" class="cw-stone-btn" style="padding:8px 16px; font-size:13px;">${t('创建房间')}</button>
          <button id="mp-join" class="cw-stone-btn" style="padding:8px 16px; font-size:13px;">${t('加入房间')}</button>
          <div id="mp-status" style="font-size:12px; color:${st ? st.color : '#9cf'};">${st ? st.text : ''}</div>
        </div>
      </div>
      <div style="width:520px; font-size:11px; color:#aaa; line-height:1.6; margin-bottom:16px;">
        ${t('先运行 <b>node server/index.mjs</b> 开启服务器；创建房间决定世界种子，其它电脑在主界面把开房机 IP 设为默认服务器后加入。')}<br/>
        ${t('联机支持：方块共建/破坏、玩家可见与移动、互殴、聊天(T)。联机模式不保存本地存档。')}<br/>
        ${t('服务器按<b>房间名</b>把世界存到磁盘（<b>server/world/</b>），重启服务器后同名房间自动恢复原世界。')}
      </div>
      <button class="cw-stone-btn back-btn" style="width:196px; height:36px; font-size:14px;">${t('← 返回')}</button>
    `;
    this._bindLan();
  }

  _bindLan() {
    if (!this.net) return;
    this._bindBiomeScale(); // 与单人页共用 selectedBiomeScale 状态
    const hostBtn = this.el.querySelector('#mp-host');
    const joinBtn = this.el.querySelector('#mp-join');
    if (hostBtn) hostBtn.addEventListener('click', () => this._mpConnect('host'));
    if (joinBtn) joinBtn.addEventListener('click', () => this._mpConnect('join'));
  }

  _mpConnect(kind) {
    const name = this.el.querySelector('#mp-name')?.value.trim() || t('玩家');
    const url = lanWsUrl(getLanHost()); // Build 24：地址唯一来源 = 主界面「LAN默认服务器设置」（LAN 页输入框已移除）
    const room = this.el.querySelector('#mp-room')?.value.trim() || 'default';
    this.setMpStatus(t('连接中...'), '#9cf');
    this.net.connect(url, name);
    // 群系规模随建房上送（服务器首次开房固定；重复开房/加入沿用房间记录）
    if (kind === 'host') this.net.createRoom(this._readSeed(), this.selectedMode, room, this.selectedBiomeScale);
    else this.net.joinRoom(room);
  }

  setMpStatus(text, color = '#9cf') {
    this.mpStatus = { text, color };
    const el = this.el.querySelector('#mp-status');
    if (el) { el.textContent = text; el.style.color = color; }
  }

  _readSeed() {
    const txt = document.getElementById('seed-input')?.value.trim();
    if (!txt) return (Math.random() * 4294967296) >>> 0;
    let seed = 0;
    for (let i = 0; i < txt.length; i++) seed = (seed * 31 + txt.charCodeAt(i)) >>> 0;
    return seed;
  }

  // onShow/onHide 由 main.js 注入（切换全景背景的启停）
  hide() { this.el.style.display = 'none'; this.versionEl.style.display = 'none'; if (this.onHide) this.onHide(); }
  show() { this.page = 'main'; this.el.style.display = 'flex'; this.versionEl.style.display = 'block'; this.render(); if (this.onShow) this.onShow(); }
}
