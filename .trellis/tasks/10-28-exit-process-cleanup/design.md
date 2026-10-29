# Exit ownership / receipt v1 — normative contract

## 1. 已有证据及最小新增
`server.rs::ClientHandle` 只有 attached/flow/replay；client_id 是每个 TCP/WS 连接分配的 u64，不是 GUI 身份。`handle_create` 只建立订阅；`CloseAll` 调 `host.pty.close_all` 并清全表。`AuthOk` 有 pid/features，无 owner。`connect_or_spawn` 先复用 discovery；spawn 丢 Child。`routing` 是 Host 单例，无 client owner。因此不能把连接、attached、发现文件、session ID 或“我曾 spawn daemon”当独占证明。

采用最小的**实例 owner 登记 + 资源 owner 集合 + 退出事务**，不引入通用租约/调度系统。PTY 与 web-device 是两个独立 daemon，各自同语义注册，不强行合并运输协议。

### 身份
- GUI native startup 生成随机 `instanceId`（每进程全新，不从 settings/backup 恢复）和进程 identity（PID + OS start-time + 可执行路径诊断信息）。保留可等待的 OS process handle；PID/path 单独不够。
- daemon 每次启动生成 `daemonEpoch`；握手 feature `owned_exit_v1`，返回 epoch/PID/start-time。GUI 在发现/握手后获取并校验 handle；新 spawn 保留 Child，验证 handshake 为同一子进程。路径不是杀进程授权。
- 已有认证后，native 控制连接发 `RegisterOwner {id, instanceId, processIdentity}`；daemon 返回随机 `ownerToken` 与 epoch。token 仅内存，不写日志/备份。native 与前端 WS 使用同一 owner，不按每条连接新建 owner。原有 token 认证继续生效；ownerToken 是隔离能力不是替代鉴权。
- `BindOwner {id, instanceId, ownerToken, daemonEpoch}` 将 TCP/WS 连接绑定 owner。IPC 返回 WS 连接信息时仅授权本实例主窗口，沿用既有 BTW 窗口拒绝策略。所有新受管资源在 spawn 前必须绑定 owner。
- native 控制连接保持 owner 注册；断连不等于 owner 死亡，保留其资源和记录，允许相同 token 重连；用 OS identity 确认进程死亡，不凭 socket 超时扫杀。无法确认死亡的 owner 仍阻止 daemon 全局停止。崩溃孤儿自动回收不属于本次范围。

### 资源规则
- 会话：`handle_create` 在现有 worktree admission 后、reserve 与 spawn 前原子取得 owner admission；登记 `sessionId -> owner`（包括隐藏会话）。失败撤销；退出同时发生必须等待在途 spawn 注册完成或取消并回收，不能越过 fence。
- attach 只是观看/订阅，不转让 owner；其它实例不得 claim 旧活 session，也不能用 list/attach 建立杀权限。正常重连同 owner 可 attach。新启动恢复默认 metadata recreate，不 adopt 旧会话。跨实例 attach 维持观察能力但写/close/resize 等变更须 owner 校验；旧协议客户端新建资源标为 legacy/unowned，不猜归属。
- 共享运行服务：routing 与按 host 复用的 SSH bridge 维护 owner/consumer 引用集合；启动/使用显式 acquire，停止/释放仅删自身引用。最后 owner 才停止 runtime。未登记旧客户端/独立启动留下的 runtime 标为 external/legacy，阻止全局退出，不冒认为本实例资源。保留 routing 配置/auto-start 偏好，不调用配置删除。
- 同版本 daemon 对旧 `CloseAll`/`Shutdown` 禁止作用于其它 owner；退出客户端不再使用它们。legacy 全局请求只能返回 capability/ownership 错误，不能静默越权。普通单会话关闭同样校验 owner。
- 旧 daemon 缺 `owned_exit_v1`：返回 `unsupported/daemon_ownership_unsupported`，不发送旧全局 close/shutdown，不“空会话就升级重启”；提示用户关闭相关实例再重启升级。退出流程 blocked。无 daemon 且本实例从未登记资源可为 absent；连接失败不能推断 absent。

## 2. Native 事务与命令
放入小型 `features/terminal/exit_coordinator.rs`（可按职责拆分），lib.rs 保持薄注册。

