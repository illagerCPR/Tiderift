// BlockDefs.js -- 方块定义 + 对应 SVG 生成
// 程序化生成 16x16 SVG，全部内联，无外部图片
// 阶段 9：材质重绘——原版配色校准 + 结构化像素画（砖缝/木板拼条/圆石砌块/年轮/矿石晶簇），
// 注册名 / textures key / SVG 管线保持不变，仅替换纹理生成实现。
import { BlockRegistry } from '../core/BlockRegistry.js';
import { SVGTextures } from '../render/SVGTextures.js';
import { doorClosedShape, doorOpenShape, trapdoorShape, BED_SHAPE } from '../core/blockShape.js';

const { pixelSvg, rng } = SVGTextures;

// ---------- 像素画基础工具 ----------
function makeTex() { return new Array(256).fill(null); }

function setPx(px, x, y, c) {
  if (x >= 0 && x < 16 && y >= 0 && y < 16) px[y * 16 + x] = c;
}

function fillRect(px, x0, y0, x1, y1, c) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPx(px, x, y, c);
}

// [r,g,b] × f → 'rgb(...)' 字符串
function rgb(c, f = 1) {
  const r = Math.max(0, Math.min(255, Math.round(c[0] * f)));
  const g = Math.max(0, Math.min(255, Math.round(c[1] * f)));
  const b = Math.max(0, Math.min(255, Math.round(c[2] * f)));
  return `rgb(${r},${g},${b})`;
}

// 确定性散列 [0,1)（与 rng 等价的带坐标记忆版本，噪点分布稳定）
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 974634073) >>> 0;
  h = ((h ^ (h >>> 13)) * 1103515245) >>> 0;
  return (h >>> 16) / 65536;
}

// 三色噪声底（原版风：基色为主 + 少量暗/亮碎点 + 轻微抖动）
function noiseTex(base, seed, opts = {}) {
  const dark = opts.dark ?? 0.86, light = opts.light ?? 1.1;
  const dProb = opts.dProb ?? 0.16, lProb = opts.lProb ?? 0.12;
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y, seed);
      let f = 1 + (hash2(x, y, seed + 1) - 0.5) * 0.06;
      if (t < dProb) f *= dark;
      else if (t > 1 - lProb) f *= light;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

// 2×2 块状斑驳（基岩/沙砾/末地石等大颗粒质感）
function blotchTex(base, seed, opts = {}) {
  const dark = opts.dark ?? 0.72, light = opts.light ?? 1.25;
  const dProb = opts.dProb ?? 0.25, lProb = opts.lProb ?? 0.2;
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x >> 1, y >> 1, seed);
      let f;
      if (t < dProb) f = dark;
      else if (t > 1 - lProb) f = light;
      else f = 0.96 + hash2(x, y, seed + 1) * 0.08;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

// ---------- 自然方块 ----------
function stoneTex(seed) {
  return noiseTex([125, 125, 125], seed, { dark: 0.9, light: 1.08, dProb: 0.2, lProb: 0.15 });
}

function grassTopTex(seed) {
  const px = makeTex();
  const g = [124, 178, 80];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y, seed);
      let f = 0.9 + hash2(x, y, seed + 1) * 0.2;
      if (t < 0.14) f *= 0.82;
      else if (t > 0.88) f *= 1.15;
      px[y * 16 + x] = rgb(g, f);
    }
  }
  return pixelSvg(px);
}

// 草侧面：泥土 + 顶部锯齿草皮（每列 2~4px 深浅过渡）
function grassSideTex(seed) {
  const px = makeTex();
  const dirt = [134, 96, 67], grass = [110, 158, 72];
  for (let x = 0; x < 16; x++) {
    const depth = 2 + Math.floor(hash2(x, 0, seed) * 3);
    for (let y = 0; y < 16; y++) {
      if (y < depth) px[y * 16 + x] = rgb(grass, 0.9 + hash2(x, y, seed + 1) * 0.2);
      else if (y === depth) px[y * 16 + x] = rgb(grass, 0.62);
      else px[y * 16 + x] = rgb(dirt, 0.9 + hash2(x, y, seed + 2) * 0.2);
    }
  }
  return pixelSvg(px);
}

function waterTex() {
  const px = makeTex();
  const base = [52, 96, 218];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // 周期取 16 的整数分频 → 世界平铺无缝
      const w = Math.sin(x * Math.PI / 8 + y * Math.PI / 4) * 0.5 + 0.5;
      px[y * 16 + x] = rgb(base, 0.85 + w * 0.3);
    }
  }
  return pixelSvg(px);
}

function lavaTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x >> 1, y >> 1, seed);
      let c;
      if (t < 0.3) c = [252, 172, 48];
      else if (t < 0.5) c = [232, 108, 24];
      else c = [200, 62, 16];
      px[y * 16 + x] = rgb(c, 0.94 + hash2(x, y, seed + 1) * 0.12);
    }
  }
  return pixelSvg(px);
}

function obsidianTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x >> 1, y >> 1, seed);
      let c = [28, 22, 40];
      if (t < 0.22) c = [16, 12, 24];
      else if (t > 0.82) c = [52, 40, 78];
      if (hash2(x, y, seed + 3) < 0.05) c = [92, 68, 128];
      px[y * 16 + x] = rgb(c, 0.9 + hash2(x, y, seed + 1) * 0.2);
    }
  }
  return pixelSvg(px);
}

function iceTex(seed, base = [150, 187, 235]) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.92 + hash2(x, y, seed) * 0.16;
      if ((x + y) % 8 === 3) f *= 1.18;
      else if ((x + y) % 8 === 4) f *= 0.9;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

function leavesTex(seed, tone) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y, seed);
      if (t < 0.11) continue; // 透光孔
      let f = 0.82 + hash2(x, y, seed + 1) * 0.4;
      if (t > 0.86) f *= 1.2;
      px[y * 16 + x] = rgb(tone, f);
    }
  }
  return pixelSvg(px);
}

function cactusTex(seed) {
  const px = makeTex();
  const g = [58, 118, 44];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.92 + hash2(x, y, seed) * 0.16;
      if (x <= 1 || x >= 14) f *= 0.8;
      else if (x === 2 || x === 13) f *= 1.1;
      if ((x <= 1 || x >= 14) && y % 4 === 2) px[y * 16 + x] = 'rgb(214,214,182)';
      else px[y * 16 + x] = rgb(g, f);
    }
  }
  return pixelSvg(px);
}

// 仙人掌顶/底面（B28）：芯部亮绿 + 放射棱线 + 边缘刺点（侧面那套竖棱不该出现在头顶）
function cactusTopTex(seed) {
  const px = makeTex();
  const g = [58, 118, 44];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      let f = 0.94 + hash2(x, y, seed) * 0.12;
      if (r < 4.5) f *= 1.14;
      if (r > 6.6) f *= 0.86;
      px[y * 16 + x] = rgb(g, f);
    }
  }
  for (const [px2, py2] of [[7, 1], [8, 14], [1, 7], [14, 8], [3, 3], [12, 12]]) {
    setPx(px, px2, py2, 'rgb(214,214,182)');
  }
  return pixelSvg(px);
}

function pumpkinSideTex(seed) {
  const px = makeTex();
  const o = [206, 122, 30];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.9 + hash2(x, y, seed) * 0.18;
      if (x % 5 === 0) f *= 0.72;
      else if (x % 5 === 1) f *= 1.12;
      px[y * 16 + x] = rgb(o, f);
    }
  }
  return pixelSvg(px);
}

function pumpkinTopTex(seed) {
  const px = makeTex();
  const o = [206, 122, 30];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.9 + hash2(x, y, seed) * 0.16;
      if (x <= 1 || x >= 14 || y <= 1 || y >= 14) f *= 0.8;
      px[y * 16 + x] = rgb(o, f);
    }
  }
  fillRect(px, 7, 7, 8, 8, rgb([88, 110, 40]));
  return pixelSvg(px);
}

// 西瓜顶/底面（B28）：瓜蒂凹陷 + 同心瓜皮纹（条纹只属于侧面）
function melonTopTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      const ring = Math.floor(r / 2) % 2 === 0;
      const base = ring ? [128, 176, 60] : [96, 152, 48];
      px[y * 16 + x] = rgb(base, 0.9 + hash2(x, y, seed) * 0.16);
    }
  }
  fillRect(px, 6, 6, 9, 9, rgb([188, 176, 96]));   // 瓜蒂
  fillRect(px, 7, 7, 8, 8, rgb([146, 132, 62]));
  return pixelSvg(px);
}

function melonTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const stripe = (x >> 1) % 2 === 0;
      const base = stripe ? [88, 148, 44] : [156, 196, 80];
      px[y * 16 + x] = rgb(base, 0.9 + hash2(x, y, seed) * 0.2);
    }
  }
  return pixelSvg(px);
}

function haySideTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.88 + hash2(x >> 2, y, seed) * 0.24;
      if (y <= 1 || y >= 14) f *= 0.78;
      if ((x + y * 3) % 11 === 0) f *= 0.8;
      px[y * 16 + x] = rgb([200, 168, 60], f);
    }
  }
  return pixelSvg(px);
}

function hayTopTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const weave = ((x >> 2) + (y >> 2)) % 2 === 0;
      const base = weave ? [214, 182, 74] : [188, 152, 48];
      px[y * 16 + x] = rgb(base, 0.92 + hash2(x, y, seed) * 0.16);
    }
  }
  return pixelSvg(px);
}

// ---------- 矿石 / 深板岩 ----------
// 石底 + 4 组晶簇（中心 + 十字 + 高光/阴影点）
function oreTex(stoneBase, ore, seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb(stoneBase, 0.92 + hash2(x, y, seed) * 0.16);
    }
  }
  const clusters = [[3, 3], [9, 6], [12, 11], [5, 12]];
  for (const [cx, cy] of clusters) {
    const pts = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const [dx, dy] of pts) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x > 15 || y < 0 || y > 15) continue;
      px[y * 16 + x] = rgb(ore, 0.9 + hash2(x, y, seed + 9) * 0.25);
    }
    setPx(px, cx - 1, cy - 1, rgb(ore, 1.35));
    setPx(px, cx + 1, cy + 1, rgb(ore, 0.6));
  }
  return pixelSvg(px);
}

function deepslateTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y >> 2, seed);
      let f = 0.9 + hash2(x, y, seed + 1) * 0.14;
      if (t < 0.2) f *= 0.8;
      px[y * 16 + x] = rgb([74, 74, 82], f);
    }
  }
  return pixelSvg(px);
}

// ---------- 砖石类 ----------
// 圆石：4×4 砌块，奇数行错位 2px，块间深缝
function cobbleTex(seed) {
  const px = makeTex();
  const r = rng(seed);
  const v = [];
  for (let i = 0; i < 20; i++) v.push(0.86 + r() * 0.3);
  for (let y = 0; y < 16; y++) {
    const row = y >> 2;
    const off = (row % 2) * 2;
    for (let x = 0; x < 16; x++) {
      const xx = (x + off) & 15;
      const isSeam = (xx & 3) === 3 || (y & 3) === 3;
      const f = isSeam ? 0.62 : v[row * 5 + (xx >> 2)] * (0.95 + hash2(x, y, seed) * 0.1);
      px[y * 16 + x] = rgb([126, 126, 126], f);
    }
  }
  return pixelSvg(px);
}

// 石砖：2×2 大砖（8×8），右上/右下 1px 缝 + 上/左受光边
function stoneBricksTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.95 + hash2(x, y, seed) * 0.1;
      if ((x & 7) === 0 || (y & 7) === 0) f *= 1.08;
      if ((x & 7) === 7 || (y & 7) === 7) f = 0.55;
      px[y * 16 + x] = rgb([122, 122, 122], f);
    }
  }
  return pixelSvg(px);
}

// 红砖：4 行交错砖 + 浅灰缝
function brickTex(seed) {
  const px = makeTex();
  const brick = [150, 97, 83], mortar = [172, 165, 160];
  for (let y = 0; y < 16; y++) {
    const row = y >> 2;
    for (let x = 0; x < 16; x++) {
      const xx = (x + (row % 2) * 4) & 15;
      if ((y & 3) === 3 || (xx & 7) === 7) px[y * 16 + x] = rgb(mortar);
      else px[y * 16 + x] = rgb(brick, 0.9 + hash2(xx, y, seed) * 0.2);
    }
  }
  return pixelSvg(px);
}

function sandstoneTex(seed) {
  const px = makeTex();
  const base = [216, 203, 155];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.94 + hash2(x, y, seed) * 0.1;
      if (y <= 1) f *= 1.08;
      else if (y >= 14) f *= 0.82;
      else if (hash2(0, y >> 1, seed + 2) < 0.3) f *= 0.92;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

// ---------- 木质类 ----------
// 木板：4 横板 + 横缝 + 每板 1 条端缝 + 板上沿受光
function planksTex(base, seed, seamF = 0.62) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const row = y >> 2;
      const jointX = (5 + row * 4 + ((row * 7) % 3)) & 15;
      let f = 0.94 + hash2(x, y, seed) * 0.12;
      if ((y & 3) === 3) f = seamF;
      else if (x === jointX) f = seamF * 1.05;
      else if ((y & 3) === 0) f *= 1.08;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

// 原木侧面：竖向断续纹 + 侧棱暗
function logSideTex(bark, seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y >> 2, seed);
      let f = 1;
      if (t < 0.18) f = 0.78;
      else if (t > 0.85) f = 1.12;
      f *= 0.95 + hash2(x, y, seed + 1) * 0.1;
      if (x === 0 || x === 15) f *= 0.92;
      px[y * 16 + x] = rgb(bark, f);
    }
  }
  return pixelSvg(px);
}

// 原木顶面：树皮边 + 年轮 + 亮芯
function logTopTex(bark, ring, seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      let c, f;
      if (d > 6.6) {
        c = bark;
        f = 0.9 + hash2(x, y, seed) * 0.2;
      } else {
        const ringIdx = Math.floor(d);
        c = ringIdx % 2 === 0 ? ring : [Math.min(255, ring[0] + 22), Math.min(255, ring[1] + 20), Math.min(255, ring[2] + 16)];
        f = 0.92 + hash2(x, y, seed + 2) * 0.16;
        if (d < 1.6) f *= 1.1;
      }
      px[y * 16 + x] = rgb(c, f);
    }
  }
  return pixelSvg(px);
}

