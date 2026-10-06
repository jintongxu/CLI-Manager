# 执行
- [x] 创建批准任务三工件，TEMP，无upstream不Git同步。
- [x] terminal metadata actions/selectors/save/两restore及WTsettings/orderhelper，聚焦基础tests。
- [x] terminal pin/drag/keyboard与WT同projectDnd/collision/dispatch、多入口一致、去WTchip，双语/样式。
- [x] 聚焦integrationtests/独立review、tsc、独立strictarchitecture、diffcheck；TEMP changelog/功能清单/任务记录。

## 用户纠正与最终拖动方式
用户明确不要专用手柄，要与终端标签一致；已改为terminal整行/WT行主体activator，移除handle组件/CSS/闲置文案，复用终端tab阈值与transition。短点击选择/打开；primary pointer才可drag，折叠/controls/右键隔离；Alt上下移在行焦点生效。排序/保存契约不变。

## 审查修复与结果
独立review发现五项：self collision排除导致近原位误排、project/group rollback旧WT树、WT存储失败不处理、无效英文keyboard指引、canonical nestedWT ghost查询缺失。已集中修复：self空间候选但不mutation；rollback按current pref rebuild；失败settle false+revision条件rollback+localized toast；中英指引匹配Alt替代；canonicallookup及activatorref。延迟DB/pref failure与真实closestCenter矩形回归通过。
最终62项聚焦tests、tsc、npm run check:architecture -- --strict通过（1229源文件零超限/违规）及diffcheck。原51/59批次仅中间结果，不合计。
未真实拖动/屏幕阅读器/native save failure/重启/语言切换验证，mock与source不是实机证明。terminal metadata FIFO与snapshot/restore独立save路径仍存在，未确认实际metadata丢失竞争，不做推测性补丁。Graph缺失使用契约+调用点降级，无图impact证明。不Git同步提交或EXE构建。
证据：agent://4e511bc2-97c4-43fc-b9d6-a1833b7801e6；agent://a7714b18-6556-42ce-8dfa-4202568012c6；agent://fd6234cb-eddc-4ee6-84a7-556027e959f7；agent://3eb04faa-4f2c-4ca4-85b6-851ff3b24818；agent://14702288-f79f-4de1-990c-2f0b43c57f7e。
知识候选：本次未发布新增知识，规则已在任务设计/聚焦tests体现，无activeRun知识工作流不擅自创建。
验证按改动选择、不full/Rust，无效inputs才重跑。实机drag/keyboard/restart/语言未执行如实记录，mock不实机。临时开发仅npm run tauri -- dev无EXE。新知识无可复用则零候选。<=2000行且抽职责不压缩绕限。
