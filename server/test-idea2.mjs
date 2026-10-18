// test-idea2.mjs -- Idea-2 服务器回归：箭矢/凋灵之首事件同步（转发 / 无回声 / 脏包丢弃）+ 潜影盒 data 通道
// 用法：node server/test-idea2.mjs   （先启动 server/index.mjs，端口 3001；跑批前清空 server/world/ 与 server/config.json）
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from './protocol.js';

const URL = 'ws://127.0.0.1:3001/ws';
const results = [];

function assert(name, cond, extra = '') {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const p = { ws, id: null, inbox: [], waiters: [], closed: false };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      p.inbox.push(m);
      for (let i = p.waiters.length - 1; i >= 0; i--) {
        if (p.waiters[i](m)) p.waiters.splice(i, 1);
      }
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, version: PROTOCOL_VERSION })));
    ws.on('message', function h(raw) {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome') {
        ws.off('message', h);
        p.id = m.selfId;
        resolve(p);
      }
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
    const t = setTimeout(() => resolve(null), timeout);
    p.waiters.push((m) => { if (pred(m)) { clearTimeout(t); resolve(m); return true; } return false; });
  });
}

// --- 用例：箭矢事件转发 ---
{
  const room = `i2-arrow-${Date.now()}`;
  const a = await connect('i2-甲');
  const b = await connect('i2-乙');

  send(a, 'create_room', { room, seed: 20260912, mode: 'survival' });
  const wa = await waitFor(a, (m) => m.t === 'room_created');
  assert('甲建房', !!wa);

  send(b, 'join_room', { room });
  const wb = await waitFor(b, (m) => m.t === 'welcome');
  assert('乙入房', !!wb);
  await sleep(200);
  b.inbox.length = 0; a.inbox.length = 0;

  // 甲射箭 → 乙收到初速；甲无回声
  const shot = { x: 1.5, y: 70.25, z: -3.75, dx: 19.6, dy: -2.8, dz: 0 };
  send(a, 'arrow_shot', shot);
  const got = await waitFor(b, (m) => m.t === 'arrow_shot');
  assert('乙收到 arrow_shot', !!got);
  assert('初速字段一致', !!got && Math.abs(got.x - shot.x) < 1e-6 && Math.abs(got.dx - shot.dx) < 1e-6 && Math.abs(got.dz - shot.dz) < 1e-6,
    got ? `x=${got.x} dx=${got.dx}` : '');
  assert('携带射者 id', !!got && got.id === a.id, got ? `id=${got.id}` : '');
  await sleep(300);
  assert('甲不收自己的箭（无回声）', !a.inbox.some((m) => m.t === 'arrow_shot'));

  // 脏包：非有限数值 → 服务器丢弃，乙不应收到
  b.inbox.length = 0;
  send(a, 'arrow_shot', { x: 'abc', y: 70, z: 0, dx: 1, dy: 1, dz: 1 });
  send(a, 'arrow_shot', { x: 1, y: 70, z: 0 });
  send(a, 'arrow_shot', { x: NaN, y: 70, z: 0, dx: 1, dy: 1, dz: 1 });
  await sleep(400);
  assert('脏包被服务器丢弃', !b.inbox.some((m) => m.t === 'arrow_shot'));

  // Idea-2D-②：凋灵之首同款事件转发（甲发 → 乙收初速 + 射者 id；甲无回声；脏包丢弃）
  const skull = { x: 2.5, y: 72.25, z: -4.75, dx: 15.2, dy: -1.4, dz: 3.2 };
  send(a, 'wither_skull', skull);
  const gotSkull = await waitFor(b, (m) => m.t === 'wither_skull');
  assert('乙收到 wither_skull', !!gotSkull);
  assert('凋灵之首初速字段一致', !!gotSkull && Math.abs(gotSkull.x - skull.x) < 1e-6 && Math.abs(gotSkull.dx - skull.dx) < 1e-6,
    gotSkull ? `x=${gotSkull.x} dx=${gotSkull.dx}` : '');
  assert('凋灵之首携带射者 id', !!gotSkull && gotSkull.id === a.id);
  b.inbox.length = 0;
  send(a, 'wither_skull', { x: 'abc', y: 70, z: 0, dx: 1, dy: 1, dz: 1 });
  send(a, 'wither_skull', { x: 1, y: Infinity, z: 0, dx: 1, dy: 1, dz: 1 });
  await sleep(400);
  assert('凋灵之首脏包被丢弃', !b.inbox.some((m) => m.t === 'wither_skull'));

  a.ws.close(); b.ws.close();
}

