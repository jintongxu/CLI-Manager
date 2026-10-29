# 实施

1. 创建文档、上下文，validate/start，锁定design接口。
2. 后端默认home/全局根读取和窄IPC、定向Rust测试；前端独立设置section/专用可靠保存/双语/机器路径排除并行。
3. 联合核对同一settings文件、优先级和落盘可见性，更新TEMP/功能清单/契约。
4. 复用未失效证据，定向验证及架构，任务收尾。

验证：Rust默认根/配置/创建相关filters，必要cargo check；ConPTY占用时可用进程级TAURI_CONFIG resources=[]，不杀进程不改打包配置。TS实际mock保存/失败/恢复默认/picker取消/加载及sync排除测试；npx tsc --noEmit；npm run check:architecture及--strict；git diff --check。已知旧scripts/worktreeCreation.test.mjs8项失败不顺便改。无全库套件，按项目规范不启动应用，中英文桌面/多实例未验报告。无有价值新知识则零候选。

## 结果与验证
- 已实现项目根 > 本机worktreeDefaultRoot > home/Worktrees，窄get/validate接口与注册；同app_get_data_paths.settingsStorePath读取，坏配置不静默回退。稳定桶/checkout与junction防护保留，旧路径不迁移。
- 已实现General独立存储区域及专项保存、显式save后发布、失败补偿与本前端串行写；syncSettings字段excluded。不会提供跨窗口或开发版/正式版共享settings.json的事务隔离，避免并行修改同一配置。
- 后端证据 agent://36121959-2a4a-403d-8a6d-79e6146d2aaf：`TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --manifest-path src-tauri/Cargo.toml --lib commands::git_worktree::default_root` 11通过，`commands::git_worktree::create::tests` 12通过，`commands::git_worktree::tests` 27通过；同环境cargo check通过（既有警告）。不等价生产打包验收。
- 前端证据 agent://9dd19e10-3cbc-407f-9f4b-9a44a17d7ca8：`node --test scripts/worktreeRootSettings.test.mjs scripts/appearanceTransaction.test.mjs` 28通过；`npx tsc --noEmit`通过；普通/strict架构1483源文件零超限零新增违规；diff check通过。settingsStore1982行。
- 集成核对发现上轮双语测试loader需认识新的worktreeRootErrors模块，及旧路径文案断言需更新home/Worktrees，已同步；`node --test --test-name-pattern='actual short label field exposes bilingual' scripts/worktreeCreation.test.mjs`最终1/1通过。不改应用代码，不失效既有编译/架构结果。
- 额外旧 `scripts/worktreeLabels.test.mjs` 7失败（缺失sonner mock/旧显示预期），`scripts/appearancePreviewUi.test.mjs`8通过。未扩大范围修复；此前完整creation套件8旧失败不重复跑。
- TEMP、功能清单及Worktree契约已更新为home/可配置全局规则。普通/分屏/显式/Web创建的Store和server入口未改，均由执行设备Rust解析本机目录。
- 未桌面手验真实picker/语言切换/多实例保存创建，未启动或终止应用、未写真实配置、未安装依赖、未提交同步Git。Trellis active指针degraded，按任务目录收尾，不清其他任务指针。
- 新知识候选0：实现规则已更新领域契约，持久化补偿仅本前端，不将未经真实多实例验证的结论沉淀为规范。
