// test-industry.mjs -- Build 51 R3 潮工（工业）服务器权威回归
// 覆盖：① 未启用工业的世界拒绝工业方块写入（回滚）
//       ② 放锅炉/轴/碎石机的方块账本 + 投料/取物动作的权威回执
//       ③ 服务器 tick 真的产生产物（客户端不推进，这里只看服务器回执）
//       ④ 两人同时取物不复制（一份产物只能被取走一次）
//       ⑤ 拆机器 → 方块消失 + 剩余内容散落
//       ⑥ 落盘快照携带工业账本，重启恢复后一致
// 用法：node server/test-industry.mjs（先启动 server/index.mjs，端口 3001）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { Room } from './room.js';
import * as store from './store.js';
import { assert, finish, counts, configure } from './test-lib.mjs';

configure({ style: 'spaced' });

const WS_URL = 'ws://127.0.0.1:3001/ws';
const STAMP = Date.now().toString(36);
const ROOM_ON = `ind-on-${STAMP}`;
const ROOM_OFF = `ind-off-${STAMP}`;
const BOTH = { schema: 1, ids: ['industry', 'magic'] };

// 方块 id（与 BlockDefs 注册顺序一致，tests/industry-unit.mjs 有钉值断言）
const ID = { boiler: 224, shaft: 225, crusher: 226, air: 0 };
const BX = 8, BY = 70, BZ = 8; // 测试用坐标（远离出生点即可）

const CONNS = [];
function connect(name, caps = BOTH) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const p = { ws, id: null, name, inbox: [], waiters: [], kicked: null };
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      p.inbox.push(m);
      if (m.t === 'kicked') p.kicked = m.reason || '被拒绝';
      for (let i = p.waiters.length - 1; i >= 0; i--) {
        if (p.waiters[i](m)) p.waiters.splice(i, 1);
      }
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, version: PROTOCOL_VERSION, extras: caps })));
    ws.on('message', function h(raw) {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome') { ws.off('message', h); p.id = m.selfId; CONNS.push(p); resolve(p); }
    });
    ws.on('error', reject);
  });
}

