# 执行

- [x] 用户批准需求/方案，建立规划三件套；分支 wt/task-1006-1637 干净无upstream，不同步Git。
- [x] 审计生命周期与激活/恢复调用点，新增可见性字段和hide/reopen动作；保持backing layouts/输出监听；标签所有关闭入口区分PTY与伪会话。
- [x] 加入Worktree/主项目终端列表、单击重开、右键删除及键盘ARIA，双语言与既有样式。
- [x] 聚焦自动验证并更新TEMP changelog、功能清单和任务完成记录；实机验收未执行，限制如下。

## 验证与复用
新增聚焦测试：隐藏不close、不删layout；重开不create；scope×hidden、多pane/最后成员回退；两种restore保留字段；归属/删除。运行直接受影响 terminalWorkspan 测试及新增文件；仅改exit/runtime边界时追加其测试。npx tsc --noEmit；npm run check:architecture -- --strict 独立运行。不跑无关Rust/全库测试；复用有效通过结果，改动到所测输入才重跑。
实机可用时验证持续输出→隐藏→重开同进程、右键删除、daemon与fallback/ask/auto重启恢复、中英文及24小时格式。无法实机验证则明确记录，不用静态结果冒充。

## 结果与验证限制

- 生命周期与相关现有回归共73项通过，侧栏集成批次23项通过（有重叠，不合计为独立测试数量）。
- 独立集成审查发现P2：显式重开另一Pane的终端时，原Pane fullscreen仍遮挡目标。根因是显式导航与controller局部fullscreen状态分离；已将fullscreen改为store运行态，在setActive/setActiveWorkspan中原子协调跨Pane/Workspan导航，同Pane保留。
- 修复后生命周期18项通过（含7项focus-mode导航新增回归），npx tsc --noEmit、npm run check:architecture -- --strict、git diff --check最终均通过，1212源文件零2000行超限。
- OCR CLI和GitNexus不可用；使用独立人工式代码审查与契约/符号调用点审计，无图风险等级证明。
- 未运行Tauri桌面/真实PTY验证：同PID持续输出、native菜单焦点、实际compact/focus-mode渲染、中英文设置切换、local/WSL/Bash/SSH与托盘、daemon/重建及ask/auto启动仍需实机验收。自动测试有native边界mock，不能替代这些验证。
- 未Git提交/同步，未修改依赖或运行无关全量检查。无新增可复用知识候选：隐藏终端保持挂载的约束已有契约，不重复建立知识。
- 证据：agent://b4d248c0-a44a-41c8-9615-7503c5713161；agent://079a73e8-9deb-4cca-89d5-57dbbaace8e2；agent://65feb739-19ca-4d96-a1df-db7cd50a264c；agent://bb1c1392-ca83-4733-b0c0-fa04c7d0228c。

## Review/rollback
按shared lifecycle/visible layout/restore同一状态机合并问题，避免逐个修复重审。保持用户无关修改，禁止同步或自动提交。回滚隐藏字段后旧版会显示标签，但不能删除数据；不改变恢复/退出设置协议。
