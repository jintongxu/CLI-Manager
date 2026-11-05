# 实施与验证

## 最新：底部辅助终端
用户确认改为底部：独立shellOpen开关，移除右侧shell页签，中央列主Pi下方BottomShellPanel默认240px，拖拽/键盘调整、父容器clamp、最大化还原、独立收起；高度偏好auxiliaryTerminalHeight纳入显式同步策略。
81项定向测试、tsc及strict architecture通过。独立审查发现pointercancel恢复height但未恢复ref，已修并在7项UI测试中补取消后无移动点击回归通过。其余未受影响证据复用。额外workspaceBackgroundLayout旧WindowTitleBar正则断言失败，未改业务绕过。
实际开发服务1420已返回BottomShellPanel和TerminalTabsView更新模块（HTTP200）；尚未声称真机拖拽/焦点/双语验收。零新知识候选，代码未提交。

## 已完成
- 独立上下文解析与runtime owner，不改变主session/workspan，普通空启动命令、受管transient创建及严格关闭。
- 稳定portal host保留全部owner解析器，侧栏标签/入口/显示偏好和双语控制。
- 定向25项测试、TypeScript和strict architecture检查通过（独立审查前基线）。

## 独立审查与修复
审查结果 agent://c81fe427-2ccd-4bd2-a5d9-d174b56d3bd1：
1. Shell焦点下全局Ctrl+W可能关闭主Pi；需主快捷键焦点边界。
2. 受管候选清理失败后转普通恢复workspan，sidebar与PaneLeaf可能重复解析；需明确显示权转交。
3. project-bound会话不能因live cwd变为Worktree而改变侧栏根归属。
4. WSL Windows盘符根目录需支持native已支持的挂载转换，并保留发行版。
5. 窗口Alt-tab不能丢弃Shell逻辑焦点。

五项已修复：Shell DOM焦点边界在全局捕获阶段隔离主会话快捷键；窗口blur不再清除逻辑焦点；失败候选若转普通恢复工作区则sidebar不再渲染；project-bound上下文不从live cwd推导Worktree；WSL盘符通过共享路径helper编码发行版UNC。真实受管候选保留回归覆盖显示权转交。

最终定向回归56项通过（sidebarShell、exitPolicyPreferences、chatNavigation、terminalCreationContext）；TypeScript和strict architecture通过。额外发现terminalCreationContext旧测试在HEAD已有5项失败，使用git show内存基线确认后仅修正测试依赖及陈旧正则，改为实际回调行为断言。

## 侧栏空白反馈补修
用户截图34显示目录与关闭按钮但无提示符。已确认普通终端40列fit门槛不适配300px侧栏，单独参数化为侧栏8列，fit与resize一致，主终端默认40不变；7项续接测试验证28/20/8列、拒绝7列、普通40列与8行门槛。该证据不等同已确认完全空白的唯一根因。
按用户要求，本地侧栏明确使用pwsh；上下文/owner17项测试通过，类型和strict architecture通过。现运行开发服务确认已提供minTerminalCols=8模块，需关闭旧侧栏会话重开以应用pwsh并真机验证。

## 手工限制
新开发版Rust编译成功（0.96秒），但启动后立即退出，未得到可验收窗口。进程只读核对发现另一个task-1105-1105-f129c34111a2工作树的开发版及已安装正式版仍运行；疑似单实例拦截，未擅自结束其他窗口。尚未对新侧栏进行真实桌面、IME、WebGL、WSL/SSH及窗口托盘验收。未提交代码。

知识评估：稳定解析器、严格关闭和焦点隔离沿用既有契约，暂无需要单独沉淀的新知识候选（0）；审查与修复证据保留在任务记录。

## 本地干净 pwsh（用户确认后实施）
- 知识闸机：`maestro search --wiki-only --limit 5 'sidebar shell pwsh profile PTY'` 无命中；已加载 coding spec，遵守不启动/重启生产实例。
- 分诊：跨前后端启动策略需求。根因边界是 PTY 参数构造：空 startupCmd 仅禁止 CLI，不能禁止 profile 或应用 prompt/监控注入，所以在 owner 标记意图、后端首次 shell 启动处落地。
- 图影响前置：指定 wrapper 的 upstream impact 返回 CRITICAL，25 上游触点、5 直接调用、11 模块、0 已解析流程；索引落后 105 commits，不能当作完整实时图。当前源码确认生产调用 `create -> create_with_launch -> build_shell_args`，SSH 分支单独 build_process_launch，不走本地 shell 参数。其余直接调用为参数测试。owner 新符号索引 UNKNOWN，文本确认只从本模块 singleton 与 owner 测试构造。
- 场景：仅 local + pwsh 且无 sshHostId 设置标记，用户 env 的同名值不能覆盖；WSL/SSH/非pwsh 过滤同名标记。普通 pwsh 无标记维持现状；监控开关有无均不能覆盖 clean 参数。焦点、收起、分屏、最小化、项目/Worktree 切换、hook 有无不改变启动作用域，沿用现有 owner 生命周期，不修改 UI/目录/续接策略。
- 发现清单：sidebarShellContext 已确认不需改；sidebarShellStore 在唯一 create 调用构造临时环境；terminalSessionCreation 受管 transient 分支已确认不需改；terminalLaunch 的 env copy 保留标记，真实 resolver 测试确认空命令即使有 codex 扩展准备也不生成 CLI/供应商启动；PTY manager 添加 pwsh 精确标记分支并在 spawn 前大小写不敏感移除标记；SSH 独立启动、WSL 参数、普通终端路径已确认不变。
- 测试：JS 定向 56/56 通过（含新增 owner/真实 resolver 5 例）；`npx tsc --noEmit` 与 strict architecture 通过。Rust `cargo test --manifest-path src-tauri/Cargo.toml --lib build_shell_args -- --nocapture` 初次被运行中资源文件锁阻断（os error 32）；不终止进程，使用仅本次命令 `TAURI_CONFIG='{"bundle":{"resources":[]}}'` 禁用测试构建资源复制重跑，3/3 通过（新增2例+普通缓存prompt基线），完整 lib test 编译成功，有20条现有警告。
- 未提交、未重启生产、未进行真机 profile/交互验收；现有侧栏会话需显式关闭后重开才采用新启动参数。
