# 执行计划

批准计划 b6887e19070060baa67d333b41688873cc04f9d871da6737605d4bbd3e0954a7；Todo #4-7。

1. 创建文档及上下文，validate/start。
2. 默认集中根和稳定仓库桶实现；相关Rust单元测试验证主/linked同桶、同名不同仓库、自定义根不变、数据根内拒绝和空父清理。
3. 双语说明与错误映射；保留普通入口和历史策略；TEMP及功能清单、默认路径契约同步。
4. 复用定向证据，架构与变更范围验收后收尾。

验证只运行相关目标：Rust默认目录/创建/自定义根/空父清理过滤器，必要cargo check；node --test src/features/projects/tests/projectSelection.test.mjs，新增相关测试；改TS后npx tsc --noEmit；npm run check:architecture及--strict；git diff --check。不运行无关全量测试。手工中英文切换仅环境允许时执行，否则报告限制。

每阶段记录实际命令/结果；不自动提交、不迁移清理旧目录。故障先定位最小失败目标，不重复通过的无关检查。

## 实施结果

- 默认根已集中到活动data/worktrees/仓库名-SHA256(common-dir)，身份、同名仓库、内部目录拒绝、junction与旧目录兼容6项测试通过。
- Rust定向验证：`commands::git_worktree::default_root::tests` 6/6、`commands::git_worktree::create::tests` 12/12、`computes_default_worktree_root_in_active_data_directory` 1/1、`resolves_target_path_under_custom_root` 1/1、`cleanup_empty_worktree_parent` 1/1。均使用 `TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --offline --manifest-path src-tauri/Cargo.toml --lib <filter>`，原始构建因运行中的ConPTY资源文件占用os error32失败，未终止用户进程，未修改打包配置。
- 同样环境下 `cargo check --offline --manifest-path src-tauri/Cargo.toml` 通过，保留既有警告。
- `node --test src/features/projects/tests/projectSelection.test.mjs` 对应4项通过；修改后的实际错误映射/双语测试通过（`node --test --test-name-pattern='actual short label field exposes bilingual' scripts/worktreeCreation.test.mjs`）。`npx tsc --noEmit` 通过。
- 完整 `scripts/worktreeCreation.test.mjs` 有8项失败：6项unexpected dependency sonner、2项旧短标签预期与当前显示名称不一致；失败依赖的Store/Sidebar/Git对话框本次未修改，未将其当作通过，未扩大范围修复。
- `npm run check:architecture` 与 `npm run check:architecture -- --strict` 通过，1477源文件、零超限/新增违规；`git diff --check` 通过。
- 双语设置、TEMP、功能清单与默认路径契约已同步。旧目录不迁移、不删除，历史策略不重置。
- 未启动桌面应用（项目规范）；真实创建、语言切换、生产资源打包未手工验收。无新增知识候选：本次约束已记入领域契约，不重复沉淀。
- Trellis start缺少会话identity，以degraded模式进入in_progress；明确任务目录继续，完成后标记completed，不清除其他任务的active指针。无Git提交或同步。
