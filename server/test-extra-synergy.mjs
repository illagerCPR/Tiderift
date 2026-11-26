// test-extra-synergy.mjs -- Build 56 R1 双开联动：刻纹压印机的服务器权威回归（需先起 server/index.mjs，端口 3001）
// 覆盖：
//   ① 仅工业房间 / 仅魔法房间 / 双关房间：写入刻纹压印机一律回滚（联动只在双开出现）
//   ② 双开房间：压印机进工业账本（INDUSTRY_OPEN 拿得到权威状态与网络摘要）
//   ③ 投料路由：回响残片自动进 shard 槽、基础焦点进 input 槽、其它一律 invalid
//   ④ 服务器 tick 真的压出进阶焦点（客户端不推进），焦点与残片各 -1（1:1，不复制）
//   ⑤ 半份料不推进：只有焦点没残片时服务器不产出、也不报错
//   ⑥ 两人同抢一份产物只成功一次（服务器权威，不复制）
//   ⑦ 风压超载（B56 R2）：单开房间直接丢弃；双开房间写入服务器账本、广播表现与权威摘要；
//      同一条轴不给第二个人再叠一次（不累积）；够不着/轴不是目标一律拒。
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { INDUSTRY_ID_INFO, industryAllowedIn } from './industry.js';
import { assert, finish, configure } from './test-lib.mjs';

configure({ style: 'spaced' });

const WS_URL = 'ws://127.0.0.1:3001/ws';
const STAMP = Date.now().toString(36);
const ROOM_IND = `syn-ind-${STAMP}`;
const ROOM_MAG = `syn-mag-${STAMP}`;
const ROOM_BOTH = `syn-both-${STAMP}`;
const CAPS = { schema: 1, ids: ['industry', 'magic'] };

// 方块 id（与 BlockDefs 注册顺序一致；tests/extra-synergy-unit.mjs 有钉值断言）
const ID = { air: 0, boiler: 224, shaft: 225, press: 239 };
const BX = 24, BY = 70, BZ = 24; // 与其它套件错开的坐标

const CONNS = [];
function connect(name, caps = CAPS) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const p = { ws, id: null, name, inbox: [], waiters: [], kicked: null };
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      // 服务器心跳：真客户端会自动回 pong，这里同款（否则长等待会被 terminate）
      if (m.t === 'ping') { try { ws.send(JSON.stringify({ t: 'pong', seq: m.seq })); } catch {} return; }
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

const place = (p, x, y, z, id) => send(p, 'block_set', { x, y, z, id });

// 工业动作回执：清收件箱后等一条带 res 的 industry_state（只发给发起者）
function act(p, x, y, z, op, name = null, count = 1, slot = null, timeout = 3000) {
  p.inbox.length = 0;
  p.waiters.length = 0;
  send(p, 'industry_action', { x, y, z, op, name, count, ...(slot ? { slot } : {}) });
  return waitFor(p, (m) => m.t === 'industry_state' && !!m.res, timeout);
}

function openAt(p, x, y, z, timeout = 2500) {
  p.inbox.length = 0;
  p.waiters.length = 0;
  send(p, 'industry_open', { x, y, z });
  return waitFor(p, (m) => m.t === 'industry_state' && m.x === x && m.y === y && m.z === z && !m.res, timeout);
}

// 写入被接受：自己不发自己的 block_change（广播排除发起者），所以「没收到回滚」就是被接受
async function expectAccepted(p, x, y, z, id, timeout = 600) {
  p.inbox.length = 0;
  p.waiters.length = 0;
  place(p, x, y, z, id);
  const rollback = await waitFor(p, (e) => e.t === 'block_change' && e.x === x && e.y === y && e.z === z, timeout);
  return !rollback;
}

// 等方块写入的回滚（服务器拒绝 → 广播回原地块 id）
async function expectRollback(p, x, y, z, wantId = 0, timeout = 3000) {
  p.inbox.length = 0;
  p.waiters.length = 0;
  place(p, x, y, z, ID.press);
  const m = await waitFor(p, (e) => e.t === 'block_change' && e.x === x && e.y === y && e.z === z, timeout);
  return m && m.id === wantId;
}

