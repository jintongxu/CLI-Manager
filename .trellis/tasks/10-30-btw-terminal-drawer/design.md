## 最新范围 2+3（覆盖下方历史设计）

边界原因：全局 embeddedId/staging 与组件局部 collapsed/无条件流式 scrollTop 不具备终端生命周期和读者意图。状态落在 owner BtwThreadModel：terminalViews 保存 staging/source/selection/open/collapse，readers 保存 thread 阅读位置/follow/content/unread；thread.draft 沿用现有持久化。controller 响应 activeSessionId + sessions 更新，关闭 terminal 清理 UI 记忆，保留 pending 请求及其 generation fence。历史查询保留所有终端选中 thread 和非空草稿，避免切换后读入旧副本。

触点清单（符号 fallback）：BtwThreadModel stage/selectEmbedded/activateTerminal/reconcileTerminals/loadHistory/remove/clear；useTerminalTabsController 终端切换/关闭/打开路由；BtwTerminalDrawer 恢复 reader/scroll/latest/ResizeObserver；新增纯 btwBottomFollow 转换函数；双语 locale、确定性测试、TEMP/功能清单/task 记录。已确认无关：TerminalTabsView 现有隐藏布局无需改；BtwSideQuestionPanel scoped history/new question/embedded routing 无需改；source resolver、repository SQL、native protocol/bridge、后端 IPC/DB、退出子系统均不改。保留无关 workflow logs、markdown navigation test、output 证据。

阅读规则：新提交默认 following；首次手动历史选择 non-following/top；内容更新仅根据已保存 following 决定跳转，不按更新后 scrollHeight 猜测意图。scroll 更新读者意图；ResizeObserver 处理可见性/布局变化，仅可见 geometry 恢复目标；卸载不覆盖 saved offset。完成块和 hidden 更新在重现时统一比对。初始 staging 与 UI 记忆不跨 owner 销毁/应用重启；既有 thread/follow-up persistence 不变。

# 设计与触点

## 最新追加批准：侧问记录入口（覆盖下方旧侧栏不变说明）

根因/边界：原侧栏把 composer、全局 history 与 native open 混为一条主路径；现将 history 投影与 owner selection 分开。仅展示 activeSessionId 精确 terminalId 的记录，持久化查询在 LIMIT 前加 source_terminal_id 条件，UI 再过滤合并保留的 live entries，搜索覆盖题目/引用/消息/草稿/流式答案。新增 createdAt 映射复用既有 created_at 列，不迁移数据库。

触点清单：toolbar 使用既有 MessageSquare 与双语 label/tooltip；BtwSideQuestionPanel 改为历史优先并复用 Popover 收纳低频操作；TerminalTabsView 两种侧栏都传 onOpenReader；controller 只切回 terminal 并打开 reader，工具栏切换不再 stage；BtwThreadModel 的 selectEmbedded 与 submitEmbedded 共用 embeddedId，不碰 openVersion；repository 仅扩展过滤参数与时间映射；locale、定向 tests、TEMP 文档更新。确认无关：native hook/protocol/bridge/backend IPC、source resolver、终端右键来源捕获、其他终端模式、旧 Markdown 导航脚本与 workflow/evidence 不改。

场景矩阵：当前/其他/分屏/Workspan 切换均按 active terminalId 展示，新建显式捕获该 id；无当前终端为空列表且禁用新建；selected thread 不因切侧栏重 stage；搜索/归档隐藏记录不删除 owner pending/context/native/embedded 线程；历史恢复保留 messages/draft/status/source，只有明确 popout 调 open；reader 关闭/收起/临时 Git 隐藏仍沿用原行为。Local/WSL/SSH/无 hook/Worktree 不重新推断 source 或放宽继承，窗口焦点/最小化/托盘/native owner 语义不改。真实焦点与系统窗口效果未验收。

知识检索已先执行，无相关项目命中（BM25 fallback）；GitNexus runner `.gitnexus/run.cjs` 缺失，impact 命令 MODULE_NOT_FOUND，按 triage、architecture/history-session 契约及符号调用链 fallback，图风险未知。

用户追加批准：以终端右侧分栏替换底部抽屉，提交前提供继承开关，完整复用 Markdown 预览链。原 task 扩展，不建新 task。GitNexus impact 已重试，`.gitnexus/run.cjs` 缺失，按架构/history-session 契约与符号文本核对；图风险未知，不宣称低风险。

## 根因与场景

根因：内嵌线程身份原由可卸载组件局部保存，而新引用 staging 属于 owner 模型；两个生命周期没有统一边界，导致新引用仍显示旧线程、Git 隐藏后丢失绑定。修复落在 owner 的 embeddedId/stageVersion 与持久 draft，而非在 UI 猜测 quote 是否变化。

