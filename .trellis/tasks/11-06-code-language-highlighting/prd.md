# Java/Python/Dockerfile/Shell高亮完善

用户确认只先实施四类语言高亮完善，代码跳转/LSP不在本次范围。

## 验收
- .java/.py/.sh及Dockerfile和Dockerfile.*自动识别；未知路径可用sh/bash/python shebang降级识别，未知不误识别。
- 可词法识别的声明、类/函数、装饰器/注解、Docker指令参数/变量、shell命令/函数/变量/flags层次清楚，深浅主题均可读。
- 注释/字符串/跨行状态不被新增规则误涂；不把所有普通identifier假装成类/方法语义。
- 复用现有Monaco，不能用token颜色冒充语言服务器定义跳转。保留已有伴随编辑、未提交统一终端改动。
- 实际Monarch token fixture与theme rules检查、类型、strict架构，必要build；真实WebView视觉未测明确说明。
