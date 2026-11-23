---
title: Topology & local runtime
description: Run the same actor behavior with direct spawning or a declarative topology.
sidebar:
  order: 3
---

# Topology & local runtime

You can run an [actor behavior](/getting-started/your-first-actor) **with or
without a topology**. The choice is about who wires the application, not how
many actors it has.

- **Use `system.spawn()`** when your code decides which actors to start and
  when. Keep the returned references to send messages. You can spawn multiple
  actors and create more as work arrives.
- **Use `startRuntime(topology)`** when you want to declare your application's
  wiring up front: actor names, node placement, tool grants, supervision, and
  subscriptions. The runtime starts the declared actors and exposes them by key.

Either way, `defineBehavior` still owns how the actor handles messages. A
topology doesn't decide what the application does next.

## Define the behavior once

Both startup examples use this same counter. Define it, then choose one of the
two paths below.

```ts
import { defineBehavior } from '@actor-web/runtime';

const counter = defineBehavior<{ type: 'INCREMENT' }>()
  .withContext({ count: 0 })
  .onMessage(({ context }) => {
    const count = context.count + 1;
    return { context: { count }, reply: count };
  });
```

## Start actors directly with `system.spawn()`

```ts
import { createActorSystem } from '@actor-web/runtime';

const system = await createActorSystem({ nodeAddress: 'localhost:0' });
await system.start();

try {
  const ref = await system.spawn(counter, { id: 'counter' });
  console.log(await ref.ask<number>({ type: 'INCREMENT' })); // 1
} finally {
  await system.stop();
}
```

## Start actors from a topology

```ts
import { startRuntime } from '@actor-web/runtime';
import { actor, defineActorWebTopology, node } from '@actor-web/runtime/topology';

const topology = defineActorWebTopology({
  nodes: { local: node('local') },
  actors: {
    counter: actor({ id: 'counter', node: 'local', behavior: counter }),
  },
});

const runtime = await startRuntime(topology);
try {
  const commands = runtime.actors.counter.commands();
  console.log(await commands.ask<number>({ type: 'INCREMENT' })); // 1
} finally {
  await runtime.stop();
}
```

`actor()` declares the behavior, identity, and placement; it doesn't start the
actor. `startRuntime()` starts the topology in-process. The actor key
(`counter`) gives callers access to its command and read-model sources.

For display-only UI components, prefer `readModel()` — see
[Sources & the gateway](/concepts/sources-and-gateway) and the
[Ignite Element guide](/guides/ignite-element).

## Next

- [Topology, nodes & supervisors](/concepts/topology) — the full model.
- [Multi-process deployment](/guides/multi-process-deployment) — run across nodes.
