// build41-skin-candidates.mjs -- B41 按用户名取皮肤的候选链回归（纯 node，不联网）
// 背景：B41 前候选链在静态托管（GitHub Pages）上必然失败：
//   ① 先试 `http://<pages-host>:3001/api/skin/...`——HTTPS 页面里混合内容被浏览器拦，且那台主机没有 3001
//   ② 唯一的镜像回退用 `new Image()` 不设 crossOrigin → 画布被污染 → toDataURL 抛 SecurityError，
//      异常被 catch 吞掉 → 表现成"获取失败"（浏览器已实测：minotar none = READ FAILED SecurityError）
// 本套件只钉候选链的**结构与顺序**（不联网）：
//   ① Pages：不含 :3001 候选，全部 https，先镜像后无
//   ② 联机：联机代理排第一且与后续去重
//   ③ 本机开发：localhost/http 才追加 3001 候选
//   ④ HTTPS 内网页面（无联机）：不得出现 http:// 候选（混合内容必拦）
//   ⑤ 用户名编码与镜像清单约束
import { buildSkinCandidates, SKIN_MIRRORS } from '../src/entity/PlayerSkin.js';
import { assert, finish } from './harness.mjs';

const urlOf = (list) => list.map((c) => c.url);

// ── ① GitHub Pages 场景 ──
{
  const list = buildSkinCandidates('Notch', { protocol: 'https:', hostname: 'illagercpr.github.io' });
  assert('① Pages 上不再生成 :3001 候选', list.every((c) => !c.url.includes(':3001')), urlOf(list).join(' , '));
  assert('① Pages 上全部为 https 镜像', list.length >= 1 && list.every((c) => c.url.startsWith('https://')), urlOf(list).join(' , '));
  // minotar 对浏览器请求带 ACAO:*（实测可读回画布）；mc-heads 的 ACAO 只在非浏览器客户端出现，降为备用
  assert('① 镜像顺序 = minotar → mc-heads', list[0].name === 'minotar' && list[1].name === 'mc-heads', list.map((c) => c.name).join(','));
  assert('① 镜像候选带 ACAO 的域名（不能是任意第三方）',
    list.every((c) => /^https:\/\/(mc-heads\.net|minotar\.net)\/skin\//.test(c.url)), urlOf(list).join(' , '));
}

// ── ② 联机场景：代理优先且去重 ──
{
  const list = buildSkinCandidates('Notch', {
    netUrl: 'ws://192.168.1.5:3001/ws', protocol: 'http:', hostname: '192.168.1.5',
  });
  assert('② 联机代理排第一（可拿到 slim 标记）', list[0].url === 'http://192.168.1.5:3001/api/skin/Notch', list[0].url);
  const dup = urlOf(list).filter((u, i, a) => a.indexOf(u) !== i);
  assert('② 候选链无重复 URL（代理与本机 3001 同址时只留一条）', dup.length === 0, dup.join(','));
  assert('② 末尾仍保留 https 镜像兜底', list[list.length - 1].url.startsWith('https://'), list[list.length - 1].url);
}

// ── ③ 本机开发场景 ──
{
  const a = buildSkinCandidates('Notch', { protocol: 'http:', hostname: 'localhost' });
  assert('③ localhost 开发页追加本机 3001 候选', a.some((c) => c.url === 'http://localhost:3001/api/skin/Notch'), urlOf(a).join(','));
  const b = buildSkinCandidates('Notch', { protocol: 'https:', hostname: 'localhost' });
  // localhost 属"潜在可信源"，https 页面请求 http://localhost 不算混合内容拦截对象
  assert('③ https 的 localhost 仍保留本机 3001 候选',
    b.some((c) => c.url === 'http://localhost:3001/api/skin/Notch'), urlOf(b).join(','));
}

// ── ④ HTTPS 内网页面不得出现 http:// 候选（混合内容）──
{
  const list = buildSkinCandidates('Notch', { protocol: 'https:', hostname: '192.168.1.5' });
  assert('④ HTTPS 内网页面上不出现 http:// 候选',
    list.every((c) => !c.url.startsWith('http://')), urlOf(list).join(','));
}

// ── ⑤ 用户名编码与镜像清单 ──
{
  const list = buildSkinCandidates('a b&c', { protocol: 'https:', hostname: 'example.org' });
  assert('⑤ 用户名做 URL 编码（空格/& 不裸奔）', list.every((c) => c.url.includes('a%20b%26c')), urlOf(list).join(','));
  assert('⑤ 镜像清单全部 https 且按用户名直取',
    SKIN_MIRRORS.every((m) => m.url('X').startsWith(`https://`)), SKIN_MIRRORS.map((m) => m.url('X')).join(','));
  const names = SKIN_MIRRORS.map((m) => m.name);
  assert('⑤ 镜像名唯一（用于提示来源）', new Set(names).size === names.length, names.join(','));
}

finish();
