# 实施与验证

1. 推理缺省/显式 off 和轻量标题栏导航：调整数据默认与样式，覆盖切换、重载和中英文。
2. 会话置顶与侧栏显隐：前端持久化置顶集合，右键菜单、行内 Pin 标识、排序规则与拖动同区，收起入口始终可达。
3. 定向测试：排序/置顶/取消/存储/删除或过滤/侧栏显隐/推理缺省/导航结构；`npx tsc --noEmit`、`node --test scripts/chat*.test.mjs`、`npm run check:architecture`、`git diff --check`，更新 TEMP CHANGELOG 与对应功能清单；记录未执行的桌面视觉/语言手动验收。