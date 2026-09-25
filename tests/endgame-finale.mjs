// endgame-finale.mjs -- 终局篇 F3「听潮仪式」回归（node 直跑，无需服务器）
// 断言：
//   ① 听潮门控真值表：finaleListenGate 8 组合（read/trigger/swallow 三态）
//   ② finaleDone 状态序列化三处（dragonDefeated 同款：start 恢复 / SaveSystem / 换维透传）
//   ③ 协议链路绊线：FINALE_STATE 定义 / room onFinaleState 只进不退 + save /
//      WORLD_INFO 三处 finale 字段 / store 序列化 / NetworkManager 收发 / WORLD_INFO 先达暂存
//   ④ 仪式演出绊线：龙影低头粒子（dragon AI 零改动）/ 纹章发放（背包满走掉落链）/
//      守望碑右键门控接入（不回退碑文阅读）
//   ⑤ 发版：BUILD 17→18（终局篇统一发版）
import { finaleListenGate } from '../src/world/finale-tide.js';
import { readFileSync } from 'fs';
import { BUILD } from '../src/version.js';

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}

// ── ① 听潮门控真值表 ──
// (chapterId, done, offered, windowActive) → read | trigger | swallow
ok(finaleListenGate({ chapterId: 'end_gleaner', done: false, offered: true, windowActive: false }) === 'read', '非守望碑 → read');
ok(finaleListenGate({ chapterId: null, done: false, offered: true, windowActive: false }) === 'read', '无章节（无字碑）→ read');
ok(finaleListenGate({ chapterId: 'end_watch', done: true, offered: true, windowActive: false }) === 'read', '已听完 → read（碑文不写终章，重复右键读守望章）');
ok(finaleListenGate({ chapterId: 'end_watch', done: false, offered: false, windowActive: false }) === 'read', '未候潮 → read（不变量 6：既有阅读行为不回退）');
ok(finaleListenGate({ chapterId: 'end_watch', done: false, offered: true, windowActive: false }) === 'trigger', '候潮 ∧ 未听过 ∧ 空闲 → trigger');
ok(finaleListenGate({ chapterId: 'end_watch', done: false, offered: true, windowActive: true }) === 'swallow', '演出进行中 → swallow（不重触发）');
ok(finaleListenGate({ chapterId: 'end_watch', done: true, offered: true, windowActive: true }) === 'read', 'done 优先于窗口 → read');
ok(finaleListenGate(null) === 'read', '空状态 → read（防御）');

// ── ② finaleDone 状态序列化三处 ──
const gameSrc = readFileSync('./src/player/Game.js', 'utf8');
ok(gameSrc.includes('this.world.finaleDone = !!(loadData && loadData.finaleDone);'), 'start 恢复 finaleDone');
ok(gameSrc.includes('finaleDone: !!this.world.finaleDone, // 听潮完成跨维透传'), '换维透传 finaleDone');
const saveSrc = readFileSync('./src/core/SaveSystem.js', 'utf8');
ok(saveSrc.includes('finaleDone: !!game.world.finaleDone,'), 'SaveSystem 序列化 finaleDone');

// ── ③ 协议链路绊线 ──
const protoSrc = readFileSync('./server/protocol.js', 'utf8');
ok(protoSrc.includes("FINALE_STATE: 'finale_state'"), '协议键 FINALE_STATE 在场');
const roomSrc = readFileSync('./server/room.js', 'utf8');
ok(roomSrc.includes('onFinaleState(player, msg) {'), '服务器 onFinaleState 在场');
ok(roomSrc.includes("msg.offered === true && !this.finaleOffered"), '献证只进不退（首次坐标锁定）');
ok(roomSrc.includes("msg.done === true && this.finaleOffered && !this.finaleDone"), '听潮门控：须先候潮 ∧ 未完成');
ok(roomSrc.includes('startTs: Date.now()'), 'startTs 服务器时钟重排（房间权威时钟）');
ok((roomSrc.match(/finale: this\.finaleInfo\(\)/g) || []).length === 3, 'WORLD_INFO 三处 finale 快照（join/重连/重建）');
ok(roomSrc.includes('finaleOffered = !!snap.finaleOffered;'), '快照 restore finaleOffered');
const storeSrc = readFileSync('./server/store.js', 'utf8');
ok(storeSrc.includes('finaleOffered: !!room.finaleOffered,') && storeSrc.includes('finaleDone: !!room.finaleDone,'), 'store 序列化 finale 状态');
const netSrc = readFileSync('./src/net/NetworkManager.js', 'utf8');
ok(netSrc.includes('sendFinaleState(payload) {'), '客户端发送口在场');
ok(netSrc.includes('case MSG.FINALE_STATE:'), '客户端接收 case 在场');
ok(netSrc.includes('this.game.finaleInfo = {'), 'WORLD_INFO 先达暂存 finaleInfo（start 前时序安全）');
ok(gameSrc.includes('if (this.finaleInfo) {'), 'start 落地 finaleInfo（aetherDusk 同款时序）');

