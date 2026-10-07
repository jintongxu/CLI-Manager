# 用户追加：强制删除恢复按钮（已批准）

Pi批准来源：20261006T112859505Z-r0004-7d20685a-h373564973e6f1fcb52e3017335d89e84902d7cf1d9b98e44a127efb119814b73.md；handoff373564973e6f1fcb52e3017335d89e84902d7cf1d9b98e44a127efb119814b73。用户选择“实现残留强制删除（推荐）”，沿用当前Trellis和TEMP。执行图Pi Todo8→9→10。

## 需求与契约（覆盖旧文档“不扩展显式未知残留删除”的非目标，仅对明确force操作）

在FinishDialog增加“强制删除 Worktree”危险入口。普通safe finish保持旧规则，绝不自动认领历史残留；force独立显式授权允许已注销非空残留/有效dirtyunmerged目录删除，默认保留branch。无stage/commit/merge，不推断merged，不回滚已有merge。

完整项目、target路径、branch保留、当前session数量与不可恢复风险呈现在专用确认dialog；需输入完整target路径精确匹配，明确确认关闭关联会话，不可outside/Escape确认。取消不副作用。只读预检先于sessionclose，绑定req身份/root原生identity和当前registration/token，确认后换root/登记变化拒绝；新session重新确认；sameWT共享finish/discard/commit锁，busy不关闭父dialog。

后端保护project root/physical main repo/祖先/admin/其它registeredWT/contains其它WT/branchpath mismatch/traversal/unsafe ancestor-root links。目录内部junction/symlinks只unlink自身，不能遍历外部目标；不能保证则停止。复用现有retry/rootabsence/prune；不增加依赖/迁移/大文件。目标固定于记录身份而非任意路径selector。检查不自动记录merged或清理。执行后root验证absence、registration移除，再SQLdelete立即localremove；SQLfail保留force收尾，refreshfail不redoGit。缺branch/path force幂等收尾不叫merged。已有finishjournal不被force标作merge成功。

## 范围和安全

新Rust窄force模块/tests/lib注册，store/小forceAPI/专用confirmUI/FinishDialog，双语，TEMP记录/功能清单/领域contract。保持上一轮未提交变更。不扩展batchforce、不branchdelete、不自动cleanup真实task-1005-2309，不真实DB/branches/app测试/no commitpush。

## 验收

临时repo：残留nonempty未经confirmation不能删，确认后record+root消失branch留；validdirtyunmerged仅forced删branch留；missingpath/branch不merged幂等；protected/mismatch/replaced/traversal/links外target保持；deletefailure/SQLfailure/refreshfailure恢复；cancel/pathwrong/newsession/lock/busy无未确认副作用；zh/en完整path输入aria。

focused Rust --lib（局部TAURI_CONFIG bundle.resources=[]）、Node actualmockcallback及tsc，独立strict architecture/diffcheck；sharedhelper变化才invalidate旧测试。独立窄安全review；GitNexus/OCR不可用按契约降级，不声称graphpass。真实desktop语言/OS占用未自动执行。

## Backend IPC contract（Todo8 implementation）

