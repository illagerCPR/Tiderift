// Hud.js -- 生存模式 HUD：血量/饥饿/经验
import { VERSION_LABEL } from '../version.js';
import { t } from '../i18n/index.js';

export class Hud {
  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; bottom: 86px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 0; z-index: 10; pointer-events: none;
    `;
    this.hearts = document.createElement('div');
    this.hearts.style.cssText = 'display: flex; gap: 1px; margin-right: 80px;';
    this.foods = document.createElement('div');
    this.foods.style.cssText = 'display: flex; gap: 1px;';
    this.el.appendChild(this.hearts);
    this.el.appendChild(this.foods);
    
    this.xpBar = document.createElement('div');
    this.xpBar.style.cssText = `
      position: absolute; bottom: 72px; left: 50%; transform: translateX(-50%);
      width: 360px; height: 8px; background: rgba(0,0,0,0.5); border: 1px solid #333;
      z-index: 9; display: none;
    `;
    this.xpFill = document.createElement('div');
    this.xpFill.style.cssText = 'width: 0%; height: 100%; background: #80ff20;';
    this.xpBar.appendChild(this.xpFill);
    this.xpText = document.createElement('div');
    this.xpText.style.cssText = 'position: absolute; left: 50%; top: -16px; transform: translateX(-50%); color: #80ff20; font-size: 12px; text-shadow: 1px 1px 0 #000;';
    this.xpBar.appendChild(this.xpText);
    
    // 氧气泡（水下显示）
    this.airBar = document.createElement('div');
    this.airBar.style.cssText = `
      position: absolute; bottom: 122px; left: 50%; transform: translateX(-50%);
      display: none; gap: 1px; z-index: 10; pointer-events: none;
    `;
    document.body.appendChild(this.airBar);

    // 盔甲行（有护甲时显示，血条上方；氧气再上一层）
    this.armorRow = document.createElement('div');
    this.armorRow.style.cssText = `
      position: absolute; bottom: 104px; left: 50%; transform: translateX(-50%);
      display: none; gap: 1px; z-index: 10; pointer-events: none;
    `;
    document.body.appendChild(this.armorRow);

    // 飞行翅翼（Build 19 K2：所有模式飞行中显示，快捷栏左侧）——纯装饰零协议
    this.wingIcon = document.createElement('div');
    this.wingIcon.style.cssText = `
      position: fixed; bottom: 24px; left: calc(50% - 252px); width: 44px; height: 30px;
      display: none; z-index: 10; pointer-events: none;
      background: url("${Hud.wingSvg()}") center / contain no-repeat;
      filter: drop-shadow(0 0 5px rgba(150, 220, 255, 0.55));
    `;
    document.body.appendChild(this.wingIcon);

    // 终局横幅（Build 19 K3）：顶部金色大字 10s（淡入-停留-淡出），获得原初纹章时触发
    this.finaleBanner = document.createElement('div');
    this.finaleBanner.style.cssText = `
      position: fixed; top: 16%; left: 50%; transform: translateX(-50%);
      display: none; z-index: 60; pointer-events: none; text-align: center;
      opacity: 0; transition: opacity 1.2s ease;
    `;
    document.body.appendChild(this.finaleBanner);

    // 冒泡提示（B35 D 遗迹解开/领取等一次性事件）：准星下方一行，2.6s 后淡出
    this.toast = document.createElement('div');
    this.toast.style.cssText = `
      position: fixed; top: 63%; left: 50%; transform: translateX(-50%);
      display: none; z-index: 12; pointer-events: none; max-width: 72vw; text-align: center;
      color: #d8f2ea; font: 600 14px sans-serif; letter-spacing: 1px; opacity: 0;
      transition: opacity 0.4s ease;
      text-shadow: 0 1px 3px #000, 0 0 10px rgba(90, 200, 190, 0.55);
    `;
    document.body.appendChild(this.toast);

    // 滑翔指示（鞘翅展开时显示在准星下方偏上，轻提示不打断视野）
    this.glideTag = document.createElement('div');
    this.glideTag.textContent = '🪂 鞘翅滑翔中';
    this.glideTag.style.cssText = `
      position: fixed; top: 60%; left: 50%; transform: translateX(-50%);
      display: none; z-index: 10; pointer-events: none;
      color: #d8e6ff; font: 600 13px sans-serif; letter-spacing: 2px;
      text-shadow: 0 1px 3px #000, 0 0 8px rgba(80,120,255,0.6);
    `;
    document.body.appendChild(this.glideTag);

    // 版本号（游戏内左下角，规则见 AGENTS.md「版本号与发布规则」）：
    // 进游戏由 update()/updateVisibility() 显示，回菜单 hideAll() 隐藏
    this.versionTag = document.createElement('div');
    this.versionTag.textContent = VERSION_LABEL;
    this.versionTag.style.cssText = `
      position: fixed; left: 10px; bottom: 8px; z-index: 10; pointer-events: none; display: none;
      color: rgba(255,255,255,0.78); font-size: 12px; text-shadow: 1px 1px 0 #000;
    `;
    document.body.appendChild(this.versionTag);

    document.body.appendChild(this.el);
    document.body.appendChild(this.xpBar);
    
    this.crosshair = document.createElement('div');
    this.crosshair.style.cssText = `
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 20px; height: 20px; z-index: 10; pointer-events: none; display: none;
      background: linear-gradient(to right, transparent 45%, #fff 45%, #fff 55%, transparent 55%),
                  linear-gradient(to bottom, transparent 45%, #fff 45%, #fff 55%, transparent 55%);
      mix-blend-mode: difference;
    `;
    document.body.appendChild(this.crosshair);

    // 受击红屏 vignette（玩家被攻击 / 摔落时短暂闪一下）
    this.damageOverlay = document.createElement('div');
    this.damageOverlay.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 50; opacity: 0;
      background: radial-gradient(ellipse at center,
        rgba(180, 0, 0, 0) 30%,
        rgba(180, 0, 0, 0.35) 75%,
        rgba(140, 0, 0, 0.7) 100%);
      transition: opacity 0.5s ease-out;
    `;
    document.body.appendChild(this.damageOverlay);
    this.damageTimerId = 0;

    // 水下屏幕滤镜（全屏蓝色薄纱，透明度过渡）
    this.underwaterOverlay = document.createElement('div');
    this.underwaterOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 5; opacity: 0;
      background: radial-gradient(ellipse at center,
        rgba(20, 70, 130, 0.28) 0%,
        rgba(12, 45, 95, 0.45) 100%);
      transition: opacity 0.3s ease-out;
    `;
    document.body.appendChild(this.underwaterOverlay);

    // 着火屏幕滤镜（橙色边缘火光，onFire>0 时显示）
    this.fireOverlay = document.createElement('div');
    this.fireOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 5; opacity: 0;
      background: radial-gradient(ellipse at center,
        rgba(200, 80, 0, 0) 45%,
        rgba(230, 100, 10, 0.30) 80%,
        rgba(180, 60, 0, 0.45) 100%);
      transition: opacity 0.25s ease-out;
    `;
    document.body.appendChild(this.fireOverlay);
    this._onFireShown = false;

    // 凋零滤镜（Idea-2D-②：紫黑边缘，凋零 II 生效时常驻；持续状态不打红屏）
    this.witherOverlay = document.createElement('div');
    this.witherOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 5; opacity: 0;
      background: radial-gradient(ellipse at center,
        rgba(40, 10, 50, 0) 40%,
        rgba(48, 12, 58, 0.30) 75%,
        rgba(30, 4, 40, 0.55) 100%);
      transition: opacity 0.4s ease-out;
    `;
    document.body.appendChild(this.witherOverlay);

    // 初始全隐藏（主菜单不显示准星/血条）；进游戏后 update()/updateVisibility() 按模式设置
    this.el.style.display = 'none';
    this.xpBar.style.display = 'none';
    this.crosshair.style.display = 'none';
    this.armorRow.style.display = 'none';
  }

  // 水下滤镜开关（Game.update 按 inWater 每帧调用，on=false 时淡出）
  setUnderwater(on) {
    this.underwaterOverlay.style.opacity = on ? '1' : '0';
  }

  // 滑翔指示开关（Game._updateGliding 展开/折叠时调用）
  setGliding(on) {
    this.glideTag.style.display = on ? 'block' : 'none';
  }

  // 全部状态栏隐藏（返回主菜单时调用；Hud 是跨存档共享实例，
  // 不隐藏会让血量/饥饿/经验条/氧气/准星残留在菜单界面上）
  hideAll() {
    this.el.style.display = 'none';
    this.xpBar.style.display = 'none';
    this.crosshair.style.display = 'none';
    this.airBar.style.display = 'none';
    this.armorRow.style.display = 'none';
    this.glideTag.style.display = 'none';
    this.wingIcon.style.display = 'none';
    this.finaleBanner.style.display = 'none';
    this.finaleBanner.style.opacity = '0';
    this.versionTag.style.display = 'none';
    this.toast.style.display = 'none';
    this.toast.style.opacity = '0';
    this.witherOverlay.style.opacity = '0'; // 回菜单复位凋零滤镜（防上一存档残留）
  }

  // 冒泡提示（B35 D）：同时只留最新一条；淡出靠 CSS transition，超时后再撤下 display
  showToast(text) {
    if (!this.toast) return;
    this.toast.textContent = String(text == null ? '' : text);
    this.toast.style.display = 'block';
    this.toast.style.opacity = '1';
    clearTimeout(this._toastTimer);
    clearTimeout(this._toastHideTimer);
    this._toastTimer = setTimeout(() => {
      this.toast.style.opacity = '0';
      this._toastHideTimer = setTimeout(() => { this.toast.style.display = 'none'; }, 440);
    }, 2600);
  }

  // 终局横幅（Build 19 K3）：金色大字淡入 → 停留 10s → 淡出（获得原初纹章时触发一次）
  showFinaleBanner() {
    this.finaleBanner.innerHTML = `
      <div style="font-size:42px; font-weight:bold; letter-spacing:14px; color:#ffd98a; text-shadow: 0 0 20px rgba(255,200,90,0.55), 0 2px 0 #7a5a18;">${t('潮归其位')}</div>
      <div style="margin-top:12px; font-size:15px; color:#e8e0c8; letter-spacing:4px; text-shadow: 0 1px 3px #000;">${t('世界记起了自己曾经是一整片海。')}</div>
      <div style="margin-top:14px; font-size:12px; color:#c8b878; letter-spacing:3px;">✦ ${t('终局达成')} ✦</div>`;
    this.finaleBanner.style.display = 'block';
    requestAnimationFrame(() => { this.finaleBanner.style.opacity = '1'; });
    clearTimeout(this._finaleBannerTimer);
    this._finaleBannerTimer = setTimeout(() => {
      this.finaleBanner.style.opacity = '0';
      setTimeout(() => { this.finaleBanner.style.display = 'none'; }, 1300);
    }, 10000);
  }

  // 着火滤镜开关（同款幂等开关）
  setOnFire(on) {
    if (this._onFireShown === on) return;
    this._onFireShown = on;
    this.fireOverlay.style.opacity = on ? '1' : '0';
  }

  // 飞行翅翼 SVG（Build 19 K2）：浅蓝羽状双翼（展开三笔渐短 + 中心体），data-URI
  static wingSvg() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 30">
      <g fill="#d6ecff" stroke="#8fb8e0" stroke-width="0.8" stroke-linejoin="round">
        <path d="M21 21 L3 7 Q14 10 20 14 Z"/>
        <path d="M21 21 L5 14 Q14 15 20 17 Z"/>
        <path d="M21 21 L8 19 Q15 19 20 20 Z"/>
        <path d="M23 21 L41 7 Q30 10 24 14 Z"/>
        <path d="M23 21 L39 14 Q30 15 24 17 Z"/>
        <path d="M23 21 L36 19 Q29 19 24 20 Z"/>
        <ellipse cx="22" cy="22" rx="3" ry="4.5"/>
      </g>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  // 凋零滤镜开关（Idea-2D-②：凋零 II 剩余秒数 > 0 时常驻）
  setWithered(on) {
    this.witherOverlay.style.opacity = on ? '1' : '0';
  }

  heartSvg(filled, half = false, bedrock = false) {
    // Build 19 K3：佩戴原初纹章时生命值图标变为基岩心形（深灰岩质）
    const color = bedrock ? (filled ? '#8a8a8a' : '#262626') : (filled ? '#ff3030' : '#3a0a0a');
    const halfColor = bedrock ? '#4a4a4a' : (half ? '#7a1818' : color);
    const edge = bedrock ? 'stroke="#111" stroke-width="0.6"' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges">
      <path d="M2 3h3v1h1v1h1v1h1v1h1V4h1V3h1V2h3v4h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1H7v-1H6v-1H5v-1H4v-1H3V8H2V3z" fill="${color}" ${edge}/>
      ${half ? `<rect x="8" y="2" width="6" height="12" fill="${halfColor}"/>` : ''}
    </svg>`;
  }

  // 盾形盔甲图标（filled=亮盾；盔甲点数为奇时末位为暗盾）
  armorSvg(filled) {
    const color = filled ? '#d8d8d8' : '#4a4a4a';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges">
      <path d="M4 2h8v7l-4 5-4-5V2z" fill="${color}" stroke="#222" stroke-width="1"/>
    </svg>`;
  }

  foodSvg(filled, half = false) {
    const color = filled ? '#a06020' : '#2a1a0a';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges">
      <path d="M3 4h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h-2v1h-2v-1H7v-1H6v-1H5v-1H4v-1H3V4z" fill="${color}"/>
      ${half ? `<rect x="8" y="3" width="6" height="10" fill="${color}"/>` : ''}
    </svg>`;
  }

  update(player) {
    this.versionTag.style.display = 'block'; // 版本号任意模式常显（含创造/旁观提前 return 前）
    // 飞行翅翼：所有模式（创造/旁观提前 return 之前判定——用户要求"所有模式"）
    this.wingIcon.style.display = player.flying ? 'block' : 'none';
    if (player.gamemode === 'spectator' || player.gamemode === 'creative') {
      this.el.style.display = 'none';
      this.xpBar.style.display = 'none';
      this.armorRow.style.display = 'none';
      this.crosshair.style.display = player.gamemode === 'spectator' ? 'none' : 'block';
      return;
    }
    this.el.style.display = 'flex';
    this.crosshair.style.display = 'block';
    
    // 血量（10 颗心，每颗 2 点；佩戴原初纹章时为基岩心形）
    this.hearts.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const v = player.health - i * 2;
      const filled = v >= 2;
      const half = v === 1;
      const img = document.createElement('div');
      img.innerHTML = this.heartSvg(filled, half, player.emblemWorn);
      img.style.cssText = 'width: 16px; height: 16px;';
      this.hearts.appendChild(img);
    }
    
    // 饥饿
    this.foods.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const v = player.food - i * 2;
      const filled = v >= 2;
      const half = v === 1;
      const img = document.createElement('div');
      img.innerHTML = this.foodSvg(filled, half);
      img.style.cssText = 'width: 16px; height: 16px;';
      this.foods.appendChild(img);
    }
    
