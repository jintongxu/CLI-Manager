# 修复 BTW 图片输入失败

## Goal

修复 BTW 侧问添加或粘贴 PNG/JPEG/WebP 后推理失败的问题，保持纯文本、上下文继承、线程续问和错误脱敏兼容。

## Requirements

- 图片从前端内容块经 Rust IPC 到 Node sidecar 后，必须按 Pi SDK 1.4 的 `AgentSession.prompt(text, { images })` 契约发送。
- 已完成的含图用户历史仍以 SDK `ImageContent` 内容块恢复，不把图片序列化成文本。
- 初始问题、抽屉续问和阅读器续问均支持“文字+图片”与“仅图片”；重试复用已保存的用户消息。
- 继续限制为 PNG/JPEG/WebP、单图 6 MiB、最多 4 张；不得向 UI 暴露 provider 原始错误、路径、提示词或凭据。
- 保持纯文本请求及现有线程持久化数据兼容。

## Acceptance Criteria

- [x] 无网络 mock provider 的真实 Pi SDK 1.4 AgentSession 回路收到独立文本和图片内容块，并返回回答。
- [x] sidecar 单元测试覆盖当前图片 prompt、含图历史恢复、无效图片块拒绝和纯文本回归。
- [x] BtwThreadModel 测试覆盖初始图片、续问图片及仅图片发送，传输请求不包含 JSON 伪文本。
- [x] Rust 请求校验测试覆盖合法/非法图片内容块，相关定向测试与 TypeScript 类型检查通过。
- [x] `CHANGELOG.md` 与 `docs/功能清单.md` 以 `TEMP` 记录本次代码修复。

## Root Cause

故障位于 Node sidecar 到 Pi SDK 1.4 的调用边界：宿主图片内容块虽已转换为 SDK `ImageContent`，却被作为 `AgentSession.prompt` 的第一个 `text` 参数整体传入；SDK 1.4 要求第一个参数始终为字符串、图片放在 `options.images`，因此图片请求在输入处理阶段失败并被脱敏为 `side_question_failed`。修复必须落在该协议适配层。
