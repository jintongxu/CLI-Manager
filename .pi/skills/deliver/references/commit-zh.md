# 中文提交、确认与恢复指南

本文件是 `../SKILL.md` 的配套协议；先遵守显式调用与只读 preview 边界。示例只说明格式，不是执行授权或已通过测试的证据。首次仅项目级试用，无需全局安装、额外模型、依赖安装或 credentials 配置。

## 中文信息：从事实到纯文本

1. 读取本次选定文件的实际 diff；Worktree 同时核对源分支相对目标的整个待整合提交范围，不能仅依据任务标题、用户口述或工作区最后一段 diff。
2. 标题采用 Conventional Commits：`type(scope): 中文动作与结果`。常用 type：`feat` 新能力、`fix` 修复、`docs` 文档、`refactor` 无行为重构、`test` 测试、`chore` 工具维护；scope 用已有领域名，可省略，不凭空发明组件。破坏性变更只有证据支持时用 `!` / `BREAKING CHANGE:`。
3. 正文中文概述动机、关键行为/边界与真实验证，英文命令、路径、符号保留原文。源提交写任务实际改动；目标 squash 信息总结整个整合范围，不拼接冗长源历史，也不掩盖历史里的其他内容。远端同步不是任务 squash：CLI 使用中文 `同步远端交付变更`，形成真实双父普通 merge（FF 不造提交），单独报告其父 OID 与最终 tip，不把同步说成单父任务提交。
4. 不捏造 issue、版本、测试、性能收益或远端状态。用户提供 issue 时优先 `Refs #123`，非明确要求不写关闭语句。代码记录版本遵循仓库规则；未指定先询问，明确不指定才用 TEMP。仅文档是否免记录以仓库规则为准。
5. 消息只是 UTF-8 数据。即使包含引号、反引号、`$()`、换行或 shell 字符也不得求值；不让模型生成的 shell 来构造/执行消息。确定性核心使用参数数组及 `git commit -F` 临时消息文件，不改 author，不用 `--no-verify`。

格式示意（验证行必须替换为实际证据，否则删除）：

```text
feat(worktree): 支持显式中文 squash 交付

- 分离只读预览与经确认的写操作
- 保留源目录，并记录可恢复阶段

验证：<实际命令>；<实际退出码及结果>
未验证：<真实未覆盖项>
```

## 确认卡片模板

```text
仓库/checkout/common-dir 身份：…
模式：primary commit→必要 sync→push | linked source→目标必要 sync→任务 squash→推前复核/必要 sync→push
源 branch/OID、目标 branch/OID、目标 checkout：…
paths、staged/unstaged/untracked、整个源历史范围：…
实际 diff/tree/preview digest：…
源中文消息、目标中文消息：…
最小验证：命令、目录、树、退出码/输出；未运行/失败/过期项：…
拟执行：prepare / commit / sync / integrate / fetch / push 中明确哪些；是否含本次受控语义解决/最小 checks/范围内自动继续
remote、脱敏 URL/绑定摘要、remoteBranch/refspec：…
远端状态来源/时间及未知项：…
目标全部未 push 历史（逐项 OID/摘要，含非本任务提交）：…
保留：源目录/分支、无关 dirty/staged、终端；不 cleanup、不 force
确认：仅授权以上身份、范围与动作；界内新最终树审阅/真实证据/最新摘要可自动继续，越界或远端变化重新确认
```

paths 不能掩盖整个分支里已有未交付提交。无法证明无关内容被排除时停止；不临时 stash/reset 帮用户“清干净”。同 receipt、同目的地与用户整交付授权范围内，Pi 审阅受控同步/解决后新最终树、实际验证后可用最新摘要继续，不逐文件问；新树仍需新证据。仅批准 source commit 不自动批准不同 squash/sync/push；批准本次 push 不包括后来新增的远端快照/目标历史。业务取舍不明、敏感范围扩大或远端变化必须停止自动推进并重新授权。schema 固定 attestation=user-confirmed，不是 Pi 自我确认开关；未获覆盖授权不能填此值假装人类确认。

