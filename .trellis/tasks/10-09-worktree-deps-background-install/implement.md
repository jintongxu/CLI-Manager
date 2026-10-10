# Implement：Worktree 依赖后台安装

依据 design.md。顺序执行，每步可独立验证；S1 落地后即有完整行为，S2/S3 为收尾。

## S1 — 后台通道 + runner 核心

1. `src/shared/types/index.ts`：`TerminalSession` 加 `transientBackground?: boolean`
  （注释：后台任务会话，不持久化、不展示）。
2. `src/features/terminal/types/terminalStoreTypes.ts`：`createSession` options
   加 `transientBackground?: boolean`；`SessionKind` 若为联合类型则同步扩展注释。
3. `src/features/terminal/store/terminalStore.ts`（`createSession` 内）：
   - session 对象加 `...(transient ? { transientBackground: true, tabHidden: true } : {})`。
   - `if (sessionKind !== "ephemeral-pi")` 改为同时排除 transient，跳过
     `persistCommittedLaunch`。
   - 其余布局/订阅逻辑不动（`buildWorkspanMirror` + `resolveVisibleTerminalFocus`
     已过滤 `tabHidden`，新会话不抢焦点——实现后以人工验证为准）。
4. `src/features/terminal/api/sessionStore.ts`：`isPersistableSession` 排除
   `transientBackground`。
5. 新建 `src/features/projects/api/worktreeDepsRunner.ts`（目标 <400 行）：
   - `buildDepsInstallCommand(command, shellKey)` 纯函数（powershell/pwsh/cmd/
     bash系/fish/兜底，见 design 矩阵）——导出供单测。
   - zustand store：`tasks: Record<worktreeId, { sessionId, command, startedAt }>`,
     `start(project, worktree)`（single-flight：查 map + `checkDeps` →
     `dismissDepsPrompt` → `buildProjectSplitOptions` 取 env/shell →
     `createSession(..., transientBackground: true)` → 写 map → loading Toast）、
     `cancel(worktreeId)`（`closeSession(id, true)` + 删 map）、
     `retry(project, worktree)`（= start，map 中已有 running 则直接返回）、
     `onStatus(sessionId, payload)`（exited 0 → 成功 Toast + `closeSession(id, true)` +
     删 map；失败 → 失败 Toast[重试][关闭] + `closeSession(id, true)` + 删 map）。
   - 状态订阅：`terminalProcessManager.subscribeStatus` 在 start 后订阅，
     结束/取消时 unlisten。`exit_code === null` 按失败处理（“状态未知”）。
   - 失败保留的会话必须被 `closeSession(id, true)` 回收（零残留）。
   - 与 `removeWorktree` 的互斥：订阅 `useTerminalStore` sessions，
     同 worktree 会话消失即清 map（删除/Finish 路径已有会话关闭，runner 只清状态）。

## S2 — 调用点切换 + Dialog 删除

6. `useSidebarController.tsx`：
   - `maybePromptWorktreeDeps`：删 `checkDeps`/`setDepsPrompt`/`depsPromptingWorktreeIdsRef`
     逻辑，改为 `void runner.start(project, worktree)`（保留开关 + dismissed 前置判断）。
   - `handleInstallWorktreeDeps`（手动菜单）：`checkDeps` 后 `needsInstall` 走
     `runner.start`，`notNeeded` Toast 保留。
   - 删除 `depsPrompt` state、`depsPromptingWorktreeIdsRef`、返回对象对应字段。
7. `SidebarView.tsx`：删除 deps Dialog（约 1047–1095 行）及 props
   （`depsPrompt/setDepsPrompt/dismissWorktreeDepsPrompt/depsPromptingWorktreeIdsRef`）；
   worktree 行订阅 runner store，running 中显示 spinner（位置：worktree 行尾状态区，
   不挤占名称；具体 class 参照现有 pending/missing 样式）。
8. `useTerminalTabsController.tsx`：`handleInstallWorktreeDeps` 改调 runner
  （与 S2-6 同语义，注意其 `groups` 参数传入 `buildProjectSplitOptions` —— runner
   内部统一处理，调用方只传 project/worktree）。
9. `worktreeStore.ts`：`removeWorktree` 首行加 `runner.cancelByWorktree(worktree.id)`
   （幂等，无任务则空操作）；`checkDeps`/`dismissDepsPrompt` 不动。

## S3 — 文案/测试/收尾

10. i18n：`projects.zh-CN/en-US` 新增
    `worktree.deps.installing`（后台安装中：{name}…）、`worktree.deps.done`
    （依赖安装完成：{name}）、`worktree.deps.failed`（依赖安装失败：{reason}）、
    `worktree.deps.retry`（重试）、`worktree.deps.cancel`（取消）、
    `worktree.deps.unknownStatus`（安装状态未知）；`title/description/install/skip`
    旧键删除（确认无他处引用：`rg worktree.deps` 全仓扫）。
11. 新 `scripts/worktreeDepsRunner.test.mjs`：拼接矩阵（powershell/pwsh/cmd/
    bash/gitbash/wsl/sh/zsh/fish/unknown × npm/cargo 命令）、single-flight、
    成功/失败/null-code/取消流转（mock terminal store + toast + invoke，
    参照 `worktreeCreation.test.mjs` 的 vm harness 写法）。
12. 现有测试：`terminalCreationContext.test.mjs` 的 `installTitle` 断言保留通过；
    若 SidebarView 相关测试引用已删 props/Dialog 则同步更新；
    `webManagement.ts` 的桌面 `worktree.installDeps`（432 行）改调 runner，
    其 `creation.test.mjs` mock 同步。
13. 验证：`npx tsc --noEmit`、`npm run check:architecture`（新文件 <2000 行、
    位置合规）、新测试 + 关联旧测试全过。
14. `CHANGELOG.md`（TEMP）+ `docs/功能清单.md`（worktree 板块）更新。
15. 人工验收（implement 不代劳，列出）：新建缺依赖 worktree 全程无弹窗无新 Tab；
    成功/失败 Toast；重试；中英切换；安装中删除 worktree；重启无残留。

## 不做

- `check_dependency_need` 判定逻辑、命令种类：不动。
- SSH 自动装：不动（开关默认 0）。
- web 远控链路除桌面 `worktree.installDeps` 外：不动。
- 多任务队列/并发调度：单 worktree 单任务 + single-flight 足够。
