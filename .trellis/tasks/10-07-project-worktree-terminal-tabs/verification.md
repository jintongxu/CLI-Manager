# 验证与交付记录

## 实现

- 项目 ID 第一行归并；第二行按主目录 / Worktree / 失效 / 跨 Worktree / 混合工作区分组。
- 当前窗口最近工作区与成员恢复；活动终端驱动项目选中；新建继承实际活动终端。
- 保留 backing tree、挂载键、侧栏 scope、closeSessionIds 与既有拖拽算法。
- 双语文案、aria、分组样式与溢出重测量；TEMP changelog 与功能清单已更新。

## 自动检查证据

- 模型阶段：模型与 Workspan 测试 22/22；tsc 与严格架构通过。
- UI 阶段：模型、交互、Workspan 与拖拽测试 30/30；tsc 与严格架构通过。
- 审查修正后：`node --test scripts/terminalProjectTabsInteraction.test.mjs scripts/terminalProjectTabsModel.test.mjs scripts/terminalWorkspan.test.mjs` 29/29，`npx tsc --noEmit`、`npm run check:architecture -- --strict` 与 `git diff --check` 通过。
- 上述为展示细化前的阶段证据；后续 Todo #4/#6 修改使旧最终检查失效，已分别重跑，见下文。拖拽算法未改变。

## 独立审查与修正

OCR 不可用（PATH 没有 ocr），降级为独立 teammate read-only diff 审查，覆盖 14/14 相关源码及测试文件。

RV-001 HIGH：分组显示顺序和后台模型顺序不同，原关闭左侧 / 右侧以后台数组切片，可能误关视觉上另一侧标签。同类问题也涉及关闭其他标签。

修正落点：由 WorkspanTabBar 根据当前项目 / 状态过滤后的 flattened 显示行产生明确关闭 ID，TerminalTabsView 的回调与 disabled 状态消费这些 ID；各模型原有 closeSessionIds 不变。

回归：后台 [A(root), B(worktree), C(root)] 显示 [A,C,B]，实际菜单回调 close-left(C) 只选 A，close-right(C) 只选 B；同时覆盖其他项目、状态隐藏项、scoped split 与 mixed close 范围、菜单锚点及禁用状态。

## 手动验证限制

本轮未启动实际 Tauri 应用，也未通过浏览器 / 桌面执行手动验收。实际中英文设置切换、窄窗口/上下置布局、键盘导航、Radix 行为、真实 PTY 新建继承、通知跳转、实际拖拽及 React 生命周期仍未手动验证。自动交互测试使用确定性 React/DOM adapter 执行实际编译后的 hook/component/menu 回调，不等同真实 React 调度、清理和浏览器布局验证。

## 影响与知识评估

GitNexus 缺失，图风险仍 UNKNOWN；按分诊规则使用契约与符号调用点确认，不将空图视作低风险。不涉及新增依赖、Rust、IPC、快照持久化或 hook 通知生产协议。

无提交、推送、同步或自动回滚。分支 wt/task-1007-1111 无 upstream。

本轮未新增正式知识候选（0）：RV-001 属于本次实现引入且已通过直接回归覆盖的显示序与操作序不一致，现有 scope / close 契约已有约束；保留任务级复盘，不重复登记为新的通用契约。

## 结果资源

- 模型：agent://df804eb2-fea3-4487-af17-967b28f323c8
- UI：agent://4235321f-649d-4b47-b066-d0417c0caaab
- 审查：agent://4a30ee81-0939-4904-867b-df238a98ecf7
- RV-001 修正：agent://0f0938dc-3830-438b-9f32-e6e67a429f13

## Todo #4 展示细化最终检查

用户批准由标签内徽标 + 细色线替换独立组名。第一行项目-only、原分组/排序/关闭目标保持。
最终 `node --test scripts/terminalProjectTabsInteraction.test.mjs scripts/terminalProjectTabsModel.test.mjs scripts/terminalWorkspan.test.mjs scripts/workspanTabBarLayout.test.mjs` 37/37 pass；tsc、strict architecture（1255 / 0 / 0）与 diff-check pass。
compiled tests 执行实际 helper/badge/bar/view/sortable 代码，检查无独立组名、唯一徽标（同尾/长名/重名/保留字）、mixed/scoped、语言/标题/通知/选中独立身份色及 existing close callbacks。
实际桌面/浏览器 layout、主题/对比、React 生命周期与 PTY 未人工验证；详见 implement.md 手动清单。未操作已有 dev job，无 commit/sync。