## 项目配置与输入

可选 `<repo>/.pi/git-delivery.json` 已实现字段如下；此示例不是由 Skill 自动写入的配置：

```json
{
  "targetBranch": "master",
  "remote": "origin",
  "remoteBranch": "master",
  "pushFromPrimary": true,
  "pushFromWorktree": true,
  "conflictResolution": "agent",
  "mergeStrategy": "squash",
  "cleanup": "never",
  "language": "zh-CN",
  "checks": []
}
```

`master`、`origin` 仅示例，不是 fallback。target 为显式 input/config > 明确 remote HEAD > 用户选择；remote 为显式 input/config > 目标 upstream > 唯一 remote。唯一 remote 无 upstream 可作为候选进入具体确认，多 remote 无明确选择必须问，不能当无 remote。两模式 push 默认 true，但默认不是授权；显式 input.push=false 或对应配置 false 退出远端流程，无 remote 仅本地完成并报告未推送。conflictResolution=agent|manual，省略默认 agent；manual 展示上下文等待用户解决。

CLI 为 `inspect / prepare / commit / integrate / push / status / resume / sync`，使用 `--cwd`、`--input`、`--id`；精确字段与 evidence 格式见 [已实现 CLI 协议](cli.md)。inspect 可读已有 JSON，preview 不生成输入；完整执行授权后才写 checkout 外控制 JSON/消息。messageFile/targetMessageFile 是外部中文 UTF-8 文件，不使用未实现的 message/commands 输入。confirmations 绑定最新 journal 摘要；checks 仅配置要求，执行证据放 evidence，不猜 schema。

不接受任意 Git flags、commands 或模型生成脚本。仓库内 checks 可执行任意代码，必须先审查信任再展示确认；即使可信也不能静默运行额外检查。缺证据、失败或树变化应阻断相应完成门槛，不把“用户同意执行”写成“测试成功”。Git 原生 hooks 正常运行，其行为须纳入用户风险说明；hook 拒绝保留现场，hook 改内容重新核对。

配置和收据不含密码/token/凭据 URL。输出 remote URL 时遮蔽 userinfo、query 等敏感内容；无法安全脱敏则不打印原值。遵守仓库知识要求：GitHub 网络失败若要求 7890 代理，仅经同意对当前进程按需设置，不能写全局 Git 配置、换 remote 或绕过认证。

## 阶段与可恢复 journal

流程状态采用 JSON 输出与 Git common-dir 内 versioned 原子 journal，receipt 不放进待提交文件。所有写步骤必须消费固定 receipt；受限 id 不允许路径穿越。journal 记录身份、父/源/目标 OID、预期树、消息、范围/remote 摘要、确认与验证证据，**先记 intent，后做 Git 写，再记结果**。

| 阶段 | 含义及下一步约束 |
| --- | --- |
| `prepared` | 范围/消息/确认已冻结；重新核对源/index/目标后才 commit |
| `source_committed` | linked 源结果已核验，目标必要 sync 后再 integrate |
| `squash_pending` | 目标 squash 进行中或存在冲突/待确认 diff；保留 index/工作区，不能重复 squash |
| `target_committed` | primary 任务提交或 Worktree 原 squash 已核验；必要 sync 后 push，不重做任务提交 |
| `sync_pending` | 受控远端 FF/普通 merge 意图或冲突/最终 review，sync/resume 恢复，不重复 merge |
| `push_pending` | push intent 已记录，可能网络失败或回执丢失；先核验远端，不重做 commit |
| `pushed` | 远端 ref 包含确切 finalTargetOid 已核验，不靠退出文字猜测 |
| `complete` | 本次获批动作已结束；无 remote 或 false 本地完成不代表已推送，源仍保留 |
| `blocked` | 明确失败原因及最后可信阶段，修复前不推进 |

