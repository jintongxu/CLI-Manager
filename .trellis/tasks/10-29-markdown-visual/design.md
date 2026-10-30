# 设计与触点
采用既有.ui-markdown/--md语义变量，不全局prose污染外层布局。不硬编码只适配Storm，default跟应用，terminal/file/subagent跟对应终端面板浅深色。代码内联padding/font/lineHeight最小TSX改为可被上下文CSS控制，高亮plain长行统一自身横滚。保留语言栏/围栏复制成功失败按钮，无新增文案/交互，若确需文案必须zh/en。

Graph runner不可用，契约+符号降级：
- shared/ui/MarkdownContent.tsx已有h/table/quote/code稳定类，MarkdownCodeBlock约228行，inline自定义参数需收敛；copy保持安全fence，搜索不改内容。
- styles/components/history-scroll-markdown.css约270-671基础密度/正文/表格/code，794terminal、895subagent、1017split preview覆盖；如拆样式按职责有序导入。
- file-editor.css约325-405后置terminal样式及单行无语言围栏兼容，不改编辑器布局。
- 调用：历史HistoryMarkdownContent、TerminalMarkdownPreview、SubagentTranscriptView、FileEditorContent、PromptLibrary compact/query、About/Btw default/open。父级宽度外层控制，不全局限宽；compact max220保留。
- parser/safe/Math/plugins不变，navigation契约markdown-file-navigation-contracts保持raw href、root内anchor、Ctrl右击。

视觉：标题字重/字号/留白而非全蓝；中文行高、段落与嵌套列表节奏；inlinecode轻底，link清晰；quote细线低底色。code轻header/language/copy、底色层次、边框圆角、明确hover/focus，两分支统一font/line-height/padding。table保留alignment、适当cell间距/轻stripe/表头，局部scroll。

验证：真实React MarkdownContent渲染中文/标题嵌套/quote/inline/known unknown fence/table/math/query，生产全CSS有序导入，default/terminal浅深/file/subagent/compact computed与geometry；用已有Vite/host puppeteer不加依赖。TS测试copy/link/math/safety保留，浏览器fixture不冒充真实Tauri手验。回滚只本次Markdown相关CSS/TSX/tests，保留既有dirty。
