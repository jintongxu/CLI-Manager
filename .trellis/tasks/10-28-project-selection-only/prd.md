# 项目行选择不导航（TEMP）

用户授权继续：左侧项目行仅选中/展开，不打开或切换终端/Worktree；只有显式终端或Worktree点击才导航。显式新建/打开终端按钮保持原样。不改变分组行为。

根因：useSidebarController 的 handleSelectProject/handleSelectProjectByKeyboard 将 sidebar selection 与 onTerminalScopeChange/activateFirstProjectSession/closeHistory 耦合，选择项目会过滤并激活已有终端（含Worktree会话）。需要在选择入口解除副作用，不在终端界面兜底。

触点：TreeNodeItem、ProjectTree 主/浮层项目行、PinnedProjectSection 共享上述回调；ProjectTree Enter 的 onOpenProject 是显式打开，Space选择走键盘回调；SidebarTerminalList 的 openSidebarTerminal、handleSelectWorktree 仍保持导航。检查选中状态相关 effects 无反向页面导航。

场景：鼠标普通/Ctrl/Cmd/Shift、键盘选择、置顶/折叠浮层/标准/紧凑侧栏；当前工作/普通页面、当前已有终端/Worktree/历史/Git页面应保持。显式终端/Worktree与新建按钮仍按原语义。保留现有dirty主题/侧栏与终端关闭改动。

GitNexus impact尝试失败（缺少.gitnexus/run.cjs），按fix-triage允许的契约与符号搜索降级，不把未知当低风险。分支无upstream，不做同步。

验收：执行实际生产回调测试确认所有选择分支不改scope、不激活会话、不关闭历史、不创建；多选保持；相关显式操作回归不变。tsc、架构普通/strict及定向测试。更新CHANGELOG TEMP/docs功能清单，既有运行dev可HMR但不冒充真机验收。无新增可见文案无需新翻译。
