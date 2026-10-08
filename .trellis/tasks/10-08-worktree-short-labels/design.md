# 设计契约

批准Plan `7008f9fccd9439b99ec06682bff1afda18303c8774c3d5c2cd7b5582839b50e2`。权威执行图为Pi Todo #9–#15。

worktrees新增short_label(空默认)、label_ordinal(每树正整数不变)，projects新增worktree_label_high_water。SQLite单语句trigger分配，所有状态参与，旧created_at,id回填。最高号/全删不回收，上限2147483647拒绝。别名NFC trim最多12Unicode码点，禁control/bidi/W数字；项目内NOCASE唯一。update undefined保留、空清除；清除回原号。Store保留Git成功SQL失败恢复语义，回读trigger最终值。

UI表单创建不承诺具体Wn，编辑展示原默认号。标签用持久token不派生display后缀；global/Pane/crossproject带项目名，同名项目ID；missing无record明确ID。不额外项目P编号。token独立title，cross/mixed全可见归属，scope/close/activation不变。去每组大标题，完整当前上下文主体上方一次挂载，actualactive校验scope，全文换行可滚；固定轻量标签行与唯一横向scroller，超宽active左对齐。

Web仅加性create/list/snapshot字段不新op；备份显式列和Rust白名单同步，空项目高水位也保存；新编号优先旧确定性补，非法冲突全rollback。旧备份未知删除历史不能恢复。保持旧命名/CLI启动/save故障修复。
