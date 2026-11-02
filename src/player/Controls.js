// Controls.js -- 输入控制
export class Controls {
  constructor(domElement, player) {
    this.dom = domElement;
    this.player = player;
    this.keys = {};
    this.mouseLeft = false;
    this.mouseRight = false;
    this.locked = false;
    this.lastJumpTap = 0;
    this.wheelDelta = 0;
    this.enabled = false;
    this.sensitivityScale = 1; // 视频设置：鼠标灵敏度倍率
    // B41：鼠标位移的落点。非空时写到该对象（灵魂出窍相机），玩家的 yaw/pitch 保持不变
    this.lookTarget = null;
    
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('wheel', this.onWheel);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  dispose() {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }

  requestLock() {
    this.dom.requestPointerLock();
  }

  onPointerLockChange() {
    this.locked = document.pointerLockElement === this.dom;
  }

  onKeyDown(e) {
    // Build 12：文本输入焦点或输入法合成中不记录按键状态——否则输入法打断后 keyup 丢失，
    // keys[] 卡死（"按键失灵"：松键仍移动/松开空格意外翻转飞行）
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.isComposing || e.keyCode === 229) return;
    this.keys[e.code] = true;
    // 自动重复（长按触发的 OS keydown 连发）：保持按键状态，但不得进入单击/双击触发逻辑
    //——否则长按空格期间 lastJumpTap 被连发刷新（间隔恒 <300ms），飞行状态被以键率翻转，
    // 释放时空格相位随机落在"关"上（表现为松开空格意外取消飞行）
    if (!this.enabled || e.repeat) return;
    if (e.code === 'Space' && !this.lookTarget) {
      const now = performance.now();
      // Build 19 K3：佩戴原初纹章的生存玩家同样可双击空格切换飞行（创造式飞行）
      if (now - this.lastJumpTap < 300 && (this.player.creative || this.player.emblemWorn)) {
        this.player.flying = !this.player.flying;
        if (this.player.flying) this.player.velocity.y = 0;
      }
      this.lastJumpTap = now;
    }
  }

  onKeyUp(e) {
    this.keys[e.code] = false;
  }

  onMouseMove(e) {
    if (!this.locked) return;
    const sensitivity = 0.0022 * this.sensitivityScale;
    const rig = this.lookTarget || this.player; // B41：灵魂出窍时改道到独立相机位姿
    rig.yaw -= e.movementX * sensitivity;
    rig.pitch -= e.movementY * sensitivity;
    const lim = Math.PI / 2 - 0.01;
    rig.pitch = Math.max(-lim, Math.min(lim, rig.pitch));
  }

  onMouseDown(e) {
    if (!this.enabled) return;
    if (!this.locked) {
      this.requestLock();
      return;
    }
    // Build 20 ③：中键取物（原版创造行为）——回调由 Game 注入，吞掉浏览器中键自动滚动
    if (e.button === 1) {
      e.preventDefault();
      if (this.onPickBlock) this.onPickBlock();
      return;
    }
    if (e.button === 0) this.mouseLeft = true;
    if (e.button === 2) this.mouseRight = true;
  }

  onMouseUp(e) {
    if (e.button === 0) this.mouseLeft = false;
    if (e.button === 2) this.mouseRight = false;
  }

  onWheel(e) {
    // UI（背包/箱子/熔炉/暂停等）打开时 enabled=false：不累积滚轮增量，
    // 否则物品栏内滚动鼠标会在关闭界面时意外切换快捷栏
    if (!this.enabled) return;
    this.wheelDelta += Math.sign(e.deltaY);
  }

  // 获取移动方向（基于朝向）；yaw 可显式传入（灵魂出窍用相机 yaw，身体朝向不参与）
  getMoveVector(yaw = this.player.yaw) {
    let fx = 0, fz = 0;
    if (this.keys['KeyW']) fz -= 1;
    if (this.keys['KeyS']) fz += 1;
    if (this.keys['KeyA']) fx -= 1;
    if (this.keys['KeyD']) fx += 1;
    
    // 转换到世界空间（基于 yaw）
    // Three.js 中 yaw 绕 Y 轴右手旋转，yaw=0 时相机朝 -Z
    // forward = (-sin(yaw), 0, -cos(yaw))
    // right   = ( cos(yaw), 0, -sin(yaw))
    // W (fz=-1) 朝 forward，D (fx=+1) 朝 right
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const wx = (-fz) * (-sin) + fx * cos;
    const wz = (-fz) * (-cos) + fx * (-sin);
    
    const len = Math.sqrt(wx * wx + wz * wz);
    if (len > 0) return { x: wx / len, z: wz / len };
    return { x: 0, z: 0 };
  }

  isJumping() { return !!this.keys['Space']; }
  isSneaking() { return !!this.keys['ShiftLeft'] || !!this.keys['ShiftRight']; }
  isSprinting() { return !!this.keys['ControlLeft']; }
}
