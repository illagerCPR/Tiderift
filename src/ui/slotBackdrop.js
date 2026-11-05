// slotBackdrop.js -- 槽位空槽底纹（B45）
// 原版语义：空槽显示轮廓纹样，放入物品即隐藏（否则纹样会从物品贴图的透明处透出来）。
// 只改 backgroundImage 系列，不碰底色/边框，所以能直接叠在 makeSlotEl 的 #8b8b8b 上。
// 纯 DOM 小工具（只依赖传入元素的 style），node 可用假元素单测；盔甲槽与纹章槽共用同一入口。

const BACKDROP_SIZE = '32px 32px';

export function applySlotBackdrop(el, icon, hasItem) {
  if (!el || !el.style) return;
  el.style.backgroundImage = (!hasItem && icon) ? `url("${icon}")` : 'none';
  el.style.backgroundRepeat = 'no-repeat';
  el.style.backgroundPosition = 'center';
  el.style.backgroundSize = BACKDROP_SIZE;
}

// 便于测试/调用方核对常量（纹样绘制在 32×32 画布上，与物品图标同一尺寸）
export const SLOT_BACKDROP_SIZE = BACKDROP_SIZE;
