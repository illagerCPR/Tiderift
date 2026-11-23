// test-magic.mjs -- Build 51 R4 四潮回响（服务器侧）回归
// 覆盖：① 未启用魔法的世界：仪台写入被拒绝、施法事件被丢弃
//       ② 启用魔法：施法表现只广播给同维其他人（发起者本端已结算）
//       ③ 服务器独立硬约束：冷却内重复施法不转发、起点离本人太远不转发、非法法术/方向不转发
//       ④ 回响随 LAN 玩家档案：上报 42 → 断线重连同昵称恢复
// 用法：node server/test-magic.mjs（先启动 server/index.mjs，端口 3001）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { assert, finish, counts, configure } from './test-lib.mjs';

configure({ style: 'spaced' });

const WS_URL = 'ws://127.0.0.1:3001/ws';
const STAMP = Date.now().toString(36);
const ROOM_OFF = `mag-off-${STAMP}`;
const ROOM_ON = `mag-on-${STAMP}`;
const BOTH = { schema: 1, ids: ['industry', 'magic'] };
const TABLE_ID = 227;
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
    const hello = { t: 'hello', name, version: PROTOCOL_VERSION };
    if (caps !== undefined) hello.extras = caps;
    ws.on('open', () => ws.send(JSON.stringify(hello)));
    ws.on('message', function h(raw) {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome') { ws.off('message', h); p.id = m.selfId; CONNS.push(p); resolve(p); }
    });
    ws.on('error', reject);
  });
}

