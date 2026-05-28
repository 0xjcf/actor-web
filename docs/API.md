# Actor-Web Runtime API

Actor-Web provides actor runtimes, topology descriptors, browser/client sources,
gateway projections, and runtime-to-runtime transports. The public API favors
typed messages, topology-owned actors, and hexagonal boundaries.

Read this guide in layers:

1. Define actor behavior with `defineActor(...)`.
2. Declare runtime ownership with `defineActorWebTopology(...)`.
3. Start actor-owning locations with `serveActorWebNode(...)` or
   `startActorWebNode(...)`.
4. Connect thin UIs and dashboards with `createActorWebReadModelClient(...)` or
   `createActorWebReadModelSource(...)`.
5. Add application ingress with `serveActorWebHttp(...)`.

Current guarantees:

- Actor behavior handlers return `{ context, reply, emit }`.
- Runtime-to-runtime transport uses the `MessageTransport` seam.
- Gateway is a client projection/control channel, not cluster transport.
- Built-in runtime transport is direct-peer and at-most-once.
- Runtime peers and gateway clients can be authenticated before stream/peer
  admission.
- Topology runners expose normalized runtime transport status with peer
  freshness and heartbeat-derived stale detection.
- Gateway streams detect sequence gaps and resync from a bounded replay tail,
  using in-memory storage by default and optionally restoring that tail from an
  app-provided durable replay provider.
- Topology runners can use a runtime peer discovery provider instead of only
  static `peers` maps.
- Runtime transport telemetry, exporter plumbing, and the Node JSONL sink are
  available for transport observability.

## Runtime Locations

Actor-Web treats a distributed application as a topology of logical nodes. A
node can run in a backend process, browser worker, service worker, CLI process,
or another machine. Actors belong to nodes, and clients consume actor projections
through gateway sources.

Use these APIs by location:

| Location | Owns actors? | API |
| --- | --- | --- |
| Shared contract package | No runtime | `defineActorWebTopology(...)` |
| Backend/server process | Yes | `serveActorWebNode(...)` |
| Backend REST/application ingress | Uses served actors | `serveActorWebHttp(runtime)` |
| Browser UI / Ignite host | No ActorSystem by default | `createActorWebReadModelClient(...)` |
| Browser/WebWorker runtime location | Yes | `startActorWebNode(...)` |
| Browser-local worker or service-worker edge | Optional | `createMessagePortTransport(...)` passed to `startActorWebNode(...)` |
| Separate frontend/backend repos | Usually client-only | `createActorWebReadModelSource({ address, contractVersion, gateway })` |

There are two different network channels:

- **Gateway URL**: client projection/control channel for UI, Ignite Element,
  live command clients, and dashboards.
- **Transport URL**: runtime-to-runtime channel used by Actor-Web nodes that own
  actors and exchange actor messages.

Use a gateway source when a page or client wants to observe/control an actor. Use
`startActorWebNode(...)` or `serveActorWebNode(...)` when that process is an
Actor-Web runtime location that owns actors.

Recommended imports:

```ts
// Shared topology and actor behavior.
import { defineActor, defineFSM } from '@actor-core/runtime';
import { actor, defineActorWebTopology, node, supervisor, tool } from '@actor-core/runtime/topology';

// Browser/client projection and browser worker runtime hosting.
import {
  createActorWebCommandSource,
  createActorWebReadModelClient,
  createActorWebReadModelSource,
  startActorWebLocalRuntime,
  startActorWebNode,
} from '@actor-core/runtime/browser';

// Node/server runtime hosting and HTTP ingress.
import { serveActorWebHttp, serveActorWebNode } from '@actor-core/runtime/node';
```

## Actor Behavior

### `defineActor()`

Use `defineActor` to define actor behavior. The normal handler context exposes
only the public capabilities needed for application code:

```ts
const shipmentBehavior = defineActor()
  .withContext({
    shipmentId: null,
    shipmentCount: 0,
    status: 'idle',
    destination: '',
    carrier: 'pending',
    eta: 'pending',
    routeNotes: 'pending route plan',
    timeline: [],
  })
  .onMessage(({ message, context }) => {
    if (message.type === 'GET_SHIPMENT_COUNT') {
      return { reply: context.shipmentCount };
    }
  })
  .build();
```

Handler context:

- `message`: incoming actor message.
- `context`: current actor context when `.withContext(...)` or
  `.withMachine(...)` provides one.
- `tools`: actor tool ports assigned by topology and implemented by the node
  runner.
- `actor`: advanced state/machine inspection when needed.

Handler result:

```ts
return {
  context: {
    ...context,
    status: 'route-assigned',
  },
  reply: { ok: true },
  emit: [{ type: 'ROUTE_ASSIGNED', shipmentId }],
};
```

- `context`: replaces this actor's state.
- `reply`: responds to `ask(...)`.
- `emit`: publishes facts/events to subscribers and gateway streams.

### `withFSM(...)` and `onTransition(...)`

