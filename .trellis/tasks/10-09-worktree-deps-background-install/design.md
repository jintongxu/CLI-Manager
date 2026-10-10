# Design：Worktree 依赖后台安装

## 决策总览

- 执行通道：**复用 PTY 隐藏会话**，不新增 Rust 命令/进程管理。
  - `createSession` 扩展 `options.transientBackground`：创建即 `tabHidden: true`、
    跳过会话持久化（`persistCommittedLaunch` + `isPersistableSession` 排除），焦点不受影响
    （`resolveVisibleTerminalFocus` 本就过滤 `tabHidden`）。
  - 安装命令按 shell 追加链式 `exit`，让 PTY 退出码 = 安装退出码，复用现有
    `subscribeStatus` → `PtyStatusPayload.exit_code` 做成功/失败判定。
- 状态机：新建 `src/features/projects/api/worktreeDepsRunner.ts`（zustand store +
  `Map<worktreeId, { sessionId, command, startedAt }>`）， Single-flight/幂等、取消、重试入口。
- UI：删除 `SidebarView` 的 deps 确认 Dialog；进行中 Toast loading + 侧栏行内 spinner；
  成功 Toast + `dismissDepsPrompt`；失败 Toast（含原因 + 重试 action + 取消）。
- 手动入口（侧栏菜单 / Tab 右键 / web `worktree.installDeps` 的桌面部分）统一走 runner；
  web 远控 `worktree.installDeps` 保持现状（deploy 注释，implement 阶段确认是否顺手统一）。

## 通道选型（已否决项）

- Rust 侧 `silent_command` + 新 Tauri 命令：需新增命令、前后端事件、进程跟踪/kill、
  各 shell 语法差异处理，跨 Rust+IPC+前端三层，否决。
- 可见安装 Tab 成功后自动关（选项 B）：简单但仍有 Tab 闪现 + 焦点抢占，体验不如隐藏会话，否决。
- OSC 133 `D;exit` 标记感知完成：powershell/bash 有集成，但 cmd 恒无 exit code，
  且需新增输出监听解析，不如链式 `exit` 直接拿 PTY `exit_code`，否决。

## 链式退出命令（shell 拼接规则）

输入均为简单命令（`npm/pnpm/yarn install`、`cargo fetch`，无 shell 元字符），按
`normalizeShellKey` 拼接：

| shellKey | 启动命令 |
|---|---|
| powershell / pwsh | `<cmd>; exit $LASTEXITCODE` |
| cmd | `<cmd> && exit 0 \|\| exit 1`（退出码只保真成功/失败，不保真具体码） |
| bash / gitbash / wsl / sh / zsh | `<cmd>; exit $?` |
| fish | `<cmd>; exit $status` |
| 未知/未归一化 | `<cmd>; exit $?`（sh 兼容兜底） |

成功判定：`status === "exited" && exit_code === 0`。`status === "error"` 或非零 → 失败。
说明：cmd 下只能区分成功/失败，Toast 文案只展示“失败”，不展示具体退出码，避免误导。

## 状态机（worktreeDepsRunner）

```text
idle →(start)→ running →(exited 0)→ done → auto closeSession(id, true) + dismissDepsPrompt + 成功Toast
                 running →(exited≠0/error)→ failed → 失败Toast[重试][关闭]（会话保留？见下）
                 running →(cancel/删树)→ cancelled → closeSession(id, true) + 取消Toast/静默
```

- 失败会话处理：失败后自动 `closeSession(id, true)` 回收隐藏 PTY（日志已落盘到后端），
  用户点“重试”重新起一个。全程无可见 Tab，符合“零打断”目标。
- 幂等：`start` 前查 map，同 worktree running 中直接返回；`maybePrompt` 的
  `depsPromptingWorktreeIdsRef` 废弃，由 runner map 接管。
- `dismissDepsPrompt` 时机：与现状一致，**启动时**置位（用户意图=处理过）。
  失败后重开 worktree 不再自动触发，靠失败 Toast 的重试 + 手动菜单入口。
- 删除/Finish 互斥：`removeWorktree` 内已有“关闭同 worktree 全会话”逻辑
  （按 `worktreeId` 过滤，transient 会话同样被关），runner 额外订阅 store `sessions`
  移除做 map 清理；`withFinishLock` 路径在 implement 阶段确认是否需要显式 `cancel`。

## 改动清单（文件级）

1. `src/shared/types/index.ts` — `TerminalSession` 加 `transientBackground?: boolean`；
   `terminalStoreTypes.ts` — `createSession` options 加 `transientBackground?: boolean`
  （或复用 `sessionKind` 联合类型扩展，implement 阶段选其一；推荐独立 boolean，
   与 `ephemeral-pi` 语义正交）。
2. `src/features/terminal/store/terminalStore.ts` — `createSession`：
   `tabHidden: true`（transient 时）、跳过 `persistCommittedLaunch`。
3. `src/features/terminal/api/sessionStore.ts` — `isPersistableSession` 排除
   `transientBackground`，重启不恢复、记忆中不留痕。
4. 新建 `src/features/projects/api/worktreeDepsRunner.ts` — store + start/cancel/
   retry + shell 拼接纯函数（可单测）+ 状态订阅。
5. `src/features/projects/hooks/useSidebarController.tsx` —
   `maybePromptWorktreeDeps` 改调 runner（删 Dialog 相关 state 传递），
   `handleInstallWorktreeDeps` 改调 runner（手动入口同样后台化），
   删 `depsPrompt` state（`setDepsPrompt` 保留与否看 SidebarView 清理面）。
6. `src/features/projects/components/SidebarView.tsx` — 删除 deps Dialog；
   worktree 行加 running spinner（订阅 runner store）；菜单项保留。
7. `src/features/terminal/hooks/useTerminalTabsController.tsx` —
   `handleInstallWorktreeDeps` 改调 runner。
8. i18n `projects.zh-CN/en-US` — 新增 `worktree.deps.installing/progress/done/
   failed/retry/cancel`，复用 `installTitle` 做隐藏会话标题，复用
   `notNeeded/checkFailed`。
9. `src/features/projects/api/worktreeStore.ts` — `removeWorktree` 首行加
   `runner.cancel`（即使已有会话关闭逻辑，map 清理明确化）；`checkDeps` 不动。
10. PaneTabBar/可见性：implement 阶段实测确认 `tabHidden` 会话不渲染 Tab、不抢焦点
    （`visibleTerminalSessionIds` 已过滤，属预期；若有漏网处随手补）。

## 风险与回退

- 某 shell 链式语法水土不服 → 该 shell 回退为可见 Tab 安装（白名单制，默认全后台）。
- `exit_code` 为 null（`Ok(None)` 罕见路径）→ 按失败处理并提示“状态未知，可重试”。
- 重启前 running 的任务不恢复（transient 不持久化，先天保证）。
- 回退总开关：复用项目级 `worktree_deps_prompt_enabled=0` 即关闭自动装。

## 测试计划

- 新 `scripts/worktreeDepsRunner.test.mjs`：拼接规则全 shell 矩阵、幂等、
  成功/失败/取消状态流转（mock terminal store + toast + invoke）。
- 现有 `terminalCreationContext.test.mjs` 中 `worktree.deps.installTitle` 断言保持通过
  （标题复用）；SidebarView Dialog 删除若有快照类断言则同步更新。
- `npx tsc --noEmit` + `npm run check:architecture`（新文件位置/行数合规）。
- 人工：新建 worktree 缺依赖 → 无弹窗无新 Tab → Toast 进度 → 成功/失败；
  中英切换；安装中删除 worktree。
