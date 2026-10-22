// tests/journal-unit.mjs -- Build 34「A：四界游记」Journal 数据模型确定性单元测试（纯 node，无服务器/无 DOM）
// 七组：deserialize 清洗 / 幂等 / 上限 / 序列化往返 / observe 揭图 / 标记 / isExplored 边界
import { Journal } from '../src/core/Journal.js';
import { ok, finish, configure } from './harness.mjs';

configure({ verbose: true });

const DIMS = ['overworld', 'nether', 'end', 'aether'];
const CELL_LIMIT = 12000;
const DISCOVERY_LIMIT = 512;
const MARKER_LIMIT = 64;
const SHARED_MARKER_LIMIT = 256;
const COORD_LIMIT = 30000000;

// 最小 game 桩：observe 只读 game.world?.generator?.getBiome(x, z)
function gameStub(biome = 'plains') {
  const sample = typeof biome === 'function' ? biome : () => biome;
  return { world: { generator: { getBiome: sample } } };
}

function makeJournal(biome) {
  return new Journal(gameStub(biome));
}

// 稳定序列化：对象键排序后比较，避免插入顺序造成假红
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function isBlank(j) {
  return DIMS.every((d) => j.explored[d] instanceof Map && j.explored[d].size === 0) &&
    j.discoveries.length === 0 &&
    j.readSteles.size === 0 &&
    j.markers.length === 0 &&
    j.sharedMarkers.length === 0 &&
    Object.keys(j.lastPosition).length === 0;
}

function cellsOf(j, dim) {
  return [...j.explored[dim].keys()];
}

// ── 一、deserialize 清洗：脏数据丢弃、缺字段回落空游记 ──
for (const raw of [null, undefined, 0, '', 'not-an-object', 42, true]) {
  const j = makeJournal();
  j.deserialize(raw);
  ok(isBlank(j), '一·非对象 raw 回落空游记：' + String(raw));
}

{
  const j = makeJournal();
  j.deserialize([1, 2, 3]);
  ok(isBlank(j), '一·数组 raw 无嵌套字段时回落空游记');
}

{
  const j = makeJournal();
  ok(isBlank(j), '一·构造函数默认空游记');
  ok(DIMS.every((d) => j.explored[d] instanceof Map), '一·explored 按四个已实现维度分桶');
  ok(Object.keys(j.explored).length === 4, '一·explored 只含已实现维度');
}

{
  const j = makeJournal();
  j.deserialize({ version: 1 });
  ok(isBlank(j), '一·旧存档缺字段（仅 version）回落空游记');
}

{
  const j = makeJournal();
  j.deserialize({
    explored: { bogus: '1,2,plains' },
    discoveries: [{ dim: 'bogus', type: 'ruin', x: 0, z: 0 }],
    markers: [{ id: 'm', dim: 'bogus', x: 0, y: 0, z: 0, label: 'L' }],
    lastPosition: { bogus: { x: 1, z: 2 } },
  });
  ok(isBlank(j) && !('bogus' in j.explored), '一·非法维度（未实现/未知 dim）字段整体丢弃');
}

{
  const j = makeJournal();
  j.deserialize({
    explored: { overworld: 123, nether: {}, end: null, aether: true },
    discoveries: 'nope', readSteles: { a: 1 }, markers: 7, lastPosition: 'x',
  });
  ok(isBlank(j), '一·字段类型错误（explored 桶非字符串/数组、其余非数组或非对象）整体忽略');
}

{
  const j = makeJournal();
  j.deserialize({ explored: { overworld: [
    '1,2,plains',
    '3,4',
    '5,6,PLAINS',
    '#,7,plains',
    '99999999,1,plains',
    '7,8,oak',
  ].join(';') } });
  ok(stableJson(cellsOf(j, 'overworld')) === stableJson(['1,2', '7,8']),
    '一·explored 字符串行校验列数/群系码/36 进制坐标/格坐标边界');
}

{
  const j = makeJournal();
  j.deserialize({ explored: { nether: [[1, 2, 'plains'], [3, 4], [5.5, 6, 'x'], 'nope', [7, 8, 'BAD!'], [9, 10, 'oak']] } });
  ok(stableJson(cellsOf(j, 'nether')) === stableJson(['1,2', '9,10']),
    '一·explored 数组行丢弃非整数坐标与非法群系码');
}

