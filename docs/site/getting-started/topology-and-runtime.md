---
title: Topology & local runtime
description: Wire a behavior into a topology and run it on an in-process runtime.
sidebar:
  order: 3
---

# Topology & local runtime

You have a [behavior](/getting-started/your-first-actor). To *run* it, place it in
a **topology** and start a **runtime**.

## 1. Declare a topology

```ts
import { defineActorWebTopology, actor, node } from '@actor-web/runtime/topology';

export const topology = defineActorWebTopology({
  nodes: { local: node('local') },
  actors: {
    counter: actor({ id: 'counter', node: 'local', behavior: counter }),
  },
});
```

## 2. Start a local runtime

`startRuntime` runs the whole topology in-process — perfect for the
browser and tests:

```ts
import { startRuntime } from '@actor-web/runtime';

const runtime = await startRuntime(topology);
```

## 3. Drive the actor

Each actor exposes source factories. A command source can both observe and send:

```ts
const counter = runtime.actors.counter.commandSource();

await counter.ask({ type: 'INCREMENT' });
console.log(counter.snapshot().context.count); // 1
```

For a UI, prefer `readModel()` for display-only components — see
[Sources & the gateway](/concepts/sources-and-gateway) and the
[Ignite Element guide](/guides/ignite-element).

## 4. Stop

```ts
await runtime.stop();
```

## Next

- [Topology, nodes & supervisors](/concepts/topology) — the full model.
- [Multi-process deployment](/guides/multi-process-deployment) — run across nodes.
