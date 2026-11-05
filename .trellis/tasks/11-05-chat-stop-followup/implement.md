# 实施
1. 先增前端停止/草稿冲突续问测试和真实 SQLite stopped 续问测试，确认失败。
2. 修复 repository 新问题准入和 controller 显式发送时草稿 CAS 基数恢复；不自动重试模型或后台草稿保存。
3. 定向运行 chatPersistence/chatController 与新增 Rust 测试；类型检查、严格架构检查；更新 TEMP 交付记录。真机验收由用户执行停止长回答后再发送下一问题。

## 结果
- 前端新增2例修复前失败；修复后controller/persistence 17例全部通过。
- SQLite新增stopped续问测试修复前chat_retry_required，修复后通过；failed/interrupted仍拒绝且事务无新增消息。
- 既有chat_retry_preserves_independent_saved_draft通过。
- npx tsc --noEmit、npm run check:architecture -- --strict、git diff --check通过。
- 未改模型网络协议、自动重试或吞掉存储错误；未动已存在的UI布局改动。
- Rust cargo test编译库测试，不等同运行中的开发版后端已更新；真机验证待重建开发版。
- 用户补充侧栏与快捷对话同样生效：确认侧栏共用ChatController，quickChatOwner generate转发到同一主owner控制器；停止/草稿CAS回归已参数化覆盖workspace/sidebar/quick-chat三个origin。chatPersistence、chatUi、quickChat三个定向文件共77例通过；此结果包括命令通路既有测试，不等同真实快捷窗口模型端到端验收。
