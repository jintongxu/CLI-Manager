# 技术设计：隐藏终端惰性重建

## 根因陈述

 bug 生活在**持久化恢复边界**（`restoreSessions` ↔ sessions.json）：`tabHidden` 的语义
是"展示层关闭、进程与持久化保留"，但恢复路径把"保留持久化"当成了"必须立即实体化 PTY"，
导致用户不可见的旧隐藏终端在每次重启时都被重建进程并被计入恢复提示。修复落在恢复入口
（`restoreSessions`），把"实体化"从恢复时推迟到"用户重新打开"时，而不是在提示/列表处打补丁。

## 状态自检（state qualifier）

根因陈述含状态限定词"隐藏的会话" → 按场景矩阵枚举：

| 场景 | 行为 |
|---|---|
| 可见会话（tabHidden 假/空） | 现行为不变：daemon attach 或重建 |
| 隐藏会话 + daemon 存活 | 恢复为休眠元数据；daemon 会话继续后台运行（对账保护）；重新打开时 attach |
| 隐藏会话 + daemon 不存在/查询失败 | 休眠元数据；重新打开时走重建（含 scrollback 贴回 / CLI resume） |
| 隐藏会话属于当前工作 pane 树 | 激活该 pane 会话时实体化；标签渲染仍按 tabHidden 过滤 |
| 隐藏会话为 remoteHandoff | 走既有 remoteHandoff 元数据恢复分支，不入休眠路径 |
| 隐藏会话为 ssh | 重建分支沿用 `resolvePtyLaunch`（ssh launch 已在现有路径内） |
| 隐藏会话为 CLI（claude/codex/pi） | 重建分支沿用 `detectCliResumeKind` / `buildCliResumeStartupCommand` |
| 恢复被用户拒绝（ask 模式） | 现有 clear 逻辑不变，无休眠状态残留 |
| 二次重启 | 休眠会话继续持久化，仍为休眠（幂等） |

## 数据结构（data structures first）

- **休眠 = 运行态派生，不新增持久化字段**。在 terminal store 增加运行态集合
  `dormantRestoredSessionIds: Set<string>`（不落盘）：restore 时隐藏会话 id 进入集合；
  实体化成功后移除。派生判定 `isDormant(session) = dormantRestoredSessionIds.has(id)`，
  避免引入"`tabHidden` 且无 PTY"这类脆弱推断（与"用户主动隐藏已有 PTY 的会话"无法区分）。
- 休眠会话对象 = 持久化元数据的浅拷贝（保留 `initialTerminalOutput`、`cliSessionId`、
  `providerSnapshot` 引用语义与现有恢复分支一致），`sessionStatuses[id] = "exited"`，
  不注册 status listener。

## 代码触点（发现清单）

| 触点 | 处理 | 说明 |
|---|---|---|
| `src/features/terminal/store/terminalStore.ts` `restoreSessions`（L1277-1650） | **改** | 隐藏会话走休眠分支；实体化逻辑抽为可复用函数 |
| 同上：重建分支（L1400-1590 内联体） | **抽** | 提取 `materializeRestoredSession(ps, ...)` 供 restore（仅可见）与 reopen（休眠）共用；daemon attach 分支同理复用 |
| `src/features/terminal/store/terminalTabLifecycle.ts` `reopenSession` / `showSessions` | **改** | 打开/批量显示前对休眠会话触发实体化（await 后再 setActive/unhide） |
| `src/features/terminal/types/terminalStoreTypes.ts` | **改** | `TerminalStore` 增加 `dormantRestoredSessionIds` 与（如需）`materializeSession` 动作 |
| `src/features/terminal/store/terminalRuntime.ts` `setActive` | **核对** | 确认所有"清 tabHidden"入口都收敛到 reopenSession/showSessions（现有注释已声明"Explicit navigation is the only path"），若有旁路一并挂实体化 |
| `src/features/terminal/lib/ptyOrphanReconcile.ts` + `terminalStore.ts:1812` | **核对** | 休眠 id 继续随 `hasBackendPty` 进入活跃列表；daemon 侧已有空列表保护测试 |
| `src/app/App.tsx` 恢复调用（L1176/L1221） | **核对** | 无需改：仍调用 `restoreSessions` |
| 恢复 toast（terminalStore.ts L1633-1640） | **改** | 仅统计实体化数量；休眠数量走补充文案 |
| `src/shared/i18n/messages/terminal.zh-CN.ts` / `.en-US.ts` | **改** | 新增休眠补充文案键（替换现有硬编码中文，顺手达标 i18n 规则） |
| `src/features/terminal/tests/terminalTabLifecycle.test.mjs`（L437-462 契约测试） | **改** | 改写为休眠语义：restore 不 create/attach；reopen 触发实体化 |
| `src/features/projects/lib/sidebarTerminals.ts` / 资源页 | **核对** | 只读入口，`openSidebarTerminal` → `reopenSession` 已收敛，无需改 |
| current work 激活链路（`useCurrentWorkSessionController`、`PaneLeafView` L261） | **核对** | 激活最终走 `setActive`/reopen 语义，确认实体化挂点覆盖 |

GitNexus impact 于实现阶段执行（`restoreSessions`、`reopenSession`、`setActive` 三个符号
upstream），本表为契约级发现清单。

## 权衡

- **为什么不跳过持久化**（方案 A"隐藏不参与恢复"）：会破坏 daemon 真后台续跑会话的
  归属与"隐藏后重启再打开"的既有契约，且丢弃用户刻意保留的后台终端。
- **为什么不立即恢复但不提示**（方案 C）：不解决旧隐藏终端每次重启重建进程的资源浪费，
  只掩盖观感。
- **休眠标记为何放运行态而非 session 字段**：持久化字段会引入旧快照迁移与同步
  （WebDAV/instance 切换）负担；休眠本质是"本次恢复周期内尚未实体化"，重启自然重算。

## 风险

- 实体化失败（项目已删除/路径无效）：reopen 时 toast 提示并保留休眠状态，不崩溃、
  不把会话从持久化中移除（与现有 skippedSessions 语义对齐）。
- `attachDaemonSession` 已有"从持久化 attach"的独立入口，实体化复用其状态监听注册，
  避免双份订阅。

## 验证计划

- `node --test src/features/terminal/tests/terminalTabLifecycle.test.mjs`（定向）
- 新增/改写用例：restore 休眠不 create；reopen attach；reopen 重建；toast 计数；二次重启幂等
- `npx tsc --noEmit`；交付前 `npm run check:architecture`
- 手动：隐藏一个终端 → 重启 → 确认无新 PTY、无可见标签 → 侧栏重开 → attach/重建正确；
  中英文切换确认新文案
