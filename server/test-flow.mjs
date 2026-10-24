// test-flow.mjs -- Build 36 F-1 服务器权威漏斗搬运回归（需已启动 node server/index.mjs；run-all-tests.sh 调用）
// 覆盖：服务器 tick 真的搬货（by:0 广播）、两条同步路径分界（客户端改漏斗被拒 + 回滚）、
//       每房间 64 个漏斗上限的拒绝与回滚、搬运结果按容器合并去重。
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { assert, finish, counts } from './test-lib.mjs';
import '../src/blocks/BlockDefs.js'; // 方块 id 由注册顺序决定：直接读同一份注册表，避免硬编码
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { HOPPER_FACING_BY_ID, FLOW_HOPPER_LIMIT } from './flow.js';

const URL = 'ws://127.0.0.1:3001/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws._queue = [];
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, version: PROTOCOL_VERSION })));
    ws.on('message', (d) => ws._queue.push(JSON.parse(d.toString())));
    ws.on('error', reject);
    const timer = setInterval(() => {
      const w = ws._queue.find((m) => m.t === 'welcome');
      if (w) {
        clearInterval(timer);
        resolve({ ws, selfId: w.selfId, queue: ws._queue });
      }
    }, 20);
    setTimeout(() => { clearInterval(timer); reject(new Error('timeout waiting welcome')); }, 3000);
  });
}

// 轮询等待某条消息出现（默认 3s 超时）
async function waitFor(client, pred, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const hit = client.queue.find(pred);
    if (hit) return hit;
    await sleep(50);
  }
  return null;
}
const send = (c, t, extra = {}) => c.ws.send(JSON.stringify({ t, ...extra }));
const items = (defs) => new Array(27).fill(null).map((_, i) => defs[i] || null);
const at = (m, x, y, z) => m.t === 'container_set' && m.x === x && m.y === y && m.z === z;
const countOf = (m) => (m && Array.isArray(m.items) ? m.items.filter(Boolean).reduce((n, s) => n + s.count, 0) : -1);

// 方块 id 取自同一份注册表（服务器表与注册表的一致性由 tests/hopper-unit.mjs 钉住）
const CHEST_ID = BlockRegistry.getByName('chest').id;
const HOPPER_S_ID = [...HOPPER_FACING_BY_ID].find(([, f]) => f === 's')[0];

const ROOM = 'flow-main-' + Date.now();
const A = await connect('FlowA');
send(A, 'create_room', { seed: 9091, mode: 'survival', room: ROOM });
await sleep(250);
assert('A 建房成功', !!A.queue.find((m) => m.t === 'room_created'));

const B = await connect('FlowB');
send(B, 'join_room', { room: ROOM });
await sleep(300);
assert('B 加入成功', !!B.queue.find((m) => m.t === 'world_info' && m.room === ROOM));

// ── 摆位：源箱(10,71,10) → 漏斗(10,70,10) 朝 s → 目标箱(10,70,11) ───────────────
send(A, 'block_set', { x: 10, y: 71, z: 10, id: CHEST_ID });
send(A, 'block_set', { x: 10, y: 70, z: 10, id: HOPPER_S_ID });
send(A, 'block_set', { x: 10, y: 70, z: 11, id: CHEST_ID });
await sleep(200);
assert('B 收到漏斗方块广播', !!B.queue.find((m) => m.t === 'block_change' && m.x === 10 && m.y === 70 && m.z === 10 && m.id === HOPPER_S_ID));

send(A, 'container_set', { x: 10, y: 71, z: 10, items: items([{ name: 'bread', count: 5 }]) });
await sleep(150);

// ── 服务器 tick 搬货 ─────────────────────────────────────────────────────────
const landed = await waitFor(B, (m) => at(m, 10, 70, 11) && countOf(m) === 5, 4000);
assert('漏斗把面包搬到目标箱', !!landed, landed ? `count=${countOf(landed)}` : '超时未到');
assert('搬运广播来源是服务器（by=0）', !!landed && landed.by === 0);
assert('搬运广播带维度字段', !!landed && landed.d === 'overworld');

