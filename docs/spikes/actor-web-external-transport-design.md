# Actor-Web External Transport Design

## Status

Active roadmap/status doc. Tracks the Actor-Web runtime transport and gateway
state, the remaining work for true multi-machine deployment, and the recommended
external transport direction.

Current closeout status: the runtime gateway and Ignite bridge are a documented
projection/gateway slice. They prove the host-facing API shape, service-worker
topology, and shared-contract projection mapping. They do not complete
production distributed transport.

## Why This Doc Exists

Actor-Web now has:

- a runtime-owned transport seam at
  `packages/actor-core-runtime/src/actor-system.ts`
- an internal runtime control plane at
  `packages/actor-core-runtime/src/runtime-transport-protocol.ts`
- transport-backed remote projection support in
  `packages/actor-core-runtime/src/actor-system-impl.ts`
- shared-contract mapping in
  `packages/actor-core-runtime/src/integration/fas-shared-contracts.ts`
- a browser prove-out where the runtime is owned by a service worker and the
  page is the thin host
- a gateway projection API at
  `packages/actor-core-runtime/src/runtime-gateway.ts`

That is enough to prove the API and topology shape, but not enough for
deployment across multiple machines. This doc records how to move from the
current prove-out transport to a real cluster transport without breaking the
hexagonal boundary or the actor model.

## Current State

### Done in the current prove-out slice

- `MessageTransport` is a small runtime port:
  - `send(destination, message)`
  - `subscribe(listener)`
  - `connect(address)`
  - `disconnect(address)`
  - `getConnectedNodes()`
  - `isConnected(address)`
- `__runtime.*` control messages already cover:
  - directory register/unregister/sync
  - remote send
  - remote ask request/response
  - remote snapshot fetch/subscribe/update
  - remote event subscribe/update
  - remote stop/stats
- remote projections already support:
  - `connected`, `replaying`, `degraded`, `disconnected`
  - monotonic per-actor projection sequence tracking
  - reconnect and latest-snapshot resync
- runtime gateway exports now cover:
  - `createRuntimeGatewayHub`
  - `createRuntimeGatewaySource`
  - client and server gateway frame types
  - command-capable `send`/`ask` host frames with `ack`/`reply`
  - scope descriptors and scope resolver contract
  - gateway error codes
  - stream sequencing, status, and resync behavior
- the Ignite headless example now has a server-owned runtime gateway path:
  - a Node logistics runtime owns the shipment actor
  - a browser/Ignite host consumes snapshots, events, status, and commands over
    a gateway WebSocket
  - service-worker and in-memory modes remain topology proofs/fallbacks
- runtime transport contract exports now cover:
  - `RuntimeNodeIdentity`
  - `RuntimeTransportFrame`
  - `RuntimeTransportHandshake`
  - `RUNTIME_TRANSPORT_PROTOCOL_VERSION`
  - identity, handshake, and frame validation helpers
- Node WebSocket transport prove-out now covers:
  - `NodeWebSocketMessageTransport`
  - localhost listener lifecycle
  - static peer URL resolution
  - handshake-backed connect/disconnect
  - runtime frame send/receive over real WebSocket sockets
  - two-runtime directory sync, remote send/ask, and Ignite projection tests
- runtime membership hardening now covers:
  - peer lifecycle states: `connecting`, `connected`, `disconnecting`,
    `disconnected`, and `rejected`
  - stable `nodeId` plus `incarnation` peer replacement
  - identity-conflict rejection for reused `nodeAddress` with a different
    `nodeId`
  - transport-level heartbeat timeout and disconnect emission
  - stale socket frame suppression after peer replacement
- browser/WebWorker runtime transport now covers:
  - `BrowserWebSocketMessageTransport` exported from
    `@actor-core/runtime/browser`
  - outbound-only browser WebSocket peer connections
  - reuse of the runtime handshake and frame envelope contract
  - app-level `runtime.transport.ping` and `runtime.transport.pong` heartbeat
    frames for browser sockets
  - Node transport interop for browser-style heartbeat frames
  - runtime-level directory sync, remote send/ask, and projection tests with a
    browser-style worker peer
- the Ignite headless example now has a logistics control tower demo mode:
  - the Node server exposes a browser-facing runtime gateway and a runtime
    WebSocket transport listener
  - the Node server also exposes REST ingress for shipment commands and queries
  - the server runtime owns
    `actor://logistics-server-runtime/actor/logistics-shipment`
  - the browser/WebWorker runtime owns
    `actor://logistics-worker-runtime/actor/logistics-routing`
  - gateway sources can project and command both actors while the runtimes
    communicate over Actor-Web transport
  - REST-created shipments stream live gateway updates to subscribed browser
    hosts
