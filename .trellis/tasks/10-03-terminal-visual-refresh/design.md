# Design

## Direction

采用“Clear Focus 正文基线 + 主题驱动的 Terminal Chrome”：缺少显式设置键时使用 Clear Focus One Half Light 正文色、JetBrainsMono Nerd Font 优先字体和 16px 字号；浅灰蓝应用壳层、高对比浅色终端、深色命令字与蓝紫提示符优先保证 PowerShell 7 命令和输出清晰。新安装应用默认使用 Clear Focus 浅色 palette，右侧辅助栏默认使用 terminal skin；用户选择其他终端主题/应用 palette 后，ANSI 色与外壳仍由当前选择负责，外壳从 `--terminal-theme-*` 派生层级色。

## Visual Layers

1. **Content**：默认正文使用取自 Windows Terminal Acrylic 截图的蓝灰背景 `#2A373F`、One Half ANSI 色、16px 字号和 Nerd Font 优先字体栈。
2. **Frame**：终端 well 保持既有 margin、圆角与尺寸，增强极轻边界和环境阴影。
3. **Chrome**：标签栏使用低对比渐变，减少厚重卡片感；选中标签以柔和面层加底部强调线表示。
4. **Actions**：右侧操作按钮和侧栏按钮统一圆角、hover 与 active 表达。
5. **Overlays**：搜索、Markdown 预览、滚到底、字体控制和链接提示统一半透明面层与轻阴影。
6. **Split**：保持 34px 分屏 chrome 及现有几何，只提升焦点和分隔辨识。

## Constraints

- 不修改 React DOM、状态或事件处理。
- 不改变 xterm container padding、字体 metrics 或 FitAddon 可用区域。
- 不覆盖 `workspace-layout.css` 的背景图透明规则。
- 不使用 ANSI red/green 等颜色作为通用 UI 状态色。
- 动效遵守 `prefers-reduced-motion`。
