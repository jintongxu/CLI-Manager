# 设计

空 worktree_root 使用 cli_manager_data_dir()/worktrees/<仓库可读名>-<稳定common-dir摘要>/<task>。复用既有平台路径和摘要依赖；common Git dir规范化保证linked与主目录一致，Windows目录组件合法。活动数据根位于受管理仓库内时拒绝默认创建，提示外部自定义根。非空自定义根不增加仓库分组，保留原语义。

旧记录继续按实际path打开/删除/恢复；只清理一层空父目录，不递归应用数据根。不静默更改always/autoParallel/prompt策略。普通终端和disabled默认已满足需求，复用不新增入口。

## 影响分析（GitNexus不可用，契约与源码降级）
- worktree.rs default_worktree_root -> resolve_worktree_target_path -> worktree_create.rs create_observed：默认目录规则及创建安全检查。
- worktree_tests.rs / worktree_create_tests.rs：默认目录、临时仓库、custom-root及创建。
- app_paths.rs cli_manager_data_dir：只复用现有活动数据目录，不改变存储协议。
- ConfigModal及领域i18n：双语根目录/默认使用说明；worktree错误映射需同步。
- Sidebar controller / projectSelection tests：确认普通、分屏、显式创建和既有策略。
- finish/remove/force-delete：确认按实际路径运行，本任务不修改其安全协议。
- CHANGELOG TEMP、docs/功能清单、worktree-isolation-contracts默认目录条款同步。

## 场景
主仓库、linked .git文件、同名仓库；空根、自定义根、旧路径、缺失/占用目录、Windows路径、数据根内部拒绝；普通/分屏/显式隔离；WSL/SSH保持不支持；多窗口焦点/托盘/hook不参与路径计算，不改生命周期。

## 风险及回滚
保留确认、身份与越界检查。数据根变更仅影响新建，旧记录不反推路径。回滚仅恢复默认计算与说明，不删除已创建目录或记录。无Git上游，保留已有dirty工作区，不自动commit/push。
