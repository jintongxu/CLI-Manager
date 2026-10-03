# 内嵌终端界面视觉美化

## Goal

在不导入 Windows Terminal 配置、不改变 PTY/xterm 行为的前提下，改善内嵌终端的视觉层次、焦点辨识与控件一致性。

## Requirements

- Changelog Target: `[TEMP]`
- 继续使用用户显式保存的终端主题、字体、字号和背景图；缺少对应设置键时采用新的 Windows Terminal 风格默认值。
- 参考现代 Windows Terminal 的克制层次：One Half Dark Acrylic 正文主题、JetBrainsMono Nerd Font 优先字体、16px 字号、低对比 chrome、清晰选中态、轻量边界和紧凑浮层。
- 统一普通标签栏、分屏标签栏、侧边操作栏、终端框架、搜索与滚动浮层。
- 深色、浅色、独立主题、背景图、工作区背景图均保持可读。
- 不修改 PTY、IPC、xterm 初始化、快捷键、输入法、鼠标、滚动、分屏几何或会话生命周期。
- 不新增设置项，不覆盖已有持久化选择。

## Scenario Matrix

- 单标签 / 多标签 / 标签溢出。
- 单窗格 / 横向分屏 / 纵向分屏 / 深层分屏。
- 深色终端主题 / 浅色终端主题。
- 无背景图 / 终端背景图 / 工作区铺满背景图。
- 普通窗口 / 全屏终端。
- 本地 PowerShell、CMD、Pwsh、WSL 与 SSH 会话共享同一视觉层，不改变运行环境。

## Acceptance Criteria

- [x] 缺少显式设置键时，终端正文使用 `Windows Terminal One Half Dark Acrylic`、16px 字号和 `JetBrainsMono Nerd Font` 优先字体栈。
- [x] 标签选中、悬停、关闭按钮和操作按钮层次清楚且命中区不缩小。
- [x] 分屏活动标签与窗格边界清晰，不改变 34px/42px 既有高度。
- [x] 搜索、Markdown 预览、滚到底、链接提示和右键菜单风格一致。
- [x] xterm 内容区域尺寸与 padding 不变，分屏与 resize 不发生行为回归。
- [x] 工作区背景透明契约保持有效。
- [x] 定向终端测试、TypeScript 检查和严格架构检查通过。
- [x] `CHANGELOG.md` 与 `docs/功能清单.md` 已更新。
