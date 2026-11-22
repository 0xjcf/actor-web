---
"@actor-web/runtime": patch
---

Cancel the fallback correlation timer when a local actor ask reaches its deadline, so it no longer keeps the process alive after the request settles.
