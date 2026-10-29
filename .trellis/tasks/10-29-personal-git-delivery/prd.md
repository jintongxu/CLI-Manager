# 个人开发中文提交与 Worktree 交付

用户唯一维护项目，批准实施计划53970bad8b1ad41711f2fbc429a628d3f7dfcee5e3a774124fe8cf8a7ea7c4dd，版本TEMP。选择先做项目级Pi Skill，不做GUI按钮。

## 需求
- 显式 `/skill:deliver`，preview仅只读；普通讨论不得启动写操作。
- 目标主分支上：只提交选定任务内容，中文commit，默认不push。
- 任务linked Worktree：先形成源提交，squash整合到明确目标主分支的一个中文提交，有明确已确认远端则push；默认保留源目录和分支。
- 主目录功能分支、detached、目标/remote歧义停止选择，不从目录名字猜。
- 不混入无关dirty/staged；主checkout干净；不自动stash/reset/rebase/amend/force push。
- 预览文件/分支历史、中文消息及全部目标未推送提交。Git原生hooks正常运行。
- 失败区分commit/integrate/push与恢复；push成功回执丢失、journal中断不能重复squash。
- 不伪造既有finish merge收据，不自动清理Worktree、不关闭终端。
- 配置无凭据，敏感内容不送额外模型；不修改Git作者、不自动PR/tag/release。

## 验收
临时repo/linked/bare覆盖主提交不push、source多提交目标一个squash、no remote、歧义main/master、自定义目标、多remote、范围/refs变化、dirty/hooks/冲突保留、remote拒绝/响应丢失、commit后journal故障恢复、重复resume、锁、中文/空格/参数注入。preview无refs/index/checkout/fetch写入。只运行定向tests与独立架构检查。Skill真实host加载若不可用明确未验。

## 授权边界
授权实现和临时仓库测试不等于交付当前工作区。禁止当前真实项目commit/merge/push，禁止安装全局Skill或操作运行中正式/开发应用。保留所有既有dirty文件。
