// test-extra-matrix.mjs -- Build 56 R3 四组合世界规则矩阵（服务器侧：创建/加入/换房/重建/恢复）
// 对「双关 / 仅工业 / 仅魔法 / 双开」四种清单各跑同一套操作，断言规则在每一步都不走样：
//   ① 创建：world_info 的清单 = 请求的清单
//   ② 加入：能力不足的客户端被拒（缺失内容被点名）；旧客户端只在双关房间放行
//   ③ 联动门控：刻纹压印机只可能在双开房间入账；其余房间写入被回滚
//   ④ 联动法术：风压超载只在双开房间写进账本（其余房间无过载）
//   ⑤ 换房：换到新房间继承当前清单，门的判定跟着新房间走
//   ⑥ 重建：清单保留、种子变化，门的判定不变
//   ⑦ 恢复：离开后重新加入同一房间，清单从落盘恢复（不回落双关）
// 用法：node server/test-extra-matrix.mjs（先启动 server/index.mjs，端口 3001）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { assert, finish, configure } from './test-lib.mjs';

configure({ style: 'spaced' });

const WS_URL = 'ws://127.0.0.1:3001/ws';
const STAMP = Date.now().toString(36);
const CAPS = { schema: 1, ids: ['industry', 'magic'] };
const CAPS_IND = { schema: 1, ids: ['industry'] };
const CAPS_NONE = { schema: 1, ids: [] };

const ID = { air: 0, boiler: 224, shaft: 225, press: 239 };
const BX = 40, BY = 70, BZ = 40;

const COMBOS = [
  { slug: 'none', name: '双关', raw: { schema: 1 }, industry: false, magic: false },
  { slug: 'ind', name: '仅工业', raw: { schema: 1, industry: true }, industry: true, magic: false },
  { slug: 'mag', name: '仅魔法', raw: { schema: 1, magic: true }, industry: false, magic: true },
  { slug: 'both', name: '双开', raw: { schema: 1, industry: true, magic: true }, industry: true, magic: true },
];

