# 实施记录：侧栏伴随式 AI 对话面板

## 1. 落地阶段回顾

| 阶段 | 任务 | 结果 | 关键产出 |
|---|---|---|---|
| T1 | 方案规划与 Trellis 任务建立 | 完成 | `10-31-sidebar-ai-chat`、PRD、Design |
| T2 | i18n 底座与设置项 | 完成 | `settingsStore.ts`（恰好 2000 行）、`SidebarSettingsPage.tsx`、中英字典共 42 键 |
| T3 | 工作区选区快照 | 完成 | `workspaceSelection.ts`（27 行）、`useXTermController.ts`（1981 行） |
| T4 | 状态 store 与纯函数 | 完成 | `chatPanelStore.ts`（39 行）、`chatPanelActions.ts`（25 行） |
| T5 | 紧凑 ChatPanel 组件集 | 完成 | `ChatPanel.tsx`、`Composer`、`Messages`、`ModelPicker`、`chatPanel.css`、`chatProviderCatalog.ts` |
| T6 | TerminalSidePanel 接入 | 完成 | `TerminalSidePanel.tsx` 新增 `"chat"` Tab、渲染位与图标 |
| T7 | useTerminalTabsController 接线 | 完成 | 抽出 `sidePanelTabs.ts`（21 行），controller 净增后压在 1992 行 |
| T8 | TerminalTabsView 双宿主 | 完成 | 传入 dock 内容、挂载 float 宿主卡片、防御未合并面板状态 |
| T9 | 工具栏 Sparkles 按钮 | 完成 | `useTerminalToolbarRenderer.tsx` 新增按钮与 Tooltip，联动 active 高亮 |
| T10 | 全局快捷键 Alt+C | 完成 | 抽出 `chatPanelCommands.ts`（11 行），`useKeyboardShortcuts.ts` 接入事件触发 |
| T11 | ⤢ 全屏流转 | 完成 | 一键调用 `usePrimarySpaceStore.setSpace("chat")`，同一 controller 续聊 |
| T12 | 交付记录与架构验证 | 完成 | `CHANGELOG.md`（TEMP）、`docs/功能清单.md`、`check.md` |

---

## 2. 代码物理行数核验

```text
src/shared/preferences/settingsStore.ts: 2000 行（硬上限 2000）
src/features/terminal/hooks/useTerminalTabsController.tsx: 1992 行（硬上限 2000）
src/features/terminal/hooks/useXTermController.ts: 1981 行（硬上限 2000）
src/features/chat/api/ChatPanel.tsx: 165 行
src/features/chat/components/ChatPanelComposer.tsx: 112 行
src/features/chat/components/ChatPanelMessages.tsx: 89 行
src/features/chat/components/ChatPanelModelPicker.tsx: 54 行
src/features/chat/components/chatPanel.css: 256 行
src/features/terminal/lib/sidePanelTabs.ts: 21 行
src/features/terminal/api/chatPanelCommands.ts: 11 行
src/features/terminal/store/chatPanelStore.ts: 39 行
src/shared/lib/workspaceSelection.ts: 27 行
```
所有文件均严格遵守单文件 ≤ 2000 行要求，子模块按单一职责控制在 20–260 行之间。
