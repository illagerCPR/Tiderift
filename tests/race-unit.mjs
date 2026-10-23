// tests/race-unit.mjs -- Build 34「C：御风竞速」赛道定义与顺序检查点判定确定性测试（纯 node，无服务器/无 DOM）
// 四组：字段清洗 / 赛道校验 / 赛道表与成绩存取 / 计时状态机（含乱序·折返·高速穿过·取消·超时）
import {
  RaceTracks, sanitizeTrack, cleanRaceName, cleanRaceMode, cleanRacePoint, cleanRaceMillis,
  racePointKey, raceRecordKey, trackLength, newRaceId, cleanRaceId,
  RACE_ID_RE, RACE_NAME_MAX, RACE_POINT_MAX, RACE_SEGMENT_MAX, RACE_TRACK_LIMIT, RACE_RECORD_LIMIT,
} from '../src/core/RaceTracks.js';
import {
  RaceRun, pointSegmentDistance, formatRaceTime, RACE_TRIGGER_RADIUS, RACE_ARM_TIMEOUT_MS,
} from '../src/core/RaceRun.js';
import { ok, finish, configure } from './harness.mjs';

configure({ verbose: true });

const POINTS = [{ x: 0, y: 64, z: 0 }, { x: 100, y: 64, z: 0 }, { x: 100, y: 64, z: 100 }];
const rawTrack = (over = {}) => ({
  id: 'race01', name: '测试赛道', dim: 'overworld', mode: 'glide', revision: 1, points: POINTS, ...over,
});
const makeTrack = (over = {}) => sanitizeTrack(rawTrack(over));

// ── 一、字段清洗 ─────────────────────────────────────────────────────
ok(cleanRaceName('  风之试炼  ') === '风之试炼', '名称去首尾空白');
ok(cleanRaceName('a\u0000b\u001fc') === 'a b c', '控制字符压成空格', cleanRaceName('a\u0000b\u001fc'));
ok(cleanRaceName('   ') === '' && cleanRaceName(null) === '' && cleanRaceName(42) === '', '空名/非字符串归一为空串');
ok([...cleanRaceName('一'.repeat(RACE_NAME_MAX + 8))].length === RACE_NAME_MAX, '名称按字符截断到上限');
ok(cleanRaceMode('free') === 'free' && cleanRaceMode('glide') === 'glide', '合法模式保留');
ok(cleanRaceMode('nope') === 'glide' && cleanRaceMode(undefined) === 'glide', '非法模式回落御风');
ok(cleanRacePoint({ x: 1, y: 64, z: -2 }).x === 1, '合法点位保留');
ok(cleanRacePoint({ x: 1.5, y: 64, z: 0 }) === null, '非整数点位拒绝（不静默取整）');
ok(cleanRacePoint({ x: 0, y: 300, z: 0 }) === null && cleanRacePoint({ x: 0, y: -1, z: 0 }) === null, '高度越界拒绝');
ok(cleanRacePoint({ x: 30000001, y: 64, z: 0 }) === null, '世界坐标越界拒绝');
ok(cleanRacePoint(null) === null && cleanRacePoint('0,0,0') === null, '非对象点位拒绝');
ok(racePointKey({ x: 3, y: 4, z: 5 }) === '3,4,5', '点位键格式');
ok(cleanRaceMillis(1000) === 1000 && cleanRaceMillis(3600000) === 3600000, '成绩上下界内保留');
ok(cleanRaceMillis(999) === 0 && cleanRaceMillis(3600001) === 0, '成绩越界归零');
ok(cleanRaceMillis('abc') === 0 && cleanRaceMillis(null) === 0 && cleanRaceMillis(Infinity) === 0, '非数成绩归零');
ok(cleanRaceMillis(1234.6) === 1235, '成绩四舍五入到整数毫秒');
const id = newRaceId();
ok(RACE_ID_RE.test(id), '新赛道 id 合法', id);
ok(cleanRaceId(id) === id && cleanRaceId('AB') === '' && cleanRaceId(123) === '', 'id 清洗');
ok(raceRecordKey('race01', 2, 'p3') === 'race01#2#p3', '成绩键格式');

