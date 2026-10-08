# 修复重启恢复后 Worktree 状态误判

## 用户问题

关闭应用后重新打开并恢复终端，所有 Worktree 终端标签显示「Worktree 丢失」，侧栏所有 Worktree 显示「待完成恢复」。用户同意创建独立 Trellis 修复任务。

## 目标

- 定位重启时正常 Worktree 被误判为待恢复的根因，修复状态生产 / 对账边界，不在标签上掩盖错误状态。
- 恢复后的普通 Worktree 终端仍保持正确项目、Worktree ID、路径及会话身份，标签能显示真实归属。
- 真正存在完成收尾、恢复阻塞或失效 checkout 的 Worktree 继续受到原有安全保护。

## 约束

- 调研阶段只读，不触发 Worktree 合并、提交、完成清理、数据库修复写入或删除，不擅自把所有状态改成 active。
- 保留当前 Worktree 内此前标签栏改动及会话数据，不做 Git 同步 / 提交。
- 修复前产出根因陈述、代码发现清单、场景矩阵和设计 / 执行计划，方案获批准后再实施。
- 不新增依赖或不必要的持久化协议；必要边界变化须在方案中说明。
- 用户可见文案如有改动须兼容 zh-CN / en-US。
- 代码交付同时更新 CHANGELOG.md 的 TEMP 记录与 docs/功能清单.md 对应 Worktree / 恢复板块。

## 验收

- 有效、未进入完成流程的 Worktree 在启动检查与终端恢复后仍判为可用，不误显示待完成恢复或丢失。
- 真正完成流程部分失败 / 清理待恢复状态不被正常化；缺失路径 / 已注销 checkout 不错误开放新建终端。
- 已有受影响状态如需恢复，只按明确有效性证据对账，不全量强制覆盖。
- 覆盖主仓库、有效 Worktree、缺失 Worktree、有 / 无完成凭据、正常启动与重复加载、恢复模式 ask / auto、已有 daemon 与快照重建、主目录与 Worktree 会话、隐藏终端与混合分屏。
- 使用最小定向回归验证状态判定、启动接线和标签归属；执行必要类型 / 跨层检查及独立严格架构检查，不运行无关全量套件。

## 初步线索（不是根因结论）

- worktreeStore.markMissingWorktrees 在启动时调用 inspectFinish。
- inspectFinish 消费后端 FinishState，通过 finishStatus 更新 Worktree 状态及持久记录。
- 终端标签模型仅把 active Worktree 当作有效；pending 状态会被展示为丢失。

## 当前状态

已创建，planning。分支 wt/task-1007-1111 无上游；未同步。下一阶段只读追踪 FinishState 来源、凭据与启动检查，再提交修复方案。