- runtime transport observability now covers:
  - public runtime-native telemetry event and stats types
  - optional telemetry observer callbacks on Node and browser WebSocket
    transports
  - `getStats()` and `getPeerStats(nodeAddress)` snapshots
  - runtime-native telemetry exporters and sinks
  - Node JSONL file sink for durable local telemetry evidence
  - connection, handshake, frame send/receive/drop, heartbeat timeout, and
    sequence-gap counters
- Actor-Web already maps its data plane toward FAS shared contracts:
  - `EventEnvelope`
  - `WorkflowSnapshot`
  - `WorkflowTransitionRecord`
- the Ignite/browser example demonstrates a service-worker-owned runtime with a
  page-owned thin host consuming snapshots and emitted events

### Remaining before production distributed transport

- the distributed actor directory is still an in-memory replicated cache
- stable node identity and incarnation are enforced at the WebSocket transport
  edge; topology runners now accept a discovery provider, but there is not yet a
  durable membership store
- auth is static token/provider hooks; TLS, certificate management, OAuth/OIDC,
  and per-frame signing remain deployment/application concerns
- actor `send` remains at-most-once by default; internal runtime control traffic
  has bounded ack/retry support
- gateway projection replay is bounded and in-memory: clients can recover from
  sequence gaps when the range is still buffered, otherwise they fall back to the
  latest snapshot
- `NodeWebSocketMessageTransport` has basic lifecycle and stale-peer handling,
  but is not a fully hardened production transport
- `BrowserWebSocketMessageTransport` is outbound-only; browser-safe topology
  runners can consume discovery providers, but browser nodes still cannot listen
  for inbound peers
- transport telemetry has dependency-free exporter/sink primitives and a Node
  JSONL sink; it is not yet OpenTelemetry integration or a metrics backend

## Architectural Constraints

### Hexagonal Architecture

Actor-Web should keep the same dependency direction:

- deterministic actor behavior does not import transport clients
- runtime execution owns transport adapters
- projection mapping stays deterministic
- host adapters stay outside Actor-Web core runtime

This means:

- `MessageTransport` remains the only distributed transport port
- concrete transports live in the runtime/execution layer
- Ignite and other hosts consume `IgniteActorSource`; they do not become cluster
  members

### Actor Model Principles

The external transport must preserve:

- location transparency at the `ActorRef` level
- single owner of an actor instance at a time
- ordered projection stream per actor
- explicit failure semantics for `send`, `ask`, and subscriptions
- bounded buffering and backpressure instead of unbounded queues

### Behavior Boundaries

Transport code belongs in imperative/runtime boundaries, not in deterministic
behavior surfaces.

That means:

- behavior handlers and machine logic remain transport-agnostic
- transport serialization, retries, auth, heartbeats, and reconnection stay in
  runtime adapters
- shared-contract mapping remains a deterministic mapper, even when the wire
  payloads are promoted to canonical shared-contract shapes

## Remaining Actor-Web Work

1. Production discovery adapters backed by deployment infrastructure
2. Production delivery semantics beyond at-most-once actor `send`
3. Durable replay providers for projections and events
4. Shared-contract promotion from mapper to real data-plane wire shape
5. Durable telemetry export, tracing, lag, replay, and backpressure
   observability
6. Multi-process and multi-machine prove-out beyond localhost

## External Transport Options

### Option A: Direct WebSocket peer mesh

Each Actor-Web node maintains direct connections to peer nodes and exchanges
`__runtime.*` frames over a bidirectional socket.

#### Pros

- maps cleanly to the current `MessageTransport` shape
- preserves ordered delivery per connection
- easy request/response fit for `ask`
- easy subscription streaming fit for snapshots/events
- simplest first production slice
- easy browser-facing gateway story later because browser and node transports can
  share framing concepts

#### Cons

- node discovery and membership become our responsibility
- full mesh gets expensive as node count grows
- reconnect storms and peer churn are our problem
- no broker-managed buffering or replay

#### Fit

Best fit for the first real external transport because it matches the current
runtime port and keeps actor ownership and delivery semantics explicit.

### Option B: Broker-backed transport with NATS

Each node publishes runtime frames to broker subjects and consumes frames for its
own node identity. Request/reply and fan-out go through the broker.

#### Pros

- better operational story for multi-machine deployment
- simpler node discovery bootstrap
- good basis for horizontal scaling
- request/reply and topic routing are already broker-native
- can reduce connection-mesh complexity

#### Cons

- weaker fit to the current direct-connect `MessageTransport` mental model
- ordering guarantees depend on subject design and subscriber topology
- broker dependency becomes mandatory infrastructure
- can hide actor-topology failure modes behind broker abstractions too early
- additional care needed for bounded replay, duplicate delivery, and subject
  design

