# Design

## 现状链路（命中小帧顿挫的三层）

```
ConPTY reader 线程（manager.rs）
  │ safe_emit_boundary 切帧 → sink.on_output
  ▼
DaemonPtyEventSink 单消费者线程（pty_events.rs）
  │ 5ms / 64KiB 合批（OUTPUT_BUFFERING_DURATION / OUTPUT_BUFFERING_MAX_BYTES）
  ▼
ClientWriter 写线程（client_transport.rs）→ WebSocket 二进制帧
  │ 高水位 100k chars 背压（小命令不触发）
  ▼
PtyHostSocket → TerminalProcessManager 队列（按 sequence 去重/FIFO）
  │ commit → acknowledge（写回调后）
  ▼
useTerminalDisplay 全局 rAF 单槽调度（scheduledTerminalWrites）
  │ 可见 burst=3 让位隐藏；fallback 250ms timer
  ▼
terminal.write(transformed, callback) → 64KB 单次封顶（PTY_LIVE_WRITE_BATCH_BYTES）
```

小命令三波短突发（prompt 重绘 + 命令回显 + 执行结果）每一波都小，但：
- daemon 侧第一帧到达后等 5ms 看看有没有更多 → +5ms；
- 前端侧排队等下一个 rAF 单槽 → +1 帧（16ms）；
- 若恰好有隐藏终端积压，burst 计数还可能让首帧再让位一次。

三者相加约 20–40ms，且发生在回车后注意力最集中的时刻 → 主观「卡一下」。

## 改动设计（方案 A，三层联动，均向后兼容）

### D1. Daemon 小帧直通（Rust，`pty_events.rs` + `server.rs` 常量）

- 新增 `OUTPUT_PASSTHROUGH_MAX_BYTES = 4 * 1024`。
- 聚合线程逻辑改为：首帧到达后，若首帧 `len <= PASSTHROUGH`，给一个极短的粘连窗口（`OUTPUT_PASSTHROUGH_WINDOW = 1ms`）只为粘住同一 read 调用后脚跟来的 prompt 重绘尾巴；窗口内无后续帧则立即 emit，不等满 5ms。
- 首帧 `> PASSTHROUGH` 或粘连后总量超过阈值 → 回落现有 5ms/64KiB 路径，语义不变。
- `Status` 帧仍优先冲刷此前输出后发送（现有行为不变）。
- 契约更新：`terminal-output-scheduling-contracts.md` §3 增加直通条款，§4 增加「4KiB 首帧 + 1ms 内无跟随 → 立即 emit」验证行，§6 增加 Rust 单测要求。

### D2. 可见终端首帧优先（前端，`useTerminalDisplay.ts` 调度器）

- 在 `ScheduledTerminalWrite` 条目上加 `queuedAt` 与 `isInteractive`（由 `attachPtyOutput` 在收到回车后首个 live 帧时标记——实现方式：`TerminalProcessManager` 在 `write("\r")` 后给该 session 设一个 500ms 有效期的优先标记，前端调度器读取）。
- `runGlobalTerminalWrite` 选帧规则改为：若存在带优先标记且可见的条目，直接选中它，不受 `visibleWriteBurst` 计数影响；优先标记消费一次后清除（一帧只优先一次，避免饿死隐藏终端）。
- burst=3 / 让位一次的公平条款保持不变（Q3 决议：看数据再定，本任务不改）。
- 文档隐藏时的 timer fallback 路径不变。

### D3. 自适应写封顶（前端，`useTerminalDisplay.ts` flush 路径）

- `PTY_LIVE_WRITE_BATCH_BYTES=64KB` 保持为默认上限；新增：当队列深度 ≤2 帧且总字节 ≤64KB 时，一次 `terminal.write` 全量刷出（现状小命令已如此，明确为不变量并加单测锁定）。
- 当队列持续堆积（连续 3 个 flush 周期队列非空），允许单次上限临时放宽到 256KB（按完整帧边界），消化积压后回落 64KB。防止大输出场景下调度 hop 数量随输出线性增长。
- `Replay/Reset` 屏障与 commit→ACK 顺序不变。

### D4. 常驻诊断埋点（前端为主，后端为辅）

- 前端：在 `useTerminalInput.forwardTerminalInput` 记录回车时间戳（`performance.now()`，内存 Map，按 session 只保留最近一次）；在 `attachPtyOutput.queuePayload` 记录首帧到达时间；在 `terminal.write` 首帧回调里记录渲染提交时间。三段差值记入模块级滑动窗口（最近 50 次），每 30s 随 `runtimeDiagnostics` 快照输出 P50/P95/max，不逐次打日志。
- 后端（可选，若前端数据已足够定位则不做）：daemon 聚合线程记录直通/合批命中计数器，随现有日志周期输出。
- 诊断面板：复用现有资源诊断日志通道，不新增独立 UI 页面；字段需 i18n（若有可见文案）。
- 节流：滑动窗口内存结构 + 30s 快照 cadence，与现有 `RUNTIME_DIAGNOSTIC_INTERVAL_MS` 对齐。

## 兼容与回滚

- 所有改动都是「快速路径 + 回落慢速路径」结构：阈值判断失败即走现有逻辑。任一层出问题可单独用常量开关关闭（直通阈值设 0 = 关闭；优先标记关闭 = 不设标记；自适应上限关闭 = 恒 64KB）。
- 传输协议、序号/ACK、Replay/Reset、UTF-8/ANSI 边界语义零改动。
- 若实测证明 burst=3 是瓶颈，另起任务改契约，本任务不碰。

## 触点清单（待 implement 逐项打勾）

- [ ] `src-tauri/src/infrastructure/daemon/server.rs`（常量）
- [ ] `src-tauri/src/infrastructure/daemon/server/pty_events.rs`（聚合线程直通逻辑）
- [ ] `src-tauri/src/infrastructure/daemon/server/tests.rs`（直通单测）
- [ ] `src/features/terminal/hooks/useTerminalDisplay.ts`（调度器 + 自适应封顶 + 埋点消费端）
- [ ] `src/features/terminal/api/TerminalProcessManager.ts`（优先标记：write 回车侧）
- [ ] `src/features/terminal/hooks/useTerminalInput.ts`（埋点：回车时间戳）
- [ ] `src/features/terminal/api/runtimeDiagnostics.ts`（快照输出 P50/P95/max）
- [ ] `.trellis/spec/backend/terminal-output-scheduling-contracts.md`（契约更新）
- [ ] `CHANGELOG.md` + `docs/功能清单.md`（TEMP）
- 已确认无关：`manager.rs` reader 线程、`boundary.rs`、`client_transport.rs` 写线程、`PtyHostSocket.ts` 传输、`terminalStatus.ts` 状态节流、`sessionSnapshotPersistence.ts` 快照定时器。
