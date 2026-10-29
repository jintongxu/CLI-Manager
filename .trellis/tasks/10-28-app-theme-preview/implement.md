# Implementation and verification

## Delivered

Standalone preview under `design-previews/app-theme/`. Open `index.html` directly; no server, build or dependency installation needed. Default: Graphite / dark / Chinese / comfortable / terminal workspace.

## Verification executed

- `node --check design-previews/app-theme/app.js` — PASS.
- `node --check design-previews/app-theme/views.js` — PASS.
- `node design-previews/app-theme/verify.cjs` — PASS: 96 configuration/scene renders; project, tab, file, collapse, preference interactions; escaped mock input.
- `npm run check:architecture -- --strict` — PASS: 1392 source files, zero above 2000 lines, zero new violations. Initial long-template violations were corrected by readable line breaks.
- Browser and screenshot checks deliberately delegated to root. VM smoke tests are not browser layout or accessibility validation.

## Browser handoff selectors

- Entry: `design-previews/app-theme/index.html`.
- Themes: `button[data-theme="graphite|porcelain|midnight"]` (top bar; duplicated in settings).
- Selects: `select[data-setting="mode|lang|density"]`; values `dark/light`, `zh/en`, `comfortable/compact`.
- Pages: `button[data-page="workspace|editor|settings|stats"]`.
- Projects: `[data-project="0|1|2"]`; terminals: `[data-tab="0|1|2"]`.
- Files: `[data-file="FileTree.tsx|useTreeNavigation.ts|navigation.test.ts"]`.
- Sidebar: `[data-action="collapse"]`; diff: `[data-action="diff"]`; review: `[data-action="review"]`.
- Preferences: `[data-toggle="restore|notify"]`, `select[data-setting="shell"]`.
- Statistics range: `select[data-setting="range"]`, values `7/30`.
- Mock terminal: `#terminal-message`, `#terminal-form`; status: `#visible-status`, `#announcement`.
- New terminal: `[data-action="new-session"]` opens mock PowerShell, never spawns a process.

Suggested browser sequence: 1440×1000 default screenshot; each theme in dark/light on four pages; switch English and compact; 1000px and 800px widths; sidebar collapse, file selection, diff/review, settings toggle, terminal input, reload reset. Check console, local horizontal diff scrolling, accessible labels and keyboard focus.

## Boundaries and repository state

Branch `wt/task-1027-2130-3c711d70c03c` has no configured upstream. No Git synchronization or commits performed. Existing `.workflow` modifications and task metadata were left untouched. Existing PRD was the task placeholder and was expanded as authorized. Production source files were read only. GitNexus local runner `.gitnexus/run.cjs` is absent; no existing production function/class/method was edited, so no existing-symbol impact operation was required. General executor schema paths were absent; report follows the supplied inline schema. Root owns changelog and feature-list updates.


## Graphite 生产接入（2026-10-28）

用户选择 Graphite 深色，新安装默认、保留已存配置；仅统一外壳，保留内容配色，版本 TEMP。已接入设置、双语、Mantine、BTW 协议和 auto 终端兼容，以及作用域化 CSS。

验证：27 项模型/兼容测试、3 项 CSS 对比度测试及有序导入测试通过；TypeScript 通过，集成后严格架构 1395 文件零违规，diff check 通过。浏览器加载生产 CSS 的隔离样本确认主背景 #15171b、侧栏 #1c1e23、实心按钮 #416ee8/白字、输入框 #23262d/#eef0f6、蓝色焦点。

限制：普通浏览器直接访问开发应用未显示可检查的实际界面，隔离样本不替代真实 Tauri/WebView 全界面验收；未操作真实设置、未重启、未提交。已有安装需在设置→通用选择深色 Graphite。知识候选 0。


## 奶油森林（方案A，用户替代选型）

已接入生产light/cream-forest：奶油白FFF9EE、淡杏F5E6CF、森林绿286044，muted为AA校正后的59654F。新安装light/cream-forest，已有偏好不迁移，Graphite旧工作保留。终端显式主题和默认值不改，auto映射既有warmPaperLight。

