# 设计

复用现有tag-push Windows Release，GitHub Secrets完成签名。npm根版本、Cargo自身版本、Tauri版本和workflow默认标签统一；保留TEMP功能详情，单独增加版本发布条目。

图impact对配置为UNKNOWN，索引落后100提交；精确文本和发布契约确认版本消费者，不将空调用者当无风险。本次无行为/API/迁移改动，焦点、分屏、WSL、Worktree及hook均不改变。

仅Windows x64，自动与手动入口不得重复触发。远端并发或tag已存在则停止，不force；推送后不移tag/删附件。坏代理仅命令级绕过，不改持久配置。平台/构建失败保留证据，业务修复须另授权。不读密钥，不换公钥，无签名包不得替代既定交付。
