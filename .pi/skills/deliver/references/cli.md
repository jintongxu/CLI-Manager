# 已实现的 CLI 协议（v2）

Node + Git，无第三方运行依赖。输出 `{ok:true,result:...}` 或 `{ok:false,error:{code,message,details}}`，失败退出码 1。按 Skill 绝对路径调用，路径/消息不拼 shell：

```text
node <skill>/scripts/deliver.mjs <action> --cwd <source-checkout> [--input <JSON-file>] [--id <receipt-id>]
```

支持 inspect/prepare/commit/integrate/push/status/resume/sync。inspect/prepare 禁止 id，其余必须 id；prepare 必须 input。未知/重复参数、未知输入字段拒绝；输入须为最多 4 MiB 的普通非符号链接 JSON 文件。所有恢复从 receipt 绑定的源 checkout 调用，不能把 cwd 换到目标。

## 1. inspect：严格只读

可无 input 查看阻断项；只接受以下字段：

```json
{
  "targetBranch": "master",
  "remote": "origin",
  "remoteBranch": "master",
  "paths": ["src/example.ts"],
  "messageFile": "<checkout外的绝对UTF-8文件路径>",
  "targetMessageFile": "<可选，缺省复用messageFile>",
  "push": true
}
```

master/origin 只是示例。消息须含中文，为 checkout 外普通 UTF-8 文件；prepare 最终预览必须带 messageFile。纯 preview 不创建任何输入/消息/journal，不 fetch、运行 checks 或刷新 index；读取已有输入，或无 input inspect。对话消息草案不等于已绑定消息的 digest。

获准执行后可把控制 JSON/消息放 checkout 外临时目录，再 inspect 取得最终完整 digest。result 包含 version=2/digest/context/resolution/config/scope/state；提供消息时还有 coreDigest/messages。state.ready 只表示本地就绪，不是远端写授权。scope 含 paths、消息、源分支历史、目标全部未 push 历史及跟踪状态（离线可能过期）。

push 默认取显式 input.push > 对应模式 pushFromPrimary/pushFromWorktree > true。false 保留并退出远端流程。remote 取显式 input/config > 目标 upstream > 唯一 remote；唯一 remote 无 upstream 是可进入确认的候选，不必先配 upstream。多 remote 无明确选择阻断，不能视为无 remote；多 URL 也阻断。无 remote 仅本地完成，不添加 remote。目标分支仍取显式 input/config > 明确 remote HEAD > 用户选择，不猜 main/master。默认值/配置都不是用户授权。

## 2. prepare：完整授权后写 v2 收据

inspect 字段加：

```json
{
  "expectedPreviewDigest": "<最终inspect.result.digest>",
  "confirmation": "<同一个digest>",
  "allowFetch": true
}
```

确认卡片覆盖身份、OID、范围/历史、消息、checks、同步/冲突解决、remote/ref/URL、全部待 push 历史与保留边界。push=true 且有 remote 时必须授权 fetch；未授权返回 fetch_authorization_required 和 details.id，收据已保存，不再次 prepare。status 后获准 resume 补授权。

fetch 的 remoteState.relation 为 equal/local-ahead/remote-ahead/diverged/missing；落后或分叉不直接拒绝，而按 next/requiresSync 进入 sync。无共同祖先/多个共同祖先、身份或 URL 漂移停止。

## 3. commit：任务提交

仅 `{ "confirmation": "<最新result.confirmation>" }`。主分支有 remote 且 push=true 时到 target_committed，之后必要 sync/push；无 remote 或 false 时 complete。Worktree 到 source_committed，先必要 sync 再 integrate；已有干净源历史由核心识别，不造空提交。

## 4. integrate：任务 squash 的最终树及证据

仅接受 confirmation/evidence。首次 confirmation 产生 squash.diff/tree，返回 requiresFinalConfirmation:true，不立即提交；需要同步时先返回 requiresSync。对最终树实际运行已批准最小 checks（含配置要求），再 integrate：

```json
{
  "confirmation": "<最新confirmation>",
  "evidence": {
    "tree": "<squash.tree或sync.review.tree>",
    "attestation": "user-confirmed",
    "checks": [
      {"command": "<实际执行命令>", "result": "pass", "outputDigest": "<实际输出SHA-256>"}
    ]
  }
}
```

evidence 仅 tree/checks/attestation；tree 为 40–64 位小写十六进制，checks 至少一项，每项仅 command/result/outputDigest，命令非空、result 只能 pass、摘要为 64 位小写十六进制。配置每个 checks 命令必须出现。执行目录/退出码/实际输出另留可审计记录，不向严格 schema 填额外字段。脚本不执行这些命令，不证明外部记录真实。

`user-confirmed` 是现有固定字面值，不是无条件 yes。仅在已有用户完整交付授权确实涵盖同范围的最终树审阅、语义解决及实际 checks，或另获用户确认时如实提供。Pi 可在该授权内审核新 diff/证据、用新摘要自动继续；不逐文件问，也不伪造人类确认。新业务取舍、敏感/路径/验证范围扩大或远端快照/目的地变化须停并重新确认。最终树变了必须新预览、新证据，不能沿用源树测试。

