## 最新追加交付：已提交 BTW 持久化与保留

根因/发现：useBtwSideQuestion 原 require/catch 在 ESM 中静默失效；dispose->clear->remove 为非用户动作误删；history terminalId 精确过滤导致新 PTY ID 无法看到旧记录；publish(entries) 全量回写可能用旧历史覆盖新状态，hydrating 又吞掉并发用户提交；metadata patch 游离队列和仓库 existence/read 在 save 序列外存在时序风险。已阅读 hook/model/panel/repository、shared/platform/db.ts、btw_threads.sql、migration54 注册，既有 schema 能存完整/部分消息，不新增迁移。

实现边界：正常 ESM import 固定仓库接线，测试注入 SQL/platform harness 而非削弱生产；dispose 只标记 disposed/取消请求/解绑，不清空记录、不删除；terminal reconcile 仅清 UI。仅 remove/用户确认 clear(已加载集合) 删除。model 单队列按 thread 合并流式最新快照，失败保留重试工作，删除覆盖旧 save，读取等待已接受写并有 latest-query fence/tombstone；hydration 不抑制 live writes，读取不隐式保存任何历史。repository 全 save（查存在/消息/metadata）序列化，ordinal UPSERT 代替先删所有消息再插入；流式 partial 用现有 assistant 消息行保存，pending/stopped/failed 还原可读 partial，pending 映射 stopped。context 获取中旧 idle+inherit+draft 也恢复 stopped，不自动推理。读取失败和写/删失败在 drawer/history 两处显示双语 alert+存储重试。

默认当前终端不变，新增明确全部记录开关、跨终端搜索及每次100条更早分页；SQL terminal/query 在 LIMIT/OFFSET 前，分页只读不删。旧 ID 历史打开不改变当前终端 UI 归属，线程仍保持原来源；reader/follow/collapse/per-terminal memory 保留原逻辑，无 native reveal。

知识 gate 先执行 maestro load coding + knowhow btw/spec persistence 搜索（无相关命中），阅读 frontend architecture/history 契约；gitnexus impact 命令不存在/.gitnexus/run.cjs 缺失，使用 repo→getDb→schema/migration 与 hook→model→panel/drawer 调用/状态契约回退，图风险未知。分支只读 wt/task-1027-2130-3c711d70c03c，无 upstream；HEAD...本地 origin/master 0/0，未 fetch，无远端实时保证。保留既有 unrelated dirty/log/output/terminalMarkdownPreviewNavigation 变更，未修改终端退出流程。

验证：node --test scripts/btwPersistenceLifecycle.test.mjs scripts/btwHistoryScope.test.mjs scripts/terminalBtwThreads.test.mjs scripts/terminalBtwPanel.test.mjs scripts/btwTerminalDrawer.test.mjs = 54/54 pass。新增7项 fake persistence 生命周期/重建、终端关闭不删、目标删除、hydration 并发/晚查询、失败重试、1000片段 coalesce、真正 native ESM hook+实际 repo+fake SQL（含并发相同ID保存和 partial recovery）；双语 all-history/error render；既有 StrictMode IPC harness 现显式注入 repo。npx tsc --noEmit pass；独立 npm run check:architecture -- --strict:1508源码/零超限/零违规；git diff --check pass（既有CRLF警告）。只重跑这些材料受影响测试，未重跑 native exit regex；其既有 ExitRequested 不匹配失败沿用之前报告，不改不隐藏。

耐久性限制：未真正关闭/重启应用、未磁盘/真实Tauri/浏览器/语言切换验收、未检查用户私有DB。正常已完成SQL写入走现有磁盘仓库，但没有应用退出等待屏障；立即退出/崩溃可丢失尚未完成的保存，尤其最后流式片段。多语句更新不是跨连接SQLite事务，突发电源故障/中途IO失败仍可能留下部分状态（UPSERT避免先整体删除旧消息）；UI明确提示已检测到的失败，不能把fake SQL验证当作断电耐久性保证。初始未发送问题/阅读/折叠仍仅owner内存。无保留清理/迁移/commit/push/restart/process操作。报告schema两个约定路径缺失，按inline schema逐字段校验。

