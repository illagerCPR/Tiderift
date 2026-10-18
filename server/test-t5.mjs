// test-t5.mjs -- T5 批次服务器回归：容器（箱子）账本协议 + mob_spawn tradeSeed 透传 + 容器落盘格式
// 用法：node server/test-t5.mjs（需已启动 node server/index.mjs；run-all-tests.sh 调用）
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';

const URL = 'ws://127.0.0.1:3001/ws';
const results = [];

function assert(name, cond) {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws._queue = [];
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, version: PROTOCOL_VERSION })));
    ws.on('message', (d) => ws._queue.push(JSON.parse(d.toString())));
    ws.on('error', reject);
    const timer = setInterval(() => {
      const w = ws._queue.find(m => m.t === 'welcome');
      if (w) {
        clearInterval(timer);
        resolve({ ws, selfId: w.selfId, queue: ws._queue });
      }
    }, 20);
    setTimeout(() => { clearInterval(timer); reject(new Error('timeout waiting welcome')); }, 3000);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ROOM = 't5-ctest-' + Date.now();

const items = (defs) => new Array(27).fill(null).map((_, i) => defs[i] || null);
const A = await connect('T5A');
A.ws.send(JSON.stringify({ t: 'create_room', seed: 777, mode: 'survival', room: ROOM }));
await sleep(200);
assert('A 建房成功', !!A.queue.find(m => m.t === 'room_created'));

const B = await connect('T5B');
B.ws.send(JSON.stringify({ t: 'join_room', room: ROOM }));
await sleep(250);
assert('B 加入成功', !!B.queue.find(m => m.t === 'world_info' && m.room === ROOM));

// ── 容器整箱同步 ─────────────────────────────────────────────────────────
const chestItems = items([{ name: 'bread', count: 3 }, null, { name: 'iron_ingot', count: 2 }]);
A.ws.send(JSON.stringify({ t: 'container_set', x: 100, y: 70, z: -50, items: chestItems }));
await sleep(200);
const bC = B.queue.find(m => m.t === 'container_set' && m.x === 100 && m.y === 70 && m.z === -50);
assert('B 收到 container_set 且内容逐槽一致', !!bC && bC.by === A.selfId &&
  JSON.stringify(bC.items) === JSON.stringify(chestItems));
assert('发起者 A 不回显 container_set', !A.queue.some(m => m.t === 'container_set' && m.by === A.selfId));

// 脏包：长度非 27 → 拒绝（不记账不广播）
const bCount = B.queue.filter(m => m.t === 'container_set').length;
A.ws.send(JSON.stringify({ t: 'container_set', x: 1, y: 2, z: 3, items: new Array(26).fill(null) }));
await sleep(150);
assert('长度 26 的 container_set 被拒绝', B.queue.filter(m => m.t === 'container_set').length === bCount);

// 脏条目：超量 count 钳到 64、超长 name 截断、非法槽清空
const dirty = items([{ name: 'x'.repeat(60), count: 999 }, { name: 'bread', count: 0 }, 'oops']);
A.ws.send(JSON.stringify({ t: 'container_set', x: 100, y: 70, z: -50, items: dirty }));
await sleep(200);
const bD = [...B.queue].reverse().find(m => m.t === 'container_set' && m.x === 100);
assert('脏条目被消毒（count 钳 64）', !!bD && bD.items[0] && bD.items[0].count === 64 && bD.items[0].name.length <= 32);
assert('非法条目清空（count=0 / 非对象）', !!bD && bD.items[1] === null && bD.items[2] === null);

// 新加入者收到容器账本回放
const C = await connect('T5C');
C.ws.send(JSON.stringify({ t: 'join_room', room: ROOM }));
await sleep(300);
const cReplay = C.queue.find(m => m.t === 'container_set' && m.x === 100 && m.y === 70 && m.z === -50);
assert('C 加入收到容器账本回放(by=0)', !!cReplay && cReplay.by === 0 && Array.isArray(cReplay.items) && cReplay.items.length === 27);

// 挖箱（block_set id=0）→ 账本清除 → 新加入者不再回放该容器
A.ws.send(JSON.stringify({ t: 'block_set', x: 100, y: 70, z: -50, id: 0 }));
await sleep(200);
const D = await connect('T5D');
D.ws.send(JSON.stringify({ t: 'join_room', room: ROOM }));
await sleep(300);
assert('挖箱后账本清除，D 不再收到该容器回放', !D.queue.some(m => m.t === 'container_set' && m.x === 100 && m.z === -50));

// ── mob_spawn tradeSeed 透传 ─────────────────────────────────────────────
A.ws.send(JSON.stringify({ t: 'mob_spawn', type: 'villager', x: 5, y: 70, z: 5, tradeSeed: 13579 }));
await sleep(200);
const bMob = B.queue.filter(m => m.t === 'mob_spawn' && m.type === 'villager').pop();
assert('B 收到 mob_spawn 且 tradeSeed 原样透传', !!bMob && bMob.tradeSeed === 13579 && bMob.id > 0);
const cMob = C.queue.filter(m => m.t === 'mob_spawn' && m.type === 'villager').pop();
assert('C 同样收到同一 tradeSeed（两端一致）', !!cMob && cMob.tradeSeed === 13579 && cMob.id === bMob.id);
A.ws.send(JSON.stringify({ t: 'mob_spawn', type: 'zombie', x: 6, y: 70, z: 6 }));
await sleep(200);
const bZ = B.queue.filter(m => m.t === 'mob_spawn' && m.type === 'zombie').pop();
assert('不带 tradeSeed 的 mob_spawn 不产生该字段', !!bZ && bZ.tradeSeed === undefined);

// ── 容器落盘格式（store 单元级：写临时目录读回；M4 分维格式）──────────────
{
  const tmpDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.t5-store-test');
  const fakeRoom = {
    name: 't5-store-unit', seed: 42, time: 0.35, nextDropId: 1, nextMobId: 1,
    dimensionBlocks: new Map([
      ['overworld', new Map([['1,2,3', 5]])],
    ]),
    drops: new Map(),
    dimensionContainers: new Map([
      ['overworld', new Map([
        ['9,9,9', items([{ name: 'emerald', count: 5 }])],
      ])],
    ]),
  };
  store.saveRoom(fakeRoom, tmpDir);
  const snap = store.loadRooms(tmpDir).find(r => r.name === 't5-store-unit');
  assert('store 落盘含 containers 分维数组', !!snap && Array.isArray(snap.dimensionContainers?.overworld) && snap.dimensionContainers.overworld.length === 1);
  const [k, arr] = snap.dimensionContainers.overworld[0];
  assert('容器落盘逐槽一致（含 null 稀疏槽）', k === '9,9,9' && JSON.stringify(arr) === JSON.stringify([...fakeRoom.dimensionContainers.get('overworld').get('9,9,9')]));
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

for (const c of [A, B, C, D]) { try { c.ws.close(); } catch {} }
await sleep(150);

const failed = results.filter(r => !r[1]).length;
console.log(`\nT5 服务器回归: ${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