Use `withFSM(...)` for a small synchronous constraint map. Side effects, tools,
emits, replies, and context updates stay in `onTransition(...)`.

`withFSM(...)` does not provide actor context by itself. If the actor needs
domain state, pair it with `withContext(...)` as shown below.

```ts
const shipmentFSM = defineFSM({
  initial: 'idle',
  states: {
    idle: {
      on: {
        CREATE_SHIPMENT: 'route-requested',
      },
    },
    'route-requested': {
      on: {
        ASSIGN_ROUTE: 'route-assigned',
      },
    },
    'route-assigned': {
      on: {
        MARK_DELIVERED: 'delivered',
      },
    },
    delivered: {},
  },
});

const behavior = defineActor()
  .withContext({
    shipmentId: null,
    shipmentCount: 0,
    status: 'idle',
    destination: '',
    carrier: 'pending',
    eta: 'pending',
    routeNotes: 'pending route plan',
    timeline: [],
  })
  .withFSM(shipmentFSM)
  .onTransition({
    CREATE_SHIPMENT: ({ context }) => ({
      context: {
        ...context,
        status: 'route-requested',
      },
      emit: [{ type: 'SHIPMENT_CREATED' }],
    }),
  })
  .build();
```

Invalid transitions are returned as error values for `ask(...)` instead of being
thrown by default.

The FSM is a constraint map, not an effect engine. Keep I/O, tool calls,
actor-to-actor messaging, emitted events, replies, and context updates in actor
handlers.

### `withMachine(...)`

Use `withMachine(...)` when you need XState features. Do not combine
`withMachine(...)` and `withFSM(...)` on the same actor.

```ts
import { createMachine } from 'xstate';

const workflowMachine = createMachine({
  context: {
    approved: false,
  },
  initial: 'pending',
  states: {
    pending: {
      on: {
        APPROVE: 'approved',
      },
    },
    approved: {},
  },
});

const behavior = defineActor()
  .withMachine(workflowMachine)
  .onTransition({
    APPROVE: ({ context }) => ({
      context: {
        ...context,
        approved: true,
      },
      emit: [{ type: 'WORKFLOW_APPROVED' }],
    }),
  })
  .build();
```

## Topology

### `defineActorWebTopology(...)`

Topology is the shared source of truth for nodes, actors, supervision metadata,
gateway exposure, and tool requirements.

```ts
import { actor, defineActorWebTopology, node, supervisor, tool } from '@actor-core/runtime/topology';

const shipmentBehavior = defineActor()
  .withContext({
    shipmentId: null,
    shipmentCount: 0,
    status: 'idle',
  })
  .onMessage(({ message, context }) => {
    if (message.type === 'CREATE_SHIPMENT') {
      return {
        context: {
          ...context,
          shipmentId: String(message.shipmentId),
          shipmentCount: context.shipmentCount + 1,
          status: 'route-requested',
        },
        emit: [{ type: 'SHIPMENT_CREATED' }],
      };
    }
  })
  .build();

const routingBehavior = defineActor()
  .withContext({
    carrier: 'pending',
    eta: 'pending',
    routeNotes: 'pending worker plan',
  })
  .onMessage(({ message, context }) => {
    if (message.type === 'PLAN_ROUTE') {
      return {
        context: {
          ...context,
          carrier: 'Northline Express',
          eta: '24h',
          routeNotes: `Route through ${String(message.destination)}`,
        },
        reply: {
          carrier: 'Northline Express',
          eta: '24h',
          routeNotes: `Route through ${String(message.destination)}`,
        },
        emit: [{ type: 'ROUTE_ASSIGNED' }],
      };
    }
  })
  .build();

export const logistics = defineActorWebTopology({
  contractVersion: '1.0.0',

  nodes: {
    browser: node('logistics-browser-host'),
    server: node('logistics-server-runtime'),
    worker: node('logistics-worker-runtime'),
  },

  tools: [tool('routing.plan')],

  actors: {
    shipment: actor({
      id: 'logistics-shipment',
      node: 'server',
      behavior: shipmentBehavior,
      gateway: true,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    routing: actor({
      id: 'logistics-routing',
      node: 'worker',
      behavior: routingBehavior,
      tools: ['routing.plan'],
      gateway: true,
    }),
  },

  supervisors: {
    serverLogistics: supervisor({
      node: 'server',
      strategy: 'one-for-one',
      children: ['shipment'],
    }),
  },
});
```

Actor descriptors include an inferred address:

```ts
logistics.actors.shipment.address.path;
// actor://logistics-server-runtime/actor/logistics-shipment
```

The `node` field declares ownership, not import location. For example,
`shipment` can be defined in a shared package, served by a backend process, and
projected into a browser UI without the browser owning the actor runtime.

### Supervision

Topology supervision has two levels:

- `actor(... { supervision })` declares the intended failure policy for one
  actor.
- `supervisor(...)` declares a process group on one node.

```ts
supervisors: {
  serverLogistics: supervisor({
    node: 'server',
    strategy: 'one-for-one',
    children: ['shipment', 'routing'],
  }),
}
```

