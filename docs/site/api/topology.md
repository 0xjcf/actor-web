---
title: Topology
description: defineActorWebTopology, the actor/node/supervisor/tool DSL, and source factories.
---

# Topology

```ts
import { defineActorWebTopology, actor, node, supervisor, tool }
  from '@actor-web/runtime/topology';
```

## `defineActorWebTopology(input)`

```ts
defineActorWebTopology({
  contractVersion?: string;
  nodes: Record<string, NodeDefinition>;
  actors: Record<string, ActorDefinition>;
  supervisors?: Record<string, SupervisorDefinition>;
  subscriptions?: SubscriptionDefinition[];
  tools?: ToolReference[];
}): ActorWebTopology
```

Declares the system's nodes, actors, supervisors, tool catalog, and event
subscriptions. Returns a typed topology whose `actors` carry source factories
(below).

### `subscriptions`

Declare which actors receive which actors' emitted events. The runtime wires
these on start and tears them down on stop (durable across restart).

```ts
subscriptions: [
  { from: 'compare', to: ['actorSystem', 'pipeline'], events: ['OUTCOME_RESOLVED'] },
]
```

`from` and `to` are checked against the topology's actor keys (`to` is one key or
an array for fan-out); `events` is type-checked against the `from` actor's
emitted-event types — a typo or an event the publisher never emits is a
compile-time error (omit for all events). See
[Subscriptions & events](/concepts/subscriptions-and-events).

## DSL builders

| Builder | Shape |
| --- | --- |
| `node(name)` | A runtime process. |
| `actor({ id, node, behavior, tools?, supervision?, gateway? })` | An actor placement. |
| `supervisor({ node, strategy, children })` | A restart group. `strategy`: `one-for-one` \| `one-for-all` \| `rest-for-one` \| `escalate`. |
| `tool(name)` | Declares a usable tool. |

`behavior` accepts an un-built builder (`defineBehavior(...)` — `.build()` is
optional and runs under the hood), a built behavior value
(`defineBehavior(...).build()`), or a factory. Pass the builder or plain value
for tool-free actors; reach for `actor.withTools<TRegistry>()` with a
`(defineBehavior) => …` factory only when the actor calls tools.

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
  from '@actor-web/runtime/browser';
```
