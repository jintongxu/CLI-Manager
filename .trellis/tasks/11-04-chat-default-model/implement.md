# Implement

## 最后一次共享持久化边界合并修复
- confirmed finding `agent://4bf298b3-b137-4282-90d1-cb3d11312184`：原 chat 缓存回滚失败只设置共享布尔 fence；root 的公开 exclusive 直接拿原始 Store，既可 flush 失败 chat 值，又可清除该 fence。
- 最小修复仅在 settingsPersistence：confirmed 写缓存回滚失败时，按 key 留存实际旧基线；exclusive 在交出原始 Store 前串行恢复全部未恢复基线（原来无键则 delete），失败即 reject，不进入调用方。恢复成功才移除该 key。set/save/setConfirmed 和 root saver 都经此入口，root 的 markUnsafeCache(false) 无法清除 confirmed 基线；普通 save 失败且回滚成功路径不变。
- worktreeRootPersistence 源码无改动：其原有 root 专用 unsafeCache fence、exclusive 重试和成功解锁保持原样；既有 root rollback 失败 → 自动写拒绝 → root retry → 自动写恢复测试继续通过。未引入新的通用事务层。
- 新增 4 个组合故障用例：chat set 在缓存变更后抛错 / 显式 save 抛错 × 旧值存在 / 不存在，随后缓存回滚失败；验证存储尚未恢复时 set、save、公开 exclusive、root saver 均不进入实际写；恢复存储后 root saver 成功，每一次恢复及后续 auto-save 快照都只含旧 chat 基线而非失败选择。原普通 save 失败及双 owner 用例不改。
- 验证命令：`node --test scripts/chatDefaultModel.test.mjs scripts/worktreeRootSettings.test.mjs scripts/chatModelSettings.test.mjs scripts/chatUi.test.mjs scripts/chatPersistence.test.mjs scripts/quickChat.test.mjs`：99/99 pass，0 skipped；`npx tsc --noEmit` exit 0；`npm run check:architecture -- --strict`：1667 sources、0 超限、0 违规；`git diff --check` exit 0（仅既有 CRLF 提示）。记录更新后另跑 diff check。
- 边界与约束：复用根知识 gate 无 spec 命中和已记录的 impact UNKNOWN，不重复 review/启动代理；本次只改 persistence、chat 定向测试和本记录，未触碰 terminal/SidebarFooter 或其他既有改动；不提交、不启动/重启应用。故障注入为 Node cache/disk mock，并非真实 Tauri 磁盘故障；仍不承诺跨窗口/进程原子性。

## 第一阶段（本次）
1. 新增 shared preference 类型/归一化、settingsStore 字段/load/update、preferences 同步分类。
2. 扩展领域 resolver，保留 sidebar/workspace 两种无偏好 fallback；提供公开 API 入口。
3. 设置页独立即时保存选择，中英文状态/错误/重试。
4. focused tests：真实 settingsStore mocked I/O 保存/重载；resolver 精确身份、失效、空；设置 UI 保存/失败/失效保留。
5. 验证：`node --test scripts/chatDefaultModel.test.mjs scripts/chatModelSettings.test.mjs scripts/chatUi.test.mjs scripts/chatPersistence.test.mjs`、`npx tsc --noEmit`、`node scripts/architecture.mjs --strict`、`git diff --check`。

## 第二阶段（已实现，真实桌面验收未运行）
- ChatWorkspace 与 ChatPanelSurface 接入 settingsStore 最新偏好、最新目录与公开 resolver；分别显式选 workspace/sidebar 保持旧 fallback。
- 只对目标新建空模型会话绑定，稳定 ID、防异步目录与快速切换竞态，保留 native 兼容路径及已有选择。
- 补新建绑定测试、独立审查、最终 TEMP CHANGELOG/功能清单；真实 Tauri 与语言切换未验证需明示。

## 限制
本次不启动应用、不触碰真实密钥/Pi 配置/后端 schema，不重启/kill/提交。所有原有终端删除、SidebarFooter、CHANGELOG/docs 修改均保留。maestro 命令自动产生 spec analytics/hit-log 变更，不当作功能实现修改。

第二阶段验证命令另含 `scripts/quickChat.test.mjs`，覆盖共享 Surface 的兼容回归；具体计数见执行报告。未启动、重启、kill、提交或推送。

