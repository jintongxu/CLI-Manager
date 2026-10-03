# Implementation Plan

1. 调整 `workspace-chrome.css` 的主题派生 chrome token、标签、操作区、终端 frame 与浅色适配。
2. 调整 `terminal-actions-panes.css` 的侧边操作栏、分屏标签和终端 well 层次。
3. 调整 `terminal-background.css` 的 xterm 内浮层控件与链接提示，不触碰透明背景实现。
4. 更新 `[TEMP]` CHANGELOG 与功能清单。
5. 运行定向终端测试、`npx tsc --noEmit` 和 `npm run check:architecture -- --strict`。