// ---------- 功能方块 ----------
function craftingTopTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([162, 130, 78], 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  const frame = rgb([96, 72, 40]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  const grid = rgb([110, 84, 48]);
  for (let i = 2; i <= 13; i++) {
    setPx(px, 5, i, grid); setPx(px, 10, i, grid);
    setPx(px, i, 5, grid); setPx(px, i, 10, grid);
  }
  return pixelSvg(px);
}

function craftingSideTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([152, 120, 72], 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  fillRect(px, 0, 0, 15, 3, rgb([118, 90, 50]));
  fillRect(px, 0, 4, 15, 4, rgb([180, 148, 92]));
  fillRect(px, 3, 6, 7, 7, rgb([126, 98, 56]));
  fillRect(px, 4, 8, 6, 13, rgb([96, 72, 40]));
  fillRect(px, 9, 8, 11, 13, rgb([96, 72, 40]));
  fillRect(px, 10, 6, 12, 7, rgb([126, 98, 56]));
  return pixelSvg(px);
}

// 熔炉（B28 定向面）：炉口只在正面；侧面砖框石身；顶面通风环；底面石头。
// 家族 4 朝向 × 未点燃/点燃两态（点燃态 `furnace_lit*` 走 light:13 亮块管线，见 Game.updateFurnaces）。
function furnaceBasePx(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([120, 120, 120], 0.9 + hash2(x, y, seed) * 0.2);
    }
  }
  return px;
}

// 侧面：石身 + 圆石砖框（原版熔炉侧面是石砖圈住整面）
function furnaceSidePx(seed) {
  const px = furnaceBasePx(seed);
  const frame = rgb([88, 88, 88]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  for (let i = 2; i <= 13; i += 3) {
    fillRect(px, i, 1, i, 4, rgb([104, 104, 104]));
    fillRect(px, i, 11, i, 14, rgb([104, 104, 104]));
  }
  return px;
}
function furnaceSideTex(seed) { return pixelSvg(furnaceSidePx(seed)); }

// 正面：石身 + 炉口（上半通风槽 + 下半炉膛）+ 砖框
function furnaceFrontPx(seed) {
  const px = furnaceSidePx(seed);
  const frame = rgb([88, 88, 88]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  fillRect(px, 5, 8, 10, 8, rgb([70, 70, 70]));
  fillRect(px, 4, 9, 11, 13, rgb([30, 30, 30]));
  fillRect(px, 5, 12, 10, 13, rgb([58, 44, 36]));
  return px;
}
function furnaceFrontTex(seed) { return pixelSvg(furnaceFrontPx(seed)); }

// 正面（点燃）：炉膛炭火 + 火星（点燃态专用；亮块管线会让它夜里自发光）
function furnaceFrontLitTex(seed) {
  const px = furnaceFrontPx(seed);
  fillRect(px, 4, 9, 11, 13, rgb([64, 26, 12]));
  fillRect(px, 5, 10, 10, 13, rgb([196, 88, 24]));
  fillRect(px, 5, 12, 10, 13, rgb([248, 196, 84]));
  for (const [fx, fy] of [[5, 10], [8, 9], [10, 11], [6, 9]]) setPx(px, fx, fy, 'rgb(255,232,150)');
  fillRect(px, 5, 8, 10, 8, rgb([120, 96, 72]));
  return pixelSvg(px);
}

// 顶面：石面 + 通风环（原版熔炉顶的圆形炉盖）
function furnaceTopTex(seed) {
  const px = furnaceBasePx(seed);
  const frame = rgb([88, 88, 88]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      if (r <= 5.6 && r >= 4.2) px[y * 16 + x] = rgb([92, 92, 92]);
      else if (r < 2.4) px[y * 16 + x] = rgb([68, 68, 68]);
    }
  }
  return pixelSvg(px);
}

// TNT 侧面：红底 + 白带 + TNT 字样
function tntSideTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.9 + hash2(x, y, seed) * 0.2;
      let c = [196, 62, 44];
      if (y <= 1 || y >= 14) c = [124, 40, 32];
      px[y * 16 + x] = rgb(c, f);
    }
  }
  fillRect(px, 0, 6, 15, 9, 'rgb(236,232,224)');
  const ink = 'rgb(40,36,34)';
  fillRect(px, 3, 7, 5, 7, ink); fillRect(px, 4, 8, 4, 9, ink);   // T
  fillRect(px, 7, 7, 7, 9, ink); fillRect(px, 9, 7, 9, 9, ink); fillRect(px, 8, 8, 8, 8, ink); // N
  fillRect(px, 11, 7, 13, 7, ink); fillRect(px, 12, 8, 12, 9, ink); // T
  return pixelSvg(px);
}

function tntTopTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([160, 52, 38], 0.9 + hash2(x, y, seed) * 0.2);
    }
  }
  fillRect(px, 6, 6, 9, 9, rgb([92, 88, 84]));
  fillRect(px, 7, 7, 8, 8, rgb([60, 56, 52]));
  setPx(px, 7, 7, 'rgb(220,216,208)');
  return pixelSvg(px);
}

function glowstoneTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x >> 1, y >> 1, seed);
      let c;
      if (t < 0.32) c = [250, 214, 130];
      else if (t < 0.5) c = [220, 168, 88];
      else c = [148, 110, 72];
      px[y * 16 + x] = rgb(c, 0.94 + hash2(x, y, seed + 1) * 0.12);
    }
  }
  return pixelSvg(px);
}

function seaLanternTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      let c;
      if (d > 6.5) c = [186, 205, 208];
      else if (d > 4.5) c = [205, 224, 226];
      else c = [226, 240, 242];
      px[y * 16 + x] = rgb(c, 0.94 + hash2(x, y, seed) * 0.1);
    }
  }
  return pixelSvg(px);
}

// 红石灯（B28）：铁栅格 + 中央灯芯。未充能 = 暗灯芯（light 0）；充能 = 亮灯芯（light 15，走亮块管线）。
// 两态是独立方块 ID（家族：redstone_lamp = 未充能本名，redstone_lamp_lit = 充能态，尾部追加注册）。
function redstoneLampTex(seed, lit) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const f = 0.92 + hash2(x, y, seed) * 0.14;
      const c = (x % 4 === 0 || y % 4 === 0) ? [86, 58, 32] : [118, 82, 46];
      px[y * 16 + x] = rgb(c, f);
    }
  }
  const core = lit ? [255, 224, 140] : [92, 66, 40];
  const ring = lit ? [248, 176, 74] : [110, 78, 44];
  fillRect(px, 5, 5, 10, 10, rgb(ring));
  fillRect(px, 6, 6, 9, 9, rgb(core));
  if (lit) {
    fillRect(px, 7, 7, 8, 8, 'rgb(255,248,214)');
    for (const [gx, gy] of [[4, 4], [11, 4], [4, 11], [11, 11]]) setPx(px, gx, gy, rgb([252, 214, 130]));
  }
  return pixelSvg(px);
}

// 矿物块：斜面受光（上/左亮、下/右暗）
function mineralBlockTex(base, seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.96 + hash2(x, y, seed) * 0.08;
      if (x === 0 || y === 0) f *= 1.12;
      else if (x === 15 || y === 15) f *= 0.82;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

function soulTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([86, 65, 52], 0.9 + hash2(x, y, seed) * 0.2);
    }
  }
  const holes = [[3, 4], [9, 8], [12, 3]];
  for (const [hx, hy] of holes) {
    fillRect(px, hx, hy, hx + 1, hy + 1, rgb([44, 31, 24]));
    setPx(px, hx - 1, hy, rgb([64, 47, 37]));
    setPx(px, hx + 2, hy + 1, rgb([64, 47, 37]));
  }
  return pixelSvg(px);
}

function magmaTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x >> 1, y >> 1, seed);
      let c;
      if (t < 0.22) c = [236, 108, 28];
      else if (t < 0.36) c = [180, 62, 20];
      else c = [52, 30, 26];
      px[y * 16 + x] = rgb(c, 0.92 + hash2(x, y, seed + 1) * 0.16);
    }
  }
  return pixelSvg(px);
}

function glassTex() {
  const px = makeTex();
  const edge = 'rgb(226,245,247)';
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, edge); setPx(px, i, 15, edge);
    setPx(px, 0, i, edge); setPx(px, 15, i, edge);
  }
  const hi = 'rgb(240,252,254)';
  setPx(px, 3, 2, hi); setPx(px, 2, 3, hi);
  setPx(px, 5, 3, hi); setPx(px, 4, 4, hi); setPx(px, 3, 5, hi);
  return pixelSvg(px);
}

// 门：边框 + 中缝 + 上下凹板
function doorTex(base, seed, rivets = false) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb(base, 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  const frame = rgb([base[0] * 0.55, base[1] * 0.55, base[2] * 0.55]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
    if (i >= 1 && i <= 14) { setPx(px, 7, i, frame); setPx(px, 8, i, frame); }
  }
  fillRect(px, 2, 2, 6, 6, rgb(base, 0.85));
  fillRect(px, 9, 2, 13, 6, rgb(base, 0.85));
  fillRect(px, 2, 9, 6, 13, rgb(base, 0.85));
  fillRect(px, 9, 9, 13, 13, rgb(base, 0.85));
  if (rivets) {
    fillRect(px, 3, 3, 3, 3, rgb([230, 230, 234]));
    fillRect(px, 12, 12, 12, 12, rgb([230, 230, 234]));
  }
  return pixelSvg(px);
}

function trapdoorTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([162, 130, 78], 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  const frame = rgb([96, 72, 40]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
    setPx(px, i, 5, frame); setPx(px, i, 10, frame);
  }
  setPx(px, 5, 3, frame); setPx(px, 11, 8, frame); setPx(px, 6, 13, frame);
  return pixelSvg(px);
}

// 活塞：top 木板+铁框 / side 压板+槽 / bottom 石板
function pistonTopTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([152, 120, 72], 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  fillRect(px, 2, 2, 13, 13, rgb([108, 84, 48]));
  fillRect(px, 3, 3, 12, 12, rgb([150, 150, 150]));
  for (let i = 3; i <= 12; i++) {
    setPx(px, i, 3, rgb([172, 172, 172])); setPx(px, i, 12, rgb([126, 126, 126]));
    setPx(px, 3, i, rgb([172, 172, 172])); setPx(px, 12, i, rgb([126, 126, 126]));
  }
  return pixelSvg(px);
}

function stickyTopTex(seed) {
  const px = makeTex();
  const base = pixelPixels(pistonTopTex(seed));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px[y * 16 + x] = base[y * 16 + x];
  fillRect(px, 6, 6, 9, 9, rgb([140, 190, 110]));
  fillRect(px, 7, 7, 8, 8, rgb([170, 214, 140]));
  return pixelSvg(px);
}

// pixelSvg 的逆向辅助（把已生成 SVG 重新解析太绕，直接内部用像素数组版本）
function pixelPixels(svgText) {
  const out = new Array(256).fill(null);
  const re = /<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="([^"]+)"\/>/g;
  let m;
  while ((m = re.exec(svgText)) !== null) {
    out[parseInt(m[2], 10) * 16 + parseInt(m[1], 10)] = m[3];
  }
  return out;
}

function pistonSideTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([140, 110, 66], 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  fillRect(px, 0, 0, 15, 2, rgb([176, 148, 96]));
  fillRect(px, 0, 3, 15, 5, rgb([96, 74, 42]));
  return pixelSvg(px);
}

function pistonBottomTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([116, 116, 116], 0.9 + hash2(x, y, seed) * 0.2);
    }
  }
  const frame = rgb([86, 86, 86]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  return pixelSvg(px);
}

// 活塞头（B28）：顶面 = 推出面板（铁框 + 木芯，原版活塞头顶面看得见的推板），
// 侧面 = 活塞臂（沿用灰铁），底面 = 与活塞机身的接缝。此前六面同一张灰铁图。
function pistonHeadBasePx(seed, tone = [160, 160, 160]) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.96 + hash2(x, y, seed) * 0.08;
      if (x === 0 || y === 0) f *= 1.12;
      else if (x === 15 || y === 15) f *= 0.82;
      px[y * 16 + x] = rgb(tone, f);
    }
  }
  return px;
}

function pistonHeadTopTex(seed) {
  const px = pistonHeadBasePx(seed);
  const frame = rgb([104, 104, 104]);
  for (let i = 1; i < 15; i++) {
    setPx(px, i, 1, frame); setPx(px, i, 14, frame);
    setPx(px, 1, i, frame); setPx(px, 14, i, frame);
  }
  fillRect(px, 3, 3, 12, 12, rgb([176, 140, 86]));  // 木板推面
  for (let y = 4; y <= 11; y += 3) fillRect(px, 4, y, 11, y, rgb([148, 114, 66]));
  return pixelSvg(px);
}

function pistonHeadSideTex(seed) {
  const px = pistonHeadBasePx(seed);
  fillRect(px, 0, 0, 15, 2, rgb([132, 132, 132]));
  fillRect(px, 0, 13, 15, 15, rgb([116, 116, 116]));
  fillRect(px, 5, 4, 10, 11, rgb([106, 106, 106])); // 活塞臂凹槽
  return pixelSvg(px);
}