{
  const j = makeJournal();
  j.deserialize({ discoveries: [
    null, 42, {},
    { dim: 'bogus', type: 'ruin', x: 0, z: 0 },
    { dim: 'overworld', type: 123, x: 0, z: 0 },
    { dim: 'overworld', type: 'ruin', x: NaN, z: 0 },
    { dim: 'overworld', type: 'ruin', x: Infinity, z: 0 },
    { dim: 'overworld', type: 'ruin', x: COORD_LIMIT + 1, z: 0 },
    { dim: 'overworld', type: 'ruin', x: 5, z: 6, label: 'ok' },
  ] });
  ok(j.discoveries.length === 1 && j.discoveries[0].x === 5 && j.discoveries[0].label === 'ok',
    '一·discoveries 脏条目（非对象/非法维度/类型错/非有限或越界坐标）全部丢弃');
}

{
  const j = makeJournal();
  j.deserialize({ discoveries: [
    { dim: 'overworld', type: 'ruin', x: 10.2, z: 3.9, label: 'a' },
    { dim: 'overworld', type: 'ruin', x: 10.8, z: 3.1, label: 'b' },
  ] });
  ok(j.discoveries.length === 1 && j.discoveries[0].label === 'a',
    '一·deserialize 内同 (dim,type,floor 坐标) 的重复发现只保留首条');
}

{
  const j = makeJournal();
  j.deserialize({ readSteles: ['ok_id', 'Bad Id', 'x'.repeat(50), 123, 'a-b_c', ''] });
  ok(stableJson([...j.readSteles]) === stableJson(['ok_id', 'a-b_c']),
    '一·readSteles 只接受 1-40 位小写 id 模式');
}

{
  const j = makeJournal();
  j.deserialize({ markers: [
    null,
    { id: 'm1', dim: 'bogus', x: 0, y: 0, z: 0, label: 'L' },
    { id: 'm2', dim: 'overworld', x: 0, y: 0, z: 0, label: '' },
    { id: 'm3', dim: 'overworld', x: NaN, y: 0, z: 0, label: 'L' },
    { id: 'm4', dim: 'overworld', x: 0, y: COORD_LIMIT + 1, z: 0, label: 'L' },
    { id: 'm5', dim: 'overworld', x: 1, y: 2, z: 3, label: 'ok', color: 'red' },
  ] });
  ok(j.markers.length === 1 && j.markers[0].id === 'm5' && j.markers[0].color === '#f4ca64',
    '一·markers 脏条目被丢弃，非法 color 回落默认色');
}

{
  const j = makeJournal();
  j.deserialize({
    discoveries: [{ dim: 'overworld', type: 'ru\u0001in', x: 1, z: 2, label: 'a\u0000b\u001fc\u007f' }],
    markers: [{ id: 'm\u0002k', dim: 'overworld', x: 0, y: 0, z: 0, label: '\u0007标\u0000记' }],
  });
  ok(j.discoveries[0].type === 'ruin' && j.discoveries[0].label === 'abc',
    '一·发现类型与标签剥离控制字符');
  ok(j.markers[0].id === 'mk' && j.markers[0].label === '标记',
    '一·标记 id 与标签剥离控制字符');
}

{
  const j = makeJournal();
  j.deserialize({
    discoveries: [{ dim: 'overworld', type: 't'.repeat(60), x: 1, z: 2, label: 'L'.repeat(60) }],
    markers: [{ id: 'i'.repeat(60), dim: 'overworld', x: 0, y: 0, z: 0, label: 'M'.repeat(60) }],
  });
  ok(j.discoveries[0].type.length === 32 && j.discoveries[0].label.length === 48,
    '一·发现类型截断 32 字符、标签截断 48 字符');
  ok(j.markers[0].id.length === 48 && j.markers[0].label.length === 48,
    '一·标记 id 截断 48 字符、标签截断 48 字符');
}

