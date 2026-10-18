// test-hardening-store.mjs -- S2/S3/S5 服务端加固回归（纯 node，不需要运行中的服务器）
// 用法：node server/test-hardening-store.mjs
// 覆盖：① 畸形快照 restore/loadRooms 不崩服（坏项跳过 + 坏档归档保留现场）
//       ② 生产落盘原子化（tmp + renameSync，覆盖写后内容完整、无 .tmp 残留）
//       ③ CREATE_ROOM hostId 守卫（host 在线不夺权 / 原 host 离线可接管，与 joinRoom 同口径）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from './room.js';
import * as store from './store.js';
import { assert, finish, counts, configure } from './test-lib.mjs';

configure({ style: 'bracket' });

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const serverWorld = path.join(SERVER_DIR, 'world');
const probeName = `hardening-probe-${process.pid}`;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-hardening-'));
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// ---- ① S2：畸形快照 restore 不抛异常、坏项跳过 ----
const origWarn = console.warn;
const origError = console.error;
const badSnaps = [
  ['外层非对象', 'not-an-object'],
  ['外层 null', null],
  ['外层 undefined', undefined],
  ['外层数组', [1, 2, 3]],
  ['entries 非数组', { name: 'x', seed: 1, dimensionBlocks: { overworld: 5 } }],
  ['containers 非数组', { name: 'x', seed: 1, dimensionContainers: { overworld: 5 } }],
  ['drops 非数组', { name: 'x', seed: 1, drops: { 1: {} } }],
  ['entries 内条目为 null', { name: 'x', seed: 1, dimensionBlocks: { overworld: [null] } }],
  ['V1 旧格式 blocks 非数组', { name: 'x', seed: 1, blocks: 7 }],
  ['V1 旧格式 containers 非数组', { name: 'x', seed: 1, blocks: [], containers: 'oops' }],
];
let threw = 0;
console.warn = () => {};
for (const [label, snap] of badSnaps) {
  try {
    new Room('bad-snap').restore(snap);
  } catch (e) {
    threw++;
    console.log(`  restore(${label}) 抛异常: ${e.constructor.name}: ${e.message}`);
  }
}
console.warn = origWarn;
assert('畸形快照 restore 全部不抛异常（S2 崩溃路径）', threw === 0, `抛异常 ${threw} 次`);

const mixed = new Room('mixed');
const warnsSeen = [];
let mixedThrew = false;
console.warn = (...a) => warnsSeen.push(a.join(' '));
try {
  mixed.restore({
    name: 'mixed', seed: 4242,
    dimensionBlocks: { overworld: [null, ['1,64,2', 5]], nether: 99 },
    dimensionContainers: { overworld: 'x' },
    drops: 'nope',
  });
} catch { mixedThrew = true; }
console.warn = origWarn;
assert('好桶 + 坏桶混合档不抛异常', !mixedThrew && mixed.seed === 4242);
assert('好桶保留、坏条目被过滤', mixed.dimensionBlocks.get('overworld')?.get('1,64,2') === 5 && mixed.dimensionBlocks.get('overworld').size === 1);
assert('坏桶被跳过（nether/容器/drops 均不进账本）', !mixed.dimensionBlocks.has('nether') && mixed.dimensionContainers.size === 0 && mixed.drops.size === 0);
assert('坏项有告警输出', warnsSeen.length >= 3, `warn ${warnsSeen.length} 条: ${warnsSeen[0] || ''}`);

// ---- ② S2/S3：loadRooms 对坏档归档（corrupt/）+ 报警 + 跳过 ----
const dir = path.join(tmpRoot, 'world');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'broken.json'), '{"name":"broken","seed":123,"drops":[{"id":1'); // 模拟写中途崩溃的截断档
fs.writeFileSync(path.join(dir, 'shapebad.json'), JSON.stringify({ name: 'shapebad', seed: 7, dimensionBlocks: { overworld: 5 } }));
const okRoom = new Room('okroom', (r) => store.saveRoom(r, dir));
okRoom.restore({ seed: 99, time: 0.5, blocks: [['1,2,3', 4]], drops: [] });
okRoom.save();

const logs = [];
let loadThrew = false;
let loaded = [];
console.error = (...a) => logs.push(a.join(' '));
try { loaded = store.loadRooms(dir); } catch { loadThrew = true; }
console.error = origError;
assert('loadRooms 不抛异常', !loadThrew);
assert('坏档被跳过、正常档照常加载', loaded.length === 1 && loaded[0].name === 'okroom', `返回 ${loaded.length} 条`);
assert('坏档报警（console.error）', logs.filter((l) => l.includes('坏档')).length === 2, logs.join(' | ').slice(0, 160));
const corruptDir = path.join(dir, 'corrupt');
const archived = fs.existsSync(corruptDir) ? fs.readdirSync(corruptDir) : [];
assert('归档目录位于 world 之下（<dir>/corrupt/）', archived.length === 2, archived.join(', '));
assert('归档保留现场（原名 + 时间戳）', archived.some((f) => f.startsWith('broken-')) && archived.some((f) => f.startsWith('shapebad-')));
assert('坏档已从 world 根移走', !fs.existsSync(path.join(dir, 'broken.json')) && !fs.existsSync(path.join(dir, 'shapebad.json')));
const shapeArchived = archived.find((f) => f.startsWith('shapebad-'));
assert('归档内容原样保留（可再解析）', !!readJson(path.join(corruptDir, shapeArchived)));

