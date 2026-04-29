# Actor-Web Runtime API

Actor-Web provides actor runtimes, topology descriptors, browser/client sources,
gateway projections, and runtime-to-runtime transports. The public API favors
typed messages, topology-owned actors, and hexagonal boundaries.

Read this guide in layers:

1. Define actor behavior with `defineActor(...)`.
2. Declare runtime ownership with `defineActorWebTopology(...)`.
3. Start actor-owning locations with `serveActorWebNode(...)` or
   `startActorWebNode(...)`.
4. Connect thin UIs and dashboards with `createActorWebClient(...)` or
   `createActorWebSource(...)`.
5. Add application ingress with `serveActorWebHttp(...)`.

Current guarantees:

- Actor behavior handlers return `{ context, reply, emit }`.
- Runtime-to-runtime transport uses the `MessageTransport` seam.
- Gateway is a client projection/control channel, not cluster transport.
- Built-in runtime transport is direct-peer and at-most-once.
- Runtime peers and gateway clients can be authenticated before stream/peer
  admission.
- Gateway streams detect sequence gaps and resync from a bounded in-memory replay
  buffer, falling back to a latest snapshot when the requested range is no
  longer available.
- Topology runners can use a runtime peer discovery provider instead of only
  static `peers` maps.
- Durable replay storage and exported observability remain follow-up hardening
  slices.

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
| Browser UI / Ignite host | No ActorSystem by default | `createActorWebClient(...)` |
| Browser/WebWorker runtime location | Yes | `startActorWebNode(...)` |
| Browser-local worker or service-worker edge | Optional | `createMessagePortTransport(...)` passed to `startActorWebNode(...)` |
| Separate frontend/backend repos | Usually client-only | `createActorWebSource({ address, contractVersion, gateway })` |

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
import { createActorWebClient, createActorWebSource, startActorWebNode } from '@actor-core/runtime/browser';

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
the runtime's restart guardrails, while topology-specific group strategies such
as `one-for-all` and `rest-for-one` remain declared metadata until the
supervision enforcement slice is completed.

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
const scanShipmentBehavior = defineActor()
  .withContext({ status: 'idle', latestScan: null })
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
implements those tool ports at the process boundary.

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
const client = createActorWebClient(logistics, {
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

Use `createActorWebClient(...)` as the default UI/client entrypoint when a
shared topology is available. It binds gateway configuration once and exposes
each actor as a source.

```ts
const client = createActorWebClient(logistics, {
  gateway: { url: 'ws://127.0.0.1:4100' },
  clientVersion: 'logistics-ui',
});

const shipmentSource = client.actors.shipment;
await shipmentSource.send({
  type: 'CREATE_SHIPMENT',
  shipmentId: 'shipment-1001',
  destination: 'Chicago warehouse',
});
```

An Actor-Web source provides:

- `snapshot()`
- `subscribe(listener)`
- `subscribeEvent(listener, options?)`
- `transportStatus()`
- `subscribeTransportStatus(listener)`
- `send(message)`
- `ask(message, timeout?)`
- `close()`

### `createActorWebSource(...)`

Use `createActorWebSource` for explicit or generated-client paths. Prefer the
single-object shape. This creates a gateway-backed source for a client; it does
not start an Actor-Web runtime node.

```ts
const shipmentSource = createActorWebSource({
  actor: logistics.actors.shipment,
  gateway: { url: 'ws://127.0.0.1:4100' },
});
```

The topology descriptor convenience is equivalent and useful when the topology
is already in scope:

```ts
const shipmentSource = logistics.actors.shipment.source({
  gateway: { url: 'ws://127.0.0.1:4100' },
});
```

Separate repos can use address metadata instead of the shared TypeScript
topology:

```ts
const shipmentSource = createActorWebSource({
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

### `createActorWebClient(topology, options)`

This is the normal browser/UI entrypoint when the UI does not own an
ActorSystem. Use direct `createActorWebSource(...)` only when you need one
source without constructing a full topology client, or when a generated client
only has address metadata.

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

const client = createActorWebClient(logistics, {
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
    server: 'ws://127.0.0.1:4101',
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

## Gateway

Gateway is the thin-host projection/control channel. It is used by browser UIs,
Ignite Element sources, dashboards, and other clients that need live actor
snapshots or command routing without becoming runtime peers. HTTP/REST ingress
is a separate application adapter built with `serveActorWebHttp(...)`.

Gateway is not runtime transport. Runtime-to-runtime ownership still flows
through `MessageTransport`.

Normal applications do not construct gateway hubs directly. Use:

- `serveActorWebNode(logistics, { gateway: true })` on the runtime owner.
- `createActorWebClient(logistics, { gateway: { url } })` in the UI/client.
- `createActorWebSource({ address, contractVersion, gateway })` for generated
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
const inspections = fleet.actors.vehicleInspections.source({
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
- The served gateway keeps a bounded in-memory replay buffer for snapshots,
  events, and transition frames.
- If the requested range is still buffered, the gateway replays those frames.
- If the range is unavailable, the gateway sends a fresh latest snapshot and
  then resumes live status/events.

This is projection recovery, not durable event storage. If a process restarts or
the replay buffer has rolled past the missing range, clients recover to the
latest snapshot.

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

Do not use a runtime transport URL for `createActorWebClient(...)` or
`createActorWebSource(...)`; sources connect to the gateway URL. Do not use a
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

Telemetry/stats cover connection state, handshake accept/reject, malformed
frames, reconnect/disconnect count, heartbeat timeout, frame send/receive count,
ack received count, retry count, retry exhaustion, duplicate drops, idempotency
cache evictions, outbound queue depth, backpressure drops, validation drops,
sequence gaps, and last-seen timestamps.

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
