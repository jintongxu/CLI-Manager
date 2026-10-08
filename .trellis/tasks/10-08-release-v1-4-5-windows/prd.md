# V1.4.5 Windows 正式版发布

## 范围

用户确认 V1.4.5，创建 Trellis 发布任务。沿用既有 Windows Release workflow，不修改应用功能、不新增构建平台。同步 npm 根版本、npm lock 两处根版本、Tauri 配置、Rust manifest 与 src-tauri lock 中 cli-manager 版本；同步两个工作流默认标签及发布测试断言，更新 CHANGELOG.md 与 docs/功能清单.md。

## 发布方案与场景

- 仅向 origin（jintongxu/CLI-Manager）推送 master 和新标签 V1.4.5，不向 upstream 推送。
- 保留 .workflow 未提交记录，不包含在发布提交。推送前检查远端 master 未变化；新标签不得覆盖已有标签。
- GitHub windows-latest 构建 NSIS/MSI、签名、便携 ZIP、latest.json；正式非草稿、非预发布。只验证签名 Secret 名称，不读取秘密。
- 使用 src-tauri/Cargo.lock，根目录遗留 Cargo.lock 不属于桌面构建入口，不修改；SSH Agent 独立版本保持原样。
- 焦点、分屏、WSL、Worktree、hook 等运行时维度不受版本元数据修改影响；保留已有业务实现。仅 Windows x64 既有 runner，不承诺 ARM64/x86 独立安装包。
- CI 失败或产物缺失不视为完成；报告准确日志，不移动已发布标签，不默默改为预发布。

## 影响与验证

GitNexus impact 对发布测试文件返回 UNKNOWN / Target not found。补充定向搜索确认调用入口是 .github/workflows/release.yml 的 Validate release workflow。只改版本常量，无业务函数变更。

验收：六处桌面版本一致；发布契约测试及严格架构检查通过；GitNexus 变更分析并报告限制；发布提交与新标签推送成功；Windows Actions 成功；GitHub 正式 Release 包含 exe/msi、签名、便携 ZIP 与 latest.json。

前端及 Rust release 编译由同一 GitHub Windows 构建执行，不重复本地全量编译。发布链接与构建链接交付用户。