验证：复用26项模型/隔离测试及tsc，6项新CSS/preview测试+3项Graphite回归；子任务Chromium真实生产CSS样本确认token隔离和AA。root打开localhost18742/cream-forest.html确认结构及1024无溢出。严格架构1402文件零违规（格式化此前real-layout三处长行），diff check通过。无真实Tauri全界面验收；参考图不是App截图。未操作真实设置/重启/提交，用户需手动浅色+奶油森林。知识候选0。


## 海盐蓝最终选型与一致性待验收

冻结参考color-directions.html/css/js的sea/light，生产新增sea-salt与真实seaSaltLight；背景/文字/选区匹配参考，实际TerminalTabRow与工具栏selector已覆盖。显式整套应用只设置theme/lightPalette/terminalThemeMode/terminalThemeName，自定义覆盖保持并有双语说明。

验证复用31模型测试、16样式测试、tsc及Vite build；root集成strict1409文件零违规/diff通过。独立review代理网络失败无可用结论，桌面list_windows(app=cli-manager)无窗口，未修改真实偏好/重启，故真实视觉一致性仍待验收，禁止以静态或构建通过宣称一致。用户在设置→通用点击应用海盐蓝整套外观后截图对照为下一步；shell真彩色/自定义字体背景/独立skin不保证与mock相同。未提交推送。知识候选0。


## 最终新选型：Tokyo Night Storm 整套

实际app新增tokyo-night-storm + tokyoNightStormOfficial与独立整套按钮；按上游storm.lua/Windows Terminal extras固定色值，保留旧Storm不改。fresh defaults dark/Storm，已存配置和覆盖不迁移。

30项模型兼容测试和tsc通过；整合24项新旧样式测试通过（旧固定tail断言改为验证相对顺序保留）；strict1414文件零违规/diff通过。参考页由生产CSS、真实TSX TerminalTabRow SSR与ITheme AST生成，root浏览器确认sidebar/rail31,35,53，terminal36,40,59，button122,162,247配深字，双语收起与1024无溢出。

URL http://127.0.0.1:18742/storm-production-reference.html 。非真实Tauri截图，实际用户手动设置→通用应用Storm后需窗口确认；未操作真实配置或重启/提交。官方ANSI黑色固有低对比保留不擅改。无新增知识候选。


## Storm体验完善：临时预览/状态/焦点

实现5外观字段owner事务和通用页真实预览；preview仅内存，confirm保存dirty键，cancel/切页/close还原，确认中close等待settle。与legacy setter共用队列，system实时派生，不回滚语言字体等。Storm控件状态及已有用户分屏marker增强不默认dim。

独立review发现并已修复：备份读取committed values防draft泄露；补偿失败unresolved keys必须在后续保存先reconcile。修复后43项生产模块事务/UI与主题兼容测试通过，tsc/strict1421零违规。旧Cream/Graphite默认断言改为Storm，resolveTheme抽取后VM exports/result绑定修正，失败用例定向通过。样式与marker细项证据见Todo63；已有terminalPaneMarker旧className正则一项仍失败未扩大范围。

真实Tauri preview交互尚未由用户确认，测试为VM deterministic host而非真实窗口；不宣称视觉全验收，不操作真实配置/重启/提交。新增知识候选0。


## 项目侧栏清晰度/定位改造

显示纯helper最短唯一父路径和CLI/type/短ID补充，同步expanded/pinned/collapsed/flyout，继承路径消费groupPath resolver及groups订阅，SSHremote优先。身份图标区分project/worktree/session，不改ID及flat worktree。标题locate/collapseall复用key和nonce，按active session真实归属清search回all/展开祖先，不新建或激活终端。Storm sidebar轻量行和focus/hover/nohover操作可达，危险状态保留。

独立review两个缺陷一次修复：embedded button Enter/Space不被树劫持，继承项目展示使用有效group目录。61项selected项目测试通过，其中keyboard真实Chromium native按键执行production callback；1项旧palette22vs26断言仍fail未隐藏。最新tsc通过，rootstrict1430零违规/diff通过。styles18项通过复用。测试是隔离host/markup非真实App截图；未写真实设置/重启/提交。无新知识候选。
