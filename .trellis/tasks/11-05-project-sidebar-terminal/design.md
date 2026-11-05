# 设计

## 用户确认变更：底部停靠
辅助终端不再作为右侧栏页签。操作栏独立开关；BottomShellPanel置于TerminalWorkspaceFrame中央列、主Pi下方，右侧文件/Git及左右停靠不变。默认240px，上沿pointer capture拖动/键盘调整持久化；最大化使用可用中央高度，不覆盖正常保存高度，收起不结束进程。稳定parser host及owner不变。内部命名保留sidebarShell以避免无价值重命名。

批准方案：760c093a91a6fd45464eefa1047e65b2fab0309170177b81878e048bbac617e3。

- 复用 terminalStore 的 createSession，显式空 startupCmd、transientBackground=true，普通PTY而非匿名Pi。
- 上下文解析使用项目/Worktree根目录及现有shell、环境、WSL/SSH信息；不复制启动命令或CLI身份。无法可靠定位的上下文拒绝启动。
- 运行态owner按稳定环境key单飞创建，迟到成功仍归属旧环境，不随UI切换丢弃；显式关闭序列化等待创建并调用closeSession(id,true)，失败保留归属。
- 所有保留终端的XTerm解析器稳定挂载；侧栏仅切换可见/焦点，不以条件卸载代替隐藏。
- 侧栏终端不加入主布局，不调用主setActive，不参与普通恢复快照。退出沿既有实例级PTY所有权栅栏。
- 偏好需同时更新类型、默认、迁移和设置入口；遵守2000物理行限制，不压缩规避。

## 已知边界
SSH项目创建目前使用配置remote_path，不能假称支持SSH Worktree路径覆盖；不支持的组合须明确阻止，不在错误目录启动。默认沿用用户侧栏停靠位置，不强制移到右侧。

## 发现清单
主接入：TerminalSidePanel、TerminalTabsView、useTerminalTabsController、sidePanelTabs；生命周期：terminalCreationContext、terminalSessionCreation、TerminalProcessManager、sidebarShellStore；显示：XTermTerminal；显示设置：terminalToolbarVisibility类型/默认/显式迁移/SidebarSettingsPage。GitNexus索引落后，不能以空调用证明无影响，实施需核对当前源码。
