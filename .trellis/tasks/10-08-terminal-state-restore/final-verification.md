# 最终验证记录

## 结论
已完成批准范围的代码与自动检查；未提交、未push、未启动应用。Windows真机验收未执行，不能声称截图异常已经实测消失。task状态维持in_progress供人工验收/提交阶段，Todo执行项完成。

## 根因
退出/重连跨进程边界把空闲PTY误当可关闭进程，显示挂载又把live continuation当cold Shell历史重置光标/滚动模式；快照序号及不完整控制序列边界、用户输入就绪与输出回放未统一，修复落在退出策略、快照/renderer delivery及输入来源所有权层，而非单纯清屏或延迟。

## 触点
- 已修改：App normal exit及窄exit policy、terminalLaunch/restoreSessions/Pi hook身份、historyResumeCommand、snapshot capture/lifecycle/persistence、manager checkpoint/display/deferred startup、socket disconnect/reset、controller/display/input/IME/OpenCode clipboard、shared historical parser/continuation/modes、normalizer completeness、可选快照sequence类型。
- 必要调用方兼容：saveSessionToSidebar明确仍不支持Pi，避免新恢复kind落入Claude默认分支；不扩展既有侧栏保存功能。
- 复用验证：daemon atomic attach/replay和既有PID清理机制，query origin、source geometry、匿名/dev隔离、CLI resume包装。
- 不修改：Rust/ConPTY/spawn、DB、凭证、providers配置与历史日志解析。

## 自动证据
- continuation implementation聚焦95项通过：continuation-tests.log。
- exit/Pi聚焦64项通过：exit-pi-tests.log。
- 独立review发现RV001-4，先真实xterm复现、修正后聚焦90项通过：review-regressions-before.log / review-focused.log。与前组有重叠，不把所有运行次数相加称唯一测试数。
- review更正：unsafe VT/normalizer carry保留安全prefix；DECSTBM pending wrap（含宽字/属性）；inactive normal scroll-region/saved attrs；session-owned deferred启动取消/失败释放、成功只一次。
- 新侧栏kind boundary测试1项通过：`node --test scripts/terminalResumeSidebarBoundary.test.mjs`。
- 最终类型检查先发现Pi kind调用方不兼容、后发现目标lib不支持replaceAll，分别修正后：`npx tsc --noEmit`通过。
- 最后一处replaceAll改正后真实snapshot回归27项全部通过：`node --test scripts/terminalSnapshotCapture.test.mjs`。
- 独立最终 `npm run check:architecture -- --strict`通过：1278 source files，0 above 2000，0 new violations。
- `git diff --check`通过（仅CRLF转换提示）。无Rust变更，不运行cargo。

## 独立审查
初始全部production/test31路径审查（无跳过）发现4项HIGH；统一修改后仅重查受影响单位，RV001-4均Closed，无剩余material finding。
不可变证据：agent://c844a83b-aca6-4f2d-b64b-7f1149c16b38、agent://3be487e6-f6a7-4eb3-af7c-8316a1cf59e4、agent://4bfb17e4-a489-462c-a606-a3c3a8ff98f3。
OCR CLI不在PATH；GitNexus runner/CLI不可用，按已批准contracts+符号调用链降级；不安装工具、不自动commit。

## 变更记录与知识评估
CHANGELOG TEMP及docs/功能清单桌面终端板块已更新。恢复/后台契约已同步新normal preserve、Pi、safe parser prefix及readiness约束；这是真实xterm揭示的非显然边界经验。不重复提交相同规则到知识库，额外知识候选0。自动spec-load telemetry属于本次工具副作用，已精确移除本次新增行，保留原内容。

## 人工验收（未执行）
- 安装版与dev各验证普通exit/重开：idle Pi、active Pi/Shell、多Tab，确认同session/PID，画面及输入落点正确，startup不重复。
- 多分屏/Workspan移动/隐藏/缩窄放大、焦点在另一窗口、托盘，物理IME与粘贴；回放中输入拒绝、完成后正常。
- running ask/background/minimize/discard、显式删除会话、restore disabled/reject保持清理；普通Tab既有隐藏语义不改。
- 本地PowerShell/GitBash/WSL/SSH、主仓库/Worktree路径与hook有/无。daemon死亡冷Pi明确ID/continue仅续聊，无原内存还原承诺。
- 本次无新增用户可见UI文案，不修改时间格式；中英文切换运行验收仍未执行。
