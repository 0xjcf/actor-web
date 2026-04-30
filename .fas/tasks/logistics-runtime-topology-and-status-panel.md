# Logistics runtime topology and status panel

## Source

Created with `fas create-task --queue` on 2026-04-30 from the remaining work
in `docs/actor-web-multi-process-deployment-demo-design.md`.

## Roadmap Position

1. Logistics runtime topology and status panel
2. Logistics provider runtime and container split
3. Runtime durable gateway replay storage
4. Runtime restart-persistent idempotency
5. Production discovery and secure deployment adapters
6. Logistics multi-machine deployment prove-out
7. Actor-Web production operations runbooks

## Problem

The logistics control tower has a static topology summary and per-source
transport badges, but it does not yet expose the runtime health information
required by the deployment demo roadmap. Operators should be able to inspect
node identity, peer state, heartbeat freshness, and telemetry counters without
curling `/runtime/status` or reading JSONL telemetry by hand.

## Mode

- Workflow: 6-agent
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: cross-cutting

## Scope

- Replace or extend the static runtime topology list in the logistics Ignite
  host with a runtime status panel backed by `/runtime/status`.
- Show browser host, server runtime, worker runtime, and service-worker proof
  with process/container labels.
- Show runtime node identity, actor addresses, worker peer state, connected and
  fresh booleans, heartbeat freshness, `lastSeenAt`, `disconnectedAt`,
  `staleReason`, and `rejectedReason` when present.
- Expose available transport telemetry counters in the panel, or add a small
  `/runtime/status` projection extension when the runtime already has the data
  but the endpoint does not.
- Keep Ignite Element as a thin projection/read-model host. It must not own
  actor state or transport implementation details.
- Cover connected, disconnected, and recovered worker states in focused tests.

## Non-Goals

- No provider runtime/container split.
- No durable replay storage.
- No multi-machine deployment proof.
- No production telemetry backend.

## Acceptance Criteria

- The logistics UI shows live runtime topology and status derived from
  `/runtime/status`.
- Worker disconnect and recovery are visible in the UI using runtime-derived
  peer state, not logistics-local freshness rules.
- Transport metrics shown in the UI are either sourced from existing runtime
  telemetry/status data or explicitly marked as unavailable.
- Tests cover connected, disconnected, and recovered worker rendering.
- Documentation or comments clarify that the panel is an operator demo surface,
  not a cluster membership source of truth.

## Implementation Plan

1. Inspect the current `/runtime/status` response shape and identify the
   smallest UI-ready view model needed by the panel.
2. Add a typed status fetch/projection boundary for the logistics browser host.
3. Render the runtime topology/status panel in
   `examples/ignite-headless-host/ignite-headless-host-element.tsx`.
4. Extend CSS only for the new panel states and keep the existing control tower
   layout stable.
5. Add focused tests for status mapping and UI rendering.
6. Update the deployment design or API docs only if the exposed status shape
   changes.

## Verification

- `pnpm test:examples`
- `pnpm lint`
- `pnpm typecheck`
- `fas verify`
- `pnpm examples:logistics:docker:verify` if container status behavior changes

## Dependencies

- Existing `/runtime/status` endpoint in the logistics server runtime.
- Existing runtime transport status APIs:
  `getTransportStatus()` and `getPeerStatus(...)`.

## Risks

- Pulling raw transport internals directly into the UI would weaken the
  projection boundary. Keep a small typed adapter between the endpoint and the
  rendered view.
- Telemetry counters may not all exist in status yet. Prefer an explicit
  unavailable state over inventing client-side counters.

## Open Questions

- Should telemetry counters be read from `/runtime/status`, JSONL telemetry, or
  a separate status endpoint? Prefer `/runtime/status` unless implementation
  shows it would couple unrelated concerns.
