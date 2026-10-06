# 设计

SidebarTerminalList/TreeContext/useSidebarTerminals或小型领域dialog接线，复用useTerminalStore.renameSession(id,title)（trim、空值无操作、串行保存完整sessions）。不改terminal store/IPC/持久化协议/依赖。
优先复用shared输入dialog，查三类似用例遵循风格，不window.prompt。触发与确认按普通PTY存在性检查；对话取消/删除竞态安全；Enter避开composition。预填触发时标题，重复/未变化沿用原语义。远程托管改名不触发handoff生命周期。
同一SidebarTerminalList涵盖所有表示，不逐入口复制；projects中英字典同步。文件<=2000行，保护前序dirty。
GitNexus缺失图risk未确认，降级契约+精确符号调用审计。场景：可见/隐藏、主仓库/WT、空白/重复/取消/IME、目标删除、精准id与原打开删除；PTY环境/Pane/托盘/恢复流程不改变。
