# 设计与锁定接口

计划67c09cda7f58934d9e0c9b7faf4080f3e4f7320d8cd813bce4c7164d2cf901c1。

Settings.worktreeDefaultRoot: string，默认空字符串。本机字段syncSettings分类excluded。

Rust窄IPC（由后端实现并注册，前端按此调用）：
- `git_worktree_get_default_root` 无参数，返回 `Result<String,String>`，仅返回用户主目录/Worktrees的普通本地路径，不返回仓库桶，也不读取坏配置而妨碍恢复默认。
- `git_worktree_validate_default_root({root: string})` 返回 `Result<String,String>`，trim后校验，空串返回空串代表默认；非空返回合法普通本地绝对路径。验证不创建目录，不执行Git或修改设置。拒绝相对、WSL/UNC/远程及指向现有文件的路径；检查可用存在前缀，保留创建时checkout/junction保护。
- 统一面向用户错误码 `worktree_default_root_invalid`（非法配置/路径），`worktree_default_root_read_failed`（读取/解析settings失败），`worktree_default_root_inside_repository`（创建时已存在的安全错误）。其他底层错误按既有方式保留诊断；新home错误也需前端可理解处理。

设置存储：复用app_get_data_paths.settingsStorePath的活动文件，注意现有settings.json dev/install共享（sessions才分开），Rust必须通过现有app_paths helper获取同一路径，不硬编码猜测。设置缺失/空=>home/Worktrees；存在非字符串值或坏文件=>明确错误，不静默fallback。项目自定义根非空不读全局配置。

前端新section以草稿工作，保存先invoke校验，再使用窄的持久化动作/辅助模块await plugin-store set/save，成功才发布确认state和成功消息；不改变无关字段update语义。处理失败时恢复缓存，避免autoSave后续写入失败值，回滚失败如实呈现。保存期间防重，picker取消不改值。不要让其他设置直接update该字段绕开save边界；新的机器路径尽量通过专项保存入口。

默认根计算：全局根只加仓库桶（无额外worktrees）。保留common-dir SHA256、主/linked同桶、同名隔离、Windows安全名及根/junction不落入任何已登记checkout/common目录的检查。旧记录按实际路径，单层空父清理不递归。Web由执行设备本机读取。

## 影响分析
GitNexus不可用，契约+符号降级。
- default_worktree_root -> resolve_worktree_target_path -> create_observed，复用默认根策略及测试。
- settingsStore字段/加载/专用持久化边界 -> 独立WorktreeStorageSection -> General页面组合。
- syncSettings穷尽分类与backup白名单，机器路径excluded。
- Tauri命令注册、窄路径接口；原create req不变。
- settings/projects双语与创建错误映射；TEMP、功能清单、领域契约同步。
- 普通/分屏/显式/Web均同Store创建链，未改变其策略。

## 场景
空值、有效全局、项目优先、相对/远程/坏配置、home缺失、现有文件、目录不存在、链接前缀；保存成功/失败/立即创建/恢复默认/picker取消/重复；主/linked同桶/同名不同库/受保护目录/旧目录；多窗口及执行设备本机，不改focus/tray/hook生命周期。

## 回滚
只恢复设置入口/默认规则，不移动删除真实目录或配置其他字段。保留原dirty文件，不Git同步提交、不杀正在运行的应用。
