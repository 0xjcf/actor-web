---
title: API Reference
description: The primary actor runtime, agent runner, and testing entry points.
---

# API Reference

Actor-Web ships as a small set of packages and subpath entry points. Import from
the narrowest one that fits — browser code should not pull in Node entry points.

## Entry points

| Import | Use for |
| --- | --- |
| `@actor-web/runtime` | Core: [`defineBehavior`](/api/define-behavior), messages, runtime client. |
| `@actor-web/runtime/topology` | [`defineActorWebTopology`](/api/topology) and the `actor`/`node`/`supervisor`/`tool` DSL. |
| `@actor-web/runtime/browser` | Browser-safe sources & clients (no Node built-ins). |
| `@actor-web/runtime/node` | [`serveNode`](/api/runtimes), HTTP ingress — server only. |
| `@actor-web/agent` | `createAgentLoopBehavior` and provider-facing tools (`ModelToolDefinition`, `createLlmToolRegistry`). |
| `@actor-web/agent/portable` | Bind a definition to any `AgentRunner` with `createAgent`; no actor is started here. |
| `@actor-web/agent/runner` | `createAgentRunner` runs assignments in fresh in-process actor sessions. |
| `@actor-web/agent/zod` | Optional structured output parsing and assignment-aware validation. |
| `@actor-web/testing` | [State-machine analysis](/api/testing) test helpers. |

The agent subpaths above are present in this checkout, not in `@actor-web/agent@0.2.2`.

## Actor runtime or agent runner?

```ts
// Host the actors that own shipment state and process lifecycle messages.
const runtime = await startRuntime(shipmentTopology);

// Ask a specialist to investigate one shipment; it does not own that lifecycle.
const runner = createAgentRunner({ ...options, definition: inquiryDefinition });
const inquiry = createAgent(runner, inquiryDefinition);
const answer = await inquiry.run({ tracking_id: shipmentId, signal });
```

`actor(...)` declares a topology entry; `system.spawn(behavior)` starts a live
actor. The deprecated `createActor(behavior)` only returns its argument. Pass
an existing behavior object directly (use `satisfies ActorBehavior<MyMessage>`
for contextual typing), or author a new one with the [`defineBehavior()`
builder](/api/define-behavior). Neither form spawns it.

## Map

- **[`defineBehavior`](/api/define-behavior)** — author a behavior (the builder, the
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
