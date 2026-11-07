# 设计

## 数据与文件
migration59新增chat_assets、chat_message_assets、chat_conversation_branches；引用是真相无refcount。文件<data-root>/chat-assets/{objects/sha256,staging,trash}，path由hash/真实格式推导。先stage+sync，再promote，最后DB transaction references；失败只产生不可达object，由startup reconcile处理，不得DB悬空。

Rust权威限制4/6MiB/8192/12MP、PNG JPEG staticWebP完整decode。原始验证字节保留，不剥EXIF/重编码。DTO只metadata；raw IPC精确message ref授权，Quick额外origin/owner约束，不扩大asset protocol。

## 请求和GC
user turn attachments历史重建到Anthropic/ChatCompletions/Responses，retry加载committed refs。组装预算16refs/32MiB/48MP，缺文件corrupt不静默text-only。删除DB先成功，GC mutex+BEGIN IMMEDIATE零引用canonical→trash、删row commit，24h sweep；reconcile恢复仍引用trash/清stage和orphan。

## 编辑分支
controller停止并await source run，unsaved阻止，refresh revision，backend single fork transaction：validate idle/CAS/user/settled prefix/operation idempotency；copy prefix fresh IDs/request IDs/reply remap/assets，edited user preserve|replace+pending answer+lineage+child lease。source完全不变，commit后network。conflict保留编辑draft不auto replay。

## UI
共享attachments/editor/branch components接三入口，picker/paste/drop统一stage；历史图按需read blob并严格revoke，Quick JSON仅stage UUID/descriptor/fork command。parent/sibling summary bounded。i18n/a11y/privacy。

## 风险
DB/FS split brain、raw IPC版本、asset path安全、provider历史预算、lease/race、Blob泄漏。索引落后106仍impact，当前源码确认。现有大量uncommitted统一终端/伴随/高亮改动严格保留，无reset/clean/mass format。
