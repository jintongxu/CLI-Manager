# V1.5.1 Windows 正式版

用户已批准发布到 `jintongxu/CLI-Manager`，提交并推送当前 `origin/master` 的最新已提交代码与 `V1.5.1` 标签。仅构建 Windows x64，复用 GitHub Actions 签名发布流程。

## 范围

- 将 npm 根包、Cargo 主包、Tauri 配置及 Windows Release 手动入口默认标签统一为 `1.5.1` / `V1.5.1`。
- 更新 `CHANGELOG.md` 与 `docs/功能清单.md`，保留已有 TEMP 功能记录。
- 发布源只包含已提交代码与本次发布元数据；不得提交现有 `.workflow/spec-analytics.jsonl` 修改。
- 不改业务逻辑、依赖、公钥、Secrets 或权限，不构建 macOS/Linux，不覆盖已有 Release。

## 验收标准

- [ ] 所有桌面版本字段一致为 `1.5.1`，两个 Windows workflow 默认标签一致为 `V1.5.1`。
- [ ] 发布流程定向测试、严格架构检查、版本断言、diff 检查和 GitNexus changes 分析完成。
- [ ] 推送前确认 `origin/master` 未发生分叉且远端不存在 `V1.5.1`。
- [ ] 只提交发布相关文件和本任务记录，`.workflow/spec-analytics.jsonl` 保持未提交。
- [ ] `V1.5.1` 标签触发 `jintongxu/CLI-Manager` 的 Windows Release，正式 Release 非草稿、非预发布且标记 Latest。
- [ ] Release 包含 NSIS EXE、MSI、portable ZIP、对应签名和 `latest.json`，更新清单只引用本版本 Windows 资产。

## 非验收范围

不宣称本机安装、真实 GUI、中英文切换或自动更新升级链路经过人工验收。