The topology builder validates supervisor node keys and child actor keys. Current
runtime enforcement is intentionally basic: actor failures are restarted through
the runtime's per-actor restart guardrails. Topology-specific group strategies
such as `one-for-all` and `rest-for-one` are metadata-only until the supervision
enforcement slice is completed; today they fall back to independent per-actor
restart behavior rather than restarting or stopping sibling actors as a group.

### Tools For Agents

Tools are topology ports. Declare them once, assign them to actors, and implement
them in the node runner that hosts those actors.

Tool access has three layers:

- Root `tools`: the topology-wide catalog and contract.
- Actor `tools`: the least-privilege allowlist for one actor.
- Runner `tools`: concrete implementations supplied by the hosting process.

Root tools do not automatically become available to every actor. Actor behavior
only receives tools explicitly assigned to that actor.

```ts
import type { ActorToolExecutor } from '@actor-core/runtime';

type ScanInput = { label: string; destination: string };
type ScanResult = { accepted: boolean; label: string };
type RouteResult = { carrier: string; eta: string; routeNotes: string };
type LogisticsTools = {
  'provider.scan.verify': ActorToolExecutor<ScanInput, ScanResult>;
  'route.plan': ActorToolExecutor<ScanInput, RouteResult>;
};

const scanShipmentBehavior = defineActor()
  .withContext({ status: 'idle', latestScan: null })
  .withTools<LogisticsTools>()
  .onMessage(async ({ message, context, tools }) => {
    if (message.type === 'SCAN_LABEL') {
      const scan = await tools.execute('provider.scan.verify', message);

      return {
        context: {
          ...context,
          latestScan: scan,
        },
        emit: [{ type: 'PROVIDER_SIGNAL_RECORDED' }],
      };
    }
  })
  .build();

const logistics = defineActorWebTopology({
  tools: [tool('provider.scan.verify'), tool('route.plan')],
  nodes: {
    server: node('logistics-server-runtime'),
  },
  actors: {
    shipment: actor({
      id: 'logistics-shipment',
      node: 'server',
      behavior: scanShipmentBehavior,
      tools: ['provider.scan.verify', 'route.plan'],
    }),
  },
});

const server = await serveActorWebNode(logistics, {
  node: 'server',
  tools: {
    'provider.scan.verify': async (input) => ({
      accepted: true,
      label: String(input.label),
    }),
    'route.plan': async (input) => ({
      carrier: 'Northline Express',
      eta: '24h',
      routeNotes: `Route through ${String(input.destination)}`,
    }),
  },
});
```

Actor behavior uses assigned tools from the handler context. The node runner
implements those tool ports at the process boundary. `withTools<TRegistry>()`
is type-only; it makes `tools.execute(...)` infer tool payload and result
shapes, while topology actor `tools` still controls runtime least-privilege
access. A runner can register additional tools, but an actor cannot execute a
tool that is not assigned to that actor.

This is the recommended agent pattern: the actor owns state, routing, emitted
facts, and transition constraints; tools are explicit ports for outside
capabilities such as model calls, scanners, payment providers, search, or
workflow engines.

## Common Deployment Shapes

### Server-owned actor, thin browser UI

Use this when the server owns the actor lifecycle and the browser only needs
live state and commands.

```ts
// server.ts
const server = await serveActorWebNode(logistics, {
  node: 'server',
  gateway: {
    auth: {
      verifyToken: ({ token }) => token === process.env.ACTOR_WEB_GATEWAY_TOKEN,
    },
  },
});

// browser.ts
const client = createActorWebReadModelClient(logistics, {
  gateway: {
    url: 'ws://logistics.example.com/gateway',
    auth: {
      token: () => sessionStorage.getItem('actor-web-gateway-token') ?? undefined,
    },
  },
});

const shipmentSource = client.actors.shipment;
```

### Server runtime plus worker runtime

Use this when different runtime locations own different actors and communicate
through Actor-Web transport.

```ts
// server.ts
const server = await serveActorWebNode(logistics, {
  node: 'server',
  gateway: true,
  transport: {
    listen: true,
    auth: {
      token: () => process.env.ACTOR_WEB_NODE_TOKEN,
      verifyToken: ({ token }) => token === process.env.ACTOR_WEB_NODE_TOKEN,
    },
  },
});

// worker.ts
const worker = await startActorWebNode(logistics, {
  node: 'worker',
  peers: {
    server: 'ws://logistics.example.com/runtime-transport',
  },
  transport: {
    auth: {
      token: () => workerRuntimeToken,
    },
  },
});
```

`ws://logistics.example.com/runtime-transport` is the server node's transport
URL, not the gateway URL. Browser UI sources still use the gateway URL.

For deployments where peer URLs are not known at compile time, use a discovery
provider:

```ts
const discovery = createStaticRuntimePeerDiscoveryProvider([
  {
    nodeAddress: 'logistics-server-runtime',
    url: 'ws://logistics.example.com/runtime-transport',
  },
]);

await startActorWebNode(logistics, {
  node: 'worker',
  discovery,
});
```

