# 恢复状态契约与发现清单

## 根因
恢复 actions 串联普通 close/create（各自发布状态和持久化），之后使用 startup restore 处理过期布局快照；缺少统一 prepare/close/commit 所有权。

## 必修边界
1. `terminalStore.createSession` 复用抽取候选 prepare：resolve launch、创建 PTY、status subscription，暂不发布布局；共享 cleanup，失败必须有资源所有权。
2. `terminalRecoveryActions` 按 ID+实例单飞，严格旧 PTY 关闭 ACK 后同步替换；进程提交与持久化分离。
3. `terminalWorkspan` 使用 latest-state retain-unmapped 单 ID 替换，禁止 `restoreTerminalWorkspans(snapshot, {[old]:new})`（会过滤所有未映射会话）。
4. `sessionStore` 与 Current Work 树/成员统一替换；应急通过正常创建入口加入；保持并发节点/比例/焦点。
5. 共享环境解析继承路径、Worktree 项目关联、Shell/env、WSL distro+cwd（现有 UNC 编码优先），源及解析后 SSH 均拒绝。
6. 控制器/菜单统一 busy、错误原因与风险确认；当前只有 PaneTabBar 入口，默认单标签导航可达性需核验。

## 场景矩阵
- 窗口/展示：普通、单标签隐藏 pane bar、分屏、多 Workspan、当前工作；焦点在目标/其它会话、操作期间切换。
- 环境：本地 shell、继承项目、Worktree 活跃/缺失/不匹配、WSL 非默认发行版+POSIX cwd、SSH/nonPTY（明确拒绝）。
- 故障：prepare create/subscribe reject、old close reject、candidate cleanup reject、post-ACK persistence reject。
- 并发：重复恢复、close/hardKill 对 rebuild、其它会话 create/move/resize/rename/focus。

## 证据
独立分析 agent://ea8a847d-6dc4-423f-9479-4de981eeb12c；入口映射 agent://149308bb-a01c-48eb-9980-0ee93d2e2266。图索引陈旧，结论须以当前源码与定向测试核实。
