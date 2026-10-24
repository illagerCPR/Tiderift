// test-mp.mjs -- 局域网服务器协议端到端验证脚本（阶段 0~3 回归，正式回归套件）
// 用法：node server/test-mp.mjs  （需已启动 node server/index.mjs）
// 说明：id 从 welcome 动态读取，不依赖绝对 id；房间状态由本脚本自建（先 create_room）
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';
import { assert, finish, counts } from './test-lib.mjs';

const URL = 'ws://127.0.0.1:3001/ws';

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws._queue = [];
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, version: PROTOCOL_VERSION })));
    ws.on('message', (d) => ws._queue.push(JSON.parse(d.toString())));
    ws.on('error', reject);
    // 等 welcome 后 resolve，返回 {ws, selfId, queue}
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

// A 创建房间
const A = await connect('Alice');
assert('A 收到 welcome', !!A);
A.ws.send(JSON.stringify({ t: 'create_room', seed: 12345, mode: 'survival', biomeScale: 'large' }));
await sleep(200);
assert('A 收到 room_created', !!A.queue.find(m => m.t === 'room_created'));
const aWorld = A.queue.find(m => m.t === 'world_info');
assert('A 收到 world_info seed=12345', !!aWorld && aWorld.seed === 12345);
assert('A world_info 带回 biomeScale=large', !!aWorld && aWorld.biomeScale === 'large');

// B 加入
const B = await connect('Bob');
assert('B 收到 welcome', !!B && !!B.queue.find(m => m.t === 'welcome'));
B.ws.send(JSON.stringify({ t: 'join_room' }));
await sleep(250);
const bWorld = B.queue.find(m => m.t === 'world_info');
assert('B 收到 world_info seed=12345', !!bWorld && bWorld.seed === 12345);
assert('B world_info 沿用房间 biomeScale=large（加入者自动跟随）', !!bWorld && bWorld.biomeScale === 'large');
assert('B 收到 A 的 player_join 回放（进房后回放已有玩家）', !!B.queue.find(m => m.t === 'player_join' && m.id === A.selfId));
assert('A 收到 player_join Bob', !!A.queue.find(m => m.t === 'player_join' && m.id === B.selfId && m.name === 'Bob'));

// A 改方块 -> B 收到
A.ws.send(JSON.stringify({ t: 'block_set', x: 10, y: 64, z: 20, id: 1 }));
await sleep(200);
const bBlock = B.queue.find(m => m.t === 'block_change' && m.x === 10 && m.y === 64 && m.z === 20);
assert('B 收到 block_change(10,64,20)->1 by=A', !!bBlock && bBlock.id === 1 && bBlock.by === A.selfId);

// B 断开，C 加入应收到方块账本回放
B.ws.close();
await sleep(150);
const C = await connect('Carol');
C.ws.send(JSON.stringify({ t: 'join_room' }));
await sleep(250);
// S9：账本回放改为 block_change_batch 分块（元素形状 [x,y,z,id]）
const cReplay = C.queue.filter(m => m.t === 'block_change_batch').flatMap(m => m.list || []);
assert('C 加入收到方块账本回放 block_change_batch(10,64,20)->1',
  cReplay.some(([x, y, z, id]) => x === 10 && y === 64 && z === 20 && id === 1));

// C 玩家状态 -> A 收到
C.ws.send(JSON.stringify({ t: 'player_state', x: 5, y: 70, z: 5, yaw: 1.5, pitch: 0.2, onGround: true, flying: false, inWater: false }));
await sleep(200);
assert('A 收到 player_state(C)', !!A.queue.find(m => m.t === 'player_state' && m.id === C.selfId && m.x === 5));

// C 聊天 -> A 收到
C.ws.send(JSON.stringify({ t: 'chat', text: 'hello world' }));
await sleep(200);
const aChat = A.queue.find(m => m.t === 'chat');
assert('A 收到 chat from Carol', !!aChat && aChat.text === 'hello world' && aChat.from === 'Carol');

// 互殴：A 打 C -> C 收到 attack_player 且扣血
A.ws.send(JSON.stringify({ t: 'attack_player', targetId: C.selfId, damage: 5 }));
await sleep(200);
const cAttack = C.queue.find(m => m.t === 'attack_player' && m.targetId === C.selfId);
assert('C 收到 attack_player 5', !!cAttack && cAttack.damage === 5 && cAttack.fromId === A.selfId);

// host 设时间 -> C 收到 time
A.ws.send(JSON.stringify({ t: 'set_time', time: 0.75 }));
await sleep(300);
console.log('[debug] A.queue time:', JSON.stringify(A.queue.filter(m => m.t === 'time')));
console.log('[debug] C.queue time:', JSON.stringify(C.queue.filter(m => m.t === 'time')));
assert('C 收到 time=0.75', !!C.queue.find(m => m.t === 'time' && m.time === 0.75));

