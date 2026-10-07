# 完成 Worktree 修复验证

## 根因与实施范围

Git 注销后目录删除失败能保留 DB 行，但原流程没有持久完成/目录归属证据，重开又清空组件阶段并访问失效 checkout。并非以重复点击作为已证实根因。修复在 Rust 权威生命周期与前端恢复状态两侧落地，不用任意目录删除兜底。

后端：finish.rs、finish_receipt.rs、worktree.rs、lib.rs；20项初始finish测试及既有28项worktree测试，后续审查补至27项finish测试。既有worktree测试按职责移到worktree_tests.rs避免超过2000行。
前端：worktreeFinish、worktreeStore、FinishDialog、projectStore/sidebarModel/TreeNode及三个完成入口、非active目录消费者、shared类型、zh/en。回归脚本以转译后的真实dialog/store回调和mock IPC/SQL验证。

发现清单已检查：App/sync启动沿用权威markMissing；remoteHandoff原active门禁足够；TerminalTabsView/GitRefTree共用恢复入口；创建、策略、依赖安装、provider与项目想法无业务语义扩展。显式丢弃保持确认语义，与finish共锁但不偷偷认领历史未知残留。

## 独立审查及收敛

一次完整集成审查修复了有效linked项目root被额外拒绝、discard绕过finish前端锁、inspect错误仍保留active三个确认缺陷。根流程补查prepared证据重绑定与normal abort证明，后续定向修复确认无mutation/stash/outcome的prepared可在显式merge时重采source/ownership；normal abort须证明HEAD/base/checkout未变、MERGE_HEAD不存在且clean才可重新prepared。journal observer失败不能把已发生mutation伪装成可重试prepare。

新增旧残留明确手动指导与Node回归，invalid未知目录不再显示“无改动可进入合并”暗示。必要函数注释已核对，未宣称跨进程事务或安全隔离。

## 有效证据

- `TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --manifest-path src-tauri/Cargo.toml --lib commands::git_worktree -- --test-threads=1`：初始48/48（20 finish+28旧worktree）。
- 后续最终 `TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --lib commands::git_worktree::finish:: -- --test-threads=1`（src-tauri cwd）：27/27，覆盖正常/注销后删除失败与重启重试、缺分支有无凭据、未合并/dirty/newtip/changedresidual/replacedroot、protected/link、stash blocker、observer/persist失败、linked project、正常冲突中止及prepared重试。
- `TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo check --manifest-path src-tauri/Cargo.toml`：成功；后续Rust改动由上述最终library测试再次编译。仅已有ssh_agent_bridge deprecated warning。
- 最终 `node --test scripts/worktreeFinishRecovery.test.mjs`：21/21；含重开、对象/语言刷新、旧async、invalidstage、force恢复冲突、SQL/refresh/ack失败、session确认及新会话拒绝、legacy人工恢复。
- 最终 `npx tsc --noEmit`：通过。
- `npm run check:architecture -- --strict`：1210 source files，0超限，0违规；独立执行。
- `git diff --check`：最终通过（workflow metadata仅LF/CRLF告警）。

证据原始结果：agent://abf324bc-6bff-4834-babe-2a596f511bf4；agent://90915b30-6b1c-4b5c-91b7-d3e5a2e70193；agent://af33b7ce-11ac-47a9-8684-b364dfb14602；agent://c2cd214d-7d49-4cc3-883a-8ea6a146d31a。未因纯注释/空白修改重复有效测试。

## 限制与未执行

默认Tauri compile依赖缺失 apps/web/dist bundle资源，测试/编译用命令局部resources空列表，不改产品配置；一次非lib test命令还触发已有tests/web_listener.rs Config缺trusted_network，本次未改无关集成测试。
GitNexus runner/index/CLI与OCR CLI不可用；没有冒称graph impact/detect_changes或OCR通过，按triage契约+源码diff/独立审查降级。
未启动真实桌面应用，未手动切换语言检查三个入口/真实Windows占用；双语与异步语言切换仅自动mock覆盖，桌面手动验收仍待用户完成。
进程锁不能排除外部Git/文件系统并发TOCTOU。ownership快照拒绝links/junctions、超20000条目或超256MiB元数据大小/512MiB实际读取预算，保守要求人工处理。未恢复stash需人工恢复，没有自动猜测解除阻塞接口。
旧task-1005-2309无历史可信归属凭据，不自动删残留；UI可确认分支ancestor已合并并给出人工核对/备份/安全移走后重新检查收尾。

无真实worktree/branch/DB修改，无commit/push/merge/rebase。CHANGELOG TEMP与docs/功能清单Worktree已更新。领域contract新增可复用约束（partial failure不等于merge失败，merge证据不等于directory ownership）；无活动Run/Session，未另行写入知识候选库。

## 工作区记录

任务期间工具自动产生 `.workflow/spec-analytics.jsonl` 与 `.workflow/specs/` 元数据，非手写产品改动；保留，不在本次建议提交范围中静默包含。任务状态保留in_progress待用户commit/finish-work，代码交付不自动archive或push。
