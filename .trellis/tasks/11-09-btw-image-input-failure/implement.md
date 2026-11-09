# 实施记录

## 根因

Node sidecar 已将宿主图片块转换为 Pi SDK `ImageContent`，但错误地把内容块数组作为 `AgentSession.prompt` 的第一个文本参数传入。Pi SDK 1.4 要求 `prompt(text, { images })`，所以含图请求在 SDK 输入处理阶段失败并被脱敏为 `side_question_failed`。

## 触点清单

- `src/features/terminal/lib/btwImageAttachments.ts`：确认 PNG/JPEG/WebP、4 张、单图 6 MiB 输入边界。
- `src/features/terminal/lib/btwThreadModel.ts`：结构化消息、初始/续问/重试/重新开始图片状态。
- `BtwTerminalDrawer.tsx`、`BtwThreadDialog.tsx`：图片选择/粘贴与原子发送；未改变来源上下文语义。
- `src-tauri/src/features/terminal/side_question.rs`：结构化 wire 校验；文本 512 KiB、单图 base64 8 MiB、多轮 wire 72 MiB 分离计量。
- `scripts/piSideQuestionAgentCore.mjs`：宿主内容块转 SDK 内容块，当前 prompt 使用 `options.images`。
- `scripts/piSideQuestionAgent.mjs`、`side_question_process.rs`：确认固定错误码与日志分类不向 UI 泄露 provider 原文。
- 持久化仓库与 native bridge：结构化消息由现有序列化路径透传；相关回归测试通过。

## 场景

- 初始提问：文字+图片、仅图片。
- 同线程续问：文字+图片、仅图片，完整历史重发。
- 重试：复用已提交用户结构化消息，不追加重复用户轮次。
- 重新开始：恢复首个用户问题文本和图片。
- 继承上下文开/关：图片等待准确来源快照后发送；无来源仍按既有规则。
- 明确 provider error/abort：保留部分流式显示但请求失败，线程可重试，不提交部分回答。

## 验证

- `node --test scripts/piSideQuestionAgent.test.mjs scripts/btwTerminalDrawer.test.mjs scripts/btwNativeBridge.test.mjs scripts/terminalBtwThreads.test.mjs`：48/48。
- `npx tsc --noEmit`：通过。
- `CARGO_TARGET_DIR=src-tauri/target-btw-image cargo test --manifest-path src-tauri/Cargo.toml --lib commands::side_question::tests::`：5/5；临时 target 已删除。
- `npm run check:architecture -- --strict`：1712 files，0 超限，0 新违规。
- `git diff --check`：通过。
- GitNexus `impact` / `detect-changes`：仓库缺少 `.gitnexus/run.cjs`，无法运行；按规则降级为契约文档、精确搜索和完整相关测试，不将其报告为零影响。
