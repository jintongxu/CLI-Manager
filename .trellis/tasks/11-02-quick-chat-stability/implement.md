# 实施清单

1. 落盘 prd/design/implement 与 manifests，`task.py start` 激活。
2. 内存上界：`panelController` 有界窗口 + 单调水位；`quickChatRemote` 发送 seq；Rust `Envelope` 可选 seq；`chatController` 有界 deleted/deleting；Rust `runtime.seen` 优先清理与 `unsaved` 上界。
3. 生命周期：移除 `ChatPanelSurface` 隐式 create；单一补建；恢复矩阵测试。
4. 错误分级：错误码 → 文案 + 动作；清除时机；zh/en。
5. 搜索：防抖、进行中、数量、清空；语义文案。
6. 退出清理：Rust 通道清空 + 快捷键注销 + 运行时清空；前端定时器/订阅/命令拒绝 + flush 报错。
7. 独立审查、定向验证、TEMP/功能清单与 verification 更新。

## 验证命令（按改动范围选择，复用未失效证据）
- `node --test scripts/quickChat.test.mjs scripts/chatController.test.mjs scripts/chatMultiSelect.test.mjs scripts/chatOrigin.test.mjs scripts/chatNavigation.test.mjs`
- `npx tsc --noEmit`
- `cargo test --manifest-path src-tauri/Cargo.toml chat:: --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml quick_chat:: --lib`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run check:architecture -- --strict`（已知两处无关历史超限，如实报告）
- `git diff --check`

## 不执行
不启动/重启桌面程序；不做真实删除、真实供应商调用；不做 Git 提交或同步；不按进程名批量结束进程。

## 人工验收（需明确报告未执行）
真实内存曲线、退出后资源释放、后台/托盘唤起、多屏 DPI、中英文切换、真实模型调用。

## 回滚
快聊功能可禁用回退；内存与退出改动不影响主聊天；如需回滚只撤本任务改动。