{
  const j = makeJournal();
  j.deserialize({ lastPosition: {
    overworld: { x: 5, z: 6, y: 99 },
    nether: { x: NaN, z: 0 },
    end: 'str',
    aether: { x: COORD_LIMIT + 1, z: 0 },
    bogus: { x: 1, z: 2 },
  } });
  ok(stableJson(j.lastPosition) === stableJson({ overworld: { x: 5, z: 6 } }),
    '一·lastPosition 只保留已实现维度的有限 x/z 且丢弃多余字段');
}
// ── 二、幂等：重复记录不入列 ──
{
  const j = makeJournal();
  ok(j.recordDiscovery('overworld', 'ruin', 10.4, 20.7, '遗迹') === true, '二·首次记录发现返回 true');
  ok(j.recordDiscovery('overworld', 'ruin', 10.9, 20.1, '重复') === false, '二·同 (dim,type,floor 坐标) 再次记录返回 false');
  ok(j.discoveries.length === 1, '二·重复发现不重复入列');
  ok(j.recordDiscovery('overworld', 'ruin', 11.0, 20.7, '邻格') === true, '二·floor 坐标不同视为新发现');
  ok(j.recordDiscovery('nether', 'ruin', 10.4, 20.7, '异维') === true, '二·不同维度同坐标视为新发现');
  ok(j.recordDiscovery('overworld', 'tower', 10.4, 20.7, '异型') === true, '二·不同类型同坐标视为新发现');
  ok(j.discoveries.length === 4, '二·四类键互不冲突');
}

{
  const j = makeJournal();
  ok(j.recordStele('aether-ch1') === true, '二·首次记录碑文返回 true');
  ok(j.recordStele('aether-ch1') === false && j.readSteles.size === 1, '二·同 id 碑文重复记录返回 false 且不重复入列');
  ok(j.recordStele('Bad Id') === false && j.recordStele('') === false && j.recordStele(123) === false,
    '二·非法碑文 id 一律返回 false');
}

{
  const source = makeJournal();
  source.observe('overworld', 100, 200);
  source.recordDiscovery('overworld', 'ruin', 10, 20, '遗迹');
  source.recordStele('ow-ch1');
  source.addMarker('overworld', 1, 2, 3, '家');
  const raw = source.serialize();
  const j = makeJournal();
  j.reset(raw);
  j.reset(raw);
  ok(j.discoveries.length === 1 && j.markers.length === 1 && j.readSteles.size === 1,
    '二·同一存档经 reset 连续载入两次不产生重复条目');
  ok(j.explored.overworld.size === source.explored.overworld.size, '二·重复载入后探索格数量不变');
}

{
  const source = makeJournal();
  source.observe('nether', 32, -48);
  source.recordDiscovery('nether', 'fortress', 33, -47, '要塞');
  source.recordStele('ne-ch1');
  source.addMarker('nether', 8, 70, -9, '营地');
  const first = source.serialize();
  const reloaded = makeJournal();
  reloaded.reset(first);
  ok(stableJson(reloaded.serialize()) === stableJson(first), '二·往返后再次序列化与原序列化逐字段一致');
}

{
  const raw = {
    explored: { overworld: '5,11,plains' },
    discoveries: [{ dim: 'overworld', type: 'ruin', x: 1, z: 2, label: 'a' }],
    readSteles: ['ow-ch1'],
    markers: [{ id: 'm1', dim: 'overworld', x: 0, y: 0, z: 0, label: 'L' }],
  };
  const j = makeJournal();
  j.deserialize(raw);
  const once = { cells: j.explored.overworld.size, steles: j.readSteles.size };
  j.deserialize(raw);
  ok(j.explored.overworld.size === once.cells && j.readSteles.size === once.steles,
    '二·重复 deserialize 时探索格与已读碑文保持幂等');
}

// ── 三、上限：超限丢弃最旧 ──
{
  const rows = [];
  for (let i = 0; i < CELL_LIMIT; i++) rows.push([i, 0, 'plains']);
  const j = makeJournal();
  j.deserialize({ explored: { overworld: rows } });
  ok(j.explored.overworld.size === CELL_LIMIT, '三·探索格恰好 CELL_LIMIT 时全部保留');
  j.observe('overworld', 5000 * 16, 5000 * 16);
  ok(j.explored.overworld.size === CELL_LIMIT, '三·observe 越过 CELL_LIMIT 后仍回收至上限');
  ok(!j.explored.overworld.has('0,0') && !j.explored.overworld.has('8,0'), '三·超上限时丢弃最旧的探索格');
  ok(j.explored.overworld.has('9,0'), '三·未越线的较早格保留');
  ok(j.explored.overworld.has('5000,5000'), '三·新揭开的格保留');
}

