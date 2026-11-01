# Implementation and verification

1. Add pure generic retained session state machine + isolated Rust behavioral tests; wire native serialized lifecycle, timeout/Escape watchdog, hidden publication and identity-checked IPC.
2. Wire frontend subscribe/read handshake and async generation fencing, image decode/paint-ready callback, confirm-hide before model and successful result delivery only.
3. Run filtered translator Rust tests, cargo check, translator node tests, tsc --noEmit, standalone strict architecture check. Never launch app/GUI/dev server or full-repo test suites. Record unrelated baseline failures and missing graph risk; no commit or broad docs/changelog changes.

## Verification outcome

- `cargo test --manifest-path src-tauri/Cargo.toml --lib translator:: -- --test-threads=1`: 28 passed (6 new pure protocol/effect/watchdog tests); no desktop tests executed.
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`: passed with existing warnings.
- `node --test scripts/translator.test.mjs`: 25 passed including four new async lifecycle behavioral tests.
- `npx tsc --noEmit`: passed.
- `node scripts/architecture.mjs --strict`: failed only on unrelated existing `src-tauri/src/commands/web_device.rs` (2024 lines) and `src-tauri/src/infrastructure/daemon/server.rs` (2028 lines).
- Initial Rust filter `features::translator` matched zero tests; corrected to actual module path `translator::`, results above. An obsolete structural test expected old show helpers; updated to new lifecycle entry. Initial async test required cross-VM microtask settlement; fixed test synchronization with setImmediate.

No GUI, dev server, actual fullscreen or live model requests launched. Native command compilation verified on Windows; actual compositor/native API failure/DPI behaviors unverified. Hidden-webview animation-frame throttling can prevent readiness; the five-second native deadline fails closed rather than forcing show. A 120-second session lease releases a later hung overlay. Cancellation fences requests/results but does not abort provider HTTP work already executing.

`task.py start` successfully transitioned task status but session pointer was not persisted (host session identity unavailable/degraded). Required design.md and implement.md existed before start. Missing report schema paths `.pi/agents/general-executor-report.schema.json` and `flow/agents/` mean final report follows authoritative inline schema. GitNexus missing entry remains an unresolved graph-completeness risk.

## 独立复核与最终验证
- 修复 Selecting 时保留帧不可重读造成重挂载空白风险；重复 ready 幂等，不重复 show/focus。
- 修复原生释放失败却丢失会话所有权的风险：Releasing 持续重试，失败时尝试鼠标穿透，前端保持现有画面直到释放成功。
- 30 Rust translator 测试、27 Node translator 测试、tsc 通过（独立测试 agent://2ba724f7-dd01-4c32-940a-55d882f36702）。
- 根流程独立运行 npm run check:architecture -- --strict：失败仅 web_device.rs 2024 行、daemon/server.rs 2028 行；未修改这两个文件。
- 无真实 GUI / 全屏 / 模型调用。隐藏 WebView rAF 可能被节流：5秒准备超时安全关闭，不能据此声称实际可用性已经通过。OS hide/destroy/passthrough同时永久失败或主线程阻塞不在隔离测试保证范围。
- 可复用经验：预热改变 mount 与 show 的对应关系，长期窗口的每轮业务必须有身份与保留状态，不能以 mount-only effect 或一次性事件充当生命周期。当前无活动 Run/Session，未向其知识流写入候选（0 条）。
