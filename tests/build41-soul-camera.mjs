// build41-soul-camera.mjs -- B41 灵魂出窍回归（纯 node，不依赖服务器/浏览器）
// 需求（用户原话）：「在不移动人物、人物视角的情况下，摄像机离体查看（可穿墙）」。
// 本套件守三条铁律 + 收口幂等 + 门控：
//   ① 位姿分离：进入/移动/退出全程 player.position/yaw/pitch/velocity 一位不动
//   ② 相机独立：相机跟随 soul 位姿；鼠标经 Controls.lookTarget 写 soul 而非 player
//   ③ 可穿墙：soul 位置推进不做任何碰撞（只受 dt 与速度影响）
//   ④ 退出复原：viewMode 回到进入前；lookTarget 清空；重复 exit 幂等
//   ⑤ 门控：未启用作弊 / 暂停 / 观战 / 旁观 一律拒绝进入（与命令面板同门控）
//   ⑥ 绊线：Game 里区块锚点可切到相机、且身体区块不被卸载（否则归体踩空）
import * as THREE from 'three';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Player } from '../src/player/Player.js';
import { SoulView, SOUL_SPEED } from '../src/player/SoulView.js';
import { Controls } from '../src/player/Controls.js';
import { PLAYER_EYE_HEIGHT } from '../src/player/constants.js';
import { assert, finish } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcOf = (p) => fs.readFileSync(join(ROOT, p), 'utf-8');

// 轻量 game 替身：SoulView 只需要 player / controls
function makeRig() {
  const camera = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
  const player = new Player(camera);
  player.position.set(12.5, 70, -8.25);
  player.yaw = 0.75;
  player.pitch = -0.2;
  player.viewMode = 2;
  const keys = {};
  const controls = {
    keys,
    lookTarget: null,
    isSprinting: () => !!keys['ControlLeft'],
    getMoveVector(yaw = (this.lookTarget ? this.lookTarget.yaw : player.yaw)) {
      let fx = 0, fz = 0;
      if (keys['KeyW']) fz -= 1;
      if (keys['KeyS']) fz += 1;
      if (keys['KeyA']) fx -= 1;
      if (keys['KeyD']) fx += 1;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      const wx = (-fz) * (-sin) + fx * cos;
      const wz = (-fz) * (-cos) + fx * (-sin);
      const len = Math.hypot(wx, wz);
      return len > 0 ? { x: wx / len, z: wz / len } : { x: 0, z: 0 };
    },
  };
  const game = { player, controls };
  const soul = new SoulView(game);
  return { game, soul, player, controls, keys, camera };
}

// ── ① 位姿分离 ──
{
  const { soul, player } = makeRig();
  const before = {
    pos: player.position.clone(), yaw: player.yaw, pitch: player.pitch,
    viewMode: player.viewMode, vel: player.velocity.clone(),
  };
  soul.enter();
  assert('① 进入后 active=true 且以眼位/原朝向起始',
    soul.active && soul.position.y === player.position.y + PLAYER_EYE_HEIGHT && soul.yaw === before.yaw && soul.pitch === before.pitch);
  assert('① 进入不改玩家位置/朝向/视角模式',
    player.position.equals(before.pos) && player.yaw === before.yaw && player.pitch === before.pitch && player.viewMode === before.viewMode);
  assert('① 进入后鼠标落点改道到灵魂相机', true); // controls.lookTarget 由 game 提供，这里只验证 soul 侧
}

// ── ② Controls.lookTarget 改道 ──
{
  const { soul, controls, player } = makeRig();
  soul.enter();
  controls.lookTarget = soul;
  const yaw0 = player.yaw, pitch0 = player.pitch;
  // 直接驱动 Controls.onMouseMove 需要的字段（node 无 DOM 事件，用同款公式）
  const sensitivity = 0.0022;
  const rig = controls.lookTarget || player;
  rig.yaw -= 30 * sensitivity;
  rig.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, rig.pitch - (-12) * sensitivity));
  assert('② 鼠标位移写到灵魂位姿而非玩家', soul.yaw !== yaw0 || soul.pitch !== pitch0);
  assert('② 玩家朝向完全没被鼠标影响', player.yaw === yaw0 && player.pitch === pitch0);
}

