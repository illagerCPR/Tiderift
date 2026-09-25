// RemoteHotbarSprite.js -- 远端玩家头顶快捷栏 sprite（阶段11）
// 9 槽 canvas 广告牌：物品图标走 itemSvgMap→blockSvgMap 解析链（与 Hotbar 同口径），
// 选中槽白框高亮；内容/选中态签名未变化不重绘（player_state 20Hz 高频触发也只做字符串比较）。
// 注意：texture/material 每实例独享（昵称标签同款），dispose 必须释放；图标 Image 模块级缓存复用。
import * as THREE from 'three';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { BlockSVGDefinitions } from '../blocks/BlockDefs.js';
import { SVGTextures } from './SVGTextures.js';

const CELL = 20;         // 单槽像素
const PAD = 3;           // 画布外边距
const GAP = 2;           // 槽间距
const SLOTS = 9;
const CANVAS_W = PAD * 2 + SLOTS * CELL + (SLOTS - 1) * GAP;
const CANVAS_H = PAD * 2 + CELL;
const WORLD_W = 2.0;     // 世界宽度（高按画布比例换算）

// 模块级图标缓存：name -> {promise, img|null}（跨玩家/跨重建复用，避免重复解码）
const iconCache = new Map();

// 与 Hotbar.getIconSvg 同口径的 SVG 解析链：物品优先，方块用 side 贴图
function getIconSvg(name) {
  const item = ItemRegistry.getByName(name);
  if (item && ItemSVGDefinitions[name]) return ItemSVGDefinitions[name];
  const block = BlockRegistry.getByName(name);
  if (block) {
    const texName = block.icon || block.side || block.top; // B28 优先定向面（箱子/熔炉图标看得出正面）
    if (BlockSVGDefinitions[texName]) return BlockSVGDefinitions[texName];
  }
  return null;
}

// 取图标：返回已就绪的 Image（同步）或 null（异步加载中/失败；加载完成后由回调触发重绘）
function getIcon(name, onLoaded) {
  let e = iconCache.get(name);
  if (!e) {
    const svg = getIconSvg(name);
    if (!svg) return null;
    e = { promise: null, img: null };
    e.promise = SVGTextures.svgToImage(svg)
      .then((img) => { e.img = img; if (onLoaded) onLoaded(); })
      .catch(() => {});
    iconCache.set(name, e);
  }
  return e.img;
}

export class RemoteHotbarSprite {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.material = new THREE.SpriteMaterial({
      map: this.texture, depthTest: false, depthWrite: false, transparent: true,
    });
    this.sprite = new THREE.Sprite(this.material);
    const h = WORLD_W * CANVAS_H / CANVAS_W;
    this.sprite.scale.set(WORLD_W, h, 1);
    this.sprite.renderOrder = 999;
    this._slots = new Array(SLOTS).fill(null); // [{name,count}|null]
    this._selected = 0;
    this._sig = null;   // 指纹（setHotbar 比较）
    this._empty = true; // 无任何物品时隐藏
    this._redraw();
  }

  // 快捷栏变化入口：签名比较 → 变化才重绘；图标异步到位后补画（签名已再变化时由新一次重绘覆盖）
  setHotbar(hotbar, selected) {
    if (!Array.isArray(hotbar)) return;
    const slots = [];
    let any = false;
    for (let i = 0; i < SLOTS; i++) {
      const s = hotbar[i];
      if (s && s.name) { slots.push({ name: s.name, count: s.count || 1 }); any = true; }
      else slots.push(null);
    }
    const sig = `${selected | 0}|${slots.map((s) => (s ? `${s.name}:${s.count}` : '')).join(';')}`;
    this._empty = !any;
    if (sig === this._sig) return;
    this._sig = sig;
    this._slots = slots;
    this._selected = selected | 0;
    this._redraw();
  }

  setVisible(v) {
    this.sprite.visible = !!v && !this._empty;
  }

  _redraw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    // 半透明底板
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (let i = 0; i < SLOTS; i++) {
      const x = PAD + i * (CELL + GAP);
      // 槽框：选中槽白 2px，其余淡 1px
      ctx.strokeStyle = i === this._selected ? '#ffffff' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = i === this._selected ? 2 : 1;
      ctx.strokeRect(x + 0.5, PAD + 0.5, CELL - 1, CELL - 1);
      const s = this._slots[i];
      if (!s) continue;
      // 图标（16×16 居中；异步加载中的槽位先留空，加载完成回调里补画）
      const img = getIcon(s.name, () => this._redraw());
      if (img) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x + 2, PAD + 2, CELL - 4, CELL - 4);
      }
      // 数量角标
      if (s.count > 1) {
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeText(String(s.count), x + CELL - 2, PAD + CELL - 2);
        ctx.fillStyle = '#fff';
        ctx.fillText(String(s.count), x + CELL - 2, PAD + CELL - 2);
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    if (this.sprite.parent) this.sprite.parent.remove(this.sprite);
    this.texture.dispose();
    this.material.dispose();
  }
}