`app_exit_prepare {source}` -> `{transactionId, phase:'prepared'}`：single-flight；获取全局 admission gate（覆盖终端、routing、side-question、cc-connect 启动/授权、web/live server、web-device、SSH 请求），等待在途创建完成；这里不 kill。native 生成 ID，不接受前端 PID。
`app_exit_abort {transactionId}`：仅在 prepared/saving 且未开始停止时开放 gate。metadata 保存失败调用此命令，无进程受损。
`app_exit_cleanup {transactionId}` -> `ExitReceipt`：必须先由前端完成并确认 metadata 保存；后台 blocking worker 协调资源，主线程不 join/网络等待。重复请求同 txn 共享 worker；retry 只重做未完成项。
`app_exit_status {transactionId}` -> receipt/progress：UI 重连可查询，进度事件只是展示，不是权威完成。
`app_exit {transactionId}` -> Result：仅 native 已存储 ready 且 owner generation 未改变的事务允许 `app.exit(0)`；缺 ID、伪造 receipt、旧事务都拒绝并发起/通知请求确认流程。命令不能直接信任 JS `canExit`。

状态：idle -> prepared -> saving -> stopping -> verifying -> ready -> committed。失败前置保存 -> abort/idle；停止后失败 -> blocked（保留 gate 与句柄，允许 retry）。停止后取消只取消退出意图，不恢复已结束任务：提供 `app_exit_resume`，先确认当前 worker 结束，再开放 gate/递增 generation/使旧 receipt 失效；未收回资源仍保留注册且相同资源禁止重启。禁止后台旧 worker 晚到完成触发退出。

`RunEvent::ExitRequested`：除内部 ready->committed 单次 permit 外始终 prevent_exit；将 native 请求通知主窗口走确认/保存/cleanup。UI 未就绪或保存不可确认则保持窗口与 blocked，不直接杀。`RunEvent::Exit` 只标 graceful/无阻塞幂等最终收尾，不能首次开始关键清理。移除 ExitRequested 中提前永久 side_question::shutdown。OS 强杀/断电无法 prevent，明确不保证保存。

## 3. Daemon 退出操作与完成证明
新增 `OwnerExit {id, transactionId, ownerToken, daemonEpoch}`，daemon 原子 fence 本 owner、等待本 owner 在途 admission，按 session/bridge/routing 资源停止并生成 per-resource receipt。native 本地 helpers 并行有界停止，然后汇总。
- 每次尝试总预算 15s（单调 deadline）；正常停 2s、force/reap 最多 5s，余量用于 RPC/验证；所有内部 wait/lock/reader completion 服从剩余预算。多个资源并发但不同时持有全局锁等待。超时不是成功；超时 worker 的 registry 仍在，不 spawn 无穷重试 worker。
- Windows PTY/Node/SSH 使用受管 job 或已登记进程树；复用 `process_job::ChildJob` 并增加可验证 active-process-zero/wait 能力。必须在子进程执行用户代码前完成 job admission（suspended spawn/受控 launcher 或等价无逃逸保证），若 portable-pty 无此接缝需在其 Windows adapter 建立；不把 spawn 后 assign 的竞态当已证明整树归属。不得把整个共享 daemon 放入某个 GUI 的 kill-on-close Job。
- Unix 使用独立受管 process group，登记 leader identity，停止组并等待自有 child/成员；Windows 已持有 process handle或创建时间核验后才允许 exact-PID `/T` 后备。不能只调用 taskkill 然后无视返回值。
- PTY 把 session 从 active 移到 closing registry，而非 drain 后遗失；进程/树已消亡、PTY 释放、reader 完成才 stopped。有界 join 用 completion channel/JoinHandle::is_finished + 所有权保留；不要丢 handle 伪装 join 成功。
- daemon 若还有其他 owner、legacy client、其它 session/runtime：返回 retained_shared 并保留进程；本 owner 资源全已释放仍可 ready。其它活跃 owner 以登记/OS identity 为准，不以 momentary socket 数量。
- 最后一名 owner 且无 legacy/未知资源：server 在同一全局 admission 锁内进入 draining，拒绝新 register/spawn（调用者可稍后重连新 daemon）；停止 bridge/runtime/listeners 后返回 `daemon: stopping`。GUI 必须等待对应 process handle signaled，变为 stopped 后才 ready。socket EOF/ACK、discovery 消失都不是退出证明。
- 不响应 daemon 不允许 GUI 仅凭曾 spawn 就 force-kill：共享权无法原子排除。仅持有 daemon 已授予的 draining 独占关闭状态及准确 process identity 才可升级 force；否则 timeout/blocked。

