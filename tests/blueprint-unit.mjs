// tests/blueprint-unit.mjs -- Build 35 E 蓝图模型、RLE、捕获和材料需求回归
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import {
  Blueprints, BLUEPRINT_LIMITS, calculateBlueprintMaterials, captureBlueprint,
  decodeBlueprintRLE, encodeBlueprintRLE, inventoryBlockCount, isWithinCaptureReach,
  validateBlueprint, validateBlueprintName,
} from '../src/core/Blueprints.js';
import { Chunk } from '../src/core/Chunk.js';
import { assert, finish } from './harness.mjs';

function blueprint(overrides = {}) {
  const palette = overrides.palette || [0, BlockRegistry.getId('stone')];
  const data = overrides.data || '0.1,1.1,0.1';
  return { id: 'blueprt1', name: '小屋', dim: 'overworld', rev: 1, byId: '', size: { x: 3, y: 1, z: 1 }, palette, data, ...overrides };
}

function fakeWorld(chunks, dimension = 'overworld') {
  let ensureCalls = 0;
  let getBlockCalls = 0;
  return {
    dimension,
    getChunk(cx, cz) { return chunks.get(cx + ',' + cz) || null; },
    ensureChunk() { ensureCalls++; throw new Error('capture must not generate chunks'); },
    getBlock() { getBlockCalls++; throw new Error('capture reads loaded Chunk data directly'); },
    counts() { return { ensureCalls, getBlockCalls }; },
  };
}

const stone = BlockRegistry.getId('stone');
const dirt = BlockRegistry.getId('dirt');
const torch = BlockRegistry.getId('torch');

{
  const palette = [0, stone, dirt];
  const voxels = Uint8Array.from([0, stone, stone, 0, dirt, 0, 0]);
  const encoded = encodeBlueprintRLE(voxels, palette);
  assert('RLE roundtrip', Buffer.from(decodeBlueprintRLE(encoded, palette, voxels.length)).equals(Buffer.from(voxels)));
  assert('RLE adjacent runs merged', encoded === '0.1,1.2,0.1,2.1,0.2');
  assert('RLE air holes preserved', decodeBlueprintRLE('1.1,0.1,1.1', [0, stone], 3).join(',') === [stone, 0, stone].join(','));
  assert('RLE empty payload rejected', decodeBlueprintRLE('', [0, stone], 1) === null);
  assert('RLE trailing comma rejected', decodeBlueprintRLE('0.1,', [0], 1) === null);
  assert('RLE adjacent duplicate token rejected', decodeBlueprintRLE('0.1,0.1', [0], 2) === null);
  assert('RLE leading zero rejected', decodeBlueprintRLE('00.1', [0], 1) === null);
  assert('RLE uppercase rejected', decodeBlueprintRLE('A.1', [0, stone], 1) === null);
  assert('RLE invalid index rejected', decodeBlueprintRLE('2.1', [0, stone], 1) === null);
  assert('RLE zero length rejected', decodeBlueprintRLE('0.0', [0], 1) === null);
  assert('RLE length overflow rejected', decodeBlueprintRLE('0.2', [0], 1) === null);
  assert('RLE incomplete volume rejected', decodeBlueprintRLE('0.1', [0], 2) === null);
  assert('RLE non-ASCII rejected', decodeBlueprintRLE('0.1雪', [0], 1) === null);
  assert('RLE 16KB compressed limit enforced', decodeBlueprintRLE('0.1'.padEnd(BLUEPRINT_LIMITS.dataBytes + 1, 'x'), [0], 1) === null);
}

{
  assert('name 24 Unicode code points accepted', validateBlueprintName('蓝'.repeat(24)));
  assert('name 25 Unicode code points rejected', !validateBlueprintName('蓝'.repeat(25)));
  assert('name whitespace only rejected', !validateBlueprintName('   '));
  assert('id six lowercase alphanumeric accepted', validateBlueprint({ ...blueprint(), id: 'abcdef' }).ok);
  assert('id uppercase rejected', !validateBlueprint({ ...blueprint(), id: 'ABCDEF' }).ok);
  assert('id five characters rejected', !validateBlueprint({ ...blueprint(), id: 'abcde' }).ok);
  assert('id punctuation rejected', !validateBlueprint({ ...blueprint(), id: 'abcde-' }).ok);
  assert('unknown dimension rejected', !validateBlueprint({ ...blueprint(), dim: 'moon' }).ok);
  assert('revision lower and upper bounds accepted', validateBlueprint({ ...blueprint(), rev: 1 }).ok && validateBlueprint({ ...blueprint(), rev: 99999 }).ok);
  assert('revision over max rejected', !validateBlueprint({ ...blueprint(), rev: 100000 }).ok);
  assert('axis limit accepted', validateBlueprint({ ...blueprint(), size: { x: 32, y: 1, z: 1 }, data: '0.w' }).ok);
  assert('axis over 32 rejected', !validateBlueprint({ ...blueprint(), size: { x: 33, y: 1, z: 1 }, data: '0.x' }).ok);
  assert('volume over 32768 rejected', !validateBlueprint({ ...blueprint(), size: { x: 32, y: 32, z: 33 }, data: '0.wk' }).ok);
  assert('palette air index zero required', !validateBlueprint({ ...blueprint(), palette: [stone, 0] }).ok);
  assert('duplicate palette id rejected', !validateBlueprint({ ...blueprint(), palette: [0, stone, stone], data: '0.1' }).ok);
  assert('noninteger palette id rejected', !validateBlueprint({ ...blueprint(), palette: [0, 1.5], data: '0.1' }).ok);
  assert('palette id greater than 255 rejected', !validateBlueprint({ ...blueprint(), palette: [0, 256], data: '0.1' }).ok);
  assert('palette over 256 rejected', !validateBlueprint({ ...blueprint(), palette: [0, ...Array.from({ length: 256 }, (_, i) => i + 1)], data: '0.1' }).ok);
}

