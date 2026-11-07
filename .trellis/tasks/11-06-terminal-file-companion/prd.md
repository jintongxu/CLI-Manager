# 文件与终端并排预览编辑

用户批准方案d824de60eb4076094cf15b7fee6775b98189fc8f6c97993ecd26ecb72aced55b。

## 体验验收
- 单击文件默认终端左55%/文件右45%并排，不替换/激活主Pi；比例拖拽记忆，单层主导航及底部Shell保留。
- 单击预览复用clean/unpinned槽；双击tree/tab固定，edit自动固定；重复打开复用，dirty不被替换。
- 旧慢请求不能覆盖新点击、pin或跨project/root上下文；沿用buffer park、diff、save/discard/cancel。
- 最后file且无diff关闭后collapse；收起不丢buffer，最大化/还原只作用中央上方，不覆盖saved ratio。
- 当前窗格全宽/旁边打开明确，唯一编辑器controller，Pi唯一XTerm consumer，CtrlS/CtrlW焦点隔离。
- 无Pi时文件可独立，不创建PTY；local/Worktree/WSL/SSH沿原接口，不承诺未保存buffer跨重启持久化。

## 场景
主/辅助Shell/编辑器焦点、IME、窗口失焦；单/多终端split；窄窗/右侧栏左右停靠；project/worktree相同project不同root、SSH host与大小写remote path、WSL；slow/error open、双击期间read未完成、dirty保存失败、diff标签剩余。
