# 翻译稳定版 TEMP（Todo34 修订）
Approved stability source: 20261031T134122778Z-r0012 / c8ccfda0ffa06076ba821197d53160939206a33c786f19138d312dbd6a188036.

## Current authorized requirements
用户已明确取消全部翻译历史功能，并授权「一并清空」现有翻译历史；本修订覆盖先前历史功能要求。保留稳定性、可操作安全错误、同卡片手动重试和原生 latest-attempt 权威；保留截图安全释放、当前 crop 生命周期、WindowRAF、布局与几何。

- 删除历史列表、搜索、复制/删除/清空控件、记录开关、历史设置入口、原生历史 IPC 和运行时历史写入。
- 删除历史保存警告与仅供历史的成功 UUID、时间、元数据/持久化接受状态；译文结果保留原生 identity 与文本，不依赖历史数据库写入。
- 已有 migration55/56/57 和 history.sql 不得改写、删迁移或修 checksum。追加最后的 migration58，仅清空 translator_history、translator_history_receipts，并将 translator_history_settings.recording 禁用；保留兼容表。
- 实际数据库清理必须先从 app_paths.rs 推导权威路径，确认没有当前应用写进程，只读 schema/counts，限定事务；不读/打印翻译内容或凭据，不自动修复55，不写迁移账本。
- 无历史表时如实报告无需清空；无法安全清理时报告 pending。未授权删除 raw DB repair safety copies / 手动文件副本，不做取证级擦除承诺。
- 不启动 GUI/dev/model；root 负责最终 TEMP CHANGELOG 与功能清单整合。

## Acceptance / current evidence
65 Node tests (0 skipped), 44 Rust translator tests (0 ignored), TypeScript and affected Rust compile pass. Migration58 disposable SQLite test proves deletion + recording OFF + idempotence + unrelated data/migration-ledger preservation; failure rolls back without missing-schema repair. Source hashes prove55/56/57 registrations and included history.sql/chat schema unchanged. Strict architecture fails only pre-existing unrelated web_device.rs2024 / daemon/server.rs2028; no exemptions.

Actual database cleanup is pending while installed and worktree CLI-Manager writer processes are running. See implement.md Todo34 for exact path and process evidence. Earlier completed history acceptance claims are superseded, not evidence that cleanup has run. Manual cross-monitor/DPI, locale switching and GUI performance remain unrun.
