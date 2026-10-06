# 设计

## 边界与根因
terminalStore.closeSession 当前将呈现关闭与记录、布局、PTY 删除绑定，须在状态层分离 hide/reopen 与 destructive close。

## 数据与流程
- TerminalSession 增加可选 tabHidden，旧数据缺省可见。sessionStore 保留整个对象，restoreSessions daemon/recreate 分支复制字段，遵循 workspace-session-restore-contracts。
- hide/reopen 保留 backing pane/workspan 树和 session identity，只推导 scope×!tabHidden 的呈现树。全部隐藏空状态，xterm/listener/buffer/queue 仍挂载。有效 active 回退只选可见成员。
- 标签各关闭入口隐藏普通 PTY；其他 kinds 保留关闭确认/销毁语义。显式跳转重开，后台状态事件不应取消隐藏。
- TreeNodeItem/TreeContext/ProjectTree/useSidebarController 添加所属 PTY 子列表；worktreeId 关联 Worktree，projectId 且无 worktreeId 关联主项目。点击重开原会话，右键删除复用 closeSession 与确认/托管限制。
- 现有停止、退出、自动清理、项目/Worktree 删除处理全部 sessions，不能只处理 visibleSessions；不改 PTY IPC。

## 触点
shared/types；terminalStore、sessionStore、terminalWorkspan 与 tabs controller；TerminalTabsView/SplitTerminalView/PaneLeafView；项目树与控制器；worktreeStore 删除链路；App 启动恢复/激活审计；领域翻译、局部样式与测试。
GitNexus 缺失，按契约+调用点搜索降级，未知图风险不能当低风险。避免大模块超过2000行，抽出职责明确的纯函数/组件，不建立大聚合入口。

## 兼容与回滚
无DB迁移/新依赖。旧数据默认可见；旧版忽略新字段时仅重新显示标签，不能删除其记录。现有恢复开关与ask/auto拒绝语义不变，daemon不存在时不承诺进程继续。

## 风险与场景
关注全部隐藏、批量关闭、多/深层分屏、多个Workspan、scope/focus-mode、展开/折叠/紧凑侧栏、通知跳转、失焦/托盘、local/WSL/Bash/SSH、hook有无、主仓库/linked Worktree/失效目录、remote handoff、非PTY未保存确认与daemon/fallback恢复。不得将隐藏实现为卸载/搬迁底层树。

## 证据
agent://f6e6c14a-8909-4ce2-b903-666feec4c53e
agent://3da071c0-b405-44b1-ac47-f6015a88049d
批准 handoff fe540751240c0addffd9cd88850c69ab63b73092a3ccd7d36dea8e6fbc33f182