## 最新批准 2+3 交付

实现模型拥有的 per-terminal UI 快照与 per-thread reader，controller 同步 active terminal 和关闭清理；显式 bottom-follow 纯状态转换及组件 scroll/latest/resize 绑定。A/B 空初始草稿、来源快照、所选线程/追问、收起/关闭、历史保留、隐藏完成与晚事件、重挂载、向上阅读/最终块/latest/历史不强跳都有定向回归；没有新增引用展开或回填主任务功能。

本轮验证：7 个最小受影响脚本合计 58/58 pass（btwTerminalDrawer、terminalBtwPanel、btwHistoryScope、terminalBtwSource、terminalBtwThreads、terminalTabRow、btwNativeBridge）；npx tsc --noEmit pass；独立 strict architecture 1506 source files、零超限/违规；git diff --check pass，仅既有 CRLF 提示。旧 native-window ExitRequested regex 失败沿用既有证据，未重跑/未改退出子系统。未做真实 browser/Tauri/native/clipboard/语言切换，不将 harness 视为真实 UI 验收。

知识 gate maestro search 已先执行，BM25 无相关项目命中；读 triage/state/history/architecture 与当前入口链。GitNexus impact 命令不存在且 .gitnexus/run.cjs 缺失，使用契约/符号 fallback，图风险未知。只读分支报告：当前 wt/task-1027-2130-3c711d70c03c 无 upstream，HEAD...本地 origin/master 为 0/0，未 fetch，非远端实时保证。无 commit/push/sync writes/restart/native/process 操作。

持久化边界：新增终端 UI、初始未发送问题、阅读位置/follow/collapse 只存在 owner/controller 内存，切换/阅读器重挂载可恢复，终端关闭清除 UI，owner 销毁/应用重启清空；已提交线程/追问草稿沿用原 repository，无 migration。schema 两个约定路径缺失，按 inline report schema 返回。

# 实施记录（更正与追加批准）

## 截图纠正：更多菜单打开内嵌侧问

根因：BtwSideQuestionPanel 历史卡片点击已使用 selectEmbedded + onOpenReader，但更多首项仍调用 model.open，从 UI 路由边界错误触发 native reveal；因此在该组件共享 openEmbedded 回调修正，而非只改标签。

发现清单：已修正 BtwSideQuestionPanel 两个打开目标共用回调；新增 zh/en openEmbedded 文案；扩展 terminalBtwPanel 可执行回归（菜单与卡片回调相同、真实 owner 恢复消息/草稿、model.open 被禁止、openVersion 不变）；TerminalTabsView/onOpenReader 与 controller/openBtwReader 继续使用现有右分栏路由，确认无需修改；btwThreadModel.selectEmbedded/open 和 btwNativeBridge 原协议确认无关、未改。TEMP 与功能清单及本 task 验收同步纠正。运行中/已完成、归档可见项均由同一逐卡片回调打开，不依赖新增焦点/环境条件。

知识闸机：maestro search 无相关项目命中，coding spec/triage/架构与历史契约已读。GitNexus .gitnexus/run.cjs 缺失且 PATH 无 gitnexus，使用契约及符号 fallback，图风险未能评估，不声称低风险图结论。分支 wt/task-1027-2130-3c711d70c03c 无 upstream；HEAD 与本地已知 origin/master 比较 0/0（未 fetch，不代表远端实时状态）。保持既有 dirty，仅做增量定点修改。

验证：`node --test scripts/terminalBtwPanel.test.mjs scripts/btwHistoryScope.test.mjs scripts/btwTerminalDrawer.test.mjs scripts/terminalBtwSource.test.mjs scripts/terminalBtwThreads.test.mjs scripts/terminalTabRow.test.mjs scripts/btwNativeBridge.test.mjs` 54/54 pass；`npx tsc --noEmit` pass；独立 `npm run check:architecture -- --strict` 1505 文件、零超限/违规；`git diff --check` pass，仅已有 CRLF 提示。双语通过组件渲染测试验证；未新开浏览器、未做真实语言切换/native 验证。无 commit/push/restart。报告 schema 两个约定路径缺失，按 inline schema 返回。