{
  const rows = [];
  for (let i = 0; i < CELL_LIMIT + 5; i++) rows.push(i.toString(36) + ',0,plains');
  const j = makeJournal();
  j.deserialize({ explored: { overworld: rows.join(';') } });
  ok(j.explored.overworld.size === CELL_LIMIT && !j.explored.overworld.has('0,0') && j.explored.overworld.has('5,0'),
    '三·explored 字符串桶超 CELL_LIMIT 时只保留最后 CELL_LIMIT 行');
}

{
  const j = makeJournal();
  for (let i = 0; i < DISCOVERY_LIMIT + 3; i++) j.recordDiscovery('overworld', 'ruin', i, 0, 'x' + i);
  ok(j.discoveries.length === DISCOVERY_LIMIT, '三·discoveries 超过 DISCOVERY_LIMIT 时回收至上限');
  ok(j.discoveries[0].x === 3 && j.discoveries[DISCOVERY_LIMIT - 1].x === DISCOVERY_LIMIT + 2,
    '三·discoveries 超上限时丢弃最早条目');
}

{
  const j = makeJournal();
  for (let i = 0; i < MARKER_LIMIT + 3; i++) j.addMarker('overworld', i, 64, 0, 'm' + i);
  ok(j.markers.length === MARKER_LIMIT, '三·markers 超过 MARKER_LIMIT 时回收至上限');
  ok(j.markers[0].label === 'm3' && j.markers[MARKER_LIMIT - 1].label === 'm' + (MARKER_LIMIT + 2),
    '三·markers 超上限时丢弃最早标记');
}

{
  const j = makeJournal();
  for (let i = 0; i < SHARED_MARKER_LIMIT + 4; i++) {
    j.upsertSharedMarker({ id: 's' + i, dim: 'overworld', x: i, y: 0, z: 0, label: 'L' + i });
  }
  ok(j.sharedMarkers.length === SHARED_MARKER_LIMIT, '三·sharedMarkers 超过 SHARED_MARKER_LIMIT 时回收至上限');
  ok(j.sharedMarkers[0].id === 's4', '三·sharedMarkers 超上限时丢弃最早条目');
}

{
  const j = makeJournal();
  for (let i = 0; i < DISCOVERY_LIMIT + 8; i++) j.recordStele('st' + i);
  ok(j.readSteles.size === DISCOVERY_LIMIT && !j.readSteles.has('st0') && j.readSteles.has('st8'),
    '三·readSteles 超过 DISCOVERY_LIMIT 时丢弃最早 id');
}
function pickDiscovery(d) {
  return { dim: d.dim, type: d.type, x: d.x, z: d.z, label: d.label };
}

// ── 四、往返：serialize → 新实例 deserialize ──
{
  const source = makeJournal();
  source.observe('overworld', 100, -200);
  source.observe('aether', 320, 512);
  source.recordDiscovery('aether', 'aether_tower', 320.6, -63.2, '潮塔');
  source.recordStele('ae-ch1');
  const marker = source.addMarker('nether', 8, 70, -9, '据点');
  source.setSharedMarkers([{ id: 'room-1', dim: 'overworld', x: 1, y: 2, z: 3, label: '共享', ownerId: 4, owner: 'alice' }]);
  const raw = source.serialize();
  ok(raw.version === 1, '四·序列化版本号为 1');
  ok(!('sharedMarkers' in raw), '四·序列化不含 sharedMarkers（房间账本另行承载）');

  const restored = makeJournal();
  restored.deserialize(raw);
  ok(DIMS.every((d) => stableJson([...restored.explored[d].entries()]) === stableJson([...source.explored[d].entries()])),
    '四·探索格（Map）跨序列化往返一致');
  ok(stableJson(restored.discoveries.map(pickDiscovery)) === stableJson(source.discoveries.map(pickDiscovery)),
    '四·发现条目（维度/类型/坐标/标签）往返一致');
  ok(stableJson([...restored.readSteles]) === stableJson([...source.readSteles]), '四·已读碑文往返一致');
  ok(stableJson(restored.markers) === stableJson(source.markers) && restored.markers[0].id === marker.id,
    '四·个人标记往返一致（含 id 与颜色）');
  ok(stableJson(restored.lastPosition) === stableJson(source.lastPosition), '四·lastPosition 往返一致');
  ok(restored.sharedMarkers.length === 0, '四·共享标记不进入个人存档，载入后为空');
  ok(stableJson(restored.serialize()) === stableJson(raw), '四·往返后再次序列化与原存档逐字段一致');
}

