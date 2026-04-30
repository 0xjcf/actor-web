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
