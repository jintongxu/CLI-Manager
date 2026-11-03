# 技术设计

## 唯一所有者
main WebView 的 chatController 保持唯一请求/草稿/流式所有者。现有 ChatController 是每 WebView 单例，不能在小窗再次创建真实控制器。保留 Rust chat commands main-only 授权。

小窗作为远程展示：抽取面板需要的结构化接口、注入远程适配器；main 提供受限操作与模型目录，避免小窗直读供应商凭证。桥接由 Rust 验证窗口身份，禁止依赖无鉴权全局事件作为授权。握手同步当前快照，单调版本拒绝乱序，唯一命令 ID/确认/失败反馈与去重防止重复发送。快照仅含当前展示所需数据，不广播全历史。

用户确认 A 取代共享 selected：快聊独立 quickSelected，main 唯一请求所有者。主界面继续先选择同一 ID 再导航。main 未准备好应明确未就绪并支持握手恢复。

## 窗口与热键
Rust 新 quick-chat 模块复用 translator 的单例窗口和全局快捷键模式；不 unregister_all。懒创建窗口，隐藏不销毁；焦点事件驱动输入聚焦。尺寸/位置保持并在显示时检查屏幕范围。主界面不因小窗打开而显示。

设置沿用 shared/preferences 持久化机制，默认 Ctrl+Alt+Space，可禁用和修改，冲突明确提示。原生命令最小授权；新入口 src/main.tsx 根据标签轻量加载。置顶独立于现有侧栏浮动模式。

## 触点
聊天 API、ChatPanel/Composer/模型目录、main App 侧桥接与导航；src/main.tsx；Rust quick-chat 模块、lib 注册和 capabilities；共享 preferences 与设置 UI、i18n、样式。PTY/WSL/Worktree/Hook 无关。

GitNexus 未安装（.gitnexus 不存在）；依据 fix-triage-guide 使用契约+符号检索追踪，零图结果不是低风险结论。

## 兼容/回滚
不改变 chat main-only IPC、持久化协议或已有主聊天行为。不新增依赖。禁用本功能即不注册热键、不创建窗口。退出复用主控制器 flush/drain。主要风险为跨窗口重复生成/乱序/权限；通过单所有者、身份约束、序号/命令确认和聚焦测试控制。

## 用户确认 A（取代早期共享选择设计）
首次成功 hello 新建 quick-chat 会话，与 main selected 无关；重复 hello/隐藏/重开保留 quickSelected。非选择式 create/loadDetail，显式投影与命令校验；删除后恢复。同 ID 继续先 main select 再导航。不可变持久化 origin=workspace/sidebar/quick-chat，旧行/旧 Create 默认 workspace，fork 保留，Update 禁止修改。追加 v58，历史 schema.sql/v55 不变；测试执行增量 SQL。工作区左侧历史三分组，保留搜索分页置顶重命名删除，拖拽仅组内；快聊仅快聊历史。快聊默认 medium，显式 off 保留。无新依赖/自动剪贴板/安全放宽/用户 DB 重置。

## Approved Todo12 correction — migration identity / fail-closed readiness
- 根因确认：SQLx SHA-384 校验原始 SQL 字节；历史 v55 checkout CRLF 与 HEAD LF 不同。v55 不增加 origin；origin 仍只由 v58 添加。v55/v57 使用显式转义 LF 的 concat 字节常量，v58 同样固定 LF，避免 checkout 改变运行身份。
- 唯一兼容例外：现有固定 app_paths 修复入口只识别 v55/v57 的精确历史 LF/CRLF 等价变体、正确 description、success=1，以及与规范迁移生成的 sqlite_master 表/索引（包括约束）完全一致的 schema；v55 仅允许规范 v58 origin 扩展。未知 checksum/身份/失败 marker/schema 直接失败，不写入，不禁用 SQLx 校验。
- 仅需修复的变体先 SQLite VACUUM INTO 一致备份（含 WAL），BEGIN IMMEDIATE 下重新验证并带旧 checksum/identity/success 条件 UPDATE；任何更新失败事务回滚恢复 marker，备份保留。规范 LF marker不改写。测试数据库全为临时合成，无用户 DB 修改/重置。
- getDb 首次加载失败在同一进程永久缓存拒绝（避免 SQL 插件消费迁移列表后重试假就绪）；恢复需要 root 管理的完整进程重启，不自动重试/杀进程。repository 在空表时也验证所有会话/消息字段含 origin，decoder 使用 try_get 并传播错误，非法 origin 不默认 workspace。
- quick hello 在 owner 不 ready 时先拒绝，不查模型目录/新建/发布 ready；不以缺模型掩盖 DB 失败。main-only 授权、独立 quickSelected、三来源分组、medium/off 设计不变。GitNexus absent，使用契约和源码调用链降级；不新增依赖/提交。