const CONNS = [];
function connect(name, caps) {  // caps === undefined = 旧客户端（HELLO 不带 extras）
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const p = { ws, id: null, name, inbox: [], waiters: [], kicked: null };
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      // 服务器心跳：真客户端会自动回 pong；不回会被 terminate（长等待时尤其致命）
      if (m.t === 'ping') { try { ws.send(JSON.stringify({ t: 'pong', seq: m.seq })); } catch {} return; }
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

function waitFor(p, pred, timeout = 3000) {
  return new Promise((resolve) => {
    const hit = p.inbox.find(pred);
    if (hit) return resolve(hit);
    const timer = setTimeout(() => resolve(null), timeout);
    p.waiters.push((m) => { if (pred(m)) { clearTimeout(timer); resolve(m); return true; } return false; });
  });
}

const waitWorldInfo = (p) => waitFor(p, (m) => m.t === 'world_info');
const norm = (m) => (m && typeof m === 'object' ? m : { industry: false, magic: false });

// 写入被接受：自己收不到自己的 block_change（广播排除发起者），没收到回滚就是接受
async function expectAccepted(p, x, y, z, id, timeout = 700) {
  p.inbox.length = 0;
  p.waiters.length = 0;
  send(p, 'block_set', { x, y, z, id });
  const rollback = await waitFor(p, (e) => e.t === 'block_change' && e.x === x && e.y === y && e.z === z, timeout);
  return !rollback;
}
// 写入被拒绝：服务器定向回一条原地块 id
async function expectRollback(p, x, y, z, timeout = 2000) {
  p.inbox.length = 0;
  p.waiters.length = 0;
  send(p, 'block_set', { x, y, z, id: ID.press });
  const m = await waitFor(p, (e) => e.t === 'block_change' && e.x === x && e.y === y && e.z === z, timeout);
  return m && m.id === 0;
}

function openAt(p, x, y, z, timeout = 2000) {
  p.inbox.length = 0;
  p.waiters.length = 0;
  send(p, 'industry_open', { x, y, z });
  return waitFor(p, (m) => m.t === 'industry_state' && m.x === x && m.y === y && m.z === z && !m.res, timeout);
}

// 玩家站到机器旁（服务器按自己手里的玩家位置算距离）
const standNear = (p, x, y, z) => send(p, 'player_state', {
  x, y, z, yaw: 0, pitch: 0, onGround: true, flying: false, inWater: false,
});

// ── 逐组合跑完整矩阵 ────────────────────────────────────────────────────
for (const combo of COMBOS) {
  const tag = `[${combo.name}]`;
  const room = `mx-${combo.slug}-${STAMP}`;
  const room2 = `mx2-${combo.slug}-${STAMP}`;
  const host = await connect(`h-${combo.slug}-${STAMP}`, CAPS);

  // ① 创建
  send(host, 'create_room', { room, seed: 900, mode: 'creative', extraContent: combo.raw });
  const wi = await waitWorldInfo(host);
  const m = norm(wi && wi.extraContent);
  assert(`${tag} 创建：清单与请求一致`,
    !!wi && m.industry === combo.industry && m.magic === combo.magic,
    `got=${JSON.stringify(m)}`);

  // ② 加入：能力协商
  const weak = await connect(`w-${combo.slug}-${STAMP}`, CAPS_IND);
  send(weak, 'join_room', { room });
  if (combo.magic) {
    const kicked = await waitFor(weak, (x) => x.t === 'kicked');
    assert(`${tag} 加入：缺魔法的客户端被拒（点名魔法）`,
      !!kicked && String(kicked.reason).includes('魔法'), kicked && kicked.reason);
  } else {
    const wi2 = await waitWorldInfo(weak);
    assert(`${tag} 加入：缺魔法的客户端可进入`, !!wi2);
  }
  try { weak.ws.close(); } catch {}

  const legacy = await connect(`l-${combo.slug}-${STAMP}`, undefined);
  send(legacy, 'join_room', { room });
  if (combo.industry || combo.magic) {
    const kicked = await waitFor(legacy, (x) => x.t === 'kicked');
    assert(`${tag} 加入：旧客户端（不报能力）被拒`, !!kicked);
  } else {
    const wi3 = await waitWorldInfo(legacy);
    assert(`${tag} 加入：双关房间旧客户端可进入`, !!wi3);
  }
  try { legacy.ws.close(); } catch {}

  // ③ 联动方块门控
  const pressOk = combo.industry && combo.magic;
  if (pressOk) {
    send(host, 'block_set', { x: BX, y: BY, z: BZ, id: ID.boiler });
    send(host, 'block_set', { x: BX + 1, y: BY, z: BZ, id: ID.shaft });
    assert(`${tag} 方块：刻纹压印机可写入`, await expectAccepted(host, BX + 2, BY, BZ, ID.press));
  } else {
    assert(`${tag} 方块：刻纹压印机写入被回滚`, await expectRollback(host, BX + 2, BY, BZ));
  }

  // ④ 联动法术门控：只有双开房间会真的产生过载
  const target = { x: pressOk ? BX + 2 : BX, y: BY, z: BZ };
  standNear(host, target.x + 0.5, target.y, target.z + 2.5);
  await sleep(150);
  send(host, 'magic_cast', {
    spell: 'gale_overload', echo: 60,
    x: target.x + 0.5, y: target.y + 1.62, z: target.z + 2.5,
    dx: 0, dy: -0.2, dz: -1, tx: target.x, ty: target.y, tz: target.z,
  });
  await sleep(600);
  const opened = await openAt(host, target.x, target.y, target.z);
  if (pressOk) {
    assert(`${tag} 法术：双开房间写进过载账本`, !!opened && !!opened.net && !!opened.net.overload);
  } else {
    assert(`${tag} 法术：非双开房间不产生过载`,
      !opened || !opened.net || !opened.net.overload);
  }

  // ⑤ 换房：新房间继承当前清单，门控跟着走
  send(host, 'switch_room', { room: room2 });
  const wiSwitch = await waitFor(host, (x) => x.t === 'world_info' && x.seed !== undefined);
  const sw = norm(wiSwitch && wiSwitch.extraContent);
  assert(`${tag} 换房：新房间继承清单`, !!wiSwitch && sw.industry === combo.industry && sw.magic === combo.magic,
    `got=${JSON.stringify(sw)}`);
  if (pressOk) {
    assert(`${tag} 换房后：压印机仍可写入`, await expectAccepted(host, BX, BY, BZ, ID.press));
  } else {
    assert(`${tag} 换房后：压印机仍被回滚`, await expectRollback(host, BX, BY, BZ));
  }

  // ⑥ 重建：清单保留、种子变化、门控不变
  host.inbox.length = 0;
  host.waiters.length = 0;
  send(host, 'world_reset', {});
  const wiReset = await waitFor(host, (x) => x.t === 'world_info');
  const rs = norm(wiReset && wiReset.extraContent);
  assert(`${tag} 重建：清单保留`, !!wiReset && rs.industry === combo.industry && rs.magic === combo.magic);
  assert(`${tag} 重建：换了种子`, !!wiReset && wiReset.seed !== 900);
  if (pressOk) {
    assert(`${tag} 重建后：压印机仍可写入`, await expectAccepted(host, BX + 2, BY, BZ, ID.press));
  } else {
    assert(`${tag} 重建后：压印机仍被回滚`, await expectRollback(host, BX + 2, BY, BZ));
  }

  // ⑦ 恢复：离开房间后重新加入，清单从落盘恢复
  send(host, 'leave_room', {});
  await sleep(300);
  try { host.ws.close(); } catch {}
  const back = await connect(`b-${combo.slug}-${STAMP}`, CAPS);
  send(back, 'join_room', { room: room2 });
  const wiBack = await waitWorldInfo(back);
  const bk = norm(wiBack && wiBack.extraContent);
  assert(`${tag} 恢复：重新加入后清单不变`, !!wiBack && bk.industry === combo.industry && bk.magic === combo.magic,
    `got=${JSON.stringify(bk)}`);
  if (pressOk) {
    assert(`${tag} 恢复后：压印机仍可写入`, await expectAccepted(back, BX, BY, BZ, ID.press));
  } else {
    assert(`${tag} 恢复后：压印机仍被回滚`, await expectRollback(back, BX, BY, BZ));
  }
  try { back.ws.close(); } catch {}
  await sleep(120);
}

for (const p of CONNS) { try { p.ws.close(); } catch {} }
finish('test-extra-matrix');
