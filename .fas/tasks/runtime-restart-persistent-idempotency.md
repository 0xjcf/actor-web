# Runtime restart-persistent idempotency

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

Runtime message IDs and bounded in-memory idempotency caches already suppress
duplicates during a process lifetime. Production deployment hardening needs a
provider-backed option for duplicate suppression that can survive runtime
restart while keeping the current direct-peer, at-most-once transport contract
explicit.

## Mode

- Workflow: 6-agent
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: cross-cutting

## Scope

- Add a persistence-provider boundary for runtime frame idempotency state.
- Preserve the existing bounded in-memory cache as the default.
- Prove duplicate runtime frames are dropped across runtime restart when a
  persistent provider is configured.
- Expose status or telemetry needed to diagnose persistent idempotency behavior.
- Update docs to state how this interacts with at-most-once direct-peer
  transport semantics.

## Non-Goals

- No exactly-once transport guarantee.
- No broker-backed delivery.
- No default database dependency.
- No unrelated changes to gateway replay storage.

## Acceptance Criteria

- Persistent idempotency is opt-in and provider-backed.
- In-memory idempotency behavior remains unchanged by default.
- Tests cover default duplicate suppression and restart-persistent duplicate
  suppression.
- Runtime status or telemetry gives operators enough signal to diagnose
  duplicate drops and provider failures.
- Docs preserve the current transport guarantee wording unless the task
  explicitly changes it.

## Implementation Plan

1. Inspect the current runtime message ID and idempotency cache implementation.
2. Define a minimal persistence-provider contract for duplicate suppression.
3. Wire the provider through topology runner or transport options.
4. Add restart-oriented tests using a deterministic provider.
5. Update API docs and deployment hardening docs.

## Verification

- `pnpm test:runtime`
- `pnpm test:examples`
- `pnpm lint`
- `pnpm typecheck`
- `fas verify`

## Dependencies

- Existing runtime transport message ID and idempotency implementation.

## Risks

- Persistence failures can create confusing delivery behavior if hidden. Surface
  provider errors through telemetry/status rather than silently degrading.

## Open Questions

- Should persistent idempotency share storage provider conventions with durable
  gateway replay, or stay as a separate contract?
