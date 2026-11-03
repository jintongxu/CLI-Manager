# V1.4.11 Windows 正式版

用户批准发布 V1.4.11、创建任务并执行发布计划。

## 范围
以 master 15123de0 为业务代码基线，仅升级发布元数据；仅构建 Windows x64 EXE、MSI、便携 ZIP 和签名更新文件，上传 jintongxu/CLI-Manager 正式 Release。不构建 macOS/Linux，不修改业务行为，不覆盖旧版本。

## 验收
- 版本统一 1.4.11，发布契约测试、strict 架构检查和 diff 检查通过。
- 发布提交和 V1.4.11 新标签推送成功；Windows CI 成功。
- 正式 Release 非草稿非预发布，附件及 Windows latest.json 齐全。
- 明确本机安装、桌面 GUI、语言切换与真实升级未经验证。
