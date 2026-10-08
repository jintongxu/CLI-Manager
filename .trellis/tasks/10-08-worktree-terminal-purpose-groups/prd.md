# Worktree 完整分组与终端用途命名

## 授权
用户确认推荐方案 B，并同意创建任务。Plan handoff: `e0d7cb2ea7e27f940f3230ff13a52dbb97e3bb13f9d636ec774182f866687f44`，记录版本 TEMP。

## 根因
创建入口把 Worktree/项目/来源终端名称写入新终端标题；Pane 另按当前顺序加工标题，顶层 Workspan 直接使用原标题，导致环境名称重复与用途名称不一致。修复创建命名、继承与显示层，而非截断用户名称。

## 需求及验收

自动化交付完成（2026-10-08）：最新命名/创建/保存故障定向 66 项与分组/布局/交互 38 项通过；此前历史继续/CLI身份与拖拽定向结果仍有效。tsc、严格架构、diff-check通过。Chromium真实CSS隔离夹具8例：窄/宽窗口、100%/150%、top/bottom，标题完整、底线齐、主体无重叠。独立审查3项确认问题已集中修正。

人工待验收：实际Tauri退出重启、中英文设置切换、真实SSH、鼠标拖拽及主题。未启动应用，不将隔离夹具或mock等同实机验收。既有Web menu测试3项初始化失败（mock缺WEB_GIT_READ_KINDS），新增Web创建测试通过，本次不扩大该测试修复范围。

证据：`agent://5fbb33fb-9373-4efc-a5f4-88b84ac09a59`（命名修正），`agent://860d4bb7-5169-46b8-8921-faa46f0de315`（完整标题碰撞修正），`agent://1c02ef0f-d9d0-440d-a53f-593fffa2dd87`（布局），`agent://fa1e2eaf-bd45-42f6-9282-92d157d611dd`（命名首次交付）。本次无新增持久知识候选：同步提交边界与旧标题来源保护已是批准约束，不重复登记为新知识。
- [x] 新建真实终端默认用途＋创建时稳定序号；同项目/Worktree及用途内分配，当前及待恢复记录参与，同步成功提交不重号。彻底删除最高号后允许复用，不引入持久counter。
- [x] 新建/复制/分屏继承既有有效环境和启动意图，不复制标题/命名元数据；空分屏仍空Shell。
- [x] 用户改名、任务名及无来源标记旧记录原样保护；项目/树改名不覆盖终端，attach/重建保留命名及CLI/远端身份。
- [x] 完整 Worktree 名作为组标题自然换行，无省略/截断；用途标签位于下方，不重复短徽标，保留身份色线。
- [x] 项目分组排序及全局连续上下文段保证每个Workspan一次、全局backing顺序不变，cross/mixed全部可见归属；关闭/激活/侧栏scope不变。
- [x] 本体/slot动态高度、top/bottom停靠、单横向滚动及溢出列表完整分组标题、测量/插入线适配。
- [x] 定向命名/入口/恢复/模型/交互/布局测试，类型及严格架构通过；不运行无关全量suite。
- [x] TEMP CHANGELOG、功能清单对齐，人工未执行项准确记录。

## 场景
主仓库/有效或失效Worktree/子目录；已有树追加/新隔离/普通和项目分屏/复制；单多会话/深split/cross/mixed；全局状态/空结果/同名实体/隐藏scope；实际Shell与CLI、WSL/SSH、空命令；auto/custom/task/legacy与daemon/重建；长中文/连续ASCII、中英、窄窗口/缩放/top/bottom/焦点模式/失焦恢复。

## 边界
不改 Rust/PTY/IPC/SQLite/Worktree生命周期、Hook协议、CLI恢复身份；不批量猜测改旧名，不新增依赖。上一版72px省略方案精确撤换；不reset无关变更，不操作Git同步或提交，不自动启动应用。

## 影响发现
创建：useSidebarController/useTerminalTabsController/CommandPalette/useKeyboardShortcuts/历史SSHWeb入口。数据：terminalStore/types/sessionStore/terminalStatus。显示：terminalTabsModel/PaneTabBar/workspanTabModel、project grouping/selection、WorkspanTabBar/TerminalTabsView/SortableTerminalTabs、overflow hook与slot/bar/theme CSS。GitNexus unavailable（运行脚本与CLI缺失），按契约与文本降级，不宣称图谱通过。
