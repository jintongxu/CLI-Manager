# V1.5.2 Windows 正式版

用户批准创建 Trellis task，并以 V1.5.2 发布当前 `master`。

## 范围

- 以 `master` 当前业务代码为基线，仅调整发布元数据与发布记录。
- 仅通过 `jintongxu/CLI-Manager` 既有 GitHub Actions 构建 Windows NSIS EXE、MSI、便携 ZIP 和签名更新清单。
- 不构建 macOS/Linux，不修改 SSH Agent 独立版本，不覆盖既有 V1.5.1 Release。
- 发布前必须确认 `master` 与 `origin/master` 同步，且 V1.5.2 标签和 Release 不存在。

## 验收标准

- [ ] npm、Cargo、Tauri 六处桌面版本源统一为 1.5.2，工作流手动触发默认标签同步为 V1.5.2。
- [ ] `CHANGELOG.md` 和 `docs/功能清单.md` 记录 V1.5.2 Windows 正式版。
- [ ] 发布契约定向测试、严格架构检查、版本一致性检查和 `git diff --check` 通过。
- [ ] 发布提交与 annotated `V1.5.2` 标签推送到 `origin`，Windows Release 工作流成功。
- [ ] GitHub Release 非草稿、非预发布，包含 NSIS EXE、MSI、便携 ZIP、`latest.json` 与签名更新资产。

## 限制

本机安装、桌面 GUI、中英文切换及真实旧版本升级不在自动发布验收范围内，必须如实标注未验证。