// 非 host 设时间应被忽略
const before = C.queue.filter(m => m.t === 'time').length;
C.ws.send(JSON.stringify({ t: 'set_time', time: 0.1 }));
await sleep(200);
const after = C.queue.filter(m => m.t === 'time').length;
assert('非 host set_time 被忽略', before === after);

// --- 阶段 1：掉落物与拾取同步 ---
A.ws.send(JSON.stringify({ t: 'drop_spawn', x: 10, y: 70, z: 10, name: 'stone', count: 1 }));
await sleep(200);
const cDrop = C.queue.find(m => m.t === 'drop_spawn' && m.name === 'stone');
assert('C 收到 drop_spawn stone(含 id)', !!cDrop && cDrop.id > 0 && cDrop.x === 10 && cDrop.count === 1);
const dropId = cDrop.id;

// 无效 id 的 drop_taken 应被忽略（账本无此项，不广播）
C.ws.send(JSON.stringify({ t: 'drop_taken', id: 99999 }));
await sleep(150);
assert('无效 drop_taken 被忽略', !C.queue.some(m => m.t === 'drop_taken'));

// C 拾取 -> A 收到 drop_taken(by=C)
C.ws.send(JSON.stringify({ t: 'drop_taken', id: dropId }));
await sleep(200);
const aTaken = A.queue.filter(m => m.t === 'drop_taken' && m.id === dropId);
assert('A 收到 drop_taken by=C', aTaken.length === 1 && aTaken[0].by === C.selfId);

// 重复取同一 id 不再广播（账本已删除）
C.ws.send(JSON.stringify({ t: 'drop_taken', id: dropId }));
await sleep(150);
assert('重复 drop_taken 不再广播', A.queue.filter(m => m.t === 'drop_taken' && m.id === dropId).length === 1);

// 新掉落 + 新玩家 E 加入应收到掉落物回放
A.ws.send(JSON.stringify({ t: 'drop_spawn', x: 12, y: 70, z: 12, name: 'iron_ingot', count: 2 }));
await sleep(150);
const E = await connect('Eve');
E.ws.send(JSON.stringify({ t: 'join_room' }));
await sleep(250);
const eDrop = E.queue.find(m => m.t === 'drop_spawn' && m.name === 'iron_ingot');
assert('E 加入收到掉落物回放 iron_ingot', !!eDrop && eDrop.count === 2 && eDrop.id > 0);

// --- 阶段 1：玩家离开广播带 name ---
C.ws.close();
await sleep(150);
const leaveMsg = A.queue.filter(m => m.t === 'player_leave').find(m => m.id === C.selfId);
assert('A 收到 player_leave(C) 带 name', !!leaveMsg && leaveMsg.name === 'Carol');

// --- 阶段 2：怪物事件同步（host 生成 / 受击 / 死亡广播） ---
A.ws.send(JSON.stringify({ t: 'mob_spawn', type: 'zombie', x: 20, y: 70, z: 20 }));
await sleep(200);
const eMob = E.queue.find(m => m.t === 'mob_spawn' && m.type === 'zombie');
assert('E 收到 mob_spawn zombie(含 id)', !!eMob && eMob.id > 0 && eMob.x === 20);
const mobId = eMob.id;

E.ws.send(JSON.stringify({ t: 'mob_attack', id: mobId, damage: 5, x: 21, y: 70, z: 21 }));
await sleep(200);
const aAttack = A.queue.find(m => m.t === 'mob_attack' && m.id === mobId);
assert('A 收到 mob_attack 5', !!aAttack && aAttack.damage === 5 && aAttack.fromId === E.selfId);

E.ws.send(JSON.stringify({ t: 'mob_died', id: mobId }));
await sleep(200);
assert('A 收到 mob_died', !!A.queue.find(m => m.t === 'mob_died' && m.id === mobId));

// --- 阶段 2：红石源状态转发 ---
A.ws.send(JSON.stringify({ t: 'redstone_state', x: 30, y: 65, z: 30, on: true }));
await sleep(200);
const eRs = E.queue.find(m => m.t === 'redstone_state' && m.x === 30);
assert('E 收到 redstone_state on', !!eRs && eRs.on === true);

// --- 阶段 3：多房间隔离 + 世界落盘协议 + 服务器命令 ---
// F 创建房间 alpha（seed=555）
const F = await connect('Frank');
F.ws.send(JSON.stringify({ t: 'create_room', seed: 555, mode: 'survival', room: 'alpha' }));
await sleep(250);
const fWorld = F.queue.find(m => m.t === 'world_info');
assert('F 创建房间 alpha seed=555', !!fWorld && fWorld.seed === 555 && fWorld.room === 'alpha');

