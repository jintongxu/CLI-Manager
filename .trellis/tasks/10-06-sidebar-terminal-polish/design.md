# 设计

从styles/components.css有序导入定位现有tree/status领域CSS，局部.sidebar-terminal-* classes不污染全局。SidebarTerminalList统一语义class/density/depth，保持click/menu/dialog/key handlers；适度树线、row/presentation glyph、title min-width+ellipsis、静态可辨running/wait/complete/fail/remote状态与隐藏小标记。title/aria保留完整标题/状态/隐藏文字，中英projects字典只简化rename菜单为重命名/Rename及需要的无障碍内容。theme变量适配浅深theme，focus/reduced-motion遵循现有样式。
不改terminal store/IPC/persistence/menu其它文本及布局/topbar、不复制多入口实现。<=2000行、保留前序dirty。Graph runner absent，按契约+调用点降级风险未图确认。
场景：隐藏/可见、状态五类、长名称/窄栏、选中/非选中、keyboard/mouse、collapsed多WT、两个density/语言/theme；Pane/WSL/SSH/后台/恢复不变不拓宽tests。
