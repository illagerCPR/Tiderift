// build45-slot-backdrop.mjs -- Build 45 盔甲槽空槽纹样回归（纯 node，不依赖 DOM）
// 断言：
//   ① 空槽 + 有纹样 → backgroundImage 挂上纹样，repeat/position/size 就位；
//   ② 有物品 → backgroundImage 为 none（原版语义：穿上盔甲即隐藏，纹样不再从贴图透明处透出）；
//   ③ 无纹样 / 无元素 → 不抛错、不写图；只动 backgroundImage 系列，不碰底色（不写 background 简写）；
//   ④ 接线绊线：InventoryScreen 盔甲槽按「有无物品」调用、纹章槽同源、旧的「无条件铺底纹」已移除。
import { readFileSync } from 'fs';
import { applySlotBackdrop, SLOT_BACKDROP_SIZE } from '../src/ui/slotBackdrop.js';
import { ok, finish } from './harness.mjs';

const ICON = 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E';
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const fakeEl = () => ({ style: { backgroundColor: '#8b8b8b' } });

// ── ① 空槽显示纹样 ─────────────────────────────────────────────────────
{
  const el = fakeEl();
  applySlotBackdrop(el, ICON, false);
  ok(el.style.backgroundImage === `url("${ICON}")`, '空槽：backgroundImage 挂上纹样');
  ok(el.style.backgroundRepeat === 'no-repeat', '空槽：不重复平铺');
  ok(el.style.backgroundPosition === 'center', '空槽：居中');
  ok(el.style.backgroundSize === SLOT_BACKDROP_SIZE, '空槽：32×32（与物品图标同尺寸）');
  ok(el.style.backgroundColor === '#8b8b8b', '空槽：底色不被改动（不写 background 简写）');
}

// ── ② 有物品即隐藏 ─────────────────────────────────────────────────────
{
  const el = fakeEl();
  applySlotBackdrop(el, ICON, true);
  ok(el.style.backgroundImage === 'none', '有物品：纹样隐藏（原版语义）');
  ok(el.style.backgroundColor === '#8b8b8b', '有物品：底色保持');
}

// ── ③ 边界：无纹样/无元素/空字符串 ──────────────────────────────────────
{
  const el = fakeEl();
  applySlotBackdrop(el, null, false);
  ok(el.style.backgroundImage === 'none', '无纹样：不写 backgroundImage');

  const empty = fakeEl();
  applySlotBackdrop(empty, '', false);
  ok(empty.style.backgroundImage === 'none', '空纹样字符串：不写图');

  let threw = false;
  try {
    applySlotBackdrop(null, ICON, false);
    applySlotBackdrop({}, ICON, false);
    applySlotBackdrop(undefined, ICON, true);
  } catch (e) { threw = true; }
  ok(!threw, '无元素/无 style：静默返回不抛错');

  const helper = src('../src/ui/slotBackdrop.js');
  ok(!helper.includes('style.background =') && !helper.includes('style.background +='),
    '绊线：辅助函数不写 background 简写（会连带清底色/边框）');
  ok(helper.includes('style.backgroundImage'), '核实：只改 backgroundImage');
}

// ── ④ 接线绊线 ─────────────────────────────────────────────────────────
{
  const inv = src('../src/ui/InventoryScreen.js');
  ok(inv.includes("import { applySlotBackdrop } from './slotBackdrop.js'"), '接线：InventoryScreen 引入统一入口');
  ok(inv.includes('el.dataset.armorIcon = ARMOR_ICONS[i]'), '接线：纹样随槽位元素存放（渲染期才知道有没有物品）');
  ok(inv.includes('applySlotBackdrop(el, el.dataset.armorIcon, !!this.inventory.armor[idx])'),
    '接线：盔甲槽按「有无物品」切换纹样');
  ok(!inv.includes('url(${ARMOR_ICONS[i]})'), '绊线：盔甲槽不再无条件铺底纹（B45 的 bug 根因）');
  ok(inv.includes('applySlotBackdrop(emblemSlot, emblemSlotIcon(), worn)'),
    '接线：纹章槽同样走辅助函数（已佩戴 = 无底纹，语义一致）');
  ok(inv.includes('ARMOR_ICONS[i]'), '核实：四件套轮廓仍按槽位下发');
}

finish('build45-slot-backdrop');
