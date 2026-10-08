# 实施与验证

数据lane：SQLite迁移/真实temp tests、shared类型、projects/api Store/labels。数据接口完成后并行：forms lane projects components/hooks、GitWorkspace与projects i18n；presentation lane terminal/workspace标签及terminal i18n/CSS；compat lane Web协议/DTO/桥接和sync/恢复白名单。共享文件单一owner，未知触点先协调。

前基线为上一轮全部未提交改动：不整文件回HEAD，尤其命名、CLI启动、session保存失败修复。Store/controllers近2000行，职责模块抽取不可新增豁免。

验证最小真实SQLite并发/回填/删除/restore、Store/forms/模型/render/overflow/drag定向tests，跨层tsc/webtypecheck/受影响Rust check或tests、strict architecture/diffcheck。复用未失效证据，不全suite，不真实数据库/app。fresh独立review集中修复，不无限纠正。真实Tauri中英/升级/重启/SSH/拖拽未执行如实列出。