function pistonHeadBottomTex(seed) {
  const px = pistonHeadBasePx(seed, [150, 150, 150]);
  const frame = rgb([96, 96, 96]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  fillRect(px, 5, 5, 10, 10, rgb([116, 116, 116]));
  return pixelSvg(px);
}

// ---------- 注册 ----------
const svgMap = {};

// 统一注册：textures 字段指定 SVG 文件名
const BlockCN = {
  air: '空气', stone: '石头', grass_block: '草方块', dirt: '泥土', coarse_dirt: '砂土',
  sand: '沙子', red_sand: '红沙', gravel: '沙砾', clay: '粘土块', bedrock: '基岩',
  water: '水', lava: '岩浆',
  ice: '冰', packed_ice: '浮冰', blue_ice: '蓝冰',
  snow_block: '雪块', snow_layer: '雪层', obsidian: '黑曜石',
  coal_ore: '煤矿石', iron_ore: '铁矿石', gold_ore: '金矿石', diamond_ore: '钻石矿石',
  emerald_ore: '绿宝石矿石', redstone_ore: '红石矿石', lapis_ore: '青金石矿石', copper_ore: '铜矿石',
  deepslate: '深板岩',
  deepslate_coal_ore: '深板岩煤矿石', deepslate_iron_ore: '深板岩铁矿石',
  deepslate_gold_ore: '深板岩金矿石', deepslate_diamond_ore: '深板岩钻石矿石',
  oak_log: '橡木原木', spruce_log: '云杉原木', birch_log: '白桦原木', dark_oak_log: '深色橡木原木', acacia_log: '金合欢原木',
  oak_planks: '橡木木板', spruce_planks: '云杉木板', birch_planks: '白桦木板', dark_oak_planks: '深色橡木木板', acacia_planks: '金合欢木板',
  oak_leaves: '橡树树叶', spruce_leaves: '云杉树叶', birch_leaves: '白桦树叶', acacia_leaves: '金合欢树叶',
  cobblestone: '圆石', stone_bricks: '石砖', mossy_stone_bricks: '苔石砖', cracked_stone_bricks: '裂石砖',
  mossy_cobblestone: '苔石', brick_block: '红砖块', nether_bricks: '下界砖块',
  bookshelf: '书架', end_portal_frame: '末地传送门框架', end_portal_frame_eye: '末地传送门框架（已嵌眼）', end_portal: '末地传送门',
  nether_portal: '下界传送门', aether_portal: '天域传送门',
  sandstone: '砂岩', red_sandstone: '红砂岩', quartz_block: '石英块',
  crafting_table: '工作台', furnace: '熔炉', tnt: 'TNT',
  glass: '玻璃', glowstone: '荧石', sea_lantern: '海晶灯', torch: '火把',
  iron_block: '铁块', gold_block: '金块', diamond_block: '钻石块', emerald_block: '绿宝石块',
  lapis_block: '青金石块', redstone_block: '红石块', coal_block: '煤炭块',
  cactus: '仙人掌', pumpkin: '南瓜', melon: '西瓜', hay_block: '干草块',
  netherrack: '下界岩', end_stone: '末地石', soul_sand: '灵魂沙', magma_block: '岩浆块',
  redstone_lamp: '红石灯', redstone_torch: '红石火把',
  lever: '拉杆', stone_button: '石按钮', oak_button: '橡木按钮', redstone_wire: '红石粉',
  piston: '活塞', piston_head: '活塞头', sticky_piston: '粘性活塞',
  oak_door: '橡木门', iron_door: '铁门', oak_trapdoor: '橡木活板门', note_block: '音符盒',
  white_concrete: '白色混凝土', white_wool: '白色羊毛', white_terracotta: '白色陶瓦', white_bed: '白色床',
  chest: '箱子',
  star_marrow_ore: '星髓矿石', star_marrow_block: '星髓块', cloud_wool: '云绒块',
  wind_stele: '风纹石碑', aether_altar: '恒昼祭坛', wind_current: '气流', gale_block: '风阵块',
  tide_altar: '潮心祭坛',
  ember_stele: '烬纹石碑', // 世界观批次 N1：下界石碑（石碑家族第二员）
  moss_stele: '苔纹石碑', // 世界观批次 W1：主世界石碑（石碑家族第三员）
  end_stele: '界纹石碑', // 世界观批次 E1：末地石碑（石碑家族第四员）
  primordial_altar: '原初祭坛', // 终局篇 F1：候潮仪式受体
  whale_bone_block: '鲸骨块', // 鲸骨冢篇 K1：天海巨鲸的骨骼建材
};

function reg(name, def, svgs) {
  BlockRegistry.register({ name, displayName: BlockCN[name] || def.displayName || name, ...def });
  if (svgs) {
    for (const [key, svg] of Object.entries(svgs)) {
      svgMap[key] = svg;
    }
  }
}

// --- 自然方块 ---
reg('air', { id: 0, displayName: '空气', solid: false, transparent: true, hardness: 0 });
reg('stone', { hardness: 1.5, tool: 'pickaxe', minTier: 1 }, { stone: stoneTex(1) });
reg('grass_block', { tool: 'shovel', textures: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hardness: 0.6 },
  { grass_top: grassTopTex(7), grass_side: grassSideTex(8), dirt: noiseTex([134, 96, 67], 9) });
// 菌丝体：紫灰顶 + 带紫缘的土侧 + dirt 底（蘑菇岛地表）
function myceliumSideTex(seed) {
  const px = makeTex();
  const soil = [134, 96, 67], mold = [125, 100, 130];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = y < 3 + (hash2(x, 0, seed) > 0.5 ? 1 : 0); // 紫缘参差下沿
      const f = 1 + (hash2(x, y, seed + 1) - 0.5) * 0.12;
      setPx(px, x, y, rgb(edge ? mold : soil, f));
      if (edge && hash2(x, y, seed + 2) > 0.8) setPx(px, x, y, rgb([150, 118, 152], f));
    }
  }
  return pixelSvg(px);
}
reg('mycelium', { displayName: '菌丝体', textures: { top: 'mycelium_top', side: 'mycelium_side', bottom: 'dirt' }, hardness: 0.6 },
  {
    mycelium_top: noiseTex([125, 100, 130], 116, { dark: 0.84, light: 1.16, dProb: 0.26, lProb: 0.14 }),
    mycelium_side: myceliumSideTex(117)
  });
reg('dirt', { tool: 'shovel', hardness: 0.5 }, { dirt: noiseTex([134, 96, 67], 9) });
reg('coarse_dirt', { tool: 'shovel', hardness: 0.5 }, { coarse_dirt: noiseTex([122, 90, 60], 10, { dProb: 0.24 }) });
reg('sand', { tool: 'shovel', hardness: 0.5 }, { sand: noiseTex([219, 207, 163], 11, { dark: 0.93, light: 1.06 }) });
reg('red_sand', { tool: 'shovel', hardness: 0.5 }, { red_sand: noiseTex([190, 105, 60], 12, { dark: 0.93, light: 1.06 }) });
reg('gravel', { tool: 'shovel', hardness: 0.6 }, { gravel: blotchTex([130, 124, 120], 13, { dark: 0.72, light: 1.2 }) });
reg('clay', { tool: 'shovel', hardness: 0.6 }, { clay: noiseTex([163, 166, 179], 14, { dark: 0.94, light: 1.06 }) });
reg('bedrock', { hardness: -1 }, { bedrock: blotchTex([100, 100, 100], 15, { dark: 0.45, light: 1.35, dProb: 0.3, lProb: 0.25 }) });
reg('water', { solid: false, transparent: true, fluid: true, fluidType: 'water', hardness: 100 }, { water: waterTex() });
reg('lava', { displayName: '岩浆', solid: false, transparent: true, fluid: true, fluidType: 'lava', light: 15, hardness: 100 }, { lava: lavaTex(17) });
// --- 流体流动等级方块（B26 流体模拟）：等级 1 最强（紧邻源）→ N 最弱，数字越大越弱；
// fluidType 供游泳/伤害/渲染分路判定（与源方块同值）；textures 复用源纹理避免图集膨胀
for (let wl = 1; wl <= 7; wl++) {
  reg(`water_flow_${wl}`, { displayName: '水', solid: false, transparent: true, fluid: true, fluidType: 'water', textures: { top: 'water', side: 'water', bottom: 'water' }, hardness: 100 });
}
for (let ll = 1; ll <= 3; ll++) {
  reg(`lava_flow_${ll}`, { displayName: '岩浆', solid: false, transparent: true, fluid: true, fluidType: 'lava', light: 15, textures: { top: 'lava', side: 'lava', bottom: 'lava' }, hardness: 100 });
}
reg('ice', { transparent: true, hardness: 0.5 }, { ice: iceTex(18) });
reg('packed_ice', { hardness: 0.5 }, { packed_ice: iceTex(19, [138, 172, 222]) });
reg('blue_ice', { hardness: 0.5 }, { blue_ice: iceTex(20, [110, 150, 222]) });
reg('snow_block', { hardness: 0.2 }, { snow_block: noiseTex([246, 250, 252], 21, { dark: 0.97, light: 1.03, dProb: 0.1, lProb: 0.1 }) });
reg('snow_layer', { transparent: true, hardness: 0.1 }, { snow_layer: noiseTex([246, 250, 252], 22, { dark: 0.97, light: 1.03, dProb: 0.1, lProb: 0.1 }) });
reg('obsidian', { hardness: 12, tool: 'pickaxe', minTier: 4 }, { obsidian: obsidianTex(23) });

// --- 矿石 ---
reg('coal_ore', { hardness: 3, tool: 'pickaxe', minTier: 1 }, { coal_ore: oreTex([125, 125, 125], [42, 42, 42], 31) });
reg('iron_ore', { hardness: 3, tool: 'pickaxe', minTier: 2 }, { iron_ore: oreTex([125, 125, 125], [216, 175, 147], 32) });
reg('gold_ore', { hardness: 3, tool: 'pickaxe', minTier: 3 }, { gold_ore: oreTex([125, 125, 125], [250, 224, 92], 33) });
reg('diamond_ore', { hardness: 3, tool: 'pickaxe', minTier: 3 }, { diamond_ore: oreTex([125, 125, 125], [104, 232, 222], 34) });
reg('emerald_ore', { hardness: 3, tool: 'pickaxe', minTier: 3 }, { emerald_ore: oreTex([125, 125, 125], [62, 216, 92], 35) });
reg('redstone_ore', { hardness: 3, tool: 'pickaxe', minTier: 3, light: 9 }, { redstone_ore: oreTex([125, 125, 125], [226, 48, 42], 36) });
reg('lapis_ore', { hardness: 3, tool: 'pickaxe', minTier: 2 }, { lapis_ore: oreTex([125, 125, 125], [38, 70, 200], 37) });
reg('copper_ore', { hardness: 3, tool: 'pickaxe', minTier: 2 }, { copper_ore: oreTex([125, 125, 125], [200, 124, 84], 38) });

// 深板岩变种
reg('deepslate', { hardness: 3, tool: 'pickaxe', minTier: 1 }, { deepslate: deepslateTex(41) });
reg('deepslate_coal_ore', { hardness: 4.5, tool: 'pickaxe', minTier: 1 }, { deepslate_coal_ore: oreTex([74, 74, 82], [42, 42, 42], 42) });
reg('deepslate_iron_ore', { hardness: 4.5, tool: 'pickaxe', minTier: 2 }, { deepslate_iron_ore: oreTex([74, 74, 82], [216, 175, 147], 43) });
reg('deepslate_gold_ore', { hardness: 4.5, tool: 'pickaxe', minTier: 3 }, { deepslate_gold_ore: oreTex([74, 74, 82], [250, 224, 92], 44) });
reg('deepslate_diamond_ore', { hardness: 4.5, tool: 'pickaxe', minTier: 3 }, { deepslate_diamond_ore: oreTex([74, 74, 82], [104, 232, 222], 45) });

// --- 原木 ---
reg('oak_log', { tool: 'axe', textures: { top: 'oak_log_top', side: 'oak_log_side', bottom: 'oak_log_top' }, hardness: 2 },
  { oak_log_top: logTopTex([109, 84, 50], [172, 138, 90], 46), oak_log_side: logSideTex([109, 84, 50], 47) });
reg('spruce_log', { tool: 'axe', textures: { top: 'spruce_log_top', side: 'spruce_log_side', bottom: 'spruce_log_top' }, hardness: 2 },
  { spruce_log_top: logTopTex([70, 45, 20], [120, 80, 40], 48), spruce_log_side: logSideTex([70, 45, 20], 49) });
reg('birch_log', { tool: 'axe', textures: { top: 'birch_log_top', side: 'birch_log_side', bottom: 'birch_log_top' }, hardness: 2 },
  { birch_log_top: logTopTex([206, 199, 182], [226, 220, 206], 50), birch_log_side: logSideTex([214, 208, 194], 51) });
reg('dark_oak_log', { tool: 'axe', textures: { top: 'dark_oak_log_top', side: 'dark_oak_log_side', bottom: 'dark_oak_log_top' }, hardness: 2 },
  { dark_oak_log_top: logTopTex([46, 32, 18], [76, 52, 28], 52), dark_oak_log_side: logSideTex([56, 40, 22], 53) });
reg('acacia_log', { tool: 'axe', textures: { top: 'acacia_log_top', side: 'acacia_log_side', bottom: 'acacia_log_top' }, hardness: 2 },
  { acacia_log_top: logTopTex([110, 62, 24], [172, 100, 44], 54), acacia_log_side: logSideTex([128, 74, 30], 55) });

// --- 木板 ---
reg('oak_planks', { tool: 'axe', hardness: 2 }, { oak_planks: planksTex([162, 130, 78], 61) });
reg('spruce_planks', { tool: 'axe', hardness: 2 }, { spruce_planks: planksTex([114, 84, 50], 62) });
reg('birch_planks', { tool: 'axe', hardness: 2 }, { birch_planks: planksTex([212, 200, 176], 63) });
reg('dark_oak_planks', { tool: 'axe', hardness: 2 }, { dark_oak_planks: planksTex([68, 50, 30], 64) });
reg('acacia_planks', { tool: 'axe', hardness: 2 }, { acacia_planks: planksTex([168, 88, 44], 65) });

// --- 树叶 ---
reg('oak_leaves', { transparent: true, solid: true, hardness: 0.2 }, { oak_leaves: leavesTex(71, [64, 118, 38]) });
reg('spruce_leaves', { transparent: true, solid: true, hardness: 0.2 }, { spruce_leaves: leavesTex(72, [46, 86, 50]) });
reg('birch_leaves', { transparent: true, solid: true, hardness: 0.2 }, { birch_leaves: leavesTex(73, [98, 140, 58]) });
reg('acacia_leaves', { transparent: true, solid: true, hardness: 0.2 }, { acacia_leaves: leavesTex(74, [202, 118, 26]) });