### Browser-local service worker topology proof

Use `createMessagePortTransport(...)` when the host page and worker already
share a `MessagePort`. This is useful for browser-local demos, embedded worker
edges, or service worker proofs.

```ts
const channel = new MessageChannel();

const transport = createMessagePortTransport({
  nodeAddress: 'browser-host',
  peerAddress: 'service-worker-runtime',
  port: channel.port1,
});

await startActorWebNode(logistics, {
  node: 'serviceWorker',
  transport,
});
```

## Client Sources

Use `createActorWebReadModelClient(...)` as the default UI/client entrypoint
when a shared topology is available. It binds gateway configuration once and
exposes each actor as a projection-only source.

```ts
const client = createActorWebReadModelClient(logistics, {
  gateway: { url: 'ws://127.0.0.1:4100' },
  clientVersion: 'logistics-ui',
});

const shipmentSource = client.actors.shipment;
```

Actor-Web read-model sources provide:

- `snapshot()`
- `subscribe(listener)`
- `subscribeEvent(listener, options?)`
- `transportStatus()`
- `subscribeTransportStatus(listener)`
- `close()`

For Ignite Element, the target API keeps this read-model source as the default
`source` for `ignite-element/actor-web`. Components that only render live
projection state should not need a command-capable source:

```ts
const shipmentCard = igniteCore({
  source: () =>
    logistics.actors.shipment.readModel({
      gateway: { url: 'ws://127.0.0.1:4100' },
    }),

  states: ({ context, transport }) => ({
    shipmentId: context.shipmentId,
    status: context.status,
    syncState: transport.state,
  }),
});
```

When a host needs both live projection state and command/control for the same
actor, pair the read-model source with an explicit command helper. The
read-model side stays on the full projection subscription, while the explicit
command helper uses a lighter command-only gateway subscribe mode so it does
not open a second snapshot/event/transition stream for the same actor.

```ts
const client = createActorWebReadModelClient(logistics, {
  gateway: { url: 'ws://127.0.0.1:4100' },
  clientVersion: 'logistics-ui',
});

const shipmentSource = client.actors.shipment;
const shipmentCommands = logistics.actors.shipment.commandSource({
  gateway: { url: 'ws://127.0.0.1:4100' },
});
```

The matching `ignite-element/actor-web` contract should expose that pairing
without requiring product code to wrap sources or write manual generics:

```ts
const shipmentCard = igniteCore({
  source: () =>
    logistics.actors.shipment.readModel({
      gateway: { url: 'ws://127.0.0.1:4100' },
    }),
  commandSource: () =>
    logistics.actors.shipment.commandSource({
      gateway: { url: 'ws://127.0.0.1:4100' },
    }),

  commands: ({ actor }) => ({
    cancel: (shipmentId: string) =>
      actor.send({ type: 'CANCEL_SHIPMENT', shipmentId }),
  }),
});
```

`ignite-element/actor-web` should treat `close()` as the Actor-Web cleanup hook,
equivalent to `stop()` for handles, so product code does not need to adapt
`{ source, stop: () => source.close() }` by hand.

For single-process proofs, use `startActorWebLocalRuntime(...)` instead of
hand-starting every topology node and manually adapting ActorRefs. It starts the
selected topology nodes over an in-memory transport network and exposes each
actor at the top level with the Ignite-friendly source shape:

```ts
const runtime = await startActorWebLocalRuntime(logistics, {
  tools: {
    'routing.plan': async (input) => ({
      carrier: 'Northline Express',
      eta: '24h',
      routeNotes: `Route through ${String(input.destination)}`,
    }),
  },
});

const dashboard = igniteCore({
  source: ({ host }) => runtime.dashboard.readModel({ host }),
  commandSource: () => runtime.dashboard.commandSource(),
});
```

`readModel({ host })` accepts Ignite's host-context object so product code can
pass the source factory arguments straight through. `source.close()` closes that
source's subscriptions; `runtime.stop()` closes every source the runtime opened
and then stops all started Actor-Web nodes. App-owned runtimes should call
`runtime.stop()` during teardown. Ignite-owned isolated sources can rely on
`close()` or an `AbortSignal` passed to `readModel(...)`/`commandSource(...)`.

Use an explicit command helper when the host owns command/control:

```ts
const shipmentCommands = logistics.actors.shipment.commandSource({
  gateway: { url: 'ws://127.0.0.1:4100' },
});

await shipmentCommands.send({
  type: 'CREATE_SHIPMENT',
  shipmentId: 'shipment-1001',
  destination: 'Chicago warehouse',
});
```

Legacy command-capable helpers remain available for compatibility:

```ts
const legacyClient = createActorWebClient(logistics, {
  gateway: { url: 'ws://127.0.0.1:4100' },
});

await legacyClient.actors.shipment.send({
  type: 'CREATE_SHIPMENT',
  shipmentId: 'shipment-1001',
  destination: 'Chicago warehouse',
});
```

