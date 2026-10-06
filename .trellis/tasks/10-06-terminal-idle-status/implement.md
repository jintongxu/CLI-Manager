# 执行

## 最终批准需求交付（覆盖下方历史要求）
普通Shell task状态全隐藏，只有实际Agent资格读取hook任务状态，manualPi SessionStart建立资格，无Agent WTsummary仅总数。共享terminalTaskPresentation供sidebar/project/WT/top使用。trusted OSC prompt清资格，Stop只是turn结束不当退出。其它已有Agent兼容，普通监测仍存储但不用于任务展示。
120项受影响focusedtests、tsc、独立strictarchitecture通过（1230sourcefiles零超限违规）；root定向source资格/exit审计并更新TEMP/功能清单。证据agent://1b1412bf-3c15-4816-8f25-9d2c088d8e53。
限制：无existingOSC prompt/foregroundidentity时Pi退出无法可靠发现，资格可能残留；未nativePi进出/语言切换实机。此边界是已披露缺口，不声称所有shell完美退出。误方向nativeShell lane已撤除，Rustmanager及OSCtests回到先前内容，agent://b10c40c1-f595-48be-b2d1-08637baff294。不build/Git同步提交，无新知识候选。


## 最终纠正进度（TEMP，in_progress）
- [x] 记录最终批准方案957d40515d5c71b1e4ccc3cacad27894396689126e596d4db8c629d518522f54：普通Shell任务显示完全隐藏，仅进入Pi Agent后显示任务；其它既有Agent兼容保留。此前普通命令running方向已superseded。
- [x] #27精确撤销agent://e0f4d840-8ca2-4672-aa2a-cba40eae911e的nativeShell lane：manager.rs自定义PowerShell监控注入/两项测试、terminalLaunch显式exe增量、runtime两项pwsh场景、OSC mock/probe增量及三个新探针文件/.tmp-terminal-probe。保留前序plainShell分类、idle/OSC测试及无关dirty改动。
- [ ] 后续任务实现普通Shell完全隐藏与Pi实际进入后的任务显示边界，保留其它Agent语义，并完成最终验收。
本轮仅定向静态清理检查；不运行native/frontend测试、不构建、不启动应用、不提交，不读取raw native captures、用户profile或凭据。历史测试结果不是最终纠正行为的验收结果；CHANGELOG/功能清单最终由root处理。

## 历史执行记录（不代表最终纠正已完成）
- [x] 需求授权/方案批准，Trellis planning工件TEMP。
- [x] idle resolver/六态counts文案，restorealivefallback修正，top/project消费者任务语义审计；create/split PTY alive回调不再写task running。
- [x] 126项定向sidebar/status/lifecycle/runtime等tests真实代码事件/恢复与缺省通过，tsc/独立strictarchitecture通过（1229源文件零超限/违规）。
- [x] Root定向resolver/daemonfallback/projecttask边界审计，TEMP CHANGELOG/功能清单/任务记录。

## 普通命令执行后续修复（历史要求，已被最终需求取代）
用户进一步要求实施普通命令运行态。源代码确认显式startupCmd空字符串普通shell被项目cli_tool推断成Agent，runtime忽略shell事件。修正launch-intent分类并保留空字符串sentinel于create/split/restore/newtab/duplicate；undefined继承Agent仍保持，ephemeralPi不变，无新机制/自动开设置。
50项受影响terminalLifecycle/runtime/agent/osc tests、tsc、独立strictarchitecture、diffcheck通过。证据agent://9329d561-a200-42bb-ae2b-854556ce11d9及agent://f4440cbe-d781-44c8-afcb-f7fc23824c29。需用户开启monitor后新建受支持shell，旧PTY不补装，真实PSReadLine/OSC/native执行未验证。

## 证据与失败/限制
agent://d432a65f-e148-418e-adc1-a377cfc53275。额外kimiHookFrontend旧source-pattern断言失败（扩展批129/130，要求App包含event.payload.source !== kimi），App.tsx与HEAD无diff，不修改无关测试/源码；不是126项通过目标的一部分。
未真实shell/静默任务/Agent hooks/重启/语言切换验收，native边界mock不实机；无hook/禁monitor缺省idle仅无task信号，不保证检测。保留既有30分钟hook expiry无新timeout。Graph无降级契约/调用点风险未知。零新知识候选（既有task/life契约纠正），无Git同步/commit/EXEbuild。
不full/Rust/build/git，mock不实机；实际空shell/静默运行/Agenthook/恢复与中英未跑准确说明。无timeout猜测，不修改dragpin/fold/层级。无新知识可零候选。