// ── 二、赛道校验：任一项不合规整条拒绝 ────────────────────────────────
ok(makeTrack() !== null, '合法赛道通过');
ok(trackLength(makeTrack()) === 200, '赛道全长 = 相邻点距离之和', String(trackLength(makeTrack())));
ok(sanitizeTrack(rawTrack({ name: '' })) === null, '空名拒绝');
ok(sanitizeTrack(rawTrack({ dim: 'moon' })) === null, '未知维度拒绝');
ok(sanitizeTrack(rawTrack({ id: 'X' })) === null, '非法 id 拒绝');
ok(sanitizeTrack(rawTrack({ points: POINTS.slice(0, 2) })) === null, '少于 3 个点位拒绝');
const many = Array.from({ length: RACE_POINT_MAX + 1 }, (_, i) => ({ x: i * 10, y: 64, z: 0 }));
ok(sanitizeTrack(rawTrack({ points: many })) === null, '超过点位上拒绝');
ok(sanitizeTrack(rawTrack({ points: [{ x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: 0 }, { x: 10, y: 64, z: 0 }] })) === null, '相邻重复点拒绝');
ok(sanitizeTrack(rawTrack({ points: [{ x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: RACE_SEGMENT_MAX + 1 }, { x: 0, y: 64, z: RACE_SEGMENT_MAX + 20 }] })) === null, '单段超长拒绝');
ok(sanitizeTrack(rawTrack({ points: 'x' })) === null && sanitizeTrack(null) === null, '非数组点位/非对象拒绝');
ok(sanitizeTrack(rawTrack({ byId: 7 })).byId === '7', '数字 byId 归一为字符串（服务器 player.id 是数字）');
ok(sanitizeTrack(rawTrack({ revision: 0 })).revision === 1, '修订号下限为 1');

// ── 三、赛道表与成绩存取 ─────────────────────────────────────────────
const table = new RaceTracks(null);
table.reset({ tracks: [rawTrack()], records: [[raceRecordKey('race01', 1, ''), 61000, '']] });
ok(table.size === 1 && table.get('race01') !== null, '赛道载入');
ok(table.best('race01', 1, '') === 61000, '个人最佳载入');
ok(table.list('overworld').length === 1 && table.list('aether').length === 0, '按维度过滤');
table.applyTrack(rawTrack({ revision: 2, name: '改名' }));
ok(table.size === 1 && table.get('race01').revision === 2 && table.get('race01').name === '改名', '同 id 就地覆盖而非追加');
ok(table.best('race01', 2, '') === null, '新修订没有旧成绩（编辑后旧成绩不充当新纪录）');
ok(table.submitBest('race01', 2, 50000, '').isBest, '首次成绩即最佳');
ok(!table.submitBest('race01', 2, 60000, '').isBest && table.best('race01', 2, '') === 50000, '更慢不覆盖');
ok(table.submitBest('race01', 2, 40000, '').isBest && table.best('race01', 2, '') === 40000, '更快覆盖');
ok(!table.submitBest('race01', 2, 999, '').accepted, '越界成绩不接收');
table.setRecord('race01', 2, 'p2', 45000, 'Bob');
const roomBest = table.roomBest('race01', 2, '');
ok(roomBest && roomBest.ms === 45000 && roomBest.name === 'Bob', '房间最佳排除本人记录');
const solo = new RaceTracks(null);
solo.setRecord('race01', 2, 'p2', 45000, 'Bob');
ok(solo.roomBest('race01', 2, 'p2') === null, '只有自己时不产生房间最佳');
const roundTrip = new RaceTracks(null);
roundTrip.reset(table.serialize());
ok(JSON.stringify(roundTrip.serialize()) === JSON.stringify(table.serialize()), '序列化往返一致');
const removed = new RaceTracks(null);
removed.reset(table.serialize());
ok(removed.remove('race01') && removed.size === 0 && removed.best('race01', 2, '') === null, '删除赛道连带清成绩');
ok(!removed.remove('race01'), '重复删除返回 false');
const limited = new RaceTracks(null);
for (let i = 0; i < RACE_TRACK_LIMIT; i++) {
  ok(limited.applyTrack(rawTrack({ id: 'r' + String(i).padStart(6, '0') })) !== null, '赛道上限内可追加 ' + i);
}
ok(limited.applyTrack(rawTrack({ id: 'rover01' })) === null, '超出赛道上限拒绝');
ok(limited.size === RACE_TRACK_LIMIT, '上限内数量正确');
const recordLimited = new RaceTracks(null);
for (let i = 0; i < RACE_RECORD_LIMIT; i++) recordLimited.setRecord('race01', 1, 'p' + i, 60000 + i, '');
ok(recordLimited.records.size === RACE_RECORD_LIMIT, '成绩条数上限');
ok(recordLimited.setRecord('race01', 1, 'overflow', 60000, '') === null, '超上限的新成绩拒绝');

