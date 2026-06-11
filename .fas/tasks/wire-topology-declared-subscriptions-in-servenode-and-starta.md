# Wire topology-declared subscriptions in serveNode and startActorWebNode

## Source

Created with `fas create-task` on 2026-06-11.

## Problem

Wire topology-declared subscriptions in serveNode and startActorWebNode

## Acceptance criteria

- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/serve-actor-web-node.ts
- packages/actor-core-runtime/src/start-actor-web-node.ts
- packages/actor-core-runtime/src/actor-web-node-runtime.ts
- packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts
- packages/actor-core-runtime/src/unit/start-actor-web-node.test.ts
- docs/actor-web-declarative-subscriptions-design.md

## Scope Amendments

- 2026-06-11: Removed `packages/actor-core-runtime/src/actor-web-client.ts` from scope — its subscription wiring (lines 484-514) already works for the multi-node in-process local runtime and needed no change; the shared helper landed in `actor-web-node-runtime.ts` instead, consumed by both node hosts. Added the two host unit-test files and the declarative-subscriptions design doc (current-state refresh) that the implementation touched.

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
