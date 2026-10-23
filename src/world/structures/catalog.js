// catalog.js -- 生产结构类型注册入口（terrain.js 侧效导入）
// 新增结构类型在此登记；测试用类型由 tests/ 自行注册，不进本文件。
// def.dims 声明维度作用域（缺省 = 任意维度）：村庄/要塞仅主世界，下界要塞仅下界，
// 末地城仅末地（外岛高原）。
import { registerStructureType } from './StructureManager.js';
import { VILLAGE_DEF } from './village.js';
import { STRONGHOLD_DEF } from './stronghold.js';
import { FORTRESS_DEF } from './fortress.js';
import { END_CITY_DEF } from './endCity.js';
import { AETHER_TEMPLE_DEF, AETHER_TOWER_DEF, AETHER_SHIP_DEF, AETHER_WELL_DEF, AETHER_GATE_DEF } from './aetherStructures.js';
import { TIDEFIRE_HEARTH_DEF } from './tidefire_hearth.js';
import { TIDE_BARROW_DEF } from './tide_barrow.js';
import { GLEANER_RING_DEF } from './gleaner_ring.js';
import { WHALE_BARROW_DEF } from './whale_barrow.js';

VILLAGE_DEF.dims = ['overworld'];
STRONGHOLD_DEF.dims = ['overworld'];
registerStructureType('village', VILLAGE_DEF);
registerStructureType('stronghold', STRONGHOLD_DEF);
registerStructureType('fortress', FORTRESS_DEF);
registerStructureType('end_city', END_CITY_DEF);
// 天域结构（defs 自带 dims: ['aether']）——批次 B 增漩风井/天海之门遗迹
registerStructureType('aether_temple', AETHER_TEMPLE_DEF);
registerStructureType('aether_tower', AETHER_TOWER_DEF);
registerStructureType('aether_ship', AETHER_SHIP_DEF);
registerStructureType('aether_well', AETHER_WELL_DEF);
registerStructureType('aether_gate', AETHER_GATE_DEF);
// 下界·烬火纪（世界观批次 N2）：潮火之炉（defs 自带 dims: ['nether']）
registerStructureType('tidefire_hearth', TIDEFIRE_HEARTH_DEF);
// 主世界·雨土纪（世界观批次 W2）：潮冢（defs 自带 dims: ['overworld']）
registerStructureType('tide_barrow', TIDE_BARROW_DEF);
// 末地·无潮彼岸（世界观批次 E2）：拾遗者石环（defs 自带 dims: ['end']）
registerStructureType('gleaner_ring', GLEANER_RING_DEF);
// 天域后传（鲸骨冢篇 K1）：鲸骨冢（defs 自带 dims: ['aether']）
registerStructureType('whale_barrow', WHALE_BARROW_DEF);

// ── D 可动手解开的遗迹（机关房三种，各占一维：主世界/下界/天域）──────────────────
// defs 自带 dims；几何与判定共用 core/Ruins.js 的布局常量，阶段 2 按 ruinPuzzle 接线。
import { TIDE_SLUICE_DEF } from './tide_sluice.js';
import { EMBER_CIRCUIT_DEF } from './ember_circuit.js';
import { FRAME_RACK_DEF } from './frame_rack.js';
registerStructureType('tide_sluice', TIDE_SLUICE_DEF);
registerStructureType('ember_circuit', EMBER_CIRCUIT_DEF);
registerStructureType('frame_rack', FRAME_RACK_DEF);
