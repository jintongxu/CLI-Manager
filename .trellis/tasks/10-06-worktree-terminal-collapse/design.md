# 技术设计

TreeContext新增worktreeTerminalsCollapseId(id)，命名空间worktree-terminals:<id>，复用collapsedIds/toggleCollapsed及既有保存行为，不增加持久化协议。TreeNodeItemImpl的worktree行和SidebarProjectTerminals的快捷入口根据getTerminals数量显示共享小按钮（独立终端列表折叠，不复用project-worktrees key），按同key显示SidebarTerminalList。按钮阻止事件冒泡与右键/双击干扰，ARIA与中英文文案同步。保留Worktree图标，默认展开，forceExpanded不取消显式终端折叠。

边界：项目components/TreeContext、领域翻译和聚焦tests；不改terminal lifecycle/PTY/IPC/依赖/主仓库终端列表。新增/删除终端由现有sessions订阅驱动。保持2000行上限与前序dirty工作区。

GitNexus不存在，无法确认图风险；按契约与精确调用点审计，不将未知当低风险。场景覆盖有无/隐藏终端、多Worktree独立、展开/紧凑/窄栏/置顶入口、keyboard/双击冒泡、项目列表折叠隔离；环境/focus/分屏/恢复流程不调用不修改。
