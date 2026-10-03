# Research

## 已确认的代码触点
- `src/styles/components/workspace-chrome.css`：工作区、主区、项目侧栏、搜索框、Tab 与终端 chrome。
- `src/styles/components/terminal-actions-panes.css`：右侧 action rail、辅助面板、pane chrome、terminal well。
- `src/styles/workspace-layout.css`：工作区背景层、透明覆盖、左右停靠边界。
- `src/styles/components/terminal-empty-tabs.css`：空状态、选中 Tab 基础样式。
- `src/features/terminal/components/PaneLeafView.tsx`：Pane wrapper 与 Pi Agent 20px 底部留白标记。
- `src/features/terminal/components/PaneTabBar.tsx` / `SortableTerminalTabs.tsx`：终端 Tab 结构与选中态属性。
- `src/shared/lib/terminalThemes.ts` / `src/styles/themes.css`：Midnight Aurora 终端与应用 palette。

## 当前视觉约束
- Midnight Aurora：`#0B1220`、`#111C2D`、`#17243A`，青蓝 `#66D9EF`，紫 `#A78BFA`。
- 主按钮已改为低注意力描边样式；Pi Agent `brightBlack` 已提亮；Pi Agent 底部留白为 20px。
- 当前工作区存在历史未提交改动，实施时必须保留并避免覆盖无关内容。
