# 设计规格：侧栏伴随式 AI 对话「思考/推理强度」控件重构

## 1. 架构触点
- UI 组件：`src/features/chat/components/ChatReasoningPill.tsx`（新增独立高内聚胶囊组件）
- 接入点：`src/features/chat/components/ChatPanelSurface.tsx`（替换原有简单无边框 Select）
- 样式表：`src/features/chat/components/chatPanel.css`（定义胶囊边框、圆角、背景、激活态与下拉弹出样式）
- 国际化：`src/shared/i18n/messages/chat.zh-CN.ts` 与 `chat.en-US.ts`（增加 `chat.panel.reasoningPrefix`）

## 2. 组件设计
```tsx
export interface ChatReasoningPillProps {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  disabled?: boolean;
}
```
- 基于 `@radix-ui/react-select` 原语封装。
- 触发器：
  - 图标：`Brain`（lucide-react），大小 12px。
  - 固定前缀：`t("chat.panel.reasoningPrefix")`（思考 / Think）。
  - 当前值：根据 `value`（off / low / medium / high）匹配 `chat.panel.reasoningDefault` 等对应档位文本。
  - 展开指示：`ChevronDown`，在 open 状态下旋转 180°。
- 状态样式：
  - 胶囊类名：`chat-reasoning-pill`，带 `data-active={value !== "off"}`。
  - 激活态：当 `value !== "off"` 时，边框和脑图标变为 `var(--accent)` / `var(--primary)`，背景带有强调色微光；
  - 默认态：边框微弱，背景柔和半透明。
- 弹出菜单：
  - 挂载 Portal，使用 `ui-select-popover` 风格，选项包含 4 项，每项带有标签与对勾指示。
  - 键盘操作：支持 Enter/Space 展开，方向键导航，Enter 选择，Esc 关闭。