// --- 砖/石砖 ---
reg('cobblestone', { hardness: 2, tool: 'pickaxe', minTier: 1 }, { cobblestone: cobbleTex(81) });
reg('stone_bricks', { hardness: 1.5, tool: 'pickaxe', minTier: 1 }, { stone_bricks: stoneBricksTex(82) });
reg('mossy_stone_bricks', { hardness: 1.5, tool: 'pickaxe', minTier: 1 }, { mossy_stone_bricks: stoneBricksMossyTex(89) });
reg('cracked_stone_bricks', { hardness: 1.5, tool: 'pickaxe', minTier: 1 }, { cracked_stone_bricks: stoneBricksCrackedTex(90) });
reg('mossy_cobblestone', { hardness: 2, tool: 'pickaxe', minTier: 1 }, { mossy_cobblestone: blotchTex([100, 118, 82], 83, { dark: 0.7, light: 1.2 }) });
reg('brick_block', { hardness: 2, tool: 'pickaxe', minTier: 1 }, { brick_block: brickTex(84) });
reg('nether_bricks', { hardness: 2, tool: 'pickaxe', minTier: 1 }, { nether_bricks: brickTexMagenta(85) });
reg('bookshelf', { hardness: 1.5, tool: 'axe', textures: { top: 'oak_planks', side: 'bookshelf_side', bottom: 'oak_planks' } }, { bookshelf_side: bookshelfSideTex(91) });
reg('end_portal_frame', { hardness: -1, textures: { top: 'end_portal_frame_top', side: 'end_portal_frame_side', bottom: 'stone_bricks' } }, { end_portal_frame_top: endPortalFrameTopTex(92), end_portal_frame_side: endPortalFrameSideTex(93) });

// 末地传送门框架（已嵌末影之眼）：同框架 + 顶面中央眼球（迭代 M3 逐框激活）
function endPortalFrameEyeTopTex(seed) {
  const px = makeTex();
  const stone = [136, 136, 136], green = [86, 178, 132], greenD = [52, 116, 88];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = stone, f = 0.9 + hash2(x, y, seed) * 0.2;
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d <= 4) c = green;
      if (d > 3 && d <= 4) c = greenD;
      if (d > 1.5 && d <= 2) f *= 0.6;
      // 中央眼球：黑绿瞳仁 + 高光（覆盖中心 5×5）
      const e = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (e <= 2) c = [10, 40, 30];
      if (e <= 1) c = [6, 24, 18];
      if ((x === 6 && y === 6) || (x === 5 && y === 7)) c = [160, 240, 200];
      px[y * 16 + x] = rgb(c, f);
    }
  }
  return pixelSvg(px);
}
reg('end_portal_frame_eye', { hardness: -1, textures: { top: 'end_portal_frame_eye_top', side: 'end_portal_frame_side', bottom: 'stone_bricks' } }, { end_portal_frame_eye_top: endPortalFrameEyeTopTex(99) });

// 末地传送门（激活门体）：星空黑面，solid:false 可陷入触发，light:15 自发光
function endPortalTex(seed) {
  const px = makeTex();
  fillRect(px, 0, 0, 15, 15, rgb([4, 4, 12]));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y, seed);
      if (t > 0.90) px[y * 16 + x] = rgb([190, 210, 255], 0.7 + t * 0.4);
      else if (t > 0.80) px[y * 16 + x] = rgb([110, 130, 210], 0.8 + t * 0.3);
      else if (t > 0.75) px[y * 16 + x] = rgb([40, 60, 120]);
    }
  }
  return pixelSvg(px);
}
reg('end_portal', { displayName: '末地传送门', solid: false, transparent: true, light: 15, hardness: -1, ambientParticles: true }, { end_portal: endPortalTex(100) });

// 苔石砖：石砖基底 + 苔斑侵蚀（要塞材质）
function stoneBricksMossyTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.95 + hash2(x, y, seed) * 0.1;
      if ((x & 7) === 0 || (y & 7) === 0) f *= 1.08;
      if ((x & 7) === 7 || (y & 7) === 7) f = 0.55;
      const r = hash2(x + 31, y + 17, seed + 5);
      if (r < 0.3) px[y * 16 + x] = rgb([96, 122, 70], 0.85 + r);
      else px[y * 16 + x] = rgb([122, 122, 122], f);
    }
  }
  return pixelSvg(px);
}

// 裂石砖：石砖基底 + 两条贯穿裂纹
function stoneBricksCrackedTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.95 + hash2(x, y, seed) * 0.1;
      if ((x & 7) === 0 || (y & 7) === 0) f *= 1.08;
      if ((x & 7) === 7 || (y & 7) === 7) f = 0.55;
      if (x === ((y * 3 + 4) & 15) || x === ((y * 5 + 11) & 15)) f *= 0.55;
      px[y * 16 + x] = rgb([122, 122, 122], f);
    }
  }
  return pixelSvg(px);
}

// 书架侧面：木框 + 两排彩色书脊
function bookshelfSideTex(seed) {
  const px = makeTex();
  const plank = [162, 130, 78];
  const spines = [[178, 60, 48], [62, 98, 158], [92, 132, 60], [168, 140, 58], [120, 70, 140]];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = plank, f = 0.9 + hash2(x, y, seed) * 0.2;
      const inShelf = (y >= 2 && y <= 6) || (y >= 9 && y <= 13);
      if (inShelf) {
        const shelf = y <= 6 ? 0 : 1;
        if (x === 0 || x === 15 || hash2(x, y + 40, seed + 3) < 0.15) c = [88, 66, 44];
        else c = spines[Math.floor(hash2(x, shelf, seed + 9) * 5) % 5];
        f = 0.85 + hash2(x, y, seed + 5) * 0.3;
      }
      px[y * 16 + x] = rgb(c, f);
    }
  }
  return pixelSvg(px);
}

// 末地传送门框架：顶面绿心石框 / 侧面石身绿带
function endPortalFrameTopTex(seed) {
  const px = makeTex();
  const stone = [136, 136, 136], green = [86, 178, 132], greenD = [52, 116, 88];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = stone, f = 0.9 + hash2(x, y, seed) * 0.2;
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d <= 4) c = green;
      if (d > 3 && d <= 4) c = greenD;
      if (d > 1.5 && d <= 2) f *= 0.6;
      px[y * 16 + x] = rgb(c, f);
    }
  }
  return pixelSvg(px);
}

function endPortalFrameSideTex(seed) {
  const px = makeTex();
  const stone = [136, 136, 136], green = [86, 178, 132], greenD = [52, 116, 88];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = stone, f = 0.9 + hash2(x, y, seed) * 0.2;
      if (y <= 2) { c = green; if (y === 2) c = greenD; }
      if (y === 11) f *= 0.6;
      px[y * 16 + x] = rgb(c, f);
    }
  }
  return pixelSvg(px);
}

// 砂岩顶/底面（B28）：平滑石面 + 四周浅框（原版砂岩只有侧面带沉积层）
function sandstoneTopTex(seed, base) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.96 + hash2(x, y, seed) * 0.08;
      if (x <= 1 || x >= 14 || y <= 1 || y >= 14) f *= 0.94;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

// 石英顶/底面（B28）：细边框纹（原版石英块顶面有一圈浅槽）
function quartzTopTex(seed) {
  const px = makeTex();
  const base = [236, 233, 226];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px[y * 16 + x] = rgb(base, 0.97 + hash2(x, y, seed) * 0.05);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, rgb(base, 0.88)); setPx(px, i, 15, rgb(base, 0.88));
    setPx(px, 0, i, rgb(base, 0.88)); setPx(px, 15, i, rgb(base, 0.88));
    setPx(px, i, 2, rgb(base, 0.93)); setPx(px, i, 13, rgb(base, 0.93));
    setPx(px, 2, i, rgb(base, 0.93)); setPx(px, 13, i, rgb(base, 0.93));
  }
  return pixelSvg(px);
}

reg('sandstone', {
  hardness: 0.8, tool: 'pickaxe', minTier: 1,
  textures: { top: 'sandstone_top', side: 'sandstone', bottom: 'sandstone_top' },
}, { sandstone: sandstoneTex(86), sandstone_top: sandstoneTopTex(866, [216, 203, 155]) });
reg('red_sandstone', {
  hardness: 0.8, tool: 'pickaxe', minTier: 1,
  textures: { top: 'red_sandstone_top', side: 'red_sandstone', bottom: 'red_sandstone_top' },
}, { red_sandstone: sandstoneTexR(87), red_sandstone_top: sandstoneTopTex(867, [206, 118, 62]) });
reg('quartz_block', {
  hardness: 0.8, tool: 'pickaxe', minTier: 1,
  textures: { top: 'quartz_block_top', side: 'quartz_block', bottom: 'quartz_block_top' },
}, {
  quartz_block: noiseTex([236, 233, 226], 88, { dark: 0.97, light: 1.03, dProb: 0.12, lProb: 0.1 }),
  quartz_block_top: quartzTopTex(89),
});

// 下界砖：深紫红砖 + 深缝（brickTex 的调色变体）
function brickTexMagenta(seed) {
  const px = makeTex();
  const brick = [86, 34, 40], mortar = [52, 20, 26];
  for (let y = 0; y < 16; y++) {
    const row = y >> 2;
    for (let x = 0; x < 16; x++) {
      const xx = (x + (row % 2) * 4) & 15;
      if ((y & 3) === 3 || (xx & 7) === 7) px[y * 16 + x] = rgb(mortar);
      else px[y * 16 + x] = rgb(brick, 0.9 + hash2(xx, y, seed) * 0.2);
    }
  }
  return pixelSvg(px);
}

function sandstoneTexR(seed) {
  const px = makeTex();
  const base = [206, 118, 62];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.94 + hash2(x, y, seed) * 0.1;
      if (y <= 1) f *= 1.08;
      else if (y >= 14) f *= 0.82;
      else if (hash2(0, y >> 1, seed + 2) < 0.3) f *= 0.92;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

// --- 功能方块 ---
reg('crafting_table', { tool: 'axe', textures: { top: 'crafting_table_top', side: 'crafting_table_side', bottom: 'oak_planks' }, hardness: 2.5 },
  {
    crafting_table_top: craftingTopTex(91),
    crafting_table_side: craftingSideTex(92)
  });
// 熔炉（B28 定向面）：本名 = 朝北/未点燃（旧存档零迁移）；朝向与点燃态变体尾部追加。
const FURNACE_TEX = { top: 'furnace_top', side: 'furnace_side', bottom: 'stone', front: 'furnace_front' };
const FURNACE_SVG = {
  furnace_top: furnaceTopTex(93),
  furnace_side: furnaceSideTex(94),
  furnace_front: furnaceFrontTex(95),
  furnace_front_lit: furnaceFrontLitTex(96),
};
reg('furnace', {
  textures: FURNACE_TEX, hardness: 3.5, tool: 'pickaxe', minTier: 1,
  facing: 'n', baseBlock: 'furnace', facingBase: 'furnace', lit: false,
}, { ...FURNACE_SVG });
reg('glass', { transparent: true, hardness: 0.3 }, { glass: glassTex() });
reg('glowstone', { displayName: '荧石', light: 15, hardness: 0.3, lore: ['坠入地底的海水在地火中凝成的光。', '云民叫它长明灯石，用它造通往家乡的门。'] }, { glowstone: glowstoneTex(95) });
reg('sea_lantern', { displayName: '海晶灯', light: 15, hardness: 0.3 }, { sea_lantern: seaLanternTex(96) });

// --- 传送门（迭代：原版式维度传送门）---
// portal 渲染薄片（门面方向由水平邻格推断，双面可见）+ 自发光（light:13 走光源 LUT/亮块重绘管线）；solid:false 可穿行。
// 框校验/点火/穿越逻辑在 src/core/Portals.js + Game.js。

// 下界传送门：紫色涡流能量幕
function netherPortalTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // 涡流：绕中心的极角域正弦 + 距离衰减（确定性 hash 抖动）
      const dx = x - 7.5, dy = y - 7.5;
      const ang = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
      const swirl = Math.sin(ang * 3 + r * 1.5 + seed * 0.13) * 0.5 + 0.5;
      const t = hash2(x, y, seed);
      const base = swirl > 0.62 ? [186, 92, 224] : swirl > 0.32 ? [124, 44, 178] : [74, 18, 118];
      px[y * 16 + x] = rgb(base, 0.88 + t * 0.28);
    }
  }
  return pixelSvg(px);
}

// 天域传送门：淡金/天白气流幕（萤石框配色呼应）
function aetherPortalTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const ang = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
      const swirl = Math.sin(ang * 2.4 - r * 1.1 + seed * 0.17) * 0.5 + 0.5;
      const t = hash2(x, y, seed);
      const base = swirl > 0.6 ? [252, 246, 208] : swirl > 0.3 ? [216, 232, 250] : [150, 190, 236];
      px[y * 16 + x] = rgb(base, 0.9 + t * 0.22);
    }
  }
  return pixelSvg(px);
}

reg('nether_portal', { displayName: '下界传送门', solid: false, transparent: true, renderType: 'portal', light: 13, hardness: 0.1, ambientParticles: true }, { nether_portal: netherPortalTex(97) });
reg('aether_portal', { displayName: '天域传送门', solid: false, transparent: true, renderType: 'portal', light: 13, hardness: 0.1, ambientParticles: true }, { aether_portal: aetherPortalTex(98) });
reg('torch', { displayName: '火把', transparent: true, light: 14, hardness: 0, renderType: 'cross', solid: false },
  { torch: (function () { const px = makeTex();
    // 火把：上半黄色火，下半棕色棍
    for (let y = 2; y < 6; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(255,200,50)';
    for (let y = 6; y < 14; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(120,80,40)';
    px[1 * 16 + 8] = 'rgb(255,230,100)';
    return pixelSvg(px); })()
  });

// --- 金面方块 ---
reg('iron_block', { hardness: 5, tool: 'pickaxe', minTier: 2 }, { iron_block: mineralBlockTex([219, 219, 219], 101) });
reg('gold_block', { hardness: 5, tool: 'pickaxe', minTier: 3 }, { gold_block: mineralBlockTex([250, 222, 90], 102) });
reg('diamond_block', { hardness: 5, tool: 'pickaxe', minTier: 3 }, { diamond_block: mineralBlockTex([98, 229, 226], 103) });
reg('emerald_block', { hardness: 5, tool: 'pickaxe' }, { emerald_block: mineralBlockTex([62, 216, 92], 104) });
reg('lapis_block', { hardness: 3, tool: 'pickaxe' }, { lapis_block: mineralBlockTex([40, 72, 204], 105) });
reg('coal_block', { hardness: 5, tool: 'pickaxe' }, { coal_block: noiseTex([28, 28, 28], 107, { dark: 0.8, light: 1.35, dProb: 0.3, lProb: 0.12 }) });

// --- 植物 ---
// 睡莲纹理：圆形绿叶 + 朝北 V 形缺口 + 放射叶脉（确定性像素画，无 Math.random）
function lilyPadTex(seed) {
  const px = makeTex();
  const leaf = [92, 148, 56], vein = [70, 118, 40], rim = [64, 110, 38], spot = [122, 172, 82];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > 7.4) continue; // 圆外透明
      // V 形缺口：从圆心向北（-y）张开的楔形
      if (dy < 0 && Math.abs(dx) < -dy * 0.5) continue;
      let c = leaf;
      if (r > 6.6) c = rim; // 边缘深色一圈
      else if (Math.abs(Math.abs(dx) - Math.abs(dy) * 1.4) < 0.9 && dy > -0.5) c = vein; // 放射叶脉
      else if (r < 2.2) c = spot; // 中心浅斑
      if (hash2(x, y, seed) > 0.86) c = vein; // 零散深点
      setPx(px, x, y, rgb(c));
    }
  }
  return pixelSvg(px);
}

