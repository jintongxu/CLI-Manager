# 执行

1. 同步9个发布文件至1.4.12，不改业务依赖。
2. 验证版本一致、node .github/scripts/release-workflow.test.mjs、npm run check:architecture -- --strict、git diff --check和GitNexus detect-changes，保留工具局限。
3. 确认远端master和新tag，提交release: 1.4.12 Windows，创建annotated tag并非强制推送；确认一次Windows CI。
4. 等待CI并核对正式Release、所有Windows附件与latest.json版本/链接，报告下载入口。

用户Plan确认已授权执行提交推送。本次复用已验证发布设计，无新知识候选。不启动或终止桌面应用。已有统计文件不提交，不重复无关测试。