{
  const j = makeJournal();
  j.explored.overworld.set('-5,-7', 'plains');
  j.explored.overworld.set('3,4', 'desert');
  const raw = j.serialize();
  ok(raw.explored.overworld === '-5,-7,plains;3,4,desert',
    '四·explored 序列化为 cx36,cz36,群系 的分号压缩串（负坐标保留符号）');
  const back = makeJournal();
  back.deserialize(raw);
  ok(stableJson([...back.explored.overworld.entries()]) === stableJson([...j.explored.overworld.entries()]),
    '四·压缩串反解析后格键与群系一致');
  ok(back.serialize().explored.overworld === raw.explored.overworld, '四·压缩串反解析后再序列化逐字符一致');
}

// ── 五、observe：跨格揭图、非法入参、lastPosition ──
{
  const j = makeJournal('plains');
  ok(j.observe('overworld', 100, 200) === true, '五·首次跨入新格返回 true');
  ok(j.explored.overworld.size === 9, '五·首次抵达揭开 3×3 格');
  ok(['5,11', '5,12', '5,13', '6,11', '6,12', '6,13', '7,11', '7,12', '7,13']
    .every((k) => j.explored.overworld.has(k)), '五·揭开的格为当前格及其八邻域');
  ok(j.explored.overworld.get('6,12') === 'plains', '五·格群系写入小写群系码');
}

{
  const samples = [];
  const j = new Journal(gameStub((sx, sz) => { samples.push([sx, sz]); return 'Ocean'; }));
  j.observe('overworld', 100, 200);
  ok(samples.length === 9, '五·每揭开一格采样一次群系');
  ok(samples[0][0] === 5 * 16 + 8 && samples[0][1] === 11 * 16 + 8, '五·群系采样点为格中心 ((cx+0.5)*16)');
  ok([...j.explored.overworld.values()].every((b) => b === 'ocean'), '五·群系名统一转小写码');
}

{
  const j = makeJournal();
  j.observe('overworld', 100, 200);
  ok(j.observe('overworld', 108, 200) === false, '五·同格内（含其它坐标）再次调用返回 false');
  ok(j.explored.overworld.size === 9, '五·同格重复调用不新增格');
  ok(j.observe('overworld', 116, 200) === true, '五·跨入相邻格返回 true');
  ok(j.explored.overworld.size === 12, '五·跨格只新增与既有 3×3 不重叠的 3 格');
  ok(!j.explored.overworld.has('4,11') && j.explored.overworld.has('8,12'), '五·新增格位于移动方向新列');
}

{
  const j = makeJournal();
  ok(j.observe('bogus', 0, 0) === false, '五·非法维度返回 false');
  ok(j.observe('overworld', NaN, 0) === false && j.observe('overworld', 0, Infinity) === false,
    '五·非有限坐标返回 false');
  ok(j.observe('overworld', COORD_LIMIT + 1, 0) === false, '五·越界 x 返回 false');
  ok(j.observe('overworld', 0, -(COORD_LIMIT + 1)) === false, '五·越界 z 返回 false');
  ok(Object.keys(j.lastPosition).length === 0 && j.explored.overworld.size === 0,
    '五·非法调用既不写 lastPosition 也不揭开格');
}

{
  const j = makeJournal();
  j.observe('overworld', 100, 200);
  ok(stableJson(j.lastPosition.overworld) === stableJson({ x: 100, z: 200 }), '五·lastPosition 记录当前维度原始坐标');
  j.observe('overworld', 101, 201);
  ok(stableJson(j.lastPosition.overworld) === stableJson({ x: 101, z: 201 }), '五·同格重复调用也更新 lastPosition');
  j.observe('nether', 7, 8);
  ok(j.lastPosition.overworld.x === 101 && stableJson(j.lastPosition.nether) === stableJson({ x: 7, z: 8 }),
    '五·lastPosition 按维度分别记录');
}

