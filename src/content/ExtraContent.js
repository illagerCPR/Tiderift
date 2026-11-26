// ExtraContent.js -- 「额外内容」世界清单：规范化 / 相等 / 归属过滤（Build 51 基石）
// 纯模块：无 DOM、无模块级可变状态；主线程、地形 Worker、服务器、测试共用同一份口径。
//
// 纪律（docs/archives/extra-content-master-plan.md 四、十）：
//   ① 注册永远全量——开关只决定生成/获取/放置/交互/模拟是否启用，绝不按开关增删定义；
//   ② 清单必须显式传入（生成器、配方匹配、tick、房间），禁止"当前世界开关"全局变量；
//   ③ 旧档/旧快照缺字段一律回落"双关"；未知 schema 返回 null，由调用方拒绝加载/加入。
//
// 归属元数据：方块/物品/配方/结构定义可带 requiresExtras（内容 ID 数组）。
//   [] 或缺失 = 基础内容（任何世界都有）；['industry'] / ['magic'] = 单模块；['industry','magic'] = 联动。
//   未知内容 ID 一律视为"永不满足"（fail-closed），不会因为写错 ID 而意外放行。

export const EXTRA_CONTENT_SCHEMA = 1;

// 内容 ID（顺序即界面卡片顺序，与存档/协议字段名一致，代码 ID 不随显示名变动）
export const EXTRA_IDS = Object.freeze(['industry', 'magic']);

// 显示名（i18n 键；世界规则字段恒英文，界面渲染时走 t()）
export const EXTRA_LABEL_KEYS = Object.freeze({ industry: '工业', magic: '魔法' });

const EXTRA_ID_SET = new Set(EXTRA_IDS);

// 双关清单（默认值，冻结共享；调用方只读）
const NONE = Object.freeze({ schema: EXTRA_CONTENT_SCHEMA, industry: false, magic: false });
export const NONE_EXTRA_CONTENT = NONE;

function makeManifest(industry, magic) {
  return Object.freeze({ schema: EXTRA_CONTENT_SCHEMA, industry: !!industry, magic: !!magic });
}

// 规范化：返回冻结清单；旧形态（缺 schema / 缺字段）按 schema 1 读；
// 未知 schema 或非对象形态返回 null（调用方必须拒绝加载/加入，不得静默降级成双关）。
export function normalizeExtraContent(raw) {
  if (raw === undefined || raw === null) return NONE;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.schema !== undefined && raw.schema !== EXTRA_CONTENT_SCHEMA) return null;
  const industry = raw.industry === true; // 只认严格 boolean true
  const magic = raw.magic === true;
  if (industry === false && magic === false) return NONE;
  return makeManifest(industry, magic);
}

// 是否为「已规范化」的清单（供内部断言/测试使用，不做兼容读取）
export function isNormalizedExtraContent(m) {
  return !!m && typeof m === 'object' && m.schema === EXTRA_CONTENT_SCHEMA;
}

export function extrasEqual(a, b) {
  const x = normalizeExtraContent(a);
  const y = normalizeExtraContent(b);
  if (!x || !y) return x === y;
  return x.industry === y.industry && x.magic === y.magic;
}

// 启用的内容 ID 列表（顺序同 EXTRA_IDS）
export function enabledExtras(m) {
  const n = normalizeExtraContent(m);
  if (!n) return [];
  const out = [];
  for (const id of EXTRA_IDS) if (n[id] === true) out.push(id);
  return out;
}

export function isExtraEnabled(m, id) {
  const n = normalizeExtraContent(m);
  if (!n || !EXTRA_ID_SET.has(id)) return false;
  return n[id] === true;
}

export function isAnyExtraEnabled(m) {
  return enabledExtras(m).length > 0;
}

// 稳定序列化：写存档 / 房间快照 / 网络消息的统一形状
export function serializeExtraContent(m) {
  const n = normalizeExtraContent(m) || NONE;
  return { schema: EXTRA_CONTENT_SCHEMA, industry: n.industry, magic: n.magic };
}

// ── 归属元数据 ────────────────────────────────────────────────────────────────
// 定义侧白名单：字符串或数组 → 去重字符串数组（含未知 ID 也保留，由 requiresSatisfied
// 判为永不满足）；空值 → null（= 基础内容）
export function normalizeRequires(raw) {
  if (raw === undefined || raw === null || raw === false) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const id of list) {
    if (typeof id !== 'string') continue;
    const s = id.trim();
    if (!s || out.indexOf(s) >= 0) continue;
    out.push(s);
  }
  return out.length ? Object.freeze(out) : null;
}

// 需求是否满足：无需求恒真；清单非法（未知 schema）恒假
export function requiresSatisfied(requires, manifest) {
  if (!requires || requires.length === 0) return true;
  const n = normalizeExtraContent(manifest);
  if (!n) return false;
  for (const id of requires) {
    if (!EXTRA_ID_SET.has(id) || n[id] !== true) return false;
  }
  return true;
}

// 定义级判定：方块/物品/配方/结构/能力是否对当前世界启用
export function isContentEnabled(def, manifest) {
  if (!def) return false;
  return requiresSatisfied(def.requiresExtras, manifest);
}

// 列表过滤（创造栏 / 配方查询 / 结构类型等「获取」闸口）
export function filterEnabled(defs, manifest) {
  if (!Array.isArray(defs)) return [];
  const out = [];
  for (const def of defs) if (isContentEnabled(def, manifest)) out.push(def);
  return out;
}

// 客户端能力声明（HELLO 上报）：支持 schema 1 的全部内容 ID。
// 服务器据此拒绝「启用了客户端不支持内容」的房间；旧客户端不报此字段 = 只支持双关房间。
export function extraCapability() {
  return { schema: EXTRA_CONTENT_SCHEMA, ids: [...EXTRA_IDS] };
}

// 记录用简述："industry+magic" / "industry" / "magic" / ""（不进 UI，UI 走 EXTRA_LABEL_KEYS）
export function extraContentCode(m) {
  return enabledExtras(m).join('+');
}
