# 交付收口：架构 strict 超限清零、Tauri 版本对齐与任务归档

## 目标
消除项目中现存的硬性质量缺陷与交付债，使项目达到完全合规状态：
1. **架构代码行数合规**：消除 `npm run check:architecture -- --strict` 报告的 2 处既有违规（`src-tauri/src/commands/web_device.rs` 2024行、`src-tauri/src/infrastructure/daemon/server.rs` 2028行），拆分后均处于 2000 行限制以内。
2. **Tauri 依赖版本匹配**：将 `@tauri-apps/api` 由 2.10.1 升级至 2.12.x，消除 Tauri 开发模式启动时的版本不匹配告警。
3. **已上线任务归档**：将实际功能已上线、测试已通过但 task.json 仍标记为 `in_progress` 的任务（`11-01-chat-space-controls`、`10-31-chat-question-outline`、`11-01-global-quick-chat`）置为 `completed`。
4. **交付记录与验证**：更新 `CHANGELOG.md` 与 `docs/功能清单.md`（TEMP 版本），执行全量自动化回归。

## 非目标
- 不重写 web_device 或 daemon server 的核心业务逻辑或外部 IPC 协议。
- 不进行 Git 提交或推送。
- 不重置本地 SQLite 数据库。
- 不按进程名批量杀进程。
