// test-furnace.mjs -- Build 36 F-2 熔炉进出料与生产链回归（需已启动 node server/index.mjs；run-all-tests.sh 调用）
// 覆盖：熔炉内容首次上账本（open 拉权威状态 / 玩家改动按 by 广播给其他端）、
//       服务器权威推进产出（客户端本地不推进 → 只产出一份）、点燃态方块切换、
//       漏斗从熔炉取产物送进仓库箱、挖掉熔炉后账本清理与内容物散落。
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { assert, finish, counts } from './test-lib.mjs';
import '../src/blocks/BlockDefs.js'; // 方块 id 由注册顺序决定：直接读同一份注册表，避免硬编码
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { furnaceBlockId } from './furnace.js';
import { HOPPER_FACING_BY_ID } from './flow.js';

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
// 只在「某条消息之后新到的」消息里等待，避免队列里更早的同类消息造成假阳性
async function waitAfter(client, from, pred, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (let i = from; i < client.queue.length; i++) if (pred(client.queue[i])) return client.queue[i];
    await sleep(50);
  }
  return null;
}
const send = (c, t, extra = {}) => c.ws.send(JSON.stringify({ t, ...extra }));
const atFurnace = (m, x, y, z) => m.t === 'furnace_set' && m.x === x && m.y === y && m.z === z;

const CHEST_ID = BlockRegistry.getByName('chest').id;
const FURNACE_ID = furnaceBlockId('n', false);
const FURNACE_LIT_ID = furnaceBlockId('n', true);
const HOPPER_E_ID = [...HOPPER_FACING_BY_ID].find(([, f]) => f === 'e')[0];

// 布局：熔炉(20,64,20) 上方无物；漏斗(20,63,20) 在熔炉正下方 → 只取产物 → 朝 e 送进仓库箱(21,63,20)
const FX = 20, FY = 64, FZ = 20;
const HX = 20, HY = 63, HZ = 20;
const CX = 21, CY = 63, CZ = 20;

const ROOM = 'furnace-main-' + Date.now();
const A = await connect('FurnA');
send(A, 'create_room', { seed: 7771, mode: 'survival', room: ROOM });
await sleep(250);
assert('A 建房成功', !!A.queue.find((m) => m.t === 'room_created'));

const B = await connect('FurnB');
send(B, 'join_room', { room: ROOM });
await sleep(300);
assert('B 加入成功', !!B.queue.find((m) => m.t === 'world_info' && m.room === ROOM));

// ── 1. 放熔炉 + 打开界面拉权威状态 ────────────────────────────────────────────
send(A, 'block_set', { x: FX, y: FY, z: FZ, id: FURNACE_ID });
await sleep(200);
assert('B 收到熔炉方块广播', !!B.queue.find((m) => m.t === 'block_change' && m.x === FX && m.y === FY && m.z === FZ && m.id === FURNACE_ID));

send(A, 'furnace_open', { x: FX, y: FY, z: FZ });
const opened = await waitFor(A, (m) => atFurnace(m, FX, FY, FZ));
assert('打开熔炉收到服务器权威状态（by=0）', !!opened && opened.by === 0);
assert('权威状态带维度与进度字段', !!opened && opened.d === 'overworld' && opened.burnTime === 0 && opened.cookTime === 0 && opened.burnMax === 0);
assert('新熔炉三槽皆空', !!opened && opened.input === null && opened.fuel === null && opened.output === null);

// ── 2. 玩家改动内容槽 → 服务器广播给其他端（by=发起者） ────────────────────────
send(A, 'furnace_set', { x: FX, y: FY, z: FZ, input: { name: 'iron_ore', count: 2 }, fuel: { name: 'coal', count: 1 }, output: null });
const relayed = await waitFor(B, (m) => atFurnace(m, FX, FY, FZ) && m.by === A.selfId);
assert('其他端收到熔炉内容改动（by=改动者）', !!relayed);
assert('改动内容透传正确', !!relayed && relayed.input.name === 'iron_ore' && relayed.input.count === 2 &&
  relayed.fuel.name === 'coal' && relayed.output === null);