reg('lily_pad', { displayName: '睡莲', transparent: true, solid: false, hardness: 0, renderType: 'flat' },
  { lily_pad: lilyPadTex(115) });
// 向日葵：绿茎双叶 + 黄瓣棕心花盘（cross 全高纹理，确定性像素画）
function sunflowerTex(seed) {
  const px = makeTex();
  const stem = [66, 122, 48], leaf = [88, 148, 60], petal = [232, 190, 40], core = [96, 66, 30];
  for (let y = 6; y < 16; y++) { setPx(px, 7, y, rgb(stem)); setPx(px, 8, y, rgb(stem)); }
  for (const [lx, ly] of [[4, 10], [5, 10], [5, 11], [10, 12], [11, 12], [11, 13]]) setPx(px, lx, ly, rgb(leaf));
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 3.5, r = Math.sqrt(dx * dx + dy * dy);
    if (r <= 4.4) setPx(px, x, y, rgb(r <= 1.9 ? core : petal, 1 + (hash2(x, y, seed) - 0.5) * 0.12));
  }
  return pixelSvg(px);
}
// 小蘑菇：白柄 + 圆帽（red 带白点），cross 纹理
function smallMushroomTex(seed, capColor, dots) {
  const px = makeTex();
  const stem = [224, 218, 205];
  for (let y = 9; y < 16; y++) { setPx(px, 7, y, rgb(stem)); setPx(px, 8, y, rgb(stem)); }
  for (let y = 5; y < 9; y++) for (let x = 3; x < 13; x++) {
    const dx = x - 7.5, dy = (y - 8.6) * 1.8, r = Math.sqrt(dx * dx + dy * dy);
    if (r <= 5.2) setPx(px, x, y, rgb(capColor, 1 + (hash2(x, y, seed) - 0.5) * 0.1));
  }
  if (dots) for (const [dx2, dy2] of [[5, 6], [9, 6], [7, 5], [4, 8], [10, 8]]) setPx(px, dx2, dy2, rgb([236, 232, 226]));
  return pixelSvg(px);
}
// 巨型蘑菇部件：白灰竖纹菌柄 / 红底白点菌盖 / 棕色菌盖
function mushroomStemTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const stripe = hash2(Math.floor(x / 2), Math.floor(y / 4), seed) > 0.72 ? 0.9 : 1;
    setPx(px, x, y, rgb([222, 216, 202], stripe * (1 + (hash2(x, y, seed + 1) - 0.5) * 0.06)));
  }
  return pixelSvg(px);
}
function mushroomCapRedTex(seed) {
  const px = makeTex();
  const base = [198, 44, 40];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    setPx(px, x, y, rgb(base, 1 + (hash2(x, y, seed) - 0.5) * 0.14));
    if (hash2(Math.floor(x / 3), Math.floor(y / 3), seed + 1) > 0.82) setPx(px, x, y, rgb([238, 234, 228]));
  }
  return pixelSvg(px);
}
reg('sunflower', { displayName: '向日葵', transparent: true, solid: false, hardness: 0, renderType: 'cross' },
  { sunflower: sunflowerTex(118) });
reg('red_mushroom', { displayName: '红色蘑菇', transparent: true, solid: false, hardness: 0, renderType: 'cross' },
  { red_mushroom: smallMushroomTex(119, [204, 42, 38], true) });
reg('brown_mushroom', { displayName: '棕色蘑菇', transparent: true, solid: false, hardness: 0, renderType: 'cross' },
  { brown_mushroom: smallMushroomTex(120, [148, 104, 62], false) });
reg('mushroom_stem', { displayName: '蘑菇柄', hardness: 0.3 },
  { mushroom_stem: mushroomStemTex(121) });
reg('mushroom_cap_red', { displayName: '红色蘑菇盖', hardness: 0.3 },
  { mushroom_cap_red: mushroomCapRedTex(122) });
reg('mushroom_cap_brown', { displayName: '棕色蘑菇盖', hardness: 0.3 },
  { mushroom_cap_brown: noiseTex([148, 104, 62], 123, { dark: 0.88, light: 1.1, dProb: 0.2, lProb: 0.14 }) });
reg('cactus', {
  transparent: true, solid: true, hardness: 0.4,
  textures: { top: 'cactus_top', side: 'cactus', bottom: 'cactus_top' },
}, { cactus: cactusTex(111), cactus_top: cactusTopTex(1111) });
reg('pumpkin', { textures: { top: 'pumpkin_top', side: 'pumpkin_side', bottom: 'pumpkin_top' }, hardness: 1 },
  { pumpkin_top: pumpkinTopTex(112), pumpkin_side: pumpkinSideTex(113) });
reg('melon', {
  hardness: 1,
  textures: { top: 'melon_top', side: 'melon', bottom: 'melon_top' },
}, { melon: melonTex(114), melon_top: melonTopTex(1141) });
reg('hay_block', { textures: { top: 'hay_top', side: 'hay_side', bottom: 'hay_top' }, hardness: 0.5 },
  { hay_top: hayTopTex(116), hay_side: haySideTex(117) });

// --- 下界/末地 ---
reg('netherrack', { hardness: 0.4, tool: 'pickaxe' }, { netherrack: blotchTex([102, 38, 38], 121, { dark: 0.65, light: 1.3, dProb: 0.28, lProb: 0.18 }) });
reg('end_stone', { hardness: 3, tool: 'pickaxe' }, { end_stone: blotchTex([219, 222, 167], 122, { dark: 0.86, light: 1.05, dProb: 0.3, lProb: 0.15 }) });
reg('soul_sand', { hardness: 0.5, tool: 'shovel', lore: ['坠潮裹挟的溺亡者沉进了泥沙。', '把耳朵贴近，雨夜里能听见很轻的潮声。'] }, { soul_sand: soulTex(123) });
reg('magma_block', { displayName: '岩浆块', light: 6, hardness: 0.5, tool: 'pickaxe' }, { magma_block: magmaTex(124) });
// 末影水晶：柱顶发光晶体（为龙回血；被击碎时爆炸，Game._breakCrystal 处理）
reg('end_crystal', { displayName: '末影水晶', light: 15, hardness: 0.5 }, { end_crystal: (function () {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const diag = (x + y) % 7;
    let c = 'rgb(96,44,146)';                                   // 深紫底
    if (diag === 0 || diag === 1) c = 'rgb(176,116,236)';       // 晶面斜纹
    if (hash2(x, y, 203) < 0.08) c = 'rgb(236,210,255)';        // 白高光
    if (x === 0 || x === 15 || y === 0 || y === 15) c = 'rgb(62,26,98)'; // 晶棱
    px[y * 16 + x] = c;
  }
  return pixelSvg(px); })()
});
// 龙蛋：末影龙击败掉落（装饰收藏方块）——终局篇 F1 补 lore 重释（§4 方案二「王所守之物」，
// 仅 tooltip，机制零改动）：王从滩涂尽头衔来的东西；不解释王在等什么（留白纪律）。
reg('dragon_egg', { displayName: '龙蛋', hardness: 3, tool: 'pickaxe', lore: ['王从滩涂尽头衔来的、涨潮之前的东西。', '它一直被守在潮的出生地——守着它的人，从不去解释为什么。'] }, { dragon_egg: (function () {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const wave = Math.sin((x + y * 0.6) * 0.9) * 0.5 + 0.5;
    let c = wave > 0.72 ? 'rgb(58,36,84)' : 'rgb(26,18,36)';    // 紫波纹鳞面
    if (hash2(x, y, 207) < 0.06) c = 'rgb(140,96,196)';         // 亮斑
    px[y * 16 + x] = c;
  }
  return pixelSvg(px); })()
});
// 末地折跃门：龙败后在主岛缘/外岛缘生成（基岩框内嵌光束；踩入触发同维传送）。
// Build 20 ②：视觉改末地传送门式——去 cross 渲染（正常立方面）、黑洞星空纹理
//（折跃门用绿色星点区分传送门的蓝白星点），solid:false 陷入语义不变。
reg('end_gateway', { displayName: '末地折跃门', transparent: true, solid: false, light: 15, hardness: -1, ambientParticles: true },
  { end_gateway: (function () { const px = makeTex();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = 'rgb(3,6,4)';                            // 黑洞底色（微绿）
      const t = hash2(x, y, 213);
      if (t > 0.93) px[y * 16 + x] = 'rgb(150,255,170)';        // 亮绿星点
      else if (t > 0.86) px[y * 16 + x] = 'rgb(60,140,80)';
      else if (t > 0.80) px[y * 16 + x] = 'rgb(20,50,28)';
    }
    return pixelSvg(px); })()
  });
// 紫珀系列：末地城主体材料（原版配色：淡紫底 + 深紫纹路）
reg('purpur_block', { displayName: '紫珀块', hardness: 1.5, tool: 'pickaxe' }, { purpur_block: (function () {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const t = hash2(x >> 2, y >> 2, 214);
    let c = t < 0.3 ? 'rgb(166,124,186)' : 'rgb(184,142,202)'; // 4×4 块状斑驳
    if ((x % 8 === 0 || y % 8 === 0)) c = 'rgb(146,104,166)';  // 拼缝
    px[y * 16 + x] = c;
  }
  return pixelSvg(px); })()
});
reg('purpur_pillar', { displayName: '紫珀柱', textures: { top: 'purpur_pillar_top', side: 'purpur_pillar_side', bottom: 'purpur_pillar_top' }, hardness: 1.5, tool: 'pickaxe' },
  { purpur_pillar_top: (function () { const px = makeTex();
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const ring = Math.max(Math.abs(x - 8), Math.abs(y - 8));
        px[y * 16 + x] = ring === 3 || ring === 6 ? 'rgb(146,104,166)' : 'rgb(184,142,202)';
      }
      return pixelSvg(px); })(),
    purpur_pillar_side: (function () { const px = makeTex();
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let c = (x === 3 || x === 12) ? 'rgb(146,104,166)' : 'rgb(180,138,198)'; // 竖棱
        if (x >= 6 && x <= 9 && y % 5 === 0) c = 'rgb(160,118,180)';            // 中槽纹
        px[y * 16 + x] = c;
      }
      return pixelSvg(px); })()
  });
reg('end_stone_bricks', { displayName: '末地砖', hardness: 3, tool: 'pickaxe' }, { end_stone_bricks: (function () {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let c = 'rgb(219,222,167)';
    const row = Math.floor(y / 8), off = (row % 2) * 4;
    if (y % 8 === 7 || (x + off) % 8 === 7) c = 'rgb(180,184,130)'; // 砖缝（错缝排布）
    if (hash2(x, y, 217) < 0.12) c = 'rgb(200,204,146)';
    px[y * 16 + x] = c;
  }
  return pixelSvg(px); })()
});
// 紫颂植物：末地城花园装饰（茎 = 节状柱；花 = 顶端白紫色十字植物，可采紫颂果掉落）
reg('chorus_plant', { displayName: '紫颂植株', transparent: true, solid: false, hardness: 0.4, renderType: 'cross' },
  { chorus_plant: (function () { const px = makeTex();
    for (let y = 2; y < 15; y++) {
      const w = (y % 4 < 2) ? 2 : 1;
      for (let x = 8 - w; x <= 8 + w; x++) px[y * 16 + x] = 'rgb(120,84,150)';
    }
    for (let x = 6; x <= 10; x++) px[2 * 16 + x] = 'rgb(150,112,182)';
    return pixelSvg(px); })()
  });
reg('chorus_flower', { displayName: '紫颂花', transparent: true, solid: false, hardness: 0.4, renderType: 'cross' },
  { chorus_flower: (function () { const px = makeTex();
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) {
      const edge = x === 3 || x === 12 || y === 3 || y === 12;
      px[y * 16 + x] = edge ? 'rgb(224,206,238)' : 'rgb(168,132,198)';
    }
    px[6 * 16 + 6] = 'rgb(120,84,150)'; px[9 * 16 + 9] = 'rgb(120,84,150)';
    px[6 * 16 + 9] = 'rgb(120,84,150)'; px[9 * 16 + 6] = 'rgb(120,84,150)';
    return pixelSvg(px); })()
  });

// --- 红石相关 ---
// B28：本名 = 未充能态（light 0）；充能态 `redstone_lamp_lit`（light 15）尾部追加注册，
// 由 RedstoneSystem 在充能边沿切换（此前红石灯恒亮 light:15、充能与否外观无差别）。
reg('redstone_lamp', { displayName: '红石灯', hardness: 0.3, baseBlock: 'redstone_lamp' },
  { redstone_lamp: redstoneLampTex(131, false), redstone_lamp_lit: redstoneLampTex(132, true) });
