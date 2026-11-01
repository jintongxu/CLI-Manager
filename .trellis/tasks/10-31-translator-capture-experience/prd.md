# 截图翻译结果卡片、框选体验与输入浮窗尺寸稳定性

## 用户确认
用户明确要求创建任务，并说明截图操作“都不舒服”：需要整体检查弹出响应、框选跟手、遮罩、确认及取消，不仅优化其中一项。
参考图片：`C:/Users/xujin/.cli-manager/attachments/clipboard-image-63.png`。已通过图像分析确认结构，不能将截图像素直接视为逻辑尺寸。

## 需求
1. 截图翻译完成后呈现独立结果卡片，不复用 Alt+T 的空输入框布局。按参考图：顶部截图缩略图和“截图”标题，中间分隔展示识别原文与译文，底部复制译文。耗时/Token等仅展示真实可获得数据，不估造指标。
2. 全面对照 Kivio 实际实现，调查快捷键到框选显示的端到端响应、鼠标框选流畅度、遮罩视觉、确认与取消操作。区分 Windows 可迁移实现与 macOS 特有路径，不直接搬运不适用机制。
3. 修复 Alt+T 输入翻译窗口时大时小：统一逻辑/物理尺寸边界，厘清内容测量、首次打开、隐藏重开、清空及旧 resize 请求的时序。初始尺寸参考 Kivio，内容增长后自适应，上限后保留滚动，不能通过固定高度牺牲长译文展示。

## 调查假设（不是最终根因）
- `window.rs` 创建/resize 使用逻辑尺寸，重新显示却使用物理尺寸；多 DPI 可能不一致。
- 220 初始高度与内容测量允许缩至150竞争；预热/重开/异步resize可能互相覆盖。
- 截图当前协议仅提供译文，结果卡片还需要携带裁剪图与识别原文，需设计结构化输出/解析失败行为，不能用假原文填充。

## 范围与触点
- Rust translator session/lifecycle/window/capture/commands/shortcuts，必要的 lib 命令注册。
- 前端 CaptureWindowApp、TranslatorWindowApp、TranslatorPanel、ScreenshotOverlay、captureSession/captureReadiness/crop；新增结果卡片须按域分层。
- 设置仅在必要数据契约涉及处调整；不扩大到通用模型管理、提示词重做或无关功能。
- 翻译域中英文文案与定向样式；CHANGELOG TEMP、docs/功能清单.md同步记录。
- 参考 Kivio 截图/结果链路、窗口尺寸/框选交互，调查后写 design.md/implement.md 并进入方案审批。

## 安全不变量
继承 `.trellis/tasks/10-31-translator-capture-lifecycle` 的全部安全边界：图像解码/交互准备后才显示全屏；每轮身份隔离；原生 Esc/再次快捷键/超时取消；确认后先释放桌面输入再翻译；旧结果不能复活窗口；释放失败持续清理。
禁止为追求快而绕过准备确认或取消保护。禁止自动触发真实全屏截图测试。保留无关工作区改动，不按进程名批量清理开发版/正式版。

## 场景与验收
- 主窗口前台/后台/最小化/托盘；截图浮窗已经存在时截图不得包含自身。
- 冷开、预热、反复开关、短文本/空文本/长文本、快速清空与重开；单/多屏、不同DPI、负坐标。
- 框选四个方向、极小区域、拖动到边界；确认/取消/Esc/重复热键；图片加载或模型失败。
- 截图结果有真实缩略图、识别原文、译文和复制操作；错误不冒充译文，缺失元数据不伪造。
- Alt+T 同一DPI下反复空白打开尺寸稳定，跨DPI逻辑尺寸一致，旧请求不能缩错新窗口。
- 框选性能需有可复现测量或明确观察证据，不写未经测量的毫秒数或“瞬时/绝不”等保证。
- 自动化覆盖实际状态与几何/结构化数据行为，不仅源码字符串检查；复用有效生命周期测试。
- 定向测试与类型检查、独立严格架构检查；准确报告已知无关长度超限。真人GUI与语言切换未验证时明确说明。

## 状态
已按批准方案实现结果卡片、尺寸协议和框选交互，并完成独立复核。补充选区附近loading→success/error同卡片状态后，最新52项 Node / 38项 Rust 定向测试及 tsc 通过；严格架构检查仅被两处无关既有超长文件阻塞。版本 TEMP。未启动 GUI/全屏/模型请求，实际 Windows 框选手感、多屏 DPI、视觉和性能仍待用户授权验收，不能标作已实测。独立审查另修复原生捕获基线事务竞态、确认期间保留帧读回竞态、缩略图失败和复制失败状态。

## Todo27 approved extension
After native fullscreen release and before crop/model, show one selection-anchored small card in loading state; update actual thumbnail then success/error in that same opening. Translate above original (screenshot64), localized loading/error and success-only copy, real elapsed time, theme/drag/Esc. Alt+T, close and new capture invalidate late updates. No GUI/model/server launch; root owns final changelog/function-list.
