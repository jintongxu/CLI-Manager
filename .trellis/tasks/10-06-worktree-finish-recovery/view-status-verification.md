# 只读状态查看验收

入口SidebarView查看状态在完成前，active/missing/pending无reject，挂载独立WorktreeStatusDialog。root读取helper/组件核验仅直接invoke git_worktree_finish_inspect，不走Store状态SQL写；展示recordstatus/branch与实时证据区分，unknown不merged，sourceOid不当branch存在；现有缺细项不伪造。无force token/sessionclose/stagecommitmerge/delete/prune，refresh/close/error/lateasync与identity/lang保护。

实现证据agent://68227985-a20b-4ea0-b9c2-ba1eb7adea98：node --test scripts/worktreeStatus.test.mjs scripts/worktreeForceDelete.test.mjs 67/67（含finish导入）；tsc通过。root strict architecture1219source零超限/违规，diffcheck通过（只换行warnings）。TEMP/功能清单/领域contract更新。未改backend/store，不重跑无关Rust证据。

未知状态如legacy residual ancestry已合并但ownership未确认可能同时显示unknown与blocker，summary保守以blocked优先、outcome未确认，不删除也不替用户决策。接口并非完整Git诊断，独立目录/分支是否存在等未提供字段不展示为确定结果。

开发watch已运行未重启；未手动桌面语言/视觉检查，无真实cleanup/DBbranch变更/no commitpush。Graph/OCR缺失contractfallback无graphcleanclaim。0新增知识候选，规则已在领域contract。全清force另在todo15/16审查交付，不凭本页面验收代替。