### `createActorWebReadModelSource(...)`

Use `createActorWebReadModelSource` for explicit or generated-client paths.
Prefer the single-object shape. This creates a gateway-backed read-model source
for a client; it does not start an Actor-Web runtime node. Read-model sources
always keep the full projection subscription so `snapshot()`,
`subscribe(listener)`, and `subscribeEvent(...)` remain available.

```ts
const shipmentSource = createActorWebReadModelSource({
  actor: logistics.actors.shipment,
  gateway: { url: 'ws://127.0.0.1:4100' },
});
```

The topology descriptor convenience is equivalent and useful when the topology
is already in scope:

```ts
const shipmentSource = logistics.actors.shipment.readModel({
  gateway: { url: 'ws://127.0.0.1:4100' },
});
```

Separate repos can use address metadata instead of the shared TypeScript
topology:

```ts
const shipmentSource = createActorWebReadModelSource({
  address: 'actor://logistics-server-runtime/actor/logistics-shipment',
  contractVersion: '1.0.0',
  gateway: {
    url: 'ws://127.0.0.1:4100',
    scope: {
      params: { tenantId: 'tenant-a' },
    },
  },
});
```

Use `createActorWebCommandSource(...)` or `topology.actors.name.commandSource(...)`
only when the host intentionally owns command/control for that actor. These
helpers now opt into the gateway's command-only subscribe mode: they still go
through gateway auth and scope resolution, but they wait for the first
post-subscribe status instead of an initial snapshot and they do not request
snapshot/event/transition replay.

```ts
const shipmentCommands = createActorWebCommandSource({
  address: 'actor://logistics-server-runtime/actor/logistics-shipment',
  contractVersion: '1.0.0',
  gateway: { url: 'ws://127.0.0.1:4100' },
});

await shipmentCommands.send({
  type: 'CREATE_SHIPMENT',
  shipmentId: 'shipment-1001',
  destination: 'Chicago warehouse',
});
```

### `createActorWebReadModelClient(topology, options)`

This is the normal browser/UI entrypoint when the UI does not own an
ActorSystem. Use direct `createActorWebReadModelSource(...)` only when you need
one source without constructing a full topology client, or when a generated
client only has address metadata.

## Node And Worker Runners

### `serveActorWebNode(topology, options)`

Starts one topology node in a Node/server environment. Use this in the process
that owns one or more topology actors.

```ts
const server = await serveActorWebNode(logistics, {
  node: 'server',
  gateway: true,
  transport: true,
  tools: {
    'routing.plan': async (input) => ({
      carrier: 'Northline Express',
      eta: '24h',
      routeNotes: `Route through ${String(input.destination)}`,
    }),
  },
});

const shipment = server.requireActor('shipment');
console.log(server.getGatewayUrl());
console.log(server.getTransportUrl());
```

`gateway: true` exposes topology actors that declare `gateway: true`.
`transport: true` opens the runtime-to-runtime WebSocket listener. Use object
options only when deployment details need explicit ports, hosts, heartbeat
settings, peer resolution, or auth.

Topology runners expose runtime transport status without requiring applications
to inspect transport internals:

```ts
const transport = server.getTransportStatus();
const worker = server.getPeerStatus('logistics-worker-runtime');

if (!worker.connected || !worker.fresh) {
  console.warn(worker.staleReason ?? worker.rejectedReason ?? 'worker unavailable');
}
```

`RuntimePeerStatus` includes `nodeAddress`, `state`, `connected`, `fresh`,
`lastSeenAt`, `disconnectedAt`, `rejectedReason`, `staleAfterMs`, and
`staleReason`. `RuntimeTransportStatus` includes normalized `connectedNodes`,
all known `peers`, and optional `startedAt` / `stoppedAt` timestamps.

When `transport: true` or `transport: { listen: true }` is used,
`serveActorWebNode(...)` and `startActorWebNode(...)` let the WebSocket
transport heartbeat defaults apply: 15 seconds interval and 30 seconds timeout.
Set `heartbeatIntervalMs: 0` explicitly to opt out for tests or custom
deployment constraints.

`serveActorWebNode` deliberately does not own REST routes, provider callbacks,
persistence, or business ingress. Those are application adapters around the
served node. It can enforce gateway and runtime-peer auth because those are
transport admission concerns.

### Auth Hooks

Auth is optional by default so local examples and tests can run without secrets.
When configured, runtime peers are verified during the WebSocket handshake before
peer registration, and gateway clients are verified during `hello` before any
stream can subscribe, send, or ask.

```ts
const server = await serveActorWebNode(logistics, {
  node: 'server',
  gateway: {
    auth: {
      verifyToken: ({ token }) => token === process.env.ACTOR_WEB_GATEWAY_TOKEN,
    },
  },
  transport: {
    listen: true,
    auth: {
      token: () => process.env.ACTOR_WEB_NODE_TOKEN,
      verifyToken: ({ token }) => token === process.env.ACTOR_WEB_NODE_TOKEN,
    },
  },
});

const client = createActorWebReadModelClient(logistics, {
  gateway: {
    url: server.getGatewayUrl() ?? '',
    auth: {
      token: () => browserSessionToken,
    },
  },
});
```

