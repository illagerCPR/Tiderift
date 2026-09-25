// build21-skins.mjs -- Build 21 M1 玩家皮肤回归（node 直跑，无需服务器）
// 断言：
//   ① partRects 纯函数：classic/slim 双模型区域表（head/body/arm/leg 六面 + overlay 全套）
//   ② 区域完备性：全部矩形在 64×64 界内、同层六面互不重叠
//   ③ buildParts 布局：原版比例（classic 臂 4px / slim 臂 3px）+ pivot 肩髋点 + PARTS 常量
//   ④ 修复 A：头部俯仰符号翻正（行为级——LocalPlayerModel.update + RemotePlayer 源码绊线）
//   ⑤ 修复 B：手持物挂点移到掌前（源码绊线）
//   ⑥ 皮肤管线接线：SkinScreen / 主菜单入口 / 通知刷新 / 键名同源 / 默认皮肤文件在场
//   ⑦ i18n 新键 10 包在场；批次 1 不 bump BUILD
import { readFileSync, existsSync } from 'fs';
import * as THREE from 'three';
import { partRects, SKIN_STORAGE_KEY, DEFAULT_SKIN_URLS } from '../src/entity/PlayerSkin.js';
import { PARTS, buildParts, RemotePlayer } from '../src/entity/RemotePlayer.js';
import { LocalPlayerModel } from '../src/entity/LocalPlayerModel.js';
import { BUILD } from '../src/version.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
function inBounds(r) { return r.x >= 0 && r.y >= 0 && r.x + r.w <= 64 && r.y + r.h <= 64; }
function noOverlap(a, b) {
  return a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
}

// ── ① partRects 区域表 ──
{
  const c = partRects('classic');
  const s = partRects('slim');
  // head 六面（标准 64×64 布局锚点）
  const h = c.head;
  for (const sel of ['right', 'front', 'left', 'back', 'top', 'bottom']) {
    ok(!!h.base[sel], `head base 缺面 ${sel}`);
    ok(!!h.overlay[sel], `head overlay 缺面 ${sel}`);
  }
  ok(h.base.front.x === 8 && h.base.front.y === 8 && h.base.front.w === 8 && h.base.front.h === 8,
    'head front = (8,8,8,8)');
  ok(h.base.right.x === 0 && h.base.right.y === 8, 'head right = (0,8)');
  ok(h.base.left.x === 16 && h.base.left.y === 8, 'head left = (16,8)');
  ok(h.base.back.x === 24 && h.base.back.y === 8, 'head back = (24,8)');
  ok(h.base.top.x === 8 && h.base.top.y === 0, 'head top = (8,0)');
  ok(h.base.bottom.x === 16 && h.base.bottom.y === 0, 'head bottom = (16,0)');
  ok(h.overlay.front.x === 40 && h.overlay.front.y === 8, 'hat front = (40,8)（overlay 原点 +32x）');
  // body
  ok(c.body.base.front.x === 20 && c.body.base.front.y === 20 && c.body.base.front.h === 12,
    'body front = (20,20,8,12)');
  ok(c.body.overlay.front.x === 20 && c.body.overlay.front.y === 36, 'jacket front = (20,36)（+16y）');
  // classic/slim 臂差异：仅宽度 4px/3px，front 区域与背侧排布随公式
  ok(c.armR.base.front.w === 4 && s.armR.base.front.w === 3, '臂宽 classic 4px / slim 3px');
  ok(c.armR.base.front.x === 44 && c.armR.base.front.y === 20 && c.armR.base.front.h === 12,
    'armR front = (44,20,4,12)');
  ok(s.armR.base.front.x === 44 && s.armR.base.front.y === 20 && s.armR.base.front.h === 12,
    'slim armR front = (44,20,3,12)');
  ok(s.armL.base.front.w === 3 && s.armL.base.front.x === 36, 'slim armL front = (36,52,3,12)');
  ok(c.armR.overlay.front.y === 36 && c.armL.overlay.front.y === 52, 'sleeve overlay 行位正确');
  ok(c.legR.overlay.front.y === 36 && c.legL.overlay.front.y === 52, 'pant overlay 行位正确');
  ok(c.legR.base.front.x === 4 && c.legR.base.front.y === 20, 'legR front = (4,20,4,12)');
  ok(c.armL.base.front.x === 36 && c.armL.base.front.y === 52, 'armL front = (36,52,4,12)');
}