#### Fit

Strong second-stage transport once the runtime wire protocol and delivery
semantics are hardened. Not the best first implementation while the runtime
still needs clearer node-identity and failure semantics.

### Option C: Redis Pub/Sub or Streams

Nodes exchange runtime frames via Redis channels or stream groups.

#### Pros

- common infrastructure
- simple bootstrap in some deployments
- Redis Streams can help with replay-like mechanics

#### Cons

- Pub/Sub is too weak for reliable runtime control traffic
- Streams introduce consumer-group semantics that do not map cleanly to
  point-to-point actor node ownership
- request/response and subscription fan-out become awkward
- weaker long-term fit than NATS for a runtime message plane

#### Fit

Not recommended as the primary long-term transport.

### Option D: gRPC bidirectional streams

Nodes establish long-lived RPC streams and exchange runtime frames through typed
service calls.

#### Pros

- strong schema discipline
- bidirectional streaming fits projection subscriptions
- explicit request/response semantics
- solid tooling for service-to-service deployment

#### Cons

- more ceremony around multiplexing runtime frame types
- browser compatibility is worse than WebSocket for host/gateway scenarios
- still requires separate discovery/membership design
- current `MessageTransport` shape is framed more like message delivery than RPC

#### Fit

Viable for a service-only deployment, but less natural than a message-oriented
socket transport for the current Actor-Web runtime.

## Recommended Direction

### Recommendation

Use a **direct WebSocket inter-node transport as the first real external
transport**, then add a **broker-backed transport adapter later** if deployment
scale justifies it.

This matches the architecture best right now because:

- it preserves the current hexagonal seam instead of forcing a new transport
  model
- it keeps actor-topology semantics explicit
- it preserves ordered per-connection delivery for projection streams
- it lets Actor-Web harden delivery, reconnect, and resync logic before adding
  broker complexity

### Production topology target

The production-oriented topology should be:

```text
Browser / Ignite host
  -> gateway transport
  -> Actor-Web runtime node(s)

Actor-Web runtime node A <-> Actor-Web runtime node B <-> Actor-Web runtime node C
```

Important boundary:

- browsers are thin hosts and consumers
- server/worker nodes own actor runtime, transport, supervision, and recovery
- service workers remain a prove-out pattern, not the canonical cluster model
- the runtime gateway is a host projection/control channel, not the
  runtime-to-runtime `MessageTransport` seam

### Why not make browsers cluster peers

- browser/service-worker lifecycle is unstable
- auth and secret management are weaker
- long-lived peer membership is fragile
- actor ownership and recovery belong on server/worker runtime nodes

## Recommended Runtime Design

### 1. Node identity

Introduce a stable runtime node identity model:

- `nodeAddress`: logical address used in actor paths
- `nodeId`: stable unique runtime identity
- `incarnation`: restart epoch/version for stale-peer detection
- `protocolVersion`: handshake compatibility

Directory state, subscriptions, and replay state should be keyed by
`nodeId + incarnation`, not only by string address.

### 2. Handshake

Every inter-node connection should start with a runtime handshake:

- node identity
- incarnation
- protocol version
- capabilities
- auth material or peer identity proof

No runtime frames should be accepted before handshake success.

### 3. Membership and discovery

First production slice:

- static seed peers
- explicit `connect(address)`
- heartbeat and disconnect detection
- directory sync after handshake

Later slice:

- pluggable membership/discovery provider
- cloud/container friendly peer discovery

Status: complete for the provider interface and runner integration.
`serveActorWebNode(...)` can register a listening transport URL, and both
`serveActorWebNode(...)` and `startActorWebNode(...)` can seed and subscribe to
discovered peer records. Remaining work is production adapters backed by real
deployment infrastructure and durable membership state.

### 4. Delivery semantics

The runtime should define these explicitly:

- `send`: at-most-once initially unless message IDs and idempotency are promoted
- `ask`: request/response with correlation, timeout, and clear remote failure
  mapping
- projection streams: ordered per actor, gap detection, replay-to-latest-snapshot,
  degrade on unrecoverable gap

Do not imply stronger guarantees than the runtime can enforce.

### 5. Projection replay

Near-term:

- gateway-owned bounded replay buffer for ordered snapshots, events, and
  transitions
- source-side sequence gap detection and resync request from the first missing
  sequence
- latest-snapshot fallback when the requested replay range is unavailable

Later:

- durable latest snapshot per actor owner that survives owner restart
- optional durable historical event replay where product/runtime needs justify it

### 6. Shared-contract promotion

Control plane should remain internal Actor-Web protocol:

