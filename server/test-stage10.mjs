// test-stage10.mjs -- 阶段 10 服务器回归：RTT 直测回显 / 完整快捷栏同步 / 死亡掉落归属锁 / 管理多账号与 token 轮换 / 踢出原因
// 用法：node server/test-stage10.mjs   （先启动 server/index.mjs，端口 3001；跑批前清空 server/world/ 与 server/config.json）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { assert, finish, counts, configure } from './test-lib.mjs';

configure({ style: 'spaced' });

const URL = 'ws://127.0.0.1:3001/ws';
const API = 'http://127.0.0.1:3001/api';

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const p = { ws, id: null, inbox: [], waiters: [] };
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

console.log('阶段 10 服务器回归 ================');

// --- 用例 1：ping/pong RTT 直测回显 ---
{
  console.log('[1] RTT 直测回显');
  const A = await connect('rttA');
  send(A, 'create_room', { room: 's10-rtt', seed: 101, mode: 'survival' });
  await sleep(150);
  send(A, 'ping', { seq: 42, ts: 1234.5 });
  const pong = await waitFor(A, (m) => m.t === 'pong' && m.seq === 42);
  assert('ping(seq=42,ts) -> pong 回显 seq', !!pong && pong.seq === 42, JSON.stringify(pong || {}));
  assert('pong 回显客户端 ts=1234.5', !!pong && pong.ts === 1234.5, JSON.stringify(pong && pong.ts));
  A.ws.close();
  await sleep(120);
}

// --- 用例 2+3：完整快捷栏同步 + joinRoom 回放 ---
const HOTBAR = [
  { name: 'wood_pickaxe', count: 1 }, { name: 'torch', count: 16 }, null,
  { name: 'bread', count: 5 }, null, null, null, null, null,
];
{
  console.log('[2] player_full 完整快捷栏同步');
  const A = await connect('栏A');
  send(A, 'create_room', { room: 's10-hotbar', seed: 202, mode: 'survival' });
  await sleep(150);
  const B = await connect('栏B');
  send(B, 'join_room', { room: 's10-hotbar' });
  await sleep(150);
  send(A, 'player_full', { health: 18, food: 20, saturation: 4, mode: 'survival', selected: 1, held: 'torch', hotbar: HOTBAR });
  const bFull = await waitFor(B, (m) => m.t === 'player_full' && m.id === A.id);
  assert('B 收到 player_full 带 hotbar', !!bFull && Array.isArray(bFull.hotbar), JSON.stringify(bFull || {}));
  assert('hotbar 内容一致（9 槽）', !!bFull && bFull.hotbar.length === 9 && bFull.hotbar[0].name === 'wood_pickaxe' && bFull.hotbar[1].count === 16 && bFull.hotbar[2] === null, JSON.stringify(bFull && bFull.hotbar));

  // 用例 3：新玩家 C 加入 → joinRoom 回放 PLAYER_JOIN 携带 selected/held/hotbar
  const C = await connect('栏C');
  send(C, 'join_room', { room: 's10-hotbar' });
  const cJoin = await waitFor(C, (m) => m.t === 'player_join' && m.id === A.id);
  assert('C 加入收到 A 的 player_join 带 selected', !!cJoin && cJoin.selected === 1, JSON.stringify(cJoin || {}));
  assert('player_join 带 held=torch', !!cJoin && cJoin.held === 'torch', JSON.stringify(cJoin && cJoin.held));
  assert('player_join 带完整 hotbar', !!cJoin && Array.isArray(cJoin.hotbar) && cJoin.hotbar[3].name === 'bread', JSON.stringify(cJoin && cJoin.hotbar));
  // 脏 hotbar 整体丢弃：非法上报不改变服务器状态（保留上一次合法快捷栏）
  send(A, 'player_full', { health: 18, food: 20, saturation: 4, mode: 'survival', selected: 0, held: 'wood_pickaxe', hotbar: [{ name: '', count: 1 }] });
  await sleep(150);
  const bDirty = B.inbox.filter((m) => m.t === 'player_full' && m.id === A.id).pop();
  assert('脏 hotbar（空名）被丢弃，服务器保留旧合法值', !!bDirty && Array.isArray(bDirty.hotbar) && bDirty.hotbar[3] && bDirty.hotbar[3].name === 'bread', JSON.stringify(bDirty && bDirty.hotbar));
  A.ws.close(); B.ws.close(); C.ws.close();
  await sleep(120);
}

