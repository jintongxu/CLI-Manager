# 执行

1. 将九个发布版本触点统一至 1.5.1 / V1.5.1，并在 CHANGELOG 与功能清单新增 Windows 正式版条目；保留已有 TEMP 业务记录。
2. 运行版本一致性断言、release workflow 定向测试、`check:architecture -- --strict`、diff 检查与 GitNexus `detect-changes`，并校验待提交文件集合。
3. 重新确认 `origin/master` 同步且 `V1.5.1` 不存在，只提交发布文件与 Trellis 任务记录，推送 master，再创建 annotated `V1.5.1` 标签并普通推送。
4. 等待 GitHub Windows Release 完成，核验 Release 状态、来源提交、Windows 安装包/便携包/签名/更新清单，并提供下载链接。

不提交 `.workflow/spec-analytics.jsonl`，不执行 macOS/Linux 构建，不进行业务修复或依赖升级。
