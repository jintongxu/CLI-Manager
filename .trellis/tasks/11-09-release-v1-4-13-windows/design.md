# 设计

复用V1.4.12 Windows Release；npm根包、Cargo自身包、Tauri版本和两workflow默认tag同步，保留TEMP详细功能记录。签名由既有GitHub Secrets注入，不读私钥或换公钥。

配置impact UNKNOWN且索引落后117提交，不视为无风险；精确文本与发布契约确认触点。本次无函数行为或数据迁移改动，各桌面/WSL/Worktree/hook场景不变。

推送前远端实时状态须确认。失败累计三次停止同接口重试，不force、不重写历史，不删旧tag或附件。网络恢复后自动push触发一次CI，无在途才允许手动入口。不以本机无签名包替代。统计文件不提交。
