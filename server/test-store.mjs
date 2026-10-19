// test-store.mjs -- 世界落盘模块往返测试（阶段 3，不依赖运行中的服务器）
// 用法：node server/test-store.mjs
// 验证 store.saveRoom / store.loadRooms / Room.restore 的序列化往返与过期清理
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Room } from './room.js';
import * as store from './store.js';
import { assert, finish, counts } from './test-lib.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-world-'));

// 造一个房间并写入若干状态（onSave 用临时目录）
const room = new Room('测试世界', (r) => store.saveRoom(r, dir));
room.restore({
  seed: 777, time: 0.5, nextDropId: 3, nextMobId: 2,
  blocks: [['10,64,20', 1]],
  drops: [{ id: 1, x: 1, y: 2, z: 3, name: 'stone', count: 2, spawnedAt: Date.now() }],
});
room.save();

assert('落盘文件存在', fs.existsSync(path.join(dir, store.roomFileName('测试世界') + '.json')));
const loaded = store.loadRooms(dir);
assert('恢复出 1 个房间', loaded.length === 1);
const r = loaded[0];
assert('恢复 seed=777', r.seed === 777);
assert('恢复 time=0.5', r.time === 0.5);
assert('恢复 nextDropId=3', r.nextDropId === 3);
assert('恢复 nextMobId=2', r.nextMobId === 2);
assert('恢复方块账本（旧版平铺格式迁移到 overworld 桶）', Array.isArray(r.dimensionBlocks?.overworld) && r.dimensionBlocks.overworld.length === 1 && r.dimensionBlocks.overworld[0][1] === 1);
assert('恢复掉落物', Array.isArray(r.drops) && r.drops.length === 1 && r.drops[0].name === 'stone');

// Room.restore 完整还原成可用房间对象
const revived = new Room('测试世界', null);
revived.restore(r);
assert('restore 后 blocks Map 有 1 项', revived.dimensionBlocks.get('overworld')?.size === 1 && revived.dimensionBlocks.get('overworld').get('10,64,20') === 1);
assert('restore 后 drops Map 有 1 项', revived.drops.size === 1 && revived.drops.get(1).count === 2);
assert('restore 后 hostId 复位为 null(由新玩家接管)', revived.hostId === null);

// 显式空气账本通过真实文件写入/读取往返，且不改变旧版平铺格式迁移覆盖。
const airRoom = new Room('空气世界', (r) => store.saveRoom(r, dir));
airRoom.restore({ seed: 778, dimensionBlocks: { overworld: [['11,64,20', 0]] } });
airRoom.save();
const loadedAir = store.loadRooms(dir).find((entry) => entry.name === '空气世界');
assert('JSON 文件落盘与读取保留显式空气值 0',
  loadedAir?.dimensionBlocks?.overworld?.some(([key, id]) => key === '11,64,20' && id === 0));
const revivedAir = new Room('空气世界', null);
revivedAir.restore(loadedAir);
assert('恢复空气世界后账本仍有显式 0',
  revivedAir.dimensionBlocks.get('overworld')?.has('11,64,20') &&
  revivedAir.dimensionBlocks.get('overworld')?.get('11,64,20') === 0);

// 过期掉落物在恢复时被丢弃（5 分钟）
const room2 = new Room('过期世界', () => {});
room2.restore({
  seed: 1, time: 0.35, nextDropId: 2, nextMobId: 1, blocks: [],
  drops: [{ id: 5, x: 0, y: 0, z: 0, name: 'iron_ingot', count: 1, spawnedAt: Date.now() - 400000 }],
});
assert('过期掉落物被丢弃', room2.drops.size === 0);

// 房间名 -> 文件名安全化
assert('房间名安全化', store.roomFileName('a/b\\c:*.json') === 'a_b_c___json');
assert('空房间名回退 default', store.roomFileName('') === 'default');
assert('中文房间名保留', store.roomFileName('测试世界') === '测试世界');

fs.rmSync(dir, { recursive: true, force: true });
const { total, passed } = counts();
console.log(`---\n${passed}/${total} PASS`);
finish();
