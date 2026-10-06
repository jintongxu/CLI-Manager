# 执行

- [x] 创建planning工件，用户批准方案；当前分支无upstream，保留全部前序修改。
- [x] 创建独立collapse key/共享箭头按钮，接入TreeNodeItem与SidebarProjectTerminals及中英翻译，同时覆盖分组浮层。
- [x] 扩展聚焦sidebar组件测试：按钮有无、toggle key/独立、collapsed列表、event propagation/keyboard/入口一致。
- [x] 聚焦9项tests、npx tsc --noEmit、npm run check:architecture -- --strict通过（1214源文件、零2000行超限）；更新TEMP changelog/功能清单及task状态。

## 结果与限制

Root定向检查共享按钮、主树接线与shortcut折叠，git diff --check通过。未执行真实Tauri/浏览器点击及中英文设置切换；测试使用组件mock，Enter/Space测试检验不阻止原生事件并模拟单次click，不是真实浏览器证明。GitNexus不可用，无调用图风险等级证明；无需新知识候选（复用既有折叠状态的常规实现）。未提交/同步Git或构建EXE。
证据：agent://53f8806f-13cb-4c7f-b4c1-2f9ec03bcc80。

不跑全量/Rust/不受影响终端tests，不构建EXE；实机需要运行npm run tauri -- dev，不能用mock断言假称实机。复用有效结果只对改变的输入重跑。无GitNexus采用契约+callsite，清楚报告限制。
