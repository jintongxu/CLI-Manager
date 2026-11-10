# 设计

复用现有 `.github/workflows/release.yml` 的 Windows-only 发布链路：标签推送后由 `windows-latest` checkout 精确标签，执行 `npm ci` 和发布契约测试，再由 `tauri-action` 构建 NSIS/MSI、生成 updater 文件，并额外打包 portable ZIP。

版本由 npm 根包、npm 锁文件、Cargo 主包、Cargo 锁文件和 Tauri 配置共同持有；手动 workflow 的默认标签同步更新。签名只由既有 GitHub Secrets 注入，不读取私钥、不替换公钥。

GitNexus 对通用 `version` 查询返回歧义、UNKNOWN 且索引落后，不能作为低风险结论；因此用精确文本搜索和既有 V1.4.13 发布提交确认所有版本触点。本次不修改函数行为、数据迁移或运行状态，窗口、分屏、WSL、Worktree、hook 等场景行为不变。

推送前重新读取远端 master 和标签状态。禁止 force push、重写历史、删除旧标签或覆盖旧附件；如发现远端变化、标签冲突或 CI 失败，停止并报告，不用本地无签名包替代正式发布。