// --- 用例 4+5+6：死亡掉落归属锁 ---
{
  console.log('[4] 死亡掉落归属锁');
  const A = await connect('亡A');
  send(A, 'create_room', { room: 's10-owner', seed: 303, mode: 'survival' });
  await sleep(150);
  const B = await connect('亡B');
  send(B, 'join_room', { room: 's10-owner' });
  await sleep(150);

  const boxData = new Array(27).fill(null);
  boxData[0] = { name: 'diamond', count: 3 };
  boxData[13] = { name: 'bread', count: 4 };
  boxData[26] = { name: 'iron_ingot', count: 7 };
  send(A, 'player_died', { x: 5, y: 65, z: 5,
    drops: [{ name: 'diamond', count: 2 }, { name: 'shulker_box', count: 1, data: boxData }] });
  const bSpawn = await waitFor(B, (m) => m.t === 'drop_spawn' && m.name === 'diamond');
  assert('B 收到死亡掉落 drop_spawn', !!bSpawn, JSON.stringify(bSpawn || {}));
  assert('drop_spawn 带 owner=A.id', !!bSpawn && bSpawn.owner === A.id, JSON.stringify(bSpawn && bSpawn.owner));
  assert('drop_spawn 带 ownerLock>0', !!bSpawn && typeof bSpawn.ownerLock === 'number' && bSpawn.ownerLock > 0, JSON.stringify(bSpawn && bSpawn.ownerLock));

  // B（非 owner）在锁定期内拾取 → 拒绝 + 补发实体；不广播 drop_taken
  send(B, 'drop_taken', { id: bSpawn.id });
  const bDeny = await waitFor(B, (m) => m.t === 'drop_deny' && m.id === bSpawn.id);
  assert('B 拾取被拒（drop_deny 带 owner）', !!bDeny && bDeny.owner === A.id, JSON.stringify(bDeny || {}));
  const bRespawn = await waitFor(B, (m) => m.t === 'drop_spawn' && m.id === bSpawn.id && m !== bSpawn);
  assert('拒绝时补发 drop_spawn 供客户端重建实体', !!bRespawn && bRespawn.ownerLock > 0, JSON.stringify(bRespawn || {}));
  const bTaken = await waitFor(B, (m) => m.t === 'drop_taken' && m.id === bSpawn.id, 600);
  assert('锁定期内不广播 drop_taken', !bTaken, JSON.stringify(bTaken || {}));

  // owner 本人拾取 → 成功
  send(A, 'drop_taken', { id: bSpawn.id });
  const aTaken = await waitFor(A, (m) => m.t === 'drop_taken' && m.id === bSpawn.id);
  assert('owner 本人拾取成功（drop_taken 广播）', !!aTaken && aTaken.by === A.id, JSON.stringify(aTaken || {}));

  const boxSpawn = await waitFor(B, (m) => m.t === 'drop_spawn' && m.name === 'shulker_box');
  assert('死亡潜影盒实时掉落保留稀疏 27 槽数据',
    !!boxSpawn && JSON.stringify(boxSpawn.data) === JSON.stringify(boxData));
  send(B, 'drop_taken', { id: boxSpawn.id });
  const boxDeny = await waitFor(B, (m) => m.t === 'drop_deny' && m.id === boxSpawn.id);
  const boxResend = await waitFor(B, (m) => m.t === 'drop_spawn' && m.id === boxSpawn.id && m !== boxSpawn);
  assert('归属锁拒绝后补发潜影盒内容、维度与剩余锁时长',
    !!boxDeny && !!boxResend && JSON.stringify(boxResend.data) === JSON.stringify(boxData) &&
    boxResend.d === 'overworld' && boxResend.ownerLock > 0);
  send(A, 'drop_taken', { id: boxSpawn.id });
  const boxTaken = await waitFor(A, (m) => m.t === 'drop_taken' && m.id === boxSpawn.id);
  const boxTakenB = await waitFor(B, (m) => m.t === 'drop_taken' && m.id === boxSpawn.id);
  assert('主人合法拾取潜影盒只广播一次', !!boxTaken && !!boxTakenB &&
    B.inbox.filter((m) => m.t === 'drop_taken' && m.id === boxSpawn.id).length === 1);

  // 用例 5：普通挖矿掉落（无 owner）先到先得
  send(A, 'drop_spawn', { x: 1.5, y: 65, z: 1.5, name: 'stone', count: 1 });
  const nSpawn = await waitFor(B, (m) => m.t === 'drop_spawn' && m.name === 'stone');
  assert('普通掉落无归属锁', !!nSpawn && nSpawn.owner === undefined, JSON.stringify(nSpawn || {}));
  send(B, 'drop_taken', { id: nSpawn.id });
  const nTaken = await waitFor(B, (m) => m.t === 'drop_taken' && m.id === nSpawn.id);
  assert('普通掉落他人立即可拾取', !!nTaken && nTaken.by === B.id, JSON.stringify(nTaken || {}));

  // 用例 6：对已不存在的掉落物发 drop_taken → deny（防同时拾取复制）
  send(B, 'drop_taken', { id: nSpawn.id });
  const bDeny2 = await waitFor(B, (m) => m.t === 'drop_deny' && m.id === nSpawn.id);
  assert('已移除的掉落物拾取 -> deny 回滚信号', !!bDeny2, JSON.stringify(bDeny2 || {}));
  A.ws.close(); B.ws.close();
  await sleep(120);
}

