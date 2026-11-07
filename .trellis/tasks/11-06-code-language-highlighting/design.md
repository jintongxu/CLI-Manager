# 根因与设计

实际Monaco完整import已注册四语言，并非缺contribution或worker。安装包Monarch实测：Java/Python类/函数普通identifier；Docker只uppercase指令有色、参数空token且lowercase无匹配；shell自定义命令/函数空token。现有主题inherit vs-dark/vs无额外rules；只改颜色不足以区分词法类别。

识别缺口：Dockerfile.dev/.prod为plaintext，无扩展shebang未知。改languageFromPath可选content并仅未知路径fallback，controller传content。

基于既有grammar做有限可解释lexical增强，保留注释/字符串/跨行状态，不加依赖或semantic/LSP。自定义token scopes配dark/light规则，其他语言与主题编辑器背景不变。测试实际Monarch compile/tokenize而非只检源码字符串。

证据agent://a298e266-ddb3-456b-bdef-fd6cb2c09645。索引106提交落后、UNKNOWN源码调用确认；不自动提交。
