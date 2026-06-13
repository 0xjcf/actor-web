# Deprecate and remove the standalone Supervisor and Superviso

## Source

Created with `fas create-task` on 2026-06-13.

## Problem

Follow-up from supervisor-trees (PR #28). The standalone Supervisor/SupervisorTree classes (actors/supervisor.ts, supervisor-tree.ts) were confirmed dead-ends during the trees work: legacy strategy union, non-functional restart, placeholder one-for-all/rest-for-one. Tree semantics now live directly in ActorSystemImpl. Supervisor and SupervisorOptions are still exported from index.ts (~66,68), so this is a public-API deprecation (deprecate in 0.2.0, remove in a later major), not just dead-code deletion.

## Acceptance criteria

- The change is verified and does not introduce regressions.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/index.ts
- packages/actor-core-runtime/src/actors/supervisor.ts
- packages/actor-core-runtime/src/actors/supervisor-tree.ts

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
