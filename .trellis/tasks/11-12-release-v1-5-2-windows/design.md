# 发布设计

复用现有 Windows 发布链路，不改变业务行为或发布架构：

1. 按版本更新清单同步 `package.json`、根 lockfile、Rust crate/lockfile 和 Tauri config。
2. 将两个手动发布入口的默认标签更新为 `V1.5.2`，保留 `push: tags: V*` 自动触发与签名配置。
3. 更新正式版变更记录；运行定向发布契约和架构检查。
4. 在远端状态未漂移且新标签不存在的前提下提交、创建 annotated tag 并推送 `master` 与标签。
5. 由 GitHub Actions 的 Windows runner 生成正式签名资产，完成后逐项核验 Release。

## 场景

- 新版本标签不存在：允许发布。
- 旧版本 V1.5.1 已存在：保持不可变，不覆盖。
- Actions 签名私钥存在：允许正式 updater 构建；私钥内容不得读取或写入仓库。
- 构建/打包/上传任一步失败：不宣称发布成功，保留失败证据并停止。
- SSH Agent 未变更：保持其独立版本不变，仅沿用桌面 bundle 资源。
