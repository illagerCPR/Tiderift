// tests/waymarks-unit.mjs -- Build 34「B：旧航路修复」航标进度与塔身份确定性测试（纯 node，无服务器/无 DOM）
// 六组：阶段定义 / 键与清洗 / 递增一次性 / 序列化往返与上限 / 材料缺口 / 塔身份与下一座航路确定性
import '../src/blocks/BlockDefs.js';
import '../src/world/structures/catalog.js';
import { AetherGenerator } from '../src/world/dimensions/aether.js';
import {
  Waymarks, WAYMARK_STAGES, WAYMARK_LIMIT, WAYMARK_STAGE_LIMIT, WAYMARK_NAME_MAX,
  waymarkKey, isValidWaymarkKey, cleanWaymarkStage, cleanWaymarkName, waymarkStageDef,
} from '../src/core/Waymarks.js';
import { ok, finish, configure } from './harness.mjs';

configure({ verbose: true });

// ── 一、阶段定义 ─────────────────────────────────────────────────────
ok(WAYMARK_STAGES.length === WAYMARK_STAGE_LIMIT, '三阶段定义与上限一致');
ok(WAYMARK_STAGES.every((d, i) => d.stage === i + 1), '阶段编号从 1 连续递增');
ok(WAYMARK_STAGES.every((d) => d.title && d.hint), '每阶段都有标题与说明');
ok(WAYMARK_STAGES.every((d) => Array.isArray(d.needs) && d.needs.length > 0), '每阶段都有材料需求');
ok(WAYMARK_STAGES.every((d) => d.needs.every((n) => typeof n.name === 'string' && n.name && Number.isInteger(n.count) && n.count > 0)), '材料条目形状合法');
ok(waymarkStageDef(1) === WAYMARK_STAGES[0] && waymarkStageDef(3) === WAYMARK_STAGES[2], 'waymarkStageDef 按阶段取定义');
ok(waymarkStageDef(0) === null && waymarkStageDef(4) === null, '越界阶段返回 null');

// ── 二、键与清洗 ─────────────────────────────────────────────────────
ok(waymarkKey(224, -448) === '224,-448', '锚点键格式');
ok(waymarkKey(12.7, -0.2) === '12,-1', '锚点键向下取整（负值同样 floor）', waymarkKey(12.7, -0.2));
ok(isValidWaymarkKey('0,0') && isValidWaymarkKey('-1234,5678'), '合法键通过');
ok(!isValidWaymarkKey('12') && !isValidWaymarkKey('1.5,2') && !isValidWaymarkKey('a,b') && !isValidWaymarkKey(''), '非法键拒绝');
ok(!isValidWaymarkKey(12) && !isValidWaymarkKey(null), '非字符串键拒绝');
ok(cleanWaymarkStage(1) === 1 && cleanWaymarkStage(3) === 3, '合法阶段保留');
ok(cleanWaymarkStage(0) === 0 && cleanWaymarkStage(4) === 0 && cleanWaymarkStage(-2) === 0 && cleanWaymarkStage('x') === 0, '越界/非数阶段归零');
ok(cleanWaymarkName('  Alice  ') === 'Alice', '归属名去空白');
ok(cleanWaymarkName('a\u0000b\u001fc').length === 3, '归属名去控制字符');
ok(cleanWaymarkName('x'.repeat(80)).length === WAYMARK_NAME_MAX, '归属名截断到上限');

// ── 三、递增与一次性 ─────────────────────────────────────────────────
const w = new Waymarks(null);
ok(w.stageAt(224, -448) === 0, '未记录锚点阶段为 0');
ok(w.setStage(224, -448, 1, 'Alice') === true, '首次写入成功');
ok(w.stageAt(224, -448) === 1, '写入后可读回');
ok(w.setStage(224, -448, 1, 'Bob') === false, '同阶段重复写入被拒（一次性语义）');
ok(w.setStage(224, -448, 0, 'Bob') === false, '阶段不得回退到 0');
ok(w.setStage(224, -448, 2, 'Bob') === true && w.stageAt(224, -448) === 2, '阶段可递增');
ok(w.setStage(224, -448, 3, 'Bob') === true && w.isRepaired(224, -448), '第三阶段后标记为已修复');
ok(w.setStage(224, -448, 1, 'Carl') === false && w.isRepaired(224, -448), '已修复后不接受旧阶段');
ok(w.entries().length === 1 && w.entries()[0].byName === 'Bob', 'entries 反映最终归属');

// ── 四、序列化往返、清洗与上限 ───────────────────────────────────────
const round = new Waymarks(null);
round.setStage(10, 20, 2, 'Ann');
round.setStage(-30, 40, 3, 'Ben');
const restored = new Waymarks(null).reset(round.serialize());
ok(restored.stageAt(10, 20) === 2 && restored.stageAt(-30, 40) === 3, '序列化往返保留阶段');
ok(restored.entries()[0].byName === 'Ann', '序列化往返保留归属名');

