# 设计规格：当前工作模式下 SSH 远程文件编辑分屏与标签自愈联动

## 1. 架构触点
- 分屏触发：`src/features/terminal/hooks/useCurrentWorkSessionController.ts`
  - 监听 `CURRENT_WORK_SESSION_CREATED_EVENT`，当 `currentWorkMode` 为 true 且新增会话为 SSH 文件编辑器时：
  - 判断当前激活窗口是否为 SSH 终端，若是，执行 `splitSessionToEdge(sessionId, targetPaneId, "right")`。
- 顶栏标签自愈展示：`src/features/terminal/components/CurrentWorkTabBar.tsx`
  - 订阅 `useFileExplorerStore`，当会话为 `file-editor` 时：
  - 图标：使用 `FileText` 替代终端图标；
  - 标题：显示当前打开的实际文件名 `activeFile.name`，若 `content !== savedContent` 则附加 ` *` 脏标记；
  - 上下文：若项目为 SSH 环境，呈现 `SSH: <主机名>` 标识。
- 空面板自愈清理：`src/features/files/hooks/useFileEditorController.ts`
  - 在 `closeFiles` 以及确认保存/放弃修改流程中，计算剩余打开文件数；
  - 若剩余文件数为 0 且无 Diff 标签，自动调用 `onClose()` 销毁编辑器会话，分屏自动折叠并归还焦点给终端。
