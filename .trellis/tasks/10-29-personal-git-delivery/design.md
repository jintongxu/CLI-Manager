# 设计

批准计划53970bad8b1ad41711f2fbc429a628d3f7dfcee5e3a774124fe8cf8a7ea7c4dd。Pi Skill显式命令，模型理解diff生成中文文本，确定性Node脚本承担Git边界和journal。无新第三方依赖。项目级.pi/skills/deliver，不全局安装。

## 布局
scripts/deliver.mjs为JSON CLI，git-state.mjs只读识别预览，delivery.mjs写操作编排，journal.mjs原子收据及同common-dir锁；按实际职责可增小模块，不宽泛export或超过2000行。scripts/gitDelivery.test.mjs及聚焦子文件为临时仓库验证。

## CLI和核心协议（实施时如有必要改名必须同步Skill与测试）
`node <skill>/scripts/deliver.mjs inspect --cwd <repo> [--input <JSON-file>]`：只读preview JSON，不创建journal、不fetch，process Git env GIT_OPTIONAL_LOCKS=0避免只读refresh写索引。参数结构化解析，未知参数拒绝。
`prepare --cwd <repo> --input <JSON-file>`：在用户确认后冻结范围和消息，写common-dir receipt；网络fetch必须在确认push目标后执行。返回id、确认摘要和待确认变化，不把准备授权当任意后续新范围授权。
`commit|integrate|push|status|resume --cwd <repo> --id <id> [--input <JSON-file>]`：每步只使用固定receipt；若待新diff/验证必须提供该状态相符的新确认，不能resume自行绕过。
JSON输入允许targetBranch、remote、remoteBranch、paths、message、push、checks/evidence、expectedPreviewDigest/confirmation等；精确schema由实施核心统一定义并文档化，不允许任意Git flags/commands。Skill必须先inspect后让用户确认具体范围和动作，再prepare；脚本绑定digest防状态变更。message仅UTF8文本不shell执行。
模块导出可测核心函数（inspectDelivery/prepareDelivery/commitDelivery/integrateDelivery/pushDelivery/statusDelivery/resumeDelivery或等效），CLI只分派，不复制实现。

## 配置
.pi/git-delivery.json：targetBranch、remote、remoteBranch、pushFromPrimary=false、pushFromWorktree=true、mergeStrategy=squash、cleanup=never、language=zh-CN、checks。可缺失配置，歧义停下，不硬编码main/master/origin。配置检查命令属于需展示确认的仓库内容，不自动运行不信任shell；首版脚本可只接收验证证据并由Pi执行已确认命令，但证据必须绑定实际tree与动作确认，不能把任意输入当机械验证成功。输出remote脱敏，禁止凭据URL泄露。GitHub网络失败时知识要求7890代理，仅按需进程级使用，不改全局Git配置。

## 安全与Git语义
- project identity来自common-dir和worktree porcelain -z；真实refs决定模式。target显式>明确remote HEAD>用户选择；remote显式>target upstream；单remote只候选，多个不猜。源是target则主提交不push，linked task才自动squash，primary feature/detached停止。
- 明确paths、索引/工作区/diff/OID摘要与已有待交付提交，源最终必须clean以免整个分支squash混入未选内容。无关staged/dirty拒绝而非清理。目标checkout必须存在且已检出目标、干净，不自动checkout/stash。
- normal hooks不跳过，hook改内容后重新核对；进程用参数数组及消息临时UTF8文件git commit -F，恶意路径必须--边界。
- 目标oldOID/sourceOID冻结，merge --squash sourceOID在目标上生成索引；空diff不空提交或冒称已交付。最终diff需确认及相关验证证据，变化重新确认。
- fetch是经批准写remote跟踪状态，不属于inspect。remote落后/分叉停止不pull/rebase/force；目标已有未push提交完整展示确认。push明确refspec，确认remote绑定URL摘要（显示脱敏），前后复核。响应丢失通过远端ref包含确切resultOID核验，不重复commit。
- squash冲突保留目标index/工作区，不假设MERGE_HEAD/merge --abort；显式resume后核对冲突已解、实际树、测试与确认。不可自动reset回滚用户内容。
- 完成后源保留，并禁止对同source新历史盲目重复squash，提示新任务或明确新范围。既有finish普通merge/cleanup协议不变，不伪造祖先证明。

## Journal/锁
Git common-dir专用目录中version原子写收据，阶段prepared/source_committed/squash_pending/target_committed/push_pending/pushed/complete/blocked。intent先于Git写，记录父OID/预期树/消息/范围digest/check证据/source/target/remote/整合状态，id受限不可路径穿越。临时消息/锁/journal不进提交。
同common-dir交付锁，未知活进程/陈旧锁不抢占；锁不阻止任意外部Git，前后核对OID/index/原生锁必需，不能承诺原子避免所有外部竞态。
Git成功journal失败不能仅重跑；按parent/tree等充分证据恢复，证据不足停止。push intent与verified包含关系区分网络失败与完成。所有resume按阶段推进，不重复已成功步骤。

## 影响分析（Graph不可用降级）
新Skill脚本独立，不修改应用已有gitStore/finish/cleanup；只复用系统Git语义。已有Git panel无AI闭环，Pi模板仅文本投递，因此不借UI状态当结果。领域契约worktree-isolation约束保留，source不是squash结果祖先不能写merged receipt。CHANGLEOG TEMP、功能清单Pi/交付板块同步。

## 当前环境
当前linked分支无upstream、dirty含先前多个任务：不允许执行真实交付。只临时仓库自动测试，真实当前repo最多inspect只读；不触碰正式/开发应用，不自动GitHub推送。
