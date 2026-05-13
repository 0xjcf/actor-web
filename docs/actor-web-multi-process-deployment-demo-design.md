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
- Do not treat the container demo as production-ready; durable replay storage,
  production deployment adapters, TLS/secret rotation, and operator runbooks
  remain hardening work.
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
- Runtime status exposes worker disconnect/recover state; richer deployment
  supervision panels remain UI hardening.

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
name: actor-web-logistics

x-logistics-build: &logistics-build
  context: .
  dockerfile: docker/logistics/Dockerfile
  additional_contexts:
    ignite-element: ../ignite-element
    fas: ../fas

services:
  server-runtime:
    build: *logistics-build
    command: pnpm examples:logistics:server
    environment:
      ACTOR_WEB_HOST: 0.0.0.0
      ACTOR_WEB_REST_PORT: 4100
      ACTOR_WEB_GATEWAY_PORT: 4101
      ACTOR_WEB_TRANSPORT_PORT: 4102
      ACTOR_WEB_TELEMETRY_JSONL: /workspace/actor-web/.actor-web/telemetry/server-transport.jsonl
      LOGISTICS_LIFECYCLE_MODE: manual
    ports:
      - "4100:4100"
      - "4101:4101"
      - "4102:4102"
    volumes:
      - ./.actor-web/telemetry:/workspace/actor-web/.actor-web/telemetry
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:4100/runtime/status').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
      interval: 2s
      timeout: 2s
      retries: 30

  worker-runtime:
    build: *logistics-build
    command: pnpm examples:logistics:worker
    depends_on:
      server-runtime:
        condition: service_healthy
    environment:
      ACTOR_WEB_HOST: 0.0.0.0
      ACTOR_WEB_SERVER_TRANSPORT_URL: ws://server-runtime:4102
      ACTOR_WEB_TELEMETRY_JSONL: /workspace/actor-web/.actor-web/telemetry/worker-transport.jsonl
    volumes:
      - ./.actor-web/telemetry:/workspace/actor-web/.actor-web/telemetry

  web:
    build: *logistics-build
    command: pnpm examples:logistics:web
    depends_on:
      server-runtime:
        condition: service_healthy
    environment:
      VITE_ACTOR_WEB_REST_URL: http://127.0.0.1:4100
      VITE_ACTOR_WEB_GATEWAY_URL: ws://127.0.0.1:4101
      VITE_ACTOR_WEB_TRANSPORT_URL: ws://127.0.0.1:4102
    ports:
      - "4173:4173"
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
- If routing stops after a worker restart while transport reconnects cleanly,
  inspect `transport.idempotency`, `transport.workerPeer.idempotency`, and any
  provider error counters/messages returned by `/runtime/status`. Provider
  claim failures should remain visible; they are not treated as accepted
  deliveries.
- If the browser cannot connect, remember that `server-runtime` is Docker DNS
  and is not reachable from the host browser. Browser env vars should use
  `127.0.0.1` published ports.
- If telemetry is missing, check `.actor-web/telemetry/server-transport.jsonl`
  and `.actor-web/telemetry/worker-transport.jsonl` after the services stop.
- The smoke verification stops and restarts `worker-runtime`, then confirms
  `/runtime/status` reports disconnected and recovered worker peer state before
  routing another shipment.

## Stage 3: Multi-Machine Prove-Out

Stage 3 carries the current runtime guarantees into a topology where runtime
nodes can run on different machines:

```text
machine A: logistics server runtime
machine B: logistics worker runtime
machine C: provider integration/runtime
machine D: browser/PWA clients
```

Implemented automated proof:

```sh
pnpm exec vitest run --config examples/vitest.config.ts \
  examples/ignite-headless-host/logistics-multiprocess.test.ts \
  examples/ignite-headless-host/logistics-runtime-status.test.ts
```

The Stage 3 logistics proof now keeps the existing thin launcher shape and
drives the committed typed entrypoints for each role:

- `examples/ignite-headless-host/logistics-server-process.ts`
- `examples/ignite-headless-host/logistics-worker-process.ts`
- `examples/ignite-headless-host/logistics-provider-process.ts`

The automated proof covers these deployment-shaped seams without assuming
Docker-only DNS:

- server runtime, worker runtime, and provider runtime bind loopback/ephemeral
  ports and exchange explicit transport URLs.
- browser/PWA clients remain gateway consumers and `/runtime/status` observers,
  not runtime peers.
- shared runtime peer auth can be injected through
  `ACTOR_WEB_RUNTIME_AUTH_TOKEN`; the proof exercises both accepted peer joins
  and rejected unauthenticated joins.
- gateway auth can be injected through `ACTOR_WEB_GATEWAY_AUTH_TOKEN`; the
  browser reconnect/resubscribe proof uses the same boundary a real PWA would.
