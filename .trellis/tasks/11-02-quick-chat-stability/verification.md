# 验证记录

## Task #32 内存上界
- CommandLedger: 512 窗口 + 单调 seq 水位 fail-closed；无 seq envelope 不推进水位。`src/features/chat/lib/panelController.ts`
- quickChatRemote 发送 seq；Rust `Envelope.seq: Option<u64>` 保持 deny_unknown_fields。`src-tauri/src/features/quick_chat/mod.rs`
- chatController `deleted`/`deleting` → `BoundedSet(512)`。`src/features/chat/lib/boundedSet.ts`
- runtime `unsaved` 上限 64：先 retry_unsaved，再按 `at` 淘汰最旧并 `log::warn!`；`seen` 已有 retain，保持 4096 有界。
- 证据：32 Node（quickChat+chatController）、`npx tsc --noEmit`、`cargo test chat::` 34 passed、`quick_chat::` 4 passed、`unsaved_backlog_evicts_oldest_entries_only` passed、strict 仅 web_device.rs 2024 / daemon/server.rs 2028、`git diff --check` 通过。
- Rust 使用 `TAURI_CONFIG='{"bundle":{"resources":[]}}'` 仅验证覆盖（当时 dev 进程占用 target 资源）。

## Task #33 生命周期收敛
- 移除 `ChatPanelSurface` 无选中时的隐式 `create`，改为 `chat.panel.noSelection` 提示（zh/en 同步）。
- 删除恢复不再取消多选模式，修复“批量失败项应保留选择”的回归；恢复允许在选中模式下进行。
- 证据：61 Node（chatOrigin/chatMultiSelect/chatController/chatNavigation/quickChat）全通过、`npx tsc --noEmit` 通过。

## Task #34 错误分级与可操作提示
- 错误分级：`src/features/chat/lib/chatErrors.ts` 实现 `diagnoseChatError` 与 `resolveSnapshotError`。
  - 6 大原因分类：`not_ready`（未就绪/连接失败）、`not_found`（会话不存在/已删除）、`storage`（存储失败）、`unsupported_protocol`（供应商协议不支持）、`timeout`（超时）、`capacity`（容量上限）。
  - 5 项对应动作：`reconnect`（重连）、`create`（新建）、`retry_save`（重试保存）、`switch_model`（换模型）、`wait`（等待）。
  - 快照清除与防掩盖：恢复成功（有效就绪选中且无 owner 错误）清除过期错误；版本 <= 失败时版本的旧成功快照不得掩盖进行中的失败。
- 远端与 UI 对接：
  - `quickChatRemote.ts` report 保留真实错误码并跟踪 inFlightError，accept 遵循防掩盖与恢复清除规则。
  - `ChatPanelSurface.tsx` 与 `ChatWorkspace.tsx` 错误提示升级为按原因分级的可操作提示与按钮，不统一硬编码“重试保存”。
  - `chat.zh-CN.ts` 与 `chat.en-US.ts` 双语同步新增动作、分类与快聊专用错误文案。
- 证据：
  - 新增 `scripts/chatErrors.test.mjs` 覆盖每个错误码的分类/动作/双语文案映射，以及旧快照防掩盖/恢复清除时机。
  - 65 Node 测试（chatErrors / quickChat / chatController / chatMultiSelect / chatOrigin / chatNavigation）全数通过。
  - `npx tsc --noEmit` 通过。
  - `git diff --check` 通过。
  - `npm run check:architecture -- --strict` 仅 2 处既有历史超限。

## Task #35 搜索防抖与语义说明
- 搜索防抖与进行中状态：
  - `ChatController` 新增 `searchHistory(query, delayMs = 250)` 与 `clearSearch()`；维护 `searching: boolean` 状态。
  - 连续快速输入仅发出一次最终查询，避免每次按键重复请求后端。
  - 显式 `clearSearch()` 立即取消待执行防抖定时器并恢复全量历史列表。
- 交互与语义诚实反馈：
  - 搜索框内提供清空按钮（仅在有搜索内容时展示）；点击一键清空并重置多选作用域。
  - 搜索进行中显示 `chat.searching`（zh: 搜索中… / en: Searching…）。
  - 匹配项计数反馈：根据分页状态显示 `chat.searchMatches` 或 `chat.searchMatchesMore`（标记已加载匹配项并提示有更多）。
  - 空状态语义诚实：无匹配时显示 `chat.searchNoMatchesInLoaded`（当前已加载历史中未找到匹配项），不虚假宣称全量历史为空。
  - 搜索输入变更与来源 Tab 切换均触发 `historySelection.resetScope`，清空多选状态，避免误删不可见项。
- 证据：
  - 新增 `scripts/chatSearch.test.mjs` 覆盖防抖单次请求、连续输入取最后值、进行中状态跟踪、清空即时恢复、来源切换与搜索变更重置多选。
  - 70 Node 测试（chatErrors / chatSearch / quickChat / chatController / chatMultiSelect / chatOrigin / chatNavigation）全数通过。
  - `npx tsc --noEmit` 通过。
  - `git diff --check` 通过。
  - `npm run check:architecture -- --strict` 仅 2 处既有历史超限。

