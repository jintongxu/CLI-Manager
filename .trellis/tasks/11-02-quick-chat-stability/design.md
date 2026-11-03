# 技术设计

## 1. 有界容器与淘汰策略
### CommandLedger（前端）
- 现状：`Map<id, Promise<QuickAck>>`，上限 100000，永不淘汰。
- 目标：保留最近 `LEDGER_WINDOW = 512` 条；`envelope.seq` 单调递增，owner 维护 `highWater`。
- 规则：`seq <= highWater` 且不在窗口内 → 直接返回 `chat_quick_capacity`（fail-closed，不重放）；窗口内命中 → 返回既有 Promise（去重）。
- 兼容：缺少 `seq` 的旧 envelope 视为一次新命令但**不入窗口**，避免无序号命令污染水位；Rust `Envelope` 保持 `deny_unknown_fields`，新增可选 `seq`。
- 理由：远端只在超时或重复点击时重发同一 ID，512 条窗口足够覆盖；真正过期的重复命令被水位拒绝，不会误执行第二次生成。

### ChatController.deleted / deleting（前端）
- 改为有界集合（512，插入序淘汰最旧）。近期“已删除不复活”保证不变；淘汰仅影响极旧 ID 的防御性检查，后端已删除记录，列表来自后端。

### Rust runtime
- `seen`：达到上限前先 `retain` 清理过期项；仍满才返回 `chat_capacity`（保持现有错误语义）。
- `unsaved`：上限 64。超出前先 `retry_unsaved`；仍失败则保留最新项并 `log::warn!`，不静默丢弃持久化状态。

## 2. 生命周期不变式
- 唯一 owner（main WebView）；唯一快聊当前会话（`quickSelected`）；最多一次补建（`creating` 单飞 + `recovering` 栅栏）。
- 移除 `ChatPanelSurface` 无选中时的隐式 `create`；未就绪显示未就绪。
- Workspace 恢复只选同一来源既有会话；仅 owner 明确要求时创建。
- 删除/切换/放大/隐藏/重连/epoch 切换每个组合：恢复成功或明确报错，不得停留旧 ID。

## 3. 错误分级
- 映射错误码 → 文案 key + 动作（重连 / 新建 / 重试保存 / 换模型 / 等待）。
- 有效新快照清除过期错误；进行中的失败不被旧成功快照掩盖。
- zh-CN / en-US 同步。

## 4. 搜索
- 250ms 防抖；请求期间显示搜索中；显示匹配数量与清空；保留分页。
- 语义：后端匹配分页，来源 Tab 客户端过滤；文案不宣称覆盖未加载历史。
- 搜索变化仍清空多选范围（既有安全规则）。

## 5. 退出清理
- 顺序：现有 exit authority 先 `chat prepare`/drain，再释放快聊通道；不新增第二权威。
- Rust `RunEvent::Exit` 与窗口销毁：清空 `MAIN_CHANNEL`/`REMOTE_CHANNEL`、注销快捷键、释放窗口。
- 前端：取消 publish 定时器与订阅、拒绝新快聊命令；`flushChatPersistence` 必须完成，失败显式报错。
- 运行时退出后清空 `seen`/`unsaved`（unsaved 已在 prepare 尝试持久化）。

## 触点
前端：`chat/lib/{chatController,panelController,quickChatRemote,historySelection}.ts`、`chat/api/{quickChatOwner,ChatWorkspace}.tsx`、`chat/components/ChatPanelSurface.tsx`、`app/useAppExit.ts`、i18n chat 域。
Rust：`features/chat/runtime.rs`、`features/quick_chat/mod.rs`、`lib.rs`（RunEvent::Exit）、`capabilities/quick-chat.json`（如需新命令最小授权）。
无关：PTY/WSL/Worktree/Hook、历史迁移字节、chat main-only 授权。

GitNexus 与本地代码索引不可用，按架构契约 + 符号文本追踪；零图结果不作为低风险结论。

## 兼容与回滚
- 不改变既有 IPC 名称、serde 键、迁移、持久化键、i18n 键、CSS 顺序。
- 快聊可整体禁用回退；主聊天行为不变。
- 去重窗口过小风险：由水位 fail-closed + 回归测试控制。
- 退出清理过早释放风险：严格先 drain 再释放，并加顺序测试。
