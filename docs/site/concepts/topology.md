---
title: Topology, nodes & supervisors
description: Declaring where actors run and how they are grouped with defineActorWebTopology.
---

# Topology, nodes & supervisors

A **topology** is a declarative description of your system: which runtime
**nodes** exist, which **actors** run on them, and how they are **supervised**.
It's the one place that owns placement and lifecycle.

```ts
import { defineActorWebTopology, actor, node, supervisor, tool } from '@actor-web/runtime/topology';

export const topology = defineActorWebTopology({
  contractVersion: '0.1.0',
  nodes: { local: node('local') },
  tools: [tool('repo.diff'), tool('verification.run')],
  actors: {
    pipeline: actor({ id: 'pipeline', node: 'local', behavior: createPipeline }),
    compare:  actor({ id: 'compare',  node: 'local', behavior: createCompare }),
  },
  supervisors: {
    aggregates: supervisor({ node: 'local', strategy: 'one-for-one', children: ['pipeline', 'compare'] }),
  },
});
```

## The pieces

- **`node(name)`** — a runtime process: a server, a browser tab, a web worker, a
  container. Actors are placed on nodes.
- **`actor({ id, node, behavior, tools?, supervision? })`** — an actor
  definition. `tools` is its allowlist (see [Tools](/concepts/tools));
  `supervision` is its restart policy.
- **`supervisor({ node, strategy, children })`** — groups actors under a restart
  [supervision](/concepts/supervision) strategy.
- **`tool(name)`** — declares a tool the topology's actors may use.

## Location transparency

Because placement is declared (not hard-coded into behaviors), the same actor
code runs locally or across nodes — only the topology changes. Actors address
each other by id/address, and the runtime resolves whether that's an in-process
mailbox or a [transport](/concepts/transport) hop.

## Running a topology

`startRuntime(topology)` spins up a single-node runtime (ideal for
the browser and tests); `serveNode(topology, { node })` serves a node
with optional gateway/transport for multi-process deployments.
