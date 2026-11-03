# 执行

1. 已获 Plan 执行批准；配置上下文并启动任务。
2. terminalBatchClose 增加运行时关闭分派并接入 useTerminalTabsController，保持确认、取消、当前工作与显式隐藏。
3. 扩展生命周期定向测试：SSH 状态、Shell、混合批次、严格失败、缺失会话、非 SSH/伪会话兼容；复用既有隐藏、保护与确认测试。
4. 更新 CHANGELOG TEMP 和功能清单终端板块。
5. 执行定向 Node 测试、npx tsc --noEmit、npm run check:architecture -- --strict。复用未失效结果，不运行无关全库测试。
6. 记录根因、触点、验证及实机限制，不提交或同步 Git。

## 结果
- 已实现 terminalBatchClose.closeTerminalTab 并接入通用关闭控制器；隐藏入口未修改。
- 11 项定向测试通过：5 项分派/保护，5 项真实 Store 失败/隐藏/handoff/项目隐藏兼容，1 项真实 Store 严格 ACK 清理。
- ACK 测试初版依赖固定微任务次数导致 acknowledge 未就绪，已改为显式 entered 事件等待并单独重跑通过；非生产缺陷。
- npx tsc --noEmit 通过。
- npm run check:architecture -- --strict 通过：1661 文件、0 超限、0 违规；git diff --check 通过。
- CHANGELOG.md TEMP 和 docs/功能清单.md SSH 板块已更新；无新增 UI 文案。
- 未启动真实桌面或建立真实 SSH 连接，尚未做实机关闭/中英文切换验收；自动化使用真实 Store 与模拟原生边界。
- GitNexus 不可用，未进行图影响检查，使用契约与源码确认；未提交。
- Trellis 上下文校验通过，但 SSH 契约超注入字节上限会被截断；本次直接读取 PTY/daemon 相关段落。会话指针不可用，task start 以 degraded 模式激活。
- 零知识候选：本次为既有严格关闭链路的窄入口修复，没有新增值得独立沉淀的非平凡约束。
