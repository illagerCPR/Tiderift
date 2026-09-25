// version.js -- 版本号唯一来源：每次功能交付完成（批次 push + CI 绿）BUILD 递增 1
// 规则全文见 AGENTS.md「版本号与发布规则」；主界面与游戏内左下角显示 VERSION_LABEL
// B29 起：项目更名 Tiderift（裂潮），版本格式 Alpha → Beta，Build 数不重置（跨前缀连续）
export const BUILD = 29;
export const VERSION_LABEL = `Tiderift Beta Build ${BUILD}`;
