// Renderer.js -- Three.js 渲染器封装
// render() 无参：游戏场景固定走 scene/camera；"完整"光照增强档切换到 PostFX 后处理链，
// 其余档位直渲（现状行为）。主菜单全景自持渲染循环直接用底层 renderer，不经此封装。
import * as THREE from 'three';
import { PostFX } from './PostFX.js';
import { SunShadow } from './SunShadow.js';

export class Renderer {
  constructor(container) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // B49：渲染统计改为手动清零（默认 autoReset=true 会在每次 render() 前清空，本管线一帧
    // 可能有反射/太阳掩码/后处理多遍 → 只剩最后一遍的数字；Game.loop 帧首调 resetStats()）
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // 后处理链（惰性构建；"完整"档才启用）。场景/相机在构造末尾注入。
    // 相机启用 layer 1：太阳/月亮/日晕在其上，体积光掩码预通道依赖此分层；
    // 启用 layer 2：水面 mesh 双挂（0+2），L4-A 反射相机按 mask 排除水面防自反射递归
    this.postfx = new PostFX(this.renderer);
    this.postfx.setSceneCamera(this.scene, this.camera);
    this.camera.layers.enable(1);
    this.camera.layers.enable(2);
    // L4-B 太阳阴影：shadow pass 节流由 SunShadow.update 驱动（autoUpdate=false）；
    // PCFSoft 3x3 柔化影子边缘——默认 PCF 是 1px 硬边缘，lit/shadow 边界逐像素振荡
    // 产生可感知的边缘抖动（用户实测）
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sunShadow = new SunShadow(this.renderer);

    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postfx.setSize(window.innerWidth, window.innerHeight);
    this.postfx.setPixelRatio(this.renderer.getPixelRatio());
  }

  // 光照增强档位接线：仅"完整"档启用后处理 + ACESFilmic 色调映射 + shadowMap（直渲路径
  // 必须保持 NoToneMapping + shadowMap 关——USE_SHADOWMAP define 由场景 shadow 状态驱动，
  // 关闭时所有材质的阴影注入代码被整体裁掉 = 现状着色器）
  setGraphicsMode(mode) {
    const full = mode === 'full';
    this.renderer.toneMapping = full ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = full;
    this.postfx.setSceneCamera(this.scene, this.camera);
    this.postfx.setEnabled(full);
  }

  render() {
    this.postfx.render(this.scene, this.camera);
  }

  // B49：帧首清零渲染统计（Game.loop 调用）。此后本帧所有 pass 的绘制次数/三角面累加，
  // 帧末读 stats 即为整帧总量。
  resetStats() {
    this.renderer.info.reset();
  }

  // B49：渲染统计（THREE.WebGLRenderer.info；调试屏读 render / memory 两组）
  get stats() { return this.renderer.info; }

  get domElement() { return this.renderer.domElement; }
}
