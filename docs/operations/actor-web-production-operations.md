# Actor-Web Production Operations Runbook

This runbook covers the current production-facing operations boundary for the
direct WebSocket transport path in Actor-Web. It is intentionally limited to
what the repository currently implements:

- direct runtime-to-runtime WebSocket transport,
- gateway replay/resync for projection clients,
- runtime peer auth hooks,
- runtime status diagnostics,
- JSONL telemetry export,
- logistics prove-out commands that exercise those seams.

This document does not turn the demo Docker Compose topology into a production
reference architecture. It also does not add broker transport guidance, cloud
provider steps, or runtime semantics that Actor-Web does not currently ship.

## Ownership Boundary

Actor-Web owns:

- runtime actor placement and runtime-to-runtime transport,
- gateway projection/control transport,
- `/runtime/status` transport diagnostics,
- direct WebSocket peer auth hooks,
- bounded replay/resubscribe behavior for gateway consumers,
- runtime transport telemetry export.

Ignite and browser/PWA hosts consume:

- gateway snapshots, events, and explicit opt-in command surfaces,
- `/runtime/status` as an operator-facing read-model feed.

Ignite remains a projection/read-model consumer only. It does not join runtime
membership and it does not own actor state, transport membership, or replay
storage policy.

## Deployment Lanes

Use the correct lane for the question you are answering:

| Lane | Purpose | Commands |
| --- | --- | --- |
| Demo Compose | Local container proof only | `docker compose -f docker-compose.logistics.yml up --build`, `pnpm examples:logistics:docker:verify` |
| Stage 3 proof | Deterministic multi-process/multi-machine seam proof | `pnpm exec vitest run --config examples/vitest.config.ts examples/ignite-headless-host/logistics-multiprocess.test.ts examples/ignite-headless-host/logistics-runtime-status.test.ts` |
| Production runtime | Real deployment responsibility | Use `serveNode(...)` for Node runtime owners such as server/worker/provider peers, reserve `startActorWebNode(...)` for browser or worker-runtime locations, use `serveActorWebHttp(...)` for explicit HTTP ingress, and keep auth/TLS/secrets plus rollout/rollback in deployment-owned procedures |

Do not use Docker Compose as proof of production readiness. It validates the
direct transport seam and restart recovery shape, but TLS termination,
certificate rotation, secret rotation, DNS, host supervision, and rollout
strategy remain deployment responsibilities.

## Exact Runtime Surfaces

These are the current repository-owned surfaces the logistics roadmap depends
on:

- `serveNode(...)`: starts a Node runtime owner, optional gateway, and
  optional transport listener.
- `startActorWebNode(...)`: starts a browser-safe or worker-runtime peer that
  owns actors and connects outward to transport peers.
- `serveActorWebHttp(...)`: application ingress adapter for explicit REST
  routes such as `/runtime/status`.
- `createActorWebReadModelClient(...)` and
  `createActorWebReadModelSource(...)`: default client/gateway read-model
  consumers, not runtime peers.
- `createActorWebCommandSource(...)`: explicit host-owned gateway command path
  when a browser or thin host intentionally owns control for an exposed actor.
- `getTransportStatus()` and `getPeerStatus(nodeAddress)`: runtime-native peer
  health/status accessors.
- `createRuntimeTransportTelemetryExporter(...)` with
  `createRuntimeTransportTelemetryJsonlFileSink(...)`: file-backed transport
  telemetry export.

See [../API.md](../API.md) for the API contracts and
[../actor-web-multi-process-deployment-demo-design.md](../actor-web-multi-process-deployment-demo-design.md)
for the current demo and Stage 3 proof boundary.

## Production Deployment Shape

The supported production shape for this runbook is:

1. Actor-owning Node runtime started with `serveNode(...)`.
2. Node worker/provider runtime peers started with `serveNode(...)`
   and explicit discovery or transport URLs; browser or worker-runtime peers
   use `startActorWebNode(...)` where that runtime shape is actually deployed.
3. Browser/PWA clients pointed only at the REST and gateway URLs.
4. Deployment-managed auth tokens passed through
   `ACTOR_WEB_RUNTIME_AUTH_TOKEN` and `ACTOR_WEB_GATEWAY_AUTH_TOKEN` or
   equivalent token factories/verifiers.
5. JSONL telemetry enabled through `ACTOR_WEB_TELEMETRY_JSONL` when transport
   event retention is required.

Recommended production baseline:

- Use `wss://` for runtime peer URLs and gateway URLs.
- Terminate TLS outside Actor-Web core or wrap the Node listener with your
  deployment's TLS layer.
- Keep token generation, distribution, and revocation in deployment systems,
  not in Actor-Web discovery metadata.
