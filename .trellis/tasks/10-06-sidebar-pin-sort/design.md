# 设计
TerminalSession sidebarPinned/sidebarOrder可选元数据，metadata-only actions严格scope/type/partition校验，pin至目标区尾；shared sidebar selector稳定pin-first/rank/fallback。不可调用reorderSessions/Workspans或排序stored sessions数组；复用serialized save并复制daemon/recreate restore。
WT settings existing preferences project-keyed orderedIds map校验，不DBmigration；shared orderhelper忽略stale/namefallback追加新记录，main树/shortcuts/flyout一致。
Dnd-kit：terminal localDnd+专用handle隔离outer tree，keyboardmove同partition；WT sibling SortableContext typedmetadata、候选前过滤sameproject、WTdispatch在旧project/group前，搜索/过滤disabled规则保留。其它副本只排序读共享map。WT主树文字chip移除，其余alignment占位保持。i18n+domainCSS。
触点terminal store smallmetadata module/restore/types；shared/preferences load/default/save抽小模块避免2000超限；projects lib/api/order helper、sidebar actions/hooks/context/components/controller/Dnd。Graph absent fallback contracts+exactcalls risk未确认。保留全部dirty知识库，无Git改动。接口基础先于UI，避免并行sharedcomponent conflict。
