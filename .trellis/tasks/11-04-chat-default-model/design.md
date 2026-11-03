# Design — 第一阶段

## 持久化边界
`src/shared/preferences/chatDefaultModel.ts` 定义 ChatDefaultModelPreference `{ providerId: string; model: string }`，结构校验不查询目录，不修剪有效身份，不删除失效选择。settingsStore Settings.chatDefaultModel 默认 null，在 load/update 归一化，复用现有 Store autoSave:0 的 await set 后发布状态；失败不发布成功状态。syncSettings 将字段按 translatorModelKey / terminalInputSuggestionModel 既有 AI 设置约定列为 preferences，不携带密钥。

## Resolver API
公开入口 `src/features/chat/api/chatProviderCatalog.ts` 导出
`defaultCatalogModel(providers, preference = null, fallbackPolicy = "sidebar")`。
有效且启用的 providerId+model 精确匹配优先，否则使用 fallback：
- sidebar：保持原实现，首个有启用模型供应商内优先 model.isDefault，再首模型（忽略 provider.isDefault）。
- workspace：遍历启用模型，首个 model.isDefault 或 provider.isDefault，否则全局首项；与现 Workspace effect 等价。
返回 `{ providerId, model } | null`。下一阶段消费者显式传偏好与对应策略；现有单参数调用不变。

## 设置 UI
页面顶部独立选择，与供应商编辑草稿分离；身份选项 value 使用 JSON 元组避免分隔符冲突。失效偏好以禁用选项保留显示，ready 时展示 workspace 策略实际结果。加载中和加载错误不伪报空目录；失败可重试；保存等待时禁用选择，失败显示告警。实际消费接入尚未完成。

## 前置影响分析
maestro search "对话 默认模型" --type spec --json 无命中；coding spec 已加载。按主库 runner 对 defaultCatalogModel / ChatModelSettingsPage / useSettingsStore 做 impact；索引落后 96 commits，前两符号不存在，风险 UNKNOWN，不能据其判定无影响。当前源码补证：defaultCatalogModel 旧消费者为 ChatPanelSurface；Workspace 自行使用全局 isDefault 规则；syncSettings 对 Settings 穷尽分类；settingsStore 通用 update/load 为持久化边界。新增字段不改消费者与其他默认配置。

## 第二阶段消费者
- `useConversationDefaultModel` 领域 hook 在稳定 selection、偏好或模型状态变化时重新读取目录；settings loaded 前不绑定。目录失败保留错误，不发布成功空态；每次 effect 清理废弃旧请求。
- Workspace 和主窗口 ChatPanel 分别显式使用 workspace/sidebar resolver 策略；PanelSurface 主窗口及 Quick Chat 远程旧 effect 关闭。Quick-chat origin 不由共享 hook 初始化，改由主 owner 新建路径初始化。
- `ChatController.bindDefaultModel` 在既有每会话队列中检查请求有效、当前 ID、模型仍为空，经过草稿保存后再 CAS；已有非空模型绝不覆写，冲突刷新不自动重试。
- Workspace 当前项取消跨供应商同名匹配，目录 key 使用 JSON 元组；成功空目录保留 native 手选。新增领域 hook 不修改 IPC/schema。
- 场景：工作区/侧栏、null/有效/失效偏好、同名/空/失败目录、保存后新建、显式模型/重载、设置加载、异步目录/快速切换/队列显式编辑/CAS；焦点/分屏/托盘/WSL/Hook/Worktree 不改变此纯会话绑定链路，真实桌面验证未运行。
- 再次执行 GitNexus impact：ChatWorkspace、ChatPanelSurface、ChatController 均 UNKNOWN/not found，主库索引落后 96 commits。update 查询歧义不能证明无影响；已读当前 controller 队列/CAS、Workspace、ChatPanel/Surface、QuickChatRemote/WindowApp、后端 repository.create（默认空模型）补证。native 手选为保留边界；Quick Chat 经用户明确扩展授权接入（见下）。

## Quick Chat 扩展（用户明确覆盖原 non-goal）
- knowledge gate：`maestro search "快速对话 默认模型" --json`：只有通用 knowhow/template，code index 未初始化。沿用已记录 GitNexus UNKNOWN，不以陈旧图声称无影响；当前源码补证 quickChatOwner → createUnselected、QuickChatWindowApp → remote → Surface、hook 排除 quick-chat、controller 选中限定/CAS 队列。
- refreshCatalog 先 owner.start/ready，再仅在尚未 loaded 时 await settingsStore.load（复用 singleFlight，不重载覆盖已保存状态），每次新建重新读目录；读取完成取最新偏好，sidebar fallback。hello 已有 ID 只刷新目录，不绑定旧会话。
- 新增 bindQuickDefaultModel 定向 API，复用私有 queue/CAS 实现，队列内检查 origin=quick-chat、空模型、生命周期，绝不 select。原 bindDefaultModel 继续要求 selected=id 且排除 quick-chat，Workspace/sidebar race 保护不放宽。
- QuickChatWindowApp 标记 defaultBindingManaged，浮窗只投影；导航 hello/create/select/continue 仍到达顺序执行。初始化前拒绝非 hello 命令，stop 使在途读取失效。
