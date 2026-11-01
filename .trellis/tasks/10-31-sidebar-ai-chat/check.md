# 验证记录：侧栏伴随式 AI 对话面板

## 1. 自动化检查结果

### 1.1 前端类型检查 (tsc)
```bash
npx tsc --noEmit
```
- **结果**：0 错误，通过。

### 1.2 架构契约检查 (check:architecture)
```bash
npm run check:architecture
```
- **结果**：仅保留既有 2 个基线 Rust 违规（`src-tauri/src/commands/web_device.rs` 2024 行、`src-tauri/src/infrastructure/daemon/server.rs` 2028 行），**0 新增违规**，通过。
- **跨层引入检查**：`features/workspace` → `features/terminal/api/chatPanelCommands` 为合法公开入口；`features/terminal` → `features/chat/api/ChatPanel` 为合法公开入口；无非法内部目录引入。

### 1.3 关键文件物理行数检查
```bash
wc -l src/shared/preferences/settingsStore.ts src/features/terminal/hooks/useTerminalTabsController.tsx src/features/terminal/hooks/useXTermController.ts
```
- `settingsStore.ts`: **2000 行**（≤ 2000）
- `useTerminalTabsController.tsx`: **1992 行**（≤ 2000）
- `useXTermController.ts`: **1981 行**（≤ 2000）
全部符合硬限制。

### 1.4 中英文字典键完全对齐核查
```bash
for f in chat terminal settings; do
  diff <(grep -o '"[a-zA-Z.]*":' src/shared/i18n/messages/$f.zh-CN.ts | sort) \
       <(grep -o '"[a-zA-Z.]*":' src/shared/i18n/messages/$f.en-US.ts | sort)
done
```
- `chat`: 完全一致
- `terminal`: 完全一致
- `settings`: 完全一致

---

## 2. 交付与变更记录核对

- `CHANGELOG.md`：已写入 `TEMP — 侧栏伴随式 AI 对话 / Sidebar companion chat`，版本号为 `TEMP`。
- `docs/功能清单.md`：已写入 `### TEMP — 侧栏伴随式 AI 对话 / Sidebar companion chat`。

---

## 3. 未覆盖的人工验收项（如实上报）

按用户授权与工作区保护原则，本次不启动开发服务 `npm run tauri dev`，以下事项仍待用户在真实桌面环境下验收：
1. **真实桌面拖拽宽度与动画**：在 Dock 模式下拉伸侧栏边缘，验证宽度记忆与终端自动避让。
2. **实际流式模型输出**：连接真实已配置的 OpenAI/Claude/DeepSeek 供应商，验证逐字流式渲染与停止/重试操作。
3. **语言切换**：在「设置 → 通用 → 界面语言」中切换中英文，确认面板标题、按钮提示、消息角色标签无硬编码。
4. **退出重开草稿恢复**：输入草稿后关闭并重启应用，验证草稿仍保留在 SQLite 中。

---

# 第二阶段：体验修复与推理强度

## 用户反馈项与处理

| # | 反馈 | 处理 |
|---|---|---|
| 1 | 对话气泡不美观 | 重做气泡：用户右对齐主色气泡、助手左对齐带徽标弱底、元信息 hover 显示 |
| 2 | 输入框不美观 | 改为统一圆角卡片，textarea + 底部动作行 + 卡内圆形发送/停止，focus-within 主色描边 |
| 3 | 浮动模式不能拖动 | 新增 `useChatPanelDrag`，标题栏 Pointer Capture 拖动 + 边界夹取 + 位置记忆 + 方向键微调 |
| 4 | 不能设置推理强度 | Rust + TS 全链路新增可选 reasoning；UI 提供默认/最低/低/中/高；默认为「中」（medium）；修复窄屏丢字与弹出层竖排折行 |
| 5 | 历史对话选择框不美观 | 原生 select → 主题 Radix Select |
| 6 | 模型选择框不美观 | 同上 |
| 7 | 附带选中文本困扰（未复制却出现） | 彻底移除被动自动推脸胶囊，改为动作条曲别针 📎 主动点击触发 |

## 自动化验证

```bash
npx tsc --noEmit                      # 通过
npm run check:architecture            # 仅 2 项既有 Rust 基线违规，0 新增
cd src-tauri && cargo check           # 0 error
cd src-tauri && cargo test --lib chat_stream_body_and_reasoning_effort   # 1 passed
```