- Enable bounded queue configuration explicitly with
  `ACTOR_WEB_TRANSPORT_OUTBOUND_QUEUE_LIMIT` so drop behavior is intentional.
- Enable telemetry file export or a custom sink before treating a new topology
  as operationally ready.

## Deployment Procedure

1. Prepare runtime config for each actor-owning role:
   - server runtime: REST, gateway, transport, telemetry, auth token inputs.
   - worker/provider runtimes: outbound transport URL, telemetry, runtime auth.
   - browser/PWA clients: REST and gateway URLs only.
2. Deploy the server runtime first and verify that REST and transport listeners
   are reachable.
3. Deploy worker and provider runtimes and confirm they authenticate and appear
   in `/runtime/status`.
4. Point projection clients at the gateway URL after runtime peers are healthy.
5. Validate telemetry export and capture the first healthy `/runtime/status`
   snapshot as the post-deploy baseline.

Minimum post-deploy checks:

- `curl <rest-url>/runtime/status`
- peer entries show `connected: true` and `fresh: true`
- rejected peers are empty or explained
- queue-limit, reconnect, duplicate-drop, and backpressure counters are present
- JSONL transport telemetry is being written if enabled

## Rollback Procedure

Rollback remains deployment-owned because Actor-Web does not ship a rollout
controller. Use your deployment system to restore the last known-good runtime
revision, then validate with Actor-Web surfaces:

1. Roll back the affected runtime process or runtime peer group.
2. Re-check `/runtime/status` for peer reconnection and freshness.
3. Confirm gateway clients resubscribe and recover to a live snapshot.
4. Inspect JSONL telemetry around the rollback window for auth rejects,
   disconnects, replay/resubscribe, and queue-pressure signals.
5. Keep the previous telemetry files and status snapshots as the incident
   boundary record.

Rollback trigger examples:

- repeated peer auth rejects after secret rotation,
- stale peers that do not recover after a targeted restart,
- sustained backpressure drops after a deployment,
- replay recovery that repeatedly falls back to fresh snapshots when durable
  replay was expected by the application,
- unexpected provider idempotency claim errors after a runtime upgrade.

## TLS And Secret Rotation

Actor-Web exposes auth hooks but does not own certificate lifecycle or secret
distribution. Treat these as deployment responsibilities:

- TLS termination, certificate issuance, and certificate rotation happen in
  your network or process edge, not in Actor-Web runtime code.
- Runtime peer auth and gateway auth tokens must be rotated by the deployment
  system.
- Discovery metadata must not carry secrets.
- Telemetry and `/runtime/status` should be inspected after rotation to confirm
  successful reconnect/auth without exposing token values.

Rotation expectations:

1. Stage new runtime and gateway secrets in deployment-managed config.
2. Roll runtimes in an order that preserves at least one healthy server
   transport endpoint.
3. Watch `/runtime/status` for temporary disconnects, `rejectedReason`, and
   freshness recovery.
4. Review JSONL telemetry for `auth.rejected`, `peer.rejected`, or repeated
   handshake rejects.
5. Remove old secrets only after all runtime peers and gateway clients have
   rejoined cleanly.

## Runtime Status Diagnosis

`/runtime/status` is the primary operator surface for the current direct
transport path. Use it before inspecting internals.

Start with:

```sh
curl http://127.0.0.1:4100/runtime/status
```

Key fields to inspect:

- peer connectivity and `connectedNodes`
- peer `state`, `connected`, `fresh`, `lastSeenAt`, `disconnectedAt`
- `rejectedReason` and `staleReason`
- reconnect/disconnect counters
- duplicate-drop and idempotency provider counters
- outbound queue limit, queue depth, and backpressure-drop counters

Interpretation guide:

`/runtime/status` covers runtime transport membership, peer freshness,
idempotency, queue pressure, and related transport telemetry. Replay or
resubscribe recovery belongs to the gateway client path and should be confirmed
through gateway client state/events or gateway replay diagnostics instead of
this surface.

| Symptom | Primary fields | Likely meaning |
| --- | --- | --- |
| Peer disconnected | `connected: false`, `disconnectedAt` | peer process stopped, network path failed, or auth never completed |
| Peer stale | `fresh: false`, `staleReason` | heartbeat timeout or missing last-seen updates |
| Peer rejected | `rejectedReason` | auth, protocol, identity, or malformed-handshake failure |
| Duplicate drops rising | duplicate/idempotency counters | duplicate frame suppression is active; inspect whether restart-persistent mode is expected |
| Backpressure drops rising | queue limit/depth/drop counters | producer is overrunning bounded outbound queues |
| Gateway client replay recovery | gateway client state/events move through replay/resubscribe | projection client lost continuity and recovered through the gateway path; inspect the gateway client or replay diagnostics, not `/runtime/status` |

