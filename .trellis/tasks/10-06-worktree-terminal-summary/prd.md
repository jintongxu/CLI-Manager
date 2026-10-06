# Worktree终端状态汇总
批准handoff ac2288df7310b84bcd6ebb6ffe5094ec02b980d5881fe51a73d905e98a10f41d，TEMP。
## 需求
Worktree行折叠与展开均显示终端总数与非零运行/等待输入/完成/失败/远程数量，计入隐藏普通PTY，无终端不显示。五态互斥total等于和，实时更新，与列表一致。主树/compact/窄置顶/flyout同效，glyph+数字/full中英文tooltip和aria，长名称窄sidebar合理。只做汇总，不排序置顶/主仓库汇总/新操作。
## 验收
状态优先级沿用现有remote>error/exited>attention/done/failed>running，recovery_failed原语义；legacy与伪会话正确；零/多WT/hidden与collapsed、两density/语言/theme可用。保持折叠/PTY/lifecycle不变，聚焦tests/tsc/严格架构通过，实机限制明确。TEMP/功能清单更新，不Git同步提交/EXE构建。
