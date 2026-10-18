// test-stage11.mjs -- 阶段 11 服务器回归：房间白名单 / 管理账号 op-viewer 角色分级 / 房间 op 名单 / netStats 抖动纯函数
// 用法：node server/test-stage11.mjs   （先启动 server/index.mjs，端口 3001；跑批前清空 server/world/ 与 server/config.json）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { createNetStats, pushRttSample, targetInterpDelay } from '../src/net/netStats.js';
import { assert, finish, counts, configure } from './test-lib.mjs';

configure({ style: 'spaced' });

const URL = 'ws://127.0.0.1:3001/ws';
const API = 'http://127.0.0.1:3001/api';

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const p = { ws, id: null, inbox: [], waiters: [], closed: false };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      p.inbox.push(m);
      for (let i = p.waiters.length - 1; i >= 0; i--) {
        if (p.waiters[i](m)) p.waiters.splice(i, 1);
      }
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, version: PROTOCOL_VERSION })));
    ws.on('message', function h(raw) {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome') {
        ws.off('message', h);
        p.id = m.selfId;
        resolve(p);
      }
    });
    ws.on('error', reject);
    ws.on('close', () => { p.closed = true; });
  });
}

const send = (p, t, d = {}) => p.ws.send(JSON.stringify({ t, ...d }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(p, pred, timeout = 3000) {
  return new Promise((resolve) => {
    const hit = p.inbox.find(pred);
    if (hit) return resolve(hit);
    const t = setTimeout(() => resolve(null), timeout);
    p.waiters.push((m) => { if (pred(m)) { clearTimeout(t); resolve(m); return true; } return false; });
  });
}

const api = async (path, method = 'GET', body, token) => {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
};

console.log('阶段 11 服务器回归 ================');

// --- 用例 0：netStats 纯函数（无服务器依赖） ---
{
  console.log('[0] netStats：RTT EMA / 抖动 / 目标延迟钳位');
  const st = createNetStats();
  assert('初始 rttMs=null', st.rttMs === null && st.rttJitterMs === null);
  pushRttSample(st, 100);
  assert('首样本直通 rttMs=100', st.rttMs === 100);
  assert('单样本无抖动', st.rttJitterMs === null);
  pushRttSample(st, 200);
  assert('EMA(0.8/0.2)：100,200 → 120', Math.abs(st.rttMs - 120) < 1e-9, String(st.rttMs));
  assert('抖动 |200-100|=100', Math.abs(st.rttJitterMs - 100) < 1e-9, String(st.rttJitterMs));
  pushRttSample(st, 200);
  assert('抖动 EMA：100,0 → 80', Math.abs(st.rttJitterMs - 80) < 1e-9, String(st.rttJitterMs));
  pushRttSample(st, NaN); pushRttSample(st, -5); pushRttSample(st, 20000);
  assert('非法样本（NaN/负/≥10s）被忽略', Math.abs(st.rttJitterMs - 80) < 1e-9);
  assert('目标延迟：无数据 → 0.05 下限', targetInterpDelay(null, null) === 0.05);
  assert('目标延迟：rtt=200 → 0.15', Math.abs(targetInterpDelay(200, 0) - 0.15) < 1e-9);
  assert('目标延迟：rtt=200,jitter=400 → 0.25', Math.abs(targetInterpDelay(200, 400) - 0.25) < 1e-9);
  assert('目标延迟：超大值钳 0.4 上限', targetInterpDelay(5000, 1000) === 0.4);
}

// --- 用例 1：白名单 API + 入房拦截（鉴权未开启阶段） ---
let OP_TOKEN = null;
let VIEWER_TOKEN = null;
{
  console.log('[1] 房间白名单');
  // 设置白名单：昵称带首尾空格，验证清洗 trim；另一房间名单为空 = 不启用
  const w = await api('/whitelist', 'POST', { roomWhitelist: { 's11-wl': [' alice '] } });
  assert('POST /api/whitelist 200', w.status === 200);
  const r = await api('/whitelist');
  assert('GET 回读且 trim 生效', r.json.roomWhitelist['s11-wl'] && r.json.roomWhitelist['s11-wl'][0] === 'alice', JSON.stringify(r.json.roomWhitelist));

  // 名单外昵称 join_room → kicked + 断开
  const outsider = await connect('outsider');
  send(outsider, 'join_room', { room: 's11-wl' });
  const kicked = await waitFor(outsider, (m) => m.t === 'kicked');
  assert('名单外 join_room 被 kicked', !!kicked && /白名单/.test(kicked.reason || ''), JSON.stringify(kicked || {}));
  await sleep(150);
  assert('被拒后服务器关闭连接', outsider.closed === true);

  // 名单外昵称 create_room 同样被拒（房间存在即受名单约束）
  const outsider2 = await connect('outsider');
  send(outsider2, 'create_room', { room: 's11-wl', seed: 11, mode: 'survival' });
  const kicked2 = await waitFor(outsider2, (m) => m.t === 'kicked');
  assert('名单外 create_room 被 kicked', !!kicked2 && /白名单/.test(kicked2.reason || ''));
  outsider2.ws.close();

  // 名单内昵称正常加入
  const alice = await connect('alice');
  send(alice, 'join_room', { room: 's11-wl' });
  const wi = await waitFor(alice, (m) => m.t === 'world_info');
  assert('名单内昵称正常加入（world_info 下发）', !!wi && wi.room === 's11-wl');

  // 游戏内换房到白名单房间（名单外）→ 系统聊天拒绝且留在原房间
  const switcher = await connect('switcher');
  send(switcher, 'create_room', { room: 's11-src', seed: 12, mode: 'survival' });
  await sleep(150);
  send(switcher, 'switch_room', { room: 's11-wl' });
  const rej = await waitFor(switcher, (m) => m.t === 'chat' && /白名单/.test(m.text || ''));
  assert('switch_room 到白名单房间被聊天拒绝', !!rej, JSON.stringify(rej || {}));
  send(switcher, 'chat', { text: '/seed' });
  const seedReply = await waitFor(switcher, (m) => m.t === 'chat' && /当前房间「s11-src」seed=/.test(m.text || ''));
  assert('拒绝后仍留在原房间', !!seedReply && /s11-src/.test(seedReply.text || ''), JSON.stringify(seedReply || {}));

  // 对照组：未启用白名单的房间任何人可进
  const anyone = await connect('anyone');
  send(anyone, 'join_room', { room: 's11-open' });
  const wi2 = await waitFor(anyone, (m) => m.t === 'world_info');
  assert('未启用白名单的房间任何人可进', !!wi2 && wi2.room === 's11-open');
  alice.ws.close(); switcher.ws.close(); anyone.ws.close();
  await sleep(120);

  // 无鉴权阶段 whoami = op（局域网信任）
  const me0 = await api('/whoami');
  assert('无鉴权 whoami role=op', me0.status === 200 && me0.json.role === 'op' && me0.json.authEnabled === false, JSON.stringify(me0.json));

  // 生成 op 账号（此后鉴权开启）→ 用它生成 viewer 账号
  const t1 = await api('/tokens', 'POST', { label: 'op-主', expiresMinutes: 0, role: 'op' });
  assert('生成 op 账号 200', t1.status === 200 && t1.json.token, JSON.stringify({ ...t1.json, token: t1.json.token ? '***' : null }));
  OP_TOKEN = t1.json.token;
  const t2 = await api('/whitelist', 'POST', { roomOps: {} }, OP_TOKEN);
  assert('op token 可写 /api/whitelist', t2.status === 200);
  const t3 = await api('/tokens', 'POST', { label: 'viewer-只读', expiresMinutes: 0, role: 'viewer' }, OP_TOKEN);
  assert('op 可生成 viewer 账号', t3.status === 200 && !!t3.json.token);
  VIEWER_TOKEN = t3.json.token;
}

// --- 用例 2：viewer 角色只读分级 ---
{
  console.log('[2] viewer 只读 / op 全权');
  const meV = await api('/whoami', 'GET', undefined, VIEWER_TOKEN);
  assert('viewer whoami role=viewer', meV.status === 200 && meV.json.role === 'viewer' && meV.json.authEnabled === true, JSON.stringify(meV.json));
  const meO = await api('/whoami', 'GET', undefined, OP_TOKEN);
  assert('op whoami role=op', meO.status === 200 && meO.json.role === 'op');

  const g1 = await api('/status', 'GET', undefined, VIEWER_TOKEN);
  assert('viewer GET /api/status 放行', g1.status === 200);
  const g2 = await api('/whitelist', 'GET', undefined, VIEWER_TOKEN);
  assert('viewer GET /api/whitelist 放行', g2.status === 200);
  const g3 = await api('/logs', 'GET', undefined, VIEWER_TOKEN);
  assert('viewer GET /api/logs 放行', g3.status === 200);

  const w403 = await api('/whitelist', 'POST', { roomWhitelist: {} }, VIEWER_TOKEN);
  assert('viewer POST /api/whitelist 403', w403.status === 403, JSON.stringify(w403.json));
  const c403 = await api('/config', 'POST', { dropTtlMs: 300000 }, VIEWER_TOKEN);
  assert('viewer POST /api/config 403', c403.status === 403);
  const k403 = await api('/kick', 'POST', { playerId: 1 }, VIEWER_TOKEN);
  assert('viewer POST /api/kick 403', k403.status === 403);
  const t403 = await api('/tokens', 'POST', { label: 'x' }, VIEWER_TOKEN);
  assert('viewer POST /api/tokens 403', t403.status === 403);
  const b403 = await api('/broadcast', 'POST', { text: 'hi' }, VIEWER_TOKEN);
  assert('viewer POST /api/broadcast 403', b403.status === 403);

  // 旧账号兼容：无 role 字段提交 → 归一为 op
  const compat = await api('/config', 'POST', {
    adminAccounts: [
      { token: OP_TOKEN, label: 'default', expires: 0 },
      { token: VIEWER_TOKEN, label: 'viewer-只读', expires: 0 },
    ],
  }, OP_TOKEN);
  assert('无 role 旧账号提交 200', compat.status === 200);
  const roles = (compat.json.config.adminAccounts || []).map((a) => a.role);
  assert('缺省 role 归一为 op', roles.length === 2 && roles.every((x) => x === 'op'), JSON.stringify(roles));
  // 恢复 viewer 角色（供后续断言口径一致）
  await api('/config', 'POST', {
    adminAccounts: [
      { token: OP_TOKEN, label: 'default', expires: 0, role: 'op' },
      { token: VIEWER_TOKEN, label: 'viewer-只读', expires: 0, role: 'viewer' },
    ],
  }, OP_TOKEN);
}

// --- 用例 3：房间 op 名单（gamemode / set_time / world_reset 放宽） ---
{
  console.log('[3] 房间 op 名单');
  const w = await api('/whitelist', 'POST', { roomOps: { 's11-ops': ['op甲'] } }, OP_TOKEN);
  assert('POST roomOps 200', w.status === 200 && w.json.roomOps['s11-ops'][0] === 'op甲');

  const host = await connect('房主');
  send(host, 'create_room', { room: 's11-ops', seed: 13, mode: 'survival' });
  await sleep(150);
  const opP = await connect('op甲');
  send(opP, 'join_room', { room: 's11-ops' });
  await sleep(150);
  const plain = await connect('路人');
  send(plain, 'join_room', { room: 's11-ops' });
  await sleep(150);

  // op（非 host）：gamemode 放行
  send(opP, 'gamemode', { mode: 'creative' });
  const gm = await waitFor(opP, (m) => m.t === 'gamemode' && m.id === opP.id);
  assert('op 名单内非 host 可切模式', !!gm && gm.mode === 'creative', JSON.stringify(gm || {}));

  // op（非 host）：set_time 放行
  send(opP, 'set_time', { time: 0.9 });
  const tm = await waitFor(opP, (m) => m.t === 'time');
  assert('op 名单内非 host 可设时间', !!tm && Math.abs(tm.time - 0.9) < 1e-9, JSON.stringify(tm || {}));

  // op（非 host）：world_reset 放行（world_info restart=true）
  send(opP, 'world_reset', {});
  const wr = await waitFor(opP, (m) => m.t === 'world_info' && m.restart === true);
  assert('op 名单内非 host 可重建世界', !!wr, JSON.stringify(wr || {}));

  // 普通玩家：gamemode / set_time / world_reset 均拒（系统聊天提示）
  send(plain, 'gamemode', { mode: 'creative' });
  const rj1 = await waitFor(plain, (m) => m.t === 'chat' && /只有房主\(HOST\)\/op/.test(m.text || ''));
  assert('名单外 gamemode 被拒并提示', !!rj1, JSON.stringify(rj1 || {}));
  send(plain, 'set_time', { time: 0.5 });
  const rj2 = await waitFor(plain, (m) => m.t === 'chat' && /只有房主\(HOST\)\/op/.test(m.text || ''));
  assert('名单外 set_time 被拒并提示', !!rj2);
  send(plain, 'world_reset', {});
  const rj3 = await waitFor(plain, (m) => m.t === 'chat' && /只有房主\(HOST\)\/op/.test(m.text || ''));
  assert('名单外 world_reset 被拒并提示', !!rj3);

  // 清理名单后 op 失权（回归：名单为空 = 仅 host）
  await api('/whitelist', 'POST', { roomOps: { 's11-ops': [] } }, OP_TOKEN);
  send(opP, 'gamemode', { mode: 'survival' });
  const rj4 = await waitFor(opP, (m) => m.t === 'chat' && /只有房主\(HOST\)\/op/.test(m.text || ''));
  assert('清空名单后 op 失权', !!rj4);
  host.ws.close(); opP.ws.close(); plain.ws.close();
}

// --- 收尾：清理白名单配置（避免污染后续跑批） ---
{
  const w = await api('/whitelist', 'POST', { roomWhitelist: {}, roomOps: {} }, OP_TOKEN);
  assert('收尾清空白名单配置', w.status === 200);
}

// --- 收尾：清除鉴权账号（Build 23）---
// 面板/多账号测试会持久化 adminAccounts 到 config.json，遗留鉴权态会让
// 跑批后续套件与人工调用 401；清空 = 恢复默认无鉴权状态
{
  const clear = await api('/config', 'POST', { adminAccounts: [] }, OP_TOKEN);
  assert('收尾清除鉴权账号', clear.status === 200 && (clear.json.config.adminAccounts || []).length === 0);
}

const { total, passed } = counts();
console.log(`\n阶段 11 回归：${passed}/${total} 通过`);
finish();
