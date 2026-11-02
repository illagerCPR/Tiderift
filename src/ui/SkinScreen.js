// SkinScreen.js -- 皮肤设置界面（Build 21 M1）
// 主界面多语言按钮右侧小按钮进入；2D 正面预览（base+overlay 叠加）+ classic/slim 模型
// 切换 + 本地上传 PNG（64×64 或 legacy 64×32 自动归一化）+ 恢复默认。
// 生命周期同 LanguageScreen：show 设 controls.enabled=false + 退指针锁，hide 恢复 + onHide。
// 保存后实时通知游戏内模型（window.game.playerModel.refreshSkin / hand.loadSkin）。
import { t } from '../i18n/index.js';
import { ensureStoneStyles } from './StoneStyle.js';
import {
  getSkinPrefs, saveSkinPrefs, clearSkinPrefs,
  loadImageFromURL, normalizeSkin, DEFAULT_SKIN_URLS, buildSkinCandidates,
} from '../entity/PlayerSkin.js';

// 像素风小人图标（皮肤设置入口）：头+躯干+张开双臂，SVG data-URI 背景用
export function personIconDataUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">
    <circle cx="8" cy="4" r="3" fill="#e0b080" stroke="#3a2a1a" stroke-width="0.8"/>
    <rect x="5" y="7.5" width="6" height="5" fill="#4a7fbe" stroke="#26364a" stroke-width="0.8"/>
    <rect x="1.5" y="7.5" width="3" height="4.5" fill="#4a7fbe" stroke="#26364a" stroke-width="0.8"/>
    <rect x="11.5" y="7.5" width="3" height="4.5" fill="#4a7fbe" stroke="#26364a" stroke-width="0.8"/>
    <rect x="5.5" y="12.5" width="2.2" height="3.5" fill="#3a4a8a" stroke="#1a2438" stroke-width="0.8"/>
    <rect x="8.3" y="12.5" width="2.2" height="3.5" fill="#3a4a8a" stroke="#1a2438" stroke-width="0.8"/>
  </svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// 正面 2D 拼图布局（像素单位；×scale 绘制）：头部居中、躯干其下、双臂双列、双腿并立
const PREVIEW_PARTS = [
  { rect: [8, 8, 8, 8], at: [4, 0] },    // head front
  { rect: [20, 20, 8, 12], at: [4, 8] }, // body front
  { rect: [44, 20, 4, 12], at: [0, 8] }, // armR front
  { rect: [36, 52, 4, 12], at: [12, 8] },// armL front
  { rect: [4, 20, 4, 12], at: [4, 20] }, // legR front
  { rect: [20, 52, 4, 12], at: [8, 20] },// legL front
];
// overlay 同位叠加（hat/jacket/sleeve/pant 的 front 区域）
const PREVIEW_OVERLAYS = [
  { rect: [40, 8, 8, 8], at: [4, 0] },
  { rect: [20, 36, 8, 12], at: [4, 8] },
  { rect: [44, 36, 4, 12], at: [0, 8] },
  { rect: [52, 52, 4, 12], at: [12, 8] },
  { rect: [4, 36, 4, 12], at: [4, 20] },
  { rect: [20, 52, 4, 12], at: [8, 20] },
];