// ── ② 区域完备性 ──
{
  const SELS = ['right', 'front', 'left', 'back', 'top', 'bottom'];
  for (const model of ['classic', 'slim']) {
    const m = partRects(model);
    for (const [key, part] of Object.entries(m)) {
      for (const layer of ['base', 'overlay']) {
        for (const sel of SELS) {
          const r = part[layer][sel];
          ok(inBounds(r), `${model}/${key}/${layer}/${sel} 越界: ${JSON.stringify(r)}`);
        }
        ok(noOverlap(part[layer].front, part[layer].right), `${model}/${key}/${layer} front/right 重叠`);
        ok(noOverlap(part[layer].front, part[layer].back), `${model}/${key}/${layer} front/back 重叠`);
        ok(noOverlap(part[layer].top, part[layer].front), `${model}/${key}/${layer} top/front 重叠`);
      }
    }
    // 同部件 base 与 overlay 不重叠（双层贴图区域独立）
    for (const [key, part] of Object.entries(m)) {
      ok(noOverlap(part.base.front, part.overlay.front), `${model}/${key} base/overlay front 重叠`);
    }
  }
}

// ── ③ buildParts 布局 ──
{
  const c = buildParts('classic');
  const s = buildParts('slim');
  const by = (arr, role) => arr.find((d) => d.role === role);
  ok(Math.abs(by(c, 'armR').box[3] - by(c, 'armR').box[0] - 0.25) < 1e-9, 'classic 臂宽 4px（0.25 格）');
  ok(Math.abs(by(s, 'armR').box[3] - by(s, 'armR').box[0] - 0.1875) < 1e-9, 'slim 臂宽 3px（0.1875 格）');
  ok(Math.abs(by(s, 'armR').box[5] - by(s, 'armR').box[2] - 0.25) < 1e-9, 'slim 臂厚（z）仍 4px——slim 只改宽度');
  ok(Math.abs(by(c, 'body').box[3] - by(c, 'body').box[0] - 0.5) < 1e-9, 'body 宽 8px');
  ok(Math.abs(by(c, 'body').box[4] - by(c, 'body').box[1] - 0.75) < 1e-9, 'body 高 12px');
  ok(Math.abs(by(c, 'head').box[3] - by(c, 'head').box[0] - 0.5) < 1e-9, 'head 8px');
  const armR = by(c, 'armR');
  ok(Math.abs(armR.pivot[0] - 0.375) < 1e-9 && Math.abs(armR.pivot[1] - 1.375) < 1e-9,
    'classic 肩点 pivot (0.375, 1.375)（比部件顶低 2px）');
  const slimArmR = by(s, 'armR');
  ok(Math.abs(slimArmR.pivot[0] - 0.34375) < 1e-9, 'slim 肩点 pivot (0.34375, 1.375)（3px 臂中心）');
  const legR = by(c, 'legR');
  ok(Math.abs(legR.pivot[1] - 0.75) < 1e-9, '髋点 pivot y=0.75（比腿顶低 2px）');
  ok(PARTS === PARTS && buildParts('classic').length === 6 && buildParts('slim').length === 6,
    'buildParts 双模型各 6 部件');
  // 部件总高 32px = 2.0 格（head 顶 2.0 / leg 底 0）
  ok(by(c, 'head').box[4] === 2.0 && by(c, 'legR').box[1] === 0, '模型总高 2.0 格（32px）');
}

