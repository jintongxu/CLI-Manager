# 真正退出应用时回收所属进程（TEMP）

## 授权与交付边界
- Approved Plan: `bcaf76ae3633e47245f54c6f473e205b05fb2d71790b729d59824f09a4e24862`，本任务由 Todo11 固定契约，Todo12/13/14 分别实现后端/前端/集成验收。
- Trellis 已以 `--no-start --meta version=TEMP` 创建；本阶段只写任务文档，不实现、不启动应用、不终止用户进程、不读取凭据、不提交。
- 当前分支 `wt/task-1027-2130-3c711d70c03c` 未配置 upstream；不执行同步。主题、侧栏、项目选择等既有 dirty 工作保留。
- 已执行知识检索并加载 `knowhow-tip-20261013-0006`：dev/release 同名，禁止 image-name kill。GitNexus CLI query 实际失败：`.gitnexus/run.cjs` 不存在；依据 fix-triage-guide §4 与 ai-architecture-contracts 降级契约+符号追踪。图风险为未解析，不是低风险。

## 根因（跨层根因修复）
前端把恢复开关解释为保活、后台退出跳过 PTY 清理，daemon 的 close-all 是全局且没有实例所有权，ACK/false/吞掉的 close 错误却被当成可退出；native app_exit 又直接退出，导致 GUI、共享 daemon 与 helper 的寿命失配。修复必须落在创建时登记归属、停止时有界回执和 native 提交门禁三层，不能只删对话框。

## 用户行为
1. 真退出停止该实例所属运行资源，保存恢复信息；restore on/off 不改变停止义务。
2. 最小化/隐藏到托盘不是退出；取消确认不停止、不永久封禁新任务。
3. 偏好仅 ask/minimize/discard；旧 background 在加载、update、备份导入统一转 ask；discard 表示停止并退出，不删除恢复档案。
4. 运行中任务需清晰确认；失败显示实际资源及重试，不出现假成功，不提前丢失句柄。
5. 只恢复 metadata：CLI 原生 session ID resume 或新建普通 shell，不保留运行内存；匿名 Pi 不恢复，恢复关闭仍不恢复。
6. 不杀其他客户端资源、父 npm/Vite、外部服务或无归属远端任务，不扫描历史孤儿后批杀。WSL/SSH 只保证受管本机连接/树，不承诺第三方主动脱离监督的远端/WSL 后台任务。

## 决策与实施边界
精确协议、所有权证据与状态机见 `design.md`（规范性）；逐文件触点、测试名单和交付步骤见 `implement.md`。后端不得把前端 session ID 列表当授权来源；前端不得自行将 ACK、timeout 或 bool 转 canExit。

## 场景/验收矩阵
- [ ] restore on/off × 零任务/idle shell/运行 Agent/隐藏终端/后台 session：真退出统一关闭实例资源；布局保留符合原恢复开关。
- [ ] 窗口 X、托盘退出、显式 app_exit、native ExitRequested 共用门禁；托盘隐藏/取消无停止；重复请求同事务。
- [ ] 任意焦点、分屏深层、折叠/compact sidebar、workspan、focus-mode：不依赖可见 UI 列表，后台 owner registry 完整枚举。
- [ ] dev/release、共享 daemon、多客户端/多 socket：只清自身；共享资源返回 retained_shared；旧 daemon 返回 unsupported 而非全局 shutdown。
- [ ] PID 复用、进程已退出、断连/重连、新建与退出竞态：身份匹配、原子 admission、失败保留注册；无凭据日志。
- [ ] PTY close 失败、RPC 无响应、routing 活跃、reader join 卡住、helper 超时、metadata 保存失败：有界失败且不 canExit，重试仍持有证据。
- [ ] 本地 PowerShell/CMD/Pwsh/Bash、WSL、SSH/代理；主 repo/worktree/缺失路径、hook 开关不影响归属；远端独立服务明确不支持自动清理。
- [ ] 恢复 metadata 包含 cwd/CLI session ID/布局，退出不 clear；匿名过滤；旧 background 加载和导入转 ask。
- [ ] 自有测试进程树及无关对照进程验证；不使用用户 Agent 作 kill 测试。

## Todo11 完成标准
已固定可实施的 v1 所有权/退出回执协议、native guard、helper 停止边界、metadata 顺序和故障测试接缝；不以此文档声明运行时修复已完成。后续实现必须按验收勾选并更新 TEMP CHANGELOG 与功能清单；桌面双实例/真实退出内存验证由用户授权测试实例完成。
