# project-chips-drag-sort

## Goal

终端顶部第一行项目 chips 栏支持拖拽排序；拖拽后联动第二行 Workspan 顺序（按项目分组整体移动）并持久化（重启恢复）。

## Requirements

- 第一行项目 chips 可通过指针拖拽排序（与第二行 Workspan tabs 同一套 `DndContext` / `PointerSensor distance:3`）。
- 拖拽语义为"按项目分组联动"：把项目 A 的 chip 拖到项目 B 的 chip 上，A 拥有的全部 Workspan 作为一个稳定块移动到 B 分组所在位置；第二行随之重排。
- Workspan 与自身的 `primaryProject`（其首个成员的 `projectKey`）一起移动；混合项目 Workspan 跟随其 primary 项目，不拆散。
- 排序结果走现有 Workspan 持久化通道（`persistWorkspanState` → `saveWorkspans`），重启后恢复，无新增持久化机制。
- 作用域过滤（`hasScopedTerminalFilter`）开启时禁用拖拽，与第二行 Workspan tabs 一致。
- 三类拖拽互不干扰：project-chip / workspan-tab / session-pane 的碰撞检测互相隔离；拖 project-chip 时不出现 pane 拆分预览与 detach 预览。
- 不新增用户可见文案（无 i18n 增量）；点击选中、隐藏（X）按钮行为不变；X 按钮 `onPointerDown` 止血，避免误触发拖拽。

## Acceptance Criteria

- [ ] 第一行任意项目 chip 可拖到另一项目 chip 上松手，第一行顺序变化。
- [ ] 松手后第二行 Workspan tabs 按项目分组跟随重排；被移动项目的全部 Workspan 保持原有相对顺序。
- [ ] 混合项目 Workspan 跟随其首个成员项目移动，不被拆散。
- [ ] 重启应用后，第一行与第二行顺序与拖拽后一致（Workspan 持久化恢复）。
- [ ] 作用域过滤开启时，第一行不可拖拽。
- [ ] 拖 project-chip 时不触发 pane 拆分高亮 / detach 插入线；拖 workspan/session 时第一行 chips 不参与碰撞。
- [ ] `npx tsc --noEmit` 通过；新增纯函数单测通过；`npm run check:architecture` 通过。

## Notes

- 第一行顺序派生自 Workspan 顺序（`buildTerminalProjectOptions` 按 Workspan 中首现项目去重），因此"项目排序"的本质是"Workspan 按项目分组重排"，天然持久化。
- 与第二行已有的 `reorderWorkspans(fromId,toId)` 不同：项目移动是分组块移动，需新增纯函数 + store `orderWorkspans(orderedIds)`。
