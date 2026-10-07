# 强制删除菜单入口调整（用户明确授权）

用户建议按钮放在Worktree右键“丢弃Worktree”下面，已回复“调整吧”。沿用本task与TEMP，不重新规划backend/删除能力。

目标：Sidebar Worktree右键menu中discard紧接下一项“强制删除 Worktree…”红色danger；invalid/missing/pending节点也可打开，不能误走rejectMissing。移除FinishDialog常驻force按钮及其force确认生命周期职责，不改变finish普通清理/merge/commit流程。单独的force流程容器复用WorktreeForceDeleteDialog、store inspect/validate原token/execute、精确path输入、sessionconfirm/newcomer、sharedlock、SQL/refresh次序和generation取消保护。菜单点击只是打开预检与确认，绝不直接删除。

范围：SidebarView及独立窄force flow组件，FinishDialog移除force，Node harness/tests针对menu顺序与入口、standalone lifecycle、cancel/lateasync/reopen，zh/en新增menu文案（可复用title加…），TEMP/功能清单与contract准确位置；后端不变，原Rust69项证据有效，不重跑。tsc/Node focused与strict architecture/diffchecks。

当前valid worktree-bug，无upstream，所有上一轮未提交改动保留；知识检索无相关命中，GitNexus/OCR仍缺失，contract+sourcefallback，不能宣称图gatepass。不真实删除目录/DBbranch，不commitpush。手动desktop语言/位置验收如未启动需披露。