// ── ④ 仪式演出绊线 ──
ok(gameSrc.includes('_tryListenTide(block) {'), '听潮门控方法在场');
ok(gameSrc.includes("if (!this._tryListenTide(hit.block)) {"), '守望碑右键走门控（返回 false 才读碑文）');
ok(gameSrc.includes("finaleListenGate({"), '门控走纯函数（真值表 node 可测）');
ok(gameSrc.includes('this.net.sendFinaleState({ done: true })'), 'LAN 听潮上服务器（含发起者统一由广播驱动）');
ok(gameSrc.includes('this.world.finaleDone = true; // 单机：本地置位'), '单机听潮本地置位（SaveSystem 持久化）');
ok(gameSrc.includes('_grantPrimordialEmblem() {'), '纹章发放方法在场');
ok(gameSrc.includes('if (ft && ft.ritual && !ft.granted) this._grantPrimordialEmblem();'), '仪式窗口结束发放（granted 防重复）');
ok(gameSrc.includes("this.inventory.add('primordial_emblem', 1)"), '纹章入背包');
ok(gameSrc.includes("sendDropSpawn(p.x, p.y + 1, p.z, 'primordial_emblem', 1)"), '背包满走掉落链（联机进账本）');
ok(gameSrc.includes("m.typeName === 'dragon'"), '龙影低头取龙实体位置（在场才低头）');
ok(gameSrc.includes('_finaleTide.ritual && p > 0.25 && this.mobManager'), '龙影环仅仪式窗口且包络盛放期');
ok(gameSrc.includes('this.net.sendFinaleState({ offered: true'), '献证 LAN 上报（F1 缺口补齐）');

// ── ⑤ 发版 ──
ok(BUILD === 28, `BUILD 24（Build 23 主菜单与皮肤面板批次统一 bump，当前 ${BUILD}）`);

// ── ⑥ K3 终局成就 ──
const hudSrc = readFileSync('./src/ui/Hud.js', 'utf8');
ok(hudSrc.includes('showFinaleBanner() {'), '终局横幅方法在场（10s 金色淡入淡出）');
ok(gameSrc.includes('if (this.hud) this.hud.showFinaleBanner();'), '纹章发放时触发横幅');
ok(hudSrc.includes('heartSvg(filled, half = false, bedrock = false)'), '心形 SVG 支持基岩参数');
ok(hudSrc.includes('player.emblemWorn'), 'Hud 按 emblemWorn 渲染基岩心');
ok(hudSrc.includes('wingIcon.style.display = player.flying'), '翅膀图标全模式判定（K2 在场核对）');
const playerSrc = readFileSync('./src/player/Player.js', 'utf8');
ok(playerSrc.includes('if (this.emblemWorn) return false;'), '佩戴纹章=无敌（hurt 顶部拒绝）');
ok(playerSrc.includes('this.emblemWorn = false;'), 'emblemWorn 默认关闭');
const ctrlSrc = readFileSync('./src/player/Controls.js', 'utf8');
ok(ctrlSrc.includes('(this.player.creative || this.player.emblemWorn)'), '双击空格飞行门控放开（creative || emblemWorn）');
ok(saveSrc.includes('emblemWorn: !!game.player.emblemWorn,'), 'SaveSystem 序列化 emblemWorn');
ok(gameSrc.includes('this.player.emblemWorn = !!(loadData && loadData.emblemWorn) && this.world.finaleDone;'), 'start 恢复佩戴（仅通关存档有效）');
ok(gameSrc.includes('emblemWorn: !!this.player.emblemWorn, // 纹章佩戴跨维透传'), '换维透传 emblemWorn');
const menuSrc = readFileSync('./src/ui/MenuScreen.js', 'utf8');
ok(menuSrc.includes("s.finaleDone ? `<div style=\"font-size:12px; color:#ffd98a"), '存档栏通关祝贺字样（金色）');
const invSrc = readFileSync('./src/ui/InventoryScreen.js', 'utf8');
ok(invSrc.includes('this.game.world.finaleDone'), '纹章槽门控 finaleDone（仅通关显示）');
ok(invSrc.includes("s && s.name === 'primordial_emblem'"), '佩戴需背包持有纹章（不可凭空）');
ok(invSrc.includes('this.player.flying = false; // 取下即落地'), '取下即落地（防悬空）');

console.log(`endgame-finale: ${passed} assertions passed`);
