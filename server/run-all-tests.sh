#!/usr/bin/env bash
# run-all-tests.sh -- 一键回归：纯 node 套件（无需服务器）→ 清状态 → 起真实服务器 → 跑全部套件 → 停服（套件清单以本脚本内数组/循环为准，勿写死数量）
# 任何套件失败则整体退出 1；CI 与本地共用同一入口（本地须在 3001 空闲时执行）

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ── 纯 node 套件（不依赖服务器，先跑；清单即下面的数组，新增套件只加一行）──
PURE_NODE_SUITES=(
    structure-determinism      # 结构生成确定性回归（纯 node，不依赖服务器；放最前避免占用 3001 端口检查）
    loot-determinism           # T5 战利品/交易表确定性回归（纯 node）
    cave-determinism           # W3 洞穴生成回归（纯 node）
    biome-determinism          # 主世界群系回归（纯 node：确定性/在场占比/高山海拔锚点/相邻列连续性）
    dimension-determinism      # 维度地形生成回归（纯 node：下界等已实现维度的确定性/顺序无关/出生点安全）
    biome-scale-determinism    # 生物群系规模档位回归（纯 node：small 与旧版逐字节一致/档位单调放大/清洗兜底）
    portals-unit               # 传送门逻辑回归（纯 node：框校验/填充/拆门清波/自动返程门/账本搜门）
    nether-fortress            # 下界要塞结构回归（纯 node：维度作用域/记录自洽/布局确定性/区块落地/战利品表）
    nether-mobs                # 下界怪物回归（纯 node：类型注册/模型一致/生成表分布/中立悬浮标记）
    nether-steles              # 下界烬火纪基石（世界观批次 N1：ember_stele/mourn_tear/方块 lore/碑文跨维度 dim 完备）
    nether-structures          # 潮火之炉（世界观批次 N2：选址确定性/落地/三向注册/要塞碑位/FORCED 哀潮之泪）
    overworld-steles           # 主世界雨土纪基石（世界观批次 W1：moss_stele/page_rain/凋灵骷髅头 lore/雨土纪 3 章）
    overworld-structures       # 潮冢（世界观批次 W2：河段锚点选址/显式水填/三向注册/陆地零命中/FORCED 雨潮残页）
    end-islands                # 末地外岛锚点场回归（纯 node：群系在场/密度带宽/锚点确定性/群系方块同源）
    end-steles                 # 末地·无潮彼岸基石（世界观批次 E1：界纹石碑注册/彼岸碑文 2 章/拾遗者体系 lore/龙留白纪律）
    end-structures             # 拾遗者石环 + 主岛守望界碑（世界观批次 E2：密度预案/高原门控/三向注册/对拍/守望碑位/不变量绊线）
    endgame-content            # 终局篇 F1 候潮基石（原初祭坛/原初纹章注册、龙蛋 lore、i18n 盲区键、接线绊线）
    endgame-tide               # 终局篇 F2 四界同潮演出管线（段配置/包络确定性/还原纯度绊线/零持久化）
    endgame-finale             # 终局篇 F3 听潮仪式（门控真值表/状态序列化/协议链路/龙影绊线/BUILD 18）
    whale-barrow               # 鲸骨冢篇 K1（鲸骨块注册/归云章/solve 确定性/选址拒绝/箱表/探索列表绊线）
    build20-fixes              # 终局演出全维度/永昼泄漏修复）
    build21-skins              # 修复 B 挂点/皮肤管线接线/i18n 新键）
    build22-fixes              # Build 22 修复批次（overlay 双层对齐/第一人称手臂缩小/实体体素光染色/皮肤拉取日志绊线/i18n 改版）
    build23-menu-lan           # Build 23（皮肤面板输入框自适应加宽/鉴权账号收尾清理/主界面 LAN 状态组件）
    build24-fixes              # Build 24 wip（LAN 默认服务器设置/积雪针叶林树修复；不 bump BUILD）
    build25-fixes              # Build 25 回归（纯 node：树让位/村庄麦田/单机位多群系全景）
    build26-fluid              # Build 26 流体模拟回归（纯 node：等级往返/扩散/消退/水岩浆生成/批量通道）
    build27-doors-beds         # Build 27 床/门形制回归（纯 node：状态 ID 家族/白名单透传/红石切换/几何/碰撞/村庄配对/迁移）
    build28-block-textures     # B28 方块材质（定向面/多面纠偏 + 状态家族）回归（纯 node）
    build29-rename-icons       # B29 更名 Tiderift（Beta 版本格式/logo/引用面）+ 创造栏技术方块过滤 + 等轴图标回归（纯 node）
    build30-water-exit-air     # B30 水中上岸助推 + 氧气原版口径回归（纯 node：物理场景仿真/助推门限/陆上台阶保持/氧气 15 秒/溺水 2HP/s/接线绊线）
    end-dragon                 # 末影龙 Boss 回归（纯 node：类型注册/柱顶水晶/DragonAI 状态机/击败链路/末地门控）
    end-gateway                # 龙败奖励链回归（纯 node：折跃门注册/选址/建门/角度配对/返程喷泉门/幂等门控）
    end-city                   # 末地城结构回归（纯 node：方块/潜影贝注册/选址漏斗/落地/箱子三向/loot 保底/确定性）
    aether-structures          # 天域三结构回归（纯 node：维度作用域/选址漏斗/落地/箱子三向/loot/确定性）
    aether-mobs                # 天域生物回归（纯 node：类型注册/模型/生成表分布/悬浮被动标记）
    aether-content             # 天域叙事基石回归（纯 node：方块/物品注册/分类/碑文章节表/石碑注册表/id 追加纪律）
    aether-boss                # 守誓巨像回归（纯 node：注册/状态机/齐射震地回调/图腾配方）
    i18n-parity                # 语言包三重校验（纯 node：10 包键集对齐/占位符对齐/静态∪动态键覆盖审计/重复键扫描）
    leak-guards                # 资源释放回归守卫（纯 node：unloadChunk 三 mesh 释放 / InventoryScreen dispose 接线 / _disposeWorld 单点收口）
    version-pin                # 版本钉值唯一来源（纯 node：BUILD/VERSION_LABEL 断言 + tests/ 无第二处 BUILD 钉值的元断言）
    framework-guard            # runner 样板唯一性元断言（纯 node：tests/ 与 server/ 各自只有一份框架，无复制粘贴断言样板）
    room-persist-replay        # 落盘节流 + 账本回放打包（纯 node：Room 直接实例化，不依赖服务器进程）
    net-message-guard          # 客户端消息入口防御（纯 node：parseServerMessage 脏输入 + _handle 空值不抛）
    ray-sphere                 # 共享球体射线纯函数（纯 node：命中/未命中/背向/相切/非单位方向口径 + 帧射线缓存与 UI 阻断清单唯一性）
    world-mod-index            # 修改方块账本分桶索引与热路径坐标键（纯 node：索引一致性 + 与旧全量扫描实现等价性对照）
    mob-ray-select             # 怪物球体射线选择 + dispose 复用 + Boss 列表（纯 node：与改前逐字实现随机对拍 + 源码唯一性断言）
    cw1-mesh-stability         # CW-1 区块边界稳定态收敛（纯 node：缺邻居构建 → 反向标脏 → 重建与参照构建逐顶点一致）
    ui-audio-smoke             # src/ui + src/audio import 冒烟（纯 node：最小 DOM 壳下全量 import + 跨模块具名导出核对）
)

