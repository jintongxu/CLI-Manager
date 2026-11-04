# 终端会话恢复：隐藏终端惰性重建

## 背景（用户报告 + 实证）

用户反馈："当前工作和待加入的终端标签就几个，但重新打开软件显示恢复了好多个终端。"

实证（读取 `~/.cli-manager/sessions.json`）：持久化 8 个会话，其中 7 个 `tabHidden: true`
（含 3 个无项目的旧 "PowerShell 7 ×1/2/3" 空终端），当前工作仅 5 个。

根因：`hideSession`（标签"隐藏"）= 展示层关闭，PTY 与持久化均保留；重启恢复
`restoreSessions` 按设计恢复全部持久化会话（含隐藏的），无 daemon 存活时逐个**重建 PTY
进程**。用户可见标签只有 5~6 个，却收到"已恢复 8 个终端会话"，侧栏与终端资源页也列出全部
隐藏终端。旧隐藏终端被反复重建进程，浪费资源且制造"恢复了一堆"的观感。

## Goal

重启恢复时，**隐藏（tabHidden）终端不再立即重建/attach PTY**，仅恢复为"休眠"元数据；
当用户从侧栏/待加入/资源页重新打开时，再按现有语义（daemon 存活 → attach；否则 → 重建
PTY 并贴回 scrollback）惰性实体化。

## Requirements

1. `restoreSessions` 对 `tabHidden: true` 的会话：跳过 daemon attach 与 PTY 重建，
   不订阅状态监听、不执行启动命令；保留原 id、标题、项目、cwd、cliSessionId、
   providerSnapshot、`initialTerminalOutput` 等元数据并继续持久化（下次重启仍可恢复）。
2. 休眠会话在 UI 中不产生可见标签；重新打开入口（reopenSession / showSessions /
   当前工作激活 / 侧栏打开 / 终端资源页）触发实体化：daemon 存活 → 复用现有 attach
   流程；不存在 → 复用现有重建流程（含 scrollback 贴回与 CLI resume 语义）。
3. 恢复提示"已恢复 N 个终端会话"只统计实体化（可见）会话；存在休眠会话时以补充文案
   说明"N 个隐藏终端将在打开时恢复"（zh-CN 与 en-US 双语，走 i18n）。
4. 孤儿对账安全：休眠会话 id 继续进入 `startPtyOrphanReconcileHeartbeat` 的活跃列表
   （沿用 `hasBackendPty` 过滤），daemon 存活的后台会话不得被对账清理。
5. 兼容性：不改变"隐藏 = 后台保留"的运行中语义（本次不隐藏，行为不变）；只改变
   **跨重启恢复**路径。`remoteHandoff`、`ephemeral-pi`、sync artifact 跳过逻辑不变。

## Acceptance Criteria

- [ ] 持久化含隐藏会话时重启：隐藏会话不产生 PTY 创建/attach 调用（测试断言
      `create`/daemon attach 调用次数为 0）。
- [ ] 重新打开休眠会话：daemon 存活 → attach 成功且状态正确；daemon 不存在 →
      重建 PTY、贴回 `initialTerminalOutput`、CLI 会话走 resume 启动命令。
- [ ] 恢复 toast 数量 = 实体化会话数，隐藏会话不计入；补充文案双语生效。
- [ ] 休眠会话重启两次仍可恢复（持久化不被清除）。
- [ ] 既有测试契约更新：`terminalTabLifecycle.test.mjs` "restore preserves hidden
      state" 改写为新语义；`npx tsc --noEmit` 通过；定向测试通过。

## Notes

- 方向已与用户确认（2026-11-04）：选择"恢复但惰性重建"，并要求走 Trellis 流程。
