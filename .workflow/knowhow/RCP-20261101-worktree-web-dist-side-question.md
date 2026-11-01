---
title: 新 worktree 首次运行开发版必须补齐 web dist 与 side-question 资源
type: recipe
created: 2026-11-01T03:12:14.577Z
lifecycleStatus: active
---

# 新 worktree 首次运行开发版的前置资源补齐

## 症状

在新建的 git worktree 中首次执行 `npm run tauri -- dev`，Rust 依赖全部编译通过后，`cli-manager` 包自身的 build script 连续失败，报错逐个推进：

```
resource path `..\apps\web\dist\index.html` doesn't exist
→ resource path `resources\side-question` doesn't exist
```

每次修复一个资源后重新启动，才会暴露下一个，容易被误判为环境损坏或反复怀疑 C 工具链。

## 根因

`src-tauri/tauri.conf.json` 的 `bundle.resources` 把两类**产物**声明为必需资源：

- `../apps/web/dist/index.html` + `assets/**`：web 工作区构建产物，`dist` 未纳入版本控制。
- `resources/side-question/`：由 staging 脚本生成，`.gitignore` 明确忽略。

而这两者的生成动作挂在 `beforeBuildCommand`（`node ./scripts/stage-side-question-runtime.mjs && npm run build && npm run web:build`）；`beforeDevCommand` 只有 `npm run dev`。Tauri 的 build script 在 **dev 模式下同样校验资源存在性**，所以 dev 流程不含的生成步骤必须先手工补齐。

老 worktree / 主仓库不报错，是因为 build script 已被 cargo 指纹缓存，不会重新执行校验；一旦清缓存或升级依赖即会复现。

## 恢复步骤（新 worktree 首次开发版）

```bash
# 1. web 工作区产物
npm run web:build

# 2. side-question 运行时（会写入 119 个包到 src-tauri/resources/side-question/）
node ./scripts/stage-side-question-runtime.mjs

# 3. 正常启动开发版
npm run tauri -- dev
```

## 附带的一处一次性编译失败

同批次还遇到 `libgit2-sys v0.17.0+1.8.1` 的 `util.c` 编译失败：`cl.exe` 退出码 2，cc-rs 捕获到的 stderr 为空。判定方法：对比另一个已成功构建的 worktree / 主仓库，其 `target/debug/build/libgit2-sys-*/out/build/` 下只有该文件缺失（209/210 个 `.o` 存在），且同哈希前缀的 `f6e81ea219c0b9f3-util.o` 在成功目录中存在 → 说明编译参数一致、属一次性失败。直接重试 `npm run tauri -- dev` 即通过（cargo 指纹会复用其余产物，只补这 1 个文件）。

不要因为这种「单文件 C 编译失败 + 空 stderr」去重建工具链或清理 target。

## 关键判据

- 报错以 `resource path <X> doesn't exist` 形式出现时，先查 `tauri.conf.json` 的 `bundle.resources`，再查 `.gitignore` 与 `beforeBuildCommand`，不要先怀疑 Rust 环境。
- dev 模式不执行 `beforeBuildCommand`，但会校验其产物。
