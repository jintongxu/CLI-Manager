# 可恢复 Finish 生命周期

## 根因

Git/FS 清理与前端 DB 无持久完成阶段/归属证据。worktree.rs remove 成功后 residual cleanup 仍可失败；store 在整个命令成功才删除 SQL 行；重试变成未登记非空路径被安全拒绝；dialog 开/对象刷新/翻译引用改变时清空阶段并访问失效目录，旧请求无隔离。

## 后端权威

在 features/projects 下新增职责模块，worktree.rs 现有约 1940 行不得超 2000。普通 merge/remove/discard 兼容。新 finish check/merge/cleanup/ack IPC 用共同完成上下文 worktree ID、projectPath、worktreePath、branch、baseBranch，serde camelCase。

凭据持久于 repository common Git admin 内，不位于 checkout 或即将移除的登记目录。版本绑定 repo/ID/path/branch/base/source OID/merge或no_diff证据/stash恢复状态/cleanup阶段/目录身份与内容归属。关键删除意图先落盘，失败停止下一阶段；同 repo 操作锁串行。

状态应向前端明确表达 valid 可审查提交、可合并、cleanup pending、cleanup blocked（含需人工确认旧残留）、unknown invalid、Git/FS完成待SQL收尾。active/missing 仍用于工作目录有效性，新增 pending显示不得当 active运行目录。无凭据 branch存在可按指定base ancestry确认历史已合并；无 branch且无证据unknown，不推断完成。no_diff是无需合并并单独记载。force stash pending必须持久阻塞，不能通过 ancestry猜测或重复apply解除。

## 安全清理

finish与destructive discard分开；每次 cleanup 复核 source/base/branch tip、登记/同repo checkout、dirty。任何合并后新内容停止。清理前持久绑定root原生generation/identity及文件快照归属，重试允许原快照的残留子集，拒绝替换root/新增修改内容/新.git/登记错配；ignored产物可维持既有finish清理语义但纳入归属；不能遍历 symlink/junction 外部目标。拒绝main/ancestor/admin目录。

复用 removal retry/residual/stale/prune；只有root NotFound代表缺失。删除后复核root absence，内部NotFound不等于成功。branch删除合法wt/、明确请求、完成已验证且OID未变；已经缺失在有凭据情况下幂等收尾。receipt保留至SQL成功ack。

历史未登记非空目录无所有权证据不得自动adopt/delete，即使 ancestry证明branch已合并。明确显示branch合并与残留人工核对；安全移走目录后允许 finalize。此次不对真实旧目录执行操作。

## 前端

markMissing 改权威检查，不用path存在当valid；pending记录可恢复并保留侧栏但不可当正常checkout。dialog stable open周期/ID/path，clear旧changes、generation隔离旧async，翻译/对象refresh不重置。先check再get_changes，只有validcheckout读changes，commit前重新check；loading/error/invalid/pending禁add/commit。merge成功持久phase，重开直接cleanup，失败明确merge已完成cleanup失败。

cleanup检查成功后必须确认关联会话关闭（UI提示/确认）；检查不关闭会话。same WT串行，busy禁outside close。后端done而SQL失败保留finalize；SQL成功马上移除store然后refresh，refresh失败不重做Git。所有入口共用恢复dialog，invalid可以打开check而非直接拒绝。

## 触点

修改：worktree.rs/new finish模块/lib注册，worktreeStore/FinishDialog/types，TreeNodeItem，Sidebar/Terminal controllers，GitWorkspace，projects zh/en。
核对必要窄改：App/sync startup、projectStore/sidebarModel构树、terminalStore/webManagement/remote handoff/Stats工作目录消费者。
不扩大：创建/自动隔离/依赖安装/provider配置/项目想法。显式discard保留确认与原安全边界。

## 风险与证据

GitNexus在当前/主repo缺runner，当前无index/skill且PATH无CLI，按triage契约fallback；graph gate未通过不得冒称通过。FS删除高风险，UNKNOWN/legacy必须保守。事故OS原因无日志不下结论。
