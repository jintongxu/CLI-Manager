# 强制删除追加功能交付

## 完成范围

完成弹窗增加独立“强制删除 Worktree”按钮。只读预检后显示项目/完整路径/分支保留/关联会话/目录数据丢失风险；精确输入目标路径并显式确认后执行。没有普通finish合并证据也可显式清理旧残留，不修改合并凭据、不stage/commit/merge、不删除branch。

新后端force_delete.rs/force_delete_tests.rs与三个IPC(lib注册)：inspect、validate原token不替换不消费、execute一次性消费。复用common身份/删除重试/rootabsence并检查prune影响范围。前端worktreeForceDelete/WorktreeForceDeleteDialog、FinishDialog/store集成，同WT共锁，SQL/local/refresh分开。双语风险精确说明未提交/未跟踪/残留目录数据会删除，已经提交的数据保留在现有branch不自动merge。

## 确认缺陷及审查

- 原token opaque无法在frontend关session前验证：增专用readonlyvalidate，同token/originalexpiry；执行仍复核。
- prune --expire now可能删除其它缺失WT登记：预检及删除后dryrun保守阻止其它候选，未证明排除时不prune。
- 外部close可能让保留confirmation回调/validation异步继续：parentgeneration绑定，在preflight后/副作用前再次确认生命周期；旧callback拒绝。
- 独立窄review覆盖三个forceIPC/identityhelpers/pathroot与registration/mismatch/replacedroot/protectedmain-otherWT/内部links不follow/prune；frontendcallback/token/session/SQLfailure/refreshfailure/dialoggeneration。无剩余确认缺陷。

## 验证证据

- 后端最终：`TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --manifest-path src-tauri/Cargo.toml --lib commands::git_worktree -- --test-threads=1`，69/69通过（14force+27finish+28既有worktree）。本轮Rust编译由最终librarytest证明。
- 前端最终：`node --test scripts/worktreeForceDelete.test.mjs`，31/31通过（10force+21导入finish）；`npx tsc --noEmit`通过。
- 独立严格架构：`npm run check:architecture -- --strict`，1215源文件、0超2000行、0违规。
- `git diff --check`通过；workflow自动metadata仅换行告警。
- 产品CHANGELOG TEMP、docs/功能清单Worktree、领域contract已更新；本文件/force-delete.md记录批准与确切IPC。

结果引用：agent://dfec73df-a706-4ac8-9652-77f4176c87f6；agent://fe9d37f9-1fbc-47d0-aa3f-4c197b8727f7；agent://d812c980-33a3-4843-8e6a-bc66dcffa6b9；agent://1d452543-a3f4-4218-a461-415b0f286e86。

## 限制与安全事实

测试均使用临时仓库或mockIPC/SQL，未真正删除task-1005-2309或任何用户目录/branch/DB，没有commit/push。未启动真实desktop验证布局/语言/真实OS占用，Unix link测试在Windows cfg未执行。crossprocess外部Git/FS竞争不受进程锁完整保护，已在契约说明；可能影响其它prune候选会保守阻塞而非扩大删除。
GitNexus/OCR unavailable，按contract/source+独立review降级，未宣称graphgate通过。复用仍有效证据，纯双语措辞更正没有重复测试。新增prescriptive约束落领域contract，无活动Run/Session，不另造重复知识候选（0新增候选）。
