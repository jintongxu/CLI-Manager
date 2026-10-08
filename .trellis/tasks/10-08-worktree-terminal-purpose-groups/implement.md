# 实施边界与验证

命名域负责session类型/Store/持久恢复、创建上下文与各入口、Pane标题；分组域负责project tabs模型/selector、顶层bar/Sortable/overflow与CSS。不得并发修改共享文件；Pi Todo #5/#6分别持有细化brief。

完成时复用仍有效定向测试，相关接口改变才重跑。至少命名真实Store/入口/恢复，分组model/interaction/layout；npx tsc --noEmit；独立npm run check:architecture -- --strict；git diff --check。drag/history边界改变才执行相关定向测试。不运行无关全量suite、不构建生产包、不自动启动应用。

精确diff独立审查，集中同子系统修正，遵守review收敛限制。最终TEMP及功能清单替换当前行为矛盾描述，任务PRD逐项标记并记录manual未验收。无可复用非显然实测知识则零候选。