Auth payloads are intentionally small: `{ scheme, token, metadata }`. Do not put
secrets in metadata. Actor-Web emits auth accept/reject telemetry without echoing
token values; TLS, certificate management, OAuth, and secret rotation remain
deployment/application concerns.

### Runtime Peer Discovery

Discovery is a separate runtime port. It tells topology runners where runtime
peers can be reached; it does not replace `MessageTransport`, gateway sources,
or HTTP ingress.

```ts
const discovery = createInMemoryRuntimePeerDiscoveryProvider();

const server = await serveActorWebNode(logistics, {
  node: 'server',
  transport: true,
  discovery,
});

await startActorWebNode(logistics, {
  node: 'worker',
  discovery,
});
```

`serveActorWebNode(...)` registers its listening transport URL when one exists
and unregisters on stop. Both `serveActorWebNode(...)` and
`startActorWebNode(...)` read discovery snapshots at startup and subscribe to
peer availability changes.

The public provider shape is intentionally small:

```ts
interface RuntimePeerDiscoveryProvider {
  getPeers(): readonly RuntimePeerDiscoveryRecord[] | Promise<readonly RuntimePeerDiscoveryRecord[]>;
  subscribe?(listener: (event: RuntimePeerDiscoveryEvent) => void): () => void;
  registerSelf?(peer: RuntimePeerDiscoveryRecord): void | Promise<void>;
  unregisterSelf?(nodeAddress: string): void | Promise<void>;
}
```

When a deployment system gives you endpoint parts instead of a final URL, use
`createRuntimePeerDiscoveryRecord(...)` to normalize provider-managed host/port
input into the same `RuntimePeerDiscoveryRecord` shape the runtime already
consumes:

```ts
const peer = createRuntimePeerDiscoveryRecord({
  nodeAddress: 'worker-node',
  protocol: 'wss',
  host: 'worker.internal',
  port: 443,
  path: '/runtime',
  metadata: {
    zone: 'use1',
    role: 'worker',
  },
});
```

The helper is provider-neutral and deterministic. It is for endpoint mapping,
not secret distribution. Keep auth secrets in `token` factories and
`verifyToken` callbacks, not in discovery metadata. Secret-like discovery
metadata keys are dropped before they become runtime peer records. Secret-like
query parameter keys are also dropped from both endpoint-part input and raw
`url` input. Raw URLs must use `ws:` or `wss:` and must not include embedded
username/password credentials. The helper does not inspect values for
benign-looking keys, so secrets must stay in auth providers rather than
discovery inputs. The same public boundary is enforced when records are passed
directly to static or in-memory discovery providers.

Use `createStaticRuntimePeerDiscoveryProvider(...)` for static deployment
metadata and generated config. Use `createInMemoryRuntimePeerDiscoveryProvider`
for tests, examples, and local multi-process demos. Production adapters can map
the same port to Kubernetes, service discovery, a config service, or a broker
later without changing actor behavior.

### `serveActorWebHttp(runtime)`

Use the HTTP builder for explicit REST/application ports. HTTP routes are
application adapters around a served node; they are not actor transport and they
do not replace actor messages inside the runtime.

```ts
const http = await serveActorWebHttp(server)
  .for(logistics.actors.shipment)
  .post('/shipments', async (request, response, actorWeb) => {
    const shipmentId = `shipment-${Date.now()}`;

    await actorWeb.actor.send({
      type: 'CREATE_SHIPMENT',
      shipmentId,
      destination: String(request.body.destination),
    });

    return response.accepted({ shipmentId });
  })
  .listen({ host: '127.0.0.1', port: 4100 });
```

### `startActorWebNode(topology, options)`

Starts one topology node in a browser/WebWorker-compatible environment. Use this
only when that worker/process owns actors from the topology.

```ts
const worker = await startActorWebNode(logistics, {
  node: 'worker',
  peers: {
    server: 'ws://127.0.0.1:4102',
  },
  transport: {
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 15000,
  },
  tools: {
    'routing.plan': async (input) => ({
      carrier: 'Northline Express',
      eta: '24h',
      routeNotes: `Route through ${String(input.destination)}`,
    }),
  },
});
```

Browser nodes only open outbound WebSocket connections. They do not listen for
runtime peers.

### `startActorWebLocalRuntime(topology, options?)`

Starts a whole topology, or an explicit subset of nodes, inside one process with
an in-memory transport network. Use it for demos, product proofs, and local
Ignite validation where the app owns runtime startup and teardown.

```ts
const runtime = await startActorWebLocalRuntime(logistics);

const shipmentProjection = runtime.shipment.readModel();
const shipmentCommands = runtime.shipment.commandSource();

await shipmentCommands.send({
  type: 'CREATE_SHIPMENT',
  shipmentId: 'shipment-1001',
});

await runtime.stop();
```

