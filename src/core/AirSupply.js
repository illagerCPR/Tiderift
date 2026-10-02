// AirSupply.js -- 氧气/溺水结算（原版口径纯函数，node 可测）
// airTicks 语义 = 原版 tick（20 tick/s），满氧 300 tick = 15 秒；逐帧按 dt 折算，帧率无关。

export const AIR_MAX_TICKS = 300;      // 满氧（原版 300 tick = 15 秒）
export const AIR_REGEN_PER_SEC = 600;  // 出水回氧速度（约 0.5 秒回满）
export const DROWN_INTERVAL = 1.0;     // 溺水伤害间隔（秒，原版每秒一次）
export const DROWN_DAMAGE = 2;         // 单次溺水伤害（原版口径）

// entity 需要 airTicks / drownTimer / health 字段；inWater = 眼位是否在水下（Game 侧判定）
export function updateAirSupply(entity, inWater, dt) {
  if (inWater) {
    entity.airTicks -= dt * 20;
    if (entity.airTicks < 0) entity.airTicks = 0;
    if (entity.airTicks <= 0) {
      // 耗尽后每秒扣一次血；drownTimer 缺省满值（存档不持久化该计时器）
      entity.drownTimer = (entity.drownTimer ?? DROWN_INTERVAL) - dt;
      if (entity.drownTimer <= 0) {
        entity.drownTimer = DROWN_INTERVAL;
        entity.health = Math.max(0, entity.health - DROWN_DAMAGE);
      }
    }
  } else {
    entity.drownTimer = DROWN_INTERVAL;
    entity.airTicks = Math.min(AIR_MAX_TICKS, entity.airTicks + AIR_REGEN_PER_SEC * dt);
  }
}
