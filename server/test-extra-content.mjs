// test-extra-content.mjs -- Build 51 R2 额外内容世界清单（服务器权威）回归
// 覆盖：① Room 纯模块（快照恢复/旧快照双关/未知 schema 拒绝/快照落盘/能力判定）
//       ② 端到端（首次固定、重复创建不覆盖、加入忽略本地草稿、重建保留、换房继承）
//       ③ 能力协商（旧客户端/能力不足客户端被拒；双关房间旧客户端可进）
//       ④ 隐式创建（加入不存在房间用草稿）与断线恢复到不存在房间被中止
// 用法：node server/test-extra-content.mjs（先启动 server/index.mjs，端口 3001）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { Room } from './room.js';
import * as store from './store.js';
import { assert, finish, counts, configure } from './test-lib.mjs';

configure({ style: 'spaced' });

const WS_URL = 'ws://127.0.0.1:3001/ws';
const STAMP = Date.now().toString(36);
const ROOM_A = `extra-a-${STAMP}`;
const ROOM_B = `extra-b-${STAMP}`;
const ROOM_C = `extra-c-${STAMP}`;

// ── 连接工具（capabilities 可选：模拟旧客户端不传 extras） ──────────────────
function connect(name, caps) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const p = { ws, id: null, name, inbox: [], waiters: [], closed: false, kicked: null };
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
      if (m.t === 'welcome') { ws.off('message', h); p.id = m.selfId; resolve(p); }
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
    const timer = setTimeout(() => resolve(null), timeout);
    p.waiters.push((m) => { if (pred(m)) { clearTimeout(timer); resolve(m); return true; } return false; });
  });
}

const waitWorldInfo = (p) => waitFor(p, (m) => m.t === 'world_info');
const BOTH = { schema: 1, ids: ['industry', 'magic'] };
const LEGACY = undefined;      // 旧客户端：HELLO 不带 extras
const NO_CAPS = { schema: 1, ids: [] }; // 新客户端但一个内容都不支持（模拟落后版本）
const norm = (m) => ({ industry: !!(m && m.industry), magic: !!(m && m.magic) });
const CONNS = []; // 全部已建连接：收尾统一关闭（服务器按 socket 关闭清理玩家）

function track(p) { CONNS.push(p); return p; }

// ══════════════════════════════════════════════════════════════════════════
// ① Room 纯模块
// ══════════════════════════════════════════════════════════════════════════
{
  const capsOf = (ids) => ({ schema: 1, ids: new Set(ids) });

  // 旧快照（无字段）→ 双关
  const old = new Room('pure-old');
  old.restore({ seed: 42, biomeScale: 'small' });
  assert('旧快照无清单字段 → 回落双关', old.extraContent.industry === false && old.extraContent.magic === false);
  assert('旧快照不标记为损坏', old.extraBroken === false);

  // 带清单的快照 → 原样恢复
  const kept = new Room('pure-kept');
  kept.restore({ seed: 7, extraContent: { schema: 1, industry: true, magic: false } });
  assert('快照清单恢复（工业）', kept.extraContent.industry === true && kept.extraContent.magic === false);

  // 未知 schema → 拒绝加入（extraBroken），不静默降级
  const broken = new Room('pure-broken');
  broken.restore({ seed: 9, extraContent: { schema: 2, industry: true, magic: true } });
  assert('未知 schema 快照标记 extraBroken', broken.extraBroken === true);
  assert('未知 schema 快照不启用任何内容', broken.extraContent.industry === false && broken.extraContent.magic === false);

  // 快照序列化携带清单
  const snap = store.roomSnapshot(kept);
  assert('roomSnapshot 携带 extraContent', snap.extraContent && snap.extraContent.industry === true);

  // 能力判定
  const room = new Room('pure-caps');
  room.extraContent = { schema: 1, industry: true, magic: true };
  assert('能力齐备 → 无拒绝项', room.unsupportedExtras({ extraCaps: capsOf(['industry', 'magic']) }).length === 0);
  const partial = room.unsupportedExtras({ extraCaps: capsOf(['industry']) });
  assert('能力不足 → 报告缺魔法', partial.length === 1 && partial[0] === 'magic');
  assert('旧客户端（无能力声明）→ 两个都缺',
    room.unsupportedExtras({}).length === 2);
  room.extraContent = { schema: 1, industry: false, magic: false };
  assert('双关房间旧客户端可进', room.unsupportedExtras({}).length === 0);
}

// ══════════════════════════════════════════════════════════════════════════
// ② 端到端：首次固定 / 不覆盖 / 忽略草稿 / 重建保留 / 换房继承
// ══════════════════════════════════════════════════════════════════════════
const host = track(await connect(`host-${STAMP}`, BOTH));
send(host, 'create_room', {
  room: ROOM_A, seed: 424242, mode: 'creative', biomeScale: 'small',
  extraContent: { schema: 1, industry: true, magic: false },
});
const wi1 = await waitWorldInfo(host);
assert('建房 WORLD_INFO 带清单', !!wi1);
assert('首次开房采用建房者清单（工业）', norm(wi1 && wi1.extraContent).industry === true
  && norm(wi1 && wi1.extraContent).magic === false);

// 另一人重复「创建」同名房间，草稿不同 → 沿用首次清单
const dup = track(await connect(`dup-${STAMP}`, BOTH));
send(dup, 'create_room', { room: ROOM_A, seed: 999, mode: 'survival', extraContent: { schema: 1, industry: false, magic: true } });
const wi2 = await waitWorldInfo(dup);
assert('重复创建不覆盖房间清单', norm(wi2 && wi2.extraContent).industry === true
  && norm(wi2 && wi2.extraContent).magic === false);
