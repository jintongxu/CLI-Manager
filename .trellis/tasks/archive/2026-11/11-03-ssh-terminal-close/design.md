# 设计

## 根因
默认关闭在 useTerminalTabsController.closeSessionIds 中统一调用 hideSession，PTY 隐藏资格不区分 SSH，导致只设置 tabHidden。

## 方案
在 terminalBatchClose 公共模块增加按实时会话分派的窄函数；SSH PTY 使用 closeSession(id, true)，其余默认使用 hideSession，显式销毁保留原行为。控制器在确认与保护过滤之后调用该函数。保留 terminalProjectHide 和 terminalTabVisibility 的非破坏性语义。

## 已核查触点
- useTerminalTabsController：默认关闭/批量关闭、确认及脏文件保护。
- terminalBatchClose：保护名单与逐项错误收集，作为分派归属。
- terminalTabLifecycle / terminalTabVisibility：显式隐藏，不修改。
- terminalProjectHide：显式项目隐藏，不修改。
- terminalStore.closeSession：严格关闭先等待 closeTerminalSource，成功再清理监听、会话、Workspan、持久化；失败不先移除。
- terminalSessionCandidate.closeTerminalSource：复用 terminalProcessManager.close(id, true)。
- useCloseOtherTerminals：已有显式销毁及当前工作保护，不改变。

## 场景
SSH 项目/独立 Shell、连接中/已连接/失败/断开、隐藏过的会话，默认关闭均严格销毁；本地/WSL、伪会话、显式隐藏保持兼容。焦点、托盘、Worktree 与 Hook 安装状态不影响分派。远程 handoff 锁继续由 Store 判定。

## 风险及回滚
GitNexus runner/索引不存在，采用 SSH 契约和符号搜索降级，未宣称图检查通过。新增分派不改变 IPC 或持久化协议。回滚仅撤销分派接入与 helper，既有清理实现不变。
