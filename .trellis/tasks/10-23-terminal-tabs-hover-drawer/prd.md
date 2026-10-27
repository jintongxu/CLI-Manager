# 终端标签栏与浮动抽屉导航

## Goal

标签栏按当前集合直接展示终端；悬停意图+点击钉住的浮动抽屉承载完整列表/分组/搜索/管理；取代范围下拉+快捷区+查找+管理四件套；TEMP。

## Requirements

- 顶部一排真实终端标签，标签与抽屉使用同一 entries 集合和 totalCount；支持项目色、状态、标题省略、平滑横向滚动及当前标签自动可见。
- 抽屉使用 350ms hover-intent、点击钉住、Escape/外部关闭和键盘可达；标签栏隐藏时强制关闭并抑制打开。
- 抽屉按项目/独立会话分组，支持本地搜索、切换、普通视图显式加入当前工作、当前工作移出、匿名 Pi 移出并关闭、多选和排序提示。
- 普通视图不显示移出/批量成员 mutation；添加候选不显示关闭、固定或旧会话菜单。
- 保留关闭确认、未保存保护、分屏 pane 操作、PTY/body 挂载身份、匿名 Pi 生命周期和既有平滑滚轮。
- 使用 `current-work-tab:` 与 `current-work-order:` 命名空间防止 DnD 重复 ID；ordering-only 不显示移除按钮；局部 pane tab guard 保留 workspan/visible-session 条件。
- 中英文键同步，不新增依赖、Rust/IPC/DB/持久化协议或全局快捷键。

## Acceptance Criteria

- [x] 真实标签行、抽屉、模型分组和 hover/pin 状态机已实现。
- [x] 普通/当前工作成员边界、匿名 Pi 移除语义、关闭锚点和异步竞态已修正。
- [x] 定向导航/生命周期/滚轮/分屏测试 95 项通过。
- [x] TypeScript、strict architecture、diff check 通过。
- [ ] 真实 WebView 的悬停手感、触屏路径、中英文切换及实际鼠标 DnD 仍需人工验收；本轮未启动开发版。
