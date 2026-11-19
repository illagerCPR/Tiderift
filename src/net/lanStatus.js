// lanStatus.js -- 主菜单 LAN 服务器状态探测与地址持久化（Build 23）
// 主界面右下角组件：LAN 服务器在线/离线显示 + SVG 刷新按钮 + 局域网 IP 设置。
// IP 持久化到 localStorage（键 project-mc-lan-host），LAN 游戏页的服务器地址（ws://<host>:3001/ws）
// 以此为默认预填——单一来源，两处不脱节。
// normalizeLanHost/lanWsUrl 为纯函数（node 可测）；probeLanServer 用 fetch + AbortSignal.timeout
//（node 18+/现代浏览器均可跑），任何 HTTP 响应（含 401 鉴权拒绝）都算"在线"——探测只关心端口可达。

export const LAN_PORT = 3001;
export const LAN_HOST_KEY = 'project-mc-lan-host';
export const DEFAULT_LAN_HOST = '127.0.0.1';

// 同源部署（Docker 单端口：客户端与服务器同端口）时的默认主机名。
// 页面由 http(s) 提供时，服务器就在同一个 host 上——直接用 location.hostname，
// 玩家打开 http://<服务器IP>:3001/ 即可联机，无需手填 IP。
// 无 location（node 测试）或 file: 协议时回退 127.0.0.1。
export function defaultLanHost() {
  try {
    const loc = typeof location !== 'undefined' ? location : null;
    if (loc && (loc.protocol === 'http:' || loc.protocol === 'https:') && loc.hostname) {
      return loc.hostname;
    }
  } catch (e) { /* 无 location 走默认 */ }
  return DEFAULT_LAN_HOST;
}

// 归一化用户输入：去 scheme（ws:// http:// wss:// https://）、去端口、去尾斜杠与路径。
// 空/非法输入返回 null（调用方回退显示当前已存值）；合法返回裸主机名（IPv4/域名/IPv6 原样保留）。
export function normalizeLanHost(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^(ws|wss|http|https):\/\//i, '');
  s = s.replace(/\/.*$/, '');            // 尾斜杠/路径
  s = s.replace(/:\d+$/, '');            // 端口（固定 3001，不收在 host 里）
  s = s.replace(/^\[/, '').replace(/\]$/, ''); // [IPv6] 方括号
  if (!s) return null;
  if (!/^[A-Za-z0-9.:\-_]+$/.test(s)) return null; // 主机名合法字符（IPv6 冒号在列）
  return s;
}

// LAN 游戏页的 WebSocket 地址
export function lanWsUrl(host = DEFAULT_LAN_HOST) {
  return `ws://${host}:${LAN_PORT}/ws`;
}

// 当前持久化的 LAN 主机名（localStorage 不可用/未存时回退同源推导，再回退 127.0.0.1）
export function getLanHost() {
  try {
    const raw = localStorage.getItem(LAN_HOST_KEY);
    if (raw) {
      const n = normalizeLanHost(raw);
      if (n) return n;
    }
  } catch (e) { /* 无 localStorage（node/隐私模式）走默认 */ }
  return defaultLanHost();
}

// 归一化并持久化；非法输入返回 null（调用方保持原值），合法返回归一化结果
export function setLanHost(raw) {
  const n = normalizeLanHost(raw);
  if (n == null) return null;
  try { localStorage.setItem(LAN_HOST_KEY, n); } catch (e) { /* 忽略 */ }
  return n;
}

// 探测 LAN 服务器端口可达性。任何 HTTP 响应（200/401/404…）= 在线；
// 网络错误/超时 = 离线。返回 { online, status? }。
// 必须用 mode:'no-cors'：菜单页(5173)与服务器(3001)跨端口，常规 fetch 会被 CORS
// 拦下响应而抛 TypeError（服务器在线也误判离线）；no-cors 拿到不透明响应（status 0）
// 只表明"端口有 HTTP 服务应答"，正合探测本意，且对鉴权开/关都成立。
export async function probeLanServer(host = DEFAULT_LAN_HOST, opts = {}) {
  const port = opts.port || LAN_PORT;
  const timeoutMs = opts.timeoutMs || 2000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${host}:${port}/api/status`, { mode: 'no-cors', signal: ctl.signal });
    return { online: true, status: res.status };
  } catch (e) {
    return { online: false };
  } finally {
    clearTimeout(timer);
  }
}
