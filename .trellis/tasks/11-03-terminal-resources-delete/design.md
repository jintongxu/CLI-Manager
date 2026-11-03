# 实现设计

- 资源面板：`src/features/terminal/components/TerminalResourcesPanel.tsx`，行内独立删除按钮，保留定位。
- 确认：`useAppConfirm`，渲染confirmDialog；pending从确认开始覆盖关闭结束，避免重复提交。
- 删除：`useTerminalStore.getState().closeSession(id, true)`；backend成功前不移除行，失败展示错误。禁止hideSession及直接改store列表。
- 竞态：确认前后核对稳定ID与会话实例身份字段，当前不可删除/已移交会话不操作；不把旧目标映射为新会话。
- 资源列表由sessions订阅更新；terminalResourcePage自动钳制页码。无新增采样器。
- 翻译增加terminal.resources命名空间中英文键；TEMP记录放资源面板所属板块。
- GitNexus索引落后96提交且目标不存在(UNKNOWN)；当前源码证据替代：terminalStore.ts:489严格关闭先等后台，TerminalProcessManager.close严格失败保留缓存；terminalResourceModel过滤remoteHandoff并包含隐藏会话。
- 风险：操作具有破坏性，必须确认；不能按进程名结束应用/终端，不涉及历史或项目文件。
