// net-message-guard.mjs -- S13 客户端消息入口防御 + S11 协议版本上报（纯 node，不依赖浏览器/服务器）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseServerMessage } from '../src/net/netMessage.js';
import { assert, finish } from './harness.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ① parseServerMessage：脏包/空值/非对象/无字符串 t 一律 null
const REJECTS = ['null', '[]', '1', '"x"', '{}', '{"t":1}', '{bad json', '', 'true', 'null null', '[{"t":"chat"}]'];
for (const raw of REJECTS) {
  assert(`parseServerMessage(${JSON.stringify(raw)}) → null`, parseServerMessage(raw) === null, String(parseServerMessage(raw)));
}

// ② 合法消息：返回解析结果本体（字段可读、不做结构改写）
const parsed = parseServerMessage(JSON.stringify({ t: 'chat', from: 'Bob', text: 'hi' }));
assert('合法消息返回对象且字段可读', !!parsed && parsed.t === 'chat' && parsed.from === 'Bob' && parsed.text === 'hi');
assert('合法消息不做结构改写（原样返回解析结果）',
  JSON.stringify(parseServerMessage('{"t":"pong","seq":7}')) === JSON.stringify({ t: 'pong', seq: 7 }));

const src = fs.readFileSync(path.join(ROOT, 'src/net/NetworkManager.js'), 'utf8');
const GUARD_SRC = /_handle\(msg\) \{[\s\S]{0,240}?if \(!msg \|\| typeof msg !== 'object' \|\| Array\.isArray\(msg\) \|\| typeof msg\.t !== 'string'\) return;/;

// ③ 客户端入口防御：优先真调用 _handle（JSON.parse 层已由 ① 覆盖，_handle 不抛只有真调用能证明）；
//    NetworkManager 依赖 N1 的 server/protocol.js 的 PROTOCOL_VERSION——常量尚未落地时降级为源码断言并标注 SKIP，不静默通过
let NetworkManager = null;
try {
  ({ NetworkManager } = await import('../src/net/NetworkManager.js'));
} catch (e) {
  console.log(`SKIP  NetworkManager 暂不可加载（${String(e.message).split('\n')[0]}）——待 PROTOCOL_VERSION 落地后由联合验收复核`);
}
if (NetworkManager) {
  const nm = new NetworkManager({});
  let threw = null;
  try {
    nm._handle(null); nm._handle({}); nm._handle([]);
    nm._handle(0); nm._handle('chat'); nm._handle({ t: 1 }); nm._handle(undefined);
  } catch (e) { threw = e; }
  assert('_handle(null/{}/[]/0/字符串/t 非字符串) 不抛异常', threw === null, threw ? String(threw.message) : '');
} else {
  assert('_handle 入口防御存在（源码断言，降级）', GUARD_SRC.test(src));
}

// ④ onmessage 接线（无浏览器环境无法触发真实 ws 事件，故用单条源码断言覆盖接线点）
assert('ws.onmessage 走 parseServerMessage 且空值不派发',
  /ws\.onmessage = \(ev\) => \{[\s\S]{0,240}?parseServerMessage\(ev\.data\)[\s\S]{0,80}?if \(m\) this\._handle\(m\);/.test(src));
assert('onmessage 内无裸 JSON.parse 残留', !/ws\.onmessage[\s\S]{0,240}?JSON\.parse/.test(src));

// ⑤ S11：客户端握手上报 PROTOCOL_VERSION（不得回落到字面量版本号）
assert('HELLO 上报 version: PROTOCOL_VERSION', src.includes('version: PROTOCOL_VERSION'));
assert('HELLO 无字面量 version: \'0.1\'', !src.includes("version: '0.1'"));
finish('net-message-guard');
