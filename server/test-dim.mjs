// test-dim.mjs -- M4 联机维度同步回归：维度化账本隔离 / 按维度过滤广播 / 换维账本下发 / 快照迁移
// 用法：node server/test-dim.mjs（需已启动 node server/index.mjs；run-all-tests.sh 调用）
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from './room.js';
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
    const timer = setInterval(() => {
      const w = ws._queue.find(m => m.t === 'welcome');
      if (w) { clearInterval(timer); resolve({ ws, selfId: w.selfId, queue: ws._queue }); }
    }, 20);
    setTimeout(() => { clearInterval(timer); reject(new Error('timeout waiting welcome')); }, 3000);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ROOM = 'dim-ctest-' + Date.now();

const A = await connect('DimA');
A.ws.send(JSON.stringify({ t: 'create_room', seed: 888, mode: 'survival', room: ROOM }));
await sleep(200);
assert('A 建房成功', !!A.queue.find(m => m.t === 'room_created'));

const B = await connect('DimB');
B.ws.send(JSON.stringify({ t: 'join_room', room: ROOM }));
await sleep(250);
assert('B 加入成功（join_info 带 dim=overworld）',
  !!B.queue.find(m => m.t === 'player_join' && m.id === A.selfId && m.dim === 'overworld'));

// ── A 切换到下界 ─────────────────────────────────────────────────────────
A.ws.send(JSON.stringify({ t: 'switch_dimension', dim: 'nether' }));
await sleep(250);
const aDimWorld = A.queue.find(m => m.t === 'dimension_world' && m.dim === 'nether');
assert('A 收到 dimension_world(nether) 账本下发', !!aDimWorld && Array.isArray(aDimWorld.blocks) && Array.isArray(aDimWorld.containers));
const bDimMsg = B.queue.find(m => m.t === 'player_dimension' && m.id === A.selfId);
assert('B 收到 player_dimension(A→nether) 广播', !!bDimMsg && bDimMsg.dim === 'nether');

// ── 账本隔离：A 在下界放方块，B（主世界）不得收到 ────────────────────────
A.ws.send(JSON.stringify({ t: 'block_set', x: 10, y: 70, z: 10, id: 1 }));
await sleep(250);
assert('B 未收到 A 的下界 block_change', !B.queue.some(m => m.t === 'block_change' && m.x === 10 && m.y === 70 && m.z === 10));
assert('发起者 A 不回显自己的 block_change', !A.queue.some(m => m.t === 'block_change' && m.by === A.selfId));

// ── 掉落物维度过滤：A 在下界丢掉落，B（主世界）不得收到 ──────────────────
A.ws.send(JSON.stringify({ t: 'drop_spawn', x: 11, y: 70, z: 11, name: 'dirt', count: 2 }));
await sleep(250);
const bDrop = B.queue.find(m => m.t === 'drop_spawn' && m.name === 'dirt');
assert('B 未收到 A 的下界 drop_spawn', !bDrop);
const aDrop = A.queue.find(m => m.t === 'drop_spawn' && m.name === 'dirt');
assert('A 自己收到 drop_spawn 回执（同维含发起者）', !!aDrop && aDrop.d === 'nether');
const dropId = aDrop ? aDrop.id : -1;

// ── C 加入（主世界）：回放不含 A 的下界方块 ─────────────────────────────
const C = await connect('DimC');
C.ws.send(JSON.stringify({ t: 'join_room', room: ROOM }));
await sleep(300);
assert('C 加入（主世界）回放不含下界方块',
  !C.queue.some(m => (m.t === 'block_change' && m.x === 10 && m.y === 70 && m.z === 10) ||
    (m.t === 'block_change_batch' && (m.list || []).some(it => it[0] === 10 && it[1] === 70 && it[2] === 10))));

// ── C 换到下界：dimension_world 含 A 的下界方块 + 回放同维玩家 A ─────────
C.ws.send(JSON.stringify({ t: 'switch_dimension', dim: 'nether' }));
await sleep(300);
const cDimWorld = C.queue.find(m => m.t === 'dimension_world' && m.dim === 'nether');
const cLedgerHit = !!cDimWorld && cDimWorld.blocks.some(b => b.x === 10 && b.y === 70 && b.z === 10 && b.id === 1);
assert('C 换维账本含 A 的下界方块 (10,70,10)', cLedgerHit);
assert('C 收到同维玩家 A 的 player_join 回放', !!C.queue.find(m => m.t === 'player_join' && m.id === A.selfId && m.dim === 'nether'));

