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
- Local split-process defaults are deterministic:
  - REST: `http://127.0.0.1:4100`
  - gateway: `ws://127.0.0.1:4101`
  - transport: `ws://127.0.0.1:4102`
- Restarting the worker process is a follow-up once deployment supervision and
  operational status panels are added.

Manual run shape:

```sh
pnpm examples:logistics:server
```

In another terminal, run:

```sh
pnpm examples:logistics:worker
```

The worker defaults to `ws://127.0.0.1:4102`. Override
`ACTOR_WEB_SERVER_TRANSPORT_URL` when the server transport listens somewhere
else.

Create a shipment through the server REST URL and the server runtime will ask
the worker-owned routing actor over WebSocket transport.

## Stage 2: Docker Compose

The Docker Compose prove-out packages the same topology into separate container
roles:

```text
container 1: logistics-server-runtime
container 2: logistics-worker-runtime
container 3: logistics-web
```

Implemented command:

```sh
pnpm examples:logistics:docker:verify
```

Manual run shape:

```sh
docker compose -f docker-compose.logistics.yml up --build
```

Then open:

```text
http://127.0.0.1:4173/ignite-headless-host/
```

The compose topology uses two kinds of URLs:

- Docker-internal runtime transport URL:
  `ws://server-runtime:4102`
- Browser-facing URLs published on the host:
  - REST: `http://127.0.0.1:4100`
  - gateway: `ws://127.0.0.1:4101`
  - browser worker transport: `ws://127.0.0.1:4102`

Current compose shape:

```yaml
services:
  server-runtime:
    build: docker/logistics/Dockerfile
    command: pnpm examples:logistics:server
    environment:
      ACTOR_WEB_HOST: 0.0.0.0
      ACTOR_WEB_TELEMETRY_JSONL: /workspace/actor-web/.actor-web/telemetry/server-transport.jsonl
    ports:
      - "4100:4100"
      - "4101:4101"
      - "4102:4102"

  worker-runtime:
    build: docker/logistics/Dockerfile
    command: pnpm examples:logistics:worker
    environment:
      ACTOR_WEB_SERVER_TRANSPORT_URL: ws://server-runtime:4102
      ACTOR_WEB_TELEMETRY_JSONL: /workspace/actor-web/.actor-web/telemetry/worker-transport.jsonl

  web:
    build: docker/logistics/Dockerfile
    command: pnpm examples:logistics:web
    ports:
      - "4173:4173"
    environment:
      VITE_ACTOR_WEB_GATEWAY_URL: ws://localhost:4100/gateway
      VITE_ACTOR_WEB_REST_URL: http://localhost:4100
```

The compose file should be treated as a demo deployment artifact, not a
production reference architecture. Provider HQ remains server-owned in this
slice; a separate provider runtime/container is still a follow-up.

Troubleshooting:

- If the worker is not connected, check
  `curl http://127.0.0.1:4100/runtime/status` and confirm
  `transport.workerConnected` is `true` and `transport.workerPeer.fresh` is
  `true`.
- If `transport.workerConnected` is `false`, inspect
  `transport.workerPeer.state`, `transport.workerPeer.disconnectedAt`, and
  `transport.workerPeer.staleReason`. These values come from Actor-Web runtime
  status derivation, not from logistics-local freshness rules.
- If the browser cannot connect, remember that `server-runtime` is Docker DNS
  and is not reachable from the host browser. Browser env vars should use
  `127.0.0.1` published ports.
- If telemetry is missing, check `.actor-web/telemetry/server-transport.jsonl`
  and `.actor-web/telemetry/worker-transport.jsonl` after the services stop.
- The smoke verification stops and restarts `worker-runtime`, then confirms
  `/runtime/status` reports disconnected and recovered worker peer state before
  routing another shipment.

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
- Verify worker container connects to server container by service DNS.
- Verify REST shipment ingress through published host REST URL.
- Verify server asks worker-owned routing actor over real WebSocket transport.
- Verify server and worker telemetry JSONL files record peer connection events.
- Verify the worker container remains running after route work completes.
- Stop the worker container, verify `/runtime/status` reports the worker peer as
  disconnected, restart the worker container, and verify routing recovers.
- Browser-host manual verification uses the published web URL.

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
