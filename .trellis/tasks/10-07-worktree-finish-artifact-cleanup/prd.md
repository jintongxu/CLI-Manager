# Worktree 完成恢复与大型临时产物自动清理

用户已批准Execute，handoff 521ff78a7e2fe11ab1736bf5580c661f52e27948dbb8d382157f251196c79fd9。

## 需求
- 修复大型构建产物触发finish_snapshot_limit而阻断整个完成流程。
- 提交/合并/清理/SQL完成分阶段可恢复，合并成功清理失败不能重复合并。
- 用户确认策略：已识别缓存自动处理，未知文件保留；一次统一清理确认展示确切路径，不逐个重复确认，确认才删。读inspect/open/startup不删。
- 默认支持验证过的checkout内node_modules/Cargo默认target；自有临时文件只凭实际已有生成记录。不能凭size/名称/.tmp/ignore认定垃圾。
- 显示整个授权缓存目录内容不可逆删除风险，手工放入的文件也在范围内；未知根外文件保留并指导移走，不静默扩scope。
- 双语阶段/路径/预算/候选/blocked说明，关联session及迟到状态保护。

## 验收
1. 6.5GB大型缓存不阻合并，清理确认后自动处理；未识别大型/log/tmp/ignored数据不删除，tracked不走缓存删除。
2. node/workspace/Cargo/metadata验证；custom/outside/shared/root links/内含Git仓库或其他worktree拒绝。
3. 所有权流式持久化和预算有限，意图落盘先于删除；root/content/source/base变化/权限/清单损坏停止。
4. 内部link只unlink自身，外部target保留；旧receipt恢复不得扩信任；partial-delete registered及unregistered两方向重启可恢复。
5. session关闭前后与cleanup期间新建/async launch/跨窗口IPC准入屏障；不能宣称防住任意外部writer。
6. force-stash blocker、分支expected-OID、SQL-only/ack/refresh顺序不回归。
7. 定向临时fixture/Rust+Node真实callbacks测试，不清理真实用户目录验收，不未授权启动app。

## 非目标
不改创建命名/数据库schema/dependencies/历史/provider/无关PTY协议，不放宽独立force-delete授权，不清全磁盘垃圾。不自动push/sync/commit。

## 交付
版本TEMP，CHANGELOG/docs功能清单/契约同步；人工未验说明。初始branch wt/task-1007-1055无上游，HEAD62914c7d干净；GitNexus不可用contracts/text fallback。