const dirty = new Waymarks(null).reset({
  towers: {
    'bad-key': { stage: 1 },
    '1,2': { stage: 9 },
    '3,4': { stage: 0 },
    '5,6': { stage: 1, byName: 'Ok' },
    '7,8': 2,
  },
});
ok(dirty.stageAt(5, 6) === 1 && dirty.entries().length === 2, '坏项跳过、合法项与旧扁平格式保留', String(dirty.entries().length));
ok(dirty.stageAt(1, 2) === 0 && dirty.stageAt(3, 4) === 0, '越界阶段被丢弃');
ok(new Waymarks(null).reset(null).entries().length === 0, 'null 回落空进度（旧档兼容）');
ok(new Waymarks(null).reset('oops').entries().length === 0, '非对象回落空进度');

const capped = new Waymarks(null);
for (let i = 0; i < WAYMARK_LIMIT + 20; i++) capped.setStage(i * 16, 0, 1, '');
ok(capped.entries().length === WAYMARK_LIMIT, '账本上限生效', String(capped.entries().length));
ok(capped.setStage(999999, 0, 1, '') === false, '超限后拒绝新锚点');
ok(capped.setStage(0, 0, 2, '') === true, '超限后仍可推进已有锚点');

// ── 五、材料缺口 ─────────────────────────────────────────────────────
const inv = { slots: [{ name: 'glowstone', count: 4 }, { name: 'compass', count: 1 }, { name: 'iron_ingot', count: 2 }] };
const needs1 = w.missingFor(1, inv);
ok(needs1.length === 0, '阶段一材料齐备');
const needs2 = w.missingFor(2, inv);
ok(needs2.length === 1 && needs2[0].name === 'iron_ingot' && needs2[0].have === 2 && needs2[0].count === 4, '阶段二缺口精确到剩余数量');
ok(w.missingFor(3, { slots: [] }).length === 2, '空背包时阶段三报出全部缺口');
ok(w.missingFor(4, inv).length === 0, '越界阶段不报缺口');
ok(w.missingFor(1, null).length === 1, '无背包时视为全缺');
ok(w.missingFor(1, { slots: [{ name: 'glowstone', count: 2 }, { name: 'glowstone', count: 2 }] }).length === 0, '多槽同物品累加');

// ── 六、塔身份与下一座航路（同种子双端一致）────────────────────────────
const SEED = 12345;
function towerFrom(gen, x, z, r = 4) {
  return gen.structureManager.recordsAround('aether_tower', x, z, r);
}
const genA = new AetherGenerator(SEED);
const genB = new AetherGenerator(SEED);
const towersA = towerFrom(genA, 5000, 5000);
ok(towersA.length > 0, '种子 12345 在 5000,5000 附近存在瞭望塔', String(towersA.length));
const towersB = towerFrom(genB, 5000, 5000);
ok(JSON.stringify(towersA.map((r) => [r.ax, r.az, r.groundY])) === JSON.stringify(towersB.map((r) => [r.ax, r.az, r.groundY])),
  '同种子两端解出完全相同的塔锚点与地面高度');

const tower = towersA[0];
const smA = genA.structureManager;
ok(smA.waymarkTowerAt(tower.ax, tower.groundY + 10, tower.az) === tower, '塔心航标位命中该塔记录');
ok(smA.waymarkTowerAt(tower.ax + 3, tower.groundY + 11, tower.az + 3) === tower, '四角荧石命中该塔记录');
ok(smA.waymarkTowerAt(tower.ax + 5, tower.groundY + 11, tower.az) === null, '偏离角位的荧石不命中（自建荧石塔不被识别）');
ok(smA.waymarkTowerAt(tower.ax + 3, tower.groundY + 10, tower.az + 3) === null, '高度不符的角位不命中');
ok(smA.towerRecordAt(tower.ax, tower.az) === tower, '按锚点取回塔记录（联机回执定位用）');
ok(smA.towerRecordAt(tower.ax + 16, tower.az) !== tower, '错误锚点取不到该塔');

const nextA = smA.nextTowerFrom(tower.ax, tower.az);
ok(nextA !== null, '修复完成后能找到下一座瞭望塔');
ok(nextA && !(nextA.ax === tower.ax && nextA.az === tower.az), '下一座塔不是当前塔');
const nextB = genB.structureManager.nextTowerFrom(tower.ax, tower.az);
ok(nextA && nextB && nextA.ax === nextB.ax && nextA.az === nextB.az, '同种子两端选出同一座下一塔（导航确定性）');
ok(smA.nextTowerFrom(tower.ax, tower.az, 0) === null, '半径为 0 时如实返回 null（不伪造目标）');

finish('waymarks-unit');