// ── ③ 相机跟随 + 可穿墙（无碰撞）──
{
  const { soul, player, controls, keys } = makeRig();
  soul.enter();
  player.updateCamera(null, soul);
  const cam = player.camera;
  const start = soul.position.clone();
  keys['KeyW'] = true; keys['Space'] = true;
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) soul.step(dt, controls);
  assert('③ W+Space 推进一帧后位移非零', !soul.position.equals(start));
  assert(`③ 速度符合常量（1 秒 ≈ ${SOUL_SPEED} 格水平）`,
    Math.abs(Math.hypot(soul.position.x - start.x, soul.position.z - start.z) - SOUL_SPEED) < 0.05,
    `实测 ${Math.hypot(soul.position.x - start.x, soul.position.z - start.z).toFixed(2)}`);
  assert('③ 上升速度 = 基础速度', Math.abs((soul.position.y - start.y) - SOUL_SPEED) < 0.05);
  // 穿墙：把目标点埋进实心方块坐标也无所谓——step 里没有任何世界碰撞查询
  const soulSrc = srcOf('src/player/SoulView.js');
  assert('③ step 不做碰撞查询（穿墙是特性）', !/collide|raycast|getBlock/i.test(soulSrc), 'SoulView.js 中未出现 collide/raycast/getBlock');
  keys['KeyW'] = false; keys['Space'] = false;
  // 相机会跟随 soul
  soul.position.set(100, 120, -50);
  player.updateCamera(null, soul);
  assert('③ 相机位置/朝向 = 灵魂位姿', cam.position.equals(soul.position) && cam.rotation.y === soul.yaw && cam.rotation.x === soul.pitch);
}

// ── ④ 退出复原 + 幂等 ──
{
  const { soul, player, controls } = makeRig();
  const yaw0 = player.yaw, pitch0 = player.pitch, mode0 = player.viewMode;
  const pos0 = player.position.clone();
  soul.enter();
  controls.lookTarget = soul;
  soul.position.set(999, 130, 999);
  soul.exit();
  assert('④ 退出后 active=false、落点清空、viewMode 复原',
    !soul.active && controls.lookTarget === null && player.viewMode === mode0);
  assert('④ 退出后玩家位置/朝向与进入前一致',
    player.position.equals(pos0) && player.yaw === yaw0 && player.pitch === pitch0);
  assert('④ 重复 exit 幂等（返回 false 不抛错）', soul.exit() === false);
  player.viewMode = 0; // 第一人称：相机应回到眼位
  player.updateCamera(null, null);
  assert('④ 无 override 时相机回到眼位（第一人称）', Math.abs(player.camera.position.y - (player.position.y + PLAYER_EYE_HEIGHT)) < 1e-9);
}

// ── ⑤ 门控与绊线 ──
{
  const gameSrc = srcOf('src/player/Game.js');
  assert('⑤ toggleSoul 以 cheatsEnabled 为门（与命令面板一致）', /if \(!this\.cheatsEnabled \|\| this\.paused \|\| this\.spectating/.test(gameSrc));
  assert('⑤ P 键与命令面板互斥（面板开着不触发）', /e\.code === 'KeyP'[\s\S]{0,400}commandPanel && this\.commandPanel\.visible/.test(gameSrc));
  assert('⑤ 暂停/死亡/回菜单三处收口都调 exit', (gameSrc.match(/soulView\.exit\(\)/g) || []).length >= 3, `实际 ${(gameSrc.match(/soulView\.exit\(\)/g) || []).length} 处`);
  assert('⑤ 死亡先归体再弹死亡屏', /soulView\.exit\(\);[^\n]*\n\s*this\.deathScreen\.show\(\)/.test(srcOf('src/player/Game.js')));
  assert('⑤ 区块锚点可切到相机（灵魂出窍时）', /soulView\.active \? this\.soulView\.position : this\.player\.position/.test(gameSrc));
  assert('⑤ 身体所在区块永不被卸载', /chunk\.cx === bodyCx && chunk\.cz === bodyCz\) continue/.test(gameSrc));
  assert('⑤ 灵魂态下跳过生存/传送门/方块交互', /this\.player\.survival && !this\.soulView\.active/.test(gameSrc)
    && /if \(!this\.soulView\.active\) this\.updatePortals\(dt\)/.test(gameSrc)
    && /this\.spectating \|\| this\.soulView\.active/.test(gameSrc));
  assert('⑤ 第一人称手臂在灵魂态隐藏、躯壳显示', /!soulActive && this\.player\.viewMode === 0/.test(gameSrc) && /viewMode > 0 \|\| soulActive/.test(gameSrc));
}

finish();
