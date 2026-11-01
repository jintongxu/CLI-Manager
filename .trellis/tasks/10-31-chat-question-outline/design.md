# 设计：当前会话问题大纲

- 数据源：`ChatWorkspace` 的 `detail.messages`，仅 `role === "user"`。沿用消息 id 作为大纲项 key 与目标 article 的 `data-chat-message-id`，无需额外状态或持久化。长内容从首个非空行截断为展示摘要，完整内容保留在 title。
- 呈现：参考 Kivio `ChatMessageNavigator.tsx`（固定提交 `790c2727`）贴边细导航轨、鼠标靠近才揭示内容的方式。阅读区右缘只留 30px 的细触发轨，默认不占正文宽度、不显示完整问题；鼠标进入轨道或键盘聚焦时在轨道左侧浮出问题列表，鼠标离开收起，点击按钮可固定展开；选中问题后无论是否固定展开都自动收起，焦点移到目标提问，防止鼠标仍在触发区时立即重新弹出；只有移开再进入才能再次悬停展开。宽/窄窗口均不挤占 composer，空会话无触发轨。
- 定位：点击大纲按钮，根据 id 从当前 `scroll` 容器内找对应 article，设置 `scrollTop` 至 article 顶部（并留出边距），不调用 `scrollIntoView` 改动其他滚动容器。手动滚动时读取用户消息元素的位置，选择最接近容器上沿的已出现提问作为当前项；点击和手动滚动共享活动 id。切换对话清理旧 id/展开状态。
- 兼容：保留既有消息 DOM、`chat-messages` 滚动与 `follow.current` 语义；跳转后暂停自动跟底，只有滚到最底部才重新跟随。仅调整聊天域 CSS 与双语字典，避免影响历史消息、BTW 和终端。
- 不引入 ResizeObserver/IntersectionObserver 或第三方依赖。用原生按钮、aria-current 和 aria-label。测试使用现有 `chatHarness` 加滚动容器 stub 验证定位与会话隔离。

## 代码触点（GitNexus 当前 worktree 不可用，按契约 + 符号搜索核对）

- `src/features/chat/api/ChatWorkspace.tsx`：消息渲染、当前会话、滚动跟随和大纲入口；需要修改。
- `src/features/chat/components/chatWorkspace.css`：阅读区与窄窗口布局；需要修改。
- `src/shared/i18n/messages/chat.{zh-CN,en-US}.ts`：大纲标题、空态和切换 aria 文案；需要修改。
- `scripts/chatHarness.mjs` 与新增定向测试：可复用现有组件测试；可能仅新增测试。
- `src/features/chat/lib/chatController.ts` / Rust chat repository / IPC：当前消息已含 role/id/content，确认无需修改。
- `src/app/App.tsx` 与 BTW/终端窗口：仅组合当前 ChatWorkspace，确认无需修改。