// --- 用例 7：管理多账号 / token 轮换 / 撤销 / 兼容旧 adminToken ---
{
  console.log('[7] 管理多账号与 token 轮换');
  // 起始态：鉴权关闭（clean config）
  const s0 = await api('/status');
  assert('初始鉴权关闭（无 token 可访问）', s0.status === 200, `status=${s0.status}`);

  // 生成账号 op1（鉴权自动开启）
  const mk1 = await api('/tokens', 'POST', { label: 'op1' });
  assert('生成账号 op1 返回明文 token', mk1.status === 200 && typeof mk1.json.token === 'string' && mk1.json.token.length >= 20, JSON.stringify(mk1.json || {}));
  const t1 = mk1.json.token;
  const noAuth = await api('/status');
  assert('有账号后无口令访问 -> 401', noAuth.status === 401, `status=${noAuth.status}`);
  const ok1 = await api('/status', 'GET', undefined, t1);
  assert('op1 token 可访问 -> 200', ok1.status === 200, `status=${ok1.status}`);

  // 第二账号 op2（多账号共存 + 过期分钟）
  const mk2 = await api('/tokens', 'POST', { label: 'op2', expiresMinutes: 10 }, t1);
  assert('生成账号 op2（10 分钟过期）', mk2.status === 200 && mk2.json.expires > Math.floor(Date.now() / 1000), JSON.stringify(mk2.json || {}));
  const ok2 = await api('/status', 'GET', undefined, mk2.json.token);
  assert('op2 token 亦可访问（多账号并存）', ok2.status === 200, `status=${ok2.status}`);

  // 列表掩码
  const st = await api('/status', 'GET', undefined, t1);
  const accs = st.json.config.adminAccounts || [];
  assert('账号列表含 2 项且 token 掩码', accs.length === 2 && accs.every((a) => a.token === '****' && typeof a.id === 'string' && a.id.length === 8), JSON.stringify(accs));
  assert('default 兼容字段 adminToken 掩码为空（无 default 账号）', st.json.config.adminToken === '', JSON.stringify(st.json.config.adminToken));

  // 轮换 op1：旧失效、新可用、op2 不受影响
  const rot = await api('/tokens/rotate', 'POST', { id: accs.find((a) => a.label === 'op1').id }, t1);
  assert('轮换 op1 返回新明文 token', rot.status === 200 && typeof rot.json.token === 'string' && rot.json.token !== t1, JSON.stringify(rot.json || {}));
  const oldStat = await api('/status', 'GET', undefined, t1);
  assert('轮换后旧 token -> 401', oldStat.status === 401, `status=${oldStat.status}`);
  const t1b = rot.json.token;
  const newStat = await api('/status', 'GET', undefined, t1b);
  assert('轮换后新 token -> 200', newStat.status === 200, `status=${newStat.status}`);
  const op2Stat = await api('/status', 'GET', undefined, mk2.json.token);
  assert('轮换 op1 不影响 op2', op2Stat.status === 200, `status=${op2Stat.status}`);

  // 撤销 op2 → 401；撤销 op1 → 鉴权关闭
  // 注意：id = token 哈希，rotate 后 op1 的 id 已变 → 轮换后重新拉取列表
  const accs2 = (await api('/status', 'GET', undefined, t1b)).json.config.adminAccounts || [];
  const rv2 = await api('/tokens/revoke', 'POST', { id: accs2.find((a) => a.label === 'op2').id }, t1b);
  assert('撤销 op2 成功', rv2.status === 200 && rv2.json.remaining === 1, JSON.stringify(rv2.json || {}));
  const op2After = await api('/status', 'GET', undefined, mk2.json.token);
  assert('撤销后 op2 -> 401', op2After.status === 401, `status=${op2After.status}`);
  const rv1 = await api('/tokens/revoke', 'POST', { id: accs2.find((a) => a.label === 'op1').id }, t1b);
  assert('撤销 op1 成功（剩余 0）', rv1.status === 200 && rv1.json.remaining === 0, JSON.stringify(rv1.json || {}));
  const afterAll = await api('/status');
  assert('全部撤销后鉴权自动关闭', afterAll.status === 200, `status=${afterAll.status}`);

  // 兼容旧接口：adminToken <-> default 账号
  const legacySet = await api('/config', 'POST', { adminToken: 'legacy' });
  assert('旧接口设置 adminToken 成功（掩码 ****）', legacySet.status === 200 && legacySet.json.config.adminToken === '****', JSON.stringify(legacySet.json && legacySet.json.config));
  const legacyOk = await api('/status', 'GET', undefined, 'legacy');
  assert('legacy 口令可访问（default 账号生效）', legacyOk.status === 200, `status=${legacyOk.status}`);
  const legacyList = (legacyOk.json && legacyOk.json.config && legacyOk.json.config.adminAccounts) || [];
  assert('default 账号出现在列表', legacyList.length === 1 && legacyList[0].label === 'default', JSON.stringify(legacyList));
  const legacyClear = await api('/config', 'POST', { adminToken: '' }, 'legacy');
  assert('旧接口清空 adminToken 关闭鉴权', legacyClear.status === 200 && legacyClear.json.config.adminToken === '' && (legacyClear.json.config.adminAccounts || []).length === 0, JSON.stringify(legacyClear.json && legacyClear.json.config));
  const afterClear = await api('/status');
  assert('清空后鉴权关闭', afterClear.status === 200, `status=${afterClear.status}`);
}

// --- 用例 8：踢出原因 ---
{
  console.log('[8] 踢出原因透传');
  const A = await connect('踢A');
  send(A, 'create_room', { room: 's10-kick', seed: 404, mode: 'survival' });
  await sleep(150);
  const kr = await api('/kick', 'POST', { playerId: A.id, reason: '违规建筑' });
  assert('kick API 带原因成功', kr.status === 200, JSON.stringify(kr.json || {}));
  const kicked = await waitFor(A, (m) => m.t === 'kicked');
  assert('客户端收到 kicked 且原因一致', !!kicked && kicked.reason === '违规建筑', JSON.stringify(kicked || {}));
  A.ws.close();
  await sleep(120);
}

const { total, passed } = counts();
console.log(`\n阶段 10 回归：${passed}/${total} 通过`);
finish();