The returned runtime exposes:

- `runtime.actorKey.readModel({ host?, signal? })`
- `runtime.actorKey.commandSource({ host?, signal? })`
- `runtime.actorKey.actor()`
- `runtime.actors.actorKey` for the same helpers without top-level access
- `runtime.nodes` for node handles and focused test flushing
- `runtime.getActor(key)` / `runtime.requireActor(key)`
- `runtime.stop()`

## Gateway

Gateway is the thin-host projection/control channel. It is used by browser UIs,
Ignite Element sources, dashboards, and other clients that need live actor
snapshots or command routing without becoming runtime peers. HTTP/REST ingress
is a separate application adapter built with `serveActorWebHttp(...)`.

Gateway is not runtime transport. Runtime-to-runtime ownership still flows
through `MessageTransport`.

Normal applications do not construct gateway hubs directly. Use:

- `serveActorWebNode(logistics, { gateway: true })` on the runtime owner.
- `createActorWebReadModelClient(logistics, { gateway: { url } })` in the UI/client.
- `createActorWebReadModelSource({ address, contractVersion, gateway })` for generated
  or separate-repo clients.

Scope descriptors:

```ts
{
  kind: 'shipment',
  params: { tenantId: 'tenant-a', shipmentId: 'shipment-1001' }
}
```

For normal topology actors, `kind` defaults to the topology actor key.
`params` exist for advanced routed projections such as tenant, document,
inspection, or shipment-specific scopes.

Example: a fleet app can expose one `vehicleInspections` actor while allowing a
dashboard to subscribe to only one vehicle's projection:

```ts
const inspections = fleet.actors.vehicleInspections.readModel({
  gateway: {
    url: 'wss://fleet.example.com/gateway',
    scope: {
      params: {
        fleetId: host.getAttribute('fleet-id') ?? 'default',
        vehicleId: host.getAttribute('vehicle-id') ?? 'all',
      },
    },
  },
});
```

Use explicit `kind` only when the gateway intentionally exposes a public scope
that is different from the topology actor key, such as a read-model projection
or a compatibility alias for a generated client.

Gateway replay/resync:

- Each gateway stream is ordered by `sequence`.
- Gateway-backed sources detect missing sequence numbers, mark transport status
  as `degraded`, and request `resync` from the first missing sequence.
- The served gateway keeps a bounded replay tail for snapshots, events, and
  transition frames.
- By default that replay tail is in-memory only. `createRuntimeGatewayHub()`
  also accepts an optional `replayStorage` provider that can load/store the
  bounded tail by `replaySessionId` plus an internal scoped storage stream key
  derived from the visible `streamId` and subscription `scope`.
- Authenticated resume uses owner-bound replay session ids as an intentional
  storage-key rotation. The gateway does not dual-read legacy plain
  `lastConnectionId` storage keys because that would weaken the owner binding
  that prevents cross-client replay reuse.
- Replay storage load/store failures stay non-fatal. Use
  `onReplayStorageError` if you need an operator hook for degraded durable
  recovery; those events still report the visible client `streamId`.
- If the requested range is still buffered, the gateway replays those frames.
- If the range is unavailable, the gateway sends a fresh latest snapshot and
  then resumes live status/events.
- Rolling forward to owner-bound replay keys and then rolling back to older
  binaries can lose replay continuity for existing sessions. Preserve continuity
  only by planning a separate replay-storage migration or storage-contract task;
  this gateway API does not provide a compatibility dual-read path.

This is projection recovery, not event sourcing, exactly-once delivery, or
cluster transport. The optional provider only hardens the gateway-owned replay
tail; if the stored range is unavailable, clients still recover to the latest
snapshot.

## Runtime Transport

### `MessageTransport`

`MessageTransport` is the distributed runtime seam:

```ts
interface MessageTransport {
  send(destination: string, message: ActorMessage): Promise<void>;
  subscribe(listener: (event: { source: string; message: ActorMessage }) => void): () => void;
  connect(address: string): Promise<void>;
  disconnect(address: string): Promise<void>;
  getConnectedNodes(): string[];
  isConnected(address: string): boolean;
}
```

## Built-In Runtime Transport

Application code should start runtime peers through topology runners instead of
creating concrete WebSocket adapters directly:

```ts
const server = await serveActorWebNode(logistics, {
  node: 'server',
  transport: true,
});

const worker = await startActorWebNode(logistics, {
  node: 'worker',
  peers: {
    server: server.getTransportUrl() ?? '',
  },
});
```

The direct WebSocket adapters are internal implementation details of those
runners. Public app code should treat `MessageTransport` as the seam and use
runner options for host, port, peers, heartbeat settings, telemetry, and
explicit custom transport injection when needed.

Do not use a runtime transport URL for `createActorWebReadModelClient(...)`,
`createActorWebReadModelSource(...)`, or `createActorWebCommandSource(...)`;
sources connect to the gateway URL. Do not use a
gateway URL for `startActorWebNode(...)` peers; runtime peers connect to
transport URLs.

