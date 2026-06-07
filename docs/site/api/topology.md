---
title: Topology
description: defineActorWebTopology, the actor/node/supervisor/tool DSL, and source factories.
---

# Topology

```ts
import { defineActorWebTopology, actor, node, supervisor, tool }
  from '@actor-core/runtime/topology';
```

## `defineActorWebTopology(input)`

```ts
defineActorWebTopology({
  contractVersion?: string;
  nodes: Record<string, NodeDefinition>;
  actors: Record<string, ActorDefinition>;
  supervisors?: Record<string, SupervisorDefinition>;
  tools?: ToolReference[];
}): ActorWebTopology
```

Declares the system's nodes, actors, supervisors, and tool catalog. Returns a
typed topology whose `actors` carry source factories (below).

## DSL builders

| Builder | Shape |
| --- | --- |
| `node(name)` | A runtime process. |
| `actor({ id, node, behavior, tools?, supervision?, gateway? })` | An actor placement. |
| `supervisor({ node, strategy, children })` | A restart group. `strategy`: `one-for-one` \| `one-for-all` \| `rest-for-one` \| `escalate`. |
| `tool(name)` | Declares a usable tool. |

`supervision` is `{ strategy, maxRestarts, withinMs }`. See
[Supervision](/concepts/supervision).

## Source factories

Each actor in a topology exposes factories for UI consumption:

| Factory | Returns |
| --- | --- |
| `actor.readModel(opts)` | Read-only source: `snapshot`, `subscribe`, `subscribeEvent`. |
| `actor.commandSource(opts)` | Read-model **+** `send` / `ask`. |
| `actor.source(opts)` | Unified read + command. |
| `actor.sourceHandle(opts)` | Paired read-model + command source. |
| `actor.readModelHandle(opts)` | Gateway-wrapped read-model handle. |

`opts` is `ActorWebSourceOptions` — gateway/transport config
(`{ gateway: { url, scope?, auth? }, streamId?, createSocket? }`), **not** actor
identity. See [Sources & the gateway](/concepts/sources-and-gateway).

## Address-based sources

For consumers outside the topology's TypeScript project:

```ts
import { createActorWebReadModelSource, createActorWebCommandSource }
  from '@actor-core/runtime/browser';
```