{
  const j = makeJournal();
  j.observe('overworld', 0, 0);
  j.observe('nether', 0, 0);
  j.observe('end', 0, 0);
  j.observe('aether', 0, 0);
  ok(DIMS.every((d) => j.explored[d].size === 9), '五·四个维度分别揭图互不影响');
}

{
  const j = new Journal(gameStub(() => 'Nether Wastes'));
  j.observe('nether', 0, 0);
  ok([...j.explored.nether.values()].every((b) => b === 'unknown'), '五·返回的群系码不合规时回落 unknown');
  const k = new Journal({});
  k.observe('end', 0, 0);
  ok(k.explored.end.size === 9 && [...k.explored.end.values()].every((b) => b === 'unknown'),
    '五·game 无世界生成器桩时回落 unknown 而不抛异常');
}
// ── 六、标记：个人标记与房间共享标记 ──
{
  const j = makeJournal();
  const marker = j.addMarker('overworld', 12.5, 64, -30.5, '家');
  ok(marker !== null && j.markers.length === 1, '六·addMarker 合法参数入列并返回标记');
  ok(Object.keys(marker).join(',') === 'id,dim,x,y,z,label,color', '六·标记字段恰为 id/dim/x/y/z/label/color');
  ok(/^p-[0-9a-z]+-[0-9a-z]{0,5}$/.test(marker.id), '六·标记 id 非空且形如 p-<时间戳36>-<随机段>');
  ok(marker.color === '#f4ca64', '六·标记颜色取默认值');
  ok(marker.x === 12.5 && marker.y === 64 && marker.z === -30.5 && marker.label === '家', '六·标记保留原始坐标与标签');
}

{
  const j = makeJournal();
  ok(j.addMarker('bogus', 0, 0, 0, 'x') === null, '六·addMarker 非法维度返回 null');
  ok(j.addMarker('overworld', COORD_LIMIT + 1, 0, 0, 'x') === null, '六·addMarker 越界 x 返回 null');
  ok(j.addMarker('overworld', 0, NaN, 0, 'x') === null, '六·addMarker 非有限 y 返回 null');
  ok(j.addMarker('overworld', 0, 0, Infinity, 'x') === null, '六·addMarker 非有限 z 返回 null');
  ok(j.addMarker('overworld', 0, 0, 0, '   ') === null, '六·addMarker 空白标签返回 null');
  ok(j.addMarker('overworld', 0, 0, 0, '\u0000\u0001') === null, '六·addMarker 纯控制字符标签返回 null');
  ok(j.markers.length === 0, '六·addMarker 失败不写入任何标记');
}

{
  const j = makeJournal();
  const m = j.addMarker('overworld', 1, 2, 3, ' \u0007' + 'x'.repeat(60));
  ok(m.label.length === 48 && m.label.startsWith('xxxx'), '六·addMarker 标签剥离控制字符并截断 48');
  ok(!('ownerId' in m) && !('owner' in m), '六·个人标记不带 ownerId/owner 字段');
}

{
  const j = makeJournal();
  const a = j.addMarker('overworld', 1, 2, 3, 'a');
  const b = j.addMarker('nether', 4, 5, 6, 'b');
  ok(j.removeMarker('missing-id') === false, '六·removeMarker 不存在的 id 返回 false');
  ok(j.markers.length === 2, '六·removeMarker 失败不破坏其它标记');
  ok(j.removeMarker(a.id) === true, '六·removeMarker 命中返回 true');
  ok(j.markers.length === 1 && j.markers[0].id === b.id, '六·removeMarker 只删除目标标记并保留其余');
}

{
  const j = makeJournal();
  j.setSharedMarkers([
    { id: 'a', dim: 'overworld', x: 1, y: 2, z: 3, label: 'A' },
    { id: 'b', dim: 'nether', x: 4, y: 5, z: 6, label: 'B' },
  ]);
  ok(j.sharedMarkers.length === 2, '六·setSharedMarkers 载入房间标记');
  j.setSharedMarkers([{ id: 'c', dim: 'end', x: 7, y: 8, z: 9, label: 'C' }]);
  ok(j.sharedMarkers.length === 1 && j.sharedMarkers[0].id === 'c', '六·setSharedMarkers 是覆盖语义（旧集合整体替换）');
  j.setSharedMarkers('not-an-array');
  ok(j.sharedMarkers.length === 0, '六·setSharedMarkers 非数组清空共享标记');
}

