# Docs honesty pass: scope the location-transparency claim at first mention and reconcile multi-machine status

## Source

Created with `fas create-task` on 2026-06-19.

## Problem

Location-transparency audit L6. (1) Hero one-liners (README:3,17,76; packages/actor-core-runtime/README.md:3; docs/site/index.md:7) assert distributed and location-transparent flatly; add a first-mention qualifier (across directly-connected nodes; dynamic membership in progress) linking the external-transport status doc. (2) Refresh README:67 (now stale-in-favor: identity/auth/replay/telemetry partly landed). (3) Reconcile the multi-machine prove-out contradiction: TASKS.md:535 done vs external-transport-design.md:204 remaining; state precisely what was proven (multi-process on one host) vs not (true multi-host).

## Acceptance criteria

- The change is verified and does not introduce regressions.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- Scope unknown.

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