中英文字典键集合（chat / terminal / settings）diff 完全一致。

## 设计决策记录

- 推理强度**仅 OpenAI 系**：`Protocol::Chat` → `reasoning_effort`；`Protocol::Responses` → `reasoning.effort`；`Protocol::Messages` 忽略（不改其 max_tokens 语义）。
- 合法值限定 `minimal|low|medium|high`，非法值返回 `chat_invalid_input`（Rust 侧 `normalize_effort`）。
- `default` 档不发送任何字段，保证既有请求体字节不变。
- 推理强度与浮动位置均为**内存态**，不新增数据库迁移、不改 `settingsStore`（其行数已在 2000 行上限）。
- 推理强度类型放在 `features/chat/api/chatReasoning.ts`，由 `features/terminal` 反向引用，避免 chat 依赖 terminal 内部 store（跨 feature 契约）。

## 未覆盖的人工验收项

1. 真实桌面拖动阻尼、贴边行为与多显示器下的位置夹取。
2. 深色/浅色主题下主题下拉弹出层的实际观感。
3. 供应商侧 `reasoning_effort` 是否被真实端点接受（不同 OpenAI 兼容端点支持度不同，未支持的端点可能返回参数错误）。
4. 中英文切换后的新控件文案。

---

# 第三阶段：回答渲染与图片支持

| # | 反馈 | 根因 | 处理 |
|---|---|---|---|
| 1 | 回答文字底下是黑的 | `.ui-markdown` 自带不透明 `--md-reading-bg`（=bg-primary） | 面板作用域内 `background-color: transparent`（新增 `chatPanelMarkdown.css`） |
| 2 | 不支持代码渲染 | 传入 `compact` 触发 `.ui-markdown-compact{max-height:220px;overflow:auto}` 裁切长回答与代码块；叠加不透明黑底 | 移除 `compact` 传参 + 代码块/行内码重做样式 |
| 3 | 回答渲染借鉴优秀项目 | — | 段落 1.65 行高、标题收敛、列表缩进、行内码淡色 chip、代码块圆角+边框+头部、引用主色细边、表格单元格内距、链接 hover 下划线 |
| 4 | 粘贴图片 + 点击预览 | 功能缺失；后端无多模态通道 | 前端 onPaste + 缩略图 + 全屏预览；Rust `body` 为最后一条 user 消息注入图片数组（三协议） |
| 5 | 推理标识太大 / 输入框高亮难看 | Select 基础样式 `w-full`；全局 `:where(textarea):focus-visible` 二次描边 | 触发器改无边框紧凑控件 + `w-auto`；`textarea:focus-visible` 清空 outline/box-shadow |

## 自动化验证

```bash
npx tsc --noEmit                                   # 通过
npm run check:architecture                         # 仅 2 项既有 Rust 基线违规，0 新增
cd src-tauri && cargo check                        # 0 error
cd src-tauri && cargo test --lib chat_             # 21 passed
cd src-tauri && cargo test --lib chat_stream       # 2 passed（reasoning + images）
```

中英文字典键集合（chat / terminal / settings）diff 完全一致。

## 设计决策

- 图片只在**最后一条 user 消息**上转数组内容，历史消息保持字符串，避免改动历史 payload 形状。
- 图片与推理强度均为**内存态**，不入库、无迁移；重启或切会话后清空。
- 校验：最多 4 张、单张 ≤ 6MB、仅接受 png/jpeg/webp 的 data URI；Rust 侧 `normalize_images` 二次校验，非法返回 `chat_invalid_input`。
- 预览层 Esc 使用**捕获阶段**监听并 `stopPropagation`，避免同时触发面板自身的 Esc 收起。
- 未改全局 `history-scroll-markdown.css`，仅在 `.chat-panel` 作用域覆盖，避免影响其他阅读界面。

## 未覆盖的人工验收项

1. 真实模型端点的视觉/多模态支持度（不同 OpenAI 兼容端点的图片与 reasoning 支持差异较大，可能返回参数错误）。
2. 真实桌面粘贴截图的尺寸、缩略图清晰度与预览层观感。
3. 长代码块在窄面板下的横向滚动与代码高亮配色。
