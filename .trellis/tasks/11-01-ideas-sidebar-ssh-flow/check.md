# 验收记录

## 已验证

- `npx tsc --noEmit`：通过（无输出）。
- `npm run check:architecture -- --strict`：失败，仅报告 2 项既有 Rust 文件超限（`src-tauri/src/commands/web_device.rs` 2024 行、`src-tauri/src/infrastructure/daemon/server.rs` 2028 行），本次新增/修改文件均未超限。
- `node --test src/features/projects/tests/*.test.mjs`：先前基线 79/80 通过；本次 `projectIdeaPreview.test.mjs` 2/2 通过。
  - 唯一失败：`sidebar text/status/focus contrast on opaque theme token surfaces across declared palettes`，断言 `palettes === 22` 实际为 26，属于主题调色板数量变更导致的既有断言滞后，与本次改动无关（未触碰 `themes.css` 与 `sidebar-terminals.css`）。

## 未验收（需真人桌面）

- 项目树展开的实际手感与动画观感（需 Tauri 窗口）。
- 项目想法弹窗/侧栏单输入框在 zh-CN 与 en-US 下的实际排版。
- 当前工作 SSH 文件自动分屏的视觉效果、拖拽比例与关闭最后一个文件后的自动回收行为。
