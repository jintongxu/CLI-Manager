# 实施计划

1. 扩展 `CurrentWorkTabBarProps`，加入关闭其它终端按钮及文案；补齐两套 i18n。
2. 在 `useTerminalTabsController` 暴露 `closeOtherTerminals`，根据当前工作会话集合生成目标并调用 `handleCloseSessions`。
3. 在 `TerminalTabsView` 接线并按目标数量禁用按钮。
4. 更新 `CHANGELOG.md`（TEMP）与 `docs/功能清单.md`。
5. 运行 `npx tsc --noEmit`、`npm run check:architecture`，必要时运行终端相关定向测试。