## Todo #6 徽标溢出审查修正与最终证据

- 独立展示审查：agent://ec3e716e-03dc-42e8-9cc6-479b990237d4，结论 approved、无 high/critical；本轮 RV-001 MEDIUM（与上文早期关闭顺序 HIGH 同编号但不同问题）：固定 w-72 菜单中 nowrap / flex: 0 0 auto 长徽标可能吞掉主标题并越过激活按钮覆盖关闭按钮。
- 编辑前已读取实际 WorkspanTabBar、SortableTerminalTabs、徽标模型、CSS、交互回归及本记录。GitNexus 不在 PATH；`maestro kg impact WorkspanTabBar` 返回图未初始化，风险 UNKNOWN。`maestro search --wiki-only --no-emb --limit 5 "Workspan overflow badge close scope"` 0 命中；coding spec 仅 dev 默认运行契约。降级到明确调用点：TerminalTabsView 渲染入口、controller/overflow 类型消费者、两处徽标 CSS 消费者；不初始化或同步图。
- 修正仅作用于 overflow：激活按钮内使用 min-w-0 / flex-1 / flex-col / overflow-hidden 文本列，标题占独立整行；次行徽标 max-width: 100%、min-width: 0、border-box、ellipsis。图标/状态及兄弟关闭按钮仍 shrink-0，完整唯一徽标同时进入徽标 title 与激活按钮上下文 title。主标签 h-7、原分组/排序/身份色/closeSessionIds 不变。
- 新增 compiled bar 回归使用两个超长完全同名 Worktree 与不同长身份兜底，验证唯一全文 hover、文本列/标题及 CSS 限制契约、独立关闭按钮，并实际调用激活/关闭回调确认 scoped closeSessionIds 不扩大。这是结构与样式契约回归，不是浏览器像素测量。
- `node --test scripts/terminalProjectTabsInteraction.test.mjs scripts/terminalProjectTabsModel.test.mjs scripts/terminalWorkspan.test.mjs scripts/workspanTabBarLayout.test.mjs`：38/38 pass，0 failed。
- `npx tsc --noEmit`：pass；`npm run check:architecture -- --strict`：1255 source files / 0 above 2000 lines / 0 new violations；`git diff --check`：pass，仅已有 analytics 文件 LF/CRLF 警告。
- CHANGELOG TEMP 明确说明独立组名与重复归属文字被替换；功能清单移除旧项目缩写/重复归属表述，准确记录项目-only 第一行、唯一短徽标 + 稳定 2px 线、图标/标题主层级与原分组/顺序/关闭 scope。
- 手动限制：未做任何实际浏览器/桌面/Tauri 检查，未声称像素布局或 hover 已人工验收；仍需检查极窄窗口、超长/同名徽标实际 ellipsis 和全文 hover、上下置、主题/对比、键盘/拖拽、Radix/React 生命周期与真实 PTY。原 dev 进程 bg-2-muxs1c33 留运行，未操作。未创建/推进 Todo、commit 或 sync。
- 本轮知识候选 0：本次局部布局缺陷由任务级样式契约回归覆盖，不新增通用处方或重复登记既有 scope 契约。


## Todo #9 全局筛选交付与 RV-GLOBAL-001 修正

