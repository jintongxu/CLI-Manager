# 实施计划（已批准）

批准 handoff: c42614dd2a73c317660af9291f30dabd02e4d828cedbe93368058aa10fd0aee0。

1. [x] 知识闸机（无相关governing结果）、分支检查（无上游/干净）、根因契约与UI发现、用户批准。
2. [x] 原子实施身份生成与Rust权威创建；承接已有taskName字段，无IPC/schema/dependency改动。确认无法证明分支归属不删除。
3. [x] 接入Sidebar普通/分屏/自动和Git创建表单，每开窗一次内部身份，显示名可中文编辑，独立只读内部名称可复制；中英文说明外部占用会重新分配。
4. [x] 新建 focused creation Node 测试覆盖真实store/mockUI稳定候选、displayName独立、重复请求guard及失败释放/SQL失败；Rust临时仓库覆盖占用、分支/注册/共享根、竞争、非冲突失败、最多5候选、linked worktree。
5. [x] 更新 CHANGELOG TEMP 与 docs/功能清单 对应板块。
6. [x] 独立精确diff审查，合并同一状态机发现；复用未失效验证，不运行无关finish套件。
7. [x] 独立npm run check:architecture 与 npm run check:architecture -- --strict；评估手动验证限制及知识质量。提交仍待用户另行确认，不以勾选表示已提交。

## 验证
- node --test scripts/worktreeCreation.test.mjs
- cargo test --manifest-path src-tauri/Cargo.toml --lib <新增创建测试模块过滤器> （不得全库测试）
- npx tsc --noEmit；必要时cargo check。
- npm run check:architecture；npm run check:architecture -- --strict。
不启动应用，手动中英文/只读复制体验未执行如实报告。无相关material invalidator不重跑测试。

## review
主要子系统key=Worktree创建身份分配/提交/竞争。第一次review将所有已知边界合并处理，不持续逐个fix-review。未知图风险确认以contracts/text，不误称graph clean。

## 执行证据（实现代理）
- 根因修复：Store 不再从显示名推导内部身份；Sidebar 普通/分屏/自动及 Git 创建表单保存稳定候选，Rust 按真实目录/引用/登记决定是否重新分配。
- 已删除 failed-add 分支清理函数及其旧“此前不存在即归属”单测，创建失败不执行删除/复用。
- node --test scripts/worktreeCreation.test.mjs：7/7 通过，真实 transpiled Store、SidebarView、Sidebar controller、GitWorkspace mocked callbacks；含所有四个 Sidebar 提交、开窗稳定/重开新名、自动普通/分屏、guard/失败释放与 SQL 错误。
- TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --manifest-path src-tauri/Cargo.toml --lib commands::git_worktree::create::tests：9/9 通过，临时仓库、linked、目录/引用/缺失登记、共享根、外部反向交错与线程竞争、非冲突错误/五候选。资源覆盖仅测试进程环境，不修改打包配置。
- 无覆盖的原始 Rust 命令被缺失 apps/web/dist/assets 构建资源阻止；新并发测试首次发现“cannot lock ref: reference already exists”诊断未覆盖，已补精确识别并验证通过。
- npx tsc --noEmit：通过；git diff --check：通过。
- 实现代理已检查精确 diff、IPC/serde/DB/依赖未改。
- 独立审查覆盖所有修改及新增源文件/测试/文案/产品记录；OCR binary缺失采用独立人工diff审查，GitNexus不可用，不声称图检查通过。审查发现的自动动作重入、混合占用错误分类、引用命名空间冲突在一次集中批次修复。
- 最终focused证据：Node 7/7，Rust创建filter 12/12（同样测试进程TAURI_CONFIG资源覆盖），tsc及diff-check通过。先前9/9为首次实现证据，被最终12/12覆盖。
- Root 复核修复diff后独立运行 architecture 正常/strict 均通过：1251 source files，0超2000行，0新违规。未重跑无关finish全套。
- Worktree契约同步权威有限分配、独立显示名/固定preview、自动动作锁、混合错误保守处理、unknown失败归属禁止删除。知识质量结论：该非显然失败归属约束已落入契约，不重复新增知识候选（0）。
- 未启动应用；中英文真实桌面切换、鼠标/键盘选中复制与视觉布局仍需人工验证。没有自动提交、同步或push；Trellis状态保留in_progress直到用户决定提交/归档。
