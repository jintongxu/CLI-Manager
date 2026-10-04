# Implement

## 执行顺序（依赖链）

1. S1 daemon 小帧直通（Rust）→ 先行，可独立验证。
2. S2 可见终端首帧优先（前端调度器 + 优先标记）。
3. S3 自适应写封顶（前端 flush 路径，与 S2 同文件，分两次提交以便回滚定位）。
4. S4 常驻诊断埋点（前端三段时间 + 快照输出）。
5. S5 契约文档更新 + CHANGELOG/功能清单 + 全量验证。

S2 依赖 S1 的常量语义澄清（直通阈值 4KB 口径），但代码可并行；S4 依赖 S2 的标记点（回车时间戳）与 S1 完成（首帧到达口径稳定）。

## Checklist

### S1. Daemon 小帧直通

- [ ] `server.rs` 新增 `OUTPUT_PASSTHROUGH_MAX_BYTES`（4KiB）与 `OUTPUT_PASSTHROUGH_WINDOW`（1ms）常量，注释写明口径与回落语义。
- [ ] `pty_events.rs` 聚合线程：首帧 ≤阈值时 1ms 粘连窗口后立即 emit；否则走现有 5ms/64KiB 路径；Status 冲刷语义不变。
- [ ] `tests.rs` 新增单测：小首帧直通、首帧+跟随帧粘连合并、大首帧回落合批（对应契约 §6）。
- [ ] 验证：`cd src-tauri && cargo test pty_events`（或 daemon 相关测试集）+ `cargo check`。

### S2. 可见终端首帧优先

- [ ] `TerminalProcessManager`：`write()` 检测 `"\r"`（回车提交）后给 session 设 500ms 有效期优先标记；提供调度器可读接口。
- [ ] `useTerminalDisplay.ts`：`ScheduledTerminalWrite` 加 `queuedAt`；`runGlobalTerminalWrite` 优先选中带有效标记的可见条目，消费一次后清除；burst=3 公平条款其余不变。
- [ ] 前端单测（若有调度器测试文件则加，无则在现有终端测试目录加）：优先条目跳过 burst 计数、标记一次性消费、隐藏终端不饿死。
- [ ] 验证：`npx tsc --noEmit` + 定向终端测试。

### S3. 自适应写封顶

- [ ] `useTerminalDisplay.ts` flush 路径：队列 ≤2 帧且 ≤64KB 全量刷出（不变量单测锁定）；连续 3 个 flush 周期队列非空时上限临时 256KB（完整帧边界），消化后回落。
- [ ] 验证：`npx tsc --noEmit` + 定向终端测试；大输出场景人工 `dir C:\Windows\System32` 无乱序/截断。

### S4. 常驻诊断埋点

- [ ] `useTerminalInput.ts`：回车提交记 `performance.now()`（按 session 最近一次）。
- [ ] `useTerminalDisplay.ts`：首帧到达记时、首帧写回调记时，三段差值入最近 50 次滑动窗口。
- [ ] `runtimeDiagnostics.ts`：30s 快照输出 P50/P95/max；高频回车无日志洪水（快照 cadence 对齐现有间隔）。
- [ ] 可见文案（如有）同步 zh-CN/en-US。
- [ ] 验证：`npx tsc --noEmit`；人工回车后在诊断日志中看到三段时间字段。

### S5. 收尾

- [ ] 更新 `terminal-output-scheduling-contracts.md`（直通条款 + 验证行 + Rust 单测要求）。
- [ ] `CHANGELOG.md`（TEMP）+ `docs/功能清单.md` 对应板块。
- [ ] 最终验证：`npx tsc --noEmit`、`cd src-tauri && cargo check`、定向终端测试、`npm run check:architecture -- --strict`。
- [ ] 人工验收：本地 PowerShell 小命令连续回车，主观流畅；查看诊断快照三段时间。

## 回滚点

- R1（S1 后）：Rust 单测不过 → 直通阈值置 0 即关闭，不影响后续前端工作。
- R2（S2 后）：调度回归 → 移除优先标记读取，恢复纯 burst 逻辑。
- R3（S3 后）：大输出异常 → 上限恒 64KB。
- 全程不改动协议/序号/ACK/边界语义，无数据迁移，无需发布回滚方案。

## Review Gates

- S1 完成后：Rust 测试 + cargo check。
- S2/S3/S4 每个完成后：tsc + 定向终端测试。
- S5 前：架构检查 `--strict` 零超限。
