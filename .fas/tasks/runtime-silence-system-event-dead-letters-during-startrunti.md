# Runtime: silence system-event dead letters during startRunti

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

Surfaced while building CLI v0 (task actor-web CLI v0). Plain startRuntime(topology) + actor emit + system.flush() + runtime.stop() prints repeated dead-letter diagnostics during shutdown: EMIT_SYSTEM_EVENT messages targeted at actor://node/actor/system-event-actor fail with 'Mailbox not found' then 'Actor not found' because the system-event actor stops before peers finish emitting lifecycle/system events. Reproduced WITHOUT the CLI host (minimal script: start, send one message that emits, flush, stop). Exit code stays 0 but every CLI/console session ends with alarming noise. Fix in the runtime's shutdown ordering: stop the system-event actor last (or drop EMIT_SYSTEM_EVENT routing once shutdown begins) so a clean stop produces no dead letters.

## Automation admission

- Expected operator value: Improves operator leverage around "Runtime: silence system-event dead letters during startRuntime stop()" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- a minimal start/emit/flush/stop script produces no dead-letter or mailbox-not-found diagnostics
- shutdown ordering is covered by a regression test in actor-core-runtime
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
