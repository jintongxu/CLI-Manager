# 技术设计（已批准）

批准 handoff 521ff78a7e2fe11ab1736bf5580c661f52e27948dbb8d382157f251196c79fd9；原文source C:/Users/xujin/.pi/workspaces/task-1007-1055-1f8ac349/sessions/01a1144b-2520-75ec-b3e3-5defdfe28045-9c96c373/plans/approvals/20261007T135947081Z-r0004-0c2fa729-h521ff78a7e2fe11ab1736bf5580c661f52e27948dbb8d382157f251196c79fd9.md。

## 根因
finish.rs merge_with_save先whole-root snapshot再merge；ignored缓存也被算且metadata+readbytes重复计数。合并与删除所有权耦合，cache6.5GB阻断merge。

## 状态分离
merge只clean checkout/source/base/stash检查+durable intents/outcome，无cleanup snapshot。inspect只观察，不发授权、不写manifest、不close/delete。valid registered尚未cleanup的merged receipt可确认后准备；无ownership未登记residual保守block。retry只未完成阶段。

## 分类和授权
允许current checkout内node_modules（真实package/workspace+installation metadata/结构+ignored+no tracked descendants）、Cargo默认target（package/workspace默认位置+CACHEDIR.TAG/产物结构+ignored+no tracked）。正确workspace对应，不只凭名；custom/outside/shared/ambiguous target不猜。自有temp只已有可靠生成记录，没有就不自动删；任意tmp/log/dist/download/config/data/源代码/未知large都保留。whole recognized root授权可能删除手工放入data，UI明确并一次confirm可取消。unknown ignored/untracked在roots外列block，防整个Git remove隐式删除。tracked正常提交合并证据。

## 协议
追加cleanup plan/validate能力，与现fields兼容；bind req/source/base/repo/root identity/classifier version/exact candidate roots/deleteBranch。预检只读估计budget内可unknown大小计数；用户confirm后same token，范围变化fresh confirm，不悄悄replace。validate beforeclose session，close/release后再check；central create/split+RustPTY admission屏障同checkout多窗口及already async launch，其他project不受影响。

## Manifest与删除
ordinary snapshot保守limits，修double计数。authorized artifact用sha2流式hash，bounded chunks commonGit outside checkout，receipt refer version/digest/count。budget=32GiB content/500000 entries/128MiB manifest/10min prep，各budget错误具体定位；注入小budgettests，不降低为mtime/root-only。complete classification+ownership durable后首次delete。native roots+entries+subset，变化/新git/corrupt manifest/权限保留block。
先删authorized artifacts while still registered .git，再ordinary ownership并现Gitremove/prune/rootabsence/conditionalexpectedOIDbranch。不能删除前才发现unknown并留下partial。journals每phase durable，再delete，failure retry不新授权。v1valid registeredprecleanup可新prep；v1cleanup_intent/unregistered unknown不得扩scope。rollback旧版未知receipt保留不删新manifest。
cache root/ancestorslink拒绝，internal recordedlinks只unlink自身nevertarget；nestedrepo/worktree/protectedroots拒绝。arbitrary external mutation非atomic，重复复核不是全外writer保证。

## 触点
Rust finish.rs/receipt.rs +专职classifier/manifest/cleanup模块/tests；worktree/force_delete复用helpers不改dangerpolicy；IPC registration。frontend worktreeFinish.ts/store/FinishDialog、terminal central create/split及RustPTYadmission、StatusDialog/Webwire兼容核对、领域i18n。TEMP two docs/契约。

## 安全审查矩阵
oversizedcache/unknown/literalignored→merge不block；force restore永block；before/after unregisterpartial/rootreplacement/newcontent/newgit/sourcebasechange/refinuse；manifestwriteflushpublishfailure，readlock/innerNotFound/false-success；symlinkjunction/outside/shared/nested；newsessionpre/postclose/duringcleanup+async+otherwindow；v1/unsupported/corrupt/doneSQLretry；generation/language/openinspect无delete。fixturesonly，no actualuserdirectory deletion。

## 回滚
无DB迁移，新field/versions分流；不能旧版把新manifest忽略后授权delete。merge不回滚，cleanupfailed如实phase。2 corrections/3 review rounds limit一次集中fix所有known boundaries。
