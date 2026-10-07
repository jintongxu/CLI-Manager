# 菜单迁移验收

用户“调整吧”授权完成：Sidebar右键Worktree，“丢弃Worktree”下一项为danger“强制删除 Worktree…”；点击只设置target打开新独立WorktreeForceDeleteFlow。active/missing/pending均可打开预检，不走missing拒绝。原FinishDialog所有force-delete UI/state/callback/error职责已移除，仅普通finish/force-merge保留。

新flow沿用既有store/service/confirmation组件，按stable identity/open generation隔离late请求/旧确认。预检readonly，失败须显式重新预检；完整路径输入/原tokenvalidate/session newcomer/sharelock/SQL-firstlocalremove protections不变。全hooks在visibility guard之前。root读取新flow/Sidebar实际菜单/FinishDialog符号无forceDelete确认通过，无确认剩余缺陷。

结果agent://500a5305-a38d-47bd-bd1c-097deabea8e1：node --test scripts/worktreeForceDelete.test.mjs 34/34（含21finish）；单独finish21/21；npx tsc通过。root独立npm run check:architecture -- --strict1216sourcefiles，0oversize/0violations；gitdiffcheck通过（仅CRLFwarning）。backend/store/service未修改，复用既有Rust69证据，不重跑无关suite。

CHANGELOG TEMP、docs功能清单Worktree、领域contract已更新至最终菜单位置；新中英文menu/retry keys同步。无新增知识候选（0），新菜单没有额外可复用非显然规则，existingforce/async约束已在contract。

真实desktop双语/视觉验收未执行；GitNexus/OCR缺失按contract/sourcefallback不claimgraphclean。不真实删除旧目录/DBbranch，无commitpush；所有上一轮dirty保留。此文记录结果，不覆盖旧轮验证的历史位置说明。
