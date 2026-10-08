# 执行清单与模型交接

Source: approved plan `d225d1b055c5ea68a2e57b4abd67e6a4f907bd71aa28c0454d3533ca9a87d735`.

## Approved sequence

1. Todo #1: Trellis design/implement and context manifests, task start, knowledge/impact fallback, pure project/Workspan models and focused tests.
2. Todo #2 (not implemented in model lane): project runtime memory and active-member synchronization, plus source, two-row bar, scope/close/drag compatibility, overflow, translations/styles.
3. Todo #3 (not implemented in model lane): affected integration/manual verification and TEMP CHANGELOG.md + docs/功能清单.md records.

## Model APIs ready for UI

`src/features/terminal/api/terminalProjectTabsModel.ts` is the narrow, pure cross-feature entry.
`terminalTabsModel.ts` explicitly re-exports project option/selection/grouping symbols for existing terminal consumers.

- `buildTerminalProjectOptions(layouts, sessions, projectById, worktrees, labels, notifications?) -> TerminalProjectOption[]`: stable first-occurrence project ID groups; session-ID-deduplicated counts, running/done/failed/attention; member metadata and session IDs. Never call legacy buildTerminalContextOptions for the new project row.
- `resolveTerminalProjectMembership(...) -> TerminalProjectMembership`: sessionId, projectId/projectKey/display label, worktreeId, root/worktree/missing-worktree kind, Worktree name/path/branch, environmentType and sshHostId. Reuses terminalProject parent/editor/path resolution. Unknown explicit ID stays distinct rather than merging with true unbound sessions. Physical directory health is represented by existing Worktree status, not a new filesystem probe.
- `buildWorkspanTabModels(layouts, sessions, projects, notifications, t, worktrees?, labels?) -> ProjectWorkspanTabModel[]`: legacy workspan/sessionIds/closeSessionIds/singleSession/title/notification/vendor/cliToolIcon/contextKey preserved. Rich additions: memberSessions, members, projectKeys, projectMemberships, mixedProject.
- Each `WorkspanProjectMembership` contains projectKey/projectId/project label, scoped sessionIds, activationSessionId, members and group metadata. A mixed Workspan has one membership per project; within a project it appears once.
- `WorkspanProjectGroup`: stable key, kind (`root`, `worktree`, `missing-worktree`, `cross-worktree`, `mixed-project`), worktreeId/name for singular Worktree groups. Root/cross/mixed localized labels are UI responsibilities; model exposes discriminants, not hardcoded copy.
- `resolveProjectWorkspanTarget(models, projectKey, recent?)`: validates runtime recent Workspan/session against supplied memberships, otherwise first available target using project's active member when possible.
- `groupProjectWorkspanModels(models, projectKey)`: first-appearance group order with stable model order; no tree/session/close mutation.
- `getTerminalProjectKey(projectId)`: collision-safe ID key with unbound separate from actual project IDs.

## Required UI migration details

Current consumers still type models as legacy WorkspanTabModel and use legacy contextKey; this lane intentionally does not change UI behavior. Update consumers to the rich interface above rather than rereading source or casting legacy types. Pass current `worktrees` and translated labels to buildWorkspanTabModels: the backwards-compatible omitted-Worktree argument cannot resolve active metadata and therefore marks explicit IDs missing. Project switch activation must pass both Workspan ID and membership session ID through existing store activation. Use full sessions for plus's active-session source; do not derive it from status-filtered tabs. Preserve upstream layout filtering and closeSessionIds.

## Evidence / verification

Executed:
- `node --test scripts/terminalProjectTabsModel.test.mjs scripts/terminalWorkspan.test.mjs`: 22/22 pass (6 focused model tests + 16 existing Workspan tests).
- `npx tsc --noEmit`: pass, old callers compile unchanged.
- `npm run check:architecture -- --strict`: pass, 0 violations / 0 files above 2000 lines.

Focused tests compile actual project identity, metadata, project-model, Workspan-model and legacy context code using installed TypeScript. Existing UI/store imports in terminalTabsModel and vendor/icon inference are isolated for Node; this is not a rendering test. No new dependencies. Drag hover handlers and algorithms unchanged; dragInteraction test not needed for this lane. Manual UI, actual directory health, PTY and Rust checks not claimed.

Task start/context validation results are recorded by task.py. Model lane stops after Todo #1; never execute #2/#3 just because dependency unlocks.

## Todo #3 review remediation: RV-001

