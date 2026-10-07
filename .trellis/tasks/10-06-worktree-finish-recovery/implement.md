# 实施与证据

批准来源：Pi plan handoff fbd2e14cca8dc46601439a672e7a990913e8c892232bc36eb7c003004cbfe204（20261006T100922271Z）。完整执行图为 Pi Todos #4 → #5 → #6 → #7；此文件记录Trellis所需执行顺序与结果，不重复生成plan.json。

1. [x] curate contexts 并 start task（session pointer降级，状态in_progress）。
2. [x] Rust backend finish receipt/check/merge/cleanup/ack，复用清理原语，共锁/同repo/path安全。
3. [x] 临时Git及fault injection：正常、unregister后删除失败retry/restart、branch缺失有/无receipt、unknown残留、dirty/newtip/changed残留/replaced/mismatch/link、stashblocked、metadata/internalNotFound。
4. [x] IPC合约交付前端；store/db finalize/dialog async及sidebar/运行目录consumer，双语。
5. [x] focused Node行为测试覆盖重开/refresh/lang/stale请求、SQL/refresh失败、invalidcommit gating与sessionconfirmation，TypeScript check。
6. [x] 独立窄diff安全审查全部已知边界，复用有效证据，不反复全量验证。
7. [x] TEMP CHANGELOG和docs/功能清单Worktree，strict architecture；手动验证与graph缺失限制已记于verification.md。

验证：cargo test --manifest-path src-tauri/Cargo.toml <具体worktree/finish过滤>；node --test <本次新增focused脚本>；npx tsc --noEmit；cargo check --manifest-path src-tauri/Cargo.toml；npm run check:architecture -- --strict。

不启动真实desktop、不对真实旧worktree/branches/DB做测试、不自动commit/push。测试选择具体目标，不跑无关全库suite；只因材料变更重跑。回滚仅撤销本次代码diff，不改实际Git合并。

场景：正常/cleanup失败/注销残留/缺路径/缺branch/SQL失败；重试/重开/refresh/lang/晚到response；新commit/newdirty/未合并/stashrestore blocked/mismatch/root替换；多个关联会话仅确认关闭。主仓库 vs linked worktree .git文件 vs invalid严格验证，WSL/remote沿用不支持。focus/分屏/最小化/hook有无不改变authority，三个入口共用逻辑。

## 当前证据

只读分析 agent://e9f59b00-3fed-4305-ba47-2a1fc8416b3d，已与当前source关键remove/merge/dialog/store行确认。知识两次检索无相关结果。实际branch/head/旧目录只读核验见prd。