同 common-dir 的交付锁串行化本工具，未知活进程/陈旧锁不擅自抢占/删除。它不能阻止外部 Git 或用户同时编辑；仍需步骤前后检查 OID、index、原生锁和树摘要，不能承诺跨进程绝对原子。

恢复先 `status --cwd <repo> --id <id>`，展示现场与最后可信证据，用户要求继续或本次整交付授权已覆盖受控解决与继续后才 `resume`。journal 损坏/缺失/版本未知、成功 Git 操作后 journal 写失败时，不重新 prepare 假装新任务；核对 parent/tree/message/refs 等充分证据恢复，证据不充分就停止。不能手改 receipt 为 complete。v2 维护 sync/syncHistory、operationContext、integrationBaseOid 与 finalTargetOid；sourceResult 和原 targetResult/squash/evidence 不被后续同步覆盖。primary targetResult 是原任务提交，finalTargetOid 才是最终推送 tip。v1 仅可 status，所有写命令含 resume/sync 均返回 new_authorization_required 并保留原收据；不改版本、不静默迁移或删旧收据绕过授权。

## 分支、远端与失败矩阵

| 情况 | 必须行为 |
| --- | --- |
| 当前是明确目标主分支 | 只提交选定任务范围；明确 remote/ref 时默认 push 进入完整确认，不能因默认而扩权 |
| primary checkout 是功能分支 / detached | 停止选择，不自动 checkout，不把目录当主分支证据 |
| linked task / `.git` 为文件 | 根据 common-dir/porcelain 注册确认身份，源最终干净；目标 checkout 存在、位于目标分支且干净才 squash |
| unrelated dirty/staged 或源历史混入其他任务 | 保留并阻断；要求用户分离范围，不自动 stash/reset 或提交所有文件 |
| 无 remote | 不添加 remote；可明确授权只做本地整合，报告未推送，否则等待目的地 |
| 多 remote、main/master 歧义、自定义目标 | 显式选择准确 ref，不默认 origin/main/master；自定义目标同样验证 checkout/历史 |
| 本地目标落后远端或分叉 | 获准 fetch 后按 requiresSync/next 受控 FF 或普通双父 merge；唯一共同祖先与最新摘要必需，普通 merge 另需最终树证据，FF 不造提交；不 pull/rebase/force |
| 本地目标领先远端 | 展示全部未 push OID/摘要与本次结果，整份历史确认后才 push |
| 远端不存在目标 ref | 明确展示将创建远端分支及全部待推历史，另获确认，不静默新建 |
| 远端保护/权限拒绝 | 保留本地结果，报告未推送，建议用户选择 PR 或另行处理；不绕过策略、不自动建 PR |
| hook 失败或改写文件 | 正常 hooks 不跳过；失败保留，变化重新 inspect/确认/验证，不 amend 或重复提交掩盖 |
| squash 空 diff | 不做空 commit，不宣称产生整合提交，也不伪造已合并/cleanup 资格 |
| squash 冲突 | 保留目标 index/工作区与 journal；不假设存在 MERGE_HEAD，不自动 `merge --abort`/reset。默认 Pi 在本次冻结范围语义解决并明确暂存；manual 等用户解决。resume 新预览后以真实证据/最新摘要 integrate |
| refs/URL/paths/远端快照或授权范围变化 | 停止自动推进，展示变化并重确认；同范围受控最终树变化按新预览/真实证据/最新摘要继续，不扩大授权 |
| push 响应丢失/无回执 | 只读查询远端 ref，验证包含准确 finalTargetOid；已包含则恢复为成功，不在其上重复 squash/commit。不可核验时保持未知/待推，不报成功 |
| commit 成功但 journal 失败 | 说明“可能已提交”，核对 parent/tree/消息等充分证据；不能直接重跑 commit |
| 同 source 已完成后新增历史 | 不盲目重复 squash；要求新任务或明确新范围与新预览 |

