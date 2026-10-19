// net-reconnect.mjs -- B32-3：断线恢复先收敛维度账本，再恢复联机状态
import { NetworkManager } from '../src/net/NetworkManager.js';
import { MSG } from '../server/protocol.js';
import { assert, finish } from './harness.mjs';

const sent = [];
const inventory = {
  slots: new Array(9).fill(null), hotbarSelected: 0,
  getSelected() { return null; },
  deserialize(data) { this.restored = data; },
};
const game = {
  running: true,
  world: { dimension: 'nether' },
  sky: { time: 0 },
  player: {
    position: { x: 123, y: 70, z: -45, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    velocity: { set() {} }, setMode(mode) { this.mode = mode; },
  },
  inventory,
  hotbar: { update() {} },
  remotePlayers: new Map(),
  renderer: { scene: { add() {}, remove() {} } },
};
const net = new NetworkManager(game);
net.selfId = 7;
net.connected = true;
net.ws = { readyState: 1 };
net._ready = false;
net.isRecovering = true;
net._recoveryId = 'resume-1';
net._recoveryDim = 'nether';
net._recoveryPhase = 'joining';
net._send = (type, data) => sent.push({ t: type, ...data });

let worldInfoCount = 0;
let dimensionSnapshot = null;
net.on('world_info', () => { worldInfoCount++; });
net.on('dimension_world', (msg) => { dimensionSnapshot = msg; });
net._handle({ t: MSG.WORLD_INFO, room: 'resume-room', seed: 4, mode: 'survival', time: 0.6,
  hostId: 7, recoveryId: 'resume-1', dim: 'nether' });
assert('重连 WORLD_INFO 不直接解锁旧世界', net.isRecovering && !net._ready);
assert('恢复中的 WORLD_INFO 不触发首次进房建世界事件', worldInfoCount === 0);

const profile = {
  inventory: { slots: [], armor: [] }, position: { x: 900, y: 90, z: 900 }, dim: 'nether',
  health: 16, food: 14, saturation: 3, xp: 2, xpLevel: 1,
};
net._handle({ t: MSG.PLAYER_PROFILE, profile });
assert('权威档案在世界确认前只暂存', net._pendingProfile === profile && !inventory.restored);
net._handle({ t: MSG.DIMENSION_WORLD, recoveryId: 'resume-1', dim: 'nether', blocks: [], containers: [] });
assert('收到同维恢复快照并交给世界落地入口', dimensionSnapshot?.recoveryId === 'resume-1');

net._handle({ t: MSG.WORLD_RESUMED, recoveryId: 'stale-id', dim: 'nether' });
assert('过期恢复确认不能解锁', net.isRecovering && !net._ready);
const completionSupported = typeof net.completeWorldRecovery === 'function';
if (completionSupported) net.completeWorldRecovery('resume-1', true);
assert('本地快照应用完成后发送服务端确认',
  sent.some((m) => m.t === MSG.WORLD_READY && m.recoveryId === 'resume-1' && m.dim === 'nether'));
assert('等待服务端确认期间仍保持恢复门控', net.isRecovering && !net._ready);
net._handle({ t: MSG.WORLD_RESUMED, recoveryId: 'resume-1', dim: 'nether' });
assert('服务端确认后才恢复世界消息处理', !net.isRecovering && net._ready && net.dim === 'nether');
assert('恢复先收敛维度再应用玩家档案，沿用本地断线位置',
  inventory.restored === profile.inventory && game.player.position.x === 123 && game.player.position.y === 70);
assert('完成恢复后发送玩家完整状态', sent.some((m) => m.t === MSG.PLAYER_FULL));

sent.length = 0;
net.isRecovering = true;
net._ready = false;
net.update(1);
net.sendPlayerFull();
assert('恢复门控期间不广播位置、档案或快捷栏状态', sent.length === 0);
finish('net-reconnect');
