// main.js -- 入口：Game + 主菜单 + 网络层 + 全景背景
import { Game } from './player/Game.js';
import { BlockRegistry } from './core/BlockRegistry.js';
import { ItemRegistry } from './core/ItemRegistry.js';
import { SaveSystem } from './core/SaveSystem.js';
import { MenuScreen } from './ui/MenuScreen.js';
import { NetworkManager } from './net/NetworkManager.js';
import { Panorama } from './render/Panorama.js';
import { VideoSettings } from './ui/VideoSettings.js';
import { LanguageScreen } from './ui/LanguageScreen.js';
import { SkinScreen } from './ui/SkinScreen.js';
import { audio } from './audio/AudioEngine.js';
import { loadSettings } from './core/Settings.js';
import { initLocale, t } from './i18n/index.js';

// 音频解锁：首次用户手势后创建 AudioContext（自动播放策略规避，幂等）
audio.installUnlock();

// 语言初始化（Build 5 i18n）：越早越好——index.html 静态加载文案随之替换
initLocale(loadSettings().language);
{
  const loadingInner = document.querySelector('#loading > div');
  if (loadingInner) loadingInner.textContent = t('世界生成中...');
}

const app = document.getElementById('app');
const game = new Game(app);

// dev：全景图烘焙工具（?bake-panorama=1）——生成世界 → 选机位 → 导出 6 面 JPEG，不进游戏流程
if (location.search.includes('bake-panorama')) {
  import('./render/PanoramaBake.js').then(async ({ bakePanorama }) => {
    window.bakedFaces = await bakePanorama(game.renderer);
    document.title = '[DONE] ' + document.title;
    console.log('[Bake] 全景烘焙完成:', Object.keys(window.bakedFaces.faces).join(','));
  });
} else {
  // 主菜单全景背景播放器（预烘焙 cubemap + 动态云层）
  const panorama = new Panorama(game);

  // 视频设置面板（ESC 暂停菜单与主菜单共用的单例）
  const videoSettings = new VideoSettings(game);
  game.videoSettings = videoSettings;

  // 语言切换界面（Build 7：主界面/暂停菜单地球小按钮进入的共用单例）
  const languageScreen = new LanguageScreen(game);
  game.languageScreen = languageScreen;

  // 皮肤设置界面（Build 21 M1：主界面皮肤小按钮进入的共用单例）
  const skinScreen = new SkinScreen(game);
  game.skinScreen = skinScreen;

  // 局域网联机网络层
  const net = new NetworkManager(game);
  game.net = net;

  // 主菜单（onStart 第 6 参：新建世界的生物群系规模档位）
  const menu = new MenuScreen((mode, seed, loadData, slot, cheatsEnabled, biomeScale) => {
    if (game.running) game.returnToMenu(false);
    menu.hide();
    game.start(mode, seed, loadData, slot, cheatsEnabled, false, biomeScale);
  }, net);

  // 菜单显隐联动全景启停（game.running 期间全景循环自身也会早退）
  menu.onHide = () => panorama.setActive(false);
  menu.onShow = () => panorama.setActive(true);
  menu.videoSettings = videoSettings; // 主菜单"视频设置"入口
  menu.languageScreen = languageScreen; // 主菜单语言小按钮入口
  menu.skinScreen = skinScreen; // Build 21 M1：主菜单皮肤小按钮入口
  window.panorama = panorama; // 调试暴露

  game.onExit = () => {
    menu.show();
  };

  // 联机：收到世界信息后用服务器 seed 启动本地世界（msg.room 用于房间展示；biomeScale 随房间固定）
  net.on('world_info', async ({ seed, mode, time, room, biomeScale }) => {
    net.room = room || net.room || 'default';
    menu.hide();
    await game.start(mode, seed, null, 0, false, true, biomeScale);
    game.sky.time = time;
    net.onWorldStarted();
    net.sendPlayerFull();
  });

  // 阶段5：世界内换房 / 重建世界 —— 保持连接，用新 seed 重启本地世界（不回主菜单）
  net.on('restart_world', async ({ seed, mode, time, room, biomeScale }) => {
    net.room = room || net.room || 'default';
    await game.start(mode, seed, null, 0, false, true, biomeScale);
    game.sky.time = time;
    net.onWorldStarted();
    net.sendPlayerFull();
  });

  // M4：联机维度切换落地——服务器 dimension_world 回执（目标维度权威账本）→ 重建本地世界
  // 迭代 M2：pos 为传送门落点回传（applyDimensionWorld 据此吸附既有门/自动建返程门）
  net.on('dimension_world', ({ dim, blocks, containers, pos, recoveryId }) => {
    if (!game.running) {
      if (recoveryId) net.completeWorldRecovery(recoveryId, false);
      return;
    }
    const applied = game.applyDimensionWorld(dim, blocks, containers, pos);
    if (recoveryId) {
      Promise.resolve(applied)
        .then((ok) => net.completeWorldRecovery(recoveryId, ok === true))
        .catch(() => net.completeWorldRecovery(recoveryId, false));
    }
  });

  // 联机连接状态提示
  net.onStatusChange = (status, text) => {
    menu.setMpStatus(text, status === 'connected' ? '#6f6' : (status === 'reconnecting' ? '#fa0' : '#f88'));
    console.log('[联机]', status, text);
    if (status === 'closed' && game.networkMode) {
      alert('与服务器断开连接，返回主菜单');
      game.returnToMenu(false);
    }
  };
}

// 暴露到 window 便于调试
window.game = game;
window.BlockRegistry = BlockRegistry;
window.ItemRegistry = ItemRegistry;
window.SaveSystem = SaveSystem;
window.net = game.net;
