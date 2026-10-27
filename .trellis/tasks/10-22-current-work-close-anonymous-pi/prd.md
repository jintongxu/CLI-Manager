# 匿名 Pi 移出当前工作时关闭

## 需求与根因
匿名 Pi 通过 kind=ephemeral-pi 明确标识；当前工作 removeSessions 只更新成员关系，导致移除后匿名会话及进程仍保留。应在统一的显式成员移除入口复用 terminalStore.closeSession，而非在 UI 标签或通用关闭层按标题判断。

## 发现清单
- useCurrentWorkSessionController.removeSessions：单个移除、toggle移出、选中批量清理/全部清理共用入口，需要修改。
- CurrentWorkTabBar / TerminalTabsView / 键盘当前工作操作：复用同一入口，无需修改。
- anonymousPiSession：创建设置kind=ephemeral-pi，确认仅按此标记判断，普通Pi/项目/Worktree/SSH不扩大关闭范围。
- terminalStore.closeSession：真实删除会话、清理Workspan和监听、关闭PTY并持久化；复用，不修改。
- reconciliation/updateMembership/切换视图/退出当前工作：不触发显式移除，不关闭会话。
- GitNexus入口缺失，使用现有契约与定向源码搜索降级，图风险无法确认。

## 场景及验收
- 匿名Pi在当前工作中单个移除、toggle移出、批量移除、全部清理时关闭一次。
- 混合列表仅关闭实际移除的ephemeral-pi；未移除、非成员、重复ID、失效ID不误关。
- 普通终端/绑定项目Pi/Worktree/SSH/文件编辑器只移出，不关闭。
- 当前/其他分屏、激活/非激活会话共用成员入口，正常重建布局和回落激活项。
- 退出当前工作、切换视图、恢复持久化成员和重排不关闭。
- 无新增可见文案，沿用TEMP变更记录；不修改现有2016行控制器。
- 定向执行控制器回归、现有当前工作模型测试、tsc；独立架构检查并报告基线超限。
