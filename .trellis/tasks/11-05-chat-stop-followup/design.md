# 根因与触点

## 确认根因
1. repository.begin 把 stopped 与 failed/interrupted 等同，后端禁止主动停止后的正常续问，而 UI 提供正常发送。
2. terminal checkpoint 独立提升 revision；已排队的草稿 CAS 可冲突。前端 generate 用 dirty + 任意全局 error 直接抛 chat_storage，未尝试按最新 revision 保存，导致可恢复冲突被误标记为存储失败。

## 修复边界
- repository.rs begin：允许 completed/stopped 后新问题，其它终态策略不变。
- chatController.ts generate：保留 unsaved 安全栅栏；发送串行队列内，在 dirty 且已有错误时先读取最新详情以刷新 CAS，再显式保存草稿。不自动重放模型请求，不覆盖用户本地草稿。删除将全局错误粗暴转为 chat_storage 的 guard。
- chatHarness + chatPersistence 测试：复现停止终态/草稿 CAS 竞争、真正存储失败。
- chat tests.rs：真实 SQLite stopped 续问与 failed/interrupted 限制。

## 场景
- 停止前/中/后编辑下一问题；终态保存成功/失败；普通窗口/侧栏/快聊共用控制器；重试旧回答与新发问分别验证。
- 跨会话全局错误不得使另一会话草稿被直接误判为保存失败。
- 并发窗口继续遵守 revision CAS：主动发送前刷新基数，刷新后冲突不重试、不吞错。

## 图分析限制
GitNexus 索引落后102提交且不存在当前聊天域符号；impact saveDraft 错误解析到定价设置同名方法，不能作为聊天域低风险证据。按当前代码契约与精确搜索校验调用点。未发现当前聊天域契约文件。

## 暂不处理
runtime 的租约丢失快照修复与临时 checkpoint 失败属于独立条件，当前无用户会话触发证据，不扩入本修复。
