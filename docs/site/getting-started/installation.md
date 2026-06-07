---
title: Installation
description: Install Actor-Web and pick the right entry point for your environment.
sidebar:
  order: 1
---

# Installation

```bash
pnpm add @actor-core/runtime
# optional: state-machine test helpers
pnpm add -D @actor-core/testing
```

Actor-Web targets modern browsers and Node. Messages and events must be
JSON-serializable, since they may cross a worker or network boundary.

## Entry points

Import from the narrowest entry point that fits — browser bundles should not pull
in Node built-ins:

| Import | Use for |
| --- | --- |
| `@actor-core/runtime` | Core: `defineActor`, messages, local runtime. |
| `@actor-core/runtime/topology` | `defineActorWebTopology` and the DSL. |
| `@actor-core/runtime/browser` | Browser-safe sources & clients. |
| `@actor-core/runtime/node` | `serveActorWebNode`, HTTP ingress — server only. |
| `@actor-core/testing` | XState machine analysis helpers. |

See the [API entry-point map](/api/) for what each exports.

## Next

- [Your first actor](/getting-started/your-first-actor) — build a counter.
- [Topology & local runtime](/getting-started/topology-and-runtime) — wire it up
  and run it.