Root cause: `WorkspanTabBar` renders a flattened project/status-filtered group row, but passed
an index from the unfiltered backing models. `TerminalTabsView` used that backing index/order
for directional closes, and used all backing models for Close others. The latter also widened
targets to other projects/status-hidden tabs.

Fix: `renderTab` now receives explicit left/right/other close-session IDs derived from the
exact displayed row. Menu disabled states and callbacks consume those IDs. Each target
model's supplied `closeSessionIds` stays unchanged; current/overflow closes and dirty-editor
confirmation remain wired to the existing handler. Mixed tabs keep their communicated mixed
close scope; scoped split IDs are not rebuilt from member/session IDs. Overflow-clipped tabs
remain in the logical displayed row (reachable through overflow), not status-hidden tabs.

Batch-command audit: Workspan Close others required the same correction as left/right.
There is no Workspan/pane/XTerm Close all tabs menu command. PaneTabBar batches use the
same filtered paneSessionIds as its rendered paneSessions; PaneLeafView/XTerm callbacks use
visiblePaneSessionIds and retain pane-local scope. Process-manager/socket/exit cleanup
`closeAll` is whole-process shutdown, not a tabs-row menu action, and is unchanged.

Regression compiles actual TerminalTabsView and WorkspanTabBar, calls the actual renderTab
and menuContent callbacks and invokes actual menu onSelect handlers with an anchor. Covers
backing [A,B,C] -> displayed [A,C,B], other-project exclusions, status exclusions, edge and
single-row disabled states, exact scoped split close IDs, and mixed-tab close scope. UI imports
are stubbed and React uses the existing deterministic shim: this proves callback target wiring,
not browser rendering, React lifecycle/cleanup or Radix behavior.

Knowledge/impact gates rerun: `maestro search "terminal tabs batch close display scope"`
returned only unrelated reference templates; code index uninitialized. Coding spec loaded
(unrelated explicit dev/build convention). `maestro kg impact WorkspanTabBar` reports graph
uninitialized, `.gitnexus` absent; risk remains UNKNOWN, not a graph-based low-risk claim.
Approved fallback: inspect contract plus literal renderTab/WorkspanTabBar and all close-menu
call sites in TerminalTabsView, PaneTabBar, PaneLeafView, XTermView and shutdown closeAll.
No new dependency, scope, storage or transport changes.

Passing commands after remediation:
- `node --test scripts/terminalProjectTabsInteraction.test.mjs scripts/terminalProjectTabsModel.test.mjs scripts/terminalWorkspan.test.mjs`: 29/29 pass.
- `npx tsc --noEmit`: pass.
- `npm run check:architecture -- --strict`: pass; 1254 sources, 0 above 2000 lines, 0 new violations.
- `git diff --check`: pass (existing analytics LF/CRLF warnings only).

No Todo creation/advancement, commit, sync, changelog or feature-list edits in remediation.

## Todo #4 实施与证据

已实现批准细化：移除独立组名，将唯一短徽标与 2px 稳定身份色线放入现有 tab；overflow 同步。
保留第一行项目切换、原有分组顺序、closeTargets、控制器/scope/drag/分屏。
新增 compiled pure/helper/render tests，使用实际编译的 badge/helper/bar/view/sortable 与双语 messages。
覆盖相同末尾、长名称、完全同名、保留字与 ID fallback 碰撞、重排序、scoped 与 cross/mixed split、语言/标题/通知/选中状态独立、无独立组名或重复 context metadata、title/icon 和 h-7 保持、真实菜单回调关闭目标。

最终检查：
- `node --test scripts/terminalProjectTabsInteraction.test.mjs scripts/terminalProjectTabsModel.test.mjs scripts/terminalWorkspan.test.mjs scripts/workspanTabBarLayout.test.mjs`: 37/37 pass（11 交互/细化，6 模型，16 Workspan，4 布局）。
- `npx tsc --noEmit`: pass。
- `npm run check:architecture -- --strict`: pass，1255 sources，0 above 2000，0 new violations。
- `git diff --check`: pass；仅已有 analytics LF/CRLF warning。

人工限制：shim render 不证明实际 React/Radix 生命周期、浏览器宽度/主题对比或 desktop PTY 行为。
需人工验证中英文、light/dark、顶部/底部、窄窗口 overflow、超长/同名徽标、split hover 完整上下文、键盘/drag 与 notification；正常/全屏无额外边距、背景图透明/blur/darken/fit/position。
未启动或停止 dev/Tauri job，无依赖/Rust/PTY/persistence 改动，无 commit/sync；保留先前 dirty feature；未执行 Todo #5/#6，未编辑 CHANGELOG/docs 功能清单。