## 独立 review F1/F2 根因修复（本次）
- 根因 F1：Store.set 的 autoSave:0 不向调用者传播磁盘失败，缓存成功不等于持久化成功。新增 settingsPersistence.setConfirmed 的 opt-in 串行事务：读取实际缓存基线、set + 显式 save 确认，失败恢复旧缓存（不存在则 delete）、尽力补偿磁盘，回滚缓存失败则复用 unsafeCache fence 阻止后续本地写；原错误 reject，settingsStore 仅在确认后发布。仅 chatDefaultModel 使用，其他设置 set 语义不变；同窗串行，不保证跨窗口/进程事务。
- 根因 F2：同一 controller 的隐藏 Workspace 和侧栏同时挂载，view policy 不应拥有会话默认策略。移除 hook policy 参数，以持久化 conversation.origin 决定 workspace/sidebar fallback（旧数据缺失 origin 按 workspace），Quick Chat 排除；保留 controller 队列、空模型检查、显式选择优先和 CAS，不改 schema 或可见性规则。
- 发现清单：已核对 settingsStore.update/UI saveDefault、settingsPersistence 和 worktreeRootPersistence 共用边界；已核对两 consumer、hook、controller.create/createUnselected/bindDefaultModel 和 Surface sidebar create；Quick Chat 专属路径、终端删除、SidebarFooter 均确认无关，未改。设置 UI 已有 reject 展示错误和旧值保留，无需改 UI。CHANGELOG/功能清单已有默认模型条目，本次按限定范围不改。
- 场景：null/失效/有效精确偏好 × workspace/sidebar/quick-chat origin × 双请求正反返回；双 view 同时存在（含隐藏 Workspace），显式旧模型；设置加载/快速切换/队列/CAS 复用定向回归。焦点、托盘、分屏、WSL/Worktree/Hook 不参与 origin 或持久化确认，不新增环境分支。
- 前置：根 knowledge gate 无命中已由父会话完成；本次 coding spec 已加载。分支 wt/task-1103-2044-046cfd69541c 无 upstream，不推拉/同步。主库 runner 对 createSettingsPersistence/useConversationDefaultModel impact 返回 UNKNOWN/not found、索引落后 96 commits，非低风险结论；以上当前源码调用链补证。不提交，因此未运行 commit 前 detect_changes。
- 测试边界：双 owner 使用真实 ChatWorkspace/ChatPanel 和真实 hook 实现、同一真实 controller，在 Node hookHarness 中维护两个独立 hook/effect 生命周期，并控制目录响应顺序；不是 DOM/真实 React renderer/Tauri 测试。缓存 mock 区分 cache 与 disk，模拟 set 吞 auto-save 错误及显式 save 抛错；验证回滚、后续写不污染磁盘、成功重载和回滚失败 fence。现有 UI 错误分支另有定向测试。未运行真实 Tauri 磁盘故障注入、实际重开/视觉/语言切换。
- 最终验证：`node --test scripts/chatDefaultModel.test.mjs scripts/chatModelSettings.test.mjs scripts/chatUi.test.mjs scripts/worktreeRootSettings.test.mjs` 共 65/65 pass、0 skipped（output/chat-default-review-fixes.log）；`npx tsc --noEmit` exit 0；`npm run check:architecture -- --strict` 1667 sources、零超限/违规；`git diff --check` exit 0。没有重跑之前的全套 60：仅重跑修改的 persistence/UI/hook 测试，并因新增共享 persistence API 补 worktreeRootSettings 的既有边界保护回归。初次补跑发现 settingsStore 尾换行计数断言把 2000 物理行计为 2001，已用单表达式选择持久化方法回到 1999 物理行，最终回归通过；未改长度测试或豁免。

## 用户授权扩展 Quick Chat 默认模型
- 原 Quick Chat non-goal 由本次用户明确覆盖。实际增量文件：`src/features/chat/api/quickChatOwner.ts`、`src/features/chat/api/QuickChatWindowApp.tsx`、`src/features/chat/components/ChatPanelSurface.tsx`（注释）、`src/features/chat/lib/chatController.ts`、`scripts/quickChat.test.mjs`、settings 中英 hint、TEMP CHANGELOG/功能清单及本任务 PRD/design/implement。共享 hook 继续排除 quick-chat；没有修改 terminal/SidebarFooter、Pi、翻译模型或 settings persistence。
- 主 owner 新建前先 start/ready、await 主 settingsStore.load/loaded、读最新目录，随后读最新偏好并按 sidebar fallback 定向绑定新 ID；已有 hello/select 不绑定，create/delete recovery 共用同一路径。浮窗 defaultBindingManaged 关闭旧 Surface effect；初始化前 mutation 与旧 epoch 拒绝，导航继续顺序执行。
- bindQuickDefaultModel 复用私有队列实现，queue 内核对 origin、空模型与 owner 生命周期，保留 draft/revision CAS；不借 select，原 Workspace/sidebar API 的选中限定和 quick-chat 排除不变。
- 新增 7 个 Node 用例（quickChat 共 31）：真实 ChatController + owner 的 DB start gate / settings loaded gate / hello→create 顺序、最新目录与保存后下次新建、已有手选与 owner reload、null/失效 sidebar fallback、空目录和 settings/catalog 失败重试、未选中主会话定向绑定、queue 内显式编辑优先、初始化前拒绝与浮窗委托。settings load、IPC、catalog 为 mock；不是实际跨 WebView/Tauri ready/磁盘/热键测试。
- 最终实跑 `node --test scripts/quickChat.test.mjs scripts/chatDefaultModel.test.mjs scripts/chatUi.test.mjs`：77/77 pass、0 skipped；quickChat 单独 31/31 pass。`npx tsc --noEmit` exit 0；`npm run check:architecture -- --strict`：1667 sources、0 above 2000、0 new violations；`git diff --check` exit 0（既有 LF→CRLF warning）。未启动/重启应用、kill、提交、推送或同步。真实 Tauri 热键、隐藏重开/托盘与多窗口 ready、视觉/语言切换及模型联网请求仍待人工验收。
