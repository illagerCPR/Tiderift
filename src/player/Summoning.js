// Summoning.js -- 手工召唤链路：铁傀儡 / 凋灵 T 型结构判定（L12 域，自 Game.js 迁出）
//
// Game 侧保留同名薄门面（_trySummonIronGolem / _trySummonWither），外部依赖面不变。
// 凋灵的「头层由放置物决定」判定**刻意留在 Game 门面**：头颅是 B28 四朝向家族，判层必须
// 按家族判 —— tests/build28-block-textures.mjs:266-269 把 isSkull 家族判定与判层那两行
// 字面钉在 Game.js 文本上，整段搬走即红（轮 8 路标 C 的 tests 绊线清单已列明）。
//
// 生命周期：**构造器共享型**——无 Three 资源 / 无 DOM / 无监听器，_disposeWorld 无收口义务。
// world / mobManager / chatBox 一律在调用点经 this.game 现取，不留构造期快照：
// 这三者都是「每次 start() 新建」的，快照会指向已销毁的上一存档对象。

import { BlockRegistry } from '../core/BlockRegistry.js';
import { BLOCK_CENTER } from './constants.js';
import { t } from '../i18n/index.js';

export class Summoning {
  constructor(game) {
    this.game = game;
  }

  // Idea-2E：铁傀儡召唤检测——南瓜头 + 2 格铁块身柱 + 双臂铁块（原版 T 型）。
  // 只在本地放置成功路径调用（联机远端方块变更不检测，防多端重复召唤）；
  // 命中则移除 5 块（走 setBlock 自动广播）并就地召唤护卫（联机经 mob_spawn 回执全端创建）。
  trySummonIronGolem(x, y, z) {
    const g = this.game;
    if (!g.world || !g.mobManager) return false;
    const IRON = BlockRegistry.getId('iron_block');
    const PUMPKIN = BlockRegistry.getId('pumpkin');
    if (!IRON || !PUMPKIN) return false;
    const get = (bx, by, bz) => g.world.getBlock(bx, by, bz);
    // 推定南瓜头位置：本次放的是头 / 柱底（头在其上 2 格）/ 柱中或臂（头在其上 1 格）
    const placed = get(x, y, z);
    let hx = x, hy = y, hz = z;
    if (placed === PUMPKIN) {
      // 本次放的是头
    } else if (placed === IRON && get(x, y + 1, z) === IRON && get(x, y + 2, z) === PUMPKIN) {
      hy = y + 2;
    } else if (placed === IRON && get(x, y - 1, z) === IRON && get(x, y + 1, z) === PUMPKIN) {
      hy = y + 1;
    } else {
      return false;
    }
    // 身柱 2 格 + 双臂各 1（臂与身上段同层）
    if (get(hx, hy - 1, hz) !== IRON || get(hx, hy - 2, hz) !== IRON) return false;
    if (get(hx - 1, hy - 1, hz) !== IRON || get(hx + 1, hy - 1, hz) !== IRON) return false;
    for (const [bx, by, bz] of [[hx, hy, hz], [hx, hy - 1, hz], [hx, hy - 2, hz], [hx - 1, hy - 1, hz], [hx + 1, hy - 1, hz]]) {
      g.world.setBlock(bx, by, bz, 0);
    }
    g.mobManager._spawnAt('iron_golem', hx + BLOCK_CENTER, hy - 2 + 0.1, hz + BLOCK_CENTER);
    if (g.chatBox) g.chatBox.add(t('铁傀儡从方块中苏醒了…'), '#cfc');
    return true;
  }

  // Idea-2D-②：凋灵结构扫描（原版 T 型 / 兼容平铺两层）。
  // 枚举：轴向 x/z × 头排起点 [-3,3]（宽枚举无害，校验保证正确性）。
  // 命中返回待清除块与召唤点；isSkull 由调用方注入（家族判定口径留在 Game 门面）。
  // 返回 null 表示该层位该形状不匹配。
  scanWitherShape(x, y, z, ty, shape, SAND, isSkull) {
    const get = (bx, by, bz) => this.game.world.getBlock(bx, by, bz);
    for (const [ax, az] of [[1, 0], [0, 1]]) {       // 水平轴向：x / z
      for (let h0 = -3; h0 <= 3; h0++) {             // 头排起点相对放置点（沿轴标量）
        const hx = x + ax * h0, hz = z + az * h0;
        let ok = true;
        for (let i = 0; i < 3 && ok; i++) if (!isSkull(get(hx + ax * i, ty, hz + az * i))) ok = false;
        if (!ok) continue;
        if (shape === 'flat') {                      // 兼容平铺：沙排 4 连，头排左/右两种对齐
          for (const off of [0, -1]) {
            const bx0 = hx + ax * off, bz0 = hz + az * off;
            let ok2 = true;
            for (let i = 0; i < 4 && ok2; i++) if (get(bx0 + ax * i, ty - 1, bz0 + az * i) !== SAND) ok2 = false;
            if (!ok2) continue;
            const blocks = [];
            for (let i = 0; i < 3; i++) blocks.push([hx + ax * i, ty, hz + az * i]);
            for (let i = 0; i < 4; i++) blocks.push([bx0 + ax * i, ty - 1, bz0 + az * i]);
            return { blocks, cx: bx0 + ax * 1.5, cz: bz0 + az * 1.5, sy: ty };
          }
        } else {                                     // 原版 T：沙排 3 连同列 + 柱底在沙排中列下方一层
          let ok2 = true;
          for (let i = 0; i < 3 && ok2; i++) if (get(hx + ax * i, ty - 1, hz + az * i) !== SAND) ok2 = false;
          if (!ok2) continue;
          if (get(hx + ax, ty - 2, hz + az) !== SAND) continue;
          const blocks = [];
          for (let i = 0; i < 3; i++) blocks.push([hx + ax * i, ty, hz + az * i]);
          for (let i = 0; i < 3; i++) blocks.push([hx + ax * i, ty - 1, hz + az * i]);
          blocks.push([hx + ax, ty - 2, hz + az]);
          return { blocks, cx: hx + ax + BLOCK_CENTER, cz: hz + az + BLOCK_CENTER, sy: ty - 1 };
        }
      }
    }
    return null;
  }

  // 命中落地：移除结构块（setBlock 自动广播账本）并就地召唤凋灵。
  commitWitherSummon(hit) {
    const g = this.game;
    if (!hit) return false;
    for (const [bx, by, bz] of hit.blocks) g.world.setBlock(bx, by, bz, 0);
    g.mobManager._spawnAt('wither', hit.cx, hit.sy + 0.1, hit.cz);
    if (g.chatBox) g.chatBox.add(t('凋灵从方块中苏醒了…'), '#c9c');
    return true;
  }
}
