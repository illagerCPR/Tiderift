// netMessage.js -- 服务器消息入口解析（S13）：脏包/空值一律返回 null，调用方据此整条丢弃
export function parseServerMessage(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  if (typeof m.t !== 'string') return null;
  return m;
}
