# 发布设计

复用既有 Windows Release tag-push 工作流，不新增构建链。同步 npm 根包、Cargo 自身包、Tauri 版本与 workflow 手动默认标签。保留全部已有 TEMP 功能记录，在两份产品记录中增加 V1.4.11 发布条目。

图分析：tauri.conf.json upstream impact UNKNOWN、索引落后92提交，不代表无消费者；以版本文本和 release-workflow 契约核对 npm/Cargo/Tauri/CI 触点。配置修改不涉及函数、API或数据迁移。

场景：仅 Windows x64 安装包和便携包，签名由已有 Actions secrets 提供；不影响窗口焦点、分屏、WSL、Worktree、hook 行为。已有旧版本不覆盖。远端并发更新或标签已存在则停止。Git 无效代理仅命令级绕过。推送前可撤回本次未提交改动，推送后不重写历史。CI失败按最小步骤诊断，业务改动另行授权。
