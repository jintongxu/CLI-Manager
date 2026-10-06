# 终端置顶排序与Worktree拖动排序
批准f20ca092f8b0c3cf2ba88045713dc1802076862a5aefbbc5e084814a23fa19f1，TEMP。
## 需求
终端右键pin/unpin、小图钉，所属project主仓库或Worktree内drag排序且pin/普通分区独立；keyboard上/下替代，顺序置顶随隐藏/折叠/恢复保留。Worktree同project拖动排序保存并多入口一致，不改归属。移除Worktree主树行WT文字chip，不移除图标/provider/summary或顶部标签。
## 验收
普通/legacy/hidden正确，pseudo排除；同归属同pinpartition、crosspartition/crossproject拒绝，pin至目标区尾；pane/workspan/sessions数组原顺序身份不变。两restore branch保留metadata，旧数据兼容。WT新/删/stale排序稳；主树/compact/narrow/pinned/flyout一致；projectgroup原Dnd/搜索过滤禁拖不回归。点击/context/折叠不误drag，不activate/stop/create；中英ARIA。聚焦tests/tsc/严格架构+集成review，实机限制准确。无其它建议/DBmigration/dep/Git同步提交/EXE打包。
