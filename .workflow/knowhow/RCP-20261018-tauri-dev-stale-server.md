---
title: Tauri dev 复用旧前端服务导致黑屏的通用诊断与恢复
type: recipe
explicitId: rcp-20261018-tauri-dev-stale-server
created: 2026-10-18T06:59:53.329Z
keywords:
  - Tauri
  - Vite
  - dev-server
  - 黑屏
  - HMR
  - 模块缓存
  - 动态端口
lifecycleStatus: active
relatedPaths:
  - scripts/dev-server.mjs
  - scripts/tauri-cli.mjs
supersedes: ["knowhow-rcp-20261018-tauri-dev-vite"]
---

## Tauri dev 黑屏但 Rust 正常时检查被复用的旧前端开发服务

症状：Tauri/Rust 编译成功、桌面进程与后端服务正常，但窗口只有背景色，React 根节点为空，前端 logger 未初始化或 `bootstrap()` 失败。

常见根因：Tauri 重启时复用了仍在运行的旧 Vite/前端 dev server；该进程持有过期模块图或 HMR 缓存，使新 WebView 加载到与当前源码不一致的模块。典型异常是：

```text
The requested module '<module>' does not provide an export named '<symbol>'
```

诊断与恢复：

1. 不要假设固定端口。先从 Tauri 配置的 `build.devUrl`、启动日志中的 dev URL、`Reusing existing ... dev server at <url>` 输出，或当前 WebView URL，取得本次实际协议、主机和端口。
2. 连接真实 Tauri WebView DevTools，捕获 `bootstrap()` 的动态 import 异常；普通 Chromium 页面可能受调试注入影响，不能替代真实 WebView 证据。
3. 使用 `netstat -ano -p tcp`（或平台等价工具）按实际端口定位监听 PID，再核对进程命令行、工作目录或可执行路径，确认它属于当前项目/worktree 的前端 dev server。
4. 单纯重启 Tauri 不会清除独立存活的旧 Vite 模块图。只终止已确认的旧前端 dev server PID，以及可通过完整 `ExecutablePath` 证明属于当前 worktree 的开发版桌面进程；禁止按通用进程名批量结束，避免误杀正式版、其它项目或其它 worktree。
5. 重新运行项目约定的 Tauri dev 命令，确保启动的是全新的前端 dev server；确认日志出现前端 logger 初始化、应用启动阶段完成及所需后端连接成功。

适用范围不限于 1420：Vite 可使用配置端口、备用端口或其它项目自定义端口，必须以本次运行的实际 dev URL 为准。
