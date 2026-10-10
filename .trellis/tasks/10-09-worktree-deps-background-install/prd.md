# Worktree 依赖后台安装

用户已选方案：D. 后台任务安装 + 失败 Toast+重试。TEMP，未指定版本。

## Goal

新建 worktree 命中缺依赖时，不再弹窗确认、不新开终端 Tab、不留待手关的安装 Tab，
改为轻量后台任务自动安装，侧栏/Toast 显示进度，成功静默完成，失败 Toast 给原因+重试。

## 现状（根因一句话）

`maybePromptWorktreeDeps` → 弹窗 → `createSession(worktree.path, deps.command)` 新开 Tab 跑
`npm/pnpm/yarn install` / `cargo fetch`，装完 Tab 残留需手关；打断点 = 弹窗 × 1 + 新 Tab × 1 + 手关 × 1。

## Requirements

- [ ] 命中缺依赖（`checkDeps` → `needs_install`，复用现有 `git_worktree_check_deps` 命令）
  时自动起后台安装任务，不弹窗、不新开终端 Tab、不阻塞任务 Tab 使用。
- [ ] 安装中：worktree 行（侧栏对应位置）与 Toast 显示进行中状态；可取消（至少 Toast/行内取消其一）。
- [ ] 成功：Toast 提示完成，无残留 Tab/弹窗；`deps_prompt_dismissed` 置位，同一 worktree 不再触发。
- [ ] 失败：Toast 给失败原因 + “重试”按钮；重试重新触发同一后台任务；保留手动入口
  （现有终端 Tab 菜单“安装依赖”）可用。
- [ ] 总开关复用项目级 `worktree_deps_prompt_enabled`（关闭则不自动装；SSH 项目默认关闭保持不变）。
- [ ] 命令复用 `checkDeps` 返回的 `command`（npm/pnpm/yarn install、cargo fetch），不新增包管理器判断。
- [ ] 中英文案齐备（`projects.zh-CN/en-US`），时间格式不受语言切换影响（沿用现有 `useI18n`）。
- [ ] 安装任务与 worktree 删除/Finish 互斥：worktree 被删或开始 Finish 时取消后台任务，不留孤儿进程。

## Non-Goals

- 不改变 `checkDeps` 的缺依赖判定逻辑；不新增包管理器类型。
- 不做多 worktree 队列/并发调度（首版串行或单 worktree 单任务即可，design 定）。
- 不动 PTY/终端恢复主链路；后台任务独立通道，失败不影响任务 Tab。

## 场景枚举（对照 fix-triage-guide §5）

- 窗口焦点：聚焦本窗口 / 其他窗口 / 未聚焦——后台继续跑，Toast 正常弹出。
- 分屏：任务 Tab 在任意 Pane/Workspan——安装不占 Pane，任务 Tab 可正常用。
- 最小化/托盘：任务继续，恢复后状态一致。
- 侧栏形态：展开/收起/紧凑——进行中标识至少在 Toast 可见，侧栏行内标识尽力而为。
- 多会话：同项目多 worktree 各自任务独立，互不串扰。
- 运行环境：本地 PowerShell/CMD/pwsh 首版；WSL 尽力复用现有 session 创建环境；
  SSH 项目保持不自动装（现有开关为 0）。
- Worktree 状态：active 正常装；pending/missing 不启动；安装中 worktree 被删 → 取消任务。
- 包管理器：npm / pnpm / yarn install、cargo fetch 四种命令原样执行。
- 重复触发：同 worktree 安装中再次创建/打开 → 不起第二个任务（幂等）。
- 应用重启：重启前未完成的后台任务不恢复（首版），重启后 `deps_prompt_dismissed=0`
  且仍缺依赖 → 再次自动装（design 确认是否加退避）。

## Acceptance Criteria

- [ ] 新建 worktree 缺依赖：无弹窗、无新增终端 Tab，后台自动装；侧栏/Toast 可见进度。
- [ ] 成功：Toast 完成提示，无残留；同 worktree 不再触发。
- [ ] 失败：Toast 含原因 + 重试按钮，重试可再次执行；现有手动“安装依赖”入口仍可用。
- [ ] `worktree_deps_prompt_enabled=0` 的项目不自动装；SSH 项目行为不变。
- [ ] 安装中删除 worktree：任务取消，无孤儿进程/残留状态。
- [ ] 定向自动化测试 + `npx tsc --noEmit`（前端）/ 相关 Rust 检查通过；中英文案齐备。
- [ ] `CHANGELOG.md` + `docs/功能清单.md` 按 AGENTS.md 更新（TEMP）。

## Notes

- 发现清单（touchpoints，planning 阶段逐项勾销）：
  - `src/features/projects/hooks/useSidebarController.tsx`（maybePromptWorktreeDeps、
    handleInstallWorktreeDeps、createAndOpenWorktree/Split 调用点）——改动。
  - `src/features/projects/components/SidebarView.tsx`（deps 弹窗 Dialog）——移除/替换为进度 UI。
  - `src/features/terminal/hooks/useTerminalTabsController.tsx`（第二处安装入口）——复用后台任务。
  - `src/features/terminal/lib/webManagement.ts`（web 侧 check_deps/安装）——确认是否同步。
  - `src/features/projects/api/worktreeStore.ts`（checkDeps、dismissDepsPrompt）——复用。
  - `src-tauri/src/features/projects/worktree.rs`（check_dependency_need、
    git_worktree_check_deps）——确认无关（判定逻辑不动）。
  - 后台任务执行通道（新建：复用 PTY 隐藏会话 vs Rust 侧 `Command` 后台跑）——design 定。
  - 进度/取消/重试状态机（新建 store 或复用 terminalStore）——design 定。
  - i18n `projects.zh-CN/en-US`（worktree.deps.* 新增/调整）——改动。
  - 现有测试 `scripts/worktreeCreation.test.mjs`、`webManagement.creation.test.mjs` 等——同步更新。
- 与 C 选项的关系：本任务默认自动装（不再二次弹窗）；如评审要求保留确认，
  降级为“一键确认即后台装”，不回退到新开 Tab。
