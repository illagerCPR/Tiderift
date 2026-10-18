// constants.js -- 玩家/方块共享常量（F9 魔法数字集中；第二波 MobManager 亦 import 本模块）
export const PLAYER_EYE_HEIGHT = 1.62;  // 眼高：相机视点、准星射线起点、箭矢/粒子起点
export const BLOCK_CENTER = 0.5;        // 方块中心偏移：整数方块坐标 → 方块几何中心（x/y/z 同口径）
export const MOVE_SPEED_FLYING = 12;    // 飞行移速（创造/旁观开启飞行）
export const MOVE_SPEED_SURVIVAL = 4.3; // 生存步行移速
export const MOVE_SPEED_CREATIVE = 5.6; // 创造/旁观未飞行时的步行移速
