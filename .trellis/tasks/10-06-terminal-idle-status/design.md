# 根因与设计

## 最终设计边界（批准957d40515d5c71b1e4ccc3cacad27894396689126e596d4db8c629d518522f54）
同一TEMP任务重新in_progress。普通Shell完全隐藏任务显示；普通PowerShell命令不产生可见任务状态，进入Pi Agent后才使用其任务状态。其它既有Agent状态兼容保留。此设计覆盖此前普通命令running的扩展方向，不将“PTY alive”或普通Shell OSC/输入/输出作为Pi任务执行证据。
清理阶段只撤销误方向nativeShell lane：manager.rs自定义PowerShell路径/别名监控注入与两项测试、terminalLaunch.ts显式exe选取增量、terminalRuntime测试的两项pwsh场景、terminalOsc测试新增mock/probe断言、三个新powershellRuntime探针文件及.tmp-terminal-probe目录。保留此前plainShell launch-intent分类、idle/runtime/OSC既有测试及其它dirty代码；不用git restore/reset。
#27不实现新的状态显示机制；后续实现负责普通Shell显示门控和实际Pi进入/退出边界，不能只改为空闲图标。无需新native监控、hook、IPC、timeout或profile读取。本轮只做静态清理核验，不构建/启动/提交；CHANGELOG及功能清单由root最终处理。

## 先前设计记录（已受最终边界约束）
PTY SessionStatus running代表process alive，非task；sidebar resolver默认running与daemon restore alive fallback伪造任务。
sidebar state加idle，用merged tabNotifications显式running，none/undefined idle，不改变SessionStatusenum；WT统计同resolver六态中英。resolveDaemonRestoredTaskStatus missing/invalidalive none、dead done、valid原样。审计top已用taskstate和project聚合边界，仅任务消费者修正，不更改明确life契约。
用已有shell command_started/finished/prompt与Agent hooks，不静默超时。Agent shellalive不代表turn执行；nohook/禁monitor无信号=>idle默认不承诺检测。
触点projects resolver/components汇总/aggregates/i18n/tests，terminal status恢复helper/定向tests。Graph缺失契约+调用点风险未知，dirty<=2000。发现证据agent://07f92766-403c-41d1-bfcb-1b62c1364284。
