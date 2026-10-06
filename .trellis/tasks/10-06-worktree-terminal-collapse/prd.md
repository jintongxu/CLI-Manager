# Worktree 终端列表折叠按钮

用户批准 Plan 65a86562687bf1c813da436e7df5c8c5c756bb9cae778e131bea3d3c4ae9813b，版本 TEMP。

## 需求
有普通终端（含已隐藏标签的保留终端）的Worktree行显示独立常驻折叠箭头，默认展开，点击收起/展开其终端列表。无终端无按钮。不同Worktree独立，展开/紧凑主树与窄栏/置顶快捷入口一致。不改变主仓库列表，不改变终端标签、进程、重开/删除或恢复协议。

## 验收
- 有无终端决定按钮显示；数量变化同步更新。
- 按钮只改变该Worktree的列表显示，不选节点、打开新终端或触发树快捷键/双击/拖动。
- 鼠标、Enter/Space与ARIA expanded正确；中英tooltip/label。
- 折叠后终端仍运行，展开可按原逻辑重开/删除，其他Worktree及项目Worktree列表展开不受影响。
- 聚焦自动tests、tsc、独立严格架构通过；实机不可执行如实记录。
- 更新TEMP changelog与功能清单。不Git同步/提交，不临时EXE打包。