// 生产默认目录：server/world 下的坏档同样归档到 server/world/corrupt/（跑批 rm -rf server/world 一并清理）
fs.mkdirSync(serverWorld, { recursive: true });
fs.writeFileSync(path.join(serverWorld, probeName + '.json'), '{"name":"probe","seed":');
console.error = () => {};
try { store.loadRooms(); } catch { /* 兜底 */ }
console.error = origError;
const probeArchive = fs.existsSync(path.join(serverWorld, 'corrupt'))
  ? fs.readdirSync(path.join(serverWorld, 'corrupt')).find((f) => f.startsWith(probeName))
  : null;
assert('默认目录归档位于 server/world/corrupt/', !!probeArchive, String(probeArchive));

// ---- ③ S3：生产落盘路径原子化（tmp + renameSync） ----
const atomicDir = path.join(tmpRoot, 'atomic');
const room = new Room('原子世界', (r) => store.saveRoom(r, atomicDir));
room.restore({ seed: 5, time: 0.25, blocks: [['0,64,0', 9]], drops: [] });
room.save();
room.restore({ seed: 6, time: 0.75, blocks: [['0,64,0', 10], ['1,64,0', 11]], drops: [] });
room.save(); // 覆盖写：原子替换后必须是新的完整快照，而非截断/半旧半新
const worldFile = path.join(atomicDir, store.roomFileName('原子世界') + '.json');
const worldSnap = readJson(worldFile);
assert('saveRoom 覆盖写后内容完整（无截断）', !!worldSnap && worldSnap.seed === 6 && worldSnap.dimensionBlocks.overworld.length === 2, worldSnap ? 'seed=' + worldSnap.seed : '解析失败');

store.savePlayerProfiles('原子世界', { alice: { xp: 1 } }, atomicDir);
const profFile = path.join(atomicDir, 'players', store.roomFileName('原子世界') + '.players.json');
assert('savePlayerProfiles 落盘完整', readJson(profFile)?.alice?.xp === 1);

const bkFile = store.backupRoom(room, atomicDir);
const bkSnap = readJson(path.join(atomicDir, 'backups', bkFile));
assert('backupRoom 落盘完整', !!bkSnap && bkSnap.seed === 6 && bkSnap.name === '原子世界');

const tmpLeft = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.tmp')) tmpLeft.push(p);
  }
})(atomicDir);
assert('落盘后无 .tmp 残留', tmpLeft.length === 0, tmpLeft.join(', '));

const cfgTmp = path.join(tmpRoot, 'cfg.json');
store.writeFileAtomic(cfgTmp, '{"a":1}');
store.writeFileAtomic(cfgTmp, '{"a":2}');
assert('writeFileAtomic 覆盖写为最新完整内容 + 无 tmp 残留', fs.readFileSync(cfgTmp, 'utf8') === '{"a":2}' && !fs.existsSync(cfgTmp + '.tmp'));
const configSrc = fs.readFileSync(path.join(SERVER_DIR, 'config.js'), 'utf8');
assert('config.saveConfig 已改走原子写（无 writeFileSync 直写）', /writeFileAtomic\(CONFIG_PATH/.test(configSrc) && !/writeFileSync\(/.test(configSrc));

// ---- ④ S5：CREATE_ROOM hostId 守卫 ----
const hroom = new Room('host-guard');
hroom.sendTo = () => {};
hroom.broadcast = () => {};
const pA = { id: 1, name: 'A', mode: 'survival', dim: 'overworld', pos: { x: 0, y: 66, z: 0 }, selected: 0, heldItem: null };
const pB = { id: 2, name: 'B', mode: 'survival', dim: 'overworld', pos: { x: 1, y: 66, z: 1 }, selected: 0, heldItem: null };
hroom.players.set(pA.id, pA);
hroom.players.set(pB.id, pB);
hroom.createRoom(pA, { seed: 111, mode: 'survival', biomeScale: 'small' });
assert('首个创建者成为 host', hroom.hostId === pA.id);
const firstScale = hroom.biomeScale;
hroom.createRoom(pB, { seed: 222, mode: 'creative', biomeScale: 'large' });
assert('host 在线时二次 CREATE_ROOM 不夺权（S5）', hroom.hostId === pA.id, `hostId=${hroom.hostId}`);
assert('二次 CREATE_ROOM 不改 seed/biomeScale（仅首次固定）', hroom.seed === 111 && hroom.biomeScale === firstScale, `seed=${hroom.seed}`);
assert('非 host 仍在房内、模式按请求更新', hroom.players.size === 2 && pB.mode === 'creative');
hroom.hostId = 9999; // 原 host 已离线（不在 players 中，如重启后残留记录）
hroom.createRoom(pB, { seed: 333, mode: 'survival' });
assert('原 host 离线时 CREATE_ROOM 允许接管', hroom.hostId === pB.id, `hostId=${hroom.hostId}`);
const pC = { id: 3, name: 'C', mode: 'survival', dim: 'overworld', pos: { x: 2, y: 66, z: 2 }, selected: 0, heldItem: null };
hroom.players.set(pC.id, pC);
hroom.hostId = null;
hroom.joinRoom(pC, {});
assert('joinRoom 空位接管（与 createRoom 同口径）', hroom.hostId === pC.id, `hostId=${hroom.hostId}`);

// ---- 清理：只清本套件产生的文件 ----
fs.rmSync(tmpRoot, { recursive: true, force: true });
try {
  const cd = path.join(serverWorld, 'corrupt');
  if (fs.existsSync(cd)) {
    for (const f of fs.readdirSync(cd)) if (f.startsWith(probeName)) fs.unlinkSync(path.join(cd, f));
    if (fs.readdirSync(cd).length === 0) fs.rmdirSync(cd);
  }
  if (fs.readdirSync(serverWorld).length === 0) fs.rmdirSync(serverWorld); // 仅空目录才删，绝不动他人文件
} catch { /* 清理尽力而为 */ }

const { total, passed } = counts();
console.log(`---\n${passed}/${total} PASS`);
finish();
