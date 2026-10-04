# PowerShell终端执行卡顿优化

## Goal

本地 PowerShell / pwsh 终端每次输入命令执行后无可感知的顿挫。调用的本来就是本地 PowerShell（经 ConPTY + daemon 本地回环）。实际机器核对后确认用户默认 Shell 为 PowerShell 7（`C:\huanjing\PowerShell\7\pwsh.exe`），其 profile 中 oh-my-posh 主题每次生成 prompt 约 1.2 秒，主要来自 Git 状态/远程/stash 计算；Windows Terminal 不复现。CLI-Manager 不修改用户 profile，而是在当前 PTY 内注入轻量 prompt。本任务同时保留方案 A 的链路优化。

## Requirements

- Changelog Target: `[TEMP]`
- 范围仅本地 `powershell` / `pwsh`（Windows ConPTY 路径）。`cmd` / GitBash / WSL / SSH 不动行为，只可共享无差别的链路改进；凡按 shell 分支的改动必须以 `powershell`/`pwsh` 为条件。
- 后端（daemon 聚合层）：小帧直通。典型命令回显+结果小帧（目标 ≤4KB）不吃满 5ms 合批窗口；高吞吐大输出仍保持现有 64KiB 预算合批行为不变。
- 前端（`useTerminalDisplay` 全局写调度）：单终端可见场景下回车后首帧不被隐藏终端插队、不多等一个调度轮次；公平调度契约（可见连续 3 批后让位隐藏一次）默认保持不变，先加数据再定是否放宽（见 Q3 决议）。
- 前端（单次写封顶）：`PTY_LIVE_WRITE_BATCH_BYTES=64KB` 的完整 PTY 帧边界语义不变；大输出允许按速率自适应连续刷出，不在主观卡顿场景下增加额外调度 hop。
- 常驻诊断埋点：记录「回车提交 → 首帧到达 → 首帧渲染提交」三段时间，写入 `runtimeDiagnostics` 快照与资源诊断日志，可在诊断面板查看；采样必须节流，不得每个回车都写全量日志。
- 不改变传输协议（WebSocket 二进制帧格式、序号/ACK、Replay/Reset 屏障、FIFO 顺序）与 `safe_emit_boundary` 的 ANSI/UTF-8 边界语义。
- 国际化：新增用户可见文案（如诊断面板字段）必须同步 `zh-CN` / `en-US`，不得硬编码。

## Scenario Matrix

- 本地 PowerShell 空命令回车（仅 prompt 重绘）。
- 本地 PowerShell 小命令（`echo hi`、`dir` 小目录）：输出 < 4KB，主观卡顿高发区。
- 本地 PowerShell 大输出（`dir C:\Windows\System32`、长 `Get-ChildItem -Recurse`）：> 64KB 多帧，需保持合批与背压。
- pwsh（`pwsh.exe`）同上小命令对照。
- 单可见终端 + 若干隐藏终端有积压输出：首帧延迟不得被隐藏终端调度插队放大。
- 多可见分屏并发输出：公平性条款仍生效（3 批让位一次），输出不饿死。
- 文档隐藏 / 最小化时输入回车：timer fallback 仍能 eventual 刷出，不永久卡住。
- 中文/Emoji 输出：UTF-8 边界保护行为不变，无替换符回归。

## Acceptance Criteria

- [ ] 本地 PowerShell 连续执行小命令，主观无可感知的回车后顿挫（验收方式：人工操作确认）。
- [ ] 小帧（≤4KB）在 daemon 侧不等待完整 5ms 合批窗口（单测或日志证明直通路径命中）。
- [ ] 单可见终端场景下，回车后首帧调度等待不引入额外 rAF 轮次（代码审查 + 诊断数据证明）。
- [ ] 高吞吐场景仍满足 `terminal-output-scheduling-contracts.md` 的预算/公平/屏障条款；若实测需要放宽 burst=3，需另起数据结论并更新契约文档。
- [ ] 常驻埋点在诊断快照中可见三段时间字段，高频回车不产生日志洪水（节流验证）。
- [ ] `cmd`/`wsl`/`ssh` 回归：现有定向终端测试、TypeScript 检查、Rust `cargo check` 通过。
- [ ] `CHANGELOG.md` 与 `docs/功能清单.md` 已更新（版本 `TEMP`）。
