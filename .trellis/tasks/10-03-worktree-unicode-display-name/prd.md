# 支持中文 Worktree 名称与任务说明

## Goal

允许用户使用中文及其他 Unicode 字符作为 Worktree 任务显示名，并增加独立任务说明；实际目录和 Git 分支继续使用安全 ASCII 标识。

## Requirements

- Worktree 数据模型持久化 `display_name` 与 `description`，旧记录自动以现有 ASCII `name` 回填显示名。
- `name` 继续作为内部 ASCII slug，仅用于目录、`wt/` 分支和唯一性判断；中文显示名不得传给 Git 创建命令。
- 侧边栏隔离创建与 Git 工作区创建均填写任务名称和说明；任务名称 1–64 个 Unicode 码点，说明最多 2000 个 Unicode 码点。
- 项目树、终端标题、Git 工作区、完成/丢弃/依赖提示、历史/供应商上下文及 Web 工作区显示任务显示名，并保留分支和路径技术信息。
- Git 工作区可编辑显示名与任务说明，修改元数据不得改变目录、分支或 Worktree 身份。
- Web 快照、管理操作与同步备份/恢复传递新字段，同时兼容旧客户端、旧快照和旧备份。
- 中英文用户文案同步维护。

## Acceptance Criteria

- [x] 输入中文任务名后，底层目录与 `wt/` 分支均保持 ASCII，且同项目 slug 按大小写不敏感判重。
- [x] 任务说明可创建、显示、编辑、清空并在重启、Web 快照及备份恢复后保留。
- [x] 旧 Worktree 无需人工迁移即可显示原任务名，旧 Web 快照/管理载荷/备份继续可用。
- [x] `npx tsc --noEmit`、`npm run web:typecheck`、`cargo check`、Web 服务 `cargo check`、定向 Rust 测试和严格架构检查通过。
- [x] `CHANGELOG.md` 与 `docs/功能清单.md` 已更新。

## Notes

- 当前功能仅改变 Worktree 元数据和展示；Git 创建、合并、删除、路径归属和供应商作用域行为保持不变。
