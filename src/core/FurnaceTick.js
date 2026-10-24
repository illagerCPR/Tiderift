// FurnaceTick.js -- Build 36 F-2 熔炉烧炼推进的纯算法（服务器权威 tick 与单机本地 tick 共用）
// 无浏览器/Three 依赖，node 可测。状态对象 = {input, fuel, output, burnTime, burnMax, cookTime}
// 单位：burnTime/burnMax/cookTime 都是秒。语义对齐原版：燃料燃尽暂停（进度保温缓慢回退）、
// 输出槽同类未满才续烧、燃料点燃即扣 1 个、断料清进度。
import { SMELT_TIME, getSmeltingResult, getFuelTime } from './Smelting.js';

export function emptyFurnaceState() {
  return { input: null, fuel: null, output: null, burnTime: 0, burnMax: 0, cookTime: 0 };
}

// 槽位指纹：判断本 tick 是否改动了内容物（供调用方决定是否广播/落盘）
function slotSig(st) {
  const one = (s) => (s ? `${s.name}|${s.count}|${s.data ? 1 : 0}` : '-');
  return `${one(st.input)}/${one(st.fuel)}/${one(st.output)}`;
}

// 推进一个熔炉 dt 秒（原地改 st）。返回 { slotsChanged, litChanged }。
export function tickFurnaceState(st, dt) {
  const out = { slotsChanged: false, litChanged: false };
  if (!st || !(dt > 0)) return out;
  const litBefore = st.burnTime > 0;
  const sigBefore = slotSig(st);
  const recipe = st.input ? getSmeltingResult(st.input.name) : null;
  const canSmelt = !!(recipe && (!st.output ||
    (st.output.name === recipe.output && st.output.count + recipe.count <= 64)));
  if (st.burnTime > 0) st.burnTime -= dt;
  if (st.burnTime <= 0 && canSmelt && st.fuel) {
    const ft = getFuelTime(st.fuel.name);
    if (ft > 0) {
      st.burnMax = ft;
      st.burnTime = ft;
      st.fuel.count--;
      if (st.fuel.count <= 0) st.fuel = null;
    }
  }
  if (st.burnTime > 0 && canSmelt) {
    st.cookTime += dt;
    // 有界循环：大步长 dt（卡顿/追赶）也能连续产出，不积压 cookTime
    let guard = 0;
    while (st.cookTime >= SMELT_TIME && guard++ < 64) {
      const r = st.input ? getSmeltingResult(st.input.name) : null;
      if (!r || (st.output && (st.output.name !== r.output || st.output.count + r.count > 64))) break;
      st.cookTime -= SMELT_TIME;
      if (st.output) st.output.count += r.count;
      else st.output = { name: r.output, count: r.count, data: null };
      st.input.count--;
      if (st.input.count <= 0) st.input = null;
    }
    if (!st.input) st.cookTime = 0; // 断料清进度（原版语义）
  } else if (st.cookTime > 0) {
    // 熄火/断料：进度缓慢回退而不是瞬间清零
    st.cookTime = Math.max(0, st.cookTime - dt * 2);
  }
  out.slotsChanged = slotSig(st) !== sigBefore;
  out.litChanged = (st.burnTime > 0) !== litBefore;
  return out;
}
