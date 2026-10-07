# 发布 CLI-Manager V1.4.4 Windows 正式版

## Goal

将当前 `master` 上已完成但尚未发布的变更作为桌面端 `V1.4.4` 正式版发布到 `jintongxu/CLI-Manager`，仅构建 Windows 产物。

## Requirements

- 桌面端版本由现状统一升级为 `1.4.4`，发布标签使用既有约定 `V1.4.4`。
- 六个桌面版本源必须一致：`package.json`、`package-lock.json` 两处根版本、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 中 `cli-manager` 包版本、`src-tauri/tauri.conf.json`。
- 更新 `.github/workflows/release.yml`、`.github/workflows/windows-release-upload.yml` 的手动触发默认标签，以及 `.github/scripts/release-workflow.test.mjs` 的版本断言。
- 在 `CHANGELOG.md` 和 `docs/功能清单.md` 顶部新增 `V1.4.4` 发布记录；保留既有 `TEMP` 内容，不将其删除或重复搬运。
- 发布前验证版本一致性、Windows Release 工作流契约、架构约束及必要的前端/Rust 构建边界。
- 仅向 `origin`（`https://github.com/jintongxu/CLI-Manager.git`）推送 `master` 与新标签；不得推送 `upstream`。
- 使用仓库现有 `.github/workflows/release.yml`：GitHub Actions `windows-latest` 构建 NSIS、MSI、便携 ZIP 和签名更新清单；不构建 Linux/macOS。
- 不修改 SSH Agent 的独立版本；桌面 Release 继续打包当前 SSH Agent 资源。
- 不读取、打印或修改 updater 私钥。仓库已存在 `TAURI_SIGNING_PRIVATE_KEY` Secret，发布过程只验证名称存在。

## Scenario Matrix

| 场景 | 预期 |
|---|---|
| 工作区/分支 | 从干净且与 `origin/master` 同步的 `master` 开始；发布提交前若状态变化则停止复核。 |
| 版本源原本不一致 | 将 npm/Tauri/Rust 六处统一到 `1.4.4`，不沿用 `Cargo.toml`/`Cargo.lock` 中遗留的 `1.4.2`。 |
| 标签已存在 | 推送前确认本地和远端均不存在 `V1.4.4`；若存在则停止，不覆盖或移动标签。 |
| 发布 Secret 缺失 | 在推送 tag 前停止，不制造无法签名的正式 Release。 |
| GitHub Actions 失败 | 不篡改已推送提交/tag；报告失败步骤和日志链接，经修复后按用户决定使用新版本或重跑现有工作流。 |
| 产物不完整 | Release 必须包含 NSIS、MSI、各自 `.sig`、便携 ZIP、`latest.json`；缺一即不视为完成。 |
| 其他平台 | 工作流仅有 `windows-latest` job，不触发 Linux/macOS 构建。 |
| 远端选择 | 只推送 `origin`，绝不推送 `upstream`。 |

## Acceptance Criteria

- [ ] 六个桌面版本源均为 `1.4.4`，SSH Agent 版本未改变。
- [ ] 发布工作流及其测试默认版本均为 `V1.4.4`。
- [ ] `CHANGELOG.md` 与 `docs/功能清单.md` 包含 `V1.4.4` Windows 发布记录。
- [ ] 定向版本/工作流测试、`npm run check:architecture -- --strict`、必要构建检查通过。
- [ ] GitNexus `detect-changes` 完成；若本地入口继续缺失，明确记录降级检查结果。
- [ ] 发布变更已按用户确认的提交计划提交到 `master`。
- [ ] `master` 和不可变标签 `V1.4.4` 已推送到 `origin`，远端提交与本地一致。
- [ ] GitHub Actions 的 Windows Release run 成功完成。
- [ ] GitHub Release `V1.4.4` 为非草稿、非预发布，并包含 NSIS、MSI、签名、便携 ZIP、`latest.json`。
- [ ] Release 页面与 Actions run URL 已交付给用户。