reg('redstone_torch', { displayName: '红石火把', transparent: true, light: 14, hardness: 0, renderType: 'cross', solid: false },
  { redstone_torch: (function () { const px = makeTex();
    for (let y = 2; y < 6; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(220,40,40)';
    for (let y = 6; y < 14; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(120,80,40)';
    px[1 * 16 + 8] = 'rgb(255,120,100)';
    return pixelSvg(px); })()
  });
reg('lever', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { lever: (function () { const px = makeTex();
    for (let y = 6; y < 14; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(100,70,40)';
    for (let y = 4; y < 7; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(160,160,160)';
    return pixelSvg(px); })()
  });
reg('stone_button', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { stone_button: (function () { const px = makeTex();
    for (let y = 7; y < 9; y++) for (let x = 6; x < 10; x++) px[y * 16 + x] = 'rgb(140,140,140)';
    return pixelSvg(px); })()
  });
reg('oak_button', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { oak_button: (function () { const px = makeTex();
    for (let y = 7; y < 9; y++) for (let x = 6; x < 10; x++) px[y * 16 + x] = 'rgb(160,130,70)';
    return pixelSvg(px); })()
  });
reg('redstone_wire', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { redstone_wire: (function () { const px = makeTex();
    for (let y = 7; y < 9; y++) for (let x = 4; x < 12; x++) px[y * 16 + x] = 'rgb(200,20,20)';
    return pixelSvg(px); })()
  });
// 红石块（仅注册一次；曾双注册被覆盖，light 保持 0 = 不发光）
reg('redstone_block', { light: 0, hardness: 5, tool: 'pickaxe' }, { redstone_block: noiseTex([188, 32, 32], 132, { dark: 0.85, light: 1.15, dProb: 0.3, lProb: 0.2 }) });
reg('piston', { textures: { top: 'piston_top', side: 'piston_side', bottom: 'piston_bottom' }, hardness: 1.5 }, {
  piston_top: pistonTopTex(133),
  piston_side: pistonSideTex(134),
  piston_bottom: pistonBottomTex(135)
});
reg('piston_head', {
  transparent: true, hardness: 0.5, solid: false,
  textures: { top: 'piston_head_top', side: 'piston_head_side', bottom: 'piston_head_bottom' },
}, {
  piston_head_top: pistonHeadTopTex(136),
  piston_head_side: pistonHeadSideTex(137),
  piston_head_bottom: pistonHeadBottomTex(138),
});
reg('sticky_piston', { textures: { top: 'sticky_piston_top', side: 'piston_side', bottom: 'piston_bottom' }, hardness: 1.5 }, {
  sticky_piston_top: stickyTopTex(137),
  piston_side: pistonSideTex(134),
  piston_bottom: pistonBottomTex(135)
});
reg('tnt', { textures: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom' }, hardness: 0, transparent: false }, {
  tnt_top: tntTopTex(141),
  tnt_side: tntSideTex(142),
  tnt_bottom: noiseTex([124, 40, 32], 143, { dark: 0.9, light: 1.1 })
});
// --- B27 门/床/活板门状态家族（状态 = 独立方块 ID，命名约定见 core/blockShape.js）---
const FACINGS = ['n', 's', 'e', 'w'];

// 门家族：8 状态/半格（4 朝向 × 开关），关态朝北下半沿用 base 本名（旧存档零迁移）
function regDoorFamily(base, hardness, extra = {}) {
  for (const half of ['lower', 'upper']) {
    for (const facing of FACINGS) {
      for (const open of [false, true]) {
        const name = open
          ? `${base}_${half}_${facing}_open`
          : (facing === 'n' ? (half === 'lower' ? base : `${base}_${half}`) : `${base}_${half}_${facing}`);
        reg(name, {
          displayName: extra.displayName || base,
          transparent: true, solid: true, hardness,
          textures: base,
          part: `door_${half}`, facing, open, baseBlock: base,
          shape: open ? doorOpenShape(facing) : doorClosedShape(facing),
          ...(extra.def || {}),
        }, { [base]: extra.texSvg });
      }
    }
  }
}

regDoorFamily('oak_door', 1, { displayName: '橡木门', texSvg: doorTex([162, 130, 78], 144) });
regDoorFamily('iron_door', 5, { displayName: '铁门', texSvg: doorTex([198, 198, 202], 145, true), def: { tool: 'pickaxe' } });

// 活板门：4 朝向 × 开关（关态朝北沿用本名）
for (const facing of FACINGS) {
  for (const open of [false, true]) {
    const name = open ? `oak_trapdoor_${facing}_open` : (facing === 'n' ? 'oak_trapdoor' : `oak_trapdoor_${facing}`);
    reg(name, {
      displayName: '橡木活板门', transparent: true, solid: true, hardness: 1,
      textures: 'oak_trapdoor',
      part: 'trapdoor', facing, open, baseBlock: 'oak_trapdoor',
      shape: trapdoorShape(facing, open),
    }, { oak_trapdoor: trapdoorTex(146) });
  }
}
// 音符盒（B28）：侧面 = 深色木框（原版音符盒四壁的木框），顶面 = 中央音符圆盘（只该出现在顶上）。
// 此前同一张带圆盘的图铺满六面，四面都像"顶"。
function noteBlockSidePx(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([120, 92, 56], 0.92 + hash2(x, y, seed) * 0.14);
  }
  const frame = rgb([70, 52, 32]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  fillRect(px, 2, 2, 13, 2, rgb([104, 78, 46]));
  fillRect(px, 2, 13, 13, 13, rgb([96, 72, 42]));
  return px;
}
function noteBlockSideTex(seed) { return pixelSvg(noteBlockSidePx(seed)); }

function noteBlockTopTex(seed) {
  const px = noteBlockSidePx(seed);
  fillRect(px, 5, 5, 10, 10, rgb([90, 68, 42]));
  fillRect(px, 7, 7, 8, 8, rgb([220, 214, 200]));
  setPx(px, 6, 6, rgb([186, 180, 166]));
  setPx(px, 9, 9, rgb([186, 180, 166]));
  return pixelSvg(px);
}

reg('note_block', {
  hardness: 1,
  textures: { top: 'note_block_top', side: 'note_block_side', bottom: 'note_block_side' },
}, { note_block_top: noteBlockTopTex(147), note_block_side: noteBlockSideTex(148) });

// --- 混凝土（染色算 1 种，以白色代表）---
reg('white_concrete', { hardness: 1.8, tool: 'pickaxe' }, { white_concrete: noiseTex([228, 228, 228], 151, { dark: 0.98, light: 1.02, dProb: 0.1, lProb: 0.1 }) });
reg('white_wool', { hardness: 0.8 }, { white_wool: (function () { const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let f = 0.95 + hash2(x, y, 152) * 0.08;
    if ((x * 3 + y * 7) % 13 === 0) f *= 0.94;
    px[y * 16 + x] = rgb([236, 236, 236], f);
  }
  return pixelSvg(px); })()
});
reg('white_terracotta', { hardness: 1.25, tool: 'pickaxe' }, { white_terracotta: noiseTex([180, 156, 138], 153, { dark: 0.93, light: 1.06 }) });
// 床：头/尾双格（4 朝向），foot 朝北沿用 white_bed 本名（旧存档零迁移）
function bedHeadTopTex() {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([238, 238, 240], 0.95 + hash2(x, y, 154) * 0.08);
  }
  const frame = rgb([200, 200, 206]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame); setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  // 枕头（居中：顶面 UV 映射随朝向旋转不可控，居中方枕四向可读）
  fillRect(px, 3, 4, 12, 11, rgb([250, 250, 252]));
  const pl = rgb([214, 214, 220]);
  for (let x = 3; x <= 12; x++) { setPx(px, x, 4, pl); setPx(px, x, 11, pl); }
  for (let y = 4; y <= 11; y++) { setPx(px, 3, y, pl); setPx(px, 12, y, pl); }
  return pixelSvg(px);
}
function bedFootTopTex() {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([238, 238, 240], 0.95 + hash2(x, y, 154) * 0.08);
  }
  const frame = rgb([200, 200, 206]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame); setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  // 毯子褶皱横纹
  const fold = rgb([222, 222, 228]);
  for (let y = 5; y <= 13; y += 3) fillRect(px, 2, y, 13, y, fold);
  return pixelSvg(px);
}
function bedSideTex() {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([232, 232, 236], 0.94 + hash2(x, y, 155) * 0.08);
  }
  fillRect(px, 0, 0, 15, 1, rgb([206, 206, 212])); // 顶缘床垫线
  fillRect(px, 0, 12, 15, 12, rgb([214, 214, 220])); // 床裙分缝
  return pixelSvg(px);
}
for (const half of ['foot', 'head']) {
  for (const facing of FACINGS) {
    const name = (half === 'foot' && facing === 'n') ? 'white_bed' : `white_bed_${half}_${facing}`;
    reg(name, {
      displayName: '白色床', transparent: true, solid: true, hardness: 0.2,
      textures: { top: half === 'head' ? 'white_bed_head_top' : 'white_bed_foot_top', side: 'white_bed_side', bottom: 'oak_planks' },
      part: `bed_${half}`, facing, open: false, baseBlock: 'white_bed',
      shape: BED_SHAPE,
    }, {
      white_bed_head_top: bedHeadTopTex(),
      white_bed_foot_top: bedFootTopTex(),
      white_bed_side: bedSideTex(),
      white_bed: bedFootTopTex(), // 物品栏图标沿用整体床贴图
    });
  }
}

// --- 容器方块（T5：箱子，内容经 loot.js 惰性生成） ---
// B28 定向面：正面（锁扣）只出现在 facing 边，其余三面为素木板——原版箱子的"前后左右不再相同"。
// 家族 4 状态：chest（朝北本名，旧存档/结构箱子零迁移）/ chest_s / chest_e / chest_w，
// 放置时正面朝玩家（Game._facingTowardPlayer）；facingBase 供放置路径替换 ID。
function chestBoardPx(seed) {
  const px = makeTex();
  const base = [168, 128, 74];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb(base, 0.92 + hash2(x, y, seed) * 0.16);
  }
  return px;
}

// 侧面：木板 + 四边暗框 + 横向盖缝（盖 1/3 处）
function chestSidePx(seed) {
  const px = chestBoardPx(seed);
  const base = [168, 128, 74];
  fillRect(px, 0, 0, 15, 0, rgb([94, 62, 32]));
  fillRect(px, 0, 15, 15, 15, rgb([82, 52, 24]));
  fillRect(px, 0, 0, 0, 15, rgb([94, 62, 32]));
  fillRect(px, 15, 0, 15, 15, rgb([82, 52, 24]));
  fillRect(px, 1, 5, 14, 5, rgb([94, 62, 32]));
  fillRect(px, 1, 1, 14, 1, rgb(base, 1.14));
  fillRect(px, 1, 6, 14, 6, rgb(base, 1.1));
  // 铁箍：左右两条竖带（原版箱子侧面的金属包角）
  fillRect(px, 3, 1, 3, 14, rgb([150, 150, 150]));
  fillRect(px, 12, 1, 12, 14, rgb([150, 150, 150]));
  return px;
}
function chestSideTex(seed) { return pixelSvg(chestSidePx(seed)); }

// 正面：侧面 + 中央锁扣（盖缝跨越的金属搭扣 + 钥匙孔）
function chestFrontTex(seed) {
  const px = chestSidePx(seed);
  fillRect(px, 7, 3, 8, 7, 'rgb(158,158,158)');
  fillRect(px, 6, 4, 9, 5, 'rgb(120,120,120)');
  fillRect(px, 7, 6, 8, 7, 'rgb(96,96,96)');   // 钥匙孔
  fillRect(px, 6, 3, 6, 7, 'rgb(120,120,120)');
  fillRect(px, 9, 3, 9, 7, 'rgb(120,120,120)');
  return pixelSvg(px);
}

// 顶面：盖板（内缩一圈 + 铰链侧压条 + 木纹横条）
function chestTopTex(seed) {
  const px = chestBoardPx(seed);
  const base = [168, 128, 74];
  fillRect(px, 0, 0, 15, 0, rgb([104, 70, 38]));
  fillRect(px, 0, 15, 15, 15, rgb([88, 58, 28]));
  fillRect(px, 0, 0, 0, 15, rgb([104, 70, 38]));
  fillRect(px, 15, 0, 15, 15, rgb([88, 58, 28]));
  fillRect(px, 1, 1, 14, 2, rgb(base, 1.16));  // 铰链压条
  fillRect(px, 1, 14, 14, 14, rgb(base, 0.86));
  for (let x = 2; x <= 13; x += 4) fillRect(px, x, 4, x, 13, rgb([150, 114, 64]));
  return pixelSvg(px);
}

// 底面：素木板（无盖缝无锁扣）
function chestBottomTex(seed) {
  const px = chestBoardPx(seed);
  fillRect(px, 0, 0, 15, 0, rgb([94, 62, 32]));
  fillRect(px, 0, 15, 15, 15, rgb([82, 52, 24]));
  fillRect(px, 0, 0, 0, 15, rgb([94, 62, 32]));
  fillRect(px, 15, 0, 15, 15, rgb([82, 52, 24]));
  return pixelSvg(px);
}

const CHEST_TEX = {
  top: 'chest_top', side: 'chest_side', bottom: 'chest_bottom', front: 'chest_front',
};
const CHEST_SVG = {
  chest_top: chestTopTex(961),
  chest_side: chestSideTex(962),
  chest_front: chestFrontTex(963),
  chest_bottom: chestBottomTex(964),
};
// 朝北 = 本名（旧存档/结构箱子/账本零迁移，ID 不变）；facingBase 让放置路径按玩家方位换态。
// 其余三朝向变体 `chest_s/_e/_w` **文件末尾追加**（新增 ID 一律尾部，防既有方块 ID 错位）。
reg('chest', {
  textures: CHEST_TEX, hardness: 2.5, facing: 'n', baseBlock: 'chest', facingBase: 'chest',
}, { ...CHEST_SVG });

// 潜影盒（Idea-2C）：27 槽随身容器方块，物品形态内容跟随（槽位 data 字段）
// 潜影盒（B28）：侧面 = 壳壁 + 盖缝 + 中央扣饰；顶面 = 同心壳板（盖子）；底面 = 素壳。
// 此前六面同一张"带扣饰的侧壁"，扣饰在头顶和脚底各出现一次。
function shulkerShellPx(seed) {
  const px = makeTex();
  const base = [172, 136, 200]; // 潜影紫
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb(base, 0.9 + hash2(x, y, seed) * 0.18);
  }
  return px;
}

