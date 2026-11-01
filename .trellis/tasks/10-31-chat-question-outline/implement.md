# 实施：问题大纲

1. 复核 ChatWorkspace 消息/滚动链、现有样式、双语字典与组件测试；保留已存在工作区改动。对没有 GitNexus 的 worktree，采用 frontend 架构契约与符号搜索确认触点。
2. 从当前会话用户消息派生大纲，加入右侧阅读栏与窄窗口展开控件；点击定位、手动滚动活动态、会话切换清理、长内容摘要与双语可访问性。
3. 加入定向测试：列表/长问题/空态/切换会话/点击跳转/滚动活动态；运行定向测试、`npx tsc --noEmit`、`npm run check:architecture`（现有超限需单列），`git diff --check`。代码变更同步 TEMP `CHANGELOG.md` 与 `docs/功能清单.md`。

不修改数据库、后端请求协议、其它 workspace，未经请求不提交或推送。