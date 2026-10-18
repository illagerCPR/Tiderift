// posKey.js -- 方块坐标键 "x,y,z" 的唯一编解码（账本键/计划队列键/红石键同格式，勿改）

export function posKey(x, y, z) { return `${x},${y},${z}`; }

// 解析 "x,y,z"；非法键得到 NaN 分量，与旧 split(',').map(Number) 同为 NaN（调用方自带越界守卫）
export function parsePosKey(k) {
  const i = k.indexOf(',');
  const j = k.indexOf(',', i + 1);
  return { x: +k.slice(0, i), y: +k.slice(i + 1, j), z: +k.slice(j + 1) };
}
