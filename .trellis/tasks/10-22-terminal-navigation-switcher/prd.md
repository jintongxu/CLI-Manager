# 统一终端导航

## 已批准目标
单排范围选择 + 当前/固定/最近访问最多五项快捷入口 + 可搜索全部终端；上下文与批量管理收进浮层。普通、当前工作、Workspan关闭模式统一，多窗格保留局部操作。TEMP，不新增依赖或后端/持久化协议。

## 实现
- terminalNavigationModel / useTerminalNavigation：作用域内运行时终端、固定/最近顺序、范围协调和先过滤后限额。
- TerminalNavigationBar / Panels / Adapter：单排、搜索、上下文、管理；复用既有菜单与单一DndContext。
- TerminalTabsView / useTerminalPaneAdapter：接入与隐藏单窗格重复标签，保持终端body和portal挂载身份；controller抽取后低于2000行。
- 普通导航不隐式加入当前工作；显式加入不受当前工作模式门禁限制，自动创建加入门禁保持。匿名Pi移除即关闭保持。
- zh-CN/en-US与TEMP记录同步。

## 评审修正
修复普通视图显式加入无效、管理DndContext隔离、侧栏范围变化后残留项目选择及快捷项过滤顺序问题。图分析不可用（GitNexus入口缺失），使用契约/定向源码。

## 验证
- 69项导航、交互、布局、当前工作生命周期及滚轮定向测试通过。
- TypeScript通过；严格架构检查通过（零超限），diff --check通过。
- 单独terminalProjectTabsModel旧测试存在临时编译目录解析worktreeMetadata失败，未修改该测试；不宣称全量测试通过。
- 真实WebView内中英文切换、Radix焦点恢复、响应式尺寸和鼠标拖拽尚未手验，交付明确披露；未操作用户会话制造验证数据。
- 分支无上游，无Git同步或提交。可复用知识候选0（本轮结论已在任务/已批准交互契约记录，不重复发布）。
