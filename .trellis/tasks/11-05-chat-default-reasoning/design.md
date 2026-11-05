# 实现边界
- shared/preferences纯类型与归一化；settingsStore初始化/加载/确认保存；syncSettings偏好同步。
- 设置对话模型页默认强度选择与中英文文案。
- useConversationReasoning统一主空间/侧栏/快捷窗口，等待设置就绪再初始化本地会话选择；现存选择不覆盖。
- QuickSnapshot传递主owner最新默认强度，快捷窗口直接消费权威快照，避免落盘前读旧值。
- 沿用当前能力约束medium/high/xhigh/max，旧off/minimal/low按既有medium下限归一化，不扩大上游协议支持。
- 索引落后103提交、聊天域符号缺失，graph impact无可靠答案，按现有API入口与调用点检索降级。

# 场景
新/旧会话；设置加载前/后；修改默认后新建；明确会话选择；无效导入；保存失败；三个入口、快捷重开与主窗口继续。