## 最新交付：历史优先侧栏（覆盖旧「侧栏入口不变」范围）

用户明确批准在原 task 延续：右侧气泡入口「侧问记录 / Side question history」，tooltip「查看侧问记录，继续之前的讨论」；顶部搜索/新建，当前终端精确过滤，标题/摘要/时间/状态与更多操作。历史点击 selectEmbedded + openBtwReader，不触发 native；新建 stageFromTerminal 当前 terminalId 后打开内嵌输入。后续截图纠正：历史卡片更多首项也必须打开内嵌，移除该菜单 popout；其他入口的原单 owner/reveal 协议不动。

读取当前 dirty 源码后在既有实现上增量完成；不覆盖 unrelated workflow logs/scripts/terminalMarkdownPreviewNavigation.test.mjs/evidence。新增 selectEmbedded 是现有 embeddedId API 的历史选择补充。持久化复用 existing list/search/created_at，过滤在 LIMIT 前；UI 过滤 merged live entries 不删 pending owner；start hydration 合并现存 live entries，避免初次读取驱逐新提交。

验证：`node --test scripts/btwHistoryScope.test.mjs scripts/btwTerminalDrawer.test.mjs scripts/terminalBtwPanel.test.mjs scripts/terminalBtwSource.test.mjs scripts/terminalBtwThreads.test.mjs scripts/terminalTabRow.test.mjs scripts/btwNativeBridge.test.mjs` 53/53 pass，证据 output/btw-history-focused-tests.txt。当时覆盖当前 terminal SQL/UI 过滤、历史 messages/draft 恢复不 native reveal、旧明确 popout、新建路由、pending/background hydration 与 toolbar 不重 stage；其中菜单 popout 预期已由后续截图纠正替代。另本轮实际跑含 btwNativeWindow 的组合共 58 tests，57 pass/1 fail，仅旧 ExitRequested regex（scripts/btwNativeWindow.test.mjs:112）与 exit_coordinator 不一致，不修无关流程。

`npx tsc --noEmit` 通过（首次发现错误 setter 后改用既有 workspace route）；独立 `npm run check:architecture -- --strict` 1504 文件零违规；`git diff --check` 通过仅现有 CRLF 警告。最终再验 tsc 通过，strict architecture 1505 文件零违规，diff-check 通过仅 CRLF 警告。未执行 browser/native/clipboard/语言切换，不宣称真实 UI 成功。无 commit/push/sync/restart。分支无 upstream，不能给出远端同步差异；仅只读报告 origin/upstream 配置。schema 两个约定路径均缺失，最终按 inline report schema 校验。

## 当前交付：右侧分栏

本轮已按追加批准将底部 overlay 替换为 TerminalWorkspaceFrame 内的右侧 flex 分栏，增加提交前继承开关（默认关闭），完成与流式回答均走 SessionTranscriptContent variant=terminal + useTerminalPreviewTheme + subagent-transcript-markdown。原 sidebar/native 入口及 reveal 协议不改。

根因：旧组件的 local activeId 与 owner staging 生命周期分离，Git 条件卸载也丢失绑定。现由 owner embeddedId/stageVersion 与 thread.draft 统一管理；新 stage 重置内嵌选择，重挂载恢复线程/草稿；历史查询保留内嵌/运行中的对象；来源已移除不采信残留 runtime status；停止支持 context 获取阶段，晚到快照被 generation fence。

验证：`node --test scripts/btwTerminalDrawer.test.mjs scripts/terminalBtwSource.test.mjs scripts/terminalBtwThreads.test.mjs scripts/terminalTabRow.test.mjs` 36/36 通过（包含组件 hook 生命周期 harness、模型、旧线程回归与文本契约，不等同实际浏览器挂载）；`npx tsc --noEmit` 通过；独立 strict architecture 通过（1504 文件、零超限/违规）；`git diff --check` 通过，仅已有 CRLF 警告。

