# 设置对话模式默认模型

## Goal
设置中选择独立的对话默认供应商＋模型偏好，用于后续新对话初始化，保留已有会话显式选择。

## Requirements
- `chatDefaultModel` 为 null（跟随目录）或精确 `{ providerId, model }`；不改目录 isDefault、后端 schema 或 Pi 配置。
- 设置仅列启用供应商的启用模型；同名跨供应商不可混认。立即持久化，旧设置兼容 null。
- 已存但删除/禁用的身份保留并展示；区分实际回退、无可用模型、目录加载失败，失败支持重试。
- 按现有 AI 设置约定归入 preferences 同步；远端缺失供应商时保留身份并回退。
- 消费者接入覆盖 ChatWorkspace / ChatPanelSurface 与主 owner 的 Quick Chat 新建路径；浮窗只投影，不竞争初始化。
- 不改变终端、翻译默认；Quick Chat 原 non-goal 已由用户明确授权覆盖：只初始化新建空模型会话，重开不覆盖，不启动应用/杀进程/提交；保护已有未提交修改。

## Acceptance Criteria — 第一阶段
- [x] 设置偏好保存/重新加载、旧设置/null、失效身份保留有定向测试。
- [x] Resolver 精确身份优先，禁用/删除/同名跨供应商/空目录有测试。
- [x] 无偏好时两种旧 fallback 策略可分别保留。
- [x] 中英文选择、回退、空态、目录失败、保存失败文案齐全。
- [x] TypeScript、strict architecture、focused tests 与 diff 检查。

## 后续阶段验收
- [ ] Workspace/侧栏新建读取最新偏好和目录；稳定会话 ID 防竞态，已有选择不覆写。
- [ ] 新建绑定、异步加载/快速切换定向测试；真实 Tauri/语言切换人工验证。
- [ ] 最后阶段补 TEMP CHANGELOG 与功能清单，本阶段不动其已有修改。

## 用户扩展授权 — Quick Chat
- 主 owner 新建（首次 hello、显式 create、删除恢复）等待 controller ready、主 settingsStore loaded 和最新目录，精确偏好优先，空/失效按旧 sidebar 策略回退。
- 只绑定新建空模型 ID；已有显式选择、隐藏重开/历史选择不覆盖；主窗口选中另一会话时仍正确绑定，不能借 select 改主窗口选择。
- settings/catalog 失败不伪装空目录，不创建；hello 可重试。ready/epoch 与导航顺序保护不回退；浮窗禁止本地默认初始化。
