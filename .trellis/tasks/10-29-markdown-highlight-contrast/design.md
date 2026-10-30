# 调查与设计
先实际复现，不凭截图断言根因。MarkdownContent当前PrismAsyncLight+手动注册语言+oneDark/oneLight；查dev模块/asyncAST/grammar/主题覆盖。旧fixture生产仅JavaScript token存在未验证computed多色、没Python，验收不充分。

影响清单（GitNexus不可用按契约+符号降级）：
- MarkdownContent.tsx highlighter引入/注册→MarkdownCodeBlock→codeTheme选择→react-syntax-highlighter AST/token。
- history-scroll-markdown.css基础--md及terminal/subagent/split覆盖，file-editor后置terminal覆盖；避免统一颜色压制token。
- fixtures/markdownVisual.tsx真实组件示例添加截图JS/Python；markdownVisualBrowser.fixture.mjs扩dev/build两模式与多色/对比断言。
- markdownRendering/historyMarkdownRendering及必要导航tests保持契约。

修复优先源头最小改：若证实async引擎dev不可靠可同库同步PrismLight配已有语言注册，不能吞error降级伪装高亮或新增库。语法token明暗主题实际可辨。不更改PowerShell语言策略等额外需求。
Markdown专属语义背景/强调变量提高层次，而非全跟主背景微混；标题清晰、code/header/body独立、quote/table轻但可辨，浅色无硬黑深色正文。保持外层宽度/compact与横滚，不改变parser、copy围栏、query、链接/anchor/math/safe/boundary。

矩阵：dev/build×light/dark×default/terminal/file/subagent/compact；JS/Python keyword/string/number actual color至少多色且对比可读；code header/body/root有差异，table/quote背景有层次；实际scrollLeft、copy成功失败、math/query/link稳定。console/network错误记录，不把node存在当成功。代表截图helper目测，非真实Tauri手验。