- transport queue configuration can be injected through
  `ACTOR_WEB_TRANSPORT_OUTBOUND_QUEUE_LIMIT`; `/runtime/status` now exports the
  configured limit plus reconnect, handshake, duplicate-drop, and
  backpressure-drop counters.
- worker and provider reconnect behavior is exercised by stopping and
  restarting the separate processes, then proving routing/provider workflows
  recover on the restarted peers.
- exported telemetry remains file-based (`ACTOR_WEB_TELEMETRY_JSONL`) so the
  proof can assert auth and peer lifecycle events without requiring an external
  observability backend.

What the Stage 3 automated proof demonstrates today:

- runtime peer authentication with deployment-managed secrets,
- reconnect and membership behavior through explicit URL discovery seams,
- bounded projection replay/resubscribe after browser disconnect,
- exported operational telemetry and traceability for auth, peer lifecycle, and
  reconnect counters.

What remains intentionally outside the automated prove-out:

- physical multi-machine network validation such as DNS, mTLS/TLS termination,
  firewall rules, secret rotation, and host-level process supervision.
- non-zero duplicate-frame and backpressure counters in the logistics example.
  Actor-Web transport unit tests already exercise duplicate suppression,
  outbound queue pressure, and retry semantics directly; Stage 3 exposes those
  counters and telemetry through `/runtime/status` and JSONL export so
  operators can validate them during physical multi-machine rehearsals.
- durable replay storage, restart-persistent duplicate suppression, and
  production discovery adapters still remain hardening layers rather than demo
  defaults.
- browser clients continue to observe through gateway + REST only. They do not
  join runtime membership directly and should not be treated as transport peers.

Durable replay storage and production deployment adapters remain the hardening
boundary between this demo and a production reference architecture.
Restart-persistent duplicate suppression is now available as an opt-in
provider-backed transport capability; it does not change the direct-peer,
at-most-once transport contract.

Actor-Web core stays provider-neutral in this stage. A deployment adapter may
translate service-discovery output into `RuntimePeerDiscoveryRecord` values, but
it should not introduce cloud SDKs or provider-owned lifecycle into the runtime.

Recommended manual multi-machine rehearsal:

1. Start the server process on machine A with explicit `ACTOR_WEB_*` ports,
   optional `ACTOR_WEB_RUNTIME_AUTH_TOKEN`, optional
   `ACTOR_WEB_GATEWAY_AUTH_TOKEN`, and JSONL telemetry output enabled.
2. Start the worker and provider processes on machines B and C with
   `ACTOR_WEB_SERVER_TRANSPORT_URL` pointed at the server listener and the same
   runtime auth token.
3. Point browser/PWA clients on machine D at the server REST/gateway URLs only.
4. Confirm `/runtime/status` reports authenticated peers, reconnect counters,
   queue-limit telemetry, and exported JSONL auth/peer events before treating
   the topology as deployment-ready.
Use deployment-managed auth token factories/verifiers for peer admission, keep
secrets out of discovery metadata and telemetry, and treat TLS termination,
certificate rotation, and secret rotation as deployment responsibilities outside
Actor-Web core.

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
- Stop/restart recovery can be validated through runtime status; richer
  operational panels are separate UI work.

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
- Verify `/runtime/status` exposes rejected peer reasons and stale-peer
  diagnostics without exposing secrets.
- Verify reconnect/resync after browser disconnect.
- Verify duplicate runtime frame IDs are dropped by the in-memory idempotency
  cache when no provider is configured.
- Verify duplicate runtime frame IDs are acked and dropped across runtime
  restart when a persistent idempotency provider is configured.
- Verify slow consumer/backpressure telemetry when bounded queues fill.

## Relationship To Transport Hardening

This demo now relies on current runtime guarantees instead of treating them all
as future gates:

- topology/source API,
- gateway and runtime-peer auth hooks,
- runtime message IDs, bounded idempotency caches, and opt-in restart-persistent
  provider claims,
- ack control frames for runtime control traffic,
- bounded outbound queues with backpressure telemetry,
- bounded gateway replay/resync,
- runtime peer discovery providers,
- runtime telemetry export with the Node JSONL sink,
- Docker worker restart recovery verification.

The remaining hardening boundary is production deployment readiness: durable
replay storage, production-grade discovery/deployment adapters, TLS and secret
rotation, rollback guidance, and operations runbooks. Runtime idempotency stays
direct-peer and at-most-once; this demo does not introduce exactly-once
delivery semantics.

The production-facing procedures for those remaining responsibilities now live
in [operations/actor-web-production-operations.md](operations/actor-web-production-operations.md).
Keep this document focused on proof shape and demo evidence; use the runbook
for operator actions and production-vs-demo boundary guidance.

## Assumptions

- The logistics demo remains the flagship Actor-Web integration example.
- `pnpm examples:logistics` remains the simplest local demo command.
- Multi-process and Docker Compose commands are additive.
- Direct WebSocket transport remains the first production topology.
- Broker-backed transport remains a later option after direct transport
  semantics are hardened.
