// Settings.js -- 视频设置存取与应用（localStorage 全局，不按存档隔离）
// applySettings 把当前设置实时套到渲染器/相机/天空/控制/体素光/粒子上；
// 平滑光照/AO 改动由调用方负责 world.markAllDirty()（见 VideoSettings 面板）。
import { RenderQuality } from '../render/ChunkMesh.js';
import { VoxelLightUniforms } from '../render/VoxelLight.js';
import { audio } from '../audio/AudioEngine.js';
import { LOCALES } from '../i18n/index.js';

const KEY = 'cubeworld-settings';

export const DEFAULT_SETTINGS = {
  renderDistance: 6,   // 2..12 区块
  fov: 75,             // 60..110
  brightness: 6,       // 0..100 → uMinLight 0.02..0.25（6 ≈ 现调校值 0.035）
  clouds: true,
  particles: 'all',    // all | decreased | minimal
  phenomena: true,     // 局部潮候与稀有景象（Build 37 G）：关掉即无粒子与预兆提示，观测记录不受影响
  smoothLighting: true,
  viewBobbing: true,
  sensitivity: 100,    // 30..200 (%)
  gfx: 'full',         // off | basic | full 光照增强档位（默认完整档大满：基础=水面反射+云影，完整=再加后处理）
  gfxBloom: true,      // 完整档子开关：泛光
  gfxGodRays: true,    // 完整档子开关：体积光
  gfxWaterReflection: true, // 完整档子开关：平面真反射（L4-A，镜像相机二次渲染场景）
  gfxShadows: true,    // 完整档子开关：太阳阴影贴图（L4-B，节流 shadow pass）
  sound: true,         // 音效总开关
  volume: 60,          // 0..100 主音量
  music: true,         // 音乐（BGM/环境风声）开关
  language: 'zh-CN',   // 界面语言（Build 5 i18n：zh-CN | zh-TW | en）
};

export const GFX_ORDER = ['off', 'basic', 'full'];
export const GFX_LABELS = { off: '关闭', basic: '基础', full: '完整' };

const PARTICLE_SCALE = { all: 1, decreased: 0.5, minimal: 0.15 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function loadSettings() {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (typeof saved === 'object' && saved) {
        if (saved.renderDistance !== undefined) s.renderDistance = clamp(Math.round(saved.renderDistance), 2, 12);
        if (saved.fov !== undefined) s.fov = clamp(Math.round(saved.fov), 60, 110);
        if (saved.brightness !== undefined) s.brightness = clamp(Math.round(saved.brightness), 0, 100);
        if (saved.clouds !== undefined) s.clouds = !!saved.clouds;
        if (PARTICLE_SCALE[saved.particles]) s.particles = saved.particles;
        if (saved.phenomena !== undefined) s.phenomena = !!saved.phenomena;
        if (saved.smoothLighting !== undefined) s.smoothLighting = !!saved.smoothLighting;
        if (saved.viewBobbing !== undefined) s.viewBobbing = !!saved.viewBobbing;
        if (saved.sensitivity !== undefined) s.sensitivity = clamp(Math.round(saved.sensitivity), 30, 200);
        if (GFX_ORDER.includes(saved.gfx)) s.gfx = saved.gfx;
        if (saved.gfxBloom !== undefined) s.gfxBloom = !!saved.gfxBloom;
        if (saved.gfxGodRays !== undefined) s.gfxGodRays = !!saved.gfxGodRays;
        if (saved.gfxWaterReflection !== undefined) s.gfxWaterReflection = !!saved.gfxWaterReflection;
        if (saved.gfxShadows !== undefined) s.gfxShadows = !!saved.gfxShadows;
        if (saved.sound !== undefined) s.sound = !!saved.sound;
        if (saved.volume !== undefined) s.volume = clamp(Math.round(saved.volume), 0, 100);
        if (saved.music !== undefined) s.music = !!saved.music;
        if (LOCALES.some(l => l.id === saved.language)) s.language = saved.language;
      }
    }
  } catch { /* 损坏的设置按默认处理 */ }
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 存储满等忽略 */ }
}

