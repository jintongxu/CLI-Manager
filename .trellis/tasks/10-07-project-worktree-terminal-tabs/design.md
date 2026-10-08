# 项目 / Worktree 两层终端标签栏：批准设计

Source: approved plan `d225d1b055c5ea68a2e57b4abd67e6a4f907bd71aa28c0454d3533ca9a87d735`, approval r0002 (2026-10-07).
This document summarizes the approved plan, not a replacement proposal.

## Presentation and identity

- First row: one entry per stable project ID; equal names never merge. Only projects with visible sessions appear. Unbound sessions have a translated entry.
- Second row: all mode browses selected project; non-all status mode shows matching Workspans across all visible projects once (Todo #7 correction). No third row. Root remains distinct from missing/inactive/unresolved Worktree.
- Same-project multi-Worktree split stays one tab in `cross-worktree`; cross-project split appears once in every member project's `mixed-project` group.
- Project activation chooses that project's member session. Clicking another project's split member updates project selection. Grouping never rebuilds trees, changes mounted keys, or enlarges closeSessionIds.
- Environment and SSH identity remain session metadata, not first-row grouping axes.

## Interaction decisions (UI lane)

- Project switches restore the last Workspan/member target in current-window runtime memory only. Invalid memory falls back to first available target in existing Workspan order.
- Direct activation, notification jumps, closes and drag-induced activation synchronize project selection with the active session; do not create unrelated selection state.
- Superseded by Todo #7: only explicit project-button navigation exits global status mode; active-project changes and empty status results never reset it.
- Preserve explicit sidebar project/worktree/group scope; models only organize sessions supplied by visible layouts. A worktree scope is not widened.
- Plus inherits the active session's project, Worktree, environment and SSH host even when status filtering hides it. No active session uses the existing creation chooser. Invalid Worktree creation remains rejected.
- Close uses existing closeSessionIds and dirty-editor confirmation. Mixed tabs must communicate their other-context close scope.
- Groups follow first appearance; tabs within groups retain existing order. Drag does not change cwd/Worktree identity; existing scoped drag limits, merge and detach behavior remain.
- Keep horizontal scrolling. Overflow menus show Worktree affiliation; project/filter/group changes remeasure DOM and clear stale menu state.
- Project status totals deduplicate by session ID, including repeated/mixed memberships. Background project states remain visible.

## Scenario matrix

Model coverage: no sessions; unbound; same-name projects; root/multiple Worktrees; missing, inactive and wrong-project metadata; singleton, same-Worktree split, same-project cross-Worktree and mixed-project split; pseudo-session parent/editor/path identity; repeated session IDs and unknown IDs; valid/closed/out-of-scope recent targets; stable grouping; scoped membership and close IDs; WSL/SSH identity retention.
UI/integration coverage: project switches, notification jumps, filter empty results, plus inheritance, close-current and close-group, reorder/merge/detach, deep splits, overflow and narrow windows, sidebar expanded/collapsed/compact, focus mode, top/bottom bar, explicit scopes, zh-CN/en-US and keyboard/aria. Focused/other-window/unfocused, minimized/tray and hook installed/uninstalled states consume existing routing only; no routing/producer changes.

## Contracts / boundaries

Pure models in terminal domain; cross-feature consumption uses narrow `api/terminalProjectTabsModel.ts`. Reuse terminalProject identity resolution; no project-name guesses. Keep existing UI model fields until next lane migrates consumers. No dependencies, database, IPC, Rust, PTY, snapshot or notification-producer changes. Session objects, tree identity, visible-layout scope and closeSessionIds remain unchanged. Handwritten source <=2000 lines, no architecture exemptions.

## Gates and impact fallback

- Branch `wt/task-1007-1111` has no upstream; sync state unknown. No pull/push/merge/rebase/commit authorized.
- `maestro search "terminal project worktree tabs membership"`: only unrelated reference templates, code index uninitialized. Coding spec loaded; it governs explicit dev/build requests, none requested here.
- `.gitnexus` and runner absent. No graph risk conclusion; UNKNOWN remains unresolved. Fallback approved by briefing and triage guide: contracts plus literal symbol call sites.
- `buildTerminalContextOptions`: controller line 324 -> TerminalTabsView -> WorkspanTabBar. Retained legacy context-specific options, deduplicated counts only; new `buildTerminalProjectOptions` is project-only.
- `getTerminalTabScopeKey`: PaneTabBar lines 148, 157, 388 and workspanTabModel singleton context. Preserved exactly; it controls title ordinals as well as legacy selection.
- `buildWorkspanTabModels`: controller line 328 -> TerminalTabsView -> WorkspanTabBar. Return type now extends legacy model; new rich membership fields do not change current filtering behavior until UI wiring.
- `terminalScope.ts` and `useTerminalVisibleLayouts.ts`: existing pre-model filtering and close target ownership, confirmed unrelated to this implementation.
- Controller/view/bar: inspected call sites; deferred to UI lane, no edits here. Store merge/detach/reorder: confirmed no edits; existing terminalWorkspan tests reused.
- PTY/Rust/persistence/hook producers: confirmed unrelated via preserved identity and workspace restore contracts; no protocol edits.

## Verification / rollback

Focused mjs models plus existing Workspan tests, TypeScript check, independent strict architecture gate. UI/interaction and bilingual manual checks belong to later lanes and are not represented by static tests. Delivery records use TEMP and are deferred to Todo #3. Rollback only these model/UI changes; no migration required, no automated Git rollback.

## 用户批准的展示细化（Todo #4）

- 移除独立 Worktree heading 及组间额外边线/间距；保留 group wrapper、SortableContext 及原分组顺序。
- `terminalWorktreeBadge.ts` 按项目全部 supplied models 生成徽标，再进行状态筛选/overflow，避免状态过滤改变简称。
- 共用 compact helper 移到 `projects/api/worktreeMetadata.ts`；terminalTabsModel 保持原导出供旧调用使用。原任意 10 字符尾截断存在同尾碰撞，已改最短可区分 token suffix；完全同名、保留主/丢失/跨树/混合字样和二级 fallback 碰撞使用稳定 ID 及确定性序号兜底，不截断徽标。
- SortableWorkspanTab 原本只显示用途标题，不含行内 project/worktree metadata；没有再叠加 project 缩写或旧 context pill。只加一个附属徽标，title/icon 仍优先，title 保留 64–160px，超长唯一徽标按内容扩宽并沿用横向 overflow。
- h-7 tab、h-9 第二行及第一行 h-7 不变。2px 色线 absolute 放入 tab 内，无额外高度。
- identity 为所有成员 projectKey/worktreeId 去重排序集合，颜色不依赖显示名/简称/语言/标题/notification/selection。混合分屏在不同项目下显示同一色线；颜色可碰撞，是附属视觉提示，唯一文字徽标才是识别保障。
- 溢出列表同样采用行内徽标/色线，保留全上下文 title。单会话详细 hover 和 split wrapper 上所有成员完整上下文不删除。
- 第一行项目按钮、控制器、新建来源、tree/mount keys、scope/close IDs、显示序关闭修正及 drag 算法均不改。

本 lane 修改前重新执行知识/spec/impact gate：`maestro search "terminal worktree tabs" --wiki-only --limit 5` 无相关输出，coding spec 已加载；.gitnexus 不存在，`maestro kg impact WorkspanTabBar` 返回 graph uninitialized，风险 UNKNOWN。
按批准 fallback 阅读 frontend component/quality/visual 契约，追踪 WorkspanTabBar → TerminalTabsView renderTab → SortableWorkspanTab、compact helper、hover 及显示序 close callbacks；不把缺图视为低风险。


## 用户纠正：全项目状态筛选（Todo #7，替代旧项目局部筛选语义）

- 状态按钮移动到第一行。all 保留当前项目浏览；running/done/failed 在第二行展示所有 supplied visible Workspan 中匹配状态的结果，不限当前项目。
- 全局结果保持 backing Workspan 顺序，每个 Workspan 一次，跨项目混合分屏亦不重复。行内徽标同时标识项目及 Worktree，混合结果列出所有成员上下文；不恢复独立 Worktree 标题。
- 状态模式不因 active session/project、后台通知或空结果而自动重置，也不自动激活无关终端。显式项目按钮（包括当前项目）先退出状态模式，再调用原 runtime remembered project/member 导航。点击 all 恢复 active member 所属项目浏览，不自行跳转。
- 全局结果及 overflow 点击明确传入当前状态匹配 session；优先匹配的 Workspan active member，否则首个匹配 visible member。不得回退到上个项目不匹配的记忆目标。
- 通知更新重建结果与去重 session counts；row signature 包括状态 totals、成员状态及 rendered notification，用于 overflow 重测与过期菜单清理，结果 ID 不变时也生效。
- 显式侧栏 scope 和 tabHidden 始终是上界：只使用 useTerminalVisibleLayouts 提供的 visible members；隐藏/范围外终端不因全局状态而复活。Backing tree、mount keys、closeSessionIds 不改；左右/其他关闭以当前显示行计算，单项/overflow 关闭保留原 closeSessionIds。新建始终继承实际 active context，不取筛选最后结果。
- 本纠正替代此前“项目变更自动 reset 状态”“状态只看当前项目”的设计，不替代显式项目点击退出筛选的导航契约。

修改前 gate：已运行 maestro search "terminal status project tabs" --wiki-only --limit 5（无相关知识结果）、maestro load --type spec --category coding。maestro kg impact WorkspanTabBar 未提供可用 graph evidence，.gitnexus 缺失，风险 UNKNOWN。按批准 fallback 阅读 frontend component/quality 契约及 call-site：controller visible layouts/models → project selection hook → TerminalTabsView renderTab → WorkspanTabBar ordinary/overflow activation；drag-hover 无 explicit member 参数继续旧项目行为。API 通过 terminalProjectSelection/terminalWorktreeBadge 窄口跨 feature，未改 PTY/Rust/persistence/store 或通知生产者。No deps。

自动回归：scripts/terminalProjectTabsInteraction.test.mjs 执行实际编译 hook/component 回调（确定性 React 调度 harness）覆盖 A 无匹配/B 有匹配、mixed matching target/overflow、dedupe、稳定序、项目退出/all 恢复、通知 signature/count、empty 无导航、scope 上界及显示行 close targets。它不代表真实 WebView2 布局/键盘/拖拽/通知生命周期验证；人工检查仍需要双语、窄窗口、上下 tabbar、mixed pane focus、sidebar scope、empty/+ 上下文及通知后台更新。本 lane 不修改 CHANGELOG/功能清单，root Todo #9 负责交付记录。

## screenshot26 最终项目 × 语义（替代旧行末解释）

每个项目标签名称与状态后紧邻独立常驻 ×（与导航按钮为兄弟，不嵌套按钮），没有全局行末按钮；未选中项目也可直接隐藏，无目标仍显示但禁用。点击 × 不激活项目、不重置状态筛选。全部模式处理所点击项目在侧栏作用域内所有未隐藏的普通终端（即使该项目不在当前第二行）；运行中 / 已结束 / 失败模式进一步只处理精确匹配状态的成员。排除已隐藏及文件编辑器、子 Agent 记录、同步历史、临时 Pi 等伪会话，不使用整组 closeSessionIds 扩大目标，混合分屏其他项目不受影响。保留会话、后台进程、监听器及原分屏归属，侧栏可重新打开；彻底删除仍通过侧栏右键。双语 title / aria 包含所点击项目名称，专用样式不复用 ui-terminal-tab-close。

目标从全部 supplied scope-bounded models 按 option.key 生成，不从当前 selectedProject 的 visibleModels 生成。激活与隐藏为 compound chip 内独立兄弟按钮，wrapper 没有点击处理器；仅导航回调调用 setStatusFilter / onActivateProject。安全执行器、tree/mount keys、sidebar scope、通知生产者与 PTY 生命周期不改。