// G 加入 alpha
const G = await connect('Grace');
G.ws.send(JSON.stringify({ t: 'join_room', room: 'alpha' }));
await sleep(250);
const gWorld = G.queue.find(m => m.t === 'world_info');
assert('G 加入 alpha 收到 seed=555', !!gWorld && gWorld.seed === 555 && gWorld.room === 'alpha');
assert('G world_info biomeScale 回落 small（alpha 建房未带档位）', !!gWorld && (gWorld.biomeScale || 'small') === 'small');

// 重复开房 alpha 换档位：房间群系规模与 seed 同语义，仅首次固定，不得被覆盖
F.ws.send(JSON.stringify({ t: 'create_room', seed: 666, mode: 'survival', room: 'alpha', biomeScale: 'huge' }));
await sleep(250);
const fWorld2 = F.queue.filter(m => m.t === 'world_info').pop();
assert('重复开房 alpha 不改 seed', !!fWorld2 && fWorld2.seed === 555);
assert('重复开房 alpha 不改 biomeScale（仍 small 非 huge）', !!fWorld2 && (fWorld2.biomeScale || 'small') === 'small');
assert('G 收到 alpha 内已有玩家 F 的 player_join 回放', !!G.queue.find(m => m.t === 'player_join' && m.id === F.selfId));
assert('F 收到 G 加入 alpha 的 player_join', !!F.queue.find(m => m.t === 'player_join' && m.id === G.selfId));

// alpha 内改方块 -> G 收到
F.ws.send(JSON.stringify({ t: 'block_set', x: 50, y: 64, z: 50, id: 3 }));
await sleep(200);
assert('G 收到 alpha 内 block_change(50,64,50)', !!G.queue.find(m => m.t === 'block_change' && m.x === 50 && m.y === 64 && m.z === 50));

// 房间隔离：默认房间的 E 收不到 alpha 的方块改动；G 收不到默认房间的方块回放
assert('默认房间 E 未收到 alpha 方块改动',
  !E.queue.some(m => m.t === 'block_change' && m.x === 50) &&
  !E.queue.some(m => m.t === 'block_change_batch' && (m.list || []).some(it => it[0] === 50)));
assert('G 未收到默认房间方块(10,64,20)回放',
  !G.queue.some(m => (m.t === 'block_change' && m.x === 10 && m.y === 64 && m.z === 20) ||
    (m.t === 'block_change_batch' && (m.list || []).some(it => it[0] === 10 && it[1] === 64 && it[2] === 20))));

// 加入不存在房间 beta -> 自动创建，首个加入者成为 host
const H = await connect('Harry');
H.ws.send(JSON.stringify({ t: 'join_room', room: 'beta' }));
await sleep(250);
const hWorld = H.queue.find(m => m.t === 'world_info');
assert('H 加入 beta 自动创建且成为 host', !!hWorld && Number.isInteger(hWorld.seed) && hWorld.hostId === H.selfId);

// 服务器命令 /seed 与 /rooms（从 F 发起，F 在 alpha）
F.ws.send(JSON.stringify({ t: 'chat', text: '/seed' }));
await sleep(200);
const seedReply = F.queue.find(m => m.t === 'chat' && m.fromId === 0 && m.text.includes('seed=555'));
assert('F 收到 /seed 回复(seed=555)', !!seedReply);
F.ws.send(JSON.stringify({ t: 'chat', text: '/rooms' }));
await sleep(200);
assert('F 收到 /rooms 回复(含 alpha)', !!F.queue.find(m => m.t === 'chat' && m.fromId === 0 && m.text.includes('alpha')));

// B38 L1：延迟透传——A 自报 player_state.rtt，同房间的 J 收到；更晚加入者还要能从 player_join 回放里拿到
const J = await connect('Jack');
J.ws.send(JSON.stringify({ t: 'join_room' }));
await sleep(250);
J.queue.length = 0; // 只看自己发 rtt 之后到达的包（进房回放里的旧状态不应参与断言）
A.ws.send(JSON.stringify({ t: 'player_state', x: 1, y: 64, z: 2, yaw: 0, pitch: 0, rtt: 137 }));
await sleep(200);
const jState = J.queue.filter(m => m.t === 'player_state' && m.id === A.selfId).pop();
assert('B38 L1：player_state 透传 rtt', !!jState && jState.rtt === 137);
const I = await connect('Iris');
I.ws.send(JSON.stringify({ t: 'join_room' }));
await sleep(250);
const iJoin = I.queue.find(m => m.t === 'player_join' && m.id === A.selfId);
assert('B38 L1：player_join 回放带 rtt', !!iJoin && iJoin.rtt === 137);
I.ws.close(); J.ws.close();

// 断开
A.ws.close(); E.ws.close(); F.ws.close(); G.ws.close(); H.ws.close();
await sleep(100);

const { total, passed } = counts();
console.log(`---\n${passed}/${total} PASS`);
finish();