    // 经验
    this.xpBar.style.display = 'block';
    const need = player.xpLevel * 10 + 10;
    this.xpFill.style.width = `${(player.xp / need) * 100}%`;
    this.xpText.textContent = player.xpLevel;

    // 盔甲（10 盾，每盾 2 点；为 0 隐藏整行）
    if (player.armor > 0) {
      this.armorRow.style.display = 'flex';
      this.armorRow.innerHTML = '';
      for (let i = 0; i < 10; i++) {
        const v = player.armor - i * 2;
        if (v <= 0) break;
        const img = document.createElement('div');
        img.innerHTML = this.armorSvg(v >= 2);
        img.style.cssText = 'width: 16px; height: 16px;';
        this.armorRow.appendChild(img);
      }
    } else {
      this.armorRow.style.display = 'none';
    }
    
    // 氧气（水下且未满时显示）
    if (player.inWater && player.airTicks < 300) {
      this.airBar.style.display = 'flex';
      this.airBar.innerHTML = '';
      const bubbles = Math.ceil((player.airTicks / 300) * 10);
      for (let i = 0; i < bubbles; i++) {
        const b = document.createElement('div');
        b.style.cssText = 'width: 16px; height: 16px;';
        b.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges"><path d="M5 3h6v1h1v1h1v6h-1v1h-1v1H5v-1H4v-1H3V5h1V4h1V3z" fill="#9ad0ff"/></svg>`;
        this.airBar.appendChild(b);
      }
    } else {
      this.airBar.style.display = 'none';
    }
  }

  updateVisibility(mode) {
    this.versionTag.style.display = 'block';
    if (mode === 'creative') {
      this.el.style.display = 'none';
      this.xpBar.style.display = 'none';
      this.crosshair.style.display = 'block';
    } else if (mode === 'spectator') {
      this.el.style.display = 'none';
      this.xpBar.style.display = 'none';
      this.crosshair.style.display = 'none';
    } else {
      this.el.style.display = 'flex';
      this.xpBar.style.display = 'block';
      this.crosshair.style.display = 'block';
    }
  }

  // 受击红屏：瞬间红色 vignette → 0.5s 内淡出。
  // damage 越高闪得越亮（封顶 0.9），低伤害轻微闪。
  flashDamage(damage = 1) {
    if (!this.damageOverlay) return;
    if (this.damageTimerId) {
      clearTimeout(this.damageTimerId);
      this.damageTimerId = 0;
    }
    const intensity = Math.min(0.9, 0.3 + damage * 0.04);
    this.damageOverlay.style.transition = 'none';
    this.damageOverlay.style.opacity = String(intensity);
    const self = this;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!self.damageOverlay) return;
        self.damageOverlay.style.transition = 'opacity 0.5s ease-out';
        self.damageOverlay.style.opacity = '0';
      });
    });
  }
}