for t in "${PURE_NODE_SUITES[@]}"; do
    echo "=== $t ==="
    if node "tests/$t.mjs"; then
        echo "$t: OK"
    else
        echo "$t: FAILED"
        exit 1
    fi
done

# 测试非幂等：先确认 3001 空闲，再清空运行时数据保证干净状态
if (exec 3<>/dev/tcp/127.0.0.1/3001) 2>/dev/null; then
    exec 3>&- 3<&- 2>/dev/null
    echo "ERROR: port 3001 already in use. Stop the LAN server first (./start.sh server-stop)." >&2
    exit 1
fi
rm -rf server/world
rm -f server/config.json

./start.sh server >/dev/null 2>&1

# 等端口 3001 就绪（最多 10 秒）
port_ready=0
for i in $(seq 1 20); do
    if (exec 3<>/dev/tcp/127.0.0.1/3001) 2>/dev/null; then
        exec 3>&- 3<&- 2>/dev/null
        port_ready=1
        break
    fi
    sleep 0.5
done
if [ "$port_ready" -ne 1 ]; then
    echo "ERROR: LAN server did not listen on 3001 in time. See server-err.log." >&2
    ./start.sh server-stop >/dev/null 2>&1
    exit 1
fi

failed=0
for t in test-mp test-store test-admin test-stage5 test-stage6 test-stage10 test-stage11 test-idea2 test-profile test-idea4 test-t5 test-dim test-skinlog test-hardening-net test-hardening-edge test-hardening-store; do
    echo "=== $t ==="
    if node "server/$t.mjs"; then
        echo "$t: OK"
    else
        echo "$t: FAILED"
        failed=1
    fi
done

./start.sh server-stop >/dev/null 2>&1

# Build 23：跑批结束自动清除鉴权账号与测试世界（与跑批前清理对称）。
# 面板/多账号套件会持久化 adminAccounts 到 config.json，遗留鉴权态会让
# 后续人工调用 401；stage11 已有 API 级收尾，此处文件级兜底回到默认无鉴权状态。
rm -rf server/world
rm -f server/config.json
echo "cleanup: 服务器测试数据与鉴权账号已清除"

if [ "$failed" -ne 0 ]; then
    echo "RESULT: FAILED"
    exit 1
fi
echo "RESULT: ALL PASS"
