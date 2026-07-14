---
"@actor-web/runtime": patch
---

Expose per-peer directory readiness through `ClusterState`, including syncing,
ready, and degraded states that remain separate from transport membership.
