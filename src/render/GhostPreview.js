// GhostPreview.js -- 非世界幽灵体素预览
import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { decodeBlueprintRLE, BLUEPRINT_LIMITS, validateBlueprint } from '../core/Blueprints.js';

const sharedGeometry = new THREE.BoxGeometry(0.96, 0.96, 0.96);
const materials = new Map();
function materialFor(id) {
  let material = materials.get(id);
  if (material) return material;
  const def = BlockRegistry.getById(id);
  const color = Number.isInteger(def && def.color) ? def.color : 0x9bbec2;
  material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.48, depthWrite: false });
  materials.set(id, material);
  return material;
}

export class GhostPreview {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);
    this.mesh = null;
    this.outline = null;
    this.blueprint = null;
    this.dim = null;
    this.rotation = 0;
    this.offsetY = 0;
    this.anchor = { x: 0, y: 0, z: 0 };
    this.boxOnly = false;
    this.notice = '';
  }

  show(blueprint, dim) {
    const checked = validateBlueprint(blueprint);
    if (!checked.ok) return false;
    this._clearObjects();
    this.blueprint = blueprint;
    this.dim = dim;
    this.rotation = 0;
    this.offsetY = 0;
    this.boxOnly = false;
    this.notice = '';
    const decoded = checked.voxels;
    let solidCount = 0;
    for (const id of decoded) if (id !== 0) solidCount++;
    if (solidCount > BLUEPRINT_LIMITS.instances) {
      this.boxOnly = true;
      this.notice = 'box';
      this._buildOutline();
    } else {
      this._buildInstances(decoded);
    }
    this.group.visible = true;
    return true;
  }

  _buildInstances(voxels) {
    const { x: sx, y: sy, z: sz } = this.blueprint.size;
    const grouped = new Map();
    for (let i = 0; i < voxels.length; i++) {
      const id = voxels[i];
      if (id === 0) continue;
      let list = grouped.get(id);
      if (!list) grouped.set(id, list = []);
      list.push(i);
    }
    const dummy = new THREE.Object3D();
    for (const [id, indices] of grouped) {
      const mesh = new THREE.InstancedMesh(sharedGeometry, materialFor(id), indices.length);
      mesh.frustumCulled = false;
      for (let n = 0; n < indices.length; n++) {
        const i = indices[n];
        const x = i % sx;
        const z = Math.floor(i / sx) % sz;
        const y = Math.floor(i / (sx * sz));
        dummy.position.set(x + 0.5 - sx / 2, y + 0.5, z + 0.5 - sz / 2);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }
  }

  _buildOutline() {
    const size = this.blueprint.size;
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const material = new THREE.LineBasicMaterial({ color: 0xffd775, transparent: true, opacity: 0.9 });
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), material);
    this.outline.position.set(0, size.y / 2, 0);
    geometry.dispose(); // EdgesGeometry 已复制顶点数据，源 BoxGeometry 可立即释放
    this.group.add(this.outline); // 材质归 outline 所有，由 _clearObjects 统一释放（勿在建造时提前 dispose）
  }

  setAnchor(x, y, z) {
    this.anchor = { x, y, z };
    this._applyTransform();
  }

  rotate() {
    this.rotation = (this.rotation + 1) % 4;
    this._applyTransform();
  }

  raise(amount) {
    this.offsetY += amount;
    this._applyTransform();
  }

  _applyTransform() {
    this.group.rotation.y = this.rotation * Math.PI / 2;
    this.group.position.set(this.anchor.x, this.anchor.y + this.offsetY, this.anchor.z);
  }

  _clearObjects() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child.isLineSegments) {
        // 轮廓 geometry/material 为本实例独占（每次重建），关闭时必须释放
        child.geometry.dispose();
        child.material.dispose();
      } else if (child.isInstancedMesh) {
        // 共享 geometry/material 不随实例释放；只注销 instanceMatrix 的 GPU 缓冲（three WebGLObjects 监听该事件）
        child.dispose();
      }
    }
    this.mesh = null;
    this.outline = null;
  }

  hide() {
    this.group.visible = false;
    this._clearObjects();
    this.blueprint = null;
    this.dim = null;
    this.boxOnly = false;
    this.notice = '';
  }

  dispose() {
    if (!this.scene) return; // 幂等：重复 dispose 不抛错
    this.hide();
    this.scene.remove(this.group);
    this.group.clear();
    this.scene = null;
  }
}