// ── ④ 修复 A：头部俯仰符号 ──
{
  // 行为级：第三人称抬头 pitch>0 时模型头顶向后仰（rotation.x = +pitch）
  const game = { net: null, inventory: null };
  const scene = new THREE.Group();
  const model = new LocalPlayerModel(scene, game);
  const player = {
    position: new THREE.Vector3(0, 64, 0),
    velocity: new THREE.Vector3(),
    yaw: 0, pitch: 0.5, flying: false,
  };
  model.update(0.016, player, true, false);
  ok(model.joints.head && Math.abs(model.joints.head.pivot.rotation.x - 0.5) < 1e-9,
    '修复 A：抬头 pitch=0.5 → 头部 pivot rotation.x=+0.5（仰头，原 -0.5 为反向低头）');
  model.dispose();

  const rp = srcOf('../src/entity/RemotePlayer.js');
  ok(rp.includes('this.joints.head.pivot.rotation.x = this.pitch;'),
    '修复 A：RemotePlayer 头部俯仰同符号翻正（联机两端一致）');
  ok(!rp.includes('rotation.x = -this.pitch'), '修复 A：旧负号已移除');
}

// ── ⑤ 修复 B：手持物挂点 ──
{
  const lpm = srcOf('../src/entity/LocalPlayerModel.js');
  const rp = srcOf('../src/entity/RemotePlayer.js');
  ok(lpm.includes('g.position.set(0, -0.85, -0.28);'), '修复 B：LocalPlayerModel 手持物挂点掌前 (-Z)');
  ok(rp.includes('g.position.set(0, -0.85, -0.28);'), '修复 B：RemotePlayer 手持物挂点掌前 (-Z)');
  ok(!lpm.includes('0.10, -0.88, 0.22') && !rp.includes('0.10, -0.88, 0.22'),
    '修复 B：旧背后侧挂点 (+0.22) 已移除');
}

// ── ⑥ 皮肤管线接线 ──
{
  ok(existsSync(new URL('../res/default_skin/default_skin_classic.png', import.meta.url)),
    '默认皮肤 classic 文件在场');
  ok(existsSync(new URL('../res/default_skin/default_skin_slim.png', import.meta.url)),
    '默认皮肤 slim 文件在场');
  ok(DEFAULT_SKIN_URLS.classic.endsWith('default_skin_classic.png') &&
     DEFAULT_SKIN_URLS.slim.endsWith('default_skin_slim.png'),
    'DEFAULT_SKIN_URLS 指向默认皮肤（new URL import.meta.url 引入）');
  ok(SKIN_STORAGE_KEY === 'project-mc-skin-v1', '皮肤持久化键名');
  ok(srcOf('../src/entity/LocalPlayerModel.js').includes('SKIN_STORAGE_KEY'),
    'LocalPlayerModel 皮肤键与 PlayerSkin 常量同源');
  const ss = srcOf('../src/ui/SkinScreen.js');
  ok(ss.includes('personIconDataUri'), '皮肤入口图标');
  ok(ss.includes('saveSkinPrefs') && ss.includes('clearSkinPrefs'), 'SkinScreen 持久化读写');
  ok(ss.includes('refreshSkin') && ss.includes('loadSkin'), 'SkinScreen 保存后通知游戏内模型刷新');
  ok(ss.includes('classic') && ss.includes('slim'), 'SkinScreen 双模型档位');
  const menu = srcOf('../src/ui/MenuScreen.js');
  ok(menu.includes('id="skin-btn"') && menu.includes('skinScreen.show()'),
    '主菜单皮肤入口（多语言按钮右侧挂载点）');
  ok(menu.includes("background-image:url('${personIconDataUri()}')"), '皮肤按钮用小人图标');
  const main = srcOf('../src/main.js');
  ok(main.includes('new SkinScreen(game)') && main.includes('menu.skinScreen = skinScreen'),
    'main.js 构造 SkinScreen 并挂主菜单');
  ok(menu.includes("import { personIconDataUri } from './SkinScreen.js';"),
    'MenuScreen 引入皮肤图标');
  // RemotePlayer 皮肤预接口（M2 联机接线用）
  const rp = srcOf('../src/entity/RemotePlayer.js');
  ok(rp.includes('applySkinFromImage(img, model') && rp.includes('applySkinToRig'),
    'RemotePlayer.applySkinFromImage 预接口（M2 接线）');
  ok(rp.includes('this._skinHandle') && rp.includes('_skinHandle.dispose()'),
    'RemotePlayer 换肤先释放旧层（dispose 幂等）');
}

