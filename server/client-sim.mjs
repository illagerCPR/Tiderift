// client-sim.mjs -- 模拟第二玩家客户端（临时联机验证，配合浏览器 host）
// 流程：hello -> join_room -> 发 player_state/chat/block_set
//       然后等待浏览器 host 放方块(60,72,60) 的广播回显，验证反向同步
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';

const URL = 'ws://127.0.0.1:3001/ws';
const results = [];
const assert = (name, cond) => { results.push([name, !!cond]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ws = new WebSocket(URL);
const inbox = [];
ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
ws.send(JSON.stringify({ t: 'hello', name: 'NodeClient', version: PROTOCOL_VERSION }));
await sleep(150);
const welcome = inbox.find(m => m.t === 'welcome');
assert('Node 收到 welcome', !!welcome);
const selfId = welcome ? welcome.selfId : -1;
console.log('[node] selfId =', selfId);

ws.send(JSON.stringify({ t: 'join_room' }));
await sleep(300);
assert('Node 收到 world_info', !!inbox.find(m => m.t === 'world_info'));

// 发玩家状态（位置 12.5,68,22.5）
ws.send(JSON.stringify({ t: 'player_state', x: 12.5, y: 68, z: 22.5, yaw: 1.2, pitch: 0.1, onGround: true, flying: false, inWater: false }));
await sleep(200);
// 发聊天
ws.send(JSON.stringify({ t: 'chat', text: 'hi from node' }));
await sleep(200);
// 发方块修改
ws.send(JSON.stringify({ t: 'block_set', x: 55, y: 72, z: 55, id: 1 }));
await sleep(300);
const echoBlock = inbox.find(m => m.t === 'block_change' && m.x === 55 && m.y === 72 && m.z === 55);
assert('Node 收到自己 block_set 的广播回显(55,72,55)=1', !!echoBlock && echoBlock.id === 1);

console.log('[node] 等待浏览器 host 放方块 (60,72,60) ...');
// 等待浏览器 host 端 world.setBlock(60,72,60,1) 的广播
let browserBlock = null;
for (let i = 0; i < 40; i++) {
  browserBlock = inbox.find(m => m.t === 'block_change' && m.x === 60 && m.y === 72 && m.z === 60);
  if (browserBlock) break;
  await sleep(250);
}
assert('Node 收到浏览器 host 的 block_change(60,72,60)=1', !!browserBlock && browserBlock.id === 1 && browserBlock.by !== selfId);

ws.close();
const failCount = results.filter(r => !r[1]).length;
console.log(`---\n${results.length - failCount}/${results.length} PASS`);
process.exit(failCount ? 1 : 0);