## Task #36 退出资源释放与通道清理
- 顺序与退出权威：
  - 维持既有 exit authority：先执行 `chat prepare`/drain（`drain_chat_until(deadline)`）保证未保存快照刷盘，再在 `RunEvent::Exit` 中释放快聊通道与快捷键，不得截断最后一次快照。
  - Rust 退出与销毁清理：
    - `quick_chat::cleanup(app)` 与纯函数 `cleanup_channels_and_hotkey`：清空 `MAIN_CHANNEL` 与 `REMOTE_CHANNEL`，注销注册的全局快捷键，销毁小窗句柄；小窗 `WindowEvent::Destroyed` 及时清空 `REMOTE_CHANNEL`。
    - `chat::commands::cleanup()`：调用 `runtime.shutdown()` 清空 `seen`、`unsaved` 与 `active` 运行时状态。
  - 前端退出处理：
    - `lifecycle.ts:suspendChatEditing()` 联动调用 `stopQuickChatOwner()`：取消 `publishTimer`、退订 `owner` 与 `settingsStore` 监听、发布携带 `suspended: true` 的终态快照。
    - `quickChatOwner` 对处于 `suspended` 状态的主控制器拒绝所有快聊新命令，直接抛出 `chat_shutting_down`。
    - `flushChatPersistence` 若有残留无法持久化的消息显式抛出 `chat_storage` 报错，阻止退出提交并回滚。
- 证据：
  - Rust 单元测试：`quick_chat::tests::cleanup_releases_channels_and_unregisters_hotkey` 验证通道释放与快捷键注销；`runtime` 验证 `shutdown()` 彻底清空 active/seen/unsaved。
  - Node 单元测试：`scripts/chatExit.test.mjs` 新增测试验证退出挂起期间快聊命令被拒绝且不触发新变更、`stopQuickChatOwner` 发布终态并退订。
  - 75 Node 测试全数通过；`cargo test quick_chat::`（5 tests）与 `cargo test chat::`（35 tests）全数通过。
  - `cargo check`、`npx tsc --noEmit`、`git diff --check` 通过。
  - `npm run check:architecture -- --strict` 仅 2 处既有历史超限。

## Task #37 独立审查与交付记录
- 独立审查五项核心问题核实（含 file:line 证据）：
  1. 有界容器增长性核实：
     - `CommandLedger.results`: `src/features/chat/lib/panelController.ts:63` 限制在 `COMMAND_LEDGER_WINDOW = 512`，插入序淘汰最旧项；
     - `deleted`/`deleting`: `src/features/chat/lib/boundedSet.ts:16` 限制在 512，旧 ID 淘汰；
     - `unsaved`: `src-tauri/src/features/chat/runtime.rs:24-49` 限制在 `UNSAVED_LIMIT = 64`，超限先尝试持久化重试，仍失败则淘汰最旧并 `log::warn!`；
     - `seen`: 达到 4096 前先按过期时间清理，仍满 fail-closed；
     - 结论：确证全部长期容器均已具备明确容量上界与淘汰策略，内存无界增长点已消除。
  2. 水位拒绝误拒核实：
     - `quickChatRemote.ts:88` 在每次发送命令时使用 `++this.seq` 生成严格单调递增序号；
     - `panelController.ts:52` 校验 `seq <= this.highWater`：新命令序号必定大于 highWater 并推高水位；512 窗口内的重复命令直接命中 Promise 去重；仅当 seq 低于水位且已从 512 窗口中淘汰的重复/过时命令才被 fail-closed 拒绝（`chat_quick_capacity`）；无 seq 旧命令既不误拒也不推进水位；
     - 结论：正常命令不会被误拒。
  3. deleted 淘汰复活核实：
     - 会话删除在 SQLite 数据表中执行真实物理 `DELETE`；
     - 前端 `ChatController.deleted` 仅防范正在进行的并发 `api.list` 查询旧快照覆盖；
     - 当已删除会话在数百次操作后从 512 淘汰时，SQLite 数据库中该记录早不存在，后端无法返回该会话；
     - 结论：淘汰已删除 ID 绝不可能导致旧会话复活。
  4. 退出清理截断快照核实：
     - `useAppExit.ts` 与 `lifecycle.ts` 严格遵循四阶段：
       1. `suspendChatEditing` 设置 `suspended: true`，`stopQuickChatOwner` 取消待执行定时器并同步发送最后一次携带 `suspended: true` 的快照；
       2. `flushChatPersistence` 落盘草稿与持久化事件，失败显式中断退出；
       3. 后端 `drain_chat_until` 等待在途生成停止并刷盘；
       4. 仅在 `RunEvent::Exit` 最终执行时清理通道与快捷键；
     - 结论：通道不会在最后一次快照前或持久化前被截断。
  5. 搜索防抖与多选范围冲突核实：
     - `src/features/chat/api/ChatWorkspace.tsx:740` 在输入改变时同步调用 `historySelection.resetScope(...)` 立即清空多选状态，随后才触发 250ms 防抖；
     - 来源 Tab 切换同样同步重置多选范围；
     - 结论：多选范围始终在条件变更瞬间清空，防抖延迟绝不导致跨条件误删不可见项。
- 交付记录更新核实：
  - `CHANGELOG.md` 写入 TEMP 章节。
  - `docs/功能清单.md` 写入对应功能板块。
  - `.trellis/tasks/11-02-quick-chat-stability/implement.jsonl` 与 `check.jsonl` 已同步更新。
- 全量自动化验证通过（75 Node 测试 + 40 Rust 测试 + cargo check + tsc + diff-check + architecture-check）。

## 未执行（人工验收）
真实内存曲线、进程退出资源释放、后台/托盘唤起、多屏 DPI、中英文切换、真实供应商调用。开发版已被用户关闭（日志显示正常退出流程）。
