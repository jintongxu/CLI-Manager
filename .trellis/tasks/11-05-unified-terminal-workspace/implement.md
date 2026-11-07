# 实施记录

## 阶段1：唯一布局迁移完成
新增terminalLayoutMigration.ts；sessionStore发布加载前迁移，workspans为唯一持久化权威，current-work冲突几何优先、保留普通残余分屏及遗漏归属，隐藏metadata保留，transient/匿名不进入重启快照。
保存原快照于terminalLayoutMigrationBackup，完整排队save成功后提交terminalLayoutVersion=1；失败可重试。saveWorkspans保存完整canonical快照，exit/recovery不复活旧partition。restore不再因workspanEnabled=false平铺canonical布局。

验证：migration/store + terminalWorkspan 27项通过；restore/remap定向4项通过；tsc与diff空白检查通过。广义terminalTabLifecycle 80通过4失败，均用baseline bf061895 terminalStore复现，未伪称全绿。古老splits缺二级sessionID仅保留备份，不重造PTY。

证据：agent://7581a18c-af53-42f9-ae6e-d5fbce6b33f9。

## 阶段2：统一UI已完成
统一canonical workspans渲染、导航与所有外部入口，移除旧成员UI/events/controller及runtime兼容facade；legacy字段仅在migration decoding读取。273项定向测试、tsc、strict architecture通过。3项广义lifecycle失败与process manager harness失败已baseline bf061895复现，非静默忽略。

## 独立审查修复
存储5项：启动load失败不许当空clear、complete writer缓存rollback、recovery发布Zustand、active selector一致、恶意/重复session边界。已集中修复，真实sessionStore38项通过、tsc通过；组合140项通过仍3项baseline生命周期失败。证据agent://a8ebade3-66c9-426d-8119-03c9c5763484。
UI4项集中修复：sidebar休眠实体化single-flight、已挂载休眠parser延迟初始化与live隐藏稳定消费、drawer关闭其他精确eligible集合已完成；49项导航/显示/资源测试与5项休眠测试通过，tsc/strict architecture通过。resource跨scope定位还需App接线，已放开原storage lane占用并授权最小更改。证据agent://3738be95-305a-4f62-bb19-1c9077a09e56；不将状态修复拆成无限复审链。

## 最终导航修复
App在resource/session target capture阶段验证目标并同步协调scope，再由既有listener唯一激活；去除通知处理重复setActive，保留startup加载失败闸门。47项导航/启动/焦点定向测试、2项休眠测试、tsc与strict architecture通过。证据agent://554d1296-2c7a-4d87-92a0-b26a40867b8a。其余未受影响证据复用。

## 手工边界与启动阻塞
未对真实旧快照和开发窗口做验收，未提交。知识统计原有改动保留。npm run tauri -- dev实际启动失败：Vite绑定127.0.0.1:1420返回EACCES，无该端口监听进程；netsh只读确认Windows排除范围1365–1464包含1420。未修改系统保留或结束正式版，需用户选择临时备用端口启动或系统层解除保留。零新知识候选（本次发现均保留在任务证据，未自动改知识库）。

## 用户纠正：恢复原单层终端标签
根因：统一界面解除旧模式条件后，TerminalTabsView 同时挂载 WorkspanTabBar 与 TerminalNavigationAdapter，形成两层主导航。删除前者整层及其专用视图参数/菜单，保留后者在唯一方向感知布局槽内；controller/store/migration不改。分屏内部 PaneTabBar 不属于重复主导航，保留。
触点核对：TerminalTabs→TerminalTabsView→App 调用链保持；Adapter继续接收完整sessions及mountedWorkspanLayouts，handleActivateSession仍走setActive；SplitTerminalView保持canonical树与比例；成员、PTY生命周期、迁移及21420开发服务均未操作。GitNexus upstream显示2个影响（TerminalTabs、App）、LOW，但索引落后106提交，以上按当前源码核实。当前分支wt/task-1104-1010-2c596940826c未配置上游，不执行同步。
验证：68项定向导航/UI/显示/标签布局测试全部通过（含单主层、顶部/底部及显隐、跨workspan可达与.37分屏比例）；npx tsc --noEmit通过；strict architecture通过（1684文件、零超限/新违规）。证据：output/single-tier-navigation-tests.txt、output/single-tier-tsc.txt、output/single-tier-architecture.txt。未重启应用、删除会话或提交；21420 HMR真机视觉验收尚未执行。