## Telemetry Inspection

Enable JSONL export with `ACTOR_WEB_TELEMETRY_JSONL` on each runtime you need
to observe. Typical logistics proof paths are:

- `.actor-web/telemetry/server-transport.jsonl`
- `.actor-web/telemetry/worker-transport.jsonl`
- `.actor-web/telemetry/provider-transport.jsonl`

Inspect telemetry when:

- `/runtime/status` shows rejected or stale peers,
- you need event ordering around a restart or rollback,
- backpressure counters or duplicate counters rise,
- a secret rotation or deploy changed peer admission behavior.

Recommended inspection pattern:

1. capture the `/runtime/status` snapshot,
2. isolate the relevant runtime telemetry files,
3. search for auth, peer lifecycle, handshake reject, reconnect, and queue
   pressure events around the same timestamps,
4. preserve the files with the incident report.

## Incident Runbooks

### Stale peer triage

1. Check `/runtime/status` for `fresh: false`, `staleReason`, `lastSeenAt`, and
   `disconnectedAt`.
2. Confirm whether the peer is still connected but not heartbeating, or fully
   disconnected.
3. Inspect telemetry for heartbeat timeout, reconnect, or auth rejection events.
4. Restart only the affected peer process first.
5. If the peer does not recover, treat it as a deployment/network/auth issue,
   not an Ignite/UI issue.

### Rejected peer triage

1. Read `rejectedReason` from `/runtime/status`.
2. Inspect JSONL telemetry for `auth.rejected`, `peer.rejected`, or
   `handshake.rejected`.
3. Verify runtime auth token alignment and protocol/version compatibility.
4. Confirm the peer is using the runtime transport URL, not the gateway URL.
5. If rejection starts immediately after secret rotation, use the rollback
   procedure or complete the rotation across all peers.

### Replay recovery triage

This applies to gateway consumers, not runtime peer membership.

1. Confirm the affected surface is a browser/PWA/gateway client.
2. Verify the client reconnects and resubscribes through the gateway.
3. If durable replay storage is configured by the application, inspect replay
   storage health and operator hooks outside Actor-Web core.
4. If the requested replay range is unavailable, expect recovery to the latest
   snapshot instead of exact frame continuity.
5. Do not treat Ignite or browser clients as runtime peers while debugging this
   path.

### Duplicate-drop triage

1. Inspect duplicate/idempotency counters in `/runtime/status`.
2. Decide whether in-memory duplicate suppression is sufficient for the
   incident window or whether a provider-backed idempotency configuration was
   expected.
3. Inspect telemetry for idempotency provider duplicate or error counters.
4. If provider claim errors rise, treat that as a production hardening issue in
   the deployment/application provider layer rather than silently ignoring it.

### Backpressure incident triage

1. Check `ACTOR_WEB_TRANSPORT_OUTBOUND_QUEUE_LIMIT` for the deployed value.
2. Inspect queue depth and backpressure-drop counters in `/runtime/status`.
3. Review telemetry around the same timestamps for sustained outbound pressure.
4. Reduce producer pressure, add capacity, or change deployment topology before
   increasing limits blindly.
5. Treat repeated queue drops as a transport-capacity incident, not a gateway
   projection bug.

## Proof Commands Versus Production Responsibility

Use these commands as evidence of implemented seams, not as production
orchestration:

- `pnpm examples:logistics`
  - single-command local developer path
- `pnpm examples:logistics:server`
  - direct server runtime entrypoint
- `pnpm examples:logistics:worker`
  - direct worker runtime entrypoint
- `pnpm examples:logistics:web`
  - thin browser host only
- `pnpm examples:logistics:docker:verify`
  - Docker demo verification, including worker restart recovery
- `pnpm exec vitest run --config examples/vitest.config.ts examples/ignite-headless-host/logistics-multiprocess.test.ts examples/ignite-headless-host/logistics-runtime-status.test.ts`
  - Stage 3 deterministic proof for auth, reconnect, telemetry, replay status,
    rejected peers, duplicate counters, and backpressure counters

Production responsibilities that remain outside these commands:

- host/process supervision,
- TLS certificate lifecycle,
- secret distribution and revocation,
- DNS and firewall policy,
- physical multi-machine routing,
- deployment rollout policy and rollback execution,
- external telemetry backend integration if JSONL is insufficient.

## Follow-Up Gaps Intentionally Not Implemented Here

These are intentionally documented but not changed in this task:

- no cloud-provider-specific deployment adapters or guides,
- no broker-backed transport runbooks before broker transport exists,
- no runtime semantic changes for replay, delivery guarantees, or backpressure,
- no new diagnostic APIs because `/runtime/status` and telemetry already cover
  the required runbook signals for the direct transport path.
