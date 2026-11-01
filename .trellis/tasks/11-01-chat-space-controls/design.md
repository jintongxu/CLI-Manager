# 设计：对话空间控制与置顶

- 默认推理：`reasoning.ts` 的缺省值改为 medium；显式 off 必须留在存储中而不是删除（否则无法区分缺省）。`ChatWorkspace` 初始/切换会话保持同一默认；后端请求体由现有协议映射，不修改。
- 标题栏：`PrimarySpaceNav` 保持两个按钮与隐藏设置兼容入口，改用无外边框的轻量 pill/underline 状态；`WindowTitleBar` 中增加应用名与导航的间距，避免“标题+内嵌盒子”拥挤；macOS 交通灯留白不变。
- 置顶：`conversationOrder.ts` 负责读取/写入本地置顶 id 集合并导出纯排序函数。最终列表为「置顶项（依原排序）→普通项（依原排序）」，不变更后端 `chat_conversations` 结构；删除/过滤不存在 id 不会生成假条目。右键菜单操作，行内 Pin 图标常显。拖动预览与提交只允许在同一置顶区内排序，避免拖动使视觉排序与落点冲突。
- 侧栏：独立的布尔显隐状态在 `ChatWorkspace` 根节点；保留现有隐藏兼容 toggle；新建可见 toggle 放在主列顶部且无会话时也可见。收起时 aside 从 flex 流移出，主列填满；切换空间后状态不丢（组件保持挂载）。
- 触点：`ChatWorkspace.tsx`、`chatWorkspace.css`、`conversationOrder.ts`、`reasoning.ts`、`PrimarySpaceNav.tsx`、`WindowTitleBar.tsx`、`focus-controls.css`、双语 chat 字典及定向测试；`App.tsx` 仅组合不改，Rust/IPC/PTY 无关。GitNexus 在本 worktree 无 CLI，按 frontend 契约和符号检索确认。
