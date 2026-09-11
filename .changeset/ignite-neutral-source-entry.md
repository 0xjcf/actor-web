---
'@actor-web/runtime': minor
---

# Neutral source entrypoint

Expose existing source contracts and factories through `@actor-web/runtime/source`
without importing the browser or Node host entrypoints. Source observation cleanup
does not transfer caller-owned actor or backing-runtime shutdown authority.
Existing root, browser, topology, Node and event-sourcing imports are unchanged.
