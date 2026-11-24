// tide_workshop.js -- 潮工断坊（B53 R4）：主世界地表的小型潮工遗迹
// 内容：塌了一半的砖砌工坊（11×9 地基 + 三面残墙）、中央被锯断的"轴"基座、
//      东侧工作台残骸、碎石锈痕、两盏火把、一只箱子（tide_workshop 表）与一块四格石碑。
// 纪律：
//   ① requiresExtras = ['industry']——只有启用工业的世界才参与锚点求值，
//      关闭时本类型整体不激活（旧世界的结构随机流与 Build 52 逐字节一致）。
//   ② 自带独立 salt / 独立锚点网格，不与村庄、要塞、潮冢等既有类型共流。
//   ③ 布局只由 (seed, 锚点 cell) 决定：rng 抽取顺序固定，任意端/任意顺序逐字节一致。
//   ④ 遗迹**不是机器主线的解锁点**：机器靠配方与材料就能做，断坊只给叙述、材料与形制参考。
import { blockId } from './StructureManager.js';
import { clearBox } from './StructureKit.js';
import { steleStack } from '../steles.js';

const CELL = 20;      // 20 区块网格（320 格）：比潮冢(28)常见，比村庄(各类型自定)稀疏
const SALT = 8419;    // 与既有类型错开（7266/7267/7388/8419 为新增一批）
const CHANCE = 0.3;   // 单次尝试通过概率（哈希门控）

export const TIDE_WORKSHOP_DEF = {
  cell: CELL,
  attempts: 2,
  chance: CHANCE,
  radius: 16,        // 覆盖 11×9 地基与四格石碑
  // 断坊体量小：探针环按 11×9 足迹收窄（默认 16/28 会在丘陵上几乎全部落选），
  // 坡度容差放宽到 5——断坊本来就该塌在斜坡上
  probeR: [10, 14],
  maxSlope: 5,
  salt: SALT,
  dims: ['overworld'],
  requiresExtras: ['industry'],
  solve: solveWorkshop,
};

export function solveWorkshop(rng, ax, groundY, az) {
  const BRICK = blockId('stone_bricks');
  const CRACK = blockId('cracked_stone_bricks');
  const MOSSY_BRICK = blockId('mossy_stone_bricks');
  const MOSSY = blockId('mossy_cobblestone');
  const COBBLE = blockId('cobblestone');
  const GRAVEL = blockId('gravel');
  const CHEST = blockId('chest');
  const TORCH = blockId('torch');
  const y0 = groundY;
  const blocks = [];
  const meta = { kind: 'tide_workshop', center: [ax, y0, az], chests: [], steles: [] };

  // rng 抽样：砖/裂砖/苔砖三选一（抽取顺序固定 = 确定性）
  const brick = () => {
    const r = rng();
    if (r < 0.45) return BRICK;
    if (r < 0.8) return CRACK;
    return MOSSY_BRICK;
  };

  // ① 清腔：把建筑带里的草/花/雪清掉（不碰地板以下）
  clearBox(blocks, ax - 5, y0 + 1, az - 4, ax + 5, y0 + 3, az + 4);

  // ② 地基 11×9：砖面，12% 塌成洞（露出下面的土）
  for (let dx = -5; dx <= 5; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      if (rng() < 0.12) {
        blocks.push([ax + dx, y0, az + dz, 0]);
        continue;
      }
      blocks.push([ax + dx, y0, az + dz, brick()]);
    }
  }

  // ③ 残墙：北墙（缺口在 dx=+2、东段只剩半高）+ 东西墙（缺口在 dz=0、两端半高），南面敞开
  for (let dx = -5; dx <= 5; dx++) {
    if (dx === 2) continue;
    const top = dx > 3 ? y0 + 1 : y0 + 2;
    for (let y = y0 + 1; y <= top; y++) blocks.push([ax + dx, y, az - 4, brick()]);
  }
  for (let dz = -4; dz <= 4; dz++) {
    if (dz === 0) continue;
    const top = (dz < -2 || dz > 2) ? y0 + 1 : y0 + 2;
    for (let y = y0 + 1; y <= top; y++) {
      blocks.push([ax - 5, y, az + dz, brick()]);
      blocks.push([ax + 5, y, az + dz, brick()]);
    }
  }

  // ④ 断轴：工坊中央的基座 + 断口（纯装饰——不是能用的工业方块，别在这里放 tide 机器）
  blocks.push([ax, y0 + 1, az, BRICK]);
  blocks.push([ax, y0 + 2, az, CRACK]);

  // ⑤ 工作台残骸：东侧 2×2 圆石台
  for (const [dx, dz] of [[2, 1], [3, 1], [2, 2], [3, 2]]) blocks.push([ax + dx, y0, az + dz, COBBLE]);

  // ⑥ 碎石与苔痕：固定点位（不耗 rng，免得改密度时整片布局漂移）
  for (const [dx, dz, id] of [[-4, -3, MOSSY], [-3, 3, GRAVEL], [4, -3, COBBLE], [1, 3, MOSSY], [-2, 2, GRAVEL], [4, 3, MOSSY]]) {
    blocks.push([ax + dx, y0 + 1, az + dz, id]);
  }

  // ⑦ 两盏火把：贴北墙内侧（断坊自己还留着一点光）
  blocks.push([ax - 3, y0 + 2, az - 3, TORCH]);
  blocks.push([ax + 4, y0 + 2, az - 3, TORCH]);

  // ⑧ 箱子（tide_workshop 表：铁/铜/煤/红石 + 桶保底）+ 四格石碑（潮工纪）
  meta.chests.push([ax - 4, y0 + 1, az + 3, 'tide_workshop']);
  meta.steles.push([ax + 3, y0 + 1, az + 3, 'tideworks']);
  for (const s of meta.steles) {
    for (const [bx, by, bz, bid] of steleStack(s[0], s[1], s[2], 'overworld')) blocks.push([bx, by, bz, bid]);
  }
  for (const c of meta.chests) blocks.push([c[0], c[1], c[2], CHEST]);

  return { blocks, meta };
}
