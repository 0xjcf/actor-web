---
title: API Reference
description: The public entry points of @actor-web/runtime and @actor-web/testing.
---

# API Reference

Actor-Web ships as a small set of packages and subpath entry points. Import from
the narrowest one that fits — browser code should not pull in Node entry points.

## Entry points

| Import | Use for |
| --- | --- |
| `@actor-web/runtime` | Core: [`defineActor`](/api/define-actor), messages, runtime client. |
| `@actor-web/runtime/topology` | [`defineActorWebTopology`](/api/topology) and the `actor`/`node`/`supervisor`/`tool` DSL. |
| `@actor-web/runtime/browser` | Browser-safe sources & clients (no Node built-ins). |
| `@actor-web/runtime/node` | [`serveActorWebNode`](/api/runtimes), HTTP ingress — server only. |
| `@actor-web/testing` | [State-machine analysis](/api/testing) test helpers. |

## Map

- **[`defineActor`](/api/define-actor)** — author a behavior (the builder, the
  handler shape, return results).
- **[Topology](/api/topology)** — declare nodes, actors, supervisors, tools, and
  the source factories each actor exposes.
- **[Runtimes](/api/runtimes)** — start a local runtime or serve a node.
- **[`@actor-web/testing`](/api/testing)** — analyze XState machines used by
  machine-based actors.

These pages document signatures. For the *why* behind each idea, see
[Concepts](/concepts/actors-and-behaviors).

::: info Scope
This reference covers the primary public surface. Lower-level exports (transport,
gateway internals, telemetry) are intentionally not yet documented here.
:::
