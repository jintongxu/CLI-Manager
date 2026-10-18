# PRD：关闭其它终端

## 目标

在“当前工作”终端栏增加一个按钮，点击后关闭除当前工作终端集合外的所有已打开终端。当前工作中的所有终端（包括分屏中的终端）必须保留；没有当前工作终端时按钮不可用或不显示。关闭行为复用现有终端关闭确认、未保存文件保护和 PTY 生命周期，不得只移除标签或只清理当前工作成员关系。

版本记录：`TEMP`。

## 验收标准

1. 当前工作模式下显示“关闭其它终端”按钮；按钮含中英文可访问名称、title，当前工作为空或不存在其它终端时禁用。
2. 点击按钮关闭所有不属于当前工作集合的已打开会话；当前工作集合的全部会话保持打开，当前活动会话不被关闭。
3. 关闭范围覆盖普通终端、不同项目/Worktree、不同 Workspan、分屏、隐藏终端和可关闭的编辑/辅助会话；不误删后台 daemon 中未恢复的任务记录，也不把“清空当前工作”误当作关闭终端。
4. 批量关闭遵循现有终端关闭确认及编辑器未保存文件确认；取消确认时所有目标保持打开。
5. 每个关闭目标都经过现有会话关闭链路，PTY/SSH/子代理订阅、Workspan 布局、持久化会话和当前工作持久化状态保持一致；关闭失败记录现有错误日志并继续处理其它目标。
6. 普通全部终端视图和当前工作视图切换后，按钮状态与实际会话列表一致；分屏/Worktree/范围过滤/隐藏状态不改变“保留当前工作集合”的判定。
7. 已隐藏但仍存活的普通终端不作为可关闭目标，避免重复隐藏无效操作；分屏紧凑当前工作栏仍提供该按钮。
8. `zh-CN` 与 `en-US` 文案同步，`npx tsc --noEmit` 通过。
9. `CHANGELOG.md` 使用 `TEMP` 版本记录，`docs/功能清单.md` 在终端/工作区功能板块记录该能力。

## 场景矩阵

- 当前工作：空 / 单终端 / 多终端 / 分屏多终端。
- 其它会话：同项目、其它项目、其它 Worktree、其它 Workspan、隐藏会话。
- 运行环境：本地 PowerShell/CMD/pwsh/Git Bash/WSL、SSH（沿用既有关闭行为）。
- 会话类型：普通 PTY、文件编辑器/辅助会话、后台 daemon 未恢复记录（不得误删记录）。
- 焦点与呈现：当前工作视图、全部终端视图、窗口失焦/重新聚焦、紧凑分屏布局。
- 保护流程：无未保存文件、存在未保存编辑器文件、用户取消确认、部分目标关闭失败。

## 已确认触点

- `src/features/terminal/components/CurrentWorkTabBar.tsx`：当前工作栏按钮布局及 props。
- `src/features/terminal/components/TerminalTabsView.tsx`：当前工作栏渲染和控制器回调接线。
- `src/features/terminal/hooks/useTerminalTabsController.tsx`：现有批量关闭、确认、未保存文件保护和关闭目标计算。
- `src/features/terminal/hooks/useCurrentWorkSessionController.ts`：当前工作成员集合和分屏树维护。
- `src/features/terminal/store/terminalStore.ts`：单会话关闭、PTY/持久化/Workspan 清理。
- `src/features/terminal/api/TerminalProcessManager.ts`、`PtyHostSocket.ts`：PTY close 生命周期；不新增协议。
- `src/shared/i18n/messages/terminal.zh-CN.ts`、`terminal.en-US.ts`：中英文文案。
- `CHANGELOG.md`、`docs/功能清单.md`：交付记录。

GitNexus CLI 在当前 worktree 中缺少 `.gitnexus/run.cjs`，因此影响分析降级为 `.trellis` 契约与代码交叉检索；未发现需要修改 Rust IPC 契约的触点。
