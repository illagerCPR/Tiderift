// build23-menu-lan.mjs -- Build 23 回归（node 直跑，无需服务器）
// 断言：
//   ① 皮肤面板用户名输入框按占位文本实测加宽（_fitNameInput + canvas measureText 绊线）
//   ② 测试后自动清除鉴权账号（stage11 API 级收尾 + run-all 文件级兜底）
//   ③ 主界面 LAN 状态组件：lanStatus 纯函数（归一化/URL）+ probeLanServer 真实探测
//     （本机临时端口起 http 服务：在线/离线双态）+ MenuScreen 接线绊线 + LAN 页地址预填
//   ④ i18n 新键 10 包在场
//   ⑤ BUILD = 23
import { readFileSync } from 'fs';
import http from 'node:http';
import {
  normalizeLanHost, lanWsUrl, probeLanServer, LAN_PORT, LAN_HOST_KEY, DEFAULT_LAN_HOST,
} from '../src/net/lanStatus.js';
import { BUILD } from '../src/version.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}
function srcOf(path) { return readFileSync(new URL(path, import.meta.url), 'utf-8'); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── ① 用户名输入框按占位文本加宽 ──
{
  const ss = srcOf('../src/ui/SkinScreen.js');
  ok(ss.includes('this._fitNameInput(this._nameInput)'), 'render 中调用 _fitNameInput');
  ok(ss.includes('measureText(input.placeholder).width'), '按占位文本 measureText 实测宽度');
  ok(ss.includes("Math.min(460, Math.max(160, w))"), '宽度钳位 [160, 460]（过长语言不无限加宽）');
  // 顺序校验：加宽调用必须在 style.cssText 赋值之后（cssText 会整体覆盖 width）
  const cssIdx = ss.indexOf("this._nameInput.style.cssText = 'width: 150px;");
  const fitIdx = ss.indexOf('this._fitNameInput(this._nameInput)');
  ok(cssIdx !== -1 && fitIdx !== -1 && fitIdx > cssIdx, '加宽调用在 cssText 赋值之后（否则被覆盖）');
}

// ── ② 测试后自动清除鉴权账号 ──
{
  const s11 = srcOf('../server/test-stage11.mjs');
  ok(s11.includes("api('/config', 'POST', { adminAccounts: [] }"), 'stage11 收尾 API 清除鉴权账号');
  const ra = srcOf('../server/run-all-tests.sh');
  ok(ra.includes('server-stop') && /server-stop[^]*?rm -f server\/config\.json/.test(ra),
    'run-all 停服后文件级清除 config.json（兜底）');
  ok(ra.includes('服务器测试数据与鉴权账号已清除'), '跑批收尾打印清理提示');
}

// ── ③ LAN 状态组件 ──
{
  // 纯函数：归一化（去 scheme/端口/路径，空与非法回退）
  ok(normalizeLanHost('192.168.1.5') === '192.168.1.5', '裸 IP 原样');
  ok(normalizeLanHost('ws://192.168.1.5:3001/ws') === '192.168.1.5', '去 ws:// scheme 与端口路径');
  ok(normalizeLanHost('http://myhost.lan/') === 'myhost.lan', '去 http:// 与尾斜杠');
  ok(normalizeLanHost('[fd00::1]:3001') === 'fd00::1', 'IPv6 去方括号与端口');
  ok(normalizeLanHost('  127.0.0.1  ') === '127.0.0.1', '首尾空白裁剪');
  ok(normalizeLanHost('') === null && normalizeLanHost('   ') === null, '空输入 → null（回退当前值）');
  ok(normalizeLanHost('bad host!') === null, '非法字符 → null');
  ok(normalizeLanHost(null) === null, '非字符串 → null');
  ok(lanWsUrl('192.168.1.5') === 'ws://192.168.1.5:3001/ws', 'lanWsUrl 组装');
  ok(lanWsUrl() === `ws://${DEFAULT_LAN_HOST}:${LAN_PORT}/ws`, '默认主机 127.0.0.1:3001');

  // probeLanServer 真实探测：本机临时端口起 http 服务（在线）→ 关闭（离线）
  const server = http.createServer((req, res) => { res.writeHead(401); res.end('no'); }); // 401 也算在线
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const up = await probeLanServer('127.0.0.1', { port, timeoutMs: 1500 });
  ok(up.online === true, '端口可达（no-cors 不透明响应，即使 401 鉴权拒绝）= 在线');
  ok(up.status === 0 || up.status === 401, '浏览器 no-cors status=0（opaque）；node undici 透传 401——探测只关心可达性');
  await new Promise((r) => server.close(r));
  const down = await probeLanServer('127.0.0.1', { port, timeoutMs: 1500 });
  ok(down.online === false, '端口关闭 = 离线（网络错误吞掉不抛）');

  // MenuScreen 接线绊线
  const ms = srcOf('../src/ui/MenuScreen.js');
  ok(ms.includes('id="lan-status-widget"'), '主界面右下角 LAN 状态组件在渲染标记中');
  ok(ms.includes('position: absolute; right: 12px; bottom: 8px'), '组件位于右下角（避开左下角版本号）');
  ok(ms.includes('id="lan-host-input"'), 'LAN IP 设置输入框');
  ok(ms.includes('id="lan-refresh-btn"'), '刷新按钮');
  ok(ms.includes("function refreshIconDataUri()"), 'SVG 刷新图标（data URI）');
  ok(ms.includes("btn.id === 'lan-refresh-btn'") && ms.includes('this._probeLan()'), '刷新按钮走事件委托重探测');
  ok(ms.includes("e.target.id === 'lan-host-input'"), 'IP 输入框 change 委托');
  // Build 24 起变更：LAN 页地址输入框移除，地址唯一来源 = 主界面「LAN默认服务器设置」；
  // change 只探测不落盘（保存走「设置为默认」按钮），此处改作历史行为绊线
  ok(ms.includes('setLanHost(e.target.value)') === false, 'IP 输入框 change 不再直接落盘（Build 24 迁移到设为默认按钮）');
  ok(ms.includes('id="mp-url"') === false, 'LAN 游戏页地址输入框已移除');
  ok(ms.includes("r.online ? t('在线') : t('离线')"), '状态文本双态 + i18n');
  ok(ms.includes("t('检测中…')"), '探测中占位文本');
  ok(ms.includes("localStorage") === false, '菜单模块不直接碰 localStorage（持久化收口在 lanStatus）');
}

// ── ④ i18n 新键 10 包 ──
{
  const langs = ['zh-TW', 'en', 'fr', 'de', 'ja', 'ko', 'ar', 'ru', 'es', 'pt'];
  for (const lang of langs) {
    const src = srcOf(`../src/i18n/locales/${lang}.js`);
    for (const key of ['LAN 服务器 IP', '检测中…', '在线', '离线', '刷新',
                       'LAN默认服务器设置', '设置为默认', '已设为默认', '连接地址（主界面右下角可改）：']) {
      ok(src.includes(`"${key}"`), `语言包 ${lang} 缺键: ${key}`);
    }
  }
}

// ── ⑤ BUILD ──
ok(BUILD === 28, `BUILD 递增到 24（当前 ${BUILD}）`);

console.log(`build23-menu-lan: ${passed} assertions ALL PASS`);
