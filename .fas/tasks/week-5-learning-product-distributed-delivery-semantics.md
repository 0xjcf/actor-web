# Week 5 learning product: distributed delivery semantics

## Source

Created with `fas create-task` on 2026-07-31.

## Problem

Build the guide, workbook, and lab for address resolution, transport, ordering scope, at-most-once delivery, timeouts, retry ambiguity, partitions, remote hosting, and why an ask timeout does not reveal the remote outcome.

## Acceptance criteria

- Teach the current local and distributed message path using merged PR 56 runtime-host and transport evidence.
- Distinguish enqueue, delivery, handling, acknowledgement, external completion, and reconciliation.
- Add bounded drop, delay, duplicate, reordering, timeout, reconnect, and replay experiments.
- Add an interactive cross-node delivery lab with authoritative versus simulated states labeled.
- Keep stronger delivery guarantees as application protocols or maturity-labeled targets, not implicit send or ask behavior.
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

- Queue prerequisites: task-1785529946967 (Week 4) and completed runtime-host proof task-1785250582987.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