function shulkerBoxSideTex(seed) {
  const px = shulkerShellPx(seed);
  const base = [172, 136, 200];
  fillRect(px, 0, 0, 15, 0, rgb([124, 94, 154]));
  fillRect(px, 0, 15, 15, 15, rgb([98, 74, 126]));
  fillRect(px, 0, 0, 0, 15, rgb([124, 94, 154]));
  fillRect(px, 15, 0, 15, 15, rgb([98, 74, 126]));
  fillRect(px, 1, 5, 14, 5, rgb([112, 84, 142])); // 盖缝
  fillRect(px, 1, 1, 14, 1, rgb(base, 1.14));     // 盖板受光
  fillRect(px, 7, 3, 8, 6, 'rgb(158,148,172)');   // 中央扣饰
  return pixelSvg(px);
}

function shulkerBoxTopTex(seed) {
  const px = shulkerShellPx(seed);
  const base = [172, 136, 200];
  fillRect(px, 0, 0, 15, 0, rgb([124, 94, 154]));
  fillRect(px, 0, 15, 15, 15, rgb([98, 74, 126]));
  fillRect(px, 0, 0, 0, 15, rgb([124, 94, 154]));
  fillRect(px, 15, 0, 15, 15, rgb([98, 74, 126]));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const r = Math.hypot(x - 7.5, y - 7.5);
    if (r > 6.4) px[y * 16 + x] = rgb([140, 108, 168]);
    else if (r > 3.6 && r < 4.6) px[y * 16 + x] = rgb(base, 1.12);
  }
  fillRect(px, 7, 7, 8, 8, rgb([158, 148, 172]));
  return pixelSvg(px);
}

function shulkerBoxBottomTex(seed) {
  const px = shulkerShellPx(seed);
  fillRect(px, 0, 0, 15, 0, rgb([124, 94, 154]));
  fillRect(px, 0, 15, 15, 15, rgb([98, 74, 126]));
  fillRect(px, 0, 0, 0, 15, rgb([124, 94, 154]));
  fillRect(px, 15, 0, 15, 15, rgb([98, 74, 126]));
  return pixelSvg(px);
}

reg('shulker_box', {
  displayName: '潜影盒', hardness: 2,
  lore: ['扣上就再没有缝的壳，摔不碎，也撬不开。', '拾遗者的行囊——他们的规矩：拾来的东西先装进自己的壳，再入库。'],
  textures: { top: 'shulker_box_top', side: 'shulker_box_side', bottom: 'shulker_box_bottom' },
}, {
  shulker_box_top: shulkerBoxTopTex(976),
  shulker_box_side: shulkerBoxSideTex(977),
  shulker_box_bottom: shulkerBoxBottomTex(978),
});

// --- 耕种（P3-4）：耕地 / 小麦作物 8 阶段 / 草丛（种子来源） ---
// 湿土：比 dirt 深 + 水渍暗斑 + 两条犁沟
function farmlandTex(seed) {
  const px = makeTex();
  const soil = [96, 66, 44];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const t = hash2(x, y, seed);
    let f = 1 + (hash2(x, y, seed + 1) - 0.5) * 0.08;
    if (t < 0.14) f *= 0.72;
    px[y * 16 + x] = rgb(soil, f);
  }
  fillRect(px, 0, 5, 15, 5, rgb(soil, 0.8));
  fillRect(px, 0, 11, 15, 11, rgb(soil, 0.8));
  return pixelSvg(px);
}

// 小麦 8 阶段：绿矮苗 → 高绿秆 → 金黄穗（5 株/格，高度与颜色随阶段插值）
function wheatTex(stage) {
  const px = makeTex();
  const h = 3 + Math.round((stage / 7) * 11);
  const t = stage / 7;
  const stalk = t < 0.7 ? [92, 150, 60] : [176, 158, 64];
  const head = [222, 190, 84];
  for (let i = 0; i < 5; i++) {
    const x = 2 + i * 3 + (hash2(i, stage, 41) > 0.5 ? 1 : 0);
    const sh = Math.max(2, h - Math.floor(hash2(i, 1, 42) * 3));
    for (let y = 15; y > 15 - sh; y--) {
      const f = 0.9 + hash2(x, y, 43) * 0.2;
      setPx(px, x, y, rgb(y < 15 - sh + 3 && t > 0.6 ? head : stalk, f));
    }
    if (t > 0.6) {
      setPx(px, x, 16 - sh - 1, rgb(head, 1.05));
      setPx(px, x - 1, 16 - sh, rgb(head, 0.95));
      setPx(px, x + 1, 16 - sh, rgb(head, 0.95));
    }
  }
  return pixelSvg(px);
}

// 草丛：7 株弯叶剪影
function tallGrassTex(seed) {
  const px = makeTex();
  const grass = [96, 152, 64];
  for (let i = 0; i < 7; i++) {
    const x = 1 + i * 2 + Math.floor(hash2(i, 0, seed) * 2);
    const h = 5 + Math.floor(hash2(i, 1, seed) * 7);
    for (let y = 15; y > 15 - h; y--) {
      const bend = (15 - y) > h * 0.6 ? (hash2(i, 2, seed) > 0.5 ? 1 : -1) : 0;
      setPx(px, x + bend, y, rgb(grass, 0.85 + hash2(x, y, seed + 3) * 0.3));
    }
  }
  return pixelSvg(px);
}

// 耕地（B28）：顶面 = 湿土 + 犁沟；侧面/底面 = 泥土（此前六面都是犁沟土，"田垄"出现在侧面）。
// icon 显式指回 top：默认图标取 side（=泥土）会让物品栏里的耕地变成一块土。
reg('farmland', {
  displayName: '耕地', tool: 'shovel', hardness: 0.6, icon: 'farmland',
  textures: { top: 'farmland', side: 'dirt', bottom: 'dirt' },
}, { farmland: farmlandTex(61) });
for (let s = 0; s <= 7; s++) {
  reg(`wheat_crop_${s}`, { displayName: '小麦', transparent: true, solid: false, hardness: 0, renderType: 'cross' },
    { [`wheat_crop_${s}`]: wheatTex(s) });
}
reg('tall_grass', { displayName: '草丛', transparent: true, solid: false, hardness: 0, renderType: 'cross' },
  { tall_grass: tallGrassTex(62) });

// 凋零骷髅头颅方块（Idea-2D-②，**文件末尾追加**防方块 ID 错位）：
// 与同名物品互通——放置消耗物品、破坏掉回同名物品；T 型摆塔（4 灵魂沙 + 3 头）召唤凋灵
// B28 定向面：五官只在正面（facing 边），侧面 = 颞骨 + 耳窝，顶面 = 颅缝 + 裂纹。
// 此前五官被画在四个侧面（前后左右一模一样的脸）；家族变体 `_s/_e/_w` 尾部追加。
function witherSkullBasePx(seed) {
  const px = makeTex();
  const bone = [64, 64, 70];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb(bone, 0.9 + hash2(x, y, seed) * 0.2);
  }
  return px;
}

// 正面：眼窝 + 鼻腔 + 獠牙列
function witherSkullFrontTex(seed) {
  const px = witherSkullBasePx(seed);
  const boneD = [44, 44, 50], boneHi = [92, 92, 98], socket = [14, 14, 18];
  fillRect(px, 0, 3, 15, 3, rgb(boneD));
  fillRect(px, 3, 6, 5, 7, rgb(socket));
  fillRect(px, 10, 6, 12, 7, rgb(socket));
  fillRect(px, 7, 9, 8, 10, rgb(socket));
  for (const x of [4, 6, 9, 11]) {
    setPx(px, x, 12, rgb(boneHi));
    setPx(px, x, 13, rgb(boneD));
  }
  return pixelSvg(px);
}

// 侧面：颅缝 + 颞骨暗带 + 耳窝（无眼鼻）
function witherSkullSideTex(seed) {
  const px = witherSkullBasePx(seed);
  const boneD = [44, 44, 50], boneHi = [92, 92, 98];
  fillRect(px, 0, 3, 15, 3, rgb(boneD));
  fillRect(px, 0, 4, 15, 5, rgb([56, 56, 62]));
  fillRect(px, 10, 8, 12, 10, rgb([36, 36, 42])); // 耳窝
  setPx(px, 11, 9, rgb([22, 22, 26]));
  fillRect(px, 3, 12, 6, 12, rgb(boneHi));
  return pixelSvg(px);
}

// 顶面：颅缝十字 + 骨缝裂纹（原版头颅顶）
function witherSkullTopTex(seed) {
  const px = witherSkullBasePx(seed);
  const boneD = [40, 40, 46], boneHi = [96, 96, 102];
  fillRect(px, 0, 7, 15, 8, rgb(boneD));
  fillRect(px, 7, 0, 8, 15, rgb(boneD));
  for (const [cx, cy] of [[3, 3], [12, 4], [4, 11], [11, 12]]) setPx(px, cx, cy, rgb(boneHi));
  return pixelSvg(px);
}

reg('wither_skeleton_skull', {
  displayName: '凋零骷髅头颅', hardness: 1,
  textures: { top: 'wither_skull_top', side: 'wither_skull_side', bottom: 'wither_skull_top', front: 'wither_skull_front' },
  facing: 'n', baseBlock: 'wither_skeleton_skull', facingBase: 'wither_skeleton_skull',
}, {
  wither_skull_top: witherSkullTopTex(131),
  wither_skull_side: witherSkullSideTex(132),
  wither_skull_front: witherSkullFrontTex(133),
});

// 信标（Idea-2D-③；B28 拆面）：顶面 = 下界之星（唯一发光面），侧面 = 黑曜石框 + 玻璃带 + 金角，
// 底面 = 黑曜石底座。此前六面同一张四芒星图，星的四面都亮。
function beaconSideTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([26, 28, 40], 0.9 + hash2(x, y, seed) * 0.2); // 深夜蓝底（黑曜石）
  }
  // 中段玻璃带（半透青白），带内可见微光
  fillRect(px, 1, 6, 14, 9, rgb([118, 176, 190], 0.92 + 0.08));
  for (let x = 1; x <= 14; x += 3) fillRect(px, x, 6, x, 9, rgb([96, 148, 164]));
  // 四角金饰
  for (const [cx, cy] of [[1, 1], [14, 1], [1, 14], [14, 14]]) {
    fillRect(px, cx, cy, cx + 1, cy + 1, rgb([226, 184, 92]));
  }
  fillRect(px, 0, 0, 15, 0, rgb([14, 15, 24]));
  fillRect(px, 0, 15, 15, 15, rgb([14, 15, 24]));
  return pixelSvg(px);
}

function beaconTopTex() {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([26, 28, 40], 0.9 + hash2(x, y, 141) * 0.2);
  }
  const star = [240, 238, 220];
  fillRect(px, 7, 2, 8, 13, rgb(star, 0.95));
  fillRect(px, 2, 7, 13, 8, rgb(star, 0.95));
  fillRect(px, 6, 6, 9, 9, rgb([255, 255, 245]));
  setPx(px, 5, 5, rgb(star)); setPx(px, 10, 5, rgb(star));
  setPx(px, 5, 10, rgb(star)); setPx(px, 10, 10, rgb(star));
  for (const [cx, cy] of [[1, 1], [14, 1], [1, 14], [14, 14]]) {
    fillRect(px, cx, cy, cx + 1, cy + 1, rgb([226, 184, 92]));
  }
  return pixelSvg(px);
}

function beaconBottomTex() {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([20, 22, 32], 0.9 + hash2(x, y, 142) * 0.2);
  }
  for (const [cx, cy] of [[1, 1], [14, 1], [1, 14], [14, 14]]) {
    fillRect(px, cx, cy, cx + 1, cy + 1, rgb([196, 158, 78]));
  }
  return pixelSvg(px);
}

reg('beacon', {
  displayName: '信标', light: 15, hardness: 3, tool: 'pickaxe',
  textures: { top: 'beacon_top', side: 'beacon_side', bottom: 'beacon_bottom' },
}, {
  beacon_top: beaconTopTex(),
  beacon_side: beaconSideTex(143),
  beacon_bottom: beaconBottomTex(),
});

// ── 天域叙事基石（批次 A，**文件末尾追加**防方块 ID 错位）────────────────
// 星髓 = 凝固的潮之力（docs/aether-storyline.md §2.2）：矿石 teal 晶簇 / 块体亮脉络。
// star_marrow_ore 掉落映射在 Game._blockDrops（→ star_marrow，非矿块本体）。
reg('star_marrow_ore', { hardness: 3, tool: 'pickaxe', minTier: 2 },
  { star_marrow_ore: oreTex([125, 125, 125], [96, 232, 210], 151) });

function marrowBlockTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([204, 238, 230], 0.94 + hash2(x, y, seed) * 0.12);
  }
  // 对角脉络：亮青主脉 + 白芯（凝固潮光）
  for (let i = 0; i < 16; i++) {
    px[i * 16 + ((i * 5 + 3) % 16)] = rgb([120, 228, 210]);
    if (i % 3 === 0) px[i * 16 + ((i * 5 + 4) % 16)] = rgb([244, 255, 252]);
    px[i * 16 + ((i * 11 + 9) % 16)] = rgb([156, 232, 220], 0.92);
  }
  return pixelSvg(px);
}
reg('star_marrow_block', { light: 13, hardness: 1.5, tool: 'pickaxe', minTier: 1 },
  { star_marrow_block: marrowBlockTex(152) });

function cloudWoolTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    // 云绒：雪白底 + 大颗粒团块（2×2 块状斑驳）+ 极淡青阴影
    const t = hash2(x >> 1, y >> 1, seed);
    const f = 0.96 + hash2(x, y, seed + 1) * 0.06;
    px[y * 16 + x] = t < 0.22 ? rgb([214, 226, 238], f) : rgb([243, 247, 251], f);
  }
  return pixelSvg(px);
}
reg('cloud_wool', { hardness: 0.4 }, { cloud_wool: cloudWoolTex(153) });

function steleTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([128, 132, 142], 0.92 + hash2(x, y, seed) * 0.14);
  }
  // 风纹刻痕：三道水平凹槽 + 一枚青色风纹符（微光）
  for (const y of [3, 7, 11]) {
    for (let x = 2; x <= 13; x++) px[y * 16 + x] = rgb([96, 100, 110]);
  }
  for (const [x, y] of [[6, 5], [7, 5], [8, 5], [9, 6], [7, 7], [8, 7], [8, 8]]) {
    px[y * 16 + x] = rgb([110, 220, 205], 0.95);
  }
  return pixelSvg(px);
}
reg('wind_stele', { hardness: -1, stele: true }, { wind_stele: steleTex(154) });

function altarTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([222, 204, 148], 0.93 + hash2(x, y, seed) * 0.12);
  }
  // 恒昼日轮：中央亮盘 + 边缘短芒 + 暗色描边
  for (let y = 4; y <= 11; y++) for (let x = 4; x <= 11; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    if (dx * dx + dy * dy <= 12) px[y * 16 + x] = rgb([250, 238, 186]);
  }
  px[7 * 16 + 7] = px[7 * 16 + 8] = px[8 * 16 + 7] = px[8 * 16 + 8] = rgb([255, 252, 232]);
  for (const [x, y] of [[2, 7], [2, 8], [13, 7], [13, 8], [7, 2], [8, 2], [7, 13], [8, 13]]) {
    px[y * 16 + x] = rgb([206, 178, 116]);
  }
  return pixelSvg(px);
}
reg('aether_altar', { light: 13, hardness: -1 }, { aether_altar: altarTex(155) });

function windCurrentTex() {
  const px = makeTex();
  // 气流：cross 渲染 + 二值 alpha（solid 材质 alphaTest 0.1 且 transparent:false——
  // 半透明像素会被按不透明画成色块，只有 0/全透二值才安全，火把同款纪律）
  for (let y = 0; y < 16; y++) {
    for (const bx of [4, 11]) {
      const x = (bx + Math.round(Math.sin(y * 0.8) * 1.5) + 16) % 16;
      px[y * 16 + x] = y % 4 === 0 ? 'rgb(200,240,255)' : 'rgb(168,226,244)';
    }
  }
  return pixelSvg(px);
}
reg('wind_current', { solid: false, transparent: true, renderType: 'cross', updraft: true, hardness: 0.3 },
  { wind_current: windCurrentTex() });

// 风阵块（天域批次 B）：合成气流发射器——放置时上方 12 格写风流柱（Game._placeGaleBlock）
function galeBlockTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    // 云白底 + 青色回旋纹（风眼）
    const t = hash2(x >> 1, y >> 1, seed);
    px[y * 16 + x] = t < 0.2 ? rgb([208, 222, 236], 1) : rgb([240, 246, 251], 1);
  }
  for (let a = 0; a < 24; a++) {
    const r = 2 + (a % 3) * 1.6, ang = a / 24 * Math.PI * 2;
    const x = 8 + Math.round(Math.cos(ang) * r), y = 8 + Math.round(Math.sin(ang) * r);
    if (x >= 0 && x < 16 && y >= 0 && y < 16) px[y * 16 + x] = a % 2 ? rgb([96, 232, 210]) : rgb([120, 210, 226]);
  }
  return pixelSvg(px);
}
reg('gale_block', { hardness: 1.2, tool: 'pickaxe' }, { gale_block: galeBlockTex(156) });

// 潮心祭坛（批次 D）：复潮仪式后由恒昼祭坛置换而来（setBlock 进账本，存档/联机天然一致）。
// 右键浮现第九章碑文（复潮）；light 13 兼任照明。
function tideAltarTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([148, 168, 186], 0.93 + hash2(x, y, seed) * 0.12); // 蓝灰潮石底
  }
  // 中央潮心：青色心形 + 暗描边 + 一弯新月纹（长夜归还）
  for (let y = 4; y <= 11; y++) for (let x = 4; x <= 11; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    if (dx * dx + dy * dy <= 12) px[y * 16 + x] = rgb([96, 214, 196]);
  }
  px[6 * 16 + 6] = px[6 * 16 + 9] = px[8 * 16 + 7] = px[8 * 16 + 8] = rgb([222, 255, 248]);
  px[5 * 16 + 7] = px[5 * 16 + 8] = rgb([222, 255, 248]);
  for (const [x, y] of [[2, 7], [2, 8], [13, 7], [13, 8], [7, 2], [8, 2], [7, 13], [8, 13]]) {
    px[y * 16 + x] = rgb([86, 118, 140]);
  }
  return pixelSvg(px);
}
reg('tide_altar', { light: 13, hardness: -1 }, { tide_altar: tideAltarTex(157) });

// 烬纹石碑（世界观批次 N1：下界石碑家族第二员）：暗色岩底 + 三道凹槽 + 余烬裂纹符
// 与风纹石碑同构（steleTex 同款布局），色系换成烬火（炭黑底/余烬橙红），章节随批次 N2 注册
function emberSteleTex() {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([58, 54, 58], 0.9 + hash2(x, y, 158) * 0.18);
  }
  for (const y of [3, 7, 11]) {
    for (let x = 2; x <= 13; x++) px[y * 16 + x] = rgb([40, 37, 41]);
  }
  // 余烬裂纹符：一道自上而下的裂谷 + 残火斑点（微光感）
  for (const [x, y] of [[8, 4], [8, 5], [7, 6], [8, 6], [9, 7], [8, 7], [8, 8], [7, 9]]) {
    px[y * 16 + x] = rgb([236, 126, 58], 0.95);
  }
  for (const [x, y] of [[6, 5], [10, 6], [6, 8], [9, 9], [8, 10]]) {
    px[y * 16 + x] = rgb([196, 74, 34], 0.9);
  }
  return pixelSvg(px);
}
reg('ember_stele', { hardness: -1, stele: true }, { ember_stele: emberSteleTex() });

// 苔纹石碑（世界观批次 W1：主世界石碑家族第三员）：风纹石碑同构，色系换成雨土
// （湿苔岩底/青蓝雨纹符），章节本批注册（雨土纪 3 章），碑位随批次 W2/W3 落入潮冢/村庄/要塞
function mossSteleTex() {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([116, 120, 106], 0.9 + hash2(x, y, 159) * 0.16);
  }
  // 湿苔斑：四角与边缘零星苔点
  for (const [x, y] of [[2, 2], [3, 2], [2, 3], [13, 2], [2, 13], [12, 12], [13, 12], [12, 13], [13, 13], [3, 12], [12, 3], [14, 8], [1, 8]]) {
    px[y * 16 + x] = rgb([88, 118, 72], 0.95);
  }
  for (const y of [3, 7, 11]) {
    for (let x = 2; x <= 13; x++) px[y * 16 + x] = rgb([84, 90, 76]);
  }
  // 雨纹符：一竖三滴（咸雨意象，青蓝湿光 + 微亮水点）
  for (let y = 4; y <= 8; y++) px[y * 16 + 8] = rgb([86, 148, 160], 0.95);
  for (const [x, y] of [[6, 9], [10, 9], [7, 6], [9, 5], [6, 12], [10, 12]]) {
    px[y * 16 + x] = rgb([86, 148, 160], 0.9);
  }
  for (const [x, y] of [[7, 10], [9, 10]]) {
    px[y * 16 + x] = rgb([150, 202, 204], 0.9);
  }
  return pixelSvg(px);
}
reg('moss_stele', { hardness: -1, stele: true }, { moss_stele: mossSteleTex() });

// 界纹石碑（世界观批次 E1：末地石碑家族第四员）：风纹石碑同构，色系换成无潮彼岸
// （苍白滩岩底/界门轮廓符——内芯只刻半截，扣「碑文不写满」的留白），章节本批注册
// （彼岸碑文 2 章），碑位随批次 E2 落入拾遗者石环
function endSteleTex() {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([204, 202, 186], 0.9 + hash2(x, y, 160) * 0.14);
  }
  for (const y of [3, 7, 11]) {
    for (let x = 2; x <= 13; x++) px[y * 16 + x] = rgb([176, 174, 160]);
  }
  // 界纹符：界门轮廓（两竖一梁）+ 内芯半截短竖（未刻完的字）+ 底部两点紫斑
  for (let y = 4; y <= 10; y++) {
    px[y * 16 + 6] = rgb([92, 72, 120], 0.95);
    px[y * 16 + 10] = rgb([92, 72, 120], 0.95);
  }
  for (let x = 6; x <= 10; x++) px[3 * 16 + x] = rgb([92, 72, 120], 0.95);
  for (const [x, y] of [[8, 6], [8, 7]]) px[y * 16 + x] = rgb([178, 128, 208], 0.9);
  for (const [x, y] of [[7, 12], [9, 12]]) px[y * 16 + x] = rgb([140, 100, 176], 0.9);
  return pixelSvg(px);
}
reg('end_stele', { hardness: -1, stele: true }, { end_stele: endSteleTex() });

// 原初祭坛（终局篇 F1「候潮基石」）：候潮仪式的受体——潮心祭坛右键献齐三潮之证后
// 置换而来（setBlock 进账本，存档/联机天然一致）。潮石底 + 原初波纹环 + 三点滴纹：
// 环是海还没有名字时的颜色，三点滴是三枚旧心跳（风、坠、雨）落座的位置。
// 右键行为见 Game.js _tryPrimordialOffering：候潮后 F3 听潮仪式在此挂终局钩子。
function primordialAltarTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([148, 168, 186], 0.93 + hash2(x, y, seed) * 0.12); // 蓝灰潮石底（潮心祭坛同源）
  }
  // 原初波纹环：外环暗潮线 + 内环月白回声（比潮心的青更古旧）
  for (let a = 0; a < 30; a++) {
    const ang = a / 30 * Math.PI * 2;
    const rx = 8 + Math.round(Math.cos(ang) * 5.4), ry = 8 + Math.round(Math.sin(ang) * 5.4);
    if (rx >= 0 && rx < 16 && ry >= 0 && ry < 16) px[ry * 16 + rx] = rgb([86, 118, 140]);
  }
  for (let a = 0; a < 20; a++) {
    const ang = a / 20 * Math.PI * 2;
    const rx = 8 + Math.round(Math.cos(ang) * 3), ry = 8 + Math.round(Math.sin(ang) * 3);
    if (rx >= 0 && rx < 16 && ry >= 0 && ry < 16) px[ry * 16 + rx] = rgb([222, 240, 240], 0.92);
  }
  // 三点滴纹：三证落座点（上=风、左下=坠、右下=雨）
  for (const [x, y] of [[8, 1], [2, 11], [13, 11]]) {
    px[y * 16 + x] = rgb([120, 214, 206], 0.95);
    px[(y + 1) * 16 + x] = rgb([96, 190, 190], 0.95);
  }
  return pixelSvg(px);
}
reg('primordial_altar', { light: 13, hardness: -1 }, { primordial_altar: primordialAltarTex(224) });

// 鲸骨块（鲸骨冢篇 K1）：月白骨面 + 三道肋纹浅凹 + 骨孔——天海巨鲸的骨骼建材。
// 天域"海来过"的实物证词载体（潮冢骨环沉于海底，鲸骨拱搁浅在天空——一沉一浮）。
function whaleBoneTex() {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([226, 224, 210], 0.92 + hash2(x, y, 232) * 0.1);
  }
  for (const y of [3, 8, 13]) {
    for (let x = 0; x < 16; x++) {
      if (hash2(x, y, 233) < 0.8) px[y * 16 + x] = rgb([198, 195, 180]); // 肋纹浅凹
    }
  }
  px[6 * 16 + 5] = rgb([176, 172, 156]); // 骨孔
  px[11 * 16 + 10] = rgb([176, 172, 156]);
  return pixelSvg(px);
}
reg('whale_bone_block', { hardness: 1.5, tool: 'pickaxe' }, { whale_bone_block: whaleBoneTex() });

// ── B28 定向面/状态家族变体（**一律文件末尾追加**：既存方块 ID 一律不动，旧存档/联机账本零迁移）──
// 命名约定见 src/core/blockShape.js facingId()：家族本名 = 朝北态，其余 `${family}_${facing}`。
// 变体必须带 baseBlock（掉落映射回基础物品）与 facing（渲染逐面取纹理）。

// 箱子：朝北 = 'chest'（本名，结构箱子/旧存档同 ID）；其余三朝向
for (const facing of ['s', 'e', 'w']) {
  reg(`chest_${facing}`, {
    textures: CHEST_TEX, hardness: 2.5, facing, baseBlock: 'chest',
    displayName: '箱子',
  }, { ...CHEST_SVG });
}

// 熔炉：未点燃三朝向 + 点燃四朝向（点燃态 light 13 走亮块管线，Game.updateFurnaces 切换）
for (const facing of ['s', 'e', 'w']) {
  reg(`furnace_${facing}`, {
    textures: FURNACE_TEX, hardness: 3.5, tool: 'pickaxe', minTier: 1,
    facing, baseBlock: 'furnace', lit: false, displayName: '熔炉',
  }, { ...FURNACE_SVG });
}
const FURNACE_LIT_TEX = { ...FURNACE_TEX, front: 'furnace_front_lit' };
for (const facing of ['n', 's', 'e', 'w']) {
  const name = facing === 'n' ? 'furnace_lit' : `furnace_lit_${facing}`;
  reg(name, {
    textures: FURNACE_LIT_TEX, hardness: 3.5, tool: 'pickaxe', minTier: 1, light: 13,
    facing, baseBlock: 'furnace', lit: true, displayName: '熔炉',
  }, { ...FURNACE_SVG });
}

// 凋零骷髅头颅：五官只在正面（facing 边）
for (const facing of ['s', 'e', 'w']) {
  reg(`wither_skeleton_skull_${facing}`, {
    displayName: '凋零骷髅头颅', hardness: 1, facing, baseBlock: 'wither_skeleton_skull',
    textures: { top: 'wither_skull_top', side: 'wither_skull_side', bottom: 'wither_skull_top', front: 'wither_skull_front' },
  }, {
    wither_skull_top: witherSkullTopTex(131),
    wither_skull_side: witherSkullSideTex(132),
    wither_skull_front: witherSkullFrontTex(133),
  });
}

// 红石灯充能态（light 15；未充能本名 light 0，两态由 RedstoneSystem 切换）
reg('redstone_lamp_lit', {
  displayName: '红石灯', hardness: 0.3, light: 15, lit: true, baseBlock: 'redstone_lamp',
}, { redstone_lamp_lit: redstoneLampTex(132, true) });

export const BlockSVGDefinitions = svgMap;

export function getBlockCount() {
  return BlockRegistry.all().length;
}