// ── 3. 服务器权威推进：10 秒产出一个，且只有一份 ───────────────────────────────
const produced = await waitFor(B, (m) => atFurnace(m, FX, FY, FZ) && m.by === 0 && m.output && m.output.count >= 1, 14000);
assert('服务器 tick 真的产出了铁锭（by=0 广播）', !!produced, produced ? JSON.stringify(produced.output) : '超时未产出');
assert('产出恰好 1 个（两端各自本地推进才会翻倍）', !!produced && produced.output.name === 'iron_ingot' && produced.output.count === 1,
  produced ? JSON.stringify(produced.output) : '');
assert('原料按产出量恰好消耗 1 个', !!produced && !!produced.input && produced.input.count === 1,
  produced ? JSON.stringify(produced.input) : '');
assert('烧炼进度由服务器给出（客户端不推进）', !!produced && Number.isFinite(produced.burnTime) && produced.burnTime > 0);

const litChange = await waitFor(B, (m) => m.t === 'block_change' && m.x === FX && m.y === FY && m.z === FZ && m.id === FURNACE_LIT_ID, 3000);
assert('服务器把熔炉切成点燃态方块（保留朝向，by=0）', !!litChange && litChange.by === 0, litChange ? `id=${litChange.id}` : '无点燃态广播');
assert('点燃态 id 与熄灭态不同', FURNACE_LIT_ID !== FURNACE_ID);

// ── 4. 漏斗接线：下方漏斗只取产物并送进仓库箱 ────────────────────────────────
send(A, 'block_set', { x: HX, y: HY, z: HZ, id: HOPPER_E_ID });
send(A, 'block_set', { x: CX, y: CY, z: CZ, id: CHEST_ID });
await sleep(200);
const mark = B.queue.length;
const delivered = await waitAfter(B, mark, (m) => m.t === 'container_set' && m.x === CX && m.y === CY && m.z === CZ &&
  Array.isArray(m.items) && m.items.some((s) => s && s.name === 'iron_ingot'), 6000);
assert('漏斗把熔炉产物送进仓库箱（服务器权威 by=0）', !!delivered && delivered.by === 0,
  delivered ? JSON.stringify(delivered.items.filter(Boolean)) : '超时未送达');

const mark2 = B.queue.length;
const outEmptied = await waitAfter(B, mark2, (m) => atFurnace(m, FX, FY, FZ) && m.by === 0 && m.output === null, 4000);
assert('产物槽被漏斗取空（熔炉状态同步更新）', !!outEmptied,
  outEmptied ? '已同步' : JSON.stringify(B.queue.filter((m) => atFurnace(m, FX, FY, FZ)).slice(-3)));

// ── 5. 挖掉熔炉：账本清理 + 内容物散落（服务器权威一份） ───────────────────────
send(A, 'block_set', { x: FX, y: FY, z: FZ, id: 0 });
const scattered = await waitFor(B, (m) => m.t === 'drop_spawn' && m.name === 'iron_ore', 3000);
assert('挖掉熔炉后剩余原料散落成掉落（服务器权威）', !!scattered && scattered.count === 1,
  scattered ? `${scattered.name}x${scattered.count}` : '无散落');

// 账本已清：再打开同一坐标拿不到权威状态
A.queue.length = 0;
send(A, 'furnace_open', { x: FX, y: FY, z: FZ });
await sleep(800);
assert('挖掉后该坐标不再有熔炉账本条目（open 无回执）', !A.queue.some((m) => atFurnace(m, FX, FY, FZ)));

// 收尾：断线（世界由跑批脚本统一清理）
for (const c of [A, B]) c.ws.close();
await sleep(150);
finish();
console.log(`test-furnace: ${counts().passed}/${counts().total}`);