{
  const j = makeJournal();
  ok(j.upsertSharedMarker({ id: 'a', dim: 'overworld', x: 1, y: 2, z: 3, label: 'A' }) === true,
    '六·upsertSharedMarker 新增返回 true');
  const before = j.sharedMarkers.length;
  ok(j.upsertSharedMarker({ id: 'a', dim: 'nether', x: 9, y: 8, z: 7, label: 'A2' }) === true,
    '六·upsertSharedMarker 同 id 更新返回 true');
  ok(j.sharedMarkers.length === before && j.sharedMarkers[0].label === 'A2' && j.sharedMarkers[0].x === 9,
    '六·upsertSharedMarker 同 id 原地更新而非追加');
  ok(j.upsertSharedMarker({ dim: 'overworld', x: 0, y: 0, z: 0, label: 'no-id' }) === false,
    '六·upsertSharedMarker 缺 id 返回 false');
  ok(j.upsertSharedMarker({ id: 'bad', dim: 'bogus', x: 0, y: 0, z: 0, label: 'L' }) === false,
    '六·upsertSharedMarker 脏数据返回 false');
  ok(j.sharedMarkers.length === before, '六·upsertSharedMarker 失败不改动现有集合');
}

{
  const j = makeJournal();
  j.setSharedMarkers([
    { id: 'a', dim: 'overworld', x: 0, y: 0, z: 0, label: 'A', ownerId: 7, owner: '  al\u0000ice  ' },
    { id: 'b', dim: 'overworld', x: 0, y: 0, z: 0, label: 'B', ownerId: 1.5, owner: 'n'.repeat(40) },
    { id: 'c', dim: 'overworld', x: 0, y: 0, z: 0, label: 'C', ownerId: '9', owner: 12 },
  ]);
  ok(j.sharedMarkers[0].ownerId === 7 && j.sharedMarkers[0].owner === 'alice',
    '六·共享标记保留合法 ownerId/owner 并剥离控制字符');
  ok(j.sharedMarkers[1].ownerId === 0, '六·共享标记非整数 ownerId 回落 0');
  ok(j.sharedMarkers[1].owner.length === 24, '六·共享标记 owner 截断 24 字符');
  ok(j.sharedMarkers[2].ownerId === 0 && j.sharedMarkers[2].owner === '12',
    '六·共享标记字符串 ownerId 与数字 owner 归一清洗');
}

{
  const j = makeJournal();
  j.addMarker('overworld', 1, 2, 3, '个人');
  j.upsertSharedMarker({ id: 'r1', dim: 'overworld', x: 1, y: 2, z: 3, label: '共享' });
  ok(j.markers.length === 1 && j.sharedMarkers.length === 1, '六·个人标记与共享标记分列存储互不干扰');
  j.removeSharedMarker('r1');
  ok(j.sharedMarkers.length === 0 && j.markers.length === 1, '六·removeSharedMarker 只移除房间标记');
}

// ── 七、isExplored 边界 ──
{
  const j = makeJournal();
  ok(j.isExplored('overworld', 0, 0) === false, '七·未探索格返回 false');
  ok(j.isExplored('bogus', 0, 0) === false, '七·未知/未实现维度返回 false');
  j.observe('overworld', 100, 200);
  ok(j.isExplored('overworld', 6, 12) === true, '七·已揭开格返回 true');
  ok(j.isExplored('overworld', 5, 11) === true, '七·八邻域格同样命中');
  ok(j.isExplored('nether', 6, 12) === false, '七·同格坐标在未探索维度返回 false');
  ok(j.isExplored('overworld', 100, 200) === false, '七·isExplored 取格坐标而非世界坐标');
  ok(j.isExplored('overworld', 4, 12) === false, '七·已揭区域之外的相邻列不命中');
}

{
  const j = makeJournal();
  j.observe('overworld', -1, -1);
  ok(j.isExplored('overworld', -1, -1) === true && j.isExplored('overworld', -2, 0) === true,
    '七·负格坐标可命中');
  ok(j.isExplored('overworld', 0, 0) === true && j.isExplored('overworld', 1, 1) === false,
    '七·负格揭图边界止于 0 格');
}

finish('journal-unit');
