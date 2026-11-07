# 实施记录

## 文件预览状态已完成
fileExplorerStore增加openFile(entry,{intent:preview|pinned})与pinFile(path)，file.isPreview由ProjectFileEditorWorkspace持有。单击clean-only替换，pending read也可pin；edit原子pin，旧read/failure不能覆盖新选中/跨context，关闭后不复活；late save保留更新draft。省略intent沿旧固定行为。fileEditorPreview.ts抽取请求/identity helpers，不复制buffer权威。

11项真实store测试通过；tsc、build与strict architecture通过。其他定向35/36（旧PaneLeafView断言在UI lane解决），batch26/28两SSH契约失败HEAD baseline复现。证据agent://6b8bc1e9-51d4-4bc4-a634-f813fe89974e。

## UI与审查完成
专用唯一host、左右55/45、独立focus/resize/max、文件树与tab单击双击、当前/旁边菜单已接入，保留Pi/底部Shell/单层导航。openFileEditorPane(project,mode?)只ensure编辑身份和show，不setActive/创建PTY或workspan。
预览store独立审查4项已集中修复：refresh marker、loading结算、close取消按context+path、late pin merge；preview真实store23项通过，API兼容。
UI116项定向、tsc/build/strict architecture通过。最终审查2项portal CtrlW与batch save-close cancel/新draft丢失已修：dialog显式ownership marker，close operation generation与最后全目标clean/identity复核；cancel/dismiss仍有效，保存失败保留dialog。最终73项file/context/focus回归、tsc和strict architecture通过。2项SSH batch baseline失败和4项旧Markdown fixture Copy未定义保留准确说明，不伪称全量绿。
开发服务21420实际返回FileCompanionSurface与TerminalTabsView更新模块HTTP200。证据agent://37a9dc14-3f75-4dbb-b2ae-f5056de4aa24、agent://d027d821-aefc-483b-866a-5fe0afae949d、agent://9515f362-5254-4eab-8a7c-caf4260ea0f0。知识评估：0新候选（既有单权威/异步意图与焦点契约的应用，证据保留任务内）。

## 手工边界
尚未验证真实Monaco/IME、dirty确认、SSH/WSL；不承诺未保存buffer跨重启持久化。未提交，保留已有统一工作区改动。