// 亮度滑杆值 → 最低环境亮度（uMinLight）
export function brightnessToMinLight(v) {
  return 0.02 + (clamp(v, 0, 100) / 100) * 0.23;
}

// 把设置实时套到游戏对象上（全部判空：主菜单期 game.world/particles 等可为空）
export function applySettings(game) {
  const s = game.settings || DEFAULT_SETTINGS;

  // 视野
  if (game.renderer && game.renderer.camera) {
    game.renderer.camera.fov = s.fov;
    game.renderer.camera.updateProjectionMatrix();
  }
  // 亮度
  VoxelLightUniforms.uMinLight.value = brightnessToMinLight(s.brightness);
  // 雾距必须跟随渲染距离（W1 补修）：旧值 near60/far160 时雾 far(160) > 加载边界
  // (renderDistance×16=96)，方形区块边界在雾起效前硬截断——海景下呈"固定距离直线分界"
  if (game.renderer && game.renderer.scene && game.renderer.scene.fog) {
    const fogProf = game.world && game.world.dimDef && game.world.dimDef.sky ? game.world.dimDef.sky.fog : null;
    applyFogRange(game.renderer.scene.fog, s.renderDistance, fogProf);
  }
  // 云（游戏天空按维度档案联动；主菜单全景天空始终套设置）
  if (game.sky) game.sky.cloudsEnabled = s.clouds;
  if (typeof window !== 'undefined' && window.panorama && window.panorama.sky) {
    window.panorama.sky.clouds.visible = s.clouds;
    if (window.panorama.camera) {
      window.panorama.camera.fov = s.fov;
      window.panorama.camera.updateProjectionMatrix();
    }
  }
  // 鼠标灵敏度
  if (game.controls) game.controls.sensitivityScale = s.sensitivity / 100;
  // 渲染距离（无需立即处理：updateChunks 每帧按此值加载/卸载；雾距已在上方同步）
  // 平滑光照/AO（改动后由面板触发 markAllDirty）
  RenderQuality.smoothLighting = s.smoothLighting;
  RenderQuality.aoEnabled = s.smoothLighting; // AO 随平滑光照开关联动（与原版"平滑光照"语义一致）
  // 粒子密度
  const ds = PARTICLE_SCALE[s.particles] ?? 1;
  if (game.particles) game.particles.densityScale = ds;
  if (game.fireParticles) game.fireParticles.densityScale = ds;
  // 光照增强（L1：水面反射 + 云影，uniform 开关零重建；L2：完整档后处理链在 Renderer 内接线）
  const gfxOn = s.gfx === 'basic' || s.gfx === 'full';
  VoxelLightUniforms.uWaterFx.value = gfxOn ? 1 : 0;
  VoxelLightUniforms.uCloudShadow.value = gfxOn ? 1 : 0; // Game.update 每帧再与维度云显隐相与
  // 音频（惰性引擎：ctx 未解锁时只记状态，unlock 后生效）
  audio.setEnabled(s.sound);
  audio.setVolume(s.volume / 100);
  audio.setMusicEnabled(s.music);
  // L2 后处理：完整档 EffectComposer（泛光/体积光子开关透传），失败自动回退直渲
  if (game.renderer && game.renderer.setGraphicsMode) {
    game.renderer.setGraphicsMode(s.gfx);
    if (game.renderer.postfx) {
      game.renderer.postfx.setBloom(s.gfxBloom);
      game.renderer.postfx.setGodRays(s.gfxGodRays);
    }
  }
}

// 雾距按渲染距离收口：far 取加载圈半径的 95%（雾 92%+ 才到边界，方形加载边界不可见），
// near 取 50%（给远景留层次）。factor 为维度档案的 { nearK, farK }（下界浓雾）。
// Game.update 出水恢复与此处必须同源（同传维度 factor）。
export function applyFogRange(fog, renderDistance, factor = null) {
  const nearK = (factor && factor.nearK) || 0.5;
  const farK = (factor && factor.farK) || 0.95;
  const dist = Math.max(2, Math.min(12, renderDistance || 6)) * 16;
  fog.near = dist * nearK;
  fog.far = dist * farK;
}