// ── 同维掉落可见 + 跨维拾取拒绝 ────────────────────────────────────────
const cDrop = C.queue.find(m => m.t === 'drop_spawn' && m.name === 'dirt' && m.d === 'nether');
assert('C（同维）收到 A 的下界 drop_spawn', !!cDrop);
C.ws.send(JSON.stringify({ t: 'drop_taken', id: dropId }));
await sleep(250);
assert('A 收到同维 drop_taken（账本移除广播）', !!A.queue.find(m => m.t === 'drop_taken' && m.id === dropId));

// ── 主世界方块与下界互不干扰：B 放方块，A/C（下界）不得收到 ─────────────
B.ws.send(JSON.stringify({ t: 'block_set', x: 20, y: 70, z: 20, id: 4 }));
await sleep(250);
assert('A（下界）未收到 B 的主世界 block_change',
  !A.queue.some(m => m.t === 'block_change' && m.x === 20 && m.y === 70 && m.z === 20));
assert('C（下界）未收到 B 的主世界 block_change',
  !C.queue.some(m => m.t === 'block_change' && m.x === 20 && m.y === 70 && m.z === 20));

// 新加入者 D（主世界）回放含 B 的方块、不含 A 的下界方块
const D = await connect('DimD');
D.ws.send(JSON.stringify({ t: 'join_room', room: ROOM }));
await sleep(300);
// S9：回放改为 block_change_batch（by=0 表示账本回放，元素形状 [x,y,z,id]）
const dReplay = D.queue.filter(m => m.t === 'block_change_batch' && m.by === 0 && m.d === 'overworld');
assert('D（主世界）回放含 B 的方块',
  dReplay.some(m => (m.list || []).some(([x, y, z, id]) => x === 20 && y === 70 && z === 20 && id === 4)));
assert('D 回放不含 A 的下界方块',
  !D.queue.some(m => (m.t === 'block_change' && m.x === 10 && m.y === 70 && m.z === 10) ||
    (m.t === 'block_change_batch' && (m.list || []).some(it => it[0] === 10 && it[1] === 70 && it[2] === 10))));

// ── player_state 按维度过滤 ─────────────────────────────────────────────
const cStateCount = C.queue.filter(m => m.t === 'player_state').length;
B.ws.send(JSON.stringify({ t: 'player_state', x: 1, y: 2, z: 3, yaw: 0, pitch: 0 }));
await sleep(250);
assert('C（下界）未收到 B 的 player_state（主世界）', C.queue.filter(m => m.t === 'player_state').length === cStateCount);

// ── A 切回主世界：账本含 B 的方块 + 回放同维玩家 B ──────────────────────
A.ws.send(JSON.stringify({ t: 'switch_dimension', dim: 'overworld' }));
await sleep(300);
const aBack = A.queue.filter(m => m.t === 'dimension_world' && m.dim === 'overworld').pop();
assert('A 切回主世界账本含 B 的方块', !!aBack && aBack.blocks.some(b => b.x === 20 && b.y === 70 && b.z === 20));
assert('A 收到同维玩家 B 的 player_join 回放', !!A.queue.find(m => m.t === 'player_join' && m.id === B.selfId && m.dim === 'overworld'));

// ── 非法维度拒绝 ───────────────────────────────────────────────────────
const aDimCount = A.queue.filter(m => m.t === 'dimension_world').length;
A.ws.send(JSON.stringify({ t: 'switch_dimension', dim: 'moon' }));
await sleep(250);
assert('非法维度 moon 被拒（无 dimension_world）', A.queue.filter(m => m.t === 'dimension_world').length === aDimCount);
assert('非法维度收到系统提示', !!A.queue.find(m => m.t === 'chat' && m.fromId === 0 && m.text.includes('moon')));