## Screenshot19 — bounded shared stream correction
Root boundary: provider SSE → shared internal text stream. The source requested reasoning yet rejected official reasoning lifecycle/final output and nullable Chat refusal. This proves decoder incompatibility, NOT the exact live Screenshot19 trigger: selected protocol, MIME, rejected event/keys are unobserved. No API calls, credential reads or live replay performed.

SDK evidence read locally: openai 7.19.0 resources/responses/responses.d.ts ResponseReasoningItem, reasoning summary/text events, content-part reasoning_text union, output-text annotation union; resources/chat/completions/completions.d.ts Delta.refusal?:string|null. @anthropic-ai/sdk 0.129.0 resources/messages/messages.d.ts ThinkingBlock, RedactedThinkingBlock, ThinkingDelta, SignatureDelta. Only these standard reasoning types are discarded. No provider-specific reasoning_content/reasoning extension, agent/tool execution or automatic retries added. Actual refusal retains chat_protocol instead of successful empty output; tools/unknown/malformed typed payloads fail closed. Reasoning never enters Part::Text, UI, repository or outbound history.

Terminal contract: first valid terminal frame closes the stream. Decoder and run both ignore all subsequent bytes (including comments or data), for every partition; no trailing payload is parsed/rendered. Pre-terminal EOF and bounds/cancel remain enforced. MIME now compares an exact case-insensitive media type before optional parameters (rejects prefix lookalikes). Safe rejection logging emits only local Protocol enum, fixed reason=event_payload/content_type and numeric HTTP status; no upstream type/key/value, URL, MIME/header value or exception is logged. These diagnostics distinguish the gate but deliberately cannot identify a provider extension; exact live cause remains unknown.

UI root: shared Select always supplied ui-input chrome and ChevronDown; theme palette selectors can override a plain local transparent class. Added default-preserving unstyled/showChevron props; only ChatPanelSurface reasoning opts out. Radix Trigger/Value/items, aria label, keyboard behavior and visible local focus outline remain; history and all other selects keep defaults. Sidebar and quick reuse this same surface. No new user-facing text.

Touchpoints checked: stream decoder/request/run, existing runtime text/empty/error persistence, chat main-only commands, panel/quick shared presentation; provider resolution/controller/owner/transport unchanged. No DB, permission, hotkey, PTY/WSL/Worktree/Hook changes. GitNexus absent; Trellis triage/delivery contracts and direct call-chain/text fallback. Dirty implementation preserved; no dependencies, nested delegation or commits. Branch has no upstream; no sync operations. New cohesive stream_tests module keeps files below 2000 lines.

## Latest explicit scope — source tabs and retained Expand
Supersedes the earlier stacked three-group presentation only. Left history uses keyboard-accessible workspace/sidebar/quick-chat tabs, default workspace, mounting only active source rows. Navigation source is explicit presentation state via chat/api/historySource and workspace/api/primarySpaceState; AppWorkspace passes controlled source/change props. Normal setSpace("chat") resets workspace; sidebar Expand supplies sidebar; quick owner continues same ID then awaits callback("quick-chat"). No selected-origin-following effect. Manual tab changes do not select another conversation or mutate origin. Main New always creates workspace and activates workspace after success. Existing sidebar expand/panel visibility behavior is unchanged.

Quick Expand waits for draft flush, main same-ID selection and explicit source navigation acknowledgment, then invokes native main action. Native show → unminimize → focus → hide chain is fail-fast; any reveal failure leaves quick visible for retry. Hide retains WebView/draft/images/run, no close/destroy/cancel. A pure Rust sequence helper covers every failure position and success. Permissions/DB/stream/provider behavior unchanged.

## TEMP increment — scoped multiselect architecture
`lib/historySelection.ts` owns ephemeral selection, scope=(source,search), frozen confirmation IDs, synchronous admission lock and sequential bounded result {succeeded,failed:{id,error}[]}. React subscribes to immutable snapshots. Scope reset clears selection/dialog; an admitted operation still finishes its captured list, suppressing stale selection/results after navigation. No new IPC/schema/dependency.
`components/HistorySelectionControls.tsx` owns toolbar, localized count/result and shared Radix dialog (focus trap/Escape/cancel/focus restoration; busy dismissal blocked). ChatWorkspace renders label+checkbox rows only in selection mode, clears drag/context/menu, preserves ordinary button rows/pin/history/pagination/single delete outside mode. Source/search/New/paging locked while confirmation or batch is pending. Search filters loaded titles locally while list responses are pending; useMemo includes search.
Every target calls ChatController.remove (stop then queue/latest revision delete). Cleanup now also removes draftStatus. A queued stopped terminal refresh skips deleting/deleted rows; only chat_not_found after acknowledged local deletion is obsolete, unrelated failures still propagate. Missing delete/get remains failure, not guessed success. Quick owner subscription uses existing one-replacement recovery; replacements never join the captured batch.
