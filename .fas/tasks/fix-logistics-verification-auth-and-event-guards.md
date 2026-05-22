# Fix logistics verification, auth, and event guards

## Source

Created with `fas create-task` on 2026-05-22.

## Problem

Covers CodeRabbit logistics and scripts findings: docker-compose worker/provider disconnect checks use flat peerFresh properties instead of nested peer.fresh, shared-secret auth uses non-timing-safe comparison, shipment/provider event guards miss required fields, timeline verification assumes index 0 ordering, dev demo accepts NaN PORT, and architecture boundary rule parsing assumes malformed runtime patterns are valid.

## Acceptance criteria

- Docker compose verification checks workerPeer.fresh and providerPeer.fresh through the current nested runtime status shape.
- Shared secret verification uses timing-safe comparison and safely handles missing or length-mismatched tokens.
- Shipment and provider HQ event guards validate all required fields for each event variant.
- Timeline verification finds the intended lifecycle event robustly instead of assuming index 0.
- Dev logistics demo validates PORT and reports a clear error or safe fallback for invalid values.
- Architecture boundary checker reports malformed runtime patterns clearly before constructing RegExp.
- Focused script/example tests or deterministic verification cover each corrected path.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- scripts/verify-logistics-docker-compose.mjs
- scripts/dev-logistics-demo.ts
- scripts/check-architecture-boundaries.mjs
- examples/ignite-headless-host/server-runtime-gateway.ts
- examples/ignite-headless-host/logistics-contract.ts
- examples/ignite-headless-host/logistics-runtime-status.test.ts
- examples/ignite-headless-host/headless-host.test.ts

## Scope Amendments

- None.

## Implementation plan

- Convert the supplied context into a scoped implementation plan before editing.
- Refresh affected-file scope before implementation if the generated hints are incomplete.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Validate generated scope, acceptance criteria, and verification evidence before closeout to avoid workflow drift.

## Dependencies

- None known at task creation.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
