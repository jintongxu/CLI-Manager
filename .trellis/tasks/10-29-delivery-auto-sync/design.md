# 版本化交付同步与冲突协议

批准计划5c719b256f0ddebfc9f7529fec47361e2bc1f29e4a3d94db0353484f519cdffc。

新配置：pushFromPrimary默认true，pushFromWorktree默认true；显式input.push/config false保留。conflictResolution=agent|manual默认agent。唯一remote无upstream可作为候选进入确认，多remote缺明确选择时阻断，不能降级无remote。目标仍明确配置/remote HEAD解析，不从main/master猜。

新journal版本显式区分v1，新流程包含sync授权和原始source/squash结果、最终target/push tip、远端快照及sync意图；不得原地将v1扩权，可v1按原语义恢复或明确报需新授权且保留原文件。最多3次冲突/同步重试计数持久化。root/parent/common/branch/ref/URL绑定与已修RV-001/RV-002必须保留。

remote模块fetch返回equal/local-ahead/remote-ahead/diverged/missing，而非一律抛ahead。读取/网络错不当无remote。同步在干净目标checkout执行，FF或普通merge冻结remoteOID；无共同历史停止。merge冲突返回受控operation及base/ours/theirs路径上下文，Pi在Skill语义解决；脚本仅生成最终索引/tree预览并校验证据。普通merge必须真实多父中文提交，保留MERGE_HEAD验证。squash冲突无MERGE_HEAD，不能混用abort。未完成squash上不叠remote同步，先形成本地任务目标提交再同步新remote。

主分支：sourceResult即已提交任务，主与target同checkout，push过程以最终tip核验，不让ensureFrozenHeads误判自身sync变化。Worktree：先提交源，再在目标完成remote同步再squash，推前再看remote；目标OID变化需更新合法基线而非篡改旧确认。result/source/squash证据不被sync覆盖。

prepare/push/resume保持明确确认与allowFetch，不无条件确认绕过。新增同步动作/状态精确CLI由实现集中schema定义并交给根同步Skill。自动“继续”由Pi提供同授权范围下最终树证据与新摘要，真正变更目的地/业务范围须人确认。验证记录外部真实check并绑定最终tree，脚本不声称机械执行shell。

intent先于Git写，sync前父列表/remoteOID/tree/messages/paths冻结；commit后回执失败按真实父/tree/message核验，不重复merge/squash。push丢响应证明remote包含最终交付OID；remote再次前进有界同步。失败权限/分支保护保留本地结果不自动PR/force。

## 影响清单
GitNexus不可用契约+符号降级：git-config默认/remote解析 -> git-state预览 -> delivery-protocol/journal版本与strict schema -> delivery-remote快照 -> delivery主提交/整合/push/resume -> deliver CLI；必要按职责抽sync模块，不扩大GUI/Rust/DB。git-commit保留正常hook、真多父提交、scope/tree核验。
Skill与references中文/CLI、tests、TEMP及功能清单同步，原应用Worktree finish不变。

## Agent流程
conflict工具可用先list/diff；读base/ours/theirs与任务diff，只改冲突及必要相邻文件，不无脑整边覆盖。明确stage解决路径，实际最小checks，脚本新tree预览/证据，范围内复用用户完整交付授权继续。业务取舍不明/敏感范围扩大或3次失败停。不要接管进入交付前已存在merge/rebase，不重置用户内容。无需额外model/provider。

## 验证/回滚
临时bare及linked模拟Agent编辑/暂存，真实语义手验另报告。按目标文件/过滤器跑，不全库。安全review合并发现同批修；独立architecture普通strict、diff check。回滚代码默认，不删除refs/receipt/真实目录，不Git提交当前dirty、不杀进程。已有review52通过仅作为未改边界基线，修改触及目标需针对复测。