## screenshot26 最终纠正实施（替代 Todo #10 行末误解）

根因：WorkspanTabBar 将“各项目名称后 ×”误实现为 selected-project row-end action，且只从 visibleModels 取目标，导致未选中项目无法直接操作。修正落在拥有 option.key 与 supplied models 的组件：每项 compound chip 包含导航与隐藏兄弟按钮；按 option.key 从 models 选择目标，保持状态与 sidebar scope 交集。

每个项目标签名称与状态后紧邻独立常驻 ×（与导航按钮为兄弟，不嵌套按钮），没有全局行末按钮；未选中项目也可直接隐藏，无目标仍显示但禁用。点击 × 不激活项目、不重置状态筛选。全部模式处理所点击项目在侧栏作用域内所有未隐藏的普通终端（即使该项目不在当前第二行）；运行中 / 已结束 / 失败模式进一步只处理精确匹配状态的成员。排除已隐藏及文件编辑器、子 Agent 记录、同步历史、临时 Pi 等伪会话，不使用整组 closeSessionIds 扩大目标，混合分屏其他项目不受影响。保留会话、后台进程、监听器及原分屏归属，侧栏可重新打开；彻底删除仍通过侧栏右键。双语 title / aria 包含所点击项目名称，专用样式不复用 ui-terminal-tab-close。

前置 gates：分支 wt/task-1007-1111 无 upstream，未同步/提交；已有 dirty feature 为本次明确复用基线，未覆盖无关工作。maestro search "project terminal bulk hide displayed sessions" --wiki-only --no-emb --limit 5 为 0 命中（daemon unreachable，BM25 fallback）；coding spec 已加载，仅 dev 默认启动契约，不启动 dev。maestro kg impact WorkspanTabBar 返回 graph not initialized，.gitnexus 缺失；风险 UNKNOWN，使用批准 contracts + symbol fallback，不声称图低风险。

发现清单：WorkspanTabBar（改 compound chip 与目标来源）；terminalProjectHide（仅补明确 scope 契约注释，算法保留）；TerminalTabsView -> controller handleHideProjectTerminals -> hideProjectTerminalSessions -> isHideableTerminalSession/hideSession（确认安全执行器不改）；useTerminalVisibleLayouts / terminalTabVisibility（scope 和 tabHidden 上界不改）；selection/global filters（不改）；CSS/i18n（改项目 chip，常驻 × 及带项目参数双语）；compiled interaction tests（改真实 view/bar 回调）；生命周期/PTY/Rust/store/persistence/drag（确认无改动）。

场景：selected/nonselected ×、all/global running/done/failed、无匹配、mixed、duplicate IDs、scope excluded、already hidden、editor/transcript/synced/ephemeral pseudo；local/WSL/SSH 继续既有普通终端 kind 判定，窗口/焦点/分屏/Worktree/hook 状态不新增路由。普通导航仍退出 filter，× 不调用激活或 reset。

定向 tests 编译真实 view/bar 回调，验证 2 个项目各自 ×、兄弟结构/无 row-end/无 ml-auto/无 ui-terminal-tab-close、未选中 all targets、每种 exact status、empty/pseudo/hidden/mixed 去重与 sidebar 上界；双语参数 label/title。已有 lifecycle 回归证明普通批量 hide 不 close/unlisten/delete，重开同 ID，不改变原 split，live kind 跨 await 重检。


最终纠正验证（screenshot26）：
- `node --test scripts/terminalProjectTabsInteraction.test.mjs scripts/terminalProjectTabsModel.test.mjs scripts/terminalWorkspan.test.mjs scripts/workspanTabBarLayout.test.mjs src/features/terminal/tests/terminalTabLifecycle.test.mjs`：80/80 pass，0 fail/skip；输出 `output/project-chip-correction-tests.log`。
- `npx tsc --noEmit`：pass。
- `npm run check:architecture -- --strict`：1256 source files，0 above 2000 lines，0 new violations。
- `git diff --check`：pass，仅已有 analytics/lifecycle LF/CRLF 提示。
- TEMP changelog / docs 功能清单已替换当前行末误解；无 Todo、browser、dev 进程、commit/sync 操作。
