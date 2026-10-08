# 标签栏按项目切换并按 Worktree 分组终端

## 背景

当前标签栏第一行以「项目 / Worktree」组合区分上下文，第二行仅显示当前组合下的终端。同一项目打开多个 Worktree 时，项目名称重复，也不便查看整个项目已打开的终端。

## 需求

- 第一行按不同项目区分，显示项目名称，不为同一项目的不同 Worktree 重复创建项目标签。
- 第二行在 all 模式显示当前项目下各 Worktree 已打开的终端；非 all 状态显示全部可见项目的匹配 Workspan（Todo #7 用户纠正）。
- 第二行应清楚区分终端所属的 Worktree；拟采用轻量分组展示，具体交互待规划确认。

## 待规划确认的交互

- 切换项目时恢复该项目最近使用的终端。
- 项目标签汇总运行、完成和失败状态，确保非当前项目的通知仍可感知。
- 新建终端时明确所属 Worktree。
- 分屏与现有工作区组织保持兼容，切换项目不自动拆散已有分屏。

## 场景覆盖

规划需覆盖：单项目、多项目、主目录、多 Worktree、同名终端、终端数量溢出、无已打开终端、当前终端关闭、项目与 Worktree 切换、新建终端、分屏与跨上下文工作区、拖拽排序、后台状态通知，以及中英文界面。WSL、窗口焦点和 hook 安装差异对上下文归属与通知的影响需在调研后明确。

## 验收标准

- 同一项目只出现一个第一行项目标签。
- 显式项目点击退出全局状态筛选，恢复该项目 remembered member；all 第二行展示当前项目终端，非 all 全局结果同时标识项目与 Worktree。
- 第二行可直接激活不同 Worktree 的终端，不必先切换第一行上下文。
- 不丢失或错误关联已有终端、工作区、分屏和通知状态。
- 新增用户可见文案兼容 zh-CN 与 en-US。
- 对改变的筛选与切换行为进行定向验证，并独立通过架构检查。
- 代码交付时同步更新 CHANGELOG.md 与 docs/功能清单.md；版本暂按 TEMP，用户另行指定时调整。

## 当前状态

用户已批准方案 d225d1b055c5ea68a2e57b4abd67e6a4f907bd71aa28c0454d3533ca9a87d735。design.md / implement.md 已记录批准设计、实施顺序及模型接口；Todo #1 为文档与模型 lane，UI/控制器及交付记录仍由 Todo #2/#3 完成。Trellis task 已进入 in_progress。

## 用户批准的展示细化（Todo #4）

用户明确拒绝第二行标签之间独立出现「主目录」及 Worktree 组名。
批准改为每个终端标签内短徽标及稳定细色线，不新增第三行或标签高度。
终端图标/用途标题保持主信息，第一行仍只显示项目。
徽标在同一项目内可区分，主目录为「主 / Main」，失效、跨树及混合分屏有双语标识；完整上下文保留 hover。
分组/显示序、scope、drag、分屏、通知及 RV-001 关闭目标不变。
Todo #5 独立复核、Todo #6 最终交付记录由 root 调度；本 lane 不改 CHANGELOG 或功能清单。


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

## screenshot26 用户最终纠正：每个项目标签紧邻批量隐藏 ×

每个项目标签名称与状态后紧邻独立常驻 ×（与导航按钮为兄弟，不嵌套按钮），没有全局行末按钮；未选中项目也可直接隐藏，无目标仍显示但禁用。点击 × 不激活项目、不重置状态筛选。全部模式处理所点击项目在侧栏作用域内所有未隐藏的普通终端（即使该项目不在当前第二行）；运行中 / 已结束 / 失败模式进一步只处理精确匹配状态的成员。排除已隐藏及文件编辑器、子 Agent 记录、同步历史、临时 Pi 等伪会话，不使用整组 closeSessionIds 扩大目标，混合分屏其他项目不受影响。保留会话、后台进程、监听器及原分屏归属，侧栏可重新打开；彻底删除仍通过侧栏右键。双语 title / aria 包含所点击项目名称，专用样式不复用 ui-terminal-tab-close。

复用现有 task；用户明确纠正已批准，不创建 Todo。项目导航（显式点击退出全局状态）与全局状态结果契约不变。复用安全 hideProjectTerminalSessions；每次操作前重检实时类型，只调用普通终端 hideSession，禁止删除或 PTY close。无依赖/Rust/协议/持久化改动，无 browser/dev 进程操作，无 commit/sync。
