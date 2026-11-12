# 执行计划

1. 完成发布前置检查，统一 V1.5.2 发布元数据与中英文发布记录。
2. 运行版本一致性断言、发布工作流测试、严格架构检查、diff 检查和 GitNexus change analysis；审阅差异后提交。
3. 再次确认远端 `master` 和标签状态，创建 annotated `V1.5.2` 标签并推送 `origin`。
4. 等待 Windows Release 工作流，核验 Release 状态及 NSIS/MSI/ZIP/签名/`latest.json` 资产。

## 触点清单

- `package.json`、`package-lock.json`：npm 根版本。
- `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`：桌面 Rust crate 版本。
- `src-tauri/tauri.conf.json`：bundle/runtime 版本；updater endpoint、公钥及 updater artifact 开关保持不变。
- `.github/workflows/release.yml`、`.github/workflows/windows-release-upload.yml`：手动发布默认标签；签名与 Windows-only 构建保持不变。
- `CHANGELOG.md`、`docs/功能清单.md`：V1.5.2 发布记录。
- `src-tauri/ssh-agent/*`：独立产品版本，确认不修改。
- PTY、IPC、窗口/分屏、WSL、Worktree、CLI Hook：不受发布元数据调整影响。