export class SkinScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.onHide = null; // 暂停菜单注入：关闭后交还父界面

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; flex-direction: column;
      align-items: center; justify-content: center; z-index: 60;
      background: rgba(0,0,0,0.65); color: #fff;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;

    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      background: #2a2a2a; border: 3px solid #555; padding: 20px 24px;
      display: flex; flex-direction: column; gap: 10px; align-items: center;
      min-width: 320px;
    `;
    this.el.appendChild(this.panel);

    this._onKey = (e) => {
      if (e.key === 'Escape' && this.visible) {
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this._onKey, true);

    this.render();
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });

    document.body.appendChild(this.el);
  }

  render() {
    ensureStoneStyles();
    this.panel.innerHTML = '';
    const prefs = getSkinPrefs();

    const title = document.createElement('div');
    title.textContent = t('皮肤');
    title.style.cssText = 'font-size: 20px; font-weight: bold; letter-spacing: 2px; margin-bottom: 4px;';
    this.panel.appendChild(title);

    // 预览：正面 2D 拼图（base + overlay 叠加）
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 192;
    cv.style.cssText = 'image-rendering: pixelated; background: rgba(0,0,0,0.35); border: 1px solid #555;';
    this.panel.appendChild(cv);
    this._drawPreview(cv);

    // 模型档位：classic / slim（原版双模型；slim 臂 3px）
    const modelRow = document.createElement('div');
    modelRow.style.cssText = 'display:flex; gap:8px;';
    for (const [mid, label] of [['classic', t('经典模型')], ['slim', t('纤细模型')]]) {
      const b = document.createElement('button');
      b.className = 'cw-stone-btn' + (prefs.model === mid ? ' selected' : '');
      b.textContent = label;
      b.style.cssText = 'width: 130px; padding: 8px 10px; font-size: 13px;';
      b.addEventListener('click', () => {
        if (prefs.model === mid) return;
        prefs.model = mid;
        saveSkinPrefs(prefs);
        this._notifyGame();
        this.render();
      });
      modelRow.appendChild(b);
    }
    this.panel.appendChild(modelRow);

    // 上传（隐藏 file input + 石质按钮触发）
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'cw-stone-btn';
    uploadBtn.textContent = t('上传皮肤 PNG');
    uploadBtn.style.cssText = 'width: 268px; padding: 10px 14px; font-size: 14px;';
    uploadBtn.addEventListener('click', () => this._fileInput.click());
    this.panel.appendChild(uploadBtn);

    this._fileInput = document.createElement('input');
    this._fileInput.type = 'file';
    this._fileInput.accept = 'image/png';
    this._fileInput.style.display = 'none';
    this._fileInput.addEventListener('change', () => this._onUpload(this._fileInput));
    this.panel.appendChild(this._fileInput);

    // Build 21 M3：按正版用户名拉取皮肤（服务器代理优先，单机回退第三方镜像）
    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex; gap:8px; align-items:center;';
    this._nameInput = document.createElement('input');
    this._nameInput.type = 'text';
    this._nameInput.placeholder = t('Minecraft®: Java Edition档案用户名');
    this._nameInput.style.cssText = 'width: 150px; padding: 8px 10px; font-size: 13px; background: rgba(0,0,0,0.4); border: 1px solid #555; color: #fff;';
    this._fitNameInput(this._nameInput); // Build 23：按占位文本实测加宽（须在 cssText 之后，否则被覆盖）
    nameRow.appendChild(this._nameInput);
    const fetchBtn = document.createElement('button');
    fetchBtn.className = 'cw-stone-btn';
    fetchBtn.textContent = t('按用户名获取');
    fetchBtn.style.cssText = 'padding: 8px 12px; font-size: 13px;';
    fetchBtn.addEventListener('click', () => this._onFetchByName());
    nameRow.appendChild(fetchBtn);
    this.panel.appendChild(nameRow);

    this._hint = document.createElement('div');
    this._hint.style.cssText = 'font-size: 11px; color: #9ab; max-width: 268px; text-align: center; line-height: 1.5;';
    this.panel.appendChild(this._hint);

    // 恢复默认
    const reset = document.createElement('button');
    reset.className = 'cw-stone-btn';
    reset.textContent = t('恢复默认');
    reset.style.cssText = 'width: 268px; padding: 8px 14px; font-size: 13px;';
    reset.addEventListener('click', () => {
      clearSkinPrefs();
      this._notifyGame();
      this.render();
    });
    this.panel.appendChild(reset);

    const back = document.createElement('button');
    back.className = 'cw-stone-btn';
    back.textContent = t('← 返回');
    back.style.cssText = 'width: 268px; padding: 8px 14px; font-size: 14px; margin-top: 6px;';
    back.addEventListener('click', () => this.hide());
    this.panel.appendChild(back);
  }

  // 2D 正面预览：base 先画、overlay 叠加（透明像素不遮盖）
  async _drawPreview(cv) {
    const prefs = getSkinPrefs();
    try {
      const src = prefs.data || DEFAULT_SKIN_URLS[prefs.model];
      const img = await loadImageFromURL(src);
      const norm = normalizeSkin(img);
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const S = 6;
      for (const p of PREVIEW_PARTS) {
        ctx.drawImage(norm, p.rect[0], p.rect[1], p.rect[2], p.rect[3], p.at[0] * S, p.at[1] * S, p.rect[2] * S, p.rect[3] * S);
      }
      for (const p of PREVIEW_OVERLAYS) {
        ctx.drawImage(norm, p.rect[0], p.rect[1], p.rect[2], p.rect[3], p.at[0] * S, p.at[1] * S, p.rect[2] * S, p.rect[3] * S);
      }
    } catch (e) {
      // 预览失败静默（面板其余部分可用）
    }
  }

  async _onUpload(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const dataURL = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('read fail'));
        fr.readAsDataURL(file);
      });
      const img = await loadImageFromURL(dataURL);
      // 统一归一化后存 64×64 PNG dataURL（legacy 64×32 在此一并归一）
      const norm = normalizeSkin(img);
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 64;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(norm, 0, 0);
      const prefs = getSkinPrefs();
      prefs.data = cv.toDataURL('image/png');
      prefs.source = 'upload';
      saveSkinPrefs(prefs);
      this._notifyGame();
      this.render();
    } catch (e) {
      if (this._hint) this._hint.textContent = t('皮肤须为 64×64 PNG（旧版 64×32 可自动转换）。');
    }
  }

  // Build 21 M3 / B41 重写：按正版用户名拉取皮肤。候选链见 PlayerSkin.buildSkinCandidates：
  //   ① 联机：走连接中的服务器代理（服务器无 CORS 限制，还能拿到 slim 标记）
  //   ② 本机 3001：仅本地地址或 http 页面才试（静态托管上 100% 被混合内容拦，不再白试）
  //   ③ 第三方镜像（mc-heads / minotar）：必须 crossOrigin 载入，否则画布污染、toDataURL 抛
  //      SecurityError——这正是 Pages 上"既没有服务器、镜像也读不回"的静默失败根因。
  async _onFetchByName() {
    const name = (this._nameInput && this._nameInput.value || '').trim();
    if (this._hint) this._hint.textContent = t('正在获取皮肤…');
    const g = window.game;
    const candidates = buildSkinCandidates(name, {
      netUrl: (g && g.networkMode && g.net && g.net._url) ? g.net._url : null,
      protocol: location.protocol,
      hostname: location.hostname,
    });
    for (const cand of candidates) {
      try {
        let data = null, model = 'classic'; // 镜像无 slim 判定，按 classic 臂宽
        if (cand.kind === 'mirror') {
          const img = await loadImageFromURL(cand.url, { crossOrigin: true });
          const cv = document.createElement('canvas');
          cv.width = 64; cv.height = 64;
          const ctx = cv.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(normalizeSkin(img), 0, 0);
          data = cv.toDataURL('image/png');
        } else {
          const r = await fetch(cand.url, { signal: AbortSignal.timeout(6000) });
          if (!r.ok) throw new Error('proxy ' + r.status);
          const j = await r.json();
          data = j.data; model = j.model === 'slim' ? 'slim' : 'classic';
        }
        if (!data) throw new Error('empty');
        const prefs = getSkinPrefs();
        prefs.data = data;
        prefs.model = model;
        prefs.source = 'username';
        saveSkinPrefs(prefs);
        this._notifyGame();
        this.render();
        if (this._hint) this._hint.textContent = t('来源：{src}', { src: cand.name });
        return;
      } catch (e) {
        console.debug('[skin] 候选失败', cand.url, e && e.message);
      }
    }
    if (this._hint) this._hint.textContent = t('获取失败：网络不可用或用户名不存在，可改用上传 PNG。');
  }

  // 通知游戏内模型实时换肤（主菜单期 game 亦已存在；running=false 时刷新无副作用）。
  // Build 21 M2：联机时同步广播新皮肤给房间。
  _notifyGame() {
    const g = window.game;
    if (!g) return;
    if (g.playerModel && g.playerModel.refreshSkin) g.playerModel.refreshSkin();
    if (g.hand && g.hand.loadSkin) g.hand.loadSkin();
    if (g.networkMode && g.net && g.net.sendSkin) g.net.sendSkin();
  }

  // Build 23：按占位文本实测宽度加宽输入框（各语言文案长度差异大，固定宽度看不全）
  _fitNameInput(input) {
    if (!input || !input.placeholder) return;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
    const w = Math.ceil(ctx.measureText(input.placeholder).width) + 24; // 左右 padding 10×2 + 边框 1×2 + 舍入余量
    input.style.width = Math.min(460, Math.max(160, w)) + 'px';
  }

  show() {
    this.render();    this.visible = true;
    this.el.style.display = 'flex';
    if (this.game && this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    if (this.onHide) this.onHide();
  }

  dispose() {
    document.removeEventListener('keydown', this._onKey, true);
    this.el.remove();
  }
}
