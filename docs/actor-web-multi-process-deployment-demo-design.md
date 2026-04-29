# Actor-Web Multi-Process Deployment Demo Design

## Summary

After the topology/source DX prototype is complete, the logistics example should
grow into a multi-process and containerized deployment prove-out. The goal is to
show that Actor-Web can run actors from different runtime locations without
shared memory: server runtime, worker runtime, provider/runtime integration, and
browser Ignite host all communicate through explicit Actor-Web boundaries.

This is a follow-on to `actor-web-topology-source-dx-design.md`. The topology
API should come first; this design proves that the topology can be deployed as
separate processes and, later, separate containers.

## Goals

- Prove Actor-Web runtimes communicate across process boundaries, not only
  same-process localhost tests.
- Demonstrate server-owned, worker-owned, and provider/external actors running
  as distinct deployable units.
- Keep Ignite Element as a thin projection host consuming gateway sources.
- Show topology, supervision, transport status, and runtime health in the demo
  UI.
- Create a practical path toward fleet inspections, PWA dashboards, and FAS
  agent runtime deployments.

## Non-Goals

- Do not start this before the topology/source API prototype is complete.
- Do not treat the container demo as production-ready until auth, delivery,
  replay, backpressure, and discovery are hardened.
- Do not make browser hosts implicit cluster members.
- Do not replace the current simple `pnpm examples:logistics` developer path.

## Stage 1: Multi-Process Localhost

Start by splitting the logistics demo into independent local processes. The
first implemented slice proves the runtime boundary with separate server and
worker processes:

```text
process 1: logistics server runtime
process 2: logistics worker runtime
process 3: Vite browser host
```

Implemented scripts:

```sh
pnpm examples:logistics:server
pnpm examples:logistics:worker
```

The existing `pnpm examples:logistics` command remains the single-command
developer path. It starts the server runtime and browser host together, while
the browser WebWorker connects as the worker runtime. The split process scripts
are lower-level deployment proof entrypoints.

Expected behavior:

- Server runtime owns `logistics-shipment`.
- Worker runtime owns `logistics-routing`.
- Provider HQ remains a server-owned actor controlled through REST or gateway
  commands in this slice.
- Browser host consumes shipment projections through the gateway WebSocket.
- Server and worker communicate over Actor-Web runtime WebSocket transport.
- The worker process uses static runtime peer discovery from
  `ACTOR_WEB_SERVER_TRANSPORT_URL` to connect to the server transport listener.
- Restarting the worker process is a follow-up once deployment supervision and
  operational status panels are added.

Manual run shape:

```sh
pnpm examples:logistics:server
```

Copy the `transportUrl` from the `LOGISTICS_SERVER_READY` line, then run:

```sh
ACTOR_WEB_SERVER_TRANSPORT_URL=<transportUrl> pnpm examples:logistics:worker
```

Create a shipment through the server REST URL and the server runtime will ask
the worker-owned routing actor over WebSocket transport.

## Stage 2: Docker Compose

After multi-process localhost works, add a container topology:

```text
container 1: logistics-server-runtime
container 2: logistics-worker-runtime
container 3: provider-hq
container 4: logistics-web
```

Example shape:

```yaml
services:
  server-runtime:
    build: .
    command: pnpm examples:logistics:server
    ports:
      - "4100:4100"
      - "4101:4101"

  worker-runtime:
    build: .
    command: pnpm examples:logistics:worker
    environment:
      ACTOR_WEB_TRANSPORT_URL: ws://server-runtime:4101/runtime

  provider-hq:
    build: .
    command: pnpm examples:logistics:provider
    environment:
      ACTOR_WEB_REST_URL: http://server-runtime:4100

  web:
    build: .
    command: pnpm examples:logistics:web
    ports:
      - "4173:4173"
    environment:
      VITE_ACTOR_WEB_GATEWAY_URL: ws://localhost:4100/gateway
      VITE_ACTOR_WEB_REST_URL: http://localhost:4100
```

The compose file should be treated as a demo deployment artifact, not a
production reference architecture.

## Stage 3: Multi-Machine Prove-Out

Once transport hardening is complete, document and test a topology where
runtime nodes can run on different machines:

```text
machine A: logistics server runtime
machine B: logistics worker runtime
machine C: provider integration/runtime
machine D: browser/PWA clients
```

This stage should prove:

- runtime peer authentication,
- reconnection and membership behavior,
- idempotent frame handling,
- ack/retry behavior where enabled,
- bounded queues and slow-consumer handling,
- projection replay/resync after disconnect,
- operational telemetry and traceability.

## UI Enhancements

The logistics control tower should expose the deployment topology clearly:

- Runtime topology panel with process/container labels.
- Node identity, incarnation, peer state, and heartbeat status.
- Supervisor group panel with strategy and restart budget metadata.
- Transport metrics panel with frames sent/received, drops, reconnects, and
  sequence gaps.
- Replay/resync panel once durable replay exists.
- Provider HQ status showing whether signals come from manual UI, simulator
  process, or provider container.

The UI should remain an Ignite Element projection host. It should not own actor
state or transport implementation details.

## Verification Plan

Stage 1 tests:

- Start server and worker as separate local processes.
- Create shipment through REST.
- Verify server asks worker-owned routing actor over real WebSocket transport.
- Verify `/runtime/status` exposes worker transport connectivity.
- Browser-host gateway observation remains covered by the existing logistics
  example tests.
- Stop/restart recovery remains a follow-up once deployment supervision and
  operational status panels are added.

Stage 2 tests:

- Start Docker Compose topology.
- Verify browser host can create shipments through published REST/gateway URLs.
- Verify worker container connects to server container by service DNS.
- Verify provider container can update shipment lifecycle.

Stage 3 tests:

- Verify authenticated peer joins and rejected unauthenticated joins.
- Verify reconnect/resync after browser disconnect.
- Verify duplicate frames are dropped once idempotency exists.
- Verify slow consumer/backpressure telemetry once queue limits exist.

## Relationship To Transport Hardening

This demo should be implemented after these hardening slices are available or
clearly in progress:

- topology/source API prototype,
- gateway/runtime auth,
- message IDs and idempotency,
- ack/retry semantics,
- bounded queues/backpressure,
- durable replay/resync,
- membership/discovery,
- telemetry export or operational metrics.

Before those slices, the multi-process demo can prove deployment shape, but not
production transport readiness.

## Assumptions

- The logistics demo remains the flagship Actor-Web integration example.
- `pnpm examples:logistics` remains the simplest local demo command.
- Multi-process and Docker Compose commands are additive.
- Direct WebSocket transport remains the first production topology.
- Broker-backed transport remains a later option after direct transport
  semantics are hardened.