场景矩阵：当前/其他/深层分屏使用右键捕获 terminalId，不按焦点推测；切换终端/Workspan 不改变已建线程来源；同引用重复 stage 也新建 composer；Git 临时隐藏保持挂载，真实重挂载从 owner 恢复；关闭/收起不停止生成，新 stage 不取消旧线程；本地 Pi 精确身份可 opt-in，非 Pi/未绑定/已移除/SSH/WSL 禁用继承；runtime identity 覆盖旧保存身份；Worktree 与 hook 未装场景不按 cwd/title 推断来源；最小化/托盘与其他窗口不新增行为，原 owner/native 生命周期保持；真实焦点、布局、native、clipboard、语言切换仍待人工验证。

## 关键边界（读源码确认）

- `lib/btwThreadModel.ts`：`stage/setQuestion/submit/send/stop/setDraft/open/clear` 已齐备。`submit()` 目前返回 void，抽屉需要在提交后拿到新 thread id，因此**扩展为返回 `string | null`**（向后兼容：现有侧栏与测试忽略返回值）。
- `open(openId)` 会递增 `openVersion`，native owner 据此 reveal。内嵌分栏禁止调用 open，改用 owner 的 embeddedId；submitEmbedded 只修改内嵌选择。
- `stage()` 会快照 `source.terminalId/sessionId`，因此切换终端不会把旧问题串到新会话；抽屉只展示该 thread 自身来源。
- 复用 SessionTranscriptContent variant=terminal、terminalCodeTheme 来自 useTerminalPreviewTheme、markdownClassName=subagent-transcript-markdown，已完成/流式回答一致；复用 btwThreadText、BtwContextDetails。

## 触点与改动

1. `hooks/useTerminalTabsController.tsx`
   - 新增 `btwDrawerOpen` 状态与 `closeBtwDrawer`。
   - `onAskBtw` 处理（约 1796 行）保持 `stageFromTerminal(quote, sourceTerminalId)` 后**追加** `setBtwDrawerOpen(true)`。
   - 侧栏 `onBtwOpen`（约 1222 行）**保持原样**，不联动抽屉。
2. `components/TerminalTabsView.tsx`
   - 在 TerminalWorkspaceFrame 的终端子区域内包 flex row，左侧终端列、右侧分栏，避免定位越过 side panel；Git 用 display:none 暂隐但不卸载。
3. 新增 `components/BtwTerminalDrawer.tsx` + `btwTerminalDrawer.css`
   - 头部：状态点 + 模式（继承/独立）+ 收起/展开 + 关闭 + 停止（pending 时）。
   - 输入栏绑定 staged question 或 owner thread.draft；Enter 提交、Shift+Enter 换行；提交调用 submitEmbedded。继承开关默认关闭，在模型层拒绝无效来源开启。
   - 回答区走上述完整预览渲染链，pending 包括 contextLoading，停止读取/生成均清理句柄并 generation fence。
   - 追问：`model.setDraft(id, text)` + `model.send(id)`；`send` 的统一前置校验保持不变。
   - 复制：`copyTextToClipboard(btwThreadText(thread))`。
   - 收起：组件内 `collapsed` 状态，收起时只渲染头部，thread 引用不释放、流式继续。
   - 宽度：指针 capture（无全局 listener）与左右键调整，280–760px，宿主最多 60%；不新增持久化契约。
   - `Esc` 仅在抽屉内元素获得焦点时收起，不劫持终端全局 Esc。
4. i18n：`src/shared/i18n/messages/terminal.zh-CN.ts` / `terminal.en-US.ts` 增补 `terminal.btw.drawer*` 键，双语齐备。
5. tests：可执行 owner 模型 + 组件 hook 生命周期 harness，覆盖重 stage、折叠恢复、重挂载、草稿、继承和读取取消、历史查询；静态断言仅补充布局/完整 renderer 链。
6. btwSource：已移除 terminal 不采信残留 tabStatus；既有 runtime identity 优先及 remote 拒绝保持。
7. loadHistory：保留 embedded/活动 request/context 对象身份，避免侧栏查询把正在推理的线程驱逐或恢复成旧副本。
8. 已确认不改：useBtwNativeWindow/btwWindowProtocol、BtwSideQuestionPanel/BtwThreadDialog、side_question IPC 与后端持久化、终端 Markdown 导航测试及既有 workflow/evidence。

## 保留契约

- `side_question_*` IPC、上下文继承失败即失败不降级、thread 持久化与 pinned/archived、native window 单 owner/epoch/revision 栅栏、终端 mark/link 导航契约全部不变。
- 不改架构层级：新增文件落在 `features/terminal/components`，不新增跨域聚合入口。
