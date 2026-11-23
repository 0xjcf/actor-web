---
"@actor-web/agent": minor
---

Allow hosts to defer the model turn after a final `OBSERVE_TOOL_RESULT` and resume it with `CONTINUE_AGENT`. Persist the pause in loop checkpoints. Reject receipts that do not match a unique outstanding call by ID and name.