// --- 用例：内容跟随物品（Idea-2C 潜影盒）——掉落/容器 data 通道 ---
{
  const room = `i2-shulker-${Date.now()}`;
  const a = await connect('i2-甲2');
  const b = await connect('i2-乙2');

  send(a, 'create_room', { room, seed: 20260913, mode: 'survival' });
  await waitFor(a, (m) => m.t === 'room_created');
  send(b, 'join_room', { room });
  await waitFor(b, (m) => m.t === 'welcome');
  await sleep(200);
  b.inbox.length = 0; a.inbox.length = 0;

  const CONTENT = [null, { name: 'diamond', count: 3 }, null, { name: 'iron_ingot', count: 5 }];

  // 带内容的盒体掉落 → data 原样透传
  send(a, 'drop_spawn', { x: 1.5, y: 70, z: 1.5, name: 'shulker_box', count: 1, data: CONTENT });
  const got = await waitFor(b, (m) => m.t === 'drop_spawn' && m.name === 'shulker_box');
  assert('盒体掉落 data 原样透传', !!got && JSON.stringify(got.data) === JSON.stringify(CONTENT),
    got ? `slots=${JSON.stringify(got.data)}` : '');
  assert('盒体掉落账本带 data（回执含）', !!got && Array.isArray(got.data) && got.data.length === 4);

  // 嵌套 data（盒中盒）→ 服务器拒绝，降级为普通掉落（无 data 字段）
  b.inbox.length = 0;
  send(a, 'drop_spawn', { x: 1.5, y: 70, z: 1.5, name: 'shulker_box', count: 1,
    data: [null, { name: 'shulker_box', count: 1, data: [null] }] });
  await sleep(400);
  const nested = b.inbox.filter((m) => m.t === 'drop_spawn' && m.name === 'shulker_box');
  const bad = nested.find((m) => m.data);
  assert('嵌套 data 被拒（降级普通掉落）', nested.length >= 1 && !bad, `n=${nested.length}`);

  // 容器整箱同步带 data
  b.inbox.length = 0;
  send(a, 'container_set', { x: 5, y: 70, z: 5, items: CONTENT.map((s) => s ? { name: s.name, count: s.count, data: null } : null).concat(new Array(23).fill(null)) });
  const cs = await waitFor(b, (m) => m.t === 'container_set');
  assert('容器整箱同步到达', !!cs && Array.isArray(cs.items) && cs.items.length === 27);

  // 容器内潜影盒（data）经 sanitizeStack 保留
  const withBox = new Array(27).fill(null);
  withBox[3] = { name: 'shulker_box', count: 1, data: CONTENT };
  b.inbox.length = 0;
  send(a, 'container_set', { x: 6, y: 70, z: 6, items: withBox });
  const cs2 = await waitFor(b, (m) => m.t === 'container_set' && m.x === 6);
  const box = cs2 ? cs2.items[3] : null;
  assert('容器内盒体 data 保留', !!box && box.name === 'shulker_box' && JSON.stringify(box.data) === JSON.stringify(CONTENT),
    box ? JSON.stringify(box).slice(0, 80) : 'missing');

  a.ws.close(); b.ws.close();
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\nIdea-2 回归：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) { console.log('失败项：'); for (const [name] of failed) console.log('  - ' + name); process.exit(1); }
