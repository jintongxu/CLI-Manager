# 技术设计方案：侧栏伴随式 AI 对话面板

## 1. 架构定位与核心取舍

### 1.1 不重构 `ChatWorkspace.tsx`（1033 行）
`ChatWorkspace` 是已验收的全屏三栏视图。侧栏面板是窄栏（~380px）紧凑排版，布局逻辑差异大。重构现有文件回归风险高；改建独立的紧凑渲染器 `ChatPanel`，只复用底层纯函数与单例：
- `src/features/chat/lib/interactions.ts`（`shouldSubmit` / `isFollowing` / `chatTime` / `copyChatText` / `activateChatLink`）
- `src/shared/ui/MarkdownContent.tsx`
- `src/features/chat/api/lifecycle.ts` 的 `chatController`
- `src/features/chat/lib/chatProviderCatalog.ts` 异步读取后端目录

### 1.2 一个面板组件，两种宿主（学 Copilot Chat）
- **Dock 宿主**：作为 `TerminalSidePanel` 的 `chat` Tab 挂载，享受现有 `ResizableTerminalPanelFrame` 的拖拽、宽度持久化与 dock 侧向逻辑。
- **Float 宿主**：作为 `.ui-terminal-well` 内的 `absolute right-3 top-3 bottom-3 w-[380px] z-30` 卡片渲染，不触发工作区 DOM resize，保证终端与 pi agent 会话不重排。
- 两者由 `useChatPanelStore` 的 `mode` 与 `floatOpen` 驱动，点击 Pin 按钮进行迁移。
- 防御性规则：若用户关闭了合并侧边面板（`terminalSidePanelMerged = false`），dock 宿主不存在，此时一律退化为 float 模式。

### 1.3 `settingsStore.ts` 2000 行硬上限应对
- `settingsStore.ts` 在修改前为 **1997 行**，架构契约硬上限为 **2000 行**。
- 为 `TerminalToolbarVisibilitySettings` / `DEFAULTS` / `migrate` 各加 1 行，共 3 行，刚好到 2000 行。
- `terminalToolbarOrder` 数组修改既有行追加 `"chat"`，不新增行。
- `Alt+C` 快捷键因此**不作为**可配置项进入 `settingsStore`（否则需新增 3 行超限），而是采用硬编码组合键（在 `useKeyboardShortcuts.ts` 内实现，沿用 `Ctrl+Shift+W` 等硬编码先例），通过按钮 Tooltip 体现快捷键。

### 1.4 `useTerminalTabsController.tsx` 行数控制
- 原文件 1978 行，上限 2000 行。
- 提取 `src/features/terminal/lib/sidePanelTabs.ts` 负责 `selectVisibleSidePanelTabs` 逻辑，成功将 controller 控制在 **1992 行**，避免超限。

### 1.5 工作区选区快照（解耦且无对象泄漏）
- 新增 `src/shared/lib/workspaceSelection.ts`，仅保存 `{ sourceId, text }` 纯文本，超长按 8000 字符截断。
- 在 `useXTermController` 的 `captureTerminalSelection` 与 `nativeSelectionListener` 中旁路调用 `recordWorkspaceSelection`，覆盖 xterm（终端与 pi agent 均使用）和普通 DOM 划选。
- 输入框提交时主动调用 `clearWorkspaceSelection`，避免重复提示。

---

## 2. 状态机与数据流

```
[工具栏 Sparkles 按钮] ────┐
                          ├─► toggleChatPanel() ──► mode === "float" ? toggleFloat() : toggleDock()
[全局 Alt+C 快捷键] ──────┘

                    ┌──► [Dock 宿主 (TerminalSidePanel)]
[chatPanelStore] ───┤
                    └──► [Float 宿主 (absolute 卡片)]
                              ▲
                              │ 渲染同一个
                              ▼
                        <ChatPanel />
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
    [chatController (单例)]          [chat_provider_catalog_list (IPC)]
             │                                 │
     (SQLite: 消息/会话/草稿)            (模型/供应商列表)
```

---

## 3. 跨模块契约遵循

- `ChatPanel` 位于 `src/features/chat/api/ChatPanel.tsx`，作为窄公开入口供 `features/terminal` 引入。
- `dispatchChatPanelToggle` / `subscribeChatPanelToggle` 位于 `src/features/terminal/api/chatPanelCommands.ts`，作为公开入口供 `features/workspace` 的 `useKeyboardShortcuts` 引入。
- 严禁跨 feature 引入 internal 目录，通过 `npm run check:architecture` 自动校验。