const send = (p, t, d = {}) => p.ws.send(JSON.stringify({ t, ...d }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(p, pred, timeout = 3000) {
  return new Promise((resolve) => {
    const hit = p.inbox.find(pred);
    if (hit) return resolve(hit);
    const timer = setTimeout(() => resolve(null), timeout);
    p.waiters.push((m) => { if (pred(m)) { clearTimeout(timer); resolve(m); return true; } return false; });
  });
}

// 等一条带 res 的工业回执（只发给动作发起者）；先清空收件箱，避免匹配到上一条回执
const waitRes = (p, timeout = 3000) => {
  p.waiters.length = 0;
  p.inbox.length = 0;
  return waitFor(p, (m) => m.t === 'industry_state' && !!m.res, timeout);
};

async function act(p, x, y, z, op, name = null, count = 1) {
  p.inbox.length = 0;
  send(p, 'industry_action', { x, y, z, op, name, count });
  return waitRes(p);
}

function place(p, x, y, z, id) { send(p, 'block_set', { x, y, z, id }); }
const key = (x, y, z) => `${x},${y},${z}`;

// ══════════════════════════════════════════════════════════════════════════
// ① 未启用工业的房间：拒绝工业方块写入（回滚为空气）
// ══════════════════════════════════════════════════════════════════════════
{
  const p = await connect(`off-${STAMP}`);
  send(p, 'create_room', { room: ROOM_OFF, seed: 111, mode: 'creative', extraContent: { schema: 1 } });
  const wi = await waitFor(p, (m) => m.t === 'world_info');
  assert('双关房间创建成功', !!wi && !!wi.extraContent && wi.extraContent.industry === false);
  p.inbox.length = 0;
  place(p, BX, BY, BZ, ID.boiler);
  const rollback = await waitFor(p, (m) => m.t === 'block_change' && m.x === BX && m.y === BY && m.z === BZ);
  assert('未启用工业：方块写入被拒绝并回滚', !!rollback && rollback.id === 0);
  // 动作也无效（账本里没有这台机器）
  const res = await act(p, BX, BY, BZ, 'insert', 'coal', 1);
  assert('未启用工业：机器动作被忽略（无回执）', !res);
  try { p.ws.close(); } catch {}
}

// ══════════════════════════════════════════════════════════════════════════
// ②/③ 启用工业：放机器 → 投料 → 服务器 tick 产生产物
// ══════════════════════════════════════════════════════════════════════════
const host = await connect(`host-${STAMP}`);
{
  send(host, 'create_room', { room: ROOM_ON, seed: 222, mode: 'creative', extraContent: { schema: 1, industry: true } });
  const wi = await waitFor(host, (m) => m.t === 'world_info');
  assert('启用工业的房间创建成功', !!wi && wi.extraContent.industry === true);

  place(host, BX, BY, BZ, ID.boiler);          // 锅炉
  place(host, BX + 1, BY, BZ, ID.shaft);       // 轴
  place(host, BX + 2, BY, BZ, ID.crusher);     // 碎石机
  await sleep(300);

  // 投燃料 + 水 + 圆石
  const r1 = await act(host, BX, BY, BZ, 'insert', 'coal', 2);
  assert('投燃料回执 inserted', !!r1 && r1.res.code === 'inserted' && r1.res.applied === 2);
  assert('锅炉状态含燃料', !!r1 && r1.state.fuel && r1.state.fuel.name === 'coal' && r1.state.fuel.count === 2);
  const r2 = await act(host, BX, BY, BZ, 'insert', 'water_bucket', 2);
  assert('投桶装水回执 inserted', !!r2 && r2.res.code === 'inserted');
  const r3 = await act(host, BX + 2, BY, BZ, 'insert', 'cobblestone', 4);
  assert('碎石机收圆石', !!r3 && r3.res.code === 'inserted' && r3.state.input.count === 4);
  const bad = await act(host, BX + 2, BY, BZ, 'insert', 'diamond', 1);
  assert('碎石机拒收不可加工物品', !!bad && bad.res.code === 'invalid');

  // 服务器 tick 推进锅炉（点火需要至少一个 tick）
  await sleep(1200);
  const afterBurn = await act(host, BX, BY, BZ, 'extract', null, 1);
  assert('锅炉点火后产出空桶（服务器权威）', !!afterBurn && afterBurn.res.code === 'extracted'
    && afterBurn.res.items[0].name === 'bucket');
  assert('水桶已被消耗（1 个）', !afterBurn.state.water || afterBurn.state.water.count === 1);

  // 等满效率碾完一个圆石（4 秒）
  await sleep(4500);
  const take = await act(host, BX + 2, BY, BZ, 'extract', null, 1);
  assert('碎石机产出了砾石', !!take && take.res.code === 'extracted' && take.res.items[0].name === 'gravel');
  await sleep(4500); // 下一个 4 秒周期
  const take2 = await act(host, BX + 2, BY, BZ, 'extract', null, 1);
  assert('第二块砾石也已产出（服务器持续推进）', !!take2 && take2.res.code === 'extracted');
}

// ══════════════════════════════════════════════════════════════════════════
// ④ 两人同时取物不复制
// ══════════════════════════════════════════════════════════════════════════
{
  // 重放一台全新的碎石机（清空槽位与进度），保证"恰好一份产物"的确定性场景
  place(host, BX + 2, BY, BZ, ID.air);
  await sleep(200);
  place(host, BX + 2, BY, BZ, ID.crusher);
  await sleep(300);
  const guest = await connect(`guest-${STAMP}`);
  send(guest, 'join_room', { room: ROOM_ON });
  const wi = await waitFor(guest, (m) => m.t === 'world_info');
  assert('第二人加入启用工业的房间', !!wi && wi.extraContent.industry === true);
  // 只喂一个圆石 → 5 秒后正好 1 份砾石
  await act(host, BX + 2, BY, BZ, 'insert', 'cobblestone', 1);
  await sleep(5000);
  guest.inbox.length = 0;
  send(guest, 'industry_action', { x: BX + 2, y: BY, z: BZ, op: 'extract', count: 1 });
  const g1 = await waitRes(guest);
  send(host, 'industry_action', { x: BX + 2, y: BY, z: BZ, op: 'extract', count: 64 });
  const h1 = await waitRes(host);
  const grabbed = (g1 && g1.res.ok ? g1.res.applied : 0) + (h1 && h1.res.ok ? h1.res.applied : 0);
  assert('两人同抢一份产物：总量恰好 1（不复制）', grabbed === 1, `grabbed=${grabbed}`);
  assert('后到者拿到 empty 回执', !!h1 && (h1.res.code === 'empty' || !h1.res.ok));
  try { guest.ws.close(); } catch {}
}

// ══════════════════════════════════════════════════════════════════════════
// ⑤ 拆机器 → 方块消失 + 剩余内容散落
// ══════════════════════════════════════════════════════════════════════════
{
  host.inbox.length = 0;
  place(host, BX, BY, BZ, ID.air); // 挖掉锅炉
  const drop = await waitFor(host, (m) => m.t === 'drop_spawn', 3000);
  assert('拆锅炉后剩余内容散落', !!drop && (drop.name === 'coal' || drop.name === 'bucket' || drop.name === 'water_bucket'));
  // 账本条目应已删除：再投料不会再起炉
  const orphan = await act(host, BX, BY, BZ, 'insert', 'coal', 1);
  assert('锅炉账本已清（幽灵机器不会复活）', !orphan);
}

// ══════════════════════════════════════════════════════════════════════════
// ⑥ 落盘 / 恢复
// ══════════════════════════════════════════════════════════════════════════
{
  await sleep(600);
  const rooms = store.loadRooms();
  const saved = rooms.find((r) => r.name === ROOM_ON);
  assert('房间世界已落盘', !!saved);
  assert('快照携带工业账本', !!saved && !!saved.dimensionIndustry && Array.isArray(saved.dimensionIndustry.overworld));
  const revived = new Room(ROOM_ON);
  revived.restore(saved);
  const states = revived.dimensionIndustry.get('overworld') || new Map();
  assert('重启恢复后碎石机账本仍在', states.has(key(BX + 2, BY, BZ)),
    [...states.keys()].join('|'));
  assert('重启恢复后锅炉账本已删除（方块也没了）', !states.has(key(BX, BY, BZ)));
  const st = states.get(key(BX + 2, BY, BZ));
  assert('恢复的状态种类正确', !!st && st.kind === 'crusher');
}

// 收尾
for (const p of CONNS) { try { p.ws.close(); } catch {} }
await sleep(150);
const { total, passed } = counts();
console.log('');
console.log(`${passed}/${total} PASS`);
finish();