assert('重复创建不覆盖种子', wi2 && wi2.seed === 424242);

// 加入已有房间，草稿不同 → 完全忽略
const joiner = track(await connect(`join-${STAMP}`, BOTH));
send(joiner, 'join_room', { room: ROOM_A, extraContent: { schema: 1, industry: false, magic: true } });
const wi3 = await waitWorldInfo(joiner);
assert('加入已有房间忽略本地草稿', norm(wi3 && wi3.extraContent).industry === true
  && norm(wi3 && wi3.extraContent).magic === false);

// 重建世界：地形与账本重置，清单保留
host.inbox.length = 0;
send(host, 'world_reset', {});
const wiReset = await waitFor(host, (m) => m.t === 'world_info' && m.restart === true);
assert('重建世界保留清单', norm(wiReset && wiReset.extraContent).industry === true
  && norm(wiReset && wiReset.extraContent).magic === false);
assert('重建世界换了种子', !!wiReset && wiReset.seed !== 424242);

// 换房到不存在的新房间 → 继承当前房间清单
joiner.inbox.length = 0;
send(joiner, 'chat', { text: `/room ${ROOM_B}` });
const wiSwitch = await waitFor(joiner, (m) => m.t === 'world_info' && m.room === ROOM_B);
assert('换房到新房间继承清单', norm(wiSwitch && wiSwitch.extraContent).industry === true
  && norm(wiSwitch && wiSwitch.extraContent).magic === false);

// ══════════════════════════════════════════════════════════════════════════
// ③ 能力协商：旧客户端 / 能力不足客户端
// ══════════════════════════════════════════════════════════════════════════
{
  const legacy = track(await connect(`legacy-${STAMP}`, LEGACY));
  send(legacy, 'join_room', { room: ROOM_A });
  const kicked = await waitFor(legacy, (m) => m.t === 'kicked');
  assert('旧客户端被拒绝进入启用内容的房间', !!kicked);
  assert('拒绝原因点名缺失内容', !!kicked && String(kicked.reason).includes('工业'));

  const weak = track(await connect(`weak-${STAMP}`, NO_CAPS));
  send(weak, 'join_room', { room: ROOM_A });
  const kicked2 = await waitFor(weak, (m) => m.t === 'kicked');
  assert('能力不足客户端被拒绝', !!kicked2 && String(kicked2.reason).includes('工业'));

  // 双关房间：旧客户端仍可进入（默认体验不变）
  const vanilla = track(await connect(`vanilla-${STAMP}`, BOTH));
  send(vanilla, 'create_room', { room: ROOM_C, seed: 5, mode: 'creative', extraContent: { schema: 1 } });
  await waitWorldInfo(vanilla);
  const legacy2 = track(await connect(`legacy2-${STAMP}`, LEGACY));
  send(legacy2, 'join_room', { room: ROOM_C });
  const wiLegacy = await waitWorldInfo(legacy2);
  assert('双关房间旧客户端可正常加入', !!wiLegacy && norm(wiLegacy.extraContent).industry === false
    && norm(wiLegacy.extraContent).magic === false);
}

// ══════════════════════════════════════════════════════════════════════════
// ④ 隐式创建与断线恢复
// ══════════════════════════════════════════════════════════════════════════
{
  const NEW_ROOM = `extra-new-${STAMP}`;
  const imp = track(await connect(`implicit-${STAMP}`, BOTH));
  send(imp, 'join_room', { room: NEW_ROOM, extraContent: { schema: 1, industry: false, magic: true } });
  const wi = await waitWorldInfo(imp);
  assert('加入不存在房间 → 隐式创建采用草稿', norm(wi && wi.extraContent).magic === true
    && norm(wi && wi.extraContent).industry === false);

  // 断线恢复到不存在的房间：中止恢复（不借恢复包造新规则世界）
  const ghost = track(await connect(`ghost-${STAMP}`, BOTH));
  send(ghost, 'join_room', {
    room: `extra-ghost-${STAMP}`, recoveryId: 'recover-abc', resumeDim: 'overworld',
    resumePos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
    extraContent: { schema: 1, industry: true, magic: true },
  });
  const kickedGhost = await waitFor(ghost, (m) => m.t === 'kicked');
  assert('恢复到不存在的房间被中止', !!kickedGhost && String(kickedGhost.reason).includes('房间世界已不存在'));
}

// ══════════════════════════════════════════════════════════════════════════
// ⑤ 落盘：清单进快照，重启后一致
// ══════════════════════════════════════════════════════════════════════════
{
  await sleep(200); // 让 save() 落盘
  const rooms = store.loadRooms();
  const saved = rooms.find((r) => r.name === ROOM_A);
  assert('房间世界已落盘', !!saved);
  assert('落盘快照携带清单', !!saved && !!saved.extraContent && saved.extraContent.industry === true);
  const revived = new Room(ROOM_A);
  revived.restore(saved);
  assert('重启恢复后清单一致', revived.extraContent.industry === true && revived.extraContent.magic === false);
}

// 收尾：断开全部连接（服务器按 socket 关闭清理玩家与队伍）
for (const p of CONNS) { try { p.ws.close(); } catch {} }

await sleep(100);
const { total, passed } = counts();
console.log('');
console.log(`${passed}/${total} PASS`);
finish();
