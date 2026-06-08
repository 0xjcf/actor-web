---
title: Multi-process deployment
description: Run one topology across several nodes with serveActorWebNode, transport, and a gateway.
---

# Multi-process deployment

A topology can run as several cooperating processes — a server, a worker, a
browser — each a **node**. Behaviors don't change; only how nodes are served and
wired does.

## Serve a node

```ts
import { serveActorWebNode } from '@actor-web/runtime/node';

// Worker process
const worker = await serveActorWebNode(topology, {
  node: 'worker',
  transport: true,
  tools: toolRegistry,
});

// Coordinator process — connects to the worker, exposes a gateway for UIs
const coordinator = await serveActorWebNode(topology, {
  node: 'coordinator',
  transport: true,
  peers: { worker: worker.getTransportUrl() },
  connect: ['worker'],
  gateway: { expose: ['taskBoard'] },
});
```

## Two edges, two jobs

- **Transport** (`transport: true`, `peers`, `connect`) — runtime-to-runtime
  actor messaging between nodes. See [Transport](/concepts/transport).
- **Gateway** (`gateway.expose`) — the consumer edge a browser/UI connects to for
  projections and commands. See
  [Sources & the gateway](/concepts/sources-and-gateway).

They're independent: a node can have transport without a gateway (a pure worker)
or a gateway without peers (a single-node server).

## Resolving remote actors

A node resolves peers' actors by address:

```ts
const planner = await coordinator.system.lookup(topology.actors.plannerAgent.address.path);
await planner.ask({ type: 'PLAN_TASK', taskId });
```

## Operational notes

- Messages cross a wire — keep them **JSON-serializable**.
- Actor `send` is **at-most-once**; design for a possibly-dropped message.
- Put durable state in adapters/stores so a node restart doesn't lose it.

For a worked end-to-end example, see the logistics multi-process demo in the
Actor-Web repository.
