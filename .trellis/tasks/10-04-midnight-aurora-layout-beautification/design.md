# Design：已实施

## 实施方向
1. 统一工作区的外层 inset、圆角和深度，不改 DOM 结构与布局算法。
2. 将项目侧栏、工作区栏、终端 pane chrome、右侧面板统一到 Midnight Aurora 的 surface token。
3. 用低对比边界、局部 Aurora 光晕、底部/内侧细线替代大面积高亮。
4. 保留 Pi Agent 底部 20px breathing room，并确保绝对定位终端内容按当前 pane wrapper 正确收缩。
5. 通过作用域选择器限制 Midnight Aurora 改动，避免 Terminal Acrylic/浅色主题泄漏。

## 实施结果
- 使用现有 DOM/data 属性和 Midnight Aurora 作用域 CSS 完成，无新增布局组件。
- 外层工作区使用 10px inset/gap，main/sidebar 使用 16px 圆角和分层阴影；全屏模式恢复无 inset。
- terminal chrome 统一 44px，Tab 统一 30px，terminal well 与辅助 panel 统一边界。
- 项目树、空状态和按钮采用低注意力交互语言。
- 保留 Pi Agent 20px 底部 breathing room。
- 未新增截图基线；使用现有定向布局/主题测试与源码视觉检查。
