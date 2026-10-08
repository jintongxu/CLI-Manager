# 终端continuation设计

批准来源：handoff 6df1b3cd01f1b3013631a1e4103960c2d13115e1363c33c8f6ca87e8615074d9。

## 根因与发现
普通退出App.runExitCleanup默认closePty=true并关闭空闲Pi；useXTermController本地快照无条件追加origin/scroll-region/SGR/cursor/bottom newline清理，破坏同进程TUI状态；输入在replay/fit前可发送；checkpoint在上传时取较新sequence。截图无法确定全部乱码因果，不能声称已复现。

## 边界设计
1. 普通exit且restore开启：先flush snapshot，走现有daemon background保留所有PTY，daemon不可用走tray不杀。running策略与明确discard/tab关闭/禁用恢复/拒绝恢复仍保持清理语义。
2. Pi加入cold CLI恢复分类（含存储tool身份），复用historyResumeCommand的pi --session参数去重；无ID pi --continue，不贴旧TUI与size，不承诺原进程内存。匿名不保存。
3. 捕获同一提交prefix的bytes/size/sequence；sequence在serialize barrier捕获传入checkpoint，不在上传时取新值。
4. 明确live continuation/cold shell history。live保留cursor/SGR/scroll-region/alternate/必要Pi模式；冷Shell保留历史清理。local remount只在snapshot与committed baseline一致时续queued frames；过旧/缺失/未完成async parse需daemon完整reset/replay并重置renderer baseline，protocol回答历史仍保留去重。
5. readiness/generation覆盖mount/display/replay/fit/cancellation，真实input拒绝不缓存，clipboard/drop异步检查owner。延伸已runtime校验CoreService user/protocol来源分离，不能disableStdin或猜字节。live query应答保留，history禁止。hidden尺寸未稳定直到fit完成仍关输入。
6. SerializeAddon所缺实际必要mouse/keyboard modes只在已验证xterm compatibility边界补充并测试，不重写。

## 触点与影响
- 修改候选：App退出guard及窄helper；terminalLaunch/restoreSessions；snapshot capture/lifecycle/persistence；manager checkpoint/delivery；controller/display/input；shared historical parser兼容边界。
- 复用/回归：daemon atomic attach/replay barrier，query origin/sequence，source geometry resize，PiCompatibility/IME，匿名过滤/dev隔离，historyResumeCommand。
- 确认不改：PTY spawn/ConPTY，PID树kill，DB migrations，凭证，providers配置，历史日志解析。
- GitNexus不可用（runner缺失、PATH CLI缺失），已按契约+符号调用链降级分析。退出生命周期高风险，用户批准改变普通restorable exit语义。

## 场景矩阵
idle/active Shell及Pi；window/dialog/tray与explicit discard/Tab/restore-off/reject；本地PowerShell/GitBash/WSL/SSH；main/worktree/路径丢失；hook装/未装；多Tab/Workspan/嵌套分屏与隐藏/焦点/托盘；同尺寸和宽窄fit；async unmount/checkpoint race/reconnect/gap reset/旧owner。人工Windows验收不能被静态测试替代。

## 兼容与回滚
旧session快照字段向后兼容，normal restored new process当cold history；不改变IPC命名/数据库/dev隔离/daemon排序。退出UI保留PTY会继续消耗资源，此为恢复原进程所必需；显式终止释放。系统重启/daemon死亡仅native续聊。回滚只撤本任务代码，保留他人修改。