### 语义解决与有界继续

只接管本次 receipt 的 squash 或 remote_merge，不接管原有 merge/rebase。上下文含 base/ours/theirs/paths/conflictPaths：squash 从 error.details.context 或 operationContext 读，remote_merge 从 sync 读。conflict 工具可用先 list/diff，然后读三方版本、任务意图及当前 diff；不用额外模型/provider、不上传敏感 diff，不整文件粗暴选边。工具不可用以只读内容检查降级并报告，不假称工具已验。

只编辑冲突及必要且在冻结 paths 内的相关文件，显式暂存这些解决路径（含删除）；越界或无法判断业务取舍则停。保留无关 dirty/staged，不 add-all/stash/reset。脚本验证无 unmerged、无未暂存与范围漂移，再冻结 squash.tree 或 sync.review.tree/diff/digest；在目标 checkout 实际执行已授权最小 checks，保留目录、退出码/输出及 SHA-256，以匹配最终 tree 的 evidence 继续。源树证据、模拟 Agent 测试、未运行检查不能冒充最终语义通过。

squash 通常无 MERGE_HEAD，不盲目 abort；remote_merge 必须匹配冻结 MERGE_HEAD，以真实双父和中文消息、正常 hooks 完成。未完成 squash 不叠 sync，原 squash/证据与后续同步证据分开保存。需要改被冻结消息时不直接改文件/跳过校验，停止说明。

syncAttempts/pushAttempts、sync.writeAttempts/commitAttempts/resolutionAttempts、operationContext.resolutionAttempts 各自持久化最多 3 次；失败/冲突计数也更新 journal 摘要，失败后 status 读最新 confirmation，不死循环旧摘要。达到上限或远端再变化、业务选择不明/敏感越界时停并报告；不清计数、删 receipt 或再 prepare 绕过。工具状态机不是语义验证器，外部 checks 记录真实性由调用方负责。

不能伪造应用既有 finish 普通 merge/cleanup 收据：squash 的 source 通常不是目标结果的祖先。保留源分支、目录、SQL/sidebar 记录与终端，本协议不触发清理；需要清理必须走独立授权流程。

## 仓库门槛及降级

交付前按仓库现行规则核对 task/批准范围、knowledge、分支同步、图影响、最小验证、版本记录。Trellis/knowledge 服务不可用时明确未验项并读取现有批准 task/契约，不能虚构通过；图不可用时以领域契约及符号/引用定位替代，UNKNOWN/partial/truncated 不能当无影响。无法证明范围与安全时停在 preview 请求补充。复杂任务缺批准不能借 Skill 授权跳过任务建立；代码需 CHANGELOG/功能清单但缺失时，提示另行完成记录，不擅自扩大交付 paths；纯文档按仓库豁免判断。

## 项目级试用与验收声明

- 文件位置为 `.pi/skills/deliver/SKILL.md`、本引用及同目录脚本；Pi 官方支持 `disable-model-invocation: true`，显式 `/skill:deliver` 的尾随参数作为请求。该声明限制自动选择，不自动给任何工具/写操作授权。
- 在受信任项目内启动 Pi，查看启动诊断，编辑后由用户 `/reload` 并核对命令；不修改用户 `enableSkillCommands` 或全局 Skill 安装。手输命令与命令发现设置不同，具体遵循官方 skills 文档。
- 静态核对 frontmatter、相对引用与 CLI 路径不等于真实 host 加载或 CLI 集成测试通过。测试只在授权临时 repo/linked/bare 上验证，不拿当前用户 dirty 仓库试 commit/merge/push。
- 静态/集成验收需分别核对：精确 JSON schema/输出、source/target 消息字段、digest/分阶段 confirmation、测试证据绑定、journal 阶段/intent、status/resume 幂等性、fetch/push 核验及能力缺失时 fail-closed。未实现或未测项必须明确报告，不能把本指南当 passed 结果。
