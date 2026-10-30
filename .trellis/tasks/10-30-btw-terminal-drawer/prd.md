# BTW 终端右侧分栏（沿用原 task）

用户否决了“BTW 必须先进独立界面”的形态，要求在主任务工作流内顺手问、看完继续干活。第一版只做最小闭环。

## 验收标准

1. 终端右键「用 btw 侧问」后，**终端右侧直接展开分栏输入区**，带可见引用与提交前继承开关（默认关闭，无准确本地来源禁用），不打开独立窗口、不切换到侧栏 tab。
2. 提交后原位流式显示回答，完整复用 Markdown 预览渲染链：SessionTranscriptContent variant=terminal、terminalCodeTheme 来自 useTerminalPreviewTheme、subagent-transcript-markdown。仅新问题聚焦输入区，流式更新不夺焦点。
3. 支持**就地追问**（同一 thread 继续发消息）、**停止生成**、**复制**、**Esc 收起**。
4. 收起后仅保留一条状态头（BTW · 回答中 / 已完成 / 失败），可再次展开且不丢内容、不中断生成。
5. 分栏宽度支持指针与键盘调整（280–760px，受宿主 60% 宽度限制）；终端占剩余空间。新 stage 清除旧内嵌线程绑定并展开；临时 Git 隐藏/重挂载保留线程与草稿。
6. 追加批准：原右侧工具栏 BTW 入口改为「侧问记录 / Side question history」，保留现有气泡图标，tooltip 为「查看侧问记录，继续之前的讨论」。侧栏历史优先，默认仅当前终端，不混入其他项目；展示标题、答案摘要、时间和状态，顶部搜索与新建侧问，低频操作放更多浮层。
7. 点击历史记录恢复 owner embeddedId 的现有右侧阅读器，不触发 native reveal；新建侧问捕获当前终端后打开同一内嵌输入区。历史卡片更多菜单首项为「打开侧问 / Open side question」，与记录点击共用 selectEmbedded + openBtwReader 路径，不提供独立窗口操作；其他入口的原 open/reveal 协议、单 owner 与其他终端模式保持。
8. 新增可见文案全部 zh-CN / en-US 双语。
9. 定向测试、`npx tsc --noEmit`、`npm run check:architecture -- --strict`、`git diff --check` 通过。

## 明确不做

- 不做多标签、自动摘要、自动执行或把结论写回终端输入区（下一版再议）。
- 不改 `side_question_*` 后端 IPC 契约、不改上下文继承语义、不改持久化表结构。
- 不新增全局快捷键。
- 不新造 Markdown 渲染或代码高亮，复用现有预览链。

## 最新批准范围 2+3 / Approved scope 2+3

- 当前终端驱动右分栏，每终端保存所选 thread、初始未发送问题（包括空字符串）、来源/引用快照、追问草稿、展开/收起与关闭状态；阅读位置按 thread 记忆。不重新推断来源、不 native reveal、不停止隐藏请求。
- 仅底部跟随，向上滚动停止；新内容显示双语 latest 按钮，点击回底并恢复；最终完成块同样处理。手动历史首次打开从顶部阅读，已读历史恢复原位置，不强跳。
- UI 状态仅 owner/controller 生命周期；初始未发送问题与阅读/折叠状态不入库；既有 thread/draft 持久化保持原样。无 migration、无主任务回填或引用扩展。
- 确定性场景：A/B 切换/空草稿/来源快照/新 stage/已关闭 terminal/历史过滤恢复/隐藏流式/晚到事件/组件重挂载/向上滚动/latest/最终块/手动历史，避免跨终端串状态。Local/WSL/SSH/分屏/Workspan 仍以 terminalId 与原来源规则为界；焦点/托盘/native 行为不扩展，真实系统验证不在本轮执行。

## 最新明确追加：已提交记录退出/终端关闭保留

- 替代上文“既有持久化不变”的假设：正常 ESM adapter，无静默内存 fallback；dispose 仅停止工作/解绑，不 clear/delete。
- 每个保存/删除失败可见双语错误与重试；初次 hydration 不抑制并发用户保存；历史投影只读，队列全保存有序，合并流式快照。遗留 pending 恢复 stopped，不重新调用推理。
- 默认当前终端，显式全部记录跨旧终端 ID，可搜索/加载更早分页，不做 TTL/数量删除；显式删除仅目标、确认 clear 仅当前已加载集合。终端关闭仅清 UI，不删已提交记录。
- schema/DB 入口读取确认版本54可复用，不扩迁移。可执行 fake persistence 生命周期、真实 ESM 模块+fake SQL、双语组件、受影响模型测试、typecheck、独立 strict architecture/diff check。
- 真实 Tauri 重启与磁盘耐久性未测试；没有退出 flush barrier，极快退出/崩溃可丢失未完成异步写入（包括末尾流式片段），不能承诺 crash/power-loss 原子保存。无用户私有记录检查、无进程/重启/commit/push操作。