## MessagePort Transport

`createMessagePortTransport(options)` adapts an existing `MessagePort` into the
`MessageTransport` seam. It is exported from `@actor-core/runtime/browser`.

```ts
const channel = new MessageChannel();
worker.postMessage({ type: 'bind-runtime-port' }, [channel.port2]);

const transport = createMessagePortTransport({
  nodeAddress: 'browser-host',
  peerAddress: 'service-worker-runtime',
  port: channel.port1,
});

await transport.connect();
```

Use this for browser-local topology proofs and embedded runtime edges such as
page-to-worker, iframe-to-host, or page-to-service-worker links. The app shell
owns creating and transferring the port.

## Runtime Transport Contract

The runtime transport contract exports:

- `RuntimeNodeIdentity`
- `RuntimeTransportFrame`
- `RuntimeTransportAckFrame`
- `RuntimeTransportHandshake`
- `RuntimeTransportHeartbeatFrame`
- `createRuntimeTransportMessageId(...)`
- `RUNTIME_TRANSPORT_PROTOCOL_VERSION`
- validation helpers for identity, handshake, runtime frames, ack frames, and
  heartbeat frames

Runtime transport frames include a `messageId`. Node and browser WebSocket
transports keep a bounded per-peer idempotency cache and drop duplicate frame IDs
before runtime subscriber delivery.

When a transport is configured with `idempotencyProvider`, the transport also
issues an atomic claim keyed by the stable local/peer node identity context plus
the frame `messageId`. This is opt-in and additive:

- default in-memory duplicate suppression remains unchanged;
- provider-backed duplicate detection can survive runtime restarts;
- provider duplicates are acked and dropped;
- provider claim failures are surfaced through stats/telemetry and the frame is
  not treated as accepted.

Node and browser WebSocket transports also exchange `runtime.transport.ack`
frames for valid runtime frames. Bounded retry is limited to internal
`__runtime.*` control traffic. User actor `send` still remains at-most-once by
default.

Both WebSocket transports keep a bounded per-peer outbound queue. The default
limit is `1024` queued data frames. When the queue is full, `send(...)` rejects
and the transport emits backpressure telemetry instead of buffering without a
limit. Ack and heartbeat control frames stay minimal and direct.

Handshake rejection covers:

- missing node identity
- same-node connections
- incompatible protocol versions
- malformed frame envelopes

## Telemetry And Stats

Runtime-native telemetry is available without adding OpenTelemetry:

- `RuntimeTransportTelemetryEvent`
- `RuntimeTransportStats`
- `RuntimeTransportPeerStats`
- `RuntimeTransportTelemetryObserver`
- `createRuntimeTransportTelemetryExporter(...)`
- `createInMemoryRuntimeTransportTelemetrySink(...)`

Telemetry/stats cover connection state, handshake accept/reject, malformed
frames, reconnect/disconnect count, heartbeat timeout, frame send/receive count,
ack received count, retry count, retry exhaustion, duplicate drops, idempotency
cache evictions, idempotency provider claim/duplicate/error counters, outbound
queue depth, backpressure drops, validation drops, sequence gaps, and last-seen
timestamps.

`getRuntimeTransportStatus(...)` and `getRuntimePeerStatus(...)` also expose an
additive `idempotency` view with:

- cache window size,
- provider enabled/disabled state,
- provider claim, duplicate, and error counters,
- last provider error timestamp/message when applicable.

Use the exporter when transport events need to outlive an individual transport
instance:

```ts
import {
  createRuntimeTransportTelemetryExporter,
  createRuntimeTransportTelemetryJsonlFileSink,
  serveActorWebNode,
} from '@actor-core/runtime/node';

const telemetry = createRuntimeTransportTelemetryExporter({
  sink: createRuntimeTransportTelemetryJsonlFileSink('./runtime-telemetry.jsonl'),
});

const server = await serveActorWebNode(logistics, {
  node: 'server',
  transport: {
    listen: true,
    telemetry: telemetry.observe,
  },
  gateway: true,
});

// During shutdown:
await server.stop();
await telemetry.close();
```

The JSONL sink is Node-only. Browser and shared runtime code can use the
in-memory sink or provide a custom sink that forwards events to the host
application.

For deployment, rollback, secret rotation, stale-peer, replay-recovery,
duplicate-drop, and backpressure incident procedures for the current direct
WebSocket transport path, see
[operations/actor-web-production-operations.md](operations/actor-web-production-operations.md).

## Package Boundaries

- `@actor-core/runtime`: universal actor behavior, actor system,
  `MessageTransport`, runtime contracts, telemetry types, and low-level shared
  types.
- `@actor-core/runtime/topology`: browser-safe topology descriptor helpers.
- `@actor-core/runtime/browser`: browser-safe Actor-Web client/source,
  MessagePort transport, and browser worker runtime hosting.
- `@actor-core/runtime/node`: Node/server topology runner and HTTP ingress
  adapter.

Node-only APIs are not exported from the browser entrypoint.
