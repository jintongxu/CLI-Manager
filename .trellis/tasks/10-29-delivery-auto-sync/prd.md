# Pi 默认推送与自动冲突恢复

批准计划5c719b256f0ddebfc9f7529fec47361e2bc1f29e4a3d94db0353484f519cdffc，用户确认建任务、TEMP。

- 主分支与任务Worktree有明确远端默认正常push；无远端只本地完成；唯一remote可纳入初次确认，无upstream不当无远端；多个不猜。
- Pi结合双方代码意图自动解决本次交付冲突，暂存、相关验证及最终树核验后继续。脚本不内置AI；语义选择不明/权限/验证失败不能假成功。
- 同一授权范围内不每文件重新问，范围/远端/业务决策变化仍确认。保留必要摘要/证据，不新增无条件yes。
- 目标干净时FF或普通merge同步冻结远端，不rebase/reset/stash/force；不接管旧操作，不清理目录分支或终端。
- 有界自动尝试最多3次，保留现场；明确状态/journal恢复、最终pushOID与squash证明独立，旧receipt不扩大授权。
- 仅临时repo/linked/bare进行写操作测试；当前dirty工作区不真交付、不操作应用进程、不新依赖/全局安装。

验收：主默认push/无上游唯一/多remote/false退出；FF/分叉/文本冲突和modify-delete模拟Pi；squash/remote冲突分离，未解决/失败证据/越界dirty拒绝；远端竞态/丢回执/merge后journal失败/重复resume/上限；旧收据及root/parent/common/ref/URL/hook安全回归。真实Pi语义/GitHub未手验明确报告。
