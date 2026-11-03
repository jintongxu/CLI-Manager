
### Active conversation deletion correction
- Active removal now waits for cancellation-triggered terminal event and the controller's queued final revision refresh before fresh GET/DELETE. Cancellation ack is not a terminal signal; no timeout authorizes deletion. Failure to cancel/refresh leaves row intact.
- Screenshot's generic `chat_storage` remains an unproven fallback label; no exact UI/bulk error stage or cause inferred.
- Quick-chat recovery review fix: replacement-create failure now publishes after clearing the recovery latch, and a later hello clears stale owner error after successful recovery; deterministic reject-then-retry regression test added (22 quick-chat tests, TypeScript, and diff whitespace check passed).