// ── 传送门落点回传（迭代 M2）：switch_dimension.pos 原样回传 dimension_world.pos ──
{
  const cnt0 = A.queue.filter(m => m.t === 'dimension_world').length;
  A.ws.send(JSON.stringify({ t: 'switch_dimension', dim: 'nether', pos: { x: 123, z: -45, portal: 'nether' } }));
  await sleep(300);
  const pw = A.queue.filter(m => m.t === 'dimension_world' && m.dim === 'nether').pop();
  assert('带 pos 换维：dimension_world.pos 原样回传（仅本人）',
    A.queue.filter(m => m.t === 'dimension_world').length === cnt0 + 1 &&
    !!pw && pw.pos && pw.pos.x === 123 && pw.pos.z === -45 && pw.pos.portal === 'nether');
  // 非法 pos 清洗为 null（不落账、不广播他人）
  A.ws.send(JSON.stringify({ t: 'switch_dimension', dim: 'aether', pos: { x: 'bad', z: null } }));
  await sleep(300);
  const pw2 = A.queue.filter(m => m.t === 'dimension_world' && m.dim === 'aether').pop();
  assert('非法 pos 清洗为 null', !!pw2 && pw2.pos === null);
}

// ── 快照落盘：分维度账本进 store ───────────────────────────────────────
// S8：落盘节流后不再依赖固定 sleep——轮询等待快照内容就绪（最多 3s，超时判失败）
const snapPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'world', ROOM + '.json');
let snap = null;
for (let t = 0; t < 30 && !snap; t++) {
  await sleep(100);
  try {
    const s = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    const nb = s.dimensionBlocks && s.dimensionBlocks.nether;
    const ow = s.dimensionBlocks && s.dimensionBlocks.overworld;
    if (nb && nb.some(([k, id]) => k === '10,70,10' && id === 1) &&
        ow && ow.some(([k, id]) => k === '20,70,20' && id === 4)) snap = s;
  } catch {} // 快照尚未落盘/写入中：继续轮询
}
assert('快照含 dimensionBlocks.nether 且有 A 的方块（3s 内落盘）',
  !!snap && snap.dimensionBlocks.nether.some(([k, id]) => k === '10,70,10' && id === 1));
assert('快照含 dimensionBlocks.overworld 且有 B 的方块',
  !!snap && snap.dimensionBlocks.overworld.some(([k, id]) => k === '20,70,20' && id === 4));

// ── Room.restore：旧平铺快照迁移进主世界桶 / 新分维快照直读 ─────────────
{
  const legacy = new Room('legacy-test', null, null);
  legacy.restore({
    seed: 1, time: 0.35,
    blocks: [['1,2,3', 5]],
    containers: [['4,5,6', new Array(27).fill(null).map((_, i) => (i === 0 ? { name: 'bread', count: 1 } : null))]],
    drops: [{ id: 9, name: 'dirt', count: 1, x: 0, y: 0, z: 0, spawnedAt: Date.now() }],
  });
  const ow = legacy.dimensionBlocks.get('overworld');
  assert('旧平铺快照迁移：overworld 桶含方块', !!ow && ow.get('1,2,3') === 5);
  const owc = legacy.dimensionContainers.get('overworld');
  assert('旧平铺快照迁移：overworld 桶含容器', !!owc && !!owc.get('4,5,6'));
  const dr = [...legacy.drops.values()][0];
  assert('旧掉落迁移：dim=overworld', dr && dr.dim === 'overworld');

  const mod = new Room('mod-test', null, null);
  mod.restore({
    seed: 2, time: 0.35,
    dimensionBlocks: { nether: [['7,8,9', 3]] },
    dimensionContainers: {},
    drops: [{ id: 5, name: 'stone', count: 1, x: 1, y: 1, z: 1, dim: 'nether', spawnedAt: Date.now() }],
  });
  assert('新分维快照直读：nether 桶含方块', mod.dimensionBlocks.get('nether')?.get('7,8,9') === 3);
  assert('新掉落恢复：dim=nether', [...mod.drops.values()][0]?.dim === 'nether');
}

// ── 汇总 ───────────────────────────────────────────────────────────────
const { total, passed } = counts();
console.log(passed < total ? `维度联机回归: ${passed}/${total} 通过（FAILED）` : `维度联机回归: ${passed}/${total} 通过`);
finish();