- `git_worktree_force_delete_inspect({ req: FinishRequest })` returns `{ token, confirmedPath, branchPreserved: true, pathMissing }`. Inspection performs no filesystem/Git/receipt mutation and closes no sessions. `confirmedPath` is **exactly `req.worktreePath` from the record**, not the canonical Windows extended-prefix spelling. Frontend must display this entire string and compare input exactly (no trim/case folding).
- `git_worktree_force_delete({ req, token, confirmedPath })` returns `{ done: true, branchPreserved: true }`. `done` denotes root absence plus removed Git registration only, never SQL completion or merged/no_diff. No branch-delete option exists. No add/commit/merge/finish receipt write/finish ack occurs.
- Opaque UUID authorization lives in process memory, expires after 10 minutes, single use, bounded to 256 pending authorizations. It binds all original request fields, normalized target/common repo, native project/common/root identities (including Windows creation generation), and complete Git porcelain registration state. Missing root is an explicit binding, not authority to delete a subsequently appearing root. Request/path mismatch, changed identity/registration, or any execution failure requires **new inspection and explicit confirmation with a new token**. Backend command busy rejects before consuming authorization. Sessions/new-session checks and SQL are frontend responsibilities.
- Same process lock as finish/merge/discard. Protect requested checkout, physical main checkout (first porcelain record even for linked projects), their ancestors/children, common admin, other registered worktrees and containing/contained paths. Reject traversal, root/ancestor reparse points and branch/path mismatch; foreign usable checkout metadata cannot be adopted. Explicit confirmation alone allows nonempty unregistered residual or dirty/unmerged matching checkout.
- Internal links are unlinked without target traversal; Windows directory junctions use `remove_dir`, other links use `remove_file`. Root identity is checked again for bounded transient-error retries; only verified root absence permits prune/finalization. Prune errors or still-registered roots propagate (including locked registrations); no silent success. An external concurrent filesystem mutation between checks remains outside the process-lock guarantee.
- After backend done: SQL delete then immediate local removal. SQL failure retains force-finalization state; missing-path reinspection/confirmation can repeat backend finalization without branch/merge mutation. Refresh failure must not redo Git. Do **not** call finish ack to mark force deletion merged.
- Verification on Windows: `TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --manifest-path src-tauri/Cargo.toml --lib commands::git_worktree -- --test-threads=1`: **64 passed**, including 9 force tests and existing finish/helper regression tests. Real worktree/DB/branches were not cleaned. No commit/push. Unix symlink variant is cfg-gated and not executed on Windows.
- Maestro project search fell back to BM25 with no applicable project hit; code index uninitialized and graph unavailable. High-risk filesystem implementation used approved contract/source fallback; graph gate is **not passed**. Independent narrow safety review and frontend acceptance remain Todo9/10.

## Backend gap closure：关闭会话之前重验原授权

- 新 IPC：`git_worktree_force_delete_validate({ req: FinishRequest, token: string, confirmedPath: string }) -> ForceDeleteInspection`，返回同一 `token`、原记录的完整 `confirmedPath`、`branchPreserved: true` 和当前 `pathMissing`。前端在共享 worktree 锁内、**关闭任何 session 之前**调用，失败不得关闭会话。此操作不重新 inspect、不刷新签发时间、不消费成功授权；检查原始 10 分钟期限、全部 request 字段、精确确认路径、project/common/target 原生身份、原 registration 状态及 prune 安全性。失败保守撤销 token；execute 仍消费并重新检查，不能以 validate 代替 execute。
- `git worktree prune --expire now` 没有 target 参数，可能注销其它 missing checkout。force 路径在 inspect/validate/execute 删除前，以及确认 root absence 后实际 prune 前，执行只读 `--dry-run --verbose --expire now`。非空输出必须逐行精确匹配由 common/worktrees 下无链接的管理目录及普通 `gitdir` 文件证明绑定到本目标 `.git` 的唯一登记。其它待 prune 登记、多重绑定、未知输出或不可证明元数据均返回 `force_delete_unrelated_prune`，不手工删除 Git admin，不认领其它登记。与本操作无关的坏登记需用户另行处理；本功能不自动处理。若外部操作在本目标删除期间让其它登记变为可 prune，最终检查阻塞且所有登记保留，目标可能已消失；需重新 inspect/确认恢复。进程锁不保证跨进程 Git/文件系统竞态原子性。
- Windows TEMP 验证：`TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --manifest-path src-tauri/Cargo.toml --lib commands::git_worktree -- --test-threads=1`：**69 passed / 0 failed**（原 64 + 5 新窄测试）。涵盖重复 validate 保持同 token/签发时间、只读无 receipt/文件/Git 改动、之后 execute 可用、精确路径/request mismatch、原授权过期、root replacement/registration change、其它 missing 登记的前置阻塞及删除后的 prune 重验保留其它登记。首次 focused 测试揭露 Windows 扩展前缀比较问题，已局部修正并由上述整套通过复验。现有 daemon deprecated warning 未改动。
- 本轮仅修改 force Rust/tests、lib 单行 IPC 注册及本契约附录；不修改 frontend/共享 helpers/数据库/真实 worktree/branch，不变更 Todo，不 commit/push。知识门 Maestro BM25 无适用项目命中，coding spec 不存在；使用当前批准契约及源码作为 fallback，不声称 graph gate 通过。独立 root 安全 review 仍待执行。
