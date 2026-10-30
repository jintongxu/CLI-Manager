# Approved design — independent AI chat

Approval: dd3e13fe27db512ea03793385d8f0360633516f6bd9cc4bc1b736d7ffd504611 (full immutable Plan read before final fixes).

Text-only project-independent workspace; projects/chat primary navigation, persistent owners and terminal visibility/input isolation. Rust main DB migration 55 + transactional repository + direct three-protocol reqwest SSE; native provider resolver never exposes credentials. Existing exit coordinator is sole authority. No new dependencies, subprocess/model calls or Git mutation.

Canonical delivered boundary: `.trellis/spec/backend/independent-chat-contracts.md`; wire DTOs: `output/chat-backend-contract.md`. Preserve all approved T1–T7 scope; excluded attachments/tools/RAG/MCP/cloud/auto-retry remain excluded. Rollback only task patch; keep migration data, never silently drop tables. Initial BTW/process/navigation dirty work protected.

Scenarios: new send vs retry with independent composer; valid vs expired foreign lease; early restart then refresh; retained terminal save vs recovery/new owner/delete; normal exit vs failure/abort/tray; hidden/current-work/compact terminal navigation; both languages/IME. Automated vs manual boundaries are recorded separately.
