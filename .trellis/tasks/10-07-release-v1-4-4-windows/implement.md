# Implementation Plan — V1.4.4 Windows Release

## 1. Preflight

- [ ] 再次确认 `master` 与 `origin/master` 同步、工作区除本任务 Trellis 文件外无未知改动。
- [ ] 确认本地和 `origin` 均不存在 `V1.4.4`。
- [ ] 确认 `origin` 指向 `jintongxu/CLI-Manager`，`TAURI_SIGNING_PRIVATE_KEY` Secret 名称存在。

## 2. Version and release metadata

- [ ] 将 `package.json`、`package-lock.json` 两个根字段更新为 `1.4.4`。
- [ ] 将 `src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 的 `cli-manager` 根 package 更新为 `1.4.4`。
- [ ] 将 `src-tauri/tauri.conf.json` 更新为 `1.4.4`。
- [ ] 将两份 workflow 的手动默认 tag 和 workflow 静态测试更新为 `V1.4.4`。
- [ ] 在 `CHANGELOG.md` 与 `docs/功能清单.md` 顶部新增 `V1.4.4` Windows 发布记录，保留既有 TEMP 内容。

## 3. Focused verification

- [ ] 运行版本一致性检查，确认仅预期的 app/version 字段为 `1.4.4`。
- [ ] 运行 `node .github/scripts/release-workflow.test.mjs`。
- [ ] 运行 `npm run build`。
- [ ] 运行 `cargo check --locked --manifest-path src-tauri/Cargo.toml`；按契约处理资源前置，不绕过错误。
- [ ] 独立运行 `npm run check:architecture -- --strict`。
- [ ] 运行 GitNexus `detect-changes --scope all`；入口不可用时记录降级的 diff/契约核验及未解析风险。

## 4. Review and commit gate

- [ ] 检查完整 diff，确认不含私钥、token、非 Windows 平台发布改动或 SSH Agent 版本变化。
- [ ] 提交前向用户展示一次提交计划；获得确认后创建发布准备提交，不 amend。
- [ ] 确认提交后工作区干净，提交 SHA 固定。

## 5. Push and release

- [ ] 重新确认远端未出现 `V1.4.4`，且 `origin/master` 未在本地验证期间前移。
- [ ] 推送 `master` 到 `origin`。
- [ ] 创建 annotated tag `V1.4.4` 指向发布提交并推送到 `origin`。
- [ ] 定位由 tag push 触发的 `Windows Release` run，等待完成并要求成功退出。
- [ ] 核验 `V1.4.4` Release 非 draft/prerelease，资产包含 NSIS、MSI、对应签名、portable ZIP 和 `latest.json`。
- [ ] 核验 Release `targetCommitish`/tag 指向预期提交，最终报告 run 与 Release URL。

## Rollback / stop points

- 修改尚未提交：仅回退本任务文件。
- 提交尚未推送：经用户授权可创建修正提交；不 amend。
- `master` 已推送但 tag 未推送：停止发版，修复后创建新的发布准备提交再打 tag。
- tag 已推送：不移动/删除 tag；workflow 失败则报告并请求用户决定重跑同一 workflow 或准备新 patch 版本。
