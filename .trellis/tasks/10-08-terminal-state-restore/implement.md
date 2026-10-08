# 执行清单

用户已批准实施，handoff 6df1b3cd01f1b3013631a1e4103960c2d13115e1363c33c8f6ca87e8615074d9；Todo #4→#5→#6→#7为权威执行队列。

1. 保存prd/design/implement与manifest并task start。
2. 实现统一continuation状态机：snapshot sequence与checkpoint固定S；live/cold分流；stale fallback authoritative replay；input readiness/协议来源分离/取消；补齐实际必要xterm状态。先失败用例后实现，定向测试立即记录，不能事后补checklist。
3. 可恢复exit与Pi cold native resume：正常restore开启保留所有alivePTY（无daemon tray），running既有策略兼容，explicit terminate/tab/restore-off/reject清理；Pi明确ID与continue fallback，无旧TUI。定向exit/Pi tests。
4. CHANGELOG TEMP与docs/功能清单终端板块，独立diff审查统一continuation subsystem全部已知finding；复用未失效通过证据，不自动验证wave。
5. `npx tsc --noEmit`，独立`npm run check:architecture -- --strict`。只执行修改所涉及的snapshot/remount/parser/input/manager/exit/Pi test文件，Rust无改不跑cargo；若改Rust需对应focused test/check/fmt。
6. 明确Windows手动安装/dev退出重开same PID、idle/active shell/Pi、pane/workspan resize/tray/focus/WSL/SSH/hook有无、explicit清理、中英文文案未验证项；遵守不自动启动Tauri。提交须另得确认，不push。不为流程fabricate知识candidate。

已知tests：scripts/terminalSnapshotCapture.test.mjs、terminalRemountSnapshot.test.mjs、terminalHistoricalParser.test.mjs、terminalProcessManager.test.mjs、ptyHostSocket.test.mjs、terminalExitCleanup.test.mjs、terminalPiCompatibility.test.mjs、resume/history command相关。执行者根据实际变更选最小目标。
