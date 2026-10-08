# 设计

批准Plan handoff `e0d7cb2ea7e27f940f3230ff13a52dbb97e3bb13f9d636ec774182f866687f44`；执行图由Pi Todo #4–#8持有，不在本文件重复调度。

## 命名
最终title保留，可选titleNaming来源auto/custom/task；缺失legacy原样。不传title自动按resolved启动用途与实际Shell，显式title专用。按环境归属及用途从合法现存/待恢复ordinal最大值+1，同步成功提交；不加持久counter。各入口只继承环境，Pane显示不再猜通用标题或动态编号。恢复保留旧title、meta及身份；项目改名解除标题联动。

## 布局
项目行不变；下区横向Worktree组，完整标题normal/anywhere自然换行、用途标签底线对齐，去重复badge但保留identity颜色。global连续同上下文组段不重排；mixed/cross全可见归属，同名稳定ID消歧。overflow同组结构、固定控制位。本体slot主题取消固定高度；单scroller，活动显露只scrollLeft，observer覆盖title，插入线锚用途行。

## 风险与恢复
旧标题无来源不可猜；Store接近2000行需职责模块；全局合并非连续组会改左右关闭语义禁止；固定slot/theme高度需同步解除。回退精确代码差异，不删会话和Worktree。人工Tauri重启/语言/drag未经测试不能宣称通过。