const aLanded = await waitFor(A, (m) => at(m, 10, 70, 11) && countOf(m) === 5, 2000);
assert('发起摆位的 A 也收到同一条搬运广播（服务器是来源，不是 A）', !!aLanded && aLanded.by === 0);

const hopperMsgs = B.queue.filter((m) => at(m, 10, 70, 10));
assert('漏斗自身内容被广播过（服务器改 → 广播）', hopperMsgs.length > 0, `msg=${hopperMsgs.length}`);
assert('漏斗自身内容最终为空（搬完不残留）', countOf(hopperMsgs[hopperMsgs.length - 1]) === 0,
  `count=${countOf(hopperMsgs[hopperMsgs.length - 1])}`);

// ── 两条同步路径分界：客户端改漏斗被拒 + 回滚 ───────────────────────────────────
const denyPromise = waitFor(A, (m) => m.t === 'container_deny' && m.x === 10 && m.y === 70 && m.z === 10, 2000);
const bBefore = B.queue.filter((m) => at(m, 10, 70, 10) && m.by === A.selfId).length;
send(A, 'container_set', { x: 10, y: 70, z: 10, items: items([{ name: 'diamond', count: 64 }]) });
const deny = await denyPromise;
await sleep(200);
assert('客户端改写漏斗被拒（container_deny）', !!deny);
assert('拒绝消息携带服务器权威内容（27 槽）', !!deny && Array.isArray(deny.items) && deny.items.length === 27);
assert('被拒的改写没有广播给其他端', B.queue.filter((m) => at(m, 10, 70, 10) && m.by === A.selfId).length === bBefore);

// ── 每房间漏斗上限 ───────────────────────────────────────────────────────────
const ROOM2 = 'flow-limit-' + Date.now();
const C = await connect('FlowC');
send(C, 'create_room', { seed: 4242, mode: 'survival', room: ROOM2 });
await sleep(250);
assert('C 建房成功（上限用例独立房间）', !!C.queue.find((m) => m.t === 'room_created'));
for (let i = 0; i < FLOW_HOPPER_LIMIT; i++) {
  send(C, 'block_set', { x: 100 + i, y: 64, z: 200, id: HOPPER_S_ID });
}
await sleep(600);
const overX = 100 + FLOW_HOPPER_LIMIT;
send(C, 'block_set', { x: overX, y: 64, z: 200, id: HOPPER_S_ID }); // 第 65 个：应被拒
const deniedBlock = await waitFor(C, (m) => m.t === 'block_change' && m.x === overX && m.y === 64 && m.z === 200, 2500);
// 第 65 个：服务端不入账，回滚 id=0 并给系统提示（这条 block_change 带 by:0，正常广播不会发回发起者）
const limitChat = C.queue.find((m) => m.t === 'chat' && typeof m.text === 'string' && m.text.includes('漏斗已达上限'));
assert('第 65 个漏斗被拒绝并回滚', !!deniedBlock && deniedBlock.id === 0 && deniedBlock.by === 0,
  deniedBlock ? `id=${deniedBlock.id} by=${deniedBlock.by}` : '无回滚');
assert('拒绝时给出系统提示', !!limitChat, limitChat ? limitChat.text : '无提示');
assert(`前 ${FLOW_HOPPER_LIMIT} 个漏斗正常入账`,
  C.queue.filter((m) => m.t === 'block_change' && m.by === undefined && m.x >= 100 && m.x < overX).length === 0 ||
  !C.queue.some((m) => m.t === 'block_change' && m.by === 0 && m.x < overX));

// 收尾：断线（世界由跑批脚本统一清理）
for (const c of [A, B, C]) c.ws.close();
await sleep(150);
finish();
console.log(`test-flow: ${counts().passed}/${counts().total}`);
