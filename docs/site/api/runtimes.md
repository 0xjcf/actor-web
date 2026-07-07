---
title: Runtimes
description: Start a local runtime or serve a node — startRuntime, serveNode.
---

# Runtimes

A topology is inert until it runs. There are two ways to run one.

## `startRuntime(topology, opts?)`

```ts
import { startRuntime } from '@actor-web/runtime';

const runtime = await startRuntime(topology, { tools });
```

Starts a single-node, in-process runtime — ideal for the browser and tests.
Returns a started runtime with:

| Member | Purpose |
| --- | --- |
| `runtime.actors.<id>` | Source factories (`commands()`, `readModel()`, `session()`, …). |
| `runtime.requireActor(id)` / `getActor(id)` | The live `ActorRef`. |
| `runtime.nodes.<node>.system` | The underlying `ActorSystem` (e.g. for `subscribe`). |
| `runtime.stop()` | Graceful shutdown. |

## `serveNode(topology, opts)` <Badge type="warning" text="node" />

```ts
import { serveNode } from '@actor-web/runtime/node';

const node = await serveNode(topology, {
  node: 'worker',
  transport: true,
  peers: { server: serverUrl },
  connect: ['server'],
  gateway: { expose: ['taskBoard'] },
});
```

Serves one node of a topology with optional inter-node **transport** and a
consumer **gateway**. Use this for multi-process / multi-machine deployments.
Returns `{ system, transport, actors, requireActor, getGatewayUrl, getTransportUrl, stop, … }`.

- `transport` — enable runtime-to-runtime messaging (see [Transport](/concepts/transport)).
- `peers` / `connect` — static peer wiring.
- `gateway.expose` — which actors are reachable by UI consumers.

## `serveActorWebHttp(...)` <Badge type="warning" text="node" />

A REST ingress adapter that maps HTTP routes onto actor `send`/`ask`, for
exposing actors over HTTP. See `@actor-web/runtime/node`.

## See also

- [Topology](/api/topology) · [Sources & the gateway](/concepts/sources-and-gateway)