const send = (p, t, d = {}) => p.ws.send(JSON.stringify({ t, ...d }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(p, pred, timeout = 1200) {
  return new Promise((resolve) => {
    const hit = p.inbox.find(pred);
    if (hit) return resolve(hit);
    const timer = setTimeout(() => resolve(null), timeout);
    p.waiters.push((m) => { if (pred(m)) { clearTimeout(timer); resolve(m); return true; } return false; });
  });
}

const BX = 6, BY = 70, BZ = 6;

// ══════════════════════════════════════════════════════════════════════════
// ① 关闭魔法的房间
// ══════════════════════════════════════════════════════════════════════════
{
  const host = await connect(`off-host-${STAMP}`);
  const guest = await connect(`off-guest-${STAMP}`);
  send(host, 'create_room', { room: ROOM_OFF, seed: 11, mode: 'creative', extraContent: { schema: 1 } });
  await waitFor(host, (m) => m.t === 'world_info');
  send(guest, 'join_room', { room: ROOM_OFF });
  await waitFor(guest, (m) => m.t === 'world_info');

  host.inbox.length = 0;
  send(host, 'block_set', { x: BX, y: BY, z: BZ, id: TABLE_ID });
  const rollback = await waitFor(host, (m) => m.t === 'block_change' && m.x === BX && m.y === BY && m.z === BZ);
  assert('关闭魔法：仪台写入被拒绝并回滚', !!rollback && rollback.id === 0);

  guest.inbox.length = 0;
  send(host, 'magic_cast', { spell: 'ember_bolt', echo: 50, x: 0, y: 70, z: 0, dx: 0, dy: 0, dz: -1 });
  const leaked = await waitFor(guest, (m) => m.t === 'magic_effect', 600);
  assert('关闭魔法：施法事件被丢弃（不外泄表现）', !leaked);
  try { host.ws.close(); guest.ws.close(); } catch {}
  await sleep(200);
}

// ══════════════════════════════════════════════════════════════════════════
// ②/③ 启用魔法：广播、冷却、位置、形状
// ══════════════════════════════════════════════════════════════════════════
{
  const nameA = `caster-${STAMP}`;
  const caster = await connect(nameA);
  const watcher = await connect(`watch-${STAMP}`);
  send(caster, 'create_room', { room: ROOM_ON, seed: 22, mode: 'survival', extraContent: { schema: 1, magic: true } });
  const wi = await waitFor(caster, (m) => m.t === 'world_info');
  assert('启用魔法的房间创建成功', !!wi && wi.extraContent.magic === true);
  send(watcher, 'join_room', { room: ROOM_ON });
  await waitFor(watcher, (m) => m.t === 'world_info');

  // 定位：服务器用 player_state 记录的位置做形状校验
  send(caster, 'player_state', { x: 0, y: 70, z: 0, yaw: 0, pitch: 0, mode: 'survival' });
  await sleep(200);

  watcher.inbox.length = 0;
  send(caster, 'magic_cast', { spell: 'ember_bolt', echo: 50, x: 0, y: 70, z: 0, dx: 0, dy: 0, dz: -2 });
  const eff = await waitFor(watcher, (m) => m.t === 'magic_effect');
  assert('施法表现广播给同维其他人', !!eff && eff.spell === 'ember_bolt');
  assert('方向被服务器归一化', !!eff && Math.abs(eff.dz + 1) < 1e-9 && Math.abs(eff.dx) < 1e-9);
  assert('事件带发起者 id', !!eff && eff.by === caster.id);

  // 冷却内重复施法：服务器独立记账，不转发
  watcher.inbox.length = 0;
  send(caster, 'magic_cast', { spell: 'ember_bolt', echo: 50, x: 0, y: 70, z: 0, dx: 0, dy: 0, dz: -1 });
  const dup = await waitFor(watcher, (m) => m.t === 'magic_effect', 600);
  assert('冷却内重复施法被服务器丢弃', !dup);

  // 换一种法术不受另一法术冷却影响
  send(caster, 'magic_cast', { spell: 'gale_step', echo: 50, x: 0, y: 70, z: 0, dx: 0, dy: 0, dz: -1 });
  const gale = await waitFor(watcher, (m) => m.t === 'magic_effect' && m.spell === 'gale_step');
  assert('不同法术各有独立冷却', !!gale);

  // 位置形状：起点离本人太远 → 不转发
  await sleep(1300);
  watcher.inbox.length = 0;
  send(caster, 'magic_cast', { spell: 'ember_bolt', echo: 50, x: 500, y: 70, z: 0, dx: 0, dy: 0, dz: -1 });
  const far = await waitFor(watcher, (m) => m.t === 'magic_effect', 600);
  assert('起点离玩家过远的表现被拒绝', !far);

  // 非法法术 / 零方向
  watcher.inbox.length = 0;
  send(caster, 'magic_cast', { spell: 'nope', echo: 50, x: 0, y: 70, z: 0, dx: 0, dy: 0, dz: -1 });
  send(caster, 'magic_cast', { spell: 'ember_bolt', echo: 50, x: 0, y: 70, z: 0, dx: 0, dy: 0, dz: 0 });
  const bad = await waitFor(watcher, (m) => m.t === 'magic_effect', 600);
  assert('非法法术/零方向都被拒绝', !bad);

  // ④ 回响随玩家档案
  send(caster, 'profile_save', { profile: {
    inventory: { slots: new Array(36).fill(null), armor: new Array(4).fill(null) },
    position: { x: 0, y: 70, z: 0 }, dim: 'overworld',
    health: 20, food: 20, saturation: 5, xp: 0, xpLevel: 0, echo: 42,
  } });
  await sleep(300);
  try { caster.ws.close(); } catch {}
  try { watcher.ws.close(); } catch {}
  await sleep(400);

  // 同昵称重连 → 服务器下发 PLAYER_PROFILE（emca 42）
  const back = await connect(nameA);
  back.inbox.length = 0;
  send(back, 'join_room', { room: ROOM_ON });
  await waitFor(back, (m) => m.t === 'world_info');
  const prof = await waitFor(back, (m) => m.t === 'player_profile');
  assert('回响随档案恢复（重连同昵称）', !!prof && prof.profile.echo === 42);
  try { back.ws.close(); } catch {}
}

// 收尾
for (const p of CONNS) { try { p.ws.close(); } catch {} }
await sleep(150);
const { total, passed } = counts();
console.log('');
console.log(`${passed}/${total} PASS`);
finish();
