---
"@actor-web/runtime": patch
---

Deprecate `createActor`, which returns its behavior argument unchanged. Pass the behavior directly or use `defineBehavior` to author one; use `system.spawn` to start an actor.