// ── 四、计时状态机 ───────────────────────────────────────────────────
const track = makeTrack();
const run = new RaceRun(track, { now: 0, pos: { x: 0.5, y: 64, z: 0.5 } });
ok(run.state === 'armed' && run.active, '报名后处于待出发');
ok(run.checkpointTotal === 1, '检查点数 = 点位数 - 2', String(run.checkpointTotal));
let events = run.update(10, { x: 0.5, y: 64, z: 0.5 });
ok(events.length === 1 && events[0].type === 'start', '穿过起点即开始计时');
ok(run.state === 'running', '状态进入计时中');
events = run.update(1000, { x: 100, y: 64, z: 100 });
ok(events.length === 0, '乱序：直接冲到终点不算数（当前应过检查点 1）');
events = run.update(2000, { x: 100, y: 64, z: 0 });
ok(events.length === 1 && events[0].type === 'checkpoint' && events[0].index === 1, '按顺序过检查点');
ok(run.checkpointsPassed === 1 && run.isNextFinish(), '下一目标变为终点');
events = run.update(2500, { x: 100, y: 64, z: 0 });
ok(events.length === 0, '重复触碰已过的检查点无效');
events = run.update(2990, { x: 100, y: 64, z: 100 });
ok(events.length === 1 && events[0].type === 'finish' && events[0].elapsed === 2980, '终点结算用时（起点 10ms）', String(events[0].elapsed));
ok(run.state === 'finished' && !run.active, '完赛后不再计时');
ok(run.update(4000, { x: 0, y: 64, z: 0 }).length === 0, '完赛后的事件被忽略');

// 折返：过检查点后走回头路，不重复计入
const back = new RaceRun(track, { now: 0, pos: { x: 0.5, y: 64, z: 0.5 } });
back.update(10, { x: 0.5, y: 64, z: 0.5 });
back.update(20, { x: 100, y: 64, z: 0 });
const backEvents = back.update(30, { x: 0.5, y: 64, z: 0.5 });
ok(backEvents.length === 0 && back.checkpointsPassed === 1, '折返不重复计入检查点');

// 高速穿过（掉帧/滑翔）：一帧跨过 200 格仍命中检查点
const fast = new RaceRun(track, { now: 0, pos: { x: 0.5, y: 64, z: 0.5 } });
fast.update(10, { x: 0.5, y: 64, z: 0.5 });
const fastEvents = fast.update(20, { x: 200, y: 64, z: 0 });
ok(fastEvents.length === 1 && fastEvents[0].type === 'checkpoint', '一帧跨过 100 格仍命中线段穿过的检查点');

// 偏离：擦肩而过 20 格不算
const miss = new RaceRun(track, { now: 0, pos: { x: 0.5, y: 64, z: 0.5 } });
miss.update(10, { x: 0.5, y: 64, z: 0.5 });
ok(miss.update(20, { x: 100, y: 64, z: 20 }).length === 0, '偏离超过触发半径不命中');

// 取消 / 超时 / 创造模式标记
const cancelled = new RaceRun(track, { now: 0, pos: { x: 0.5, y: 64, z: 0.5 } });
cancelled.update(10, { x: 0.5, y: 64, z: 0.5 });
ok(cancelled.cancel('暂停') && cancelled.state === 'cancelled' && cancelled.reason === '暂停', '取消记录原因');
ok(!cancelled.cancel('死亡'), '重复取消无效');
ok(cancelled.update(20, { x: 100, y: 64, z: 0 }).length === 0, '取消后不再判定');
const timedOut = new RaceRun(track, { now: 0, pos: { x: 500, y: 64, z: 500 } });
const timeoutEvents = timedOut.update(RACE_ARM_TIMEOUT_MS + 1, { x: 500, y: 64, z: 500 });
ok(timeoutEvents.length === 1 && timeoutEvents[0].type === 'timeout' && timedOut.state === 'cancelled', '待出发超时自动取消');
const assisted = new RaceRun(track, { now: 0, pos: { x: 0, y: 64, z: 0 }, assisted: true });
ok(assisted.assisted === true, '创造/旁观尝试带 assisted 标记');
ok(pointSegmentDistance(0, 0, 0, -10, 0, 0, 10, 0, 0) === 0, '点到线段距离（垂足在内）');
ok(Math.abs(pointSegmentDistance(5, 0, 0, 0, 0, 0, 10, 0, 0)) < 1e-9, '点到线段距离（垂足在内为 0）');
ok(Math.abs(pointSegmentDistance(20, 0, 0, 0, 0, 0, 10, 0, 0) - 10) < 1e-9, '点到线段距离（线段外截断到端点）');
ok(formatRaceTime(0) === '0:00.000' && formatRaceTime(61234) === '1:01.234', '用时格式化', formatRaceTime(61234));
ok(RACE_TRIGGER_RADIUS > 0, '触发半径为正');

finish('race-unit');
