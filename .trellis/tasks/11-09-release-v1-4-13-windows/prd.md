# V1.4.13 Windows 正式版

用户已批准发布计划、提交和标签推送。业务基线master48fd3929，仅Windows x64，复用GitHub Actions签名发布。

## 范围
同步桌面版本1.4.13和发布记录，发布当前master已合入改动。不改业务、依赖、公钥或权限，不构建其他系统、不覆盖旧版本。统计文件既有改动保留且不提交。

## 验收
版本一致；定向发布契约、strict架构、diff检查及图变化分析完成。推送前核实远端基线/新tag，网络或并发阻塞则停止。Windows CI成功，正式Release非草稿非预发布且latest；EXE/MSI/ZIP、两sig和latest.json均上传，清单1.4.13仅Windows本版签名链接。
不宣称本机安装、GUI、语言切换、真实自动升级验证。
