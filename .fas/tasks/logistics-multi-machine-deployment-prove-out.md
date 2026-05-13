# Logistics multi-machine deployment prove-out

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

The logistics demo now proves localhost and Docker Compose deployment
boundaries, but Stage 3 still needs a multi-machine prove-out. The target shape
is a server runtime, worker runtime, provider integration/runtime, and
browser/PWA clients running across different host boundaries with production
discovery and security seams.

## Mode

- Workflow: 6-agent
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: cross-cutting

## Scope

- Define scripts, docs, or harnesses for separate host roles:
  logistics server runtime, worker runtime, provider runtime, and browser/PWA
  client.
- Use production discovery/security adapter seams rather than Docker-only
  service DNS.
- Prove authenticated peer joins and rejected unauthenticated joins.
- Prove reconnect/resync behavior, duplicate frame suppression, backpressure
  telemetry, and exported telemetry under multi-host constraints.
- Document which guarantees are proven and which remain operator
  responsibilities.

## Affected files

- examples/ignite-headless-host/logistics-server-process.ts
- examples/ignite-headless-host/logistics-worker-process.ts
- examples/ignite-headless-host/logistics-provider-process.ts
- examples/ignite-headless-host/server-runtime-gateway.ts
- examples/ignite-headless-host/logistics-runtime-status.ts
- examples/ignite-headless-host/logistics-runtime-status.test.ts
- examples/ignite-headless-host/logistics-multiprocess.test.ts
- packages/actor-core-runtime/src/serve-actor-web-node.ts
- docs/actor-web-multi-process-deployment-demo-design.md

## Out of scope for this slice

- packages/actor-core-runtime/src/create-actor.ts
- packages/actor-core-runtime/src/pure-xstate-utilities.ts
- packages/actor-core-runtime/src/machine-registry.ts
- packages/actor-core-runtime/src/planning/hierarchical-task-network.ts
- packages/actor-core-runtime/src/runtime-fanout.ts

## Scope Amendments

- Type: planner-missed
  Original scope gap: The initial affected file set could not expose server
  runtime transport auth or deterministic backpressure configuration to the
  Stage 3 logistics proof.
  Added paths:
  - examples/ignite-headless-host/server-runtime-gateway.ts
  - packages/actor-core-runtime/src/serve-actor-web-node.ts
  Evidence source: delegated implementation blocker
  Evidence path: fas_senior_engineer handoff for token tok-b311d5faf9939313faef700a
  Accuracy signal: implementation-blocker
  Follow-up: Keep runtime-core changes additive and limited to surfacing
  existing transport options; do not change transport semantics.
- Type: reviewer-requested
  Original scope gap: The Stage 3 proof expanded `/runtime/status` transport
  telemetry, but the local status adapter contract and fixtures did not guard
  the new operator-facing shape.
  Added paths:
  - examples/ignite-headless-host/logistics-runtime-status.ts
  - examples/ignite-headless-host/logistics-runtime-status.test.ts
  Evidence source: delegated reviewer finding
  Evidence path: fas_reviewer handoff for token tok-37e9a3ed7baeeb2e19b8050d
  Accuracy signal: review-finding
  Follow-up: Keep the status adapter projection-only; do not move runtime
  ownership into Ignite UI code.

## Non-Goals

- No broker-backed transport.
- No managed cloud deployment.
- No hidden dependency on a developer's local network configuration for CI.
- No broad UI redesign beyond what is needed to observe the proof.

## Acceptance Criteria

- A human can follow the Stage 3 run shape and understand each host role.
- The proof demonstrates server, worker, provider, and browser/PWA boundaries.
- Authenticated and rejected runtime peer behavior is verified.
- Reconnect/resync, duplicate suppression, backpressure telemetry, and exported
  telemetry are exercised in the proof.
- Documentation records the remaining production responsibilities.

## Implementation Plan

1. Confirm prerequisites from the provider runtime, durable replay,
   idempotency, and discovery/security tasks.
2. Choose the least flaky way to simulate or run multi-host boundaries.
3. Add scripts/runbooks for each role.
4. Add focused automated coverage where deterministic and manual verification
   steps where real multi-machine behavior cannot be CI-stable.
5. Update deployment design docs with Stage 3 status and evidence.

## Verification

- Focused multi-machine or simulated multi-host tests
- `pnpm test:runtime`
- `pnpm test:examples`
- `pnpm lint`
- `pnpm typecheck`
- `fas verify`
- `pnpm examples:logistics:docker:verify` when Compose remains part of the path

## Dependencies

- Logistics provider runtime and container split.
- Runtime durable gateway replay storage.
- Runtime restart-persistent idempotency.
- Production discovery and secure deployment adapters.

## Risks

- Real multi-machine tests can become environment-sensitive. Keep deterministic
  automated coverage separate from optional manual prove-out steps.

## Open Questions

- Should CI validate a simulated multi-host topology only, leaving physical
  multi-machine validation as a documented manual run?