### ExitReceipt（Rust serde camelCase / TS 同形）
```
{ protocolVersion: 1, transactionId, instanceId, generation,
  phase: 'prepared'|'saving'|'stopping'|'verifying'|'blocked'|'ready',
  canExit: boolean,
  resources: [{ kind, resourceId, ownership: 'exclusive'|'shared'|'unknown',
    status: 'stopped'|'absent'|'released_shared'|'retained_shared'|'pending'|'failed'|'timeout'|'unsupported',
    evidence: 'process_signaled'|'job_empty'|'worker_joined'|'owner_released'|'never_created'|null,
    errorCode: string|null, retryable: boolean }],
  daemon: { epoch: string|null, status: 'stopped'|'absent'|'retained_shared'|'pending'|'failed'|'timeout'|'unsupported' },
  errors: [{ resourceId, code }] }
```
`canExit` 只能由 native 派生：metadata 已确认，全部本 owner 资源 stopped/absent/released_shared；daemon stopped/absent/retained_shared 且 shared 引用已释放；无未知归属的本实例已登记资源。shared daemon 活着不是本实例泄漏。每个 stopped 的 proof 要覆盖资源类型（树需 job_empty + root signaled，内部可存多证据；wire evidence 是摘要），不能以单一 ACK 推导。错误文字由前端 i18n，wire 不包含凭据/命令环境。

## 4. Helper 生命周期合同
| 资源 / 当前证据 | 必需改动 |
|---|---|
| side_question_process::Registration/OwnedChild，注册 fence 现有，Drop kill+无限 wait | 加 coordinator gate，受管树，取消+bounded reap receipt；失败不清登记；只在已确认停止阶段 shutdown |
| CcConnectManager::stop_inner，ChildJob 已使用，process.take 后忽略 kill/try_wait 错误仍 Ok；Weixin authorization 也 spawn | 保留 closing slot、job 检验与错误；authorization 同样纳入；不要删除 profile/凭据，不读它们验收 |
| live_server::shutdown 只是 servers.clear；Drop 通知线程 | 对 task 完成/监听关闭给出有界 receipt；锁失败显式失败，注册不丢 |
| web_server::stop_runtime 已有 timeout 保留 runtime 和测试 | 复用此行为；shutdown 不吞错误；保持 config |
| commands/web_device::ensure_web_daemon 先复用，同协议直接返回，spawn 丢句柄；web_daemon::Request::Shutdown 全局 stopping+stop | 增 Register/Bind/OwnerExit/capabilities 等价协议，持有 identity；请求型短连接共享一个 native ownerToken；服务运行 owner 集合，最后 owner drain/wait；旧 daemon unsupported，禁止沿旧升级分支无所有权 shutdown |
| SSH bridge run_bridge_once_inner 保存 Child 于 BridgeControl；stop 只 kill/wait；manager Drop 才全 stop | owner/session/consumer 引用释放；共享 host bridge 不误停；最后引用显式 stop + bounded reader/stderr join、禁止 reconnect；daemon process::exit 前显式完成，不能依赖 Drop |
| SSH proxy run_helper_and_exit / bridge_stdio | 是 SSH ProxyCommand 子进程，纳入启动 SSH 的受管树；socket shutdown+线程退出有界；不按 ssh.exe 扫杀，不执行远端 pkill |

## 5. 前端、持久化及恢复
- App 三入口共用确认 -> prepare -> snapshot/save -> cleanup -> 仅 ready 调 app_exit。Minimize 在 prepare 前返回。取消不调用 cleanup。
- `flushTerminalSnapshotsNow` 后显式 await `sessionStore.saveSessions/saveSplits/saveWorkspans/saveCurrentWork`（以现有实际 API 为准），写入过滤后的恢复元数据并保存成功。退出持久化屏障暂停 `terminalRuntime` 的状态变化自动保存，避免 close/exited 回调将空表覆盖快照；blocked/resume 恢复写队列。原有 auto-sync 尽力备份不是 metadata 保存证明。
- 停止路径不 `sessionStore.clear`，不调用 UI close-all 的 destructive store cleanup；PTY/transport 只在真实 receipt 后清运行订阅。历史与快照不是 shutdown resource。
- `terminalStore.restoreSessions` 当前优先全 daemon list/attach；新策略不 attach 任意其它 owner。干净退出后走现有 `buildCliResumeStartupCommand(cliSessionId)` + `resolvePtyLaunch` + 新 PTY；同一 owner 的传输重连可 attach。旧进程不自动 adopt，明确展示仍由其它/旧实例持有，不能为了恢复而 kill。
- `normalizeExitWithRunningTasksBehavior(unknown)` 单纯函数：ask/minimize/discard 原值，background/非法 -> ask。settings load/update 与 sync `applyPreferences` 入口复用；不破坏正在进行的 appearance transaction。
- RunningTasksExitDialog 删除 background，默认非破坏性选择，文案 zh-CN/en-US；discard 不再暗示抹历史。UI 显示真实阶段、failed/timeout/unsupported 项、retry/resume，不把按钮禁用当后端 admission。
