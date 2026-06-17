# Enforce errors-as-data behavior-boundary profile (flip from throwing-adapters)

## Source

Created with `fas create-task` on 2026-06-17.

## Problem

Governance gap (found during P2 architecture review). .fas-config.json sets behaviorBoundaryProfile=throwing-adapters, which disables the adapters-return-facts/errors-as-values check (FAS behavior-boundary-runner.js:496 enforceAdapterErrorsAsData = profile !== 'throwing-adapters'). The functional-core/shell/import-rule checks ARE enforced; only errors-as-values is off. To enforce it: (1) flip behaviorBoundaryProfile to 'errors-as-data'; (2) classify the transport files (node/browser/message-port/in-memory) as adapters; (3) remediate the ~30 adapter throws (messaging 9, interceptors 2, performance 1, node-ws 4, browser-ws 5, message-port 3, in-memory 6) — convert expected-error throws to explicit failure facts or route through a narrow core failure helper; keep truly-exceptional invariant throws via that helper. Flipping before remediation breaks full verify, so this is a standalone task, not bundled into P2. Verify with .fas/scripts/verify.sh --full (behavior boundaries full scope).

## Acceptance criteria

- The defect no longer reproduces.
- A regression test covers the fix.
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
