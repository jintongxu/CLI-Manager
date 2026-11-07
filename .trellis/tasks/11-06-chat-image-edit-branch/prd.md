# 聊天图片持久化与编辑分支重答

用户确认：发送图片在消息中耐久显示；修改已发送问题时创建新分支保留原会话，不覆盖历史。批准方案671e381e46fe114a4660a98c36467a073a299dbbfd0089f36d8b640c70100d79。

## 验收
- Workspace/侧栏/Quick发送图片后立即显示，重启历史仍显示；retry复用同一图；image-only合法。
- 每消息4图，每图PNG/JPEG/static WebP，<=6MiB、边<=8192、<=12MP；Rust验证真实格式/完整解码，拒绝损坏/spoof/动画且无DB/file/request副作用。
- data-root chat-assets对象+staging/trash，SQLite metadata+ordered refs，descriptor无path/base64/bytes，精确授权raw read，Blob URL生命周期可验证。
- 编辑committed user创建同origin child：复制目标前settled前缀、新IDs/reply/request remap、共享refs、source不变；preserve/replace图；CAS/stop/save/operation idempotency无部分branch或自动模型重放。
- parent删除child和资产引用保留，显示original deleted；三入口共同branch导航。
- chat/WebDAV backup范围不变，本地图片明文及provider发送有提示；不承诺安全擦除或未提交draft跨重启。
- migration59 additive，v55 bytes/checksum不变；完整自动+手工限制证据，中英文/a11y。
