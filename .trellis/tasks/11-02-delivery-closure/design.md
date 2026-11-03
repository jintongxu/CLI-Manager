# 技术设计

## 1. `src-tauri/src/commands/web_device.rs` 拆分
- **现状**：2024 物理行，其中第 1813 行至 2024 行为 `mod tests` 单元测试代码（212 行）。
- **设计**：将 `mod tests` 提取至同级文件 `src-tauri/src/commands/web_device_tests.rs`，在主文件使用 `#[cfg(test)] #[path = "web_device_tests.rs"] mod tests;` 载入。
- **效果**：`web_device.rs` 降至约 1812 行，`web_device_tests.rs` 约 215 行，均在 2000 行限制内。测试逻辑保持 100% 不变。

## 2. `src-tauri/src/infrastructure/daemon/server.rs` 拆分
- **现状**：2028 物理行。其子模块目录 `src-tauri/src/infrastructure/daemon/server/` 已存在多项拆分模块。
- **设计**：
  - 提取 `maybe_activate_app_for_hook` 至 `src-tauri/src/infrastructure/daemon/server/hook_activation.rs`。
  - 提取 `read_line_bounded` 有界控制帧解析至 `src-tauri/src/infrastructure/daemon/server/frame_io.rs`。
- **效果**：`server.rs` 降至约 1930 行，各新增子模块仅数十行，职责清晰，无任何行为变更。

## 3. Tauri 前后端版本对齐
- **现状**：Rust 端的 `tauri` 为 `v2.12.5`，前端 `package.json` 中的 `@tauri-apps/api` 安装的是 `v2.10.1`。启动时报错 `tauri (v2.12.5) : @tauri-apps/api (v2.10.1)`。
- **设计**：在 `package.json` 中将 `"@tauri-apps/api"` 指定为 `"~2.12.0"`，执行 `npm install` 安装 `2.12.4`，使前后端均位于 `2.12.x` 主次版本区间内。

## 4. 任务状态收敛
- 将 `.trellis/tasks/11-01-chat-space-controls`、`.trellis/tasks/10-31-chat-question-outline`、`.trellis/tasks/11-01-global-quick-chat` 的 `task.json` 的 `status` 置为 `completed` 并补充 `completedAt`。
