# 技术设计

1. 在 `CurrentWorkTabBar` 增加 `onCloseOtherTerminals` 与 `closeOtherLabel`，按钮放在“清空当前工作”附近；按钮仅在非 compact 的当前工作栏显示。
2. 在 `useTerminalTabsController` 计算 `closeOtherTerminalIds = sessions.filter(session => !currentWorkSessionIds.includes(session.id)).map(id)`，按钮点击调用现有 `handleCloseSessions`，从而统一批量确认、未保存文件保护和逐个 `hideSession` 关闭。
3. 目标快照在点击时生成，避免异步关闭过程中当前工作集合变化造成误关；当前工作集合由 `useCurrentWorkSessionController` 的 session ids 提供，分屏只影响布局，不影响保留判定。
4. `TerminalTabsView` 将控制器回调和中英文文案传入当前工作栏；非当前工作占位栏使用 no-op，保持类型与布局兼容。
5. 不调用 `TerminalProcessManager.closeAll()`，不新建 close-all IPC；用户动作必须走现有 session close 链路，保留 daemon、SSH、编辑器和持久化语义。
