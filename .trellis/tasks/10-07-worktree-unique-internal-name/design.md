# 设计

## 根因
前端内部名分钟精度、只看项目已加载记录避重，并从显示名推导slug；与后端真实目录/分支/注册权威不一致。修复落在身份生成与 Rust 创建边界，不隐藏症状。

## 数据流
1. 前端生成 task-MMDD-HHmm-UUIDsuffix（ASCII<=64，crypto.randomUUID，无新增依赖）。每次开窗一次，taskName 与 displayName 初始化相同，编辑仅更改 displayName。
2. Sidebar prompt state 新增 taskName，普通/分屏/自动按钮全部提交；Git 创建弹窗同样保存taskName/readOnly字段。自动/无UI调用不从显示名推导名字。
3. Store沿用WorktreeCreateInput.taskName、旧string显示名兼容和creation guard；不擅自将固定预览候选后缀化；保持请求/响应字段。
4. Rust检验候选path/本地分支/注册，占用时生成新的UUID后缀，最多5候选；保持安全路径与wt前缀验证。
5. Git add竞争复查占用；非冲突权限/IO/checkout错误不泛化重试，保留真实尾部错误。无法证明失败分支归属不得删除并发创建者对象（保留并报错）。
6. 最终返回name/branch/path入库，displayName始终用户输入；正常预览=最终名字，罕见占用重新分配需双语说明。

## 触点
- projects/api/worktreeStore.ts：生成、guard、兼容、持久化。
- projects/hooks/useSidebarController.tsx 与 components/SidebarView.tsx：初始化、字段、所有提交分支。
- git/api/GitWorkspace.tsx：创建state、打开/提交/表单；按职责提取防2000行。
- terminal/lib/webManagement.ts：确认legacy映射，不扩Web UI。
- Rust features/projects/worktree.rs 与专职创建模块/tests：权威避重与竞争。
- messages/projects.*、git.*：双语显示名、内部名、冲突说明/aria。
- scripts/worktreeCreation.test.mjs、Rust创建tests；CHANGELOG TEMP、docs/功能清单 Worktree板块。
- finish、force-delete、依赖安装、PTY 不改；旧DB/名字/路径不动。

## 风险与回滚
多窗口/外部竞争与失败分支清理是主要安全风险，需要反向交错临时仓库测试。不能证明创建归属时保留分支，不能用“此前不存在”证明当前分支归属。回滚仅代码/UI，不删除已创建对象。
GitNexus .gitnexus/run.cjs/skills 不存在，按契约+符号搜索回退，无图结果不视为低风险。trellis-brainstorm不可用，按workflow.md规划审批。分支wt/task-1007-1055无上游，禁止自动同步。
