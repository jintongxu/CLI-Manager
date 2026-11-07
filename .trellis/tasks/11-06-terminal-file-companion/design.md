# 设计

复用fileExplorerStore和FileEditorPane/controller，preview标识在ProjectFileEditorWorkspace，显示host只存context/open/focus/max/ratio，不复制buffer权威。主Pi active不随文件focus改变；ensure editor身份与主activate解耦。专用host唯一渲染editor，原canonical leaf不挂第二份editor或留下空几何；Pi renderer不搬父级/不重复消费。

中心上方左右分区55/45，底部Shell兄弟不变；单层主导航保留。比例独立preference及sync policy，最大化/clamp不落盘，drag结束保存，cancel和keyboard行为测试。上下文使用既有root/host/WSL等一致性，不只projectId。

文件open带preview/pin intent序列，commit核对context+请求；双击和edit pin不可被过时read取消。当前/旁边两展示复用一个host。焦点边界隔离global CtrlW、editor CtrlS与Xterm自动focus。

先preview state，再host/入口，最后独立审查集中修复。定向tests、tsc与strict架构，真实Monaco/IME及SSH/WSL未验收不声称通过。图索引106提交落后仍做impact，UNKNOWN当前契约补充，不视为低风险。