// ══════════════════════════════════════════════════════════════════════════
// ① 单开 / 双关房间拒绝写入联动方块
// ══════════════════════════════════════════════════════════════════════════
{
  assert('服务端 id 表：239 → press', INDUSTRY_ID_INFO.get(239) === 'press');
  assert('双开允许写入压印机', industryAllowedIn(239, { schema: 1, industry: true, magic: true }));
  assert('仅工业拒绝写入压印机', !industryAllowedIn(239, { schema: 1, industry: true, magic: false }));

  const p = await connect(`only-industry-${STAMP}`);
  send(p, 'create_room', { room: ROOM_IND, seed: 511, mode: 'creative', extraContent: { schema: 1, industry: true } });
  const wi = await waitFor(p, (m) => m.t === 'world_info');
  assert('仅工业房间创建成功', !!wi && wi.extraContent.industry === true && wi.extraContent.magic === false);
  assert('仅工业：写入刻纹压印机被回滚为空气', await expectRollback(p, BX, BY, BZ, 0));
  // 对照：同一格的普通潮工方块照常允许
  assert('仅工业：潮压锅炉照常允许写入', await expectAccepted(p, BX, BY, BZ, ID.boiler));
  try { p.ws.close(); } catch {}
}
{
  const p = await connect(`only-magic-${STAMP}`);
  send(p, 'create_room', { room: ROOM_MAG, seed: 512, mode: 'creative', extraContent: { schema: 1, magic: true } });
  const wi = await waitFor(p, (m) => m.t === 'world_info');
  assert('仅魔法房间创建成功', !!wi && wi.extraContent.magic === true && wi.extraContent.industry === false);
  assert('仅魔法：写入刻纹压印机被回滚为空气', await expectRollback(p, BX, BY + 2, BZ, 0));
  try { p.ws.close(); } catch {}
}