- `__runtime.*`

Data plane should move to canonical shared-contract wire payloads:

- `EventEnvelope`
- `WorkflowSnapshot`
- `WorkflowTransitionRecord`

The current mapper in `fas-shared-contracts.ts` should become the canonical
normalization path for wire payload creation, not just a local bridge helper.

### 7. Auth and security

Minimum production requirement:

- mutually authenticated node peers or signed node tokens
- transport encryption
- node authorization at handshake time
- reject unauthenticated runtime control frames

### 8. Observability and backpressure

Minimum transport telemetry:

- connection state
- handshake failures
- reconnect count
- replay count and replay duration
- sequence gap count
- per-node outbound queue depth
- dropped subscriber count
- ask timeout/failure count

Backpressure rules:

- bounded outbound queues
- bounded per-subscription buffers
- degrade and resync instead of unbounded buffering

## Implementation Phases

### Phase 1: Runtime handshake and wire contract

- define `RuntimeNodeIdentity`, protocol version, handshake frames, and runtime
  frame envelopes
- validate missing identity, self-connections, incompatible protocol versions,
  and malformed frame envelopes
- prove the contract through the in-memory transport harness

### Phase 2: Real external transport prove-out

- implement `NodeWebSocketMessageTransport`
- run two Actor-Web runtimes in separate processes
- keep existing `MessageTransport` port intact
- support handshake, direct send, ask, and projection streams

Status: complete for localhost/static-peer prove-out. Later slices added
auth/security, telemetry, idempotency, ack/retry control traffic, bounded
backpressure, bounded gateway replay, and runtime peer discovery provider
integration. Remaining production work is deployment-backed discovery adapters,
durable replay storage, durable observability export, and multi-machine
prove-out.

### Phase 3: Identity and membership hardening

- persist and compare `nodeId`, `incarnation`, and protocol version across real
  peer lifecycles
- add heartbeat and stale-peer rejection
- move directory sync to handshake/bootstrap lifecycle

Status: complete for basic membership hardening and pluggable discovery provider
wiring. Remaining production work is a deployment-backed discovery adapter,
durable membership state, durable replay storage, durable observability export,
and multi-machine prove-out.

### Phase 3.5: Runtime transport observability foundation

- add runtime-native telemetry events and stats snapshots to Node and browser
  WebSocket transports
- track handshakes, peer lifecycle, frame send/receive/drop, heartbeat timeout,
  and sequence-gap counters
- keep observability dependency-free; expose durable JSONL export before adding
  OpenTelemetry or metrics backend adapters

Status: complete for runtime-native telemetry/stats snapshots, auth/security,
message ID based duplicate suppression, and bounded retry/ack handling for
internal runtime control traffic. Bounded per-peer outbound queues now apply
backpressure by rejecting sends when the queue is full. Runtime telemetry now has
exporter/sink primitives plus a Node JSONL file sink. Remaining production work
is durable replay storage, deployment-backed discovery, OpenTelemetry/metrics
adapters, and multi-machine prove-out.

### Phase 4: Projection hardening

- bounded in-memory gateway replay for projection stream gaps
- source-side gap detection and `resync` requests
- latest-snapshot fallback when the replay range is unavailable

Status: complete for bounded gateway replay and latest-snapshot fallback.
Remaining production work is durable latest snapshot/event replay providers that
survive owner restart or process loss.

### Phase 5: Shared-contract wire promotion

- use shared-contract payloads as the remote projection wire shape
- prove FAS and Ignite consume the resulting projections unchanged

### Phase 6: Broker adapter

- add a NATS transport adapter only after the direct transport semantics are
  stable
- keep it behind the same `MessageTransport` port

## Decision Summary

Current decisions tracked in this doc:

1. Keep `MessageTransport` as the only distributed transport seam.
2. Keep runtime control traffic internal under `__runtime.*`.
3. Keep browser hosts out of the cluster core; browsers consume runtime sources.
4. Treat the service-worker runtime example as a topology prove-out, not the
   production deployment model.
5. Build a direct WebSocket inter-node transport first.
6. Promote shared-contract shapes on the data plane after the external transport
   semantics are stable.
7. Add broker-backed transport only after the direct transport path is hardened.

## Open Questions

1. Do we want `send` to remain at-most-once, or do we want to promote message
   IDs and idempotency early?
2. Where should durable latest snapshots live for owner restart and replay:
   owner-local persistence, replicated runtime state, or external store?
3. Should membership remain runtime-owned, or should it plug into external
   infrastructure discovery from the start?
4. Do we want a separate gateway transport contract for browser hosts, or should
   browser hosts consume the same remote projection framing over a narrower edge
   protocol?
