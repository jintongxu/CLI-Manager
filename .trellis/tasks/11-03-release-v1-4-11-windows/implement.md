# 执行计划

1. 同步9个发布文件至1.4.11，保留业务代码和依赖版本。
2. 运行版本一致性断言、release-workflow.test.mjs、check:architecture -- --strict、git diff --check，提交前 GitNexus detect-changes；工具局限如实报告。
3. 确认远端master未变化且V1.4.11不存在；提交 release: 1.4.11 Windows，创建新annotated tag并推送origin，触发一次Windows CI。
4. 等待CI，核对正式Release和EXE/MSI/ZIP/signatures/latest.json，记录实际结果。

计划及提交推送已由用户在Plan确认界面批准。本机安装和桌面GUI不在自动验收范围。只复用已有发布设计，没有新增需沉淀的规则。
