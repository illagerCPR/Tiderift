// net-block-ledger.mjs -- B32-2：远端方块修改写入本地账本并经区块重载保留
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { World } from '../src/core/World.js';
import { NetworkManager } from '../src/net/NetworkManager.js';
import '../src/blocks/BlockDefs.js';
import { ok, finish } from './harness.mjs';

const stoneId = BlockRegistry.getId('stone');
const planksId = BlockRegistry.getId('oak_planks');
const world = new World(20261019);
world.generator = {
  seed: 20261019,
  biomeScale: null,
  generateChunk(chunk) {
    chunk.generated = true;
    chunk.set(3, 64, 3, stoneId);
  },
};
world.ensureChunk(0, 0);

const game = { world, redstone: null, chestScreen: null };
const network = new NetworkManager(game);
const sent = [];
network.sendBlock = (...args) => sent.push(args);
network.bindWorld(world);

ok(world.getBlock(3, 64, 3) === stoneId, '生成地形在目标位置有天然石头');
network.applyRemoteBlock(3, 64, 3, 0);
ok(world.getBlock(3, 64, 3) === 0, '远端挖掘立即落地为空气');
ok(world.modifiedBlocks.has('3,64,3') && world.modifiedBlocks.get('3,64,3') === 0,
  '远端挖掘以显式 0 写入客户端修改账本');
ok(sent.length === 0, '远端挖掘不回环上报');
world.unloadChunk(0, 0);
world.ensureChunk(0, 0);
ok(world.getBlock(3, 64, 3) === 0, '挖掘记录经区块卸载重载仍为空气');

network.applyRemoteBlock(4, 64, 4, planksId);
ok(world.modifiedBlocks.get('4,64,4') === planksId, '远端放置写入客户端修改账本');
ok(sent.length === 0, '远端放置不回环上报');
world.unloadChunk(0, 0);
world.ensureChunk(0, 0);
ok(world.getBlock(4, 64, 4) === planksId, '放置记录经区块卸载重载仍存在');

world.setBlock(5, 64, 5, stoneId);
ok(sent.length === 1 && sent[0][0] === 5 && sent[0][3] === stoneId,
  '远端应用结束后本地修改仍正常上报');
finish('net-block-ledger');
