# 实施计划

> 状态（2026-11-04）：Step 1–5 已全部实施并验证。

## 实施结果

- Step 1：`dormantRestoredSessionIds` 运行态集合已加入 `TerminalStore`（不落盘）。
- Step 2：`terminalStore.ts` restore 循环增加休眠分支（跳过 attach/重建）；实体化逻辑
  落在新模块 `terminalDormantRestore.ts`（daemon attach / 重建两路，含 scrollback 贴回
  与 CLI resume、布局 id 替换、currentWork 替换、失败保休眠）。
- Step 3：`setActive` 挂点（休眠先实体化再激活）、`showSessions` 批量实体化、
  `closeSession` 清理休眠标记。
- Step 4：新增 i18n 键 `terminal.restore.success` / `terminal.restore.dormantNotice` /
  `terminal.dormant.reopenFailed`（zh + en），恢复提示改为统计实体化数量。
- Step 5：契约测试改写 + 新增 4 例（可见实体化 / 休眠惰性，× daemon 两路）；fixture
  补 `listOwnedDaemonSessions`（修复了原 daemon 契约测试在基线即失败的问题）。

## 验证记录

- `npx tsc --noEmit` 通过。
- `terminalTabLifecycle` 80 pass / 4 fail（4 例为 HEAD 既有失败：render 契约、
  daemon task-state、create/split 磁盘失败两例，与本次改动无关）。
- `terminalResourceNavigation` 11/1（与基线一致，唯一失败为既有 showProjectSpace 缺依赖）；
  `terminalPortalVisibility` 4/0；`terminalClosePresentation` 4/0；`exitTransaction` 9/0；
  `sidebarTerminals` 26/3（基线一致）；`sidebarOrdering` 11/0。
- `npm run check:architecture -- --strict` 零超限。
- 待人工验收：真实应用重启后隐藏终端不产生 PTY、重开实体化、双语提示切换。

## 后续优化（同任务完成）

1. **daemon 归属自愈**（`owner_exit.rs` 新测试 + `ownership.rs` BindOwner 修复）：
   退出事务中途断连留下的 `exits` 栅栏，在同 instance 持有效 token 重绑且无其它
   存活连接时自动清除（inflight=0、非 draining 才生效）；进行中的退出不受影响。
   `cargo test --lib daemon::server` 40 pass。
2. **休眠会话跳过 terminal_colors**（`useXTermController.ts`）：dormant 时不发颜色
   写入，实体化后由 `isDormantSession` 依赖翻转自动补发。

真机验证（2026-11-04 20:55 轮）：上一轮放弃退出再次毒化 daemon 后，本轮重启零写入
失败、零恢复失败（修复前同场景弹大量 toast），首屏 90ms / boot 1.5s。


## Step 1 — 类型与运行态
- `terminalStoreTypes.ts`：`TerminalStore` 增加 `dormantRestoredSessionIds: Set<string>`；
  如实体化需暴露动作则加 `materializeSession(id)`。
- 初始值 `new Set()`，`restoreSessions` 与实体化动作维护该集合。

## Step 2 — 恢复路径拆分
- 从 `restoreSessions` 内联循环中提取 `materializeRestoredSession`（重建分支）并复用
  daemon attach 分支（或直接调用既有 `attachDaemonSession`）。
- restore 循环：`ps.tabHidden` 且非 remoteHandoff → 走休眠分支：
  - `restoredSessions.push(休眠元数据)`；`restoredStatuses[id] = "exited"`；
  - `dormantRestoredSessionIds.add(id)`；不 create / 不 subscribe / 不写启动命令；
  - `newIdMap[ps.id] = ps.id`（保持 workspans/currentWork 映射稳定）。
- toast：数量改为实体化数；休眠数 > 0 时补充 i18n 文案。

## Step 3 — 实体化挂点
- `reopenSession(id)`：若 id ∈ dormantRestoredSessionIds → 先 `await materializeSession(id)`
  再 `setActive`；失败 toast 并保持休眠。
- `showSessions(ids)`：对其中休眠会话逐一实体化（失败跳过该会话）。
- 核对 current work 激活与 `setActive` 旁路，确保无"未实体化即激活"路径。

## Step 4 — i18n
- `terminal.zh-CN.ts` / `terminal.en-US.ts` 新增键（补充文案 + reopen 失败提示），
  替换 restore toast 的硬编码中文。

## Step 5 — 测试与验收
- 改写 `terminalTabLifecycle.test.mjs` 契约测试 + 新增休眠用例（见 design 验证计划）。
- `npx tsc --noEmit`；`npm run check:architecture`。
- 手动双语言验证 + 真机重启恢复路径。
- 更新 `CHANGELOG.md`（版本待询问用户，未指定则 TEMP）与 `docs/功能清单.md`。