// ── ⑦ i18n 新键 + BUILD ──
{
  for (const lang of ['zh-TW', 'en', 'fr', 'de', 'ja', 'ko', 'ar', 'ru', 'es', 'pt']) {
    const src = srcOf(`../src/i18n/locales/${lang}.js`);
    for (const key of ['皮肤', '经典模型', '纤细模型', '上传皮肤 PNG', '恢复默认',
      'Minecraft®: Java Edition档案用户名', '按用户名获取', '正在获取皮肤…']) {
      ok(src.includes(key), `语言包 ${lang} 缺键: ${key}`);
    }
  }
}

// ── ⑧ M2：联机 skin 协议 ──
{
  ok(srcOf('../server/protocol.js').includes("SKIN_SET: 'skin_set'"), '协议常量 SKIN_SET');
  const room = srcOf('../server/room.js');
  ok(room.includes('this.playerSkins = new Map();'), '房间皮肤账本（内存态）');
  ok(room.includes("data.startsWith('data:image/png;base64,') || data.length > 16384"),
    'onSkinSet 校验：PNG dataURL 前缀 + 16KB 体积防线');
  ok(room.includes('case MSG.SKIN_SET: this.onSkinSet(player, msg); break;'), 'room 分发接线');
  ok(room.includes('for (const [id, sk] of this.playerSkins)'), 'joinRoom 回放房内已有皮肤');
  ok(room.includes('this.playerSkins.delete(id); // Build 21 M2'), '退房删皮肤（重连重发）');
  const nm = srcOf('../src/net/NetworkManager.js');
  ok(nm.includes('async sendSkin()') && nm.includes('MSG.SKIN_SET'), '客户端 sendSkin 上报');
  ok(nm.includes('case MSG.SKIN_SET:') && nm.includes('_applySkin(msg)'), '客户端 SKIN_SET 接收与应用');
  ok(nm.includes('this.sendSkin(); // Build 21 M2'), 'welcome 后立即上报');
  ok(nm.includes('for (const msg of this._pendingSkins.values()) this._applySkin(msg);'),
    'onWorldStarted 冲掉缓存的远端皮肤');
  ok(nm.includes('if (msg.id === this.selfId) break;'), '自己的 skin_set 不回环应用');
  const rp = srcOf('../src/entity/RemotePlayer.js');
  ok(rp.includes('async applySkinFromURL(url, model'), 'RemotePlayer.applySkinFromURL（dataURL 无 CORS）');
  const ss = srcOf('../src/ui/SkinScreen.js');
  ok(ss.includes('g.net.sendSkin()'), 'SkinScreen 保存后联机广播新皮肤');
}

// ── ⑨ M3：Mojang 代理（服务器三跳 + 客户端回退链）──
{
  const idx = srcOf('../server/index.mjs');
  ok(idx.includes("p.startsWith('/api/skin/')"), '公开 GET /api/skin/:username 路由（鉴权外——玩家无管理口令）');
  ok(idx.includes('api.mojang.com/users/profiles/minecraft/'), '代理一跳：用户名→uuid');
  ok(idx.includes('sessionserver.mojang.com/session/minecraft/profile/'), '代理二跳：uuid→textures');
  ok(idx.includes("metadata.model === 'slim'"), '代理携带 slim 标记');
  ok(idx.includes('const SKIN_CACHE_TTL = 5 * 60 * 1000;'), '5min 缓存防 Mojang 限速');
  const ss = srcOf('../src/ui/SkinScreen.js');
  ok(ss.includes("g.net._url.replace(/^ws/, 'http')"), '联机走连接中服务器的 HTTP 代理');
  ok(ss.includes('https://minotar.net/skin/'), '单机回退第三方镜像');
  ok(ss.includes("prefs.source = 'username'"), '拉取成功标记来源');
}

ok(BUILD === 28, `BUILD 24（Build 23 主菜单与皮肤面板批次统一 bump，当前 ${BUILD}）`);

console.log(`build21-skins: ${passed} passed`);