另实际运行 `scripts/btwNativeWindow.test.mjs`：8 pass / 1 fail。失败是第 5 项旧静态 regex 仍要求 lib.rs ExitRequested 直接 shutdown，与现有 exit_coordinator 事务结构不符；本轮没有修改该退出流程或篡改测试。不得将其省略为 BTW 全部通过。

知识闸机 maestro search 已执行，无相关项目知识命中；已读 triage、架构/history-session 契约。GitNexus impact 重试失败：`.gitnexus/run.cjs` 缺失，使用契约/符号 fallback，不宣称图分析成功。分支 wt/task-1027-2130-3c711d70c03c 未配置 upstream，同步状态不可比较；未做任何 Git mutation/commit 或运行中应用进程操作。

本轮未运行浏览器或真实 Tauri/native/系统剪贴板/语言切换验证。旧 output/btw-drawer-expanded.png 保留作旧 fixture 证据，不能证明新右分栏或原生功能。下方旧记录仅保留历史信息；其中广泛 UI 验证和“34/34 即所有 BTW 测试”措辞撤回，以本节为准。

## 历史记录（已被上文替代）

## 结论

已完成终端底部 BTW 抽屉第一版最小闭环。

## 改动清单

- `src/features/terminal/lib/btwThreadModel.ts`: `submit()` 扩展返回新建 thread id（`string | null`），供抽屉局部绑定，避免调用 `model.open()` 触发原生独立窗口 reveal。
- `src/features/terminal/components/BtwTerminalDrawer.tsx`: 新增抽屉组件，集成状态指示、停止/重试/复制、流式 Markdown 显示、就地追问与高度调节。
- `src/features/terminal/components/btwTerminalDrawer.css`: 抽屉样式，`absolute bottom-0 z-[3]` 贴边浮层，`color-mix` 语义变量，包含脉冲动画与减弱动态媒体查询，无横向溢出。
- `src/features/terminal/hooks/useTerminalTabsController.tsx`: 增加 `btwDrawerOpen` 与 `closeBtwDrawer`；`onAskBtw` 触发时打开抽屉。
- `src/features/terminal/components/TerminalTabsView.tsx`: 挂载 `BtwTerminalDrawer`，与 `gitWorkspaceOpen` 互斥。
- `src/shared/i18n/messages/terminal.zh-CN.ts` & `terminal.en-US.ts`: 双语补充 10 个抽屉操作及提示键。
- `scripts/btwTerminalDrawer.test.mjs`: 7 条行为与契约测试。
- `scripts/terminalTabRow.test.mjs`: 更新 `onAskBtw` 路由断言（已指向抽屉而非强制切侧栏）。
- `scripts/fixtures/btwTerminalDrawer.tsx` & `scripts/btwDrawerFixture.server.mjs`: 真实浏览器独立验证 fixture。
- `CHANGELOG.md` & `docs/功能清单.md`: TEMP 交付记录已同步。

## 验证结果

- 定向测试：`scripts/btwTerminalDrawer.test.mjs` + `scripts/terminalTabRow.test.mjs` 14/14 pass。
- 既有 BTW 测试：`btwNativeBridge` (3), `btwQuestionNavigation` (3), `terminalBtwCommand` (6), `terminalBtwPanel` (8), `terminalBtwSource` (1), `terminalBtwThreads` (13) 全部 pass (34/34)。
- 类型检查：`npx tsc --noEmit` clean。
- 架构检查：`npm run check:architecture -- --strict` clean（1504 源文件，零违规）。
- 格式检查：`git diff --check` clean。
- 旧 fixture 截图：`output/btw-drawer-expanded.png`。此前“全部交互已验证通过”的描述缺少逐项证据，撤回；不构成真实应用、native、clipboard 或本轮右侧分栏验收。
- 侧栏 `btw` tab 与原生独立窗口入口及行为完全保持原样。

## 交付边界说明

- 用户指示本轮不提交不推送，代码保持在工作区内待命。
- 知识候选：0 条（属既有侧问能力的呈现层扩展，不产生跨项目通用规则或底层新模式）。
