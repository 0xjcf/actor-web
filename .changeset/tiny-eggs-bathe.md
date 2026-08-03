---
'@actor-web/runtime': patch
---

Clear pure XState correlation request timeout actors when a request resolves or errors so completed asks do not keep scheduler timers alive.
