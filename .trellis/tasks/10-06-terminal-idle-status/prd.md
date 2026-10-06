# 空闲终端状态修复

## 最终需求（覆盖此前普通命令运行态要求）
批准方案957d40515d5c71b1e4ccc3cacad27894396689126e596d4db8c629d518522f54，继续使用同一TEMP任务，状态重新打开为in_progress。
用户最终选择：普通Shell（包括PowerShell 7普通命令）完全隐藏任务显示，而不是显示Idle或执行命令时显示running。只有实际进入Pi Agent后才显示其任务状态；其它已有Agent状态兼容保留，不将其禁用。
此前“普通命令运行态”要求已被本条最终需求取代。下述原idle验收只保留其适用的Agent/恢复/task-versus-life边界；不得再据此扩展普通Shell任务监控。
本轮#27仅精确撤销agent://e0f4d840-8ca2-4672-aa2a-cba40eae911e的native Shell扩展与探针，不新增Shell机制，保留此前launch-intent分类、idle修正及其它既有改动。最终行为实现和验收由后续任务完成。

## 原始需求记录（按上述最终需求限定适用范围）
批准0e09391e244182439e22d46897667d1dd7799a3b0a549c70f0a4242c3693fa59，TEMP。
无任务终端显示空闲Idle不是▶，只明确task running才运行。remote锁/PTY error exited优先，attention done failed语义保留；WT汇总加idle六态互斥sum=total。daemon alive且无合法taskStatus不能回填running。不以输出静默猜空闲，不新hook/IPC/timeout。保留completion不按prompt粗略清掉。
验收新shell/legacy/hidden/tasksignals/remote/restore(有无合法state)/nohook monitor局限；top及project任务consumer不得混life。中英、现有dragpin/fold/层级不变，聚焦tests/tsc/严格架构及TEMP/docs，实机限制如实。无Gitcommit/sync或EXEbuild。