{
  const chunk = new Chunk(0, 0);
  chunk.blocks[Chunk.index(1, 20, 1)] = stone;
  chunk.blocks[Chunk.index(2, 20, 1)] = dirt;
  const world = fakeWorld(new Map([['0,0', chunk]]));
  const captured = captureBlueprint(world, { x: 1, y: 20, z: 1 }, { x: 3, y: 20, z: 1 }, { id: 'capture1', name: '测试' });
  const expectedVoxels = String(stone) + ',' + String(dirt) + ',0';
  assert('capture loaded chunk direct data', captured.ok && captured.blueprint.size.x === 3);
  assert('capture air reserved and hole retained', captured.ok && captured.blueprint.palette[0] === 0 && decodeBlueprintRLE(captured.blueprint.data, captured.blueprint.palette, 3).join(',') === expectedVoxels);
  assert('capture never calls ensureChunk or getBlock', world.counts().ensureCalls === 0 && world.counts().getBlockCalls === 0);
  const missing = fakeWorld(new Map());
  const rejected = captureBlueprint(missing, { x: 0, y: 20, z: 0 }, { x: 0, y: 20, z: 0 }, { id: 'missed1', name: '未加载' });
  assert('capture unloaded chunk rejected', !rejected.ok && rejected.reason === 'unloaded');
  assert('capture unloaded failure no generation', missing.counts().ensureCalls === 0);
  assert('capture oversized selection rejected', captureBlueprint(world, { x: 0, y: 20, z: 0 }, { x: 32, y: 20, z: 0 }, { id: 'over32', name: '超限' }).reason === 'size');
}

{
  // 规格：两次点选各自距玩家 ≤ 32 格（逐次点选判定）
  const origin = { x: 0.5, y: 64.5, z: 0.5 };
  assert('capture reach limit is 32', BLUEPRINT_LIMITS.reach === 32);
  assert('capture reach accepts exactly 32 blocks', isWithinCaptureReach({ x: 32.5, y: 64.5, z: 0.5 }, origin));
  assert('capture reach rejects 33 blocks', !isWithinCaptureReach({ x: 33.5, y: 64.5, z: 0.5 }, origin));
  assert('capture reach is 3D euclidean', !isWithinCaptureReach({ x: 24.5, y: 88.5, z: 0.5 }, origin) && isWithinCaptureReach({ x: 0.5, y: 96.5, z: 0.5 }, origin));
  assert('capture reach rejects missing or non-finite input', !isWithinCaptureReach(null, origin) && !isWithinCaptureReach({ x: Number.NaN, y: 0, z: 0 }, origin));
}

{
  const sample = blueprint({ size: { x: 3, y: 1, z: 1 }, palette: [0, stone, dirt], data: '1.2,2.1' });
  const inventory = { slots: [{ name: 'stone', count: 1 }, { name: 'dirt', count: 1 }, { name: 'redstone_torch_item', count: 3 }], armor: [{ name: 'stone', count: 64 }] };
  const materials = calculateBlueprintMaterials(sample, inventory);
  assert('materials count non-air blocks only', materials.ok && materials.materials.reduce((n, entry) => n + entry.needed, 0) === 3);
  assert('materials inventory quantities subtracted', materials.ok && materials.materials.find((entry) => entry.name === 'stone').owned === 1 && materials.materials.find((entry) => entry.name === 'stone').missing === 1);
  assert('materials excludes armor slots', inventoryBlockCount(inventory, 'stone') === 1);
  assert('materials matches alias items', inventoryBlockCount({ slots: [{ name: 'redstone_torch_item', count: 2 }] }, 'redstone_torch') === 2);
  const torchBlueprint = blueprint({ size: { x: 1, y: 1, z: 1 }, palette: [0, torch], data: '1.1' });
  assert('materials matches item and block names', calculateBlueprintMaterials(torchBlueprint, { slots: [{ name: 'torch', count: 1 }] }).materials[0].missing === 0);
}

{
  const personal = new Blueprints();
  const first = blueprint();
  assert('collections create personal blueprint', personal.createPersonal(first));
  assert('collections serialize personal separately', personal.serializePersonal().length === 1 && personal.shared.length === 0);
  assert('revision edits increment', personal.editPersonal(first.id, { name: '新屋' }) && personal.personal[0].rev === 2);
  assert('revision edit keeps personal byId empty', personal.personal[0].byId === '');
  assert('collections reject server-owned personal entry', !personal.createPersonal({ ...first, id: 'other01', byId: '7' }));
  const shared = { ...first, id: 'shared1', byId: '42', rev: 1 };
  assert('collections shared definitions remain separate', personal.applyShared(shared) && personal.personal.length === 1 && personal.shared.length === 1);
  assert('collections personal delete preserves shared definitions', personal.applyShared({ ...shared, id: first.id }) && personal.removePersonal(first.id) && personal.shared.some((entry) => entry.id === first.id));
  assert('collections stale room revision ignored', !personal.applyShared({ ...shared, rev: 0 }));
  assert('collections remove shared independently', personal.removeShared(shared.id) && personal.shared.every((entry) => entry.id !== shared.id));
  const capped = new Blueprints();
  capped.personal = Array.from({ length: BLUEPRINT_LIMITS.roomCount }, (_, i) => blueprint({ id: 'blue' + String(i).padStart(3, '0') }));
  assert('collections per-set limit enforced', !capped.createPersonal(blueprint({ id: 'lastone' })));
}

console.log('Focused blueprint-unit assertions complete.');
finish('blueprint-unit');
