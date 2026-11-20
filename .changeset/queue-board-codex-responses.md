---
"@actor-web/agent": minor
"@actor-web/runtime": minor
---

`createLlmProvider` speaks the OpenAI Responses API when the endpoint path ends in `/responses`, so a Codex model can use the same provider call. `START_AGENT` accepts `reset` to replace session history on a reused actor.

Actor dependencies `ask` resolves an actor reference or address and waits for the reply. In the browser, that ask runs inside the caller's open turn so the other actor can reply. The queue board uses that to run planner, builder, and reviewer sessions.
