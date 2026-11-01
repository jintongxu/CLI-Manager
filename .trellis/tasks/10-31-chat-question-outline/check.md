# 问题大纲核验

- 当前对话的用户消息按原有顺序列在问题大纲；每项以 message.id 对应原消息，点击只滚动当前 chat-messages 容器，手动滚动更新高亮。
- 长问题取首个非空行且 CSS 单行省略；标题保留完整原文；切换/新建会话不复用旧列表。
- 参考 Kivio 固定提交 `790c2727` 的 `ChatMessageNavigator` 边缘细轨、悬停预览模式：现改为 30px 边缘触发轨，完整问题列表在浮层中悬停/聚焦显示，离开收起，按钮可固定；不再常驻 220px 侧栏。
- 新增默认隐藏/悬停/焦点测试；点击定位测试继续验证自动收起、焦点转移、鼠标未离开不重新展开、移开后可重新悬停；`node --test scripts/chatOutline.test.mjs`：3/3。
- `npx tsc --noEmit --pretty false`：通过；`git diff --check`：通过。
- `npm run check:architecture`：仍有既有 `web_device.rs` 2024 行与 `daemon/server.rs` 2028 行超限，本次未新增超限。
- 未做真实桌面窗口宽/窄视图与中英文切换人工验收；开发版可能保持运行，未重启/关闭进程。未提交或推送。