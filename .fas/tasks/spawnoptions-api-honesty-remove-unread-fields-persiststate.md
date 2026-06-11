# SpawnOptions API honesty: remove unread fields (persistState, timeout, retries) and decide supervised semantics

## Source

Created with `fas create-task` on 2026-06-11.

## Problem

SpawnOptions API honesty: remove unread fields (persistState, timeout, retries) and decide supervised semantics

## Acceptance criteria

- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/actor-system.ts
- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/actor-web-node-runtime.ts
- packages/actor-core-runtime/src/actor-system-guardian.ts
- packages/actor-core-runtime/src/create-component.ts
- packages/actor-core-runtime/src/unit/spawn-options.test.ts
- .fas/memory/decisions.md

## Scope Amendments

- 2026-06-11: Added `actor-system-guardian.ts` and `create-component.ts` — both passed the removed `supervised` field at spawn call sites and needed the one-line cleanup; added the new `unit/spawn-options.test.ts` (type-level contract pins) and `.fas/memory/decisions.md` (decision record). `supervised` was REMOVED rather than honored: its semantics are entangled with per-actor topology supervision-policy wiring (the policy object is collapsed to a dropped Boolean today), filed as the follow-up "Wire per-actor topology supervision policies into the runtime failure path".

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
