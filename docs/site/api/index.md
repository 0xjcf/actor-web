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
| `@actor-web/agent/portable` | `AgentSpec` and `createAgent(runner, spec)` for binding to a custom `AgentRunner`. |
| `@actor-web/agent/runner` | `createAgent({ spec, ...options })` for typed assignments in fresh in-process actor sessions; `createAgentRunner` for direct execution handles. |
| `@actor-web/agent/zod` | Optional structured output parsing and assignment-aware validation. |
| `@actor-web/agent/terminal` | `createTerminalTraceReporter` for opt-in human-readable `trace.onEvent` output; `formatTerminalTraceEvent` to format a single event without writing. |
| `@actor-web/testing` | [State-machine analysis](/api/testing) test helpers. |

The agent subpaths above are present in this checkout, not in `@actor-web/agent@0.2.2`.

## Actor runtime or agent runner?

```ts
import { createAgent } from '@actor-web/agent/runner';

// Host the actors that own shipment state and process lifecycle messages.
const runtime = await startRuntime(shipmentTopology);

// Ask a specialist to investigate one shipment; it does not own that lifecycle.
const inquiry = createAgent({ ...options, spec: inquirySpec });
const answer = await inquiry.run({ tracking_id: shipmentId, signal });
```

An `AgentSpec` describes the purpose, system prompt, requested tools, and output
parser. The host supplies the provider, tool grants and implementations, and
execution limits. The runner factory binds the spec once for both trusted
execution and typed output parsing. Construction starts no actor; each admitted
`run` starts a fresh session.

For a custom execution backend, use `createAgent(runner, spec)` from
`@actor-web/agent/portable`. For settlement, trace snapshots, or execution evidence,
use `createAgentRunner({ spec, ...options })` and its `start(request)` handles.
The higher-level factory returns a `FocusedAgent`, not those handles.

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
