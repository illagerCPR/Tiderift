# Dockerfile -- Tiderift 一体化镜像（客户端静态站 + 局域网联机服务器，单端口 3001）
# 构建：docker build -t tiderift .
# 运行：docker run -d -p 3001:3001 -v tiderift-data:/data tiderift
# 说明：客户端由服务器同源托管（GET /），管理面板固定在 /admin；数据落在 /data 卷。
#
# 多架构设计（重要）：
#   builder / deps 阶段固定跑在构建机原生架构（$BUILDPLATFORM），产物是纯 JS 与静态文件，
#   与目标架构无关；runtime 阶段按 $TARGETPLATFORM 取对应基础镜像，且**不含任何 RUN**——
#   所有文件准备都在构建机架构完成，用 COPY --chown 落地。这样 arm64 构建不需要 QEMU
#   模拟执行任何指令，速度快且不会出现 "exec format error"。

# ── 阶段 1：构建前端静态站（构建机架构）──
FROM --platform=$BUILDPLATFORM node:26-alpine AS builder
WORKDIR /app

# 先只拷依赖清单，命中 Docker 层缓存（源码变动不触发重装）
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit

COPY index.html vite.config.js ./
COPY src ./src
COPY res ./res
# 前端 src/net/NetworkManager.js 直接 import '../../server/protocol.js'（消息类型与协议版本单一来源）
COPY server/protocol.js ./server/protocol.js
RUN npm run build

# ── 阶段 2：安装服务器生产依赖（构建机架构；ws 是纯 JS，无原生模块）──
FROM --platform=$BUILDPLATFORM node:26-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit
# 准备一个空目录，供 runtime 阶段用 COPY --chown 落地 /data（避免在目标架构执行 mkdir/chown）
RUN mkdir -p /app/data-seed

# ── 阶段 3：运行时（目标架构，零 RUN）──
FROM node:26-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    TIDERIFT_DATA_DIR=/data \
    TIDERIFT_STATIC_DIR=/app/dist

# 服务器源码（精确拷贝，不含测试套件与运行时数据）
COPY --chown=node:node server/package.json ./server/
COPY --chown=node:node server/index.mjs server/room.js server/store.js server/config.js \
     server/protocol.js server/ratelimit.js server/stats.js \
     server/flow.js server/furnace.js server/industry.js server/client-sim.mjs \
     server/admin.html ./server/
# 服务器与客户端共享的纯逻辑模块（room.js/flow.js/furnace.js 直接 import ../src/…：
# 维度表、地形生成器、结构表、方块注册表等，共 33 个文件且随功能增长）
COPY --chown=node:node src ./src
COPY --chown=node:node --from=deps /app/server/node_modules ./server/node_modules
COPY --chown=node:node --from=builder /app/dist ./dist

# 数据卷：世界存档（/data/world）与服务器配置（/data/config.json）
# 用 COPY --chown 建目录并设属主（替代 RUN mkdir + chown，避免在目标架构执行指令）
COPY --chown=node:node --from=deps /app/data-seed /data
VOLUME ["/data"]

USER node
EXPOSE 3001

# 健康检查打 /admin（恒 200）；/api/status 在开启管理口令后会 401，不能用作探针
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/admin').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
