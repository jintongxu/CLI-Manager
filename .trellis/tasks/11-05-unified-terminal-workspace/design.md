# 设计

## 唯一权威
terminalStore.workspans作为布局/激活/持久化唯一权威。旧current-work字段只用于一次性兼容迁移，不保留第二套运行态成员authority。terminalPresentation与navigation共享符合scope且可操作的普通会话集合；transient由底部owner管理。

## 迁移
恢复首次挂载前将旧currentWorkPaneTree晋升为canonical workspan，方向/比例/leaf顺序和active保留；移除普通workspan中的重复归属，保留残余分屏，遗漏成员补入。两份冲突几何不能同时保留，明确current-work优先。备份原快照、完整队列写入与版本标记保证可重试/幂等，不执行会话关闭。

## UI与调用链
只保留canonical渲染，一份XTerm消费者。移除模式切换、成员条/拖拽/菜单/palette/专属快捷键；Sidebar与历史/资源入口转普通reopen/activate，休眠取最终ID。保留普通分屏和workspan间标签可达、作用域过滤及底部Shell独立焦点边界。

## 发现及风险
原双界面不是按钮层功能：terminalPresentationAllowedIds按成员分区，navigationModel二次过滤，PaneLeafView拥有XTerm并portal至独立current-work树。sessionStore同时保存两份布局；旧workspanEnabled=false会flatten。移除成员不能调用旧remove回调（会结束匿名Pi）。GitNexus落后106提交，图结果需当前源码佐证。

## 验证
session守恒/唯一归属、冲突树/缺失/隐藏/非法节点/重试幂等、ID remap/部分恢复、scope可达、parser唯一、SSH与本地close/hide差异、底部Shell隔离。定向自动化+类型+strict架构；旧数据真机恢复与中英界面未验证不能声称完成。
