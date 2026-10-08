# Ordered implementation

- Todo16: RED actual installed browser xterm in Node (no DOM/PTY opened), fake PTY sink; parser-origin adapter; queued/explicit/snapshot wiring; cold vs same-process reporting modes; input during asynchronous parse and live/startup compatibility. Adapter APIs form Todo17 boundary.
- Todo17 (not yet assigned): generation and streamed completion; source geometry and bounded serialization; geometry/cell tests, dirty/exit/checkpoint integration.
- Todo18: consolidated independent review of six boundaries.
- Todo19/root: final evidence, TEMP changelog/features, manual matrix limitations and delivery.

Required verification: real-xterm origin test; replay/input/snapshot/manager focused tests; npx tsc --noEmit; independent npm run check:architecture -- --strict. Do not run unrelated full suites or actual user sessions.