// ══════════════════════════════════════════════════════════════════════════
// ②～⑥ 双开房间：完整链路
// ══════════════════════════════════════════════════════════════════════════
const host = await connect(`host-${STAMP}`);
{
  send(host, 'create_room', { room: ROOM_BOTH, seed: 513, mode: 'creative', extraContent: { schema: 1, industry: true, magic: true } });
  const wi = await waitFor(host, (m) => m.t === 'world_info');
  assert('双开房间创建成功', !!wi && wi.extraContent.industry === true && wi.extraContent.magic === true);

  // 锅炉 → 轴 → 压印机（自己收不到自己的 block_change：没回滚 = 写入被接受）
  place(host, BX, BY, BZ, ID.boiler);
  place(host, BX + 1, BY, BZ, ID.shaft);
  assert('双开：刻纹压印机写入成功（不回落）', await expectAccepted(host, BX + 2, BY, BZ, ID.press));
  await sleep(300);
  assert('双开：压印机确实进了工业方块账本',
    !!(await openAt(host, BX + 2, BY, BZ))?.state);

  // ② 工业账本认识这台机器（INDUSTRY_OPEN 定向回权威状态 + 网络摘要）
  const opened = await openAt(host, BX + 2, BY, BZ);
  assert('压印机在工业账本里（INDUSTRY_OPEN 有回包）', !!opened && !!opened.state && opened.state.kind === 'press');
  assert('机器界面能拿到网络摘要', !!opened && !!opened.net && opened.net.nodes >= 3);

  // ③ 投料路由
  const rShard = await act(host, BX + 2, BY, BZ, 'insert', 'echo_shard', 2);
  assert('残片进 shard 槽（自动路由）', !!rShard && rShard.res.code === 'inserted'
    && !!rShard.state.shard && rShard.state.shard.name === 'echo_shard' && rShard.state.shard.count === 2);
  const rFocus = await act(host, BX + 2, BY, BZ, 'insert', 'gale_focus', 2);
  assert('基础焦点进 input 槽', !!rFocus && rFocus.res.code === 'inserted'
    && !!rFocus.state.input && rFocus.state.input.name === 'gale_focus');
  const rBad = await act(host, BX + 2, BY, BZ, 'insert', 'stone', 1);
  assert('压印机拒收别的东西', !!rBad && rBad.res.code === 'invalid');
  const rBadSlot = await act(host, BX + 2, BY, BZ, 'insert', 'gale_focus', 1, 'shard');
  assert('残片槽拒收焦点（显式指定错槽位）', !!rBadSlot && rBadSlot.res.code === 'invalid');

  // 锅炉点火与供水
  const rb = await act(host, BX, BY, BZ, 'insert', 'coal', 4);
  assert('锅炉投燃料成功', !!rb && rb.res.code === 'inserted');
  const rw = await act(host, BX, BY, BZ, 'insert', 'water_bucket', 4);
  assert('锅炉投桶装水成功', !!rw && rw.res.code === 'inserted');

  // ④ 服务器 tick 压印（5 秒满效率 + 点火一拍；给足余量）
  await sleep(7000);
  const take = await act(host, BX + 2, BY, BZ, 'extract', null, 1, 'output');
  assert('服务器压出一支风渡焦点', !!take && take.res.code === 'extracted'
    && take.res.items[0].name === 'gale_cross_focus');
  assert('焦点与残片各 -1（1:1，不复制）', !!take
    && (!take.state.input || take.state.input.count === 1)
    && (!take.state.shard || take.state.shard.count === 1),
  `input=${JSON.stringify(take && take.state.input)} shard=${JSON.stringify(take && take.state.shard)}`);
  assert('产物槽已空（取走的就是唯一一份）', !!take && !take.state.output);

  // ⑤ 只有焦点没残片：不推进也不报错
  const guest = await connect(`guest-${STAMP}`);
  send(guest, 'join_room', { room: ROOM_BOTH });
  const gwi = await waitFor(guest, (m) => m.t === 'world_info');
  assert('第二人加入双开房间', !!gwi && gwi.extraContent.industry === true && gwi.extraContent.magic === true);
  const g1 = await act(guest, BX + 2, BY, BZ, 'extract', null, 64, 'shard');
  assert('客人取走剩余残片', !!g1 && g1.res.code === 'extracted');
  await sleep(2500);
  const g2 = await act(guest, BX + 2, BY, BZ, 'extract', null, 64, 'output');
  assert('缺残片期间不产出', !!g2 && g2.res.code === 'empty');

  // 补一份残片 → 服务器继续压印
  await act(guest, BX + 2, BY, BZ, 'insert', 'echo_shard', 1);
  await sleep(6500);
  const g3 = await act(guest, BX + 2, BY, BZ, 'extract', null, 64, 'output');
  assert('补齐残片后继续压印', !!g3 && g3.res.code === 'extracted'
    && g3.res.items[0].name === 'gale_cross_focus');

  // ⑥ 两人同抢一份产物：只成功一次（先把两种料都补上，确保确实会产出一份）
  await act(host, BX + 2, BY, BZ, 'insert', 'echo_shard', 1);
  await act(host, BX + 2, BY, BZ, 'insert', 'gale_focus', 1);
  await sleep(6500);
  const g4 = await act(guest, BX + 2, BY, BZ, 'extract', null, 64, 'output');
  const h4 = await act(host, BX + 2, BY, BZ, 'extract', null, 64, 'output');
  const grabbed = (g4 && g4.res.ok ? g4.res.applied : 0) + (h4 && h4.res.ok ? h4.res.applied : 0);
  assert('两人同抢一份产物：总量恰好 1（不复制）', grabbed === 1, `grabbed=${grabbed}`);

  // ── ⑦ 风压超载（B56 R2）──────────────────────────────────────────────
  // 在 BZ + 6 另起一条线，避免影响上面的拆机断言
  const OZ = BZ + 6;
  place(host, BX, BY, OZ, ID.boiler);
  place(host, BX + 1, BY, OZ, ID.shaft);
  await expectAccepted(host, BX + 2, BY, OZ, ID.press);
  await sleep(300);
  await act(host, BX, BY, OZ, 'insert', 'coal', 8);
  await act(host, BX, BY, OZ, 'insert', 'water_bucket', 8);
  await act(host, BX + 2, BY, OZ, 'insert', 'gale_focus', 2);
  await act(host, BX + 2, BY, OZ, 'insert', 'echo_shard', 2);

  // 玩家先站到机器旁边（服务器按自己手里的玩家位置算距离）
  const standNear = (p, x, y, z) => send(p, 'player_state', {
    x, y, z, yaw: 0, pitch: 0, onGround: true, flying: false, inWater: false,
  });
  standNear(host, BX + 2.5, BY, OZ + 2.5);
  await sleep(200);

  // 开局前：摘要里没有过载
  const before = await openAt(host, BX + 2, BY, OZ);
  assert('过载前：网络摘要里没有过载', !!before && !!before.net && before.net.overload === null);

  guest.inbox.length = 0;
  guest.waiters.length = 0;
  const fx = [];
  const collectFx = (m) => { if (m.t === 'magic_effect') fx.push(m); return false; };
  guest.waiters.push(collectFx);
  // 客人的视角：站在同一条轴旁边施放（他本地也会发自己的状态，但这里是代客操作）
  standNear(guest, BX + 2.5, BY, OZ + 2.5);
  send(host, 'magic_cast', {
    spell: 'gale_overload', echo: 60,
    x: BX + 2.5, y: BY + 1.62, z: OZ + 2.5, dx: 0, dy: -0.2, dz: -1,
    tx: BX + 2, ty: BY, tz: OZ,
  });
  await sleep(700);
  const withOv = await openAt(host, BX + 2, BY, OZ);
  assert('双开：施放后服务器账本里有过载', !!withOv && !!withOv.net && !!withOv.net.overload);
  assert('过载速率取平衡表（×1.5）', !!withOv && withOv.net.overload.rate === 1.5);
  assert('过载剩余时间接近满额', !!withOv && withOv.net.overload.left > 18);
  assert('同维其他人收到过载表现（带目标格）',
    fx.some((m) => m.spell === 'gale_overload' && m.tx === BX + 2 && m.tz === OZ),
    `fx=${JSON.stringify(fx)}`);

  // 第二条：客人对同一条轴再放一次 → 拒绝（不累积、也不重置计时）
  const leftBefore = withOv.net.overload.left;
  guest.inbox.length = 0;
  guest.waiters.length = 0;
  const fx2 = [];
  guest.waiters.push((m) => { if (m.t === 'magic_effect') fx2.push(m); return false; });
  host.inbox.length = 0;
  host.waiters.length = 0;
  const fx3 = [];
  host.waiters.push((m) => { if (m.t === 'magic_effect') fx3.push(m); return false; });
  send(guest, 'magic_cast', {
    spell: 'gale_overload', echo: 60,
    x: BX + 2.5, y: BY + 1.62, z: OZ + 2.5, dx: 0, dy: -0.2, dz: -1,
    tx: BX + 2, ty: BY, tz: OZ,
  });
  await sleep(900);
  const after2 = await openAt(host, BX + 2, BY, OZ);
  assert('同一条轴再放一次：计时不重置（不累积）',
    !!after2 && after2.net.overload.left < leftBefore, `before=${leftBefore} after=${after2 && after2.net.overload.left}`);
  assert('被拒的施放不广播表现', fx2.length === 0 && fx3.length === 0,
    `guest=${fx2.length} host=${fx3.length}`);

  // 第三条：够不着的机器 → 拒（客人换一个远处目标）
  place(guest, BX, BY, OZ + 30, ID.press);
  await sleep(300);
  guest.inbox.length = 0;
  guest.waiters.length = 0;
  const fx4 = [];
  guest.waiters.push((m) => { if (m.t === 'magic_effect') fx4.push(m); return false; });
  send(guest, 'magic_cast', {
    spell: 'gale_overload', echo: 60,
    x: BX + 2.5, y: BY + 1.62, z: OZ + 2.5, dx: 0, dy: -0.2, dz: 1,
    tx: BX, ty: BY, tz: OZ + 30,
  });
  await sleep(800);
  assert('够不着的机器：过载被拒（无表现广播）', fx4.length === 0, `fx=${fx4.length}`);
  place(guest, BX, BY, OZ + 30, ID.air);

  // 第四条：目标指着传动轴 → 拒（轴不是"机器"）
  send(guest, 'magic_cast', {
    spell: 'gale_overload', echo: 60,
    x: BX + 2.5, y: BY + 1.62, z: OZ + 2.5, dx: 0, dy: -0.2, dz: -1,
    tx: BX + 1, ty: BY, tz: OZ,
  });
  await sleep(500);
  const axisCheck = await openAt(host, BX + 2, BY, OZ);
  assert('指着传动轴：不给过载（账本没多一条）',
    !!axisCheck && axisCheck.net.overload.left < leftBefore + 1e-6 && axisCheck.net.overload.left > 0);

  // 第五条：过载真的让服务器更快出货（5 秒的活 4.2 秒内完成）
  send(host, 'player_state', { x: BX + 1, y: BY, z: OZ + 1, yaw: 0, pitch: 0, onGround: true, flying: false, inWater: false });
  await sleep(3900); // 距上次施放约 4.2 秒（含上面几步的等待）
  host.inbox.length = 0;
  host.waiters.length = 0;
  send(host, 'ping', { seq: 7, ts: Date.now() });
  const pong = await waitFor(host, (m) => m.t === 'pong', 1500);
  assert('施放后连接仍然活着', !!pong, `readyState=${host.ws.readyState}`);
  const fast = await act(host, BX + 2, BY, OZ, 'extract', null, 1, 'output');
  assert('过载期间产出快于 5 秒（服务器按 ×1.5 推进）', !!fast && fast.res.code === 'extracted'
    && fast.res.items[0].name === 'gale_cross_focus', `res=${JSON.stringify(fast && fast.res)}`);

  // 第六条：仅工业 / 仅魔法房间直接丢弃这条法术
  const onlyMagic = await connect(`mag-cast-${STAMP}`);
  send(onlyMagic, 'join_room', { room: ROOM_MAG });
  const omwi = await waitFor(onlyMagic, (m) => m.t === 'world_info');
  assert('仅魔法房间可加入（用于放联动法术）', !!omwi && omwi.extraContent.magic === true);
  onlyMagic.inbox.length = 0;
  onlyMagic.waiters.length = 0;
  const fx5 = [];
  onlyMagic.waiters.push((m) => { if (m.t === 'magic_effect') fx5.push(m); return false; });
  send(onlyMagic, 'magic_cast', {
    spell: 'gale_overload', echo: 60, x: 0, y: 64, z: 0, dx: 0, dy: 0, dz: -1,
    tx: 0, ty: 63, tz: -3,
  });
  await sleep(700);
  assert('仅魔法房间：联动法术被丢弃（没有表现广播）', fx5.length === 0, `fx=${fx5.length}`);
  try { onlyMagic.ws.close(); } catch {}

  // 拆机器：剩余内容必须散落（不吞料）；散落的只能是这台机器三种槽位里的东西
  // 先留一份残片在机器里（只有残片 → 不会推进，保证拆的时候确实有内容物）
  await act(host, BX + 2, BY, BZ, 'insert', 'echo_shard', 1);
  const drops = [];
  const collect = (m) => { if (m.t === 'drop_spawn') drops.push(m.name); return false; };
  host.waiters.push(collect);
  host.inbox.length = 0;
  place(host, BX + 2, BY, BZ, ID.air);
  await sleep(900);
  const allowed = new Set(['gale_focus', 'echo_shard', 'gale_cross_focus']);
  assert('拆压印机后剩余内容散落', drops.length > 0 && drops.every((n) => allowed.has(n)),
    `drops=${drops.join(',')}`);
}

for (const p of CONNS) { try { p.ws.close(); } catch {} }
finish('test-extra-synergy');
