# 对话空间操作优化核验

- 默认推理 medium，显式 off 保留；菜单与 controller 测试通过。
- 标题栏项目/对话取消嵌套分段边框，分隔标题并用主题下划线表示当前空间；Mac 交通灯留白维持。
- 置顶以本地 pinned ID 集合持久化；置顶优先且保留组内手动顺序，右键菜单可取消，行内 Pin 图标可见；跨组拖动拒绝，过滤/删除的无效 ID 不会生成假行。
- 对话栏可收起/恢复，收起时 inert + display:none，主消息区保持挂载并展开；按钮在没有选中会话时仍可访问。
- `node --test scripts/chat*.test.mjs`：57/57；`npx tsc --noEmit --pretty false`：通过；`git diff --check`：通过。
- `npm run check:architecture`：既有超限 `src-tauri/src/commands/web_device.rs` 2024 行及 `src-tauri/src/infrastructure/daemon/server.rs` 2028 行，本次无新增超限。
- 未进行真实桌面窗口/界面语言切换视觉验收；未提交、推送或修改进程。