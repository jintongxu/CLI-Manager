# 设计：项目想法极简流、树展开丝滑度与SSH文件分屏联动

## 1. 项目想法去标题极简流
- **接口兼容**：`projectIdeaStore.createIdea(projectId, content, priority, tags, title)`，若 `title` 为空，自动根据 `content` 的第一行提纯（去除开头的 Markdown `#`、空白字符，截取最多 50 字符，若为空则降级为 "Untitled"）。
- **组件重构**：
  - `ProjectIdeasDialog`：顶部输入区移除 `newTitle` 输入框，仅保留 `newDraft` textarea。支持按 `Ctrl+Enter` / `Cmd+Enter` 保存。按钮仅在 `!newDraft.trim()` 时禁用。
  - `ProjectIdeasPanel`：工具栏同样仅保留一个输入框，移除单独的标题输入框。
  - 详情编辑区：如果用户需要精细编辑，允许编辑全部正文，首行自动同步给列表标题展示。

## 2. 侧边栏展开性能与过渡动画
- **全树渲染隔离**：
  - `useSidebarController` 中，将 `collapsedIds` 剥离或通过粒度化的订阅模式，使 `TreeNodeItem` 只感知自身及其直接子节点的折叠状态，避免顶层 `treeActions` 引用频繁更新穿透 `React.memo`。
  - 使用 React.memo 并为 `TreeNodeItem` 定制精准的 props 比较（例如仅当该节点的 `isOpen`、`isSelected`、`status` 变化时才触发渲染）。
- **平滑展开过渡**：
  - 在 CSS 中为 `.ui-worktree-children` 和 `.tree-collapse` 使用 CSS Grid `grid-template-rows: 0fr -> 1fr` 过渡技术，确保展开与收起高度平滑流动，不产生生硬跳变。

## 3. 当前工作 SSH 文件打开联动
- **分屏创建**：
  - 在 `FileExplorerSidebar` 或 `useTerminalTabsController` 中，当检测到处于 `currentWorkMode` 且来源为 SSH 会话时，若当前工作区尚未分屏，自动调用分屏逻辑将新创建/激活的编辑器放置在当前终端右侧（Horizontal Split）。
- **动态标签呈现**：
  - `CurrentWorkTabBar` 中，针对 `kind === "file-editor"` 的会话，通过从 `fileExplorerStore` 查询该项目当前激活的 `activeFilePath`，将标签展示文本从 `文件：${host.name}` 动态解析为 `${fileName} · ${host.name}`。
- **空状态自动退出**：
  - 在 `FileEditorPaneView` / `useFileEditorController` 的 `onCloseFiles` 逻辑中，当关闭文件后 `visibleFiles` 长度为 0 且处于当前工作时，自动触发 `requestClose` 关闭整个编辑器 Session。
