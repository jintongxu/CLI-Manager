# Design — V1.4.4 Windows Release

## Scope and boundaries

本任务不改变运行时功能，只同步版本/发布元数据并执行既有 Windows 发布链。正式二进制由 GitHub Actions 的 `windows-latest` runner 通过 `tauri-apps/tauri-action` 构建和签名；本地验证不替代正式构建。

## Release data flow

1. 将六个桌面版本源统一为 `1.4.4`。
2. 将手动工作流默认 tag 和静态发布测试更新为 `V1.4.4`。
3. 添加 V1.4.4 变更记录并运行定向验证。
4. 创建单个发布准备提交，确保工作区干净。
5. 推送 `master` 到 `origin`，再创建并推送 annotated tag `V1.4.4`。
6. tag push 触发 `.github/workflows/release.yml` 的唯一 `build-windows` job。
7. workflow checkout 精确 tag，执行 `npm ci`、发布契约测试和 Tauri Windows 构建，发布 NSIS/MSI/签名/`latest.json`，随后生成并上传 portable ZIP。
8. 使用 `gh run watch --exit-status` 等待结果，并通过 Release API 核验状态与资产集合。

## Touchpoints / discovery list

GitNexus 本地入口 `.gitnexus/run.cjs` 缺失，无法执行 graph query/impact；按强制降级路径使用 `.trellis/spec/guides/version-update-checklist.md`、`.trellis/spec/backend/tauri-updater-contracts.md` 和精确搜索确认触点。

- [x] `package.json`：npm 根版本。
- [x] `package-lock.json`：顶层与 `packages[""]` 根版本；依赖中的 `1.4.3` 不修改。
- [x] `src-tauri/Cargo.toml`：桌面 Rust package 版本；现存 `1.4.2` 漂移必须纠正。
- [x] `src-tauri/Cargo.lock`：`cli-manager` 根 package 版本；依赖版本不修改。
- [x] `src-tauri/tauri.conf.json`：正式 bundle/app/updater 版本。
- [x] `.github/workflows/release.yml`：tag/手动/可复用 Windows 发布入口与默认值。
- [x] `.github/workflows/windows-release-upload.yml`：手动包装入口默认值。
- [x] `.github/scripts/release-workflow.test.mjs`：Windows-only、签名和版本静态契约。
- [x] `CHANGELOG.md`：V1.4.4 发布说明。
- [x] `docs/功能清单.md`：V1.4.4 Windows 交付记录。
- [x] `src-tauri/ssh-agent/Cargo.toml` / lock：独立版本，确认不修改。
- [x] updater 前端、capability、PTY、窗口焦点、分屏、WSL、Worktree、CLI hook：本任务不改变对应实现，确认无代码触点。

## Compatibility and safety

- 保持 tag 命名中的大写 `V`，兼容现有 `push.tags: V*`。
- 不删除 `TEMP` 区域，避免丢失 V1.4.3 后积累的待发布变更记录。
- 不改变 updater 公钥、endpoint、签名 secret 或 bundle 类型。
- 不使用本地 unsigned build 作为 GitHub Release 产物。
- 不强推、不移动远端 tag、不 amend 已发布历史。
- `master` 推送成功而 tag 推送失败时，保持发布提交，解决阻塞后再创建 tag；tag 已推送后 workflow 失败时保持 tag 不动并报告。

## Verification strategy

- 静态版本一致性脚本读取 JSON/TOML/lock/config 并断言 `1.4.4`。
- `node .github/scripts/release-workflow.test.mjs` 验证 Windows-only 正式发布契约。
- `npm run check:architecture -- --strict` 独立验证架构限制。
- `npm run build` 验证前端和 Web production build。
- `cargo check --locked --manifest-path src-tauri/Cargo.toml` 验证 Rust 元数据与锁文件；若资源前置不满足，先按 updater 契约准备既有资源，而不是绕过检查。
- 正式发布通过 GitHub Actions run 成功和 Release asset 清单作最终证据。
