# 全局快捷键快聊小窗

## 目标
在任意应用中通过全局快捷键唤起独立 AI 小窗，快速连续聊天，无需展开主窗口。

## 已确认
用户批准实施推荐方案、创建 Trellis task，版本 TEMP；批准 Plan handoff：cd73a3d94d6437ff78d44e211fc3236468ef72465cfd590432d722e99cef23ee。

## 需求与验收
- 默认 Ctrl+Alt+Space，可自定义/禁用；注册冲突明确反馈。
- 主窗口后台、最小化、托盘时仍可唤起小窗，输入自动聚焦。
- 已显示但未聚焦时聚焦；已聚焦重复快捷键隐藏。
- 连续追问、流式回答、停止、历史、模型、图片粘贴、推理强度复用已有聊天能力。
- Esc、关闭按钮、系统关闭均隐藏而不销毁；草稿、图片、会话和进行中回复保留；失焦不隐藏，可切换置顶。
- 显式新建会话；重新唤起继续当前会话；主界面继续同一会话，不复制消息。
- 中英文文案，24 小时时间显示不变。
- 可拖动/调整尺寸，恢复时避免显示在屏幕范围外。

## 场景
覆盖应用失焦/主窗口焦点、后台/最小化/托盘、窗口首次创建/隐藏复用、生成中隐藏、快捷键冲突与修改、退出保存、多显示器与 DPI。分屏、Workspan、WSL、Worktree、Hook 不改变语义：不自动引用其内容。

## 非目标
不自动读取剪贴板/选区/终端，不添加截图识别或 Agent 执行，不新增依赖，不变更终端进程与既有聊天安全边界。

## 用户确认 A（取代早期共享选择设计）
首次成功 hello 新建 quick-chat 会话，与 main selected 无关；重复 hello/隐藏/重开保留 quickSelected。非选择式 create/loadDetail，显式投影与命令校验；删除后恢复。同 ID 继续先 main select 再导航。不可变持久化 origin=workspace/sidebar/quick-chat，旧行/旧 Create 默认 workspace，fork 保留，Update 禁止修改。追加 v58，历史 schema.sql/v55 不变；测试执行增量 SQL。工作区左侧历史三分组，保留搜索分页置顶重命名删除，拖拽仅组内；快聊仅快聊历史。快聊默认 medium，显式 off 保留。无新依赖/自动剪贴板/安全放宽/用户 DB 重置。

## Approved Todo12 correction — migration identity / fail-closed readiness
- 根因确认：SQLx SHA-384 校验原始 SQL 字节；历史 v55 checkout CRLF 与 HEAD LF 不同。v55 不增加 origin；origin 仍只由 v58 添加。v55/v57 使用显式转义 LF 的 concat 字节常量，v58 同样固定 LF，避免 checkout 改变运行身份。
- 唯一兼容例外：现有固定 app_paths 修复入口只识别 v55/v57 的精确历史 LF/CRLF 等价变体、正确 description、success=1，以及与规范迁移生成的 sqlite_master 表/索引（包括约束）完全一致的 schema；v55 仅允许规范 v58 origin 扩展。未知 checksum/身份/失败 marker/schema 直接失败，不写入，不禁用 SQLx 校验。
- 仅需修复的变体先 SQLite VACUUM INTO 一致备份（含 WAL），BEGIN IMMEDIATE 下重新验证并带旧 checksum/identity/success 条件 UPDATE；任何更新失败事务回滚恢复 marker，备份保留。规范 LF marker不改写。测试数据库全为临时合成，无用户 DB 修改/重置。
- getDb 首次加载失败在同一进程永久缓存拒绝（避免 SQL 插件消费迁移列表后重试假就绪）；恢复需要 root 管理的完整进程重启，不自动重试/杀进程。repository 在空表时也验证所有会话/消息字段含 origin，decoder 使用 try_get 并传播错误，非法 origin 不默认 workspace。
- quick hello 在 owner 不 ready 时先拒绝，不查模型目录/新建/发布 ready；不以缺模型掩盖 DB 失败。main-only 授权、独立 quickSelected、三来源分组、medium/off 设计不变。GitNexus absent，使用契约和源码调用链降级；不新增依赖/提交。

## Latest explicit scope — source tabs and retained Expand
Supersedes the earlier stacked three-group presentation only. Left history uses keyboard-accessible workspace/sidebar/quick-chat tabs, default workspace, mounting only active source rows. Navigation source is explicit presentation state via chat/api/historySource and workspace/api/primarySpaceState; AppWorkspace passes controlled source/change props. Normal setSpace("chat") resets workspace; sidebar Expand supplies sidebar; quick owner continues same ID then awaits callback("quick-chat"). No selected-origin-following effect. Manual tab changes do not select another conversation or mutate origin. Main New always creates workspace and activates workspace after success. Existing sidebar expand/panel visibility behavior is unchanged.

Quick Expand waits for draft flush, main same-ID selection and explicit source navigation acknowledgment, then invokes native main action. Native show → unminimize → focus → hide chain is fail-fast; any reveal failure leaves quick visible for retry. Hide retains WebView/draft/images/run, no close/destroy/cancel. A pure Rust sequence helper covers every failure position and success. Permissions/DB/stream/provider behavior unchanged.

## TEMP increment — history multiselect deletion
- 保留工作区/侧栏/快聊来源 Tab；显式多选模式，每行原生可访问复选框，不导航、不拖拽。全选只包含当前来源、当前搜索匹配、已加载可见行，不自动分页或跨来源。
- 显示所选数量，取消全选/退出模式；切来源或搜索取消选择。删除前对冻结的 ID 列表显示数量和永久不可撤销警告，取消绝不删除。
- 确认期间禁止重复提交与本地来源/搜索切换；外部导航也不能扩充目标。逐项执行既有 remove，非原子事务；成功/失败分别记录，失败保持选中并本地化反馈，可显式重试。后端未承诺 missing 幂等，因此 missing 仍为失败。
