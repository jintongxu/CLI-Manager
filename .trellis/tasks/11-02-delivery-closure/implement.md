# 实施清单

1. 拆分 `src-tauri/src/commands/web_device.rs`：创建 `web_device_tests.rs` 并迁移测试代码。
2. 拆分 `src-tauri/src/infrastructure/daemon/server.rs`：创建 `server/hook_activation.rs` 与 `server/frame_io.rs` 并迁移对应函数。
3. 验证 `npm run check:architecture -- --strict` 达到零超限，`cargo check` 与 `cargo test` 通过。
4. 更新 `package.json` 中的 `@tauri-apps/api` 至 `~2.12.0`，运行 `npm install` 并验证 tsc 及 dev 启动日志。
5. 更新 3 个旧任务的 `task.json` 为 `completed`，运行 `task.py validate`。
6. 执行全量自动化回归（75 Node 测试 + 40 Rust 测试），更新 `CHANGELOG.md` 与 `docs/功能清单.md`。
