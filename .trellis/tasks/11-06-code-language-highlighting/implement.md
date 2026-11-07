# 实施与验证

monacoLexical组合现有四语言grammar并配语言限定深浅theme rules；monacoSetup注册lazy provider，Dockerfile.*识别及未知路径content/shebang fallback，controller传content。无新增依赖，不实现LSP/跳转。完整import/workers保持。

原30项高亮+editor回归、tsc、build及strict架构通过。独立审查3项shell #词内、heredoc引入行尾、Docker quoted platform吞string已集中修复；最终真实Monarch12项通过、tsc与strict架构通过。测试按字符span断言实际scope并验证theme trie及contrast，非仅regex匹配源码。

lexical局限：Java call-like非semantic；shell简单command位置/单一heredoc delimiter不等于完整shell parser。WebView实际颜色/主题切换未手工验收，不能宣称全部标识符语义高亮。开发服务21420确认monacoLexical更新HTTP200；新token provider若热更新未重注册需正常重启窗口，不擅自关闭用户进程。

证据agent://5999a1f8-ed61-4b94-b76b-9c473af85cb7、agent://f1d2c3e7-916e-4842-82ee-99198d198894、agent://a7fe2f00-83ac-48f6-9727-aed301276600。
知识候选0（tokenizer上下文修复证据保留任务，不制造通用知识）。CHANGELOG TEMP和功能清单已更新，未提交。