squash_conflict 的 details.context / receipt.operationContext 提供 operation=squash、base/ours/theirs/paths/conflictPaths/resolutionAttempts。仅解决本次受控范围并明确暂存后 resume，取得 squash 新预览，再 integrate 带 evidence。squash 无 MERGE_HEAD，不盲目 merge --abort；不能在未完成 squash 上叠加 remote sync。冻结 target 消息不直接改文件继续，不满足时停止，不 amend/reset。

## 5. sync：受控远端同步

```text
node <skill>/scripts/deliver.mjs sync --cwd <source-checkout> --id <receipt-id> --input <JSON-file>
```

严格仅接受 confirmation/allowFetch/evidence；首次：

```json
{"confirmation":"<最新receipt.confirmation>","allowFetch":true}
```

仅 v2、有 remote、push=true 且 source_committed/target_committed/sync_pending 可用，需 allowFetch:true。使用已冻结远端 OID，在干净目标上 FF 或普通 merge（不是 squash），intent 先写。Worktree 源已提交后先同步目标再 squash；推前远端进展时完成本地 squash 后再 sync。

FF 完成后回 returnPhase。普通 merge 进入 sync_pending，sync 含 operation=remote_merge、base/ours/theirs/paths/conflictPaths、returnPhase、kind=ff|merge、message、review/evidence、resolutionAttempts/writeAttempts/commitAttempts。有冲突时可返回 ok:true，仍不是交付完成。conflict 工具可用先 list/diff，再读冻结 base/ours/theirs 和任务 diff；不整边覆盖。仅编辑冲突及必要且属于冻结 paths 的相关文件，显式暂存解决路径（含删除），不得 stage-all 或接管既有 merge/rebase。

解决后 sync/resume 返回 `sync.review={operation,base,ours,theirs,paths,tree,diff,digest}` 与 requiresFinalConfirmation:true。无冲突普通 merge 也需此门槛。Pi 审阅新 diff，真实执行 checks，以 review.tree 和最新 confirmation 再 sync，输入为上一节 evidence 示例加 allowFetch:true。必须无 unmerged/未暂存/越界变化。普通 merge 校验冻结 MERGE_HEAD，正常 hooks 创建真实双父提交，中文消息固定为 `同步远端交付变更\n`；不能假称一个 squash 或单父任务提交。

## 6. push：明确 ref、完整历史、最终 tip

仅 `{ "confirmation": "<最新confirmation>", "allowFetch": true }`。推前 fetch；新远端快照/全部未 push 历史可能返回 requiresPushConfirmation:true，暂停自动推进、展示变化并重新授权。remote-ahead/diverged 同时通过 requiresSync/next=sync 指示同步，获准后 sync，再重新审阅 push。只推 `<finalTip>:refs/heads/<remoteBranch>`，不 force、不推其他 refs。

无 remote 或 false 退出远端流程；认证/网络失败不是无 remote。保护/权限拒绝保留本地结果，报告未推送，不自动 PR、改 URL/凭据/全局代理或绕过保护。push 响应丢失先 resume 核验远端包含确切最终 tip；不可核验保持未知，不重复提交。

## 7. status/resume、版本及计数

status 不接受非空输入，仅读 receipt 和当前状态，不加锁/写树/联网。resume 仅 confirmation/allowFetch/evidence，恢复已有 intent，不擅自进入下一阶段；sync_pending 可恢复同步，squash_pending 先产新预览后 integrate。源/目标提交恢复检查 parent/tree/message/clean；sync 提交恢复检查有序双父/tree/message；证据不足停止。

每次写入（含失败/待解决计数）会更新 revision/confirmation。总使用最新响应摘要；失败后先 status 获取最新摘要，不能复用旧字符串或手改 journal。v2 含 sync_pending、sync/syncHistory、operationContext、integrationBaseOid、finalTargetOid、syncAttempts/pushAttempts。syncAttempts、pushAttempts、sync.writeAttempts/commitAttempts/resolutionAttempts 和 operationContext.resolutionAttempts 分别持久化且各最多 3 次；到上限停止、保留现场，不删收据/清零或重 prepare 绕过。

sourceResult 保留原任务提交；primary targetResult 同任务提交。Worktree targetResult/squash/evidence 保留原 squash 及其证明；sync 前可更新合法 integrationBaseOid，sync 后更新 finalTargetOid，独立证据进入 sync/syncHistory，不覆盖源或原 squash。报告必须区分任务结果与最终 push tip。

v1 可 status 读取，但 commit/integrate/push/resume/sync 均 new_authorization_required，原收据不变；不原地迁移、不改 version、不扩展同步或默认 push 权限。旧交付如何另行授权需人工审查，不删除 receipt 绕过 active_delivery。

不删锁绕过活进程检查，不 reset/stash/abort 用户内容，默认保留目录/分支。已 squash 源新增历史不盲目再次交付，建议新任务。

## 验收边界

临时 repo/linked/bare 模拟 Agent 编辑与暂存不等于真实 Pi host 语义解决质量、真实 GitHub 权限/保护/网络手验。静态 frontmatter/引用/schema 检查也不等于 `/reload` 或真实 `/skill:deliver preview` 已验。文件 fsync/同目录 rename 不等于 Windows 目录 fsync 保证；工具锁不能阻止外部 Git。未验项必须如实报告。
