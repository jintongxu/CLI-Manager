# Markdown 阅读视觉优化
用户批准de71cd5ad7227fa87461f37d5c7d7a4efaa8a35b0c4d45d11fe324c0ef237bc4，版本TEMP。借鉴GitHub正文节奏/VitePress轻代码块，保留现有React Markdown解析。

验收：正文/标题/列表/inlinecode/link清晰；代码语言栏复制/细框圆角/留白统一，known/plain长行自身横滚；表格自身滚动、轻表头边框，引用低对比。default/terminal浅深/file/subagent/compact均可读，不父级横溢出，compact220px不变。
保留围栏copy原文/语言标签/query性能与mark/linkBehavior及导航/Math/GFM/skipHtml/错误边界/WebKit降级。无新依赖、解析器替换、Shiki、Mermaid、折叠/换行开关、行号/文件名推断。已有Storm/Skill删除/log dirty保留，不Git提交同步/进程操作。真实React+全CSS浏览器测试而非只class模板，未验真实WebView如实报告。