- 全局筛选实现：agent://901f513c-9d62-4495-a096-89eb56e79843；独立审查：agent://1bfd34ec-2ff6-40a2-af1b-d32675b19861。审查 approved，无 high/critical，但 RV-GLOBAL-001 MEDIUM 已复现：P 的 (a, foo)、(b, foo)、(c, foo · a) 中 a/c 全局徽标相同。
- 编辑前 gates：`maestro search "global worktree badge collision identity" --wiki-only --no-emb --limit 5` 为 0 命中（daemon unavailable，BM25 fallback）；`maestro load --type spec --category coding` 仅 dev 默认运行契约，未请求运行；`maestro kg impact buildGlobalWorktreeBadges` 返回 graph uninitialized，风险 UNKNOWN，未初始化/同步图。读取批准设计、架构/组件契约及真实 helper/test；literal call-site fallback 确认唯一生产消费者 WorkspanTabBar 在状态过滤前接收全部 supplied models，ordinary/overflow 共用 badge；不涉及 PTY、Rust、store、持久化或通知生产协议。
- 修正：全局 project/worktree 单上下文全文先按去重稳定身份排序，在 case-insensitive used-label set 中消解生成兜底 / 字面名称碰撞；组合 mixed 徽标全文再按上下文集合身份做相同消解。必要时使用完整稳定身份及确定性 ordinal。不同上下文唯一，同上下文重复终端共用全文/身份色；模型或成员反序不改变分配。不改项目内 badge、状态目标、closeSessionIds 或 tree/mount keys。
- 新增 3 个 compiled-production 回归：审查复现与反序、字面阻挡第二级 fallback 强制 ordinal；root/missing 与 Main/Missing/Cross/Mixed 保留字、同名（含大小写）项目和字面项目兜底碰撞；mixed 分隔符导致的完整组合全文碰撞、重复上下文、成员/模型反序及输入不变性。
- 最终 focused suite：`node --test scripts/terminalProjectTabsInteraction.test.mjs scripts/terminalProjectTabsModel.test.mjs scripts/terminalWorkspan.test.mjs scripts/workspanTabBarLayout.test.mjs`：43/43 pass，0 failed/skip；`npx tsc --noEmit` pass；`npm run check:architecture -- --strict`：1255 source files / 0 above 2000 lines / 0 new violations；`git diff --check` pass，仅 LF/CRLF 提示。
- CHANGELOG TEMP 与功能清单当前终端归属章节已替代旧项目局部 reset 描述：第一行状态筛选，非全部跨所有可见项目且每 Workspan 一次，全部恢复项目浏览，显式项目点击退出全局，mixed 普通/overflow 激活匹配状态成员；活动项目、通知和空结果不自动 reset。显式侧栏 scope/tabHidden 仍为严格结果上界，新建沿用实际 active context，关闭按实际显示行与原 closeSessionIds。
- 手动缺口：本轮未启动/停止 dev，也未进行实际 Tauri/WebView2/浏览器/桌面验证；43 个自动测试不证明像素布局、双语窄窗/上下置、真实混合 pane focus、键盘/拖拽、Radix/React 生命周期、后台通知及真实 PTY 行为。上述仍需人工验收，不作手动通过声明。
- 知识候选 0：本次徽标碰撞已由批准的唯一文字识别契约约束，任务级回归涵盖，无新增通用知识处方。保留已有 dirty work，未创建/推进 Todo（root 拥有 #9），无 commit/sync，无 dev 进程操作。

## screenshot26 最终纠正：每个项目名称旁 ×

每个项目标签名称与状态后紧邻独立常驻 ×（与导航按钮为兄弟，不嵌套按钮），没有全局行末按钮；未选中项目也可直接隐藏，无目标仍显示但禁用。点击 × 不激活项目、不重置状态筛选。全部模式处理所点击项目在侧栏作用域内所有未隐藏的普通终端（即使该项目不在当前第二行）；运行中 / 已结束 / 失败模式进一步只处理精确匹配状态的成员。排除已隐藏及文件编辑器、子 Agent 记录、同步历史、临时 Pi 等伪会话，不使用整组 closeSessionIds 扩大目标，混合分屏其他项目不受影响。保留会话、后台进程、监听器及原分屏归属，侧栏可重新打开；彻底删除仍通过侧栏右键。双语 title / aria 包含所点击项目名称，专用样式不复用 ui-terminal-tab-close。

旧 80/80 为行末版本历史证据，最终版本另行重跑。真实 WebView2 像素、键盘、语言设置切换和真实 PTY 未人工验收；按 brief 不调用 browser 或操作 dev，root 将用 viewport null 验证。

最终纠正验证（screenshot26）：
- `node --test scripts/terminalProjectTabsInteraction.test.mjs scripts/terminalProjectTabsModel.test.mjs scripts/terminalWorkspan.test.mjs scripts/workspanTabBarLayout.test.mjs src/features/terminal/tests/terminalTabLifecycle.test.mjs`：80/80 pass，0 fail/skip；输出 `output/project-chip-correction-tests.log`。
- `npx tsc --noEmit`：pass。
- `npm run check:architecture -- --strict`：1256 source files，0 above 2000 lines，0 new violations。
- `git diff --check`：pass，仅已有 analytics/lifecycle LF/CRLF 提示。
- TEMP changelog / docs 功能清单已替换当前行末误解；无 Todo、browser、dev 进程、commit/sync 操作。
